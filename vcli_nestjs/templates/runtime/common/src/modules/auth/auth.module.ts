import { Module } from '@nestjs/common';
import { ArgonPasswords } from '@vcli/auth-runtime/password';
import { authRuntimeError } from '../../core/auth/auth-runtime-error.js';
import {
  bootstrapBinding,
  type BootstrapBinding,
} from '../../core/bootstrap/bootstrap-bindings.js';
import type { AppConfig } from '../../core/config/app-config.js';
import type { openDatabase } from '../../core/database/database.js';
import { AuthTokenService } from './auth-token.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { RedisIdentityRateStore } from './redis-identity-rate-store.js';

const authServiceBinding = bootstrapBinding(AuthService);

@Module({
  controllers: [AuthController],
  providers: [authServiceBinding.provider, AuthGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}

export async function createAuthRuntime(
  config: AppConfig,
  db: Awaited<ReturnType<typeof openDatabase>>,
): Promise<
  Readonly<{ bindings: readonly BootstrapBinding[]; close(): Promise<void> }>
> {
  const {
    identifier,
    jwtPolicy,
    accessTtlSeconds,
    rateLimitRedisUrl,
    rateLimitNamespace,
  } = config.auth;
  const tokens = new AuthTokenService(jwtPolicy, accessTtlSeconds);
  const passwords = await ArgonPasswords.create({
    maxPasswordBytes: 256,
  }).catch(authRuntimeError);
  const rates = new RedisIdentityRateStore(
    rateLimitRedisUrl,
    rateLimitNamespace,
  );
  const auth = new AuthService(
    identifier,
    new AuthRepository(db),
    passwords,
    tokens,
    rates,
  );
  return {
    bindings: [authServiceBinding.bind(auth)],
    async close() {
      rates.close();
    },
  };
}
