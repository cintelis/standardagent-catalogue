# Working on the Diagram Designer

[README.md](README.md) is for people who install the package. This page is for
people who read or change its source. It is not part of the published package.

This is the second sample agent in this repository. Read
[`../text-coach-agent`](../text-coach-agent) first: it has the same structure
with a much smaller Rust crate.

- **TypeScript** defines the agent, its prompt, its model, and its two tools, in
  the shape the [Standard Agent Specification](https://standardagentspec.org)
  asks for.
- **Rust** is the diagram engine: it validates the spec, lays out the page,
  writes the draw.io XML, checks it, and draws the SVG. It compiles to
  WebAssembly, and the TypeScript tools call it.

## Build and test

You need Node 22 or later, pnpm, and Rust from rustup. `rust-toolchain.toml`
names the Rust release and the WebAssembly target, and rustup installs them on
first use.

```bash
pnpm install
pnpm test       # Builds, runs the Rust tests, then tests the built package
pnpm typecheck  # Checks the TypeScript without writing dist/
pnpm demo       # Builds the order-flow example and writes out/<name>.drawio.svg
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
4. **`src/wasm.ts`**. The TypeScript side of the boundary. It gets the module
   from one of two loaders: see "Where it runs" in the README.
5. **`src/tools/create_diagram.ts`**. The argument schema is what the model
   sees. The result has two parts: the report as text and the SVG as an
   attachment.
6. **`src/prompts/diagram_designer.ts`**. The workflow and the design rules.
7. **`src/index.ts`** and **`package.json`**. What the package exports and
   declares.

## The two WebAssembly loaders

`src/wasm.ts` imports `#wasm-module`. The `imports` field in `package.json`
maps that name to `src/wasm-module.workerd.ts` under the `workerd` condition,
and to `src/wasm-module.ts` otherwise. `scripts/build.mjs` writes the module in
both forms: as base64 in `src/generated/wasm-bytes.ts`, and as
`dist/drawgen_core.wasm`. A test checks that the two are the same module.

The Workers loader is checked by hand, not in CI.

## Why a diagram builder suits an agent

The engine is a port of drawgen, a Python package that builds draw.io diagrams.
drawgen is not public, and this agent does not need it to build or to run.

drawgen already works as a loop: write a spec, build it, read the check report,
fix, build again. That loop is
what an agent does, and every step between the spec and the SVG is a pure
calculation. The model makes the design decisions, and code does the geometry.

A packed Standard Agent is an npm package of JavaScript, so it cannot run the
Python package or start a desktop program. This agent ports the part that is a
pure calculation and leaves out the part that needs a computer:

| drawgen | In this agent |
|---|---|
| Spec format, kinds, zones, edge styles | Ported: `rust/src/theme.rs`, `rust/src/spec.rs` |
| Auto layout | Ported: `rust/src/spec.rs` |
| draw.io XML builder | Ported: `rust/src/diagram.rs` |
| Checker | Ported: `rust/src/check.rs` |
| Built-in SVG renderer, with the diagram embedded | Ported: `rust/src/render.rs` |
| YAML specs | Left out. A tool call carries JSON |
| draw.io Desktop rendering, PNG and PDF export, previews | Left out. They need a desktop program |
| Writing files, markdown documents, the Claude Code hook | Left out. The tool returns the SVG as an attachment |
| Reading and updating an existing `.drawio` file | Left out. See "What it does not do" in the README |

## How it stays true to drawgen

The Rust code must give the same output as the Python package. The tests prove
it for every spec in `test/fixtures/specs`:

- `scripts/golden.py` runs the Python `drawgen` package over the specs and
  writes `test/fixtures/expected`: the draw.io XML, the check report, and the
  SVG for a spec that builds, or the error message for one that does not.
- `cargo test` compares the Rust output with those files, byte for byte.
- `pnpm test` makes the same comparison through the built WebAssembly module.

When drawgen changes, run the script again and port the change until the
tests pass:

```bash
/path/to/python-with-drawgen scripts/golden.py
pnpm test
```

The expected files were written by drawgen 0.2.0. They hold only the diagrams
made from the specs in `test/fixtures/specs`.

The port differs from the original in three ways, and none changes the output
for the specs in `test/fixtures/specs`:

- Where Python would stop with an internal error, such as a coordinate that is
  a string, the Rust code reports a spec problem that names the entry.
- Edge waypoints count as content. drawgen sizes the page and the picture to
  the shapes alone, so an edge routed around the shapes could run off both
  without a word from the checker. Here a fitted page grows to hold the
  waypoints, the picture covers them, and the checker reports a waypoint that
  is off a page whose size the spec sets.
- A text colour must be a hex colour, a text alignment must be `left`,
  `center` or `right`, and an edge arrow must be a name made of letters.
  drawgen copies these three values into a draw.io style as they are.

## Releasing

A maintainer releases the package to npm from a tag, and signs it first. The
steps are in the maintainers' section of
[CONTRIBUTING.md](../../CONTRIBUTING.md).
