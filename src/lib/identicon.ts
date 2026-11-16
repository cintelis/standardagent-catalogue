/**
 * Works out a small picture for a package from its name, so that every
 * package has one and the same name always gets the same picture.
 *
 * The picture is made here, at build time, from the name alone. The catalogue
 * does not show a publisher's own image: that would mean loading a file the
 * publisher controls, and the Content-Security-Policy allows only this site's
 * own files.
 */
import { createHash } from 'node:crypto';

export interface Identicon {
  /** The filled squares of a 5 by 5 grid, as [column, row]. */
  cells: [number, number][];
  /** The colour of the squares, as a hue from 0 to 359. */
  hue: number;
}

export function identicon(name: string): Identicon {
  const hash = createHash('sha256').update(name).digest();
  const cells: [number, number][] = [];
  // Fifteen bits fill the left three columns. The right two mirror the left
  // two, which makes the picture symmetrical and easier to tell apart.
  for (let column = 0; column < 3; column++) {
    for (let row = 0; row < 5; row++) {
      const bit = column * 5 + row;
      const filled = ((hash[bit >> 3] ?? 0) >> (bit & 7)) & 1;
      if (!filled) continue;
      cells.push([column, row]);
      if (column < 2) cells.push([4 - column, row]);
    }
  }
  // A name whose bits are all zero would give an empty picture.
  if (cells.length === 0) cells.push([2, 2]);
  const hue = (((hash[2] ?? 0) << 8) | (hash[3] ?? 0)) % 360;
  return { cells, hue };
}
