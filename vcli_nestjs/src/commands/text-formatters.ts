import { groupPaths } from '../engine/path-groups.js';

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  return value as Record<string, unknown>;
}

/** Concise, secret-free default text rendering across all command shapes. */
export function formatTextData(operation: string, payload: unknown): string[] {
  if (Array.isArray(payload)) return formatArrayLines(operation, payload);
  const data = asRecord(payload);
  if (!data) return [];
  if (operation === 'smoke.notes' && Array.isArray(data.checks))
    return data.checks
      .filter((check): check is string => typeof check === 'string')
      .map((check) => `Passed ${check}`);
  if (operation === 'firebase.setup') {
    const lines = [`target: ${String(data.target)}`];
    if (typeof data.projectId === 'string')
      lines.push(
        `project: ${data.projectId} (${String(data.projectAction ?? data.mode)})`,
      );
    if (data.mode === 'cancelled') return ['Project creation cancelled.'];
    if (Array.isArray(data.keys))
      lines.push(`${String(data.configFile)}: ${data.keys.join(', ')}`);
    if (
      Array.isArray(data.requiredSignInMethods) &&
      data.requiredSignInMethods.length
    )
      lines.push(
        `Enable the selected Firebase sign-in methods: ${data.requiredSignInMethods.join(', ')}`,
      );
    if (typeof data.next === 'string') lines.push(data.next);
    return lines;
  }
  if (operation === 'upgrade' && asRecord(data.generation)) {
    const lines = formatObjectLines(asRecord(data.generation)!);
    const maintenance = asRecord(data.maintenance);
    if (maintenance) {
      if (typeof maintenance.targetVersion === 'string')
        lines.push(`target: ${maintenance.targetVersion}`);
      if (Array.isArray(maintenance.codemods) && maintenance.codemods.length)
        lines.push(`codemods: ${maintenance.codemods.length}`);
      if (Array.isArray(maintenance.manual) && maintenance.manual.length)
        lines.push(`manual patches: ${maintenance.manual.length}`);
    }
    return lines;
  }
  return formatObjectLines(data);
}

function formatArrayLines(operation: string, items: unknown[]): string[] {
  if (!items.length) return ['(none)'];
  if (operation === 'catalog') {
    const lines: string[] = [];
    for (const item of items) {
      const entry = asRecord(item);
      if (!entry || typeof entry.id !== 'string') continue;
      const family =
        typeof entry.family === 'string' ? ` (${entry.family})` : '';
      const summary =
        typeof entry.summary === 'string' ? `: ${entry.summary}` : '';
      lines.push(`- ${entry.id}${family}${summary}`);
    }
    lines.push('Use --verbose or --json for defaults and examples.');
    return lines;
  }
  return [`items: ${items.length}`, 'Use --verbose to list every item.'];
}

function formatObjectLines(data: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (typeof data.operationId === 'string')
    lines.push(`operation: ${data.operationId}`);
  if (typeof data.planId === 'string') lines.push(`plan: ${data.planId}`);
  if (typeof data.target === 'string') {
    const version =
      typeof data.targetVersion === 'string' ? ` ${data.targetVersion}` : '';
    lines.push(`target: ${data.target}${version}`);
  }
  if (typeof data.path === 'string' && typeof data.owner === 'string') {
    lines.push(`path: ${data.path}`);
    lines.push(`owner: ${data.owner}`);
    if (typeof data.renderer === 'string')
      lines.push(`renderer: ${data.renderer}`);
    if (typeof data.template === 'string')
      lines.push(`template: ${data.template}`);
    if (typeof data.provenance === 'string')
      lines.push(`provenance: ${data.provenance}`);
    if (typeof data.hint === 'string') lines.push(`hint: ${data.hint}`);
  }
  if (Array.isArray(data.recipes)) {
    const names = data.recipes
      .map((item) => asRecord(item)?.id)
      .filter((id): id is string => typeof id === 'string');
    if (names.length) lines.push(`features: ${names.join(', ')}`);
  }
  if (Array.isArray(data.changes)) {
    const paths = data.changes
      .map((item) => asRecord(item)?.path)
      .filter((item): item is string => typeof item === 'string');
    const groups = groupPaths(paths);
    lines.push(
      `app ${groups.app}, assets ${groups.assets}, tooling ${groups.tooling}`,
    );
    lines.push('Use --verbose to list every file.');
    if (Array.isArray(data.warnings))
      for (const warning of data.warnings)
        if (typeof warning === 'string') lines.push(warning);
  }
  if (Array.isArray(data.privateFiles) && data.privateFiles.length)
    lines.push(`Private local config: ${data.privateFiles.join(', ')}`);
  const outcomes = asRecord(data.outcomes);
  if (
    outcomes &&
    typeof outcomes.source === 'string' &&
    typeof outcomes.install === 'string' &&
    typeof outcomes.checks === 'string'
  )
    lines.push(
      `source ${outcomes.source}, install ${outcomes.install}, checks ${outcomes.checks}`,
    );
  if (Array.isArray(data.issues) && data.issues.length) {
    lines.push(`issues: ${data.issues.length}`);
    for (const item of data.issues.slice(0, 20)) {
      const issue = asRecord(item);
      if (!issue || typeof issue.code !== 'string') continue;
      const where = typeof issue.path === 'string' ? ` (${issue.path})` : '';
      const action =
        typeof issue.action === 'string' ? `: ${issue.action}` : '';
      lines.push(`- ${issue.code}${where}${action}`);
    }
  }
  const configValidation = asRecord(data.configValidation);
  if (configValidation && typeof configValidation.status === 'string') {
    const next =
      typeof configValidation.next === 'string'
        ? ` (next: ${configValidation.next})`
        : '';
    lines.push(`config validation: ${configValidation.status}${next}`);
  }
  const lastRun = asRecord(data.lastRun);
  if (
    lastRun &&
    typeof lastRun.scope === 'string' &&
    typeof lastRun.status === 'string'
  ) {
    const step = typeof lastRun.step === 'string' ? `/${lastRun.step}` : '';
    const code = typeof lastRun.code === 'string' ? ` (${lastRun.code})` : '';
    lines.push(`last run: ${lastRun.scope}${step} ${lastRun.status}${code}`);
  }
  if (Array.isArray(data.required) && Array.isArray(data.invalid)) {
    if (typeof data.status === 'string') lines.push(`config ${data.status}`);
    if (typeof data.schema === 'string') lines.push(`schema ${data.schema}`);
    const names = data.invalid.filter(
      (item): item is string => typeof item === 'string',
    );
    if (names.length) lines.push(`invalid: ${names.join(', ')}`);
  }
  if (
    typeof data.retainedFiles === 'number' ||
    Array.isArray(data.events) ||
    typeof data.truncated === 'boolean'
  ) {
    if (typeof data.retainedFiles === 'number')
      lines.push(
        `retained: ${data.retainedFiles} files, ${String(data.retainedBytes ?? 0)} bytes`,
      );
    if (Array.isArray(data.sources) && data.sources.length)
      lines.push(
        `sources: ${data.sources.filter((s): s is string => typeof s === 'string').join(', ')}`,
      );
    if (
      Array.isArray(data.unavailableSources) &&
      data.unavailableSources.length
    )
      lines.push(
        `unavailable: ${data.unavailableSources.filter((s): s is string => typeof s === 'string').join(', ')}`,
      );
    if (Array.isArray(data.gaps) && data.gaps.length)
      lines.push(
        `gaps: ${data.gaps.filter((g): g is string => typeof g === 'string').join(', ')}`,
      );
    if (Array.isArray(data.events)) {
      lines.push(
        `events: ${data.events.length}${data.truncated ? ' (truncated)' : ''}`,
      );
      for (const item of data.events.slice(0, 20)) {
        const event = asRecord(item);
        if (!event || typeof event.event !== 'string') continue;
        const ts =
          typeof event.timestamp === 'string' ? `${event.timestamp} ` : '';
        const sev =
          typeof event.severity === 'string' ? `[${event.severity}] ` : '';
        const route = typeof event.route === 'string' ? ` ${event.route}` : '';
        const code =
          typeof event.errorCode === 'string'
            ? ` ${event.errorCode}`
            : typeof event.statusCode === 'number'
              ? ` ${event.statusCode}`
              : '';
        lines.push(`- ${ts}${sev}${event.event}${route}${code}`);
      }
    }
  }
  if (Array.isArray(data.services)) {
    const names = data.services
      .map((item) => {
        const svc = asRecord(item);
        if (!svc) return undefined;
        if (typeof svc.service === 'string' && typeof svc.state === 'string')
          return `${svc.service}=${svc.state}`;
        return typeof svc.id === 'string' ? svc.id : undefined;
      })
      .filter((item): item is string => !!item);
    if (names.length) lines.push(`services: ${names.join(', ')}`);
  }
  if (Array.isArray(data.releases)) {
    const versions = data.releases
      .map((item) => asRecord(item)?.version)
      .filter((v): v is string => typeof v === 'string');
    if (versions.length) lines.push(`releases: ${versions.join(', ')}`);
  }
  if (Array.isArray(data.components))
    lines.push(`components: ${data.components.length}`);
  if (Array.isArray(data.advisories))
    lines.push(`advisories: ${data.advisories.length}`);
  if (typeof data.releaseId === 'string')
    lines.push(`release: ${data.releaseId}`);
  if (typeof data.code === 'string' && !Array.isArray(data.required))
    lines.push(`code: ${data.code}`);
  if (typeof data.next === 'string') lines.push(`next: ${data.next}`);
  if (typeof data.check === 'string') lines.push(`check: ${data.check}`);
  return lines;
}
