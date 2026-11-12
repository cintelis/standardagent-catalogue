import { defineAgent } from '@standardagents/spec';

/**
 * An agent is a conversation with two sides. Here a model drives side A with
 * the `text_coach` prompt, and a person is on side B.
 */
export default defineAgent({
  name: 'text_coach',
  title: 'Text Coach',
  description: 'Reviews a piece of writing and suggests how to make it easier to read.',
  sideA: { label: 'Coach', prompt: 'text_coach' },
  sideB: { label: 'Writer', human: true },
  // An entry agent: other agents outside this package can call it as a tool.
  exposeAsTool: true,
  toolDescription: 'Hand a piece of writing to the Text Coach for a readability review.',
});
