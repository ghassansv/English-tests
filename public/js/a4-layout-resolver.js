/**
 * a4-layout-resolver.js
 *
 * Phase 7 — Semantic A4 Layout Resolution
 *
 * Resolves a SemanticPageModel into a clean ResolvedA4LayoutModel suitable for
 * rendering through the existing page-layout.js renderer.
 *
 * Design constraints:
 *   - SemanticPageModel MUST remain coordinate-free (no x/y/width/height added to it)
 *   - Source bboxes are used only as hints for aspect ratio and relative prominence
 *   - No direct normalized-bbox → A4 coordinate mapping is performed
 *   - Layout is hierarchical: PAGE → BANDS → SECTIONS → COLUMN GROUPS → ELEMENTS
 *   - Text measurement uses deterministic character-width approximation (no DOM required)
 *   - Works in browser and Node.js test contexts
 *
 * Exports:
 *   resolveSemanticPageToA4()          - main resolver
 *   runBoundedLayoutCorrectionLoop()   - retry loop with constraint patching
 *   convertResolvedA4ToPageLayout()    - converts to page-layout.js format
 *   validateResolvedA4Layout()         - structural validation (re-exported from validator)
 *   measureTextHeight()                - public text measurement helper
 */

import { createTextMeasurementProvider } from "./text-measurement-provider.js";

export const RESOLVED_A4_LAYOUT_SCHEMA_VERSION = "resolved-a4-layout/v1";
export const A4_LAYOUT_RESOLVER_VERSION = "a4-layout-resolver/v1";

// Module-level singleton text provider (lazy-initialized)
let _defaultTextProvider = null;
function getDefaultTextProvider() {
  if (!_defaultTextProvider) _defaultTextProvider = createTextMeasurementProvider();
  return _defaultTextProvider;
}

// ============================================================
// A4 PAGE GEOMETRY (794 × 1123 px at 96 dpi)
// ============================================================

const A4_WIDTH = 794;
const A4_HEIGHT = 1123;
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 56;
const MARGIN_LEFT = 64;
const MARGIN_RIGHT = 64;
const CONTENT_WIDTH = A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;   // 666 px
const CONTENT_HEIGHT = A4_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM; // 1011 px
const FOOTER_RESERVED = 44;   // pixels reserved for footer band at bottom of content area
const COLUMN_GAP = 20;
const SECTION_GAP = 14;       // gap between major sections
const PARAGRAPH_GAP = 8;      // gap between paragraphs
const QUESTION_INNER_GAP = 4; // gap between question text and its options
const OPTION_GAP = 3;         // gap between consecutive option lines
const MIN_ELEMENT_HEIGHT = 6;
const MAX_CORRECTION_ITERATIONS = 4;

// ============================================================
// TYPOGRAPHY DEFAULTS
// ============================================================

const TYPOGRAPHY_DEFAULTS = Object.freeze({
  title:        { fontSize: 22, fontWeight: "bold",   lineHeight: 1.35, align: "center" },
  heading:      { fontSize: 18, fontWeight: "bold",   lineHeight: 1.4,  align: "left"   },
  subheading:   { fontSize: 15, fontWeight: "bold",   lineHeight: 1.4,  align: "left"   },
  instructions: { fontSize: 13, fontWeight: "normal", lineHeight: 1.55, align: "left"   },
  paragraph:    { fontSize: 12, fontWeight: "normal", lineHeight: 1.6,  align: "left"   },
  question:     { fontSize: 12, fontWeight: "bold",   lineHeight: 1.5,  align: "left"   },
  option:       { fontSize: 12, fontWeight: "normal", lineHeight: 1.5,  align: "left"   },
  answerGap:    { fontSize: 12, fontWeight: "normal", lineHeight: 1.5,  align: "left"   },
  answerLine:   { fontSize: 0,  fontWeight: "normal", lineHeight: 1.0,  align: "left",  fixedHeight: 18 },
  caption:      { fontSize: 10, fontWeight: "italic", lineHeight: 1.4,  align: "center" },
  footer:       { fontSize: 10, fontWeight: "normal", lineHeight: 1.3,  align: "left"   },
  pageNumber:   { fontSize: 10, fontWeight: "normal", lineHeight: 1.3,  align: "right"  },
  separator:    { fontSize: 0,  fontWeight: "normal", lineHeight: 1.0,  align: "left",  fixedHeight: 8  },
  image:        { fontSize: 0,  fontWeight: "normal", lineHeight: 1.0,  align: "center" },
  illustration: { fontSize: 0,  fontWeight: "normal", lineHeight: 1.0,  align: "center" },
  table:        { fontSize: 0,  fontWeight: "normal", lineHeight: 1.0,  align: "left"   },
  box:          { fontSize: 0,  fontWeight: "normal", lineHeight: 1.0,  align: "left",  fixedHeight: 24 },
});

// Prominence multipliers for font-size scaling
const PROMINENCE_FACTORS = Object.freeze({
  highest: 1.25,
  high:    1.12,
  medium:  1.06,
  normal:  1.0,
  low:     0.88,
});

// Minimum font sizes enforced during overflow resolution
const MIN_FONT_SIZES = Object.freeze({
  title:        14,
  heading:      12,
  subheading:   11,
  instructions: 9,
  paragraph:    8,
  question:     8,
  option:       8,
  answerGap:    8,
  caption:      7,
  footer:       7,
  pageNumber:   7,
});

// Types rendered by page-layout.js
const RENDERABLE_TYPES = new Set([
  "title", "heading", "subheading", "instructions", "paragraph",
  "question", "option", "answerGap", "answerLine",
  "image", "illustration", "table",
  "caption", "footer", "pageNumber",
  "separator", "box",
]);

// pageLayout renderer type mapping
const PAGE_LAYOUT_TYPE_MAP = Object.freeze({
  title: "text", heading: "text", subheading: "text", instructions: "text",
  paragraph: "text", question: "text", option: "text", answerGap: "text",
  answerLine: "line",
  caption: "text", footer: "text", pageNumber: "text",
  separator: "line",
  image: "image", illustration: "image", table: "image",
  box: "box",
});

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Resolve a SemanticPageModel into a ResolvedA4LayoutModel.
 *
 * The SemanticPageModel is never modified. A4 coordinates exist only in the
 * returned ResolvedA4LayoutModel, never in the SemanticPageModel.
 *
 * Source bbox coordinates are NOT directly mapped to A4 geometry. They are
 * used only to infer image aspect ratios from source evidence.
 */
export function resolveSemanticPageToA4({ semanticPage, sourceEvidence = null, options = {} } = {}) {
  if (!semanticPage || typeof semanticPage !== "object") {
    return nullResolvedLayout("invalid-semantic-page");
  }
  const ctx = buildLayoutContext(options);
  try {
    const { elements, overflowInfo } = resolveLayout(semanticPage, sourceEvidence, ctx);
    if (overflowInfo) ctx._overflow = overflowInfo;
    const bindings = buildLayoutBindings(elements, semanticPage);
    const diagnostics = collectLayoutDiagnostics(elements, ctx);
    return {
      schemaVersion: RESOLVED_A4_LAYOUT_SCHEMA_VERSION,
      pageRef: {
        testId:     String(semanticPage.pageRef?.testId  || ""),
        pageId:     String(semanticPage.pageRef?.pageId  || ""),
        pageNumber: semanticPage.pageRef?.pageNumber ?? null,
      },
      pageSize: { width: A4_WIDTH, height: A4_HEIGHT, unit: "px", format: "A4" },
      layoutStrategy: {
        type: "semantic-reconstruction",
        source: "semantic-page-model",
        resolverVersion: A4_LAYOUT_RESOLVER_VERSION,
      },
      elements,
      bindings,
      layoutDiagnostics: diagnostics,
      validation: {},
    };
  } catch (err) {
    return nullResolvedLayout(`resolver-error: ${err?.message || "unknown"}`);
  }
}

/**
 * Convert a ResolvedA4LayoutModel to a pageLayout-compatible object.
 * page-layout.js is NOT modified; this adapter converts output to its schema.
 */
export function convertResolvedA4ToPageLayout(resolved) {
  if (!resolved || resolved.schemaVersion !== RESOLVED_A4_LAYOUT_SCHEMA_VERSION) return null;
  return {
    pageSize: resolved.pageSize,
    elements: (resolved.elements || []).map(el => {
      const out = {
        id:       el.id,
        type:     el.pageLayoutType || el.type,
        x:        el.x,
        y:        el.y,
        width:    el.width,
        height:   el.height,
        rotation: el.rotation || 0,
        zIndex:   el.zIndex   || 0,
      };
      if (el.text    != null) out.text     = el.text;
      if (el.src     != null) out.src      = el.src;
      if (el.style        )   out.style    = el.style;
      if (el.fitMode != null) out.fitMode  = el.fitMode;
      if (el.minFontSize != null) out.minFontSize = el.minFontSize;
      if (el.role    != null) out.role     = el.role;
      return out;
    }),
  };
}

/**
 * Bounded layout correction loop.
 * Runs up to MAX_CORRECTION_ITERATIONS: resolve → validate diagnostics → patch → re-resolve.
 * Deterministic and inexpensive. Does not call any AI model.
 */
export function runBoundedLayoutCorrectionLoop({ semanticPage, sourceEvidence = null, options = {} } = {}) {
  let currentOptions = { ...options };
  let resolved = null;
  for (let i = 0; i < MAX_CORRECTION_ITERATIONS; i++) {
    resolved = resolveSemanticPageToA4({ semanticPage, sourceEvidence, options: currentOptions });
    const issues = resolved.layoutDiagnostics?.issues || [];
    if (!issues.length) break;
    const patches = deriveConstraintPatches(issues);
    if (!patches.length) break;
    currentOptions = applyConstraintPatches(currentOptions, patches);
    resolved.layoutDiagnostics.correctionIteration = i + 1;
    resolved.layoutDiagnostics.patchesApplied = patches;
  }
  return resolved;
}

/**
 * Measure the pixel height a text block will occupy.
 *
 * Uses a character-width approximation model — deterministic, no DOM required.
 * Works identically in browser and Node.js.
 *
 * @param {string} text
 * @param {number} fontSize   - in pixels
 * @param {string} fontWeight - "bold" | "normal" | "italic"
 * @param {number} lineHeight - multiplier (e.g. 1.5)
 * @param {number} availableWidth - in pixels
 * @returns {number} height in pixels
 */
export function measureTextHeight(text, fontSize, fontWeight, lineHeight, availableWidth) {
  if (!text || fontSize <= 0 || availableWidth <= 0) return 0;
  const charWidthFactor = fontWeight === "bold" ? 0.58 : 0.52;
  const avgCharWidth = Math.max(1, fontSize * charWidthFactor);
  const charsPerLine = Math.max(1, Math.floor(availableWidth / avgCharWidth));
  const segments = String(text).split(/\n/);
  const totalLines = segments.reduce((sum, seg) => {
    return sum + Math.max(1, Math.ceil(Math.max(1, seg.length) / charsPerLine));
  }, 0);
  return Math.ceil(totalLines * fontSize * lineHeight);
}

// ============================================================
// INTERNAL: LAYOUT CONTEXT
// ============================================================

function buildLayoutContext(options = {}) {
  const spacingFactor        = clampNum(Number(options.spacingFactor)        || 1.0, 0.45, 1.0);
  const fontSizeFactor       = clampNum(Number(options.fontSizeFactor)       || 1.0, 0.70, 1.2);
  const imageHeightFactor    = clampNum(Number(options.imageHeightFactor)    || 1.0, 0.40, 1.0);
  const titleProminenceFactor= clampNum(Number(options.titleProminenceFactor)|| 1.0, 0.50, 1.5);
  const footerBandExtra      = Math.max(0, Number(options.footerBandExtra)   || 0);
  return {
    contentX:             MARGIN_LEFT,
    contentY:             MARGIN_TOP,
    contentWidth:         CONTENT_WIDTH,
    contentHeight:        CONTENT_HEIGHT,
    footerReserved:       FOOTER_RESERVED + footerBandExtra,
    columnGap:            Math.round(COLUMN_GAP         * spacingFactor),
    sectionGap:           Math.max(4, Math.round(SECTION_GAP    * spacingFactor)),
    paragraphGap:         Math.max(2, Math.round(PARAGRAPH_GAP  * spacingFactor)),
    questionGap:          Math.max(2, Math.round(QUESTION_INNER_GAP * spacingFactor)),
    optionGap:            Math.max(1, Math.round(OPTION_GAP     * spacingFactor)),
    spacingFactor,
    fontSizeFactor,
    imageHeightFactor,
    titleProminenceFactor,
    _textProvider:        options.textMeasurementProvider || getDefaultTextProvider(),
    _overflow:            null,
  };
}

// ============================================================
// INTERNAL: MAIN LAYOUT RESOLUTION
// ============================================================

function resolveLayout(semanticPage, sourceEvidence, ctx) {
  const allElements   = semanticPage.elements  || [];
  const readingOrder  = Array.isArray(semanticPage.readingOrder) ? semanticPage.readingOrder : [];
  const columnCount   = Number(semanticPage.styleHints?.columnCount) || 1;

  // Filter to renderable element types and sort by semantic reading order
  const renderable = sortByReadingOrder(
    allElements.filter(el => RENDERABLE_TYPES.has(el.type)),
    readingOrder,
  );

  const headerEls = renderable.filter(el => el.layoutIntent?.band === "header");
  const footerEls = renderable.filter(el => el.layoutIntent?.band === "footer");
  const bodyEls   = renderable.filter(el => !el.layoutIntent?.band || el.layoutIntent.band === "body");

  const resolved = [];
  let currentY = ctx.contentY;

  // ── HEADER ZONE ──────────────────────────────────────────
  const headerItems = resolveZoneFlow(headerEls, semanticPage, sourceEvidence, ctx, {
    x: ctx.contentX, y: currentY, width: ctx.contentWidth, maxY: Infinity,
  });
  resolved.push(...headerItems);
  if (headerItems.length) {
    const last = headerItems[headerItems.length - 1];
    currentY = last.y + last.height + ctx.sectionGap;
  }

  // ── FOOTER ZONE (anchored at bottom) ────────────────────
  const footerY = ctx.contentY + ctx.contentHeight - ctx.footerReserved;
  const footerItems = resolveZoneFlow(footerEls, semanticPage, sourceEvidence, ctx, {
    x: ctx.contentX, y: footerY, width: ctx.contentWidth, maxY: ctx.contentY + ctx.contentHeight,
  });
  resolved.push(...footerItems);

  // ── BODY ZONE ────────────────────────────────────────────
  const bodyMaxY = footerY - ctx.sectionGap;
  const bodyItems = columnCount >= 2
    ? resolveMultiColumnBody(bodyEls, semanticPage, sourceEvidence, ctx, currentY, bodyMaxY)
    : resolveZoneFlow(bodyEls, semanticPage, sourceEvidence, ctx, {
        x: ctx.contentX, y: currentY, width: ctx.contentWidth, maxY: bodyMaxY,
      });
  resolved.push(...bodyItems);

  // ── OVERFLOW DETECTION ───────────────────────────────────
  let overflowInfo = null;
  if (bodyItems.length) {
    const lastBody = bodyItems[bodyItems.length - 1];
    const endY = lastBody.y + lastBody.height;
    if (endY > bodyMaxY + 2) {
      overflowInfo = { overflowPx: endY - bodyMaxY, bodyEndY: endY, footerY };
    }
  }

  return { elements: resolved, overflowInfo };
}

// ============================================================
// INTERNAL: MULTI-COLUMN BODY
// ============================================================

function resolveMultiColumnBody(bodyEls, semanticPage, sourceEvidence, ctx, startY, maxY) {
  const colWidth = Math.floor((ctx.contentWidth - ctx.columnGap) / 2);
  const leftX    = ctx.contentX;
  const rightX   = ctx.contentX + colWidth + ctx.columnGap;

  const resolved = [];
  let y = startY;
  let segmentLeft = [];
  let segmentRight = [];
  let segmentSingle = [];

  const renderFullWidth = (el) => {
    const typo  = inferTypography(el, ctx);
    const h     = computeElementHeight(el, typo, ctx.contentWidth, sourceEvidence, ctx);
    const built = buildLayoutElement(el, { x: leftX, y, width: ctx.contentWidth, height: h, typo });
    if (["image", "illustration", "table"].includes(el.type)) {
      built.aspectRatioSource = inferImageAspectRatioWithSource(el, sourceEvidence).source;
    }
    resolved.push(built);
    y += h + gapAfter(el, ctx);
  };

  const flushColumnSegment = () => {
    const orderedSingle = sortByReadingOrder(segmentSingle, semanticPage.readingOrder || []);
    if (!segmentLeft.length && !segmentRight.length) {
      for (const el of orderedSingle) renderFullWidth(el);
      segmentSingle = [];
      return;
    }

    for (const el of orderedSingle) renderFullWidth(el);
    segmentSingle = [];

    const colStartY = y;
    const leftItems = resolveZoneFlow(
      sortByReadingOrder(segmentLeft, semanticPage.readingOrder || []),
      semanticPage, sourceEvidence, ctx,
      { x: leftX, y: colStartY, width: colWidth, maxY },
    );
    const rightItems = resolveZoneFlow(
      sortByReadingOrder(segmentRight, semanticPage.readingOrder || []),
      semanticPage, sourceEvidence, ctx,
      { x: rightX, y: colStartY, width: colWidth, maxY },
    );
    resolved.push(...leftItems, ...rightItems);
    const leftEnd  = leftItems.length  ? leftItems[leftItems.length - 1].y   + leftItems[leftItems.length - 1].height   : colStartY;
    const rightEnd = rightItems.length ? rightItems[rightItems.length - 1].y + rightItems[rightItems.length - 1].height : colStartY;
    y = Math.max(leftEnd, rightEnd) + ctx.sectionGap;
    segmentLeft = [];
    segmentRight = [];
  };

  for (const el of sortByReadingOrder(bodyEls, semanticPage.readingOrder || [])) {
    const role = el.layoutIntent?.columnRole || "single";
    const spans = Boolean(el.layoutIntent?.spansColumns || role === "span");
    if (spans) {
      flushColumnSegment();
      renderFullWidth(el);
    } else if (role === "left") {
      segmentLeft.push(el);
    } else if (role === "right") {
      segmentRight.push(el);
    } else {
      segmentSingle.push(el);
    }
  }
  flushColumnSegment();

  return resolved;
}

// ============================================================
// INTERNAL: VERTICAL FLOW (single column or zone)
// ============================================================

function resolveZoneFlow(elements, semanticPage, sourceEvidence, ctx, bounds) {
  const { x, width, maxY } = bounds;
  let y = bounds.y;
  const items = [];
  for (const el of elements) {
    const typo = inferTypography(el, ctx);
    const h    = Math.max(MIN_ELEMENT_HEIGHT, computeElementHeight(el, typo, width, sourceEvidence, ctx));
    const built = buildLayoutElement(el, { x, y, width, height: h, typo });
    // Attach aspect ratio source for image elements (used by diagnostics and tests)
    if (["image", "illustration", "table"].includes(el.type)) {
      built.aspectRatioSource = inferImageAspectRatioWithSource(el, sourceEvidence).source;
    }
    items.push(built);
    y += h + gapAfter(el, ctx);
  }
  return items;
}

// ============================================================
// INTERNAL: BUILD LAYOUT ELEMENT
// ============================================================

function buildLayoutElement(semanticEl, { x, y, width, height, typo }) {
  const type = semanticEl.type;
  const pageLayoutType = PAGE_LAYOUT_TYPE_MAP[type] || "text";

  const el = {
    id:                `layout-${semanticEl.id}`,
    semanticElementId: semanticEl.id,
    type,
    pageLayoutType,
    x:        Math.round(x),
    y:        Math.round(y),
    width:    Math.max(1, Math.round(width)),
    height:   Math.max(1, Math.round(height)),
    rotation: 0,
    zIndex:   0,
  };

  if (semanticEl.text) {
    el.text = semanticEl.text;
    el.role = semanticEl.semanticRole || type;
    el.style = {
      fontSize:    typo.fontSize,
      fontWeight:  typo.fontWeight === "bold" ? "bold" : "normal",
      fontStyle:   typo.fontWeight === "italic" ? "italic" : "normal",
      textAlign:   typo.align,
      lineHeight:  typo.lineHeight,
      color:       "#000000",
    };
  }

  if (["image", "illustration", "table"].includes(type)) {
    el.src     = semanticEl.src || null;
    el.fitMode = "contain";
    el.style   = { objectFit: "contain" };
    if (semanticEl.altText) el.altText = semanticEl.altText;
  }

  if (type === "answerLine") {
    el.style = { strokeColor: "#000000", strokeWidth: 1 };
  }

  if (type === "separator") {
    el.style = { strokeColor: "#cccccc", strokeWidth: 1 };
  }

  if (type === "box") {
    el.style = { strokeColor: "#000000", strokeWidth: 1, fill: "none" };
  }

  return el;
}

// ============================================================
// INTERNAL: ELEMENT HEIGHT
// ============================================================

function computeElementHeight(el, typo, availableWidth, sourceEvidence, ctx) {
  if (typo.fixedHeight) return typo.fixedHeight;

  if (["image", "illustration", "table"].includes(el.type)) {
    const arInfo  = inferImageAspectRatioWithSource(el, sourceEvidence);
    const baseH   = Math.round(availableWidth / arInfo.ratio);
    const factor  = ctx?.imageHeightFactor ?? 1.0;
    return Math.max(MIN_ELEMENT_HEIGHT, Math.round(baseH * factor));
  }

  const text = el.text || "";
  if (!text || typo.fontSize <= 0) return typo.fixedHeight || MIN_ELEMENT_HEIGHT;

  const provider = ctx?._textProvider;
  if (provider) {
    return Math.max(
      MIN_ELEMENT_HEIGHT,
      provider.measureTextHeight(text, {
        fontSize:   typo.fontSize,
        fontWeight: typo.fontWeight,
        lineHeight: typo.lineHeight,
      }, availableWidth),
    );
  }
  // Fallback to inline approximation (should not normally be reached)
  return Math.max(MIN_ELEMENT_HEIGHT,
    measureTextHeight(text, typo.fontSize, typo.fontWeight, typo.lineHeight, availableWidth));
}

// ============================================================
// INTERNAL: TYPOGRAPHY
// ============================================================

function inferTypography(element, ctx) {
  const base      = TYPOGRAPHY_DEFAULTS[element.type] || TYPOGRAPHY_DEFAULTS.paragraph;
  const prominence = element.layoutIntent?.prominence || "normal";
  const pFactor   = PROMINENCE_FACTORS[prominence] || 1.0;
  // Apply extra title prominence factor for Phase 8 composition correction
  const titleFactor = (element.type === "title" || element.type === "heading")
    ? (ctx.titleProminenceFactor || 1.0)
    : 1.0;
  const rawSize   = base.fontSize * pFactor * ctx.fontSizeFactor * titleFactor;
  const minSize   = MIN_FONT_SIZES[element.type] || 0;
  const fontSize  = Math.max(minSize, Math.round(rawSize * 10) / 10);
  return {
    fontSize,
    fontWeight:  base.fontWeight,
    lineHeight:  base.lineHeight,
    align:       element.layoutIntent?.alignment || base.align,
    fixedHeight: base.fixedHeight || null,
  };
}

// ============================================================
// INTERNAL: IMAGE ASPECT RATIO — full priority chain
// ============================================================

/**
 * Resolve image aspect ratio with diagnostics.
 * Returns { ratio: number, source: string }
 *
 * Priority:
 *   1. element.pixelWidth / element.pixelHeight (persisted extracted dimensions)
 *   2. sourceEvidence imageCandidates bbox
 *   3. sourceEvidence graphicCandidates bbox
 *   4. sourceEvidence regions bbox
 *   5. element.sourceBbox (inferred relative bbox from page conversion)
 *   6. role-based fallback (NOT universal 16:9)
 */
function inferImageAspectRatioWithSource(element, sourceEvidence) {
  // Priority 1: persisted pixel dimensions
  const pw = Number(element.pixelWidth);
  const ph = Number(element.pixelHeight);
  if (pw > 0 && ph > 0) {
    return { ratio: pw / ph, source: "persisted-image-dimensions" };
  }

  // Priorities 2–4: source evidence
  if (sourceEvidence) {
    for (const id of (element.sourceEvidenceIds || [])) {
      const cand = (sourceEvidence.visualEvidence?.imageCandidates || []).find(c => c.id === id);
      if (cand?.bbox?.width > 0 && cand?.bbox?.height > 0) {
        return { ratio: cand.bbox.width / cand.bbox.height, source: "image-candidate-bbox" };
      }
      const gc = (sourceEvidence.visualEvidence?.graphicCandidates || []).find(r => r.id === id);
      if (gc?.bbox?.width > 0 && gc?.bbox?.height > 0) {
        return { ratio: gc.bbox.width / gc.bbox.height, source: "graphic-candidate-bbox" };
      }
      const reg = (sourceEvidence.visualEvidence?.regions || []).find(r => r.id === id);
      if (reg?.bbox?.width > 0 && reg?.bbox?.height > 0) {
        return { ratio: reg.bbox.width / reg.bbox.height, source: "region-bbox" };
      }
    }
  }

  // Priority 5: element.sourceBbox (relative bbox stored during page conversion)
  const sb = element.sourceBbox;
  if (sb?.width > 0 && sb?.height > 0) {
    return { ratio: sb.width / sb.height, source: "element-source-bbox" };
  }

  // Priority 6: role-based fallback — NOT universal 16:9
  const imageRole    = element.layoutIntent?.imageRole;
  const spansColumns = element.layoutIntent?.spansColumns;

  if (imageRole === "bottom-spanning-photograph" || (spansColumns && !imageRole)) {
    return { ratio: 1.65, source: "role-based-bottom-spanning" };
  }
  if (imageRole === "column-image") {
    return { ratio: 1.20, source: "role-based-column-image" };
  }
  if (imageRole === "portrait-illustration") {
    return { ratio: 0.75, source: "role-based-portrait-illustration" };
  }
  // Generic conservative fallback (NOT 16:9)
  return { ratio: 1.40, source: "role-based-generic" };
}

/**
 * Compute element height — uses text measurement provider for text elements,
 * and role-based aspect ratio resolution for image elements.
 */

// ============================================================
// INTERNAL: GAP AFTER ELEMENT
// ============================================================

function gapAfter(el, ctx) {
  const t = el.type;
  if (["title", "heading", "subheading", "separator", "image", "illustration", "table"].includes(t)) return ctx.sectionGap;
  if (t === "option")     return ctx.optionGap;
  if (t === "answerLine") return ctx.questionGap;
  return ctx.paragraphGap;
}

// ============================================================
// INTERNAL: SORT BY READING ORDER
// ============================================================

function sortByReadingOrder(elements, readingOrderIds) {
  if (!Array.isArray(readingOrderIds) || !readingOrderIds.length) {
    return [...elements].sort((a, b) => (a.readingOrder || 999) - (b.readingOrder || 999));
  }
  const orderMap = new Map(readingOrderIds.map((id, i) => [id, i]));
  return [...elements].sort((a, b) => {
    const ai = orderMap.has(a.id) ? orderMap.get(a.id) : 9999;
    const bi = orderMap.has(b.id) ? orderMap.get(b.id) : 9999;
    if (ai !== bi) return ai - bi;
    return (a.readingOrder || 999) - (b.readingOrder || 999);
  });
}

// ============================================================
// INTERNAL: BINDINGS
// ============================================================

function buildLayoutBindings(elements) {
  return elements.map(el => ({
    layoutElementId:   el.id,
    semanticElementId: el.semanticElementId,
    type:              el.type,
    bound:             true,
  }));
}

// ============================================================
// INTERNAL: DIAGNOSTICS
// ============================================================

function collectLayoutDiagnostics(elements, ctx) {
  const issues = [];

  if (ctx._overflow) {
    issues.push({
      type: "overflow",
      severity: "warning",
      message: `Layout overflows by ${ctx._overflow.overflowPx}px`,
      detail: ctx._overflow,
    });
  }

  for (const el of elements) {
    if (el.x < 0 || el.y < 0) {
      issues.push({ type: "out-of-bounds", severity: "warning", message: `${el.id}: negative coordinates`, elementId: el.id });
    }
    if (el.x + el.width > A4_WIDTH + 2) {
      issues.push({ type: "clipping-x", severity: "warning", message: `${el.id}: exceeds page width`, elementId: el.id });
    }
    if (el.y + el.height > A4_HEIGHT + 2) {
      issues.push({ type: "clipping-y", severity: "warning", message: `${el.id}: exceeds page height`, elementId: el.id });
    }
  }

  return { issues, overflowInfo: ctx._overflow || null };
}

// ============================================================
// INTERNAL: OVERFLOW CORRECTION
// ============================================================

function deriveConstraintPatches(issues) {
  const patches = [];
  if (issues.some(i => i.type === "overflow"))         patches.push({ type: "reduce-spacing",   factor: 0.80 });
  if (issues.some(i => i.type === "overflow"))         patches.push({ type: "reduce-font-size", factor: 0.90 });
  if (issues.some(i => i.type === "footer-collision")) patches.push({ type: "reduce-spacing",   factor: 0.85 });
  if (issues.some(i => i.type === "column-overflow"))  patches.push({ type: "reduce-font-size", factor: 0.88 });
  return patches;
}

function applyConstraintPatches(options, patches) {
  let spacingFactor  = Number(options.spacingFactor)  || 1.0;
  let fontSizeFactor = Number(options.fontSizeFactor) || 1.0;
  for (const p of patches) {
    if (p.type === "reduce-spacing")   spacingFactor  = Math.max(0.45, spacingFactor  * (p.factor || 0.80));
    if (p.type === "reduce-font-size") fontSizeFactor = Math.max(0.70, fontSizeFactor * (p.factor || 0.90));
  }
  return { ...options, spacingFactor, fontSizeFactor };
}

// ============================================================
// INTERNAL: NULL LAYOUT
// ============================================================

function nullResolvedLayout(reason) {
  return {
    schemaVersion: RESOLVED_A4_LAYOUT_SCHEMA_VERSION,
    pageRef:       {},
    pageSize:      { width: A4_WIDTH, height: A4_HEIGHT, unit: "px", format: "A4" },
    layoutStrategy: {
      type: "semantic-reconstruction", source: "null", resolverVersion: A4_LAYOUT_RESOLVER_VERSION,
    },
    elements:          [],
    bindings:          [],
    layoutDiagnostics: { issues: [{ type: "resolver-failed", severity: "critical", message: reason }] },
    validation:        {},
  };
}

// ============================================================
// UTILITIES
// ============================================================

function clampNum(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
