import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { createWorker } from 'tesseract.js';
import sizeOf from 'image-size';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const A4_PT = { width_pt: 595.0, height_pt: 842.0 };

function toA4Transform(srcW, srcH) {
  const targetW = A4_PT.width_pt;
  const targetH = A4_PT.height_pt;
  const scaleX = targetW / srcW;
  const scaleY = targetH / srcH;
  const scale = Math.min(scaleX, scaleY);
  const newW = srcW * scale;
  const newH = srcH * scale;
  const translateX = (targetW - newW) / 2.0;
  const translateY = (targetH - newH) / 2.0;
  return { scale, scale_x: scale, scale_y: scale, translate_x_pt: translateX, translate_y_pt: translateY };
}

function normBbox(transform, srcBox, srcW, srcH) {
  const [x, y, w, h] = srcBox;
  const xPt = x * transform.scale + transform.translate_x_pt;
  const yPt = y * transform.scale + transform.translate_y_pt;
  const wPt = w * transform.scale;
  const hPt = h * transform.scale;
  return {
    x_norm: xPt / A4_PT.width_pt,
    y_norm: yPt / A4_PT.height_pt,
    w_norm: wPt / A4_PT.width_pt,
    h_norm: hPt / A4_PT.height_pt,
    x_pt: xPt,
    y_pt: yPt,
    w_pt: wPt,
    h_pt: hPt
  };
}

async function runTesseractOnImage(imagePath) {
  // Use tesseract.js entry API. Different package versions expose createWorker or recognize.
  const mod = await import('tesseract.js');
  const T = mod && (mod.default || mod);

  if (T && T.recognize) {
    // prefer top-level recognize if available (works in many tesseract.js builds)
    const res = await T.recognize(imagePath, 'eng');
    return res.data || res;
  }
  if (T && T.createWorker) {
    const worker = T.createWorker();
    if (typeof worker.load === 'function') {
      await worker.load();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      const { data } = await worker.recognize(imagePath, { tessedit_pageseg_mode: '1' });
      await worker.terminate();
      return data;
    }
    // fallback: try worker.recognize directly
    if (typeof worker.recognize === 'function') {
      const { data } = await worker.recognize(imagePath);
      if (typeof worker.terminate === 'function') await worker.terminate();
      return data;
    }
  }
  throw new Error('tesseract.js API not found');
}

function assembleSchemaJson(pageNumber, srcW, srcH, transform, words, ocrEngine = 'tesseract.js') {
  const lines = {};
  for (const w of words) {
    // Tesseract.js words may have bbox as {x0,y0,x1,y1} or as x0,y0,w,h depending on version
    let x = 0, y = 0, wpx = 0, hpx = 0, text = '';
    if (w.bbox) {
      // bbox: {x0,y0,x1,y1} usually for tesseract.js .data.words -> bbox contains x0,y0,x1,y1
      if (Array.isArray(w.bbox) && w.bbox.length === 4) {
        x = w.bbox[0];
        y = w.bbox[1];
        wpx = w.bbox[2] - w.bbox[0];
        hpx = w.bbox[3] - w.bbox[1];
      } else if (typeof w.bbox === 'object' && w.bbox.x0 !== undefined) {
        x = w.bbox.x0; y = w.bbox.y0; wpx = w.bbox.x1 - w.bbox.x0; hpx = w.bbox.y1 - w.bbox.y0;
      }
    }
    text = (w.text || w.word || w.candidates || '').toString();
    // cluster by y
    const key = Math.round(y / Math.max(6, hpx / 2 || 10));
    lines[key] = lines[key] || [];
    lines[key].push({ text: text.trim(), bbox: [x, y, wpx, hpx], confidence: (w.confidence || w.conf || 1.0) });
  }

  const sortedKeys = Object.keys(lines).map(k => parseInt(k)).sort((a,b)=>a-b);
  const blocks = [];
  let reading = 0;
  for (const k of sortedKeys) {
    const lineWords = lines[k].sort((a,b)=>a.bbox[0]-b.bbox[0]);
    const text = lineWords.map(lw=>lw.text).filter(Boolean).join(' ');
    if (!text) continue;
    const x = Math.min(...lineWords.map(lw=>lw.bbox[0]));
    const y = Math.min(...lineWords.map(lw=>lw.bbox[1]));
    const wmax = Math.max(...lineWords.map(lw=>lw.bbox[0]+lw.bbox[2])) - x;
    const hmax = Math.max(...lineWords.map(lw=>lw.bbox[3]||0));
    const bboxSrc = [x,y,wmax,hmax];
    const bbox = normBbox(transform, bboxSrc, srcW, srcH);
    const avgConf = lineWords.reduce((s, it)=>s + (it.confidence||1.0),0)/lineWords.length;
    blocks.push({
      id: `b${reading+1}`,
      type: 'paragraph',
      role: 'body-text',
      bbox,
      reading_order: reading,
      text,
      text_runs: [
        {
          text,
          bbox,
          font_name: null,
          font_size_pt: null,
          font_weight: null,
          font_style: null,
          color: null,
          underline: false,
          hyphenation_hint: false,
          provenance: { source: 'ocr', engine: ocrEngine, confidence: avgConf }
        }
      ],
      confidence: avgConf,
      provenance: { source: 'ocr', engine: ocrEngine, confidence: avgConf }
    });
    reading += 1;
  }

  const regions = [
    {
      id: 'r1',
      type: 'text_region',
      bbox: { x_norm: 0, y_norm: 0, w_norm: 1, h_norm: 1, x_pt: 0, y_pt: 0, w_pt: A4_PT.width_pt, h_pt: A4_PT.height_pt },
      blocks,
      reading_order: 0,
      provenance: { source: 'ocr', engine: ocrEngine, confidence: 0.9 },
      confidence: 0.9
    }
  ];

  return {
    page: {
      page_number: pageNumber,
      a4: A4_PT,
      transform: transform,
      source: { original_width: srcW, original_height: srcH, dpi: null, mime_type: null },
      regions,
      metadata: { created_at: new Date().toISOString(), provenance: 'node-extractor', page_confidence: 0.9 },
      diagnostics: []
    }
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    console.error('Usage: node scripts/node_extractor.mjs <input-image-or-pdf> [--page N] [--output out.json]');
    process.exit(2);
  }

  let input = argv[0];
  let page = 1;
  let out = null;
  for (let i=1;i<argv.length;i++){
    if (argv[i]==='--page') { page = parseInt(argv[++i]||1); }
    if (argv[i]==='--output') { out = argv[++i]; }
  }

  const ext = path.extname(input).toLowerCase();
  if (!fs.existsSync(input)) {
    console.error('Input does not exist:', input);
    process.exit(3);
  }

  if (['.png','.jpg','.jpeg','.tiff','.bmp',''].includes(ext) || ext==='') {
    // Treat as image
    const dims = sizeOf(fs.readFileSync(input));
    const srcW = dims.width;
    const srcH = dims.height;
    const transform = toA4Transform(srcW, srcH);
    console.log('Running OCR (tesseract.js) on image', input, 'size', srcW, 'x', srcH);
    const data = await runTesseractOnImage(input);
    // data.words is array of words; some tesseract.js builds only return flat text
    let words = data.words && data.words.length ? data.words : (data.lines && data.lines.length ? data.lines : []);
    if ((!words || words.length === 0) && data.text) {
      // Fallback: split text into lines and approximate bbox positions across the page height
      const linesArr = data.text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
      const n = linesArr.length || 1;
      const approxLineH = Math.max(12, Math.floor(srcH / Math.max(8, n)));
      words = [];
      for (let i=0;i<linesArr.length;i++){
        const y = Math.floor(i * approxLineH);
        const txt = linesArr[i];
        words.push({ text: txt, bbox: [0, y, srcW, approxLineH], confidence: (data.confidence || 0.8) });
      }
    }
    const jsonOut = assembleSchemaJson(page, srcW, srcH, transform, words, 'tesseract.js');
    if (out) fs.writeFileSync(out, JSON.stringify(jsonOut, null, 2), 'utf8');
    else console.log(JSON.stringify(jsonOut, null, 2));
    console.log('Done');
  } else {
    // Try PDF text extraction using pdfjs-dist
    try {
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js');
      const data = new Uint8Array(fs.readFileSync(input));
      const loadingTask = pdfjsLib.getDocument({ data });
      const doc = await loadingTask.promise;
      const pg = await doc.getPage(page);
      const textContent = await pg.getTextContent();
      const items = textContent.items || [];
      const srcW = Math.round(pg.view[2]);
      const srcH = Math.round(pg.view[3]);
      const transform = toA4Transform(srcW, srcH);
      const words = items.map(it=>({ text: it.str, bbox: [it.transform[4], it.transform[5], it.width, it.height], confidence: 1.0 }));
      const jsonOut = assembleSchemaJson(page, srcW, srcH, transform, words, 'pdfjs-text');
      if (out) fs.writeFileSync(out, JSON.stringify(jsonOut, null, 2), 'utf8');
      else console.log(JSON.stringify(jsonOut, null, 2));
      console.log('Done (pdf text)');
    } catch (err) {
      console.error('PDF path failed:', err.message || err);
      process.exit(4);
    }
  }
}

main().catch(err=>{ console.error(err); process.exit(10); });
