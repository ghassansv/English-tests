import assert from "node:assert/strict";
import {
  officialStudyDocumentAnswers,
  studyDocumentGaps,
  studyDocumentQuestions,
  validateOfficialStudyDocumentAnswerMapping
} from "../public/js/study-document-official-answers.js";
import { renderStudyDocumentV1ToHtml } from "../public/js/study-document-v1-renderer.js";
import { repairStudyDocumentImport } from "../public/js/study-document-import-repair.js";

const document = {
  schemaVersion: "study-document/v1",
  documentId: "test_page_questions",
  pageNumber: 3,
  source: { kind: "page-image", sourcePageIndex: 2 },
  content: [
    {
      type: "group",
      id: "question-1",
      role: "question",
      layout: "block",
      children: [
        { type: "text", id: "number-1", role: "number", value: "1" },
        { type: "text", id: "prompt-1", role: "question", value: "Choose one." },
        {
          type: "list",
          id: "choices-1",
          role: "choices",
          marker: "letters",
          items: [
            { id: "choice-1-a", children: [{ type: "text", id: "choice-text-1-a", role: "option", value: "First" }] },
            { id: "choice-1-b", children: [{ type: "text", id: "choice-text-1-b", role: "option", value: "Second" }] }
          ]
        }
      ]
    },
    {
      type: "group",
      id: "question-2",
      role: "question",
      layout: "block",
      children: [
        { type: "text", id: "number-2", role: "number", value: "2" },
        { type: "text", id: "prompt-2", role: "question", value: "Explain." },
        { type: "gap", id: "gap-2", display: "block", style: "line", lines: 1 }
      ]
    }
  ]
};

const officialQuestions = [
  {
    id: "old-q1",
    number: "1",
    type: "multiple-choice",
    optionElementIds: { A: "old-a", B: "old-b" },
    answer: { value: "B", targetElementId: "old-b" }
  },
  {
    id: "old-q2",
    number: "2",
    type: "short-answer",
    answer: { value: "The supported official explanation.", targetElementId: "old-line" }
  }
];

assert.deepEqual(studyDocumentQuestions(document), [
  { id: "question-1", number: "1", choiceItemIds: ["choice-1-a", "choice-1-b"] },
  { id: "question-2", number: "2", choiceItemIds: [] }
]);

const answers = officialStudyDocumentAnswers(document, officialQuestions);
assert.deepEqual(answers, [
  { questionId: "question-1", questionNumber: "1", kind: "choice", choiceItemId: "choice-1-b", value: "B", origin: "official" },
  { questionId: "question-2", questionNumber: "2", kind: "text", value: "The supported official explanation.", origin: "official" }
]);

const hiddenHtml = renderStudyDocumentV1ToHtml(document, { answers, showAnswers: false });
assert.doesNotMatch(hiddenHtml, /study-document-choice--correct/);
assert.doesNotMatch(hiddenHtml, /The supported official explanation/);

const shownHtml = renderStudyDocumentV1ToHtml(document, { answers, showAnswers: true });
assert.match(shownHtml, /data-study-item-id="choice-1-b"[^>]*>.*study-document-official-answer-badge/s);
assert.match(shownHtml, /✓ Official answer/);
assert.match(shownHtml, /The supported official explanation/);
assert.match(shownHtml, /study-document-official-answer/);

const reviewOnly = officialStudyDocumentAnswers(document, [
  { number: "1", answer: { value: "A", needsReview: true } }
]);
assert.deepEqual(reviewOnly, []);
assert.equal(validateOfficialStudyDocumentAnswerMapping(document, officialQuestions).valid, true);

const missingQuestionDocument = structuredClone(document);
missingQuestionDocument.content.pop();
const incompleteMapping = validateOfficialStudyDocumentAnswerMapping(missingQuestionDocument, officialQuestions);
assert.equal(incompleteMapping.valid, false);
assert.equal(incompleteMapping.officialCount, 2);
assert.equal(incompleteMapping.mappedCount, 1);
assert.match(incompleteMapping.errors[0].message, /gap nodes/);

const numberedGapDocument = {
  schemaVersion: "study-document/v1",
  documentId: "test_page_numbered_gaps",
  pageNumber: 9,
  source: { kind: "page-image", sourcePageIndex: 8 },
  content: [{
    type: "flow",
    id: "article-flow",
    children: [
      { type: "text", id: "article-a", role: "body", value: "Before " },
      { type: "gap", id: "gap-8", display: "inline", style: "line", size: "medium", label: "8" },
      { type: "text", id: "article-b", role: "body", value: " and after " },
      { type: "gap", id: "gap-9", display: "inline", style: "line", size: "medium", label: "9" }
    ]
  }]
};
const numberedGapQuestions = [
  { number: "8", answer: { value: "first" } },
  { number: "9", answer: { value: "second" } }
];

assert.deepEqual(studyDocumentGaps(numberedGapDocument), [
  { id: "gap-8", number: "8" },
  { id: "gap-9", number: "9" }
]);
const gapAnswers = officialStudyDocumentAnswers(numberedGapDocument, numberedGapQuestions);
assert.deepEqual(gapAnswers, [
  { questionId: "gap-8", questionNumber: "8", kind: "gap", gapId: "gap-8", value: "first", origin: "official" },
  { questionId: "gap-9", questionNumber: "9", kind: "gap", gapId: "gap-9", value: "second", origin: "official" }
]);
assert.equal(validateOfficialStudyDocumentAnswerMapping(numberedGapDocument, numberedGapQuestions).valid, true);
const hiddenGapHtml = renderStudyDocumentV1ToHtml(numberedGapDocument, { answers: gapAnswers, showAnswers: false });
assert.doesNotMatch(hiddenGapHtml, /study-document-gap-answer/);
assert.doesNotMatch(hiddenGapHtml, />first</);
const shownGapHtml = renderStudyDocumentV1ToHtml(numberedGapDocument, { answers: gapAnswers, showAnswers: true });
assert.match(shownGapHtml, /data-study-node-id="gap-8"[^>]*>.*study-document-gap-answer">first</s);
assert.match(shownGapHtml, /data-study-node-id="gap-9"[^>]*>.*study-document-gap-answer">second</s);

const genericQuestionSet = {
  schemaVersion: "study-document/v1",
  documentId: "test_page_generic_questions",
  pageNumber: 18,
  source: { kind: "page-image", sourcePageIndex: 17 },
  content: [{
    type: "group",
    id: "question-set-13-18",
    role: "question-set",
    layout: "block",
    children: Array.from({ length: 6 }, (_, index) => {
      const number = String(index + 13);
      return {
        type: "group",
        id: `question-${number}`,
        role: "generic",
        layout: "block",
        children: [
          { type: "text", id: `number-${number}`, role: "number", value: number },
          { type: "text", id: `prompt-${number}`, role: "question", value: `Question ${number}` },
          { type: "gap", id: `answer-${number}`, display: "block", style: "line", lines: 1 }
        ]
      };
    })
  }]
};
const officialQuestions13To18 = Array.from({ length: 6 }, (_, index) => ({
  number: String(index + 13),
  answer: { value: `Answer ${index + 13}` }
}));
const repairedGenericQuestionSet = repairStudyDocumentImport(genericQuestionSet).document;
const repairedMapping = validateOfficialStudyDocumentAnswerMapping(repairedGenericQuestionSet, officialQuestions13To18);
assert.equal(repairedMapping.valid, true);
assert.equal(repairedMapping.mappedCount, 6);

console.log("study-document official-answer mapping tests passed");
