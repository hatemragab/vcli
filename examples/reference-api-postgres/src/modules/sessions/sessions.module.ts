import { Module, type DynamicModule } from '@nestjs/common';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import { HttpSecurityModule } from '../../core/http/http-security.module.js';
import { SessionService } from './session.service.js';
import { SessionIssuer } from './session-issuer.service.js';
import { SessionManagement } from './session-management.service.js';
import { SessionsController } from './sessions.controller.js';

@Module({})
export class SessionsModule {
  static register(
    sessions: SessionService,
    issuer: SessionIssuer,
    management: SessionManagement,
    authority: PrincipalAuthority,
  ): DynamicModule {
    return {
      module: SessionsModule,
      imports: [HttpSecurityModule.register(authority)],
      controllers: [SessionsController],
      providers: [
        { provide: SessionService, useValue: sessions },
        { provide: SessionIssuer, useValue: issuer },
        { provide: SessionManagement, useValue: management },
      ],
      exports: [SessionService, SessionIssuer, SessionManagement],
    };
  }
}
