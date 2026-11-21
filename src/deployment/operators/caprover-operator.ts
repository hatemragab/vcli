import type {
  DeploymentPlan,
  DeploymentSnapshot,
  DeploymentStep,
  Json,
  NativeDriver,
  OperatorOptions,
  ResourceSnapshot,
  TargetProfile,
} from './types.js';
import { NativeHttp } from './native-http.js';
import {
  assertReplacement,
  environmentRows,
  fail,
  identifier,
  list,
  operationMarker,
  record,
  same,
  snapshot,
  technical,
} from './validation.js';

const base = '/api/v2/user/apps/appDefinitions/';
/** CapRover 1.16.0 native app settings, schema2 image deploy; dependencies remain preprovisioned. */
export class CaproverOperator implements NativeDriver {
  private readonly http: NativeHttp;
  constructor(
    private readonly profile: TargetProfile,
    options: OperatorOptions = {},
  ) {
    this.http = new NativeHttp(profile, options);
  }
  private async apps(): Promise<Record<string, unknown>> {
    return record(await this.http.request(base));
  }
  private async one(id: string): Promise<Record<string, unknown>> {
    const matches = list((await this.apps()).appDefinitions)
      .map(record)
      .filter((r) => r.appName === id);
    if (matches.length !== 1) fail('EXPECTED_RESOURCE_MISSING');
    return matches[0]!;
  }
  private checkHooks(app: Record<string, unknown>): void {
    if (app.preDeployFunction !== undefined && app.preDeployFunction !== '')
      fail('UNREVIEWED_NATIVE_EXECUTION_HOOK');
    if (app.serviceUpdateOverride) {
      if (typeof app.serviceUpdateOverride !== 'string')
        fail('UNSUPPORTED_NATIVE_RESOURCE_OVERRIDE');
      let override: unknown;
      try {
        override = JSON.parse(app.serviceUpdateOverride);
      } catch {
        fail('UNSUPPORTED_NATIVE_RESOURCE_OVERRIDE');
      }
      if (!same(override, this.limits()))
        fail('UNSUPPORTED_NATIVE_RESOURCE_OVERRIDE');
    }
  }
  private limits(): Record<string, unknown> {
    return {
      TaskTemplate: {
        Resources: { Limits: { MemoryBytes: 536870912, NanoCPUs: 1000000000 } },
      },
    };
  }
  async discover(): Promise<DeploymentSnapshot> {
    const version = record(
      await this.http.request('/api/v2/user/system/versionInfo/'),
    );
    if (version.currentVersion !== this.profile.targetVersion)
      fail('UNSUPPORTED_TARGET_VERSION');
    const platform = record(
      await this.http.request('/api/v2/user/system/info/'),
    );
    if (platform.hasRootSsl !== true)
      fail('CAPROVER_ROOT_SSL_PRECONDITION_REQUIRED');
    const projects = list(
      record(await this.http.request('/api/v2/user/projects/')).projects,
    ).map(record);
    if (!projects.some((p) => p.id === this.profile.scope.projectId))
      fail('DEPLOYMENT_SCOPE_MISMATCH');
    if (this.profile.scope.nodeId) {
      const nodes = list(
        record(await this.http.request('/api/v2/user/system/nodes/')).nodes,
      ).map(record);
      if (
        !nodes.some(
          (n) =>
            n.nodeId === this.profile.scope.nodeId &&
            n.state === 'ready' &&
            n.status === 'active',
        )
      )
        fail('EXPECTED_NATIVE_NODE_UNAVAILABLE');
    }
    const definitions = await this.apps();
    const candidates = list(definitions.appDefinitions)
      .map(record)
      .filter((a) => a.appName === this.profile.scope.appName);
    if (candidates.length > 1) fail('AMBIGUOUS_RESOURCE_DISCOVERY');
    const resources: ResourceSnapshot[] = [];
    for (const app of candidates) {
      if (app.projectId !== this.profile.scope.projectId)
        fail('DEPLOYMENT_SCOPE_MISMATCH');
      this.checkHooks(app);
      const env = environmentRows(app.envVars);
      if (new Set(env.map((r) => r.key)).size !== env.length)
        fail('AMBIGUOUS_PRIVATE_ENVIRONMENT');
      const volumes = list(app.volumes)
        .map(record)
        .map((v) => {
          if (v.hostPath) fail('UNSUPPORTED_NATIVE_BIND_VOLUME');
          if (
            typeof v.containerPath !== 'string' ||
            !['/app/var/storage', '/app/var/evidence'].includes(v.containerPath)
          )
            fail('UNSUPPORTED_NATIVE_VOLUME');
          return {
            volumeName: identifier(v.volumeName),
            containerPath: v.containerPath,
            mode:
              v.mode === undefined
                ? 'rw'
                : v.mode === 'rw' || v.mode === 'ro'
                  ? v.mode
                  : fail('UNSUPPORTED_NATIVE_VOLUME'),
          };
        });
      const domains = list(app.customDomain)
        .map(record)
        .map((d) => {
          if (
            typeof d.publicDomain !== 'string' ||
            !/^[a-z0-9.-]{1,253}$/.test(d.publicDomain) ||
            typeof d.hasSsl !== 'boolean'
          )
            fail('UNSUPPORTED_NATIVE_DOMAINS');
          return { publicDomain: d.publicDomain, hasSsl: d.hasSsl };
        });
      resources.push({
        id: identifier(app.appName),
        name: this.profile.scope.appName,
        operationId: operationMarker(app.description),
        environmentKeys: env.map((r) => r.key).sort(),
        settings: {
          ...technical(app, [
            'projectId',
            'instanceCount',
            'containerHttpPort',
            'hasPersistentData',
            'notExposeAsWebApp',
            'forceSsl',
            'websocketSupport',
            'nodeId',
            'hasDefaultSubDomainSsl',
          ]),
          volumes,
          domains,
          ports: list(app.ports).map((v) => {
            const p = record(v);
            return {
              hostPort: Number(p.hostPort),
              containerPort: Number(p.containerPort),
            };
          }),
          resourceLimits: app.serviceUpdateOverride ? true : false,
          rootDomain: identifier(definitions.rootDomain),
        },
      });
    }
    return snapshot(this.profile, resources);
  }
  async mutate(
    step: DeploymentStep,
    plan: DeploymentPlan,
    id?: string,
  ): Promise<void> {
    const scope = this.profile.scope;
    if (step === 'create') {
      await this.http.request(base + 'register/', 'POST', {
        appName: scope.appName,
        projectId: scope.projectId,
        hasPersistentData: plan.services.volumes.length > 0,
      });
      return;
    }
    if (!id) fail('EXPECTED_RESOURCE_MISSING');
    if (step === 'configure') {
      const current = await this.one(id);
      this.checkHooks(current);
      if (current.hasPersistentData !== plan.services.volumes.length > 0)
        fail('PERSISTENCE_SETTING_CHANGE_REQUIRES_NEW_PLAN');
      const volumes = plan.services.volumes.map((v) => ({
        containerPath: v.containerPath,
        volumeName: v.resourceRef,
        mode: 'rw',
      }));
      const old = list(current.volumes);
      if (old.length && !same(old, volumes))
        fail('DURABLE_VOLUME_IDENTITY_MISMATCH');
      await this.http.request(base + 'update/', 'PATCH', {
        appName: id,
        description: 'vcli-operation:' + plan.release.operationId,
        containerHttpPort: 3100,
        instanceCount: plan.services.replicas,
        notExposeAsWebApp: false,
        websocketSupport: plan.services.ingress.some(
          (r) => r.service === 'api' && r.websocket,
        ),
        forceSsl: true,
        ports: [],
        volumes,
        nodeId: plan.release.preconditions.nodeId ?? '',
        serviceUpdateOverride: JSON.stringify(this.limits()),
      });
      return;
    }
    if (step === 'environment') {
      const app = await this.one(id);
      const env = environmentRows(app.envVars);
      assertReplacement(
        this.profile,
        env.map((r) => r.key),
      );
      const replacement = Object.entries(this.profile.environment).map(
        ([key, value]) => ({ key, value }),
      );
      await this.http.request(base + 'update/', 'PATCH', {
        appName: id,
        envVars: [
          ...env.filter((r) => !Object.hasOwn(this.profile.environment, r.key)),
          ...replacement,
        ],
      });
      return;
    }
    if (step === 'domain') {
      const defs = await this.apps();
      const host = new URL(plan.release.readinessUrl).hostname;
      if (host === id + '.' + String(defs.rootDomain)) return;
      const app = await this.one(id);
      const matches = list(app.customDomain)
        .map(record)
        .filter((d) => d.publicDomain === host);
      if (matches.length > 1) fail('AMBIGUOUS_DOMAIN_DISCOVERY');
      if (matches.length) return;
      await this.http.request(base + 'customdomain/', 'POST', {
        appName: id,
        customDomain: host,
      });
      return;
    }
    if (step === 'ssl') {
      const defs = await this.apps();
      const host = new URL(plan.release.readinessUrl).hostname;
      const app = await this.one(id);
      if (host === id + '.' + String(defs.rootDomain)) {
        if (app.hasDefaultSubDomainSsl !== true)
          await this.http.request(base + 'enablebasedomainssl/', 'POST', {
            appName: id,
          });
      } else {
        const d = list(app.customDomain)
          .map(record)
          .find((d) => d.publicDomain === host);
        if (!d) fail('EXPECTED_DOMAIN_MISSING');
        if (d.hasSsl !== true)
          await this.http.request(base + 'enablecustomdomainssl/', 'POST', {
            appName: id,
            customDomain: host,
          });
      }
      return;
    }
    if (step === 'deploy') {
      await this.http.request(
        '/api/v2/user/apps/appData/' + encodeURIComponent(id) + '/',
        'POST',
        {
          captainDefinitionContent: JSON.stringify({
            schemaVersion: 2,
            imageName: plan.release.image,
          }),
          gitHash: plan.release.sourceCommit,
        },
      );
      return;
    }
    fail('UNSUPPORTED_NATIVE_OPERATION');
  }
  async verify(plan: DeploymentPlan, id: string): Promise<void> {
    const app = await this.one(id);
    this.checkHooks(app);
    const version = list(app.versions)
      .map(record)
      .find((v) => v.version === app.deployedVersion);
    if (
      !version ||
      version.deployedImageName !== plan.release.image ||
      version.gitHash !== plan.release.sourceCommit ||
      app.isAppBuilding !== false ||
      app.containerHttpPort !== 3100 ||
      app.instanceCount !== plan.services.replicas ||
      app.forceSsl !== true
    )
      fail('NATIVE_RELEASE_IDENTITY_MISMATCH');
    const defs = await this.apps();
    const host = new URL(plan.release.readinessUrl).hostname;
    if (host === id + '.' + String(defs.rootDomain)) {
      if (app.hasDefaultSubDomainSsl !== true)
        fail('NATIVE_DOMAIN_SETTINGS_MISMATCH');
    } else if (
      !list(app.customDomain)
        .map(record)
        .some((d) => d.publicDomain === host && d.hasSsl === true)
    )
      fail('NATIVE_DOMAIN_SETTINGS_MISMATCH');
    const expected: Json[] = plan.services.volumes.map((v) => ({
      containerPath: v.containerPath,
      volumeName: v.resourceRef,
      mode: 'rw',
    }));
    if (!same(app.volumes, expected)) fail('DURABLE_VOLUME_IDENTITY_MISMATCH');
  }
}
