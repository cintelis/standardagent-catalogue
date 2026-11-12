// Loads the built package the way a runtime would, then calls the tool
// directly. It needs no model and no API key: it shows the path from the
// package entry point, through the TypeScript tool, into the Rust code.
//
//   pnpm build
//   pnpm demo "Some text to measure."

import * as pkg from '../dist/index.js';

const text =
  process.argv.slice(2).join(' ') ||
  'Notwithstanding the aforementioned considerations, the committee subsequently ' +
    'determined that implementation of the recommendations would necessitate ' +
    'additional deliberation. We will meet again on Friday.';

console.log(`Package   ${pkg.__meta.packageId}@${pkg.__meta.version}`);
console.log(`Entry     ${pkg.__meta.entryAgents.join(', ')}`);

const agent = await pkg.agents.text_coach();
const prompt = await pkg.prompts[agent.sideA.prompt]();
const model = await pkg.models[prompt.model]();
console.log(`Agent     ${agent.name}: side A runs the "${prompt.name}" prompt, side B is a person`);
console.log(`Model     ${model.name} -> ${model.model}`);
console.log(`Tools     ${prompt.tools.join(', ')}`);

const tool = await pkg.tools.analyze_text();
const args = tool.args.parse({ text });
const result = await tool.execute({}, args);

console.log(`\nText      ${JSON.stringify(text)}`);
console.log(`Status    ${result.status}`);
if (result.status === 'success') {
  console.log(JSON.stringify(JSON.parse(result.result), null, 2));
} else {
  console.log(result.error);
  process.exitCode = 1;
}
