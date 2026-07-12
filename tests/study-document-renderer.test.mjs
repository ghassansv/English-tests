import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderStudyDocumentV1ToHtml } from "../public/js/study-document-v1-renderer.js";
import { validateStudyDocumentV1 } from "../public/js/study-document-v1.js";

const document = {
  schemaVersion: "study-document/v1",
  documentId: "renderer-test",
  pageNumber: 4,
  source: { kind: "page-image", sourcePageIndex: 3 },
  content: [
    { type: "rule", id: "rule-1", role: "decorative" },
    {
      type: "group",
      id: "group-1",
      role: "article",
      layout: "columns",
      columnCount: 2,
      flowMode: "continuous",
      children: [
        { type: "text", id: "text-1", role: "body", value: "Safe <text>" },
        {
          type: "flow",
          id: "flow-1",
          children: [
            { type: "text", id: "text-2", role: "body", value: "Answer " },
            { type: "gap", id: "gap-1", display: "inline", style: "line", size: "medium" }
          ]
        },
        {
          type: "list",
          id: "list-1",
          role: "choices",
          marker: "letters",
          selectionControl: "checkbox",
          items: [{ id: "item-1", children: [{ type: "text", id: "text-3", role: "option", value: "Option" }] }]
        },
        {
          type: "table",
          id: "table-1",
          role: "data-table",
          rows: [{ id: "row-1", cells: [{ id: "cell-1", children: [{ type: "text", id: "text-4", role: "body", value: "Cell" }] }] }]
        }
      ]
    },
    { type: "graphic", id: "graphic-1", role: "photo", assetId: "asset-1", placement: "center", size: "full", placeholder: false, aspectRatio: 2 },
    { type: "gap", id: "gap-2", display: "block", style: "line", lines: 2 }
  ]
};

const original = structuredClone(document);
const html = renderStudyDocumentV1ToHtml(document, {
  markerPageId: "page-4",
  overlayHtml: '<span data-overlay="yes"></span>',
  resolveAsset: node => node.assetId === "asset-1" ? "/asset.jpg" : ""
});

assert.match(html, /study-document-rendered-page/);
assert.match(html, /data-study-document-id="renderer-test"/);
assert.match(html, /data-test-page-marker-page-id="page-4"/);
assert.match(html, /study-document-layout--columns/);
assert.match(html, /data-study-node-id="flow-1"/);
assert.match(html, /study-document-marker--letters/);
assert.match(html, /study-document-choice-row/);
assert.match(html, /study-document-choice-content/);
assert.match(html, /study-document-choice-control--checkbox/);
assert.match(html, /study-document-table--data-table/);
assert.match(html, /src="\/asset\.jpg"/);
assert.match(html, /data-overlay="yes"/);
assert.match(html, /Safe &lt;text&gt;/);
assert.deepEqual(document, original, "renderer must not mutate the semantic document");

const callbackHtml = renderStudyDocumentV1ToHtml(document, {
  renderText: value => `<mark>${value}</mark>`
});
assert.match(callbackHtml, /<mark>Safe <text><\/mark>/);

const editableGraphicHtml = renderStudyDocumentV1ToHtml(document, {
  editGraphics: true,
  resolveAsset: node => node.assetId === "asset-1" ? "/asset.jpg" : ""
});
assert.match(editableGraphicHtml, /data-edit-study-document-graphic="graphic-1"/);
assert.match(editableGraphicHtml, /study-document-graphic--editable/);
assert.match(editableGraphicHtml, /role="button" tabindex="0"/);

const arabicQuestion = structuredClone(document);
arabicQuestion.content[1].role = "question";
const arabicHtml = renderStudyDocumentV1ToHtml(arabicQuestion, {
  language: "ar",
  showAnswers: true,
  answers: [{ questionId: "group-1", kind: "choice", choiceItemId: "item-1" }]
});
assert.match(arabicHtml, /study-document-rendered-page--ar/);
assert.match(arabicHtml, /lang="ar"/);
assert.match(arabicHtml, /dir="rtl"/);
assert.match(arabicHtml, /study-document-choice-control--checkbox is-checked/);
assert.match(arabicHtml, /الإجابة الرسمية/);

const invalid = structuredClone(document);
invalid.content[0].type = "line";
assert.throws(() => renderStudyDocumentV1ToHtml(invalid), /Invalid study-document\/v1/);

const store = JSON.parse(await readFile(new URL("../data/national-test-pages.json", import.meta.url), "utf8"));
const storedStudyDocuments = (store.nationalTestPages || []).filter(page => page.studyDocument);
assert.ok(storedStudyDocuments.length > 0, "expected at least one saved study document");
for (const page of storedStudyDocuments) {
  const validation = validateStudyDocumentV1(page.studyDocument);
  assert.equal(validation.valid, true, `${page.id}: ${JSON.stringify(validation.errors)}`);
}
const pageFour = storedStudyDocuments.find(page => page.id === "test_page_06d4bf4f-f3b1-458b-9c62-e19b83f958db");
assert.equal(pageFour?.studyDocument?.documentId, pageFour?.id);
assert.equal(pageFour?.studyDocument?.pageNumber, 4);
assert.equal(pageFour?.studyDocument?.source?.sourcePageIndex, 3);

console.log("study-document/v1 renderer tests passed");
