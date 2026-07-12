export function studyDocumentPageBinding(page) {
  const pageNumber = positiveInteger(page?.pageNumber);
  const explicitSourceIndex = nonNegativeInteger(page?.sourcePage?.sourcePageIndex);
  const sourcePageNumber = positiveInteger(page?.sourcePage?.pageNumber) || pageNumber;
  return {
    documentId: String(page?.id || ""),
    pageNumber,
    sourcePageIndex: explicitSourceIndex ?? Math.max(0, sourcePageNumber - 1)
  };
}

export function validateStudyDocumentPageBinding(document, page) {
  const expected = studyDocumentPageBinding(page);
  const errors = [];
  if (document?.documentId !== expected.documentId) {
    errors.push({
      code: "page-binding-mismatch",
      path: "$.documentId",
      message: `documentId must match the selected app page: ${expected.documentId}.`
    });
  }
  if (document?.pageNumber !== expected.pageNumber) {
    errors.push({
      code: "page-binding-mismatch",
      path: "$.pageNumber",
      message: `pageNumber must match the selected app page: ${expected.pageNumber}.`
    });
  }
  if (document?.source?.sourcePageIndex !== expected.sourcePageIndex) {
    errors.push({
      code: "page-binding-mismatch",
      path: "$.source.sourcePageIndex",
      message: `sourcePageIndex must match the selected PDF page: ${expected.sourcePageIndex}.`
    });
  }
  return { valid: errors.length === 0, errors, expected };
}

export function studyDocumentPagePrompt(page) {
  const binding = studyDocumentPageBinding(page);
  return [
    "Convert the attached page image according to STUDY_DOCUMENT_V1_SPEC.md.",
    "Use this exact root metadata:",
    `- schemaVersion: study-document/v1`,
    `- documentId: ${binding.documentId}`,
    `- pageNumber: ${binding.pageNumber}`,
    `- source.kind: page-image`,
    `- source.sourcePageIndex: ${binding.sourcePageIndex}`,
    "The printed page number visible in the image is document content; preserve it as footer text when visible and do not use it to replace the root pageNumber.",
    "Follow the canonical field names exactly: group content uses children, and text content uses value.",
    "Use only group, text, flow, gap, list, graphic, table, and rule nodes. Preserve readable English exactly, do not answer questions, and do not fill gaps.",
    "Represent each question as group(role=question), preserve its visible number as text(role=number), and use list(role=choices) with stable item IDs for multiple-choice options.",
    "For One Word Gaps and other numbered blanks embedded in a passage, keep each blank as a gap in its exact flow position and set gap.label to the visible question number; do not create artificial question groups around passage fragments.",
    "When the image shows a separate square after every lettered choice, set selectionControl to checkbox on that choices list; do not omit the squares or replace the letter markers.",
    "Preserve visible paragraph boundaries. If a graphic, caption, credit, note, or box belongs to one column, use fixed columns with one block group per column and keep the owned content in that group; keep spanning graphics outside the column groups.",
    "Validate the result against the specification, then return JSON only."
  ].join("\n");
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}
