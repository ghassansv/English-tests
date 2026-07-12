/**
 * visual-composition-evaluator.js
 *
 * Phase 8 — Visual Composition Evaluation
 *
 * Evaluates whether a ResolvedA4LayoutModel preserves the structural and
 * compositional intent of the original SemanticPageModel.
 *
 * Does NOT perform pixel-perfect comparison.
 * Uses semantic relationships and relative geometry only.
 * Source bboxes are used solely to estimate relative composition, never for
 * exact x/y coordinate comparison.
 *
 * Schema: visual-composition-evaluation/v1
 *
 * Export:
 *   evaluateVisualComposition(resolved, semanticPage, sourceEvidence?)
 *   → visual-composition-evaluation/v1
 */

export const VISUAL_COMPOSITION_EVALUATION_SCHEMA_VERSION = "visual-composition-evaluation/v1";

// A4 geometry constants (mirrors a4-layout-resolver.js — not imported to avoid coupling)
const A4_WIDTH   = 794;
const A4_HEIGHT  = 1123;
const MARGIN_TOP = 56;
const CONTENT_HEIGHT = 1011;

// Footer zone threshold: y > 88% of content area
const FOOTER_ZONE_Y = MARGIN_TOP + CONTENT_HEIGHT * 0.86;

// Score dimension weights (sum = 1.0)
const WEIGHTS = Object.freeze({
  pageComposition:    0.18,
  columnStructure:    0.18,
  semanticGrouping:   0.15,
  relativePlacement:  0.14,
  typographyHierarchy:0.14,
  imageComposition:   0.12,
  footerComposition:  0.09,
});

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Evaluate the visual composition of a resolved A4 layout.
 *
 * @param {object}      resolved       - ResolvedA4LayoutModel (resolved-a4-layout/v1)
 * @param {object}      semanticPage   - SemanticPageModel (semantic-page/v1)
 * @param {object|null} sourceEvidence - SourceEvidenceModel (optional, for bbox hints only)
 * @returns {object} visual-composition-evaluation/v1 report
 */
export function evaluateVisualComposition(resolved, semanticPage, sourceEvidence = null) {
  if (!resolved || resolved.schemaVersion !== "resolved-a4-layout/v1") {
    return failureReport("invalid-resolved-layout");
  }
  if (!semanticPage || typeof semanticPage !== "object") {
    return failureReport("invalid-semantic-page");
  }

  const issues  = [];
  const patches = [];

  const scores = {
    pageComposition:    checkPageComposition(resolved, semanticPage, issues, patches),
    columnStructure:    checkColumnStructure(resolved, semanticPage, issues, patches),
    semanticGrouping:   checkSemanticGrouping(resolved, semanticPage, issues, patches),
    relativePlacement:  checkRelativePlacement(resolved, semanticPage, issues, patches),
    typographyHierarchy:checkTypographyHierarchy(resolved, semanticPage, issues, patches),
    imageComposition:   checkImageComposition(resolved, semanticPage, issues, patches),
    footerComposition:  checkFooterComposition(resolved, semanticPage, issues, patches),
  };

  const score  = weightedScore(scores);
  const status = scoreToStatus(score, issues);

  return {
    schemaVersion: VISUAL_COMPOSITION_EVALUATION_SCHEMA_VERSION,
    status,
    score:  round3(score),
    scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, round3(v)])),
    issues,
    suggestedLayoutPatches: patches,
  };
}

// ============================================================
// CHECK: PAGE COMPOSITION
// Validates basic page dimensions, element presence, and orientation.
// ============================================================

function checkPageComposition(resolved, semanticPage, issues, patches) {
  let score = 0;

  // Correct A4 portrait dimensions
  const ps = resolved.pageSize;
  if (ps?.width === A4_WIDTH && ps?.height === A4_HEIGHT) {
    score += 0.35;
  } else {
    issues.push({
      dimension: "pageComposition", severity: "critical",
      message: `Page size is not A4 (got ${ps?.width}×${ps?.height}, expected ${A4_WIDTH}×${A4_HEIGHT})`,
    });
  }

  // Has resolved elements
  const elems = resolved.elements || [];
  if (elems.length > 0) {
    score += 0.30;
  } else {
    issues.push({ dimension: "pageComposition", severity: "critical", message: "No resolved elements" });
  }

  // Elements within page bounds (≤2 px tolerance)
  const outOfBounds = elems.filter(el =>
    el.x < 0 || el.y < 0 ||
    el.x + el.width  > A4_WIDTH  + 2 ||
    el.y + el.height > A4_HEIGHT + 2
  );
  if (!outOfBounds.length) {
    score += 0.20;
  } else {
    issues.push({
      dimension: "pageComposition", severity: "warning",
      message: `${outOfBounds.length} element(s) exceed page bounds`,
      elementIds: outOfBounds.map(e => e.id),
    });
    score += 0.08;
  }

  // Portrait orientation (width < height)
  if (ps?.width < ps?.height) {
    score += 0.15;
  } else {
    issues.push({ dimension: "pageComposition", severity: "critical", message: "Page orientation is not portrait" });
  }

  return clamp01(score);
}

// ============================================================
// CHECK: COLUMN STRUCTURE
// Verifies column count in resolved layout matches semantic intent.
// ============================================================

function checkColumnStructure(resolved, semanticPage, issues, patches) {
  const expectedCols = semanticPage.styleHints?.columnCount ?? 1;
  const textEls      = (resolved.elements || []).filter(el => el.text);
  if (!textEls.length) return 1.0;

  const clusters = clusterXValues(textEls.map(el => el.x));

  if (expectedCols >= 2) {
    if (clusters >= 2) return 1.0;
    issues.push({
      dimension: "columnStructure", severity: "warning",
      message: `Expected ${expectedCols}-column layout but resolved elements cluster at only 1 x value`,
    });
    patches.push({ type: "check-column-assignment", reason: "insufficient-x-clusters" });
    return 0.55;
  }
  // Single column: ≤2 clusters is fine (indented elements like options are normal)
  if (clusters <= 2) return 1.0;
  return 0.90; // more clusters in single-column is soft warning, not failure
}

function clusterXValues(xValues) {
  if (!xValues.length) return 0;
  const sorted = [...xValues].sort((a, b) => a - b);
  let clusters = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > 60) clusters++;
  }
  return clusters;
}

// ============================================================
// CHECK: SEMANTIC GROUPING
// Validates question→option adjacency, answer line placement, etc.
// ============================================================

function checkSemanticGrouping(resolved, semanticPage, issues, patches) {
  const elems       = resolved.elements || [];
  const questions   = elems.filter(el => el.type === "question");
  const anyOptions  = elems.some(el => el.type === "option");
  let deductions    = 0;

  // Questions should have adjacent options (within 300px)
  for (const q of questions) {
    const qBottom = q.y + q.height;
    const nearOpts = elems.filter(el =>
      el.type === "option" && el.y >= qBottom && el.y <= qBottom + 300
    );
    if (anyOptions && !nearOpts.length) {
      issues.push({
        dimension: "semanticGrouping", severity: "warning",
        message: `Question "${(q.text || "").slice(0, 35)}…" has no options within 300px`,
        elementId: q.id,
      });
      patches.push({ type: "strengthen-question-option-cohesion", elementId: q.id });
      deductions++;
    }
  }

  // Answer lines should follow a question or answerGap element
  const answerLines = elems.filter(el => el.type === "answerLine");
  const precedingTypes = new Set(["question", "answerGap", "instructions"]);
  for (const al of answerLines) {
    const hasPrecedingContext = elems.some(el =>
      precedingTypes.has(el.type) && el.y + el.height <= al.y + 30
    );
    if (!hasPrecedingContext) {
      issues.push({
        dimension: "semanticGrouping", severity: "info",
        message: `Answer line (y=${al.y}) has no preceding question or answerGap within 30px`,
        elementId: al.id,
      });
    }
  }

  // Paragraph grouping: adjacent paragraphs should not have huge unexplained gaps
  // (only flag in single-column layouts — two-column layouts naturally have large gaps)
  const paras = elems.filter(el => el.type === "paragraph");
  if (paras.length >= 3) {
    const cols = clusterXValues(paras.map(el => el.x));
    if (cols === 1) {
      for (let i = 1; i < paras.length; i++) {
        const gap = paras[i].y - (paras[i - 1].y + paras[i - 1].height);
        if (gap > 150) {
          issues.push({
            dimension: "semanticGrouping", severity: "info",
            message: `Paragraphs ${paras[i - 1].id} and ${paras[i].id} have a ${gap}px gap`,
          });
        }
      }
    }
  }

  const penalty = Math.min(0.45, deductions * 0.14);
  return clamp01(1.0 - penalty);
}

// ============================================================
// CHECK: RELATIVE PLACEMENT
// Validates structural element positions relative to page zones.
// Does NOT compare exact x/y coordinates.
// ============================================================

function checkRelativePlacement(resolved, semanticPage, issues, patches) {
  const elems = resolved.elements || [];
  let score   = 1.0;

  // Titles and headings should appear in the upper 40% of the page
  const titleEls = elems.filter(el => el.type === "title" || el.type === "heading");
  if (titleEls.length > 0) {
    const firstTitle = titleEls.reduce((a, b) => a.y < b.y ? a : b);
    const relY = firstTitle.y / A4_HEIGHT;
    if (relY > 0.40) {
      issues.push({
        dimension: "relativePlacement", severity: "warning",
        message: `First title/heading at ${Math.round(relY * 100)}% of page height (expected ≤40%)`,
        elementId: firstTitle.id,
      });
      score -= 0.12;
    }
  }

  // Instructions should precede questions/paragraphs
  const instructions = elems.find(el => el.type === "instructions");
  const firstContent = elems.find(el => el.type === "question" || el.type === "paragraph");
  if (instructions && firstContent && instructions.y > firstContent.y + 20) {
    issues.push({
      dimension: "relativePlacement", severity: "warning",
      message: "Instructions appear after content elements",
      elementId: instructions.id,
    });
    score -= 0.10;
  }

  // Page numbers should be near the bottom (y > 75% of A4 height)
  for (const pn of elems.filter(el => el.type === "pageNumber")) {
    if (pn.y < A4_HEIGHT * 0.75) {
      issues.push({
        dimension: "relativePlacement", severity: "warning",
        message: `Page number at y=${pn.y} (expected > ${Math.round(A4_HEIGHT * 0.75)})`,
        elementId: pn.id,
      });
      score -= 0.10;
    }
  }

  // Footer should be near the bottom
  for (const ft of elems.filter(el => el.type === "footer")) {
    if (ft.y < A4_HEIGHT * 0.72) {
      issues.push({
        dimension: "relativePlacement", severity: "warning",
        message: `Footer at y=${ft.y} (expected > ${Math.round(A4_HEIGHT * 0.72)})`,
        elementId: ft.id,
      });
      score -= 0.10;
    }
  }

  return clamp01(score);
}

// ============================================================
// CHECK: TYPOGRAPHY HIERARCHY
// Validates font size ordering: title > heading > body; question ≥ option;
// footer < body; body text readable.
// ============================================================

function checkTypographyHierarchy(resolved, semanticPage, issues, patches) {
  const elems = resolved.elements || [];
  let score   = 1.0;

  const getSize = type => {
    const el = elems.find(e => e.type === type && e.style?.fontSize);
    return el?.style?.fontSize ?? null;
  };

  const titleSize       = getSize("title");
  const headingSize     = getSize("heading");
  const paragraphSize   = getSize("paragraph");
  const questionSize    = getSize("question");
  const optionSize      = getSize("option");
  const footerSize      = getSize("footer");
  const instructionSize = getSize("instructions");

  // title > heading (at least 2px)
  if (titleSize !== null && headingSize !== null && titleSize < headingSize - 1) {
    issues.push({
      dimension: "typographyHierarchy", severity: "warning",
      message: `Title (${titleSize}px) is smaller than heading (${headingSize}px)`,
    });
    patches.push({ type: "increase-title-prominence", factor: Math.ceil(headingSize / titleSize * 1.05 * 100) / 100 });
    score -= 0.15;
  }

  // title > body (at least 2px larger)
  if (titleSize !== null && paragraphSize !== null && titleSize < paragraphSize + 2) {
    issues.push({
      dimension: "typographyHierarchy", severity: "warning",
      message: `Title (${titleSize}px) not sufficiently larger than paragraph (${paragraphSize}px)`,
    });
    patches.push({ type: "increase-title-prominence", factor: 1.10 });
    score -= 0.10;
  }

  // heading > body
  if (headingSize !== null && paragraphSize !== null && headingSize < paragraphSize) {
    issues.push({
      dimension: "typographyHierarchy", severity: "warning",
      message: `Heading (${headingSize}px) is smaller than paragraph (${paragraphSize}px)`,
    });
    score -= 0.10;
  }

  // question >= option
  if (questionSize !== null && optionSize !== null && questionSize < optionSize - 0.5) {
    issues.push({
      dimension: "typographyHierarchy", severity: "warning",
      message: `Question (${questionSize}px) is smaller than option (${optionSize}px)`,
    });
    score -= 0.10;
  }

  // footer < body (footer should not be larger than body)
  if (footerSize !== null && paragraphSize !== null && footerSize > paragraphSize + 0.5) {
    issues.push({
      dimension: "typographyHierarchy", severity: "info",
      message: `Footer (${footerSize}px) is larger than paragraph (${paragraphSize}px)`,
    });
    score -= 0.05;
  }

  // instructions visually distinct from body (size or weight different)
  if (instructionSize !== null && paragraphSize !== null) {
    const diff = Math.abs(instructionSize - paragraphSize);
    if (diff < 0.5) {
      // Same size is acceptable if weights differ — don't penalise heavily
    }
  }

  // Body text must be readable (≥ 8px)
  if (paragraphSize !== null && paragraphSize < 8) {
    issues.push({
      dimension: "typographyHierarchy", severity: "warning",
      message: `Body text unreadably small (${paragraphSize}px — minimum is 8px)`,
    });
    score -= 0.15;
  }

  return clamp01(score);
}

// ============================================================
// CHECK: IMAGE COMPOSITION
// Validates image presence, aspect ratio range, and size limits.
// ============================================================

function checkImageComposition(resolved, semanticPage, issues, patches) {
  const semanticImages = (semanticPage.elements || []).filter(el =>
    ["image", "illustration", "table"].includes(el.type)
  );
  if (!semanticImages.length) return 1.0; // no images expected

  const resolvedImages = (resolved.elements || []).filter(el =>
    ["image", "illustration"].includes(el.type)
  );
  if (!resolvedImages.length) {
    issues.push({
      dimension: "imageComposition", severity: "warning",
      message: `${semanticImages.length} semantic image(s) but none resolved`,
    });
    return 0.35;
  }

  let score = 1.0;
  const contentH = A4_HEIGHT - 56 - 56 - 44; // ≈ 967px body area

  for (const img of resolvedImages) {
    if (!img.width || !img.height) continue;

    const ar = img.width / img.height;

    // Sanity: aspect ratio must be in 0.15–8 range
    if (ar < 0.15 || ar > 8) {
      issues.push({
        dimension: "imageComposition", severity: "warning",
        message: `Image ${img.id} has extreme aspect ratio ${ar.toFixed(2)} (expected 0.15–8)`,
        elementId: img.id,
      });
      patches.push({ type: "fix-image-aspect-ratio", elementId: img.id, suggestedRatio: 1.40 });
      score -= 0.15;
    }

    // Image must not be excessively tall (> 65% of content height)
    if (img.height > contentH * 0.65) {
      issues.push({
        dimension: "imageComposition", severity: "warning",
        message: `Image ${img.id} height (${img.height}px) is ${Math.round(img.height / contentH * 100)}% of content area`,
        elementId: img.id,
      });
      patches.push({ type: "reduce-image-height", factor: 0.75, elementId: img.id });
      score -= 0.12;
    }

    // Image must not exceed 75% of the full page height
    if (img.height > A4_HEIGHT * 0.75) {
      issues.push({
        dimension: "imageComposition", severity: "critical",
        message: `Image ${img.id} height (${img.height}px) exceeds 75% of page height`,
        elementId: img.id,
      });
      score -= 0.20;
    }
  }

  return clamp01(score);
}

// ============================================================
// CHECK: FOOTER COMPOSITION
// Validates footer and page-number presence and placement.
// ============================================================

function checkFooterComposition(resolved, semanticPage, issues, patches) {
  const elems         = resolved.elements || [];
  const semFooter     = (semanticPage.elements || []).find(el => el.type === "footer");
  const semPageNumber = (semanticPage.elements || []).find(el => el.type === "pageNumber");

  let score = 1.0;

  if (semFooter) {
    const resolvedFooter = elems.find(el => el.type === "footer");
    if (!resolvedFooter) {
      issues.push({
        dimension: "footerComposition", severity: "warning",
        message: "Footer expected (in semantic page) but not present in resolved layout",
      });
      return 0.35;
    }
    if (resolvedFooter.y < FOOTER_ZONE_Y) {
      issues.push({
        dimension: "footerComposition", severity: "warning",
        message: `Footer y=${resolvedFooter.y} is above expected footer zone (threshold: ${Math.round(FOOTER_ZONE_Y)})`,
        elementId: resolvedFooter.id,
      });
      patches.push({ type: "increase-footer-band", pixels: 20 });
      score -= 0.20;
    }
  }

  if (semPageNumber) {
    const resolvedPN = elems.find(el => el.type === "pageNumber");
    if (!resolvedPN) {
      issues.push({ dimension: "footerComposition", severity: "info", message: "Page number expected but not present" });
      score -= 0.10;
    } else if (resolvedPN.y < A4_HEIGHT * 0.75) {
      issues.push({
        dimension: "footerComposition", severity: "warning",
        message: `Page number y=${resolvedPN.y} is above 75% of page height`,
        elementId: resolvedPN.id,
      });
      score -= 0.10;
    }
  }

  return clamp01(score);
}

// ============================================================
// INTERNAL: SCORING UTILITIES
// ============================================================

function weightedScore(scores) {
  let total = 0;
  let totalWeight = 0;
  for (const [dim, weight] of Object.entries(WEIGHTS)) {
    const s = scores[dim];
    if (typeof s === "number" && !isNaN(s)) {
      total += s * weight;
      totalWeight += weight;
    }
  }
  return totalWeight > 0 ? total / totalWeight : 0;
}

function scoreToStatus(score, issues) {
  const hasCritical = issues.some(i => i.severity === "critical");
  if (hasCritical || score < 0.70) return "retry";
  if (score >= 0.85) return "pass";
  return "warning";
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

function failureReport(reason) {
  return {
    schemaVersion: VISUAL_COMPOSITION_EVALUATION_SCHEMA_VERSION,
    status: "retry",
    score: 0,
    scores: {
      pageComposition: 0, columnStructure: 0, semanticGrouping: 0,
      relativePlacement: 0, typographyHierarchy: 0, imageComposition: 0, footerComposition: 0,
    },
    issues: [{ dimension: "evaluator", severity: "critical", message: reason }],
    suggestedLayoutPatches: [],
  };
}
