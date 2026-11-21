import type {
  MailMessage,
  MailOutcome,
} from '../../core/mail/mail-submitter.js';
import { ApplicationError } from '../../core/errors/application-error.js';
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
    environment: string = process.env.NODE_ENV ?? 'development',
  ) {
    super();
    if (environment === 'production' || process.env.NODE_ENV === 'production')
      throw new ApplicationError('UNSAFE_PRODUCTION_CAPTURE', 500);
    if (
      !Number.isSafeInteger(maximum) ||
      maximum < 1 ||
      maximum > 1000 ||
      !Number.isSafeInteger(retentionMs) ||
      retentionMs < 1 ||
      retentionMs > 900000 ||
      !Number.isFinite(now()) ||
      !Array.isArray(capture.entries) ||
      capture.entries.length !== 0 ||
      capture.bytes !== 0
    )
      throw new ApplicationError('INVALID_CAPTURE_LIMIT', 400);
  }
  async submit(message: MailMessage): Promise<MailOutcome> {
    const rendered = renderMessage(message);
    pruneCapture(this.capture, this.now(), this.retentionMs);
    const size = Buffer.byteLength(JSON.stringify(rendered));
    if (size > 1048576) return { status: 'rejected', code: 'MAIL_TOO_LARGE' };
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
export type MailCaptureBuffer = {
  entries: CapturedMessage[];
  bytes: number;
};
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
