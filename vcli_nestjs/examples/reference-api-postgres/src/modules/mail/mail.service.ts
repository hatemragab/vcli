import type {
  MailMessage,
  MailOutcome,
  MailSubmitter,
} from '../../core/mail/mail-submitter.js';

/** Inject this service; the module binds capture, SMTP or the explicit test sender. */
export abstract class MailService implements MailSubmitter {
  abstract submit(message: MailMessage): Promise<MailOutcome>;
}
