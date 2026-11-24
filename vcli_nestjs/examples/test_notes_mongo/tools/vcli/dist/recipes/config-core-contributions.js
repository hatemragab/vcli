import { actionOriginHelper, actionPolicyGuard } from './config-snippets.js';
import { selection, usernameAuth } from './selection.js';
export function contributeDatabase(draft, config) {
    if (selection(config, 'database')) {
        const mongo = selection(config, 'database') === 'database.mongodb';
        draft.fields.push({
            key: 'DATABASE_URL',
            schema: `z.string().regex(${mongo ? '/^mongodb(?:\\+srv)?:\\/\\//' : '/^postgres(?:ql)?:\\/\\//'})`,
            example: mongo
                ? 'mongodb://127.0.0.1:27017/app?replicaSet=rs0&directConnection=true'
                : 'postgresql://app:CHANGE_ME@127.0.0.1:5432/app',
            production: '',
        });
        draft.output.push(`database:{driver:'${mongo ? 'mongodb' : 'postgres'}' as const,url:e.DATABASE_URL}`);
    }
}
export function contributeAuth(draft, config, auth) {
    if (auth) {
        draft.fields.push({
            key: 'SESSION_TTL_SECONDS',
            schema: 'number(86400,2592000)',
            example: '86400',
        }, { key: 'RECENT_AUTH_SECONDS', schema: 'number(300,900)', example: '300' });
        let details;
        if (auth === 'auth.local') {
            draft.fields.push({
                key: 'JWT_KEYS_JSON',
                schema: 'privateJson(z.array(jwtKeySchema).min(1).max(4))',
                example: '',
                production: '',
            }, {
                key: 'JWT_ACTIVE_KID',
                schema: 'z.string().regex(/^[A-Za-z0-9_-]{1,40}$/)',
                example: '',
                production: '',
            }, {
                key: 'JWT_MAX_LIFETIME_SECONDS',
                schema: 'number(900,86400)',
                example: '900',
            }, {
                key: 'JWT_MAX_FUTURE_ISSUED_SECONDS',
                schema: 'z.coerce.number().int().min(0).max(60).default(0)',
                example: '0',
            }, {
                key: 'JWT_ISSUER',
                schema: "z.string().min(1).default('app')",
                example: 'app',
            }, {
                key: 'JWT_AUDIENCE',
                schema: "z.string().min(1).default('app-api')",
                example: 'app-api',
            }, {
                key: 'ACCESS_TTL_SECONDS',
                schema: 'number(300,3600)',
                example: '300',
            });
            draft.guards.push("if(new Set(e.JWT_KEYS_JSON.map(key=>key.id)).size!==e.JWT_KEYS_JSON.length || new Set(e.JWT_KEYS_JSON.map(key=>Buffer.from(key.key).toString('base64url'))).size!==e.JWT_KEYS_JSON.length || !e.JWT_KEYS_JSON.some(key=>key.id===e.JWT_ACTIVE_KID) || e.ACCESS_TTL_SECONDS>e.JWT_MAX_LIFETIME_SECONDS) throw new ApplicationError('INVALID_JWT_POLICY',500);");
            details =
                (usernameAuth(config) ? "identifier:'username' as const," : '') +
                    'jwtPolicy:{issuer:e.JWT_ISSUER,audience:e.JWT_AUDIENCE,keys:e.JWT_KEYS_JSON,activeSigningKeyId:e.JWT_ACTIVE_KID,maxLifetimeSeconds:e.JWT_MAX_LIFETIME_SECONDS,maxFutureIssuedSeconds:e.JWT_MAX_FUTURE_ISSUED_SECONDS},accessTtlSeconds:e.ACCESS_TTL_SECONDS';
        }
        else {
            draft.fields.push({
                key: 'FIREBASE_PROJECT_ID',
                schema: 'z.string().min(1)',
                example: '',
                production: '',
            });
            const methods = config.capabilities.auth.options.methods ?? [
                'email-password',
                'phone',
                'google',
                'apple',
            ];
            const ids = {
                'email-password': 'password',
                phone: 'phone',
                google: 'google.com',
                apple: 'apple.com',
            };
            const selected = methods.map((method) => ids[method]);
            details = `firebaseProjectId:e.FIREBASE_PROJECT_ID,firebaseMethods:${JSON.stringify(selected)} as readonly ('password'|'phone'|'google.com'|'apple.com')[]`;
        }
        draft.output.push(`auth:{driver:'${auth === 'auth.local' ? 'local' : 'firebase'}' as const,sessionTtlSeconds:e.SESSION_TTL_SECONDS,recentAuthSeconds:e.RECENT_AUTH_SECONDS,${details}}`);
    }
}
export function contributeMail(draft, config) {
    if (selection(config, 'mail')) {
        const smtp = selection(config, 'mail') === 'mail.smtp';
        const http = selection(config, 'mail') === 'mail.http';
        draft.fields.push({
            key: 'MAIL_FROM',
            schema: "z.email().default('application@example.invalid')",
            example: 'application@example.invalid',
        });
        if (http) {
            draft.fields.push({
                key: 'RESEND_API_KEY',
                schema: 'z.string().min(1).max(512)',
                example: '',
                production: '',
            }, {
                key: 'HTTP_MAIL_TIMEOUT_MS',
                schema: 'z.coerce.number().int().min(50).max(60000).default(10000)',
                example: '10000',
            }, {
                key: 'HTTP_MAIL_MAX_CONCURRENCY',
                schema: 'number(4,16)',
                example: '4',
            });
            draft.output.push("mail:{driver:'http' as const,from:e.MAIL_FROM,apiKey:e.RESEND_API_KEY,timeoutMs:e.HTTP_MAIL_TIMEOUT_MS,maxConcurrency:e.HTTP_MAIL_MAX_CONCURRENCY}");
        }
        else if (smtp) {
            draft.fields.push({
                key: 'SMTP_HOST',
                schema: 'z.string().min(1)',
                example: '',
                production: '',
            }, { key: 'SMTP_PORT', schema: 'number(587,65535)', example: '587' }, { key: 'SMTP_SECURE', schema: 'flag', example: 'false' }, { key: 'SMTP_USER', schema: 'optionalString', example: '' }, { key: 'SMTP_PASSWORD', schema: 'optionalString', example: '' }, {
                key: 'SMTP_TIMEOUT_MS',
                schema: 'z.coerce.number().int().min(50).max(60000).default(10000)',
                example: '10000',
            }, { key: 'SMTP_MAX_CONCURRENCY', schema: 'number(4,16)', example: '4' });
            draft.guards.push("if(Boolean(e.SMTP_USER)!==Boolean(e.SMTP_PASSWORD)) throw new ApplicationError('INVALID_SMTP_CONFIG',500);");
            draft.output.push("mail:{driver:'smtp' as const,from:e.MAIL_FROM,host:e.SMTP_HOST,port:e.SMTP_PORT,secure:e.SMTP_SECURE,user:e.SMTP_USER,password:e.SMTP_PASSWORD,timeoutMs:e.SMTP_TIMEOUT_MS,maxConcurrency:e.SMTP_MAX_CONCURRENCY}");
        }
        else {
            draft.fields.push({
                key: 'MAIL_CAPTURE_MAX',
                schema: 'number(100,1000)',
                example: '100',
            });
            draft.guards.push("if(e.NODE_ENV==='production') throw new ApplicationError('UNSAFE_PRODUCTION_CAPTURE',500);");
            draft.output.push("mail:{driver:'capture' as const,from:e.MAIL_FROM,maxCaptured:e.MAIL_CAPTURE_MAX}");
        }
    }
}
export function contributeReliableMail(draft, config, reliableMail) {
    if (reliableMail) {
        draft.fields.push({
            key: 'MAIL_DELIVERY_KEY_ID',
            schema: 'z.string().regex(/^[A-Za-z0-9_-]{1,40}$/)',
            example: '',
            production: '',
        }, {
            key: 'MAIL_DELIVERY_KEYS_JSON',
            schema: 'privateJson(mailKeysSchema)',
            example: '',
            production: '',
        }, {
            key: 'MAIL_DELIVERY_MAX_ATTEMPTS',
            schema: 'number(3,10)',
            example: '3',
        }, {
            key: 'MAIL_DELIVERY_LEASE_MS',
            schema: 'z.coerce.number().int().min(1000).max(300000).default(30000)',
            example: '30000',
        }, {
            key: 'MAIL_DELIVERY_MAX_LIFETIME_MS',
            schema: 'z.coerce.number().int().min(1000).max(86400000).default(3600000)',
            example: '3600000',
        });
        draft.guards.push("if(!Object.hasOwn(e.MAIL_DELIVERY_KEYS_JSON,e.MAIL_DELIVERY_KEY_ID)) throw new ApplicationError('INVALID_MAIL_DELIVERY_KEYS',500);");
        if (selection(config, 'mail') === 'mail.http')
            draft.guards.push("if(e.MAIL_DELIVERY_LEASE_MS<=e.HTTP_MAIL_TIMEOUT_MS) throw new ApplicationError('INVALID_MAIL_DELIVERY_LEASE',500);");
        if (selection(config, 'mail') === 'mail.smtp')
            draft.guards.push("if(e.MAIL_DELIVERY_LEASE_MS<=e.SMTP_TIMEOUT_MS) throw new ApplicationError('INVALID_MAIL_DELIVERY_LEASE',500);");
        draft.output.push('mailDelivery:{activeKeyId:e.MAIL_DELIVERY_KEY_ID,keys:e.MAIL_DELIVERY_KEYS_JSON,maxAttempts:e.MAIL_DELIVERY_MAX_ATTEMPTS,leaseMs:e.MAIL_DELIVERY_LEASE_MS,maxLifetimeMs:e.MAIL_DELIVERY_MAX_LIFETIME_MS}');
    }
}
export function contributeApplicationActions(draft, config, applicationActions) {
    if (applicationActions) {
        draft.helpers.push(actionOriginHelper);
        draft.fields.push({
            key: 'FIREBASE_ACTION_CONTINUE_ORIGINS',
            schema: 'privateJson(z.array(actionOriginSchema).min(1).max(16))',
            example: '["http://127.0.0.1:3100"]',
            production: '["https://app.example.invalid"]',
        }, {
            key: 'FIREBASE_ACTION_CONTINUE_URL',
            schema: 'z.url().max(2048)',
            example: 'http://127.0.0.1:3100/auth/action',
            production: 'https://app.example.invalid/auth/action',
        }, {
            key: 'FIREBASE_ACTION_LINK_DOMAIN',
            schema: 'optionalString',
            example: '',
        }, {
            key: 'FIREBASE_ACTION_HANDLE_CODE_IN_APP',
            schema: 'flag',
            example: 'false',
        }, {
            key: 'FIREBASE_ACTION_IOS_BUNDLE_ID',
            schema: 'optionalString',
            example: '',
        }, {
            key: 'FIREBASE_ACTION_ANDROID_PACKAGE_NAME',
            schema: 'optionalString',
            example: '',
        }, {
            key: 'FIREBASE_ACTION_ANDROID_INSTALL_APP',
            schema: 'flag',
            example: 'false',
        }, {
            key: 'FIREBASE_ACTION_ANDROID_MINIMUM_VERSION',
            schema: 'optionalString',
            example: '',
        });
        draft.guards.push(actionPolicyGuard);
        draft.output.push(`firebaseActions:{policy:{continueOrigins:e.FIREBASE_ACTION_CONTINUE_ORIGINS,linkDomain:e.FIREBASE_ACTION_LINK_DOMAIN,handleCodeInApp:e.FIREBASE_ACTION_HANDLE_CODE_IN_APP,iOS:e.FIREBASE_ACTION_IOS_BUNDLE_ID?{bundleId:e.FIREBASE_ACTION_IOS_BUNDLE_ID}:undefined,android:e.FIREBASE_ACTION_ANDROID_PACKAGE_NAME?{packageName:e.FIREBASE_ACTION_ANDROID_PACKAGE_NAME,installApp:e.FIREBASE_ACTION_ANDROID_INSTALL_APP,minimumVersion:e.FIREBASE_ACTION_ANDROID_MINIMUM_VERSION}:undefined},continueUrl:e.FIREBASE_ACTION_CONTINUE_URL,applicationName:${JSON.stringify(config.project.name)},deliveryLifetimeMs:e.MAIL_DELIVERY_MAX_LIFETIME_MS}`);
    }
}
//# sourceMappingURL=config-core-contributions.js.map