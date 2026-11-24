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
  private readonly abort = new AbortController();
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
  publish(
    channel: string,
    event: ApplicationEvent,
  ): Promise<'accepted' | 'unavailable' | 'unknown'> {
    return this.call('publish', { channel, data: event });
  }
  disconnect(
    user: string,
    client: string,
  ): Promise<'accepted' | 'unavailable' | 'unknown'> {
    return this.call('disconnect', {
      user,
      client,
      disconnect: { code: 4501, reason: 'authority expired' },
    });
  }
  close(): void {
    this.closed = true;
    this.abort.abort();
  }
  private async call(
    method: 'publish' | 'disconnect',
    body: unknown,
  ): Promise<'accepted' | 'unavailable' | 'unknown'> {
    if (this.closed || this.active >= 16) return 'unavailable';
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
          signal: AbortSignal.any([
            this.abort.signal,
            AbortSignal.timeout(2000),
          ]),
        },
      );
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        return 'unknown';
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
            return 'unknown';
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      const parsed = replySchema.safeParse(
        JSON.parse(Buffer.concat(chunks).toString('utf8')),
      );
      if (!parsed.success) return 'unknown';
      if (parsed.data.error)
        return [100, 111].includes(parsed.data.error.code)
          ? 'unknown'
          : 'unavailable';
      return parsed.data.result !== undefined ? 'accepted' : 'unknown';
    } catch {
      return 'unknown';
    } finally {
      this.active--;
    }
  }
}
