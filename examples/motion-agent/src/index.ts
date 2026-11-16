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
  motion_designer: async () => (await import('./agents/motion_designer.js')).default,
} satisfies PackedExports['agents'];

export const prompts = {
  motion_designer: async () => (await import('./prompts/motion_designer.js')).default,
} satisfies PackedExports['prompts'];

export const tools = {
  motion_reference: async () => (await import('./tools/motion_reference.js')).default,
  create_animation: async () => (await import('./tools/create_animation.js')).default,
} satisfies PackedExports['tools'];

export const models = {
  designer_model: async () => (await import('./models/designer_model.js')).default,
} satisfies PackedExports['models'];

// This package has no handlers or hooks. The registries are still required.
export const handlers = {} satisfies PackedExports['handlers'];
export const hooks = {} satisfies PackedExports['hooks'];

/** Must agree with the `standardagent` field in package.json. */
export const __meta: PackedMeta = {
  packageId: PACKAGE_ID,
  version: PACKAGE_VERSION,
  entryAgents: ['motion_designer'],
  packedAt: PACKED_AT,
  description: 'Designs animated SVG pictures that play without script, and fixes the problems it finds in them.',
};
