import { defineTool } from '@standardagents/spec';
import { specReference } from '../wasm.js';

/**
 * Returns the spec format and the theme. The data comes from the Rust code, so
 * what the model reads is what the builder accepts.
 */
export default defineTool({
  description:
    'Get the diagram spec format, the component kinds, the zone colours, and the edge styles. ' +
    'Call this once before writing the first diagram.',
  execute: async () => {
    try {
      return { status: 'success', result: JSON.stringify(specReference()) };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'The reference could not be read.',
      };
    }
  },
});
