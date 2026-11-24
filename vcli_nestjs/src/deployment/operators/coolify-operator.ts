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
  assertReplacement,
  fail,
  identifier,
  keySchema,
  list,
  operationMarker,
  record,
  same,
  snapshot,
  technical,
} from './validation.js';

/** Coolify 4.7.5 Git Compose, fixed source commit, root base directory, existing standalone destination. */
export class CoolifyOperator implements NativeDriver {
  private readonly http: NativeHttp;
  constructor(
    private readonly profile: TargetProfile,
    options: OperatorOptions = {},
  ) {
    this.http = new NativeHttp(profile, options);
  }
  private appPath(id: string): string {
    return '/api/v1/applications/' + encodeURIComponent(id);
  }
  private async envKeys(id: string): Promise<string[]> {
    const rows = list(await this.http.request(this.appPath(id) + '/envs'))
      .map(record)
      .filter((r) => r.is_preview !== true);
    const keys = rows.map((r) => {
      if (!keySchema.safeParse(r.key).success)
        fail('INVALID_NATIVE_ENVIRONMENT_KEY');
      return String(r.key);
    });
    if (new Set(keys).size !== keys.length)
      fail('AMBIGUOUS_PRIVATE_ENVIRONMENT');
    return keys.sort();
  }
  async discover(): Promise<DeploymentSnapshot> {
    const scope = this.profile.scope;
    if (
      (await this.http.request('/api/v1/version', 'GET', undefined, true)) !==
      this.profile.targetVersion
    )
      fail('UNSUPPORTED_TARGET_VERSION');
    const team = record(await this.http.request('/api/v1/team'));
    if (String(team.id) !== scope.namespace) fail('DEPLOYMENT_SCOPE_MISMATCH');
    const project = record(
      await this.http.request(
        '/api/v1/projects/' + encodeURIComponent(scope.projectId),
      ),
    );
    if (project.uuid !== scope.projectId) fail('DEPLOYMENT_SCOPE_MISMATCH');
    const environment = record(
      await this.http.request(
        '/api/v1/projects/' +
          encodeURIComponent(scope.projectId) +
          '/environments/' +
          encodeURIComponent(scope.environmentId),
      ),
    );
    if (environment.uuid !== scope.environmentId)
      fail('DEPLOYMENT_SCOPE_MISMATCH');
    const destinations = list(
      await this.http.request(
        '/api/v1/servers/' +
          encodeURIComponent(scope.serverId) +
          '/destinations',
      ),
    ).map(record);
    if (
      !destinations.some(
        (d) =>
          d.uuid === scope.destinationId &&
          d.server_uuid === scope.serverId &&
          d.type === 'standalone',
      )
    )
      fail('UNSUPPORTED_NATIVE_DESTINATION');
    const candidates = list(environment.applications)
      .map(record)
      .filter((r) => r.name === scope.appName || r.uuid === scope.resourceId);
    if (candidates.length > 1) fail('AMBIGUOUS_RESOURCE_DISCOVERY');
    const resources: ResourceSnapshot[] = [];
    for (const candidate of candidates) {
      const id = identifier(candidate.uuid);
      const app = record(await this.http.request(this.appPath(id)));
      if (app.uuid !== id || app.name !== scope.appName)
        fail('DEPLOYMENT_SCOPE_MISMATCH');
      const appDestinations = list(
        await this.http.request(this.appPath(id) + '/destinations'),
      ).map(record);
      if (
        appDestinations.length !== 1 ||
        appDestinations[0]?.uuid !== scope.destinationId ||
        appDestinations[0]?.server_uuid !== scope.serverId ||
        appDestinations[0]?.is_primary !== true
      )
        fail('UNSUPPORTED_NATIVE_DESTINATION');
      this.assertNoHooks(app);
      const settings = record(app.settings);
      const storage = record(
        await this.http.request(this.appPath(id) + '/storages'),
      );
      if (list(storage.file_storages).length)
        fail('UNREVIEWED_NATIVE_FILE_MOUNT');
      const volumeBindings = list(storage.persistent_storages)
        .map(record)
        .map((v) => {
          if (
            v.host_path ||
            typeof v.mount_path !== 'string' ||
            !['/app/var/storage', '/app/var/evidence'].includes(v.mount_path)
          )
            fail('UNREVIEWED_NATIVE_VOLUME');
          return {
            resourceRef: identifier(v.name),
            containerPath: v.mount_path,
            nativeId: identifier(v.uuid),
          };
        });
      resources.push({
        id,
        name: scope.appName,
        operationId: operationMarker(app.description),
        environmentKeys: await this.envKeys(id),
        settings: {
          ...technical(app, [
            'git_repository',
            'git_branch',
            'git_commit_sha',
            'build_pack',
            'base_directory',
            'docker_compose_location',
            'ports_exposes',
            'health_check_enabled',
            'health_check_path',
            'health_check_port',
            'limits_memory',
            'limits_cpus',
          ]),
          domains: this.domains(app.docker_compose_domains),
          volumeBindings,
          ...technical(settings, [
            'is_auto_deploy_enabled',
            'is_preview_deployments_enabled',
            'is_force_https_enabled',
            'inject_build_args_to_dockerfile',
            'redact_all_env_values_in_logs',
            'include_coolify_default_variables',
          ]),
        },
      });
    }
    return snapshot(this.profile, resources);
  }
  private assertNoHooks(app: Record<string, unknown>): void {
    // These read:sensitive fields must be visible; hidden configuration cannot be reviewed safely.
    for (const key of [
      'pre_deployment_command',
      'post_deployment_command',
      'docker_compose_custom_start_command',
      'docker_compose_custom_build_command',
    ]) {
      if (!Object.hasOwn(app, key))
        fail('NATIVE_CONFIGURATION_VISIBILITY_REQUIRED');
      if (app[key] !== null && app[key] !== '')
        fail('UNREVIEWED_NATIVE_EXECUTION_HOOK');
    }
  }
  private domains(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 4096)
      fail('UNSUPPORTED_NATIVE_DOMAINS');
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      fail('UNSUPPORTED_NATIVE_DOMAINS');
    }
    const entries = record(parsed);
    const normalized: Record<string, { domain: string }> = {};
    for (const [key, raw] of Object.entries(entries)) {
      if (key !== 'api') fail('UNSUPPORTED_NATIVE_DOMAINS');
      const row = record(raw);
      if (
        typeof row.domain !== 'string' ||
        !/^https:\/\/[a-z0-9.-]+:3100$/.test(row.domain)
      )
        fail('UNSUPPORTED_NATIVE_DOMAINS');
      normalized[key] = { domain: row.domain };
    }
    return JSON.stringify(normalized);
  }
  private configuration(plan: DeploymentPlan): Record<string, unknown> {
    return {
      name: this.profile.scope.appName,
      description: 'vcli-operation:' + plan.release.operationId,
      git_repository: plan.release.source!.repository,
      git_branch: plan.release.source!.branch,
      git_commit_sha: plan.release.sourceCommit,
      build_pack: 'dockercompose',
      base_directory: '/',
      docker_compose_location: '/ops/deploy/coolify/compose.yaml',
      docker_compose_domains: [
        {
          name: 'api',
          domain: new URL(plan.release.readinessUrl).origin + ':3100',
        },
      ],
      ports_exposes: '3100',
      is_auto_deploy_enabled: false,
      is_preview_deployments_enabled: false,
      is_force_https_enabled: true,
      health_check_enabled: true,
      health_check_path: '/health/ready',
      health_check_port: '3100',
      limits_memory: '512m',
      limits_cpus: '1',
      instant_deploy: false,
      inject_build_args_to_dockerfile: false,
      redact_all_env_values_in_logs: true,
      include_coolify_default_variables: false,
    };
  }
  async mutate(
    step: DeploymentStep,
    plan: DeploymentPlan,
    id?: string,
  ): Promise<void> {
    const scope = this.profile.scope;
    if (step === 'create') {
      await this.http.request('/api/v1/applications/public', 'POST', {
        ...this.configuration(plan),
        project_uuid: scope.projectId,
        environment_uuid: scope.environmentId,
        server_uuid: scope.serverId,
        destination_uuid: scope.destinationId,
      });
      return;
    }
    if (!id) fail('EXPECTED_RESOURCE_MISSING');
    if (step === 'configure') {
      await this.http.request(
        this.appPath(id),
        'PATCH',
        this.configuration(plan),
      );
      return;
    }
    if (step === 'environment') {
      assertReplacement(this.profile, await this.envKeys(id));
      await this.http.request(this.appPath(id) + '/envs/bulk', 'PATCH', {
        data: Object.entries(this.profile.environment)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => ({
            key,
            value,
            is_preview: false,
            is_literal: true,
            is_shown_once: true,
            is_runtime: true,
            is_buildtime: false,
          })),
      });
      return;
    }
    if (step === 'deploy') {
      const receipt = record(
        await this.http.request(this.appPath(id) + '/start', 'POST', {
          force: false,
          instant_deploy: true,
        }),
      );
      identifier(receipt.deployment_uuid);
      return;
    }
    fail('UNSUPPORTED_NATIVE_OPERATION');
  }
  async verify(plan: DeploymentPlan, id: string): Promise<void> {
    const app = record(await this.http.request(this.appPath(id)));
    this.assertNoHooks(app);
    const expected = plan.release.source!.repository;
    const url = new URL(expected);
    const repository =
      url.hostname === 'github.com' ? url.pathname.slice(1) : expected;
    if (
      app.git_commit_sha !== plan.release.sourceCommit ||
      app.git_repository !== repository ||
      app.git_branch !== plan.release.source!.branch ||
      app.build_pack !== 'dockercompose' ||
      app.base_directory !== '/' ||
      app.docker_compose_location !== '/ops/deploy/coolify/compose.yaml' ||
      typeof app.status !== 'string' ||
      !app.status.startsWith('running')
    )
      fail('NATIVE_RELEASE_IDENTITY_MISMATCH');
    const domains = this.domains(app.docker_compose_domains);
    if (
      domains !==
      JSON.stringify({
        api: { domain: new URL(plan.release.readinessUrl).origin + ':3100' },
      })
    )
      fail('NATIVE_DOMAIN_SETTINGS_MISMATCH');
    const current = await this.discover();
    const bindings = current.resources[0]?.settings.volumeBindings as {
      resourceRef: string;
      containerPath: string;
    }[];
    for (const v of plan.services.volumes)
      if (
        !bindings.some(
          (b) =>
            b.resourceRef === v.resourceRef &&
            b.containerPath === v.containerPath,
        )
      )
        fail('DURABLE_VOLUME_IDENTITY_MISMATCH');
    const history = record(
      await this.http.request(
        '/api/v1/deployments/applications/' +
          encodeURIComponent(id) +
          '?take=1&skip=0',
      ),
    );
    const latest = record(list(history.deployments)[0]);
    if (
      latest.commit !== plan.release.sourceCommit ||
      latest.status !== 'finished' ||
      !same(Number(latest.pull_request_id ?? 0), 0)
    )
      fail('NATIVE_RELEASE_IDENTITY_MISMATCH');
  }
}
