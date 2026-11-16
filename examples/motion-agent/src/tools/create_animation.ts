import { defineTool } from '@standardagents/spec';
import { z } from 'zod';
import { createAnimation, MotionSpecError, type CheckReport } from '../engine/index.js';
import { EASES, FONTS, LIMITS, SHAPE_TYPES, WEIGHTS } from '../engine/spec.js';

// Bounds on every value, so that one tool call cannot ask for unbounded work.
//
// The specification limits a tool's arguments to a fixed set of Zod types. A
// strict object is not among them, so this schema drops a key it does not
// name. The engine checks the spec again and names every problem it finds.
const id = z.string().min(1).max(LIMITS.maxId);
const coordinate = z.number().min(-LIMITS.maxCoordinate).max(LIMITS.maxCoordinate);
const length = z.number().min(0.1).max(LIMITS.maxCoordinate);
const canvas = z.number().min(LIMITS.minCanvas).max(LIMITS.maxCanvas);
const colour = z.string().max(9).describe('A hex colour such as "#0969da", or "none".');
const unit = z.number().min(0).max(1);
const scale = z.number().min(0).max(50);
const turn = z.number().min(-3600).max(3600);
const time = z.number().min(0).max(LIMITS.maxDuration);

const args = z.object({
  name: z.string().min(1).max(80).describe('A short name for the file, such as "logo-reveal".'),
  title: z
    .string()
    .min(1)
    .max(LIMITS.maxTitle)
    .describe('One line that says what the animation shows. Screen readers read it out.'),
  width: canvas.optional().describe('Canvas width. Default: 480.'),
  height: canvas.optional().describe('Canvas height. Default: 270.'),
  background: colour.optional().describe('The colour behind the shapes. Default: none, which is see-through.'),
  loop: z
    .boolean()
    .optional()
    .describe('true plays the animation again and again. false plays it once and keeps the last frame. Default: true.'),
  shapes: z
    .array(
      z.object({
        id,
        type: z.enum(SHAPE_TYPES),
        x: coordinate
          .optional()
          .describe('Left edge of a rect, centre of a circle, middle of a text, start of a line. A path: an offset, default 0.'),
        y: coordinate.optional().describe('Top edge of a rect. Otherwise as x.'),
        w: length.optional().describe('Width of a rect.'),
        h: length.optional().describe('Height of a rect.'),
        radius: z.number().min(0).max(LIMITS.maxCoordinate).optional().describe('Corner radius of a rect.'),
        r: length.optional().describe('Radius of a circle.'),
        x2: coordinate.optional().describe('End of a line.'),
        y2: coordinate.optional(),
        text: z.string().max(LIMITS.maxText).optional().describe('The words of a text.'),
        size: z.number().min(4).max(400).optional().describe('Font size of a text. Default: 24.'),
        weight: z.enum(WEIGHTS).optional(),
        font: z.enum(FONTS).optional(),
        d: z.string().max(LIMITS.maxPath).optional().describe('SVG path data of a path, such as "M 10 10 L 90 10".'),
        ox: coordinate.optional().describe('The point a path turns and grows about, in its own numbers. Default: 0.'),
        oy: coordinate.optional(),
        fill: colour.optional(),
        stroke: colour.optional(),
        strokeWidth: z.number().min(0).max(200).optional(),
        opacity: unit.optional().describe('How solid the shape is at the start, 0 to 1. Default: 1.'),
        scale: scale.optional().describe('How large the shape is at the start. Default: 1.'),
        rotate: turn.optional().describe('How far the shape is turned at the start, in degrees. Default: 0.'),
        draw: unit.optional().describe('How much of the stroke is drawn at the start, 0 to 1. Default: 1.'),
      }),
    )
    .min(1)
    .max(LIMITS.maxShapes)
    .describe('The shapes, as they are at the start. Later shapes are drawn on top.'),
  steps: z
    .array(
      z.object({
        targets: z.array(id).min(1).max(LIMITS.maxShapes).describe('The ids of the shapes this step changes.'),
        to: z
          .object({
            x: coordinate.optional(),
            y: coordinate.optional(),
            scale: scale.optional(),
            rotate: turn.optional().describe('Degrees. 360 is one full turn.'),
            opacity: unit.optional(),
            draw: unit.optional().describe('1 draws the whole stroke. Needs a stroke.'),
          })
          .describe('The values to reach by the end of the step.'),
        duration: time.optional().describe('Milliseconds. Default: 600.'),
        at: time
          .optional()
          .describe('When the step starts, in milliseconds from the start. Leave it out to start when every step before it has ended.'),
        ease: z.enum(EASES).optional().describe('Default: outQuad.'),
        stagger: z
          .number()
          .min(0)
          .max(5000)
          .optional()
          .describe('Milliseconds between one target and the next, so that they follow one another.'),
      }),
    )
    .max(LIMITS.maxSteps)
    .optional()
    .describe('What moves, in order.'),
});

/** The most issues one result lists. The counts always cover every issue. */
export const MAX_REPORTED_ISSUES = 40;

/** Keeps the errors first, lists at most MAX_REPORTED_ISSUES, and counts the rest. */
export function limitReport(check: CheckReport) {
  const ordered = [
    ...check.issues.filter((issue) => issue.severity === 'error'),
    ...check.issues.filter((issue) => issue.severity !== 'error'),
  ];
  const issues = ordered.slice(0, MAX_REPORTED_ISSUES);
  const rest = ordered.slice(MAX_REPORTED_ISSUES);
  if (rest.length === 0) return { ...check, issues };
  const byCode: Record<string, number> = {};
  for (const issue of rest) byCode[issue.code] = (byCode[issue.code] ?? 0) + 1;
  return {
    ...check,
    issues,
    omitted: {
      count: rest.length,
      by_code: byCode,
      note: `Only the first ${issues.length} of ${ordered.length} issues are listed, errors first. Fix them and build again to see the rest.`,
    },
  };
}

/** A name that is safe in a file name: lower case, digits, and hyphens. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return slug || 'animation';
}

/** The first 8 hex characters of the SHA-256 of the file. */
async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).slice(0, 4), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  // In chunks, because one call with every byte as an argument can overflow the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Builds an animation from a spec and checks it.
 *
 * The result has two parts. The text is the check report, which the model
 * reads and acts on. The attachment is the picture: one SVG file that plays
 * without script.
 */
export default defineTool({
  description:
    'Build an animated SVG from a spec of shapes and steps. Returns a check report and attaches NAME.svg, ' +
    'a picture that plays on its own, with no script in it. You cannot watch the animation, so read the ' +
    'report: fix every error and warning in it, then call this tool again with the corrected spec.',
  args,
  execute: async (_state, { name, ...spec }) => {
    try {
      const created = createAnimation(spec);
      // The hash changes when the animation changes, so a changed one gets a
      // new file name and nobody sees a stale cached picture.
      const file = `${await contentHash(created.svg)}-${slugify(name)}.svg`;
      return {
        status: 'success',
        result: JSON.stringify({ file, check: limitReport(created.check) }),
        attachments: [{ name: file, mimeType: 'image/svg+xml', data: toBase64(created.svg) }],
      };
    } catch (error) {
      if (error instanceof MotionSpecError) {
        // Each line names one entry of the spec and what would be accepted.
        return { status: 'error', error: error.message, error_code: 'invalid_spec' };
      }
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'The animation could not be built.',
      };
    }
  },
});
