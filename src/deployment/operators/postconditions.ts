import type {
  DeploymentPlan,
  DeploymentSnapshot,
  DeploymentStep,
  Json,
} from './types.js';
import { composeFingerprint, imageCompose } from './compose.js';
import { fail, same } from './validation.js';

/** Native acknowledgement alone is insufficient; compare the managed nonsecret result. */
export function assertMutationResult(
  step: DeploymentStep,
  plan: DeploymentPlan,
  before: DeploymentSnapshot,
  after: DeploymentSnapshot,
): void {
  if (step === 'create' || step === 'deploy') return;
  const current = after.resources[0];
  if (!current) fail('EXPECTED_RESOURCE_MISSING');
  const s = current.settings;
  if (step === 'environment') {
    const expected = [
      ...new Set([
        ...(before.resources[0]?.environmentKeys ?? []),
        ...plan.release.managedEnvironmentKeys,
      ]),
    ].sort();
    if (!same(current.environmentKeys, expected))
      fail('NATIVE_ENVIRONMENT_KEYS_MISMATCH');
    return;
  }
  const hostname = new URL(plan.release.readinessUrl).hostname;
  if (step === 'domain') {
    if (plan.services.target === 'dokploy') {
      const domains = s.domains as { [key: string]: Json }[];
      if (
        !domains.some(
          (d) =>
            d.host === hostname &&
            d.port === 3100 &&
            d.https === true &&
            d.path === '/' &&
            d.serviceName === 'api',
        )
      )
        fail('NATIVE_DOMAIN_SETTINGS_MISMATCH');
    } else if (
      hostname !== current.id + '.' + s.rootDomain &&
      !(s.domains as { [key: string]: Json }[]).some(
        (d) => d.publicDomain === hostname,
      )
    )
      fail('NATIVE_DOMAIN_SETTINGS_MISMATCH');
    return;
  }
  if (step === 'ssl') {
    if (hostname === current.id + '.' + s.rootDomain) {
      if (s.hasDefaultSubDomainSsl !== true)
        fail('NATIVE_DOMAIN_SETTINGS_MISMATCH');
    } else if (
      !(s.domains as { [key: string]: Json }[]).some(
        (d) => d.publicDomain === hostname && d.hasSsl === true,
      )
    )
      fail('NATIVE_DOMAIN_SETTINGS_MISMATCH');
    return;
  }
  if (plan.services.target === 'dokploy') {
    if (
      s.sourceType !== 'raw' ||
      s.composeType !== 'docker-compose' ||
      s.autoDeploy !== false ||
      s.composePath !== 'docker-compose.yml' ||
      s.composeFingerprint !==
        composeFingerprint(JSON.stringify(imageCompose(plan)))
    )
      fail('NATIVE_SETTINGS_NOT_APPLIED');
  } else if (plan.services.target === 'coolify') {
    const url = new URL(plan.release.source!.repository);
    const repository =
      url.hostname === 'github.com' ? url.pathname.slice(1) : url.href;
    if (
      s.git_repository !== repository ||
      s.git_branch !== plan.release.source!.branch ||
      s.git_commit_sha !== plan.release.sourceCommit ||
      s.build_pack !== 'dockercompose' ||
      s.base_directory !== '/' ||
      s.docker_compose_location !== '/ops/deploy/coolify/compose.yaml' ||
      s.ports_exposes !== '3100' ||
      s.is_auto_deploy_enabled !== false ||
      s.is_preview_deployments_enabled !== false ||
      s.is_force_https_enabled !== true ||
      s.health_check_enabled !== true ||
      s.health_check_path !== '/health/ready' ||
      String(s.health_check_port) !== '3100' ||
      s.limits_memory !== '512m' ||
      String(s.limits_cpus) !== '1' ||
      s.inject_build_args_to_dockerfile !== false ||
      s.redact_all_env_values_in_logs !== true ||
      s.include_coolify_default_variables !== false ||
      s.domains !==
        JSON.stringify({
          api: { domain: new URL(plan.release.readinessUrl).origin + ':3100' },
        })
    )
      fail('NATIVE_SETTINGS_NOT_APPLIED');
  } else {
    const expected = plan.services.volumes.map((v) => ({
      containerPath: v.containerPath,
      volumeName: v.resourceRef,
      mode: 'rw',
    }));
    if (
      s.containerHttpPort !== 3100 ||
      s.instanceCount !== plan.services.replicas ||
      s.hasPersistentData !== plan.services.volumes.length > 0 ||
      s.notExposeAsWebApp !== false ||
      s.forceSsl !== true ||
      s.websocketSupport !==
        plan.services.ingress.some((r) => r.service === 'api' && r.websocket) ||
      s.nodeId !== (plan.release.preconditions.nodeId ?? '') ||
      s.resourceLimits !== true ||
      !same(s.ports, []) ||
      !same(s.volumes, expected)
    )
      fail('NATIVE_SETTINGS_NOT_APPLIED');
  }
}
