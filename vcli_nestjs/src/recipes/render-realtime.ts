import type { ProjectConfig, RenderedFile } from '../contracts.js';
import { bundled, file } from './bundle.js';
import { selection } from './selection.js';

export async function realtimeFiles(
  config: ProjectConfig,
): Promise<RenderedFile[]> {
  const selected = selection(config, 'realtime');
  const socket = selected === 'realtime.socket-io',
    native = selected === 'realtime.native-ws';
  const scale =
    config.capabilities.realtime?.options.scale ?? 'single-instance';
  if (
    !['single-instance', 'cluster'].includes(String(scale)) ||
    (native && scale === 'cluster')
  )
    throw new Error('UNSUPPORTED_REALTIME_SCALE');
  const cluster = scale === 'cluster',
    variant =
      selection(config, 'database') === 'database.mongodb'
        ? 'mongodb'
        : 'postgres';
  const database = variant === 'mongodb' ? 'MongoDatabase' : 'PostgresDatabase';
  const protocol = socket
    ? 'SocketIoService'
    : native
      ? 'NativeWsService'
      : 'CentrifugoConnectionService';
  const paths = [
    'realtime.service.ts',
    'realtime-ticket.service.ts',
    'realtime-records.ts',
    'protocol-validation.ts',
    ...(socket
      ? [
          'socket-io.service.ts',
          ...(cluster ? ['socket-io-cluster.service.ts'] : []),
        ]
      : native
        ? ['native-ws.service.ts']
        : [
            'centrifugo-api.service.ts',
            'centrifugo-connection.service.ts',
            'centrifugo-proxy.controller.ts',
          ]),
  ];
  const files = await Promise.all(
    paths.map((path) => bundled('src/modules/realtime/' + path)),
  );
  files.push(
    ...(await Promise.all(
      [
        'realtime-store.service.ts',
        'initialize-realtime.ts',
        ...(socket && cluster
          ? [
              'configure-socket-io-cluster.ts',
              'initialize-socket-io-cluster.ts',
            ]
          : []),
      ].map((path) => bundled('src/modules/realtime/' + path, variant)),
    )),
  );
  if (socket && cluster) {
    const initializer = files.find(
      (file) => file.path === 'src/modules/realtime/initialize-realtime.ts',
    )!;
    initializer.content =
      "import {initializeSocketIoCluster} from './initialize-socket-io-cluster.js';\n" +
      initializer.content.replace(
        '// Selected adapter schema contribution.',
        'await initializeSocketIoCluster(database);',
      );
  }
  files.push(
    ...(await Promise.all(
      ['event-publisher.ts', 'realtime-store.ts'].map((path) =>
        bundled('src/core/realtime/' + path),
      ),
    )),
  );
  files.push(
    await bundled(
      `clients/${socket ? 'socket-io' : native ? 'native-ws' : 'centrifugo'}.mjs`,
    ),
  );
  if (!socket && !native) {
    const assets = await Promise.all(
      ['config.json', 'compose.yml', 'README.md'].map((path) =>
        bundled('ops/centrifugo/' + path),
      ),
    );
    for (const asset of assets) {
      if (cluster && asset.path.endsWith('config.json')) {
        const config = JSON.parse(asset.content) as Record<string, unknown>;
        config.engine = { type: 'redis', redis: {} };
        asset.content = JSON.stringify(config, null, 2) + '\n';
      }
      if (cluster && asset.path.endsWith('compose.yml'))
        asset.content = asset.content.replace(
          '    ports:',
          '      CENTRIFUGO_ENGINE_REDIS_ADDRESS: ${CENTRIFUGO_ENGINE_REDIS_ADDRESS:?Set the shared private Redis engine address}\n    ports:',
        );
      files.push(asset);
    }
    files.push(
      file(
        'ops/centrifugo/service-requirements.json',
        JSON.stringify(
          {
            schema: 1,
            service: 'centrifugo',
            image: 'centrifugo/centrifugo:v6.10.3',
            scale,
            engine: cluster ? 'redis' : 'memory',
            dependencies: cluster
              ? [
                  {
                    service: 'redis',
                    minimumVersion: '6.2.0',
                    external: true,
                    private: true,
                    env: 'CENTRIFUGO_ENGINE_REDIS_ADDRESS',
                  },
                ]
              : [],
            endpoints: {
              public: {
                port: 8000,
                path: '/connection/websocket',
                protocol: 'websocket',
              },
              private: { port: 9000, api: '/api', health: '/health' },
              callbacks: [
                '/api/realtime/centrifugo/connect',
                '/api/realtime/centrifugo/refresh',
              ],
            },
            callbackHeaders: ['X-Centrifugo-Proxy-Secret'],
            forwardClientHeaders: false,
            sharedAuthority: 'selected-native-database',
            recovery: 'REST',
            presence: false,
            replay: false,
          },
          null,
          2,
        ) + '\n',
      ),
    );
  }
  files.push(
    file(
      'src/modules/realtime/realtime.controller.ts',
      `import {Controller,Get,Inject,UseGuards${socket ? '' : ',Header,Post'}} from '@nestjs/common';
import type {AppConfig} from '../../core/config/app-config.js';
import {PrincipalGuard} from '../../core/http/principal.guard.js';
${
  socket
    ? ''
    : `import {CurrentPrincipal} from '../../core/http/current-principal.decorator.js';
import type {Principal} from '../../core/auth/principal.js';
import {RealtimeTicketService} from './realtime-ticket.service.js';`
}
export const REALTIME_CONFIG=Symbol('RealtimeConfig');
@Controller('realtime') @UseGuards(PrincipalGuard)
export class RealtimeController {
constructor(@Inject(REALTIME_CONFIG) private readonly config:AppConfig${socket ? '' : ',private readonly tickets:RealtimeTicketService'}){}
@Get('profile') profile():unknown{return {driver:this.config.realtime.driver,path:this.config.realtime.path,scale:'${scale}',transport:'websocket',recovery:'Read authoritative owner REST state after admission/reconnect or any missed hint',maxPayloadBytes:this.config.realtime.maxPayloadBytes};}
${socket ? '' : `@Post('${native ? 'tickets' : 'centrifugo-grants'}') @Header('Cache-Control','no-store') grant(@CurrentPrincipal() principal:Principal):Promise<unknown>{return this.tickets.issue(principal,'${native ? 'ws' : 'centrifugo'}');}`}
}
`,
      'scaffold',
    ),
  );
  files.push(
    file(
      'src/modules/realtime/realtime.module.ts',
      `import {Module,type DynamicModule} from '@nestjs/common';
import type {Server} from 'node:http';
import type {AppConfig} from '../../core/config/app-config.js';
import type {${database}} from '../../core/database/${variant === 'mongodb' ? 'mongo' : 'postgres'}-database.js';
import type {PrincipalAuthority} from '../../core/auth/principal-authority.js';
import {HttpSecurityModule} from '../../core/http/http-security.module.js';
import {DIAGNOSTIC_EVENTS,type DiagnosticEvents} from '../../core/diagnostics/diagnostic-events.js';
import {RealtimeController,REALTIME_CONFIG} from './realtime.controller.js';
import {RealtimeService} from './realtime.service.js';
import {RealtimeTicketService} from './realtime-ticket.service.js';
import {RealtimeStoreService} from './realtime-store.service.js';
import {${protocol}} from './${socket ? 'socket-io' : native ? 'native-ws' : 'centrifugo-connection'}.service.js';
${
  socket && cluster
    ? `import {SocketIoClusterService} from './socket-io-cluster.service.js';
import {configureSocketIoCluster} from './configure-socket-io-cluster.js';`
    : ''
}
${
  socket || native
    ? ''
    : `import {CentrifugoApiService} from './centrifugo-api.service.js';
import {CentrifugoProxyController} from './centrifugo-proxy.controller.js';`
}
@Module({})
export class RealtimeModule {}
export async function createRealtimeRuntime(config:AppConfig,authority:PrincipalAuthority,events:DiagnosticEvents,database:${database}){
const store=new RealtimeStoreService(database);
await store.assertInitialized();
${socket || native ? '' : 'const api=new CentrifugoApiService(config.realtime.centrifugoApiUrl,config.realtime.centrifugoApiKey);'}
const tickets=new RealtimeTicketService(authority,config.realtime.ticketTtlSeconds,store);
const realtime=new RealtimeService(authority,events,'${socket ? 'socketio' : native ? 'ws' : 'centrifugo'}',config.realtime.maxPayloadBytes);
${socket && cluster ? 'const cluster=new SocketIoClusterService(store,io=>configureSocketIoCluster(io,database),config.realtime.maxPayloadBytes);' : ''}
let protocol:${protocol};
try{${
        socket
          ? `protocol=new SocketIoService(config,authority,realtime${cluster ? ',cluster' : ''});`
          : native
            ? 'protocol=new NativeWsService(config,authority,tickets,realtime);'
            : `protocol=new CentrifugoConnectionService(authority,tickets,store,api,config.realtime.centrifugoProxySecret);
realtime.setPublisher((accountId,event)=>protocol.publish(accountId,event));`
      }}
catch(error){realtime.close();tickets.close();${socket || native ? '' : 'api.close();'}throw error;}
const module:DynamicModule={module:RealtimeModule,imports:[HttpSecurityModule.register(authority)],controllers:[RealtimeController${socket || native ? '' : ',CentrifugoProxyController'}],providers:[{provide:REALTIME_CONFIG,useValue:config},{provide:DIAGNOSTIC_EVENTS,useValue:events},{provide:RealtimeService,useValue:realtime},{provide:RealtimeTicketService,useValue:tickets},{provide:RealtimeStoreService,useValue:store},{provide:${protocol},useValue:protocol}${socket && cluster ? ',{provide:SocketIoClusterService,useValue:cluster}' : ''}${socket || native ? '' : ',{provide:CentrifugoApiService,useValue:api}'}],exports:[RealtimeService,${protocol}]};
let attached=false,closing:Promise<void>|undefined;
return {module,publisher:realtime,async attach(server:Server){if(attached||closing)throw new Error('REALTIME_ALREADY_ATTACHED_OR_CLOSED');attached=true;await protocol.attach(server);},close(){return closing??=(async()=>{realtime.close();tickets.close();await protocol.close();})();}};
}
`,
    ),
  );
  return files;
}
