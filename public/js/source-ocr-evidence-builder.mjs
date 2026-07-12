/**
 * source-ocr-evidence-builder.mjs
 *
 * Phase 8.5 — Build SourceEvidenceModel from real PDF page or image.
 *
 * Two entry points:
 *
 *   buildSourceEvidenceFromPdfPage(renderPath, textblocksData, opts?)
 *     → SourceEvidenceModel starting from a freshly rendered PDF page PNG
 *       plus pre-extracted PDF text blocks (from extract-pdf-page.py).
 *       OCR is run on the rendered PNG and merged with PDF text evidence.
 *       Provenance flags record freshPdfPageRender / freshOcr = true.
 *
 *   buildSourceEvidenceFromImage(imagePath, opts?)
 *     → SourceEvidenceModel starting from a raw image (JPEG/PNG).
 *       OCR only — no PDF text evidence.
 *
 *   classifyPageContent(sourceEvidence)
 *     → { pageType, columnCount, hasABCD, hasBlanks, ... }
 *
 * All paths: NO pageLayout is consulted.
 *
 * Exports:
 *   buildSourceEvidenceFromPdfPage(renderPath, textblocksData, opts?)
 *   buildSourceEvidenceFromImage(imagePath, opts?)
 *   classifyPageContent(sourceEvidence)
 */

import { createWorker } from "tesseract.js";

// ============================================================
// PUBLIC: BUILD SOURCE EVIDENCE FROM IMAGE
// ============================================================

/**
 * Run Tesseract OCR on an image and build a SourceEvidenceModel.
 *
 * @param {string} imagePath   - Absolute or project-relative path to image
 * @param {object} [opts]
 * @param {string} [opts.lang]  - Tesseract language (default "eng")
 * @param {function} [opts.logger] - Progress logger
 * @returns {Promise<object>} SourceEvidenceModel (source-evidence/v1)
 */
export async function buildSourceEvidenceFromImage(imagePath, opts = {}) {
  const lang   = opts.lang   || "eng";
  const logger = opts.logger || (() => {});

  logger({ status: "starting-ocr", imagePath });

  // tesseract.js v7: structured data requires `{ blocks: true }` in the output param
  const worker = await createWorker(lang, 1, { logger });
  let tessData;
  try {
    const { data } = await worker.recognize(imagePath, {}, { text: true, blocks: true });
    tessData = data;
  } finally {
    await worker.terminate();
  }

  const model = buildEvidenceFromTessData(tessData, imagePath);
  const textSelection = selectSourceTextLines(model);
  return {
    ...model,
    diagnostics: {
      ...(model.diagnostics || {}),
      textSelection: summarizeTextSelection(textSelection),
    },
  };
}

// ============================================================
// PUBLIC: BUILD SOURCE EVIDENCE FROM FRESH PDF PAGE RENDER
// ============================================================

/**
 * Build SourceEvidenceModel from a freshly rendered PDF page.
 *
 * This is the primary entry point for the Phase 8.5 PDF pipeline.
 * It combines:
 *   1. Fresh OCR on the rendered PNG  (always run)
 *   2. PDF text blocks from extract-pdf-page.py  (when available)
 *
 * @param {string} renderPath       - Path to the freshly rendered PDF page PNG
 * @param {object} textblocksData   - Parsed JSON from page-N-textblocks.json
 * @param {object} [opts]
 * @param {string} [opts.lang]      - OCR language (default "eng")
 * @param {function} [opts.logger]
 * @returns {Promise<object>} SourceEvidenceModel (source-evidence/v1)
 */
export async function buildSourceEvidenceFromPdfPage(renderPath, textblocksData, opts = {}) {
  const lang   = opts.lang   || "eng";
  const logger = opts.logger || (() => {});

  // ── STEP 1: Run fresh OCR on the rendered PNG ──────────────
  logger({ status: "starting-ocr", renderPath });

  const worker = await createWorker(lang, 1, { logger });
  let tessData;
  try {
    const { data } = await worker.recognize(renderPath, {}, { text: true, blocks: true });
    tessData = data;
  } finally {
    await worker.terminate();
  }

  // ── STEP 2: Build OCR evidence from tessData ───────────────
  const ocrEvidence = buildOcrEvidenceFromTessData(
    tessData,
    textblocksData.renderWidthPx  || 1,
    textblocksData.renderHeightPx || 1
  );

  // ── STEP 3: Build PDF text evidence (when available) ───────
  // PDF text evidence is the ground truth for text-layer PDFs.
  // For scanned PDFs, textblocksData.textBlocks will be empty.
  const pdfTextEvidence = (textblocksData.textBlocks || []).map((b, i) => ({
    id:         `pdf-${i}`,
    kind:       "pdf-text",
    text:       b.text.trim(),
    confidence: b.confidence ?? 1.0,
    bbox:       b.bbox,
    source:     "pdf-text-layer",
    sourcePdfPage: textblocksData.pageNumber,
    sourcePdfPath: textblocksData.pdfPath,
  }));

  // ── STEP 4: Build visual evidence (image blocks from PDF + OCR) ─
  const pdfImageCandidates = (textblocksData.imageBlocks || []).map((ib, i) => ({
    id:        `pdf-img-${i}`,
    kind:      "image-candidate",
    blocktype: "IMAGE_BLOCK_PDF",
    bbox:      ib.bbox,
    source:    "pdf-page-image-block",
    accepted:  true,
    confidence: ib.confidence ?? 0.85,
  }));

  // Merge: prefer PDF image blocks; fall back to OCR non-text regions
  const imageCandidates = pdfImageCandidates.length > 0
    ? pdfImageCandidates
    : ocrEvidence.imageCandidates;

  // ── STEP 5: Choose primary text source ─────────────────────
  // When PDF has extractable text, prefer it over OCR lines.
  // When PDF is scanned (no text), rely on OCR lines.
  const hasExtractableText = (pdfTextEvidence.length > 0);

  // For the semantic builder, we always populate ocrEvidence from OCR.
  // If PDF text is available, it is also available as pdfTextEvidence.
  // The semantic builder and classifier prefer pdfTextEvidence when populated.

  const model = {
    schemaVersion:    "source-evidence/v1",
    sourceType:       "pdf-page",
    sourcePath:       renderPath,
    pdfPath:          textblocksData.pdfPath,
    pageNumber:       textblocksData.pageNumber,
    pageWidth:        textblocksData.renderWidthPx  || tessData.width  || 1,
    pageHeight:       textblocksData.renderHeightPx || tessData.height || 1,
    ocrEngine:        "tesseract.js",
    ocrConfidence:    (tessData.confidence ?? 0) / 100,
    hasExtractableText,
    // Provenance — these must never be changed to true/false incorrectly
    freshPdfPageRender:    true,
    freshOcr:              true,
    freshSourceEvidence:   true,
    savedPageEvidenceUsed: false,
    legacyPageLayoutUsed:  false,
    savedSemanticPageUsed: false,
    visualEvidence: {
      imageCandidates,
      graphicCandidates: [],
      regions:           [],
    },
    ocrEvidence,
    pdfTextEvidence,
  };
  const textSelection = selectSourceTextLines(model);
  return {
    ...model,
    diagnostics: {
      textSelection: summarizeTextSelection(textSelection),
    },
  };
}

// ============================================================
// PUBLIC: SOURCE TEXT SELECTION + CLASSIFY PAGE CONTENT
// ============================================================

/**
 * Deterministically choose the text evidence stream that should drive semantic
 * reconstruction. PDF text is not automatically trusted when it is sparse.
 *
 * @param {object} sourceEvidence
 * @returns {{
 *   mode: "pdf-text-primary"|"ocr-primary"|"reconciled-pdf-ocr",
 *   primarySource: "pdf-text"|"ocr-line"|"reconciled",
 *   lines: object[],
 *   diagnostics: object
 * }}
 */
export function selectSourceTextLines(sourceEvidence = {}) {
  const pdfLines = normalizeEvidenceLines(sourceEvidence.pdfTextEvidence || [], "pdf-text");
  const ocrLines = normalizeEvidenceLines(sourceEvidence.ocrEvidence?.lines || [], "ocr-line");

  const pdf = assessTextSource(pdfLines);
  const ocr = assessTextSource(ocrLines);
  const overlap = estimateSourceOverlap(pdfLines, ocrLines);
  const reasons = [];

  let mode = "pdf-text-primary";
  let primarySource = "pdf-text";
  let lines = pdfLines;

  const hasPdf = pdf.lineCount > 0;
  const hasOcr = ocr.lineCount > 0;
  const ocrUsable = ocr.lineCount >= 3 && ocr.charCount >= 60 && ocr.avgConfidence >= 0.30;
  const pdfUsable = pdf.lineCount >= 3 && pdf.charCount >= 60;
  const pdfSuspiciouslySparse = hasPdf && ocrUsable && (
    pdf.lineCount < Math.max(3, Math.floor(ocr.lineCount * 0.25)) ||
    pdf.charCount < Math.max(80, Math.floor(ocr.charCount * 0.30))
  );
  const ocrMarkerAdvantage = ocr.markerCount >= pdf.markerCount + 2 &&
    ocr.lineCount >= Math.max(6, pdf.lineCount * 1.5);

  if (!hasPdf && hasOcr) {
    mode = "ocr-primary";
    primarySource = "ocr-line";
    lines = ocrLines;
    reasons.push("no-pdf-text-evidence");
  } else if (hasPdf && !hasOcr) {
    mode = "pdf-text-primary";
    primarySource = "pdf-text";
    lines = pdfLines;
    reasons.push("no-ocr-lines");
  } else if (pdfSuspiciouslySparse) {
    mode = "ocr-primary";
    primarySource = "ocr-line";
    lines = ocrLines;
    reasons.push("pdf-text-suspiciously-sparse");
    reasons.push(`pdf-lines=${pdf.lineCount}:ocr-lines=${ocr.lineCount}`);
    reasons.push(`pdf-chars=${pdf.charCount}:ocr-chars=${ocr.charCount}`);
  } else if (ocrMarkerAdvantage && ocr.avgConfidence >= 0.45 && overlap.pdfCoveredByOcr < 0.55) {
    mode = "ocr-primary";
    primarySource = "ocr-line";
    lines = ocrLines;
    reasons.push("ocr-has-more-structural-markers");
  } else if (pdfUsable && (overlap.pdfCoveredByOcr >= 0.40 || pdf.charCount >= ocr.charCount * 0.55 || pdf.markerCount >= ocr.markerCount * 0.75)) {
    mode = "pdf-text-primary";
    primarySource = "pdf-text";
    lines = pdfLines;
    reasons.push("pdf-text-quality-sufficient");
    if (overlap.pdfCoveredByOcr >= 0.40) reasons.push("pdf-ocr-overlap-supported");
  } else if (ocrUsable && ocr.lineCount > Math.max(8, pdf.lineCount * 1.8)) {
    mode = "ocr-primary";
    primarySource = "ocr-line";
    lines = ocrLines;
    reasons.push("ocr-has-materially-more-text");
  } else if (hasPdf && hasOcr) {
    mode = "reconciled-pdf-ocr";
    primarySource = "reconciled";
    lines = reconcilePdfAndOcrLines(pdfLines, ocrLines);
    reasons.push("pdf-and-ocr-both-material");
  } else {
    mode = "pdf-text-primary";
    primarySource = "pdf-text";
    lines = pdfLines;
    reasons.push("fallback-pdf-text-primary");
  }

  const sortedLines = sortEvidenceLines(lines);
  return {
    mode,
    primarySource,
    lines: sortedLines,
    diagnostics: {
      mode,
      primarySource,
      reasons: uniqueStrings(reasons),
      pdf,
      ocr,
      overlap,
      selectedLineCount: sortedLines.length,
      selectedLineIds: sortedLines.map(line => line.id).filter(Boolean),
    },
  };
}

/**
 * Analyse a SourceEvidenceModel to determine page type and structure.
 *
 * @param {object} sourceEvidence - SourceEvidenceModel
 * @returns {{ pageType, columnCount, hasABCD, hasBlanks, hasAnswerLines, hasImages,
 *             questionCount, optionCount, paragraphCount, confidence }}
 */
export function classifyPageContent(sourceEvidence) {
  const textSelection = selectSourceTextLines(sourceEvidence);
  const lines      = textSelection.lines;
  const bodyLines  = lines.filter(l => Number(l.bbox?.y ?? 0) < 0.88);
  const blocks     = sourceEvidence?.ocrEvidence?.blocks  || [];
  const words      = sourceEvidence?.ocrEvidence?.words   || [];

  // Build full text for pattern matching
  const fullText = bodyLines.map(l => l.text).join("\n");

  // --- ABCD detection ---
  const abcdPat = /^\s*[A-D]\s*[-.)]\s+\w/m;
  const hasABCD = abcdPat.test(fullText);

  // --- numbered question detection ---
  const qLines = bodyLines.filter(l => isQuestionLikeLine(l.text));
  const questionCount = qLines.length;

  // --- option detection ---
  const optLines = bodyLines.filter(l => /^\s*[A-D]\s*[-.)]\s+\w/.test(l.text));
  const optionCount = optLines.length;

  // --- blank/gap detection (underscore runs) ---
  const hasBlanks = /_{4,}/.test(fullText) ||
    bodyLines.some(l => (l.text.match(/_/g) || []).length >= 4);

  // --- answer-line detection (line is predominantly underscores) ---
  // Standalone answer lines look like "______________________________"
  // Fill-in-blank lines look like "1. The cat sat on the _______."
  // Distinguish by underscore-to-nonspace-char ratio (must be >= 0.50)
  const answerLineCount = bodyLines.filter(l => {
    const u     = (l.text.match(/_/g) || []).length;
    const nonWS = (l.text.match(/\S/g) || []).length;
    const ratio = nonWS > 0 ? u / nonWS : 0;
    return u >= 6 && ratio >= 0.50 && l.text.trim().length < 80;
  }).length;
  const hasAnswerLines = answerLineCount >= 2;

  // --- image candidates ---
  const hasImages = (sourceEvidence?.visualEvidence?.imageCandidates?.length || 0) > 0;

  // --- column detection from x-position distribution ---
  const bodyWords = words.filter(w => Number(w.bbox?.y ?? 0) < 0.88);
  const useLineColumnEvidence = textSelection.mode === "ocr-primary" &&
    Number(textSelection.diagnostics?.ocr?.avgConfidence ?? 1) < 0.75;
  const layoutItems = (!useLineColumnEvidence && bodyWords.length >= 20)
    ? bodyWords
    : bodyLines.filter(l => normalizeComparableText(l.text).replace(/\s+/g, "").length >= 8);
  const leftWords  = layoutItems.filter(w => Number(w.bbox?.x ?? 0) < 0.40);
  const rightWords = layoutItems.filter(w => Number(w.bbox?.x ?? 0) > 0.55);
  const leftChars = leftWords.reduce((sum, item) => sum + normalizeComparableText(item.text).replace(/\s+/g, "").length, 0);
  const rightChars = rightWords.reduce((sum, item) => sum + normalizeComparableText(item.text).replace(/\s+/g, "").length, 0);
  const minColumnItems = useLineColumnEvidence ? 4 : 8;
  const bothPresent = leftWords.length >= minColumnItems &&
    rightWords.length >= minColumnItems &&
    rightChars >= Math.max(40, leftChars * 0.25);
  const columnCount = bothPresent ? 2 : 1;

  // --- paragraph count ---
  const paragraphCount = blocks.filter(b => b.blocktype === "FLOWING_TEXT" && b.text?.length > 50).length ||
    bodyLines.filter(l => l.text?.length > 40 && !/^\s*(?:\d{1,3}\s*[-.)]?|[A-D]\s*[-.)])\s+/i.test(l.text)).length;

  // --- page type classification ---
  let pageType = "article";
  if (hasABCD && (questionCount >= 1 || optionCount >= 2)) {
    pageType = "questions-abcd";
  } else if (hasAnswerLines && questionCount >= 1) {
    pageType = "answer-lines";
  } else if (hasBlanks && questionCount >= 1) {
    pageType = "fill-in-blank";
  } else if (hasImages && paragraphCount >= 2) {
    pageType = "mixed-image-text";
  } else if (columnCount === 2 && paragraphCount >= 2) {
    pageType = "two-column-article";
  } else if (paragraphCount >= 3) {
    pageType = "article";
  }

  const confidence = (questionCount + optionCount + paragraphCount > 5) ? "high" : "medium";

  return {
    pageType, columnCount, hasABCD, hasBlanks, hasAnswerLines,
    hasImages, questionCount, optionCount, paragraphCount,
    answerLineCount, confidence,
    textSelection: textSelection.diagnostics,
  };
}

function normalizeEvidenceLines(lines = [], sourceKind = "text") {
  return (Array.isArray(lines) ? lines : [])
    .filter(line => String(line?.text || "").trim())
    .map(line => ({
      ...line,
      text: String(line.text || "").trim(),
      evidenceKind: line.evidenceKind || line.kind || sourceKind,
      confidence: confidence01(line.confidence),
    }));
}

function assessTextSource(lines = []) {
  const body = lines.filter(line => Number(line.bbox?.y ?? 0) < 0.90);
  const text = body.map(line => line.text || "").join("\n");
  const confidenceValues = body.map(line => Number(line.confidence)).filter(Number.isFinite);
  const avgConfidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : (lines.length ? 1 : 0);
  const questionCount = body.filter(line => isQuestionLikeLine(line.text || "")).length;
  const optionCount = body.filter(line => /^\s*[A-D]\s*[-.)]\s+\w/i.test(line.text || "")).length;
  const gapCount = body.filter(line => /_{4,}/.test(line.text || "")).length;
  const answerLineCount = body.filter(line => isMostlyAnswerLineText(line.text)).length;
  return {
    lineCount: body.length,
    totalLineCount: lines.length,
    charCount: text.replace(/\s+/g, "").length,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    questionCount,
    optionCount,
    gapCount,
    answerLineCount,
    markerCount: questionCount + optionCount + gapCount + answerLineCount,
    avgConfidence: round3(avgConfidence),
  };
}

function estimateSourceOverlap(pdfLines = [], ocrLines = []) {
  if (!pdfLines.length || !ocrLines.length) {
    return { pdfCoveredByOcr: 0, ocrCoveredByPdf: 0, matchedPdfLines: 0, matchedOcrLines: 0 };
  }
  const pdfMatched = pdfLines.filter(pdf => ocrLines.some(ocr => evidenceLinesEquivalent(pdf, ocr))).length;
  const ocrMatched = ocrLines.filter(ocr => pdfLines.some(pdf => evidenceLinesEquivalent(ocr, pdf))).length;
  return {
    pdfCoveredByOcr: round3(pdfMatched / pdfLines.length),
    ocrCoveredByPdf: round3(ocrMatched / ocrLines.length),
    matchedPdfLines: pdfMatched,
    matchedOcrLines: ocrMatched,
  };
}

function reconcilePdfAndOcrLines(pdfLines = [], ocrLines = []) {
  const reconciled = [...pdfLines];
  for (const ocrLine of ocrLines) {
    const alreadyRepresented = reconciled.some(line => evidenceLinesEquivalent(line, ocrLine));
    if (!alreadyRepresented) reconciled.push(ocrLine);
  }
  return sortEvidenceLines(reconciled);
}

function evidenceLinesEquivalent(a, b) {
  const sim = textSimilarity(a?.text || "", b?.text || "");
  if (sim >= 0.72) return true;
  const overlap = bboxOverlapRatio(a?.bbox, b?.bbox);
  return overlap >= 0.35 && sim >= 0.55;
}

function sortEvidenceLines(lines = []) {
  return [...lines].sort((a, b) => {
    const ay = Number(a.bbox?.y ?? 0);
    const by = Number(b.bbox?.y ?? 0);
    if (Math.abs(ay - by) > 0.015) return ay - by;
    return Number(a.bbox?.x ?? 0) - Number(b.bbox?.x ?? 0);
  });
}

function summarizeTextSelection(selection) {
  return {
    ...selection.diagnostics,
    selectedLineIds: selection.diagnostics.selectedLineIds,
  };
}

function isMostlyAnswerLineText(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  const underscores = (trimmed.match(/_/g) || []).length;
  const nonSpace = (trimmed.match(/\S/g) || []).length;
  return underscores >= 6 && underscores / Math.max(1, nonSpace) >= 0.50;
}

function isQuestionLikeLine(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed || /NATIONELLT|\bNATION\b|PROV\s*\||ENGELSKA|DELPROV|VT\s*\d{4}|SEPTEMBER|SEPTEMPER|SEPTEN/i.test(trimmed)) {
    return false;
  }
  const numbered = trimmed.match(/^(\d{1,3})\s*([.)-])?\s+(.+)$/u);
  if (numbered) {
    const rest = numbered[3].trim();
    if (!rest) return false;
    if (/^(?:what|why|how|which|when|where|who|whose|do|does|did|is|are|was|were|can|could|would|should)\b/i.test(rest)) return true;
    if (/\?\s*$/u.test(rest)) return true;
    return Boolean(numbered[2]) &&
      /^[\p{L}"']/u.test(rest) &&
      rest.split(/\s+/).filter(Boolean).length >= 3;
  }
  return /\?\s*$/u.test(trimmed);
}

function normalizeComparableText(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textSimilarity(a = "", b = "") {
  const an = normalizeComparableText(a);
  const bn = normalizeComparableText(b);
  if (!an && !bn) return 1;
  if (!an || !bn) return 0;
  if (an === bn) return 1;
  if (an.includes(bn) || bn.includes(an)) {
    const short = Math.min(an.length, bn.length);
    const long = Math.max(an.length, bn.length);
    return Math.max(0.72, short / Math.max(1, long));
  }
  const aTokens = new Set(an.split(" ").filter(Boolean));
  const bTokens = new Set(bn.split(" ").filter(Boolean));
  const intersection = [...aTokens].filter(token => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union ? intersection / union : 0;
}

function bboxOverlapRatio(a, b) {
  if (!a || !b) return 0;
  const ax1 = Number(a.x ?? 0);
  const ay1 = Number(a.y ?? 0);
  const ax2 = ax1 + Number(a.width ?? 0);
  const ay2 = ay1 + Number(a.height ?? 0);
  const bx1 = Number(b.x ?? 0);
  const by1 = Number(b.y ?? 0);
  const bx2 = bx1 + Number(b.width ?? 0);
  const by2 = by1 + Number(b.height ?? 0);
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const inter = ix * iy;
  const minArea = Math.min(Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1),
                           Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1));
  return minArea > 0 ? inter / minArea : 0;
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter(value => typeof value === "string" && value.trim()).map(value => value.trim()))];
}

function round3(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

// ============================================================
// INTERNAL: BUILD EVIDENCE FROM TESSDATA
// ============================================================

/**
 * Shared helper: flatten tessData.blocks nested structure into ocrEvidence object.
 * Used by both buildEvidenceFromTessData and buildSourceEvidenceFromPdfPage.
 */
function buildOcrEvidenceFromTessData(tessData, pw, ph) {
  const flatWords  = [];
  const flatLines  = [];
  const flatBlocks = [];
  const imageCands = [];

  let wIdx = 0, lIdx = 0, bIdx = 0;

  const addWord = (word, lineId = "", blockId = "") => {
    const wText = (word?.text || "").trim();
    if (!wText) return null;
    const bbox = normaliseBbox(word.bbox || word, pw, ph);
    const item = {
      id:         `w${wIdx++}`,
      kind:       "ocr-word",
      text:       wText,
      confidence: confidence01(word.confidence),
      bbox,
      source:     "tesseract.js",
      lineId,
      blockId,
    };
    flatWords.push(item);
    return item;
  };

  const addLine = (line, words = [], blockId = "") => {
    const lineText = (line?.text || words.map(w => w.text).join(" ") || "").trim().replace(/\n/g, " ");
    if (!lineText) return null;
    const wordItems = words
      .map(word => ({
        id: word.id,
        text: word.text,
        confidence: word.confidence,
        bbox: word.bbox,
      }))
      .filter(word => word.text);
    const bbox = normaliseBbox(line.bbox || line, pw, ph) || mergeNormalizedBboxes(wordItems.map(word => word.bbox));
    const item = {
      id:         `l${lIdx++}`,
      kind:       "ocr-line",
      text:       lineText,
      confidence: confidence01(line.confidence, words),
      bbox,
      words:      wordItems,
      source:     "tesseract.js",
      blockId,
    };
    flatLines.push(item);
    return item;
  };

  for (const block of (tessData.blocks || [])) {
    if (!block.text?.trim()) continue;

    const blockBbox = normaliseBbox(block.bbox, pw, ph);
    const blockType = block.blocktype ?? "FLOWING_TEXT";
    const hasTextStructure = Boolean((block.paragraphs || []).length || (block.lines || []).length);
    const isFlowingText = blockType === "FLOWING_TEXT" || blockType === 0 || blockType === "0" || hasTextStructure;

    if (!isFlowingText) {
      imageCands.push({
        id:        `img-cand-${imageCands.length}`,
        kind:      "image-candidate",
        blocktype: blockType,
        bbox:      blockBbox,
        source:    "tesseract.js-layout",
        confidence: confidence01(block.confidence),
      });
      continue;
    }

    const blockId = `b${bIdx++}`;
    flatBlocks.push({
      id:         blockId,
      kind:       "ocr-block",
      text:       block.text.trim().replace(/\n/g, " "),
      confidence: confidence01(block.confidence),
      blocktype:  blockType,
      bbox:       blockBbox,
      source:     "tesseract.js",
    });

    for (const para of (block.paragraphs || [])) {
      for (const line of (para.lines || [])) {
        const lineWords = [];
        for (const word of (line.words || [])) {
          const item = addWord(word, "", blockId);
          if (item) lineWords.push(item);
        }

        const lineItem = addLine(line, lineWords, blockId);
        if (lineItem) {
          for (const word of lineWords) word.lineId = lineItem.id;
        }
      }
    }
  }

  // Tesseract.js versions differ: some expose data.lines/data.words directly
  // without nested block/paragraph structures. Consume those before falling
  // back to raw text-only OCR.
  if (!flatLines.length && Array.isArray(tessData.lines)) {
    for (const line of tessData.lines) {
      const lineWords = [];
      for (const word of (line.words || [])) {
        const item = addWord(word);
        if (item) lineWords.push(item);
      }
      const lineItem = addLine(line, lineWords);
      if (lineItem) {
        for (const word of lineWords) word.lineId = lineItem.id;
      }
    }
  }

  if (!flatWords.length && Array.isArray(tessData.words)) {
    const directWords = tessData.words
      .map(word => addWord(word))
      .filter(Boolean);
    if (directWords.length && !flatLines.length) {
      synthesizeLinesFromWords(directWords, pw, ph).forEach(group => {
        const lineItem = addLine({ text: group.map(w => w.text).join(" "), bbox: mergeNormalizedBboxes(group.map(w => w.bbox)) }, group);
        if (lineItem) {
          for (const word of group) word.lineId = lineItem.id;
        }
      });
    }
  }

  if (!flatLines.length && tessData.text?.trim()) {
    const rawLines = tessData.text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    rawLines.forEach((text, index) => {
      flatLines.push({
        id:         `l${lIdx++}`,
        kind:       "ocr-line",
        text,
        confidence: confidence01(tessData.confidence),
        bbox:       estimatedLineBbox(index, rawLines.length),
        words:      [],
        source:     "tesseract.js-text-fallback",
        bboxEstimated: true,
      });
    });
  }

  return {
    blocks:         flatBlocks,
    lines:          flatLines,
    words:          flatWords,
    imageCandidates: imageCands,
  };
}

function buildEvidenceFromTessData(tessData, imagePath) {
  // Determine page dimensions from tessData or from block extents
  let pw = tessData.width  || 0;
  let ph = tessData.height || 0;
  if (pw === 0 || ph === 0) {
    let maxX = 0, maxY = 0;
    for (const b of (tessData.blocks || [])) {
      if (b.bbox) {
        maxX = Math.max(maxX, b.bbox.x1 || 0);
        maxY = Math.max(maxY, b.bbox.y1 || 0);
      }
    }
    pw = maxX > 0 ? maxX * 1.02 : 1;
    ph = maxY > 0 ? maxY * 1.02 : 1;
  }
  if (pw < 1) pw = 1;
  if (ph < 1) ph = 1;

  const ocr = buildOcrEvidenceFromTessData(tessData, pw, ph);

  return {
    schemaVersion:    "source-evidence/v1",
    sourceType:       "photographed-image",
    sourcePath:       imagePath,
    pageWidth:        pw,
    pageHeight:       ph,
    ocrEngine:        "tesseract.js",
    ocrConfidence:    (tessData.confidence ?? 0) / 100,
    visualEvidence: {
      imageCandidates:  ocr.imageCandidates,
      graphicCandidates: [],
      regions:           [],
    },
    ocrEvidence: {
      blocks: ocr.blocks,
      lines:  ocr.lines,
      words:  ocr.words,
    },
    pdfTextEvidence: [],
  };
}

function normaliseBbox(bbox, pw, ph) {
  if (!bbox) return null;
  const rawX0 = bbox.x0 ?? bbox.left ?? bbox.x ?? 0;
  const rawY0 = bbox.y0 ?? bbox.top ?? bbox.y ?? 0;
  const rawX1 = bbox.x1 ?? bbox.right ?? ((bbox.x0 ?? bbox.left ?? bbox.x ?? 0) + (bbox.width ?? 0));
  const rawY1 = bbox.y1 ?? bbox.bottom ?? ((bbox.y0 ?? bbox.top ?? bbox.y ?? 0) + (bbox.height ?? 0));
  const x0 = rawX0 / pw;
  const y0 = rawY0 / ph;
  const x1 = rawX1 / pw;
  const y1 = rawY1 / ph;
  return {
    x:      x0,
    y:      y0,
    width:  Math.max(0, x1 - x0),
    height: Math.max(0, y1 - y0),
    // Raw pixel coords preserved for debugging
    x0: rawX0,
    y0: rawY0,
    x1: rawX1,
    y1: rawY1,
    coordinateSpace: "source-document-plane-normalized",
  };
}

function confidence01(value, children = []) {
  if (Number.isFinite(Number(value))) {
    const n = Number(value);
    return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
  }
  const childValues = (children || []).map(item => Number(item.confidence)).filter(Number.isFinite);
  if (childValues.length) {
    return Math.max(0, Math.min(1, childValues.reduce((a, b) => a + b, 0) / childValues.length));
  }
  return 0;
}

function mergeNormalizedBboxes(bboxes) {
  const valid = (bboxes || []).filter(Boolean);
  if (!valid.length) return null;
  const x0 = Math.min(...valid.map(b => Number(b.x) || 0));
  const y0 = Math.min(...valid.map(b => Number(b.y) || 0));
  const x1 = Math.max(...valid.map(b => (Number(b.x) || 0) + (Number(b.width) || 0)));
  const y1 = Math.max(...valid.map(b => (Number(b.y) || 0) + (Number(b.height) || 0)));
  return {
    x: x0,
    y: y0,
    width: Math.max(0.0001, x1 - x0),
    height: Math.max(0.0001, y1 - y0),
    coordinateSpace: "source-document-plane-normalized",
  };
}

function synthesizeLinesFromWords(words) {
  const sorted = [...words].filter(w => w.bbox).sort((a, b) => {
    const dy = Number(a.bbox.y) - Number(b.bbox.y);
    if (Math.abs(dy) > 0.01) return dy;
    return Number(a.bbox.x) - Number(b.bbox.x);
  });
  const groups = [];
  for (const word of sorted) {
    const last = groups[groups.length - 1];
    if (!last?.length) {
      groups.push([word]);
      continue;
    }
    const prev = last[last.length - 1];
    const yDiff = Math.abs(Number(word.bbox.y) - Number(prev.bbox.y));
    if (yDiff > 0.012) groups.push([word]);
    else last.push(word);
  }
  return groups;
}

function estimatedLineBbox(index, total) {
  const top = 0.08 + (Math.max(0, index) / Math.max(1, total)) * 0.84;
  return {
    x: 0.08,
    y: Math.min(0.94, top),
    width: 0.84,
    height: Math.max(0.012, Math.min(0.03, 0.84 / Math.max(8, total))),
    coordinateSpace: "source-document-plane-normalized",
  };
}
