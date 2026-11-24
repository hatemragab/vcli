import { file, runtime } from './bundle.js';
import { selection, usernameAuth } from './selection.js';
import { removeBetween, replaceExact, requireIndex, } from './template-markers.js';
/** Selected identity source plus explicit owner composition; no root/schema composition. */
export async function identityFiles(config) {
    const db = selection(config, 'database') === 'database.mongodb'
        ? 'mongodb'
        : 'postgres';
    const databaseClass = db === 'mongodb' ? 'MongoDatabase' : 'PostgresDatabase';
    const local = selection(config, 'auth') === 'auth.local';
    const username = usernameAuth(config);
    const application = !local &&
        config.capabilities.auth?.options.actionDelivery === 'application';
    const reliable = config.capabilities.mail?.options.reliableActions === true;
    const paths = [
        'core/auth/auth-runtime-error.ts',
        'core/auth/enrollment-cutoff.ts',
        'core/auth/password-input.ts',
        'core/auth/principal.ts',
        'core/auth/principal-authority.ts',
        'core/auth/session-record.ts',
        'core/http/current-principal.decorator.ts',
        'core/http/principal.guard.ts',
        'core/http/http-security.module.ts',
        'core/http/parse-input.ts',
        'modules/accounts/account.entity.ts',
        'modules/accounts/account.service.ts',
        'modules/accounts/current-account.controller.ts',
        'modules/accounts/account.module.ts',
        'modules/installations/installation.entity.ts',
        'modules/installations/installation.service.ts',
        'modules/installations/installation.module.ts',
        'modules/sessions/session.entity.ts',
        'modules/sessions/session.service.ts',
        'modules/sessions/session-facts.ts',
        'modules/sessions/session-issuer.service.ts',
        'modules/sessions/session-management.service.ts',
        'modules/sessions/session-policy.ts',
        'modules/sessions/sessions.controller.ts',
        'modules/sessions/sessions.module.ts',
        'modules/identity/identity.entity.ts',
        'modules/identity/identity.service.ts',
        'modules/identity/identity-authority.service.ts',
        'modules/identity/identity-rate-limits.service.ts',
        'modules/identity/secret-facts.ts',
        'modules/identity/credential-ports.ts',
        'modules/identity/rate-request.ts',
        'modules/identity/identity-inputs.ts',
        'modules/identity/identity-request-bodies.ts',
        'modules/identity/identity-self-policy.ts',
        'modules/identity/fresh-identity-proof.service.ts',
        'modules/identity/account-lifecycle.service.ts',
        'modules/identity/self-account.controller.ts',
        'modules/identity/installation-lifecycle.service.ts',
        'modules/identity/installation-lifecycle.controller.ts',
        // Nullable same-owner type dependencies exist in both modes, without provider SDK imports.
        'modules/identity/provider-cleanup.entity.ts',
        'modules/identity/provider-cleanup.service.ts',
        ...(db === 'mongodb'
            ? [
                'modules/identity/identity-lifecycle-migration.ts',
                'modules/installations/installation-lifecycle-migration.ts',
                'modules/sessions/session-lifecycle-migration.ts',
            ]
            : []),
        ...(local
            ? [
                'modules/sessions/refresh-sessions.service.ts',
                'modules/identity/argon-passwords.service.ts',
                'modules/identity/jose-access-tokens.service.ts',
                `modules/identity/${username ? 'username' : 'local'}-credentials.service.ts`,
                'modules/identity/change-password.service.ts',
                `modules/identity/${username ? 'username' : 'local'}-identity.controller.ts`,
                ...(username
                    ? []
                    : [
                        'modules/identity/action-tokens.service.ts',
                        'modules/identity/action-tokens.controller.ts',
                    ]),
                'modules/identity/change-password.controller.ts',
            ]
            : [
                'modules/identity/firebase-token-verifier.service.ts',
                'modules/identity/firebase-enrollment.service.ts',
                'modules/identity/firebase-identity.controller.ts',
                'modules/identity/provider-links.service.ts',
                'modules/identity/provider-links.controller.ts',
                'modules/identity/provider-cleanup-dispatcher.service.ts',
                ...(application
                    ? [
                        'modules/identity/firebase-actions.service.ts',
                        'modules/identity/firebase-actions.controller.ts',
                    ]
                    : []),
            ]),
    ];
    const files = await Promise.all(paths.map((path) => runtime('src/' + path, db)));
    const inputFile = files.find((entry) => entry.path.endsWith('/identity-inputs.ts'));
    const bodies = files.find((entry) => entry.path.endsWith('/identity-request-bodies.ts'));
    if (username) {
        inputFile.content = (await runtime('src/modules/identity/username-inputs.ts', 'common')).content;
        bodies.content = (await runtime('src/modules/identity/username-request-bodies.ts', 'common')).content.replaceAll('./username-inputs.js', './identity-inputs.js');
        const controller = files.find((entry) => entry.path.endsWith('/username-identity.controller.ts'));
        controller.content = controller.content
            .replaceAll('./username-inputs.js', './identity-inputs.js')
            .replaceAll('./username-request-bodies.js', './identity-request-bodies.js');
    }
    else if (local) {
        inputFile.content = removeBetween(inputFile.content, 'export const firebaseInput =', 'export const changeInput =', inputFile.path);
        bodies.content = replaceExact(bodies.content, '  firebaseInput,\n', '', bodies.path);
        const firebaseBodyStart = requireIndex(bodies.content, '  firebaseBootstrap: requestBody(', bodies.path);
        bodies.content =
            bodies.content.slice(0, firebaseBodyStart) +
                '} satisfies Record<string, ApiBodyOptions>;\n';
    }
    else {
        // Keep the owned strict schema, including retry-stable private enrollment/device capabilities.
        bodies.content = `import {z} from 'zod';
import type {ApiBodyOptions} from '@nestjs/swagger';
import {firebaseInput} from './identity-inputs.js';
type RequestSchema=Extract<ApiBodyOptions,{schema:unknown}>['schema'];
export const identityRequestBodies={firebaseBootstrap:{required:true,description:'Verified Firebase token plus private retry-stable sessionCapability and separate installationCapability; returns only safe independently revocable session facts. Reuse the original capability as X-Session-Token.',schema:z.toJSONSchema(firebaseInput,{target:'openapi-3.0',io:'input'}) as RequestSchema}} satisfies Record<string,ApiBodyOptions>;
`;
    }
    files.push(file('src/modules/identity/identity.tokens.ts', "export const IDENTITY_CONFIG=Symbol('IdentityConfig');\nexport const ACCESS_TOKENS=Symbol('AccessTokens');\n", 'scaffold'));
    files.push(file('src/modules/identity/identity.module.ts', identityModule(databaseClass, db, local, application, reliable, username)));
    const client = await runtime('clients/auth-' +
        (username ? 'username' : local ? 'local' : 'firebase') +
        '.mjs', 'common');
    if (username)
        client.path = 'clients/auth-local.mjs';
    files.push(client);
    files.push(await runtime('src/initialize-identity-database.ts', db));
    if (db === 'postgres') {
        files.push(await runtime('migrations/001-identity.sql', db), await runtime('migrations/002-identity-lifecycle.sql', db));
    }
    return files;
}
function identityModule(databaseClass, db, local, application, reliable, username) {
    const email = local && !username;
    const credentials = username ? 'UsernameCredentials' : 'LocalCredentials';
    const controller = username
        ? 'UsernameIdentityController'
        : 'LocalIdentityController';
    return `import {Module,type DynamicModule,type Provider} from '@nestjs/common';
import type {AppConfig} from '../../core/config/app-config.js';
import type {PrincipalAuthority} from '../../core/auth/principal-authority.js';
${email || application ? "import {ApplicationError} from '../../core/errors/application-error.js';" : ''}
import {HttpSecurityModule} from '../../core/http/http-security.module.js';
import {DatabaseModule} from '../../core/database/database.module.js';
import type {${databaseClass}} from '../../core/database/${db === 'mongodb' ? 'mongo' : 'postgres'}-database.js';
import {AccountService} from '../accounts/account.service.js';
import {AccountModule} from '../accounts/account.module.js';
import {InstallationService} from '../installations/installation.service.js';
import {InstallationModule} from '../installations/installation.module.js';
import {SessionService} from '../sessions/session.service.js';
import {SessionIssuer} from '../sessions/session-issuer.service.js';
import {SessionManagement} from '../sessions/session-management.service.js';
import {SessionsModule} from '../sessions/sessions.module.js';
import {IdentityService} from './identity.service.js';
import {IdentityAuthority} from './identity-authority.service.js';
import {IdentityRateLimits} from './identity-rate-limits.service.js';
import {FreshIdentityProof} from './fresh-identity-proof.service.js';
import {AccountLifecycle} from './account-lifecycle.service.js';
import {SelfAccountController} from './self-account.controller.js';
import {InstallationLifecycle} from './installation-lifecycle.service.js';
import {InstallationLifecycleController} from './installation-lifecycle.controller.js';
import {IDENTITY_CONFIG${local ? ',ACCESS_TOKENS' : ''}} from './identity.tokens.js';
${email || application ? "import type {ActionDeliveryWriter} from '../../core/mail/action-delivery.js';" : ''}
${local
        ? `${email ? "import type {MailSubmitter} from '../../core/mail/mail-submitter.js';" : ''}
import {ArgonPasswords} from './argon-passwords.service.js';
import {JoseAccessTokens} from './jose-access-tokens.service.js';
import {RefreshSessions} from '../sessions/refresh-sessions.service.js';
import {${credentials}} from './${username ? 'username' : 'local'}-credentials.service.js';
${email ? "import {ActionTokens} from './action-tokens.service.js';" : ''}
import {ChangePassword} from './change-password.service.js';
import {${controller}} from './${username ? 'username' : 'local'}-identity.controller.js';
${email ? "import {ActionTokensController} from './action-tokens.controller.js';" : ''}
import {ChangePasswordController} from './change-password.controller.js';`
        : `import type {FirebaseVerifier} from './credential-ports.js';
import {ProviderCleanupService} from './provider-cleanup.service.js';
import {ProviderCleanupDispatcher,type FirebaseCleanup} from './provider-cleanup-dispatcher.service.js';
import {ProviderLinks} from './provider-links.service.js';
import {ProviderLinksController} from './provider-links.controller.js';
import {FirebaseTokenVerifier} from './firebase-token-verifier.service.js';
import {FirebaseEnrollment} from './firebase-enrollment.service.js';
import {FirebaseIdentityController,FIREBASE_VERIFIER} from './firebase-identity.controller.js';
${application
            ? `import type {Auth} from 'firebase-admin/auth';
import {FirebaseActionLinksService} from '../mail/firebase-action-links.service.js';
import {FirebaseActions} from './firebase-actions.service.js';
import {FirebaseActionsController} from './firebase-actions.controller.js';`
            : ''}
/** Trusted programmatic composition only; never selected by environment or HTTP input. */
export type FirebaseIdentityProvider=FirebaseVerifier & FirebaseCleanup & {close():Promise<void>;${application ? "actionLinksAuth():Pick<Auth,'generateEmailVerificationLink'|'generatePasswordResetLink'>;" : ''}};
export type IdentityRuntimeDependencies=Readonly<{firebase?:FirebaseIdentityProvider}>;`}
export type IdentityRuntime=Readonly<{authority:PrincipalAuthority;module:DynamicModule;${local ? '' : 'cleanup:ProviderCleanupDispatcher;'}close():Promise<void>}>;
@Module({})
export class IdentityModule {}
export async function createIdentityRuntime(config:AppConfig,db:${databaseClass}${local ? (username ? '' : ',mail:MailSubmitter,delivery?:ActionDeliveryWriter') : application ? ',delivery:ActionDeliveryWriter,dependencies:IdentityRuntimeDependencies={}' : ',dependencies:IdentityRuntimeDependencies={}'}):Promise<IdentityRuntime>{
${email ? (reliable ? "if(!delivery)throw new ApplicationError('RELIABLE_ACTION_DELIVERY_REQUIRED',500);" : "if(delivery)throw new ApplicationError('UNSELECTED_RELIABLE_ACTION_DELIVERY',500);") : application ? "if(!delivery)throw new ApplicationError('RELIABLE_ACTION_DELIVERY_REQUIRED',500);" : ''}
const accounts=new AccountService(db),identities=new IdentityService(db),installations=new InstallationService(db),sessions=new SessionService(db);
const issuer=new SessionIssuer(accounts,installations,sessions);
const management=new SessionManagement(db,accounts,identities,installations,sessions,config.auth.recentAuthSeconds*1000);
${local
        ? `const tokens=new JoseAccessTokens(config.auth.jwtPolicy);
const passwords=await ArgonPasswords.create();
const close=async():Promise<void>=>{};`
        : `const firebase=dependencies.firebase??new FirebaseTokenVerifier(config.auth.firebaseProjectId);
let closing:Promise<void>|undefined;
const close=():Promise<void>=>closing??=Promise.resolve().then(()=>firebase.close());
try {`}
const authority=new IdentityAuthority(db,accounts,installations,sessions,'${local ? 'local' : 'firebase'}',${local ? '[],tokens,null' : 'config.auth.firebaseMethods,null,firebase'});
const fresh=new FreshIdentityProof(db,accounts,identities,installations,sessions,${local ? 'passwords,null,[]' : 'null,firebase,config.auth.firebaseMethods'},config.auth.recentAuthSeconds*1000);
${local
        ? ''
        : `const cleanupStore=new ProviderCleanupService(db);
const cleanup=new ProviderCleanupDispatcher(db,identities,cleanupStore,firebase);`}
const lifecycle=new AccountLifecycle(db,accounts,identities,sessions,fresh,${local ? 'null' : 'cleanupStore'});
const installationLifecycle=new InstallationLifecycle(db,installations,sessions,fresh);
${application ? `const links=new FirebaseActionLinksService(firebase.actionLinksAuth(),config.firebaseActions.policy,config.firebaseActions.applicationName);` : ''}
const providers:Provider[]=[
{provide:IdentityService,useValue:identities},{provide:IdentityAuthority,useValue:authority},{provide:IDENTITY_CONFIG,useValue:config},{provide:IdentityRateLimits,useValue:new IdentityRateLimits(db,identities)},
{provide:FreshIdentityProof,useValue:fresh},{provide:AccountLifecycle,useValue:lifecycle},{provide:InstallationLifecycle,useValue:installationLifecycle},
${local
        ? `{provide:ACCESS_TOKENS,useValue:tokens},{provide:${credentials},useValue:new ${credentials}(db,accounts,identities,passwords,issuer)},
${email ? `{provide:ActionTokens,useValue:new ActionTokens(db,accounts,identities,sessions,passwords,mail${reliable ? ',delivery,config.mailDelivery.maxLifetimeMs' : ''})},` : ''}
{provide:RefreshSessions,useValue:new RefreshSessions(db,accounts,installations,sessions)},
{provide:ChangePassword,useValue:new ChangePassword(db,accounts,identities,installations,sessions,passwords,config.auth.recentAuthSeconds*1000)}`
        : `{provide:FIREBASE_VERIFIER,useValue:firebase},{provide:FirebaseEnrollment,useValue:new FirebaseEnrollment(db,accounts,identities,issuer,config.auth.firebaseProjectId,config.auth.firebaseMethods,config.auth.recentAuthSeconds*1000)},
{provide:ProviderCleanupService,useValue:cleanupStore},{provide:ProviderCleanupDispatcher,useValue:cleanup},
{provide:ProviderLinks,useValue:new ProviderLinks(db,identities,sessions,fresh,firebase,cleanupStore,config.auth.firebaseProjectId,config.auth.firebaseMethods,config.auth.recentAuthSeconds*1000)}${application ? ',\n{provide:FirebaseActions,useValue:new FirebaseActions(db,fresh,firebase,links,delivery,config.firebaseActions.continueUrl,config.firebaseActions.deliveryLifetimeMs)}' : ''}`}
];
return {authority,${local ? '' : 'cleanup,'}module:{module:IdentityModule,imports:[DatabaseModule.register(db),HttpSecurityModule.register(authority),AccountModule.register(accounts,authority),InstallationModule.register(installations),SessionsModule.register(sessions,issuer,management,authority)],controllers:[SelfAccountController,InstallationLifecycleController,${local ? controller + (email ? ',ActionTokensController' : '') + ',ChangePasswordController' : 'FirebaseIdentityController,ProviderLinksController' + (application ? ',FirebaseActionsController' : '')}],providers,exports:[HttpSecurityModule,IdentityService,IdentityAuthority,FreshIdentityProof,AccountLifecycle,InstallationLifecycle,AccountModule,InstallationModule,SessionsModule${local ? '' : ',ProviderLinks,ProviderCleanupDispatcher'}]},close};
${local ? '' : '}catch(error){await close();throw error;}'}
}
`;
}
//# sourceMappingURL=render-identity.js.map