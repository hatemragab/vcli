import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import ts from 'typescript';

const mainSourceRoot = resolve('src');
const sourceRoots = [mainSourceRoot, resolve('packages/auth-runtime/src')];
const testRoot = resolve('test');
const kebabFilename = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+)+$/;

async function sources(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink())
      throw new Error('Source symlinks are not supported.');
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sources(path)));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

const files = (await Promise.all(sourceRoots.map(sources))).flat();
const testFiles = await sources(testRoot);
const graph = new Map<string, Set<string>>();
const issues: string[] = [];
const options: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
};

for (const file of [...files, ...testFiles]) {
  if (!kebabFilename.test(basename(file)))
    issues.push(`${relative(resolve('.'), file)}: filename must be kebab-case`);
}

const rootManifest = JSON.parse(await readFile('package.json', 'utf8')) as {
  version: string;
};
const authManifest = JSON.parse(
  await readFile('packages/auth-runtime/package.json', 'utf8'),
) as { version: string };
const contractsSource = await readFile(
  join(mainSourceRoot, 'contracts.ts'),
  'utf8',
);
const toolVersion = /export const TOOL_VERSION = '([^']+)';/.exec(
  contractsSource,
)?.[1];
if (
  !toolVersion ||
  rootManifest.version !== toolVersion ||
  authManifest.version !== toolVersion
)
  issues.push(
    `Version mismatch: root=${rootManifest.version}, auth-runtime=${authManifest.version}, TOOL_VERSION=${toolVersion ?? 'missing'}`,
  );

for (const path of files) {
  const sourceRoot = sourceRoots.find((root) => path.startsWith(`${root}/`))!;
  const local = relative(sourceRoot, path);
  const source = ts.createSourceFile(
    path,
    await readFile(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports = new Set<string>();
  let classes = 0;
  const addImport = (name: string) => {
    if (!name.startsWith('.')) return;
    const target = ts.resolveModuleName(name, path, options, ts.sys)
      .resolvedModule?.resolvedFileName;
    if (!target) issues.push(`${local}: unresolved local import`);
    else if (sourceRoots.some((root) => target.startsWith(`${root}/`))) {
      imports.add(target);
      const targetLocal = relative(sourceRoot, target);
      if (
        local.startsWith('engine/') &&
        !targetLocal.startsWith('engine/') &&
        targetLocal !== 'contracts.ts'
      )
        issues.push(`${local}: engine imports higher-level implementation`);
      if (
        local.startsWith('recipes/') &&
        !targetLocal.startsWith('recipes/') &&
        targetLocal !== 'contracts.ts'
      )
        issues.push(`${local}: recipe imports command/engine implementation`);
      if (
        local.startsWith('deployment/') &&
        !targetLocal.startsWith('deployment/') &&
        !targetLocal.startsWith('recipes/') &&
        targetLocal !== 'contracts.ts'
      )
        issues.push(
          `${local}: deployment imports forbidden layer ${targetLocal}`,
        );
      if (
        local.startsWith('maintenance/') &&
        (targetLocal.startsWith('commands/') ||
          targetLocal.startsWith('deployment/') ||
          targetLocal.startsWith('services/'))
      )
        issues.push(
          `${local}: maintenance imports forbidden layer ${targetLocal}`,
        );
      if (
        local.startsWith('services/') &&
        (targetLocal.startsWith('commands/') ||
          targetLocal.startsWith('deployment/') ||
          targetLocal.startsWith('maintenance/'))
      )
        issues.push(
          `${local}: services imports forbidden layer ${targetLocal}`,
        );
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) classes++;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      addImport(node.moduleSpecifier.text);
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      addImport(node.argument.literal.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    )
      issues.push(`${local}: dynamic loading is prohibited`);
    if (
      ts.isIdentifier(node) &&
      ['forwardRef', 'ModuleRef', 'Global', 'createRequire'].includes(node.text)
    )
      issues.push(`${local}: prohibited cycle/locator escape`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (classes > 1) issues.push(`${local}: more than one handwritten class`);
  graph.set(path, imports);
}
const visited = new Set<string>();
const visiting = new Set<string>();
const stack: string[] = [];
function walk(path: string): void {
  if (visiting.has(path)) {
    issues.push(
      `Import cycle: ${[...stack.slice(stack.indexOf(path)), path].map((file) => relative(mainSourceRoot, file)).join(' -> ')}`,
    );
    return;
  }
  if (visited.has(path)) return;
  visiting.add(path);
  stack.push(path);
  for (const target of graph.get(path) ?? []) walk(target);
  stack.pop();
  visiting.delete(path);
  visited.add(path);
}
for (const path of files) walk(path);
if (issues.length) {
  process.stderr.write(`${issues.join('\n')}\n`);
  process.exitCode = 1;
} else
  process.stdout.write(
    `CLI/auth architecture passed: ${files.length} source files, ${testFiles.length} test files; acyclic, kebab-case, version-synced, one class per file.\n`,
  );
