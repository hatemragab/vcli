import path from 'node:path';
import type { JsonValue } from '../contracts.js';
import { canonical, hash, parseJson, validateToolchain } from './data.js';
import { EngineError } from './engine-error.js';
import { managedRegion, validatePackageFields } from './managed-content.js';
import { listJournals, unfinishedJournals } from './operation-storage.js';
import {
  assertNoSymlinks,
  projectPath,
  readRegular,
  statOrNull,
  relativePath,
} from './paths.js';
import { readLastResult } from './last-result.js';
import { readProject, validateLock } from './state.js';
import type { Inspection, ManagedFile } from './types.js';

type ObjectValue = Record<string, JsonValue>;
function object(value: unknown): ObjectValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : null;
}
async function allBounded<T>(
  items: readonly T[],
  limit: number,
  check: (item: T) => Promise<boolean>,
): Promise<boolean> {
  let index = 0;
  let ok = true;
  const worker = async (): Promise<void> => {
    while (ok) {
      const current = index++;
      if (current >= items.length) return;
      if (!(await check(items[current]!))) ok = false;
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return ok;
}
async function localPayloadHealthy(
  projectDir: string,
  name: string,
  directory: string,
  manifest: ObjectValue,
  managed: Record<string, ManagedFile>,
  managedHashes?: ReadonlyMap<string, string>,
): Promise<boolean> {
  const paths = Object.entries(managed)
    .filter(
      ([file, metadata]) =>
        file.startsWith(directory + '/') &&
        metadata.ownership === 'managed' &&
        file !== directory + '/package.json',
    )
    .map(([file, metadata]) => ({
      relative: file.slice(directory.length + 1),
      expected: metadata.hash,
    }));
  if (!paths.length) {
    // A standalone local package has no VCLI ownership ledger. Its explicitly
    // declared entrypoints are a bounded compatibility surface, not an audit.
    const declared = new Set<string>();
    const collect = (value: JsonValue | undefined): void => {
      if (typeof value === 'string' && value.startsWith('./'))
        declared.add(value.slice(2));
      else if (value && typeof value === 'object')
        for (const child of Object.values(value)) collect(child);
    };
    collect(manifest.exports);
    collect(manifest.main);
    collect(manifest.bin);
    for (const relative of declared)
      paths.push({ relative, expected: undefined });
  }
  return allBounded(paths, 24, async (entry) => {
    relativePath(entry.relative);
    const fullRelative = directory + '/' + entry.relative;
    let sourceHash = managedHashes?.get(fullRelative);
    if (!sourceHash) {
      const source = await readRegular(
        await projectPath(projectDir, fullRelative),
      );
      if (!source) return false;
      sourceHash = hash(source);
    }
    const installed = await readRegular(
      path.join(projectDir, 'node_modules', name, entry.relative),
    );
    return Boolean(
      installed &&
      (!entry.expected || sourceHash === entry.expected) &&
      sourceHash === hash(installed),
    );
  });
}
export async function localFileDependencyHealthy(
  projectDir: string,
  name: string,
  directory: string,
  managed: Record<string, ManagedFile>,
): Promise<boolean> {
  const source = await readRegular(
    await projectPath(projectDir, directory + '/package.json'),
  );
  const installed = await readRegular(
    path.join(projectDir, 'node_modules', name, 'package.json'),
  );
  const sourceManifest = source
    ? object(parseJson(source.toString('utf8')))
    : null;
  const installedManifest = installed
    ? object(parseJson(installed.toString('utf8')))
    : null;
  return Boolean(
    sourceManifest &&
    installedManifest &&
    sourceManifest.version === installedManifest.version &&
    (await localPayloadHealthy(
      projectDir,
      name,
      directory,
      sourceManifest,
      managed,
    )),
  );
}
/** Local evidence only: both npm locks plus every recorded installed manifest must match installed versions. */
export async function installationHealthy(
  projectDir: string,
  managedHashes?: ReadonlyMap<string, string>,
): Promise<boolean> {
  try {
    const packageBytes = await readRegular(
      await projectPath(projectDir, 'package.json'),
    );
    const lockBytes = await readRegular(
      await projectPath(projectDir, 'package-lock.json'),
    );
    if (!packageBytes || !lockBytes) return false;
    const manifest = object(parseJson(packageBytes.toString('utf8')));
    const lock = object(parseJson(lockBytes.toString('utf8')));
    const packages = object(lock?.packages);
    const root = object(packages?.['']);
    if (
      !manifest ||
      !lock ||
      !packages ||
      !root ||
      typeof lock.lockfileVersion !== 'number' ||
      lock.lockfileVersion < 3
    )
      return false;
    const hiddenPath = path.join(projectDir, 'node_modules/.package-lock.json');
    await assertNoSymlinks(hiddenPath);
    const hiddenBytes = await readRegular(hiddenPath);
    if (!hiddenBytes) return false;
    const hidden = object(parseJson(hiddenBytes.toString('utf8')));
    const installedPackages = object(hidden?.packages);
    if (!installedPackages) return false;
    const stateBytes = await readRegular(
      await projectPath(projectDir, 'vcli.lock.json'),
    );
    const managed = stateBytes
      ? validateLock(parseJson(stateBytes.toString('utf8'))).files
      : {};
    for (const section of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
    ]) {
      const declarations = object(manifest[section]) ?? {};
      if (canonical(declarations) !== canonical(object(root[section]) ?? {}))
        return false;
      for (const [name] of Object.entries(declarations)) {
        if (
          !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name) ||
          !packages[`node_modules/${name}`]
        )
          return false;
        const declaration = declarations[name];
        if (
          typeof declaration === 'string' &&
          declaration.startsWith('file:')
        ) {
          const source = relativePath(declaration.slice(5));
          const bytes = await readRegular(
            await projectPath(projectDir, source + '/package.json'),
          );
          const sourcePackage = bytes
            ? object(parseJson(bytes.toString('utf8')))
            : null;
          if (
            !sourcePackage ||
            sourcePackage.version !==
              object(packages[`node_modules/${name}`])?.version
          )
            return false;
          if (
            !(await localPayloadHealthy(
              projectDir,
              name,
              source,
              sourcePackage,
              managed,
              managedHashes,
            ))
          )
            return false;
        }
      }
    }
    const packageEntries = Object.entries(packages).filter(([relative]) =>
      relative.startsWith('node_modules/'),
    );
    return allBounded(packageEntries, 24, async ([relative, item]) => {
      if (
        relative
          .split('/')
          .some(
            (part) =>
              !/^[A-Za-z0-9_.@-]+$/.test(part) || part === '.' || part === '..',
          )
      )
        return false;
      const expected = object(item);
      const installed = object(installedPackages[relative]);
      if (
        !expected ||
        expected.link ||
        !installed ||
        installed.version !== expected.version ||
        installed.integrity !== expected.integrity
      )
        return false;
      const packagePath = path.join(projectDir, relative, 'package.json');
      await assertNoSymlinks(packagePath);
      const bytes = await readRegular(packagePath);
      return Boolean(
        bytes &&
        object(parseJson(bytes.toString('utf8')))?.version === expected.version,
      );
    });
  } catch {
    return false;
  }
}
function publicChoices(config: {
  capabilities: Record<
    string,
    { recipe: string; options: Record<string, JsonValue> }
  >;
}): Record<string, unknown> {
  const choices: Record<string, unknown> = {};
  for (const [family, selected] of Object.entries(config.capabilities)) {
    const options: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(selected.options)) {
      if (/key|secret|password|token|credential/i.test(key)) continue;
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      )
        options[key] = value;
      else if (
        Array.isArray(value) &&
        value.every(
          (item) =>
            typeof item === 'string' ||
            typeof item === 'number' ||
            typeof item === 'boolean',
        )
      )
        options[key] = value;
    }
    choices[family] = {
      recipe: selected.recipe,
      ...(Object.keys(options).length ? { options } : {}),
    };
  }
  return choices;
}

/** Hash and install guards still run. A preloaded snapshot skips only the second metadata read. */
export async function inspectProject(
  projectDir: string,
  preloaded?: Awaited<ReturnType<typeof readProject>>,
): Promise<Inspection> {
  const absolute = path.resolve(projectDir);
  const journals = await listJournals(absolute);
  let state: Awaited<ReturnType<typeof readProject>> | undefined;
  if (preloaded && path.resolve(preloaded.projectDir) === absolute)
    state = preloaded;
  if (!state)
    try {
      state = await readProject(absolute);
    } catch (error) {
      const interrupted = unfinishedJournals(journals);
      if (!interrupted.length) throw error;
      return {
        schemaVersion: 1,
        project: 'incomplete-project',
        recipes: [],
        outcomes: { source: 'failed', install: 'pending', checks: 'pending' },
        issues: [
          {
            code: 'INCOMPLETE_OPERATION',
            action:
              'Recover the interrupted operation before reconciling incomplete metadata.',
          },
        ],
        pending: [],
        operations: journals.map(({ id, status }) => ({ id, status })),
      };
    }
  if (!state)
    throw new EngineError(
      'STATE_DRIFT',
      'inspect',
      'Read project metadata before inspecting managed files.',
    );
  const result: Inspection = {
    schemaVersion: 1,
    project: state.config.project.name,
    recipes: state.lock.recipes,
    outcomes: { ...state.lock.outcomes },
    issues: [],
    pending: [...state.lock.pending],
    operations: [],
  };
  result.operations = journals.map(({ id, status }) => ({ id, status }));
  if (unfinishedJournals(journals).length) {
    result.outcomes.source = 'failed';
    result.issues.push({
      code: 'INCOMPLETE_OPERATION',
      action: 'Recover interrupted source writes before continuing.',
    });
  }
  const managedHashes = new Map<string, string>();
  const managedEntries = Object.entries(state.lock.files).filter(
    ([, metadata]) => metadata.ownership !== 'scaffold',
  );
  const managedConflicts: string[] = [];
  await allBounded(managedEntries, 24, async ([file, metadata]) => {
    try {
      const bytes = await readRegular(
        await projectPath(state.projectDir, file),
      );
      if (!bytes)
        throw new EngineError(
          'MANAGED_CONFLICT',
          'inspect',
          'Restore the missing managed file.',
        );
      if (file === 'package.json')
        validatePackageFields(bytes.toString('utf8'), state.lock.packageFields);
      else {
        const region = metadata.region
          ? managedRegion(bytes.toString('utf8'))
          : null;
        const digest = hash(region?.content ?? bytes);
        if ((metadata.region && !region) || digest !== metadata.hash)
          throw new EngineError(
            'MANAGED_CONFLICT',
            'inspect',
            'Review modified managed output.',
          );
        if (!metadata.region) managedHashes.set(file, digest);
      }
    } catch {
      managedConflicts.push(file);
    }
    return true;
  });
  for (const file of managedConflicts.sort()) {
    result.issues.push({
      code: 'MANAGED_CONFLICT',
      path: file,
      action: 'Review the selected managed file or region before regeneration.',
    });
  }
  if (!(await installationHealthy(state.projectDir, managedHashes))) {
    if (result.outcomes.install === 'completed')
      result.outcomes.install = 'failed';
    result.outcomes.checks =
      result.outcomes.checks === 'completed'
        ? 'pending'
        : result.outcomes.checks;
    result.issues.push({
      code: 'INSTALL_INCOMPLETE',
      action:
        'Explicitly install dependencies; verify both npm locks and installed direct package manifests.',
    });
  }
  result.choices = publicChoices(state.config);
  try {
    const last = await readLastResult(absolute);
    if (last)
      result.lastRun = {
        at: last.at,
        scope: last.scope,
        status: last.status,
        ...(last.step ? { step: last.step } : {}),
        ...(last.code ? { code: last.code } : {}),
      };
  } catch {
    // A corrupt last-result record must not hide source or install issues.
  }
  return result;
}
export async function doctorProject(projectDir: string): Promise<Inspection> {
  const result = await inspectProject(projectDir);
  result.configValidation = {
    status: 'not-run',
    next: 'vcli config check',
  };
  try {
    validateToolchain();
  } catch {
    result.issues.push({
      code: 'UNSUPPORTED_TOOLCHAIN',
      action:
        'Use Node >=26.13.1 <27 without changing a global toolchain automatically.',
    });
  }
  // Names only, no private environment contents or hashes are read.
  for (const file of ['.env.development.example', '.env.production.example']) {
    const location = await projectPath(path.resolve(projectDir), file);
    if (!(await statOrNull(location))?.isFile())
      result.issues.push({
        code: 'CONFIG_EXAMPLE_MISSING',
        path: file,
        action:
          'Restore the selected configuration example; inject actual values privately at runtime.',
      });
  }
  return result;
}
