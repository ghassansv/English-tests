/**
 * image-evidence-association.js
 *
 * Phase 8 — Image provenance hardening
 *
 * Builds deterministic cross-provider image associations.
 * The same document image detected by Paddle, Qwen, and source visual
 * heuristics should resolve to one semantic image object with full provenance.
 *
 * Export:
 *   buildImageEvidenceAssociations(semanticPage, sourceEvidence, paddleOutput?, qwenOutput?)
 *   → ImageEvidenceAssociation[]
 *
 * ImageEvidenceAssociation schema:
 * {
 *   "semanticImageId": "...",
 *   "associatedEvidence": [
 *     { "source": "source-visual-evidence", "id": "...", "bbox": {...} },
 *     { "source": "paddleocr-vl",            "id": "...", "confidence": 0.95 },
 *     { "source": "qwen3-vl",               "description": "..." }
 *   ],
 *   "confidence": 0.94
 * }
 */

const MIN_SPATIAL_OVERLAP = 0.20; // minimum IoU to consider two bboxes the same image

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Build image evidence associations for all image-type elements in a SemanticPageModel.
 *
 * @param {object}      semanticPage   - SemanticPageModel (schema: semantic-page/v1)
 * @param {object|null} sourceEvidence - SourceEvidenceModel
 * @param {object|null} paddleOutput   - document-provider-analysis/v1 from Paddle parser
 * @param {object|null} qwenOutput     - vision-document-analysis/v1 from Qwen
 * @returns {Array<{semanticImageId, associatedEvidence, confidence}>}
 */
export function buildImageEvidenceAssociations(
  semanticPage,
  sourceEvidence,
  paddleOutput = null,
  qwenOutput   = null,
) {
  const imageElements = (semanticPage?.elements || []).filter(el =>
    ["image", "illustration", "table"].includes(el.type)
  );
  return imageElements.map(el =>
    buildAssociation(el, sourceEvidence, paddleOutput, qwenOutput)
  );
}

// ============================================================
// INTERNAL: BUILD ONE ASSOCIATION
// ============================================================

function buildAssociation(el, sourceEvidence, paddleOutput, qwenOutput) {
  const associatedEvidence = [];
  let maxConfidence = 0.50;

  // 1. Source evidence — direct ID match (highest-quality link)
  for (const id of (el.sourceEvidenceIds || [])) {
    const ev = findInSourceEvidence(id, sourceEvidence);
    if (ev) {
      associatedEvidence.push({
        source: "source-visual-evidence",
        id,
        bbox: ev.bbox || null,
      });
      maxConfidence = Math.max(maxConfidence, 0.80);
    }
  }

  // 2. Paddle visual classifications — match by spatial overlap with element's source evidence bbox
  if (paddleOutput) {
    const paddleVCs = paddleOutput.visualClassifications || [];
    const seenPaddleIds = new Set();

    for (const vc of paddleVCs) {
      if (!vc.sourceRegionId) continue;
      if (seenPaddleIds.has(vc.sourceRegionId)) continue; // dedup within Paddle
      const rawType = vc.attributes?.rawTypeName || "";
      if (vc.classification !== "document-image" && rawType !== "image") continue;

      const paddleEl   = (paddleOutput.elements || []).find(e => e.id === vc.sourceRegionId);
      const paddleBbox = paddleEl?.sourceBBox || paddleEl?.bbox;

      if (spatiallyOverlapsElement(paddleBbox, el, sourceEvidence)) {
        seenPaddleIds.add(vc.sourceRegionId);
        associatedEvidence.push({
          source:     "paddleocr-vl",
          id:         vc.sourceRegionId,
          confidence: vc.confidence ?? null,
          bbox:       paddleBbox || null,
        });
        maxConfidence = Math.max(maxConfidence, 0.85);
      }
    }
  }

  // 3. Qwen visual classifications — attach by type/content (no spatial data available)
  if (qwenOutput) {
    const qwenVCs = qwenOutput.visualClassifications || [];
    for (const vc of qwenVCs) {
      if (vc.type !== "image" && vc.classification !== "document-image") continue;
      associatedEvidence.push({
        source:      "qwen3-vl",
        id:          vc.id || vc.sourceRegionId || null,
        description: vc.content || vc.description || "",
      });
      maxConfidence = Math.max(maxConfidence, 0.90);
    }
  }

  return {
    semanticImageId:    el.id,
    associatedEvidence,
    confidence:         Math.round(maxConfidence * 100) / 100,
  };
}

// ============================================================
// INTERNAL: SOURCE EVIDENCE LOOKUP
// ============================================================

function findInSourceEvidence(id, sourceEvidence) {
  if (!sourceEvidence) return null;
  const ve = sourceEvidence.visualEvidence;
  if (!ve) return null;
  return (
    (ve.imageCandidates   || []).find(c => c.id === id) ||
    (ve.graphicCandidates || []).find(c => c.id === id) ||
    (ve.regions           || []).find(r => r.id === id) ||
    null
  );
}

// ============================================================
// INTERNAL: SPATIAL OVERLAP
// ============================================================

/**
 * Returns true if targetBbox overlaps with any source evidence bbox of the semantic element.
 */
function spatiallyOverlapsElement(targetBbox, el, sourceEvidence) {
  if (!targetBbox) return false;
  for (const id of (el.sourceEvidenceIds || [])) {
    const ev = findInSourceEvidence(id, sourceEvidence);
    if (ev?.bbox && iouBbox(targetBbox, ev.bbox) >= MIN_SPATIAL_OVERLAP) return true;
  }
  // If element has no source evidence but has a sourceBbox, check against that
  const sb = el.sourceBbox;
  if (sb && iouBbox(targetBbox, sb) >= MIN_SPATIAL_OVERLAP) return true;
  return false;
}

function iouBbox(a, b) {
  if (!a || !b || !a.width || !b.width) return 0;
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width)   - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  if (!inter) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}
