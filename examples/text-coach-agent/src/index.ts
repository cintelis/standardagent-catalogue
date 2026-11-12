/**
 * The package entry point.
 *
 * A packed Standard Agent package exports one registry per kind of definition.
 * Each entry is a function that returns a promise, so a runtime can list what
 * the package contains and load only what it needs.
 */

import type { PackedExports, PackedMeta } from '@standardagents/spec';
import { PACKAGE_ID, PACKAGE_VERSION, PACKED_AT } from './generated/package-info.js';

export const agents = {
  text_coach: async () => (await import('./agents/text_coach.js')).default,
} satisfies PackedExports['agents'];

export const prompts = {
  text_coach: async () => (await import('./prompts/text_coach.js')).default,
} satisfies PackedExports['prompts'];

export const tools = {
  analyze_text: async () => (await import('./tools/analyze_text.js')).default,
} satisfies PackedExports['tools'];

export const models = {
  coach_model: async () => (await import('./models/coach_model.js')).default,
} satisfies PackedExports['models'];

// This package has no handlers or hooks. The registries are still required.
export const handlers = {} satisfies PackedExports['handlers'];
export const hooks = {} satisfies PackedExports['hooks'];

/** Must agree with the `standardagent` field in package.json. */
export const __meta: PackedMeta = {
  packageId: PACKAGE_ID,
  version: PACKAGE_VERSION,
  entryAgents: ['text_coach'],
  packedAt: PACKED_AT,
  description: 'Reviews a piece of writing and suggests how to make it easier to read.',
};
