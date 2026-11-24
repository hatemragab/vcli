import type {
  CheckCommand,
  FileOwnership,
  FileProvenance,
  JsonValue,
  ProjectConfig,
  RecipeCatalog,
  RecipeSelection,
  RenderedFile,
  ScriptDiagnostic,
} from '../contracts.js';

export type Outcome = 'pending' | 'completed' | 'failed';
export interface ProjectOutcomes {
  source: Outcome;
  install: Outcome;
  checks: Outcome;
}
export interface ManagedFile {
  ownership: FileOwnership;
  hash?: string;
  region?: boolean;
  provenance?: FileProvenance;
}
export type PackageFields = Record<string, JsonValue>;
export interface ProjectLock {
  schemaVersion: 1;
  toolVersion: string;
  config: ProjectConfig;
  recipes: { id: string; version: string; family: string }[];
  files: Record<string, ManagedFile>;
  packageFields: PackageFields;
  checks: CheckCommand[];
  pending: string[];
  outcomes: ProjectOutcomes;
  operationId: string;
  migrations: string[];
}
export type ExpectedFile = { kind: 'absent' } | { kind: 'hash'; hash: string };
export interface FileChange {
  path: string;
  ownership: FileOwnership;
  expected: ExpectedFile;
  content: string;
  hash: string;
}
export interface GenerationPlan {
  schemaVersion: 1;
  toolVersion: string;
  id: string;
  kind: 'init' | 'add' | 'scaffold' | 'upgrade';
  workspaceDir: string;
  projectDir: string;
  config: ProjectConfig;
  recipes: { id: string; version: string; family: string }[];
  changes: FileChange[];
  guards: { path: string; expected: ExpectedFile }[];
  checks: CheckCommand[];
  warnings: string[];
  pending: string[];
  outcomes: ProjectOutcomes;
  /** Init records only permitted directory entries, never a user-file inventory. */
  initialEntries?: string[];
  /** Public recipe defaults only, without locally generated keys. */
  developmentDefaults?: Record<string, string>;
  sourceMigrations?: PlannedSourceMigration[];
}
export interface PlanInitOptions {
  workspaceDir: string;
  projectDir: string;
  config: ProjectConfig;
  catalog: RecipeCatalog;
}
export interface PlanAddOptions {
  projectDir: string;
  selections: Record<string, RecipeSelection>;
  catalog: RecipeCatalog;
}
export interface PlanScaffoldOptions {
  projectDir: string;
  files: RenderedFile[];
  checks?: CheckCommand[];
  pending?: string[];
}
export interface PlanUpgradeOptions {
  projectDir: string;
  catalog: RecipeCatalog;
  upgrades?: RecipeUpgrade[];
  sourceMigrations?: string[];
}
export interface RecipeUpgrade {
  recipe: string;
  from: string;
  to: string;
  migrationId: string;
}
export interface PlanSummary {
  schemaVersion: 1;
  operationId: string;
  kind: GenerationPlan['kind'];
  project: string;
  recipes: GenerationPlan['recipes'];
  changes: {
    path: string;
    action: 'create' | 'replace';
    ownership: FileOwnership;
  }[];
  privateFiles?: string[];
  outcomes: ProjectOutcomes;
  warnings: string[];
  pending: string[];
}
export interface ApplyOptions {
  /** Controlled fault for acceptance; does not run an install. */ failAfterWrites?: number;
}
export interface ApplyResult {
  operationId: string;
  changed: string[];
  outcomes: ProjectOutcomes;
  pending: string[];
}
export interface CommandRequest {
  command: 'npm';
  args: readonly string[];
  cwd: string;
}
export interface CommandResult {
  exitCode: number | null;
  signal?: string;
  diagnostics?: readonly ScriptDiagnostic[];
}
export type CommandRunner = (request: CommandRequest) => Promise<CommandResult>;
export interface ExecutionOptions {
  runner?: CommandRunner;
  /** One declared check. A focused run does not change the recorded full-check outcome. */
  only?: string;
}
export interface ExecutionResult {
  outcomes: ProjectOutcomes;
  pending: string[];
  commands: { name: string; status: Outcome }[];
}
export interface Inspection {
  schemaVersion: 1;
  project: string;
  recipes: ProjectLock['recipes'];
  outcomes: ProjectOutcomes;
  issues: { code: string; path?: string; action: string }[];
  pending: string[];
  operations: { id: string; status: string }[];
  choices?: Record<string, unknown>;
  lastRun?: {
    at: string;
    scope: string;
    status: string;
    step?: string;
    code?: string;
  };
  configValidation?: { status: 'not-run'; next: string };
}
export interface RecoveryOptions {
  operationId?: string;
  abandonLock?: boolean;
}
export interface RecoveryResult {
  operationId: string;
  restored: string[];
  conflicts: string[];
  status: 'recovered' | 'conflicted';
  externalEffects: 'not-reverted';
}
export interface JournalEntry {
  path: string;
  before: string | null;
  afterHash: string;
  status: 'pending' | 'written' | 'restored';
}
export interface OperationJournal {
  schemaVersion: 1;
  id: string;
  projectDir: string;
  status:
    'applying' | 'source-completed' | 'failed' | 'recovered' | 'conflicted';
  outcomes: ProjectOutcomes;
  entries: JournalEntry[];
  createdDirectories: string[];
  developmentEnvironment?: { afterHash: string; device: number; inode: number };
}

export interface PlannedSourceMigration {
  id: string;
  path: string;
  expectedHash: string;
  resultHash: string;
}
