/**
 * Loads the Rust code and calls it.
 *
 * This file is the TypeScript half of the boundary that `rust/src/lib.rs`
 * describes in its `ffi` module. WebAssembly functions take and return only
 * numbers, so a string crosses as a pointer and a length into the module's
 * memory.
 */

import { WASM_BASE64 } from './generated/wasm-bytes.js';

/** The numbers the Rust code returns. The field names match the Rust `Stats` struct. */
export interface TextStats {
  characters: number;
  words: number;
  sentences: number;
  paragraphs: number;
  syllables: number;
  longest_sentence_words: number;
  reading_time_seconds: number;
  /** `null` when the text has no words. */
  average_words_per_sentence: number | null;
  flesch_reading_ease: number | null;
  flesch_kincaid_grade: number | null;
}

/** The largest input the module accepts, in UTF-8 bytes. */
export const MAX_INPUT_BYTES = 400_000;

/** The functions that `rust/src/lib.rs` exports with `#[unsafe(no_mangle)]`. */
interface TextStatsExports {
  memory: WebAssembly.Memory;
  text_stats_alloc(len: number): number;
  text_stats_free(ptr: number, len: number): void;
  text_stats_analyze(ptr: number, len: number): bigint;
}

let cached: TextStatsExports | undefined;

/** Compiles the module on first use and reuses it afterwards. */
function load(): TextStatsExports {
  if (!cached) {
    const bytes = Uint8Array.from(atob(WASM_BASE64), (char) => char.charCodeAt(0));
    // The module imports nothing, so it can reach no network, file, or clock.
    // It can only compute on the bytes it is given.
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
    cached = instance.exports as unknown as TextStatsExports;
  }
  return cached;
}

/** Measures `text` with the Rust code. */
export function analyzeText(text: string): TextStats {
  const input = new TextEncoder().encode(text);
  if (input.length > MAX_INPUT_BYTES) {
    throw new RangeError(`Text is ${input.length} bytes; the limit is ${MAX_INPUT_BYTES}.`);
  }

  const wasm = load();

  // 1. Ask Rust for a buffer and copy the text into it.
  //    `>>> 0` reads the pointer as an unsigned 32-bit number.
  const inputPtr = wasm.text_stats_alloc(input.length) >>> 0;
  if (inputPtr === 0) {
    throw new Error('The WebAssembly module could not allocate memory.');
  }

  let packed: bigint;
  try {
    // Create each view after the allocation it belongs to. When the memory
    // grows, `memory.buffer` becomes a new ArrayBuffer and old views detach.
    new Uint8Array(wasm.memory.buffer, inputPtr, input.length).set(input);

    // 2. Run the analysis. The result packs two 32-bit numbers into one
    //    64-bit number: the pointer to the JSON, then its length.
    packed = wasm.text_stats_analyze(inputPtr, input.length);
  } finally {
    wasm.text_stats_free(inputPtr, input.length);
  }

  const outputPtr = Number(packed >> 32n);
  const outputLen = Number(packed & 0xffff_ffffn);

  // 3. Copy the JSON out, then give the buffer back to Rust.
  try {
    const json = new TextDecoder().decode(
      new Uint8Array(wasm.memory.buffer, outputPtr, outputLen),
    );
    return JSON.parse(json) as TextStats;
  } finally {
    wasm.text_stats_free(outputPtr, outputLen);
  }
}
