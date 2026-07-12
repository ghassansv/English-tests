import { createWorker } from "tesseract.js";
const imgs = [
  "data/document-intelligence-diagnostics/pdf-probe/scan-p2.png",
  "data/document-intelligence-diagnostics/pdf-probe/scan-p5.png",
];
for (const imgPath of imgs) {
  const worker = await createWorker("eng", 1, { logger: () => {} });
  const result = await worker.recognize(imgPath, {}, { text: true, blocks: true });
  const data = result.data;
  await worker.terminate();

  // Flatten lines
  const lines = [];
  for (const b of (data.blocks || [])) {
    for (const p of (b.paragraphs || [])) {
      for (const l of (p.lines || [])) {
        const t = (l.text||"").trim().replace(/\n/g," ");
        if (t) lines.push(t);
      }
    }
  }
  console.log(`\n=== ${imgPath} ===  (${lines.length} lines)`);
  lines.slice(0, 20).forEach(l => console.log(" ", JSON.stringify(l.slice(0,70))));
}
