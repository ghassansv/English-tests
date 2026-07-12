import assert from "node:assert/strict";
import {
  officialStudyDocumentAnswers,
  studyDocumentQuestions,
  validateOfficialStudyDocumentAnswerMapping
} from "../public/js/study-document-official-answers.js";
import { renderStudyDocumentV1ToHtml } from "../public/js/study-document-v1-renderer.js";

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
assert.match(incompleteMapping.errors[0].message, /group\(role=question\)/);

console.log("study-document official-answer mapping tests passed");
