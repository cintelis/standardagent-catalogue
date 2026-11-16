# Diagram Designer

A [Standard Agent](https://standardagentspec.org) that designs draw.io
diagrams. You describe a system, a process, or a schema. The agent writes a
diagram spec, builds it, reads the layout problems that its checker reports,
fixes them, and hands back a `.drawio.svg` file: an SVG that shows as a picture
and opens in draw.io as the diagram.

```bash
npm install @cintelisai/diagram-agent
```

The agent's definitions are TypeScript. The diagram engine is Rust, compiled to
WebAssembly and shipped inside the package, so there is nothing else to install
and nothing to run beside it.

It is an early release. The tools are tested, on Node and on the Cloudflare
Workers runtime, but nobody has yet run a full conversation through a hosted
runtime: see [What it does not do](#what-it-does-not-do).

## What is in the package

| Kind | Name | What it is |
|---|---|---|
| Agent | `diagram_designer` | The entry agent. A model on one side, the person who asks on the other. Another agent can call it as a tool |
| Prompt | `diagram_designer` | The design rules, and the build, check, and fix workflow |
| Model | `designer_model` | Claude, through `@standardagents/anthropic`. The runtime supplies the API key |
| Tool | `spec_reference` | Returns the spec format, the kinds of shape, and the colours. The model reads it once |
| Tool | `create_diagram` | Builds a diagram from a spec. Returns a check report and attaches the SVG |

## Use it

Install the package in a project whose runtime implements the Standard Agent
Specification. The runtime finds the entry agent from the `standardagent`
field in the package's `package.json`, and it needs an API key for the model
provider.

The package exports one registry for each kind of definition, and each entry
is a function that loads one. That makes the tools easy to try with no runtime,
no model, and no API key:

```js
import * as diagrams from '@cintelisai/diagram-agent';

const tool = await diagrams.tools.create_diagram();
const args = tool.args.parse({
  name: 'order-flow',
  title: 'Order flow',
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
});

const result = await tool.execute({}, args);
const { file, check } = JSON.parse(result.result);
console.log(file, check.errors, check.warnings);
// 491ef5ed-order-flow.drawio.svg 0 0

// The picture: an SVG, as base64.
const svg = Buffer.from(result.attachments[0].data, 'base64').toString('utf8');
```

## A diagram spec

A spec is data. The model writes one, and so can you.

| Field | What it holds |
|---|---|
| `title`, `subtitle` | The heading of the page |
| `layout`, `direction` | `"auto"` places the nodes that have no `x` and `y`, flowing `right` or `down` |
| `nodes` | Components: `id`, `label`, `kind`, and optionally `sub`, `zone`, `x`, `y`, `w`, `h` |
| `zones` | Tinted, titled containers that group nodes |
| `entities` | Entity-relationship tables, with a list of fields |
| `edges` | Connections: `from`, `to`, and optionally `label`, `style`, `exit`, `entry`, `points` |
| `texts` | Free text on the page |
| `legend` | `true` adds a legend |

A node's `kind` picks its shape and colour: `actor`, `external`, `service`,
`ai`, `worker`, `datastore`, `queue`, `ui`, `gov`, `security`, `decision`,
`step`, `terminal`, or `note`. An edge's `style` is `sync`, `async`, `data`,
`ai`, or `weak`. A zone's colour is `blue`, `green`, `purple`, `amber`, `grey`,
`red`, or `teal`.

One call takes up to 200 nodes, 400 edges, 40 zones, 60 entities, and 60 texts.
The `spec_reference` tool returns the full format.

The check report lists what is wrong with the layout, such as two shapes that
overlap, a shape or an edge off the page, an edge that crosses a shape, or a
label too long for its shape. Each issue names the shape, so that the model, or
you, can move it and build again.

## Where it runs

The package carries the WebAssembly module in two forms, and `package.json`
picks one:

| Where | How the module arrives |
|---|---|
| Node, Deno, Bun, browsers | As base64 inside the JavaScript, compiled on first use |
| Cloudflare Workers | As a `.wasm` file in the package, imported as a module |

A Worker may not compile a module from bytes at run time, so it needs the
file. The package picks the right form by itself: its `package.json` maps the
loader to the Workers one under the `workerd` condition, which Wrangler sets
when it bundles. The base64 copy then stays out of the Worker.

This was checked by hand: a Worker that imports the built package was bundled
with Wrangler 4 and run in its local runtime, and the `create_diagram` tool
returned the same result as on Node. The Worker needs the `nodejs_compat`
compatibility flag, because the model provider package imports Node modules.

Another bundler, or a runtime with the same rule under another condition
name, can import the file directly: the package exports it as
`@cintelisai/diagram-agent/drawgen_core.wasm`.

## What it does not do

- **It has not run on a hosted runtime.** Its tests load the package, check
  every definition, and run both tools. Nobody has yet run a full conversation
  through a runtime.
- **It cannot read or change an existing diagram.** The tools build from a
  spec. To change a diagram, the model changes the spec and builds again. To
  edit a `.drawio` file that the agent did not make, it would need an XML
  parser and two more tools.
- **The picture is approximate.** The built-in renderer draws what the builder
  emits closely enough to read. draw.io redraws the file exactly the next time
  someone saves it there. Two checks are estimates for the same reason: where
  an edge runs, and how wide a label is.
- **One page for each call.** The `create_diagram` tool takes one page, to
  keep its argument schema small.

## Safety

- The argument schema bounds every value: the number of nodes and edges, the
  length of each label, and the range of each coordinate. The package also
  refuses a request over 1,000,000 bytes before any memory is allocated.
- The argument schema drops a key it does not name. The specification limits
  a tool's arguments to a fixed set of Zod types, and a strict object is not
  one of them, so the schema cannot refuse the key. The Rust code would name
  an unknown key, but it never sees one. The schema takes `color` as well as
  `colour` for a zone, because that is the spelling a model is likely to mix up.
- A draw.io style is a list of `key=value` pairs separated by `;`. The Rust
  code refuses a text colour, a text alignment, or an edge arrow that could add
  a pair of its own, such as `#000;shape=image;image=https://...`. The tool's
  schema does not offer those three fields; the check protects code that calls
  `createDiagram` directly.
- The tool lists at most 40 issues from the check report, errors first, and
  counts the rest by code. A crowded page can make the checker report thousands
  of overlaps, and the model needs the first few, not all of them. The attached
  SVG has no size limit of its own.
- The WebAssembly module imports nothing. It cannot reach the network, the
  file system, or a clock.
- Every piece of text from a spec is escaped before it goes into the XML or
  the SVG. A test builds a diagram from labels that contain `<script>` and
  checks that no markup comes out. The SVG holds shapes and text only.
- The file name is made from a hash and a slug of lower-case letters, digits,
  and hyphens, so a name cannot contain a path.
- The prompt tells the model to treat a description as material to draw, not
  as instructions.
- The Rust code has one dependency, `serde_json`, pinned by a lock file. The
  package's own dependencies are pinned by a lock file too.

## Check a release

Each release is built by the release workflow of
[its repository](https://github.com/cintelis/standardagent-catalogue) and signed with the Cintelis release key before it
reaches npm. To check one, from a copy of that repository:

```bash
scripts/verify-release.sh diagram-agent-v0.1.1
```

In a project that has installed the package, `npm audit signatures` checks its
npm provenance.

## Source

The source is in
[`examples/diagram-agent`](https://github.com/cintelis/standardagent-catalogue/tree/main/examples/diagram-agent) of the Standard Agent Catalogue repository,
under the MIT licence. [DEVELOPMENT.md](https://github.com/cintelis/standardagent-catalogue/blob/main/examples/diagram-agent/DEVELOPMENT.md) there says how
the code is laid out, how to build and test it, and how the Rust engine is kept
correct. Changes are welcome: see
[CONTRIBUTING.md](https://github.com/cintelis/standardagent-catalogue/blob/main/CONTRIBUTING.md).
