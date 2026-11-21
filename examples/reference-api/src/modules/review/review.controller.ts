import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AppConfig } from '../../core/config/app-config.js';
import { referencePage } from './review-page.js';
import { REFERENCE_CONFIG } from './review.tokens.js';
@ApiExcludeController()
@Controller()
export class ReviewController {
  constructor(
    @Inject(REFERENCE_CONFIG)
    private readonly config: AppConfig,
  ) {}
  @Get(['', 'reference'])
  page(
    @Res()
    response: Response,
  ): void {
    if (this.config.environment === 'production') throw new NotFoundException();
    response.type('html').setHeader('Cache-Control', 'no-store');
    response.send(referencePage);
  }
  @Get('reference/config')
  describe() {
    if (this.config.environment === 'production') throw new NotFoundException();
    return {
      referenceOnly: true,
      environment: this.config.environment,
      database: this.config.database.driver,
      authentication: this.config.auth.driver,
      firebaseMethods: this.config.auth.firebaseMethods,
      storage: this.config.storage.driver,
      realtime: this.config.realtime.driver,
      mail: this.config.mail.driver,
      fcm: this.config.push.fcmEnabled,
      apns: this.config.push.apnsEnabled,
      externalAcceptance: 'pending',
      generatorImplementation: 'not-started',
    };
  }
}
