"""
Reference Python extractor that normalizes pages to A4 and emits JSON conforming to scripts/page_template_schema.json.
This is a lightweight reference intended to be extended and integrated into the existing app pipeline.

Usage:
  python scripts\pdf_extractor.py input.pdf --page 1 --output out.json
  python scripts\pdf_extractor.py input.jpg --output out.json

Dependencies (install in a virtualenv):
  pip install pymupdf pillow pytesseract numpy opencv-python jsonschema

Notes:
- Requires Tesseract installed on the system (for pytesseract). On Windows, install Tesseract and set TESSDATA_PREFIX if needed.
- This script first tries PDF-native extraction with PyMuPDF. If text coverage is low, it rasterizes the page and runs OCR.
- The output uses normalized A4 coordinates (595x842 pts) and normalized [0..1] values for each bbox.

"""

import sys
import os
import json
import argparse
import math
from datetime import datetime

try:
    import fitz  # PyMuPDF
except Exception:
    fitz = None

from PIL import Image
import numpy as np
import pytesseract

# Optional: cv2 for checkbox detection
try:
    import cv2
except Exception:
    cv2 = None

A4_PT = {"width_pt": 595.0, "height_pt": 842.0}


def to_a4_transform(src_w, src_h):
    """Compute scale and translate to map source image (src_w,src_h) to A4 while preserving aspect ratio.
    We center the content on the A4 page and return scale_x, scale_y, translate_x_pt, translate_y_pt.
    """
    target_w = A4_PT["width_pt"]
    target_h = A4_PT["height_pt"]
    scale_x = target_w / src_w
    scale_y = target_h / src_h
    # Use uniform scale to preserve aspect
    scale = min(scale_x, scale_y)
    new_w = src_w * scale
    new_h = src_h * scale
    translate_x_pt = (target_w - new_w) / 2.0
    translate_y_pt = (target_h - new_h) / 2.0
    return {"scale_x": scale, "scale_y": scale, "translate_x_pt": translate_x_pt, "translate_y_pt": translate_y_pt}


def norm_bbox(a4_transform, src_bbox, src_w, src_h):
    """Convert a bbox in source pixel coordinates to normalized [0..1] and A4 points.
    src_bbox = (x, y, w, h) in source pixels
    """
    x, y, w, h = src_bbox
    scale = a4_transform["scale_x"]
    tx = a4_transform["translate_x_pt"]
    ty = a4_transform["translate_y_pt"]

    x_pt = x * scale + tx
    y_pt = y * scale + ty
    w_pt = w * scale
    h_pt = h * scale

    x_norm = x_pt / A4_PT["width_pt"]
    y_norm = y_pt / A4_PT["height_pt"]
    w_norm = w_pt / A4_PT["width_pt"]
    h_norm = h_pt / A4_PT["height_pt"]

    return {
        "x_norm": x_norm,
        "y_norm": y_norm,
        "w_norm": w_norm,
        "h_norm": h_norm,
        "x_pt": x_pt,
        "y_pt": y_pt,
        "w_pt": w_pt,
        "h_pt": h_pt
    }


def extract_pdf_native(page):
    """Try extracting words and font info from a PyMuPDF page.
    Returns list of words with bbox and font metadata.
    """
    words = []
    try:
        dict_out = page.get_text("dict")
        for block in dict_out.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "").strip()
                    if not text:
                        continue
                    bbox = span.get("bbox")  # [x0,y0,x1,y1]
                    x0, y0, x1, y1 = bbox
                    w = x1 - x0
                    h = y1 - y0
                    words.append({
                        "text": text,
                        "bbox": (x0, y0, w, h),
                        "font": span.get("font"),
                        "size": span.get("size"),
                        "flags": span.get("flags")
                    })
    except Exception:
        return []
    return words


def ocr_image(image):
    """Run Tesseract OCR and return words with bounding boxes and confidence.
    Uses pytesseract.image_to_data.
    """
    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    n = len(data.get("text", []))
    words = []
    for i in range(n):
        text = (data["text"][i] or "").strip()
        if not text:
            continue
        x = int(data["left"][i])
        y = int(data["top"][i])
        w = int(data["width"][i])
        h = int(data["height"][i])
        conf = float(data["conf"][i]) if data["conf"][i] != "-1" else 0.0
        words.append({
            "text": text,
            "bbox": (x, y, w, h),
            "confidence": conf / 100.0
        })
    return words


def detect_checkboxes_cv(image):
    """Detect small square boxes that may be checkboxes. Returns list of bboxes in image pixels.
    Requires cv2. If not installed, returns [].
    """
    if cv2 is None:
        return []
    arr = np.array(image.convert("L"))
    # Adaptive threshold and find contours
    thr = cv2.adaptiveThreshold(arr, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 8)
    contours, _ = cv2.findContours(thr, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    h, w = arr.shape
    for cnt in contours:
        x, y, ww, hh = cv2.boundingRect(cnt)
        area = ww * hh
        if area < 100 or area > 10000:
            continue
        ratio = ww / float(hh)
        if 0.6 <= ratio <= 1.6:
            # compute fill ratio
            mask = np.zeros_like(arr)
            cv2.drawContours(mask, [cnt], -1, 255, -1)
            filled = np.sum((thr & (mask > 0)) > 0)
            fill_ratio = filled / float(area + 1e-6)
            # empty checkbox will have small fill ratio
            if fill_ratio < 0.6:
                boxes.append((x, y, ww, hh))
    return boxes


def build_schema_json(page_number, src_w, src_h, transform, words, ocr_used=False, checkboxes=None):
    """Assemble a minimal JSON following the schema. Words will be grouped into simple paragraph blocks.
    This is a best-effort, illustrative output.
    """
    # Group words into lines by y coordinate
    lines = {}
    for w in words:
        x, y, ww, hh = w["bbox"]
        key = int(y // max(8, hh / 2))
        lines.setdefault(key, []).append(w)
    sorted_keys = sorted(lines.keys())
    blocks = []
    reading = 0
    for k in sorted_keys:
        line_words = sorted(lines[k], key=lambda wi: wi["bbox"][0])
        text = " ".join(wi["text"] for wi in line_words)
        x = min(wi["bbox"][0] for wi in line_words)
        y = min(wi["bbox"][1] for wi in line_words)
        wmax = max(wi["bbox"][0] + wi["bbox"][2] for wi in line_words) - x
        hmax = max(wi["bbox"][3] for wi in line_words)
        bbox_src = (x, y, wmax, hmax)
        bbox = norm_bbox(transform, bbox_src, src_w, src_h)
        text_runs = []
        # build a single run per line for simplicity
        text_runs.append({
            "text": text,
            "bbox": bbox,
            "font_name": None,
            "font_size_pt": None,
            "font_weight": None,
            "font_style": None,
            "color": None,
            "underline": False,
            "hyphenation_hint": False,
            "provenance": {"source": "ocr" if ocr_used else "pdf-native", "engine": "pytesseract" if ocr_used else "pymupdf", "confidence": float(np.mean([wi.get("confidence", 1.0) for wi in line_words]))}
        })
        blocks.append({
            "id": f"b{reading+1}",
            "type": "paragraph",
            "role": "body-text",
            "bbox": bbox,
            "reading_order": reading,
            "text": text,
            "text_runs": text_runs,
            "confidence": float(np.mean([wi.get("confidence", 1.0) for wi in line_words])),
            "provenance": {"source": "ocr" if ocr_used else "pdf-native", "engine": "pytesseract" if ocr_used else "pymupdf", "confidence": float(np.mean([wi.get("confidence", 1.0) for wi in line_words]))}
        })
        reading += 1

    regions = [
        {
            "id": "r1",
            "type": "text_region",
            "bbox": {"x_norm": 0, "y_norm": 0, "w_norm": 1, "h_norm": 1, "x_pt": 0, "y_pt": 0, "w_pt": A4_PT["width_pt"], "h_pt": A4_PT["height_pt"]},
            "blocks": blocks,
            "reading_order": 0,
            "provenance": {"source": "ocr" if ocr_used else "pdf-native", "engine": "pytesseract" if ocr_used else "pymupdf", "confidence": 0.9},
            "confidence": 0.9
        }
    ]

    # Append form region with checkboxes if found
    if checkboxes:
        boxes_block = []
        for i, cb in enumerate(checkboxes):
            bbox = norm_bbox(transform, cb, src_w, src_h)
            boxes_block.append({
                "id": f"chk_{i+1}",
                "type": "checkbox_group",
                "role": "checkbox",
                "bbox": bbox,
                "reading_order": reading + i,
                "text": None,
                "text_runs": [],
                "confidence": 0.9,
                "provenance": {"source": "ocr","engine": "opencv"}
            })
        regions.append({
            "id": "r_form",
            "type": "form",
            "bbox": {"x_norm": 0, "y_norm": 0, "w_norm": 1, "h_norm": 1, "x_pt": 0, "y_pt": 0, "w_pt": A4_PT["width_pt"], "h_pt": A4_PT["height_pt"]},
            "blocks": boxes_block,
            "reading_order": reading + len(checkboxes),
            "provenance": {"source": "ocr","engine": "opencv"},
            "confidence": 0.9
        })

    result = {
        "page": {
            "page_number": page_number,
            "a4": A4_PT,
            "transform": transform,
            "source": {"original_width": src_w, "original_height": src_h, "dpi": None, "mime_type": None},
            "regions": regions,
            "metadata": {"created_at": datetime.utcnow().isoformat() + "Z", "provenance": ocr_used and "ocr" or "pdf-native", "page_confidence": 0.9},
            "diagnostics": []
        }
    }
    return result


def process_input(path, page_number=1, output_path=None):
    ext = os.path.splitext(path)[1].lower()
    ocr_used = False
    words = []
    checkboxes = []
    src_w = None
    src_h = None
    transform = None

    if ext in [".pdf"] and fitz is not None:
        doc = fitz.open(path)
        page_index = max(0, page_number - 1)
        pm = doc.load_page(page_index)
        # try pdf-native extraction
        words_native = extract_pdf_native(pm)
        # page crop size
        src_w = int(pm.rect.width)
        src_h = int(pm.rect.height)
        transform = to_a4_transform(src_w, src_h)
        if words_native and len(words_native) > 0:
            # use pdf-native
            words = []
            for w in words_native:
                bbox = w["bbox"]
                words.append({"text": w["text"], "bbox": (int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])), "confidence": 1.0})
        else:
            # fallback to raster + ocr
            ocr_used = True
            zoom = 2  # render at higher res
            mat = fitz.Matrix(zoom, zoom)
            pix = pm.get_pixmap(matrix=mat, alpha=False)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            src_w, src_h = img.size
            transform = to_a4_transform(src_w, src_h)
            words = ocr_image(img)
            # try checkbox detection
            checkboxes = detect_checkboxes_cv(img)
    else:
        # treat as image
        img = Image.open(path).convert("RGB")
        src_w, src_h = img.size
        transform = to_a4_transform(src_w, src_h)
        ocr_used = True
        words = ocr_image(img)
        checkboxes = detect_checkboxes_cv(img)

    json_out = build_schema_json(page_number, src_w, src_h, transform, words, ocr_used=ocr_used, checkboxes=checkboxes)

    if output_path:
        with open(output_path, "w", encoding="utf-8") as fh:
            json.dump(json_out, fh, ensure_ascii=False, indent=2)
        print(f"Wrote {output_path}")
    else:
        print(json.dumps(json_out, ensure_ascii=False, indent=2))


def main(argv):
    parser = argparse.ArgumentParser(description="Reference PDF/Image to A4-normalized JSON extractor")
    parser.add_argument("input", help="Input PDF or image file")
    parser.add_argument("--page", type=int, default=1, help="Page number to extract (1-based) for PDF input")
    parser.add_argument("--output", help="Output JSON file path (optional). If omitted prints to stdout")
    args = parser.parse_args(argv)

    process_input(args.input, page_number=args.page, output_path=args.output)


if __name__ == "__main__":
    main(sys.argv[1:])
