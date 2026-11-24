import { Injectable } from '@nestjs/common';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { AppConfig } from '../../core/config/app-config.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import type { Principal } from '../../core/auth/principal.js';
import { RealtimeService } from './realtime.service.js';
import {
  limits,
  parseProof,
  recheckPrincipal,
  withDeadline,
} from './protocol-validation.js';
@Injectable()
export class SocketIoService {
  private io: Server | undefined;
  private pending = 0;
  private closed = false;
  constructor(
    private readonly config: AppConfig,
    private readonly authority: PrincipalAuthority,
    private readonly registry: RealtimeService,
    private readonly cluster?: {
      readonly available: boolean;
      attach(io: Server, registry: RealtimeService): Promise<void>;
      close(): Promise<void>;
    },
  ) {}
  async attach(server: HttpServer): Promise<void> {
    if (this.io || this.closed)
      throw new Error('REALTIME_ALREADY_ATTACHED_OR_CLOSED');
    const io = new Server(server, {
      path: this.config.realtime.path,
      transports: ['websocket'],
      allowUpgrades: false,
      maxHttpBufferSize: this.config.realtime.maxPayloadBytes,
      connectTimeout: limits.authTimeoutMs,
      perMessageDeflate: false,
      serveClient: false,
      allowRequest: (request, next) =>
        next(
          null,
          !this.closed &&
            (!this.cluster || this.cluster.available) &&
            (this.io?.engine.clientsCount ?? 0) < limits.connections &&
            this.pending < limits.pendingAdmissions &&
            this.config.allowedOrigins.includes(request.headers.origin ?? ''),
        ),
    });
    this.io = io;
    if (this.cluster) await this.cluster.attach(io, this.registry);
    const principals = new WeakMap<Socket, Principal>();
    io.use((socket, next) => {
      if (this.pending >= limits.pendingAdmissions || this.closed) {
        next(new Error('REALTIME_LIMIT'));
        return;
      }
      this.pending++;
      void (async () => {
        try {
          if (
            Object.keys(socket.handshake.query).some(
              (key) => !['EIO', 'transport', 't'].includes(key),
            )
          )
            throw new Error('INVALID_QUERY');
          const principal = await withDeadline(
            this.authority.verify(
              parseProof(socket.handshake.auth, this.config.auth.driver),
            ),
          );
          socket.handshake.auth = {}; // Do not retain credentials with the socket.
          if (this.closed || principal.expiresAt <= Date.now())
            throw new Error('UNAUTHENTICATED');
          principals.set(socket, principal);
          next();
        } catch {
          socket.handshake.auth = {};
          next(new Error('UNAUTHENTICATED'));
        } finally {
          this.pending--;
        }
      })();
    });
    io.on('connection', (socket) => {
      const principal = principals.get(socket);
      if (!principal) {
        socket.disconnect(true);
        return;
      }
      try {
        this.registry.add({
          id: socket.id,
          principal,
          send: (event) => {
            if (!socket.connected || !socket.conn.transport.writable)
              return false;
            socket.volatile.emit('notification', event);
            return true;
          },
          close: () => {
            socket.disconnect(true);
          },
        });
      } catch {
        socket.disconnect(true);
        return;
      }
      let count = 0;
      let windowStart = Date.now();
      let busy = false;
      socket.onAny((name: string) => {
        if (Date.now() - windowStart >= 60000) {
          windowStart = Date.now();
          count = 0;
        }
        if (++count > limits.messagesPerMinute || name !== 'ping')
          socket.disconnect(true);
      });
      socket.on('ping', (input: unknown, ack: unknown) => {
        if (busy || typeof ack !== 'function' || input !== null) {
          socket.disconnect(true);
          return;
        }
        busy = true;
        void recheckPrincipal(this.authority, principal)
          .then(() => {
            if (socket.connected && socket.conn.transport.writable)
              (ack as (reply: { version: 1; type: 'pong' }) => void)({
                version: 1,
                type: 'pong',
              });
            else socket.disconnect(true);
          })
          .catch(() => {
            socket.disconnect(true);
          })
          .finally(() => {
            busy = false;
          });
      });
      socket.once('disconnect', () => {
        this.registry.remove(socket.id);
      });
      socket.emit('admitted', { version: 1, recovery: 'REST' });
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.cluster?.close();
    } finally {
      if (this.io)
        await new Promise<void>((resolve) => this.io!.close(() => resolve()));
    }
  }
}
