import { defineTool } from '@standardagents/spec';
import { z } from 'zod';
import { createDiagram, DiagramSpecError } from '../wasm.js';

/** The names the theme defines. A test checks them against the Rust code. */
export const KINDS = [
  'actor', 'external', 'service', 'ai', 'worker', 'datastore', 'queue', 'ui', 'gov', 'security',
  'decision', 'step', 'terminal', 'note',
] as const;
export const ZONE_COLOURS = ['blue', 'green', 'purple', 'amber', 'grey', 'red', 'teal'] as const;
export const EDGE_STYLES = ['sync', 'async', 'data', 'ai', 'weak'] as const;

// Bounds on every value, so that one tool call cannot ask for unbounded work.
const id = z.string().min(1).max(80);
const label = z.string().min(1).max(300);
const position = z.number().min(-20_000).max(20_000);
const size = z.number().min(1).max(20_000);
const side = z.enum(['top', 'bottom', 'left', 'right']);

const args = z.object({
  name: z.string().min(1).max(80).describe('A short name for the file, such as "order-flow".'),
  title: z.string().min(1).max(200).describe('The title shown at the top of the page.'),
  subtitle: z.string().max(300).optional().describe('One line under the title.'),
  width: size.optional().describe('Page width. Leave out width and height to fit the content.'),
  height: size.optional(),
  layout: z
    .enum(['auto', 'manual'])
    .optional()
    .describe('"auto" places the nodes that have no x and y. Otherwise every node needs x and y.'),
  direction: z.enum(['right', 'down']).optional().describe('The flow direction for auto layout.'),
  zones: z
    .array(
      z.object({
        id,
        label,
        x: position,
        y: position,
        w: size,
        h: size,
        colour: z.enum(ZONE_COLOURS).optional(),
      }),
    )
    .max(40)
    .optional()
    .describe('Tinted, titled containers that group nodes.'),
  nodes: z
    .array(
      z.object({
        id,
        label,
        kind: z.enum(KINDS).optional().describe('Picks the shape and the colour. Default: service.'),
        sub: z.string().max(300).optional().describe('A smaller second line.'),
        zone: id.optional().describe('The id of the zone that holds this node.'),
        x: position.optional(),
        y: position.optional(),
        w: size.optional(),
        h: size.optional(),
      }),
    )
    .max(200)
    .optional(),
  entities: z
    .array(
      z.object({
        id,
        name: label,
        fields: z.array(z.string().max(120)).max(60).describe('Prefix "PK " or "FK " to mark a key.'),
        x: position,
        y: position,
        w: size.optional(),
        zone: id.optional(),
      }),
    )
    .max(60)
    .optional()
    .describe('Entity-relationship tables.'),
  edges: z
    .array(
      z.object({
        from: id,
        to: id,
        label: z.string().max(200).optional().describe('What crosses the edge, such as "HTTPS".'),
        style: z.enum(EDGE_STYLES).optional().describe('Default: sync.'),
        exit: side.optional().describe('The side of the source that the edge leaves from.'),
        entry: side.optional().describe('The side of the target that the edge arrives at.'),
        points: z.array(z.array(position)).max(20).optional().describe('Waypoints, each [x, y].'),
        both: z.boolean().optional().describe('An arrowhead at both ends.'),
        curved: z.boolean().optional(),
      }),
    )
    .max(400)
    .optional(),
  texts: z
    .array(
      z.object({
        id,
        label,
        x: position,
        y: position,
        w: size.optional(),
        h: size.optional(),
        size: z.number().min(6).max(72).optional().describe('Font size. Default: 11.'),
        bold: z.boolean().optional(),
        align: z.enum(['left', 'center', 'right']).optional(),
      }),
    )
    .max(60)
    .optional()
    .describe('Free text on the page.'),
  legend: z
    .union([z.boolean(), z.object({ x: position, y: position })])
    .optional()
    .describe('true places a legend right of the content. {x, y} places it there.'),
});

/** A name that is safe in a file name: lower case, digits, and hyphens. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return slug || 'diagram';
}

/** The first 8 hex characters of the SHA-256 of the diagram. */
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
 * Builds a diagram from a spec, checks it, and renders it.
 *
 * The result has two parts. The text is the check report, which the model
 * reads and acts on. The attachment is the picture: a `.drawio.svg` file that
 * shows as an image and opens in draw.io as the diagram.
 */
export default defineTool({
  description:
    'Build a draw.io diagram from a spec. Returns a check report and attaches NAME.drawio.svg, ' +
    'an SVG picture with the diagram embedded, so that draw.io opens it for editing. ' +
    'Fix every error and warning in the report, then call this tool again with the corrected spec.',
  args,
  execute: async (_state, { name, ...spec }) => {
    const slug = slugify(name);
    try {
      const created = createDiagram(spec, `${slug}.drawio.svg`);
      // The hash changes when the diagram changes, so a changed diagram gets
      // a new file name and nobody sees a stale cached picture.
      const file = `${await contentHash(created.xml)}-${slug}.drawio.svg`;
      const svg = created.svgs[0] ?? '';
      return {
        status: 'success',
        result: JSON.stringify({
          file,
          check: { ...created.check, path: file },
          note:
            'Drawn by the built-in renderer: approximate, and still editable. ' +
            'draw.io redraws it exactly the next time someone saves it there.',
        }),
        attachments: [{ name: file, mimeType: 'image/svg+xml', data: toBase64(svg) }],
      };
    } catch (error) {
      if (error instanceof DiagramSpecError) {
        // Each line names one entry of the spec and what would be accepted.
        return { status: 'error', error: error.message, error_code: 'invalid_spec' };
      }
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'The diagram could not be built.',
      };
    }
  },
});
