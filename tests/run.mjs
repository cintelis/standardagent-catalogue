// Runs the tests: builds the site from tests/fixtures into dist-test/, then
// checks the result. A script instead of a shell one-liner, so that it works
// the same in every shell, including cmd and PowerShell on Windows.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'astro';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);

// src/lib/npm.ts reads saved registry responses from this folder instead of
// the network.
process.env.CATALOGUE_FIXTURES = 'tests/fixtures';
await build({ root, outDir: 'dist-test' });

// Node expands the pattern itself, so it does not depend on the shell.
const { status } = spawnSync(process.execPath, ['--test', 'tests/*.test.mjs'], {
  stdio: 'inherit',
});
process.exit(status ?? 1);
