import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { parseInput } from '../../core/http/parse-input.js';
import type { AppConfig } from '../../core/config/app-config.js';
import type { FirebaseVerifier } from './credential-ports.js';
import { FirebaseEnrollment } from './firebase-enrollment.service.js';
import { IdentityRateLimits } from './identity-rate-limits.service.js';
import { firebaseInput } from './identity-inputs.js';
import { rateRequest } from './rate-request.js';
import { IDENTITY_CONFIG } from './local-identity.controller.js';
import { newId, newSecret, sessionFacts } from './secret-facts.js';
import { identityRequestBodies } from './identity-request-bodies.js';
export const FIREBASE_VERIFIER = Symbol('FirebaseVerifier');
@Controller('identity/firebase')
@ApiTags('Firebase identity')
export class FirebaseIdentityController {
  constructor(
    @Inject(FirebaseEnrollment)
    private readonly enrollment: FirebaseEnrollment,
    @Inject(FIREBASE_VERIFIER)
    private readonly verifier: FirebaseVerifier,
    @Inject(IdentityRateLimits)
    private readonly limits: IdentityRateLimits,
    @Inject(IDENTITY_CONFIG)
    private readonly config: AppConfig,
  ) {}
  @Post('bootstrap')
  @ApiOperation({
    summary: 'Enroll an app session using a verified Firebase client ID token',
  })
  @ApiBody(identityRequestBodies.firebaseBootstrap)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async bootstrap(
    @Body()
    body: unknown,
    @Req()
    request: Request,
  ) {
    const input = parseInput(firebaseInput, body),
      now = Date.now();
    await rateRequest(this.limits, request, 'firebase-bootstrap', now);
    const proof = await this.verifier.verify(input.idToken),
      sessionToken = newSecret();
    const session = await this.enrollment.enroll(
      proof,
      newId(),
      sessionFacts(
        now,
        this.config.auth.sessionTtlSeconds,
        input.platform,
        sessionToken,
      ),
    );
    return {
      sessionToken,
      sessionId: session.id,
      installationId: session.installationId,
      expiresAt: session.expiresAt,
    };
  }
}
