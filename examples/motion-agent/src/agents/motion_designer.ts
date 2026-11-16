import { defineAgent } from '@standardagents/spec';

/**
 * A model drives side A with the `motion_designer` prompt, and a person is on
 * side B.
 */
export default defineAgent({
  name: 'motion_designer',
  title: 'Motion Designer',
  description: 'Designs animated SVG pictures that play without script, and fixes the problems it finds in them.',
  sideA: { label: 'Designer', prompt: 'motion_designer' },
  sideB: { label: 'Requester', human: true },
  // An entry agent: other agents outside this package can call it as a tool.
  exposeAsTool: true,
  toolDescription:
    'Hand a description of a motion, such as a logo reveal, a loading indicator, or an animated diagram, ' +
    'to the Motion Designer and get an animated SVG file back.',
});
