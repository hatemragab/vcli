import { readdir, readFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export type ArchitectureResult = Readonly<{
  files: number;
  imports: number;
  modules: readonly string[];
  failures: readonly string[];
}>;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await sourceFiles(file)));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts'))
      result.push(file);
  }
  return result.sort();
}

function cycles(graph: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  const active = new Set<string>();
  const done = new Set<string>();
  const path: string[] = [];
  const result: string[][] = [];
  const visit = (node: string): void => {
    if (active.has(node)) {
      result.push([...path.slice(path.indexOf(node)), node]);
      return;
    }
    if (done.has(node)) return;
    active.add(node);
    path.push(node);
    for (const dependency of [...(graph.get(node) ?? [])].sort())
      visit(dependency);
    path.pop();
    active.delete(node);
    done.add(node);
  };
  for (const node of [...graph.keys()].sort()) visit(node);
  return result;
}

/** Includes type-only edges: moving an import into a type or barrel cannot hide a cycle. */
export async function checkArchitecture(
  sourceDirectory: string,
): Promise<ArchitectureResult> {
  const root = resolve(sourceDirectory);
  const files = await sourceFiles(root);
  const known = new Set(files);
  const graph = new Map(files.map((file) => [file, new Set<string>()]));
  const moduleGraph = new Map<string, Set<string>>();
  const failures: string[] = [];
  const label = (file: string) => relative(root, file).split(sep).join('/');
  const owner = (file: string) => /^modules\/([^/]+)\//.exec(label(file))?.[1];
  const configFile = ts.findConfigFile(dirname(root), ts.sys.fileExists);
  let options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  };
  if (configFile) {
    const config = ts.readConfigFile(configFile, ts.sys.readFile);
    if (config.error) throw new Error('ARCHITECTURE_CONFIG_INVALID');
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      dirname(configFile),
    );
    if (parsed.errors.length) throw new Error('ARCHITECTURE_CONFIG_INVALID');
    options = parsed.options;
  }
  let imports = 0;
  for (const file of files) {
    const module = owner(file);
    if (module && !moduleGraph.has(module)) moduleGraph.set(module, new Set());
    const source = await readFile(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    let classes = 0;
    const addImport = (specifier: string): void => {
      if (isBuiltin(specifier)) return;
      const resolved = ts.resolveModuleName(
        specifier,
        file,
        options,
        ts.sys,
      ).resolvedModule;
      if (!resolved) {
        failures.push(`${label(file)}: unresolved import ${specifier}`);
        return;
      }
      const target = resolve(resolved.resolvedFileName);
      if (!known.has(target)) {
        if (!resolved.isExternalLibraryImport)
          failures.push(
            `${label(file)}: import escapes checked source: ${specifier}`,
          );
        return;
      }
      imports++;
      graph.get(file)!.add(target);
      const targetOwner = owner(target);
      if (module && targetOwner && module !== targetOwner) {
        const edges = moduleGraph.get(module)!;
        edges.add(targetOwner);
        if (!moduleGraph.has(targetOwner))
          moduleGraph.set(targetOwner, new Set());
      }
      if (label(file).startsWith('core/') && !label(target).startsWith('core/'))
        failures.push(`${label(file)}: core cannot import ${label(target)}`);
      if (module && !targetOwner && !label(target).startsWith('core/'))
        failures.push(
          `${label(file)}: feature cannot import root composition ${label(target)}`,
        );
    };
    const inspect = (node: ts.Node): void => {
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
      if (ts.isImportEqualsDeclaration(node))
        failures.push(`${label(file)}: import-equals dependency is prohibited`);
      if (
        ts.isIdentifier(node) &&
        [
          'forwardRef',
          'ModuleRef',
          'LazyModuleLoader',
          'Global',
          'createRequire',
        ].includes(node.text)
      )
        failures.push(
          `${label(file)}: prohibited dependency shortcut ${node.text}`,
        );
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === 'require'))
      )
        failures.push(
          `${label(file)}: dynamic dependency loading is prohibited`,
        );
      ts.forEachChild(node, inspect);
    };
    inspect(ast);
    if (classes > 1)
      failures.push(`${label(file)}: ${classes} handwritten classes`);
    if (/^modules\/[^/]+\/.+\//.test(label(file)))
      failures.push(`${label(file)}: feature directories must remain flat`);
  }
  for (const cycle of cycles(graph))
    failures.push(`File import cycle: ${cycle.map(label).join(' -> ')}`);
  for (const cycle of cycles(moduleGraph))
    failures.push(`Feature dependency cycle: ${cycle.join(' -> ')}`);
  return {
    files: files.length,
    imports,
    modules: [...moduleGraph.keys()].sort(),
    failures: [...new Set(failures)].sort(),
  };
}
