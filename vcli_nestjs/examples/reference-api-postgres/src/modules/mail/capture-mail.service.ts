import type {
  MailMessage,
  MailOutcome,
} from '../../core/mail/mail-submitter.js';
import { MailService } from './mail.service.js';
import { renderMessage } from './render-message.js';

export type CapturedMessage = Readonly<{
  capturedAt: number;
  message: MailMessage;
}>;

export class CaptureMailService extends MailService {
  constructor(
    private readonly maximum: number,
    private readonly now: () => number,
    private readonly capture: MailCaptureBuffer = { entries: [], bytes: 0 },
    private readonly retentionMs = 900000,
  ) {
    super();
  }

  async submit(message: MailMessage): Promise<MailOutcome> {
    const rendered = renderMessage(message);
    pruneCapture(this.capture, this.now(), this.retentionMs);
    const size = Buffer.byteLength(JSON.stringify(rendered));
    while (
      this.capture.entries.length >= this.maximum ||
      this.capture.bytes + size > 1048576
    )
      removeFirst(this.capture);
    this.capture.entries.push({
      capturedAt: this.now(),
      message: structuredClone(rendered),
    });
    this.capture.bytes += size;
    return { status: 'captured', reference: rendered.operationId };
  }
}

/** A test-owned handle, never exported by MailModule or an HTTP controller. */
export type MailCaptureBuffer = { entries: CapturedMessage[]; bytes: number };

function removeFirst(capture: MailCaptureBuffer): void {
  const removed = capture.entries.shift();
  if (removed)
    capture.bytes -= Buffer.byteLength(JSON.stringify(removed.message));
}

export function pruneCapture(
  capture: MailCaptureBuffer,
  now: number,
  retentionMs = 900000,
): void {
  while (
    capture.entries[0] &&
    capture.entries[0].capturedAt + retentionMs <= now
  )
    removeFirst(capture);
}
