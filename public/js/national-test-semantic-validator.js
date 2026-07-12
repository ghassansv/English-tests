import {
  validateNationalTestSemanticPageModel,
  validateNationalTestSourceEvidenceModel
} from "./national-test-semantic-models.js";

export const SEMANTIC_VALIDATION_SCHEMA_VERSION = "semantic-validation/v1";

export const SEMANTIC_VALIDATION_THRESHOLDS = Object.freeze({
  passScore: 0.9,
  warningScore: 0.68,
  textCoveragePass: 0.92,
  textSimilarityEquivalent: 0.88,
  textSimilaritySupported: 0.72,
  recognitionDisagreementMin: 0.45,
  recognitionDisagreementMax: 0.88,
  bboxOverlapEquivalent: 0.45,
  bboxProximityEquivalent: 0.055,
  columnReadingOrderPass: 0.93,
  severeTokenLossRatio: 0.35,
  highArtifactRisk: 0.75
});

const SEMANTIC_TEXT_TYPES = new Set([
  "title",
  "heading",
  "subheading",
  "instructions",
  "paragraph",
  "question",
  "option",
  "answerGap",
  "caption",
  "footer",
  "pageNumber"
]);

const PATCH_TYPES = Object.freeze({
  attachOptionToQuestion: "attach-option-to-question",
  createSemanticElement: "create-semantic-element",
  createSemanticRelationship: "create-semantic-relationship",
  createSemanticImage: "create-semantic-image",
  createSemanticGraphic: "create-semantic-graphic",
  createAnswerGap: "create-semantic-answer-gap",
  createAnswerLine: "create-semantic-answer-line",
  mergeTextElements: "merge-semantic-text-elements",
  removeDuplicateElement: "remove-duplicate-semantic-element",
  replaceReadingOrder: "replace-reading-order"
});

const EXAM_FOOTER_TEXT_RE = /NATIONELLT|\bNATION\b|PROV\s*\||ENGELSKA|DELPROV|VT\s*\d{4}|SEPTEMBER|SEPTEMPER|SEPTEN/i;

export function validateSemanticReconstruction(input = {}) {
  const sourceEvidence = input?.sourceEvidence || input?.source || null;
  const semanticPage = input?.semanticPage || input?.semantic || null;
  const pageRef = semanticPage?.pageRef || sourceEvidence?.pageRef || {};
  const evidenceIndex = buildEvidenceIndex(sourceEvidence);
  const canonicalText = buildCanonicalSourceTextUnits(sourceEvidence, evidenceIndex);
  const semanticText = semanticTextElements(semanticPage);
  const issues = [];
  const suggestedPatches = [];

  addSchemaIntegrityIssues({ sourceEvidence, semanticPage, issues });
  const textDiagnostics = validateTextCoverage({ canonicalText, semanticText, evidenceIndex, issues, suggestedPatches });
  const questionDiagnostics = validateQuestionsAndOptions({ canonicalText, semanticPage, evidenceIndex, issues, suggestedPatches });
  const gapDiagnostics = validateGapsAndAnswerAreas({ canonicalText, semanticPage, sourceEvidence, evidenceIndex, issues, suggestedPatches });
  const readingDiagnostics = validateReadingOrder({ semanticPage, evidenceIndex, issues, suggestedPatches });
  const visualDiagnostics = validateVisualCoverage({ sourceEvidence, semanticPage, issues, suggestedPatches });
  const relationshipDiagnostics = validateRelationshipStructure({ semanticPage, issues, suggestedPatches });

  const observedCounts = {
    canonicalTextUnits: canonicalText.length,
    questionCandidates: questionDiagnostics.sourceQuestions.length,
    optionCandidates: questionDiagnostics.sourceOptions.length,
    gapCandidates: gapDiagnostics.observedGapCount,
    answerLineCandidates: gapDiagnostics.observedAnswerLineCount,
    imageCandidates: visualDiagnostics.documentImageCandidateCount,
    graphicCandidates: visualDiagnostics.graphicCandidateCount,
    columnCandidates: readingDiagnostics.expectedColumnCount
  };
  const semanticCounts = semanticElementCounts(semanticPage);
  const scores = scoreSemanticValidation({
    textDiagnostics,
    questionDiagnostics,
    gapDiagnostics,
    readingDiagnostics,
    visualDiagnostics,
    relationshipDiagnostics,
    issues
  });
  const score = weightedOverallScore(scores);
  const status = semanticValidationStatus(score, issues);

  return {
    schemaVersion: SEMANTIC_VALIDATION_SCHEMA_VERSION,
    pageRef: {
      testId: String(pageRef.testId || ""),
      pageId: String(pageRef.pageId || ""),
      pageNumber: Number.isFinite(Number(pageRef.pageNumber)) ? Number(pageRef.pageNumber) : null
    },
    status,
    score,
    scores,
    observedCounts,
    semanticCounts,
    issues: issues.map((issue, index) => ({
      id: issue.id || stableId("validation-issue", index, issue.type, issue.sourceEvidenceIds, issue.semanticElementIds),
      ...issue
    })),
    suggestedPatches: suggestedPatches.map((patch, index) => ({
      id: patch.id || stableId("semantic-patch", index, patch.type, patch.targetElementId, patch.sourceEvidenceIds),
      ...patch
    })),
    diagnostics: {
      thresholds: SEMANTIC_VALIDATION_THRESHOLDS,
      canonicalTextUnits: canonicalText.map(unit => ({
        id: unit.id,
        text: unit.text,
        sourceEvidenceIds: unit.sourceEvidenceIds,
        observationKinds: [...new Set(unit.observations.map(observation => observation.kind))]
      })),
      expectedReadingOrder: readingDiagnostics.expectedReadingOrder,
      relationshipCycleCount: relationshipDiagnostics.cycleCount,
      patchVocabulary: Object.values(PATCH_TYPES)
    }
  };
}

export function semanticValidationDebugSummary(report) {
  if (!report || typeof report !== "object") return "[Semantic Validation]\nNo report.";
  const scores = report.scores || {};
  const observed = report.observedCounts || {};
  const semantic = report.semanticCounts || {};
  return [
    "[Semantic Validation]",
    `Page: ${report.pageRef?.pageNumber ?? "unknown"}`,
    `Status: ${report.status}`,
    `Score: ${formatScore(report.score)}`,
    "",
    `Text coverage: ${formatScore(scores.textCoverage)}`,
    `Reading order: ${formatScore(scores.readingOrder)}`,
    `Structure: ${formatScore(scores.semanticStructure)}`,
    "",
    `Observed: questions=${observed.questionCandidates || 0}, options=${observed.optionCandidates || 0}, images=${observed.imageCandidates || 0}`,
    `Semantic: questions=${semantic.questions || 0}, options=${semantic.options || 0}, images=${semantic.images || 0}`,
    "",
    report.issues?.length
      ? `Issues:\n${issueTypeCounts(report.issues).map(([type, count]) => `${count} ${type}`).join("\n")}`
      : "Issues: none"
  ].join("\n");
}

function addSchemaIntegrityIssues({ sourceEvidence, semanticPage, issues }) {
  const sourceValidation = validateNationalTestSourceEvidenceModel(sourceEvidence);
  const semanticValidation = validateNationalTestSemanticPageModel(semanticPage, sourceEvidence);
  sourceValidation.issues.forEach(issue => addIssue(issues, {
    type: "source-evidence-integrity-error",
    severity: "critical",
    message: issue.message,
    sourceEvidenceIds: issue.id ? [issue.id] : [],
    confidence: 1,
    details: { code: issue.code }
  }));
  semanticValidation.issues.forEach(issue => addIssue(issues, {
    type: "semantic-integrity-error",
    severity: issue.code === "final-coordinate-leak" ? "critical" : "major",
    message: issue.message,
    semanticElementIds: issue.id ? [issue.id] : [],
    sourceEvidenceIds: issue.sourceId ? [issue.sourceId] : [],
    confidence: 1,
    details: { code: issue.code }
  }));
}

function validateTextCoverage({ canonicalText, semanticText, evidenceIndex, issues, suggestedPatches }) {
  const coveredUnits = new Set();
  const supportedElements = new Set();
  const semanticByNormalizedText = new Map();
  const disagreements = recognitionDisagreements(canonicalText);

  disagreements.forEach(disagreement => addIssue(issues, {
    type: "possible-recognition-disagreement",
    severity: "warning",
    message: `Possible OCR/PDF disagreement between "${disagreement.left.text}" and "${disagreement.right.text}".`,
    sourceEvidenceIds: uniqueStrings([disagreement.left.id, disagreement.right.id]),
    confidence: roundScore(1 - disagreement.similarity),
    details: { similarity: disagreement.similarity }
  }));

  semanticText.forEach(element => {
    const normalized = normalizeTextForComparison(element.text);
    if (!semanticByNormalizedText.has(normalized)) semanticByNormalizedText.set(normalized, []);
    semanticByNormalizedText.get(normalized).push(element);
    const matches = canonicalTextMatches(element, canonicalText, evidenceIndex)
      .filter(match => match.score >= SEMANTIC_VALIDATION_THRESHOLDS.textSimilaritySupported);
    if (matches.length) {
      supportedElements.add(element.id);
      matches.forEach(match => {
        coveredUnits.add(match.unit.id);
        const tokenLoss = tokenLossRatio(match.unit.text, element.text);
        if (tokenLoss >= SEMANTIC_VALIDATION_THRESHOLDS.severeTokenLossRatio) {
          addIssue(issues, {
            type: "severe-token-loss",
            severity: "major",
            message: `Semantic text appears to have lost source tokens: ${element.id}.`,
            sourceEvidenceIds: match.unit.sourceEvidenceIds,
            semanticElementIds: [element.id],
            confidence: roundScore(tokenLoss),
            details: { tokenLossRatio: tokenLoss }
          });
        }
      });
    } else if (meaningfulText(element.text)) {
      addIssue(issues, {
        type: "unsupported-semantic-text",
        severity: "major",
        message: `Semantic text is not supported by source evidence: ${element.id}.`,
        semanticElementIds: [element.id],
        confidence: 0.88,
        details: { text: element.text }
      });
    }
  });

  semanticByNormalizedText.forEach(elements => {
    if (elements.length <= 1 || !meaningfulText(elements[0].text)) return;
    addIssue(issues, {
      type: "duplicate-semantic-text",
      severity: "major",
      message: `Duplicate semantic text represented ${elements.length} times.`,
      semanticElementIds: elements.map(element => element.id),
      confidence: 0.94,
      details: { text: elements[0].text }
    });
    suggestedPatches.push({
      type: PATCH_TYPES.removeDuplicateElement,
      elementIds: elements.slice(1).map(element => element.id),
      reason: "duplicate-semantic-text",
      confidence: 0.9
    });
  });

  canonicalText.forEach(unit => {
    if (coveredUnits.has(unit.id) || !meaningfulText(unit.text)) return;
    const severity = tokenCount(unit.text) >= 5 ? "critical" : "warning";
    addIssue(issues, {
      type: "missing-text",
      severity,
      message: `Source text is not represented semantically: "${truncateText(unit.text)}".`,
      sourceEvidenceIds: unit.sourceEvidenceIds,
      confidence: 0.92,
      details: { text: unit.text }
    });
    suggestedPatches.push({
      type: PATCH_TYPES.createSemanticElement,
      semanticType: likelySemanticTypeFromText(unit.text),
      sourceEvidenceIds: unit.sourceEvidenceIds,
      reason: "unrepresented-source-text",
      confidence: 0.88
    });
  });

  const probableFragments = findProbableFragmentedSemanticText(semanticText, canonicalText);
  probableFragments.forEach(fragment => {
    addIssue(issues, {
      type: "fragmented-text",
      severity: "warning",
      message: "Adjacent semantic text elements probably represent one source text unit.",
      sourceEvidenceIds: fragment.sourceEvidenceIds,
      semanticElementIds: fragment.elementIds,
      confidence: fragment.confidence,
      details: { combinedText: fragment.combinedText }
    });
    suggestedPatches.push({
      type: PATCH_TYPES.mergeTextElements,
      elementIds: fragment.elementIds,
      reason: "probable-fragmented-text",
      confidence: fragment.confidence
    });
  });

  return {
    canonicalTextCount: canonicalText.length,
    coveredCanonicalTextCount: coveredUnits.size,
    semanticTextCount: semanticText.length,
    supportedSemanticTextCount: supportedElements.size,
    duplicateSemanticTextCount: [...semanticByNormalizedText.values()].filter(group => group.length > 1 && meaningfulText(group[0].text)).length,
    recognitionDisagreementCount: disagreements.length
  };
}

function validateQuestionsAndOptions({ canonicalText, semanticPage, evidenceIndex, issues, suggestedPatches }) {
  const sourceQuestions = inferSourceQuestions(canonicalText);
  const sourceOptions = inferSourceOptions(canonicalText, sourceQuestions);
  const semanticQuestions = elementsByType(semanticPage, "question");
  const semanticOptions = elementsByType(semanticPage, "option");
  const relationships = Array.isArray(semanticPage?.relationships) ? semanticPage.relationships : [];
  const optionOf = relationships.filter(relationship => relationship.type === "optionOf");
  const questionByNumber = new Map(semanticQuestions.map(question => [questionNumber(question.text, question.id), question]).filter(([number]) => number !== null));

  sourceQuestions.forEach(sourceQuestion => {
    const matched = semanticQuestions.find(question => textLikelyEquivalent(question.text, sourceQuestion.text) ||
      (sourceQuestion.number !== null && questionNumber(question.text, question.id) === sourceQuestion.number));
    if (!matched) {
      addIssue(issues, {
        type: "missing-question",
        severity: "critical",
        message: `Source question is missing semantically: ${truncateText(sourceQuestion.text)}.`,
        sourceEvidenceIds: sourceQuestion.sourceEvidenceIds,
        confidence: 0.94
      });
      suggestedPatches.push({
        type: PATCH_TYPES.createSemanticElement,
        semanticType: "question",
        sourceEvidenceIds: sourceQuestion.sourceEvidenceIds,
        reason: "unrepresented-question-candidate",
        confidence: 0.94
      });
    }
  });

  duplicateNumbers(semanticQuestions.map(question => questionNumber(question.text, question.id)).filter(number => number !== null))
    .forEach(number => addIssue(issues, {
      type: "duplicated-question",
      severity: "major",
      message: `Question number ${number} appears multiple times semantically.`,
      semanticElementIds: semanticQuestions.filter(question => questionNumber(question.text, question.id) === number).map(question => question.id),
      confidence: 0.9
    }));

  sequenceGaps([...new Set([...sourceQuestions.map(question => question.number), ...semanticQuestions.map(question => questionNumber(question.text, question.id))].filter(number => number !== null))])
    .forEach(gap => addIssue(issues, {
      type: "question-sequence-gap",
      severity: "warning",
      message: `Question sequence skips from ${gap.previous} to ${gap.next}.`,
      confidence: 0.82,
      details: gap
    }));

  sourceOptions.forEach(sourceOption => {
    const matched = semanticOptions.find(option => optionLabel(option.text, option.id) === sourceOption.label &&
      textSimilarity(option.text, sourceOption.text) >= SEMANTIC_VALIDATION_THRESHOLDS.textSimilaritySupported);
    if (!matched) {
      addIssue(issues, {
        type: "missing-option",
        severity: "critical",
        message: `Source option ${sourceOption.label.toUpperCase()} is missing semantically.`,
        sourceEvidenceIds: sourceOption.sourceEvidenceIds,
        confidence: 0.93,
        details: { questionNumber: sourceOption.questionNumber, label: sourceOption.label }
      });
      suggestedPatches.push({
        type: PATCH_TYPES.createSemanticElement,
        semanticType: "option",
        sourceEvidenceIds: sourceOption.sourceEvidenceIds,
        reason: "unrepresented-option-candidate",
        confidence: 0.92
      });
    }
  });

  semanticOptions.forEach(option => {
    const outgoing = optionOf.filter(relationship => relationship.from === option.id);
    const nearestQuestion = nearestQuestionBeforeElement(option, semanticQuestions, semanticPage, evidenceIndex);
    if (!outgoing.length) {
      addIssue(issues, {
        type: "orphan-option",
        severity: "critical",
        message: `Semantic option is not attached to a question: ${option.id}.`,
        semanticElementIds: [option.id],
        confidence: 0.97
      });
      if (nearestQuestion) suggestedPatches.push({
        type: PATCH_TYPES.attachOptionToQuestion,
        targetElementId: option.id,
        questionElementId: nearestQuestion.id,
        reason: "option-label-and-local-sequence",
        confidence: 0.9
      });
      return;
    }
    const targetIds = [...new Set(outgoing.map(relationship => relationship.to))];
    if (targetIds.length > 1) {
      addIssue(issues, {
        type: "option-multiple-questions",
        severity: "critical",
        message: `Option ${option.id} is attached to multiple questions.`,
        semanticElementIds: [option.id, ...targetIds],
        confidence: 0.98
      });
    }
    if (nearestQuestion && !targetIds.includes(nearestQuestion.id)) {
      addIssue(issues, {
        type: "option-attached-to-wrong-question",
        severity: "critical",
        message: `Option ${option.id} is probably attached to the wrong question.`,
        semanticElementIds: [option.id, ...targetIds, nearestQuestion.id],
        confidence: 0.88
      });
      suggestedPatches.push({
        type: PATCH_TYPES.attachOptionToQuestion,
        targetElementId: option.id,
        questionElementId: nearestQuestion.id,
        reason: "nearest-question-reading-order",
        confidence: 0.88
      });
    }
  });

  sourceQuestions.forEach(question => {
    const expectedLabels = sourceOptions.filter(option => option.questionNumber === question.number).map(option => option.label);
    if (!expectedLabels.length) return;
    const semanticQuestion = question.number !== null ? questionByNumber.get(question.number) : null;
    if (!semanticQuestion) return;
    const actualLabels = semanticOptions
      .filter(option => optionOf.some(relationship => relationship.from === option.id && relationship.to === semanticQuestion.id))
      .map(option => optionLabel(option.text, option.id))
      .filter(Boolean);
    expectedLabels.filter(label => !actualLabels.includes(label)).forEach(label => addIssue(issues, {
      type: "missing-option-relationship",
      severity: "major",
      message: `Option ${label.toUpperCase()} is missing from question ${question.number}.`,
      semanticElementIds: [semanticQuestion.id],
      confidence: 0.86,
      details: { questionNumber: question.number, label }
    }));
  });

  return { sourceQuestions, sourceOptions, semanticQuestions, semanticOptions };
}

function validateGapsAndAnswerAreas({ canonicalText, semanticPage, sourceEvidence, evidenceIndex, issues, suggestedPatches }) {
  const semanticGaps = elementsByType(semanticPage, "answerGap");
  const semanticLines = elementsByType(semanticPage, "answerLine");
  const relationships = Array.isArray(semanticPage?.relationships) ? semanticPage.relationships : [];
  const answerAreaRelationships = relationships.filter(relationship => relationship.type === "answerAreaOf");
  const textualGapCandidates = canonicalText.filter(unit => textHasBlank(unit.text));
  const graphicLineCandidates = (sourceEvidence?.visualEvidence?.graphicCandidates || [])
    .filter(candidate => /answer|line|blank/i.test(`${candidate.role || ""} ${candidate.kind || ""}`));
  const observedGapCount = textualGapCandidates.length;
  const observedAnswerLineCount = textualGapCandidates.length + graphicLineCandidates.length;

  textualGapCandidates.forEach(unit => {
    const covered = semanticGaps.some(gap => semanticElementSupportedByUnit(gap, unit, evidenceIndex) || textHasBlank(gap.text));
    if (!covered) {
      addIssue(issues, {
        type: "missing-answer-gap",
        severity: "major",
        message: `Detected source blank is not represented as answerGap: ${truncateText(unit.text)}.`,
        sourceEvidenceIds: unit.sourceEvidenceIds,
        confidence: 0.88
      });
      suggestedPatches.push({
        type: PATCH_TYPES.createAnswerGap,
        sourceEvidenceIds: unit.sourceEvidenceIds,
        reason: "source-text-blank",
        confidence: 0.88
      });
    }
  });

  if (observedAnswerLineCount > 0 && semanticLines.length === 0) {
    addIssue(issues, {
      type: "missing-answer-line",
      severity: "major",
      message: "Detected answer-gap evidence but no semantic answerLine exists.",
      sourceEvidenceIds: uniqueStrings([...textualGapCandidates.flatMap(unit => unit.sourceEvidenceIds), ...graphicLineCandidates.map(candidate => candidate.id)]),
      confidence: 0.86
    });
    suggestedPatches.push({
      type: PATCH_TYPES.createAnswerLine,
      sourceEvidenceIds: uniqueStrings([...textualGapCandidates.flatMap(unit => unit.sourceEvidenceIds), ...graphicLineCandidates.map(candidate => candidate.id)]),
      reason: "answer-gap-evidence",
      confidence: 0.84
    });
  }

  semanticGaps.forEach(gap => {
    const duplicates = semanticGaps.filter(candidate => candidate.id !== gap.id && sameSourceEvidence(candidate, gap) && normalizeTextForComparison(candidate.text) === normalizeTextForComparison(gap.text));
    if (duplicates.length) addIssue(issues, {
      type: "duplicate-answer-gap",
      severity: "warning",
      message: `Answer gap appears duplicated: ${gap.id}.`,
      semanticElementIds: [gap.id, ...duplicates.map(duplicate => duplicate.id)],
      confidence: 0.76
    });
  });

  semanticLines.forEach(line => {
    const hasRelationship = answerAreaRelationships.some(relationship => relationship.from === line.id) ||
      relationships.some(relationship => relationship.from === line.id && ["anchoredTo", "groupedWith"].includes(relationship.type));
    if (!hasRelationship) addIssue(issues, {
      type: "orphan-answer-line",
      severity: "major",
      message: `Answer line is not connected to a question or gap: ${line.id}.`,
      semanticElementIds: [line.id],
      confidence: 0.84
    });
  });

  answerAreaRelationships.forEach(relationship => {
    const target = elementById(semanticPage, relationship.to);
    if (target?.type !== "question") addIssue(issues, {
      type: "incorrect-answer-area-relationship",
      severity: "critical",
      message: `answerAreaOf must target a question: ${relationship.id}.`,
      semanticElementIds: [relationship.from, relationship.to],
      confidence: 0.98
    });
  });

  return {
    observedGapCount,
    observedAnswerLineCount,
    semanticGapCount: semanticGaps.length,
    semanticAnswerLineCount: semanticLines.length
  };
}

function validateReadingOrder({ semanticPage, evidenceIndex, issues, suggestedPatches }) {
  const elements = Array.isArray(semanticPage?.elements) ? semanticPage.elements : [];
  const readingOrder = Array.isArray(semanticPage?.readingOrder) ? semanticPage.readingOrder : [];
  const expectedReadingOrder = inferValidationReadingOrder(semanticPage, evidenceIndex);
  const expectedColumnCount = Math.max(1, Number(semanticPage?.styleHints?.columnCount) || elementsByType(semanticPage, "column").length || 1);
  const elementIds = new Set(elements.map(element => element.id));
  const duplicates = duplicateStrings(readingOrder);

  duplicates.forEach(id => addIssue(issues, {
    type: "duplicate-reading-order-element",
    severity: "critical",
    message: `Reading order contains duplicate element ${id}.`,
    semanticElementIds: [id],
    confidence: 0.98
  }));
  readingOrder.forEach(id => {
    if (!elementIds.has(id)) addIssue(issues, {
      type: "missing-reading-order-element",
      severity: "critical",
      message: `Reading order references missing element ${id}.`,
      semanticElementIds: [id],
      confidence: 0.98
    });
  });
  expectedReadingOrder.forEach(id => {
    if (!readingOrder.includes(id)) addIssue(issues, {
      type: "missing-reading-order-element",
      severity: "major",
      message: `Semantic reading order omits ${id}.`,
      semanticElementIds: [id],
      confidence: 0.86
    });
  });

  const orderSimilarityScore = readingOrderSimilarity(readingOrder.filter(id => expectedReadingOrder.includes(id)), expectedReadingOrder);
  if (expectedColumnCount > 1 && orderSimilarityScore < SEMANTIC_VALIDATION_THRESHOLDS.columnReadingOrderPass) {
    addIssue(issues, {
      type: "probable-column-order-error",
      severity: "major",
      message: "Semantic reading order does not match likely column flow.",
      semanticElementIds: expectedReadingOrder,
      confidence: roundScore(1 - orderSimilarityScore),
      details: { expectedReadingOrder, actualReadingOrder: readingOrder }
    });
    suggestedPatches.push({
      type: PATCH_TYPES.replaceReadingOrder,
      readingOrder: expectedReadingOrder,
      reason: "column-flow-validation",
      confidence: 0.92
    });
  }

  const spanningIssues = expectedReadingOrder.filter((id, index) => {
    const element = elementById(semanticPage, id);
    return element?.layoutIntent?.spansColumns && element.layoutIntent.band !== "footer" && index > 0 &&
      firstColumnBodyElementBeforeSpanning(semanticPage, expectedReadingOrder, index);
  });
  spanningIssues.forEach(id => addIssue(issues, {
    type: "probable-spanning-element-error",
    severity: "warning",
    message: `Spanning element appears after column body unexpectedly: ${id}.`,
    semanticElementIds: [id],
    confidence: 0.72
  }));

  const continuation = probableParagraphContinuation(semanticPage, evidenceIndex);
  if (continuation) {
    addIssue(issues, {
      type: "probable-paragraph-continuation-error",
      severity: "warning",
      message: "Last left-column paragraph probably continues at top of right column.",
      semanticElementIds: continuation.elementIds,
      confidence: continuation.confidence,
      details: { reason: continuation.reason }
    });
    suggestedPatches.push({
      type: PATCH_TYPES.createSemanticRelationship,
      relationshipType: "continues",
      from: continuation.elementIds[1],
      to: continuation.elementIds[0],
      reason: "probable-paragraph-continuation",
      confidence: continuation.confidence
    });
  }

  return {
    expectedReadingOrder,
    expectedColumnCount,
    orderSimilarityScore
  };
}

function validateVisualCoverage({ sourceEvidence, semanticPage, issues, suggestedPatches }) {
  const imageCandidates = sourceEvidence?.visualEvidence?.imageCandidates || [];
  const graphicCandidates = sourceEvidence?.visualEvidence?.graphicCandidates || [];
  const semanticImages = elementsByTypes(semanticPage, ["image", "illustration", "table"]);
  const semanticSeparators = elementsByType(semanticPage, "separator");
  const semanticBoxes = elementsByType(semanticPage, "box");
  const documentImageCandidates = imageCandidates.filter(candidate => !isHighArtifactRisk(candidate) && likelyDocumentImageCandidate(candidate));

  documentImageCandidates.forEach(candidate => {
    const supported = semanticImages.some(image => (image.sourceEvidenceIds || []).includes(candidate.id));
    if (!supported) {
      addIssue(issues, {
        type: "missing-semantic-image",
        severity: "major",
        message: `Document image candidate is missing semantically: ${candidate.id}.`,
        sourceEvidenceIds: [candidate.id],
        confidence: 0.85
      });
      suggestedPatches.push({
        type: PATCH_TYPES.createSemanticImage,
        semanticType: "image",
        sourceEvidenceIds: [candidate.id],
        reason: "unrepresented-image-candidate",
        confidence: 0.85
      });
    }
  });

  semanticImages.forEach(image => {
    const supported = (image.sourceEvidenceIds || []).some(id => imageCandidates.some(candidate => candidate.id === id));
    if (!supported) addIssue(issues, {
      type: "unsupported-semantic-image",
      severity: "warning",
      message: `Semantic image has no image evidence: ${image.id}.`,
      semanticElementIds: [image.id],
      confidence: 0.74
    });
    const candidate = imageCandidates.find(entry => (image.sourceEvidenceIds || []).includes(entry.id));
    if (candidate && isHighArtifactRisk(candidate)) addIssue(issues, {
      type: "probable-artifact-as-image",
      severity: "warning",
      message: `High artifact-risk image candidate is represented as content: ${candidate.id}.`,
      sourceEvidenceIds: [candidate.id],
      semanticElementIds: [image.id],
      confidence: Number(candidate.artifactRisk) || SEMANTIC_VALIDATION_THRESHOLDS.highArtifactRisk
    });
  });

  duplicateSourceReferences(semanticImages).forEach(group => addIssue(issues, {
    type: "duplicate-semantic-image",
    severity: "warning",
    message: "Image evidence is represented by multiple semantic image elements.",
    sourceEvidenceIds: group.sourceEvidenceIds,
    semanticElementIds: group.elementIds,
    confidence: 0.8
  }));

  graphicCandidates.forEach(candidate => {
    const roleText = `${candidate.kind || ""} ${candidate.role || ""}`;
    if (/separator|rule|line/i.test(roleText) && !semanticSeparators.some(separator => (separator.sourceEvidenceIds || []).includes(candidate.id))) {
      addIssue(issues, {
        type: "missing-separator",
        severity: "warning",
        message: `Graphic separator is not represented semantically: ${candidate.id}.`,
        sourceEvidenceIds: [candidate.id],
        confidence: 0.7
      });
      suggestedPatches.push({
        type: PATCH_TYPES.createSemanticGraphic,
        semanticType: "separator",
        sourceEvidenceIds: [candidate.id],
        reason: "unrepresented-graphic-separator",
        confidence: 0.7
      });
    }
    if (/box/i.test(roleText) && !semanticBoxes.some(box => (box.sourceEvidenceIds || []).includes(candidate.id))) {
      addIssue(issues, {
        type: "missing-box",
        severity: "warning",
        message: `Graphic box is not represented semantically: ${candidate.id}.`,
        sourceEvidenceIds: [candidate.id],
        confidence: 0.7
      });
    }
    if (/table/i.test(roleText) && !semanticImages.some(image => image.type === "table" && (image.sourceEvidenceIds || []).includes(candidate.id))) {
      addIssue(issues, {
        type: "missing-table",
        severity: "major",
        message: `Table-like graphic is not represented semantically: ${candidate.id}.`,
        sourceEvidenceIds: [candidate.id],
        confidence: 0.76
      });
    }
  });

  return {
    documentImageCandidateCount: documentImageCandidates.length,
    semanticImageCount: semanticImages.length,
    graphicCandidateCount: graphicCandidates.length,
    semanticSeparatorCount: semanticSeparators.length
  };
}

function validateRelationshipStructure({ semanticPage, issues, suggestedPatches }) {
  const relationships = Array.isArray(semanticPage?.relationships) ? semanticPage.relationships : [];
  const parentTypes = new Set(["optionOf", "captionOf", "answerAreaOf", "columnOf", "belongsTo", "sectionOf"]);
  const byFromAndType = new Map();
  relationships.filter(relationship => parentTypes.has(relationship.type)).forEach(relationship => {
    const key = `${relationship.type}:${relationship.from}`;
    if (!byFromAndType.has(key)) byFromAndType.set(key, []);
    byFromAndType.get(key).push(relationship);
  });

  byFromAndType.forEach((group, key) => {
    const targetIds = [...new Set(group.map(relationship => relationship.to))];
    const [type] = key.split(":");
    const conflictTypes = new Set(["optionOf", "captionOf", "answerAreaOf", "columnOf"]);
    if (targetIds.length > 1 && conflictTypes.has(type)) {
      addIssue(issues, {
        type: type === "columnOf" ? "column-membership-conflict" : "multiple-parent-conflict",
        severity: "critical",
        message: `${type} relationship has multiple incompatible targets.`,
        semanticElementIds: uniqueStrings([group[0].from, ...targetIds]),
        confidence: 0.98,
        details: { relationshipType: type }
      });
    }
  });

  const follows = relationships.filter(relationship => relationship.type === "follows");
  const precedes = relationships.filter(relationship => relationship.type === "precedes");
  follows.forEach(follow => {
    if (follows.some(other => other.from === follow.to && other.to === follow.from)) {
      addIssue(issues, {
        type: "relationship-cycle",
        severity: "critical",
        message: "follows relationship cycle detected.",
        semanticElementIds: [follow.from, follow.to],
        confidence: 0.98
      });
    }
    if (precedes.some(precede => precede.from === follow.from && precede.to === follow.to)) {
      addIssue(issues, {
        type: "contradictory-relationship",
        severity: "critical",
        message: "follows/precedes relationships contradict each other.",
        semanticElementIds: [follow.from, follow.to],
        confidence: 0.98
      });
    }
  });

  const graphEdges = relationships
    .filter(relationship => ["belongsTo", "optionOf", "captionOf", "answerAreaOf", "columnOf", "sectionOf"].includes(relationship.type))
    .map(relationship => [relationship.from, relationship.to]);
  const cycles = directedGraphCycles(graphEdges);
  cycles.forEach(cycle => addIssue(issues, {
    type: "relationship-cycle",
    severity: "critical",
    message: "Relationship graph cycle detected.",
    semanticElementIds: cycle,
    confidence: 0.98
  }));

  relationships.forEach(relationship => {
    const from = elementById(semanticPage, relationship.from);
    const to = elementById(semanticPage, relationship.to);
    if (relationship.type === "belongsTo" && from?.type === "footer" && ["question", "paragraphGroup", "column"].includes(to?.type)) {
      addIssue(issues, {
        type: "invalid-semantic-grouping",
        severity: "major",
        message: "Footer appears grouped with article/question body.",
        semanticElementIds: [from.id, to.id],
        confidence: 0.88
      });
    }
    if (relationship.type === "belongsTo" && from?.type === "pageNumber" && to?.type !== "footer") {
      addIssue(issues, {
        type: "invalid-semantic-grouping",
        severity: "major",
        message: "Page number is grouped outside the footer.",
        semanticElementIds: [from.id, to?.id].filter(Boolean),
        confidence: 0.88
      });
    }
  });

  if (cycles.length) {
    suggestedPatches.push({
      type: PATCH_TYPES.createSemanticRelationship,
      action: "remove-cycle-edge",
      relationshipIds: relationships.filter(relationship => cycles.some(cycle => cycle.includes(relationship.from) && cycle.includes(relationship.to))).map(relationship => relationship.id),
      reason: "relationship-cycle",
      confidence: 0.82
    });
  }

  return {
    cycleCount: cycles.length,
    relationshipCount: relationships.length
  };
}

function buildEvidenceIndex(sourceEvidence) {
  const items = allSourceEvidenceItems(sourceEvidence);
  const byId = new Map(items.map(item => [item.id, item]));
  return { items, byId };
}

function allSourceEvidenceItems(sourceEvidence) {
  if (!sourceEvidence || typeof sourceEvidence !== "object") return [];
  return [
    ...(sourceEvidence.pdfTextEvidence || []),
    ...(sourceEvidence.ocrEvidence?.words || []),
    ...(sourceEvidence.ocrEvidence?.lines || []),
    ...(sourceEvidence.ocrEvidence?.blocks || []),
    ...(sourceEvidence.visualEvidence?.regions || []),
    ...(sourceEvidence.visualEvidence?.imageCandidates || []),
    ...(sourceEvidence.visualEvidence?.graphicCandidates || [])
  ].filter(item => item?.id);
}

function buildCanonicalSourceTextUnits(sourceEvidence, evidenceIndex) {
  const observations = collectTextObservations(sourceEvidence, evidenceIndex);
  const groups = [];
  observations.forEach(observation => {
    const match = groups.find(group => sourceTextObservationEquivalent(observation, group));
    if (match) {
      match.observations.push(observation);
      match.sourceEvidenceIds = uniqueStrings([...match.sourceEvidenceIds, observation.id]);
      match.text = preferredCanonicalText(match.text, observation.text);
      match.bbox = combineBboxes(match.bbox, observation.bbox);
      match.normalizedText = normalizeTextForComparison(match.text);
      match.tokens = tokenize(match.text);
    } else {
      groups.push({
        id: stableId("canonical-text", groups.length, observation.id, observation.text),
        text: observation.text,
        normalizedText: normalizeTextForComparison(observation.text),
        tokens: tokenize(observation.text),
        bbox: observation.bbox,
        sourceEvidenceIds: [observation.id],
        observations: [observation]
      });
    }
  });
  return groups.sort(compareCanonicalUnits);
}

function collectTextObservations(sourceEvidence) {
  if (!sourceEvidence || typeof sourceEvidence !== "object") return [];
  const pdf = (sourceEvidence.pdfTextEvidence || []).map(item => textObservation(item, "pdf-text"));
  const ocrLines = (sourceEvidence.ocrEvidence?.lines || []).map(item => textObservation(item, "ocr-line"));
  const ocrBlocks = (sourceEvidence.ocrEvidence?.blocks || []).map(item => textObservation(item, "ocr-block"));
  const ocrWords = (sourceEvidence.ocrEvidence?.words || []).map(item => textObservation(item, "ocr-word"));
  const ocr = ocrLines.length ? ocrLines : (ocrBlocks.length ? ocrBlocks : ocrWords);
  const textSelection = sourceEvidence.diagnostics?.textSelection || sourceEvidence.textSelection || null;
  const selectedIds = new Set(Array.isArray(textSelection?.selectedLineIds) ? textSelection.selectedLineIds : []);
  if (selectedIds.size) {
    return [...pdf, ...ocr].filter(observation => selectedIds.has(observation.id) && meaningfulText(observation.text));
  }
  if (textSelection?.mode === "pdf-text-primary") return pdf.filter(observation => meaningfulText(observation.text));
  if (textSelection?.mode === "ocr-primary") return ocr.filter(observation => meaningfulText(observation.text));
  if (textSelection?.mode === "reconciled-pdf-ocr") return [...pdf, ...ocr].filter(observation => meaningfulText(observation.text));
  return [...pdf, ...ocr].filter(observation => meaningfulText(observation.text));
}

function textObservation(item, kind) {
  return {
    id: String(item.id || ""),
    kind,
    text: String(item.text || "").trim(),
    normalizedText: normalizeTextForComparison(item.text),
    tokens: tokenize(item.text),
    bbox: plainBbox(item.bbox),
    source: String(item.source || kind)
  };
}

function sourceTextObservationEquivalent(observation, group) {
  const similarity = Math.max(textSimilarity(observation.text, group.text), characterSimilarity(observation.text, group.text));
  if (similarity >= SEMANTIC_VALIDATION_THRESHOLDS.textSimilarityEquivalent) return true;
  const overlap = bboxOverlapRatio(observation.bbox, group.bbox);
  const proximity = bboxCenterDistance(observation.bbox, group.bbox);
  return overlap >= SEMANTIC_VALIDATION_THRESHOLDS.bboxOverlapEquivalent &&
    similarity >= SEMANTIC_VALIDATION_THRESHOLDS.textSimilaritySupported ||
    proximity <= SEMANTIC_VALIDATION_THRESHOLDS.bboxProximityEquivalent &&
    similarity >= SEMANTIC_VALIDATION_THRESHOLDS.textSimilaritySupported;
}

function recognitionDisagreements(canonicalText) {
  const disagreements = [];
  canonicalText.forEach(unit => {
    for (let leftIndex = 0; leftIndex < unit.observations.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < unit.observations.length; rightIndex += 1) {
        const left = unit.observations[leftIndex];
        const right = unit.observations[rightIndex];
        if (left.kind === right.kind) continue;
        const similarity = Math.max(textSimilarity(left.text, right.text), characterSimilarity(left.text, right.text));
        if (
          similarity >= SEMANTIC_VALIDATION_THRESHOLDS.recognitionDisagreementMin &&
          similarity < SEMANTIC_VALIDATION_THRESHOLDS.recognitionDisagreementMax &&
          normalizeTextForComparison(left.text) !== normalizeTextForComparison(right.text)
        ) disagreements.push({ left, right, similarity });
      }
    }
  });
  return disagreements;
}

function semanticTextElements(semanticPage) {
  return (Array.isArray(semanticPage?.elements) ? semanticPage.elements : [])
    .filter(element => SEMANTIC_TEXT_TYPES.has(element.type) && meaningfulText(element.text))
    .map(element => ({ ...element, text: String(element.text || "").trim() }));
}

function bestCanonicalTextMatch(element, canonicalText, evidenceIndex) {
  const direct = canonicalTextMatches(element, canonicalText, evidenceIndex, { directOnly: true })[0];
  if (direct) return direct;
  const matches = canonicalText.map(unit => ({
    unit,
    score: Math.max(
      textSimilarity(element.text, unit.text),
      normalizedContainsScore(element.text, unit.text),
      bboxProximityTextScore(element, unit, evidenceIndex)
    )
  })).sort((left, right) => right.score - left.score);
  return matches[0] || null;
}

function canonicalTextMatches(element, canonicalText, evidenceIndex, opts = {}) {
  const directMatches = canonicalText
    .filter(unit => intersects(unit.sourceEvidenceIds, element.sourceEvidenceIds || []))
    .map(unit => ({ unit, score: 1 }));
  if (directMatches.length || opts.directOnly) return directMatches;
  const best = bestCanonicalTextMatch(element, canonicalText, evidenceIndex);
  return best ? [best] : [];
}

function bboxProximityTextScore(element, unit, evidenceIndex) {
  const elementBox = elementSourceBbox(element, evidenceIndex);
  if (!elementBox || !unit.bbox) return 0;
  const overlap = bboxOverlapRatio(elementBox, unit.bbox);
  if (overlap >= SEMANTIC_VALIDATION_THRESHOLDS.bboxOverlapEquivalent) return 0.82;
  const distance = bboxCenterDistance(elementBox, unit.bbox);
  return distance <= SEMANTIC_VALIDATION_THRESHOLDS.bboxProximityEquivalent ? 0.74 : 0;
}

function semanticElementSupportedByUnit(element, unit, evidenceIndex) {
  return intersects(element.sourceEvidenceIds || [], unit.sourceEvidenceIds || []) ||
    textSimilarity(element.text, unit.text) >= SEMANTIC_VALIDATION_THRESHOLDS.textSimilaritySupported ||
    bboxProximityTextScore(element, unit, evidenceIndex) >= SEMANTIC_VALIDATION_THRESHOLDS.textSimilaritySupported;
}

function inferSourceQuestions(canonicalText) {
  return canonicalText
    .filter(unit => isQuestionLikeText(unit.text))
    .map((unit, index) => ({
      id: stableId("source-question", index, unit.text, unit.sourceEvidenceIds),
      text: unit.text,
      number: questionNumber(unit.text),
      bbox: unit.bbox,
      sourceEvidenceIds: unit.sourceEvidenceIds,
      order: sourceOrderValue(unit.bbox, index)
    }))
    .sort((left, right) => left.order - right.order);
}

function inferSourceOptions(canonicalText, sourceQuestions) {
  return canonicalText
    .filter(unit => optionLabel(unit.text) !== null)
    .map((unit, index) => {
      const order = sourceOrderValue(unit.bbox, index);
      const previousQuestion = [...sourceQuestions].reverse().find(question => question.order < order);
      return {
        id: stableId("source-option", index, unit.text, unit.sourceEvidenceIds),
        text: unit.text,
        label: optionLabel(unit.text),
        questionNumber: previousQuestion?.number ?? null,
        questionSourceId: previousQuestion?.id || "",
        bbox: unit.bbox,
        sourceEvidenceIds: unit.sourceEvidenceIds,
        order
      };
    })
    .sort((left, right) => left.order - right.order);
}

function inferValidationReadingOrder(semanticPage, evidenceIndex) {
  const candidates = (Array.isArray(semanticPage?.elements) ? semanticPage.elements : [])
    .filter(element => shouldParticipateInReadingOrder(element));
  const enriched = candidates.map(element => ({
    element,
    bbox: elementSourceBbox(element, evidenceIndex),
    band: element.layoutIntent?.band || "body",
    columnRole: element.layoutIntent?.columnRole || "single",
    spansColumns: Boolean(element.layoutIntent?.spansColumns)
  }));
  const headers = enriched.filter(entry => entry.band === "header");
  const footers = enriched.filter(entry => entry.band === "footer");
  const body = enriched.filter(entry => entry.band !== "header" && entry.band !== "footer");
  const columnCount = Math.max(1, Number(semanticPage?.styleHints?.columnCount) || 1);
  let sortedBody;
  if (columnCount > 1) {
    const columnEntries = body.filter(entry => ["left", "right"].includes(entry.columnRole) && !entry.spansColumns);
    const minColumnY = Math.min(...columnEntries.map(entry => Number(entry.bbox?.y ?? 1)), 1);
    const spanningTop = body.filter(entry => (entry.spansColumns || entry.columnRole === "span") && Number(entry.bbox?.y ?? 0.5) <= minColumnY + 0.025);
    const spanningBottom = body.filter(entry => (entry.spansColumns || entry.columnRole === "span") && !spanningTop.includes(entry));
    const left = body.filter(entry => entry.columnRole === "left" && !entry.spansColumns);
    const right = body.filter(entry => entry.columnRole === "right" && !entry.spansColumns);
    const single = body.filter(entry => !spanningTop.includes(entry) && !spanningBottom.includes(entry) && !left.includes(entry) && !right.includes(entry));
    sortedBody = [
      ...spanningTop.sort(compareReadingEntries),
      ...left.sort(compareReadingEntries),
      ...right.sort(compareReadingEntries),
      ...single.sort(compareReadingEntries),
      ...spanningBottom.sort(compareReadingEntries)
    ];
  } else {
    sortedBody = body.sort(compareReadingEntries);
  }
  return uniqueStrings([
    ...headers.sort(compareReadingEntries).map(entry => entry.element.id),
    ...sortedBody.map(entry => entry.element.id),
    ...footers.sort(compareReadingEntries).map(entry => entry.element.id)
  ]);
}

function probableParagraphContinuation(semanticPage, evidenceIndex) {
  const paragraphs = elementsByType(semanticPage, "paragraph")
    .map(element => ({ element, bbox: elementSourceBbox(element, evidenceIndex) }))
    .filter(entry => entry.bbox);
  const left = paragraphs.filter(entry => entry.element.layoutIntent?.columnRole === "left").sort(compareReadingEntries);
  const right = paragraphs.filter(entry => entry.element.layoutIntent?.columnRole === "right").sort(compareReadingEntries);
  if (!left.length || !right.length) return null;
  const lastLeft = left[left.length - 1];
  const firstRight = right[0];
  const text = String(lastLeft.element.text || "").trim();
  const endsOpen = text && !/[.!?:;)"'’”]\s*$/u.test(text);
  const verticalCompatible = Number(firstRight.bbox.y) <= Number(lastLeft.bbox.y) + Number(lastLeft.bbox.height) * 0.65;
  if (!endsOpen || !verticalCompatible) return null;
  return {
    elementIds: [lastLeft.element.id, firstRight.element.id],
    confidence: 0.78,
    reason: "left-column-text-with-open-ending-continues-at-top-of-right-column"
  };
}

function scoreSemanticValidation({ textDiagnostics, questionDiagnostics, gapDiagnostics, readingDiagnostics, visualDiagnostics, relationshipDiagnostics, issues }) {
  const issuePenalty = (types, severity = null) => issues.filter(issue => types.includes(issue.type) && (!severity || issue.severity === severity)).length;
  const textCoverage = ratioScore(textDiagnostics.coveredCanonicalTextCount, textDiagnostics.canonicalTextCount);
  const textUniqueness = clampScore(1 - textDiagnostics.duplicateSemanticTextCount / Math.max(1, textDiagnostics.semanticTextCount));
  const readingOrder = clampScore(readingDiagnostics.orderSimilarityScore -
    issuePenalty(["missing-reading-order-element", "duplicate-reading-order-element", "probable-column-order-error"], "critical") * 0.25 -
    issuePenalty(["probable-column-order-error"], "major") * 0.2);
  const semanticStructure = clampScore(1 -
    issues.filter(issue => ["critical", "major"].includes(issue.severity)).length / Math.max(8, (questionDiagnostics.semanticQuestions.length + questionDiagnostics.semanticOptions.length + 4)) -
    issues.filter(issue => issue.severity === "warning").length * 0.04);
  const relationshipIntegrity = clampScore(1 - (
    issuePenalty(["relationship-cycle", "contradictory-relationship", "multiple-parent-conflict", "column-membership-conflict"], "critical") * 0.35 +
    relationshipDiagnostics.cycleCount * 0.2
  ));
  const questionCoverage = ratioScore(
    Math.max(0, questionDiagnostics.sourceQuestions.length - issuePenalty(["missing-question"])),
    questionDiagnostics.sourceQuestions.length
  );
  const optionCoverage = ratioScore(
    Math.max(0, questionDiagnostics.sourceOptions.length - issuePenalty(["missing-option", "orphan-option", "option-attached-to-wrong-question"])),
    questionDiagnostics.sourceOptions.length
  );
  const gapCoverage = ratioScore(
    Math.max(0, gapDiagnostics.observedGapCount - issuePenalty(["missing-answer-gap"])),
    gapDiagnostics.observedGapCount
  );
  const graphicCoverage = ratioScore(
    Math.max(0, visualDiagnostics.graphicCandidateCount - issuePenalty(["missing-separator", "missing-box", "missing-table"])),
    visualDiagnostics.graphicCandidateCount
  );
  const imageCoverage = ratioScore(
    Math.max(0, visualDiagnostics.documentImageCandidateCount - issuePenalty(["missing-semantic-image"])),
    visualDiagnostics.documentImageCandidateCount
  );
  return {
    textCoverage,
    textUniqueness,
    readingOrder,
    semanticStructure,
    relationshipIntegrity,
    questionCoverage,
    optionCoverage,
    gapCoverage,
    graphicCoverage,
    imageCoverage
  };
}

function weightedOverallScore(scores) {
  const weighted = (
    scores.textCoverage * 0.22 +
    scores.textUniqueness * 0.08 +
    scores.readingOrder * 0.14 +
    scores.semanticStructure * 0.14 +
    scores.relationshipIntegrity * 0.14 +
    scores.questionCoverage * 0.09 +
    scores.optionCoverage * 0.07 +
    scores.gapCoverage * 0.04 +
    scores.graphicCoverage * 0.04 +
    scores.imageCoverage * 0.04
  );
  return roundScore(weighted);
}

function semanticValidationStatus(score, issues) {
  if (issues.some(issue => issue.severity === "critical")) return "retry";
  if (score < SEMANTIC_VALIDATION_THRESHOLDS.warningScore) return "retry";
  if (score < SEMANTIC_VALIDATION_THRESHOLDS.passScore || issues.length) return "warning";
  return "pass";
}

function semanticElementCounts(semanticPage) {
  const elements = Array.isArray(semanticPage?.elements) ? semanticPage.elements : [];
  return {
    paragraphs: elements.filter(element => element.type === "paragraph").length,
    paragraphGroups: elements.filter(element => element.type === "paragraphGroup").length,
    questions: elements.filter(element => element.type === "question").length,
    options: elements.filter(element => element.type === "option").length,
    answerGaps: elements.filter(element => element.type === "answerGap").length,
    answerLines: elements.filter(element => element.type === "answerLine").length,
    images: elements.filter(element => ["image", "illustration", "table"].includes(element.type)).length,
    separators: elements.filter(element => element.type === "separator").length,
    boxes: elements.filter(element => element.type === "box").length,
    columns: elements.filter(element => element.type === "column").length,
    footers: elements.filter(element => element.type === "footer").length,
    pageNumbers: elements.filter(element => element.type === "pageNumber").length
  };
}

function addIssue(issues, issue) {
  const normalized = {
    type: issue.type,
    severity: issue.severity || "warning",
    message: issue.message || issue.type,
    sourceEvidenceIds: uniqueStrings(issue.sourceEvidenceIds || []),
    semanticElementIds: uniqueStrings(issue.semanticElementIds || []),
    confidence: roundScore(issue.confidence ?? 0.75),
    ...(issue.details ? { details: issue.details } : {})
  };
  if (issues.some(existing => existing.type === normalized.type &&
    sameArray(existing.sourceEvidenceIds, normalized.sourceEvidenceIds) &&
    sameArray(existing.semanticElementIds, normalized.semanticElementIds) &&
    existing.message === normalized.message)) return;
  issues.push(normalized);
}

function elementsByType(semanticPage, type) {
  return (Array.isArray(semanticPage?.elements) ? semanticPage.elements : []).filter(element => element.type === type);
}

function elementsByTypes(semanticPage, types) {
  const set = new Set(types);
  return (Array.isArray(semanticPage?.elements) ? semanticPage.elements : []).filter(element => set.has(element.type));
}

function elementById(semanticPage, id) {
  return (Array.isArray(semanticPage?.elements) ? semanticPage.elements : []).find(element => element.id === id) || null;
}

function elementSourceBbox(element, evidenceIndex) {
  const boxes = (element?.sourceEvidenceIds || [])
    .map(id => plainBbox(evidenceIndex.byId.get(id)?.bbox))
    .filter(Boolean);
  return boxes.reduce(combineBboxes, null);
}

function shouldParticipateInReadingOrder(element) {
  if (!element?.id) return false;
  return ["title", "heading", "subheading", "instructions", "paragraph", "question", "option", "answerGap", "answerLine", "image", "illustration", "caption", "footer", "pageNumber"].includes(element.type);
}

function compareReadingEntries(left, right) {
  const leftBox = left.bbox || {};
  const rightBox = right.bbox || {};
  const yDiff = Number(leftBox.y || 0) - Number(rightBox.y || 0);
  if (Math.abs(yDiff) > 0.012) return yDiff;
  return Number(leftBox.x || 0) - Number(rightBox.x || 0);
}

function firstColumnBodyElementBeforeSpanning(semanticPage, expectedReadingOrder, index) {
  return expectedReadingOrder.slice(0, index).some(id => {
    const element = elementById(semanticPage, id);
    return element && ["left", "right"].includes(element.layoutIntent?.columnRole) && element.layoutIntent?.band === "body";
  });
}

function readingOrderSimilarity(actual, expected) {
  if (!expected.length) return 1;
  if (!actual.length) return 0;
  const expectedPositions = new Map(expected.map((id, index) => [id, index]));
  let inversions = 0;
  let comparisons = 0;
  for (let left = 0; left < actual.length; left += 1) {
    for (let right = left + 1; right < actual.length; right += 1) {
      if (!expectedPositions.has(actual[left]) || !expectedPositions.has(actual[right])) continue;
      comparisons += 1;
      if (expectedPositions.get(actual[left]) > expectedPositions.get(actual[right])) inversions += 1;
    }
  }
  const orderScore = comparisons ? 1 - inversions / comparisons : 1;
  const coverageScore = actual.filter(id => expectedPositions.has(id)).length / expected.length;
  return roundScore(orderScore * 0.75 + coverageScore * 0.25);
}

function isQuestionLikeText(text) {
  const trimmed = String(text || "").trim();
  if (EXAM_FOOTER_TEXT_RE.test(trimmed)) return false;
  const numbered = trimmed.match(/^(\d{1,3})\s*([.)-])?\s+(.+)$/u);
  if (numbered) {
    const rest = numbered[3].trim();
    if (!rest || EXAM_FOOTER_TEXT_RE.test(rest)) return false;
    if (/^(?:what|why|how|which|when|where|who|whose|do|does|did|is|are|was|were|can|could|would|should)\b/i.test(rest)) return true;
    if (/\?\s*$/u.test(rest)) return true;
    return Boolean(numbered[2]) &&
      /^[\p{L}"']/u.test(rest) &&
      rest.split(/\s+/).filter(Boolean).length >= 3;
  }
  return /\?\s*$/u.test(trimmed);
}

function questionNumber(text = "", fallbackId = "") {
  const match = String(text || fallbackId || "").match(/(?:^|question-|\bq)(\d{1,3})(?:\b|[-_])/i) ||
    String(text || "").match(/^\s*(\d{1,3})\b/u);
  return match ? Number(match[1]) : null;
}

function optionLabel(text = "", fallbackId = "") {
  const textMatch = String(text || "").match(/^\s*\(?([A-D])\)?(?:[.)-]\s+|:\s+|\s+(?=[A-Z0-9"']))/u);
  if (textMatch) return textMatch[1].toLowerCase();
  const idMatch = String(fallbackId || "").match(/(?:^|option-\d+-)([a-d])(?:\b|[-_])/i);
  return idMatch ? idMatch[1].toLowerCase() : null;
}

function nearestQuestionBeforeElement(option, semanticQuestions, semanticPage, evidenceIndex) {
  const readingOrder = Array.isArray(semanticPage?.readingOrder) ? semanticPage.readingOrder : inferValidationReadingOrder(semanticPage, evidenceIndex);
  const optionIndex = readingOrder.indexOf(option.id);
  if (optionIndex >= 0) {
    for (let index = optionIndex - 1; index >= 0; index -= 1) {
      const candidate = semanticQuestions.find(question => question.id === readingOrder[index]);
      if (candidate) return candidate;
    }
  }
  const optionBox = elementSourceBbox(option, evidenceIndex);
  if (!optionBox) return semanticQuestions[semanticQuestions.length - 1] || null;
  return semanticQuestions
    .map(question => ({ question, bbox: elementSourceBbox(question, evidenceIndex) }))
    .filter(entry => entry.bbox && Number(entry.bbox.y) <= Number(optionBox.y) + 0.01)
    .sort((left, right) => Number(right.bbox.y) - Number(left.bbox.y))[0]?.question || null;
}

function directedGraphCycles(edges) {
  const graph = new Map();
  edges.forEach(([from, to]) => {
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push(to);
  });
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const visit = node => {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      if (start >= 0) cycles.push(stack.slice(start));
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    (graph.get(node) || []).forEach(visit);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  };
  [...graph.keys()].forEach(visit);
  return cycles;
}

function findProbableFragmentedSemanticText(semanticText, canonicalText) {
  const fragments = [];
  for (let index = 0; index < semanticText.length - 1; index += 1) {
    const left = semanticText[index];
    const right = semanticText[index + 1];
    if (left.type !== right.type || !["paragraph", "caption", "footer"].includes(left.type)) continue;
    const combinedText = `${left.text} ${right.text}`.replace(/\s+/g, " ").trim();
    const match = canonicalText.find(unit => textSimilarity(unit.text, combinedText) >= 0.86);
    if (match && textSimilarity(unitText(left), match.text) < 0.78 && textSimilarity(unitText(right), match.text) < 0.78) {
      fragments.push({
        elementIds: [left.id, right.id],
        sourceEvidenceIds: match.sourceEvidenceIds,
        combinedText,
        confidence: 0.82
      });
    }
  }
  return fragments;
}

function duplicateSourceReferences(elements) {
  const byEvidence = new Map();
  elements.forEach(element => {
    (element.sourceEvidenceIds || []).forEach(id => {
      if (!byEvidence.has(id)) byEvidence.set(id, []);
      byEvidence.get(id).push(element.id);
    });
  });
  return [...byEvidence.entries()]
    .filter(([, elementIds]) => elementIds.length > 1)
    .map(([sourceId, elementIds]) => ({ sourceEvidenceIds: [sourceId], elementIds }));
}

function isHighArtifactRisk(candidate) {
  return Number(candidate?.artifactRisk || 0) >= SEMANTIC_VALIDATION_THRESHOLDS.highArtifactRisk;
}

function likelyDocumentImageCandidate(candidate) {
  if (!candidate) return false;
  if (candidate.accepted || candidate.url) return true;
  const area = Number(candidate.bbox?.width || 0) * Number(candidate.bbox?.height || 0);
  return area >= 0.035 && !isHighArtifactRisk(candidate);
}

function textHasBlank(text) {
  return /_{3,}|\.{4,}|-{4,}|\(\s*\)|\[\s*\]/u.test(String(text || ""));
}

function sameSourceEvidence(left, right) {
  return intersects(left?.sourceEvidenceIds || [], right?.sourceEvidenceIds || []);
}

function textLikelyEquivalent(left, right) {
  return textSimilarity(left, right) >= SEMANTIC_VALIDATION_THRESHOLDS.textSimilaritySupported;
}

function likelySemanticTypeFromText(text) {
  if (isQuestionLikeText(text)) return "question";
  if (optionLabel(text)) return "option";
  if (textHasBlank(text)) return "paragraph";
  return "paragraph";
}

function sourceOrderValue(bbox, fallbackIndex) {
  const box = plainBbox(bbox);
  if (!box) return fallbackIndex + 10000;
  return Number(box.y) * 10 + Number(box.x);
}

function compareCanonicalUnits(left, right) {
  return sourceOrderValue(left.bbox, 0) - sourceOrderValue(right.bbox, 0);
}

function duplicateNumbers(numbers) {
  const counts = new Map();
  numbers.forEach(number => counts.set(number, (counts.get(number) || 0) + 1));
  return [...counts.entries()].filter(([, count]) => count > 1).map(([number]) => number);
}

function sequenceGaps(numbers) {
  const sorted = [...new Set(numbers)].sort((left, right) => left - right);
  const gaps = [];
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] - sorted[index - 1] > 1) gaps.push({ previous: sorted[index - 1], next: sorted[index] });
  }
  return gaps;
}

function duplicateStrings(values) {
  const counts = new Map();
  values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

function normalizedContainsScore(left, right) {
  const leftText = normalizeTextForComparison(left);
  const rightText = normalizeTextForComparison(right);
  if (!leftText || !rightText) return 0;
  if (leftText.includes(rightText) || rightText.includes(leftText)) {
    return Math.min(0.9, Math.min(leftText.length, rightText.length) / Math.max(leftText.length, rightText.length) + 0.28);
  }
  return 0;
}

function tokenLossRatio(sourceText, semanticText) {
  const sourceTokens = new Set(tokenize(sourceText));
  const semanticTokens = new Set(tokenize(semanticText));
  if (!sourceTokens.size) return 0;
  const retained = [...sourceTokens].filter(token => semanticTokens.has(token)).length;
  return roundScore(1 - retained / sourceTokens.size);
}

function textSimilarity(left, right) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (!leftTokens.length && !rightTokens.length) return 1;
  if (!leftTokens.length || !rightTokens.length) return 0;
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = [...leftSet].filter(token => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  const jaccard = union ? intersection / union : 0;
  const sequence = orderedTokenOverlap(leftTokens, rightTokens) / Math.max(leftTokens.length, rightTokens.length);
  return roundScore(jaccard * 0.72 + sequence * 0.28);
}

function characterSimilarity(left, right) {
  const leftText = normalizeTextForComparison(left).replace(/\s+/g, "");
  const rightText = normalizeTextForComparison(right).replace(/\s+/g, "");
  if (!leftText && !rightText) return 1;
  if (!leftText || !rightText) return 0;
  const distance = levenshteinDistance(leftText, rightText);
  return roundScore(1 - distance / Math.max(leftText.length, rightText.length));
}

function levenshteinDistance(left, right) {
  const previous = new Array(right.length + 1).fill(0).map((_, index) => index);
  const current = new Array(right.length + 1).fill(0);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + cost
      );
    }
    for (let index = 0; index <= right.length; index += 1) previous[index] = current[index];
  }
  return previous[right.length];
}

function orderedTokenOverlap(leftTokens, rightTokens) {
  const matrix = Array.from({ length: leftTokens.length + 1 }, () => new Array(rightTokens.length + 1).fill(0));
  for (let left = 1; left <= leftTokens.length; left += 1) {
    for (let right = 1; right <= rightTokens.length; right += 1) {
      matrix[left][right] = leftTokens[left - 1] === rightTokens[right - 1]
        ? matrix[left - 1][right - 1] + 1
        : Math.max(matrix[left - 1][right], matrix[left][right - 1]);
    }
  }
  return matrix[leftTokens.length][rightTokens.length];
}

function tokenize(text) {
  return normalizeTextForComparison(text).split(/\s+/).filter(token => token.length > 0);
}

function normalizeTextForComparison(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/\s*([.,:;?!])\s*/g, "$1 ")
    .replace(/[^\p{L}\p{N}'?-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulText(text) {
  return tokenCount(text) > 0 && normalizeTextForComparison(text).length >= 2;
}

function tokenCount(text) {
  return tokenize(text).length;
}

function unitText(element) {
  return String(element?.text || "");
}

function preferredCanonicalText(left, right) {
  return String(right || "").length > String(left || "").length ? String(right || "") : String(left || "");
}

function plainBbox(bbox) {
  if (!bbox || typeof bbox !== "object") return null;
  const x = Number(bbox.x);
  const y = Number(bbox.y);
  const width = Number(bbox.width);
  const height = Number(bbox.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function combineBboxes(left, right) {
  if (!left) return right || null;
  if (!right) return left || null;
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: maxX - x, height: maxY - y };
}

function bboxOverlapRatio(left, right) {
  if (!left || !right) return 0;
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const smaller = Math.min(left.width * left.height, right.width * right.height);
  return smaller > 0 ? overlap / smaller : 0;
}

function bboxCenterDistance(left, right) {
  if (!left || !right) return 1;
  return Math.hypot((left.x + left.width / 2) - (right.x + right.width / 2), (left.y + left.height / 2) - (right.y + right.height / 2));
}

function intersects(left = [], right = []) {
  const set = new Set(left);
  return right.some(value => set.has(value));
}

function ratioScore(numerator, denominator) {
  if (!denominator) return 1;
  return clampScore(numerator / denominator);
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return roundScore(Math.max(0, Math.min(1, number)));
}

function roundScore(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function formatScore(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "0.00";
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || "")).filter(Boolean))];
}

function sameArray(left = [], right = []) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function truncateText(text, limit = 90) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function stableId(prefix, index, ...parts) {
  return `${prefix}-${String(index + 1).padStart(4, "0")}-${stableHash(parts)}`;
}

function stableHash(value) {
  const text = JSON.stringify(value, (_, entry) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return Object.keys(entry).sort().reduce((sorted, key) => {
        sorted[key] = entry[key];
        return sorted;
      }, {});
    }
    return entry;
  });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(6, "0").slice(0, 8);
}

function issueTypeCounts(issues = []) {
  const counts = new Map();
  issues.forEach(issue => counts.set(issue.type, (counts.get(issue.type) || 0) + 1));
  return [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0]));
}
