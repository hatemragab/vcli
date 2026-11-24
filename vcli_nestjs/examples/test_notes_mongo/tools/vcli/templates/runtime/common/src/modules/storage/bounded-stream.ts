import { ApplicationError } from '../../core/errors/application-error.js';
/** Abort must interrupt a stalled iterator, not just the next chunk. */
export async function* boundedStream(
  source: AsyncIterable<Uint8Array>,
  maximum: number,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  let rejectAbort: (error: unknown) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () =>
    rejectAbort(new ApplicationError('UPLOAD_CANCELLED', 408));
  signal.addEventListener('abort', onAbort, { once: true });
  let bytes = 0;
  try {
    signal.throwIfAborted();
    for (;;) {
      const next = await Promise.race([iterator.next(), aborted]);
      if (next.done) break;
      if (!(next.value instanceof Uint8Array))
        throw new ApplicationError('INVALID_UPLOAD_STREAM', 400);
      bytes += next.value.byteLength;
      if (bytes > maximum) throw new ApplicationError('UPLOAD_TOO_LARGE', 413);
      yield next.value;
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    // A peer-controlled pending next() must not delay releasing our transfer slot.
    if (iterator.return) void iterator.return().catch(() => undefined);
  }
}
