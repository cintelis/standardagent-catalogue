"""Draws public/favicon.ico: the logo in public/favicon.svg, as a bitmap.

Browsers that do not read an SVG icon ask for /favicon.ico. Run this again
after a change to the logo. It needs Pillow:

    python scripts/make-favicon.py

The shapes and colours here are the ones in public/favicon.svg, which is drawn
on a 32 by 32 grid.
"""

from pathlib import Path

from PIL import Image, ImageDraw

TILE = '#0d1117'
PACKAGE = '#f0f6fc'
AGENT = '#3fb950'

# Draw large and scale down, so that the edges come out smooth.
SCALE = 16
SIZE = 32 * SCALE


def box(x: float, y: float, w: float, h: float) -> tuple[float, float, float, float]:
    return (x * SCALE, y * SCALE, (x + w) * SCALE - 1, (y + h) * SCALE - 1)


image = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle(box(0, 0, 32, 32), radius=7 * SCALE, fill=TILE)
for x, y in [(5.5, 5.5), (17.5, 5.5), (5.5, 17.5)]:
    draw.rounded_rectangle(box(x, y, 9, 9), radius=2.2 * SCALE, fill=PACKAGE)
draw.ellipse(box(17.5, 17.5, 9, 9), fill=AGENT)

out = Path(__file__).resolve().parent.parent / 'public' / 'favicon.ico'
sizes = [(16, 16), (32, 32), (48, 48)]
image.resize((48, 48), Image.LANCZOS).save(out, sizes=sizes)
print(f'Wrote {out} ({out.stat().st_size} bytes) at {", ".join(str(w) for w, _ in sizes)} pixels')
