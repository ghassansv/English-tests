import assert from "node:assert/strict";
import {
  buildNationalTestSemanticPageModel,
  buildNationalTestSourceEvidenceModel,
  semanticPageContainsFinalCoordinates
} from "../public/js/national-test-semantic-models.js";
import { validateSemanticReconstruction } from "../public/js/national-test-semantic-validator.js";
import {
  createHybridDocumentUnderstandingProvider,
  createLocalServiceDocumentUnderstandingProvider,
  normalizeDocumentProviderAnalysis,
  parseProviderJsonOutput
} from "../public/js/document-understanding-providers.js";
import {
  refineNationalTestSemanticPageModel,
  reconcileDocumentAnalysis,
  runDocumentUnderstandingPipeline,
  selectBestSemanticCandidate
} from "../public/js/document-analysis-reconciler.js";

const page = {
  id: "du-page",
  testId: "du-test",
  pageNumber: 4,
  normalizedPage: { url: "/national-test-page-images/normalized.jpg", pixelWidth: 1200, pixelHeight: 1700 },
  sourcePage: { url: "/national-test-page-images/source.jpg", pixelWidth: 1600, pixelHeight: 2200 }
};

function item(id, role, text, bbox, confidence = 94) {
  return { id, role, text, rawText: text, bbox, confidence };
}

function baseModels(items, options = {}) {
  const extraction = {
    source: options.evidence ? "combined" : "ocr",
    language: "en",
    averageConfidence: 92,
    strategy: "whole-page",
    pageStructure: { type: options.pageType || "article", templateHint: "mirror", features: { columnCount: options.columnCount || 1 } },
    evidence: options.evidence || {},
    items
  };
  const sourceEvidence = buildNationalTestSourceEvidenceModel({
    page,
    extraction,
    sourceImages: options.sourceImages || [],
    adaptiveRegions: options.adaptiveRegions || []
  });
  const semanticPage = buildNationalTestSemanticPageModel({
    page,
    extraction,
    sourceEvidence,
    sourceImages: options.sourceImages || [],
    adaptiveRegions: options.adaptiveRegions || []
  });
  const semanticValidation = validateSemanticReconstruction({ sourceEvidence, semanticPage });
  return { extraction, sourceEvidence, semanticPage, semanticValidation };
}

function fakeProvider({ analysis, regionAnalysis, throwPage = false, maxRegionCalls = Infinity } = {}) {
  let regionCalls = 0;
  return {
    async analyzePage() {
      if (throwPage) throw new Error("gpu failure");
      return analysis || unavailableAnalysis();
    },
    async analyzeRegion() {
      regionCalls += 1;
      if (regionCalls > maxRegionCalls) throw new Error("targeted loop exceeded");
      return typeof regionAnalysis === "function" ? regionAnalysis(regionCalls) : (regionAnalysis || unavailableAnalysis());
    },
    get regionCalls() {
      return regionCalls;
    }
  };
}

function unavailableAnalysis() {
  return {
    schemaVersion: "hybrid-document-analysis/v1",
    mode: "heuristic-fallback",
    analyses: {},
    diagnostics: { available: false }
  };
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
        diagnostics: {}
      }
    }
  };
}

function visionAnalysis(extra = {}) {
  return {
    schemaVersion: "hybrid-document-analysis/v1",
    mode: "hybrid-local",
    health: { providers: { documentParser: { available: false }, visionReasoner: { available: true } } },
    analyses: {
      vision: {
        schemaVersion: "vision-document-analysis/v1",
        provider: { type: "vision-reasoner", name: "test-vision", model: "Qwen/Qwen3-VL-8B-Instruct", device: "cuda" },
        page: extra.page || {},
        elementInterpretations: extra.elementInterpretations || [],
        groups: extra.groups || [],
        relationships: extra.relationships || [],
        readingOrderEvidence: extra.readingOrderEvidence || [],
        visualClassifications: extra.visualClassifications || [],
        disagreements: []
      }
    }
  };
}

function bothAnalysis(parserExtra, visionExtra) {
  return {
    schemaVersion: "hybrid-document-analysis/v1",
    mode: "hybrid-local",
    health: { providers: { documentParser: { available: true }, visionReasoner: { available: true } } },
    analyses: {
      parser: parserAnalysis(parserExtra).analyses.parser,
      vision: visionAnalysis(visionExtra).analyses.vision
    }
  };
}

function removeImages(semanticPage) {
  const removed = semanticPage.elements.filter(element => ["image", "illustration", "table"].includes(element.type)).map(element => element.id);
  semanticPage.elements = semanticPage.elements.filter(element => !removed.includes(element.id));
  semanticPage.relationships = semanticPage.relationships.filter(rel => !removed.includes(rel.from) && !removed.includes(rel.to));
  semanticPage.readingOrder = semanticPage.readingOrder.filter(id => !removed.includes(id));
}

{
  const models = baseModels([item("p1", "paragraph", "Fallback paragraph.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 })]);
  const result = await runDocumentUnderstandingPipeline({ ...models, page, provider: fakeProvider() });
  assert.equal(result.documentUnderstanding.selectedCandidateId, "heuristic");
  assert.equal(result.documentUnderstanding.mode, "heuristic-fallback");
}

{
  const models = baseModels([item("p1", "paragraph", "Parser paragraph.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 })]);
  const result = await runDocumentUnderstandingPipeline({
    ...models,
    page,
    provider: fakeProvider({ analysis: parserAnalysis({ pageAnalysis: { columnCountCandidates: [{ value: 2, confidence: 0.94 }] } }) })
  });
  assert.equal(result.documentUnderstanding.mode, "hybrid-local");
  assert.equal(result.selectedSemanticPage.styleHints.columnCount, 2);
}

{
  const models = baseModels([item("p1", "paragraph", "Vision paragraph.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 })]);
  const result = await runDocumentUnderstandingPipeline({
    ...models,
    page,
    provider: fakeProvider({ analysis: visionAnalysis({ page: { pageType: "article", columnCount: 2, confidence: 0.97 } }) })
  });
  assert.equal(result.selectedSemanticPage.styleHints.columnCount, 2);
}

{
  const models = baseModels([item("p1", "paragraph", "Both providers paragraph.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 })]);
  const result = await runDocumentUnderstandingPipeline({
    ...models,
    page,
    provider: fakeProvider({ analysis: bothAnalysis({ pageAnalysis: { columnCountCandidates: [{ value: 2, confidence: 0.9 }] } }, { page: { columnCount: 2, confidence: 0.98 } }) })
  });
  assert.equal(result.documentUnderstanding.mode, "hybrid-local");
  assert.equal(result.selectedSemanticPage.styleHints.columnCount, 2);
}

{
  const parsed = parseProviderJsonOutput("Here is JSON:\n```json\n{\"schemaVersion\":\"x\"}\n```");
  assert.equal(parsed.schemaVersion, "x");
}

{
  const parsed = parseProviderJsonOutput("{schemaVersion:\"x\",}");
  assert.equal(parsed.schemaVersion, "x");
}

{
  const normalized = normalizeDocumentProviderAnalysis({
    provider: { type: "document-parser", name: "confidence-test", model: "PaddleOCR-VL", device: "cuda" },
    elements: [
      { id: "without-confidence", providerType: "text", text: "No confidence was returned.", sourceBBox: { x: 0.1, y: 0.1, width: 0.4, height: 0.04 }, confidence: null },
      { id: "with-confidence", providerType: "text", text: "Confidence was returned.", sourceBBox: { x: 0.1, y: 0.2, width: 0.4, height: 0.04 }, confidence: 0.82 }
    ]
  });
  assert.equal(normalized.elements[0].confidence, null);
  assert.equal(normalized.elements[1].confidence, 0.82);
}

{
  const provider = createLocalServiceDocumentUnderstandingProvider({
    timeoutMs: 5,
    fetchImpl: () => new Promise((_resolve, reject) => setTimeout(() => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, 1))
  });
  const health = await provider.health();
  assert.equal(health.status, "unavailable");
  assert.equal(health.timeout, true);
}

{
  const models = baseModels([item("p1", "paragraph", "GPU failure paragraph.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 })]);
  const result = await runDocumentUnderstandingPipeline({ ...models, page, provider: fakeProvider({ throwPage: true }) });
  assert.equal(result.documentUnderstanding.selectedCandidateId, "heuristic");
}

{
  const models = baseModels([item("p1", "paragraph", "Column conflict paragraph.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 })]);
  const reconciliation = reconcileDocumentAnalysis({
    ...models,
    providerAnalysis: bothAnalysis({ pageAnalysis: { columnCountCandidates: [{ value: 1, confidence: 0.6 }] } }, { page: { columnCount: 2, confidence: 0.99 } })
  });
  const columnDecision = reconciliation.decisions.find(decision => decision.decision === "column-count" && decision.value === 2);
  assert.ok(columnDecision);
  assert.ok(columnDecision.confidence > 0.4);
}

{
  const models = baseModels([item("p1", "paragraph", "The animals crossed.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 })], {
    evidence: {
      pdfTextItems: [{ id: "pdf-1", sourceItemId: "p1", text: "animals", bbox: { x: 0.1, y: 0.1, width: 0.14, height: 0.03 }, confidence: 99 }],
      ocrLines: [{ id: "ocr-1", sourceItemId: "p1", text: "animats", bbox: { x: 0.1, y: 0.1, width: 0.14, height: 0.03 }, confidence: 76 }]
    }
  });
  assert.ok(models.semanticValidation.issues.some(issue => issue.type === "possible-recognition-disagreement"));
}

{
  const sourceImages = [{ id: "img1", accepted: true, url: "/national-test-page-images/img.jpg", crop: { x: 0.1, y: 0.5, width: 0.7, height: 0.25 } }];
  const models = baseModels([item("p1", "paragraph", "Image text.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 })], { sourceImages });
  removeImages(models.semanticPage);
  models.semanticValidation = validateSemanticReconstruction({ sourceEvidence: models.sourceEvidence, semanticPage: models.semanticPage });
  const result = await runDocumentUnderstandingPipeline({
    ...models,
    page,
    provider: fakeProvider({
      analysis: bothAnalysis(
        { visualClassifications: [{ sourceRegionId: models.sourceEvidence.visualEvidence.imageCandidates[0].id, classification: "document-image", confidence: 0.88 }] },
        { visualClassifications: [{ sourceRegionId: models.sourceEvidence.visualEvidence.imageCandidates[0].id, classification: "artifact", confidence: 0.96 }] }
      )
    })
  });
  assert.equal(result.selectedSemanticPage.elements.some(element => ["image", "illustration", "table"].includes(element.type)), false);
}

{
  const sourceImages = [{ id: "img1", accepted: true, url: "/national-test-page-images/img.jpg", crop: { x: 0.1, y: 0.5, width: 0.7, height: 0.25 } }];
  const models = baseModels([item("p1", "paragraph", "Image text.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 })], { sourceImages });
  removeImages(models.semanticPage);
  models.semanticValidation = validateSemanticReconstruction({ sourceEvidence: models.sourceEvidence, semanticPage: models.semanticPage });
  const regionId = models.sourceEvidence.visualEvidence.imageCandidates[0].id;
  const result = await runDocumentUnderstandingPipeline({
    ...models,
    page,
    provider: fakeProvider({ analysis: visionAnalysis({ visualClassifications: [{ sourceRegionId: regionId, classification: "document-image", confidence: 0.96 }] }) })
  });
  assert.ok(result.selectedSemanticPage.elements.some(element => element.type === "image" && element.sourceEvidenceIds.includes(regionId)));
}

{
  const models = baseModels([
    item("l1", "paragraph", "This paragraph continues and", { x: 0.1, y: 0.4, width: 0.32, height: 0.04 }),
    item("r1", "paragraph", "finishes in the next column.", { x: 0.56, y: 0.12, width: 0.32, height: 0.04 })
  ]);
  const [left, right] = models.semanticPage.elements.filter(element => element.type === "paragraph");
  const result = await runDocumentUnderstandingPipeline({
    ...models,
    page,
    provider: fakeProvider({
      regionAnalysis: visionAnalysis({
        relationships: [{
          type: "continues",
          fromEvidenceIds: right.sourceEvidenceIds,
          toEvidenceIds: left.sourceEvidenceIds,
          confidence: 0.95
        }]
      })
    })
  });
  assert.ok(result.selectedSemanticPage.relationships.some(rel => rel.type === "continues" && rel.from === right.id && rel.to === left.id));
  assert.ok(result.documentUnderstanding.targetedAnalyses.length <= 2);
}

{
  const models = baseModels([
    item("q1", "question", "1 What is true?", { x: 0.1, y: 0.1, width: 0.7, height: 0.04 }),
    item("a", "option", "A It works.", { x: 0.14, y: 0.16, width: 0.5, height: 0.03 })
  ]);
  models.semanticPage.relationships = models.semanticPage.relationships.filter(rel => rel.type !== "optionOf");
  models.semanticValidation = validateSemanticReconstruction({ sourceEvidence: models.sourceEvidence, semanticPage: models.semanticPage });
  const question = models.semanticPage.elements.find(element => element.type === "question");
  const option = models.semanticPage.elements.find(element => element.type === "option");
  const result = await runDocumentUnderstandingPipeline({
    ...models,
    page,
    provider: fakeProvider({
      regionAnalysis: visionAnalysis({
        relationships: [{
          type: "optionOf",
          fromEvidenceIds: option.sourceEvidenceIds,
          toEvidenceIds: question.sourceEvidenceIds,
          confidence: 0.97
        }]
      })
    })
  });
  assert.ok(result.selectedSemanticPage.relationships.some(rel => rel.type === "optionOf" && rel.from === option.id && rel.to === question.id));
}

{
  const sourceImages = [{ id: "img1", accepted: true, url: "/national-test-page-images/img.jpg", crop: { x: 0.1, y: 0.5, width: 0.7, height: 0.25 } }];
  const models = baseModels([item("p1", "paragraph", "Missing image text.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 })], { sourceImages });
  removeImages(models.semanticPage);
  models.semanticValidation = validateSemanticReconstruction({ sourceEvidence: models.sourceEvidence, semanticPage: models.semanticPage });
  const regionId = models.sourceEvidence.visualEvidence.imageCandidates[0].id;
  const result = await runDocumentUnderstandingPipeline({
    ...models,
    page,
    provider: fakeProvider({
      regionAnalysis: visionAnalysis({ visualClassifications: [{ sourceRegionId: regionId, classification: "document-image", confidence: 0.97 }] })
    })
  });
  assert.ok(result.selectedSemanticPage.elements.some(element => element.sourceEvidenceIds.includes(regionId)));
}

{
  const models = baseModels([item("p1", "paragraph", "Stable IDs.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 })]);
  const first = await runDocumentUnderstandingPipeline({ ...models, page, provider: fakeProvider({ analysis: visionAnalysis({ page: { columnCount: 1, confidence: 0.9 } }) }) });
  const second = await runDocumentUnderstandingPipeline({ ...models, page, provider: fakeProvider({ analysis: visionAnalysis({ page: { columnCount: 1, confidence: 0.9 } }) }) });
  assert.deepEqual(first.selectedSemanticPage.elements.map(element => element.id), second.selectedSemanticPage.elements.map(element => element.id));
}

{
  const models = baseModels([
    item("p1", "paragraph", "Merge one.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 }),
    item("p2", "paragraph", "Merge two.", { x: 0.1, y: 0.2, width: 0.7, height: 0.05 })
  ]);
  const evidenceIds = models.semanticPage.elements.filter(element => element.type === "paragraph").flatMap(element => element.sourceEvidenceIds);
  const reconciliation = reconcileDocumentAnalysis({
    ...models,
    providerAnalysis: visionAnalysis({ groups: [{ id: "g1", type: "paragraphGroup", memberEvidenceIds: evidenceIds, confidence: 0.95 }] })
  });
  const refined = refineNationalTestSemanticPageModel({ ...models, reconciliation });
  const group = refined.elements.find(element => element.type === "paragraphGroup" && evidenceIds.every(id => element.sourceEvidenceIds.includes(id)));
  assert.ok(group);
}

{
  const sourceImages = [{ id: "img1", accepted: true, url: "/national-test-page-images/img.jpg", crop: { x: 0.1, y: 0.5, width: 0.7, height: 0.25 } }];
  const models = baseModels([item("p1", "paragraph", "Improve image validation.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 })], { sourceImages });
  removeImages(models.semanticPage);
  models.semanticValidation = validateSemanticReconstruction({ sourceEvidence: models.sourceEvidence, semanticPage: models.semanticPage });
  const before = models.semanticValidation.score;
  const regionId = models.sourceEvidence.visualEvidence.imageCandidates[0].id;
  const result = await runDocumentUnderstandingPipeline({
    ...models,
    page,
    provider: fakeProvider({ analysis: visionAnalysis({ visualClassifications: [{ sourceRegionId: regionId, classification: "document-image", confidence: 0.97 }] }) })
  });
  assert.ok(result.selectedValidation.score >= before);
}

{
  const models = baseModels([item("p1", "paragraph", "Candidate selection.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 })]);
  const worse = { ...models.semanticValidation, status: "retry", score: 0.1 };
  const selected = selectBestSemanticCandidate([
    { id: "heuristic", semanticPage: models.semanticPage, validation: models.semanticValidation },
    { id: "bad-provider", semanticPage: { ...models.semanticPage, elements: [] }, validation: worse }
  ], models.semanticValidation);
  assert.equal(selected.id, "heuristic");
}

{
  const models = baseModels([
    item("l1", "paragraph", "Loop issue continues and", { x: 0.1, y: 0.4, width: 0.32, height: 0.04 }),
    item("r1", "paragraph", "continues over here.", { x: 0.56, y: 0.12, width: 0.32, height: 0.04 })
  ]);
  const provider = fakeProvider({ regionAnalysis: visionAnalysis({}), maxRegionCalls: 1 });
  await runDocumentUnderstandingPipeline({ ...models, page, provider, maxTargetedAnalyses: 1 });
  assert.equal(provider.regionCalls, 1);
}

{
  const models = baseModels([item("p1", "paragraph", "No A4 coordinates.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 })]);
  const result = await runDocumentUnderstandingPipeline({ ...models, page, provider: fakeProvider({ analysis: visionAnalysis({ page: { columnCount: 1, confidence: 0.9 } }) }) });
  assert.equal(semanticPageContainsFinalCoordinates(result.selectedSemanticPage), false);
}

{
  const pageLayout = { pageSize: { width: 794, height: 1123, unit: "px", format: "A4" }, elements: [{ id: "visible", type: "text", x: 10, y: 10, width: 100, height: 20 }] };
  const before = JSON.stringify(pageLayout);
  const models = baseModels([item("p1", "paragraph", "Visible rendering source remains pageLayout.", { x: 0.1, y: 0.1, width: 0.7, height: 0.05 })]);
  await runDocumentUnderstandingPipeline({ ...models, page, provider: fakeProvider({ analysis: visionAnalysis({}) }) });
  assert.equal(JSON.stringify(pageLayout), before);
}

{
  const hybrid = createHybridDocumentUnderstandingProvider({
    localProvider: {
      async health() {
        return { status: "unavailable", providers: { documentParser: { available: false }, visionReasoner: { available: false } } };
      },
      async analyzePage() {
        throw new Error("should not be required");
      }
    }
  });
  const health = await hybrid.health();
  assert.equal(health.mode, "heuristic-fallback");
}

console.log("document understanding tests passed");
