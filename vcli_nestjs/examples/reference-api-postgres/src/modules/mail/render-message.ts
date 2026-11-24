import type { MailMessage } from '../../core/mail/mail-submitter.js';
import { ApplicationError } from '../../core/errors/application-error.js';

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ] ?? character,
  );
}

/** The reference deliberately renders text rather than accepting caller HTML. */
export function renderMessage(message: MailMessage): MailMessage {
  if (
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(message.to) ||
    Array.from(',;:"()[]\\').some((character) =>
      message.to.includes(character),
    ) ||
    message.to.length > 254 ||
    /[\r\n]/.test(message.to) ||
    !message.operationId ||
    message.operationId.length > 128 ||
    !message.subject ||
    /[\r\n]/.test(message.subject) ||
    message.subject.length > 200 ||
    message.text.length > 32768 ||
    !['verification', 'password-reset', 'notification'].includes(
      message.purpose,
    )
  ) {
    throw new ApplicationError('INVALID_MAIL_MESSAGE', 400);
  }
  return {
    ...message,
    html: `<div style="white-space:pre-wrap">${escapeHtml(message.text)}</div>`,
  };
}

export function approvedActionUrl(value: string, publicOrigin: string): string {
  const url = new URL(value);
  const allowed = new URL(publicOrigin);
  if (
    url.origin !== allowed.origin ||
    url.username ||
    url.password ||
    !['https:', 'http:'].includes(url.protocol) ||
    (url.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new ApplicationError('UNAPPROVED_ACTION_URL', 400);
  }
  return url.toString();
}
