#!/usr/bin/env node
// A second way in: this package as a Model Context Protocol (MCP) server.
//
// A Standard Agent needs a runtime that implements the specification. An MCP
// server needs none: Claude, Cursor, and other MCP clients start it as a
// program and call its tools. This file serves the same two tools, with the
// same checks, over MCP.
//
//   npx -y @cintelisai/motion-agent                 # the file comes back as text
//   npx -y @cintelisai/motion-agent --out ./motion  # the file is saved there
//
// The client's own model takes the agent's place, so the agent's instructions
// go to the client as the server's instructions, and as a prompt it can use.
//
// The protocol is JSON-RPC 2.0, one message on each line, on standard input
// and output. It is written out here, and not taken from an SDK, so that the
// package gains no dependency. A test drives this file with the official MCP
// client.
//
// This file is plain JavaScript and lives outside src/, because it is the one
// part of the package that needs Node. Everything in src/ also runs on
// Cloudflare Workers, and keeping Node's types away from it keeps it that way.
//
// The same file, but for two names, is in ../diagram-agent/bin/mcp.mjs.

import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';

import { __meta, agents, prompts, tools } from '../dist/index.js';

/** The agent and the prompt this server stands in for. */
const AGENT = 'motion_designer';
/** What the one argument of the prompt is for. */
const REQUEST = 'What to animate, in your own words.';

/** The versions of the protocol this server speaks, newest first. */
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** `--out <folder>`: where to save the files. Without it, nothing is written. */
function outFolder(argv) {
  const at = argv.indexOf('--out');
  const value = at === -1 ? undefined : argv[at + 1];
  return value ? resolve(value) : null;
}

const out = outFolder(process.argv.slice(2));
const entry = await agents[AGENT]();
const prompt = await prompts[entry.sideA.prompt]();
const instructions = typeof prompt.prompt === 'string' ? prompt.prompt : '';

const loaded = await Promise.all(
  Object.entries(tools).map(async ([name, load]) => {
    const tool = await load();
    // A tool that takes nothing may have no schema at all.
    const inputSchema = tool.args ? z.toJSONSchema(tool.args) : { type: 'object', properties: {} };
    return { name, tool, inputSchema };
  }),
);

function rpcError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Runs one tool and turns its result into MCP content. */
async function callTool(name, args) {
  const found = loaded.find((item) => item.name === name);
  if (!found) throw rpcError(-32602, `Unknown tool: ${name}`);

  // The same check a Standard Agent runtime makes before it runs a tool.
  const parsed = found.tool.args ? found.tool.args.safeParse(args ?? {}) : { success: true, data: {} };
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`);
    return {
      isError: true,
      content: [{ type: 'text', text: `The arguments do not match the tool's schema:\n${problems.join('\n')}` }],
    };
  }

  const result = await found.tool.execute({}, parsed.data);
  if (result.status !== 'success') {
    return { isError: true, content: [{ type: 'text', text: result.error ?? 'The tool failed.' }] };
  }

  const content = [];
  const report = result.result ? JSON.parse(result.result) : {};
  for (const attachment of result.attachments ?? []) {
    const text = Buffer.from(attachment.data, 'base64').toString('utf8');
    // The tool names the file from a hash and a slug, so it holds no path.
    // `basename` makes sure of it.
    const name = basename(attachment.name);
    if (out) {
      mkdirSync(out, { recursive: true });
      const path = join(out, name);
      writeFileSync(path, text);
      report.saved_to = path;
    } else {
      content.push({ type: 'resource', resource: { uri: `file:///${name}`, mimeType: attachment.mimeType, text } });
    }
  }
  content.unshift({ type: 'text', text: JSON.stringify(report) });
  return { content };
}

/** Answers one request. A notification gets no answer. */
async function handle(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;
  if (typeof method !== 'string') return null;

  try {
    let result;
    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion;
        result = {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {}, prompts: {} },
          serverInfo: { name: __meta.packageId, title: entry.title, version: __meta.version },
          instructions,
        };
        break;
      }
      case 'ping':
        result = {};
        break;
      case 'tools/list':
        result = {
          tools: loaded.map(({ name, tool, inputSchema }) => ({ name, description: tool.description, inputSchema })),
        };
        break;
      case 'tools/call':
        result = await callTool(String(params?.name ?? ''), params?.arguments);
        break;
      case 'prompts/list':
        result = {
          prompts: [
            {
              name: entry.name,
              description: entry.description,
              arguments: [{ name: 'request', description: REQUEST, required: false }],
            },
          ],
        };
        break;
      case 'prompts/get': {
        if (params?.name !== entry.name) throw rpcError(-32602, `Unknown prompt: ${String(params?.name)}`);
        const request = params?.arguments?.request;
        const text =
          typeof request === 'string' && request.trim() ? `${instructions}\n\nThe request:\n${request}` : instructions;
        result = { description: entry.description, messages: [{ role: 'user', content: { type: 'text', text } }] };
        break;
      }
      default:
        // A notification this server does not know is ignored, as the protocol asks.
        if (!isRequest) return null;
        throw rpcError(-32601, `Method not found: ${method}`);
    }
    return isRequest ? { jsonrpc: '2.0', id, result } : null;
  } catch (error) {
    if (!isRequest) return null;
    const code = typeof error?.code === 'number' ? error.code : -32603;
    return { jsonrpc: '2.0', id, error: { code, message: error instanceof Error ? error.message : String(error) } };
  }
}

// Standard output carries the protocol and nothing else. Notes go to standard error.
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
console.error(
  `${__meta.packageId}@${__meta.version}: MCP server on standard input and output` +
    (out ? `, saving files to ${out}` : ''),
);

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    continue;
  }
  for (const one of Array.isArray(message) ? message : [message]) {
    if (typeof one !== 'object' || one === null) continue;
    const answer = await handle(one);
    if (answer) send(answer);
  }
}
