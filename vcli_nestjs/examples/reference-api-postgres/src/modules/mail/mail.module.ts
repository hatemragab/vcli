import { Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from '../../core/config/app-config.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { MailSubmitter } from '../../core/mail/mail-submitter.js';
import {
  CaptureMailService,
  pruneCapture,
  type MailCaptureBuffer,
} from './capture-mail.service.js';
import { MailService } from './mail.service.js';
import { SmtpMailService } from './smtp-mail.service.js';

export function createMailSender(config: AppConfig): MailService {
  if (config.mail.driver === 'capture') {
    if (config.environment === 'production')
      throw new ApplicationError('UNSAFE_PRODUCTION_PROFILE', 500);
    return new CaptureMailService(config.mail.maxCaptured, Date.now);
  }
  if (
    !config.mail.host ||
    Boolean(config.mail.user) !== Boolean(config.mail.password)
  )
    throw new ApplicationError('INVALID_SMTP_CONFIG', 500);
  return new SmtpMailService(config.mail, config.environment === 'production');
}

/** Capture access remains in the test-owned closure; MailService only submits. */
export function createTestMailCapture(
  maximum = 100,
  now: () => number = Date.now,
) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 1000)
    throw new ApplicationError('INVALID_CAPTURE_LIMIT', 400);
  const capture: MailCaptureBuffer = { entries: [], bytes: 0 };
  const sender: MailService = new CaptureMailService(maximum, now, capture);
  return {
    sender,
    inspect: () => {
      pruneCapture(capture, now());
      return structuredClone(capture.entries);
    },
    clear: () => {
      capture.entries.length = 0;
      capture.bytes = 0;
    },
  };
}

@Module({})
export class MailModule {
  static register(sender: MailSubmitter): DynamicModule {
    return {
      module: MailModule,
      providers: [{ provide: MailService, useValue: sender }],
      exports: [MailService],
    };
  }
}
