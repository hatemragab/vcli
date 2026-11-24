import {
  LOCAL_DEVELOPMENT_STORAGE_ROOT,
  type ProjectConfig,
} from '../contracts.js';
import type { ConfigDraft } from './config-core-contributions.js';
import { evidenceByteBounds } from './evidence-bounds.js';
import { selection } from './selection.js';

export function contributeStorage(
  draft: ConfigDraft,
  config: ProjectConfig,
  storage: string | undefined,
): void {
  if (storage) {
    const localRoot =
      storage === 'storage.local'
        ? LOCAL_DEVELOPMENT_STORAGE_ROOT
        : 'var/storage';
    draft.fields.push({
      key: 'LOCAL_STORAGE_ROOT',
      schema: "z.string().min(1).default('var/storage')",
      example: localRoot,
      production: 'var/storage',
    });
    if (selection(config, 'media'))
      draft.fields.push(
        {
          key: 'UPLOAD_MAX_BYTES',
          schema: 'number(5242880,104857600)',
          example: '5242880',
        },
        {
          key: 'UPLOAD_TTL_SECONDS',
          schema: 'number(300,900)',
          example: '300',
        },
      );
    let details = '';
    if (storage !== 'storage.local') {
      draft.fields.push(
        {
          key: 'S3_BUCKET',
          schema: 'z.string().min(1)',
          example: '',
          production: '',
        },
        {
          key: 'S3_REGION',
          schema:
            storage === 'storage.r2'
              ? "z.literal('auto').default('auto')"
              : "z.string().min(1).default('us-east-1')",
          example: storage === 'storage.r2' ? 'auto' : 'us-east-1',
        },
      );
      if (storage === 'storage.r2')
        draft.fields.push({
          key: 'S3_ENDPOINT',
          schema:
            'z.url().regex(/^https:\\/\\/[a-zA-Z0-9.-]+\\.r2\\.cloudflarestorage\\.com\\/?$/)',
          example: '',
          production: '',
        });
      details = `s3Profile:'${storage === 'storage.r2' ? 'r2' : 'aws'}' as const,bucket:e.S3_BUCKET,region:e.S3_REGION,endpoint:${storage === 'storage.r2' ? 'e.S3_ENDPOINT' : 'undefined'},forcePathStyle:false,`;
    }
    draft.output.push(
      `storage:{driver:'${storage === 'storage.local' ? 'local' : 's3'}' as const,localRoot:e.LOCAL_STORAGE_ROOT,${details}${selection(config, 'media') ? `maxBytes:e.UPLOAD_MAX_BYTES,uploadTtlSeconds:e.UPLOAD_TTL_SECONDS,modes:${JSON.stringify(config.capabilities.media?.options.modes ?? ['mediated'])} as readonly ('mediated'|'presigned'|'multipart')[]` : ''}}`,
    );
  }
}

export function contributeRealtime(
  draft: ConfigDraft,
  config: ProjectConfig,
  realtime: string | undefined,
): void {
  if (realtime) {
    draft.fields.push(
      {
        key: 'REALTIME_PATH',
        schema: "z.string().regex(/^\\/[a-zA-Z0-9/_-]+$/).default('/realtime')",
        example: '/realtime',
      },
      {
        key: 'REALTIME_MAX_PAYLOAD_BYTES',
        schema: 'number(16384,65536)',
        example: '16384',
      },
    );
    let details = '';
    if (realtime !== 'realtime.socket-io') {
      draft.fields.push({
        key: 'REALTIME_TICKET_TTL_SECONDS',
        schema: 'number(30,30)',
        example: '30',
      });
      details = 'ticketTtlSeconds:e.REALTIME_TICKET_TTL_SECONDS,';
    }
    if (realtime === 'realtime.centrifugo') {
      draft.fields.push(
        {
          key: 'CENTRIFUGO_API_URL',
          schema: 'z.url()',
          example: 'http://127.0.0.1:9000/api',
        },
        {
          key: 'CENTRIFUGO_API_KEY',
          schema: 'z.string().min(32)',
          example: '',
        },
        {
          key: 'CENTRIFUGO_PROXY_SECRET',
          schema: 'z.string().min(32)',
          example: '',
        },
      );
      draft.guards.push(
        "if(e.CENTRIFUGO_API_KEY===e.CENTRIFUGO_PROXY_SECRET) throw new ApplicationError('INVALID_CENTRIFUGO_CONFIG',500);",
      );
      details +=
        'centrifugoApiUrl:e.CENTRIFUGO_API_URL,centrifugoApiKey:e.CENTRIFUGO_API_KEY,centrifugoProxySecret:e.CENTRIFUGO_PROXY_SECRET,';
    }
    draft.output.push(
      `realtime:{scale:'${config.capabilities.realtime?.options.scale === 'cluster' ? 'cluster' : 'single-instance'}' as const,driver:'${realtime === 'realtime.socket-io' ? 'socketio' : realtime === 'realtime.native-ws' ? 'ws' : 'centrifugo'}' as const,path:e.REALTIME_PATH,maxPayloadBytes:e.REALTIME_MAX_PAYLOAD_BYTES,${details}}`,
    );
  }
}

export function contributePush(
  draft: ConfigDraft,
  config: ProjectConfig,
): void {
  if (selection(config, 'push-fcm') || selection(config, 'push-apns')) {
    draft.fields.push({
      key: 'PUSH_ENVIRONMENT',
      schema: "z.enum(['sandbox','production']).default('sandbox')",
      example: 'sandbox',
      production: 'production',
    });
    let details = 'environment:e.PUSH_ENVIRONMENT,';
    if (selection(config, 'push-fcm')) {
      draft.fields.push({
        key: 'FCM_PROJECT_ID',
        schema: 'z.string().min(1)',
        example: '',
      });
      draft.fields.push({
        key: 'FCM_CREDENTIALS_PATH',
        schema: 'optionalString',
        example: '',
      });
      details +=
        'fcmProjectId:e.FCM_PROJECT_ID,fcmCredentialsPath:e.FCM_CREDENTIALS_PATH,';
    }
    if (selection(config, 'push-apns')) {
      for (const key of [
        'APNS_TEAM_ID',
        'APNS_KEY_ID',
        'APNS_KEY_PATH',
        'APNS_TOPIC',
      ])
        draft.fields.push({ key, schema: 'z.string().min(1)', example: '' });
      draft.fields.push({
        key: 'APNS_PRODUCTION',
        schema: 'flag',
        example: 'false',
        production: 'true',
      });
      draft.guards.push(
        "if(e.APNS_PRODUCTION!==(e.PUSH_ENVIRONMENT==='production')) throw new ApplicationError('INVALID_PUSH_ENVIRONMENT',500);",
      );
      details +=
        'apnsTeamId:e.APNS_TEAM_ID,apnsKeyId:e.APNS_KEY_ID,apnsKeyPath:e.APNS_KEY_PATH,apnsTopic:e.APNS_TOPIC,apnsProduction:e.APNS_PRODUCTION,';
    }
    draft.output.push(`push:{${details}}`);
  }
}

export function contributeDiagnostics(
  draft: ConfigDraft,
  config: ProjectConfig,
): void {
  if (selection(config, 'diagnostics')) {
    draft.fields.push(
      {
        key: 'EVIDENCE_DIRECTORY',
        schema: "z.string().min(1).default('var/evidence')",
        example: 'var/evidence',
      },
      {
        key: 'EVIDENCE_MAX_BYTES',
        schema: `z.coerce.number().int().min(${evidenceByteBounds.minimum}).max(${evidenceByteBounds.maximum}).default(${evidenceByteBounds.fallback})`,
        example: '1048576',
      },
      { key: 'EVIDENCE_MAX_FILES', schema: 'number(3,10)', example: '3' },
      {
        key: 'EVIDENCE_MAX_AGE_MS',
        schema:
          'z.coerce.number().int().min(1000).max(604800000).default(86400000)',
        example: '86400000',
      },
    );
    draft.output.push(
      `diagnostics:{directory:e.EVIDENCE_DIRECTORY,maxBytes:e.EVIDENCE_MAX_BYTES,maxFiles:e.EVIDENCE_MAX_FILES,maxAgeMs:e.EVIDENCE_MAX_AGE_MS,sources:${JSON.stringify(config.capabilities.diagnostics?.options.sources ?? ['application'])} as readonly ('application'|'workers'|'database'|'infrastructure'|'tests')[]}`,
    );
  }
}
