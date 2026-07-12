/**
 * heuristic-semantic-builder.mjs
 *
 * Phase 8.5 — Build SemanticPageModel from SourceEvidenceModel
 *
 * Pure heuristic analysis — no pageLayout input.
 * Uses OCR evidence (text blocks + bounding boxes) to infer:
 *   - element roles (title, heading, paragraph, question, option, answerGap,
 *                    answerLine, image, footer, pageNumber)
 *   - column assignment (left/right/span)
 *   - band assignment (header/body/footer)
 *   - semantic groups (question ↔ options)
 *   - reading order
 *
 * The resulting SemanticPageModel is schema-valid (semantic-page/v1) and
 * contains NO A4 coordinates — only source-document-plane-normalized bboxes
 * in layoutIntent.sourceBbox.
 *
 * Exports:
 *   buildSemanticPageFromEvidence(sourceEvidence, pageClassification, opts?)
 *   → SemanticPageModel (semantic-page/v1)
 */

import { selectSourceTextLines } from "./source-ocr-evidence-builder.mjs";

export const HEURISTIC_BUILDER_VERSION = "heuristic-semantic-builder/v1";

// ============================================================
// PUBLIC API
// ============================================================

/**
 * @param {object} sourceEvidence     - SourceEvidenceModel (source-evidence/v1)
 * @param {object} pageClassification - Output of classifyPageContent()
 * @param {object} [opts]
 * @param {string} [opts.pageId]
 * @param {string} [opts.testId]
 * @param {number} [opts.pageNumber]
 * @returns {object} SemanticPageModel (semantic-page/v1)
 */
export function buildSemanticPageFromEvidence(sourceEvidence, pageClassification, opts = {}) {
  const textSelection = selectSourceTextLines(sourceEvidence);
  const lines    = textSelection.lines;
  const blocks   = (sourceEvidence?.ocrEvidence?.blocks || []).filter(b => b.text?.trim());
  const imgCandidates = sourceEvidence?.visualEvidence?.imageCandidates || [];

  const columnCount = pageClassification.columnCount || 1;

  // Sort lines top-to-bottom, left-to-right
  const sortedLines = [...lines].sort((a, b) => {
    const dy = (a.bbox?.y || 0) - (b.bbox?.y || 0);
    if (Math.abs(dy) > 0.015) return dy;
    return (a.bbox?.x || 0) - (b.bbox?.x || 0);
  });

  const elements     = [];
  const readingOrder = [];
  const elementGeometry = new Map();
  let   idx          = 0;

  const usedLineIds = new Set();

  // ── IMAGE ELEMENTS ─────────────────────────────────────
  for (const cand of imgCandidates) {
    idx++;
    const el = makeElement(`img-${idx}`, "image", "", idx, {
      band:        inferBandFromY(cand.bbox?.y || 0.5, "image"),
      prominence:  "normal",
      columnRole:  inferColumnRole(cand.bbox, columnCount),
      spansColumns:isBboxWide(cand.bbox, columnCount),
      imageRole:   inferImageRole(cand.bbox),
    }, {
      bbox: cand.bbox,
      sourceEvidenceIds: [cand.id].filter(Boolean),
      confidence: cand.confidence ?? 0.78,
    });
    elementGeometry.set(el.id, cand.bbox || null);
    elements.push(el);
    readingOrder.push(el.id);
  }

  // ── TEXT ELEMENTS ───────────────────────────────────────
  // Group lines by vertical proximity into text-blocks
  const lineGroups = groupLinesByProximity(sortedLines, usedLineIds);

  for (const group of lineGroups) {
    if (!group.length) continue;
    const combinedText = group.map(l => l.text).join(" ").trim();
    if (!combinedText) continue;

    const bbox      = mergeBboxes(group.map(l => l.bbox));
    const role      = inferRole(combinedText, bbox, pageClassification, elements);
    const band      = inferBandFromY(bbox?.y || 0, role);
    const colRole   = inferColumnRole(bbox, columnCount);
    const spansCol  = isBboxWide(bbox, columnCount);

    idx++;
    const el = makeElement(`text-${idx}`, role, combinedText, idx, {
      band, prominence: inferProminence(role, combinedText),
      columnRole: colRole, spansColumns: spansCol,
    }, {
      bbox,
      sourceEvidenceIds: group.map(l => l.id).filter(Boolean),
      confidence: averageConfidence(group),
    });
    elementGeometry.set(el.id, bbox || null);
    elements.push(el);
    readingOrder.push(el.id);

    if (role === "answerGap") {
      idx++;
      const lineEl = makeElement(`text-${idx}`, "answerLine", "", idx, {
        band, prominence: "normal",
        columnRole: colRole, spansColumns: spansCol,
        relativeWidth: "short",
        relativeHeight: "thin",
      }, {
        bbox,
        sourceEvidenceIds: group.map(l => l.id).filter(Boolean),
        confidence: averageConfidence(group),
      });
      elementGeometry.set(lineEl.id, bbox || null);
      elements.push(lineEl);
      readingOrder.push(lineEl.id);
    }
  }

  // Sort final elements by reading order (top→bottom, then left→right)
  elements.sort((a, b) => {
    const aBox = elementGeometry.get(a.id) || {};
    const bBox = elementGeometry.get(b.id) || {};
    const ya = aBox.y || 0;
    const yb = bBox.y || 0;
    const dy = ya - yb;
    if (Math.abs(dy) > 0.015) return dy;
    return (aBox.x || 0) - (bBox.x || 0);
  });
  elements.forEach((el, i) => {
    el.readingOrder = i + 1;
    readingOrder[i] = el.id;
  });

  // ── SEMANTIC GROUPS (questions ↔ options) ───────────────
  const groups        = buildSemanticGroups(elements);
  const relationships = buildRelationships(elements);

  return {
    schemaVersion:    "semantic-page/v1",
    builderVersion:   HEURISTIC_BUILDER_VERSION,
    pageRef: {
      testId:     opts.testId     || "",
      pageId:     opts.pageId     || "",
      pageNumber: opts.pageNumber || 0,
    },
    pageType:   pageClassification.pageType || "article",
    styleHints: {
      columnCount,
      columnsInferred: true,
      inferredBy: "heuristic-x-distribution",
    },
    elements,
    readingOrder: [...readingOrder],
    groups,
    relationships,
    diagnostics: {
      textSelection: textSelection.diagnostics,
    },
    // Provenance
    semanticModelSource:                "real-source-analysis",
    legacyPageLayoutUsedForReconstruction: false,
  };
}

// ============================================================
// ROLE INFERENCE
// ============================================================

const QUESTION_NUM_RE   = /^\s*\d{1,3}\s*[-.)]?\s+\S/;
const OPTION_RE         = /^\s*[A-D]\s*[-.)]\s+\w/;
const BLANK_RE          = /_{4,}/;
const FOOTER_WORDS_RE   = /page|copyright|©|\d{4}|all rights/i;
const EXAM_FOOTER_RE    = /NATIONELLT|\bNATION\b|PROV\s*\||ENGELSKA|DELPROV|VT\s*\d{4}|SEPTEMBER|SEPTEMPER|SEPTEN/i;
const PAGE_NUM_RE       = /^\s*[-–]?\s*\d{1,3}\s*[-–]?\s*$/;
const INSTRUCTION_RE    = /^(read|choose|write|select|answer|complete|look|decide|match|circle|fill|tick|underline)/i;
const HEADING_CAPS_RE   = /^[A-Z][A-Z\s]{4,}$/;

function inferRole(text, bbox, classification, existingElements) {
  const y = bbox?.y || 0;

  // Page number
  if (PAGE_NUM_RE.test(text.trim())) return "pageNumber";

  // Explicit exam footer/header metadata. Keep this before structural checks so
  // footer text such as "6 NATIONELLT ..." is not misread as a question.
  if (y > 0.82 && (EXAM_FOOTER_RE.test(text) || FOOTER_WORDS_RE.test(text))) return "footer";

  // Option (A. B. C. D.)
  if (OPTION_RE.test(text)) return "option";

  // Answer gap (has long underscores in a sentence)
  if (BLANK_RE.test(text) && text.length > 15 && text.split(" ").length > 3) return "answerGap";

  // Answer line (almost entirely underscores)
  const underscoreRatio = (text.match(/_/g) || []).length / text.length;
  if (underscoreRatio > 0.60 && text.length > 4) return "answerLine";

  // Numbered question
  if (isQuestionLine(text)) return "question";

  // Footer zone fallback after structural checks. This allows bottom-of-page
  // questions/options to stay semantic while plain metadata stays footer.
  if (y > 0.90 && text.length < 120) return "footer";

  // Instructions
  if (y < 0.25 && INSTRUCTION_RE.test(text.trim())) return "instructions";

  // Title / Heading by position + capitalisation
  if (y < 0.12 && text.length < 80) return "title";
  if (y < 0.22 && text.length < 60 && HEADING_CAPS_RE.test(text.trim())) return "heading";
  if (y < 0.22 && text.length < 50 && !text.includes(" ") === false
      && /^[A-Z]/.test(text.trim())) return "heading";

  // Paragraph fallback
  return "paragraph";
}

function inferProminence(role, text) {
  if (role === "title")   return "highest";
  if (role === "heading") return text.length < 30 ? "high" : "medium";
  if (role === "footer" || role === "pageNumber") return "low";
  return "normal";
}

function inferBandFromY(y, role) {
  if (role === "footer" || role === "pageNumber") return "footer";
  if (y < 0.08) return "header";
  if (y > 0.90) return "footer";
  return "body";
}

function inferColumnRole(bbox, columnCount) {
  if (columnCount < 2 || !bbox) return "single";
  if (isBboxWide(bbox, columnCount)) return "span";
  return bbox.x < 0.45 ? "left" : "right";
}

function isBboxWide(bbox, columnCount) {
  if (!bbox || columnCount < 2) return false;
  return (bbox.width || 0) > 0.70;
}

function inferImageRole(bbox) {
  if (!bbox) return "column-image";
  const ar = (bbox.width || 1) / (bbox.height || 1);
  if (bbox.y > 0.55 && (bbox.width || 0) > 0.60) return "bottom-spanning-photograph";
  if (ar < 0.90) return "portrait-illustration";
  if (ar > 1.40) return "column-image";
  return "column-image";
}

// ============================================================
// LINE GROUPING
// ============================================================

function groupLinesByProximity(sortedLines, usedLineIds) {
  const VGAP_THRESHOLD = 0.018; // fraction of page height
  const groups = [];
  let   currentGroup = [];

  for (const line of sortedLines) {
    if (usedLineIds.has(line.id)) continue;

    if (!currentGroup.length) {
      currentGroup.push(line);
      continue;
    }

    const prev    = currentGroup[currentGroup.length - 1];
    const prevBot = (prev.bbox?.y  || 0) + (prev.bbox?.height || 0);
    const thisTop = line.bbox?.y || 0;
    const gap     = thisTop - prevBot;

    // New block if gap too large, x-position shifts significantly, or the
    // next line begins a structural unit such as a question/option/answer line.
    const xShift = Math.abs((line.bbox?.x || 0) - (prev.bbox?.x || 0));
    const currentStartsStructural = isStructuralLineStart(line.text);
    const previousWasStandalone = isStandaloneStructuralLine(prev.text);
    if (gap > VGAP_THRESHOLD || xShift > 0.25 || currentStartsStructural || previousWasStandalone) {
      groups.push(currentGroup);
      currentGroup = [line];
    } else {
      currentGroup.push(line);
    }
  }
  if (currentGroup.length) groups.push(currentGroup);
  return groups;
}

// ============================================================
// BBOX HELPERS
// ============================================================

function mergeBboxes(bboxes) {
  const valid = bboxes.filter(Boolean);
  if (!valid.length) return null;
  const x0 = Math.min(...valid.map(b => b.x || 0));
  const y0 = Math.min(...valid.map(b => b.y || 0));
  const x1 = Math.max(...valid.map(b => (b.x || 0) + (b.width || 0)));
  const y1 = Math.max(...valid.map(b => (b.y || 0) + (b.height || 0)));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0,
           coordinateSpace: "source-document-plane-normalized" };
}

// ============================================================
// SEMANTIC GROUPS + RELATIONSHIPS
// ============================================================

function buildSemanticGroups(elements) {
  const groups = [];
  let   currentQ = null;
  let   gIdx     = 0;

  for (const el of elements) {
    if (el.type === "question") {
      if (currentQ) groups.push(currentQ);
      gIdx++;
      currentQ = {
        id:          `qgroup-${gIdx}`,
        type:        "question-with-options",
        questionId:  el.id,
        optionIds:   [],
      };
    } else if (el.type === "option" && currentQ) {
      currentQ.optionIds.push(el.id);
    } else {
      if (currentQ && el.type !== "option") {
        groups.push(currentQ);
        currentQ = null;
      }
    }
  }
  if (currentQ) groups.push(currentQ);
  return groups;
}

function buildRelationships(elements) {
  const rels = [];
  let currentQuestion = null;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.type === "question") {
      currentQuestion = el;
      continue;
    }
    if (el.type === "option" && currentQuestion) {
      rels.push(makeRelationship("optionOf", el.id, currentQuestion.id, 0.9, "nearest-preceding-question"));
      const prev = elements[i - 1];
      if (prev?.type === "question" || prev?.type === "option") {
        rels.push(makeRelationship("follows", prev.id, el.id, 0.82, "reading-order-adjacency"));
      }
      continue;
    }
    if ((el.type === "answerLine" || el.type === "answerGap") && i > 0) {
      const prevQuestion = [...elements.slice(0, i)].reverse().find(e => e.type === "question");
      if (prevQuestion) {
        rels.push(makeRelationship("answerAreaOf", el.id, prevQuestion.id, 0.84, "nearest-preceding-question"));
      }
    }
  }
  return rels;
}

// ============================================================
// ELEMENT FACTORY
// ============================================================

function makeElement(id, type, text, readingOrder, layoutIntent, opts = {}) {
  const el = {
    id,
    type,
    semanticRole: type,
    readingOrder,
    layoutIntent,
    sourceEvidenceIds: Array.isArray(opts.sourceEvidenceIds) ? [...opts.sourceEvidenceIds] : [],
    confidence: normalizeConfidence(opts.confidence ?? 0.76),
  };
  if (text) el.text = text;
  return el;
}

function makeRelationship(type, from, to, confidence = 0.8, reason = "") {
  return {
    id: `rel-${type}-${from}-${to}`,
    type,
    from,
    to,
    confidence: normalizeConfidence(confidence),
    ...(reason ? { reason } : {}),
  };
}

function isStructuralLineStart(text = "") {
  const trimmed = String(text || "").trim();
  return isQuestionLine(trimmed) || OPTION_RE.test(trimmed) || isMostlyAnswerLine(trimmed);
}

function isStandaloneStructuralLine(text = "") {
  const trimmed = String(text || "").trim();
  return OPTION_RE.test(trimmed) || isMostlyAnswerLine(trimmed);
}

function isQuestionLine(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed || EXAM_FOOTER_RE.test(trimmed)) return false;
  const match = trimmed.match(/^(\d{1,3})\s*([.)-])?\s+(.+)$/u);
  if (!match) return /\?\s*$/u.test(trimmed);
  const rest = match[3].trim();
  if (!rest || EXAM_FOOTER_RE.test(rest)) return false;
  if (/^(?:what|why|how|which|when|where|who|whose|do|does|did|is|are|was|were|can|could|would|should)\b/i.test(rest)) return true;
  if (/\?\s*$/u.test(rest)) return true;
  return Boolean(match[2]) &&
    /^[\p{L}"']/u.test(rest) &&
    rest.split(/\s+/).filter(Boolean).length >= 3;
}

function isMostlyAnswerLine(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  const underscores = (trimmed.match(/_/g) || []).length;
  return underscores >= 6 && underscores / Math.max(1, trimmed.replace(/\s/g, "").length) > 0.55;
}

function averageConfidence(items = []) {
  const values = items.map(item => Number(item.confidence)).filter(Number.isFinite);
  if (!values.length) return 0.76;
  return normalizeConfidence(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function normalizeConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.76;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}
