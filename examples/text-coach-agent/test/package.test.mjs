// Checks the built package the way a runtime and the catalogue would see it.
// Run `pnpm test`, which builds first.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateAgentDefinition } from '@standardagents/spec';

import * as pkg from '../dist/index.js';
import { analyzeText, MAX_INPUT_BYTES } from '../dist/wasm.js';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('the Rust code runs through WebAssembly', () => {
  assert.deepEqual(analyzeText('The cat sat on the mat. It was happy!'), {
    characters: 37,
    words: 9,
    sentences: 2,
    paragraphs: 1,
    syllables: 10,
    longest_sentence_words: 6,
    reading_time_seconds: 3,
    average_words_per_sentence: 4.5,
    flesch_reading_ease: 108.3,
    flesch_kincaid_grade: -0.7,
  });
});

test('text without words has counts and no scores', () => {
  const stats = analyzeText('   \n\n  ');
  assert.equal(stats.words, 0);
  assert.equal(stats.flesch_reading_ease, null);
  assert.equal(analyzeText('').characters, 0);
});

test('non-ASCII text crosses the boundary intact', () => {
  // Four characters, five UTF-8 bytes.
  assert.equal(analyzeText('café').characters, 4);
  assert.equal(analyzeText('日本語 のテキスト。').words, 2);
});

test('repeated and large calls reuse the module and free their memory', () => {
  const paragraph = 'Plain words make a short sentence. ';
  const large = paragraph.repeat(5_000);
  const first = analyzeText(large);
  assert.equal(first.words, 30_000);
  for (let i = 0; i < 200; i += 1) {
    assert.deepEqual(analyzeText(large), first);
  }
});

test('oversized text is refused before it reaches the module', () => {
  assert.throws(() => analyzeText('a'.repeat(MAX_INPUT_BYTES + 1)), RangeError);
});

test('the tool returns the statistics as JSON', async () => {
  const tool = await pkg.tools.analyze_text();
  assert.ok(tool.description.length > 0);

  const ok = await tool.execute({}, { text: 'One short sentence.' });
  assert.equal(ok.status, 'success');
  assert.equal(JSON.parse(ok.result).words, 3);

  // The schema is what a runtime validates the model's arguments against.
  assert.equal(tool.args.safeParse({ text: '' }).success, false);
  assert.equal(tool.args.safeParse({ text: 'a'.repeat(100_001) }).success, false);
  assert.equal(tool.args.safeParse({}).success, false);

  // If a runtime skips validation, the tool reports an error and does not throw.
  const tooLarge = await tool.execute({}, { text: 'a'.repeat(MAX_INPUT_BYTES + 1) });
  assert.equal(tooLarge.status, 'error');
});

test('every registry entry loads', async () => {
  for (const registry of ['agents', 'prompts', 'tools', 'models', 'handlers', 'hooks']) {
    assert.equal(typeof pkg[registry], 'object', `${registry} is exported`);
    for (const [name, load] of Object.entries(pkg[registry])) {
      assert.ok(await load(), `${registry}.${name} loads`);
    }
  }
});

test('the definitions refer only to names inside the package', async () => {
  const agent = await pkg.agents.text_coach();
  assert.deepEqual(validateAgentDefinition(agent), []);
  assert.equal(agent.exposeAsTool, true);

  const prompt = await pkg.prompts[agent.sideA.prompt]();
  assert.ok(prompt.model in pkg.models, `model "${prompt.model}" is in the package`);
  for (const tool of prompt.tools) {
    assert.ok(tool in pkg.tools, `tool "${tool}" is in the package`);
  }

  const model = await pkg.models[prompt.model]();
  assert.equal(model.name, prompt.model);
});

test('__meta agrees with package.json', () => {
  assert.equal(pkg.__meta.packageId, manifest.name);
  assert.equal(pkg.__meta.version, manifest.version);
  assert.deepEqual(pkg.__meta.entryAgents, manifest.standardagent.entryAgents);
  for (const name of pkg.__meta.entryAgents) {
    assert.ok(name in pkg.agents, `entry agent "${name}" is exported`);
  }
});

test('the manifest carries what the catalogue looks for', () => {
  // The same two markers that src/lib/npm.ts in this repository requires.
  assert.ok(manifest.keywords.includes('standardagent'));
  assert.ok(manifest.standardagent.entryAgents.length > 0);
  assert.match(manifest.name, /^standardagent-/);
  assert.ok(manifest.peerDependencies['@standardagents/spec']);
});
