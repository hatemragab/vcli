const guides = {
    'foundation.nest': {
        summary: 'NestJS application foundation.',
        defaults: ['package manager npm'],
        prerequisites: [],
        conditional: [],
        examples: ['vcli init my-api --yes --preset minimal'],
    },
    'database.mongodb': {
        summary: 'MongoDB is the only database in the generated app.',
        defaults: ['selected once during init'],
        prerequisites: ['foundation'],
        conditional: ['Notes, media and release require this or postgres.'],
        examples: ['vcli init my-api --yes --preset api --database mongodb'],
    },
    'database.postgres': {
        summary: 'PostgreSQL is the only database in the generated app.',
        defaults: ['selected once during init'],
        prerequisites: ['foundation'],
        conditional: ['Notes, media and release require this or mongodb.'],
        examples: ['vcli init my-api --yes --preset api --database postgres'],
    },
    'auth.local': {
        summary: 'Local sessions. Email identifier needs mail; username does not.',
        defaults: ['identifier email'],
        prerequisites: ['foundation', 'database'],
        conditional: [
            'Email registration requires a mail recipe.',
            'Username skips mail and email recovery routes.',
        ],
        examples: [
            'vcli init my-api --yes --database mongodb --auth local --local-identifier username --notes',
        ],
    },
    'auth.firebase': {
        summary: 'Firebase identity with an explicit method list.',
        defaults: ['methods email-password,phone,google,apple'],
        prerequisites: ['foundation', 'database'],
        conditional: ['Application action delivery requires reliable mail.'],
        examples: [
            'vcli init my-api --yes --database postgres --auth firebase --firebase-methods email-password',
        ],
    },
    'mail.capture': {
        summary: 'Development/test capture. Production startup rejects it.',
        defaults: ['no reliable actions'],
        prerequisites: ['foundation'],
        conditional: ['Reliable actions also require a database.'],
        examples: ['vcli add mail.capture'],
    },
    'mail.smtp': {
        summary: 'SMTP delivery. Credentials stay in the private config file.',
        defaults: ['port 587', 'no reliable actions'],
        prerequisites: ['foundation'],
        conditional: ['Reliable actions also require a database.'],
        examples: ['vcli add mail.smtp --reliable-actions'],
    },
    'mail.http': {
        summary: 'Resend HTTP delivery.',
        defaults: ['no reliable actions'],
        prerequisites: ['foundation'],
        conditional: ['Reliable actions also require a database.'],
        examples: ['vcli add mail.http'],
    },
    'storage.local': {
        summary: 'Private local filesystem storage. Upload mode is mediated only.',
        defaults: ['mediated uploads when media is selected'],
        prerequisites: ['foundation'],
        conditional: [
            'Presigned and multipart are not available on local storage.',
        ],
        examples: ['vcli add storage.local --media'],
    },
    'storage.aws-s3': {
        summary: 'AWS S3 storage profile.',
        defaults: ['region us-east-1'],
        prerequisites: ['foundation'],
        conditional: ['Presigned POST requires this profile.'],
        examples: [
            'vcli add storage.aws-s3 --media --upload-modes mediated,presigned',
        ],
    },
    'storage.r2': {
        summary: 'Cloudflare R2 storage profile.',
        defaults: ['region auto'],
        prerequisites: ['foundation'],
        conditional: ['Presigned POST is not selected for R2.'],
        examples: ['vcli add storage.r2 --media --upload-modes mediated'],
    },
    'example.notes': {
        summary: 'Owned notes example. Inputs do not choose the owner.',
        defaults: [],
        prerequisites: ['foundation', 'database', 'auth'],
        conditional: [
            'Realtime hints appear only when a realtime recipe is selected.',
        ],
        examples: [
            'vcli init my-api --yes --database mongodb --auth local --notes',
        ],
    },
    'media.private': {
        summary: 'Private owned media. Routes follow the selected upload modes.',
        defaults: ['modes mediated'],
        prerequisites: ['foundation', 'database', 'auth', 'storage'],
        conditional: ['Local storage keeps mediated routes only.'],
        examples: ['vcli add media.private --upload-modes mediated'],
    },
    'push.fcm': {
        summary: 'FCM push artifacts.',
        defaults: ['sandbox'],
        prerequisites: ['foundation', 'database', 'auth'],
        conditional: [],
        examples: ['vcli add push.fcm'],
    },
    'push.apns': {
        summary: 'APNs push artifacts.',
        defaults: ['sandbox'],
        prerequisites: ['foundation', 'database', 'auth'],
        conditional: [],
        examples: ['vcli add push.apns'],
    },
    'realtime.socket-io': {
        summary: 'Socket.IO realtime hints.',
        defaults: ['scale single-instance'],
        prerequisites: ['foundation', 'auth'],
        conditional: ['Cluster scale is a separate profile.'],
        examples: ['vcli add realtime.socket-io --realtime-scale single-instance'],
    },
    'realtime.native-ws': {
        summary: 'Native WebSocket realtime hints.',
        defaults: ['scale single-instance'],
        prerequisites: ['foundation', 'auth'],
        conditional: ['Cluster scale is unsupported for native WebSocket.'],
        examples: ['vcli add realtime.native-ws'],
    },
    'realtime.centrifugo': {
        summary: 'Centrifugo realtime hints.',
        defaults: ['scale single-instance'],
        prerequisites: ['foundation', 'auth'],
        conditional: ['Requires a separately run Centrifugo process.'],
        examples: ['vcli add realtime.centrifugo'],
    },
    'diagnostics.local': {
        summary: 'Bounded local evidence and vcli logs.',
        defaults: ['sources application', 'reader local-same-user'],
        prerequisites: ['foundation'],
        conditional: ['Test evidence requires the tests source.'],
        examples: [
            'vcli add diagnostics.local --evidence-sources application,database',
        ],
    },
    'deployment.dokploy': {
        summary: 'Dokploy deployment artifacts. Applying them is a separate command.',
        defaults: [],
        prerequisites: ['foundation'],
        conditional: [],
        examples: ['vcli add deployment.dokploy'],
    },
    'deployment.coolify': {
        summary: 'Coolify deployment artifacts. Applying them is a separate command.',
        defaults: [],
        prerequisites: ['foundation'],
        conditional: [],
        examples: ['vcli add deployment.coolify'],
    },
    'deployment.caprover': {
        summary: 'CapRover deployment artifacts. Applying them is a separate command.',
        defaults: [],
        prerequisites: ['foundation'],
        conditional: [],
        examples: ['vcli add deployment.caprover'],
    },
};
export function recipeGuide(id) {
    return (guides[id] ?? {
        summary: 'Bundled recipe.',
        defaults: [],
        prerequisites: [],
        conditional: [],
        examples: [`vcli add ${id}`],
    });
}
//# sourceMappingURL=catalog-guide.js.map