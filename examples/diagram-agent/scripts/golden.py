"""Writes test/fixtures/expected from test/fixtures/specs with the Python drawgen package.

The Rust code in rust/ is a port of drawgen. The tests compare what the port
makes with the files this script writes, byte for byte, so the files are the
record of what the original does.

Run it with a Python that has drawgen installed, from this package's directory:

    /path/to/python-with-drawgen scripts/golden.py

Run it again after drawgen changes, and port the change until the tests pass.
"""
from __future__ import annotations

import json
import pathlib

from drawgen.check import check_xml
from drawgen.diagram import DiagramError
from drawgen.export import page_count
from drawgen.spec import SpecError, build
from drawgen.svg_render import render_svg

FIXTURES = pathlib.Path(__file__).resolve().parent.parent / "test" / "fixtures"


def write(name: str, text: str) -> None:
    # newline="" keeps line endings exactly as drawgen wrote them.
    with open(FIXTURES / "expected" / name, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def main() -> None:
    expected = FIXTURES / "expected"
    expected.mkdir(exist_ok=True)
    for old in expected.iterdir():
        old.unlink()
    for path in sorted((FIXTURES / "specs").glob("*.json")):
        name = path.stem
        spec = json.loads(path.read_text(encoding="utf-8"))
        try:
            xml = build(spec).xml()
        except (SpecError, DiagramError) as e:
            write(f"{name}.error.txt", str(e))
            print(f"{name}: error")
            continue
        write(f"{name}.drawio", xml)
        write(f"{name}.check.json", json.dumps(check_xml(xml, path=name).to_dict(), indent=2) + "\n")
        pages = page_count(xml)
        for page in range(pages):
            write(f"{name}.p{page + 1}.svg", render_svg(xml, page=page, embed=xml))
        print(f"{name}: {pages} page(s)")


if __name__ == "__main__":
    main()
