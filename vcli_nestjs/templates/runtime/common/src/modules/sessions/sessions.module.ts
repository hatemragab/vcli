import { Module } from '@nestjs/common';
import { bootstrapBinding } from '../../core/bootstrap/bootstrap-bindings.js';
import { HttpSecurityModule } from '../../core/http/http-security.module.js';
import { SessionService } from './session.service.js';
import { SessionIssuer } from './session-issuer.service.js';
import { SessionManagement } from './session-management.service.js';
import { SessionsController } from './sessions.controller.js';

const sessionServiceBinding = bootstrapBinding(SessionService);
const sessionIssuerBinding = bootstrapBinding(SessionIssuer);
const sessionManagementBinding = bootstrapBinding(SessionManagement);
export const bindSessionService = sessionServiceBinding.bind;
export const bindSessionIssuer = sessionIssuerBinding.bind;
export const bindSessionManagement = sessionManagementBinding.bind;

@Module({
  imports: [HttpSecurityModule],
  controllers: [SessionsController],
  providers: [
    sessionServiceBinding.provider,
    sessionIssuerBinding.provider,
    sessionManagementBinding.provider,
  ],
  exports: [SessionService, SessionIssuer, SessionManagement],
})
export class SessionsModule {}
