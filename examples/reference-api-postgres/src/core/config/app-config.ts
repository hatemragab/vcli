export type AppConfig = Readonly<{
  environment: 'development' | 'test' | 'production';
  host: string;
  port: number;
  publicOrigin: string;
  allowedOrigins: readonly string[];
  database: Readonly<{
    driver: 'postgres';
    url: string;
  }>;
  auth: Readonly<{
    driver: 'local' | 'firebase';
    firebaseProjectId?: string;
    firebaseMethods: readonly (
      'password' | 'phone' | 'google.com' | 'apple.com'
    )[];
    jwtSecret?: string;
    issuer: string;
    audience: string;
    accessTtlSeconds: number;
    sessionTtlSeconds: number;
    recentAuthSeconds: number;
  }>;
  storage: Readonly<{
    driver: 'local' | 's3';
    localRoot: string;
    maxBytes: number;
    uploadTtlSeconds: number;
    s3Profile: 'aws' | 'r2' | 'custom';
    bucket?: string;
    region: string;
    endpoint?: string;
    forcePathStyle: boolean;
  }>;
  realtime: Readonly<{
    driver: 'socketio' | 'ws' | 'centrifugo';
    path: string;
    maxPayloadBytes: number;
    ticketTtlSeconds: number;
    centrifugoApiUrl?: string;
    centrifugoApiKey?: string;
    centrifugoProxySecret?: string;
  }>;
  mail: Readonly<{
    driver: 'capture' | 'smtp';
    from: string;
    host?: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
    maxCaptured: number;
  }>;
  push: Readonly<{
    fcmEnabled: boolean;
    apnsEnabled: boolean;
    apnsTeamId?: string;
    apnsKeyId?: string;
    apnsKeyPath?: string;
    apnsTopic?: string;
    apnsProduction: boolean;
  }>;
  diagnostics: Readonly<{
    directory: string;
    maxBytes: number;
    maxFiles: number;
  }>;
}>;
