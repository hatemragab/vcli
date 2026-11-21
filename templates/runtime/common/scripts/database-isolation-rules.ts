import { readdir, readFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { relative, resolve, sep } from 'node:path';
import ts from 'typescript';

// This contributor check is fixed at generation time, never an app selector.
export const selectedDatabase = 'none';
const requiredPackages: string[] = [];
const forbiddenPackages = new Set([
  'mongoose',
  '@types/mongoose',
  'mongodb',
  '@types/mongodb',
  '@mongodb-js/saslprep',
  'mongodb-connection-string-url',
  'bson',
  'kareem',
  'mpath',
  'mquery',
  'sift',

  'drizzle-orm',
  'drizzle-kit',
  'pg',
  'pg-native',
  '@types/pg',
  'pg-cloudflare',
  'pg-connection-string',
  'pg-int8',
  'pg-pool',
  'pg-protocol',
  'pg-types',
  'pgpass',
  'postgres',
  'postgres-array',
  'postgres-bytea',
  'postgres-date',
  'postgres-interval',
]);
// Shared utilities are allowed when reachable from a legitimate declared root.
// Keep the pinned opposite recipe's closure here so stale orphan entries fail too.
const sharedClosurePackages = new Set([
  '@types/node',
  'undici-types',
  'split2',
  'xtend',
]);
const oppositeSource = /(^|[./_-])(mongo(?:db|ose)?|postgres(?:ql)?|drizzle|pg|database)(?=[./_-]|$)/i;
const oppositeSymbol =
  /^(Mongo|MongoDB|Mongoose|Postgres|PostgreSQL|Drizzle|Pg)(Database|Repository|Schema|Client|Pool)/;
const databaseNames = new Set([
  'mongo',
  'mongodb',
  'mongoose',
  'pg',
  'postgres',
  'postgresql',
  'memory',
]);
const dependencySections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

export type DatabaseIsolationResult = Readonly<{
  database: typeof selectedDatabase;
  files: number;
  lockedPackages: number;
  failures: readonly string[];
}>;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function dependencies(value: unknown): Record<string, unknown> {
  const object = record(value);
  return Object.assign(
    {},
    ...dependencySections.map((key) => record(object[key])),
  ) as Record<string, unknown>;
}

function packageName(specifier: string): string {
  return specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');
}

function aliasTarget(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('npm:')) return;
  return /^(?:npm:)(@[^/]+\/[^@]+|[^@]+)(?:@|$)/.exec(value)?.[1];
}

function lockName(key: string, value: unknown): string {
  const name = record(value).name;
  return typeof name === 'string' ? name : key.split('node_modules/').at(-1)!;
}

function forbiddenEntry(
  key: string,
  value: unknown,
  aliases: ReadonlySet<string> = new Set(),
): boolean {
  // Both the install path and an npm alias's real identity matter.
  return [key.split('node_modules/').at(-1)!, lockName(key, value)].some(
    (name) => forbiddenPackages.has(name) || aliases.has(name),
  );
}

function resolveLocked(
  packages: Record<string, unknown>,
  from: string,
  name: string,
): string | undefined {
  let directory = from;
  for (;;) {
    const candidate = `${directory ? `${directory}/` : ''}node_modules/${name}`;
    if (Object.hasOwn(packages, candidate)) return candidate;
    if (!directory) return;
    const parent = directory.lastIndexOf('/node_modules/');
    directory = parent < 0 ? '' : directory.slice(0, parent);
  }
}

function lockedClosure(
  packages: Record<string, unknown>,
  roots: readonly string[],
  stopForbidden: boolean,
): Set<string> {
  const seen = new Set<string>();
  const visit = (key: string): void => {
    if (seen.has(key)) return;
    if (stopForbidden && forbiddenEntry(key, packages[key])) return;
    seen.add(key);
    const entry = record(packages[key]);
    // Follow declarations only when their target actually exists in the lock.
    for (const name of Object.keys({
      ...record(entry.dependencies),
      ...record(entry.optionalDependencies),
      ...record(entry.peerDependencies),
    }).sort()) {
      const target = resolveLocked(packages, key, name);
      if (target) visit(target);
    }
  };
  for (const key of roots) visit(key);
  return seen;
}

async function checkDependencies(
  root: string,
  failures: string[],
): Promise<{ lockedPackages: number; aliases: ReadonlySet<string> }> {
  const aliases = new Set<string>();
  const readJson = async (name: string): Promise<Record<string, unknown>> => {
    try {
      const value: unknown = JSON.parse(
        await readFile(resolve(root, name), 'utf8'),
      );
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('object required');
      return record(value);
    } catch {
      failures.push(`${name}: missing or invalid JSON object`);
      return {};
    }
  };
  const manifest = await readJson('package.json');
  const lock = await readJson('package-lock.json');
  const packages = record(lock.packages);
  if (lock.lockfileVersion !== 3 || !Object.hasOwn(packages, ''))
    failures.push(
      'package-lock.json: expected lockfileVersion 3 with root and installed-package entries',
    );
  const checkDeclarations = (where: string, value: unknown): void => {
    const object = record(value);
    for (const section of dependencySections) {
      for (const [name, version] of Object.entries(record(object[section]))) {
        const target = aliasTarget(version);
        if (
          forbiddenPackages.has(name) ||
          (target && forbiddenPackages.has(target))
        ) {
          failures.push(
            `${where}: forbidden dependency ${section}.${name}${target ? ` (${target})` : ''}`,
          );
          aliases.add(name);
        }
      }
    }
  };
  checkDeclarations('package.json', manifest);
  checkDeclarations('package-lock.json root', packages['']);
  for (const name of requiredPackages) {
    if (!Object.hasOwn(record(manifest.dependencies), name))
      failures.push(
        `package.json: selected database requires dependencies.${name}`,
      );
    if (
      !Object.hasOwn(record(record(packages['']).dependencies), name) ||
      !Object.hasOwn(packages, `node_modules/${name}`)
    )
      failures.push(
        `package-lock.json: selected database requires locked ${name}`,
      );
  }
  const entries = Object.keys(packages)
    .filter((key) => key !== '')
    .sort();
  const forbiddenRoots = entries.filter((key) =>
    forbiddenEntry(key, packages[key], aliases),
  );
  const declared = dependencies(manifest);
  const allowedRoots = Object.keys(declared)
    .filter((name) => !forbiddenPackages.has(name) && !aliases.has(name))
    .flatMap((name) => {
      const target = resolveLocked(packages, '', name);
      return target ? [target] : [];
    });
  const allowed = lockedClosure(packages, allowedRoots, true);
  const forbiddenClosure = lockedClosure(packages, forbiddenRoots, false);
  for (const key of entries) {
    const name = lockName(key, packages[key]);
    if (forbiddenEntry(key, packages[key], aliases))
      failures.push(
        `package-lock.json: forbidden installed package ${key} (${name})`,
      );
    else if (
      !allowed.has(key) &&
      (forbiddenClosure.has(key) || sharedClosurePackages.has(name))
    )
      failures.push(
        `package-lock.json: unused opposite-database closure package ${key}`,
      );
  }
  return { lockedPackages: entries.length, aliases };
}

async function sourceFiles(
  directory: string,
  failures: string[],
): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isSymbolicLink())
      failures.push(`${file}: source symlinks are not supported`);
    else if (entry.isDirectory())
      result.push(...(await sourceFiles(file, failures)));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) result.push(file);
  }
  return result.sort();
}

function nameOf(node: ts.Node | undefined): string | undefined {
  if (node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node)))
    return node.text;
  return;
}

function memberName(node: ts.Node): string | undefined {
  return ts.isPropertyAccessExpression(node)
    ? node.name.text
    : ts.isElementAccessExpression(node)
      ? nameOf(node.argumentExpression)
      : nameOf(node);
}

function rejectsLegacySelector(node: ts.Node): boolean {
  const access =
    (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) &&
    (ts.isPropertyAccessExpression(node.parent) ||
      ts.isElementAccessExpression(node.parent))
      ? node.parent
      : node;
  const comparison = access.parent;
  if (
    !ts.isBinaryExpression(comparison) ||
    ![
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
    ].includes(comparison.operatorToken.kind)
  )
    return false;
  const other = comparison.left === access ? comparison.right : comparison.left;
  const statement = comparison.parent;
  if (
    !ts.isIdentifier(other) ||
    other.text !== 'undefined' ||
    !ts.isIfStatement(statement) ||
    statement.expression !== comparison ||
    statement.elseStatement
  )
    return false;
  const body = statement.thenStatement;
  return (
    ts.isThrowStatement(body) ||
    (ts.isBlock(body) &&
      body.statements.length === 1 &&
      ts.isThrowStatement(body.statements[0]!))
  );
}

function databaseSelector(node: ts.Node): boolean {
  const key = ts.isIdentifier(node)
    ? node.text
    : ts.isElementAccessExpression(node)
      ? nameOf(node.argumentExpression)
      : undefined;
  if (/^(?:DATABASE|DB)_?(?:DRIVER|PROVIDER|DIALECT|TYPE)$/i.test(key ?? ''))
    return !rejectsLegacySelector(node);
  if (
    !(
      ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
    ) ||
    !['driver', 'provider', 'dialect', 'kind', 'type'].includes(
      memberName(node) ?? '',
    ) ||
    !/^(database|db)$/i.test(memberName(node.expression) ?? '')
  )
    return false;
  // Reading a baked literal for logging is fine; using it to choose behavior is not.
  let expression: ts.Node = node;
  for (
    let parent = expression.parent;
    parent;
    expression = parent, parent = parent.parent
  ) {
    if (
      (ts.isIfStatement(parent) && parent.expression === expression) ||
      (ts.isConditionalExpression(parent) && parent.condition === expression) ||
      (ts.isSwitchStatement(parent) && parent.expression === expression) ||
      (ts.isElementAccessExpression(parent) &&
        parent.argumentExpression === expression)
    )
      return true;
    if (ts.isStatement(parent) || ts.isFunctionLike(parent)) return false;
  }
  return false;
}

function isSelectedLiteral(node: ts.Node): boolean {
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node))
    return isSelectedLiteral(node.expression);
  return nameOf(node) === selectedDatabase;
}

function providerTag(node: ts.Node): string | undefined {
  const text = ts.isLiteralTypeNode(node) ? nameOf(node.literal) : nameOf(node);
  if (text && databaseNames.has(text.toLowerCase())) return text.toLowerCase();
  if (
    text &&
    /^(Mongo|Mongoose|Postgres|PostgreSQL|Pg|Memory)(Database|Repository)$/.test(
      text,
    )
  )
    return text;
  if (ts.isTypeReferenceNode(node)) return providerTag(node.typeName);
  return;
}

/** Checks the selected output, not contributor node_modules or negative test fixtures. */
export async function checkDatabaseIsolation(
  projectDirectory: string,
): Promise<DatabaseIsolationResult> {
  const root = resolve(projectDirectory);
  const sourceRoot = resolve(root, 'src');
  const failures: string[] = [];
  const { lockedPackages, aliases } = await checkDependencies(root, failures);
  let files: string[];
  try {
    files = await sourceFiles(sourceRoot, failures);
  } catch {
    failures.push('src: application source directory is missing or unreadable');
    files = [];
  }
  if (!files.length) failures.push('src: application source is empty');
  const known = new Set(files);
  const label = (file: string) => relative(root, file).split(sep).join('/');
  let options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  };
  const configPath = resolve(root, 'tsconfig.json');
  if (ts.sys.fileExists(configPath)) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) failures.push('tsconfig.json: invalid configuration');
    else {
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
      if (parsed.errors.length)
        failures.push('tsconfig.json: invalid configuration');
      options = parsed.options;
    }
  }
  // Local TS paths need resolution, but the temporary installation is not evidence.
  const host: ts.ModuleResolutionHost = {
    fileExists: (path) =>
      !path.split(sep).includes('node_modules') && ts.sys.fileExists(path),
    readFile: (path) =>
      path.split(sep).includes('node_modules')
        ? undefined
        : ts.sys.readFile(path),
  };
  for (const file of files) {
    const report = (reason: string): void => {
      failures.push(`${label(file)}: ${reason}`);
    };
    if (oppositeSource.test(relative(sourceRoot, file)))
      report('unselected database source file');
    if (
      /(^|[./_-])(?:memory-(?:[a-z-]*state-store|database|repository|backend)|(?:database|repository|backend)-memory)(?=[./_-]|$)/i.test(
        relative(sourceRoot, file),
      )
    )
      report('application memory database source');
    const ast = ts.createSourceFile(
      file,
      await readFile(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const inspectImport = (specifier: string): void => {
      if (isBuiltin(specifier)) return;
      if (
        forbiddenPackages.has(packageName(specifier)) ||
        aliases.has(packageName(specifier))
      ) {
        report(`unselected database SDK import ${specifier}`);
        return;
      }
      const target = ts.resolveModuleName(
        specifier,
        file,
        options,
        host,
      ).resolvedModule;
      if (target) {
        const resolved = resolve(target.resolvedFileName);
        if (!known.has(resolved))
          report(`import escapes application source: ${specifier}`);
        if (oppositeSource.test(relative(sourceRoot, resolved)))
          report(`import resolves to unselected database source: ${specifier}`);
      } else if (specifier.startsWith('.'))
        report(`unresolved local import ${specifier}`);
    };
    const inspect = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      )
        inspectImport(node.moduleSpecifier.text);
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      )
        inspectImport(node.argument.literal.text);
      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteralLike(node.moduleReference.expression)
      )
        inspectImport(node.moduleReference.expression.text);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === 'require'))
      ) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteralLike(argument))
          inspectImport(argument.text);
        report('dynamic dependency loading can conceal database selection');
      }
      if (ts.isIdentifier(node)) {
        if (['RepositoryAdapter', 'RepositoryDefinition'].includes(node.text))
          report(`obsolete portable repository contract ${node.text}`);
        if (
          /^(?:In)?Memory.*(?:Database|Repository|Backend|StateStore)$/.test(
            node.text,
          )
        )
          report(`application memory database ${node.text}`);
        if (oppositeSymbol.test(node.text))
          report(`unselected database symbol ${node.text}`);
      }
      if (databaseSelector(node)) report('runtime database selector');
      if (
        ts.isBinaryExpression(node) &&
        [
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
        ].includes(node.operatorToken.kind) &&
        (providerTag(node.left) || providerTag(node.right))
      )
        report('runtime database switching comparison');
      if (ts.isCaseClause(node) && providerTag(node.expression))
        report('runtime database switching case');
      if (ts.isUnionTypeNode(node) || ts.isArrayLiteralExpression(node)) {
        const items = ts.isUnionTypeNode(node) ? node.types : node.elements;
        if (new Set(items.map(providerTag).filter(Boolean)).size > 1)
          report('database provider union or selection list');
      }
      if (ts.isObjectLiteralExpression(node) || ts.isTypeLiteralNode(node)) {
        const members = ts.isObjectLiteralExpression(node)
          ? node.properties
          : node.members;
        const names = members
          .map((member) => nameOf(member.name))
          .filter((name) => name && databaseNames.has(name));
        if (new Set(names).size > 1)
          report('dual database repository definition or provider registry');
        const parent = node.parent;
        if (
          ts.isObjectLiteralExpression(node) &&
          ts.isPropertyAssignment(parent) &&
          /^(database|db)$/i.test(nameOf(parent.name) ?? '') &&
          node.properties.some(
            (member) =>
              ts.isPropertyAssignment(member) &&
              ['driver', 'provider', 'dialect'].includes(
                nameOf(member.name) ?? '',
              ) &&
              !isSelectedLiteral(member.initializer),
          )
        )
          report('runtime database configuration selector');
      }
      ts.forEachChild(node, inspect);
    };
    inspect(ast);
  }
  return {
    database: selectedDatabase,
    files: files.length,
    lockedPackages,
    failures: [...new Set(failures)].sort(),
  };
}
