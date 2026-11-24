import { recipes } from './catalog.js';

export interface RecipeGuide {
  summary: string;
  defaults: string[];
  prerequisites: string[];
  conditional: string[];
  examples: string[];
}

const sessionAuthRequirement = 'Requires full local auth or Firebase.';

const guides: Record<string, Omit<RecipeGuide, 'prerequisites'>> = {
  'foundation.nest': {
    summary: 'NestJS application foundation.',
    defaults: ['package manager npm'],
    conditional: [],
    examples: ['vcli init my-api --yes --preset minimal'],
  },
  'database.mongodb': {
    summary: 'MongoDB is the only database in the generated app.',
    defaults: ['selected once during init'],
    conditional: ['Notes, media and release require this or postgres.'],
    examples: ['vcli init my-api --yes --preset api --database mongodb'],
  },
  'database.postgres': {
    summary: 'PostgreSQL is the only database in the generated app.',
    defaults: ['selected once during init'],
    conditional: ['Notes, media and release require this or mongodb.'],
    examples: ['vcli init my-api --yes --preset api --database postgres'],
  },
  'auth.local': {
    summary: 'Local password authentication with JWT access tokens.',
    defaults: ['profile basic during init', 'identifier email'],
    conditional: [
      'Basic supports registration, login, and the current-account route. Set --mail explicitly to add application mail.',
      'Full supports revocable sessions. Full email/password auth requires a mail recipe for verification and recovery.',
    ],
    examples: [
      'vcli init my-api --yes --database mongodb --auth local',
      'vcli init notes-api --yes --database mongodb --auth local --local-auth-profile full --local-identifier username --notes',
    ],
  },
  'auth.firebase': {
    summary: 'Firebase identity with an explicit method list.',
    defaults: ['methods email-password,phone,google,apple'],
    conditional: ['Application action delivery requires reliable mail.'],
    examples: [
      'vcli init my-api --yes --database postgres --auth firebase --firebase-methods email-password',
    ],
  },
  'mail.capture': {
    summary: 'Development/test capture. Production startup rejects it.',
    defaults: ['no reliable actions'],
    conditional: ['Reliable actions also require a database.'],
    examples: ['vcli add mail.capture'],
  },
  'mail.smtp': {
    summary: 'SMTP delivery. Credentials stay in the private config file.',
    defaults: ['port 587', 'no reliable actions'],
    conditional: ['Reliable actions also require a database.'],
    examples: ['vcli add mail.smtp --reliable-actions'],
  },
  'mail.http': {
    summary: 'Resend HTTP delivery.',
    defaults: ['no reliable actions'],
    conditional: ['Reliable actions also require a database.'],
    examples: ['vcli add mail.http'],
  },
  'storage.local': {
    summary: 'Private local filesystem storage. Upload mode is mediated only.',
    defaults: ['mediated uploads when media is selected'],
    conditional: [
      'Presigned and multipart are not available on local storage.',
    ],
    examples: ['vcli add storage.local --media'],
  },
  'storage.aws-s3': {
    summary: 'AWS S3 storage profile.',
    defaults: ['region us-east-1'],
    conditional: ['Presigned POST requires this profile.'],
    examples: [
      'vcli add storage.aws-s3 --media --upload-modes mediated,presigned',
    ],
  },
  'storage.r2': {
    summary: 'Cloudflare R2 storage profile.',
    defaults: ['region auto'],
    conditional: ['Presigned POST is not selected for R2.'],
    examples: ['vcli add storage.r2 --media --upload-modes mediated'],
  },
  'example.notes': {
    summary: 'Owned notes example. Inputs do not choose the owner.',
    defaults: [],
    conditional: [
      sessionAuthRequirement,
      'Realtime hints appear only when a realtime recipe is selected.',
    ],
    examples: [
      'vcli init notes-api --yes --database mongodb --auth local --local-auth-profile full --local-identifier username --notes',
    ],
  },
  'media.private': {
    summary: 'Private owned media. Routes follow the selected upload modes.',
    defaults: ['modes mediated'],
    conditional: [
      sessionAuthRequirement,
      'Local storage keeps mediated routes only.',
    ],
    examples: ['vcli add media.private --upload-modes mediated'],
  },
  'push.fcm': {
    summary: 'FCM push artifacts.',
    defaults: ['sandbox'],
    conditional: [sessionAuthRequirement],
    examples: ['vcli add push.fcm'],
  },
  'push.apns': {
    summary: 'APNs push artifacts.',
    defaults: ['sandbox'],
    conditional: [sessionAuthRequirement],
    examples: ['vcli add push.apns'],
  },
  'realtime.socket-io': {
    summary: 'Socket.IO realtime hints.',
    defaults: ['scale single-instance'],
    conditional: [
      sessionAuthRequirement,
      'Cluster scale is a separate profile.',
    ],
    examples: ['vcli add realtime.socket-io --realtime-scale single-instance'],
  },
  'realtime.native-ws': {
    summary: 'Native WebSocket realtime hints.',
    defaults: ['scale single-instance'],
    conditional: [
      sessionAuthRequirement,
      'Cluster scale is unsupported for native WebSocket.',
    ],
    examples: ['vcli add realtime.native-ws'],
  },
  'realtime.centrifugo': {
    summary: 'Centrifugo realtime hints.',
    defaults: ['scale single-instance'],
    conditional: [
      sessionAuthRequirement,
      'Requires a separately run Centrifugo process.',
    ],
    examples: ['vcli add realtime.centrifugo'],
  },
  'diagnostics.local': {
    summary: 'Bounded local evidence and vcli logs.',
    defaults: ['sources application', 'reader local-same-user'],
    conditional: ['Test evidence requires the tests source.'],
    examples: [
      'vcli add diagnostics.local --evidence-sources application,database',
    ],
  },
  'deployment.dokploy': {
    summary:
      'Dokploy deployment artifacts. Applying them is a separate command.',
    defaults: [],
    conditional: [],
    examples: ['vcli add deployment.dokploy'],
  },
  'deployment.coolify': {
    summary:
      'Coolify deployment artifacts. Applying them is a separate command.',
    defaults: [],
    conditional: [],
    examples: ['vcli add deployment.coolify'],
  },
  'deployment.caprover': {
    summary:
      'CapRover deployment artifacts. Applying them is a separate command.',
    defaults: [],
    conditional: [],
    examples: ['vcli add deployment.caprover'],
  },
};

export function recipeGuide(id: string): RecipeGuide {
  const { summary, defaults, conditional, examples } = guides[id] ?? {
    summary: 'Bundled recipe.',
    defaults: [],
    conditional: [],
    examples: [`vcli add ${id}`],
  };
  const recipe = recipes.find((item) => item.id === id);
  return {
    summary,
    defaults,
    prerequisites: [...(recipe?.requires ?? [])],
    conditional,
    examples,
  };
}
