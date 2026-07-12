#!/usr/bin/env python3
"""
scripts/extract-pdf-page.py

Render a specific page from a PDF to PNG and extract text blocks with bboxes.
Used by the Phase 8.5 end-to-end PDF reconstruction pipeline.

Usage:
  py -3.10 scripts/extract-pdf-page.py <pdf_path> <page_num_0based> <output_dir> [dpi]

Outputs (all paths in output_dir):
  page-<N>-render.png       — rendered page image (default 150 DPI)
  page-<N>-textblocks.json  — PDF text evidence (empty for scanned pages)
  page-<N>-info.json        — page metadata

Prints a single-line JSON summary to stdout for Node.js subprocess to parse.
Exit code 0 on success, 1 on failure.

All output flags are set to document that this is a FRESH extraction:
  freshPdfPageRender: true
  savedPageEvidenceUsed: false
"""

import sys
import os
import json
import fitz  # PyMuPDF


# ──────────────────────────────────────────────────────────────────────────────

def extract_pdf_page(pdf_path, page_num, output_dir, dpi=150):
    """
    Render a PDF page to PNG and extract text/image evidence.
    Returns info dict (also written to page-N-info.json).
    """
    os.makedirs(output_dir, exist_ok=True)

    doc = fitz.open(pdf_path)
    total_pages = len(doc)

    if page_num < 0 or page_num >= total_pages:
        raise ValueError(
            f"Page {page_num} out of range — PDF has {total_pages} pages (0-indexed)."
        )

    page = doc[page_num]
    rect = page.rect
    pw_pts = rect.width
    ph_pts = rect.height

    # ── RENDER PAGE TO PNG ────────────────────────────────────────────────────
    zoom = dpi / 72.0
    mat  = fitz.Matrix(zoom, zoom)
    pix  = page.get_pixmap(matrix=mat, alpha=False)
    pw_px = pix.width
    ph_px = pix.height

    stem        = f"page-{page_num}"
    render_path = os.path.join(output_dir, f"{stem}-render.png")
    pix.save(render_path)

    # ── EXTRACT PDF TEXT BLOCKS ───────────────────────────────────────────────
    # Returns empty list for scanned/image-only pages — that is correct behaviour.
    text_blocks  = []
    image_blocks = []

    try:
        raw = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
        for b in raw.get("blocks", []):
            btype = b.get("type", -1)

            if btype == 0:  # text block
                for line in b.get("lines", []):
                    spans     = line.get("spans", [])
                    line_text = " ".join(s.get("text", "") for s in spans).strip()
                    if not line_text:
                        continue
                    bbox = line.get("bbox", [0, 0, 0, 0])  # [x0, y0, x1, y1] pts
                    text_blocks.append({
                        "text":       line_text,
                        "confidence": 1.0,          # PDF text is certain
                        "bbox": {
                            "x":      bbox[0] / pw_pts,
                            "y":      bbox[1] / ph_pts,
                            "width":  max(0.0, (bbox[2] - bbox[0]) / pw_pts),
                            "height": max(0.0, (bbox[3] - bbox[1]) / ph_pts),
                            # Pixel coords in rendered image
                            "x0":     int(bbox[0] / pw_pts * pw_px),
                            "y0":     int(bbox[1] / ph_pts * ph_px),
                            "x1":     int(bbox[2] / pw_pts * pw_px),
                            "y1":     int(bbox[3] / ph_pts * ph_px),
                            "coordinateSpace": "source-document-plane-normalized",
                        },
                        "sourcePdfPage": page_num,
                        "sourcePdfPath": os.path.abspath(pdf_path),
                    })

            elif btype == 1:  # image block
                bbox = b.get("bbox", [0, 0, 0, 0])
                image_blocks.append({
                    "bbox": {
                        "x":      bbox[0] / pw_pts,
                        "y":      bbox[1] / ph_pts,
                        "width":  max(0.0, (bbox[2] - bbox[0]) / pw_pts),
                        "height": max(0.0, (bbox[3] - bbox[1]) / ph_pts),
                        "coordinateSpace": "source-document-plane-normalized",
                    }
                })
    except Exception as err:
        # Scanned pages raise no exception but return empty dict — safe to ignore
        sys.stderr.write(f"[extract-pdf-page] text extraction warning: {err}\n")

    # ── SAVE TEXT BLOCKS JSON ─────────────────────────────────────────────────
    textblocks_path = os.path.join(output_dir, f"{stem}-textblocks.json")
    textblocks_data = {
        "schemaVersion":      "pdf-text-evidence/v1",
        "pdfPath":            os.path.abspath(pdf_path),
        "pageNumber":         page_num,
        "totalPages":         total_pages,
        "pageWidthPts":       pw_pts,
        "pageHeightPts":      ph_pts,
        "renderWidthPx":      pw_px,
        "renderHeightPx":     ph_px,
        "dpi":                dpi,
        "textBlocks":         text_blocks,
        "imageBlocks":        image_blocks,
        "hasExtractableText": len(text_blocks) > 0,
        # Provenance flags — these must never be false
        "freshExtraction":         True,
        "savedPageEvidenceUsed":   False,
        "legacyPageLayoutUsed":    False,
    }

    with open(textblocks_path, "w", encoding="utf-8") as fh:
        json.dump(textblocks_data, fh, indent=2, ensure_ascii=False)

    # ── SAVE INFO JSON ────────────────────────────────────────────────────────
    info = {
        "pdfPath":            os.path.abspath(pdf_path),
        "pageNumber":         page_num,
        "totalPages":         total_pages,
        "renderPath":         os.path.abspath(render_path),
        "textblocksPath":     os.path.abspath(textblocks_path),
        "pageWidthPts":       pw_pts,
        "pageHeightPts":      ph_pts,
        "renderWidthPx":      pw_px,
        "renderHeightPx":     ph_px,
        "dpi":                dpi,
        "textLineCount":      len(text_blocks),
        "imageBlockCount":    len(image_blocks),
        "hasExtractableText": len(text_blocks) > 0,
        # Provenance flags
        "freshPdfPageRender":      True,
        "freshExtraction":         True,
        "savedPageEvidenceUsed":   False,
        "legacyPageLayoutUsed":    False,
        "savedSemanticPageUsed":   False,
    }

    info_path = os.path.join(output_dir, f"{stem}-info.json")
    with open(info_path, "w", encoding="utf-8") as fh:
        json.dump(info, fh, indent=2)

    doc.close()

    # Print JSON summary to stdout — Node.js subprocess reads this
    print(json.dumps(info), flush=True)
    return info


# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.stderr.write(
            "Usage: extract-pdf-page.py <pdf_path> <page_num> <output_dir> [dpi]\n"
        )
        print(json.dumps({"error": "insufficient arguments"}))
        sys.exit(1)

    _pdf_path   = sys.argv[1]
    _page_num   = int(sys.argv[2])
    _output_dir = sys.argv[3]
    _dpi        = int(sys.argv[4]) if len(sys.argv) > 4 else 150

    try:
        extract_pdf_page(_pdf_path, _page_num, _output_dir, _dpi)
        sys.exit(0)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
