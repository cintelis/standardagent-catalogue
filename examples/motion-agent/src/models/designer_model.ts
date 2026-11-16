import { defineModel } from '@standardagents/spec';
import { anthropic } from '@standardagents/anthropic';

/**
 * The model the designer runs on. Prompts refer to the name, so changing the
 * model is a change to this file only.
 *
 * The runtime that hosts the agent supplies the provider's API key.
 */
export default defineModel({
  name: 'designer_model',
  provider: anthropic,
  model: 'claude-fable-5-2',
});
