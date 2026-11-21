import type {
  DeploymentPlan,
  DeploymentSnapshot,
  DeploymentStep,
  NativeDriver,
  OperatorOptions,
  ResourceSnapshot,
  TargetProfile,
} from './types.js';
import { NativeHttp } from './native-http.js';
import {
  composeFingerprint,
  imageCompose,
  composeVolumeBindings,
} from './compose.js';
import {
  assertReplacement,
  environmentLines,
  fail,
  identifier,
  list,
  operationMarker,
  record,
  same,
  snapshot,
  technical,
} from './validation.js';

/** Dokploy 0.31.3 raw, standard Compose with an immutable prebuilt API image. Never Stack. */
export class DokployOperator implements NativeDriver {
  private readonly http: NativeHttp;
  constructor(
    private readonly profile: TargetProfile,
    options: OperatorOptions = {},
  ) {
    this.http = new NativeHttp(profile, options);
  }
  async discover(): Promise<DeploymentSnapshot> {
    const p = this.profile;
    const scope = p.scope;
    if ((await this.http.get('settings.getDokployVersion')) !== p.targetVersion)
      fail('UNSUPPORTED_TARGET_VERSION');
    const session = record(await this.http.get('user.session'));
    if (record(session.session).activeOrganizationId !== scope.namespace)
      fail('DEPLOYMENT_SCOPE_MISMATCH');
    const permissions = record(await this.http.get('user.getPermissions'));
    for (const [resource, action] of [
      ['service', 'create'],
      ['service', 'read'],
      ['deployment', 'create'],
      ['envVars', 'write'],
      ['domain', 'create'],
      ['domain', 'read'],
      ['server', 'read'],
      ['docker', 'read'],
    ])
      if (record(permissions[resource!])[action!] !== true)
        fail('DEPLOYMENT_AUTHORITY_DENIED');
    const project = record(
      await this.http.get('project.one', { projectId: scope.projectId }),
    );
    const environment = record(
      await this.http.get('environment.one', {
        environmentId: scope.environmentId,
      }),
    );
    const server = record(
      await this.http.get('server.one', { serverId: scope.serverId }),
    );
    if (
      project.projectId !== scope.projectId ||
      project.organizationId !== scope.namespace ||
      environment.environmentId !== scope.environmentId ||
      environment.projectId !== scope.projectId ||
      server.serverId !== scope.serverId ||
      server.organizationId !== scope.namespace
    )
      fail('DEPLOYMENT_SCOPE_MISMATCH');
    const candidates = list(environment.compose)
      .map(record)
      .filter(
        (r) => r.name === scope.appName || r.composeId === scope.resourceId,
      );
    if (candidates.length > 1) fail('AMBIGUOUS_RESOURCE_DISCOVERY');
    const resources: ResourceSnapshot[] = [];
    for (const c of candidates) {
      const id = identifier(c.composeId);
      const raw = record(await this.http.get('compose.one', { composeId: id }));
      if (
        raw.environmentId !== scope.environmentId ||
        raw.serverId !== scope.serverId ||
        raw.name !== scope.appName ||
        raw.composeId !== id
      )
        fail('DEPLOYMENT_SCOPE_MISMATCH');
      const domains = list(
        await this.http.get('domain.byComposeId', { composeId: id }),
      )
        .map(record)
        .map((d) => ({
          id: identifier(d.domainId),
          ...technical(d, [
            'host',
            'port',
            'path',
            'https',
            'serviceName',
            'certificateType',
            'enabled',
            'domainType',
          ]),
        }));
      resources.push({
        id,
        name: scope.appName,
        operationId: operationMarker(raw.description),
        settings: {
          ...technical(raw, [
            'appName',
            'sourceType',
            'composeType',
            'composePath',
            'autoDeploy',
          ]),
          composeFingerprint: composeFingerprint(raw.composeFile),
          volumeBindings: composeVolumeBindings(raw.composeFile),
          domains,
        },
        environmentKeys: environmentLines(raw.env).keys,
      });
    }
    return snapshot(p, resources);
  }
  private async one(id: string): Promise<Record<string, unknown>> {
    return record(await this.http.get('compose.one', { composeId: id }));
  }
  async mutate(
    step: DeploymentStep,
    plan: DeploymentPlan,
    resourceId?: string,
  ): Promise<void> {
    const scope = this.profile.scope;
    if (step === 'create') {
      await this.http.post('compose.create', {
        name: scope.appName,
        appName: scope.appName,
        description: 'vcli-operation:' + plan.release.operationId,
        environmentId: scope.environmentId,
        serverId: scope.serverId,
        sourceType: 'raw',
        composeType: 'docker-compose',
        composeFile: JSON.stringify(imageCompose(plan)),
      });
      return;
    }
    if (!resourceId) fail('EXPECTED_RESOURCE_MISSING');
    if (step === 'configure') {
      await this.http.post('compose.update', {
        composeId: resourceId,
        sourceType: 'raw',
        composeType: 'docker-compose',
        composePath: 'docker-compose.yml',
        autoDeploy: false,
        description: 'vcli-operation:' + plan.release.operationId,
        composeFile: JSON.stringify(imageCompose(plan)),
      });
      return;
    }
    if (step === 'environment') {
      const raw = await this.one(resourceId);
      const current = environmentLines(raw.env);
      assertReplacement(this.profile, current.keys);
      const keys = Object.keys(this.profile.environment);
      const lines = current.lines.filter(
        (line) => !keys.some((key) => line.startsWith(key + '=')),
      );
      for (const key of keys.sort()) {
        const value = this.profile.environment[key]!;
        // Docker dotenv single quotes preserve literal dollar characters. Ambiguous quote/newline input needs native manual setup.
        if (/[\r\n'\\\0]/.test(value))
          fail('DOKPLOY_ENVIRONMENT_REQUIRES_MANUAL_SETUP');
        lines.push(key + "='" + value + "'");
      }
      await this.http.post('compose.saveEnvironment', {
        composeId: resourceId,
        env: lines.join('\n'),
        createEnvFile: true,
      });
      return;
    }
    if (step === 'domain') {
      const domains = list(
        await this.http.get('domain.byComposeId', { composeId: resourceId }),
      ).map(record);
      const host = new URL(plan.release.readinessUrl).hostname;
      const matches = domains.filter((d) => d.host === host);
      if (matches.length > 1) fail('AMBIGUOUS_DOMAIN_DISCOVERY');
      if (matches.length) {
        if (!this.domainMatches(matches[0]!, host))
          fail('NATIVE_DOMAIN_SETTINGS_MISMATCH');
        return;
      }
      await this.http.post('domain.create', {
        composeId: resourceId,
        host,
        https: true,
        port: 3100,
        path: '/',
        serviceName: 'api',
        certificateType: 'letsencrypt',
        domainType: 'compose',
        stripPath: false,
        internalPath: '/',
      });
      return;
    }
    if (step === 'deploy') {
      await this.http.post('compose.deploy', {
        composeId: resourceId,
        title: 'vcli-operation:' + plan.release.operationId,
        freshVolumes: false,
      });
      return;
    }
    fail('UNSUPPORTED_NATIVE_OPERATION');
  }
  private domainMatches(d: Record<string, unknown>, host: string): boolean {
    return (
      d.host === host &&
      d.https === true &&
      d.port === 3100 &&
      d.path === '/' &&
      d.serviceName === 'api' &&
      d.certificateType === 'letsencrypt' &&
      d.enabled !== false
    );
  }
  async verify(plan: DeploymentPlan, id: string): Promise<void> {
    const raw = await this.one(id);
    if (
      raw.sourceType !== 'raw' ||
      raw.composeType !== 'docker-compose' ||
      raw.autoDeploy !== false ||
      raw.composeStatus !== 'done' ||
      composeFingerprint(raw.composeFile) !==
        composeFingerprint(JSON.stringify(imageCompose(plan)))
    )
      fail('NATIVE_RELEASE_IDENTITY_MISMATCH');
    const domains = list(
      await this.http.get('domain.byComposeId', { composeId: id }),
    ).map(record);
    if (
      !domains.some((d) =>
        this.domainMatches(d, new URL(plan.release.readinessUrl).hostname),
      )
    )
      fail('NATIVE_DOMAIN_SETTINGS_MISMATCH');
    const appName = identifier(raw.appName);
    const containers = list(
      await this.http.get('docker.getContainersByAppNameMatch', {
        appName,
        appType: 'docker-compose',
        serverId: this.profile.scope.serverId,
      }),
    ).map(record);
    if (containers.length > 32) fail('NATIVE_CONTAINER_INSPECTION_LIMIT');
    let apiCount = 0;
    // Serial bounded inspection avoids target overload and never retains raw Config.Env.
    for (const container of containers) {
      const config = record(
        await this.http.get('docker.getConfig', {
          containerId: identifier(container.containerId),
          serverId: this.profile.scope.serverId,
        }),
      );
      const options = record(config.Config);
      const labels = record(options.Labels);
      if (labels['com.docker.compose.project'] !== appName)
        fail('DEPLOYMENT_SCOPE_MISMATCH');
      if (labels['com.docker.compose.service'] !== 'api') continue;
      apiCount++;
      if (
        options.Image !== plan.release.image ||
        labels['io.vcli.source-commit'] !== plan.release.sourceCommit ||
        record(config.State).Running !== true
      )
        fail('NATIVE_RELEASE_IDENTITY_MISMATCH');
      const mounts = list(config.Mounts).map(record);
      for (const volume of plan.services.volumes)
        if (
          !mounts.some(
            (m) =>
              m.Name === volume.resourceRef &&
              m.Destination === volume.containerPath,
          )
        )
          fail('DURABLE_VOLUME_IDENTITY_MISMATCH');
    }
    if (!same(apiCount, plan.services.replicas))
      fail('NATIVE_REPLICA_COUNT_MISMATCH');
  }
}
