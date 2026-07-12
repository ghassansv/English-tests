export const SOURCE_EVIDENCE_SCHEMA_VERSION = "source-evidence/v1";
export const SEMANTIC_PAGE_SCHEMA_VERSION = "semantic-page/v1";
export const SOURCE_CONTAINER_SCHEMA_VERSION = "source-container/v3";

const SOURCE_BBOX_COORDINATE_SPACE = "source-document-plane-normalized";
const OCR_ENGINE_TESSERACT = "tesseract.js";

const SUPPORTED_SEMANTIC_TYPES = new Set([
  "title",
  "heading",
  "subheading",
  "instructions",
  "paragraph",
  "paragraphGroup",
  "section",
  "column",
  "columnGroup",
  "question",
  "option",
  "answerGap",
  "answerLine",
  "image",
  "illustration",
  "caption",
  "table",
  "footer",
  "pageNumber",
  "separator",
  "box",
  "visualGroup"
]);

const SUPPORTED_RELATIONSHIP_TYPES = new Set([
  "belongsTo",
  "follows",
  "precedes",
  "columnOf",
  "spansColumns",
  "anchoredTo",
  "groupedWith",
  "captionOf",
  "optionOf",
  "answerAreaOf",
  "sectionOf",
  "continues",
  "separates"
]);

export function buildNationalTestSourceEvidenceModel({
  page = {},
  extraction = {},
  sourceImages = [],
  adaptiveRegions = [],
  generatedAt = new Date().toISOString()
} = {}) {
  const pageRef = nationalTestPageRef(page);
  const sourcePage = page?.sourcePage || null;
  const normalizedPage = page?.normalizedPage || null;
  const extractionItems = Array.isArray(extraction?.items) ? extraction.items : [];
  const evidenceSeed = extraction?.evidence && typeof extraction.evidence === "object" ? extraction.evidence : {};
  const provenanceIndex = { extractionItemIdToEvidenceIds: {}, visualIdToEvidenceIds: {} };

  const rememberItemEvidence = (itemId, evidenceId) => {
    const key = stableTextId(itemId || "unmapped-item");
    if (!provenanceIndex.extractionItemIdToEvidenceIds[key]) provenanceIndex.extractionItemIdToEvidenceIds[key] = [];
    provenanceIndex.extractionItemIdToEvidenceIds[key].push(evidenceId);
  };
  const rememberVisualEvidence = (visualId, evidenceId) => {
    const key = stableTextId(visualId || "unmapped-visual");
    if (!provenanceIndex.visualIdToEvidenceIds[key]) provenanceIndex.visualIdToEvidenceIds[key] = [];
    provenanceIndex.visualIdToEvidenceIds[key].push(evidenceId);
  };

  const pdfSourceItems = Array.isArray(evidenceSeed.pdfTextItems) && evidenceSeed.pdfTextItems.length
    ? evidenceSeed.pdfTextItems
    : String(extraction?.source || "") === "pdf-text"
      ? extractionItems.map(item => ({ ...item, sourceItemId: item.id }))
      : [];
  const pdfTextEvidence = pdfSourceItems.map((item, index) => {
    const sourceItemId = stableTextId(item.sourceItemId || item.id || matchingExtractionItemId(item, extractionItems) || `pdf-${index + 1}`);
    const id = stableEvidenceId("pdf-text", index, sourceItemId, item.text, item.bbox || item);
    const evidence = {
      id,
      kind: "pdf-text",
      text: String(item.text || "").trim(),
      bbox: sourceEvidenceBBox(item.bbox || item),
      confidence: normalizedConfidence(item.confidence ?? 99),
      source: "pdf-text-layer",
      sourceItemId
    };
    rememberItemEvidence(sourceItemId, id);
    return evidence;
  }).filter(item => item.text && item.bbox);

  const ocrBlocks = [];
  const ocrLines = [];
  const ocrWords = [];
  const rawBlockIdMap = new Map();
  const rawLineIdMap = new Map();
  const rawOcrBlocks = Array.isArray(evidenceSeed.ocrBlocks) ? evidenceSeed.ocrBlocks : [];
  const rawOcrLines = Array.isArray(evidenceSeed.ocrLines) ? evidenceSeed.ocrLines : [];
  const rawOcrWords = Array.isArray(evidenceSeed.ocrWords) ? evidenceSeed.ocrWords : [];
  const shouldSynthesizeOcrFromExtraction = !rawOcrBlocks.length && !rawOcrLines.length && String(extraction?.source || "") !== "pdf-text";

  if (rawOcrBlocks.length || rawOcrLines.length || shouldSynthesizeOcrFromExtraction) {
    const sourceBlocks = rawOcrBlocks.length
      ? rawOcrBlocks
      : rawOcrLines.length
        ? rawOcrLines
        : extractionItems.map(item => ({ ...item, sourceItemId: item.id }));
    sourceBlocks.forEach((block, index) => {
      const sourceItemId = stableTextId(block.sourceItemId || block.id || matchingExtractionItemId(block, extractionItems) || `ocr-block-${index + 1}`);
      const id = stableEvidenceId("ocr-block", index, sourceItemId, block.text, block.bbox);
      const evidence = {
        id,
        kind: "ocr-block",
        text: String(block.text || "").trim(),
        bbox: sourceEvidenceBBox(block.bbox),
        confidence: normalizedConfidence(block.confidence ?? extraction?.averageConfidence ?? 0),
        source: String(block.source || evidenceSeed.ocrEngine || OCR_ENGINE_TESSERACT),
        sourceItemId
      };
      if (!evidence.text || !evidence.bbox) return;
      ocrBlocks.push(evidence);
      [block.id, block.blockId, block.sourceBlockId].filter(Boolean).forEach(rawId => rawBlockIdMap.set(String(rawId), id));
      rememberItemEvidence(sourceItemId, id);
    });
  }

  if (rawOcrLines.length || shouldSynthesizeOcrFromExtraction) {
    const sourceLines = rawOcrLines.length ? rawOcrLines : extractionItems.map(item => ({ ...item, sourceItemId: item.id }));
    sourceLines.forEach((line, index) => {
      const sourceItemId = stableTextId(line.sourceItemId || line.id || matchingExtractionItemId(line, extractionItems) || `ocr-line-${index + 1}`);
      const blockId = sourceEvidenceBlockIdForItem(sourceItemId, ocrBlocks) || stableEvidenceId("ocr-block", index, sourceItemId, line.text, line.bbox);
      const id = stableEvidenceId("ocr-line", index, sourceItemId, line.text, line.bbox);
      const evidence = {
        id,
        kind: "ocr-line",
        text: String(line.text || "").trim(),
        bbox: sourceEvidenceBBox(line.bbox),
        confidence: normalizedConfidence(line.confidence ?? extraction?.averageConfidence ?? 0),
        blockId,
        source: String(line.source || evidenceSeed.ocrEngine || OCR_ENGINE_TESSERACT),
        sourceItemId
      };
      if (!evidence.text || !evidence.bbox) return;
      ocrLines.push(evidence);
      [line.id, line.lineId, line.sourceLineId].filter(Boolean).forEach(rawId => rawLineIdMap.set(String(rawId), id));
      rememberItemEvidence(sourceItemId, id);
    });
  }

  rawOcrWords.forEach((word, index) => {
    const sourceItemId = stableTextId(word.sourceItemId || matchingExtractionItemId(word, extractionItems) || `ocr-word-${index + 1}`);
    const lineId = rawLineIdMap.get(String(word.lineId || word.sourceLineId || "")) ||
      sourceEvidenceLineIdForItem(sourceItemId, ocrLines) ||
      "";
    const blockId = rawBlockIdMap.get(String(word.blockId || word.sourceBlockId || "")) ||
      sourceEvidenceBlockIdForItem(sourceItemId, ocrBlocks) ||
      "";
    const id = stableEvidenceId("ocr-word", index, sourceItemId, word.text, word.bbox || word);
    const evidence = {
      id,
      kind: "ocr-word",
      text: String(word.text || "").trim(),
      bbox: sourceEvidenceBBox(word.bbox || word),
      confidence: normalizedConfidence(word.confidence ?? 0),
      lineId,
      blockId,
      source: String(word.source || evidenceSeed.ocrEngine || OCR_ENGINE_TESSERACT),
      sourceItemId
    };
    if (!evidence.text || !evidence.bbox) return;
    ocrWords.push(evidence);
    rememberItemEvidence(sourceItemId, id);
  });

  const candidates = (Array.isArray(evidenceSeed.ocrCandidates) ? evidenceSeed.ocrCandidates : [])
    .map((candidate, index) => ({
      id: stableEvidenceId("ocr-candidate", index, candidate.name, candidate.score, candidate.processing),
      name: String(candidate.name || `OCR candidate ${index + 1}`),
      engine: String(candidate.engine || evidenceSeed.ocrEngine || OCR_ENGINE_TESSERACT),
      language: String(candidate.language || "eng"),
      score: finiteNumber(candidate.score, 0),
      averageConfidence: normalizedConfidence(candidate.averageConfidence ?? candidate.confidence ?? 0),
      itemCount: Math.max(0, Math.round(Number(candidate.itemCount) || 0)),
      selected: Boolean(candidate.selected),
      processing: clonePlainObject(candidate.processing)
    }));
  if (!candidates.length && (ocrBlocks.length || ocrLines.length || ocrWords.length)) {
    candidates.push({
      id: stableEvidenceId("ocr-candidate", 0, extraction?.source, extraction?.strategy, extraction?.averageConfidence),
      name: String(extraction?.strategy || "selected OCR"),
      engine: String(evidenceSeed.ocrEngine || OCR_ENGINE_TESSERACT),
      language: "eng",
      score: finiteNumber(evidenceSeed.ocrScore, 0),
      averageConfidence: normalizedConfidence(extraction?.averageConfidence ?? 0),
      itemCount: extractionItems.length,
      selected: true,
      processing: clonePlainObject(page?.sourceProcessing || evidenceSeed.processing)
    });
  }

  const regions = (Array.isArray(adaptiveRegions) ? adaptiveRegions : [])
    .map((region, index) => ({
      id: stableTextId(region.id || stableEvidenceId("visual-region", index, region.role, region.bbox)),
      kind: String(region.type || "region"),
      role: String(region.role || region.type || "region"),
      bbox: sourceEvidenceBBox(region.bbox),
      source: "adaptive-region-detector",
      elementIds: normalizeStringArray(region.elementIds),
      confidence: normalizedConfidence(region.confidence ?? 0.72)
    }))
    .filter(region => region.bbox);

  const imageCandidates = (Array.isArray(sourceImages) ? sourceImages : [])
    .map((image, index) => {
      const imageId = stableTextId(image.id || `image-${index + 1}`);
      const id = stableEvidenceId("image-candidate", index, imageId, image.crop);
      rememberVisualEvidence(imageId, id);
      return {
        id,
        kind: "image-candidate",
        sourceImageId: imageId,
        bbox: sourceEvidenceBBox(image.crop || image.bbox),
        source: "detectNationalTestSourceImageRegions",
        accepted: Boolean(image.accepted || image.url),
        url: String(image.url || ""),
        caption: String(image.caption || "").trim(),
        confidence: normalizedConfidence(image.confidence ?? (image.accepted || image.url ? 0.85 : 0.55))
      };
    })
    .filter(image => image.bbox);

  const graphicCandidates = regions
    .filter(region => ["line", "box", "separator", "rule"].includes(region.kind) || /rule|separator|line|box/i.test(region.role))
    .map((region, index) => ({
      id: stableEvidenceId("graphic-candidate", index, region.id, region.bbox),
      kind: region.kind === "line" ? "separator" : region.kind,
      role: region.role,
      bbox: region.bbox,
      source: region.source,
      confidence: region.confidence,
      regionId: region.id
    }));

  const model = {
    schemaVersion: SOURCE_EVIDENCE_SCHEMA_VERSION,
    pageRef,
    coordinatePolicy: {
      bboxMeaning: "Every bbox is where evidence was observed in the source document plane.",
      bboxCoordinateSpace: SOURCE_BBOX_COORDINATE_SPACE,
      forbiddenUse: "Do not render these bbox values directly as final A4 geometry."
    },
    source: {
      pdfUrl: String(page?.pdfUrl || page?.testPdfUrl || ""),
      sourcePageImage: sourcePage?.url || null,
      normalizedPageImage: normalizedPage?.url || null,
      originalPixelSize: {
        width: Math.max(0, Math.round(Number(sourcePage?.pixelWidth) || 0)),
        height: Math.max(0, Math.round(Number(sourcePage?.pixelHeight) || 0))
      },
      normalizedPixelSize: {
        width: Math.max(0, Math.round(Number(normalizedPage?.pixelWidth) || 0)),
        height: Math.max(0, Math.round(Number(normalizedPage?.pixelHeight) || 0))
      },
      crop: sourceEvidenceBBox(page?.sourceSelection?.crop || sourcePage?.sourceCrop),
      sourceCorners: clonePlainObject(normalizedPage?.sourceCorners || null),
      transform: clonePlainObject(normalizedPage?.transform || null),
      processing: clonePlainObject(page?.sourceProcessing || null)
    },
    pdfTextEvidence,
    ocrEvidence: {
      engine: ocrBlocks.length || ocrLines.length || ocrWords.length || candidates.length
        ? String(evidenceSeed.ocrEngine || OCR_ENGINE_TESSERACT)
        : null,
      language: "eng",
      candidates,
      words: ocrWords,
      lines: ocrLines,
      blocks: ocrBlocks
    },
    visualEvidence: {
      regions,
      imageCandidates,
      graphicCandidates
    },
    provenanceIndex,
    diagnostics: {
      generatedAt,
      extractionSource: String(extraction?.source || "unknown"),
      extractionStrategy: String(extraction?.strategy || "whole-page"),
      warnings: [],
      qualityMetrics: {
        averageTextConfidence: normalizedConfidence(extraction?.averageConfidence ?? 0),
        pdfTextEvidenceCount: pdfTextEvidence.length,
        ocrWordCount: ocrWords.length,
        ocrLineCount: ocrLines.length,
        ocrBlockCount: ocrBlocks.length,
        visualRegionCount: regions.length,
        imageCandidateCount: imageCandidates.length,
        graphicCandidateCount: graphicCandidates.length
      }
    }
  };

  const validation = validateNationalTestSourceEvidenceModel(model);
  model.diagnostics.warnings = validation.issues.map(issue => issue.message);
  model.diagnostics.validationState = {
    valid: validation.valid,
    issueCount: validation.issues.length
  };
  return model;
}

export function buildNationalTestSemanticPageModel({
  page = {},
  extraction = {},
  sourceEvidence = null,
  sourceImages = [],
  adaptiveRegions = [],
  generatedAt = new Date().toISOString()
} = {}) {
  const pageRef = nationalTestPageRef(page);
  const items = Array.isArray(extraction?.items) ? extraction.items.filter(item => String(item?.text || "").trim()) : [];
  const textGeometry = new Map(items.map(item => [stableTextId(item.id), sourceEvidenceBBox(item.bbox)]));
  const columnModel = inferSemanticColumns(items);
  const sourceEvidenceIdsByItem = sourceEvidence?.provenanceIndex?.extractionItemIdToEvidenceIds || {};
  const sourceEvidenceIdsByVisual = sourceEvidence?.provenanceIndex?.visualIdToEvidenceIds || {};

  const elements = [];
  const relationships = [];
  const elementGeometry = new Map();
  const elementBySourceItem = new Map();
  const currentQuestionStack = [];
  const counters = {};
  const addElement = element => {
    const unique = uniqueSemanticElementId(element.id, elements);
    const normalized = {
      id: unique,
      type: SUPPORTED_SEMANTIC_TYPES.has(element.type) ? element.type : "paragraph",
      ...(element.text ? { text: element.text } : {}),
      sourceEvidenceIds: normalizeStringArray(element.sourceEvidenceIds),
      confidence: normalizedConfidence(element.confidence ?? 0.75),
      semanticRole: element.semanticRole || null,
      hierarchyLevel: element.hierarchyLevel ?? null,
      readingOrder: null,
      layoutIntent: {
        band: element.layoutIntent?.band || "body",
        columnRole: element.layoutIntent?.columnRole || "single",
        spansColumns: Boolean(element.layoutIntent?.spansColumns),
        relativeWidth: element.layoutIntent?.relativeWidth || "normal",
        relativeHeight: element.layoutIntent?.relativeHeight || "normal",
        prominence: element.layoutIntent?.prominence || "normal",
        alignment: element.layoutIntent?.alignment || "left",
        preserveAspectRatio: Boolean(element.layoutIntent?.preserveAspectRatio)
      }
    };
    elements.push(normalized);
    if (element.geometry) elementGeometry.set(unique, element.geometry);
    if (element.sourceItemId) elementBySourceItem.set(stableTextId(element.sourceItemId), unique);
    return normalized;
  };
  const addRelationship = (type, from, to, confidence = 0.85, reason = "") => {
    if (!from || !to || from === to || !SUPPORTED_RELATIONSHIP_TYPES.has(type)) return;
    relationships.push({
      id: stableEvidenceId(`rel-${type}`, relationships.length, from, to, reason),
      type,
      from,
      to,
      confidence: normalizedConfidence(confidence),
      ...(reason ? { reason } : {})
    });
  };

  const separatorRegions = (Array.isArray(adaptiveRegions) ? adaptiveRegions : [])
    .filter(region => region?.type === "line" || /rule|separator/i.test(String(region?.role || "")));
  separatorRegions.forEach((region, index) => {
    const evidenceIds = sourceEvidence?.visualEvidence?.graphicCandidates
      ?.filter(candidate => candidate.regionId === region.id)
      .map(candidate => candidate.id) || [];
    const separator = addElement({
      id: stableSemanticId("separator", region.id || index, region.role),
      type: "separator",
      sourceEvidenceIds: evidenceIds,
      semanticRole: "decorative-rule",
      confidence: 0.75,
      layoutIntent: { band: semanticBandForBbox(region.bbox), columnRole: "span", spansColumns: true, relativeWidth: "wide", relativeHeight: "thin", prominence: "low" },
      geometry: sourceEvidenceBBox(region.bbox)
    });
  });

  let columnGroupElement = null;
  const columnElements = new Map();
  if (columnModel.columns.length > 1) {
    const groupEvidenceIds = [];
    columnModel.columns.forEach(column => {
      column.items.forEach(item => {
        groupEvidenceIds.push(...sourceEvidenceIdsForItem(item, sourceEvidenceIdsByItem));
      });
    });
    columnGroupElement = addElement({
      id: stableSemanticId("column-group", pageRef.pageId || pageRef.pageNumber || "page", columnModel.columns.length),
      type: "columnGroup",
      sourceEvidenceIds: uniqueStrings(groupEvidenceIds),
      semanticRole: "body-columns",
      confidence: columnModel.confidence,
      layoutIntent: { band: "body", columnRole: "span", spansColumns: true, relativeWidth: "wide", relativeHeight: "tall", prominence: "normal" }
    });
    columnModel.columns.forEach((column, index) => {
      const role = column.role || (index === 0 ? "left" : "right");
      const evidenceIds = uniqueStrings(column.items.flatMap(item => sourceEvidenceIdsForItem(item, sourceEvidenceIdsByItem)));
      const columnElement = addElement({
        id: stableSemanticId("column", role, pageRef.pageId || pageRef.pageNumber || "page"),
        type: "column",
        sourceEvidenceIds: evidenceIds,
        semanticRole: role,
        confidence: columnModel.confidence,
        layoutIntent: { band: "body", columnRole: role, spansColumns: false, relativeWidth: "column", relativeHeight: "tall", prominence: "normal" },
        geometry: column.bbox
      });
      columnElements.set(role, columnElement);
      addRelationship("belongsTo", columnElement.id, columnGroupElement.id, 0.96, "column group inference");
    });
  }

  items.forEach((item, index) => {
    const sourceItemId = stableTextId(item.id || `item-${index + 1}`);
    const semanticType = semanticTypeForExtractionItem(item);
    const bbox = textGeometry.get(sourceItemId);
    const columnRole = semanticColumnRoleForItem(item, columnModel);
    const spansColumns = semanticItemSpansColumns(item, columnModel);
    const element = addElement({
      id: semanticIdForExtractionItem(item, semanticType, index, counters, currentQuestionStack),
      type: semanticType,
      text: String(item.text || "").trim(),
      sourceEvidenceIds: sourceEvidenceIdsForItem(item, sourceEvidenceIdsByItem),
      confidence: item.confidence,
      semanticRole: String(item.role || semanticType),
      hierarchyLevel: hierarchyLevelForSemanticType(semanticType),
      sourceItemId,
      layoutIntent: {
        band: semanticBandForBbox(bbox, semanticType),
        columnRole,
        spansColumns,
        relativeWidth: semanticRelativeWidthForBbox(bbox, columnModel),
        relativeHeight: semanticRelativeHeightForBbox(bbox),
        prominence: semanticProminenceForItem(item, semanticType),
        alignment: semanticAlignmentForItem(item, bbox),
        preserveAspectRatio: false
      },
      geometry: bbox
    });

    if (semanticType === "question") {
      currentQuestionStack.push(element);
    } else if (semanticType === "option") {
      const question = nearestQuestionForOption(items, index, elementBySourceItem, currentQuestionStack);
      if (question) addRelationship("optionOf", element.id, question.id, 0.96, "option follows nearest question");
    }

    if (columnGroupElement && spansColumns) {
      addRelationship("spansColumns", element.id, columnGroupElement.id, 0.9, "wide source evidence across columns");
    } else if (columnElements.has(columnRole)) {
      addRelationship("columnOf", element.id, columnElements.get(columnRole).id, 0.9, "source evidence column membership");
    }

    const gaps = semanticAnswerGapsForItem(item);
    gaps.forEach((gap, gapIndex) => {
      const gapElement = addElement({
        id: stableSemanticId("answer-gap", element.id, gapIndex + 1, gap.kind),
        type: "answerGap",
        text: gap.text || "",
        sourceEvidenceIds: sourceEvidenceIdsForItem(item, sourceEvidenceIdsByItem),
        confidence: gap.confidence,
        semanticRole: gap.kind,
        hierarchyLevel: hierarchyLevelForSemanticType("answerGap"),
        layoutIntent: {
          band: element.layoutIntent.band,
          columnRole: element.layoutIntent.columnRole,
          spansColumns: element.layoutIntent.spansColumns,
          relativeWidth: gap.widthHint || "short",
          relativeHeight: "thin",
          prominence: "normal",
          alignment: "left",
          preserveAspectRatio: false
        },
        geometry: bbox
      });
      const answerTarget = currentQuestionStack[currentQuestionStack.length - 1] || (element.type === "question" ? element : null);
      if (answerTarget?.type === "question") addRelationship("answerAreaOf", gapElement.id, answerTarget.id, 0.9, "inline answer blank");
      else addRelationship("anchoredTo", gapElement.id, element.id, 0.82, "blank anchored to non-question text");
      const lineElement = addElement({
        id: stableSemanticId("answer-line", element.id, gapIndex + 1, gap.kind),
        type: "answerLine",
        sourceEvidenceIds: sourceEvidenceIdsForItem(item, sourceEvidenceIdsByItem),
        confidence: gap.confidence,
        semanticRole: "answer-line-for-gap",
        hierarchyLevel: hierarchyLevelForSemanticType("answerLine"),
        layoutIntent: {
          band: element.layoutIntent.band,
          columnRole: element.layoutIntent.columnRole,
          spansColumns: element.layoutIntent.spansColumns,
          relativeWidth: gap.widthHint || "short",
          relativeHeight: "thin",
          prominence: "normal",
          alignment: "left",
          preserveAspectRatio: false
        },
        geometry: bbox
      });
      if (answerTarget?.type === "question") addRelationship("answerAreaOf", lineElement.id, answerTarget.id, 0.88, "answer line implied by blank");
      else addRelationship("anchoredTo", lineElement.id, element.id, 0.8, "answer line anchored to non-question text");
      addRelationship("groupedWith", lineElement.id, gapElement.id, 0.92, "answer line represents blank");
    });
  });

  const paragraphGroups = buildSemanticParagraphGroups(elements, elementGeometry, columnElements, columnModel);
  paragraphGroups.forEach(group => {
    const groupElement = addElement({
      id: group.id,
      type: "paragraphGroup",
      sourceEvidenceIds: group.sourceEvidenceIds,
      confidence: group.confidence,
      semanticRole: group.role,
      hierarchyLevel: 2,
      layoutIntent: {
        band: "body",
        columnRole: group.columnRole,
        spansColumns: group.spansColumns,
        relativeWidth: group.spansColumns ? "wide" : "column",
        relativeHeight: group.elements.length > 2 ? "tall" : "normal",
        prominence: "normal",
        alignment: "left",
        preserveAspectRatio: false
      },
      geometry: group.geometry
    });
    group.elements.forEach(child => {
      addRelationship("belongsTo", child.id, groupElement.id, 0.9, "paragraph grouping");
      if (columnElements.has(group.columnRole)) addRelationship("sectionOf", groupElement.id, columnElements.get(group.columnRole).id, 0.82, "paragraph group inside column");
    });
    for (let index = 1; index < group.elements.length; index += 1) {
      addRelationship("continues", group.elements[index].id, group.elements[index - 1].id, 0.72, "adjacent paragraphs in same region");
    }
  });

  const semanticImages = (Array.isArray(sourceImages) ? sourceImages : [])
    .filter(image => image?.crop || image?.url)
    .map((image, index) => {
      const visualId = stableTextId(image.id || `image-${index + 1}`);
      const bbox = sourceEvidenceBBox(image.crop || image.bbox);
      const imageType = /diagram|illustration|map|chart/i.test(String(image.caption || image.role || ""))
        ? "illustration"
        : "image";
      return addElement({
        id: stableSemanticId(imageType, visualId, index + 1),
        type: imageType,
        sourceEvidenceIds: sourceEvidenceIdsByVisual[visualId] || [],
        confidence: image.confidence ?? 0.85,
        semanticRole: "visual-content",
        hierarchyLevel: 2,
        layoutIntent: {
          band: semanticBandForBbox(bbox, imageType),
          columnRole: semanticColumnRoleForBbox(bbox, columnModel),
          spansColumns: Boolean(bbox && Number(bbox.width || 0) > 0.55),
          relativeWidth: semanticRelativeWidthForBbox(bbox, columnModel),
          relativeHeight: semanticRelativeHeightForBbox(bbox),
          prominence: "high",
          alignment: "center",
          preserveAspectRatio: true
        },
        geometry: bbox
      });
    });

  semanticImages.forEach(imageElement => {
    const anchor = nearestTextualAnchor(imageElement, elements, elementGeometry);
    if (anchor) addRelationship("anchoredTo", imageElement.id, anchor.id, 0.78, "nearest text or paragraph group");
  });

  const captionElements = elements.filter(element => element.type === "caption");
  captionElements.forEach(caption => {
    const image = nearestImageForCaption(caption, semanticImages, elementGeometry);
    if (image) addRelationship("captionOf", caption.id, image.id, 0.82, "caption near image");
  });

  addFooterPageNumberElements({ elements, addElement, addRelationship, page, sourceEvidenceIdsByItem, items, elementGeometry });

  const readingOrder = inferSemanticReadingOrder(elements, elementGeometry, relationships, columnModel);
  readingOrder.forEach((id, index) => {
    const element = elements.find(candidate => candidate.id === id);
    if (element) element.readingOrder = index + 1;
    if (index > 0) {
      addRelationship("follows", id, readingOrder[index - 1], 0.94, "semantic reading order");
      addRelationship("precedes", readingOrder[index - 1], id, 0.94, "semantic reading order");
    }
  });

  const validationState = {
    confidence: semanticModelConfidence(elements, relationships, sourceEvidence),
    unresolvedIssues: []
  };
  const model = {
    schemaVersion: SEMANTIC_PAGE_SCHEMA_VERSION,
    pageRef,
    generatedAt,
    pageType: String(extraction?.pageStructure?.type || inferredSemanticPageType(elements, sourceImages)),
    elements,
    relationships,
    readingOrder,
    styleHints: {
      columnCount: columnModel.columns.length,
      hasTitle: elements.some(element => element.type === "title"),
      hasQuestions: elements.some(element => element.type === "question"),
      hasAnswerAreas: elements.some(element => element.type === "answerGap" || element.type === "answerLine"),
      hasImages: semanticImages.length > 0,
      hasFooter: elements.some(element => element.type === "footer" || element.type === "pageNumber"),
      sourceGeometryUse: "evidence-only"
    },
    validationState
  };

  const validation = validateNationalTestSemanticPageModel(model, sourceEvidence);
  model.validationState.confidence = Math.min(model.validationState.confidence, validation.confidence);
  model.validationState.unresolvedIssues = validation.issues;
  return model;
}

export function validateNationalTestSourceEvidenceModel(model) {
  const issues = [];
  if (!model || typeof model !== "object") {
    return { valid: false, confidence: 0, issues: [{ code: "invalid-model", message: "SourceEvidenceModel is not an object." }] };
  }
  if (model.schemaVersion !== SOURCE_EVIDENCE_SCHEMA_VERSION) {
    issues.push({ code: "schema-version", message: `Expected ${SOURCE_EVIDENCE_SCHEMA_VERSION}.` });
  }
  const allItems = [
    ...(Array.isArray(model.pdfTextEvidence) ? model.pdfTextEvidence : []),
    ...(Array.isArray(model.ocrEvidence?.candidates) ? model.ocrEvidence.candidates : []),
    ...(Array.isArray(model.ocrEvidence?.words) ? model.ocrEvidence.words : []),
    ...(Array.isArray(model.ocrEvidence?.lines) ? model.ocrEvidence.lines : []),
    ...(Array.isArray(model.ocrEvidence?.blocks) ? model.ocrEvidence.blocks : []),
    ...(Array.isArray(model.visualEvidence?.regions) ? model.visualEvidence.regions : []),
    ...(Array.isArray(model.visualEvidence?.imageCandidates) ? model.visualEvidence.imageCandidates : []),
    ...(Array.isArray(model.visualEvidence?.graphicCandidates) ? model.visualEvidence.graphicCandidates : [])
  ];
  const idCounts = countIds(allItems);
  Object.entries(idCounts).filter(([, count]) => count > 1).forEach(([id]) => {
    issues.push({ code: "duplicate-id", id, message: `Duplicate source evidence id: ${id}` });
  });
  allItems.forEach(item => {
    if (!item?.id) issues.push({ code: "missing-id", message: "Source evidence item is missing an id." });
    if ("confidence" in item && !validConfidence(item.confidence)) {
      issues.push({ code: "invalid-confidence", id: item.id, message: `Invalid confidence on ${item.id}.` });
    }
    if ("bbox" in item && item.bbox && !validSourceEvidenceBBox(item.bbox)) {
      issues.push({ code: "invalid-bbox", id: item.id, message: `Invalid source evidence bbox on ${item.id}.` });
    }
    if (item.kind && !item.source && !String(item.kind).includes("candidate")) {
      issues.push({ code: "missing-source", id: item.id, message: `Missing source provenance on ${item.id}.` });
    }
  });
  const lineIds = new Set((model.ocrEvidence?.lines || []).map(line => line.id));
  const blockIds = new Set((model.ocrEvidence?.blocks || []).map(block => block.id));
  (model.ocrEvidence?.words || []).forEach(word => {
    if (word.lineId && !lineIds.has(word.lineId)) issues.push({ code: "missing-line-reference", id: word.id, message: `OCR word ${word.id} references missing line ${word.lineId}.` });
    if (word.blockId && !blockIds.has(word.blockId)) issues.push({ code: "missing-block-reference", id: word.id, message: `OCR word ${word.id} references missing block ${word.blockId}.` });
  });
  (model.ocrEvidence?.lines || []).forEach(line => {
    if (line.blockId && !blockIds.has(line.blockId)) issues.push({ code: "missing-block-reference", id: line.id, message: `OCR line ${line.id} references missing block ${line.blockId}.` });
  });
  const confidence = Math.max(0, 1 - issues.length / Math.max(6, allItems.length || 1));
  return { valid: issues.length === 0, confidence, issues };
}

export function validateNationalTestSemanticPageModel(model, sourceEvidence = null) {
  const issues = [];
  if (!model || typeof model !== "object") {
    return { valid: false, confidence: 0, issues: [{ code: "invalid-model", message: "SemanticPageModel is not an object." }] };
  }
  if (model.schemaVersion !== SEMANTIC_PAGE_SCHEMA_VERSION) {
    issues.push({ code: "schema-version", message: `Expected ${SEMANTIC_PAGE_SCHEMA_VERSION}.` });
  }
  const elements = Array.isArray(model.elements) ? model.elements : [];
  const relationships = Array.isArray(model.relationships) ? model.relationships : [];
  const readingOrder = Array.isArray(model.readingOrder) ? model.readingOrder : [];
  const elementIds = new Set(elements.map(element => element.id));
  const sourceIds = sourceEvidence ? sourceEvidenceIdSet(sourceEvidence) : null;
  const idCounts = countIds(elements);
  Object.entries(idCounts).filter(([, count]) => count > 1).forEach(([id]) => {
    issues.push({ code: "duplicate-semantic-id", id, message: `Duplicate semantic element id: ${id}` });
  });
  elements.forEach(element => {
    if (!element?.id) issues.push({ code: "missing-semantic-id", message: "Semantic element is missing an id." });
    if (!SUPPORTED_SEMANTIC_TYPES.has(element.type)) issues.push({ code: "unsupported-semantic-type", id: element.id, message: `Unsupported semantic type: ${element.type}` });
    if (!validConfidence(element.confidence)) issues.push({ code: "invalid-confidence", id: element.id, message: `Invalid confidence on ${element.id}.` });
    if (semanticElementHasFinalCoordinates(element)) {
      issues.push({ code: "final-coordinate-leak", id: element.id, message: `Semantic element ${element.id} contains render/source coordinate fields.` });
    }
    (Array.isArray(element.sourceEvidenceIds) ? element.sourceEvidenceIds : []).forEach(sourceId => {
      if (sourceIds && !sourceIds.has(sourceId)) issues.push({ code: "missing-source-evidence", id: element.id, sourceId, message: `Semantic element ${element.id} references missing source evidence ${sourceId}.` });
    });
  });
  relationships.forEach(relationship => {
    if (!SUPPORTED_RELATIONSHIP_TYPES.has(relationship.type)) issues.push({ code: "unsupported-relationship-type", id: relationship.id, message: `Unsupported relationship type: ${relationship.type}` });
    if (!elementIds.has(relationship.from)) issues.push({ code: "missing-relationship-from", id: relationship.id, message: `Relationship ${relationship.id} references missing from element ${relationship.from}.` });
    if (!elementIds.has(relationship.to)) issues.push({ code: "missing-relationship-to", id: relationship.id, message: `Relationship ${relationship.id} references missing to element ${relationship.to}.` });
    if (!validConfidence(relationship.confidence)) issues.push({ code: "invalid-confidence", id: relationship.id, message: `Invalid relationship confidence on ${relationship.id}.` });
    const from = elements.find(element => element.id === relationship.from);
    const to = elements.find(element => element.id === relationship.to);
    if (relationship.type === "optionOf" && to && to.type !== "question") issues.push({ code: "invalid-option-target", id: relationship.id, message: "optionOf must target a question." });
    if (relationship.type === "captionOf" && to && !["image", "illustration", "table"].includes(to.type)) issues.push({ code: "invalid-caption-target", id: relationship.id, message: "captionOf must target image, illustration, or table." });
    if (relationship.type === "answerAreaOf" && to && to.type !== "question") issues.push({ code: "invalid-answer-target", id: relationship.id, message: "answerAreaOf must target a question." });
    if (relationship.type === "columnOf" && to && !["column", "columnGroup"].includes(to.type)) issues.push({ code: "invalid-column-target", id: relationship.id, message: "columnOf must target a column or columnGroup." });
    if (relationship.type === "spansColumns" && to && to.type !== "columnGroup") issues.push({ code: "invalid-spans-target", id: relationship.id, message: "spansColumns must target a columnGroup." });
    if (relationship.type === "optionOf" && from && from.type !== "option") issues.push({ code: "invalid-option-source", id: relationship.id, message: "optionOf must start from an option." });
  });
  const readingOrderCounts = countStrings(readingOrder);
  Object.entries(readingOrderCounts).filter(([, count]) => count > 1).forEach(([id]) => {
    issues.push({ code: "duplicate-reading-order-id", id, message: `Duplicate reading order id: ${id}` });
  });
  readingOrder.forEach(id => {
    if (!elementIds.has(id)) issues.push({ code: "missing-reading-order-element", id, message: `Reading order references missing element ${id}.` });
  });
  const confidence = Math.max(0, 1 - issues.length / Math.max(8, elements.length + relationships.length || 1));
  return { valid: issues.length === 0, confidence, issues };
}

export function semanticPageContainsFinalCoordinates(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(semanticPageContainsFinalCoordinates);
  return Object.entries(value).some(([key, entry]) => (
    ["x", "y", "width", "height", "bbox", "sourceBox"].includes(key) ||
    semanticPageContainsFinalCoordinates(entry)
  ));
}

function nationalTestPageRef(page = {}) {
  return {
    testId: String(page?.testId || ""),
    pageId: String(page?.id || page?.pageId || ""),
    pageNumber: Number.isFinite(Number(page?.pageNumber)) ? Number(page.pageNumber) : null
  };
}

function sourceEvidenceBBox(value) {
  if (!value || typeof value !== "object") return null;
  const x = finiteNumber(value.x, NaN);
  const y = finiteNumber(value.y, NaN);
  const width = finiteNumber(value.width, NaN);
  const height = finiteNumber(value.height, NaN);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const clampedX = Math.max(0, Math.min(1, x));
  const clampedY = Math.max(0, Math.min(1, y));
  return {
    x: roundRatio(clampedX),
    y: roundRatio(clampedY),
    width: roundRatio(Math.max(0.0001, Math.min(1 - clampedX, width))),
    height: roundRatio(Math.max(0.0001, Math.min(1 - clampedY, height))),
    coordinateSpace: SOURCE_BBOX_COORDINATE_SPACE
  };
}

function validSourceEvidenceBBox(bbox) {
  return Boolean(bbox && typeof bbox === "object" &&
    bbox.coordinateSpace === SOURCE_BBOX_COORDINATE_SPACE &&
    Number.isFinite(Number(bbox.x)) &&
    Number.isFinite(Number(bbox.y)) &&
    Number.isFinite(Number(bbox.width)) &&
    Number.isFinite(Number(bbox.height)) &&
    Number(bbox.x) >= 0 &&
    Number(bbox.y) >= 0 &&
    Number(bbox.width) > 0 &&
    Number(bbox.height) > 0 &&
    Number(bbox.x) + Number(bbox.width) <= 1.0001 &&
    Number(bbox.y) + Number(bbox.height) <= 1.0001);
}

function stableEvidenceId(prefix, index, ...parts) {
  return `${prefix}-${String(index + 1).padStart(4, "0")}-${stableHash(parts)}`;
}

function stableSemanticId(type, ...parts) {
  const slug = stableTextId(parts.find(part => typeof part === "string" && part) || type);
  return `${type}-${slug}-${stableHash(parts)}`.replace(/-+/g, "-").replace(/-$/g, "");
}

function semanticIdForExtractionItem(item, type, index, counters, currentQuestionStack) {
  counters[type] = (counters[type] || 0) + 1;
  const text = String(item.text || "").trim();
  const questionNumber = type === "question" ? text.match(/^\s*(\d{1,3})\b/u)?.[1] : null;
  if (type === "question") return questionNumber ? `question-${questionNumber}` : stableSemanticId("question", item.id || text, counters[type]);
  if (type === "option") {
    const optionLetter = text.match(/^\s*\(?([A-D])\)?(?:[.)\s:-]|$)/iu)?.[1]?.toLowerCase();
    const currentQuestion = currentQuestionStack[currentQuestionStack.length - 1];
    const questionKey = currentQuestion?.id?.replace(/^question-/, "") || "unknown";
    return optionLetter ? `option-${questionKey}-${optionLetter}` : stableSemanticId("option", questionKey, item.id || text, counters[type]);
  }
  if (type === "title") return counters[type] === 1 ? "title-1" : `title-${counters[type]}`;
  if (type === "instructions") return counters[type] === 1 ? "instructions-1" : `instructions-${counters[type]}`;
  if (type === "footer") return counters[type] === 1 ? "footer-1" : `footer-${counters[type]}`;
  if (type === "caption") return stableSemanticId("caption", item.id || text, counters[type]);
  return stableSemanticId(type, item.id || text, index + 1);
}

function stableTextId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "unnamed";
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

function normalizedConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const normalized = number > 1 ? number / 100 : number;
  return Math.max(0, Math.min(1, Math.round(normalized * 1000) / 1000));
}

function validConfidence(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundRatio(value) {
  return Math.round(Number(value) * 1000000) / 1000000;
}

function clonePlainObject(value) {
  if (!value || typeof value !== "object") return value ?? null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function normalizeStringArray(value) {
  return (Array.isArray(value) ? value : [])
    .map(item => String(item || "").trim())
    .filter(Boolean);
}

function uniqueStrings(value) {
  return [...new Set(normalizeStringArray(value))];
}

function countIds(items) {
  return (Array.isArray(items) ? items : []).reduce((counts, item) => {
    const id = String(item?.id || "");
    if (!id) return counts;
    counts[id] = (counts[id] || 0) + 1;
    return counts;
  }, {});
}

function countStrings(items) {
  return (Array.isArray(items) ? items : []).reduce((counts, item) => {
    const id = String(item || "");
    if (!id) return counts;
    counts[id] = (counts[id] || 0) + 1;
    return counts;
  }, {});
}

function sourceEvidenceIdSet(sourceEvidence) {
  return new Set([
    ...(sourceEvidence?.pdfTextEvidence || []),
    ...(sourceEvidence?.ocrEvidence?.candidates || []),
    ...(sourceEvidence?.ocrEvidence?.words || []),
    ...(sourceEvidence?.ocrEvidence?.lines || []),
    ...(sourceEvidence?.ocrEvidence?.blocks || []),
    ...(sourceEvidence?.visualEvidence?.regions || []),
    ...(sourceEvidence?.visualEvidence?.imageCandidates || []),
    ...(sourceEvidence?.visualEvidence?.graphicCandidates || [])
  ].map(item => item.id).filter(Boolean));
}

function matchingExtractionItemId(observation, items) {
  const text = String(observation?.text || "").trim();
  if (!text) return "";
  const normalizedText = text.replace(/\s+/g, " ").toLowerCase();
  const match = items.find(item => String(item?.text || "").replace(/\s+/g, " ").toLowerCase() === normalizedText);
  return match?.id || "";
}

function sourceEvidenceBlockIdForItem(sourceItemId, blocks) {
  return blocks.find(block => stableTextId(block.sourceItemId) === stableTextId(sourceItemId))?.id || "";
}

function sourceEvidenceLineIdForItem(sourceItemId, lines) {
  return lines.find(line => stableTextId(line.sourceItemId) === stableTextId(sourceItemId))?.id || "";
}

function sourceEvidenceIdsForItem(item, sourceEvidenceIdsByItem) {
  const key = stableTextId(item?.id || "");
  return uniqueStrings(sourceEvidenceIdsByItem[key] || []);
}

function semanticTypeForExtractionItem(item) {
  const role = String(item?.role || "").toLowerCase();
  const text = String(item?.text || "").trim();
  if (role === "title") return "title";
  if (role === "heading") return "heading";
  if (role === "subheading") return "subheading";
  if (role === "instructions") return "instructions";
  if (role === "question") return "question";
  if (role === "option") return "option";
  if (role === "caption") return "caption";
  if (role === "footer") return "footer";
  if (/^\s*(?:\(?[A-D]\)?|[A-D]\s*[.:)-])\s+\p{L}/iu.test(text)) return "option";
  if (/^\s*\d{1,3}\s*[.)-]\s+\p{L}/u.test(text) || /\?\s*$/.test(text)) return "question";
  return "paragraph";
}

function hierarchyLevelForSemanticType(type) {
  if (type === "title") return 1;
  if (type === "heading") return 2;
  if (type === "subheading") return 3;
  if (type === "question") return 3;
  if (type === "option" || type === "answerGap" || type === "answerLine") return 4;
  if (type === "footer" || type === "pageNumber") return 5;
  return 3;
}

function semanticBandForBbox(bbox, type = "") {
  const y = Number(bbox?.y ?? 0.5);
  if (["title", "heading", "subheading", "instructions"].includes(type)) return "header";
  if (type === "separator" && y < 0.12) return "header";
  if (type === "footer" || type === "pageNumber" || y > 0.88) return "footer";
  return "body";
}

function semanticProminenceForItem(item, type) {
  if (type === "title") return "highest";
  if (type === "heading" || type === "question") return "high";
  if (type === "instructions" || type === "subheading") return "medium";
  if (type === "footer" || type === "caption") return "low";
  const text = String(item?.text || "");
  if (text.length < 60 && /^[A-Z][\p{L}\s:.-]+$/u.test(text)) return "medium";
  return "normal";
}

function semanticAlignmentForItem(item, bbox) {
  const text = String(item?.text || "").trim();
  if (Number(bbox?.width || 0) > 0.7 && text.length < 80) return "center";
  return "left";
}

function semanticRelativeWidthForBbox(bbox, columnModel) {
  const width = Number(bbox?.width || 0);
  if (width >= 0.68) return "wide";
  if (columnModel.columns.length > 1 && width <= 0.42) return "column";
  if (width <= 0.18) return "short";
  return "normal";
}

function semanticRelativeHeightForBbox(bbox) {
  const height = Number(bbox?.height || 0);
  if (height >= 0.24) return "tall";
  if (height <= 0.018) return "thin";
  if (height <= 0.04) return "short";
  return "normal";
}

function semanticItemSpansColumns(item, columnModel) {
  if (columnModel.columns.length < 2) return false;
  const bbox = sourceEvidenceBBox(item?.bbox);
  if (!bbox) return false;
  if (["title", "heading", "instructions"].includes(String(item?.role || "")) && Number(bbox.width) > 0.45) return true;
  return Number(bbox.width) > 0.62 ||
    (Number(bbox.width) > 0.48 &&
      Number(bbox.x) < columnModel.threshold - 0.08 &&
      Number(bbox.x) + Number(bbox.width) > columnModel.threshold + 0.08);
}

function semanticColumnRoleForItem(item, columnModel) {
  return semanticColumnRoleForBbox(item?.bbox, columnModel);
}

function semanticColumnRoleForBbox(bboxInput, columnModel) {
  const bbox = sourceEvidenceBBox(bboxInput);
  if (!bbox || columnModel.columns.length < 2) return "single";
  const center = Number(bbox.x) + Number(bbox.width) / 2;
  if (Number(bbox.width) > 0.62) return "span";
  return center < columnModel.threshold ? "left" : "right";
}

function inferSemanticColumns(items) {
  const bodyItems = items.filter(item => {
    const type = semanticTypeForExtractionItem(item);
    const bbox = sourceEvidenceBBox(item?.bbox);
    return bbox && !["footer", "title", "instructions", "caption"].includes(type);
  });
  if (bodyItems.length < 2) return { columns: [{ role: "single", items: bodyItems, bbox: combinedItemBbox(bodyItems) }], threshold: 0.5, confidence: 0.68 };
  const starts = bodyItems.map(item => Number(item.bbox?.x || 0)).sort((left, right) => left - right);
  const gaps = starts.slice(1).map((value, index) => ({ gap: value - starts[index], threshold: (value + starts[index]) / 2 }));
  const split = gaps.reduce((best, entry) => entry.gap > best.gap ? entry : best, { gap: 0, threshold: 0.5 });
  if (split.gap <= 0.11) return { columns: [{ role: "single", items: bodyItems, bbox: combinedItemBbox(bodyItems) }], threshold: 0.5, confidence: 0.7 };
  const left = bodyItems.filter(item => Number(item.bbox?.x || 0) < split.threshold);
  const right = bodyItems.filter(item => Number(item.bbox?.x || 0) >= split.threshold);
  if (!left.length || !right.length) return { columns: [{ role: "single", items: bodyItems, bbox: combinedItemBbox(bodyItems) }], threshold: 0.5, confidence: 0.62 };
  return {
    columns: [
      { role: "left", items: left, bbox: combinedItemBbox(left) },
      { role: "right", items: right, bbox: combinedItemBbox(right) }
    ],
    threshold: split.threshold,
    confidence: Math.min(0.96, 0.72 + split.gap)
  };
}

function combinedItemBbox(items) {
  return items.map(item => sourceEvidenceBBox(item?.bbox)).filter(Boolean).reduce(combineSourceBbox, null);
}

function combineSourceBbox(left, right) {
  if (!left) return right;
  if (!right) return left;
  const x = Math.min(Number(left.x), Number(right.x));
  const y = Math.min(Number(left.y), Number(right.y));
  const rightEdge = Math.max(Number(left.x) + Number(left.width), Number(right.x) + Number(right.width));
  const bottom = Math.max(Number(left.y) + Number(left.height), Number(right.y) + Number(right.height));
  return sourceEvidenceBBox({ x, y, width: rightEdge - x, height: bottom - y });
}

function semanticAnswerGapsForItem(item) {
  const text = String(item?.text || "");
  const gaps = [];
  (Array.isArray(item?.gaps) ? item.gaps : []).forEach((gap, index) => {
    const width = Number(gap?.width || 0);
    gaps.push({
      kind: "ocr-detected-gap",
      text: "",
      confidence: 0.76,
      widthHint: width > 0.28 ? "wide" : width > 0.14 ? "normal" : "short",
      index
    });
  });
  [...text.matchAll(/_{3,}|\.{4,}|-{4,}|\(\s*\)|\[\s*\]/gu)].forEach((match, index) => {
    gaps.push({
      kind: "textual-blank",
      text: match[0],
      confidence: 0.9,
      widthHint: match[0].length >= 8 ? "wide" : "normal",
      index
    });
  });
  return gaps.slice(0, 12);
}

function nearestQuestionForOption(items, optionIndex, elementBySourceItem, currentQuestionStack) {
  for (let index = optionIndex - 1; index >= 0; index -= 1) {
    if (semanticTypeForExtractionItem(items[index]) === "question") {
      const id = elementBySourceItem.get(stableTextId(items[index].id));
      if (id) return { id };
    }
  }
  return currentQuestionStack[currentQuestionStack.length - 1] || null;
}

function buildSemanticParagraphGroups(elements, elementGeometry, columnElements, columnModel) {
  const paragraphElements = elements.filter(element => element.type === "paragraph");
  if (!paragraphElements.length) return [];
  const groupsByColumn = new Map();
  paragraphElements.forEach(element => {
    const columnRole = element.layoutIntent?.spansColumns ? "span" : (element.layoutIntent?.columnRole || "single");
    if (!groupsByColumn.has(columnRole)) groupsByColumn.set(columnRole, []);
    groupsByColumn.get(columnRole).push(element);
  });
  const groups = [];
  groupsByColumn.forEach((columnElementsForRole, columnRole) => {
    const sorted = [...columnElementsForRole].sort((left, right) => compareGeometryReadingOrder(left, right, elementGeometry, columnModel));
    if (!sorted.length) return;
    const bbox = sorted.map(element => elementGeometry.get(element.id)).filter(Boolean).reduce(combineSourceBbox, null);
    groups.push({
      id: stableSemanticId("paragraph-group", columnRole, sorted.map(element => element.id).join("|")),
      role: columnRole === "span" ? "spanning-paragraphs" : `${columnRole}-paragraphs`,
      columnRole,
      spansColumns: columnRole === "span",
      elements: sorted,
      sourceEvidenceIds: uniqueStrings(sorted.flatMap(element => element.sourceEvidenceIds)),
      geometry: bbox,
      confidence: sorted.length > 1 ? 0.86 : 0.72
    });
  });
  return groups;
}

function nearestTextualAnchor(imageElement, elements, elementGeometry) {
  const imageBox = elementGeometry.get(imageElement.id);
  if (!imageBox) return null;
  const candidates = elements.filter(element => ["paragraphGroup", "paragraph", "section", "question"].includes(element.type));
  if (!candidates.length) return null;
  return candidates.map(element => {
    const box = elementGeometry.get(element.id);
    if (!box) return { element, distance: 999 };
    const imageCenterY = Number(imageBox.y) + Number(imageBox.height) / 2;
    const boxCenterY = Number(box.y) + Number(box.height) / 2;
    const imageCenterX = Number(imageBox.x) + Number(imageBox.width) / 2;
    const boxCenterX = Number(box.x) + Number(box.width) / 2;
    return { element, distance: Math.abs(imageCenterY - boxCenterY) + Math.abs(imageCenterX - boxCenterX) * 0.4 };
  }).sort((left, right) => left.distance - right.distance)[0]?.element || null;
}

function nearestImageForCaption(caption, images, elementGeometry) {
  if (!images.length) return null;
  const captionBox = elementGeometry.get(caption.id);
  if (!captionBox) return images[images.length - 1] || null;
  return images.map(image => {
    const imageBox = elementGeometry.get(image.id);
    if (!imageBox) return { image, distance: 999 };
    return { image, distance: Math.abs(Number(captionBox.y) - (Number(imageBox.y) + Number(imageBox.height))) };
  }).sort((left, right) => left.distance - right.distance)[0]?.image || null;
}

function addFooterPageNumberElements({ elements, addElement, addRelationship, page, sourceEvidenceIdsByItem, items, elementGeometry }) {
  const footerItems = items.filter(item => semanticTypeForExtractionItem(item) === "footer");
  const footerElements = elements.filter(element => element.type === "footer");
  footerItems.forEach((item, index) => {
    const text = String(item.text || "");
    const pageNumberMatch = text.match(/(?:^|\s)(\d{1,3})(?:\s|$)/u);
    if (!pageNumberMatch && !page?.pageNumber) return;
    const parent = footerElements[index] || footerElements[0];
    const pageNumberText = pageNumberMatch?.[1] || String(page.pageNumber);
    const pageNumber = addElement({
      id: stableSemanticId("page-number", pageNumberText, item.id || index),
      type: "pageNumber",
      text: pageNumberText,
      sourceEvidenceIds: sourceEvidenceIdsForItem(item, sourceEvidenceIdsByItem),
      confidence: pageNumberMatch ? 0.88 : 0.58,
      semanticRole: "printed-page-number",
      hierarchyLevel: 5,
      layoutIntent: {
        band: "footer",
        columnRole: "single",
        spansColumns: false,
        relativeWidth: "short",
        relativeHeight: "thin",
        prominence: "low",
        alignment: "left",
        preserveAspectRatio: false
      },
      geometry: sourceEvidenceBBox(item.bbox)
    });
    if (parent) {
      elementGeometry.set(pageNumber.id, elementGeometry.get(parent.id));
      addRelationship("belongsTo", pageNumber.id, parent.id, 0.82, "page number is part of footer");
    }
  });
}

function inferSemanticReadingOrder(elements, elementGeometry, relationships, columnModel) {
  const readTypes = new Set(["title", "heading", "subheading", "instructions", "paragraph", "question", "option", "answerGap", "answerLine", "image", "illustration", "caption", "footer", "pageNumber", "separator"]);
  const candidates = elements.filter(element => readTypes.has(element.type));
  const headers = candidates.filter(element => element.layoutIntent?.band === "header");
  const footers = candidates.filter(element => element.layoutIntent?.band === "footer");
  const body = candidates.filter(element => element.layoutIntent?.band !== "header" && element.layoutIntent?.band !== "footer");
  const sortedHeaders = headers.sort((left, right) => compareGeometryReadingOrder(left, right, elementGeometry, columnModel));
  const sortedFooters = footers.sort((left, right) => compareGeometryReadingOrder(left, right, elementGeometry, columnModel));
  let sortedBody;
  if (columnModel.columns.length > 1) {
    const spanning = body.filter(element => element.layoutIntent?.spansColumns || element.layoutIntent?.columnRole === "span");
    const left = body.filter(element => element.layoutIntent?.columnRole === "left" && !spanning.includes(element));
    const right = body.filter(element => element.layoutIntent?.columnRole === "right" && !spanning.includes(element));
    const single = body.filter(element => !["left", "right", "span"].includes(element.layoutIntent?.columnRole || ""));
    sortedBody = [
      ...spanning.sort((leftElement, rightElement) => compareGeometryReadingOrder(leftElement, rightElement, elementGeometry, columnModel)),
      ...left.sort((leftElement, rightElement) => compareGeometryReadingOrder(leftElement, rightElement, elementGeometry, columnModel)),
      ...right.sort((leftElement, rightElement) => compareGeometryReadingOrder(leftElement, rightElement, elementGeometry, columnModel)),
      ...single.sort((leftElement, rightElement) => compareGeometryReadingOrder(leftElement, rightElement, elementGeometry, columnModel))
    ];
  } else {
    sortedBody = body.sort((left, right) => compareGeometryReadingOrder(left, right, elementGeometry, columnModel));
  }
  return uniqueStrings([...sortedHeaders, ...sortedBody, ...sortedFooters].map(element => element.id));
}

function compareGeometryReadingOrder(left, right, elementGeometry, columnModel) {
  const leftBox = elementGeometry.get(left.id);
  const rightBox = elementGeometry.get(right.id);
  if (!leftBox && !rightBox) return String(left.id).localeCompare(String(right.id));
  if (!leftBox) return 1;
  if (!rightBox) return -1;
  if (columnModel.columns.length > 1) {
    const leftColumn = left.layoutIntent?.columnRole === "right" ? 1 : 0;
    const rightColumn = right.layoutIntent?.columnRole === "right" ? 1 : 0;
    if (leftColumn !== rightColumn && !left.layoutIntent?.spansColumns && !right.layoutIntent?.spansColumns) return leftColumn - rightColumn;
  }
  const yDiff = Number(leftBox.y) - Number(rightBox.y);
  if (Math.abs(yDiff) > 0.012) return yDiff;
  return Number(leftBox.x) - Number(rightBox.x);
}

function inferredSemanticPageType(elements, sourceImages) {
  if (elements.some(element => element.type === "question")) return "questions";
  if (elements.some(element => element.type === "answerGap" || element.type === "answerLine")) return "fill-blanks";
  if ((sourceImages || []).length) return "mixed";
  return "article";
}

function semanticModelConfidence(elements, relationships, sourceEvidence) {
  const elementConfidence = elements.length
    ? elements.reduce((sum, element) => sum + normalizedConfidence(element.confidence), 0) / elements.length
    : 0.5;
  const sourceValidation = sourceEvidence ? validateNationalTestSourceEvidenceModel(sourceEvidence) : { confidence: 0.7 };
  const relationshipFactor = relationships.length ? 0.08 : 0;
  return Math.max(0, Math.min(1, Math.round((elementConfidence * 0.62 + sourceValidation.confidence * 0.3 + relationshipFactor) * 1000) / 1000));
}

function uniqueSemanticElementId(id, elements) {
  const base = stableTextId(id || "semantic-element");
  if (!elements.some(element => element.id === base)) return base;
  let index = 2;
  while (elements.some(element => element.id === `${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function semanticElementHasFinalCoordinates(element) {
  if (!element || typeof element !== "object") return false;
  return ["x", "y", "width", "height", "bbox", "sourceBox"].some(key => Object.prototype.hasOwnProperty.call(element, key));
}
