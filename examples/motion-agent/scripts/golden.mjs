// Writes test/fixtures/expected from test/fixtures/specs: the SVG and the check
// report for a spec that builds, or the error message for one that does not.
//
//   pnpm golden
//
// The tests compare what the engine makes with these files, byte for byte, so
// that a change to the output is seen and not slipped in. Run this after a
// change that is meant to alter the output, and read the difference before
// you commit it.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createAnimation, MotionSpecError } from '../dist/engine/index.js';

const fixtures = fileURLToPath(new URL('../test/fixtures/', import.meta.url));
rmSync(`${fixtures}expected`, { recursive: true, force: true });
mkdirSync(`${fixtures}expected`, { recursive: true });

for (const file of readdirSync(`${fixtures}specs`).sort()) {
  const name = file.replace(/\.json$/, '');
  const spec = JSON.parse(readFileSync(`${fixtures}specs/${file}`, 'utf8'));
  try {
    const { svg, check } = createAnimation(spec);
    writeFileSync(`${fixtures}expected/${name}.svg`, svg);
    writeFileSync(`${fixtures}expected/${name}.check.json`, `${JSON.stringify(check, null, 2)}\n`);
    console.log(`${name}: ${check.bytes} bytes, ${check.errors} error(s), ${check.warnings} warning(s)`);
  } catch (error) {
    if (!(error instanceof MotionSpecError)) throw error;
    writeFileSync(`${fixtures}expected/${name}.error.txt`, `${error.message}\n`);
    console.log(`${name}: refused, ${error.message.split('\n').length} problem(s)`);
  }
}
