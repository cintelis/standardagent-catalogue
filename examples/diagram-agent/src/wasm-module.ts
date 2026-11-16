/**
 * Gives `wasm.ts` the compiled WebAssembly module. This is the default
 * loader, for Node, Deno, Bun, and browsers.
 *
 * The bytes travel inside the package's JavaScript as base64, so the package
 * needs no file access and no bundler setting to find them.
 *
 * Cloudflare Workers does not allow a module to be compiled from bytes at run
 * time. There, the `#wasm-module` entry in package.json picks
 * `wasm-module.workerd.ts` in place of this file.
 */

import { WASM_BASE64 } from './generated/wasm-bytes.js';

export function wasmModule(): WebAssembly.Module {
  const bytes = Uint8Array.from(atob(WASM_BASE64), (char) => char.charCodeAt(0));
  return new WebAssembly.Module(bytes);
}
