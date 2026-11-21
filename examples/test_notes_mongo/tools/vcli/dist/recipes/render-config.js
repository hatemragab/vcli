import { file } from './bundle.js';
import { selection } from './selection.js';
import { privateJsonHelper, jwtKeyHelper, mailKeyHelper, } from './config-snippets.js';
import { contributeApplicationActions, contributeAuth, contributeDatabase, contributeDiagnostics, contributeMail, contributePush, contributeRealtime, contributeReliableMail, contributeStorage, } from './config-contributions.js';
/** Integer bounds only. Nested array or string limits are not numeric config. */
function fieldBounds(schema) {
    const called = /^number\(\d+,(\d+)\)$/.exec(schema);
    if (called)
        return { minimum: 1, maximum: Number(called[1]) };
    if (!schema.startsWith('z.coerce.number()'))
        return {};
    const minimum = /\.min\((-?\d+)\)/.exec(schema);
    const maximum = /\.max\((-?\d+)\)/.exec(schema);
    return {
        ...(minimum ? { minimum: Number(minimum[1]) } : {}),
        ...(maximum ? { maximum: Number(maximum[1]) } : {}),
    };
}
/** This single selected-field model drives validation, examples and deployment keys. */
export function configuration(config) {
    const auth = selection(config, 'auth'), storage = selection(config, 'storage'), realtime = selection(config, 'realtime');
    const reliableMail = config.capabilities.mail?.options.reliableActions === true;
    const applicationActions = auth === 'auth.firebase' &&
        config.capabilities.auth?.options.actionDelivery === 'application';
    const fields = [
        {
            key: 'NODE_ENV',
            schema: "z.enum(['development','test','production']).default('development')",
            example: 'development',
            production: 'production',
        },
        {
            key: 'HOST',
            schema: "z.string().min(1).default('127.0.0.1')",
            example: '127.0.0.1',
            production: '0.0.0.0',
        },
        { key: 'PORT', schema: 'number(3100,65535)', example: '3100' },
        {
            key: 'PUBLIC_ORIGIN',
            schema: "z.url().default('http://127.0.0.1:3100')",
            example: 'http://127.0.0.1:3100',
            production: 'https://api.example.invalid',
        },
        {
            key: 'ALLOWED_ORIGINS',
            schema: "z.string().default('http://127.0.0.1:3100')",
            example: 'http://127.0.0.1:3100',
            production: 'https://app.example.invalid',
        },
    ];
    const output = [
        "environment:e.NODE_ENV as 'development'|'test'|'production', host:e.HOST, port:e.PORT, publicOrigin:e.PUBLIC_ORIGIN, allowedOrigins:e.ALLOWED_ORIGINS.split(',').map((value)=>z.url().parse(value.trim()))",
    ];
    const guards = [];
    const helpers = [];
    if (auth === 'auth.local' || reliableMail || applicationActions)
        helpers.push(privateJsonHelper);
    if (auth === 'auth.local')
        helpers.push(jwtKeyHelper);
    if (reliableMail)
        helpers.push(mailKeyHelper);
    const draft = { fields, output, guards, helpers };
    contributeDatabase(draft, config);
    contributeAuth(draft, config, auth);
    contributeMail(draft, config);
    contributeReliableMail(draft, config, reliableMail);
    contributeApplicationActions(draft, config, applicationActions);
    contributeStorage(draft, config, storage);
    contributeRealtime(draft, config, realtime);
    contributePush(draft, config);
    contributeDiagnostics(draft, config);
    const source = `import {config as loadDotenv} from 'dotenv';
import {z} from 'zod';
import {ApplicationError} from '../errors/application-error.js';
const number=(fallback:number,maximum:number)=>z.coerce.number().int().positive().max(maximum).default(fallback);
${fields.some((field) => field.schema === 'flag') ? "const flag=z.enum(['true','false']).default('false').transform((value)=>value==='true');" : ''}
${fields.some((field) => field.schema === 'optionalString') ? "const optionalString=z.preprocess((value)=>value===''?undefined:value,z.string().min(1).optional());" : ''}
${helpers.join('\n')}
export const configSchema=z.object({${fields.map((f) => `${f.key}:${f.schema}`).join(',\n')}});
export function loadConfig(env:NodeJS.ProcessEnv=process.env) {
  for(const key of ['DATABASE_DRIVER','AUTH_DRIVER','STORAGE_DRIVER','REALTIME_DRIVER','MAIL_DRIVER'])
    if(env[key]!==undefined) throw new ApplicationError('RUNTIME_PROVIDER_SELECTION_UNSUPPORTED',500);
  const result=configSchema.safeParse(env);
  if(!result.success) throw new ApplicationError('INVALID_CONFIG',500,'Invalid configuration keys: '+result.error.issues.map((issue)=>issue.path.join('.')).join(', '));
  const e=result.data;
  ${guards.join('\n')}
  return {${output.join(',\n')}};
}
export function loadSelectedEnvFile():void {
  const path=process.env.APP_ENV_FILE;
  if(!path) return;
  if(process.env.NODE_ENV==='production' && /development|test/.test(path)) throw new ApplicationError('UNSAFE_ENV_FILE',500);
  const result=loadDotenv({path,override:false,quiet:true});
  if(result.error) throw new ApplicationError('ENV_FILE_UNAVAILABLE',500);
}
`;
    const example = (production) => '# Set required blank values privately. Runtime environment overrides APP_ENV_FILE.\n' +
        fields
            .map((f) => `${f.key}=${production ? (f.production ?? f.example) : f.example}`)
            .join('\n') +
        '\n';
    return {
        keys: fields.map((f) => f.key),
        fields: fields.map((field) => {
            const secret = [
                'DATABASE_URL',
                'JWT_KEYS_JSON',
                'MAIL_DELIVERY_KEYS_JSON',
                'RESEND_API_KEY',
                'SMTP_PASSWORD',
                'SMTP_USER',
                'CENTRIFUGO_API_KEY',
                'CENTRIFUGO_PROXY_SECRET',
                'APNS_KEY_PATH',
                'FCM_CREDENTIALS_PATH',
            ].includes(field.key);
            const defaulted = field.schema.includes('.default(') ||
                field.schema.startsWith('number(') ||
                field.schema === 'flag';
            const bounds = fieldBounds(field.schema);
            return {
                key: field.key,
                required: !defaulted && field.schema !== 'optionalString',
                secret,
                ...(defaulted && !secret
                    ? { defaultValue: field.production ?? field.example }
                    : {}),
                ...bounds,
            };
        }),
        files: [
            file('src/core/config/load-config.ts', source),
            file('src/core/config/app-config.ts', "import type {loadConfig} from './load-config.js';\nexport type AppConfig=ReturnType<typeof loadConfig>;\n"),
            file('.env.development.example', example(false)),
            file('.env.production.example', example(true)),
        ],
    };
}
//# sourceMappingURL=render-config.js.map