#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.transform import Transform
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path
from PIL import Image, ImageSequence


ROOT = Path(__file__).resolve().parents[1]
RESOURCES = ROOT / "resources"

SLOT = 96
SOURCE_SLOT = 16
TREE_MIDLINE = 9.6 / SOURCE_SLOT * SLOT
TAB_MIDLINE = SLOT / 2
DEFAULT_INK_SCALE = 0.80
TERMINAL_INK_SCALE = 0.70

# Codicons terminal glyph path. Source: microsoft/vscode-codicons, MIT.
TERMINAL_PATH = (
    "M13.5 1H2.5C1.1 1 0 2.1 0 3.5v9C0 13.9 1.1 15 2.5 15h11c1.4 0 "
    "2.5-1.1 2.5-2.5v-9C16 2.1 14.9 1 13.5 1zM15 12.5c0 .8-.7 "
    "1.5-1.5 1.5h-11C1.7 14 1 13.3 1 12.5v-9C1 2.7 1.7 2 2.5 "
    "2h11c.8 0 1.5.7 1.5 1.5v9zM4.1 11.7l3-3c.4-.4.4-1 0-1.4l-3-3-"
    ".7.7L6.3 8 3.4 11l.7.7zM8 11h5v1H8v-1z"
)


@dataclass(frozen=True)
class RasterAsset:
    source: str
    tree: str
    tab: str
    ink_scale: float = DEFAULT_INK_SCALE
    knockout_white: bool = False


RASTERS = [
    RasterAsset(
        "claude-less-wide.png",
        "claude-code-padded.png",
        "claude-code-padded-center.png",
        knockout_white=True,
    ),
    RasterAsset(
        "claude-working.gif",
        "claude-working-padded.gif",
        "claude-working-padded-center.gif",
        ink_scale=0.74,
    ),
    RasterAsset("codex-code.png", "codex-code-padded.png", "codex-code-padded-center.png"),
    RasterAsset("codex-working.gif", "codex-working-padded.gif", "codex-working-padded-center.gif"),
]


def main() -> None:
    for asset in RASTERS:
        generate_raster(asset, asset.tree, TREE_MIDLINE)
        generate_raster(asset, asset.tab, TAB_MIDLINE)
    generate_terminal_font()


def generate_raster(asset: RasterAsset, output_name: str, midline: float) -> None:
    source = Image.open(RESOURCES / asset.source)
    frames = [prepare_frame(frame, asset.knockout_white) for frame in ImageSequence.Iterator(source)]
    bbox = union_bbox(frames)
    if bbox is None:
        raise ValueError(f"{asset.source} has no visible pixels")

    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    scale = (SLOT * asset.ink_scale) / max(width, height)
    target_width = round(width * scale)
    target_height = round(height * scale)
    left = round(midline - target_width / 2)
    top = round(TAB_MIDLINE - target_height / 2)

    rendered = []
    for frame in frames:
        crop = frame.crop(bbox)
        resized = crop.resize((target_width, target_height), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (SLOT, SLOT), (255, 255, 255, 0))
        canvas.alpha_composite(resized, (left, top))
        rendered.append(canvas)

    output = RESOURCES / output_name
    if output.suffix == ".gif":
        rendered[0].save(
            output,
            save_all=True,
            append_images=rendered[1:],
            duration=source.info.get("duration", 100),
            loop=source.info.get("loop", 0),
            disposal=2,
            optimize=False,
        )
        return

    rendered[0].save(output)


def prepare_frame(frame: Image.Image, knockout_white: bool) -> Image.Image:
    rgba = frame.convert("RGBA")
    if not knockout_white:
        return rgba

    pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = pixels[x, y]
            if a and r > 240 and g > 240 and b > 240:
                pixels[x, y] = (r, g, b, 0)
    return rgba


def union_bbox(frames: list[Image.Image]) -> tuple[int, int, int, int] | None:
    union: tuple[int, int, int, int] | None = None
    for frame in frames:
        bbox = frame.getchannel("A").getbbox()
        if bbox is None:
            continue
        union = bbox if union is None else (
            min(union[0], bbox[0]),
            min(union[1], bbox[1]),
            max(union[2], bbox[2]),
            max(union[3], bbox[3]),
        )
    return union


def generate_terminal_font() -> None:
    units_per_em = 1000
    source_bbox = (0.0, 1.0, 16.0, 15.0)
    source_width = source_bbox[2] - source_bbox[0]
    source_height = source_bbox[3] - source_bbox[1]
    target_size = units_per_em * TERMINAL_INK_SCALE
    scale = target_size / max(source_width, source_height)
    width = source_width * scale
    height = source_height * scale
    left = units_per_em * (TREE_MIDLINE / SLOT) - width / 2
    top = units_per_em * 0.5 - height / 2

    glyph_pen = TTGlyphPen(None)
    quad_pen = Cu2QuPen(glyph_pen, max_err=1.0)
    transform = Transform(scale, 0, 0, -scale, left, units_per_em - top)
    parse_path(TERMINAL_PATH, TransformPen(quad_pen, transform))
    glyph = glyph_pen.glyph()
    glyph.recalcBounds({"deck-terminal": glyph})

    fb = FontBuilder(units_per_em, isTTF=True)
    glyph_order = [".notdef", "deck-terminal"]
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap({0xE001: "deck-terminal"})
    fb.setupGlyf({".notdef": TTGlyphPen(None).glyph(), "deck-terminal": glyph})
    # VS Code renders the glyph flush-left unless the hmtx LSB matches xMin.
    fb.setupHorizontalMetrics({
        ".notdef": (units_per_em, 0),
        "deck-terminal": (units_per_em, glyph.xMin),
    })
    fb.setupHorizontalHeader(ascent=units_per_em, descent=0)
    fb.setupOS2(
        sTypoAscender=units_per_em,
        sTypoDescender=0,
        usWinAscent=units_per_em,
        usWinDescent=0,
    )
    fb.setupNameTable({
        "familyName": "Deck Icons",
        "styleName": "Regular",
        "uniqueFontIdentifier": "Deck Icons Regular",
        "fullName": "Deck Icons Regular",
        "psName": "DeckIcons-Regular",
    })
    fb.setupPost()
    fb.setupMaxp()

    font = fb.font
    font["head"].created = 0
    font["head"].modified = 0
    font.flavor = "woff"
    font.save(RESOURCES / "deck-icons.woff", reorderTables=True)


if __name__ == "__main__":
    main()
