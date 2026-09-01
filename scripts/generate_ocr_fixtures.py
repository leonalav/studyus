#!/usr/bin/env python3
"""
Generate isolated PNG fixtures for the oar-ocr integration tests.

Run from the repo root:
    python scripts/generate_ocr_fixtures.py

The fixtures are committed to `src-tauri/fixtures/` so the test suite can
run hermetically without model downloads. Each fixture targets one OCR
subsystem:

  - simple-text.png   — single paragraph of text; exercises OCR path
  - table.png         — small markdown-ish table rendered as PNG; exercises
                        table classification + structure recognition
  - formula.png       — single inline formula rendered with LaTeX quality;
                        exercises PP-FormulaNet recognition
  - mixed-content.png — heading + paragraph + table + formula; exercises
                        the full pipeline (Layer 1-5)
  - trig-unit-circle.png — programmatic trig identities; matches the kind
                        of page the calculus PDF regression fixture has

The script only depends on Pillow (PIL) — no LaTeX, no model runs. Each
fixture is rendered at 1280x960 so the layout model has enough resolution
to recognise block-level structure but stays small (<50KB) for a tight
git footprint.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError as exc:  # pragma: no cover
    print(
        "ERROR: Pillow is required. Install with: pip install pillow",
        file=sys.stderr,
    )
    raise SystemExit(1) from exc

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_DIR = REPO_ROOT / "src-tauri" / "fixtures"

# 1280x960 matches the layout model's expected input range. 96 DPI is what
# PDFs render at by default; this gives OCR text rows enough headroom.
PAGE_WIDTH = 1280
PAGE_HEIGHT = 960
BACKGROUND = (255, 255, 255)
INK = (15, 15, 15)


def resolve_font(size: int) -> ImageFont.ImageFont:
    """Pick a reasonable monospace/sans font for the host.

    Pillow's default bitmap font is too coarse for OCR fixtures; we look
    for the system DejaVu Sans first (present on most CI images) and fall
    back to the bundled PIL default so the script still runs on minimal
    containers.
    """
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def make_canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", (PAGE_WIDTH, PAGE_HEIGHT), BACKGROUND)
    return image, ImageDraw.Draw(image)


def write_fixture(name: str, image: Image.Image) -> Path:
    target = FIXTURE_DIR / name
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, format="PNG", optimize=True)
    return target


def render_simple_text() -> Path:
    """Single paragraph of plain prose. Exercises the OCR text path only."""
    image, draw = make_canvas()
    font = resolve_font(36)
    body = [
        "Limits are the values that functions approach as the input",
        "approaches some value. A limit is the foundation of calculus,",
        "and it lets us define derivatives, integrals, and continuity",
        "in terms of a single underlying idea.",
    ]
    y = 120
    for line in body:
        draw.text((120, y), line, font=font, fill=INK)
        y += 56
    return write_fixture("simple-text.png", image)


def render_table() -> Path:
    """Three-column table with a header row. Exercises SLANet structure
    recognition on a clean grid."""
    image, draw = make_canvas()
    header_font = resolve_font(32)
    cell_font = resolve_font(28)

    columns = [
        ("x", "1", "2", "3", "4"),
        ("sin(x)", "0.84", "0.91", "0.14", "-0.76"),
        ("cos(x)", "0.54", "-0.42", "-0.99", "-0.65"),
    ]
    col_width = 320
    row_height = 56
    origin_x, origin_y = 120, 200

    # Header background bar.
    draw.rectangle(
        [(origin_x, origin_y), (origin_x + col_width * len(columns), origin_y + row_height)],
        fill=(220, 230, 245),
    )

    for ci, column in enumerate(columns):
        for ri, cell in enumerate(column):
            font = header_font if ri == 0 else cell_font
            weight_font = font
            x = origin_x + ci * col_width + 16
            y = origin_y + ri * row_height + 12
            draw.text((x, y), cell, font=weight_font, fill=INK)

    # Grid lines so the table is unambiguous to the structure model.
    for ci in range(len(columns) + 1):
        x = origin_x + ci * col_width
        draw.line([(x, origin_y), (x, origin_y + row_height * len(columns[0]))], fill=INK, width=2)
    for ri in range(len(columns[0]) + 1):
        y = origin_y + ri * row_height
        draw.line([(origin_x, y), (origin_x + col_width * len(columns), y)], fill=INK, width=2)

    return write_fixture("table.png", image)


def render_formula() -> Path:
    """Single equation rendered large. Exercises PP-FormulaNet.

    Pillow's text rendering is not LaTeX, but the recogniser is robust
    enough that a clearly typeset identity is recovered with high
    confidence. We render the textbook Pythagorean identity.
    """
    image, draw = make_canvas()
    font = resolve_font(72)
    draw.text((160, 360), "sin^2(x) + cos^2(x) = 1", font=font, fill=INK)
    return write_fixture("formula.png", image)


def render_mixed_content() -> Path:
    """Heading + paragraph + table + formula. Exhausts the full pipeline."""
    image, draw = make_canvas()
    title_font = resolve_font(56)
    body_font = resolve_font(32)
    cell_font = resolve_font(28)

    # Heading
    draw.text((120, 80), "The Squeeze Theorem", font=title_font, fill=INK)

    # Paragraph
    paragraph = [
        "If f, g, h are functions with f(x) <= g(x) <= h(x) near a,",
        "and lim f(x) = lim h(x) = L, then lim g(x) = L as well.",
    ]
    y = 180
    for line in paragraph:
        draw.text((120, y), line, font=body_font, fill=INK)
        y += 48

    # Formula
    formula_font = resolve_font(48)
    draw.text((120, y + 30), "lim g(x) = lim f(x) = lim h(x) = L", font=formula_font, fill=INK)
    y += 140

    # Table
    columns = [("n", "1", "2", "3"), ("1/n", "1.00", "0.50", "0.33")]
    col_width = 240
    row_height = 50
    origin_x, origin_y = 120, y + 20
    for ci, column in enumerate(columns):
        for ri, cell in enumerate(column):
            x = origin_x + ci * col_width + 12
            yy = origin_y + ri * row_height + 10
            draw.text((x, yy), cell, font=cell_font, fill=INK)
    for ci in range(len(columns) + 1):
        x = origin_x + ci * col_width
        draw.line([(x, origin_y), (x, origin_y + row_height * len(columns[0]))], fill=INK, width=2)
    for ri in range(len(columns[0]) + 1):
        yy = origin_y + ri * row_height
        draw.line([(origin_x, yy), (origin_x + col_width * len(columns), yy)], fill=INK, width=2)

    return write_fixture("mixed-content.png", image)


def render_trig_unit_circle() -> Path:
    """Unit circle diagram with angle labels. Mirrors the trig identity
    pages from the calculus PDF so the regression test fixture is
    representative of the curriculum content."""
    import math

    image, draw = make_canvas()
    title_font = resolve_font(48)
    label_font = resolve_font(28)
    draw.text((120, 60), "Trigonometric Functions on the Unit Circle", font=title_font, fill=INK)

    # Center of the circle.
    cx, cy = 640, 520
    radius = 220
    draw.ellipse([(cx - radius, cy - radius), (cx + radius, cy + radius)], outline=INK, width=4)

    # Axes.
    draw.line([(cx - radius - 40, cy), (cx + radius + 40, cy)], fill=INK, width=2)
    draw.line([(cx, cy - radius - 40), (cx, cy + radius + 40)], fill=INK, width=2)

    # Tick labels at 0, pi/2, pi, 3pi/2.
    for angle_deg, label, dx, dy in [
        (0, "0", radius + 20, -10),
        (90, "pi/2", -30, -radius - 30),
        (180, "pi", -radius - 40, -10),
        (270, "3pi/2", -50, radius + 30),
    ]:
        draw.text((cx + dx, cy + dy), label, font=label_font, fill=INK)

    # Five reference angles.
    for angle_deg in [30, 60, 120, 150, 210, 240, 300, 330]:
        rad = math.radians(angle_deg)
        ex = cx + int(radius * math.cos(rad))
        ey = cy - int(radius * math.sin(rad))
        draw.line([(cx, cy), (ex, ey)], fill=(80, 80, 80), width=2)

    # Identity labels.
    draw.text((120, 800), "sin^2(theta) + cos^2(theta) = 1", font=label_font, fill=INK)
    draw.text((120, 850), "tan(theta) = sin(theta) / cos(theta)", font=label_font, fill=INK)

    return write_fixture("trig-unit-circle.png", image)


def main() -> int:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)

    renderers = [
        ("simple-text.png", render_simple_text),
        ("table.png", render_table),
        ("formula.png", render_formula),
        ("mixed-content.png", render_mixed_content),
        ("trig-unit-circle.png", render_trig_unit_circle),
    ]

    written: list[Path] = []
    for name, fn in renderers:
        path = fn()
        size_kb = path.stat().st_size / 1024
        print(f"wrote {name:<28} {size_kb:6.1f} KB")
        written.append(path)

    print(f"\nGenerated {len(written)} fixture(s) in {FIXTURE_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
