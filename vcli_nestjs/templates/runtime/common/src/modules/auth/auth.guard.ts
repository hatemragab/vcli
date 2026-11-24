import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApplicationError } from '../../core/errors/application-error.js';
import { AuthService, type AuthAccountProfile } from './auth.service.js';

export type AuthenticatedRequest = Request & {
  authAccount: AuthAccountProfile;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization || !/^Bearer /iu.test(authorization))
      throw new ApplicationError('UNAUTHENTICATED', 401);
    request.authAccount = await this.auth.authenticate(authorization.slice(7));
    return true;
  }
}
