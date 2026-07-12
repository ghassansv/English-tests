import assert from "node:assert/strict";
import {
  buildNationalTestSemanticPageModel,
  buildNationalTestSourceEvidenceModel,
  semanticPageContainsFinalCoordinates
} from "../public/js/national-test-semantic-models.js";
import {
  SEMANTIC_VALIDATION_SCHEMA_VERSION,
  validateSemanticReconstruction
} from "../public/js/national-test-semantic-validator.js";

const page = {
  id: "validation-page",
  testId: "validation-test",
  pageNumber: 4,
  sourcePage: { url: "/source.jpg", pixelWidth: 1600, pixelHeight: 2200, sourceCrop: { x: 0, y: 0, width: 1, height: 1 } },
  normalizedPage: { url: "/normalized.jpg", pixelWidth: 1200, pixelHeight: 1700 }
};

function item(id, role, text, bbox, confidence = 94) {
  return { id, role, text, rawText: text, bbox, confidence };
}

function makeModels(items, options = {}) {
  const extraction = {
    source: options.evidence ? "combined" : "ocr",
    language: "en",
    averageConfidence: 92,
    strategy: "whole-page",
    pageStructure: { type: options.pageType || "article", templateHint: "mirror", features: { columnCount: options.columnCount || 1 } },
    evidence: options.evidence || {},
    items
  };
  const sourceImages = options.sourceImages || [];
  const adaptiveRegions = options.adaptiveRegions || [];
  const sourceEvidence = buildNationalTestSourceEvidenceModel({ page, extraction, sourceImages, adaptiveRegions });
  const semanticPage = buildNationalTestSemanticPageModel({ page, extraction, sourceEvidence, sourceImages, adaptiveRegions });
  if (options.mutate) options.mutate({ sourceEvidence, semanticPage, extraction });
  const report = validateSemanticReconstruction({ sourceEvidence, semanticPage });
  return { sourceEvidence, semanticPage, report };
}

function issueTypes(report) {
  return report.issues.map(issue => issue.type);
}

function assertHasIssue(report, type) {
  assert.ok(issueTypes(report).includes(type), `Expected issue ${type}, got ${issueTypes(report).join(", ")}`);
}

function assertNoIssue(report, type) {
  assert.equal(issueTypes(report).includes(type), false, `Unexpected issue ${type}`);
}

function removeElements(semanticPage, predicate) {
  const removed = semanticPage.elements.filter(predicate).map(element => element.id);
  semanticPage.elements = semanticPage.elements.filter(element => !removed.includes(element.id));
  semanticPage.relationships = semanticPage.relationships.filter(relationship => !removed.includes(relationship.from) && !removed.includes(relationship.to));
  semanticPage.readingOrder = semanticPage.readingOrder.filter(id => !removed.includes(id));
  return removed;
}

{
  const { report } = makeModels([
    item("p1", "paragraph", "A complete paragraph is represented.", { x: 0.1, y: 0.12, width: 0.7, height: 0.05 })
  ]);
  assert.equal(report.schemaVersion, SEMANTIC_VALIDATION_SCHEMA_VERSION);
  assert.equal(report.scores.textCoverage, 1);
  assertNoIssue(report, "missing-text");
}

{
  const { report } = makeModels([
    item("p1", "paragraph", "First paragraph.", { x: 0.1, y: 0.12, width: 0.7, height: 0.05 }),
    item("p2", "paragraph", "Second paragraph disappears.", { x: 0.1, y: 0.22, width: 0.7, height: 0.05 })
  ], {
    mutate: ({ semanticPage }) => removeElements(semanticPage, element => element.id.includes("p2"))
  });
  assertHasIssue(report, "missing-text");
  assert.ok(report.suggestedPatches.some(patch => patch.type === "create-semantic-element"));
}

{
  const { report } = makeModels([
    item("p1", "paragraph", "Duplicate paragraph.", { x: 0.1, y: 0.12, width: 0.7, height: 0.05 })
  ], {
    mutate: ({ semanticPage }) => {
      const paragraph = semanticPage.elements.find(element => element.type === "paragraph");
      semanticPage.elements.push({ ...paragraph, id: `${paragraph.id}-duplicate` });
      semanticPage.readingOrder.push(`${paragraph.id}-duplicate`);
    }
  });
  assertHasIssue(report, "duplicate-semantic-text");
}

{
  const { sourceEvidence, report } = makeModels([
    item("p1", "paragraph", "PDF and OCR observed the same text.", { x: 0.1, y: 0.12, width: 0.7, height: 0.05 })
  ], {
    evidence: {
      pdfTextItems: [{ id: "pdf-1", sourceItemId: "p1", text: "PDF and OCR observed the same text.", bbox: { x: 0.1, y: 0.12, width: 0.7, height: 0.05 }, confidence: 99 }],
      ocrLines: [{ id: "ocr-line-1", sourceItemId: "p1", text: "PDF and OCR observed the same text.", bbox: { x: 0.1, y: 0.12, width: 0.7, height: 0.05 }, confidence: 90 }]
    }
  });
  assert.equal(sourceEvidence.pdfTextEvidence.length, 1);
  assert.equal(sourceEvidence.ocrEvidence.lines.length, 1);
  assert.equal(report.observedCounts.canonicalTextUnits, 1);
  assertNoIssue(report, "duplicate-semantic-text");
}

{
  const { report } = makeModels([
    item("p1", "paragraph", "The animals crossed the road.", { x: 0.1, y: 0.12, width: 0.7, height: 0.05 })
  ], {
    evidence: {
      pdfTextItems: [{ id: "pdf-1", sourceItemId: "p1", text: "animals", bbox: { x: 0.1, y: 0.12, width: 0.16, height: 0.03 }, confidence: 99 }],
      ocrLines: [{ id: "ocr-line-1", sourceItemId: "p1", text: "animats", bbox: { x: 0.1, y: 0.12, width: 0.16, height: 0.03 }, confidence: 76 }]
    }
  });
  assertHasIssue(report, "possible-recognition-disagreement");
}

{
  const { report } = makeModels([
    item("q1", "question", "1 What is true?", { x: 0.1, y: 0.1, width: 0.7, height: 0.04 }),
    item("a", "option", "A It is red.", { x: 0.14, y: 0.16, width: 0.5, height: 0.03 }),
    item("b", "option", "B It is blue.", { x: 0.14, y: 0.21, width: 0.5, height: 0.03 }),
    item("c", "option", "C It is green.", { x: 0.14, y: 0.26, width: 0.5, height: 0.03 }),
    item("d", "option", "D It is yellow.", { x: 0.14, y: 0.31, width: 0.5, height: 0.03 })
  ]);
  assert.equal(report.observedCounts.questionCandidates, 1);
  assert.equal(report.observedCounts.optionCandidates, 4);
  assertNoIssue(report, "missing-option");
  assertNoIssue(report, "orphan-option");
}

{
  const { report } = makeModels([
    item("q1", "question", "1 What is true?", { x: 0.1, y: 0.1, width: 0.7, height: 0.04 }),
    item("a", "option", "A It is red.", { x: 0.14, y: 0.16, width: 0.5, height: 0.03 }),
    item("b", "option", "B It is blue.", { x: 0.14, y: 0.21, width: 0.5, height: 0.03 }),
    item("c", "option", "C It is green.", { x: 0.14, y: 0.26, width: 0.5, height: 0.03 }),
    item("d", "option", "D It is yellow.", { x: 0.14, y: 0.31, width: 0.5, height: 0.03 })
  ], {
    mutate: ({ semanticPage }) => removeElements(semanticPage, element => element.type === "option" && /^C\b/.test(element.text))
  });
  assertHasIssue(report, "missing-option");
}

{
  const { report } = makeModels([
    item("q1", "question", "1 What is true?", { x: 0.1, y: 0.1, width: 0.7, height: 0.04 }),
    item("a", "option", "A It is red.", { x: 0.14, y: 0.16, width: 0.5, height: 0.03 })
  ], {
    mutate: ({ semanticPage }) => {
      semanticPage.relationships = semanticPage.relationships.filter(relationship => relationship.type !== "optionOf");
    }
  });
  assertHasIssue(report, "orphan-option");
}

{
  const { report } = makeModels([
    item("q1", "question", "1 First question?", { x: 0.1, y: 0.1, width: 0.7, height: 0.04 }),
    item("a1", "option", "A First option.", { x: 0.14, y: 0.16, width: 0.5, height: 0.03 }),
    item("q2", "question", "2 Second question?", { x: 0.1, y: 0.28, width: 0.7, height: 0.04 }),
    item("a2", "option", "A Second option.", { x: 0.14, y: 0.34, width: 0.5, height: 0.03 })
  ], {
    mutate: ({ semanticPage }) => {
      const q1 = semanticPage.elements.find(element => element.id === "question-1");
      const option2 = semanticPage.elements.find(element => element.id === "option-2-a");
      semanticPage.relationships = semanticPage.relationships.map(relationship => relationship.from === option2.id && relationship.type === "optionOf"
        ? { ...relationship, to: q1.id }
        : relationship);
    }
  });
  assertHasIssue(report, "option-attached-to-wrong-question");
}

{
  const { report } = makeModels([
    item("q1", "question", "1 First question?", { x: 0.1, y: 0.1, width: 0.7, height: 0.04 }),
    item("q3", "question", "3 Third question?", { x: 0.1, y: 0.22, width: 0.7, height: 0.04 })
  ]);
  assertHasIssue(report, "question-sequence-gap");
}

{
  const { report } = makeModels([
    item("l1", "paragraph", "Left one.", { x: 0.1, y: 0.14, width: 0.32, height: 0.04 }),
    item("l2", "paragraph", "Left two.", { x: 0.1, y: 0.24, width: 0.32, height: 0.04 }),
    item("r1", "paragraph", "Right one.", { x: 0.56, y: 0.14, width: 0.32, height: 0.04 }),
    item("r2", "paragraph", "Right two.", { x: 0.56, y: 0.24, width: 0.32, height: 0.04 })
  ]);
  assertNoIssue(report, "probable-column-order-error");
  assert.equal(report.scores.readingOrder, 1);
}

{
  const { report } = makeModels([
    item("l1", "paragraph", "Left one.", { x: 0.1, y: 0.14, width: 0.32, height: 0.04 }),
    item("l2", "paragraph", "Left two.", { x: 0.1, y: 0.24, width: 0.32, height: 0.04 }),
    item("r1", "paragraph", "Right one.", { x: 0.56, y: 0.14, width: 0.32, height: 0.04 }),
    item("r2", "paragraph", "Right two.", { x: 0.56, y: 0.24, width: 0.32, height: 0.04 })
  ], {
    mutate: ({ semanticPage }) => {
      const paragraphs = semanticPage.elements.filter(element => element.type === "paragraph");
      const byText = text => paragraphs.find(element => element.text === text).id;
      semanticPage.readingOrder = [byText("Left one."), byText("Right one."), byText("Left two."), byText("Right two.")];
    }
  });
  assertHasIssue(report, "probable-column-order-error");
  assert.ok(report.suggestedPatches.some(patch => patch.type === "replace-reading-order"));
}

{
  const { semanticPage, report } = makeModels([
    item("title", "title", "Spanning Title", { x: 0.1, y: 0.06, width: 0.78, height: 0.04 }),
    item("l1", "paragraph", "Left body.", { x: 0.1, y: 0.18, width: 0.32, height: 0.04 }),
    item("r1", "paragraph", "Right body.", { x: 0.56, y: 0.18, width: 0.32, height: 0.04 })
  ]);
  assert.equal(semanticPage.readingOrder[0], "title-1");
  assertNoIssue(report, "probable-spanning-element-error");
}

{
  const { report } = makeModels([
    item("l1", "paragraph", "They equated freedom with open space and", { x: 0.1, y: 0.48, width: 0.32, height: 0.04 }),
    item("r1", "paragraph", "mobility across the plains.", { x: 0.56, y: 0.12, width: 0.32, height: 0.04 })
  ]);
  assertHasIssue(report, "probable-paragraph-continuation-error");
}

{
  const blank = item("q1", "question", "1 Complete the sentence ________.", { x: 0.1, y: 0.1, width: 0.7, height: 0.04 });
  blank.gaps = [{ x: 0.5, width: 0.2 }];
  const { report } = makeModels([blank], {
    mutate: ({ semanticPage }) => removeElements(semanticPage, element => element.type === "answerGap")
  });
  assertHasIssue(report, "missing-answer-gap");
}

{
  const blank = item("q1", "question", "1 Complete the sentence ________.", { x: 0.1, y: 0.1, width: 0.7, height: 0.04 });
  blank.gaps = [{ x: 0.5, width: 0.2 }];
  const { report } = makeModels([blank], {
    mutate: ({ semanticPage }) => removeElements(semanticPage, element => element.type === "answerLine")
  });
  assertHasIssue(report, "missing-answer-line");
}

{
  const { report } = makeModels([
    item("p1", "paragraph", "Text above the image.", { x: 0.1, y: 0.12, width: 0.7, height: 0.05 })
  ], {
    sourceImages: [{ id: "img1", accepted: true, url: "/image.jpg", crop: { x: 0.1, y: 0.5, width: 0.75, height: 0.25 } }],
    mutate: ({ semanticPage }) => removeElements(semanticPage, element => ["image", "illustration", "table"].includes(element.type))
  });
  assertHasIssue(report, "missing-semantic-image");
}

{
  const { report } = makeModels([
    item("p1", "paragraph", "Text above artifact.", { x: 0.1, y: 0.12, width: 0.7, height: 0.05 })
  ], {
    sourceImages: [{ id: "artifact", accepted: false, crop: { x: 0.1, y: 0.5, width: 0.75, height: 0.25 } }],
    mutate: ({ sourceEvidence, semanticPage }) => {
      sourceEvidence.visualEvidence.imageCandidates[0].artifactRisk = 0.95;
      removeElements(semanticPage, element => ["image", "illustration", "table"].includes(element.type));
    }
  });
  assertNoIssue(report, "missing-semantic-image");
}

{
  const { report } = makeModels([
    item("p1", "paragraph", "First.", { x: 0.1, y: 0.12, width: 0.7, height: 0.05 }),
    item("p2", "paragraph", "Second.", { x: 0.1, y: 0.22, width: 0.7, height: 0.05 })
  ], {
    mutate: ({ semanticPage }) => {
      const [first, second] = semanticPage.elements.filter(element => element.type === "paragraph");
      semanticPage.relationships.push({ id: "contradictory", type: "precedes", from: second.id, to: first.id, confidence: 0.9 });
      semanticPage.relationships.push({ id: "contradictory-2", type: "follows", from: second.id, to: first.id, confidence: 0.9 });
    }
  });
  assertHasIssue(report, "contradictory-relationship");
}

{
  const { report } = makeModels([
    item("p1", "paragraph", "First.", { x: 0.1, y: 0.12, width: 0.7, height: 0.05 }),
    item("p2", "paragraph", "Second.", { x: 0.1, y: 0.22, width: 0.7, height: 0.05 })
  ], {
    mutate: ({ semanticPage }) => {
      const [first, second] = semanticPage.elements.filter(element => element.type === "paragraph");
      semanticPage.relationships.push({ id: "cycle-1", type: "belongsTo", from: first.id, to: second.id, confidence: 0.9 });
      semanticPage.relationships.push({ id: "cycle-2", type: "belongsTo", from: second.id, to: first.id, confidence: 0.9 });
    }
  });
  assertHasIssue(report, "relationship-cycle");
}

{
  const first = makeModels([
    item("p1", "paragraph", "Stable validation paragraph.", { x: 0.1, y: 0.12, width: 0.7, height: 0.05 })
  ]);
  const second = validateSemanticReconstruction({ sourceEvidence: first.sourceEvidence, semanticPage: first.semanticPage });
  assert.deepEqual(first.report, second);
}

{
  const first = makeModels([
    item("p1", "paragraph", "Bbox shift should not change validation.", { x: 0.1, y: 0.12, width: 0.7, height: 0.05 })
  ]);
  const second = makeModels([
    item("p1", "paragraph", "Bbox shift should not change validation.", { x: 0.12, y: 0.16, width: 0.7, height: 0.05 })
  ]);
  assert.equal(semanticPageContainsFinalCoordinates(first.semanticPage), false);
  assert.equal(semanticPageContainsFinalCoordinates(second.semanticPage), false);
  assert.deepEqual(issueTypes(first.report), issueTypes(second.report));
  assert.equal(first.report.status, second.report.status);
  assert.equal(first.report.scores.textCoverage, second.report.scores.textCoverage);
}

console.log("national-test semantic validation tests passed");
