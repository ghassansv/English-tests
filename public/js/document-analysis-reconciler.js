import { validateSemanticReconstruction } from "./national-test-semantic-validator.js";
import {
  collectProviderAnalyses,
  compactDocumentUnderstandingInput,
  createHybridDocumentUnderstandingProvider,
  documentUnderstandingModeSummary
} from "./document-understanding-providers.js";

export const DOCUMENT_UNDERSTANDING_SCHEMA_VERSION = "document-understanding/v1";
export const DOCUMENT_ANALYSIS_RECONCILER_VERSION = "document-analysis-reconciler/v1";

const DEFAULT_MAX_TARGETED_ANALYSES = 2;
const PROVIDER_ACCEPTANCE_MARGIN = 0.02;

export async function runDocumentUnderstandingPipeline(input = {}) {
  const provider = input.provider || createHybridDocumentUnderstandingProvider(input.providerOptions || {});
  const sourceEvidence = input.sourceEvidence;
  const heuristicSemanticPage = clonePlainObject(input.semanticPage || input.heuristicSemanticPage);
  const initialValidation = input.semanticValidation || validateSemanticReconstruction({ sourceEvidence, semanticPage: heuristicSemanticPage });
  const compactInput = compactDocumentUnderstandingInput({
    page: input.page,
    sourceEvidence,
    semanticPage: heuristicSemanticPage,
    semanticValidation: initialValidation
  });

  const initialAnalysis = await safeAsync(() => provider.analyzePage({
    page: input.page,
    sourceEvidence,
    semanticPage: heuristicSemanticPage,
    heuristicSemanticPage,
    semanticValidation: initialValidation,
    compactInput
  }), providerFailureAnalysis("analyze-page-failed"));

  const reconciliation = reconcileDocumentAnalysis({
    sourceEvidence,
    semanticPage: heuristicSemanticPage,
    semanticValidation: initialValidation,
    providerAnalysis: initialAnalysis
  });
  let refinedSemanticPage = refineNationalTestSemanticPageModel({
    sourceEvidence,
    semanticPage: heuristicSemanticPage,
    reconciliation
  });
  let refinedValidation = validateSemanticReconstruction({ sourceEvidence, semanticPage: refinedSemanticPage });

  const targetedAnalyses = [];
  const maxTargetedAnalyses = Math.max(0, Math.min(5, Number(input.maxTargetedAnalyses ?? DEFAULT_MAX_TARGETED_ANALYSES)));
  for (let index = 0; index < maxTargetedAnalyses; index += 1) {
    const issue = nextTargetedIssue(refinedValidation, targetedAnalyses);
    if (!issue) break;
    const region = regionForValidationIssue(issue, refinedSemanticPage, sourceEvidence);
    const targetedAnalysis = await safeAsync(() => provider.analyzeRegion({
      page: input.page,
      sourceEvidence,
      semanticPage: refinedSemanticPage,
      heuristicSemanticPage,
      semanticValidation: refinedValidation,
      compactInput,
      issue,
      region
    }), providerFailureAnalysis("targeted-region-analysis-failed", { issue, region }));
    targetedAnalyses.push({ issue, region, analysis: targetedAnalysis });
    const targetedReconciliation = reconcileDocumentAnalysis({
      sourceEvidence,
      semanticPage: refinedSemanticPage,
      semanticValidation: refinedValidation,
      providerAnalysis: targetedAnalysis,
      targetedIssue: issue
    });
    const targetedSemanticPage = refineNationalTestSemanticPageModel({
      sourceEvidence,
      semanticPage: refinedSemanticPage,
      reconciliation: targetedReconciliation
    });
    const targetedValidation = validateSemanticReconstruction({ sourceEvidence, semanticPage: targetedSemanticPage });
    const selected = selectBestSemanticCandidate([
      semanticCandidate("current-refined", refinedSemanticPage, refinedValidation, { reconciliation }),
      semanticCandidate(`targeted-refined-${index + 1}`, targetedSemanticPage, targetedValidation, {
        reconciliation: targetedReconciliation,
        providerChanged: semanticDecisionsChanged(refinedSemanticPage, targetedSemanticPage).length > 0
      })
    ], refinedValidation);
    if (selected.id === `targeted-refined-${index + 1}`) {
      refinedSemanticPage = targetedSemanticPage;
      refinedValidation = targetedValidation;
    }
  }

  const providerChanges = semanticDecisionsChanged(heuristicSemanticPage, refinedSemanticPage);
  const candidates = [
    semanticCandidate("heuristic", heuristicSemanticPage, initialValidation, { source: "heuristic" }),
    semanticCandidate("provider-refined", refinedSemanticPage, refinedValidation, { source: "provider-assisted", providerChanged: providerChanges.length > 0 })
  ];
  const selectedCandidate = selectBestSemanticCandidate(candidates, initialValidation);
  const selectedSemanticPage = selectedCandidate.semanticPage;
  const selectedValidation = selectedCandidate.validation;
  const result = {
    schemaVersion: DOCUMENT_UNDERSTANDING_SCHEMA_VERSION,
    providerVersion: DOCUMENT_ANALYSIS_RECONCILER_VERSION,
    mode: documentUnderstandingMode(initialAnalysis),
    providers: providerHealthSummary(initialAnalysis),
    initialAnalysis: stripHeavyAnalysis(initialAnalysis),
    targetedAnalyses: targetedAnalyses.map(entry => ({
      issue: summarizeValidationIssue(entry.issue),
      region: entry.region,
      analysis: stripHeavyAnalysis(entry.analysis)
    })),
    reconciliation: compactReconciliation(reconciliation),
    candidateResults: candidates.map(candidate => ({
      id: candidate.id,
      status: candidate.validation?.status || "unknown",
      score: Number(candidate.validation?.score) || 0,
      selected: candidate.id === selectedCandidate.id,
      diagnostics: candidate.diagnostics || {}
    })),
    selectedCandidateId: selectedCandidate.id,
    decisionsChanged: semanticDecisionsChanged(heuristicSemanticPage, selectedSemanticPage),
    diagnostics: {
      initialValidation: validationSummary(initialValidation),
      refinedValidation: validationSummary(refinedValidation),
      finalValidation: validationSummary(selectedValidation)
    }
  };
  return {
    documentUnderstanding: result,
    selectedSemanticPage,
    selectedValidation,
    selectedCandidate
  };
}

export function reconcileDocumentAnalysis(input = {}) {
  const sourceEvidence = input.sourceEvidence || {};
  const semanticPage = input.semanticPage || {};
  const semanticValidation = input.semanticValidation || {};
  const providerAnalysis = input.providerAnalysis || {};
  const analyses = collectProviderAnalyses(providerAnalysis);
  const decisions = [];
  const visualClassifications = [];
  const relationships = [];
  const groups = [];
  const elementInterpretations = [];
  const readingOrderCandidates = [];

  decisions.push(decision("page-type", semanticPage.pageType || "unknown", 0.72, [
    signal("heuristic", semanticPage.pageType || "unknown", 0.72)
  ]));
  decisions.push(decision("column-count", Number(semanticPage.styleHints?.columnCount) || 1, 0.74, [
    signal("heuristic", Number(semanticPage.styleHints?.columnCount) || 1, 0.74)
  ]));

  analyses.forEach(analysis => {
    if (!analysis || analysis.diagnostics?.available === false) return;
    const providerName = providerSignalName(analysis);
    const pageAnalysis = analysis.pageAnalysis || {};
    (pageAnalysis.pageTypeCandidates || []).forEach(candidate => {
      decisions.push(decision("page-type", candidate.value, candidate.confidence, [signal(providerName, candidate.value, candidate.confidence)]));
    });
    (pageAnalysis.columnCountCandidates || []).forEach(candidate => {
      decisions.push(decision("column-count", candidate.value, candidate.confidence, [signal(providerName, candidate.value, candidate.confidence)]));
    });
    if (analysis.page?.pageType) decisions.push(decision("page-type", analysis.page.pageType, analysis.page.confidence || 0.75, [signal(providerName, analysis.page.pageType, analysis.page.confidence || 0.75)]));
    if (analysis.page?.columnCount) decisions.push(decision("column-count", analysis.page.columnCount, analysis.page.confidence || 0.75, [signal(providerName, analysis.page.columnCount, analysis.page.confidence || 0.75)]));
    (analysis.visualClassifications || []).forEach(entry => visualClassifications.push({ ...entry, source: providerName }));
    (analysis.relationships || []).forEach(entry => relationships.push({ ...entry, source: providerName }));
    (analysis.groups || []).forEach(entry => groups.push({ ...entry, source: providerName }));
    (analysis.elementInterpretations || []).forEach(entry => elementInterpretations.push({ ...entry, source: providerName }));
    if (Array.isArray(analysis.readingOrder) && analysis.readingOrder.length) {
      readingOrderCandidates.push({ source: providerName, readingOrder: analysis.readingOrder, confidence: 0.75 });
    }
    if (Array.isArray(analysis.readingOrderEvidence) && analysis.readingOrderEvidence.length) {
      readingOrderCandidates.push({ source: providerName, readingOrder: analysis.readingOrderEvidence, confidence: 0.82 });
    }
  });

  const fusedDecisions = fuseDecisions(decisions);
  return {
    schemaVersion: "document-analysis-reconciliation/v1",
    targetedIssueType: input.targetedIssue?.type || null,
    semanticValidation: validationSummary(semanticValidation),
    decisions: fusedDecisions,
    visualClassifications,
    relationships,
    groups,
    elementInterpretations,
    readingOrderCandidates,
    diagnostics: {
      providerAnalysisCount: analyses.length,
      sourceTextEvidenceCount: (sourceEvidence.pdfTextEvidence?.length || 0) + (sourceEvidence.ocrEvidence?.lines?.length || 0) + (sourceEvidence.ocrEvidence?.blocks?.length || 0)
    }
  };
}

export function refineNationalTestSemanticPageModel(input = {}) {
  const semanticPage = clonePlainObject(input.semanticPage || {});
  const sourceEvidence = input.sourceEvidence || {};
  const reconciliation = input.reconciliation || {};
  semanticPage.elements = Array.isArray(semanticPage.elements) ? semanticPage.elements : [];
  semanticPage.relationships = Array.isArray(semanticPage.relationships) ? semanticPage.relationships : [];
  semanticPage.readingOrder = Array.isArray(semanticPage.readingOrder) ? semanticPage.readingOrder : [];
  semanticPage.documentUnderstanding = {
    reconcilerVersion: DOCUMENT_ANALYSIS_RECONCILER_VERSION,
    decisions: (reconciliation.decisions || []).map(item => ({
      decision: item.decision,
      value: item.value,
      confidence: item.confidence,
      sources: item.signals?.map(signal => signal.source) || []
    }))
  };

  applyPageDecisions(semanticPage, reconciliation);
  applyElementInterpretations(semanticPage, reconciliation);
  applyProviderGroups(semanticPage, reconciliation);
  applyProviderRelationships(semanticPage, reconciliation);
  applyVisualClassifications(semanticPage, reconciliation, sourceEvidence);
  applyReadingOrderCandidates(semanticPage, reconciliation);
  ensureStableReadingOrder(semanticPage);
  return semanticPage;
}

export function selectBestSemanticCandidate(candidates = [], baselineValidation = null) {
  const ranked = candidates
    .filter(candidate => candidate?.semanticPage && candidate?.validation)
    .map(candidate => ({ ...candidate, rank: validationRank(candidate.validation) }))
    .sort((left, right) => {
      if (right.rank !== left.rank) return right.rank - left.rank;
      const scoreDiff = Number(right.validation.score || 0) - Number(left.validation.score || 0);
      if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;
      if (left.diagnostics?.providerChanged && !right.diagnostics?.providerChanged) return -1;
      if (right.diagnostics?.providerChanged && !left.diagnostics?.providerChanged) return 1;
      if (left.id === "heuristic" && right.id !== "heuristic" && right.diagnostics?.providerChanged) return 1;
      if (right.id === "heuristic" && left.id !== "heuristic" && left.diagnostics?.providerChanged) return -1;
      return String(left.id).localeCompare(String(right.id));
    });
  const best = ranked[0] || candidates[0] || null;
  const baseline = baselineValidation ? { rank: validationRank(baselineValidation), score: Number(baselineValidation.score) || 0 } : null;
  const heuristic = candidates.find(candidate => candidate.id === "heuristic") || candidates[0] || best;
  if (!best || !baseline) return best;
  const worseRank = best.rank < baseline.rank;
  const worseScore = Number(best.validation.score || 0) < baseline.score - PROVIDER_ACCEPTANCE_MARGIN;
  return worseRank || worseScore ? heuristic : best;
}

export function documentUnderstandingDebugSummary(result) {
  if (!result) return "[Document Understanding]\nNo result.";
  const documentUnderstanding = result.documentUnderstanding || result;
  return [
    "[Document Understanding]",
    `Mode: ${documentUnderstanding.mode || "unknown"}`,
    `Selected: ${documentUnderstanding.selectedCandidateId || "unknown"}`,
    `Initial: ${documentUnderstanding.diagnostics?.initialValidation?.status || "unknown"} ${documentUnderstanding.diagnostics?.initialValidation?.score ?? ""}`,
    `Final: ${documentUnderstanding.diagnostics?.finalValidation?.status || "unknown"} ${documentUnderstanding.diagnostics?.finalValidation?.score ?? ""}`,
    `Targeted analyses: ${documentUnderstanding.targetedAnalyses?.length || 0}`
  ].join("\n");
}

function applyPageDecisions(semanticPage, reconciliation) {
  const columnDecision = bestDecision(reconciliation, "column-count");
  if (columnDecision?.value) {
    semanticPage.styleHints = {
      ...(semanticPage.styleHints || {}),
      columnCount: Math.max(1, Math.round(Number(columnDecision.value) || 1))
    };
  }
  const pageType = bestDecision(reconciliation, "page-type");
  if (pageType?.value && pageType.confidence >= 0.86) semanticPage.pageType = String(pageType.value);
}

function applyElementInterpretations(semanticPage, reconciliation) {
  (reconciliation.elementInterpretations || []).forEach(interpretation => {
    if (Number(interpretation.confidence) < 0.86 || !interpretation.semanticType) return;
    const targets = semanticPage.elements.filter(element => intersects(element.sourceEvidenceIds || [], interpretation.sourceEvidenceIds || []));
    targets.forEach(element => {
      if (["title", "heading", "subheading", "instructions", "paragraph", "question", "option", "caption", "footer", "image", "illustration", "table"].includes(interpretation.semanticType)) {
        element.type = interpretation.semanticType;
        element.semanticRole = interpretation.semanticType;
        appendSemanticDecision(element, "provider-element-interpretation", interpretation.confidence, [interpretation.source || "provider"]);
      }
    });
  });
}

function applyProviderGroups(semanticPage, reconciliation) {
  (reconciliation.groups || []).forEach(group => {
    if (/heuristic/i.test(String(group.source || ""))) return;
    if (Number(group.confidence) < 0.8 || !Array.isArray(group.memberEvidenceIds) || !group.memberEvidenceIds.length) return;
    const members = semanticPage.elements.filter(element => intersects(element.sourceEvidenceIds || [], group.memberEvidenceIds));
    if (members.length < 2) return;
    const id = stableSemanticId(group.type || "visualGroup", group.memberEvidenceIds);
    if (!semanticPage.elements.some(element => element.id === id)) {
      semanticPage.elements.push({
        id,
        type: ["paragraphGroup", "section", "columnGroup", "visualGroup"].includes(group.type) ? group.type : "visualGroup",
        sourceEvidenceIds: uniqueStrings(members.flatMap(member => member.sourceEvidenceIds || [])),
        confidence: roundScore(Number(group.confidence) || 0.8),
        semanticRole: group.type || "provider-group",
        hierarchyLevel: 2,
        readingOrder: null,
        layoutIntent: {
          band: members[0]?.layoutIntent?.band || "body",
          columnRole: members[0]?.layoutIntent?.columnRole || "single",
          spansColumns: members.some(member => member.layoutIntent?.spansColumns),
          relativeWidth: "normal",
          relativeHeight: "normal",
          prominence: "normal",
          alignment: "left",
          preserveAspectRatio: false
        },
        semanticDecision: { sources: [group.source || "provider"], confidence: roundScore(group.confidence) }
      });
    }
    members.forEach(member => addRelationship(semanticPage, {
      type: "belongsTo",
      from: member.id,
      to: id,
      confidence: group.confidence,
      reason: "provider-grouping"
    }));
  });
}

function applyProviderRelationships(semanticPage, reconciliation) {
  (reconciliation.relationships || []).forEach(relationship => {
    if (/heuristic/i.test(String(relationship.source || ""))) return;
    if (Number(relationship.confidence) < 0.72) return;
    const from = relationship.from ? elementById(semanticPage, relationship.from) : elementFromEvidenceIds(semanticPage, relationship.fromEvidenceIds || []);
    const to = relationship.to ? elementById(semanticPage, relationship.to) : elementFromEvidenceIds(semanticPage, relationship.toEvidenceIds || []);
    if (!from || !to || from.id === to.id) return;
    addRelationship(semanticPage, {
      type: relationship.type,
      from: from.id,
      to: to.id,
      confidence: relationship.confidence,
      reason: `provider-${relationship.source || "relationship"}`
    });
    appendSemanticDecision(from, `provider-relationship-${relationship.type}`, relationship.confidence, [relationship.source || "provider"]);
  });
}

function applyVisualClassifications(semanticPage, reconciliation, sourceEvidence) {
  // Build a set of all valid source evidence IDs so provider-internal IDs (e.g. "paddle-page-1-element-7")
  // cannot be placed in sourceEvidenceIds and cause a semantic-integrity-error in validation.
  const validSourceIds = buildSourceEvidenceIdSet(sourceEvidence);

  const artifactRegionIds = new Set((reconciliation.visualClassifications || [])
    .filter(classification => !/heuristic/i.test(String(classification.source || "")) && /artifact/i.test(classification.classification) && Number(classification.confidence) >= 0.72)
    .map(classification => classification.sourceRegionId).filter(Boolean));

  // Collect Qwen visual descriptions without a sourceRegionId for cross-provider enrichment.
  // When Qwen describes an image region by content only (no anchor), we attach the description
  // to the matching provider-identified image element instead of creating a duplicate.
  const qwenUnanchored = (reconciliation.visualClassifications || []).filter(
    classification => !/heuristic/i.test(String(classification.source || ""))
      && /qwen/i.test(String(classification.source || ""))
      && !classification.sourceRegionId
      && ["image", "illustration"].includes(String(classification.type || "").toLowerCase())
      && classification.content
  );

  (reconciliation.visualClassifications || []).forEach(classification => {
    if (/heuristic/i.test(String(classification.source || ""))) return;
    if (!classification.sourceRegionId || Number(classification.confidence) < 0.72) return;
    const sourceId = classification.sourceRegionId;
    const existing = semanticPage.elements.find(element => (element.sourceEvidenceIds || []).includes(sourceId));
    if (/artifact/i.test(classification.classification)) {
      if (existing) appendSemanticDecision(existing, "provider-visual-artifact-risk", classification.confidence, [classification.source || "provider"]);
      return;
    }
    if (["document-image", "image", "illustration", "table", "chart"].includes(classification.classification)) {
      if (artifactRegionIds.has(sourceId)) return;
      if (existing) {
        appendSemanticDecision(existing, "provider-visual-classification", classification.confidence, [classification.source || "provider"]);
        enrichElementWithQwenDescriptions(existing, qwenUnanchored);
        return;
      }
      const evidence = findSourceEvidence(sourceEvidence, sourceId);

      // Try spatial overlap matching: if another image element in the semantic page overlaps
      // this classification region, update it rather than creating a duplicate.
      const existingByOverlap = evidence?.bbox
        ? findImageElementByBboxOverlap(semanticPage, sourceEvidence, evidence.bbox)
        : null;
      if (existingByOverlap) {
        appendSemanticDecision(existingByOverlap, "provider-visual-classification", classification.confidence, [classification.source || "provider"]);
        // Only add sourceId to sourceEvidenceIds when it is a valid sourceEvidence entry.
        if (validSourceIds.has(sourceId) && !(existingByOverlap.sourceEvidenceIds || []).includes(sourceId)) {
          existingByOverlap.sourceEvidenceIds = uniqueStrings([...existingByOverlap.sourceEvidenceIds, sourceId]);
        }
        enrichElementWithQwenDescriptions(existingByOverlap, qwenUnanchored);
        return;
      }

      // Only reference sourceId in sourceEvidenceIds when it is a valid sourceEvidence entry.
      // Provider-internal IDs (e.g. "paddle-page-1-element-7") are NOT registered in the
      // SourceEvidenceModel and must not appear in sourceEvidenceIds — doing so causes a
      // semantic-integrity-error in validateNationalTestSemanticPageModel.
      // We still create the element; empty sourceEvidenceIds is valid.
      const useSourceId = validSourceIds.has(sourceId);

      const semanticType = classification.classification === "table" ? "table" : classification.classification === "illustration" ? "illustration" : "image";
      const newElement = {
        id: stableSemanticId(semanticType, [sourceId]),
        type: semanticType,
        sourceEvidenceIds: useSourceId ? [sourceId] : [],
        confidence: roundScore(classification.confidence),
        semanticRole: classification.classification,
        hierarchyLevel: 2,
        readingOrder: null,
        layoutIntent: {
          band: "body",
          columnRole: "single",
          spansColumns: Number(evidence?.bbox?.width || 0) > 0.55,
          relativeWidth: Number(evidence?.bbox?.width || 0) > 0.55 ? "wide" : "normal",
          relativeHeight: "normal",
          prominence: "high",
          alignment: "center",
          preserveAspectRatio: true
        },
        semanticDecision: { sources: [classification.source || "provider"], confidence: roundScore(classification.confidence) }
      };
      enrichElementWithQwenDescriptions(newElement, qwenUnanchored);
      semanticPage.elements.push(newElement);
    }
  });
}

function buildSourceEvidenceIdSet(sourceEvidence) {
  return new Set([
    ...(sourceEvidence?.pdfTextEvidence || []),
    ...(sourceEvidence?.ocrEvidence?.words || []),
    ...(sourceEvidence?.ocrEvidence?.lines || []),
    ...(sourceEvidence?.ocrEvidence?.blocks || []),
    ...(sourceEvidence?.visualEvidence?.regions || []),
    ...(sourceEvidence?.visualEvidence?.imageCandidates || []),
    ...(sourceEvidence?.visualEvidence?.graphicCandidates || [])
  ].map(item => item.id).filter(Boolean));
}

function findImageElementByBboxOverlap(semanticPage, sourceEvidence, bbox, minOverlap = 0.25) {
  if (!bbox) return null;
  const imageElements = (semanticPage.elements || []).filter(el => ["image", "illustration", "table"].includes(el.type));
  let bestMatch = null;
  let bestOverlap = minOverlap;
  for (const element of imageElements) {
    const elementBbox = getElementSourceBbox(element, sourceEvidence);
    if (!elementBbox) continue;
    const overlap = bboxOverlapRatio(bbox, elementBbox);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestMatch = element;
    }
  }
  return bestMatch;
}

function getElementSourceBbox(element, sourceEvidence) {
  for (const id of (element.sourceEvidenceIds || [])) {
    const evidence = findSourceEvidence(sourceEvidence, id);
    if (evidence?.bbox) return evidence.bbox;
  }
  return null;
}

function bboxOverlapRatio(a, b) {
  if (!a || !b) return 0;
  const ax1 = Number(a.x) || 0, ay1 = Number(a.y) || 0;
  const ax2 = ax1 + Math.max(0, Number(a.width) || 0);
  const ay2 = ay1 + Math.max(0, Number(a.height) || 0);
  const bx1 = Number(b.x) || 0, by1 = Number(b.y) || 0;
  const bx2 = bx1 + Math.max(0, Number(b.width) || 0);
  const by2 = by1 + Math.max(0, Number(b.height) || 0);
  const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
  if (ix2 <= ix1 || iy2 <= iy1) return 0;
  const intersection = (ix2 - ix1) * (iy2 - iy1);
  const union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function enrichElementWithQwenDescriptions(element, qwenUnanchored) {
  if (!qwenUnanchored.length || !element) return;
  const firstDesc = qwenUnanchored[0];
  if (firstDesc.content && !element.altText) {
    element.altText = String(firstDesc.content);
  }
}

function applyReadingOrderCandidates(semanticPage, reconciliation) {
  const candidates = (reconciliation.readingOrderCandidates || []).filter(candidate => Array.isArray(candidate.readingOrder) && candidate.readingOrder.length);
  if (!candidates.length) return;
  const best = candidates.sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0))[0];
  if (Number(best.confidence) < 0.88) return;
  const validIds = new Set(semanticPage.elements.map(element => element.id));
  const readingOrder = best.readingOrder.filter(id => validIds.has(id));
  if (readingOrder.length >= Math.max(1, semanticPage.readingOrder.length * 0.75)) {
    semanticPage.readingOrder = uniqueStrings([...readingOrder, ...semanticPage.readingOrder.filter(id => !readingOrder.includes(id))]);
  }
}

function ensureStableReadingOrder(semanticPage) {
  const ordered = uniqueStrings(semanticPage.readingOrder || []);
  const existingIds = new Set(semanticPage.elements.map(element => element.id));
  semanticPage.readingOrder = [
    ...ordered.filter(id => existingIds.has(id)),
    ...semanticPage.elements.filter(element => shouldRead(element) && !ordered.includes(element.id)).map(element => element.id)
  ];
  semanticPage.readingOrder.forEach((id, index) => {
    const element = elementById(semanticPage, id);
    if (element) element.readingOrder = index + 1;
  });
}

function semanticCandidate(id, semanticPage, validation, diagnostics = {}) {
  return { id, semanticPage, validation, diagnostics };
}

function nextTargetedIssue(validation, targetedAnalyses) {
  const handled = new Set(targetedAnalyses.map(entry => entry.issue?.id || entry.issue?.type));
  return (validation?.issues || []).find(issue => supportsTargetedAnalysis(issue) && !handled.has(issue.id || issue.type)) || null;
}

function supportsTargetedAnalysis(issue) {
  return [
    "probable-paragraph-continuation-error",
    "missing-semantic-image",
    "orphan-option",
    "missing-option",
    "missing-answer-gap",
    "missing-answer-line"
  ].includes(issue?.type);
}

function regionForValidationIssue(issue, semanticPage, sourceEvidence) {
  const evidenceIds = uniqueStrings([
    ...(issue.sourceEvidenceIds || []),
    ...(issue.semanticElementIds || []).flatMap(id => elementById(semanticPage, id)?.sourceEvidenceIds || [])
  ]);
  const boxes = evidenceIds.map(id => findSourceEvidence(sourceEvidence, id)?.bbox).filter(Boolean);
  const bbox = boxes.reduce(combineBbox, null);
  return {
    id: stableSemanticId("target-region", [issue.type, evidenceIds]),
    issueType: issue.type,
    sourceEvidenceIds: evidenceIds,
    bbox
  };
}

function fuseDecisions(decisions) {
  const byDecision = new Map();
  decisions.forEach(entry => {
    const key = `${entry.decision}:${String(entry.value)}`;
    if (!byDecision.has(key)) {
      byDecision.set(key, {
        decision: entry.decision,
        value: entry.value,
        confidence: 0,
        signals: []
      });
    }
    const target = byDecision.get(key);
    target.signals.push(...(entry.signals || []));
    target.confidence = Math.max(target.confidence, Number(entry.confidence) || 0);
  });
  return [...byDecision.values()]
    .map(entry => ({
      ...entry,
      confidence: roundScore(Math.min(1, entry.signals.reduce((sum, item) => sum + signalWeight(item), 0)))
    }))
    .sort((left, right) => {
      if (left.decision !== right.decision) return left.decision.localeCompare(right.decision);
      return Number(right.confidence) - Number(left.confidence);
    });
}

function signalWeight(item) {
  const source = String(item.source || "");
  const base = Number(item.confidence) || 0;
  if (/vision/i.test(source)) return base * 0.44;
  if (/parser|document-parser/i.test(source)) return base * 0.38;
  if (/heuristic/i.test(source)) return base * 0.28;
  return base * 0.32;
}

function decision(decisionName, value, confidence, signals = []) {
  return { decision: decisionName, value, confidence: roundScore(confidence), signals };
}

function signal(source, value, confidence) {
  return { source, value, confidence: roundScore(confidence) };
}

function bestDecision(reconciliation, decisionName) {
  return (reconciliation.decisions || []).filter(entry => entry.decision === decisionName)
    .sort((left, right) => Number(right.confidence) - Number(left.confidence))[0] || null;
}

function addRelationship(semanticPage, relationship) {
  if (!relationship.type || !relationship.from || !relationship.to || relationship.from === relationship.to) return;
  if (semanticPage.relationships.some(existing => existing.type === relationship.type && existing.from === relationship.from && existing.to === relationship.to)) return;
  semanticPage.relationships.push({
    id: stableSemanticId(`rel-${relationship.type}`, [relationship.from, relationship.to, relationship.reason || "provider"]),
    type: relationship.type,
    from: relationship.from,
    to: relationship.to,
    confidence: roundScore(relationship.confidence ?? 0.8),
    reason: relationship.reason || "document-understanding-provider"
  });
}

function appendSemanticDecision(element, decisionName, confidence, sources = []) {
  element.semanticDecision = {
    ...(element.semanticDecision || {}),
    decision: decisionName,
    sources: uniqueStrings([...(element.semanticDecision?.sources || []), ...sources]),
    confidence: Math.max(Number(element.semanticDecision?.confidence) || 0, roundScore(confidence))
  };
}

function elementFromEvidenceIds(semanticPage, evidenceIds = []) {
  if (!evidenceIds.length) return null;
  const matches = semanticPage.elements.filter(element => intersects(element.sourceEvidenceIds || [], evidenceIds));
  return matches.sort((left, right) => semanticElementSpecificity(right) - semanticElementSpecificity(left))[0] || null;
}

function semanticElementSpecificity(element) {
  if (["paragraph", "question", "option", "answerGap", "answerLine", "image", "illustration", "caption", "footer", "title", "heading"].includes(element?.type)) return 3;
  if (["separator", "box", "table"].includes(element?.type)) return 2;
  if (["paragraphGroup", "section", "visualGroup"].includes(element?.type)) return 1;
  if (["column", "columnGroup"].includes(element?.type)) return 0;
  return 1;
}

function elementById(semanticPage, id) {
  return semanticPage.elements?.find(element => element.id === id) || null;
}

function findSourceEvidence(sourceEvidence, id) {
  return [
    ...(sourceEvidence.pdfTextEvidence || []),
    ...(sourceEvidence.ocrEvidence?.words || []),
    ...(sourceEvidence.ocrEvidence?.lines || []),
    ...(sourceEvidence.ocrEvidence?.blocks || []),
    ...(sourceEvidence.visualEvidence?.regions || []),
    ...(sourceEvidence.visualEvidence?.imageCandidates || []),
    ...(sourceEvidence.visualEvidence?.graphicCandidates || [])
  ].find(item => item.id === id) || null;
}

function providerSignalName(analysis) {
  return analysis.provider?.name || analysis.provider?.type || "provider";
}

function documentUnderstandingMode(analysis) {
  if (analysis.mode) return analysis.mode;
  if (analysis.diagnostics?.available === false) return "heuristic-fallback";
  return "hybrid-local";
}

function providerHealthSummary(analysis) {
  return analysis.health?.providers || analysis.health || {};
}

function stripHeavyAnalysis(analysis) {
  const clone = clonePlainObject(analysis);
  if (!clone) return null;
  collectProviderAnalyses(clone).forEach(entry => {
    if (Array.isArray(entry.elements) && entry.elements.length > 80) entry.elements = entry.elements.slice(0, 80);
  });
  return clone;
}

function compactReconciliation(reconciliation) {
  return {
    schemaVersion: reconciliation.schemaVersion,
    targetedIssueType: reconciliation.targetedIssueType,
    decisions: reconciliation.decisions || [],
    visualClassifications: reconciliation.visualClassifications || [],
    relationships: reconciliation.relationships || [],
    groups: reconciliation.groups || [],
    readingOrderCandidates: reconciliation.readingOrderCandidates || [],
    diagnostics: reconciliation.diagnostics || {}
  };
}

function validationSummary(validation) {
  return {
    status: validation?.status || "unknown",
    score: Number(validation?.score) || 0,
    issueCount: validation?.issues?.length || 0
  };
}

function summarizeValidationIssue(issue) {
  return {
    id: issue?.id || "",
    type: issue?.type || "",
    severity: issue?.severity || "",
    sourceEvidenceIds: issue?.sourceEvidenceIds || [],
    semanticElementIds: issue?.semanticElementIds || []
  };
}

function semanticDecisionsChanged(before, after) {
  const changes = [];
  if (JSON.stringify(before.styleHints || {}) !== JSON.stringify(after.styleHints || {})) {
    changes.push({ type: "style-hints-changed", from: before.styleHints || {}, to: after.styleHints || {} });
  }
  if (String(before.pageType || "") !== String(after.pageType || "")) {
    changes.push({ type: "page-type-changed", from: before.pageType || "", to: after.pageType || "" });
  }
  const beforeElements = new Map((before.elements || []).map(element => [element.id, element]));
  (after.elements || []).forEach(element => {
    const previous = beforeElements.get(element.id);
    if (!previous) {
      changes.push({ type: "element-created", elementId: element.id, semanticType: element.type });
      return;
    }
    if (previous.type !== element.type) changes.push({ type: "element-type-changed", elementId: element.id, from: previous.type, to: element.type });
    if (JSON.stringify(previous.semanticDecision || null) !== JSON.stringify(element.semanticDecision || null)) {
      changes.push({ type: "semantic-decision-updated", elementId: element.id });
    }
  });
  const beforeRels = new Set((before.relationships || []).map(rel => `${rel.type}:${rel.from}:${rel.to}`));
  (after.relationships || []).forEach(rel => {
    const key = `${rel.type}:${rel.from}:${rel.to}`;
    if (!beforeRels.has(key)) changes.push({ type: "relationship-created", relationshipType: rel.type, from: rel.from, to: rel.to });
  });
  return changes;
}

function providerFailureAnalysis(reason, extra = {}) {
  return {
    schemaVersion: "hybrid-document-analysis/v1",
    provider: { type: "hybrid", name: "provider-failure", version: DOCUMENT_ANALYSIS_RECONCILER_VERSION },
    mode: "heuristic-fallback",
    analyses: {},
    diagnostics: { available: false, reason, ...extra }
  };
}

async function safeAsync(callback, fallback) {
  try {
    return await callback();
  } catch (error) {
    return {
      ...fallback,
      diagnostics: {
        ...(fallback?.diagnostics || {}),
        error: error?.message || "document-understanding-error"
      }
    };
  }
}

function semanticPageHasFinalCoordinates(semanticPage) {
  return (semanticPage.elements || []).some(element => ["x", "y", "width", "height", "bbox", "sourceBox"].some(key => Object.prototype.hasOwnProperty.call(element, key)));
}

function validationRank(validation) {
  const status = validation?.status || "retry";
  const statusRank = status === "pass" ? 3 : status === "warning" ? 2 : 1;
  if (semanticPageHasFinalCoordinates(validation?.semanticPage || {})) return 0;
  return statusRank * 1000 + Math.round((Number(validation.score) || 0) * 100);
}

function shouldRead(element) {
  return ["title", "heading", "subheading", "instructions", "paragraph", "question", "option", "answerGap", "answerLine", "image", "illustration", "caption", "footer", "pageNumber"].includes(element.type);
}

function combineBbox(left, right) {
  if (!left) return right || null;
  if (!right) return left || null;
  const x = Math.min(Number(left.x) || 0, Number(right.x) || 0);
  const y = Math.min(Number(left.y) || 0, Number(right.y) || 0);
  const maxX = Math.max((Number(left.x) || 0) + (Number(left.width) || 0), (Number(right.x) || 0) + (Number(right.width) || 0));
  const maxY = Math.max((Number(left.y) || 0) + (Number(left.height) || 0), (Number(right.y) || 0) + (Number(right.height) || 0));
  return {
    x,
    y,
    width: Math.max(0.0001, maxX - x),
    height: Math.max(0.0001, maxY - y),
    coordinateSpace: "source-document-plane-normalized"
  };
}

function stableSemanticId(type, parts = []) {
  return `${type}-${stableHash(parts)}`;
}

function stableHash(value) {
  const text = JSON.stringify(value, (_, entry) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return Object.keys(entry).sort().reduce((sorted, key) => {
        sorted[key] = entry[key];
        return sorted;
      }, {});
    }
    return entry;
  });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(6, "0").slice(0, 8);
}

function uniqueStrings(values = []) {
  return [...new Set(values.map(value => String(value || "")).filter(Boolean))];
}

function intersects(left = [], right = []) {
  const set = new Set(left);
  return right.some(value => set.has(value));
}

function roundScore(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function clonePlainObject(value) {
  if (!value || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}
