/**
 * Writes the animation as one SVG file.
 *
 * The file holds no script and no style sheet. The motion is SMIL: an
 * `<animate>` or `<animateTransform>` element with a list of values and the
 * moments they belong to. Browsers play it in a page and in an `<img>`, so the
 * file works anywhere a picture does.
 *
 * Each shape sits in up to three nested groups, one for each kind of change:
 * where it is, how far it is turned, and how large it is. The shape itself is
 * drawn about the point (0, 0), so that it turns and grows about its own
 * middle.
 */
import { isStill, simplify, type Motion } from './motion.js';
import type { Property, Scene, Shape } from './spec.js';

/** How far a value may be from the true one, for each kind of value. */
const TOLERANCE: Record<Property, number> = {
  x: 0.25,
  y: 0.25,
  scale: 0.004,
  rotate: 0.25,
  opacity: 0.01,
  draw: 0.004,
};

const FONT_FAMILY = {
  sans: 'system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif',
  serif: 'Georgia, Times New Roman, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const;

/** A number as short as it can be written, to `places` decimal places. */
function n(value: number, places = 2): string {
  const rounded = Number(value.toFixed(places));
  // -0 would be written as "-0".
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** Text that is safe between two tags or inside a quoted attribute. */
export function escapeXml(text: string): string {
  return (
    text
      // Characters that XML 1.0 does not allow at all.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  );
}

/** The middle of a shape, measured from its x and y. It turns about this point. */
export function pivot(shape: Shape): [number, number] {
  switch (shape.type) {
    case 'rect':
      return [shape.w / 2, shape.h / 2];
    case 'line':
      return [(shape.x2 - shape.x) / 2, (shape.y2 - shape.y) / 2];
    case 'path':
      return [shape.ox, shape.oy];
    default:
      return [0, 0];
  }
}

export interface Written {
  svg: string;
  /** How many keyframes the file holds, over every shape. */
  keyframes: number;
}

export function writeSvg(scene: Scene, motion: Motion): Written {
  const seconds = n(motion.duration / 1000, 3);
  const timing = scene.loop ? `dur="${seconds}s" repeatCount="indefinite"` : `dur="${seconds}s" fill="freeze"`;
  let keyframes = 0;

  /** The `values` and `keyTimes` of one animation element, or null when the value never changes. */
  const animation = (
    tracks: number[][],
    tolerance: number,
    write: (values: number[]) => string,
  ): string | null => {
    if (motion.duration <= 0 || tracks.every((track) => isStill(track, tolerance))) return null;
    const frames = simplify(motion.times, tracks, tolerance);
    keyframes += frames.length;
    const values = frames.map((frame) => write(tracks.map((track) => track[frame]!))).join(';');
    const keyTimes = frames.map((frame) => n(motion.times[frame]!, 4)).join(';');
    return `values="${values}" keyTimes="${keyTimes}" ${timing}`;
  };

  const parts: string[] = [];
  for (const [i, shape] of scene.shapes.entries()) {
    const track = motion.tracks[i]!;
    const [px, py] = pivot(shape);

    // The innermost part: the shape itself, drawn about (0, 0).
    const paint =
      ` fill="${shape.fill}"` +
      (shape.stroke === 'none'
        ? ''
        : ` stroke="${shape.stroke}" stroke-width="${n(shape.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"`);

    // `draw` shows part of the stroke. The outline is given the length 1, and
    // a gap of the same length slides along it.
    const drawn = animation([track.draw.map((value) => 1 - value)], TOLERANCE.draw, ([offset]) => n(offset!, 3));
    const partly = drawn !== null || shape.draw < 1;
    const dash = partly ? ` pathLength="1" stroke-dasharray="1" stroke-dashoffset="${n(1 - shape.draw, 3)}"` : '';
    const drawAnimation = drawn ? `<animate attributeName="stroke-dashoffset" ${drawn}/>` : '';
    const close = (tag: string, attributes: string, content = '') =>
      drawAnimation || content ? `<${tag}${attributes}>${content}${drawAnimation}</${tag}>` : `<${tag}${attributes}/>`;

    let body: string;
    switch (shape.type) {
      case 'rect':
        body = close(
          'rect',
          ` x="${n(-px)}" y="${n(-py)}" width="${n(shape.w)}" height="${n(shape.h)}"` +
            (shape.radius > 0 ? ` rx="${n(shape.radius)}"` : '') +
            paint +
            dash,
        );
        break;
      case 'circle':
        body = close('circle', ` r="${n(shape.r)}"${paint}${dash}`);
        break;
      case 'line':
        body = close('line', ` x1="${n(-px)}" y1="${n(-py)}" x2="${n(px)}" y2="${n(py)}"${paint}${dash}`);
        break;
      case 'path':
        body = close('path', ` d="${escapeXml(shape.d)}" transform="translate(${n(-px)} ${n(-py)})"${paint}${dash}`);
        break;
      case 'text':
        body =
          `<text text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY[shape.font]}"` +
          ` font-size="${n(shape.size)}"${shape.weight === 'bold' ? ' font-weight="700"' : ''}${paint}>` +
          `${escapeXml(shape.text)}</text>`;
        break;
    }

    // How large it is. Left out when it stays at its own size.
    const scaled = animation([track.scale], TOLERANCE.scale, ([value]) => n(value!, 3));
    if (scaled || shape.scale !== 1) {
      body =
        `<g transform="scale(${n(shape.scale, 3)})">` +
        (scaled ? `<animateTransform attributeName="transform" type="scale" ${scaled}/>` : '') +
        `${body}</g>`;
    }

    // How far it is turned.
    const turned = animation([track.rotate], TOLERANCE.rotate, ([value]) => n(value!));
    if (turned || shape.rotate !== 0) {
      body =
        `<g transform="rotate(${n(shape.rotate)})">` +
        (turned ? `<animateTransform attributeName="transform" type="rotate" ${turned}/>` : '') +
        `${body}</g>`;
    }

    // Where it is, and how solid it is.
    const moved = animation(
      [track.x.map((value) => value + px), track.y.map((value) => value + py)],
      TOLERANCE.x,
      ([x, y]) => `${n(x!)} ${n(y!)}`,
    );
    const faded = animation([track.opacity], TOLERANCE.opacity, ([value]) => n(value!, 3));
    parts.push(
      `<g transform="translate(${n(shape.x + px)} ${n(shape.y + py)})"` +
        (faded || shape.opacity !== 1 ? ` opacity="${n(shape.opacity, 3)}"` : '') +
        '>' +
        (moved ? `<animateTransform attributeName="transform" type="translate" ${moved}/>` : '') +
        (faded ? `<animate attributeName="opacity" ${faded}/>` : '') +
        `${body}</g>`,
    );
  }

  const title = escapeXml(scene.title);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(scene.width)} ${n(scene.height)}"` +
    ` width="${n(scene.width)}" height="${n(scene.height)}" role="img" aria-label="${title}">` +
    `<title>${title}</title>` +
    (scene.background === 'none'
      ? ''
      : `<rect width="${n(scene.width)}" height="${n(scene.height)}" fill="${scene.background}"/>`) +
    parts.join('') +
    '</svg>\n';
  return { svg, keyframes };
}
