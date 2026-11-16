/**
 * Reads an animation spec and checks it.
 *
 * A spec is data: a canvas, a list of shapes, and a list of steps that move
 * them. The tool's argument schema checks a spec before it gets here, but code
 * can call `createAnimation` directly, so this module checks everything again
 * and trusts nothing. Every problem names the entry it is in, so that a model
 * can find it and fix it.
 */

/** What a step can change on a shape. */
export const PROPERTIES = ['x', 'y', 'scale', 'rotate', 'opacity', 'draw'] as const;
export type Property = (typeof PROPERTIES)[number];

export const SHAPE_TYPES = ['rect', 'circle', 'line', 'text', 'path'] as const;
export type ShapeType = (typeof SHAPE_TYPES)[number];

/**
 * The easings a step can name. They are Anime.js easings: `in` starts slowly,
 * `out` ends slowly, and `inOut` does both.
 */
export const EASES = [
  'linear',
  'inQuad', 'outQuad', 'inOutQuad',
  'inCubic', 'outCubic', 'inOutCubic',
  'inQuart', 'outQuart', 'inOutQuart',
  'inSine', 'outSine', 'inOutSine',
  'inExpo', 'outExpo', 'inOutExpo',
  'inCirc', 'outCirc', 'inOutCirc',
  'inBack', 'outBack', 'inOutBack',
  'inElastic', 'outElastic', 'inOutElastic',
  'inBounce', 'outBounce', 'inOutBounce',
] as const;
export type Ease = (typeof EASES)[number];

export const FONTS = ['sans', 'serif', 'mono'] as const;
export const WEIGHTS = ['normal', 'bold'] as const;

/** The bounds on a spec. The tool's schema uses the same numbers. */
export const LIMITS = {
  maxShapes: 120,
  maxSteps: 80,
  maxCanvas: 2000,
  minCanvas: 16,
  /** The longest animation, in milliseconds. */
  maxDuration: 20_000,
  maxCoordinate: 4000,
  maxText: 200,
  maxPath: 4000,
  maxId: 40,
  maxTitle: 200,
} as const;

export const DEFAULTS = {
  width: 480,
  height: 270,
  duration: 600,
  ease: 'outQuad' as Ease,
  fill: '#0969da',
  ink: '#1f2328',
  strokeWidth: 2,
  size: 24,
} as const;

/** `#RGB`, `#RRGGBB`, or `#RRGGBBAA`. */
const COLOUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** The letters and numbers of SVG path data, and nothing else. */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-., \t\r\n]+$/;
const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** A shape, with every value filled in. */
export interface Shape {
  id: string;
  type: ShapeType;
  /** Where the shape is: the top left of a rect, the centre of a circle, the
   *  middle of a text, the start of a line, the offset of a path. */
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  r: number;
  x2: number;
  y2: number;
  text: string;
  size: number;
  weight: (typeof WEIGHTS)[number];
  font: (typeof FONTS)[number];
  d: string;
  /** For a path: the point it turns and grows about, in the path's own numbers. */
  ox: number;
  oy: number;
  /** A colour, or `none`. */
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  scale: number;
  rotate: number;
  draw: number;
}

export interface Step {
  /** Indexes into `Scene.shapes`. */
  targets: number[];
  to: Partial<Record<Property, number>>;
  duration: number;
  /** When the step starts, in milliseconds, or null for "when every step before it has ended". */
  at: number | null;
  ease: Ease;
  /** The delay between one target and the next, in milliseconds. */
  stagger: number;
}

export interface Scene {
  title: string;
  width: number;
  height: number;
  /** A colour, or `none`. */
  background: string;
  loop: boolean;
  shapes: Shape[];
  steps: Step[];
}

/** A spec that cannot be drawn. The message lists every problem. */
export class MotionSpecError extends Error {
  override name = 'MotionSpecError';
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Shows a value in a message, cut short. */
function show(value: unknown): string {
  const text = typeof value === 'string' ? JSON.stringify(value) : String(JSON.stringify(value));
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** Reads the spec, or throws `MotionSpecError` with every problem it found. */
export function parseSpec(spec: unknown): Scene {
  const problems: string[] = [];
  const bad = (where: string, what: string) => problems.push(`${where}: ${what}`);

  /** A number between two bounds. A missing one takes the default. */
  const number = (
    from: Json,
    key: string,
    where: string,
    min: number,
    max: number,
    fallback?: number,
  ): number => {
    const value = from[key];
    if (value === undefined || value === null) {
      if (fallback === undefined) bad(`${where}.${key}`, 'required');
      return fallback ?? 0;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      bad(`${where}.${key}`, `${show(value)} must be a number`);
      return fallback ?? 0;
    }
    if (value < min || value > max) {
      bad(`${where}.${key}`, `${value} must be between ${min} and ${max}`);
      return fallback ?? 0;
    }
    return value;
  };

  const colour = (from: Json, key: string, where: string, fallback: string): string => {
    const value = from[key];
    if (value === undefined || value === null) return fallback;
    if (value === 'none') return 'none';
    if (typeof value !== 'string' || !COLOUR.test(value)) {
      bad(`${where}.${key}`, `${show(value)} must be a hex colour, such as #0969da, or "none"`);
      return fallback;
    }
    return value;
  };

  const oneOf = <T extends string>(
    from: Json,
    key: string,
    where: string,
    allowed: readonly T[],
    fallback: T,
  ): T => {
    const value = from[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      bad(`${where}.${key}`, `${show(value)} is not one of ${allowed.join(', ')}`);
      return fallback;
    }
    return value as T;
  };

  if (!isRecord(spec)) throw new MotionSpecError('spec: must be an object');

  const title = typeof spec.title === 'string' ? spec.title.trim() : '';
  if (!title) bad('spec.title', 'required: one line that says what the animation shows');
  else if (title.length > LIMITS.maxTitle) bad('spec.title', `must be at most ${LIMITS.maxTitle} characters`);

  const width = number(spec, 'width', 'spec', LIMITS.minCanvas, LIMITS.maxCanvas, DEFAULTS.width);
  const height = number(spec, 'height', 'spec', LIMITS.minCanvas, LIMITS.maxCanvas, DEFAULTS.height);
  const background = colour(spec, 'background', 'spec', 'none');
  const loop = spec.loop === undefined || spec.loop === null ? true : spec.loop === true;
  if (spec.loop !== undefined && spec.loop !== null && typeof spec.loop !== 'boolean') {
    bad('spec.loop', `${show(spec.loop)} must be true or false`);
  }

  // ------------------------------------------------------------------ shapes
  const rawShapes = spec.shapes;
  if (!Array.isArray(rawShapes) || rawShapes.length === 0) {
    bad('spec.shapes', 'required: a list with at least one shape');
  } else if (rawShapes.length > LIMITS.maxShapes) {
    bad('spec.shapes', `${rawShapes.length} shapes; the most is ${LIMITS.maxShapes}`);
  }

  const shapes: Shape[] = [];
  const indexOf = new Map<string, number>();
  const c = LIMITS.maxCoordinate;
  for (const [i, raw] of (Array.isArray(rawShapes) ? rawShapes : []).slice(0, LIMITS.maxShapes).entries()) {
    const where = `spec.shapes[${i}]`;
    if (!isRecord(raw)) {
      bad(where, 'must be an object');
      continue;
    }
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!id) bad(`${where}.id`, 'required');
    else if (id.length > LIMITS.maxId || !ID.test(id)) {
      bad(`${where}.id`, `${show(id)} must start with a letter and hold only letters, digits, - and _`);
    } else if (indexOf.has(id)) {
      bad(`${where}.id`, `${show(id)} is already the id of spec.shapes[${indexOf.get(id)}]`);
    }

    const type = oneOf(raw, 'type', where, SHAPE_TYPES, 'rect');
    if (raw.type === undefined) bad(`${where}.type`, `required: one of ${SHAPE_TYPES.join(', ')}`);

    const isOutline = type === 'line' || type === 'path';
    const shape: Shape = {
      id,
      type,
      // A path already holds its own numbers, so its x and y default to 0.
      x: number(raw, 'x', where, -c, c, type === 'path' ? 0 : undefined),
      y: number(raw, 'y', where, -c, c, type === 'path' ? 0 : undefined),
      w: type === 'rect' ? number(raw, 'w', where, 0.1, c) : 0,
      h: type === 'rect' ? number(raw, 'h', where, 0.1, c) : 0,
      radius: type === 'rect' ? number(raw, 'radius', where, 0, c, 0) : 0,
      r: type === 'circle' ? number(raw, 'r', where, 0.1, c) : 0,
      x2: type === 'line' ? number(raw, 'x2', where, -c, c) : 0,
      y2: type === 'line' ? number(raw, 'y2', where, -c, c) : 0,
      text: '',
      size: type === 'text' ? number(raw, 'size', where, 4, 400, DEFAULTS.size) : 0,
      weight: oneOf(raw, 'weight', where, WEIGHTS, 'normal'),
      font: oneOf(raw, 'font', where, FONTS, 'sans'),
      d: '',
      ox: type === 'path' ? number(raw, 'ox', where, -c, c, 0) : 0,
      oy: type === 'path' ? number(raw, 'oy', where, -c, c, 0) : 0,
      fill: colour(raw, 'fill', where, isOutline ? 'none' : type === 'text' ? DEFAULTS.ink : DEFAULTS.fill),
      stroke: colour(raw, 'stroke', where, isOutline ? DEFAULTS.ink : 'none'),
      strokeWidth: number(raw, 'strokeWidth', where, 0, 200, DEFAULTS.strokeWidth),
      opacity: number(raw, 'opacity', where, 0, 1, 1),
      scale: number(raw, 'scale', where, 0, 50, 1),
      rotate: number(raw, 'rotate', where, -3600, 3600, 0),
      draw: number(raw, 'draw', where, 0, 1, 1),
    };

    if (type === 'text') {
      if (typeof raw.text !== 'string' || raw.text.trim() === '') bad(`${where}.text`, 'required for a text');
      else if (raw.text.length > LIMITS.maxText) bad(`${where}.text`, `must be at most ${LIMITS.maxText} characters`);
      else shape.text = raw.text;
    }
    if (type === 'path') {
      if (typeof raw.d !== 'string' || raw.d.trim() === '') bad(`${where}.d`, 'required for a path: SVG path data');
      else if (raw.d.length > LIMITS.maxPath) bad(`${where}.d`, `must be at most ${LIMITS.maxPath} characters`);
      else if (!PATH_DATA.test(raw.d) || !/^\s*[Mm]/.test(raw.d)) {
        bad(`${where}.d`, 'must be SVG path data that starts with M, such as "M 10 10 L 90 10"');
      } else shape.d = raw.d.trim().replace(/\s+/g, ' ');
    }
    if (isOutline && shape.stroke === 'none' && shape.fill === 'none') {
      bad(where, `a ${type} with no stroke and no fill cannot be seen; give it a stroke`);
    }

    if (id && !indexOf.has(id)) indexOf.set(id, shapes.length);
    shapes.push(shape);
  }

  // ------------------------------------------------------------------- steps
  const rawSteps = spec.steps === undefined || spec.steps === null ? [] : spec.steps;
  if (!Array.isArray(rawSteps)) bad('spec.steps', 'must be a list');
  else if (rawSteps.length > LIMITS.maxSteps) {
    bad('spec.steps', `${rawSteps.length} steps; the most is ${LIMITS.maxSteps}`);
  }

  const steps: Step[] = [];
  const ranges: Record<Property, [number, number]> = {
    x: [-c, c],
    y: [-c, c],
    scale: [0, 50],
    rotate: [-3600, 3600],
    opacity: [0, 1],
    draw: [0, 1],
  };
  for (const [i, raw] of (Array.isArray(rawSteps) ? rawSteps : []).slice(0, LIMITS.maxSteps).entries()) {
    const where = `spec.steps[${i}]`;
    if (!isRecord(raw)) {
      bad(where, 'must be an object');
      continue;
    }

    const targets: number[] = [];
    if (!Array.isArray(raw.targets) || raw.targets.length === 0) {
      bad(`${where}.targets`, 'required: a list of shape ids');
    } else {
      for (const [j, target] of raw.targets.slice(0, LIMITS.maxShapes).entries()) {
        const index = typeof target === 'string' ? indexOf.get(target) : undefined;
        if (index === undefined) bad(`${where}.targets[${j}]`, `no shape has the id ${show(target)}`);
        else if (targets.includes(index)) bad(`${where}.targets[${j}]`, `${show(target)} is in the list twice`);
        else targets.push(index);
      }
    }

    const to: Partial<Record<Property, number>> = {};
    if (!isRecord(raw.to)) {
      bad(`${where}.to`, `required: the values to reach, from ${PROPERTIES.join(', ')}`);
    } else {
      for (const key of Object.keys(raw.to)) {
        if (!PROPERTIES.includes(key as Property)) {
          bad(`${where}.to`, `unknown key ${show(key)}; a step can change ${PROPERTIES.join(', ')}`);
        }
      }
      for (const property of PROPERTIES) {
        if (raw.to[property] === undefined || raw.to[property] === null) continue;
        to[property] = number(raw.to, property, `${where}.to`, ranges[property][0], ranges[property][1]);
      }
      if (Object.keys(to).length === 0 && Object.keys(raw.to).length === 0) {
        bad(`${where}.to`, `is empty; give at least one of ${PROPERTIES.join(', ')}`);
      }
    }
    if (to.draw !== undefined) {
      for (const index of targets) {
        const shape = shapes[index];
        if (!shape) continue;
        if (shape.type === 'text') bad(`${where}.to.draw`, `"${shape.id}" is a text, and a text cannot be drawn on`);
        else if (shape.stroke === 'none') {
          bad(`${where}.to.draw`, `"${shape.id}" has no stroke; draw moves along a stroke, so give it one`);
        }
      }
    }

    steps.push({
      targets,
      to,
      duration: number(raw, 'duration', where, 0, LIMITS.maxDuration, DEFAULTS.duration),
      at: raw.at === undefined || raw.at === null ? null : number(raw, 'at', where, 0, LIMITS.maxDuration),
      ease: oneOf(raw, 'ease', where, EASES, DEFAULTS.ease),
      stagger: number(raw, 'stagger', where, 0, 5000, 0),
    });
  }

  // A shape that starts partly drawn needs a stroke too.
  for (const [i, shape] of shapes.entries()) {
    if (shape.draw < 1 && shape.type === 'text') bad(`spec.shapes[${i}].draw`, 'a text cannot be drawn on');
    else if (shape.draw < 1 && shape.stroke === 'none') {
      bad(`spec.shapes[${i}].draw`, 'draw moves along a stroke, so give the shape a stroke');
    }
  }

  // The whole timeline must fit.
  let cursor = 0;
  for (const [i, step] of steps.entries()) {
    const start = step.at ?? cursor;
    const end = start + step.duration + step.stagger * Math.max(0, step.targets.length - 1);
    if (end > LIMITS.maxDuration) {
      bad(`spec.steps[${i}]`, `ends at ${Math.round(end)}ms; an animation can be at most ${LIMITS.maxDuration}ms long`);
    }
    cursor = Math.max(cursor, end);
  }

  if (problems.length > 0) {
    // Enough to act on. A spec that is wrong everywhere is not worth listing whole.
    const listed = problems.slice(0, 30);
    if (problems.length > listed.length) listed.push(`and ${problems.length - listed.length} more problems`);
    throw new MotionSpecError(listed.join('\n'));
  }
  return { title, width, height, background, loop, shapes, steps };
}
