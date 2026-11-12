// Loads the built package the way a runtime would, then calls the
// create_diagram tool directly and saves the picture it attaches. It needs no
// model and no API key.
//
//   pnpm build
//   pnpm demo                                        # the order-flow example
//   pnpm demo test/fixtures/specs/05-problems.json   # any spec file
//
// Open the file it writes in a browser, or in draw.io to edit it.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as pkg from '../dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const specPath = process.argv[2] ?? `${root}test/fixtures/specs/01-order-flow.json`;
const spec = JSON.parse(readFileSync(specPath, 'utf8'));

const agent = await pkg.agents.diagram_designer();
const prompt = await pkg.prompts[agent.sideA.prompt]();
console.log(`Package   ${pkg.__meta.packageId}@${pkg.__meta.version}`);
console.log(`Agent     ${agent.name}: side A runs the "${prompt.name}" prompt, side B is a person`);
console.log(`Tools     ${prompt.tools.join(', ')}`);
console.log(`Spec      ${specPath}`);

const tool = await pkg.tools.create_diagram();
const parsed = tool.args.safeParse({ name: basename(specPath, '.json'), ...spec });
if (!parsed.success) {
  // What a runtime does with arguments that do not match the tool's schema.
  console.log('\nThe arguments do not match the tool schema:');
  for (const issue of parsed.error.issues) {
    console.log(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const result = await tool.execute({}, parsed.data);
console.log(`\nStatus    ${result.status}`);
if (result.status !== 'success') {
  console.log(result.error);
  process.exit(1);
}

const { file, check } = JSON.parse(result.result);
console.log(`Check     ${check.errors} error(s), ${check.warnings} warning(s), ${check.cells} cells`);
for (const issue of check.issues) {
  console.log(`  ${issue.severity} ${issue.code} ${issue.cell}: ${issue.message}`);
}

// The attachment is base64. The file name comes from the tool, which builds
// it from a hash and a slug, so it cannot name a path outside out/.
mkdirSync(`${root}out`, { recursive: true });
const out = `${root}out/${file}`;
writeFileSync(out, Buffer.from(result.attachments[0].data, 'base64'));
console.log(`\nWrote     ${out}`);
