import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import type { AppConfig } from '../../core/config/app-config.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';

import { HttpSecurityModule } from '../../core/http/http-security.module.js';
import { DatabaseModule } from '../../core/database/database.module.js';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
import { AccountService } from '../accounts/account.service.js';
import { AccountModule } from '../accounts/account.module.js';
import { InstallationService } from '../installations/installation.service.js';
import { InstallationModule } from '../installations/installation.module.js';
import { SessionService } from '../sessions/session.service.js';
import { SessionIssuer } from '../sessions/session-issuer.service.js';
import { SessionManagement } from '../sessions/session-management.service.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { IdentityService } from './identity.service.js';
import { IdentityAuthority } from './identity-authority.service.js';
import { IdentityRateLimits } from './identity-rate-limits.service.js';
import { FreshIdentityProof } from './fresh-identity-proof.service.js';
import { AccountLifecycle } from './account-lifecycle.service.js';
import { SelfAccountController } from './self-account.controller.js';
import { InstallationLifecycle } from './installation-lifecycle.service.js';
import { InstallationLifecycleController } from './installation-lifecycle.controller.js';
import { IDENTITY_CONFIG, ACCESS_TOKENS } from './identity.tokens.js';

import { ArgonPasswords } from './argon-passwords.service.js';
import { JoseAccessTokens } from './jose-access-tokens.service.js';
import { RefreshSessions } from '../sessions/refresh-sessions.service.js';
import { UsernameCredentials } from './username-credentials.service.js';

import { ChangePassword } from './change-password.service.js';
import { UsernameIdentityController } from './username-identity.controller.js';

import { ChangePasswordController } from './change-password.controller.js';
export type IdentityRuntime = Readonly<{
  authority: PrincipalAuthority;
  module: DynamicModule;
  close(): Promise<void>;
}>;
@Module({})
export class IdentityModule {}
export async function createIdentityRuntime(
  config: AppConfig,
  db: MongoDatabase,
): Promise<IdentityRuntime> {
  const accounts = new AccountService(db),
    identities = new IdentityService(db),
    installations = new InstallationService(db),
    sessions = new SessionService(db);
  const issuer = new SessionIssuer(accounts, installations, sessions);
  const management = new SessionManagement(
    db,
    accounts,
    identities,
    installations,
    sessions,
    config.auth.recentAuthSeconds * 1000,
  );
  const tokens = new JoseAccessTokens(config.auth.jwtPolicy);
  const passwords = await ArgonPasswords.create();
  const close = async (): Promise<void> => {};
  const authority = new IdentityAuthority(
    db,
    accounts,
    installations,
    sessions,
    'local',
    [],
    tokens,
    null,
  );
  const fresh = new FreshIdentityProof(
    db,
    accounts,
    identities,
    installations,
    sessions,
    passwords,
    null,
    [],
    config.auth.recentAuthSeconds * 1000,
  );

  const lifecycle = new AccountLifecycle(
    db,
    accounts,
    identities,
    sessions,
    fresh,
    null,
  );
  const installationLifecycle = new InstallationLifecycle(
    db,
    installations,
    sessions,
    fresh,
  );

  const providers: Provider[] = [
    { provide: IdentityService, useValue: identities },
    { provide: IdentityAuthority, useValue: authority },
    { provide: IDENTITY_CONFIG, useValue: config },
    {
      provide: IdentityRateLimits,
      useValue: new IdentityRateLimits(db, identities),
    },
    { provide: FreshIdentityProof, useValue: fresh },
    { provide: AccountLifecycle, useValue: lifecycle },
    { provide: InstallationLifecycle, useValue: installationLifecycle },
    { provide: ACCESS_TOKENS, useValue: tokens },
    {
      provide: UsernameCredentials,
      useValue: new UsernameCredentials(
        db,
        accounts,
        identities,
        passwords,
        issuer,
      ),
    },

    {
      provide: RefreshSessions,
      useValue: new RefreshSessions(db, accounts, installations, sessions),
    },
    {
      provide: ChangePassword,
      useValue: new ChangePassword(
        db,
        accounts,
        identities,
        installations,
        sessions,
        passwords,
        config.auth.recentAuthSeconds * 1000,
      ),
    },
  ];
  return {
    authority,
    module: {
      module: IdentityModule,
      imports: [
        DatabaseModule.register(db),
        HttpSecurityModule.register(authority),
        AccountModule.register(accounts, authority),
        InstallationModule.register(installations),
        SessionsModule.register(sessions, issuer, management, authority),
      ],
      controllers: [
        SelfAccountController,
        InstallationLifecycleController,
        UsernameIdentityController,
        ChangePasswordController,
      ],
      providers,
      exports: [
        HttpSecurityModule,
        IdentityService,
        IdentityAuthority,
        FreshIdentityProof,
        AccountLifecycle,
        InstallationLifecycle,
        AccountModule,
        InstallationModule,
        SessionsModule,
      ],
    },
    close,
  };
}
