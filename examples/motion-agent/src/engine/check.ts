/**
 * Looks at the finished motion and reports what a viewer would trip over.
 *
 * A model cannot watch an animation, so this is how it finds out what it
 * made. Each issue names the shape and says what to change.
 */
import type { Motion } from './motion.js';
import type { Scene, Shape } from './spec.js';
import { pivot } from './svg.js';

export interface Issue {
  severity: 'error' | 'warning';
  /** `never-visible`, `ends-off-canvas`, `loop-jump`, `flashing`, `no-motion`, `too-short`, `too-long`, `large-file`. */
  code: string;
  /** The id of the shape, or an empty string for the whole animation. */
  shape: string;
  message: string;
}

/** A warning once the file is this large, in bytes. */
export const LARGE_FILE = 250_000;

/** How far a shape reaches from its middle, at its own size. Null when unknown. */
function reach(shape: Shape): number | null {
  switch (shape.type) {
    case 'rect':
      return Math.hypot(shape.w, shape.h) / 2;
    case 'circle':
      return shape.r;
    case 'line':
      return Math.hypot(...pivot(shape));
    case 'text':
      // A guess: a character is a little over half as wide as it is tall.
      return Math.max(shape.size / 2, shape.text.length * shape.size * 0.3);
    default:
      // A path could be anywhere. It is not checked against the canvas.
      return null;
  }
}

export function checkMotion(scene: Scene, motion: Motion, bytes: number): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Issue['severity'], code: string, shape: string, message: string) =>
    issues.push({ severity, code, shape, message });
  const frames = motion.times.length;
  const last = frames - 1;
  const round = (value: number) => Math.round(value * 100) / 100;

  // ---------------------------------------------------- the whole animation
  if (motion.duration <= 0) {
    add('warning', 'no-motion', '', 'nothing moves: the spec has no steps, or its steps change nothing');
  } else if (motion.duration < 300) {
    add('warning', 'too-short', '', `the animation is ${motion.duration}ms long, too quick to follow; aim for 600ms or more`);
  } else if (motion.duration > 12_000) {
    add('warning', 'too-long', '', `the animation is ${round(motion.duration / 1000)}s long; most people stop watching after about 10s`);
  }
  if (bytes > LARGE_FILE) {
    add('warning', 'large-file', '', `the file is ${Math.round(bytes / 1000)} kB; use fewer shapes, or simpler easings than elastic and bounce`);
  }

  for (const [i, shape] of scene.shapes.entries()) {
    const track = motion.tracks[i]!;
    const [px, py] = pivot(shape);
    const size = reach(shape);

    /** True when some of the shape is on the canvas and it can be seen at this frame. */
    const seen = (frame: number): boolean => {
      if (track.opacity[frame]! <= 0.02 || track.scale[frame]! <= 0.01) return false;
      if (shape.stroke !== 'none' && shape.fill === 'none' && track.draw[frame]! <= 0.01) return false;
      if (size === null) return true;
      const by = size * track.scale[frame]!;
      const cx = track.x[frame]! + px;
      const cy = track.y[frame]! + py;
      return cx + by > 0 && cx - by < scene.width && cy + by > 0 && cy - by < scene.height;
    };

    // ------------------------------------------------------------ visibility
    let visible = false;
    for (let frame = 0; frame < frames && !visible; frame++) visible = seen(frame);
    if (!visible) {
      add(
        'error',
        'never-visible',
        shape.id,
        `"${shape.id}" is never seen: it is off the ${scene.width}x${scene.height} canvas, fully transparent, at size 0, or never drawn`,
      );
      continue;
    }
    if (!scene.loop && motion.duration > 0 && !seen(last)) {
      add('warning', 'ends-off-canvas', shape.id, `"${shape.id}" cannot be seen in the last frame, which is the one that stays`);
    }

    // ------------------------------------------------------------- the loop
    // A loop goes straight from the last frame to the first. A value that
    // ends away from where it began makes the shape jump.
    if (scene.loop && motion.duration > 0) {
      const jumps: string[] = [];
      const gap = (name: 'x' | 'y' | 'scale' | 'rotate' | 'opacity' | 'draw', least: number) => {
        const from = track[name][0]!;
        const to = track[name][last]!;
        // A whole turn looks the same as no turn.
        const by = name === 'rotate' ? Math.abs(((to - from + 180) % 360 + 360) % 360 - 180) : Math.abs(to - from);
        if (by > least) jumps.push(`${name} ends at ${round(to)} and starts at ${round(from)}`);
      };
      gap('x', 1);
      gap('y', 1);
      gap('scale', 0.02);
      gap('rotate', 1);
      gap('opacity', 0.05);
      gap('draw', 0.02);
      if (jumps.length > 0) {
        add(
          'warning',
          'loop-jump',
          shape.id,
          `"${shape.id}" jumps when the loop starts again: ${jumps.join(', ')}. Add a step that takes it back, or set loop to false`,
        );
      }
    }

    // ------------------------------------------------------------- flashing
    // Three flashes in a second can set off a seizure. A flash is a large
    // shape going from clear to solid and back.
    if (motion.duration > 0) {
      const large = size === null || (size * 2) ** 2 > scene.width * scene.height * 0.1;
      const swings: number[] = [];
      let low = track.opacity[0]!;
      let high = low;
      let rising: boolean | null = null;
      for (let frame = 1; frame < frames; frame++) {
        const value = track.opacity[frame]!;
        low = Math.min(low, value);
        high = Math.max(high, value);
        if (rising !== false && high - value >= 0.5) {
          swings.push(motion.times[frame]! * motion.duration);
          rising = false;
          low = value;
          high = value;
        } else if (rising !== true && value - low >= 0.5) {
          swings.push(motion.times[frame]! * motion.duration);
          rising = true;
          low = value;
          high = value;
        }
      }
      // Six swings are three flashes.
      for (let k = 0; k + 5 < swings.length; k++) {
        if (swings[k + 5]! - swings[k]! <= 1000) {
          add(
            large ? 'error' : 'warning',
            'flashing',
            shape.id,
            `"${shape.id}" flashes three times within a second, which can harm people with photosensitive epilepsy; slow it down or fade it less`,
          );
          break;
        }
      }
    }
  }
  return issues;
}
