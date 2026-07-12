#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
render-a4-to-png.py

Phase 8.5 — Render a ResolvedA4LayoutModel to a high-resolution PNG.

Usage:
  python scripts/render-a4-to-png.py <layout.json> <output.png> [--scale 2]

The renderer draws each element from the ResolvedA4LayoutModel at the
specified scale factor (default 2×, producing a 1588×2246 px image).

Element types rendered:
  title, heading, subheading, paragraph, instructions, question, option,
  answerGap, answerLine, image, footer, pageNumber, separator, box

Does NOT read or modify production data.
"""

import sys, io, json, os, math, textwrap
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from PIL import Image, ImageDraw, ImageFont

# ── A4 CONSTANTS (from a4-layout-resolver.js) ─────────────────────────────────
A4_W = 794
A4_H = 1123
MARGIN_L = 64
MARGIN_T = 56

# ── COLOUR PALETTE ─────────────────────────────────────────────────────────────
BG_COLOR      = (255, 255, 255)
TEXT_COLOR    = (20,  20,  20)
HEADING_COLOR = (0,   30,  80)
FOOTER_COLOR  = (100, 100, 100)
LINE_COLOR    = (30,  30,  30)
IMG_BG_COLOR  = (230, 235, 242)
IMG_BD_COLOR  = (150, 160, 180)
BOX_COLOR     = (0,   0,   0)
SEP_COLOR     = (200, 200, 200)
WATERMARK_CLR = (200, 210, 220)

# ── FONT LOADING ───────────────────────────────────────────────────────────────

def _find_font(bold=False, italic=False):
    """Return a PIL font path or None (falls back to default)."""
    candidates_bold = [
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/calibrib.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/arial.ttf",
    ]
    candidates_regular = [
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/calibri.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/arial.ttf",
    ]
    candidates = candidates_bold if bold else candidates_regular
    for p in candidates:
        if os.path.exists(p):
            return p
    return None

_font_cache = {}

def get_font(size, bold=False):
    key = (size, bold)
    if key in _font_cache:
        return _font_cache[key]
    path = _find_font(bold=bold)
    try:
        f = ImageFont.truetype(path, size) if path else ImageFont.load_default()
    except Exception:
        f = ImageFont.load_default()
    _font_cache[key] = f
    return f

# ── MAIN RENDERER ──────────────────────────────────────────────────────────────

def render_layout(layout_json_path: str, output_png_path: str, scale: float = 2.0):
    with open(layout_json_path, 'r', encoding='utf-8') as f:
        layout = json.load(f)

    W = round(A4_W * scale)
    H = round(A4_H * scale)
    S = scale  # scale factor

    img  = Image.new("RGB", (W, H), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Page border
    draw.rectangle([(0, 0), (W - 1, H - 1)], outline=(220, 220, 220), width=1)

    # Page margin guides (light, diagnostic only)
    ml = round(MARGIN_L * S)
    mt = round(MARGIN_T * S)
    draw.rectangle([(ml, mt), (W - ml, H - mt)], outline=(240, 240, 245), width=1)

    elements = layout.get("elements", [])

    for el in elements:
        _render_element(draw, el, S)

    # Watermark: schema version in corner
    sv = layout.get("schemaVersion", "")
    if sv:
        wf = get_font(round(7 * S))
        draw.text((round(4 * S), round(4 * S)), sv, font=wf, fill=WATERMARK_CLR)

    img.save(output_png_path, "PNG", dpi=(round(96 * scale), round(96 * scale)))
    print(f"Rendered: {output_png_path} ({W}x{H} px @ {scale:.1f}x scale)")
    return output_png_path


def _render_element(draw, el, S):
    x = round(el.get("x", 0) * S)
    y = round(el.get("y", 0) * S)
    w = round(el.get("width",  0) * S)
    h = round(el.get("height", 0) * S)
    t = el.get("type", "paragraph")

    if w <= 0 or h <= 0:
        return

    # ── IMAGE / ILLUSTRATION / TABLE ─────────────────────────
    if t in ("image", "illustration", "table"):
        # Filled placeholder box
        draw.rectangle([(x, y), (x + w, y + h)], fill=IMG_BG_COLOR, outline=IMG_BD_COLOR, width=round(S))
        # Diagonal lines for image placeholder
        draw.line([(x, y), (x + w, y + h)], fill=IMG_BD_COLOR, width=round(S * 0.5))
        draw.line([(x + w, y), (x, y + h)], fill=IMG_BD_COLOR, width=round(S * 0.5))
        # Label
        lbl = el.get("altText") or el.get("src") or "[image]"
        lbl = os.path.basename(lbl)[:30] if lbl else "[image]"
        lf  = get_font(round(8 * S))
        draw.text((x + round(4 * S), y + round(4 * S)), lbl, font=lf, fill=IMG_BD_COLOR)
        return

    # ── SEPARATOR ────────────────────────────────────────────
    if t == "separator":
        mid_y = y + h // 2
        draw.line([(x, mid_y), (x + w, mid_y)], fill=SEP_COLOR, width=max(1, round(S)))
        return

    # ── ANSWER LINE ──────────────────────────────────────────
    if t == "answerLine":
        mid_y = y + h // 2
        draw.line([(x, mid_y), (x + w, mid_y)], fill=LINE_COLOR, width=max(1, round(S * 0.7)))
        return

    # ── BOX ──────────────────────────────────────────────────
    if t == "box":
        draw.rectangle([(x, y), (x + w, y + h)], outline=BOX_COLOR, width=max(1, round(S)))
        return

    # ── TEXT ELEMENTS ────────────────────────────────────────
    text = el.get("text", "")
    if not text:
        return

    style    = el.get("style", {})
    font_sz  = style.get("fontSize", 11) if style else 11
    bold     = (style.get("fontWeight", "normal") == "bold") if style else False
    align    = style.get("textAlign", "left") if style else "left"
    lh       = style.get("lineHeight", 1.5) if style else 1.5

    px_font_sz = round(font_sz * S)
    font       = get_font(px_font_sz, bold=bold)

    # Choose colour
    if t in ("title", "heading", "subheading"):
        color = HEADING_COLOR
    elif t in ("footer", "pageNumber"):
        color = FOOTER_COLOR
    else:
        color = TEXT_COLOR

    # Word-wrap text to fit width
    wrapped_lines = _wrap_text(text, font, w - round(4 * S))

    line_h = round(font_sz * S * lh)
    cur_y  = y
    for line in wrapped_lines:
        if cur_y + line_h > y + h + line_h:
            break  # clip overflow
        if align == "center":
            try:
                lw = font.getlength(line)
            except AttributeError:
                lw = font.getsize(line)[0]
            lx = x + (w - lw) // 2
        elif align == "right":
            try:
                lw = font.getlength(line)
            except AttributeError:
                lw = font.getsize(line)[0]
            lx = x + w - lw - round(2 * S)
        else:
            lx = x + round(2 * S)
        draw.text((lx, cur_y), line, font=font, fill=color)
        cur_y += line_h


def _wrap_text(text, font, max_width):
    """Wrap text to fit within max_width pixels."""
    words  = text.split()
    lines  = []
    cur    = ""
    for word in words:
        test = (cur + " " + word).strip()
        try:
            tw = font.getlength(test)
        except AttributeError:
            tw = font.getsize(test)[0]
        if tw <= max_width:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines if lines else [""]


# ── SIDE-BY-SIDE COMPOSITE ────────────────────────────────────────────────────

def create_sidebyside(source_path: str, reconstructed_path: str, output_path: str,
                       label_left="SOURCE", label_right="RECONSTRUCTED A4"):
    """
    Compose SOURCE | RECONSTRUCTED A4 side-by-side at A4 height.
    If source image doesn't exist, creates a placeholder.
    """
    # Load reconstructed A4
    rec   = Image.open(reconstructed_path).convert("RGB")
    rec_h = rec.height
    rec_w = rec.width

    # Load or create source image
    if source_path and os.path.exists(source_path):
        src = Image.open(source_path).convert("RGB")
        # Scale source to same height
        src_w = round(src.width * rec_h / src.height)
        src   = src.resize((src_w, rec_h), Image.LANCZOS)
    else:
        src_w = rec_w
        src   = Image.new("RGB", (src_w, rec_h), (230, 230, 230))
        d     = ImageDraw.Draw(src)
        d.text((src_w // 2 - 60, rec_h // 2), "[source not on disk]",
               font=get_font(20), fill=(100, 100, 100))

    # Header band
    HDR = 40
    GAP = 12
    total_w = src_w + GAP + rec_w
    composite = Image.new("RGB", (total_w, rec_h + HDR), (245, 245, 250))
    draw = ImageDraw.Draw(composite)

    # Labels
    hf = get_font(16, bold=True)
    lbl_left_x  = src_w // 2 - 40
    lbl_right_x = src_w + GAP + rec_w // 2 - 60
    draw.text((lbl_left_x,  8), label_left,  font=hf, fill=(60, 60, 60))
    draw.text((lbl_right_x, 8), label_right, font=hf, fill=(30, 60, 30))

    composite.paste(src, (0,        HDR))
    composite.paste(rec, (src_w + GAP, HDR))

    # Divider
    draw.line([(src_w + GAP // 2, HDR), (src_w + GAP // 2, rec_h + HDR)],
              fill=(180, 180, 180), width=2)

    composite.save(output_path, "PNG")
    print(f"Side-by-side: {output_path} ({total_w}x{rec_h + HDR})")
    return output_path


# ── CLI ────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Render ResolvedA4LayoutModel to PNG")
    parser.add_argument("layout",    help="Path to ResolvedA4LayoutModel JSON")
    parser.add_argument("output",    help="Output PNG path")
    parser.add_argument("--scale",   type=float, default=2.0, help="Scale factor (default 2.0)")
    parser.add_argument("--source",  help="Optional source page image for side-by-side")
    parser.add_argument("--sidebyside", help="Output path for side-by-side composite")
    args = parser.parse_args()

    render_layout(args.layout, args.output, scale=args.scale)

    if args.source and args.sidebyside:
        create_sidebyside(args.source, args.output, args.sidebyside)
