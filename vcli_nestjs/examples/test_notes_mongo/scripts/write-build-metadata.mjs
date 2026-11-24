import { execFileSync } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
const args = process.argv.slice(2);
let sourceCommit = null;
if (args.length) {
  if (
    args.length !== 2 ||
    args[0] !== '--source-commit' ||
    !/^[a-f0-9]{40}$/.test(args[1])
  )
    throw new Error('INVALID_BUILD_METADATA_INPUT');
  sourceCommit = args[1];
} else
  try {
    const git = (...values) =>
      execFileSync('git', values, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    if (git('status', '--porcelain') === '') {
      const commit = git('rev-parse', 'HEAD');
      if (/^[a-f0-9]{40}$/.test(commit)) sourceCommit = commit;
    }
  } catch {
    /* Unversioned local builds have no deployment identity. */
  }
await mkdir('dist', { recursive: true });
const temporary = 'dist/.build-metadata-' + process.pid + '.json';
await writeFile(temporary, JSON.stringify({ schema: 1, sourceCommit }) + '\n', {
  mode: 0o444,
  flag: 'wx',
});
await rename(temporary, 'dist/build-metadata.json');
