import type { Principal } from '../../core/auth/principal.js';
import { ApplicationError } from '../../core/errors/application-error.js';

export interface NoteImageSource {
  download(
    principal: Principal,
    id: string,
    signal: AbortSignal,
  ): Promise<{ source: AsyncIterable<Uint8Array> }>;
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff]);

function isImageHeader(header: Buffer): boolean {
  return (
    header.subarray(0, png.length).equals(png) ||
    header.subarray(0, jpeg.length).equals(jpeg) ||
    ['GIF87a', 'GIF89a'].includes(header.toString('latin1', 0, 6)) ||
    (header.toString('latin1', 0, 4) === 'RIFF' &&
      header.toString('latin1', 8, 12) === 'WEBP')
  );
}

/** The media service checks ownership and readiness before opening the stream. */
export async function assertNoteImage(
  images: NoteImageSource,
  principal: Principal,
  imageId: string,
): Promise<void> {
  const controller = new AbortController();
  const header = Buffer.alloc(12);
  let bytes = 0;
  try {
    const { source } = await images.download(
      principal,
      imageId,
      controller.signal,
    );
    for await (const chunk of source) {
      const length = Math.min(chunk.byteLength, header.length - bytes);
      header.set(chunk.subarray(0, length), bytes);
      bytes += length;
      if (bytes === header.length) break;
    }
  } finally {
    controller.abort();
  }
  if (!isImageHeader(header.subarray(0, bytes))) {
    throw new ApplicationError('INVALID_NOTE_IMAGE', 400);
  }
}
