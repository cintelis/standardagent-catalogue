import { defineAgent } from '@standardagents/spec';

/**
 * A model drives side A with the `diagram_designer` prompt, and a person is on
 * side B.
 */
export default defineAgent({
  name: 'diagram_designer',
  title: 'Diagram Designer',
  description: 'Designs draw.io diagrams as editable SVG files and fixes the layout problems it finds.',
  sideA: { label: 'Designer', prompt: 'diagram_designer' },
  sideB: { label: 'Requester', human: true },
  // An entry agent: other agents outside this package can call it as a tool.
  exposeAsTool: true,
  toolDescription:
    'Hand a description of a system, a process, or a schema to the Diagram Designer and get an editable draw.io diagram back.',
});
