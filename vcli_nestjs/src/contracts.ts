import { z } from 'zod';

/** Shared release metadata and config validation codes across CLI layers. */
export const TOOL_VERSION = '0.1.2';
export const SUPPORTED_TOOL_VERSIONS = [
  '0.1.0',
  '0.1.1',
  TOOL_VERSION,
] as const;
export const NODE_ENGINE_RANGE = '>=26.13.1 <27';
export const LOCAL_DEVELOPMENT_STORAGE_ROOT = 'storage';
export const CONFIG_ERROR_CODES = [
  'INVALID_CONFIG',
  'INVALID_JWT_POLICY',
  'INVALID_SMTP_CONFIG',
  'UNSAFE_PRODUCTION_CAPTURE',
  'RUNTIME_PROVIDER_SELECTION_UNSUPPORTED',
  'UNSAFE_ENV_FILE',
  'ENV_FILE_UNAVAILABLE',
  'INVALID_FIREBASE_ACTION_POLICY',
  'INVALID_PUSH_ENVIRONMENT',
  'INVALID_MAIL_DELIVERY_KEYS',
  'INVALID_MAIL_DELIVERY_LEASE',
  'INVALID_CENTRIFUGO_CONFIG',
] as const;

/** Project metadata stays unchanged; service resource names are normalized separately. */
export const projectNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/)
  .max(64)
  .refine(
    (value) => !['constructor', 'prototype', '__proto__'].includes(value),
  );

/** Shared generation contracts. These describe files and recipes, never provider I/O. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export interface RecipeSelection {
  recipe: string;
  options: JsonObject;
}
export interface ProjectConfig {
  schemaVersion: 1;
  project: { name: string; packageManager: 'npm' };
  capabilities: Record<string, RecipeSelection>;
}
export interface Recipe {
  id: string;
  version: string;
  family: string;
  /** Required capability family names, supplied by explicit selections. */
  requires: readonly string[];
  /** Conflicting recipe IDs. */
  conflicts: readonly string[];
  validateOptions: (options: unknown) => JsonObject;
}
export type FileOwnership = 'managed' | 'scaffold';
export interface RenderedFile {
  path: string;
  content: string;
  ownership: FileOwnership;
  /** Optional scaffolds can coexist with user files that predate generation. */
  preserveExisting?: true;
  provenance?: FileProvenance;
}
export interface CheckCommand {
  name: string;
  command: string;
  args: string[];
}
export interface RenderedProject {
  files: RenderedFile[];
  /** Public local defaults. Development keys are minted only when init applies. */
  developmentDefaults?: Record<string, string>;
  checks: CheckCommand[];
  warnings: string[];
  pending: string[];
}
export interface RecipeCatalog {
  recipes: readonly Recipe[];
  render: (
    config: ProjectConfig,
    resolved: readonly Recipe[],
  ) => Promise<RenderedProject>;
}

/** Allowlisted failure facts. Never carry a caught exception, source bytes, or secret values. */
export type FailureOrigin = 'validation' | 'distribution';
export interface ScriptDiagnostic {
  path: string;
  line?: number;
  column?: number;
  code: string;
}
export interface FileProvenance {
  renderer: string;
  template?: string;
}
export interface FailureDetails {
  recipe?: string;
  option?: string;
  path?: string;
  hint?: string;
  origin?: FailureOrigin;
  step?: string;
  script?: string;
  exitCode?: number | null;
  signal?: string;
  operationId?: string;
  rerun?: string;
  diagnostics?: readonly ScriptDiagnostic[];
  outcomes?: { source: string; install: string; checks: string };
  releaseId?: string;
  owners?: readonly string[];
  keys?: readonly string[];
}
const detailToken = /^[A-Za-z0-9_.:@+-]{1,80}$/;
const detailDiagnosticCode =
  /^(?!.*\.\.)@?[A-Za-z0-9][A-Za-z0-9_./:@+-]{0,79}$/;
const detailPath = /^(?!\/)(?!.*\.\.)[A-Za-z0-9_./:-]{1,180}$/;
const detailCommand = /^vcli(?: [A-Za-z0-9_.:<>-]+){0,8}$/;
const detailOutcome = /^(?:pending|completed|failed)$/;

export function publicDetails(
  details: FailureDetails = {},
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const copy = (key: keyof FailureDetails, value: unknown, ok: boolean) => {
    if (ok) output[key] = value;
  };
  copy(
    'recipe',
    details.recipe,
    !!details.recipe && detailToken.test(details.recipe),
  );
  copy(
    'option',
    details.option,
    !!details.option && detailToken.test(details.option),
  );
  copy('path', details.path, !!details.path && detailPath.test(details.path));
  copy(
    'hint',
    details.hint,
    !!details.hint &&
      details.hint.length <= 240 &&
      !/[\r\n]/.test(details.hint),
  );
  copy(
    'origin',
    details.origin,
    details.origin === 'validation' || details.origin === 'distribution',
  );
  copy('step', details.step, !!details.step && detailToken.test(details.step));
  copy(
    'script',
    details.script,
    !!details.script && /^[a-z0-9:_-]{1,80}$/.test(details.script),
  );
  copy(
    'exitCode',
    details.exitCode,
    details.exitCode === null ||
      (typeof details.exitCode === 'number' &&
        Number.isInteger(details.exitCode) &&
        details.exitCode >= 0 &&
        details.exitCode <= 255),
  );
  copy(
    'signal',
    details.signal,
    !!details.signal && /^[A-Z][A-Z0-9]{0,15}$/.test(details.signal),
  );
  copy(
    'operationId',
    details.operationId,
    !!details.operationId && /^[0-9a-f-]{36}$/i.test(details.operationId),
  );
  copy(
    'rerun',
    details.rerun,
    !!details.rerun && detailCommand.test(details.rerun),
  );
  copy(
    'releaseId',
    details.releaseId,
    !!details.releaseId && /^[a-z0-9-]{8,128}$/i.test(details.releaseId),
  );
  if (details.owners?.every((owner) => /^[a-z0-9.-]{1,64}$/.test(owner)))
    output.owners = [...details.owners].slice(0, 16);
  if (
    details.keys?.every((key) => /^[A-Z][A-Z0-9_]{0,64}$/.test(key)) &&
    details.keys.length
  )
    output.keys = [...details.keys].slice(0, 20);
  if (
    details.outcomes &&
    detailOutcome.test(details.outcomes.source) &&
    detailOutcome.test(details.outcomes.install) &&
    detailOutcome.test(details.outcomes.checks)
  )
    output.outcomes = { ...details.outcomes };
  const diagnostics = (details.diagnostics ?? [])
    .filter(
      (item) =>
        detailPath.test(item.path) &&
        detailDiagnosticCode.test(item.code) &&
        (item.line === undefined ||
          (Number.isInteger(item.line) &&
            item.line > 0 &&
            item.line < 1_000_000)) &&
        (item.column === undefined ||
          (Number.isInteger(item.column) &&
            item.column > 0 &&
            item.column < 10_000)),
    )
    .slice(0, 20)
    .map((item) => ({
      path: item.path,
      ...(item.line ? { line: item.line } : {}),
      ...(item.column ? { column: item.column } : {}),
      code: item.code,
    }));
  if (diagnostics.length) output.diagnostics = diagnostics;
  return output;
}

export class BoundedFailure extends Error {
  readonly details: FailureDetails;
  constructor(
    readonly code: string,
    readonly stage: string,
    readonly action: string,
    details: FailureDetails = {},
  ) {
    super(code);
    this.name = 'BoundedFailure';
    this.details = details;
  }
  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      stage: this.stage,
      action: this.action,
      ...publicDetails(this.details),
    };
  }
}

export function validationFailure(
  code: string,
  action: string,
  details: FailureDetails = {},
): BoundedFailure {
  return new BoundedFailure(code, 'selection', action, {
    origin: 'validation',
    ...details,
  });
}

export function distributionFailure(
  code: string,
  action: string,
  details: FailureDetails = {},
): BoundedFailure {
  return new BoundedFailure(code, 'template', action, {
    hint:
      details.hint ??
      'Repair the VCLI template in the generator repository. Do not edit the pinned copy under tools/vcli.',
    ...details,
    origin: 'distribution',
  });
}

/** Map known generator failures. Arbitrary exception text is never copied. */
export function describeThrown(error: unknown): BoundedFailure | undefined {
  if (error instanceof BoundedFailure) return error;
  if (!(error instanceof Error)) return undefined;
  const message = error.message;
  if (message.startsWith('MISSING_CAPABILITY:')) {
    const recipe = message.slice('MISSING_CAPABILITY:'.length);
    if (/^[a-z][a-z0-9-]*$/.test(recipe))
      return validationFailure(
        'MISSING_CAPABILITY',
        `Select the ${recipe} capability before this combination.`,
        {
          recipe,
          hint: `Add the ${recipe} recipe explicitly, then retry the same command.`,
        },
      );
  }
  if (message.startsWith('DUPLICATE_RENDERED_PATH:')) {
    const path = message.slice('DUPLICATE_RENDERED_PATH:'.length);
    if (detailPath.test(path))
      return distributionFailure(
        'INVALID_CATALOG',
        'A recipe emitted the same relative path twice.',
        { path },
      );
  }
  if (
    message.startsWith('UNPINNED_TEMPLATE_DEPENDENCY:') ||
    message.startsWith('UNPINNED_CLIENT_DEPENDENCY:')
  ) {
    const option = message.slice(message.indexOf(':') + 1);
    if (detailToken.test(option))
      return distributionFailure(
        'INVALID_CATALOG',
        'A selected template imports a package that has no pin.',
        { option, path: 'package.json' },
      );
  }
  if (message === 'INVALID_BUNDLED_TEMPLATE' || message.endsWith('_TEMPLATE'))
    return distributionFailure(
      'INVALID_CATALOG',
      'A bundled template is missing a required marker or file.',
      message === 'INVALID_BUNDLED_TEMPLATE' ? {} : { option: message },
    );
  if (/^[A-Z][A-Z0-9_]{2,80}$/.test(message))
    return validationFailure(
      message,
      'Review the selected recipe options and supported profiles.',
    );
  return undefined;
}
