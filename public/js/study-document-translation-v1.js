export const STUDY_DOCUMENT_TRANSLATION_V1_SCHEMA_VERSION = "study-document-translation/v1";

const ROOT_FIELDS = new Set([
  "schemaVersion", "documentId", "sourceLanguage", "targetLanguage", "direction", "items", "answers"
]);

export function validateStudyDocumentTranslationV1(translation, studyDocument = null, officialAnswers = []) {
  const errors = [];
  const issue = (code, path, message) => errors.push({ code, path, message });
  if (!isObject(translation)) {
    issue("invalid-type", "$", "The study document translation must be an object.");
    return { valid: false, errors };
  }
  ["schemaVersion", "documentId", "sourceLanguage", "targetLanguage", "direction", "items", "answers"].forEach(field => {
    if (!has(translation, field)) issue("missing-field", `$.${field}`, `Missing required field ${field}.`);
  });
  Object.keys(translation).forEach(field => {
    if (!ROOT_FIELDS.has(field)) issue("unknown-field", `$.${field}`, `Unknown field ${field}.`);
  });
  if (translation.schemaVersion !== STUDY_DOCUMENT_TRANSLATION_V1_SCHEMA_VERSION) {
    issue("invalid-schema-version", "$.schemaVersion", `schemaVersion must equal ${STUDY_DOCUMENT_TRANSLATION_V1_SCHEMA_VERSION}.`);
  }
  if (typeof translation.documentId !== "string" || !translation.documentId) issue("invalid-type", "$.documentId", "documentId must be a non-empty string.");
  if (translation.sourceLanguage !== "en") issue("invalid-enum", "$.sourceLanguage", "sourceLanguage must equal en.");
  if (translation.targetLanguage !== "ar") issue("invalid-enum", "$.targetLanguage", "targetLanguage must equal ar.");
  if (translation.direction !== "rtl") issue("invalid-enum", "$.direction", "direction must equal rtl.");
  validateStringMap(translation.items, "$.items", "translation item", issue);
  validateStringMap(translation.answers, "$.answers", "answer translation", issue);

  if (studyDocument) {
    if (translation.documentId !== studyDocument.documentId) {
      issue("document-id-mismatch", "$.documentId", "Translation documentId must match studyDocument.documentId.");
    }
    validateExactKeys(translation.items, studyDocumentTranslationSourceItems(studyDocument), "$.items", "text node", issue);
    const expectedAnswers = Object.fromEntries(
      (Array.isArray(officialAnswers) ? officialAnswers : [])
        .filter(answer => answer.kind !== "choice")
        .map(answer => [String(answer.questionNumber), answer.value])
    );
    validateExactKeys(translation.answers, expectedAnswers, "$.answers", "open official answer", issue);
  }
  return { valid: errors.length === 0, errors };
}

export function studyDocumentTranslationSourceItems(studyDocument) {
  const items = {};
  visitStudyNodes(studyDocument?.content, node => {
    if (node.type === "text" && node.role !== "number") items[node.id] = node.value;
  });
  return items;
}

export function applyStudyDocumentTranslation(studyDocument, translation) {
  const items = isObject(translation?.items) ? translation.items : {};
  const translateNodes = nodes => (Array.isArray(nodes) ? nodes : []).map(node => {
    if (!isObject(node)) return node;
    const next = { ...node };
    if (node.type === "text" && has(items, node.id)) next.value = String(items[node.id]);
    if (Array.isArray(node.children)) next.children = translateNodes(node.children);
    if (Array.isArray(node.items)) next.items = node.items.map(item => ({ ...item, children: translateNodes(item.children) }));
    if (Array.isArray(node.rows)) next.rows = node.rows.map(row => ({
      ...row,
      cells: row.cells.map(cell => ({ ...cell, children: translateNodes(cell.children) }))
    }));
    return next;
  });
  return { ...studyDocument, content: translateNodes(studyDocument?.content) };
}

export function applyOfficialAnswerTranslation(officialAnswers, translation) {
  const answers = isObject(translation?.answers) ? translation.answers : {};
  return (Array.isArray(officialAnswers) ? officialAnswers : []).map(answer => (
    answer.kind !== "choice" && has(answers, String(answer.questionNumber))
      ? { ...answer, value: String(answers[String(answer.questionNumber)]) }
      : answer
  ));
}

export function studyDocumentArabicPrompt(studyDocument, officialAnswers = []) {
  const sourceItems = studyDocumentTranslationSourceItems(studyDocument);
  const sourceAnswers = Object.fromEntries(
    (Array.isArray(officialAnswers) ? officialAnswers : [])
      .filter(answer => answer.kind !== "choice")
      .map(answer => [String(answer.questionNumber), answer.value])
  );
  const output = {
    schemaVersion: STUDY_DOCUMENT_TRANSLATION_V1_SCHEMA_VERSION,
    documentId: studyDocument.documentId,
    sourceLanguage: "en",
    targetLanguage: "ar",
    direction: "rtl",
    items: Object.fromEntries(Object.keys(sourceItems).map(id => [id, ""])),
    answers: Object.fromEntries(Object.keys(sourceAnswers).map(number => [number, ""]))
  };
  return [
    "Translate the supplied English study-page text into natural Modern Standard Arabic.",
    "Return only the completed JSON object matching the output template.",
    "Keep every item ID and answer question number exactly unchanged. Translate values only.",
    "Do not add, remove, reorder, or rename keys. Do not add layout, coordinates, styling, explanations, or markdown.",
    "Preserve proper names, numbers, option meaning, punctuation intent, and any text that should conventionally remain Latin.",
    "The answers are existing official answers: translate them faithfully and do not generate different answers.",
    `English items:\n${JSON.stringify(sourceItems, null, 2)}`,
    `English official open answers:\n${JSON.stringify(sourceAnswers, null, 2)}`,
    `Required output template:\n${JSON.stringify(output, null, 2)}`
  ].join("\n\n");
}

function validateExactKeys(actual, expected, path, label, issue) {
  if (!isObject(actual)) return;
  const actualKeys = new Set(Object.keys(actual));
  const expectedKeys = new Set(Object.keys(expected));
  expectedKeys.forEach(key => {
    if (!actualKeys.has(key)) issue("missing-translation", `${path}.${key}`, `Missing translation for ${label} ${key}.`);
  });
  actualKeys.forEach(key => {
    if (!expectedKeys.has(key)) issue("unknown-translation-id", `${path}.${key}`, `Unknown ${label} reference ${key}.`);
  });
}

function validateStringMap(value, path, label, issue) {
  if (!isObject(value)) {
    issue("invalid-type", path, `${path.slice(2)} must be an object.`);
    return;
  }
  Object.entries(value).forEach(([key, text]) => {
    if (!key || typeof text !== "string" || !text.trim()) {
      issue("invalid-translation", `${path}.${key}`, `${label} must be a non-empty string.`);
    }
  });
}

function visitStudyNodes(nodes, visit) {
  (Array.isArray(nodes) ? nodes : []).forEach(node => {
    if (!isObject(node)) return;
    visit(node);
    visitStudyNodes(node.children, visit);
    (Array.isArray(node.items) ? node.items : []).forEach(item => visitStudyNodes(item.children, visit));
    (Array.isArray(node.rows) ? node.rows : []).forEach(row => (
      (Array.isArray(row.cells) ? row.cells : []).forEach(cell => visitStudyNodes(cell.children, visit))
    ));
  });
}

function has(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
