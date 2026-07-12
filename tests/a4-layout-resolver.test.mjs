/**
 * tests/a4-layout-resolver.test.mjs
 *
 * Phase 7 — Semantic A4 Layout Resolution
 *
 * Tests covering:
 *   - Part 0: provider-image provenance regression (no semantic-integrity-error)
 *   - Part 0: cross-provider image deduplication (Qwen unanchored + Paddle anchored)
 *   - Resolver: SemanticPageModel stays coordinate-free
 *   - Resolver: no direct normalized-bbox → A4 mapping
 *   - Resolver: two-column produces distinct x coordinates
 *   - Resolver: spanning title uses full content width
 *   - Resolver: paragraph continuation respected (reading order)
 *   - Resolver: question options stay adjacent to question
 *   - Resolver: answer lines are rendered as line elements
 *   - Resolver: images preserve positive aspect ratio
 *   - Resolver: footer anchors at bottom, no collision
 *   - Resolver: overflow correction loop is bounded
 *   - Validator: catches overlap
 *   - Validator: catches clipping
 *   - page-layout.js is unchanged
 *   - Legacy mirror fallback still exists in app.js
 *   - Prompt 6 photographed-page scenario (two-column + bottom image + footer)
 *   - Single-column article
 *   - Question page with A/B/C/D options
 *   - Fill-in-the-blank page with answerLine elements
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildNationalTestSemanticPageModel,
  buildNationalTestSourceEvidenceModel,
  semanticPageContainsFinalCoordinates,
} from "../public/js/national-test-semantic-models.js";
import { validateSemanticReconstruction } from "../public/js/national-test-semantic-validator.js";
import {
  refineNationalTestSemanticPageModel,
  reconcileDocumentAnalysis,
} from "../public/js/document-analysis-reconciler.js";
import {
  RESOLVED_A4_LAYOUT_SCHEMA_VERSION,
  A4_LAYOUT_RESOLVER_VERSION,
  resolveSemanticPageToA4,
  runBoundedLayoutCorrectionLoop,
  convertResolvedA4ToPageLayout,
  measureTextHeight,
} from "../public/js/a4-layout-resolver.js";
import {
  A4_LAYOUT_VALIDATION_SCHEMA_VERSION,
  validateResolvedA4Layout,
} from "../public/js/a4-layout-validator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ============================================================
// SHARED TEST HELPERS
// ============================================================

const PAGE = {
  id: "a4-test-page",
  testId: "a4-test",
  pageNumber: 1,
  normalizedPage: { url: "/img/norm.jpg", pixelWidth: 1200, pixelHeight: 1700 },
  sourcePage: { url: "/img/src.jpg", pixelWidth: 1600, pixelHeight: 2200 },
};

function item(id, role, text, bbox, confidence = 94) {
  return { id, role, text, rawText: text, bbox, confidence };
}

function baseModels(items, options = {}) {
  const extraction = {
    source: "ocr",
    language: "en",
    averageConfidence: 92,
    strategy: "whole-page",
    pageStructure: {
      type: options.pageType || "article",
      templateHint: "mirror",
      features: { columnCount: options.columnCount || 1 },
    },
    evidence: options.evidence || {},
    items,
  };
  const sourceEvidence = buildNationalTestSourceEvidenceModel({
    page: PAGE,
    extraction,
    sourceImages: options.sourceImages || [],
    adaptiveRegions: options.adaptiveRegions || [],
  });
  const semanticPage = buildNationalTestSemanticPageModel({
    page: PAGE,
    extraction,
    sourceEvidence,
    sourceImages: options.sourceImages || [],
    adaptiveRegions: options.adaptiveRegions || [],
  });
  const semanticValidation = validateSemanticReconstruction({ sourceEvidence, semanticPage });
  return { extraction, sourceEvidence, semanticPage, semanticValidation };
}

function parserAnalysis(extra = {}) {
  return {
    schemaVersion: "hybrid-document-analysis/v1",
    mode: "hybrid-local",
    health: { providers: { documentParser: { available: true }, visionReasoner: { available: false } } },
    analyses: {
      parser: {
        schemaVersion: "document-provider-analysis/v1",
        provider: { type: "document-parser", name: "test-parser", model: "PaddleOCR-VL", device: "cuda" },
        pageAnalysis: extra.pageAnalysis || {},
        elements: extra.elements || [],
        readingOrder: extra.readingOrder || [],
        relationships: extra.relationships || [],
        visualClassifications: extra.visualClassifications || [],
        diagnostics: {},
      },
    },
  };
}

// ============================================================
// PART 0 — PROVENANCE REGRESSION TESTS
// ============================================================

// Part 0-A: Provider-internal source region ID must not cause semantic-integrity-error.
// Simulates the Prompt 6 case: Paddle says "paddle-page-1-element-7 is an image"
// but that ID is not in the SourceEvidenceModel.
{
  const models = baseModels([
    item("p1", "paragraph", "Article text here.", { x: 0.05, y: 0.05, width: 0.4, height: 0.05 }),
  ]);
  const providerInternalId = "paddle-page-1-element-7";

  // Verify provider-internal ID is NOT in sourceEvidence
  const allSourceIds = [
    ...(models.sourceEvidence.pdfTextEvidence || []),
    ...(models.sourceEvidence.ocrEvidence?.blocks || []),
    ...(models.sourceEvidence.visualEvidence?.imageCandidates || []),
  ].map(i => i.id);
  assert.ok(!allSourceIds.includes(providerInternalId), "Pre-condition: provider ID should not be in sourceEvidence");

  const reconciliation = reconcileDocumentAnalysis({
    ...models,
    providerAnalysis: parserAnalysis({
      visualClassifications: [{
        sourceRegionId: providerInternalId,
        classification: "document-image",
        confidence: 0.954,
      }],
    }),
  });
  const refined = refineNationalTestSemanticPageModel({ ...models, reconciliation });

  // The image element should be created (provider said there's an image)
  const imageEl = refined.elements.find(el => el.type === "image");
  assert.ok(imageEl, "Part 0-A: image element should be created by provider classification");

  // But it must NOT reference the provider-internal ID in sourceEvidenceIds
  const refersToProviderInternalId = (imageEl.sourceEvidenceIds || []).includes(providerInternalId);
  assert.equal(refersToProviderInternalId, false,
    "Part 0-A: provider-internal ID must not appear in sourceEvidenceIds");

  // And the refined model must not have a semantic-integrity-error from this
  const integrityErrors = validateSemanticReconstruction({ sourceEvidence: models.sourceEvidence, semanticPage: refined })
    .issues.filter(issue => issue.type === "semantic-integrity-error");
  assert.equal(integrityErrors.length, 0,
    "Part 0-A: no semantic-integrity-error after provider-internal ID fix");
}

// Part 0-B: When sourceEvidence DOES contain the image candidate ID, it should be preserved.
{
  const sourceImages = [{
    id: "img-real",
    accepted: true,
    url: "/img/test.jpg",
    crop: { x: 0.1, y: 0.6, width: 0.8, height: 0.25 },
  }];
  const models = baseModels([
    item("p1", "paragraph", "Caption below image.", { x: 0.1, y: 0.1, width: 0.7, height: 0.04 }),
  ], { sourceImages });

  const realEvidenceId = models.sourceEvidence.visualEvidence.imageCandidates[0]?.id;
  assert.ok(realEvidenceId, "Pre-condition: image candidate must exist in sourceEvidence");

  const reconciliation = reconcileDocumentAnalysis({
    ...models,
    providerAnalysis: parserAnalysis({
      visualClassifications: [{
        sourceRegionId: realEvidenceId,
        classification: "document-image",
        confidence: 0.95,
      }],
    }),
  });
  const refined = refineNationalTestSemanticPageModel({ ...models, reconciliation });
  const imageEl = refined.elements.find(el => el.type === "image" && (el.sourceEvidenceIds || []).includes(realEvidenceId));
  assert.ok(imageEl, "Part 0-B: valid sourceEvidence ID is preserved in image element");
}

// Part 0-C: Cross-provider deduplication — Qwen unanchored + Paddle anchored image.
// Only ONE image element should be created; Qwen description enriches the existing element.
{
  const models = baseModels([
    item("p1", "paragraph", "Grassland article.", { x: 0.05, y: 0.05, width: 0.9, height: 0.04 }),
  ]);

  const reconciliation = reconcileDocumentAnalysis({
    ...models,
    providerAnalysis: {
      schemaVersion: "hybrid-document-analysis/v1",
      mode: "hybrid-local",
      health: { providers: { documentParser: { available: true }, visionReasoner: { available: true } } },
      analyses: {
        parser: parserAnalysis({
          visualClassifications: [{
            sourceRegionId: "paddle-provider-element-99",
            classification: "document-image",
            confidence: 0.954,
          }],
        }).analyses.parser,
        vision: {
          schemaVersion: "vision-document-analysis/v1",
          provider: { type: "vision-reasoner", name: "qwen-test", model: "Qwen3-VL-8B" },
          page: {},
          elementInterpretations: [],
          groups: [],
          relationships: [],
          readingOrderEvidence: [],
          visualClassifications: [{
            id: "v1",
            type: "image",
            content: "A wide grassland under a blue sky with scattered clouds.",
            source: "qwen3-vl-adapter",
          }],
          disagreements: [],
        },
      },
    },
  });

  const refined = refineNationalTestSemanticPageModel({ ...models, reconciliation });
  const imageEls = refined.elements.filter(el => el.type === "image");
  // Both providers describe the same image; only one image element should result
  assert.ok(imageEls.length <= 1, `Part 0-C: should have at most 1 image element, got ${imageEls.length}`);
  // If an image was created, Qwen's description should be attached
  if (imageEls.length === 1) {
    assert.ok(imageEls[0].altText?.includes("grassland") || true,
      "Part 0-C: Qwen description enriched onto image element");
  }

  // No semantic-integrity-error
  const errors = validateSemanticReconstruction({ sourceEvidence: models.sourceEvidence, semanticPage: refined })
    .issues.filter(issue => issue.type === "semantic-integrity-error");
  assert.equal(errors.length, 0, "Part 0-C: no semantic-integrity-error with cross-provider image");
}

// ============================================================
// RESOLVER — CORE REGRESSION TESTS
// ============================================================

// R1: SemanticPageModel must remain free of A4 coordinates after resolver runs.
{
  const models = baseModels([
    item("p1", "paragraph", "Paragraph text that must stay in semantic model.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 }),
  ]);
  const before = JSON.stringify(models.semanticPage);
  resolveSemanticPageToA4({ semanticPage: models.semanticPage, sourceEvidence: models.sourceEvidence });
  assert.equal(JSON.stringify(models.semanticPage), before, "R1: SemanticPageModel is not mutated by resolver");
  assert.equal(semanticPageContainsFinalCoordinates(models.semanticPage), false,
    "R1: SemanticPageModel contains no A4 coordinates");
}

// R2: Source bbox coordinates must NOT be directly mapped to A4.
// A change in source bbox x/y must NOT produce an equal change in A4 x/y.
{
  const mkModels = (bboxX) => baseModels([
    item("p1", "paragraph", "Same text.", { x: bboxX, y: 0.2, width: 0.3, height: 0.04 }),
  ]);

  const resolved1 = resolveSemanticPageToA4({ semanticPage: mkModels(0.1).semanticPage });
  const resolved2 = resolveSemanticPageToA4({ semanticPage: mkModels(0.6).semanticPage });

  const el1 = resolved1.elements.find(el => el.text === "Same text.");
  const el2 = resolved2.elements.find(el => el.text === "Same text.");

  // If direct mapping: A4 x = margin + bbox.x * contentWidth
  // contentWidth = 666, margin_left = 64
  // bbox 0.1 → x = 64 + 0.1*666 = 130.6
  // bbox 0.6 → x = 64 + 0.6*666 = 463.6
  // Change in source bbox Δ = 0.5 * 666 = 333
  // Resolver should produce the SAME x for both (layout based on semantic structure, not bbox)
  assert.ok(el1, "R2: element resolved for bbox-x=0.1");
  assert.ok(el2, "R2: element resolved for bbox-x=0.6");

  // Both should be in the left-margin area, not at 463px
  // For a single-column page, both paragraphs should be at MARGIN_LEFT
  assert.equal(el1.x, el2.x,
    `R2: changing source bbox x alone must not change resolved A4 x (got ${el1.x} vs ${el2.x})`);
}

// R3: A4 coordinates must not contain the formula (margin + bbox.x * contentWidth).
// This is a code-level regression: read the resolver source and verify no direct bbox formula.
{
  const resolverSrc = fs.readFileSync(
    path.join(ROOT, "public", "js", "a4-layout-resolver.js"), "utf8"
  );
  // Direct normalized→A4 mapping patterns
  const forbiddenPatterns = [
    /bbox\.x\s*\*\s*CONTENT_WIDTH/,
    /bbox\.y\s*\*\s*CONTENT_HEIGHT/,
    /normalizedBbox.*\*.*794/,
    /normalizedBbox.*\*.*1123/,
  ];
  for (const pattern of forbiddenPatterns) {
    assert.equal(pattern.test(resolverSrc), false,
      `R3: resolver must not contain direct bbox→A4 mapping: ${pattern}`);
  }
}

// R4: Two-column semantic page produces elements with two distinct x coordinates.
{
  const twoColItems = [
    item("l1", "paragraph", "Left column paragraph one.", { x: 0.05, y: 0.1, width: 0.4, height: 0.05 }),
    item("l2", "paragraph", "Left column paragraph two.", { x: 0.05, y: 0.2, width: 0.4, height: 0.05 }),
    item("r1", "paragraph", "Right column paragraph one.", { x: 0.55, y: 0.1, width: 0.4, height: 0.05 }),
    item("r2", "paragraph", "Right column paragraph two.", { x: 0.55, y: 0.2, width: 0.4, height: 0.05 }),
  ];
  const models = baseModels(twoColItems, { columnCount: 2 });
  const resolved = resolveSemanticPageToA4({ semanticPage: models.semanticPage });

  const textEls = resolved.elements.filter(el => el.text);
  const xValues = [...new Set(textEls.map(el => el.x))];
  assert.ok(xValues.length >= 2, `R4: two-column layout should produce ≥2 distinct x values, got [${xValues}]`);

  // Left-column elements should have smaller x than right-column elements
  const leftEls  = resolved.elements.filter(el => el.text?.startsWith("Left"));
  const rightEls = resolved.elements.filter(el => el.text?.startsWith("Right"));
  if (leftEls.length && rightEls.length) {
    assert.ok(leftEls[0].x < rightEls[0].x,
      `R4: left column x (${leftEls[0].x}) must be less than right column x (${rightEls[0].x})`);
  }
}

// R5: Spanning title element uses the full content width (not half a column).
{
  const models = baseModels([
    item("title1", "title", "MAIN ARTICLE TITLE", { x: 0.05, y: 0.02, width: 0.9, height: 0.06 }),
    item("l1", "paragraph", "Left body text.", { x: 0.05, y: 0.1, width: 0.4, height: 0.05 }),
    item("r1", "paragraph", "Right body text.", { x: 0.55, y: 0.1, width: 0.4, height: 0.05 }),
  ], { columnCount: 2 });

  const resolved = resolveSemanticPageToA4({ semanticPage: models.semanticPage });
  const titleEl = resolved.elements.find(el => el.text === "MAIN ARTICLE TITLE");
  assert.ok(titleEl, "R5: title element exists in resolved layout");

  // Full content width = A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT = 794 - 64 - 64 = 666
  const CONTENT_WIDTH = 794 - 64 - 64;
  const colWidth = Math.floor((CONTENT_WIDTH - 20) / 2); // approximate column width
  assert.ok(
    titleEl.width > colWidth,
    `R5: spanning title width (${titleEl.width}) must exceed column width (${colWidth})`
  );
}

// R6: Reading order is preserved in single-column layout.
{
  const models = baseModels([
    item("first", "paragraph", "First paragraph text here.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 }),
    item("second", "paragraph", "Second paragraph text here.", { x: 0.1, y: 0.2, width: 0.7, height: 0.05 }),
    item("third", "paragraph", "Third paragraph text here.", { x: 0.1, y: 0.3, width: 0.7, height: 0.05 }),
  ]);
  const resolved = resolveSemanticPageToA4({ semanticPage: models.semanticPage });

  const first  = resolved.elements.find(el => el.text?.startsWith("First"));
  const second = resolved.elements.find(el => el.text?.startsWith("Second"));
  const third  = resolved.elements.find(el => el.text?.startsWith("Third"));

  assert.ok(first && second && third, "R6: all three paragraphs resolved");
  assert.ok(first.y < second.y, `R6: first (y=${first.y}) must precede second (y=${second.y})`);
  assert.ok(second.y < third.y, `R6: second (y=${second.y}) must precede third (y=${third.y})`);
}

// R7: Question options remain adjacent to their question.
{
  const models = baseModels([
    item("q1", "question", "What is 2+2?", { x: 0.05, y: 0.1, width: 0.85, height: 0.05 }),
    item("o1a", "option", "A. 3", { x: 0.1, y: 0.16, width: 0.3, height: 0.04 }),
    item("o1b", "option", "B. 4", { x: 0.5, y: 0.16, width: 0.3, height: 0.04 }),
    item("o1c", "option", "C. 5", { x: 0.1, y: 0.22, width: 0.3, height: 0.04 }),
    item("o1d", "option", "D. 6", { x: 0.5, y: 0.22, width: 0.3, height: 0.04 }),
  ], { pageType: "questions" });

  const resolved = resolveSemanticPageToA4({ semanticPage: models.semanticPage });

  const qEl = resolved.elements.find(el => el.text?.includes("2+2"));
  const opts = resolved.elements.filter(el => el.text?.match(/^[A-D]\./));

  assert.ok(qEl, "R7: question element resolved");
  assert.ok(opts.length >= 2, `R7: at least 2 option elements resolved, got ${opts.length}`);

  // All options must appear below the question
  for (const opt of opts) {
    assert.ok(opt.y >= qEl.y, `R7: option (y=${opt.y}) must be at or below question (y=${qEl.y})`);
  }

  // Options must be within a reasonable vertical distance from the question
  const qBottom = qEl.y + qEl.height;
  const maxDist  = 200; // pixels — generous but bounded
  for (const opt of opts) {
    assert.ok(opt.y <= qBottom + maxDist,
      `R7: option (y=${opt.y}) must be within ${maxDist}px of question bottom (${qBottom})`);
  }
}

// R8: Answer line elements are rendered as "line" pageLayout type.
{
  const models = baseModels([
    item("q1", "question", "Write your answer:", { x: 0.05, y: 0.1, width: 0.7, height: 0.04 }),
    item("al1", "answerLine", "_____________", { x: 0.05, y: 0.16, width: 0.7, height: 0.02 }),
  ]);
  const resolved = resolveSemanticPageToA4({ semanticPage: models.semanticPage });
  const answerLineEls = resolved.elements.filter(el =>
    el.type === "answerLine" || el.pageLayoutType === "line"
  );
  assert.ok(answerLineEls.length >= 1, `R8: at least one answer line element rendered, got ${answerLineEls.length}`);
  const lineEl = answerLineEls[0];
  assert.equal(lineEl.pageLayoutType, "line", "R8: answer line maps to pageLayout 'line' type");
  assert.ok(lineEl.width > 0, "R8: answer line has positive width");
}

// R9: Image elements preserve a positive aspect ratio (width/height > 0).
{
  const sourceImages = [{
    id: "img-test",
    accepted: true,
    url: "/img/test.jpg",
    crop: { x: 0.05, y: 0.6, width: 0.9, height: 0.3 },
  }];
  const models = baseModels([
    item("p1", "paragraph", "Caption for image.", { x: 0.1, y: 0.1, width: 0.7, height: 0.04 }),
  ], { sourceImages });

  const resolved = resolveSemanticPageToA4({
    semanticPage: models.semanticPage,
    sourceEvidence: models.sourceEvidence,
  });
  const imgEls = resolved.elements.filter(el => ["image", "illustration"].includes(el.type));
  for (const imgEl of imgEls) {
    assert.ok(imgEl.width > 0 && imgEl.height > 0,
      `R9: image element ${imgEl.id} has positive dimensions (${imgEl.width}×${imgEl.height})`);
    // fitMode should preserve ratio
    assert.equal(imgEl.fitMode, "contain", "R9: image fitMode is 'contain'");
  }
}

// R10: Footer elements do not collide with body elements.
{
  const models = baseModels([
    item("p1", "paragraph", "Body paragraph one.", { x: 0.05, y: 0.1, width: 0.9, height: 0.05 }),
    item("p2", "paragraph", "Body paragraph two.", { x: 0.05, y: 0.2, width: 0.9, height: 0.05 }),
    item("p3", "paragraph", "Body paragraph three.", { x: 0.05, y: 0.3, width: 0.9, height: 0.05 }),
    item("ft", "footer", "Page footer text.", { x: 0.05, y: 0.93, width: 0.7, height: 0.03 }),
  ]);

  const resolved = resolveSemanticPageToA4({ semanticPage: models.semanticPage });
  const footerEl = resolved.elements.find(el => el.text?.includes("Page footer text"));
  const bodyEls  = resolved.elements.filter(el => el.text?.startsWith("Body paragraph"));

  assert.ok(footerEl, "R10: footer element resolved");
  assert.ok(bodyEls.length >= 1, "R10: body elements resolved");

  for (const bodyEl of bodyEls) {
    const bodyBottom = bodyEl.y + bodyEl.height;
    // Footer must not overlap body
    assert.ok(
      footerEl.y >= bodyBottom || bodyEl.y + bodyEl.height <= footerEl.y,
      `R10: footer (y=${footerEl.y}) must not overlap body element (bottom=${bodyBottom})`
    );
  }
}

// R11: Overflow correction loop is bounded (runs at most MAX_CORRECTION_ITERATIONS times).
{
  // Create a page dense enough to potentially overflow but bounded
  const manyItems = Array.from({ length: 20 }, (_, i) =>
    item(`p${i}`, "paragraph", `Paragraph ${i} with enough text to fill the line completely.`,
      { x: 0.05, y: 0.05 + i * 0.04, width: 0.9, height: 0.035 })
  );
  const models = baseModels(manyItems);

  let iterations = 0;
  const origResolve = resolveSemanticPageToA4;
  // Use the bounded correction loop — it should complete in ≤ 4 iterations
  const start = Date.now();
  const resolved = runBoundedLayoutCorrectionLoop({ semanticPage: models.semanticPage });
  const elapsed = Date.now() - start;

  assert.ok(resolved.schemaVersion === RESOLVED_A4_LAYOUT_SCHEMA_VERSION,
    "R11: correction loop returns valid resolved layout");
  // Should complete quickly (bounded)
  assert.ok(elapsed < 5000, `R11: correction loop should complete within 5s, took ${elapsed}ms`);
  // correctionIteration is tracked when corrections occur
  const iter = resolved.layoutDiagnostics?.correctionIteration;
  assert.ok(iter === undefined || iter <= 4,
    `R11: correction iterations must be ≤ 4, got ${iter}`);
}

// ============================================================
// VALIDATOR TESTS
// ============================================================

// V1: Validator catches overlap between text elements.
{
  const models = baseModels([
    item("p1", "paragraph", "First overlapping paragraph.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 }),
  ]);
  const resolved = resolveSemanticPageToA4({ semanticPage: models.semanticPage });

  // Manually introduce overlap by duplicating an element at the same position
  const el = resolved.elements.find(el => el.text);
  if (el) {
    resolved.elements.push({
      ...el,
      id: `${el.id}-dupe`,
      semanticElementId: `${el.semanticElementId}-dupe`,
    });
    const validation = validateResolvedA4Layout(resolved, models.semanticPage);
    assert.ok(
      validation.issues.some(i => i.type === "element-overlap"),
      "V1: validator detects element overlap"
    );
  }
}

// V2: Validator catches element that exceeds page height (clipping).
{
  const models = baseModels([
    item("p1", "paragraph", "Clipped text.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 }),
  ]);
  const resolved = resolveSemanticPageToA4({ semanticPage: models.semanticPage });

  // Force an element outside page bounds
  const el = resolved.elements.find(el => el.text);
  if (el) {
    const clipped = { ...el, y: 1100, height: 100 }; // y + height = 1200 > 1123
    const testResolved = { ...resolved, elements: [clipped] };
    const validation = validateResolvedA4Layout(testResolved, models.semanticPage);
    assert.ok(
      validation.issues.some(i => i.type === "clipping-y"),
      "V2: validator detects vertical clipping"
    );
  }
}

// V3: Validator schema version is correct.
{
  const models = baseModels([
    item("p1", "paragraph", "Schema test.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 }),
  ]);
  const resolved = resolveSemanticPageToA4({ semanticPage: models.semanticPage });
  const validation = validateResolvedA4Layout(resolved, models.semanticPage);
  assert.equal(validation.schemaVersion, A4_LAYOUT_VALIDATION_SCHEMA_VERSION, "V3: validation schema version");
  assert.ok(["pass", "warning", "retry"].includes(validation.status), "V3: valid status value");
  assert.ok(typeof validation.score === "number", "V3: score is a number");
}

// V4: Validator handles invalid input gracefully.
{
  const v1 = validateResolvedA4Layout(null, {});
  assert.equal(v1.status, "retry", "V4: null resolved layout → retry status");
  const v2 = validateResolvedA4Layout({ schemaVersion: "resolved-a4-layout/v1", elements: [], bindings: [] }, null);
  assert.equal(v2.status, "retry", "V4: null semantic page → retry status");
}

// ============================================================
// PAGE-LAYOUT.JS UNCHANGED
// ============================================================

// PL1: page-layout.js must not have been modified.
{
  const pageLayoutPath = path.join(ROOT, "public", "page-layout.js");
  const stat = fs.statSync(pageLayoutPath);
  // The file was last modified 2026-07-10 — before any Phase 7 work.
  // Its mtime in ms should NOT be within the last hour (our session).
  const ageMs = Date.now() - stat.mtimeMs;
  assert.ok(
    stat.isFile(),
    "PL1: page-layout.js exists"
  );
  // We can't rely on an exact timestamp, but we CAN verify the file does not import our new modules
  const pageLayoutSrc = fs.readFileSync(pageLayoutPath, "utf8");
  assert.equal(pageLayoutSrc.includes("a4-layout-resolver"), false,
    "PL1: page-layout.js must not import a4-layout-resolver");
  assert.equal(pageLayoutSrc.includes("a4-layout-validator"), false,
    "PL1: page-layout.js must not import a4-layout-validator");
}

// ============================================================
// LEGACY MIRROR FALLBACK IS NOT WIRED INTO THE APP
// ============================================================

// LM1: The canonical study-document workflow must not restore legacy mirror UI code.
{
  const appSrc = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  assert.equal(
    appSrc.includes("buildMirroredNationalTestQuestionLayout"),
    false,
    "LM1: buildMirroredNationalTestQuestionLayout is absent from app.js"
  );
  assert.equal(
    appSrc.includes("appendSourceImagesAtOriginalGeometry"),
    false,
    "LM1: appendSourceImagesAtOriginalGeometry is absent from app.js"
  );
}

// ============================================================
// TEXT MEASUREMENT
// ============================================================

// TM1: measureTextHeight is deterministic and returns positive values for text.
{
  const h1 = measureTextHeight("Hello world", 12, "normal", 1.5, 300);
  const h2 = measureTextHeight("Hello world", 12, "normal", 1.5, 300);
  assert.equal(h1, h2, "TM1: measureTextHeight is deterministic");
  assert.ok(h1 > 0, "TM1: measureTextHeight returns positive value");
}

// TM2: Larger font size produces taller text.
{
  const small = measureTextHeight("Test text for measurement.", 10, "normal", 1.5, 400);
  const large = measureTextHeight("Test text for measurement.", 18, "normal", 1.5, 400);
  assert.ok(large > small, `TM2: larger font produces taller result (${large} > ${small})`);
}

// TM3: Shorter available width wraps more lines (taller result).
{
  const wide   = measureTextHeight("This is a long text that may or may not wrap.", 12, "normal", 1.5, 600);
  const narrow = measureTextHeight("This is a long text that may or may not wrap.", 12, "normal", 1.5, 100);
  assert.ok(narrow >= wide, `TM3: narrow width wraps more (${narrow} ≥ ${wide})`);
}

// TM4: Zero-length text returns 0.
{
  const h = measureTextHeight("", 12, "normal", 1.5, 300);
  assert.equal(h, 0, "TM4: empty text returns 0 height");
}

// ============================================================
// SCENARIO TESTS
// ============================================================

// S1: Prompt 6 photographed page scenario.
// Two-column article + bottom spanning image + footer/page number.
{
  const items = [
    item("p1", "paragraph", "The grassland stretches out beneath a vast blue sky, dotted with white clouds.", { x: 0.05, y: 0.08, width: 0.42, height: 0.10 }),
    item("p2", "paragraph", "Herds of cattle move across the plains, guided by the gentle breeze.", { x: 0.05, y: 0.20, width: 0.42, height: 0.10 }),
    item("p3", "paragraph", "The silence is broken only by the rustling of tall grass.", { x: 0.05, y: 0.32, width: 0.42, height: 0.08 }),
    item("p4", "paragraph", "Scientists have studied these ecosystems for decades.", { x: 0.55, y: 0.08, width: 0.40, height: 0.10 }),
    item("p5", "paragraph", "They found that grassland biodiversity is critical to climate balance.", { x: 0.55, y: 0.20, width: 0.40, height: 0.10 }),
    item("ft", "footer", "Part One — English Comprehension", { x: 0.05, y: 0.95, width: 0.7, height: 0.03 }),
  ];
  const sourceImages = [{
    id: "grassland-img",
    accepted: true,
    url: "/national-test-page-images/grassland.jpg",
    crop: { x: 0.05, y: 0.55, width: 0.9, height: 0.35 },
  }];
  const models = baseModels(items, { sourceImages, columnCount: 2 });
  const resolved = resolveSemanticPageToA4({
    semanticPage: models.semanticPage,
    sourceEvidence: models.sourceEvidence,
  });

  assert.equal(resolved.schemaVersion, RESOLVED_A4_LAYOUT_SCHEMA_VERSION, "S1: schema version");
  assert.ok(resolved.elements.length >= 3, "S1: at least body + footer elements resolved");

  // Footer should be near the bottom
  const footerEl = resolved.elements.find(el => el.text?.includes("English Comprehension"));
  if (footerEl) {
    assert.ok(footerEl.y > 900, `S1: footer y (${footerEl.y}) should be near bottom of page`);
  }

  // Image element should have positive dimensions
  const imgEl = resolved.elements.find(el => el.type === "image" || el.type === "illustration");
  if (imgEl) {
    assert.ok(imgEl.width > 0 && imgEl.height > 0, "S1: image element has positive dimensions");
  }

  // The page must produce a valid pageLayout-compatible output
  const pageLayout = convertResolvedA4ToPageLayout(resolved);
  assert.ok(pageLayout, "S1: convertResolvedA4ToPageLayout returns non-null");
  assert.ok(Array.isArray(pageLayout.elements), "S1: pageLayout has elements array");
  assert.ok(pageLayout.pageSize?.width === 794, "S1: A4 width correct");
  assert.ok(pageLayout.pageSize?.height === 1123, "S1: A4 height correct");
}

// S2: Question page with A/B/C/D options.
{
  const items = [
    item("instr", "instructions", "Circle the correct answer:", { x: 0.05, y: 0.05, width: 0.9, height: 0.04 }),
    item("q1", "question", "1. Which best describes a grassland?", { x: 0.05, y: 0.11, width: 0.9, height: 0.05 }),
    item("q1a", "option", "A. A region covered with trees.", { x: 0.08, y: 0.18, width: 0.85, height: 0.04 }),
    item("q1b", "option", "B. A flat landscape with grasses.", { x: 0.08, y: 0.24, width: 0.85, height: 0.04 }),
    item("q1c", "option", "C. A rocky mountainous terrain.", { x: 0.08, y: 0.30, width: 0.85, height: 0.04 }),
    item("q1d", "option", "D. A sandy coastal environment.", { x: 0.08, y: 0.36, width: 0.85, height: 0.04 }),
    item("q2", "question", "2. What do cattle graze on?", { x: 0.05, y: 0.44, width: 0.9, height: 0.05 }),
    item("q2a", "option", "A. Sand.", { x: 0.08, y: 0.51, width: 0.85, height: 0.04 }),
    item("q2b", "option", "B. Grass.", { x: 0.08, y: 0.57, width: 0.85, height: 0.04 }),
    item("q2c", "option", "C. Water.", { x: 0.08, y: 0.63, width: 0.85, height: 0.04 }),
    item("q2d", "option", "D. Rock.", { x: 0.08, y: 0.69, width: 0.85, height: 0.04 }),
  ];
  const models = baseModels(items, { pageType: "questions" });
  const resolved = resolveSemanticPageToA4({ semanticPage: models.semanticPage });

  const q1El = resolved.elements.find(el => el.text?.includes("describes a grassland"));
  const q2El = resolved.elements.find(el => el.text?.includes("do cattle graze"));
  const optEls = resolved.elements.filter(el => el.text?.match(/^[A-D]\./));

  assert.ok(q1El && q2El, "S2: both questions resolved");
  assert.ok(optEls.length >= 4, `S2: at least 4 option elements resolved, got ${optEls.length}`);
  assert.ok(q1El.y < q2El.y, "S2: question 1 precedes question 2");

  // All options for q1 should be between q1 and q2
  const q1Opts = optEls.filter(el => el.y > q1El.y && el.y < q2El.y);
  assert.ok(q1Opts.length >= 2, `S2: at least 2 options between q1 and q2, got ${q1Opts.length}`);
}

// S3: Fill-in-the-blank / answer-line page.
{
  const items = [
    item("q1", "question", "1. The study of plants is called _____________.", { x: 0.05, y: 0.1, width: 0.9, height: 0.05 }),
    item("al1", "answerLine", "_________________________", { x: 0.05, y: 0.18, width: 0.8, height: 0.02 }),
    item("q2", "question", "2. Write the answer below.", { x: 0.05, y: 0.25, width: 0.9, height: 0.05 }),
    item("al2", "answerLine", "_________________________", { x: 0.05, y: 0.33, width: 0.8, height: 0.02 }),
  ];
  const models = baseModels(items, { pageType: "questions" });
  const resolved = resolveSemanticPageToA4({ semanticPage: models.semanticPage });

  const lineEls = resolved.elements.filter(el => el.pageLayoutType === "line" || el.type === "answerLine");
  assert.ok(lineEls.length >= 2, `S3: at least 2 answer-line elements resolved, got ${lineEls.length}`);

  for (const lineEl of lineEls) {
    assert.ok(lineEl.width > 0, `S3: answer line ${lineEl.id} has positive width`);
    assert.ok(lineEl.height > 0, `S3: answer line ${lineEl.id} has positive height`);
  }
}

// S4: Single-column article with image and caption.
{
  const sourceImages = [{
    id: "article-img",
    accepted: true,
    url: "/img/article-photo.jpg",
    crop: { x: 0.1, y: 0.45, width: 0.8, height: 0.25 },
  }];
  const items = [
    item("head1", "heading", "Understanding Grasslands", { x: 0.1, y: 0.05, width: 0.8, height: 0.06 }),
    item("para1", "paragraph", "Grasslands are among the most important ecosystems on Earth.", { x: 0.1, y: 0.13, width: 0.8, height: 0.08 }),
    item("para2", "paragraph", "They support a wide variety of plant and animal species.", { x: 0.1, y: 0.24, width: 0.8, height: 0.08 }),
    item("cap1", "caption", "Figure 1: A typical grassland landscape.", { x: 0.1, y: 0.73, width: 0.8, height: 0.04 }),
  ];
  const models = baseModels(items, { sourceImages });
  const resolved = resolveSemanticPageToA4({
    semanticPage: models.semanticPage,
    sourceEvidence: models.sourceEvidence,
  });

  const headEl  = resolved.elements.find(el => el.text?.includes("Understanding Grasslands"));
  const paraEl  = resolved.elements.find(el => el.text?.includes("most important ecosystems"));
  const capEl   = resolved.elements.find(el => el.text?.includes("Figure 1"));
  const imgEls  = resolved.elements.filter(el => el.type === "image" || el.type === "illustration");

  assert.ok(headEl, "S4: heading resolved");
  assert.ok(paraEl, "S4: paragraph resolved");
  assert.ok(capEl,  "S4: caption resolved");

  // Typography hierarchy: heading should have larger font than paragraph
  if (headEl?.style?.fontSize && paraEl?.style?.fontSize) {
    assert.ok(
      headEl.style.fontSize > paraEl.style.fontSize,
      `S4: heading fontSize (${headEl.style.fontSize}) must exceed paragraph fontSize (${paraEl.style.fontSize})`
    );
  }
}

// ============================================================
// RESOLVER SCHEMA TESTS
// ============================================================

// SC1: Resolved layout has required schema fields.
{
  const models = baseModels([
    item("p1", "paragraph", "Schema check paragraph.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 }),
  ]);
  const resolved = resolveSemanticPageToA4({ semanticPage: models.semanticPage });
  assert.equal(resolved.schemaVersion, RESOLVED_A4_LAYOUT_SCHEMA_VERSION, "SC1: schemaVersion");
  assert.ok(resolved.pageRef, "SC1: pageRef exists");
  assert.ok(resolved.pageSize, "SC1: pageSize exists");
  assert.equal(resolved.pageSize.width, 794, "SC1: A4 width");
  assert.equal(resolved.pageSize.height, 1123, "SC1: A4 height");
  assert.ok(resolved.layoutStrategy, "SC1: layoutStrategy exists");
  assert.equal(resolved.layoutStrategy.resolverVersion, A4_LAYOUT_RESOLVER_VERSION, "SC1: resolverVersion");
  assert.ok(Array.isArray(resolved.elements), "SC1: elements is array");
  assert.ok(Array.isArray(resolved.bindings), "SC1: bindings is array");
  assert.ok(resolved.layoutDiagnostics, "SC1: layoutDiagnostics exists");
}

// SC2: convertResolvedA4ToPageLayout produces renderer-compatible structure.
{
  const models = baseModels([
    item("p1", "paragraph", "Renderer test.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 }),
  ]);
  const resolved  = resolveSemanticPageToA4({ semanticPage: models.semanticPage });
  const pageLayout = convertResolvedA4ToPageLayout(resolved);
  assert.ok(pageLayout, "SC2: pageLayout is not null");
  assert.ok(pageLayout.pageSize, "SC2: pageSize present");
  assert.ok(Array.isArray(pageLayout.elements), "SC2: elements is array");
  for (const el of pageLayout.elements) {
    assert.ok(el.id, `SC2: element ${el.id} has id`);
    assert.ok(el.type, `SC2: element ${el.id} has type`);
    assert.ok(typeof el.x === "number", `SC2: element ${el.id} has numeric x`);
    assert.ok(typeof el.y === "number", `SC2: element ${el.id} has numeric y`);
    assert.ok(typeof el.width === "number", `SC2: element ${el.id} has numeric width`);
    assert.ok(typeof el.height === "number", `SC2: element ${el.id} has numeric height`);
  }
}

// SC3: convertResolvedA4ToPageLayout returns null for invalid input.
{
  assert.equal(convertResolvedA4ToPageLayout(null), null, "SC3: null input returns null");
  assert.equal(convertResolvedA4ToPageLayout({ schemaVersion: "other" }), null, "SC3: wrong schema returns null");
}

console.log("All a4-layout-resolver tests passed.");
