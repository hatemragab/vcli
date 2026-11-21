import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApplicationError } from '../errors/application-error.js';
import {
  PRINCIPAL_AUTHORITY,
  type PrincipalAuthority,
} from '../auth/principal-authority.js';
import type { Principal } from '../auth/principal.js';

export type AuthenticatedRequest = Request & { principal: Principal };

@Injectable()
export class PrincipalGuard implements CanActivate {
  constructor(
    @Inject(PRINCIPAL_AUTHORITY) private readonly authority: PrincipalAuthority,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ') || authorization.length > 16384)
      throw new ApplicationError('UNAUTHENTICATED', 401);
    const token = authorization.slice(7);
    const session = request.headers['x-session-token'];
    if (Array.isArray(session))
      throw new ApplicationError('UNAUTHENTICATED', 401);
    request.principal = await this.authority.verify(
      session
        ? { kind: 'firebase', idToken: token, sessionSecret: session }
        : { kind: 'local', accessToken: token },
    );
    return true;
  }
}
