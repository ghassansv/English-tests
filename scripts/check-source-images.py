#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Quick check for source image existence and 1783* PDFs."""
import sys, io, fitz, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

target_files = [
    'data/national-test-page-images/1783723602278-72363f58-890d-4151-9126-da904659c2a5.jpg',
    'data/national-test-page-images/1783723602745-528002e0-b091-4c23-a38b-53119f73e267.jpg'
]
for f in target_files:
    full = os.path.join(ROOT, f)
    print(f'{f}: {"EXISTS" if os.path.exists(full) else "MISSING"}')

pdf_dir = os.path.join(ROOT, 'data', 'national-tests')
for pdf_name in sorted(os.listdir(pdf_dir)):
    if not pdf_name.startswith('1783'):
        continue
    pdf_path = os.path.join(pdf_dir, pdf_name)
    doc = fitz.open(pdf_path)
    print(f'\nPDF {pdf_name[:35]} pages={len(doc)}')
    for i in range(min(10, len(doc))):
        pg = doc[i]
        text = pg.get_text()
        imgs = pg.get_images()
        words = len(text.split())
        preview = text.strip()[:60].replace('\n', ' ')
        print(f'  p{i+1}: words={words} imgs={len(imgs)} | {preview}')
    doc.close()
