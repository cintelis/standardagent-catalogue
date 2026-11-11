// Checks the site that `pnpm test` builds from tests/fixtures into dist-test/.
// The fixtures include a hostile package, because every field of a real
// package is written by its publisher.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const dist = new URL('../dist-test/', import.meta.url).pathname;
const read = (path) => readFileSync(join(dist, path), 'utf8');

function htmlFiles(folder = dist) {
  return readdirSync(folder).flatMap((entry) => {
    const path = join(folder, entry);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return entry.endsWith('.html') ? [path] : [];
  });
}

test('the agent list shows valid agent packages only', () => {
  const html = read('index.html');
  assert.match(html, /standardagent-example-issue-triage/);
  assert.match(html, /@example\/standardagent-scoped/);
  assert.match(html, /3 agent packages/);
  for (const name of ['nofield', 'mismatch', 'missing', 'some-other-package', 'escape']) {
    assert.doesNotMatch(html, new RegExp(name), `${name} must not be listed`);
  }
});

test('an agent page shows what the package declares', () => {
  const html = read('package/standardagent-example-issue-triage/index.html');
  assert.match(html, /npm install standardagent-example-issue-triage/);
  assert.match(html, /issue_triage/);
  assert.match(html, /triage_context/);
  assert.match(html, /before_parent/);
  assert.match(html, /send_digest/);
  assert.match(html, /status\.get/);
  assert.match(html, /&gt;=0\.2\.0/);
  assert.match(html, /href="https:\/\/github\.com\/example\/issue-triage"/);
  assert.match(html, /href="https:\/\/example\.com\/issue-triage"/);
  assert.match(html, /href="https:\/\/www\.npmjs\.com\/package\/standardagent-example-issue-triage"/);
});

test('a scoped package has a page under its scope', () => {
  const html = read('package/@example/standardagent-scoped/index.html');
  assert.match(html, /scoped_agent/);
  assert.doesNotMatch(html, /secret/, 'a link with credentials is dropped');
});

test('hostile metadata renders as text and never as markup or a link', () => {
  const page = read('package/standardagent-example-hostile/index.html');
  assert.match(page, /safe_agent/);
  assert.match(page, /&lt;script&gt;alert/);

  for (const file of htmlFiles()) {
    const html = readFileSync(file, 'utf8');
    assert.doesNotMatch(html, /<script>alert/i, `${file} has an injected script`);
    assert.doesNotMatch(html, /<img src=x/i, `${file} has an injected image`);
    assert.doesNotMatch(html, /<svg onload/i, `${file} has an injected svg`);
    assert.doesNotMatch(html, /<b>bold/i, `${file} has injected markup`);
    assert.doesNotMatch(html, /href="(javascript|data):/i, `${file} has an unsafe link`);
  }
});

test('no file is written outside the package folder for an invalid name', () => {
  assert.ok(!existsSync(join(dist, '..', 'escape')));
  assert.ok(!existsSync(join(dist, 'escape')));
  assert.deepEqual(readdirSync(join(dist, 'package')).sort(), [
    '@example',
    'standardagent-example-hostile',
    'standardagent-example-issue-triage',
  ]);
});

test('the ecosystem page groups providers and tooling', () => {
  const html = read('ecosystem/index.html');
  assert.match(html, /Providers/);
  assert.match(html, /Clients and tooling/);
  assert.match(html, /@example\/provider-acme/);
  assert.match(html, /@example\/agent-client/);
  assert.doesNotMatch(html, /standardagent-example-issue-triage/, 'an agent is not tooling');
});

test('the JSON catalogue matches the pages', () => {
  const data = JSON.parse(read('catalogue.json'));
  assert.equal(data.agents.length, 3);
  assert.equal(data.ecosystem.length, 2);
  assert.equal(data.agents[0].name, 'standardagent-example-issue-triage');
  const hostile = data.agents.find((pkg) => pkg.name === 'standardagent-example-hostile');
  assert.equal(hostile.links.homepage, undefined);
  assert.equal(hostile.links.repository, undefined);
  assert.equal(hostile.parentHooks[0].hooks[0].stage, undefined);
});

test('the runtimes and publish pages build', () => {
  assert.match(read('runtimes/index.html'), /Standard Agents Builder/);
  assert.match(read('publish/index.html'), /entryAgents/);
});
