import assert from "node:assert/strict";
import {
  buildNationalTestSemanticPageModel,
  buildNationalTestSourceEvidenceModel,
  semanticPageContainsFinalCoordinates,
  validateNationalTestSemanticPageModel,
  validateNationalTestSourceEvidenceModel
} from "../public/js/national-test-semantic-models.js";

const page = {
  id: "page-4",
  testId: "test-semantic",
  pageNumber: 4,
  sourcePage: { url: "/source.jpg", pixelWidth: 1600, pixelHeight: 2200, sourceCrop: { x: 0, y: 0, width: 1, height: 1 } },
  normalizedPage: { url: "/normalized.jpg", pixelWidth: 1200, pixelHeight: 1700 },
  sourceSelection: { crop: { x: 0, y: 0, width: 1, height: 1 } },
  sourceProcessing: { preset: "clean", rotation: 0, brightness: 106, contrast: 118, sharpen: 1 }
};

function item(id, role, text, bbox, confidence = 94) {
  return { id, role, text, rawText: text, bbox, confidence };
}

function models({ items, sourceImages = [], evidence = {}, adaptiveRegions = [] }) {
  const extraction = {
    source: evidence.ocrWords || evidence.ocrLines || evidence.ocrBlocks ? "combined" : "ocr",
    language: "en",
    averageConfidence: 91,
    strategy: "whole-page",
    pageStructure: { type: "article", templateHint: "mirror", features: { columnCount: 1 } },
    evidence,
    items
  };
  const sourceEvidence = buildNationalTestSourceEvidenceModel({ page, extraction, sourceImages, adaptiveRegions });
  const semanticPage = buildNationalTestSemanticPageModel({ page, extraction, sourceEvidence, sourceImages, adaptiveRegions });
  return { extraction, sourceEvidence, semanticPage };
}

function byType(model, type) {
  return model.elements.filter(element => element.type === type);
}

function rels(model, type) {
  return model.relationships.filter(relationship => relationship.type === type);
}

function assertValid(sourceEvidence, semanticPage) {
  const sourceValidation = validateNationalTestSourceEvidenceModel(sourceEvidence);
  assert.equal(sourceValidation.valid, true, JSON.stringify(sourceValidation.issues, null, 2));
  const semanticValidation = validateNationalTestSemanticPageModel(semanticPage, sourceEvidence);
  assert.equal(semanticValidation.valid, true, JSON.stringify(semanticValidation.issues, null, 2));
}

{
  const { sourceEvidence, semanticPage } = models({
    items: [
      item("p1", "paragraph", "One clear paragraph.", { x: 0.12, y: 0.14, width: 0.72, height: 0.05 }),
      item("p2", "paragraph", "Second paragraph follows.", { x: 0.12, y: 0.22, width: 0.72, height: 0.05 })
    ]
  });
  assert.equal(byType(semanticPage, "paragraph").length, 2);
  assert.equal(byType(semanticPage, "paragraphGroup").length, 1);
  assertValid(sourceEvidence, semanticPage);
}

{
  const { sourceEvidence, semanticPage } = models({
    items: [
      item("l1", "paragraph", "Left column paragraph one.", { x: 0.12, y: 0.16, width: 0.32, height: 0.08 }),
      item("l2", "paragraph", "Left column paragraph two.", { x: 0.12, y: 0.29, width: 0.32, height: 0.08 }),
      item("r1", "paragraph", "Right column paragraph one.", { x: 0.56, y: 0.16, width: 0.32, height: 0.08 }),
      item("r2", "paragraph", "Right column paragraph two.", { x: 0.56, y: 0.29, width: 0.32, height: 0.08 })
    ]
  });
  assert.equal(byType(semanticPage, "columnGroup").length, 1);
  assert.equal(byType(semanticPage, "column").length, 2);
  assert.ok(rels(semanticPage, "columnOf").length >= 4);
  assertValid(sourceEvidence, semanticPage);
}

{
  const { sourceEvidence, semanticPage } = models({
    items: [
      item("title", "title", "A Wide Title", { x: 0.12, y: 0.06, width: 0.76, height: 0.04 }),
      item("l1", "paragraph", "Left body.", { x: 0.12, y: 0.18, width: 0.32, height: 0.08 }),
      item("r1", "paragraph", "Right body.", { x: 0.56, y: 0.18, width: 0.32, height: 0.08 })
    ]
  });
  const title = byType(semanticPage, "title")[0];
  assert.equal(title.layoutIntent.spansColumns, true);
  assert.equal(rels(semanticPage, "spansColumns").some(rel => rel.from === title.id), true);
  assertValid(sourceEvidence, semanticPage);
}

{
  const { sourceEvidence, semanticPage } = models({
    items: [
      item("q1", "question", "1 What is said about the river?", { x: 0.1, y: 0.1, width: 0.7, height: 0.04 }),
      item("a", "option", "A It is long.", { x: 0.14, y: 0.16, width: 0.5, height: 0.035 }),
      item("b", "option", "B It is dry.", { x: 0.14, y: 0.21, width: 0.5, height: 0.035 }),
      item("c", "option", "C It is new.", { x: 0.14, y: 0.26, width: 0.5, height: 0.035 }),
      item("d", "option", "D It is dangerous.", { x: 0.14, y: 0.31, width: 0.5, height: 0.035 })
    ]
  });
  assert.equal(byType(semanticPage, "question").length, 1);
  assert.equal(byType(semanticPage, "option").length, 4);
  assert.equal(rels(semanticPage, "optionOf").length, 4);
  assertValid(sourceEvidence, semanticPage);
}

{
  const { sourceEvidence, semanticPage } = models({
    items: [
      item("q1", "question", "1 First question?", { x: 0.1, y: 0.1, width: 0.7, height: 0.04 }),
      item("q1a", "option", "A First answer.", { x: 0.14, y: 0.16, width: 0.5, height: 0.035 }),
      item("q2", "question", "2 Second question?", { x: 0.1, y: 0.25, width: 0.7, height: 0.04 }),
      item("q2a", "option", "A Second answer.", { x: 0.14, y: 0.31, width: 0.5, height: 0.035 })
    ]
  });
  assert.equal(byType(semanticPage, "question").length, 2);
  assert.equal(rels(semanticPage, "optionOf").length, 2);
  assert.equal(rels(semanticPage, "optionOf").some(rel => rel.from === "option-2-a" && rel.to === "question-2"), true);
  assertValid(sourceEvidence, semanticPage);
}

{
  const question = item("q1", "question", "1 Write the missing word ________.", { x: 0.1, y: 0.1, width: 0.7, height: 0.04 });
  question.gaps = [{ x: 0.62, width: 0.2 }];
  const { sourceEvidence, semanticPage } = models({ items: [question] });
  assert.ok(byType(semanticPage, "answerGap").length >= 1);
  assert.ok(byType(semanticPage, "answerLine").length >= 1);
  assert.ok(rels(semanticPage, "answerAreaOf").length >= 2);
  assertValid(sourceEvidence, semanticPage);
}

{
  const { sourceEvidence, semanticPage } = models({
    items: [
      item("blank-p", "paragraph", "The answer is ________ because the clue says so.", { x: 0.1, y: 0.1, width: 0.72, height: 0.05 })
    ]
  });
  assert.equal(byType(semanticPage, "answerGap").length, 1);
  assert.equal(rels(semanticPage, "anchoredTo").some(rel => rel.from.startsWith("answer-gap")), true);
  assertValid(sourceEvidence, semanticPage);
}

{
  const { sourceEvidence, semanticPage } = models({
    items: [
      item("p1", "paragraph", "Article text before image.", { x: 0.12, y: 0.12, width: 0.72, height: 0.08 }),
      item("footer", "footer", "8 NATIONAL TEST PAGE", { x: 0.08, y: 0.94, width: 0.45, height: 0.02 })
    ],
    sourceImages: [{ id: "img1", accepted: true, url: "/img.jpg", crop: { x: 0.1, y: 0.54, width: 0.78, height: 0.28 } }]
  });
  const image = byType(semanticPage, "image")[0];
  assert.ok(image);
  assert.ok(rels(semanticPage, "anchoredTo").some(rel => rel.from === image.id));
  assert.ok(semanticPage.readingOrder.indexOf(image.id) > semanticPage.readingOrder.indexOf(byType(semanticPage, "paragraph")[0].id));
  assertValid(sourceEvidence, semanticPage);
}

{
  const { sourceEvidence, semanticPage } = models({
    items: [item("p1", "paragraph", "Text beside image.", { x: 0.1, y: 0.2, width: 0.35, height: 0.1 })],
    sourceImages: [{ id: "side-img", accepted: true, url: "/side.jpg", crop: { x: 0.56, y: 0.18, width: 0.32, height: 0.16 } }]
  });
  assert.equal(byType(semanticPage, "image").length, 1);
  assert.equal(rels(semanticPage, "anchoredTo").length >= 1, true);
  assertValid(sourceEvidence, semanticPage);
}

{
  const { sourceEvidence, semanticPage } = models({
    items: [item("footer", "footer", "8 NATIONAL TEST PAGE", { x: 0.08, y: 0.94, width: 0.45, height: 0.02 })]
  });
  assert.equal(byType(semanticPage, "footer").length, 1);
  assert.equal(byType(semanticPage, "pageNumber").length, 1);
  assertValid(sourceEvidence, semanticPage);
}

{
  const { sourceEvidence, semanticPage } = models({
    items: [item("p1", "paragraph", "Duplicate observed text.", { x: 0.1, y: 0.1, width: 0.5, height: 0.04 })],
    evidence: {
      pdfTextItems: [{ id: "pdf-1", text: "Duplicate observed text.", bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.04 }, confidence: 99 }],
      ocrBlocks: [{ id: "ocr-b1", sourceItemId: "p1", text: "Duplicate observed text.", bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.04 }, confidence: 90 }],
      ocrLines: [{ id: "ocr-l1", blockId: "ocr-b1", sourceItemId: "p1", text: "Duplicate observed text.", bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.04 }, confidence: 90 }],
      ocrWords: [{ id: "ocr-w1", lineId: "ocr-l1", blockId: "ocr-b1", sourceItemId: "p1", text: "Duplicate", bbox: { x: 0.1, y: 0.1, width: 0.15, height: 0.03 }, confidence: 90 }]
    }
  });
  assert.equal(sourceEvidence.pdfTextEvidence.length, 1);
  assert.equal(sourceEvidence.ocrEvidence.blocks.length, 1);
  assert.equal(sourceEvidence.ocrEvidence.lines.length, 1);
  assert.equal(sourceEvidence.ocrEvidence.words.length, 1);
  assertValid(sourceEvidence, semanticPage);
}

{
  const { sourceEvidence } = models({
    items: [item("p1", "paragraph", "Same text.", { x: 0.1, y: 0.1, width: 0.5, height: 0.04 })],
    evidence: {
      pdfTextItems: [{ text: "Same text.", bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.04 }, confidence: 99 }],
      ocrLines: [{ id: "ocr-l1", text: "Same text.", bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.04 }, confidence: 88 }]
    }
  });
  assert.equal(sourceEvidence.pdfTextEvidence.length, 1);
  assert.equal(sourceEvidence.ocrEvidence.lines.length, 1);
}

{
  const { sourceEvidence, semanticPage } = models({
    items: [item("p1", "paragraph", "Paragraph.", { x: 0.1, y: 0.1, width: 0.5, height: 0.04 })]
  });
  semanticPage.relationships.push({ id: "bad-rel", type: "optionOf", from: "missing", to: "also-missing", confidence: 0.5 });
  const validation = validateNationalTestSemanticPageModel(semanticPage, sourceEvidence);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some(issue => issue.code === "missing-relationship-from"));
}

{
  const { sourceEvidence, semanticPage } = models({
    items: [item("p1", "paragraph", "Paragraph.", { x: 0.1, y: 0.1, width: 0.5, height: 0.04 })]
  });
  semanticPage.elements[0].sourceEvidenceIds.push("missing-source-evidence");
  const validation = validateNationalTestSemanticPageModel(semanticPage, sourceEvidence);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some(issue => issue.code === "missing-source-evidence"));
}

{
  const input = {
    items: [
      item("p1", "paragraph", "Stable paragraph.", { x: 0.1, y: 0.1, width: 0.5, height: 0.04 }),
      item("q1", "question", "1 Stable question?", { x: 0.1, y: 0.2, width: 0.5, height: 0.04 })
    ]
  };
  const first = models(input);
  const second = models(input);
  assert.deepEqual(first.sourceEvidence.ocrEvidence.blocks.map(block => block.id), second.sourceEvidence.ocrEvidence.blocks.map(block => block.id));
  assert.deepEqual(first.semanticPage.elements.map(element => element.id), second.semanticPage.elements.map(element => element.id));
}

{
  const { semanticPage } = models({
    items: [
      item("p1", "paragraph", "Moving the source bbox must not create final coordinates.", { x: 0.05, y: 0.85, width: 0.9, height: 0.04 })
    ]
  });
  assert.equal(semanticPageContainsFinalCoordinates(semanticPage), false);
}

console.log("national-test semantic model tests passed");
