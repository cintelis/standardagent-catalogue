# Text Coach: a sample Standard Agent in TypeScript and Rust

A small agent package to read and change. The agent reviews a piece of writing
and suggests how to make it easier to read.

- **TypeScript** defines the agent, its prompt, its model, and its tool, in the
  shape the [Standard Agent Specification](https://standardagentspec.org) asks
  for.
- **Rust** does the tool's arithmetic: word, sentence, and syllable counts,
  reading time, and two readability scores. It compiles to WebAssembly, and the
  TypeScript tool calls it.

The split is the point of the sample. A model writes well and counts badly, so
the agent gives the counting to code that returns exact numbers.

The package is marked `"private": true`, so `npm publish` refuses it. It is a
sample, not a listing.

## Run it

You need Node 22 or later, pnpm, and Rust with the WebAssembly target:

```bash
rustup target add wasm32-unknown-unknown
```

Then, from this directory:

```bash
pnpm install
pnpm test     # Builds, runs the Rust tests, then tests the built package
pnpm demo     # Calls the tool on a sample text
pnpm demo "Your own text goes here."
```

`pnpm demo` needs no model and no API key. It loads the package the way a
runtime would and calls the tool directly, so you can watch text go from
TypeScript into Rust and numbers come back.

## How a request travels

```text
writer ──▶ agent (text_coach)           src/agents/text_coach.ts
             │  side A is a prompt, side B is the writer
             ▼
           prompt (text_coach)          src/prompts/text_coach.ts
             │  runs on a model         src/models/coach_model.ts
             │  the model calls a tool
             ▼
           tool (analyze_text)          src/tools/analyze_text.ts
             │  validates the arguments, then calls
             ▼
           analyzeText()                src/wasm.ts
             │  copies the text into WebAssembly memory
             ▼
           analyze()                    rust/src/lib.rs
             │  counts, scores, writes JSON
             ▼
           numbers back to the model, which writes the review
```

## Read it in this order

1. **`rust/src/lib.rs`**, top half. `analyze` is plain Rust: a `&str` in, a
   `Stats` struct out. The tests at the bottom show what it returns.
2. **`rust/src/lib.rs`**, the `ffi` module. Three exported functions let
   JavaScript pass a string in and read a string out. WebAssembly functions take
   only numbers, so a string crosses as a pointer and a length.
3. **`src/wasm.ts`**. The other side of the same boundary: allocate, copy, call,
   copy back, free.
4. **`src/tools/analyze_text.ts`**. A tool is a description, an argument schema,
   and an `execute` function. The model sees the first two.
5. **`src/prompts/text_coach.ts`** and **`src/models/coach_model.ts`**. The
   instructions, the model they run on, and the tools the model may call.
6. **`src/agents/text_coach.ts`**. Two sides: a prompt and a person.
7. **`src/index.ts`**. What the package exports: one registry per kind of
   definition, each entry a function that loads one definition, plus `__meta`.
8. **`package.json`**. The `standardagent` keyword and the `standardagent` field
   are what the catalogue in this repository looks for.

## How the Rust gets into an npm package

`scripts/build.mjs` runs before `tsc`:

1. `cargo build --release --target wasm32-unknown-unknown` writes
   `rust/target/wasm32-unknown-unknown/release/text_stats.wasm`.
2. The script embeds that file as base64 in `src/generated/wasm-bytes.ts`.
3. It copies the name and version from `package.json` into
   `src/generated/package-info.ts`, so `__meta` cannot drift from the manifest.

`src/generated/` and `dist/` are build output and are not committed.

The Rust crate has no dependencies, and the boundary code is written by hand.
Tools such as `wasm-bindgen` generate that code for you. Here it is spelled out
so that each step is visible.

## Things to try

- Add a statistic. Add a field to `Stats` in `rust/src/lib.rs`, write it in
  `to_json`, add it to `TextStats` in `src/wasm.ts`, and extend a test on each
  side.
- Change the coaching. Edit the instructions in `src/prompts/text_coach.ts`.
- Change the model. Edit the `model` line in `src/models/coach_model.ts`, or
  swap `@standardagents/anthropic` for another provider package.
- Add a second tool. Create a file in `src/tools/`, add it to `tools` in
  `src/index.ts`, and name it in the prompt's `tools` list.

## What the sample does not do

- **It has not run on a hosted runtime.** The tests load the package, check
  every definition, and run the tool. A full conversation needs a runtime that
  implements the specification, and an API key for the model provider.
- **The WebAssembly loader compiles the module from bytes at run time.** Node,
  Deno, Bun, and browsers allow that. Cloudflare Workers does not: a Worker must
  import a `.wasm` file as a module. To run there, change `load()` in
  `src/wasm.ts` to use a static import. Nothing else needs to change.
- **The statistics are English heuristics.** Syllables are estimated from vowel
  groups, and an abbreviation such as "e.g." counts as the end of a sentence.

## Safety notes

- The tool accepts at most 100,000 characters, checked by the argument schema,
  and `src/wasm.ts` refuses more than 400,000 bytes before any memory is
  allocated.
- The WebAssembly module imports nothing. It cannot reach the network, the file
  system, or a clock. It can only compute on the bytes it is given.
- The tool returns numbers only, so text that a writer submits never comes back
  to the model through the tool. The prompt also tells the model to treat
  submitted text as material to review, not as instructions.
- `@standardagents/spec` and `@standardagents/anthropic` are pinned to an exact
  version. That project publishes several releases a day, so each version is
  newer than pnpm's minimum release age, and `pnpm-workspace.yaml` in this
  directory lists the exceptions. Review that list before you raise a version.
