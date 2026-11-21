import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import type { AppConfig } from '../../core/config/app-config.js';
import type { Principal } from '../../core/auth/principal.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import { RealtimeService } from './realtime.service.js';
import { limits, recheckPrincipal } from './protocol-validation.js';
import { RealtimeTicketService } from './realtime-ticket.service.js';

const authFrame = z.strictObject({
  version: z.literal(1),
  type: z.literal('authenticate'),
  ticket: z.string().length(43),
});
const pingFrame = z.strictObject({
  version: z.literal(1),
  type: z.literal('ping'),
  requestId: z.uuid(),
});

@Injectable()
export class NativeWsService {
  private readonly wss: WebSocketServer;
  private server: Server | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private closed = false;

  constructor(
    private readonly config: AppConfig,
    private readonly authority: PrincipalAuthority,
    private readonly tickets: RealtimeTicketService,
    private readonly registry: RealtimeService,
  ) {
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: config.realtime.maxPayloadBytes,
      perMessageDeflate: false,
    });
  }

  async attach(server: Server): Promise<void> {
    if (this.server || this.closed)
      throw new Error('REALTIME_ALREADY_ATTACHED_OR_CLOSED');
    this.server = server;
    server.on('upgrade', this.upgrade);
    const alive = new WeakSet<WebSocket>();
    this.wss.on('connection', (socket) => {
      alive.add(socket);
      this.admit(socket);
      socket.on('pong', () => {
        alive.add(socket);
      });
    });
    this.heartbeat = setInterval(() => {
      for (const socket of this.wss.clients) {
        if (!alive.has(socket)) {
          socket.terminate();
          continue;
        }
        alive.delete(socket);
        socket.ping();
      }
    }, 15000);
    this.heartbeat.unref();
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.heartbeat);
    this.server?.off('upgrade', this.upgrade);
    for (const socket of this.wss.clients) socket.terminate();
    await new Promise<void>((resolve) => {
      this.wss.close(() => resolve());
    });
  }

  private readonly upgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    if (
      this.closed ||
      request.url !== this.config.realtime.path ||
      !this.config.allowedOrigins.includes(request.headers.origin ?? '') ||
      this.wss.clients.size >= limits.connections ||
      this.wss.clients.size - this.registry.count() >= limits.pendingAdmissions
    ) {
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(request, socket, head, (websocket) => {
      this.wss.emit('connection', websocket, request);
    });
  };

  private admit(socket: WebSocket): void {
    const id = randomUUID();
    let principal: Principal | undefined;
    let busy = false;
    let count = 0;
    let windowStart = Date.now();
    const deadline = setTimeout(() => {
      socket.terminate();
    }, limits.authTimeoutMs);
    socket.on('error', () => {
      socket.terminate();
    });
    socket.once('close', () => {
      clearTimeout(deadline);
      this.registry.remove(id);
    });
    const send = (value: unknown): boolean => {
      if (
        socket.readyState !== WebSocket.OPEN ||
        socket.bufferedAmount > limits.queuedBytes
      ) {
        socket.terminate();
        return false;
      }
      const encoded = JSON.stringify(value);
      const length = Buffer.byteLength(encoded);
      if (length + socket.bufferedAmount > limits.queuedBytes) {
        socket.terminate();
        return false;
      }
      if (length > this.config.realtime.maxPayloadBytes) return false;
      socket.send(encoded, (error) => {
        if (error) socket.terminate();
      });
      return true;
    };
    socket.on('message', (data, binary) => {
      const bytes = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
      if (binary || busy) {
        socket.terminate();
        return;
      }
      if (Date.now() - windowStart >= 60000) {
        windowStart = Date.now();
        count = 0;
      }
      if (
        ++count > limits.messagesPerMinute ||
        (!principal && bytes.length > 512)
      ) {
        socket.terminate();
        return;
      }
      busy = true;
      void (async () => {
        try {
          const frame: unknown = JSON.parse(bytes.toString('utf8'));
          if (!principal) {
            const parsed = authFrame.parse(frame);
            const verified = await this.tickets.consume(parsed.ticket, 'ws');
            if (this.closed || socket.readyState !== WebSocket.OPEN) return;
            this.registry.add({
              id,
              principal: verified,
              send: (event) =>
                send({ version: 1, type: 'notification', event }),
              close: () => {
                socket.terminate();
              },
            });
            principal = verified;
            clearTimeout(deadline);
            send({ version: 1, type: 'admitted', recovery: 'REST' });
          } else {
            const parsed = pingFrame.parse(frame);
            await recheckPrincipal(this.authority, principal);
            send({ version: 1, type: 'pong', requestId: parsed.requestId });
          }
        } catch {
          socket.close(1008, 'DENIED');
        } finally {
          busy = false;
        }
      })();
    });
  }
}
