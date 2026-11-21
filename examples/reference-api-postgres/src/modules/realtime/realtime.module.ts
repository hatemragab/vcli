import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import type { Server } from 'node:http';
import type { AppConfig } from '../../core/config/app-config.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import { HttpSecurityModule } from '../../core/http/http-security.module.js';
import {
  DIAGNOSTIC_EVENTS,
  type DiagnosticEvents,
} from '../../core/diagnostics/diagnostic-events.js';
import { CentrifugoApiService } from './centrifugo-api.service.js';
import { CentrifugoConnectionService } from './centrifugo-connection.service.js';
import { CentrifugoProxyController } from './centrifugo-proxy.controller.js';
import { NativeWsService } from './native-ws.service.js';
import { RealtimeController, REALTIME_CONFIG } from './realtime.controller.js';
import { RealtimeService } from './realtime.service.js';
import { RealtimeTicketService } from './realtime-ticket.service.js';
import { SocketIoService } from './socket-io.service.js';

export type OperationsRuntime = Readonly<{
  module: DynamicModule;
  publisher: RealtimeService;
  attach(server: Server): Promise<void>;
  close(): Promise<void>;
}>;

@Module({})
export class RealtimeModule {
  /** Prepare explicit handles before Nest starts, and register those same instances. */
  static async register(
    config: AppConfig,
    authority: PrincipalAuthority,
    events: DiagnosticEvents,
  ): Promise<OperationsRuntime> {
    if (!/^\/[a-zA-Z0-9/_-]+$/.test(config.realtime.path))
      throw new Error('INVALID_REALTIME_PATH');
    const centrifugo = centrifugoSettings(config.realtime);
    const realtime = new RealtimeService(
      authority,
      events,
      config.realtime.driver,
      config.realtime.maxPayloadBytes,
    );
    const tickets = new RealtimeTicketService(
      authority,
      config.realtime.ticketTtlSeconds,
    );
    let protocol:
      SocketIoService | NativeWsService | CentrifugoConnectionService;
    const protocolProviders: Provider[] = [];
    try {
      if (config.realtime.driver === 'socketio') {
        protocol = new SocketIoService(config, authority, realtime);
        protocolProviders.push({
          provide: SocketIoService,
          useValue: protocol,
        });
      } else if (config.realtime.driver === 'ws') {
        protocol = new NativeWsService(config, authority, tickets, realtime);
        protocolProviders.push({
          provide: NativeWsService,
          useValue: protocol,
        });
      } else if (centrifugo) {
        const api = new CentrifugoApiService(
          centrifugo.apiUrl,
          centrifugo.apiKey,
        );
        protocol = new CentrifugoConnectionService(
          authority,
          tickets,
          realtime,
          api,
          centrifugo.proxySecret,
        );
        protocolProviders.push(
          { provide: CentrifugoApiService, useValue: api },
          { provide: CentrifugoConnectionService, useValue: protocol },
        );
      } else throw new Error('UNSUPPORTED_REALTIME_PROFILE');
    } catch (error) {
      realtime.close();
      tickets.close();
      throw error;
    }

    const module: DynamicModule = {
      module: RealtimeModule,
      imports: [HttpSecurityModule.register(authority)],
      controllers: [
        RealtimeController,
        ...(centrifugo ? [CentrifugoProxyController] : []),
      ],
      providers: [
        { provide: REALTIME_CONFIG, useValue: config },
        { provide: DIAGNOSTIC_EVENTS, useValue: events },
        { provide: RealtimeService, useValue: realtime },
        { provide: RealtimeTicketService, useValue: tickets },
        ...protocolProviders,
      ],
      exports: [RealtimeService],
    };
    let attached = false;
    let closing: Promise<void> | undefined;
    return {
      module,
      publisher: realtime,
      async attach(server) {
        if (attached || closing)
          throw new Error('REALTIME_ALREADY_ATTACHED_OR_CLOSED');
        attached = true;
        await protocol.attach(server);
      },
      close() {
        return (closing ??= (async () => {
          realtime.close();
          tickets.close();
          await protocol.close();
        })());
      },
    };
  }
}

/** Root integration keeps the same explicit attach/close lifecycle. */
export function createOperationsRuntime(
  config: AppConfig,
  authority: PrincipalAuthority,
  events: DiagnosticEvents,
): Promise<OperationsRuntime> {
  return RealtimeModule.register(config, authority, events);
}

function centrifugoSettings(
  config: AppConfig['realtime'],
):
  | Readonly<{ apiUrl: string; apiKey: string; proxySecret: string }>
  | undefined {
  if (config.driver !== 'centrifugo') return undefined;
  const {
    centrifugoApiUrl: apiUrl,
    centrifugoApiKey: apiKey,
    centrifugoProxySecret: proxySecret,
  } = config;
  if (
    !apiUrl ||
    !apiKey ||
    !proxySecret ||
    proxySecret.length < 32 ||
    apiKey === proxySecret
  )
    throw new Error('INVALID_CENTRIFUGO_CONFIG');
  const url = new URL(apiUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('INVALID_CENTRIFUGO_API_URL');
  return { apiUrl, apiKey, proxySecret };
}
