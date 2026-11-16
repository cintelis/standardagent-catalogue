/**
 * Gives `wasm.ts` the compiled WebAssembly module on Cloudflare Workers.
 *
 * A Worker may not compile a module from bytes at run time. It imports the
 * `.wasm` file, and the bundler hands it over already compiled. The
 * `#wasm-module` entry in package.json picks this file when the bundler
 * builds for Workers (the `workerd` condition), so the base64 copy of the
 * module stays out of the Worker.
 *
 * `scripts/build.mjs` puts text_stats.wasm next to the compiled copy of this
 * file in dist/.
 */

import compiled from './text_stats.wasm';

export function wasmModule(): WebAssembly.Module {
  return compiled;
}
