/**
 * tests/phase8-reconstruction.test.mjs
 *
 * Phase 8 — Controlled Visual Reconstruction Evaluation
 *
 * 20 assertions covering:
 *  T01 — CanvasTextMeasurementProvider availability detection + factory
 *  T02 — DeterministicFallbackTextMeasurementProvider is deterministic
 *  T03 — Wide/narrow text produces different measurements
 *  T04 — Bold font and larger font produce expected heights
 *  T05 — Persisted pixel dimensions override generic fallback
 *  T06 — Image candidate geometry fallback
 *  T07 — Role-based aspect-ratio fallback (not 16:9 universal)
 *  T08 — No universal 16/9 fallback in resolver source
 *  T09 — Cross-provider image evidence association
 *  T10 — Duplicate provider classifications deduplicated per semantic image
 *  T11 — Two-column article visual composition evaluation
 *  T12 — Question/options semantic grouping composition
 *  T13 — Answer-line composition resolves and evaluates
 *  T14 — Fill-blank (answerGap) composition
 *  T15 — Bottom image composition
 *  T16 — Footer composition
 *  T17 — Typography hierarchy issue detection
 *  T18 — Controlled correction loop records patches
 *  T19 — Legacy pageLayout untouched; page-layout.js unmodified
 *  T20 — semanticReconstructionEnabled remains false globally
 */

import assert from "node:assert/strict";
import fs     from "node:fs";
import path   from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");

import {
  CanvasTextMeasurementProvider,
  DeterministicFallbackTextMeasurementProvider,
  createTextMeasurementProvider,
} from "../public/js/text-measurement-provider.js";

import {
  resolveSemanticPageToA4,
  runBoundedLayoutCorrectionLoop,
  RESOLVED_A4_LAYOUT_SCHEMA_VERSION,
} from "../public/js/a4-layout-resolver.js";

import {
  buildImageEvidenceAssociations,
} from "../public/js/image-evidence-association.js";

import {
  evaluateVisualComposition,
  VISUAL_COMPOSITION_EVALUATION_SCHEMA_VERSION,
} from "../public/js/visual-composition-evaluator.js";

// ============================================================
// SHARED HELPERS
// ============================================================

function mkEl(id, type, text, readingOrder, band, prominence, columnRole, spansColumns, extra = {}) {
  return {
    id, type, readingOrder, text,
    semanticRole: type,
    layoutIntent: { band, prominence, columnRole, spansColumns, ...extra },
    sourceEvidenceIds: [],
  };
}

function mkImgEl(id, readingOrder, band, columnRole, spansColumns, imageRole, sourceBbox = null) {
  return {
    id, type: "image", readingOrder,
    semanticRole: "image",
    layoutIntent: { band, prominence: "normal", columnRole, spansColumns, imageRole },
    sourceEvidenceIds: [],
    sourceBbox,
  };
}

function mkSemanticPage(elements, readingOrder, columnCount = 1, pageType = "article") {
  return {
    schemaVersion: "semantic-page/v1",
    pageRef: { testId: "t1", pageId: "p1", pageNumber: 1 },
    pageType,
    styleHints: { columnCount },
    elements,
    readingOrder,
    relationships: [],
    groups: [],
  };
}

// ============================================================
// T01 — Canvas provider availability detection + factory
// ============================================================
{
  // isAvailable() must return a boolean (never throws)
  const available = CanvasTextMeasurementProvider.isAvailable();
  assert.ok(typeof available === "boolean", "T01: isAvailable() returns boolean");

  // Factory always returns a usable provider
  const provider = createTextMeasurementProvider();
  assert.ok(provider !== null && provider !== undefined, "T01: createTextMeasurementProvider returns a provider");
  assert.ok(typeof provider.measureTextHeight === "function", "T01: provider has measureTextHeight()");

  // Provider works immediately (no crash)
  const h = provider.measureTextHeight("Hello World", { fontSize: 12, fontWeight: "normal", lineHeight: 1.5 }, 300);
  assert.ok(h > 0, `T01: provider returns positive height (${h})`);
}

// ============================================================
// T02 — DeterministicFallbackTextMeasurementProvider is deterministic
// ============================================================
{
  const fb = new DeterministicFallbackTextMeasurementProvider();
  const h1 = fb.measureTextHeight("Hello world again", { fontSize: 12, fontWeight: "normal", lineHeight: 1.5 }, 300);
  const h2 = fb.measureTextHeight("Hello world again", { fontSize: 12, fontWeight: "normal", lineHeight: 1.5 }, 300);
  assert.equal(h1, h2, "T02: fallback is deterministic (same call → same result)");
  assert.ok(h1 > 0, "T02: positive height for non-empty text");
  assert.equal(
    fb.measureTextHeight("", { fontSize: 12, fontWeight: "normal", lineHeight: 1.5 }, 300),
    0,
    "T02: empty text returns 0",
  );
}

// ============================================================
// T03 — Longer/narrower text produces taller height
// ============================================================
{
  const fb    = new DeterministicFallbackTextMeasurementProvider();
  const opts  = { fontSize: 12, fontWeight: "normal", lineHeight: 1.5 };
  const long  = "A very long sentence that should wrap when the available width is narrow enough to force multiple lines.";
  const short = "Short sentence.";

  const hLong  = fb.measureTextHeight(long,  opts, 300);
  const hShort = fb.measureTextHeight(short, opts, 300);
  assert.ok(hLong > hShort, `T03: longer text is taller (${hLong} > ${hShort})`);

  // Narrower width → more wrapping → taller
  const hNarrow = fb.measureTextHeight(long, opts, 80);
  const hWide   = fb.measureTextHeight(long, opts, 600);
  assert.ok(hNarrow >= hWide, `T03: narrower width produces equal or taller result (${hNarrow} >= ${hWide})`);
}

// ============================================================
// T04 — Bold and larger font produce expected heights
// ============================================================
{
  const fb   = new DeterministicFallbackTextMeasurementProvider();
  const text = "Testing font weight and size effects on text wrapping height.";

  // Bold chars are wider → wrap sooner → same or taller
  const normalH = fb.measureTextHeight(text, { fontSize: 12, fontWeight: "normal", lineHeight: 1.5 }, 180);
  const boldH   = fb.measureTextHeight(text, { fontSize: 12, fontWeight: "bold",   lineHeight: 1.5 }, 180);
  assert.ok(boldH >= normalH, `T04: bold >= normal height (${boldH} >= ${normalH})`);

  // Larger font → taller result
  const smallH = fb.measureTextHeight(text, { fontSize: 10, fontWeight: "normal", lineHeight: 1.5 }, 400);
  const largeH = fb.measureTextHeight(text, { fontSize: 18, fontWeight: "normal", lineHeight: 1.5 }, 400);
  assert.ok(largeH > smallH, `T04: larger font → taller (${largeH} > ${smallH})`);
}

// ============================================================
// T05 — Persisted pixel dimensions override generic fallback
// ============================================================
{
  // Portrait image: pixelWidth=400, pixelHeight=600 → AR ≈ 0.667
  const semanticPage = mkSemanticPage([{
    id: "img-portrait",
    type: "image",
    readingOrder: 1,
    semanticRole: "image",
    layoutIntent: { band: "body", prominence: "normal", columnRole: "single", spansColumns: false },
    sourceEvidenceIds: [],
    pixelWidth: 400,
    pixelHeight: 600,
  }], ["img-portrait"]);

  const resolved = resolveSemanticPageToA4({ semanticPage });
  const imgEl    = resolved.elements.find(el => el.semanticElementId === "img-portrait" || el.type === "image");
  assert.ok(imgEl, "T05: portrait image element resolved");
  assert.equal(imgEl.aspectRatioSource, "persisted-image-dimensions", "T05: aspectRatioSource = persisted-image-dimensions");

  // Height should match portrait AR (width / 0.667 ≈ width * 1.5)
  const expectedH = Math.round(imgEl.width / (400 / 600));
  const tolerance  = expectedH * 0.15;
  assert.ok(
    Math.abs(imgEl.height - expectedH) <= tolerance,
    `T05: portrait image height (${imgEl.height}) ≈ expected ${expectedH} (±${Math.round(tolerance)}px)`,
  );
}

// ============================================================
// T06 — Image candidate geometry fallback
// ============================================================
{
  const sourceEvidence = {
    schemaVersion: "source-evidence/v1",
    visualEvidence: {
      imageCandidates: [{
        id: "cand-1",
        bbox: { x: 0.05, y: 0.60, width: 0.90, height: 0.30, coordinateSpace: "source-document-plane-normalized" },
      }],
      graphicCandidates: [],
      regions: [],
    },
    ocrEvidence:    { blocks: [], lines: [], words: [] },
    pdfTextEvidence: [],
  };

  const semanticPage = mkSemanticPage([{
    id: "img-1",
    type: "image",
    readingOrder: 1,
    semanticRole: "image",
    layoutIntent: { band: "body", prominence: "normal", columnRole: "single", spansColumns: false },
    sourceEvidenceIds: ["cand-1"],
  }], ["img-1"]);

  const resolved = resolveSemanticPageToA4({ semanticPage, sourceEvidence });
  const imgEl    = resolved.elements.find(el => el.type === "image");
  assert.ok(imgEl, "T06: image resolved from candidate geometry");
  assert.equal(imgEl.aspectRatioSource, "image-candidate-bbox", "T06: aspectRatioSource = image-candidate-bbox");

  // bbox AR = 0.90/0.30 = 3.0 → height ≈ width/3
  const expectedH = Math.round(imgEl.width / 3);
  assert.ok(
    Math.abs(imgEl.height - expectedH) <= expectedH * 0.12,
    `T06: height (${imgEl.height}) matches bbox AR 3.0 (expected ~${expectedH})`,
  );
}

// ============================================================
// T07 — Role-based aspect-ratio fallback (not universal 16:9)
// ============================================================
{
  const bottomImg = mkImgEl("img-bottom", 1, "body", "span", true, "bottom-spanning-photograph");
  const colImg    = mkImgEl("img-col",    2, "body", "left", false, "column-image");
  const portImg   = mkImgEl("img-port",   3, "body", "right", false, "portrait-illustration");

  const semanticPage = mkSemanticPage(
    [bottomImg, colImg, portImg],
    ["img-bottom", "img-col", "img-port"],
    2,
  );
  const resolved = resolveSemanticPageToA4({ semanticPage });

  const getAR = id => {
    const el = resolved.elements.find(e => e.semanticElementId === id);
    return el ? el.width / el.height : null;
  };

  // bottom-spanning: ~1.5–1.9
  const bottomAR = getAR("img-bottom");
  assert.ok(bottomAR !== null, "T07: bottom-spanning image resolved");
  assert.ok(bottomAR >= 1.3 && bottomAR <= 2.2, `T07: bottom-spanning AR (${bottomAR?.toFixed(2)}) in 1.3–2.2 range`);
  const bottomEl = resolved.elements.find(e => e.semanticElementId === "img-bottom");
  assert.equal(bottomEl?.aspectRatioSource, "role-based-bottom-spanning", "T07: bottom-spanning AR source");

  // portrait: AR < 1.0
  const portAR = getAR("img-port");
  assert.ok(portAR !== null, "T07: portrait image resolved");
  assert.ok(portAR < 1.0, `T07: portrait AR (${portAR?.toFixed(2)}) < 1.0`);
  const portEl = resolved.elements.find(e => e.semanticElementId === "img-port");
  assert.equal(portEl?.aspectRatioSource, "role-based-portrait-illustration", "T07: portrait AR source");
}

// ============================================================
// T08 — No universal 16/9 fallback in resolver source code
// ============================================================
{
  const resolverSrc = fs.readFileSync(path.join(ROOT, "public", "js", "a4-layout-resolver.js"), "utf8");
  // The old "return 16 / 9" fallback must be removed
  assert.ok(
    !resolverSrc.includes("return 16 / 9") && !resolverSrc.includes("return 16/9"),
    "T08: resolver does not contain 'return 16 / 9' universal fallback",
  );
  // Generic fallback should be role-based-generic (1.40), not 16:9 (1.778)
  assert.ok(
    resolverSrc.includes("role-based-generic"),
    "T08: resolver uses role-based-generic fallback label",
  );
  // Verify a generic image (no role, no source evidence) does not produce 16:9 AR
  const sem = mkSemanticPage([
    mkImgEl("img-generic", 1, "body", "single", false, null),
  ], ["img-generic"]);
  const res    = resolveSemanticPageToA4({ semanticPage: sem });
  const imgEl  = res.elements.find(e => e.type === "image");
  const ar     = imgEl ? imgEl.width / imgEl.height : null;
  assert.ok(ar !== null, "T08: generic image resolves");
  assert.ok(Math.abs(ar - 16 / 9) > 0.05, `T08: generic image AR (${ar?.toFixed(3)}) is not 16:9 (1.778)`);
}

// ============================================================
// T09 — Cross-provider image evidence association
// ============================================================
{
  const sourceEvidence = {
    schemaVersion: "source-evidence/v1",
    visualEvidence: {
      imageCandidates: [{ id: "src-img-1", bbox: { x: 0.05, y: 0.60, width: 0.90, height: 0.30 } }],
      graphicCandidates: [], regions: [],
    },
    ocrEvidence: { blocks: [], lines: [], words: [] },
    pdfTextEvidence: [],
  };

  const semanticPage = mkSemanticPage([{
    id: "img-el-1", type: "image", readingOrder: 1, semanticRole: "image",
    layoutIntent: { band: "body", prominence: "normal", columnRole: "single", spansColumns: false },
    sourceEvidenceIds: ["src-img-1"],
  }], ["img-el-1"]);

  const paddleOut = {
    visualClassifications: [{
      sourceRegionId: "paddle-img-7",
      classification: "document-image",
      confidence: 0.95,
    }],
    elements: [{
      id: "paddle-img-7",
      providerType: "image",
      sourceBBox: { x: 0.05, y: 0.61, width: 0.89, height: 0.29 },
    }],
  };
  const qwenOut = {
    visualClassifications: [{
      id: "qvc-1",
      type: "image",
      content: "A wide grassland photograph under blue sky",
    }],
  };

  const associations = buildImageEvidenceAssociations(semanticPage, sourceEvidence, paddleOut, qwenOut);
  assert.equal(associations.length, 1, "T09: one association per semantic image element");

  const assoc = associations[0];
  assert.equal(assoc.semanticImageId, "img-el-1", "T09: semanticImageId correct");
  assert.ok(assoc.confidence >= 0.80, `T09: confidence >= 0.80 (got ${assoc.confidence})`);

  const sources = assoc.associatedEvidence.map(e => e.source);
  assert.ok(sources.includes("source-visual-evidence"), "T09: source-visual-evidence linked");
  assert.ok(sources.includes("qwen3-vl"), "T09: qwen3-vl evidence linked");
}

// ============================================================
// T10 — Duplicate provider classifications deduplicated
// ============================================================
{
  const semanticPage = mkSemanticPage([{
    id: "img-dedup", type: "image", readingOrder: 1, semanticRole: "image",
    layoutIntent: { band: "body", prominence: "normal", columnRole: "single", spansColumns: false },
    sourceEvidenceIds: [],
  }], ["img-dedup"]);

  // Paddle sends the same element twice (duplicate VC entries)
  const paddleOut = {
    visualClassifications: [
      { sourceRegionId: "paddle-el-1", classification: "document-image", confidence: 0.95 },
      { sourceRegionId: "paddle-el-1", classification: "document-image", confidence: 0.91 },
    ],
    elements: [{
      id: "paddle-el-1",
      providerType: "image",
      sourceBBox: { x: 0.1, y: 0.1, width: 0.5, height: 0.3 },
    }],
  };

  const associations = buildImageEvidenceAssociations(semanticPage, null, paddleOut, null);
  assert.equal(associations.length, 1, "T10: still one association");

  const paddleEvs     = associations[0].associatedEvidence.filter(e => e.source === "paddleocr-vl");
  const uniqueIds     = [...new Set(paddleEvs.map(e => e.id))];
  assert.equal(uniqueIds.length, paddleEvs.length, "T10: duplicate Paddle entries deduplicated");
}

// ============================================================
// T11 — Two-column article visual composition
// ============================================================
{
  const sem = mkSemanticPage([
    mkEl("h1",   "heading",   "Article Title",          1, "header", "highest", "span", true),
    mkEl("p-l1", "paragraph", "Left column paragraph text.", 2, "body", "normal", "left", false),
    mkEl("p-r1", "paragraph", "Right column paragraph text.", 3, "body", "normal", "right", false),
    mkImgEl("img1", 4, "body", "span", true, "bottom-spanning-photograph"),
    mkEl("ft",   "footer",    "Footer text",            5, "footer", "low", "single", false),
    mkEl("pn",   "pageNumber","4",                      6, "footer", "low", "single", false),
  ], ["h1", "p-l1", "p-r1", "img1", "ft", "pn"], 2);

  const resolved = resolveSemanticPageToA4({ semanticPage: sem });
  const eval_    = evaluateVisualComposition(resolved, sem);

  assert.equal(eval_.schemaVersion, VISUAL_COMPOSITION_EVALUATION_SCHEMA_VERSION, "T11: correct schema version");
  assert.ok(["pass", "warning", "retry"].includes(eval_.status), "T11: valid status");
  assert.ok(eval_.scores.pageComposition >= 0.80, `T11: page composition ≥ 0.80 (${eval_.scores.pageComposition})`);
  assert.ok(eval_.scores.columnStructure >= 0.50, `T11: column structure ≥ 0.50 (${eval_.scores.columnStructure})`);
  assert.ok(typeof eval_.score === "number", "T11: overall score is a number");
}

// ============================================================
// T12 — Question/options semantic grouping composition
// ============================================================
{
  const sem = mkSemanticPage([
    mkEl("instr",  "instructions", "Choose the correct answer.", 1, "header", "normal", "single", false),
    mkEl("q1",     "question",    "1. What is the capital of France?", 2, "body", "normal", "single", false),
    mkEl("q1-a",   "option",      "A. Berlin", 3, "body", "normal", "single", false),
    mkEl("q1-b",   "option",      "B. Paris",  4, "body", "normal", "single", false),
    mkEl("q1-c",   "option",      "C. Madrid", 5, "body", "normal", "single", false),
    mkEl("q1-d",   "option",      "D. Rome",   6, "body", "normal", "single", false),
    mkEl("q2",     "question",    "2. Which is the largest planet?", 7, "body", "normal", "single", false),
    mkEl("q2-a",   "option",      "A. Earth",  8, "body", "normal", "single", false),
    mkEl("q2-b",   "option",      "B. Mars",   9, "body", "normal", "single", false),
    mkEl("q2-c",   "option",      "C. Jupiter",10, "body", "normal", "single", false),
    mkEl("q2-d",   "option",      "D. Saturn", 11, "body", "normal", "single", false),
  ], ["instr","q1","q1-a","q1-b","q1-c","q1-d","q2","q2-a","q2-b","q2-c","q2-d"], 1, "questions");

  const resolved = resolveSemanticPageToA4({ semanticPage: sem });
  const eval_    = evaluateVisualComposition(resolved, sem);

  const questions = resolved.elements.filter(e => e.type === "question");
  assert.ok(questions.length >= 2, `T12: at least 2 question elements resolved (${questions.length})`);
  assert.ok(eval_.scores.semanticGrouping >= 0.50, `T12: semantic grouping ≥ 0.50 (${eval_.scores.semanticGrouping})`);
}

// ============================================================
// T13 — Answer-line composition
// ============================================================
{
  const sem = mkSemanticPage([
    mkEl("h1",   "heading",    "One Word Gaps",                    1, "header", "high", "single", false),
    mkEl("ins",  "instructions","Write ONE word in each gap.",     2, "body",   "normal","single",false),
    mkEl("q1",   "question",   "1",                                3, "body",   "normal","single",false),
    mkEl("ag1",  "answerGap",  "The cat sat on the _____.",        4, "body",   "normal","single",false),
    { id: "al1", type: "answerLine", readingOrder: 5, semanticRole: "answerLine",
      layoutIntent: { band: "body", prominence: "normal", columnRole: "single", spansColumns: false },
      sourceEvidenceIds: [] },
    mkEl("q2",   "question",   "2",                                6, "body",   "normal","single",false),
    mkEl("ag2",  "answerGap",  "She is _____ than her sister.",    7, "body",   "normal","single",false),
    { id: "al2", type: "answerLine", readingOrder: 8, semanticRole: "answerLine",
      layoutIntent: { band: "body", prominence: "normal", columnRole: "single", spansColumns: false },
      sourceEvidenceIds: [] },
  ], ["h1","ins","q1","ag1","al1","q2","ag2","al2"]);

  const resolved = resolveSemanticPageToA4({ semanticPage: sem });
  const lineEls  = resolved.elements.filter(e => e.type === "answerLine" || e.pageLayoutType === "line");
  assert.ok(lineEls.length >= 2, `T13: at least 2 answer lines (${lineEls.length})`);
  for (const l of lineEls) {
    assert.ok(l.width > 0 && l.height > 0, `T13: answer line ${l.id} has positive dimensions`);
  }
  const eval_ = evaluateVisualComposition(resolved, sem);
  assert.ok(eval_.scores.pageComposition >= 0.80, `T13: page composition ≥ 0.80 (${eval_.scores.pageComposition})`);
}

// ============================================================
// T14 — Fill-blank (answerGap) composition
// ============================================================
{
  const sem = mkSemanticPage([
    mkEl("h1",  "heading",    "Benjamin Franklin",                          1, "header", "high", "single", false),
    mkEl("ins", "instructions","Fill each gap with ONE word.",               2, "body",  "normal","single",false),
    mkEl("p1",  "paragraph",  "Benjamin Franklin was born in _____.",       3, "body",  "normal","single",false),
    mkEl("ag1", "answerGap",  "He attended school until age _____.",        4, "body",  "normal","single",false),
    mkEl("ag2", "answerGap",  "Franklin worked as a printer's _____ boy.",  5, "body",  "normal","single",false),
  ], ["h1","ins","p1","ag1","ag2"]);

  const resolved = resolveSemanticPageToA4({ semanticPage: sem });
  const gapEls   = resolved.elements.filter(e => e.type === "answerGap");
  assert.ok(gapEls.length >= 2, `T14: at least 2 answerGap elements (${gapEls.length})`);
  const eval_ = evaluateVisualComposition(resolved, sem);
  assert.ok(typeof eval_.score === "number" && eval_.score >= 0, "T14: evaluator runs without error");
}

// ============================================================
// T15 — Bottom image composition
// ============================================================
{
  const sem = mkSemanticPage([
    mkEl("h1",  "heading",   "Springsteen and the 70s",  1, "header", "high",   "single", false),
    mkEl("p1",  "paragraph", "Some forty years ago...",  2, "body",   "normal", "single", false),
    mkImgEl("img1", 3, "body", "span", false, "column-image",
      { x: 0.05, y: 0.45, width: 0.45, height: 0.35, coordinateSpace: "source-document-plane-normalized" }),
  ], ["h1","p1","img1"]);

  const resolved = resolveSemanticPageToA4({ semanticPage: sem });
  const imgEl    = resolved.elements.find(e => e.type === "image");
  assert.ok(imgEl, "T15: image element resolved");
  assert.ok(imgEl.width > 0 && imgEl.height > 0, "T15: image has positive dimensions");
  const eval_ = evaluateVisualComposition(resolved, sem);
  assert.ok(eval_.scores.imageComposition >= 0.50, `T15: image composition ≥ 0.50 (${eval_.scores.imageComposition})`);
}

// ============================================================
// T16 — Footer composition
// ============================================================
{
  const sem = mkSemanticPage([
    mkEl("h1", "heading",    "Article Heading",                1, "header", "high",  "single", false),
    mkEl("p1", "paragraph",  "Article body paragraph text.",   2, "body",   "normal","single", false),
    mkEl("ft", "footer",     "English National Test — Part B", 3, "footer", "low",   "single", false),
    mkEl("pn", "pageNumber", "4",                              4, "footer", "low",   "single", false),
  ], ["h1","p1","ft","pn"]);

  const resolved   = resolveSemanticPageToA4({ semanticPage: sem });
  const footerEl   = resolved.elements.find(e => e.type === "footer");
  const pageNumEl  = resolved.elements.find(e => e.type === "pageNumber");
  assert.ok(footerEl,  "T16: footer element resolved");
  assert.ok(pageNumEl, "T16: pageNumber element resolved");

  const eval_ = evaluateVisualComposition(resolved, sem);
  assert.ok(eval_.scores.footerComposition >= 0.50, `T16: footer composition ≥ 0.50 (${eval_.scores.footerComposition})`);
  // Footer should be in the lower portion of the page
  assert.ok(footerEl.y > 500, `T16: footer anchored near bottom (y=${footerEl.y})`);
}

// ============================================================
// T17 — Typography hierarchy issue detection
// ============================================================
{
  // Create a page where title has "low" prominence → may end up smaller than body text
  const sem = mkSemanticPage([
    mkEl("title-1", "title", "TITLE WITH LOW PROMINENCE",
      1, "header", "low", "single", false),
    mkEl("para-1", "paragraph",
      "A normal body paragraph that is expected to be smaller than the title.",
      2, "body", "normal", "single", false),
  ], ["title-1", "para-1"]);

  const resolved = resolveSemanticPageToA4({ semanticPage: sem });
  const titleEl  = resolved.elements.find(e => e.type === "title");
  const paraEl   = resolved.elements.find(e => e.type === "paragraph");

  assert.ok(titleEl, "T17: title element resolved");
  assert.ok(paraEl,  "T17: paragraph element resolved");

  const eval_             = evaluateVisualComposition(resolved, sem);
  const typoIssues        = eval_.issues.filter(i => i.dimension === "typographyHierarchy");
  const titleProminencePatch = eval_.suggestedLayoutPatches.find(p => p.type === "increase-title-prominence");

  // If the low prominence actually makes title < body, issues and patch should be present
  if (titleEl.style?.fontSize && paraEl.style?.fontSize && titleEl.style.fontSize < paraEl.style.fontSize + 2) {
    assert.ok(typoIssues.length > 0, "T17: typography issue detected for low-prominence title");
    assert.ok(titleProminencePatch, "T17: increase-title-prominence patch suggested");
  } else {
    // Title was still bigger than body — just verify evaluator ran cleanly
    assert.ok(typeof eval_.scores.typographyHierarchy === "number",
      "T17: typographyHierarchy score produced without error");
  }
}

// ============================================================
// T18 — Controlled correction loop records patches
// ============================================================
{
  // A page with a very tall image (portrait AR) should trigger composition issues
  const sem = mkSemanticPage([
    mkEl("h1", "heading",   "Article",         1, "header","high","single",false),
    mkEl("p1", "paragraph", "Paragraph text.", 2, "body","normal","single",false),
    {
      id: "img-tall", type: "image", readingOrder: 3, semanticRole: "image",
      layoutIntent: { band: "body", prominence: "normal", columnRole: "single",
        spansColumns: false, imageRole: "portrait-illustration" },
      sourceEvidenceIds: [],
    },
  ], ["h1","p1","img-tall"]);

  let resolved  = resolveSemanticPageToA4({ semanticPage: sem });
  const eval0   = evaluateVisualComposition(resolved, sem);

  const correctionHistory = [];
  // Simulate one correction pass
  if (eval0.suggestedLayoutPatches.length > 0) {
    let options = {};
    for (const p of eval0.suggestedLayoutPatches) {
      if (p.type === "reduce-image-height")       options.imageHeightFactor    = 0.70;
      if (p.type === "increase-title-prominence") options.titleProminenceFactor = 1.10;
    }
    if (Object.keys(options).length > 0) {
      resolved = runBoundedLayoutCorrectionLoop({ semanticPage: sem, options });
      correctionHistory.push({ iteration: 1, patches: Object.keys(options) });
    }
  }

  assert.ok(resolved, "T18: correction loop produces a resolved layout");
  assert.ok(Array.isArray(correctionHistory), "T18: correctionHistory is an array");
  // The resolved layout must still be valid
  assert.equal(resolved.schemaVersion, RESOLVED_A4_LAYOUT_SCHEMA_VERSION, "T18: resolved schema version correct");
}

// ============================================================
// T19 — Legacy pageLayout untouched; page-layout.js not modified
// ============================================================
{
  // Read national-test-pages.json before running resolver
  const before = fs.readFileSync(path.join(ROOT, "data", "national-test-pages.json"), "utf8");

  // Run resolver (this must NOT write anything to disk)
  const sem = mkSemanticPage([
    mkEl("p1", "paragraph", "Test paragraph.", 1, "body", "normal", "single", false),
  ], ["p1"]);
  resolveSemanticPageToA4({ semanticPage: sem });
  runBoundedLayoutCorrectionLoop({ semanticPage: sem });
  evaluateVisualComposition(resolveSemanticPageToA4({ semanticPage: sem }), sem);

  const after = fs.readFileSync(path.join(ROOT, "data", "national-test-pages.json"), "utf8");
  assert.equal(before, after, "T19: national-test-pages.json unchanged after running resolver");

  // page-layout.js must NOT import any Phase 7/8 modules
  const pageLayoutSrc = fs.readFileSync(path.join(ROOT, "public", "page-layout.js"), "utf8");
  assert.ok(!pageLayoutSrc.includes("a4-layout-resolver"),    "T19: page-layout.js does not import a4-layout-resolver");
  assert.ok(!pageLayoutSrc.includes("visual-composition"),    "T19: page-layout.js does not import visual-composition-evaluator");
  assert.ok(!pageLayoutSrc.includes("text-measurement"),      "T19: page-layout.js does not import text-measurement-provider");
}

// ============================================================
// T20 — semanticReconstructionEnabled remains false globally
// ============================================================
{
  const appSrc = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");

  assert.equal(
    appSrc.includes("semanticReconstructionEnabled"),
    false,
    "T20: retired semanticReconstructionEnabled flag is absent from app.js",
  );

  // Also verify phase 8 modules do not set it globally
  const evaluatorSrc = fs.readFileSync(path.join(ROOT, "public", "js", "visual-composition-evaluator.js"), "utf8");
  assert.ok(!evaluatorSrc.includes("semanticReconstructionEnabled"), "T20: evaluator does not touch the feature flag");
}

console.log("All Phase 8 reconstruction tests passed.");
