/**
 * The engine: a spec in, an animated SVG and a check report out.
 *
 *   spec ─▶ parseSpec ─▶ computeMotion ─▶ writeSvg ─▶ checkMotion
 *
 * Every step is a calculation. Nothing here reads a file, opens a connection,
 * or looks at a clock, so the same spec always gives the same file.
 */
import { checkMotion, type Issue } from './check.js';
import { computeMotion } from './motion.js';
import { MotionSpecError, parseSpec } from './spec.js';
import { writeSvg } from './svg.js';

export { MotionSpecError } from './spec.js';
export type { Issue } from './check.js';

/** The largest file the engine returns, in bytes. */
export const MAX_SVG_BYTES = 1_500_000;

export interface CheckReport {
  width: number;
  height: number;
  /** The length of the animation, in milliseconds. */
  duration_ms: number;
  loop: boolean;
  shapes: number;
  /** How many keyframes the file holds. */
  keyframes: number;
  /** The size of the file, in bytes. */
  bytes: number;
  errors: number;
  warnings: number;
  issues: Issue[];
}

export interface CreatedAnimation {
  /** The animated picture: one SVG file, with no script in it. */
  svg: string;
  check: CheckReport;
}

/**
 * Builds an animation from a spec and checks it. Throws `MotionSpecError`
 * when the spec cannot be drawn.
 */
export function createAnimation(spec: unknown): CreatedAnimation {
  const scene = parseSpec(spec);
  const motion = computeMotion(scene);
  const { svg, keyframes } = writeSvg(scene, motion);
  const bytes = new TextEncoder().encode(svg).length;
  if (bytes > MAX_SVG_BYTES) {
    throw new MotionSpecError(
      `spec: the animation would be a ${Math.round(bytes / 1000)} kB file, and the most is ${MAX_SVG_BYTES / 1000} kB; ` +
        'use fewer shapes, fewer steps, or simpler easings than elastic and bounce',
    );
  }
  const issues = checkMotion(scene, motion, bytes);
  return {
    svg,
    check: {
      width: scene.width,
      height: scene.height,
      duration_ms: motion.duration,
      loop: scene.loop,
      shapes: scene.shapes.length,
      keyframes,
      bytes,
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
      issues,
    },
  };
}
