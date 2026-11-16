// Tests the MCP server in bin/mcp.mjs by talking to it with the official MCP
// client. The server writes the protocol out by hand, so this is what shows
// that a real client understands it. `pnpm test` builds first.

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import * as pkg from '../dist/index.js';

const server = fileURLToPath(new URL('../bin/mcp.mjs', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const folders = [];
after(() => folders.forEach((folder) => rmSync(folder, { recursive: true, force: true })));

/** Starts the server and connects a client to it. */
async function connect(...args) {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server, ...args], stderr: 'ignore' }));
  return client;
}

const flow = {
  name: 'checkout',
  title: 'Checkout',
  layout: 'auto',
  nodes: [
    { id: 'shop', label: 'Shopper', kind: 'actor' },
    { id: 'api', label: 'Orders API', kind: 'service' },
    { id: 'db', label: 'Postgres', kind: 'datastore' },
  ],
  edges: [
    { from: 'shop', to: 'api', label: 'POST /orders' },
    { from: 'api', to: 'db', label: 'insert', style: 'data' },
  ],
};

test('an MCP client connects, and sees the agent as a server', async () => {
  const client = await connect();
  try {
    assert.deepEqual(client.getServerVersion(), {
      name: manifest.name,
      title: 'Diagram Designer',
      version: manifest.version,
    });
    // The agent's instructions travel with the server.
    const prompt = await pkg.prompts.diagram_designer();
    assert.equal(client.getInstructions(), prompt.prompt);
    assert.deepEqual(Object.keys(client.getServerCapabilities()).sort(), ['prompts', 'tools']);
    assert.deepEqual(await client.ping(), {});
  } finally {
    await client.close();
  }
});

test('the server lists the same tools as the package, with their schemas', async () => {
  const client = await connect();
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), Object.keys(pkg.tools).sort());
    for (const listed of tools) {
      const tool = await pkg.tools[listed.name]();
      assert.equal(listed.description, tool.description);
      assert.equal(listed.inputSchema.type, 'object');
    }
    const create = tools.find((tool) => tool.name === 'create_diagram');
    assert.deepEqual(create.inputSchema.required, ['name', 'title']);
    assert.equal(create.inputSchema.properties.nodes.maxItems, 200);
  } finally {
    await client.close();
  }
});

test('create_diagram returns the report and the file', async () => {
  const client = await connect();
  try {
    const result = await client.callTool({ name: 'create_diagram', arguments: flow });
    assert.ok(!result.isError);
    const [report, file] = result.content;
    const { file: name, check, saved_to } = JSON.parse(report.text);
    assert.match(name, /^[0-9a-f]{8}-checkout\.drawio\.svg$/);
    assert.equal(check.errors, 0);
    assert.equal(saved_to, undefined, 'nothing is written without --out');
    assert.equal(file.type, 'resource');
    assert.equal(file.resource.mimeType, 'image/svg+xml');
    assert.equal(file.resource.uri, `file:///${name}`);
    assert.match(file.resource.text, /^<svg xmlns=/);

    // The same file as the package's own tool makes.
    const tool = await pkg.tools.create_diagram();
    const direct = await tool.execute({}, tool.args.parse(flow));
    assert.equal(file.resource.text, Buffer.from(direct.attachments[0].data, 'base64').toString('utf8'));

    const reference = await client.callTool({ name: 'spec_reference', arguments: {} });
    assert.match(JSON.parse(reference.content[0].text).spec_format, /nodes/);
  } finally {
    await client.close();
  }
});

test('with --out, the file is saved and not sent back', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'diagram-mcp-'));
  folders.push(folder);
  const client = await connect('--out', join(folder, 'made'));
  try {
    const result = await client.callTool({ name: 'create_diagram', arguments: flow });
    assert.equal(result.content.length, 1);
    const { file, saved_to } = JSON.parse(result.content[0].text);
    assert.deepEqual(readdirSync(join(folder, 'made')), [file]);
    assert.equal(saved_to, join(folder, 'made', file));
    assert.match(readFileSync(saved_to, 'utf8'), /^<svg xmlns=/);

    // A name cannot put the file anywhere else.
    await client.callTool({ name: 'create_diagram', arguments: { ...flow, name: '../../../escape' } });
    assert.deepEqual(readdirSync(folder), ['made']);
    assert.equal(readdirSync(join(folder, 'made')).length, 2);
  } finally {
    await client.close();
  }
});

test('a bad spec and bad arguments come back as errors the model can read', async () => {
  const client = await connect();
  try {
    const badSpec = await client.callTool({
      name: 'create_diagram',
      arguments: { name: 'x', title: 'x', nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'nowhere' }] },
    });
    assert.equal(badSpec.isError, true);
    assert.match(badSpec.content[0].text, /spec\.edges\[0\]\.to: no node, zone, entity or text has id 'nowhere'/);

    const badArguments = await client.callTool({ name: 'create_diagram', arguments: { title: 5 } });
    assert.equal(badArguments.isError, true);
    assert.match(badArguments.content[0].text, /do not match the tool's schema/);
    assert.match(badArguments.content[0].text, /^name: /m);

    // A tool that does not exist is a protocol error, not a tool result.
    await assert.rejects(client.callTool({ name: 'nope', arguments: {} }), /Unknown tool: nope/);
  } finally {
    await client.close();
  }
});

test('the agent is offered as a prompt', async () => {
  const client = await connect();
  try {
    const { prompts } = await client.listPrompts();
    assert.deepEqual(prompts.map((prompt) => prompt.name), ['diagram_designer']);
    const prompt = await pkg.prompts.diagram_designer();

    const plain = await client.getPrompt({ name: 'diagram_designer' });
    assert.equal(plain.messages[0].content.text, prompt.prompt);
    const asked = await client.getPrompt({ name: 'diagram_designer', arguments: { request: 'a checkout flow' } });
    assert.equal(asked.messages[0].content.text, `${prompt.prompt}\n\nThe request:\na checkout flow`);
    await assert.rejects(client.getPrompt({ name: 'nope' }), /Unknown prompt/);
  } finally {
    await client.close();
  }
});

test('the package offers the server as its command', () => {
  assert.deepEqual(manifest.bin, { 'diagram-agent': './bin/mcp.mjs' });
  assert.ok(manifest.files.includes('bin'));
  assert.ok(readFileSync(server, 'utf8').startsWith('#!/usr/bin/env node\n'));
  // The server adds no dependency of its own: the SDK is for this test only.
  assert.equal(manifest.dependencies['@modelcontextprotocol/sdk'], undefined);
  assert.ok(manifest.devDependencies['@modelcontextprotocol/sdk']);
});
