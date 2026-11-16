/**
 * Works out how every shape moves.
 *
 * Anime.js does the timing. It is a browser library, but it can move plain
 * objects as well as page elements, and it needs no browser for that. So each
 * shape gets a small object that holds its values, the steps go onto an
 * Anime.js timeline, and this module asks the timeline where everything is at
 * each moment. The stagger and the easings, elastic and bounce included, are
 * Anime.js's own.
 *
 * The result is a track for each value of each shape: a list of numbers, one
 * for each frame. `simplify` then keeps only the frames that matter, so that
 * the SVG holds a few keyframes and not thirty a second.
 */
import { createTimeline, stagger } from 'animejs';
import { PROPERTIES, type Property, type Scene } from './spec.js';

/** How many times a second the timeline is asked where things are. */
export const FRAMES_PER_SECOND = 30;

export interface Motion {
  /** The length of the animation, in milliseconds. 0 when nothing moves. */
  duration: number;
  /** The moment of each frame, from 0 to 1. */
  times: number[];
  /** For each shape, each value at each frame. */
  tracks: Record<Property, number[]>[];
}

export function computeMotion(scene: Scene): Motion {
  // One plain object for each shape. Anime.js changes these.
  const states = scene.shapes.map((shape) => ({
    x: shape.x,
    y: shape.y,
    scale: shape.scale,
    rotate: shape.rotate,
    opacity: shape.opacity,
    draw: shape.draw,
  }));

  const timeline = createTimeline({ autoplay: false });
  let cursor = 0;
  for (const step of scene.steps) {
    const targets = step.targets.map((index) => states[index]).filter((state) => state !== undefined);
    if (targets.length === 0 || Object.keys(step.to).length === 0) continue;
    const start = step.at ?? cursor;
    timeline.add(
      targets,
      {
        ...step.to,
        duration: step.duration,
        ease: step.ease,
        delay: step.stagger > 0 ? stagger(step.stagger) : 0,
      },
      start,
    );
    cursor = Math.max(cursor, start + step.duration + step.stagger * (targets.length - 1));
  }

  const duration = Math.round(Number(timeline.duration) || 0);
  const empty = (): Record<Property, number[]> => ({ x: [], y: [], scale: [], rotate: [], opacity: [], draw: [] });
  const tracks = states.map(empty);

  if (duration <= 0) {
    // Nothing moves: one frame, the picture as it is.
    for (const [i, state] of states.entries()) for (const p of PROPERTIES) tracks[i]![p].push(state[p]);
    return { duration: 0, times: [0], tracks };
  }

  const frames = Math.max(2, Math.ceil((duration / 1000) * FRAMES_PER_SECOND) + 1);
  const times: number[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const time = frame / (frames - 1);
    times.push(time);
    timeline.seek(time * duration);
    for (const [i, state] of states.entries()) {
      for (const p of PROPERTIES) {
        const value = Number(state[p]);
        tracks[i]![p].push(Number.isFinite(value) ? value : 0);
      }
    }
  }
  return { duration, times, tracks };
}

/**
 * The frames worth keeping: the ones that a straight line between their
 * neighbours would miss by more than `tolerance`. It takes several tracks at
 * once, so that the x and the y of a shape keep the same frames.
 *
 * This is the Ramer-Douglas-Peucker method, on a stack and not by recursion.
 */
export function simplify(times: number[], tracks: number[][], tolerance: number): number[] {
  const last = times.length - 1;
  if (last <= 0) return [0];
  const keep = new Set<number>([0, last]);
  const stack: [number, number][] = [[0, last]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    if (to - from < 2) continue;
    let worst = -1;
    let worstBy = tolerance;
    const span = times[to]! - times[from]!;
    for (let i = from + 1; i < to; i++) {
      const along = span === 0 ? 0 : (times[i]! - times[from]!) / span;
      for (const track of tracks) {
        const onLine = track[from]! + (track[to]! - track[from]!) * along;
        const by = Math.abs(track[i]! - onLine);
        if (by > worstBy) {
          worstBy = by;
          worst = i;
        }
      }
    }
    if (worst !== -1) {
      keep.add(worst);
      stack.push([from, worst], [worst, to]);
    }
  }
  return [...keep].sort((a, b) => a - b);
}

/** True when a track never leaves its first value. */
export function isStill(track: number[], tolerance: number): boolean {
  const first = track[0] ?? 0;
  return track.every((value) => Math.abs(value - first) <= tolerance);
}
