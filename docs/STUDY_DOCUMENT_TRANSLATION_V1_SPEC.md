# STUDY_DOCUMENT_TRANSLATION_V1_SPEC

## Purpose

`study-document-translation/v1` is a language overlay for one canonical
`study-document/v1`. It translates text values without duplicating or changing
the semantic tree, IDs, questions, choices, gaps, graphics, tables, or rules.

## Root object

```json
{
  "schemaVersion": "study-document-translation/v1",
  "documentId": "test_page_001",
  "sourceLanguage": "en",
  "targetLanguage": "ar",
  "direction": "rtl",
  "items": {
    "text-001": "النص العربي"
  },
  "answers": {
    "3": "ترجمة الإجابة الرسمية"
  }
}
```

Allowed and required root fields only:

- `schemaVersion`
- `documentId`
- `sourceLanguage`
- `targetLanguage`
- `direction`
- `items`
- `answers`

`schemaVersion` MUST equal `study-document-translation/v1`.

`documentId` MUST equal the companion study document ID.

`sourceLanguage`, `targetLanguage`, and `direction` MUST equal `en`, `ar`, and
`rtl` respectively.

`items` MUST contain exactly one non-empty Arabic value for every translatable
text-node ID. Text nodes with `role: number` remain sourced from English and MUST
NOT appear in `items`.

`answers` MUST contain exactly one translated value for every existing official
open answer, keyed by visible question number. Multiple-choice answers are not
duplicated because the correct choice-item ID remains unchanged.

## Rules

1. Translate values only.
2. Never rename, add, remove, or reorder IDs.
3. Never add semantic nodes, geometry, styling, layout, or answer generation.
4. Preserve proper names, numbers, and intended punctuation.
5. Translate official open answers faithfully; do not create different answers.
6. Unknown and missing translation IDs MUST be rejected.
7. The English study document remains the structural source of truth.
