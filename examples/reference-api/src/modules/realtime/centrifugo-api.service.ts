import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { ApplicationEvent } from '../../core/realtime/event-publisher.js';
const replySchema = z.object({
  result: z.object({}).optional(),
  error: z.object({ code: z.number().int() }).optional(),
});
/** Documented private HTTP API; neither its credentials nor replies enter logs. */
@Injectable()
export class CentrifugoApiService {
  private active = 0;
  private closed = false;
  constructor(
    private readonly apiUrl: string,
    private readonly key: string,
    private readonly request: typeof fetch = fetch,
  ) {
    const url = new URL(apiUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('INVALID_CENTRIFUGO_API_URL');
  }
  publish(channel: string, event: ApplicationEvent): Promise<boolean> {
    return this.call('publish', { channel, data: event });
  }
  disconnect(user: string, client: string): Promise<boolean> {
    return this.call('disconnect', {
      user,
      client,
      disconnect: { code: 4501, reason: 'authority expired' },
    });
  }
  close(): void {
    this.closed = true;
  }
  private async call(
    method: 'publish' | 'disconnect',
    body: unknown,
  ): Promise<boolean> {
    if (this.closed || this.active >= 16) return false;
    this.active++;
    try {
      const response = await this.request(
        `${this.apiUrl.replace(/\/$/, '')}/${method}`,
        {
          method: 'POST',
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            'X-API-Key': this.key,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(2000),
        },
      );
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        return false;
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 4096) {
            await reader.cancel();
            return false;
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      const parsed = replySchema.safeParse(
        JSON.parse(Buffer.concat(chunks).toString('utf8')),
      );
      return (
        parsed.success &&
        parsed.data.result !== undefined &&
        parsed.data.error === undefined
      );
    } catch {
      return false;
    } finally {
      this.active--;
    }
  }
}
