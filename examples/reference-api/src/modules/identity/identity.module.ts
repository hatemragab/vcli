import { Module } from '@nestjs/common';
import { AccountService } from '../accounts/account.service.js';
import { AccountModule } from '../accounts/account.module.js';
import { InstallationService } from '../installations/installation.service.js';
import { InstallationModule } from '../installations/installation.module.js';
import { SessionService } from '../sessions/session.service.js';
import { SessionIssuer } from '../sessions/session-issuer.service.js';
import { RefreshSessions } from '../sessions/refresh-sessions.service.js';
import { SessionManagement } from '../sessions/session-management.service.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import type { DynamicModule, Provider, Type } from '@nestjs/common';
import type { AppConfig } from '../../core/config/app-config.js';
import type { MailSubmitter } from '../../core/mail/mail-submitter.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import { HttpSecurityModule } from '../../core/http/http-security.module.js';
import { openDatabase } from '../../core/database/database.js';
import { IdentityService } from './identity.service.js';
import { ArgonPasswords } from './argon-passwords.service.js';
import { JoseAccessTokens } from './jose-access-tokens.service.js';
import { FirebaseTokenVerifier } from './firebase-token-verifier.service.js';
import { IdentityAuthority } from './identity-authority.service.js';
import { newSecret } from './secret-facts.js';
import { IdentityRateLimits } from './identity-rate-limits.service.js';
import { LocalCredentials } from './local-credentials.service.js';
import { ActionTokens } from './action-tokens.service.js';
import { ChangePassword } from './change-password.service.js';
import { FirebaseEnrollment } from './firebase-enrollment.service.js';
import {
  LocalIdentityController,
  IDENTITY_CONFIG,
  ACCESS_TOKENS,
} from './local-identity.controller.js';
import { ActionTokensController } from './action-tokens.controller.js';
import { ChangePasswordController } from './change-password.controller.js';
import {
  FirebaseIdentityController,
  FIREBASE_VERIFIER,
} from './firebase-identity.controller.js';
import { ApplicationError } from '../../core/errors/application-error.js';
export type IdentityRuntime = Readonly<{
  authority: PrincipalAuthority;
  module: DynamicModule;
  close(): Promise<void>;
}>;
@Module({})
export class IdentityModule {}
export async function createIdentityRuntime(
  config: AppConfig,
  mail: MailSubmitter,
): Promise<IdentityRuntime> {
  const db = await openDatabase(config);
  let firebase: FirebaseTokenVerifier | null = null;
  try {
    const accounts = new AccountService(db);
    const identities = new IdentityService(db);
    const installations = new InstallationService(db);
    const sessions = new SessionService(db);
    const issuer = new SessionIssuer(accounts, installations, sessions);
    const refresh = new RefreshSessions(db, accounts, installations, sessions);
    const management = new SessionManagement(
      db,
      accounts,
      identities,
      installations,
      sessions,
      config.auth.recentAuthSeconds * 1000,
    );
    if (config.auth.driver === 'firebase') {
      if (!config.auth.firebaseProjectId)
        throw new ApplicationError('FIREBASE_PROJECT_REQUIRED', 500);
      firebase = new FirebaseTokenVerifier(config.auth.firebaseProjectId);
    }
    if (
      config.environment === 'production' &&
      config.auth.driver === 'local' &&
      !config.auth.jwtSecret
    )
      throw new ApplicationError('JWT_SECRET_REQUIRED', 500);
    const tokens =
      config.auth.driver === 'local'
        ? new JoseAccessTokens(
            config.auth.jwtSecret ?? newSecret(),
            config.auth.issuer,
            config.auth.audience,
          )
        : null;
    const authority = new IdentityAuthority(
      db,
      accounts,
      installations,
      sessions,
      config.auth.driver,
      config.auth.firebaseMethods,
      tokens,
      firebase,
    );
    const security = HttpSecurityModule.register(authority);
    const providers: Provider[] = [
      { provide: IdentityService, useValue: identities },
      { provide: IDENTITY_CONFIG, useValue: config },
      {
        provide: IdentityRateLimits,
        useValue: new IdentityRateLimits(db, identities),
      },
    ];
    const controllers: Type<unknown>[] = [];
    if (config.auth.driver === 'local') {
      const passwords = await ArgonPasswords.create();
      providers.push(
        { provide: ACCESS_TOKENS, useValue: tokens },
        {
          provide: LocalCredentials,
          useValue: new LocalCredentials(
            db,
            accounts,
            identities,
            passwords,
            issuer,
          ),
        },
        {
          provide: ActionTokens,
          useValue: new ActionTokens(
            db,
            accounts,
            identities,
            sessions,
            passwords,
            mail,
          ),
        },
        {
          provide: RefreshSessions,
          useValue: refresh,
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
      );
      controllers.push(
        LocalIdentityController,
        ActionTokensController,
        ChangePasswordController,
      );
    } else {
      providers.push(
        { provide: FIREBASE_VERIFIER, useValue: firebase },
        {
          provide: FirebaseEnrollment,
          useValue: new FirebaseEnrollment(
            db,
            accounts,
            identities,
            issuer,
            config.auth.firebaseProjectId!,
            config.auth.firebaseMethods,
            config.auth.recentAuthSeconds * 1000,
          ),
        },
      );
      controllers.push(FirebaseIdentityController);
    }
    let closed = false;
    return {
      authority,
      module: {
        module: IdentityModule,
        imports: [
          security,
          AccountModule.register(accounts, authority),
          InstallationModule.register(installations),
          SessionsModule.register(sessions, issuer, management, authority),
        ],
        controllers,
        providers,
        exports: [
          IdentityService,
          AccountModule,
          InstallationModule,
          SessionsModule,
        ],
      },
      async close() {
        if (closed) return;
        closed = true;
        try {
          if (firebase) await firebase.close();
        } finally {
          await db.close();
        }
      },
    };
  } catch (error) {
    try {
      if (firebase) await firebase.close();
    } finally {
      await db.close();
    }
    throw error;
  }
}
