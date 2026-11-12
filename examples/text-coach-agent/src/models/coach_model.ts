import { defineModel } from '@standardagents/spec';
import { anthropic } from '@standardagents/anthropic';

/**
 * A model definition gives a model a name inside this package and says which
 * provider calls it. Prompts refer to the name, so changing the model is a
 * change to this file only.
 *
 * The runtime that hosts the agent supplies the provider's API key.
 */
export default defineModel({
  name: 'coach_model',
  provider: anthropic,
  model: 'claude-fable-5-2',
});
