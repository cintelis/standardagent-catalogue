// Tests the built package in dist/, the way a runtime would load it.
// `pnpm test` builds first. No test needs a model or an API key.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateAgentDefinition } from '@standardagents/spec';

import * as pkg from '../dist/index.js';
import { createAnimation, MAX_SVG_BYTES, MotionSpecError } from '../dist/engine/index.js';
import { computeMotion, simplify } from '../dist/engine/motion.js';
import { EASES, LIMITS, parseSpec, PROPERTIES, SHAPE_TYPES } from '../dist/engine/spec.js';
import { MAX_REPORTED_ISSUES, slugify } from '../dist/tools/create_animation.js';

const fixtures = new URL('./fixtures/', import.meta.url);
const read = (path) => readFileSync(new URL(path, fixtures), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const specNames = readdirSync(new URL('specs/', fixtures))
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -'.json'.length))
  .sort();
const spec = (name) => JSON.parse(read(`specs/${name}.json`));

/** A small spec that is right, to change one thing in. */
const dot = (extra = {}, steps = [{ targets: ['d'], to: { x: 150 }, duration: 600 }, { targets: ['d'], to: { x: 50 }, duration: 600 }]) => ({
  title: 'A dot',
  width: 200,
  height: 100,
  shapes: [{ id: 'd', type: 'circle', x: 50, y: 50, r: 10, ...extra }],
  steps,
});

test('every spec gives the file and the report that were checked in', () => {
  assert.ok(specNames.length >= 5);
  const expected = readdirSync(new URL('expected/', fixtures));
  for (const name of specNames) {
    let created;
    try {
      created = createAnimation(spec(name));
    } catch (error) {
      assert.ok(error instanceof MotionSpecError, `${name}: ${error}`);
      assert.equal(`${error.message}\n`, read(`expected/${name}.error.txt`), `${name}: error message`);
      continue;
    }
    assert.equal(created.svg, read(`expected/${name}.svg`), `${name}: SVG`);
    assert.deepEqual(created.check, JSON.parse(read(`expected/${name}.check.json`)), `${name}: check report`);
  }
  // No expected file is left over from a spec that is gone.
  for (const file of expected) {
    assert.ok(specNames.includes(file.replace(/\.(svg|check\.json|error\.txt)$/, '')), `${file} has a spec`);
  }
});

test('the same spec gives the same file every time', () => {
  const first = createAnimation(spec('02-logo-reveal')).svg;
  for (let i = 0; i < 5; i++) assert.equal(createAnimation(spec('02-logo-reveal')).svg, first);
});

test('Anime.js does the timing, with no browser', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');

  // A stagger of 100ms: the second dot is 100ms behind the first.
  const scene = parseSpec({
    title: 'Two dots',
    shapes: [
      { id: 'a', type: 'circle', x: 0, y: 0, r: 5 },
      { id: 'b', type: 'circle', x: 0, y: 0, r: 5 },
    ],
    steps: [{ targets: ['a', 'b'], to: { x: 100 }, duration: 400, ease: 'linear', stagger: 100 }],
  });
  const motion = computeMotion(scene);
  assert.equal(motion.duration, 500);
  const at = (track, ms) => track[Math.round((ms / 500) * (motion.times.length - 1))];
  assert.ok(Math.abs(at(motion.tracks[0].x, 200) - 50) < 1, 'the first dot is half way at 200ms');
  assert.ok(Math.abs(at(motion.tracks[1].x, 200) - 25) < 1, 'the second is a quarter of the way');
  assert.equal(motion.tracks[1].x.at(-1), 100);

  // An elastic ease goes past its end and comes back, which a linear one never does.
  const elastic = computeMotion(parseSpec(dot({}, [{ targets: ['d'], to: { x: 150 }, duration: 800, ease: 'outElastic' }])));
  assert.ok(Math.max(...elastic.tracks[0].x) > 151, 'outElastic overshoots');
});

test('a step with no "at" starts when every step before it has ended', () => {
  const motion = computeMotion(
    parseSpec({
      title: 'In order',
      shapes: [
        { id: 'a', type: 'circle', x: 0, y: 0, r: 5 },
        { id: 'b', type: 'circle', x: 0, y: 0, r: 5 },
      ],
      steps: [
        { targets: ['a'], to: { x: 10 }, duration: 1000, ease: 'linear' },
        { targets: ['b'], to: { x: 10 }, duration: 200, ease: 'linear', at: 0 },
        { targets: ['b'], to: { x: 0 }, duration: 500, ease: 'linear' },
      ],
    }),
  );
  // The third step waits for the first, which ends at 1000ms, not for the second.
  assert.equal(motion.duration, 1500);
});

test('keyframes that a straight line already covers are left out', () => {
  const times = Array.from({ length: 31 }, (_, i) => i / 30);
  const straight = times.map((t) => t * 100);
  assert.deepEqual(simplify(times, [straight], 0.25), [0, 30]);

  const corner = times.map((t) => (t < 0.5 ? t * 200 : 100));
  assert.deepEqual(simplify(times, [corner], 0.25), [0, 15, 30]);

  // A linear move is two keyframes in the file, whatever its length.
  const { svg, check } = createAnimation(dot({}, [{ targets: ['d'], to: { x: 150 }, duration: 5000, ease: 'linear' }]));
  assert.equal(check.keyframes, 2);
  assert.match(svg, /values="50 50;150 50" keyTimes="0;1" dur="5s"/);
});

test('the file is an SVG that plays without script', () => {
  const { svg, check } = createAnimation(spec('02-logo-reveal'));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 480 200"/);
  assert.match(svg, /<title>The catalogue logo assembles, and its name fades in<\/title>/);
  assert.match(svg, /<animateTransform attributeName="transform" type="scale"/);
  assert.match(svg, /<animate attributeName="opacity"/);
  assert.match(svg, /<animate attributeName="stroke-dashoffset"/);
  // Played once: the last frame stays.
  assert.match(svg, /fill="freeze"/);
  assert.doesNotMatch(svg, /repeatCount/);
  for (const never of [/<script/i, /<style/i, /\son[a-z]+=/i, /href=/i, /<foreignObject/i, /javascript:/i]) {
    assert.doesNotMatch(svg, never);
  }
  assert.equal(check.bytes, Buffer.byteLength(svg));
  assert.equal(check.duration_ms, 1600);

  // A loop repeats, and every animation in it has the same length.
  const loop = createAnimation(spec('01-loading-dots')).svg;
  assert.match(loop, /repeatCount="indefinite"/);
  assert.deepEqual([...new Set([...loop.matchAll(/dur="([^"]+)"/g)].map((m) => m[1]))], ['1.24s']);
});

test('text from a spec is escaped and never becomes markup', () => {
  const { svg } = createAnimation(spec('04-hostile'));
  assert.doesNotMatch(svg, /<script/i);
  assert.doesNotMatch(svg, /<img/i);
  assert.match(svg, /&lt;script&gt;alert\(&#39;text&#39;\)&lt;\/script&gt;/);
  assert.match(svg, /aria-label="&lt;\/title&gt;&lt;script&gt;/);
  // The only elements are the ones the engine writes.
  const tags = new Set([...svg.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]));
  for (const tag of tags) {
    assert.ok(['svg', 'title', 'g', 'rect', 'circle', 'line', 'path', 'text', 'animate', 'animateTransform'].includes(tag), tag);
  }
});

test('a value cannot add markup or attributes of its own', () => {
  const refused = [
    [dot({ fill: '#000" onload="alert(1)' }), /spec\.shapes\[0\]\.fill/],
    [dot({ stroke: 'url(#x)' }), /spec\.shapes\[0\]\.stroke/],
    [dot({ id: 'a"><script>' }), /spec\.shapes\[0\]\.id/],
    [{ ...dot(), background: 'javascript:alert(1)' }, /spec\.background/],
    [
      { title: 'P', shapes: [{ id: 'p', type: 'path', d: 'M 0 0 L 9 9" onload="alert(1)', stroke: '#000000' }] },
      /spec\.shapes\[0\]\.d/,
    ],
    [{ title: 'T', shapes: [{ id: 't', type: 'text', x: 0, y: 0, text: 'hi', font: 'x" onload="y' }] }, /\.font/],
  ];
  for (const [bad, where] of refused) {
    assert.throws(() => createAnimation(bad), (error) => {
      assert.ok(error instanceof MotionSpecError);
      assert.match(error.message, where);
      return true;
    });
  }
});

test('the checker reports each kind of problem', () => {
  const { check } = createAnimation(spec('03-problems'));
  const found = Object.fromEntries(check.issues.map((issue) => [issue.code, issue]));
  assert.equal(found['never-visible'].shape, 'lost');
  assert.equal(found['never-visible'].severity, 'error');
  assert.equal(found['loop-jump'].shape, 'jumper');
  assert.match(found['loop-jump'].message, /x ends at 260 and starts at 40/);
  assert.equal(found.flashing.shape, 'strobe');
  assert.equal(found.flashing.severity, 'error');
  assert.equal(check.errors, 2);
  assert.equal(check.warnings, 1);
  // A full turn ends where it began, so the spinner does not jump.
  assert.ok(!check.issues.some((issue) => issue.shape === 'spinner'));

  const codes = (value) => createAnimation(value).check.issues.map((issue) => issue.code);
  assert.deepEqual(codes(dot({}, [])), ['no-motion']);
  assert.deepEqual(codes(dot({}, [{ targets: ['d'], to: { x: 60 }, duration: 100 }, { targets: ['d'], to: { x: 50 }, duration: 100 }])), ['too-short']);
  assert.deepEqual(codes({ ...dot({}, [{ targets: ['d'], to: { x: 400 }, duration: 600 }]), loop: false }), ['ends-off-canvas']);
  assert.deepEqual(codes(dot({ opacity: 0 }, [{ targets: ['d'], to: { x: 60 }, duration: 600 }, { targets: ['d'], to: { x: 50 }, duration: 600 }])), ['never-visible']);
  // A clean animation has nothing to report.
  assert.deepEqual(codes(dot()), []);
});

test('a spec that cannot be drawn is refused with every problem named', () => {
  assert.throws(() => createAnimation(spec('05-errors')), (error) => {
    assert.ok(error instanceof MotionSpecError);
    const lines = error.message.split('\n');
    assert.ok(lines.length >= 15);
    // Each line starts with where the problem is.
    for (const line of lines) assert.match(line, /^spec(\.|:)/);
    return true;
  });
  for (const bad of [null, 'text', 42, [], {}]) {
    assert.throws(() => createAnimation(bad), MotionSpecError);
  }
});

test('one call cannot ask for unbounded work', async () => {
  const { args } = await pkg.tools.create_animation();
  const ok = (value) => args.safeParse(value).success;
  const base = { name: 'n', ...dot() };
  assert.equal(ok(base), true);
  assert.equal(ok({ ...dot() }), false, 'a name is required');
  assert.equal(ok({ ...base, width: 5000 }), false);
  assert.equal(ok({ ...base, shapes: [] }), false);
  assert.equal(ok({ ...base, shapes: Array.from({ length: LIMITS.maxShapes + 1 }, (_, i) => ({ id: `s${i}`, type: 'circle', x: 0, y: 0, r: 1 })) }), false);
  assert.equal(ok({ ...base, steps: Array.from({ length: LIMITS.maxSteps + 1 }, () => ({ targets: ['d'], to: { x: 1 } })) }), false);
  assert.equal(ok({ ...base, steps: [{ targets: ['d'], to: { x: 1 }, duration: LIMITS.maxDuration + 1 }] }), false);
  assert.equal(ok({ ...base, steps: [{ targets: ['d'], to: { x: 1 }, ease: 'wobble' }] }), false);

  // The largest spec the schema lets through is worked out in seconds, and
  // then refused, because the file would be over the size limit. A tool call
  // can never cost more time or return more bytes than that.
  const shapes = Array.from({ length: LIMITS.maxShapes }, (_, i) => ({ id: `s${i}`, type: 'rect', x: (i % 12) * 30, y: Math.floor(i / 12) * 20, w: 20, h: 12 }));
  const ids = shapes.map((shape) => shape.id);
  const steps = Array.from({ length: LIMITS.maxSteps }, (_, i) => ({
    targets: ids,
    to: i % 2 ? { x: 10, y: 10, scale: 1, rotate: 0, opacity: 1 } : { x: 300, y: 200, scale: 2, rotate: 720, opacity: 0.3 },
    duration: 120,
    ease: 'outElastic',
    stagger: 1,
  }));
  const worst = { name: 'worst', title: 'Everything at once', shapes, steps };
  assert.equal(ok(worst), true, 'the schema lets it through');
  const tool = await pkg.tools.create_animation();
  const started = performance.now();
  const result = await tool.execute({}, args.parse(worst));
  assert.ok(performance.now() - started < 20_000, 'it is worked out in seconds');
  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'invalid_spec');
  assert.match(result.error, /the most is 1500 kB/);
  assert.equal(result.attachments, undefined);

  // A tenth of that builds, well under the limit.
  const { check } = createAnimation({ title: 'A crowd', shapes: shapes.slice(0, 40), steps: steps.slice(0, 20).map((step) => ({ ...step, targets: ids.slice(0, 40) })) });
  assert.ok(check.bytes < MAX_SVG_BYTES / 2, `${check.bytes} bytes`);
});

test('the create_animation tool returns a check report and attaches the SVG', async () => {
  const tool = await pkg.tools.create_animation();
  const result = await tool.execute({}, tool.args.parse({ name: 'Logo reveal', ...spec('02-logo-reveal') }));
  assert.equal(result.status, 'success');

  const report = JSON.parse(result.result);
  assert.match(report.file, /^[0-9a-f]{8}-logo-reveal\.svg$/);
  assert.equal(report.check.errors, 0);
  assert.equal(report.check.duration_ms, 1600);

  assert.equal(result.attachments.length, 1);
  const [attachment] = result.attachments;
  assert.equal(attachment.name, report.file);
  assert.equal(attachment.mimeType, 'image/svg+xml');
  // The schema passes the spec through unchanged, so the file is the one the engine makes.
  assert.equal(Buffer.from(attachment.data, 'base64').toString('utf8'), read('expected/02-logo-reveal.svg'));

  // The same animation gets the same file name; a changed one gets a new name.
  const again = await tool.execute({}, tool.args.parse({ name: 'Logo reveal', ...spec('02-logo-reveal') }));
  assert.equal(JSON.parse(again.result).file, report.file);
  const changed = await tool.execute({}, tool.args.parse({ name: 'Logo reveal', ...spec('02-logo-reveal'), background: '#000000' }));
  assert.notEqual(JSON.parse(changed.result).file, report.file);
});

test('the create_animation tool reports a bad spec as an error the model can fix', async () => {
  const tool = await pkg.tools.create_animation();
  const args = tool.args.parse({
    name: 'bad',
    title: 'Bad',
    shapes: [{ id: 'a', type: 'rect', x: 0, y: 0 }],
    steps: [{ targets: ['nobody'], to: { x: 1 } }],
  });
  const result = await tool.execute({}, args);
  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'invalid_spec');
  assert.match(result.error, /spec\.shapes\[0\]\.w: required/);
  assert.match(result.error, /spec\.steps\[0\]\.targets\[0\]: no shape has the id "nobody"/);
  assert.equal(result.attachments, undefined);
});

test('the create_animation tool keeps a long check report short', async () => {
  const tool = await pkg.tools.create_animation();
  // Every shape is off the canvas, so each one is an issue.
  const shapes = Array.from({ length: LIMITS.maxShapes }, (_, i) => ({ id: `s${i}`, type: 'circle', x: -500, y: -500, r: 5 }));
  const result = await tool.execute({}, tool.args.parse({ name: 'lost', title: 'All lost', shapes }));
  const { check } = JSON.parse(result.result);
  assert.equal(check.errors, LIMITS.maxShapes);
  assert.equal(check.issues.length, MAX_REPORTED_ISSUES);
  assert.equal(check.omitted.count, check.errors + check.warnings - MAX_REPORTED_ISSUES);
  assert.ok(result.result.length < 20_000);
});

test('the motion_reference tool returns the format and the names', async () => {
  const tool = await pkg.tools.motion_reference();
  const result = await tool.execute({}, {});
  assert.equal(result.status, 'success');
  const reference = JSON.parse(result.result);
  assert.deepEqual(reference.shape_types, [...SHAPE_TYPES]);
  assert.deepEqual(reference.properties, [...PROPERTIES]);
  assert.deepEqual(reference.eases, [...EASES]);
  assert.match(reference.spec_format, /"steps"/);
  // The example in the reference is a spec that builds without a single issue.
  const example = JSON.parse(reference.spec_format.slice(reference.spec_format.indexOf('{"name"'), reference.spec_format.lastIndexOf('}') + 1));
  const create = await pkg.tools.create_animation();
  const built = await create.execute({}, create.args.parse(example));
  assert.equal(built.status, 'success');
  assert.deepEqual(JSON.parse(built.result).check.issues, []);
});

test('a file name is made only of lower-case letters, digits, and hyphens', () => {
  assert.equal(slugify('Logo reveal'), 'logo-reveal');
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
  assert.equal(slugify('***'), 'animation');
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
  const agent = await pkg.agents.motion_designer();
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

test('the manifest carries what the catalogue and npm look for', () => {
  // The same two markers that src/lib/npm.ts in this repository requires.
  assert.ok(manifest.keywords.includes('standardagent'));
  assert.ok(manifest.standardagent.entryAgents.length > 0);
  assert.ok(manifest.peerDependencies['@standardagents/spec']);
  // A published package must not be private, and a scoped one is only public
  // on npm when it says so.
  assert.notEqual(manifest.private, true);
  assert.equal(manifest.publishConfig.access, 'public');
  // The engine is pinned: a new Anime.js could move a keyframe.
  assert.match(manifest.dependencies.animejs, /^\d+\.\d+\.\d+$/);
});
