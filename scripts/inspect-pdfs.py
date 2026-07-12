#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Inspect national-test PDFs and identify representative pages for Phase 8.5."""
import fitz, os, json, sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

pdf_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'national-tests')
pdfs = sorted(os.listdir(pdf_dir))

results = []

for pdf_name in pdfs:
    pdf_path = os.path.join(pdf_dir, pdf_name)
    doc = fitz.open(pdf_path)
    info = {"file": pdf_name, "pages": len(doc), "pageInfo": []}
    for i in range(len(doc)):
        page = doc[i]
        text = page.get_text()
        lines = [l.strip() for l in text.split('\n') if l.strip()]

        has_abcd = any(s in text for s in ['A.  ', 'B.  ', 'C.  ', 'D.  ', 'A) ', 'B) ', 'A.', 'B.', '(A)', '(B)'])
        has_blank = ('______' in text or '____' in text or '___' in text)
        has_numbered_q = sum(1 for n in range(1, 50) if f'\n{n}.' in text or f'\n{n} .' in text) >= 2
        has_images = len(page.get_images()) > 0
        word_count = len(text.split())

        # Detect column structure via text block positions
        blocks = page.get_text("blocks")
        if blocks:
            xs = [b[0] for b in blocks]
            mid = page.rect.width / 2
            left_count = sum(1 for x in xs if x < mid - 20)
            right_count = sum(1 for x in xs if x > mid + 20)
            two_col = left_count >= 2 and right_count >= 2
        else:
            two_col = False

        has_answer_lines = text.count('___') >= 3 and not has_blank

        page_type = "unknown"
        if two_col and word_count > 100:
            page_type = "two-column-article"
        elif has_abcd and has_numbered_q:
            page_type = "questions-abcd"
        elif has_blank and has_numbered_q:
            page_type = "fill-blank"
        elif has_answer_lines and word_count > 30:
            page_type = "answer-lines"
        elif has_images and word_count > 50:
            page_type = "mixed-image-text"
        elif word_count > 100:
            page_type = "article"

        page_info = {
            "pageNum": i + 1,
            "type": page_type,
            "words": word_count,
            "twoColumn": two_col,
            "hasABCD": has_abcd,
            "hasBlank": has_blank,
            "hasImages": has_images,
            "hasAnswerLines": has_answer_lines,
            "firstLine": lines[0][:80] if lines else ""
        }
        info["pageInfo"].append(page_info)
    doc.close()
    results.append(info)

# Print summary
for r in results:
    print(f"\n{r['file'][:40]}  ({r['pages']} pages)")
    for p in r['pageInfo']:
        flags = []
        if p['twoColumn']: flags.append("2col")
        if p['hasABCD']: flags.append("ABCD")
        if p['hasBlank']: flags.append("blank")
        if p['hasImages']: flags.append("img")
        if p['hasAnswerLines']: flags.append("answerlines")
        print(f"  p{p['pageNum']:2d} [{p['type']:22s}] w={p['words']:4d} {','.join(flags):25s} | {p['firstLine'][:60]}")

# Print candidates for each scenario
print("\n\n=== SCENARIO CANDIDATES ===")
for scenario, typeKey in [
    ("two-column-article", "two-column-article"),
    ("questions-abcd", "questions-abcd"),
    ("fill-blank", "fill-blank"),
    ("mixed-image-text", "mixed-image-text"),
    ("answer-lines", "answer-lines"),
]:
    print(f"\n-- {scenario} --")
    found = []
    for r in results:
        for p in r['pageInfo']:
            if p['type'] == typeKey:
                found.append((r['file'][:40], p['pageNum'], p['words']))
    for f,n,w in found[:5]:
        print(f"  {f} p{n} words={w}")

# Save as JSON
out_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'document-intelligence-diagnostics', 'pdf-page-survey.json')
with open(out_path, 'w') as f:
    json.dump(results, f, indent=2)
print(f"\nSaved to {out_path}")
