import type { RenderedFile } from '../contracts.js';
import { json } from './bundle.js';

const targets = [
  { target: 'install', label: 'VCLI: Install' },
  { target: 'dev', label: 'VCLI: Dev' },
  { target: 'build', label: 'VCLI: Build' },
  { target: 'start', label: 'VCLI: Start' },
  { target: 'check', label: 'VCLI: Check' },
  { target: 'test', label: 'VCLI: Test' },
] as const;

function optionalScaffold(path: string, content: string): RenderedFile {
  return { path, content, ownership: 'scaffold', preserveExisting: true };
}

export function ideFiles(): RenderedFile[] {
  return [
    optionalScaffold(
      '.vscode/tasks.json',
      json({
        version: '2.0.0',
        tasks: targets.map(({ target, label }) => ({
          label,
          type: 'process',
          command: 'make',
          args: [target],
          options: { cwd: '${workspaceFolder}' },
          problemMatcher: [],
        })),
      }),
    ),
    ...targets.map(({ target, label }) =>
      optionalScaffold(
        `.run/vcli-${target}.run.xml`,
        `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="${label}" type="MAKEFILE_TARGET_RUN_CONFIGURATION" factoryName="Makefile">
    <makefile filename="$PROJECT_DIR$/Makefile" target="${target}" workingDirectory="$PROJECT_DIR$" arguments="" />
    <method v="2" />
  </configuration>
</component>
`,
      ),
    ),
  ];
}
