import { defineTool } from '@standardagents/spec';
import { z } from 'zod';
import { DEFAULTS, EASES, FONTS, LIMITS, PROPERTIES, SHAPE_TYPES } from '../engine/spec.js';

/** The spec format, written for a model to read once. */
export const SPEC_FORMAT = `
An animation spec has a canvas, a list of shapes, and a list of steps.

  title       one line that says what the animation shows
  width       canvas width, default ${DEFAULTS.width}
  height      canvas height, default ${DEFAULTS.height}
  background  a hex colour, or leave it out for a see-through background
  loop        true (default) plays again and again; false plays once and keeps the last frame
  shapes      [{id, type, ...}]   as they are at the start; later shapes are drawn on top
  steps       [{targets, to, duration, at, ease, stagger}]   what moves, in order

Shapes, and where x and y are measured to:
  rect    x, y = top left corner.   w, h, radius
  circle  x, y = centre.            r
  line    x, y = start.             x2, y2 = end
  text    x, y = middle.            text, size, weight (normal, bold), font (sans, serif, mono)
  path    d = SVG path data.        x, y = an offset (default 0); ox, oy = the point it turns about

Every shape also takes: fill, stroke, strokeWidth, and its starting opacity (0 to 1),
scale (1 = its own size), rotate (degrees), and draw (0 to 1, how much of the stroke shows).
A shape turns and grows about its own middle.

A step moves its targets to the values in "to". It can change:
  x, y      where the shape is, in the same sense as the shape's own x and y
  scale     1 = its own size
  rotate    degrees; 360 is one full turn
  opacity   0 = clear, 1 = solid
  draw      0 = no stroke drawn, 1 = all of it; needs a stroke

  duration  milliseconds, default ${DEFAULTS.duration}
  at        milliseconds from the start; leave it out to start when every step before it has ended
  ease      default ${DEFAULTS.ease}
  stagger   milliseconds between one target and the next

A value that no step has changed yet keeps the value the shape started with.

Example: three dots that rise one after another, then go back.

  {"name": "loading",
   "title": "Three dots rising in turn",
   "width": 200, "height": 100, "background": "#ffffff",
   "shapes": [
     {"id": "a", "type": "circle", "x": 60,  "y": 60, "r": 10, "fill": "#0969da"},
     {"id": "b", "type": "circle", "x": 100, "y": 60, "r": 10, "fill": "#0969da"},
     {"id": "c", "type": "circle", "x": 140, "y": 60, "r": 10, "fill": "#0969da"}],
   "steps": [
     {"targets": ["a", "b", "c"], "to": {"y": 36}, "duration": 300, "ease": "outQuad", "stagger": 120},
     {"targets": ["a", "b", "c"], "to": {"y": 60}, "duration": 300, "ease": "inQuad", "stagger": 120, "at": 300},
     {"targets": ["a"], "to": {"y": 60}, "duration": 400}]}

The last step changes nothing. It holds the picture still before the loop starts again.

Steps that share a moment run together: give them the same "at".
`.trim();

/**
 * Gives the model the spec format and the names it can use. It takes no
 * arguments, and its answer is the same every time.
 */
export default defineTool({
  description:
    'Read the animation spec format, the shapes, the easings, and the limits. ' +
    'Call this once, before the first call to create_animation.',
  args: z.object({}),
  execute: async () => ({
    status: 'success',
    result: JSON.stringify({
      spec_format: SPEC_FORMAT,
      shape_types: SHAPE_TYPES,
      properties: PROPERTIES,
      eases: EASES,
      fonts: FONTS,
      limits: {
        shapes: LIMITS.maxShapes,
        steps: LIMITS.maxSteps,
        canvas: [LIMITS.minCanvas, LIMITS.maxCanvas],
        duration_ms: LIMITS.maxDuration,
      },
    }),
  }),
});
