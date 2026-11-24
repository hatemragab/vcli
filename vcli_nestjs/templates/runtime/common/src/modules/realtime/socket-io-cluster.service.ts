import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import { z } from 'zod';
import type { RealtimeStore } from '../../core/realtime/realtime-store.js';
import type {
  ApplicationEvent,
  PublicationOutcome,
} from '../../core/realtime/event-publisher.js';
import { RealtimeService } from './realtime.service.js';
import { accountEventSchema, withDeadline } from './protocol-validation.js';
const hintSchema = z.strictObject({
  accountId: z.string().min(1).max(128),
  event: accountEventSchema,
});
const replySchema = z.strictObject({
  nodeId: z.uuid(),
  outcome: z.strictObject({
    status: z.enum([
      'attempted',
      'provider-accepted',
      'audience-ineligible',
      'unavailable',
      'unknown',
    ]),
    transport: z.literal('socketio'),
  }),
});
/** The official adapter carries server hints; each receiving node rechecks its own recipients. */
@Injectable()
export class SocketIoClusterService {
  private readonly nodeId = randomUUID();
  private io: Server | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private beating: Promise<void> | undefined;
  private lastHeartbeat = 0;
  private incoming = 0;
  private closed = false;
  constructor(
    private readonly store: RealtimeStore,
    private readonly configure: (io: Server) => void | Promise<void>,
    private readonly maxPayloadBytes: number,
  ) {}
  get available(): boolean {
    return !this.closed && Date.now() - this.lastHeartbeat < 5000;
  }
  async attach(io: Server, registry: RealtimeService): Promise<void> {
    if (this.io || this.closed)
      throw new Error('REALTIME_ALREADY_ATTACHED_OR_CLOSED');
    this.io = io;
    await this.configure(io);
    io.on('vcli:hint', (input: unknown, ack: unknown) => {
      if (typeof ack !== 'function') return;
      const reply = ack as (value: z.infer<typeof replySchema>) => void;
      const parsed = hintSchema.safeParse(input);
      if (
        !parsed.success ||
        !this.available ||
        this.incoming >= 8 ||
        Buffer.byteLength(JSON.stringify(input)) > this.maxPayloadBytes + 256
      ) {
        reply({
          nodeId: this.nodeId,
          outcome: { status: 'unavailable', transport: 'socketio' },
        });
        return;
      }
      this.incoming++;
      void registry
        .publishLocal(parsed.data.accountId, parsed.data.event)
        .then((outcome) =>
          reply({
            nodeId: this.nodeId,
            outcome: { ...outcome, transport: 'socketio' },
          }),
        )
        .catch(() =>
          reply({
            nodeId: this.nodeId,
            outcome: { status: 'unavailable', transport: 'socketio' },
          }),
        )
        .finally(() => {
          this.incoming--;
        });
    });
    await this.heartbeat();
    this.timer = setInterval(() => {
      void this.heartbeat().catch(() => {
        this.lastHeartbeat = 0;
      });
    }, 1000);
    this.timer.unref();
    registry.setPublisher((accountId, event) =>
      this.publish(registry, accountId, event),
    );
  }
  private async publish(
    registry: RealtimeService,
    accountId: string,
    event: ApplicationEvent,
  ): Promise<PublicationOutcome> {
    const failure = (
      status: 'unavailable' | 'unknown',
    ): PublicationOutcome => ({ status, transport: 'socketio' });
    if (!this.io || !this.available) return failure('unavailable');
    let expected: readonly string[];
    try {
      expected = await this.store.nodes(Date.now());
    } catch {
      return failure('unavailable');
    }
    if (!expected.includes(this.nodeId)) return failure('unavailable');
    // Membership comes from durable native leases, not merely the adapter's transient discovery.
    // A lost adapter event/heartbeat cannot be mistaken for a complete empty remote audience.
    const local = await registry.publishLocal(accountId, event);
    try {
      const raw: unknown = await withDeadline(
        this.io.serverSideEmitWithAck('vcli:hint', { accountId, event }),
        6000,
      );
      const replies = z.array(replySchema).max(16).parse(raw);
      if (
        expected.some(
          (id) =>
            id !== this.nodeId && !replies.some((reply) => reply.nodeId === id),
        )
      )
        return failure('unknown');
      const outcomes = [local, ...replies.map((reply) => reply.outcome)];
      return {
        status: outcomes.some((item) => item.status === 'unknown')
          ? 'unknown'
          : outcomes.some((item) => item.status === 'unavailable')
            ? 'unavailable'
            : outcomes.some((item) => item.status === 'attempted')
              ? 'attempted'
              : 'audience-ineligible',
        transport: 'socketio',
      };
    } catch {
      return failure('unknown');
    }
  }
  private heartbeat(): Promise<void> {
    return (this.beating ??= (async () => {
      if (this.closed) return;
      await this.store.heartbeat(this.nodeId, Date.now() + 5000);
      this.lastHeartbeat = this.closed ? 0 : Date.now();
    })().finally(() => {
      this.beating = undefined;
    }));
  }
  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    this.io?.removeAllListeners('vcli:hint');
    await this.beating?.catch(() => {});
    await this.store.removeNode(this.nodeId);
  }
}
