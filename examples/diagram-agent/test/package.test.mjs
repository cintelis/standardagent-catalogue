// Checks the built package the way a runtime and the catalogue would see it.
// Run `pnpm test`, which builds first.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateAgentDefinition } from '@standardagents/spec';

import * as pkg from '../dist/index.js';
import { EDGE_STYLES, KINDS, ZONE_COLOURS, slugify } from '../dist/tools/create_diagram.js';
import { createDiagram, DiagramSpecError, MAX_REQUEST_BYTES, specReference } from '../dist/wasm.js';

const fixtures = new URL('./fixtures/', import.meta.url);
const read = (path) => readFileSync(new URL(path, fixtures), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const specNames = readdirSync(new URL('specs/', fixtures))
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -'.json'.length))
  .sort();

const orderFlow = { name: 'Order flow', ...JSON.parse(read('specs/01-order-flow.json')) };

test('the WebAssembly module gives the same output as the Python drawgen package', () => {
  assert.ok(specNames.length >= 8);
  for (const name of specNames) {
    const spec = JSON.parse(read(`specs/${name}.json`));
    let created;
    try {
      created = createDiagram(spec, name);
    } catch (error) {
      assert.ok(error instanceof DiagramSpecError, `${name}: ${error}`);
      assert.equal(error.message, read(`expected/${name}.error.txt`), `${name}: error message`);
      continue;
    }
    assert.equal(created.xml, read(`expected/${name}.drawio`), `${name}: drawio XML`);
    assert.deepEqual(created.check, JSON.parse(read(`expected/${name}.check.json`)), `${name}: check report`);
    created.svgs.forEach((svg, i) => {
      assert.equal(svg, read(`expected/${name}.p${i + 1}.svg`), `${name}: SVG page ${i + 1}`);
    });
  }
});

test('the checker reports each kind of layout problem', () => {
  const { check } = createDiagram(JSON.parse(read('specs/05-problems.json')), 'problems');
  const codes = new Set(check.issues.map((issue) => issue.code));
  for (const code of ['overlap', 'out-of-page', 'edge-through-shape', 'label-overflow']) {
    assert.ok(codes.has(code), `reports ${code}`);
  }
  assert.ok(check.errors > 0 && check.warnings > 0);
});

test('the SVG embeds the diagram, so draw.io can open it', () => {
  const { xml, svgs } = createDiagram(JSON.parse(read('specs/09-unicode.json')), 'unicode');
  const content = /<svg\b[^>]*\scontent="([^"]*)"/s.exec(svgs[0])[1];
  const unescaped = content
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
  assert.equal(unescaped, xml);
});

test('text from a spec is escaped and never becomes markup', () => {
  const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'';
  const { xml, svgs } = createDiagram(
    {
      title: hostile,
      subtitle: hostile,
      nodes: [{ id: hostile, label: hostile, sub: hostile, x: 40, y: 120, w: 400 }],
      texts: [{ id: 't', label: hostile, x: 40, y: 300, colour: '"><script>', align: '"><script>' }],
      edges: [{ from: hostile, to: 't', label: hostile, arrow: '"><script>' }],
    },
    'hostile',
  );
  for (const output of [xml, svgs[0]]) {
    assert.doesNotMatch(output, /<script/i);
    assert.doesNotMatch(output, /<img/i);
  }
});

test('an oversized request is refused before it reaches the module', () => {
  assert.throws(() => createDiagram({ title: 'a'.repeat(MAX_REQUEST_BYTES) }, 'big'), RangeError);
});

test('repeated calls reuse the module and free their memory', () => {
  const spec = JSON.parse(read('specs/02-auto-right.json'));
  const first = createDiagram(spec, 'again');
  for (let i = 0; i < 300; i += 1) {
    assert.equal(createDiagram(spec, 'again').xml, first.xml);
  }
});

test('the spec_reference tool returns the format and the theme', async () => {
  const tool = await pkg.tools.spec_reference();
  const result = await tool.execute({});
  assert.equal(result.status, 'success');
  const reference = JSON.parse(result.result);
  assert.match(reference.spec_format, /title\s+required/);
  assert.deepEqual(reference, specReference());
});

test('the tool schema lists the same names as the Rust theme', () => {
  const reference = specReference();
  assert.deepEqual([...KINDS], reference.kinds.map((kind) => kind.kind));
  assert.deepEqual([...ZONE_COLOURS], reference.zone_colours);
  assert.deepEqual([...EDGE_STYLES], reference.edge_styles.map((style) => style.style));
});

test('the create_diagram tool returns a check report and attaches the SVG', async () => {
  const tool = await pkg.tools.create_diagram();
  const result = await tool.execute({}, tool.args.parse(orderFlow));
  assert.equal(result.status, 'success');

  const report = JSON.parse(result.result);
  assert.match(report.file, /^[0-9a-f]{8}-order-flow\.drawio\.svg$/);
  assert.equal(report.check.path, report.file);
  assert.equal(report.check.errors, 0);

  assert.equal(result.attachments.length, 1);
  const [attachment] = result.attachments;
  assert.equal(attachment.name, report.file);
  assert.equal(attachment.mimeType, 'image/svg+xml');
  // The schema passes the spec through unchanged, so the picture is the one
  // the Python package draws.
  assert.equal(Buffer.from(attachment.data, 'base64').toString('utf8'), read('expected/01-order-flow.p1.svg'));

  // The same diagram gets the same file name; a changed one gets a new name.
  const again = await tool.execute({}, tool.args.parse(orderFlow));
  assert.equal(JSON.parse(again.result).file, report.file);
  const changed = await tool.execute({}, tool.args.parse({ ...orderFlow, subtitle: 'Changed' }));
  assert.notEqual(JSON.parse(changed.result).file, report.file);
});

test('the create_diagram tool reports a bad spec as an error the model can fix', async () => {
  const tool = await pkg.tools.create_diagram();
  const args = tool.args.parse({
    name: 'bad',
    title: 'Bad',
    nodes: [{ id: 'a', label: 'A' }],
    edges: [{ from: 'a', to: 'nowhere' }],
  });
  const result = await tool.execute({}, args);
  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'invalid_spec');
  assert.match(result.error, /spec\.nodes\[0\]: no x\/y; add coordinates or set layout: auto on the page/);
  assert.match(result.error, /spec\.edges\[0\]\.to: no node, zone, entity or text has id 'nowhere'/);
  assert.equal(result.attachments, undefined);
});

test('the argument schema bounds what one call can ask for', async () => {
  const { args } = await pkg.tools.create_diagram();
  const ok = (value) => args.safeParse(value).success;
  assert.equal(ok(orderFlow), true);
  assert.equal(ok({ title: 'No name' }), false);
  assert.equal(ok({ name: 'n', title: 'T', nodes: [{ id: 'a', label: 'A', kind: 'server' }] }), false);
  assert.equal(ok({ name: 'n', title: 'T', nodes: [{ id: 'a', label: 'A', x: 1e9, y: 0 }] }), false);
  assert.equal(ok({ name: 'n', title: 'T', nodes: [{ id: 'a', label: 'a'.repeat(301), x: 0, y: 0 }] }), false);
  const many = Array.from({ length: 201 }, (_, i) => ({ id: `n${i}`, label: 'N' }));
  assert.equal(ok({ name: 'n', title: 'T', layout: 'auto', nodes: many }), false);
});

test('a file name is made only of lower-case letters, digits, and hyphens', () => {
  assert.equal(slugify('Order flow'), 'order-flow');
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
  assert.equal(slugify('***'), 'diagram');
  assert.match(slugify('x'.repeat(200)), /^x{48}$/);
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
  const agent = await pkg.agents.diagram_designer();
  assert.deepEqual(validateAgentDefinition(agent), []);
  assert.equal(agent.exposeAsTool, true);

  const prompt = await pkg.prompts[agent.sideA.prompt]();
  assert.ok(prompt.model in pkg.models, `model "${prompt.model}" is in the package`);
  for (const tool of prompt.tools) {
    assert.ok(tool in pkg.tools, `tool "${tool}" is in the package`);
  }
  assert.equal((await pkg.models[prompt.model]()).name, prompt.model);
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
