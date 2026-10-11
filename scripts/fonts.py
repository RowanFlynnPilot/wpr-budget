"""
fonts.py - the site's two trimmed type assets, built from the Fontsource
packages in node_modules (dev dependencies); the outputs are committed.

    python scripts/fonts.py      # needs: pip install fonttools brotli uharfbuzz

1. Fraunces, the serif: Fontsource's Latin optical-size variable file (67 kB),
   subset to the characters the site can show — Basic Latin, Latin-1 (Spanish's
   accents), and every other character in the source, the strings and the data —
   keeping the numeral features the figures use (tabular, lining), the whole
   optical-size axis, and the weight axis over the range the site sets serif
   type in (400-700; @font-face in styles.css says the same) — 67 kB -> ~58 kB.
   -> src/assets/fonts/fraunces-opsz.woff2
2. The WPR wordmark, "WAUSAU PILOT & REVIEW" in Playfair Display 900: shaped
   with HarfBuzz (kerning) at the chrome's 0.03em letter-spacing and drawn as one
   SVG path (at a fifth of font units: a tenth of a pixel at its 13 px) ->
   src/wordmark.json { viewBox, d, height_em }. A 22 kB font loaded for three
   words is gone; the logo is the same letters, as artwork.
Both fonts are under the SIL Open Font License (Fraunces names no reserved font
name, so its subset keeps its family name).
"""
import io
import json
import pathlib
import re

import uharfbuzz as hb
from fontTools import subset
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parent.parent
FRAUNCES = ROOT / "node_modules/@fontsource-variable/fraunces/files/fraunces-latin-opsz-normal.woff2"
PLAYFAIR = ROOT / "node_modules/@fontsource/playfair-display/files/playfair-display-latin-900-normal.woff2"
FRAUNCES_OUT = ROOT / "src/assets/fonts/fraunces-opsz.woff2"
WORDMARK_OUT = ROOT / "src/wordmark.json"
WORDMARK = "WAUSAU PILOT & REVIEW"
LETTER_SPACING_EM = 0.03  # .chrome-bar__wordmark in src/styles.css
WEIGHTS = (400, 700)  # the serif weights styles.css uses
SCALE = 0.2  # wordmark path units per font unit
FEATURES = ["kern", "liga", "clig", "calt", "ccmp", "locl", "mark", "mkmk", "rvrn",
            "tnum", "lnum", "pnum", "onum", "case", "frac", "numr", "dnom", "sups"]


def site_characters():
    """Every character the site can show: Basic Latin, Latin-1, and whatever
    else appears in the source (strings in three languages) and the data."""
    chars = set(range(0x20, 0x7F)) | set(range(0xA0, 0x100))
    files = [*ROOT.glob("src/**/*.js"), *ROOT.glob("src/**/*.jsx"), *ROOT.glob("src/**/*.json"), *ROOT.glob("public/*.json")]
    for f in files:
        chars |= {ord(c) for c in f.read_text(encoding="utf-8") if ord(c) > 0x7E}
    return sorted(c for c in chars if not 0xD800 <= c <= 0xDFFF)


def build_fraunces():
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = FEATURES
    opts.hinting = False
    opts.name_IDs = ["*"]
    font = subset.load_font(str(FRAUNCES), opts)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=site_characters())
    sub.subset(font)
    font = instancer.instantiateVariableFont(font, {"wght": WEIGHTS})
    axes = {a.axisTag: (a.minValue, a.maxValue) for a in font["fvar"].axes}
    if axes.get("wght") != WEIGHTS or "opsz" not in axes:
        raise SystemExit(f"unexpected axes after trimming: {axes}")
    FRAUNCES_OUT.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(FRAUNCES_OUT), opts)
    return FRAUNCES.stat().st_size, FRAUNCES_OUT.stat().st_size


def build_wordmark():
    font = TTFont(str(PLAYFAIR))
    font.flavor = None
    raw = io.BytesIO()
    font.save(raw)
    face = hb.Face(raw.getvalue())
    buf = hb.Buffer()
    buf.add_str(WORDMARK)
    buf.guess_segment_properties()
    hb.shape(hb.Font(face), buf, {"kern": True})
    glyphs, order, upem = font.getGlyphSet(), font.getGlyphOrder(), face.upem
    path, bounds = SVGPathPen(glyphs, ntos=lambda v: f"{round(v)}"), BoundsPen(glyphs)
    x = 0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        g = glyphs[order[info.codepoint]]
        flip = (SCALE, 0, 0, -SCALE, SCALE * (x + pos.x_offset), -SCALE * pos.y_offset)  # font y-up -> SVG y-down
        g.draw(TransformPen(path, flip))
        g.draw(TransformPen(bounds, flip))
        x += pos.x_advance + LETTER_SPACING_EM * upem
    x0, y0, x1, y1 = (round(v) for v in bounds.bounds)
    data = {"text": WORDMARK, "viewBox": f"{x0} {y0} {x1 - x0} {y1 - y0}", "d": path.getCommands(),
            "height_em": round((y1 - y0) / SCALE / upem, 4)}
    WORDMARK_OUT.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return len(data["d"])


if __name__ == "__main__":
    before, after = build_fraunces()
    n = build_wordmark()
    print(f"wrote {FRAUNCES_OUT.relative_to(ROOT)}: {before:,} -> {after:,} bytes; "
          f"{WORDMARK_OUT.relative_to(ROOT)}: {n:,} characters of path")
