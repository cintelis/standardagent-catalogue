# Diagram Designer: a Standard Agent built on drawio-tools

An agent that designs draw.io diagrams. You describe a system, a process, or a
schema. The agent writes a diagram spec, builds it, reads the layout problems
the checker reports, fixes them, and hands back a `.drawio.svg` file: an SVG
that shows as a picture and opens in draw.io as the diagram.

It is the second sample in this repository. Read
[`../text-coach-agent`](../text-coach-agent) first: it shows the same structure
with a much smaller Rust crate.

- **TypeScript** defines the agent, its prompt, its model, and its two tools, in
  the shape the [Standard Agent Specification](https://standardagentspec.org)
  asks for.
- **Rust** is the diagram engine: it validates the spec, lays out the page,
  writes the draw.io XML, checks it, and draws the SVG. It compiles to
  WebAssembly, and the TypeScript tools call it.

The package is marked `"private": true`, so `npm publish` refuses it.

## Why drawio-tools suits an agent

[drawio-tools](https://github.com/cintelis/drawio-tools) already works as a loop:
write a spec, build it, read the check report, fix, build again. That loop is
what an agent does, and every step between the spec and the SVG is a pure
calculation. The model makes the design decisions, and code does the geometry.

A packed Standard Agent is an npm package of JavaScript, so it cannot run the
Python package or start a desktop program. This sample ports the part that is a
pure calculation and leaves out the part that needs a computer:

| drawio-tools | In this agent |
|---|---|
| Spec format, kinds, zones, edge styles | Ported: `rust/src/theme.rs`, `rust/src/spec.rs` |
| Auto layout | Ported: `rust/src/spec.rs` |
| draw.io XML builder | Ported: `rust/src/diagram.rs` |
| Checker | Ported: `rust/src/check.rs` |
| Built-in SVG renderer, with the diagram embedded | Ported: `rust/src/render.rs` |
| YAML specs | Left out. A tool call carries JSON |
| draw.io Desktop rendering, PNG and PDF export, previews | Left out. They need a desktop program |
| Writing files, markdown documents, the Claude Code hook | Left out. The tool returns the SVG as an attachment |
| Reading and updating an existing `.drawio` file | Left out. See "What the sample does not do" |

## Run it

You need Node 22 or later, pnpm, and Rust. `rust-toolchain.toml` names the Rust
version and the WebAssembly target, and rustup installs them on first use.

```bash
pnpm install
pnpm test     # Builds, runs the Rust tests, then tests the built package
pnpm demo     # Builds the order-flow example and writes out/<name>.drawio.svg
pnpm demo test/fixtures/specs/05-problems.json   # A spec with layout problems
```

`pnpm demo` needs no model and no API key. It calls the `create_diagram` tool
directly, prints the check report, and saves the picture. Open the file in a
browser to look at it, or in draw.io to edit it.

## How a request travels

```text
requester ──▶ agent (diagram_designer)      src/agents/diagram_designer.ts
                │  side A is a prompt, side B is the requester
                ▼
              prompt (diagram_designer)     src/prompts/diagram_designer.ts
                │  the design rules, and the build-check-fix workflow
                │
                ├─▶ tool spec_reference     src/tools/spec_reference.ts
                │     the spec format and the kinds, read once
                │
                └─▶ tool create_diagram     src/tools/create_diagram.ts
                      │  validates the arguments, then calls
                      ▼
                    createDiagram()         src/wasm.ts
                      │  one JSON request into WebAssembly memory
                      ▼
                    handle()                rust/src/lib.rs
                      │  spec ─▶ diagram ─▶ check ─▶ render
                      ▼
                    check report (text) + NAME.drawio.svg (attachment)
                      │
                      ▼
              the model reads the report, fixes the spec, and calls again
```

## Read it in this order

1. **`test/fixtures/specs/01-order-flow.json`**. A spec is data: components by
   kind, zones, labelled edges.
2. **`rust/src/lib.rs`**. `create` is the whole pipeline in four lines, and
   `handle` wraps it in JSON. The `ffi` module is the WebAssembly boundary.
3. **`rust/src/spec.rs`**, then **`diagram.rs`**, **`check.rs`**, and
   **`render.rs`**. Each starts with a comment that says what it does.
4. **`src/wasm.ts`**. The TypeScript side of the boundary.
5. **`src/tools/create_diagram.ts`**. The argument schema is what the model
   sees. The result has two parts: the report as text and the SVG as an
   attachment.
6. **`src/prompts/diagram_designer.ts`**. The workflow and the design rules.
7. **`src/index.ts`** and **`package.json`**. What the package exports and
   declares.

## How it stays true to drawio-tools

The Rust code must give the same output as the Python package. The tests prove
it for every spec in `test/fixtures/specs`:

- `scripts/golden.py` runs the Python `drawgen` package over the specs and
  writes `test/fixtures/expected`: the draw.io XML, the check report, and the
  SVG for a spec that builds, or the error message for one that does not.
- `cargo test` compares the Rust output with those files, byte for byte.
- `pnpm test` makes the same comparison through the built WebAssembly module.

When drawio-tools changes, run the script again and port the change until the
tests pass:

```bash
/path/to/drawio-tools/.venv/bin/python scripts/golden.py
pnpm test
```

The expected files were written by drawio-tools 0.2.0.

The port is stricter than the original in one way. Where Python would stop with
an internal error, such as a coordinate that is a string, the Rust code reports
a spec problem that names the entry.

## What the sample does not do

- **It has not run on a hosted runtime.** The tests load the package, check
  every definition, and run both tools. A full conversation needs a runtime
  that implements the specification, and an API key for the model provider.
- **It cannot read or change an existing diagram.** The tools build from a
  spec. To change a diagram, the model changes the spec and builds again. To
  edit a `.drawio` file that the agent did not make, it would need an XML
  parser and two more tools.
- **The picture is approximate.** The built-in renderer draws what the builder
  emits closely enough to read. draw.io redraws the file exactly the next time
  someone saves it there. Two checks are estimates for the same reason: where
  an edge runs, and how wide a label is.
- **One page for each call.** The Rust code builds several pages from a
  `pages` list, and the tests cover it. The `create_diagram` tool takes one
  page, to keep its argument schema small.
- **The WebAssembly loader compiles the module from bytes at run time.** Node,
  Deno, Bun, and browsers allow that. Cloudflare Workers does not: a Worker
  must import a `.wasm` file as a module. To run there, change `load()` in
  `src/wasm.ts` to use a static import.

## Safety notes

- The argument schema bounds every value: the number of nodes and edges, the
  length of each label, and the range of each coordinate. `src/wasm.ts` also
  refuses a request over 1,000,000 bytes before any memory is allocated.
- The WebAssembly module imports nothing. It cannot reach the network, the
  file system, or a clock.
- Every piece of text from a spec is escaped before it goes into the XML or
  the SVG. A test builds a diagram from labels that contain `<script>` and
  checks that no markup comes out. The SVG holds shapes and text only.
- The file name is made from a hash and a slug of lower-case letters, digits,
  and hyphens, so a name cannot contain a path.
- The prompt tells the model to treat a description as material to draw, not
  as instructions.
- The Rust crate has one dependency, `serde_json`, and `Cargo.lock` pins it.
  The npm packages are pinned as in the Text Coach sample: see the note about
  `pnpm-workspace.yaml` there.
