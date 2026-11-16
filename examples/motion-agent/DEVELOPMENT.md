# Working on the Motion Designer

[README.md](README.md) is for people who install the package. This page is for
people who read or change its source. It is not part of the published package.

This is the third sample agent in this repository, and the only one without
Rust. [`../text-coach-agent`](../text-coach-agent) and
[`../diagram-agent`](../diagram-agent) do their work in WebAssembly. This one
does it in TypeScript, with [Anime.js](https://animejs.com) as its engine: it
shows that an agent can put an ordinary JavaScript library to work, as long as
the library can run without a browser.

## Build and test

You need Node 22 or later, and pnpm.

```bash
pnpm install
pnpm test       # Builds, then tests the built package and its MCP server
pnpm typecheck  # Checks the TypeScript without writing dist/
pnpm demo       # Builds the logo reveal and writes out/<name>.svg
pnpm demo test/fixtures/specs/03-problems.json   # A spec with problems
pnpm golden     # Writes test/fixtures/expected again: see below
```

`pnpm demo` needs no model and no API key. It calls the `create_animation`
tool directly, prints the check report, and saves the picture. Open the file in
a browser to watch it.

## How a request travels

```text
requester ──▶ agent (motion_designer)       src/agents/motion_designer.ts
                │  side A is a prompt, side B is the requester
                ▼
              prompt (motion_designer)      src/prompts/motion_designer.ts
                │  the design rules, and the build-check-fix workflow
                │
                ├─▶ tool motion_reference   src/tools/motion_reference.ts
                │     the spec format and the names, read once
                │
                └─▶ tool create_animation   src/tools/create_animation.ts
                      │  validates the arguments, then calls
                      ▼
                    createAnimation()       src/engine/index.ts
                      │
                      ├─ parseSpec          src/engine/spec.ts     checks everything again
                      ├─ computeMotion      src/engine/motion.ts   Anime.js, frame by frame
                      ├─ writeSvg           src/engine/svg.ts      keyframes into one file
                      └─ checkMotion        src/engine/check.ts    what a viewer would trip over
                      ▼
                    check report (text) + NAME.svg (attachment)
                      │
                      ▼
              the model reads the report, fixes the spec, and calls again
```

## Read it in this order

1. **`test/fixtures/specs/02-logo-reveal.json`**. A spec is data: shapes as
   they start, then steps.
2. **`src/engine/index.ts`**. `createAnimation` is the whole engine in five
   lines.
3. **`src/engine/motion.ts`**. Where Anime.js comes in. Each shape gets a plain
   object that holds its values. The steps go onto an Anime.js timeline, and
   the module asks the timeline where everything is, thirty times a second.
   `simplify` then keeps only the frames that a straight line would miss.
4. **`src/engine/svg.ts`**. One group for each kind of change: where a shape
   is, how far it is turned, and how large it is.
5. **`src/engine/check.ts`**. Each check is a few lines over the same tracks.
6. **`src/engine/spec.ts`**. The limits, and every message a bad spec can get.
7. **`src/tools/create_animation.ts`**. The argument schema is what the model
   sees.
8. **`src/prompts/motion_designer.ts`**. The workflow and the design rules.

## How Anime.js is used

Anime.js animates page elements in a browser. It also animates plain objects,
and for those it needs no `window`, no `document`, and no clock: a timeline
made with `autoplay: false` goes to any moment when told to, with `seek`. A
test checks that neither `window` nor `document` exists while it runs.

That gives the engine Anime.js's timing for free, and exactly: the same
stagger and the same easings that a page would get. What it does not give is
anything that needs a page: scrolling, dragging, text splitting, or drawing on
a canvas.

Anime.js is pinned to one exact release in `package.json`. A new release could
move a keyframe by a hair, and the tests compare files byte for byte.

## The MCP server

`bin/mcp.mjs` serves the package's tools over the Model Context Protocol, for
clients that are not Standard Agent runtimes. It is the package's command, so
`npx -y @cintelisai/motion-agent` starts it.

- It is plain JavaScript, outside `src/`, because it is the one part of the
  package that needs Node. Everything in `src/` also runs on Cloudflare
  Workers.
- It writes the protocol out by hand: JSON-RPC 2.0, one message on each line.
  The package gains no dependency that way. `test/mcp.test.mjs` connects the
  official MCP client to it, which is what shows that a real client
  understands it. The SDK is a dev dependency, for that test only.
- It adds nothing to the tools. It checks the arguments with the tool's own
  schema, runs the tool's own `execute`, and passes the result on.
- The agent's prompt goes to the client twice: as the server's instructions,
  and as a prompt the user can pick.
- The same file, but for two names, is in the other sample that has one.

## The expected files

`test/fixtures/expected` holds what the engine makes from each spec in
`test/fixtures/specs`: the SVG and the check report, or the error message for a
spec that is refused. The tests compare the two, byte for byte. So a change to
the output cannot slip in: it shows up as a difference in a file.

After a change that is meant to alter the output:

```bash
pnpm golden
git diff test/fixtures/expected   # Read what changed before you commit it
```

`.gitattributes` at the root of the repository keeps Git from changing the line
endings of these files.

## Releasing

A maintainer releases the package to npm from a tag, and signs it first. The
steps are in the maintainers' section of
[CONTRIBUTING.md](../../CONTRIBUTING.md). The tag is `motion-agent-v<version>`.
