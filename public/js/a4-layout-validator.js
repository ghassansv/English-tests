/**
 * a4-layout-validator.js
 *
 * Phase 7 — Semantic A4 Layout Resolution
 *
 * Validates a ResolvedA4LayoutModel structurally against its SemanticPageModel.
 * Does NOT perform pixel-level visual comparison.
 *
 * Output schema: a4-layout-validation/v1
 */

export const A4_LAYOUT_VALIDATION_SCHEMA_VERSION = "a4-layout-validation/v1";

const A4_WIDTH  = 794;
const A4_HEIGHT = 1123;

const SCORE_WEIGHTS = Object.freeze({
  semanticCoverage:    0.30,
  readingOrder:        0.15,
  geometryIntegrity:   0.20,
  groupIntegrity:      0.10,
  columnIntegrity:     0.10,
  typographyHierarchy: 0.08,
  imageIntegrity:      0.07,
});

const RENDERABLE_TEXT_TYPES = new Set([
  "title", "heading", "subheading", "instructions", "paragraph",
  "question", "option", "answerGap", "footer", "pageNumber", "caption",
]);

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Validate a ResolvedA4LayoutModel against its source SemanticPageModel.
 *
 * @param {object} resolved    - ResolvedA4LayoutModel (schema: resolved-a4-layout/v1)
 * @param {object} semanticPage - SemanticPageModel (schema: semantic-page/v1)
 * @returns {object} a4-layout-validation/v1 report
 */
export function validateResolvedA4Layout(resolved, semanticPage) {
  if (!resolved || resolved.schemaVersion !== "resolved-a4-layout/v1") {
    return failureReport("invalid-resolved-layout");
  }
  if (!semanticPage || typeof semanticPage !== "object") {
    return failureReport("invalid-semantic-page");
  }

  const issues = [];
  const scores = {
    semanticCoverage:    checkSemanticCoverage(resolved, semanticPage, issues),
    readingOrder:        checkReadingOrder(resolved, semanticPage, issues),
    geometryIntegrity:   checkGeometryIntegrity(resolved, issues),
    groupIntegrity:      checkGroupIntegrity(resolved, semanticPage, issues),
    columnIntegrity:     checkColumnIntegrity(resolved, issues),
    typographyHierarchy: checkTypographyHierarchy(resolved, semanticPage, issues),
    imageIntegrity:      checkImageIntegrity(resolved, semanticPage, issues),
  };

  const score  = weightedScore(scores);
  const status = computeStatus(score, issues);
  const suggestedConstraintPatches = suggestPatches(issues);

  return {
    schemaVersion: A4_LAYOUT_VALIDATION_SCHEMA_VERSION,
    status,
    score:  Math.round(score * 1000) / 1000,
    scores,
    issues,
    suggestedConstraintPatches,
  };
}

// ============================================================
// CHECK: SEMANTIC COVERAGE
// ============================================================

function checkSemanticCoverage(resolved, semanticPage, issues) {
  const semanticTexts = (semanticPage.elements || []).filter(el =>
    RENDERABLE_TEXT_TYPES.has(el.type) && el.text
  );
  if (!semanticTexts.length) return 1.0;

  const layoutIds = new Set(
    (resolved.elements || []).map(el => el.semanticElementId).filter(Boolean)
  );

  let missing = 0;
  for (const el of semanticTexts) {
    if (!layoutIds.has(el.id)) {
      issues.push({
        type: "missing-semantic-element",
        severity: "major",
        message: `Semantic element ${el.id} (${el.type}) is not represented in the resolved layout`,
        semanticElementId: el.id,
      });
      missing++;
    }
  }

  // Check for duplicated text content
  const seenTexts = new Map();
  for (const el of (resolved.elements || [])) {
    if (el.text) {
      const key = el.text.trim().toLowerCase().slice(0, 80);
      seenTexts.set(key, (seenTexts.get(key) || 0) + 1);
    }
  }
  const dupeCount = [...seenTexts.values()].filter(c => c > 1).length;
  if (dupeCount) {
    issues.push({
      type: "duplicate-text",
      severity: "warning",
      message: `${dupeCount} text fragment(s) appear more than once in the resolved layout`,
      count: dupeCount,
    });
  }

  return Math.max(0, 1 - missing / semanticTexts.length);
}

// ============================================================
// CHECK: READING ORDER
// ============================================================

function checkReadingOrder(resolved, semanticPage, issues) {
  const semOrder = semanticPage.readingOrder || [];
  if (semOrder.length < 2) return 1.0;

  const elMap = new Map(
    (resolved.elements || []).map(el => [el.semanticElementId, el])
  );

  let violations = 0, compared = 0;

  for (let i = 0; i < semOrder.length - 1; i++) {
    const a = elMap.get(semOrder[i]);
    const b = elMap.get(semOrder[i + 1]);
    if (!a || !b) continue;

    // In the same column (similar x): later in reading order must be at same or lower y
    const sameColumn = Math.abs(a.x - b.x) < 40;
    if (sameColumn && b.y < a.y - 4) {
      violations++;
      issues.push({
        type: "reading-order-violation",
        severity: "minor",
        message: `Reading order violated between ${semOrder[i]} (y=${a.y}) and ${semOrder[i + 1]} (y=${b.y})`,
        elementIds: [semOrder[i], semOrder[i + 1]],
      });
    }
    compared++;
  }

  return compared ? Math.max(0, 1 - violations / compared) : 1.0;
}

// ============================================================
// CHECK: GEOMETRY INTEGRITY
// ============================================================

function checkGeometryIntegrity(resolved, issues) {
  const elements = resolved.elements || [];
  let problems = 0;

  for (const el of elements) {
    if (el.width <= 0 || el.height <= 0) {
      issues.push({
        type: "invalid-dimensions",
        severity: "major",
        message: `Element ${el.id} has zero or negative dimensions (${el.width}×${el.height})`,
        elementId: el.id,
      });
      problems++;
    }
    if (el.x < -2 || el.y < -2) {
      issues.push({
        type: "out-of-bounds",
        severity: "warning",
        message: `Element ${el.id} has negative coordinates (x=${el.x}, y=${el.y})`,
        elementId: el.id,
      });
      problems++;
    }
    if (el.x + el.width > A4_WIDTH + 4) {
      issues.push({
        type: "clipping-x",
        severity: "warning",
        message: `Element ${el.id} extends beyond page width (right=${el.x + el.width})`,
        elementId: el.id,
      });
      problems++;
    }
    if (el.y + el.height > A4_HEIGHT + 4) {
      issues.push({
        type: "clipping-y",
        severity: "warning",
        message: `Element ${el.id} extends beyond page height (bottom=${el.y + el.height})`,
        elementId: el.id,
      });
      problems++;
    }
  }

  // Check text element overlaps
  const textEls = elements.filter(el => el.pageLayoutType === "text" || el.type === "text");
  const overlapCount = countOverlappingPairs(textEls);
  if (overlapCount) {
    issues.push({
      type: "element-overlap",
      severity: "warning",
      message: `${overlapCount} text element pair(s) overlap in the resolved layout`,
      count: overlapCount,
    });
    problems += overlapCount;
  }

  return Math.max(0, 1 - problems / Math.max(1, elements.length));
}

function countOverlappingPairs(elements) {
  let count = 0;
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      if (rectsOverlap(elements[i], elements[j])) count++;
    }
  }
  return count;
}

function rectsOverlap(a, b) {
  return !(a.x + a.width  <= b.x || b.x + b.width  <= a.x ||
           a.y + a.height <= b.y || b.y + b.height <= a.y);
}

// ============================================================
// CHECK: GROUP INTEGRITY (question–option cohesion)
// ============================================================

function checkGroupIntegrity(resolved, semanticPage, issues) {
  const optionOfRels = (semanticPage.relationships || []).filter(r => r.type === "optionOf");
  if (!optionOfRels.length) return 1.0;

  const elMap = new Map(
    (resolved.elements || []).map(el => [el.semanticElementId, el])
  );

  let violations = 0;
  for (const rel of optionOfRels) {
    const qEl  = elMap.get(rel.to);
    const optEl = elMap.get(rel.from);
    if (!qEl || !optEl) continue;

    const maxAllowedGap = qEl.height + 100;
    if (optEl.y > qEl.y + qEl.height + maxAllowedGap) {
      issues.push({
        type: "question-option-separation",
        severity: "warning",
        message: `Option ${rel.from} (y=${optEl.y}) is separated too far from question ${rel.to} (bottom=${qEl.y + qEl.height})`,
        elementIds: [rel.from, rel.to],
      });
      violations++;
    }
  }

  return Math.max(0, 1 - violations / optionOfRels.length);
}

// ============================================================
// CHECK: COLUMN INTEGRITY
// ============================================================

function checkColumnIntegrity(resolved, issues) {
  const els = resolved.elements || [];
  if (els.length < 3) return 1.0;

  // Detect if a multi-column layout is present
  const xValues = els.map(el => el.x);
  const minX = Math.min(...xValues), maxX = Math.max(...xValues);
  if (maxX - minX < 100) return 1.0; // effectively single column

  const midX = minX + (maxX - minX) / 2;
  const leftEls  = els.filter(el => el.x < midX);
  const rightEls = els.filter(el => el.x >= midX);

  let violations = 0;
  const checkFlow = (colEls, colName) => {
    const sorted = [...colEls].sort((a, b) => a.y - b.y);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i + 1].y < sorted[i].y - 4) {
        violations++;
        issues.push({
          type: "column-flow-violation",
          severity: "minor",
          message: `${colName} column: ${sorted[i + 1].id} (y=${sorted[i + 1].y}) appears above ${sorted[i].id} (y=${sorted[i].y})`,
        });
      }
    }
  };
  checkFlow(leftEls,  "left");
  checkFlow(rightEls, "right");

  return violations === 0 ? 1.0 : Math.max(0.5, 1 - violations / Math.max(leftEls.length, rightEls.length));
}

// ============================================================
// CHECK: TYPOGRAPHY HIERARCHY
// ============================================================

function checkTypographyHierarchy(resolved, semanticPage, issues) {
  const semIndex = new Map((semanticPage.elements || []).map(el => [el.id, el]));

  const titleEls = (resolved.elements || []).filter(el => {
    const sem = semIndex.get(el.semanticElementId);
    return sem?.type === "title";
  });
  const bodyEls = (resolved.elements || []).filter(el => {
    const sem = semIndex.get(el.semanticElementId);
    return sem?.type === "paragraph";
  });

  if (!titleEls.length || !bodyEls.length) return 1.0;

  const titleSize = titleEls[0].style?.fontSize || 0;
  const bodySize  = bodyEls[0].style?.fontSize  || 0;

  if (titleSize > 0 && bodySize > 0 && titleSize <= bodySize) {
    issues.push({
      type: "typography-hierarchy-violation",
      severity: "warning",
      message: `Title font size (${titleSize}px) should be larger than body font size (${bodySize}px)`,
    });
    return 0.5;
  }

  return 1.0;
}

// ============================================================
// CHECK: IMAGE INTEGRITY
// ============================================================

function checkImageIntegrity(resolved, semanticPage, issues) {
  const semImages = (semanticPage.elements || []).filter(el =>
    ["image", "illustration", "table"].includes(el.type)
  );
  if (!semImages.length) return 1.0;

  const layoutIds = new Set(
    (resolved.elements || []).map(el => el.semanticElementId).filter(Boolean)
  );

  let missing = 0;
  for (const img of semImages) {
    if (!layoutIds.has(img.id)) {
      issues.push({
        type: "missing-image-element",
        severity: "major",
        message: `Semantic image element ${img.id} is not represented in the resolved layout`,
        semanticElementId: img.id,
      });
      missing++;
    }
  }

  for (const el of (resolved.elements || [])) {
    if (["image", "illustration"].includes(el.type)) {
      if (el.width <= 0 || el.height <= 0) {
        issues.push({
          type: "image-invalid-dimensions",
          severity: "major",
          message: `Image element ${el.id} has invalid dimensions`,
          elementId: el.id,
        });
      }
    }
  }

  return Math.max(0, 1 - missing / semImages.length);
}

// ============================================================
// SCORE AND STATUS
// ============================================================

function weightedScore(scores) {
  let total = 0, weightSum = 0;
  for (const [key, w] of Object.entries(SCORE_WEIGHTS)) {
    total     += (scores[key] || 0) * w;
    weightSum += w;
  }
  return weightSum > 0 ? total / weightSum : 0;
}

function computeStatus(score, issues) {
  if (issues.some(i => i.severity === "critical")) return "retry";
  if (score < 0.5) return "retry";
  if (issues.some(i => i.severity === "major") || score < 0.75) return "warning";
  return "pass";
}

function suggestPatches(issues) {
  const patches = [];
  if (issues.some(i => i.type === "overflow"))                  patches.push({ type: "reduce-spacing",         reason: "overflow" });
  if (issues.some(i => i.type === "question-option-separation")) patches.push({ type: "increase-group-cohesion", reason: "question-split" });
  if (issues.some(i => i.type === "clipping-y"))                patches.push({ type: "reduce-font-size",        reason: "vertical-clipping" });
  if (issues.some(i => i.type === "column-flow-violation"))     patches.push({ type: "check-column-assignment",  reason: "column-flow" });
  return patches;
}

function failureReport(reason) {
  return {
    schemaVersion: A4_LAYOUT_VALIDATION_SCHEMA_VERSION,
    status: "retry",
    score: 0,
    scores: {
      semanticCoverage: 0, readingOrder: 0, geometryIntegrity: 0,
      groupIntegrity: 0, columnIntegrity: 0, typographyHierarchy: 0, imageIntegrity: 0,
    },
    issues: [{ type: "validation-failed", severity: "critical", message: reason }],
    suggestedConstraintPatches: [],
  };
}
