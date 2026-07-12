import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  studyDocumentPageBinding,
  studyDocumentPagePrompt,
  validateStudyDocumentPageBinding
} from "../public/js/study-document-page-binding.js";

const page = {
  id: "test_page_example",
  pageNumber: 4,
  sourcePage: { pageNumber: 4 }
};
const binding = studyDocumentPageBinding(page);
assert.deepEqual(binding, {
  documentId: "test_page_example",
  pageNumber: 4,
  sourcePageIndex: 3
});

const prompt = studyDocumentPagePrompt(page);
assert.match(prompt, /documentId: test_page_example/);
assert.match(prompt, /pageNumber: 4/);
assert.match(prompt, /source\.sourcePageIndex: 3/);
assert.match(prompt, /group content uses children/);
assert.match(prompt, /text content uses value/);
assert.match(prompt, /group\(role=question\)/);
assert.match(prompt, /selectionControl to checkbox/);
assert.match(prompt, /Preserve visible paragraph boundaries/);
assert.match(prompt, /fixed columns with one block group per column/);
assert.match(prompt, /spanning graphics outside the column groups/);
assert.ok(prompt.length < 1800, `page prompt should remain compact, got ${prompt.length} characters`);

const matchingDocument = {
  documentId: "test_page_example",
  pageNumber: 4,
  source: { sourcePageIndex: 3 }
};
assert.equal(validateStudyDocumentPageBinding(matchingDocument, page).valid, true);

for (const [path, mutate] of [
  ["$.documentId", document => { document.documentId = "another-page"; }],
  ["$.pageNumber", document => { document.pageNumber = 8; }],
  ["$.source.sourcePageIndex", document => { document.source.sourcePageIndex = 0; }]
]) {
  const document = structuredClone(matchingDocument);
  mutate(document);
  const validation = validateStudyDocumentPageBinding(document, page);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => error.path === path));
}

assert.equal(studyDocumentPageBinding({ ...page, sourcePage: { sourcePageIndex: 12, pageNumber: 4 } }).sourcePageIndex, 12);

const store = JSON.parse(await readFile(new URL("../data/national-test-pages.json", import.meta.url), "utf8"));
for (const storedPage of (store.nationalTestPages || []).filter(item => item.studyDocument)) {
  const validation = validateStudyDocumentPageBinding(storedPage.studyDocument, storedPage);
  assert.equal(validation.valid, true, `${storedPage.id}: ${JSON.stringify(validation.errors)}`);
}

console.log("study-document/v1 page binding tests passed");
