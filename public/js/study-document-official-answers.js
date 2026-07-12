export function officialStudyDocumentAnswers(studyDocument, officialQuestions = []) {
  const questions = studyDocumentQuestions(studyDocument);
  const officialByNumber = new Map();
  availableOfficialStudyQuestions(officialQuestions).forEach(question => {
    const number = normalizedQuestionNumber(question?.number || question?.questionNumber || question?.label);
    if (number) officialByNumber.set(number, question);
  });

  return questions.flatMap(question => {
    const official = officialByNumber.get(normalizedQuestionNumber(question.number));
    if (!official) return [];
    const value = String(official.answer?.value || "").trim();
    const choiceIndex = officialChoiceIndex(official, value);
    if (question.choiceItemIds.length && choiceIndex >= 0 && choiceIndex < question.choiceItemIds.length) {
      return [{
        questionId: question.id,
        questionNumber: question.number,
        kind: "choice",
        choiceItemId: question.choiceItemIds[choiceIndex],
        value,
        origin: "official"
      }];
    }
    return [{
      questionId: question.id,
      questionNumber: question.number,
      kind: "text",
      value,
      origin: "official"
    }];
  });
}

export function validateOfficialStudyDocumentAnswerMapping(studyDocument, officialQuestions = []) {
  const available = availableOfficialStudyQuestions(officialQuestions);
  const mapped = officialStudyDocumentAnswers(studyDocument, available);
  if (!available.length || mapped.length === available.length) {
    return { valid: true, errors: [], officialCount: available.length, mappedCount: mapped.length };
  }
  return {
    valid: false,
    officialCount: available.length,
    mappedCount: mapped.length,
    errors: [{
      code: "unmapped-official-answers",
      path: "$.content",
      message: `Only ${mapped.length} of ${available.length} saved official answers map to semantic questions. Represent every question as group(role=question) with text(role=number), and choices as list(role=choices).`
    }]
  };
}

function availableOfficialStudyQuestions(officialQuestions) {
  return (Array.isArray(officialQuestions) ? officialQuestions : [])
    .filter(question => String(question?.answer?.value || "").trim() && question?.answer?.needsReview !== true);
}

export function studyDocumentQuestions(studyDocument) {
  const questions = [];
  const visitNodes = nodes => {
    (Array.isArray(nodes) ? nodes : []).forEach(node => {
      if (!node || typeof node !== "object") return;
      if (node.type === "group" && node.role === "question") {
        questions.push({
          id: node.id,
          number: questionNumber(node),
          choiceItemIds: questionChoiceItemIds(node)
        });
      }
      visitNodes(node.children);
      (Array.isArray(node.items) ? node.items : []).forEach(item => visitNodes(item?.children));
      (Array.isArray(node.rows) ? node.rows : []).forEach(row => (
        (Array.isArray(row?.cells) ? row.cells : []).forEach(cell => visitNodes(cell?.children))
      ));
    });
  };
  visitNodes(studyDocument?.content);
  return questions.filter(question => question.id && question.number);
}

function questionNumber(group) {
  let number = "";
  const visit = nodes => {
    (Array.isArray(nodes) ? nodes : []).some(node => {
      if (!node || typeof node !== "object") return false;
      if (node.type === "text" && node.role === "number" && String(node.value || "").trim()) {
        number = String(node.value).trim();
        return true;
      }
      visit(node.children);
      return Boolean(number);
    });
  };
  visit(group.children);
  return number || String(group.id || "").match(/\d+/u)?.[0] || "";
}

function questionChoiceItemIds(group) {
  const ids = [];
  const visit = nodes => {
    (Array.isArray(nodes) ? nodes : []).forEach(node => {
      if (!node || typeof node !== "object") return;
      if (node.type === "list" && node.role === "choices") {
        ids.push(...node.items.map(item => item.id).filter(Boolean));
      }
      visit(node.children);
    });
  };
  visit(group.children);
  return ids;
}

function officialChoiceIndex(question, answerValue) {
  const normalizedValue = String(answerValue || "").trim().toUpperCase();
  if (/^[A-Z]$/u.test(normalizedValue)) return normalizedValue.charCodeAt(0) - 65;
  const targetId = String(question?.answer?.targetElementId || "");
  if (targetId) {
    const entry = Object.entries(question?.optionElementIds || {})
      .find(([, elementId]) => String(elementId) === targetId);
    if (entry && /^[A-Z]$/u.test(entry[0].toUpperCase())) return entry[0].toUpperCase().charCodeAt(0) - 65;
  }
  return -1;
}

function normalizedQuestionNumber(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/^q(?:uestion)?\.?\s*/u, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
