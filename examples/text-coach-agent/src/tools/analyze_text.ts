import { defineTool } from '@standardagents/spec';
import { z } from 'zod';
import { analyzeText } from '../wasm.js';

/**
 * A tool is a function the model can call. The description and the argument
 * schema are what the model sees. `execute` is what runs.
 *
 * A model estimates word counts and readability badly, so this tool hands the
 * arithmetic to the Rust code and returns exact numbers.
 */
export default defineTool({
  description:
    'Measure a piece of English text. Returns exact counts of characters, words, sentences, ' +
    'paragraphs, and syllables, the longest sentence in words, the reading time in seconds, ' +
    'and two readability scores: Flesch Reading Ease and Flesch-Kincaid Grade Level.',
  // The runtime validates the arguments against this schema before `execute` runs.
  args: z.object({
    text: z.string().min(1).max(100_000).describe('The text to measure, exactly as written.'),
  }),
  execute: async (_state, args) => {
    try {
      // The result holds only numbers, so nothing the writer typed is echoed
      // back to the model through this tool.
      return { status: 'success', result: JSON.stringify(analyzeText(args.text)) };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'The text could not be measured.',
      };
    }
  },
});
