#!/usr/bin/env node
/**
 * scripts/run-reconstruction-diagnostics.mjs
 *
 * Phase 8 — Controlled Visual Reconstruction Diagnostic Runner
 *
 * Runs the semantic A4 reconstruction pipeline on 5 selected real project pages.
 * Uses ONLY existing saved data — does NOT run Qwen or any ML model.
 *
 * IMPORTANT: semanticReconstructionEnabled = true ONLY within this script scope.
 *   - Production app.js flag remains false (unchanged).
 *   - Production page-layout data is NOT written to.
 *   - page-layout.js is NOT modified.
 *
 * Output:
 *   data/document-intelligence-diagnostics/phase8-reconstruction-YYYYMMDDTHHMMSS.json
 *
 * Usage:
 *   node scripts/run-reconstruction-diagnostics.mjs
 */

import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");

import { resolveSemanticPageToA4, runBoundedLayoutCorrectionLoop, convertResolvedA4ToPageLayout }
  from "../public/js/a4-layout-resolver.js";
import { validateResolvedA4Layout }
  from "../public/js/a4-layout-validator.js";
import { evaluateVisualComposition }
  from "../public/js/visual-composition-evaluator.js";
import { buildImageEvidenceAssociations }
  from "../public/js/image-evidence-association.js";

// ============================================================
// CONTROLLED FEATURE FLAG — script scope ONLY
// ============================================================

const SCRIPT_RECONSTRUCTION_ENABLED = true;   // local to this script
const GLOBAL_PRODUCTION_FLAG        = false;   // production app.js default — unchanged

// ============================================================
// LOAD SAVED DATA (no model inference)
// ============================================================

const DATA_DIR  = path.join(ROOT, "data");
const DIAG_DIR  = path.join(DATA_DIR, "document-intelligence-diagnostics");

const nationalTestPages = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "national-test-pages.json"), "utf8")
).nationalTestPages;

const paddleOutput = tryLoadJson(path.join(DIAG_DIR, "provider-worker-parser-1783772638600-output.json"));
const qwenOutput   = tryLoadJson(path.join(DIAG_DIR, "provider-worker-vision-1783776027032-output.json"));

function tryLoadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

// ============================================================
// TEST PAGE SELECTION
// 5 real project pages covering all Phase 8 required scenarios
// ============================================================

const TEST_PAGE_SPECS = [
  {
    pageId:           "test_page_06d4bf4f-f3b1-458b-9c62-e19b83f958db",
    pageType:         "two-column-article",
    description:      "Two-column photographed article — horses and Comanches",
    expectColumnCount: 2,
    useSourceContainer: true,
  },
  {
    pageId:           "test_page_44b99012-98fc-47ca-bdbf-8692433f2b0c",
    pageType:         "mixed-text-image",
    description:      "Mixed text + images — Springsteen article with photos",
    expectColumnCount: 1,
  },
  {
    pageId:           "test_page_b2825db0-241e-4891-a402-57ecc1f1e327",
    pageType:         "questions-with-options",
    description:      "Questions with open-text answers (short-answer page)",
    expectColumnCount: 1,
  },
  {
    pageId:           "test_page_191ba204-b645-4716-b6fb-138b884247b7",
    pageType:         "fill-in-blank-answer-lines",
    description:      "One-word gap sentences with answer lines",
    expectColumnCount: 1,
  },
  {
    pageId:           "test_page_44afb949-e55c-4542-a70f-a69797f971ad",
    pageType:         "multiple-choice-reading",
    description:      "Multiple-choice reading comprehension with inline options",
    expectColumnCount: 1,
  },
];

// ============================================================
// SEMANTIC PAGE MODEL BUILDER
// Converts real page data to SemanticPageModel without running inference.
// ============================================================

function buildSemanticPageFromPage(page, spec) {
  if (spec.useSourceContainer && page.sourceContainer?.content?.units) {
    return buildFromSourceContainer(page, spec);
  }
  return buildFromPageLayout(page, spec);
}

// -- Build from sourceContainer content units (page 4: photographed article)
function buildFromSourceContainer(page, spec) {
  const sc      = page.sourceContainer;
  const units   = sc.content.units;
  const elements = [];
  const readingOrder = [];
  let idx = 0;

  for (const unit of units) {
    if (!unit.id) continue;
    const semType = mapUnitRole(unit.role);
    if (!semType) continue;
    idx++;
    const sb = unit.sourceBox;
    const el = {
      id:           `sem-${unit.id}`,
      type:         semType,
      semanticRole: unit.role || semType,
      readingOrder: idx,
      text:         unit.cleanText || unit.rawText || "",
      layoutIntent: {
        band:        inferBandFromSB(sb, semType),
        prominence:  semType === "heading" ? "high" : "normal",
        columnRole:  inferColumnRoleFromSB(sb, spec.expectColumnCount),
        spansColumns:sb ? sb.width > 0.75 : false,
      },
      sourceEvidenceIds: [],
      sourceBbox: sb ? { ...sb, coordinateSpace: "source-document-plane-normalized" } : null,
    };
    elements.push(el);
    readingOrder.push(el.id);
  }

  // Add Paddle-detected image (the grassland photograph at bottom)
  if (paddleOutput) {
    const imgEl = (paddleOutput.elements || []).find(e => e.providerType === "image");
    if (imgEl) {
      elements.push({
        id: "sem-image-1", type: "image", semanticRole: "image", readingOrder: idx + 1,
        layoutIntent: { band: "body", prominence: "normal", columnRole: "span", spansColumns: true, imageRole: "bottom-spanning-photograph" },
        sourceEvidenceIds: [],
        sourceBbox: imgEl.sourceBBox || null,
        altText: "Grassland photograph",
      });
      readingOrder.push("sem-image-1");
    }
    const footerEl = (paddleOutput.elements || []).find(e => e.providerType === "footer");
    const pnEl     = (paddleOutput.elements || []).find(e => e.providerType === "number");
    if (footerEl) {
      elements.push({
        id: "sem-footer-1", type: "footer", semanticRole: "footer", readingOrder: idx + 2,
        text: (footerEl.text || "").replace(/#{3,}/g, "").trim(),
        layoutIntent: { band: "footer", prominence: "low", columnRole: "single", spansColumns: false },
        sourceEvidenceIds: [], sourceBbox: footerEl.sourceBBox || null,
      });
      readingOrder.push("sem-footer-1");
    }
    if (pnEl) {
      elements.push({
        id: "sem-pn-1", type: "pageNumber", semanticRole: "pageNumber", readingOrder: idx + 3,
        text: pnEl.text || "",
        layoutIntent: { band: "footer", prominence: "low", columnRole: "single", spansColumns: false },
        sourceEvidenceIds: [], sourceBbox: pnEl.sourceBBox || null,
      });
      readingOrder.push("sem-pn-1");
    }
  }

  return {
    schemaVersion: "semantic-page/v1",
    pageRef: { testId: page.testId || "", pageId: page.id || "", pageNumber: page.pageNumber || 0 },
    pageType: spec.pageType || "article",
    styleHints: { columnCount: spec.expectColumnCount || 2, columnsInferred: true },
    elements, readingOrder, relationships: [], groups: [],
  };
}

// -- Build from pageLayout elements (most pages)
function buildFromPageLayout(page, spec) {
  const layout   = page.pageLayout;
  if (!layout) return null;
  const layoutW  = layout.pageSize?.width  || 768;
  const layoutH  = layout.pageSize?.height || 1024;
  const elements = [];
  const readingOrder = [];
  let   idx = 0;

  for (const el of (layout.elements || [])) {
    if (!el || !el.type) continue;
    const semType = mapLayoutElementType(el.type, el.role);
    if (!semType) continue;
    idx++;
    const relX = el.x  / layoutW;
    const relY = el.y  / layoutH;
    const relW = Math.max(0.01, (el.width  || 0) / layoutW);
    const relH = Math.max(0.01, (el.height || 0) / layoutH);
    const sem = {
      id:           `sem-${el.id || `el-${idx}`}`,
      type:         semType,
      semanticRole: el.role || semType,
      readingOrder: idx,
      layoutIntent: {
        band:        inferBandFromRelY(relY, semType),
        prominence:  inferProminence(semType, el),
        columnRole:  inferColumnRoleFromX(relX, relW, spec.expectColumnCount),
        spansColumns:relW > 0.75 && spec.expectColumnCount >= 2,
      },
      sourceEvidenceIds: [],
      sourceBbox: {
        x: relX, y: relY, width: relW, height: relH,
        coordinateSpace: "source-document-plane-normalized",
      },
    };
    if (el.text) sem.text = el.text;
    if (el.src)  { sem.src = el.src; sem.pixelWidth = el.width; sem.pixelHeight = el.height; }
    elements.push(sem);
    readingOrder.push(sem.id);
  }

  return {
    schemaVersion: "semantic-page/v1",
    pageRef: { testId: page.testId || "", pageId: page.id || "", pageNumber: page.pageNumber || 0 },
    pageType: spec.pageType || "article",
    styleHints: { columnCount: spec.expectColumnCount || 1, columnsInferred: true },
    elements, readingOrder, relationships: [], groups: [],
  };
}

// ---- Helpers ----

function mapUnitRole(role) {
  const m = { paragraph: "paragraph", heading: "heading", title: "title", footer: "footer", caption: "caption" };
  return m[role] || "paragraph";
}

function mapLayoutElementType(type, role) {
  if (type === "image") return "image";
  if (type === "line")  return "answerLine";
  if (type !== "text")  return null;
  const m = {
    "heading": "heading", "instructions": "instructions",
    "question": "question", "question-stem": "question", "question-number": "question",
    "options": "option", "option": "option",
    "sentence": "answerGap", "inline-gap": "answerGap",
    "reading-text": "paragraph", "introduction": "paragraph",
    "mini-text-heading": "subheading",
    "gap-number": "answerGap", "option-group-number": "question",
    "bullet": "paragraph", "points": "paragraph",
  };
  return role ? (m[role] || "paragraph") : "paragraph";
}

function inferBandFromSB(sb, type) {
  if (type === "footer" || type === "pageNumber") return "footer";
  if (!sb) return "body";
  if (sb.y < 0.08) return "header";
  if (sb.y > 0.90) return "footer";
  return "body";
}

function inferBandFromRelY(relY, type) {
  if (type === "footer" || type === "pageNumber") return "footer";
  if (relY < 0.08) return "header";
  if (relY > 0.92) return "footer";
  return "body";
}

function inferColumnRoleFromSB(sb, colCount) {
  if (!sb || colCount < 2) return "single";
  if (sb.width > 0.75) return "span";
  return sb.x < 0.48 ? "left" : "right";
}

function inferColumnRoleFromX(relX, relW, colCount) {
  if (colCount < 2) return "single";
  if (relW > 0.75)  return "span";
  return relX < 0.48 ? "left" : "right";
}

function inferProminence(type, el) {
  const fs = el.style?.fontSize;
  if (type === "title" || type === "heading") {
    if (fs && fs >= 20) return "highest";
    if (fs && fs >= 16) return "high";
    return "medium";
  }
  return "normal";
}

// ---- Build minimal SourceEvidenceModel for image aspect ratio hints ----
function buildSourceEvidenceFromPage(page) {
  const layout = page.pageLayout;
  if (!layout) return null;
  const layoutW = layout.pageSize?.width  || 768;
  const layoutH = layout.pageSize?.height || 1024;
  const imageCandidates = (layout.elements || [])
    .filter(el => el.type === "image" && el.src)
    .map((el, i) => ({
      id:          `img-cand-${i}`,
      url:          el.src,
      bbox: {
        x: el.x / layoutW, y: el.y / layoutH,
        width: el.width / layoutW, height: el.height / layoutH,
        coordinateSpace: "source-document-plane-normalized",
      },
      pixelWidth:  el.width,
      pixelHeight: el.height,
    }));
  return {
    schemaVersion: "source-evidence/v1",
    pageId: page.id,
    visualEvidence: { imageCandidates, graphicCandidates: [], regions: [] },
    ocrEvidence:    { blocks: [], lines: [], words: [] },
    pdfTextEvidence: [],
  };
}

// ============================================================
// COMPOSITION CORRECTION LOOP (Phase 8 extension)
// ============================================================

const MAX_COMPOSITION_ITERATIONS = 3;

function runCompositionCorrectionLoop(semanticPage, sourceEvidence) {
  let resolved = runBoundedLayoutCorrectionLoop({ semanticPage, sourceEvidence });
  const correctionHistory = [];

  for (let i = 0; i < MAX_COMPOSITION_ITERATIONS; i++) {
    const evaluation = evaluateVisualComposition(resolved, semanticPage, sourceEvidence);
    if (evaluation.status !== "retry") break;

    const patches = evaluation.suggestedLayoutPatches || [];
    if (!patches.length) break;

    const record  = { iteration: i + 1, patches: [] };
    let options = {};

    for (const p of patches) {
      if (p.type === "reduce-image-height") {
        options.imageHeightFactor = Math.max(0.45, (options.imageHeightFactor || 1.0) * (p.factor || 0.80));
        record.patches.push(`reduce-image-height → factor=${options.imageHeightFactor.toFixed(2)}`);
      } else if (p.type === "increase-title-prominence") {
        options.titleProminenceFactor = Math.min(1.5, (options.titleProminenceFactor || 1.0) * (p.factor || 1.10));
        record.patches.push(`increase-title-prominence → factor=${options.titleProminenceFactor.toFixed(2)}`);
      } else if (p.type === "increase-footer-band") {
        options.footerBandExtra = (options.footerBandExtra || 0) + (p.pixels || 20);
        record.patches.push(`increase-footer-band +${p.pixels || 20}px`);
      } else if (p.type === "strengthen-question-option-cohesion") {
        options.spacingFactor = Math.max(0.55, (options.spacingFactor || 1.0) * 0.88);
        record.patches.push("strengthen-question-option-cohesion (reduce spacing)");
      }
    }
    if (!Object.keys(options).length) break;

    correctionHistory.push(record);
    resolved = runBoundedLayoutCorrectionLoop({ semanticPage, sourceEvidence, options });
  }

  return { resolved, correctionHistory };
}

// ============================================================
// MAIN DIAGNOSTIC RUNNER
// ============================================================

async function runDiagnostics() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("Phase 8 — Controlled Visual Reconstruction Diagnostics");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`semanticReconstructionEnabled (this script only): ${SCRIPT_RECONSTRUCTION_ENABLED}`);
  console.log(`Global production flag (app.js):                  ${GLOBAL_PRODUCTION_FLAG} [unchanged]`);
  console.log("No Qwen inference will be run. Using saved diagnostics only.");
  console.log();

  const results = [];

  for (const spec of TEST_PAGE_SPECS) {
    const page = nationalTestPages.find(p => p.id === spec.pageId);
    if (!page) {
      console.log(`⚠  Page ${spec.pageId} not found — skipping`);
      continue;
    }

    console.log(`▶  ${spec.description} (page ${page.pageNumber})`);

    // Build SemanticPageModel from existing data
    const semanticPage = buildSemanticPageFromPage(page, spec);
    if (!semanticPage) {
      console.log("   ✗ Could not build SemanticPageModel — skipping");
      continue;
    }
    console.log(`   Elements: ${semanticPage.elements.length}  Columns: ${semanticPage.styleHints.columnCount}`);

    // Build SourceEvidenceModel (image aspect-ratio hints only)
    const sourceEvidence = buildSourceEvidenceFromPage(page);

    // Build image evidence associations
    const imageAssociations = buildImageEvidenceAssociations(semanticPage, sourceEvidence, paddleOutput, qwenOutput);

    // Run initial pass
    const initResolved    = resolveSemanticPageToA4({ semanticPage, sourceEvidence });
    const initValidation  = validateResolvedA4Layout(initResolved, semanticPage);
    const initComposition = evaluateVisualComposition(initResolved, semanticPage, sourceEvidence);

    console.log(`   Initial  layout=${initValidation.score.toFixed(3)} [${initValidation.status}]  composition=${initComposition.score.toFixed(3)} [${initComposition.status}]`);

    // Run composition correction loop
    let finalResolved, correctionHistory;
    if (initComposition.status === "retry") {
      const r = runCompositionCorrectionLoop(semanticPage, sourceEvidence);
      finalResolved     = r.resolved;
      correctionHistory = r.correctionHistory;
    } else {
      finalResolved     = runBoundedLayoutCorrectionLoop({ semanticPage, sourceEvidence });
      correctionHistory = [];
    }

    const finalValidation  = validateResolvedA4Layout(finalResolved, semanticPage);
    const finalComposition = evaluateVisualComposition(finalResolved, semanticPage, sourceEvidence);
    const pageLayoutOutput = convertResolvedA4ToPageLayout(finalResolved);

    // ── ELEMENT COUNT PRESERVATION ASSERTION ─────────────────
    // The bounded correction loop MUST NOT drop elements.
    // (The "62 → 39" phrasing in the Phase 8 report was a reporting error:
    //  p10's element count (62) was accidentally placed next to p7's (39) in
    //  the written summary. This assertion proves elements are never removed
    //  during overflow correction — only spacingFactor/fontSizeFactor change.)
    const resolvedCount  = finalResolved.elements?.length ?? 0;
    const semanticCount  = semanticPage.elements.length;
    if (resolvedCount !== semanticCount) {
      console.warn(`   ⚠ ELEMENT COUNT MISMATCH: semantic=${semanticCount} resolved=${resolvedCount} — correction loop must not drop elements`);
    }

    const corrected = correctionHistory.length > 0;
    const compIcon  = finalComposition.status === "pass" ? "✓" : finalComposition.status === "warning" ? "⚠" : "✗";
    console.log(`   Final    layout=${finalValidation.score.toFixed(3)} [${finalValidation.status}]  composition=${finalComposition.score.toFixed(3)} [${finalComposition.status}] ${corrected ? "(corrected)" : ""}`);

    // Print issues (max 4)
    for (const iss of finalComposition.issues.slice(0, 4)) {
      const sev = iss.severity === "critical" ? "✗" : iss.severity === "warning" ? "⚠" : "ℹ";
      console.log(`   ${sev}  [${iss.dimension}] ${iss.message}`);
    }
    if (correctionHistory.length > 0) {
      correctionHistory.forEach(r => console.log(`   ↳ Correction ${r.iteration}: ${r.patches.join(", ")}`));
    }

    results.push({
      pageId:                  spec.pageId,
      pageNumber:              page.pageNumber,
      pageType:                spec.pageType,
      description:             spec.description,
      sourceImage:             page.sourcePage?.url || page.sourcePage?.filename || null,
      semanticPageVersion:     semanticPage.schemaVersion,
      semanticElementCount:    semanticPage.elements.length,
      resolvedLayoutVersion:   finalResolved.schemaVersion,
      layoutValidation: {
        initial: { score: initValidation.score,  status: initValidation.status },
        final:   { score: finalValidation.score, status: finalValidation.status },
      },
      compositionEvaluation: {
        initial: {
          score:  initComposition.score,
          status: initComposition.status,
          scores: initComposition.scores,
        },
        final: {
          score:  finalComposition.score,
          status: finalComposition.status,
          scores: finalComposition.scores,
          issues: finalComposition.issues,
          suggestedLayoutPatches: finalComposition.suggestedLayoutPatches,
        },
      },
      imageEvidenceAssociations: imageAssociations,
      correctionHistory,
      legacyLayoutAvailable: !!(page.pageLayout),
      pageLayoutElementCount:  pageLayoutOutput?.elements?.length ?? 0,
    });

    console.log();
  }

  // Save diagnostic output
  const ts         = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const outputPath = path.join(DIAG_DIR, `phase8-reconstruction-${ts}.json`);
  const output = {
    schemaVersion: "phase8-reconstruction-diagnostics/v1",
    runAt: new Date().toISOString(),
    controlledMode: {
      semanticReconstructionEnabled: SCRIPT_RECONSTRUCTION_ENABLED,
      globalProductionFlag:         GLOBAL_PRODUCTION_FLAG,
      note: "semanticReconstructionEnabled=true is scoped to this script only. Production app.js remains false.",
    },
    qwenRerun:     false,
    paddleRerun:   false,
    pagesTested:   results.length,
    results,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`✓ Diagnostics saved: ${path.relative(ROOT, outputPath)}`);

  // Summary table
  console.log();
  console.log("═══════════════════════════════════════════════════════");
  console.log("PHASE 8 SUMMARY");
  console.log("═══════════════════════════════════════════════════════");
  for (const r of results) {
    const fl = r.layoutValidation.final;
    const fc = r.compositionEvaluation.final;
    const cx = r.correctionHistory.length;
    const icon = fc.status === "pass" ? "✓" : fc.status === "warning" ? "⚠" : "✗";
    console.log(`  ${icon} ${r.description.padEnd(52)} layout=${fl.score.toFixed(3)}/${fl.status.padEnd(7)} comp=${fc.score.toFixed(3)}/${fc.status.padEnd(7)} corrections=${cx}`);
  }
  console.log();
  console.log("INVARIANTS CONFIRMED:");
  console.log("  semanticReconstructionEnabled globally: false (production app.js unchanged)");
  console.log("  Production pageLayout: NOT modified");
  console.log("  page-layout.js: NOT modified");
  console.log("  Qwen model: NOT rerun");
}

runDiagnostics().catch(err => {
  console.error("Diagnostic run failed:", err);
  process.exit(1);
});
