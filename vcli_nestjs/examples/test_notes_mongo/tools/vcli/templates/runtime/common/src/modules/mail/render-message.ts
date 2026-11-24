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
export function validMailAddress(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 254 &&
    !Array.from(value).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) &&
    /^[^\s@<>,;:"()[\]\\]+@[^\s@<>,;:"()[\]\\]+\.[^\s@<>,;:"()[\]\\]+$/.test(
      value,
    )
  );
}
/** Never trust caller HTML; text is the canonical input, with no file/URL lookup. */
export function renderMessage(message: MailMessage): MailMessage {
  if (
    !message ||
    !validMailAddress(message.to) ||
    typeof message.operationId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(message.operationId) ||
    typeof message.subject !== 'string' ||
    !message.subject ||
    // eslint-disable-next-line no-control-regex -- Reject email header control characters.
    /[\u0000-\u001f\u007f]/.test(message.subject) ||
    message.subject.length > 200 ||
    typeof message.text !== 'string' ||
    !message.text ||
    message.text.length > 32768 ||
    /\0/.test(message.text) ||
    !['verification', 'password-reset', 'notification'].includes(
      message.purpose,
    )
  )
    throw new ApplicationError('INVALID_MAIL_MESSAGE', 400);
  return {
    operationId: message.operationId,
    purpose: message.purpose,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: `<div style="white-space:pre-wrap">${escapeHtml(message.text)}</div>`,
  };
}
export function approvedActionUrl(value: string, publicOrigin: string): string {
  try {
    const url = new URL(value),
      allowed = new URL(publicOrigin);
    if (
      url.origin !== allowed.origin ||
      url.username ||
      url.password ||
      !['https:', 'http:'].includes(url.protocol) ||
      (url.protocol === 'http:' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
      throw new Error();
    return url.toString();
  } catch {
    throw new ApplicationError('UNAPPROVED_ACTION_URL', 400);
  }
}
export type ActionTemplateInput = Readonly<{
  operationId: string;
  to: string;
  template: 'verification' | 'password-reset';
  version: 1;
  locale: 'en';
  variables: Readonly<{ actionUrl: string; applicationName: string }>;
}>;
/** Versioned code-defined assets: missing template/version/locale/variables fail closed. */
export function renderActionTemplate(
  input: ActionTemplateInput,
  publicOrigin: string,
): MailMessage {
  if (
    !input ||
    input.version !== 1 ||
    input.locale !== 'en' ||
    !['verification', 'password-reset'].includes(input.template) ||
    !input.variables ||
    Object.keys(input.variables).sort().join(',') !==
      'actionUrl,applicationName' ||
    typeof input.variables.applicationName !== 'string' ||
    !input.variables.applicationName.trim() ||
    input.variables.applicationName.length > 80 ||
    /[\r\n\0]/.test(input.variables.applicationName) ||
    typeof input.variables.actionUrl !== 'string' ||
    input.variables.actionUrl.length > 8192
  )
    throw new ApplicationError('INVALID_MAIL_TEMPLATE', 400);
  const actionUrl = approvedActionUrl(input.variables.actionUrl, publicOrigin);
  const action =
    input.template === 'verification'
      ? 'Verify your email'
      : 'Reset your password';
  return renderMessage({
    operationId: input.operationId,
    to: input.to,
    purpose: input.template,
    subject: action,
    text: `${input.variables.applicationName}\n\n${action}:\n${actionUrl}\n\nIf you did not request this, ignore this message.`,
  });
}
