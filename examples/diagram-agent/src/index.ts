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
  diagram_designer: async () => (await import('./agents/diagram_designer.js')).default,
} satisfies PackedExports['agents'];

export const prompts = {
  diagram_designer: async () => (await import('./prompts/diagram_designer.js')).default,
} satisfies PackedExports['prompts'];

export const tools = {
  spec_reference: async () => (await import('./tools/spec_reference.js')).default,
  create_diagram: async () => (await import('./tools/create_diagram.js')).default,
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
  entryAgents: ['diagram_designer'],
  packedAt: PACKED_AT,
  description: 'Designs draw.io diagrams as editable SVG files and fixes the layout problems it finds.',
};
