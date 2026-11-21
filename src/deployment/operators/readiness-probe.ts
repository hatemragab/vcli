import { boundedBody } from './native-http.js';
import type { DeploymentPlan, OperatorOptions } from './types.js';
import { fail, record } from './validation.js';

/** Separate public unauthenticated HTTPS client. No native token/header is reachable here. */
export async function probeReadiness(
  plan: DeploymentPlan,
  options: OperatorOptions,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
  try {
    const response = await (options.fetch ?? globalThis.fetch)(
      plan.release.readinessUrl,
      {
        headers: { accept: 'application/json' },
        redirect: 'error',
        credentials: 'omit',
        signal: controller.signal,
      },
    );
    if (
      !response.ok ||
      response.redirected ||
      (response.url && response.url !== plan.release.readinessUrl)
    )
      fail('READINESS_PROBE_FAILED');
    let raw: unknown;
    try {
      raw = JSON.parse(await boundedBody(response, 32768));
    } catch {
      fail('READINESS_PROBE_FAILED');
    }
    const data = record(raw);
    if (
      data.status !== 'ready' ||
      data.buildId !== plan.release.sourceCommit ||
      (plan.release.schemaReleaseId &&
        data.schemaReleaseId !== plan.release.schemaReleaseId)
    )
      fail('READINESS_RELEASE_IDENTITY_MISMATCH');
  } catch (error) {
    if (error instanceof Error && /^READINESS_/.test(error.message))
      throw error;
    fail('READINESS_PROBE_FAILED');
  } finally {
    clearTimeout(timer);
  }
}
