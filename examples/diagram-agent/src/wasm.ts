/**
 * Loads the Rust code and calls it.
 *
 * The Rust crate exposes one function, `handle`, that takes a JSON request and
 * returns a JSON response. WebAssembly functions take and return only numbers,
 * so each string crosses as a pointer and a length into the module's memory.
 * `rust/src/lib.rs` describes the same boundary from the other side.
 */

import { WASM_BASE64 } from './generated/wasm-bytes.js';

/** One problem the checker found. */
export interface CheckIssue {
  page: string;
  severity: 'error' | 'warning';
  /** For example `overlap`, `out-of-page`, `edge-through-shape`, `label-overflow`. */
  code: string;
  /** The id of the cell, or two ids for an overlap. */
  cell: string;
  message: string;
}

export interface CheckReport {
  path: string;
  pages: number;
  cells: number;
  errors: number;
  warnings: number;
  issues: CheckIssue[];
}

/** Everything the Rust code makes from one spec. */
export interface CreatedDiagram {
  /** The `.drawio` file. */
  xml: string;
  /** One SVG for each page, with the `.drawio` file embedded. */
  svgs: string[];
  check: CheckReport;
}

/** The spec format and the theme. */
export interface SpecReference {
  spec_format: string;
  kinds: { kind: string; label: string; shape: string }[];
  zone_colours: string[];
  edge_styles: { style: string; label: string }[];
  default_node_size: [number, number];
}

/** A spec that the Rust code refused. The message names every problem. */
export class DiagramSpecError extends Error {
  override name = 'DiagramSpecError';
}

/** The largest request the module accepts, in UTF-8 bytes. */
export const MAX_REQUEST_BYTES = 1_000_000;

/** The functions that `rust/src/lib.rs` exports with `#[unsafe(no_mangle)]`. */
interface DrawgenExports {
  memory: WebAssembly.Memory;
  drawgen_alloc(len: number): number;
  drawgen_free(ptr: number, len: number): void;
  drawgen_handle(ptr: number, len: number): bigint;
}

let cached: DrawgenExports | undefined;

/** Compiles the module on first use and reuses it afterwards. */
function load(): DrawgenExports {
  if (!cached) {
    const bytes = Uint8Array.from(atob(WASM_BASE64), (char) => char.charCodeAt(0));
    // The module imports nothing, so it can reach no network, file, or clock.
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
    cached = instance.exports as unknown as DrawgenExports;
  }
  return cached;
}

/** Sends one JSON request to the Rust code and returns its JSON response. */
function call(request: unknown): Record<string, unknown> {
  const input = new TextEncoder().encode(JSON.stringify(request));
  if (input.length > MAX_REQUEST_BYTES) {
    throw new RangeError(`The request is ${input.length} bytes; the limit is ${MAX_REQUEST_BYTES}.`);
  }

  const wasm = load();
  const inputPtr = wasm.drawgen_alloc(input.length) >>> 0;
  if (inputPtr === 0) {
    throw new Error('The WebAssembly module could not allocate memory.');
  }

  let packed: bigint;
  try {
    // Create each view after the allocation it belongs to. When the memory
    // grows, `memory.buffer` becomes a new ArrayBuffer and old views detach.
    new Uint8Array(wasm.memory.buffer, inputPtr, input.length).set(input);
    // The result packs the pointer to the response and its length into one
    // 64-bit number.
    packed = wasm.drawgen_handle(inputPtr, input.length);
  } finally {
    wasm.drawgen_free(inputPtr, input.length);
  }

  const outputPtr = Number(packed >> 32n);
  const outputLen = Number(packed & 0xffff_ffffn);
  try {
    const json = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, outputPtr, outputLen));
    return JSON.parse(json) as Record<string, unknown>;
  } finally {
    wasm.drawgen_free(outputPtr, outputLen);
  }
}

/** The spec format, kinds, zone colours, and edge styles. */
export function specReference(): SpecReference {
  return call({ op: 'reference' }).reference as SpecReference;
}

/**
 * Builds, checks, and renders a spec. `path` is the name the check report
 * shows. Throws `DiagramSpecError` when the spec is not valid.
 */
export function createDiagram(spec: unknown, path: string): CreatedDiagram {
  const response = call({ op: 'create', spec, path });
  if (response.ok !== true) {
    throw new DiagramSpecError(String(response.error));
  }
  return {
    xml: response.xml as string,
    svgs: response.svgs as string[],
    check: response.check as CheckReport,
  };
}
