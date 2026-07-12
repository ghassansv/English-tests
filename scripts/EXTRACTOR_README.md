Reference PDF/Image to A4-normalized JSON extractor

Files added under scripts/:

- page_template_schema.json  - JSON Schema describing normalized A4 page output
- pdf_extractor.py          - Python reference extractor that outputs JSON matching the schema

Quick start (Windows)

1) Create a virtualenv (recommended)
   python -m venv .venv
   .\.venv\Scripts\activate

2) Install dependencies
   pip install --upgrade pip
   pip install pymupdf pillow pytesseract numpy opencv-python jsonschema

3) Install Tesseract on your system
   - Windows: https://github.com/tesseract-ocr/tesseract/wiki
   - Ensure tesseract is on PATH, or set TESSDATA_PREFIX as needed.

4) Run the extractor
   python scripts\pdf_extractor.py path\to\input.pdf --page 1 --output out.json

Notes and next steps
- This is a reference implementation: it prefers PDF-native extraction via PyMuPDF and falls back to OCR (pytesseract) when text coverage is low.
- The JSON structure is intentionally conservative: it produces a single text_region that covers the entire page and many simple paragraph blocks built from OCR/pdf-spans lines. The schema supports richer types (tables, images, form fields) and the extractor can be extended to populate them.
- To tighten column and block segmentation, integrate LayoutParser / detectron2, or the existing JS page-layout-normalizer logic.
- To integrate into the app: the app already normalizes and displays pageLayout objects (public/js/page-layout-normalizer.js). The outputs from this extractor should be post-processed with buildNationalTestEnglishPageLayout or similar functions if needed.

If you want, next actions:
- Extend the extractor to produce "regions" for images, figures, tables and map PDF font metadata into text_runs (font_name, font_size_pt).
- Add automated tests with a small sample dataset (ground-truth JSON) and a test runner that evaluates IoU and CER.
- Hook the extractor into scripts/maintenance so it can run on the project's dataset.
