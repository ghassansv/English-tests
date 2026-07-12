import assert from "node:assert/strict";
import {
  applyOfficialAnswerTranslation,
  applyStudyDocumentTranslation,
  studyDocumentArabicPrompt,
  studyDocumentTranslationSourceItems,
  validateStudyDocumentTranslationV1
} from "../public/js/study-document-translation-v1.js";
import { renderStudyDocumentV1ToHtml } from "../public/js/study-document-v1-renderer.js";

const document = {
  schemaVersion: "study-document/v1",
  documentId: "test_page_arabic",
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
        { type: "text", id: "prompt-1", role: "question", value: "What happened?" },
        { type: "gap", id: "gap-1", display: "block", style: "line", lines: 1 }
      ]
    },
    { type: "text", id: "footer-1", role: "footer", value: "National test" }
  ]
};
const officialAnswers = [
  { questionId: "question-1", questionNumber: "1", kind: "text", value: "The official answer.", origin: "official" }
];
const translation = {
  schemaVersion: "study-document-translation/v1",
  documentId: "test_page_arabic",
  sourceLanguage: "en",
  targetLanguage: "ar",
  direction: "rtl",
  items: {
    "prompt-1": "ماذا حدث؟",
    "footer-1": "الاختبار الوطني"
  },
  answers: {
    "1": "الإجابة الرسمية."
  }
};

assert.deepEqual(studyDocumentTranslationSourceItems(document), {
  "prompt-1": "What happened?",
  "footer-1": "National test"
});
assert.equal(validateStudyDocumentTranslationV1(translation, document, officialAnswers).valid, true);

for (const mutate of [
  value => { delete value.items["prompt-1"]; },
  value => { value.items.unknown = "غير معروف"; },
  value => { value.answers = {}; },
  value => { value.documentId = "another-page"; },
  value => { value.direction = "ltr"; }
]) {
  const invalid = structuredClone(translation);
  mutate(invalid);
  assert.equal(validateStudyDocumentTranslationV1(invalid, document, officialAnswers).valid, false);
}

const translatedDocument = applyStudyDocumentTranslation(document, translation);
assert.equal(translatedDocument.content[0].children[0].value, "1", "number roles remain sourced from English");
assert.equal(translatedDocument.content[0].children[1].value, "ماذا حدث؟");
assert.equal(translatedDocument.content[1].value, "الاختبار الوطني");
assert.equal(document.content[0].children[1].value, "What happened?", "translation must not mutate English");

const translatedAnswers = applyOfficialAnswerTranslation(officialAnswers, translation);
assert.equal(translatedAnswers[0].value, "الإجابة الرسمية.");
assert.equal(officialAnswers[0].value, "The official answer.");

const prompt = studyDocumentArabicPrompt(document, officialAnswers);
assert.match(prompt, /study-document-translation\/v1/);
assert.match(prompt, /What happened\?/);
assert.match(prompt, /The official answer\./);
assert.match(prompt, /"prompt-1": ""/);

const html = renderStudyDocumentV1ToHtml(translatedDocument, {
  answers: translatedAnswers,
  showAnswers: true,
  language: "ar"
});
assert.match(html, /study-document-rendered-page--ar/);
assert.match(html, /data-layout-language="ar"/);
assert.match(html, /dir="rtl"/);
assert.match(html, /ماذا حدث؟/);
assert.match(html, /الإجابة الرسمية\./);

console.log("study-document/v1 Arabic translation tests passed");
