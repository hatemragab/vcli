import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { CONFIG_ERROR_CODES } from '../dist/contracts.js';

const root = process.argv[2];
const configFile = process.argv[3];
const safeCodes = new Set(CONFIG_ERROR_CODES);

function emit(status, code, invalid = [], reason) {
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      status,
      invalid,
      ...(code ? { code } : {}),
      ...(reason ? { reason } : {}),
    })}\n`,
  );
}

function unavailable(reason) {
  emit('schema-unavailable', 'CONFIG_SCHEMA_UNAVAILABLE', [], reason);
  process.exitCode = 2;
}

function invalidConfig(error) {
  const raw = error && typeof error.code === 'string' ? error.code : '';
  const code = safeCodes.has(raw) ? raw : 'INVALID_CONFIG';
  const message = error instanceof Error ? error.message : '';
  const prefix = 'Invalid configuration keys: ';
  const names = new Set();
  if (message.startsWith(prefix)) {
    for (const part of message.slice(prefix.length).split(', ')) {
      const key = part.split('.')[0];
      if (/^[A-Z][A-Z0-9_]{0,64}$/.test(key)) names.add(key);
      if (names.size === 40) break;
    }
  }
  emit('invalid', code, [...names]);
  process.exitCode = 1;
}

function inside(parent, file) {
  const relative = path.relative(parent, file);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

async function fileInfo(file) {
  const info = await lstat(file).catch(() => undefined);
  if (!info?.isFile() || info.isSymbolicLink()) return undefined;
  return info;
}

function exportsStartup(source) {
  return (
    /export function loadConfig\b/.test(source) &&
    /export function loadSelectedEnvFile\b/.test(source)
  );
}

async function resolveLocal(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = spec.endsWith('.js')
    ? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`, base]
    : [`${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, 'index.ts')];
  for (const candidate of candidates) {
    if (!inside(root, candidate)) return undefined;
    if (await fileInfo(candidate)) return candidate;
  }
  return undefined;
}

async function localGraph(entry) {
  const files = [];
  const pending = [entry];
  const seen = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    if (seen.size > 12) return undefined;
    const info = await fileInfo(current);
    if (!info || info.size > 200_000) return undefined;
    const source = await readFile(current, 'utf8');
    if (current === entry && !exportsStartup(source)) return undefined;
    files.push({ file: current, source });
    for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const resolved = await resolveLocal(current, match[1]);
      if (!resolved) return undefined;
      pending.push(resolved);
    }
  }
  return files;
}

async function ownerFile(file) {
  if (!file || !path.isAbsolute(file)) return 'UNSAFE_ENV_FILE';
  const info = await lstat(file).catch(() => undefined);
  if (!info) return 'ENV_FILE_UNAVAILABLE';
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (process.getuid && info.uid !== process.getuid()) ||
    (info.mode & 0o077) !== 0 ||
    info.size > 200_000
  )
    return 'UNSAFE_ENV_FILE';
  return undefined;
}

let directory;
try {
  if (!root || !path.isAbsolute(root)) {
    unavailable('missing-startup-module');
  } else {
    const blocked = await ownerFile(configFile);
    if (blocked) {
      emit('invalid', blocked, []);
      process.exitCode = 1;
    } else {
      const sourceEntry = path.join(root, 'src/core/config/load-config.ts');
      const distEntry = path.join(root, 'dist/core/config/load-config.js');
      const entry = (await fileInfo(sourceEntry))
        ? sourceEntry
        : (await fileInfo(distEntry))
          ? distEntry
          : undefined;
      const graph = entry ? await localGraph(entry) : undefined;
      const modules = await stat(path.join(root, 'node_modules')).catch(
        () => undefined,
      );
      if (!graph || !modules?.isDirectory())
        unavailable('missing-startup-module');
      else {
        directory = await mkdtemp(path.join(tmpdir(), 'vcli-config-schema-'));
        await writeFile(
          path.join(directory, 'package.json'),
          '{"type":"module","private":true}\n',
        );
        await symlink(
          path.join(root, 'node_modules'),
          path.join(directory, 'node_modules'),
          'dir',
        );
        for (const item of graph) {
          const relative = path
            .relative(root, item.file)
            .replace(/\.tsx?$/, '.js');
          const target = path.join(directory, relative);
          await mkdir(path.dirname(target), { recursive: true });
          const javascript =
            item.file.endsWith('.ts') || item.file.endsWith('.tsx')
              ? ts.transpileModule(item.source, {
                  compilerOptions: {
                    target: ts.ScriptTarget.ES2023,
                    module: ts.ModuleKind.ESNext,
                  },
                }).outputText
              : item.source;
          await writeFile(target, javascript);
        }
        const loaded = await import(
          pathToFileURL(
            path.join(
              directory,
              path.relative(root, entry).replace(/\.tsx?$/, '.js'),
            ),
          ).href
        );
        if (
          typeof loaded.loadSelectedEnvFile !== 'function' ||
          typeof loaded.loadConfig !== 'function'
        )
          unavailable('missing-startup-module');
        else {
          process.env.APP_ENV_FILE = configFile;
          loaded.loadSelectedEnvFile();
          loaded.loadConfig();
          emit('valid');
        }
      }
    }
  }
} catch (error) {
  if (error && safeCodes.has(error.code)) invalidConfig(error);
  else unavailable('startup-module-unusable');
} finally {
  if (directory) await rm(directory, { recursive: true, force: true });
}
