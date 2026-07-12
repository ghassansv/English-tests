const PAGE_LAYOUT_TYPES = new Set(["text", "box", "rectangle", "line", "image", "circle", "group"]);
const TEXT_LAYOUT_TYPES = new Set(["text", "paragraph", "question", "option", "label", "caption", "heading", "title"]);
const RECTANGLE_LAYOUT_TYPES = new Set(["rectangle", "rect", "box", "shape", "checkbox"]);
const LINE_LAYOUT_TYPES = new Set(["line", "blank", "answer-line", "underline"]);
const BACKGROUND_TYPES = new Set(["rectangle", "box", "image"]);
const A4_PAGE_SIZE = { width: 794, height: 1123, unit: "px", format: "A4" };
const PAGE_SIZE_PRESETS = new Map([
  ["a4", A4_PAGE_SIZE],
  ["a4-portrait", A4_PAGE_SIZE],
  ["a4 portrait", A4_PAGE_SIZE],
  ["portrait-a4", A4_PAGE_SIZE]
]);
const PAGE_LAYOUT_FIT_MODES = new Set(["shrink", "clip", "overflow"]);

export function formatNationalTestTextValue(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map(formatNationalTestTextItem).filter(Boolean).join("\n");
  }
  if (value && typeof value === "object") {
    return formatNationalTestTextItem(value);
  }
  return "";
}

export function pageLayoutFromPageInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (input.pageLayout && input.pageLayout !== input) {
    const nestedLayout = pageLayoutFromPageInput(input.pageLayout);
    if (nestedLayout) return nestedLayout;
  }
  if (input?.pageSize && Array.isArray(input?.elements)) {
    const targetPageSize = normalizedVisualPageSize(input, input.elements);
    return {
      pageSize: targetPageSize || input.pageSize,
      sourcePageSize: visualPageSourceSizeFromInput(input, input.elements),
      defaults: input.defaults,
      elements: input.elements
    };
  }

  const elements = visualPageElementsFromInput(input);
  if (!elements.length) return null;

  const pageSize = visualPageSizeFromInput(input, elements);
  if (!pageSize) return null;

  return {
    pageSize,
    sourcePageSize: visualPageSourceSizeFromInput(input, elements),
    defaults: input.defaults,
    elements
  };
}

export function normalizeNationalTestPageLayout(layout, pageInput = null, options = {}) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) return null;

  const pageSize = normalizedVisualPageSize(layout, layout.elements);
  const createId = typeof options.createId === "function" ? options.createId : defaultCreateId;
  const defaultStyle = normalizePageLayoutStyle(layout.defaults);
  const sourcePageSize = visualPageSourceSizeFromInput(layout, layout.elements);
  const rawElements = Array.isArray(layout.elements)
    ? scaleVisualPageElementsToTarget(layout.elements, sourcePageSize, pageSize)
    : [];
  const elements = rawElements.length
    ? rawElements
      .map(element => normalizePageLayoutElement(element, createId, defaultStyle))
      .filter(Boolean)
      .filter(isRenderablePageLayoutElement)
    : [];
  const uniqueElements = removeDuplicatePageLayoutText(elements);
  const contentBounds = pageLayoutContentBounds(uniqueElements);
  const width = positiveNumber(pageSize?.width) || contentBounds.width;
  const height = positiveNumber(pageSize?.height) || contentBounds.height;
  if (!width || !height || !uniqueElements.length) return null;

  const normalizedLayout = fitLayoutToContent(
    reflowLikelySidewaysTextCardLayout(repairCollapsedTextLayout({
      pageSize: {
        width,
        height,
        unit: "px",
        ...(pageSize?.format ? { format: pageSize.format } : {})
      },
      elements: uniqueElements
    }, pageInput), pageInput)
  );

  return normalizedLayout;
}

export function displayLayoutForPage(page) {
  if (!page?.pageLayout) return null;
  const layout = normalizeNationalTestPageLayout(page.pageLayout, page) || page.pageLayout;
  if (!isLikelySidewaysTextCardLayout(layout, page)) return layout;
  return reflowLikelySidewaysTextCardLayout(layout, page);
}

export function shouldPreferPdfScanVisualFallback(page) {
  if (!page?.pageLayout?.elements?.length) return true;
  if (isLikelySidewaysTextCardPage(page)) return false;

  const layout = page.pageLayout;
  const blocks = extractedVisualBlocks(page);
  if (!blocks.length) return false;

  const layoutTextKey = normalizedTextKey(layoutTextValues(layout.elements).join("\n"));
  const missingBlocks = blocks.filter(block => {
    const blockKey = normalizedTextKey(block);
    return blockKey && !layoutTextKey.includes(blockKey);
  });
  if (!missingBlocks.length) return false;

  const shortMissingLines = missingBlocks
    .flatMap(block => block.split(/\r?\n/))
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => {
      const wordCount = line.split(/\s+/).filter(Boolean).length;
      return wordCount <= 4 && line.length <= 36;
    });

  const flattened = flattenedLayoutElements(layout.elements);
  const visibleElements = flattened.filter(element => {
    if (element.type !== "text") return true;
    return !isFooterLikeVisualText(element.text);
  });
  const contentBottom = visibleElements.reduce(
    (maxBottom, element) => Math.max(maxBottom, element.absBottom),
    0
  );
  const pageHeight = finiteNumber(layout.pageSize?.height);
  const gapToPageEnd = Math.max(0, pageHeight - contentBottom);
  const textCount = flattened.filter(element => element.type === "text").length;
  const sparseLayout = (layout.elements || []).length <= 8 || textCount <= 5;

  return sparseLayout && shortMissingLines.length >= 6 && gapToPageEnd > Math.max(260, pageHeight * 0.22);
}

export function layoutTextValues(elements = []) {
  const values = [];
  (Array.isArray(elements) ? elements : []).forEach(element => {
    if (!element || typeof element !== "object") return;
    if (element.type === "text") {
      const text = stringValue(element.text);
      if (text) values.push(text);
    }
    if (element.type === "group" && Array.isArray(element.elements)) {
      values.push(...layoutTextValues(element.elements));
    }
  });
  return values;
}

export function isLikelySidewaysTextCardPage(page) {
  return isLikelySidewaysTextCardLayout(page?.pageLayout, page);
}

function formatNationalTestTextItem(item, index = 0) {
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object") return "";
  const number = positiveInteger(item.number || item.gapNumber || item.itemNumber, index + 1);
  const text = stringValue(item.sentence || item.prompt || item.question || item.text || item.content);
  if (!text) return "";
  return number ? `${number}. ${text}` : text;
}

function visualPageElementsFromInput(input) {
  const elements = [
    ...(Array.isArray(input?.elements) ? input.elements : []),
    ...(Array.isArray(input?.page?.elements) ? input.page.elements : [])
  ];
  if (hasPositionedVisualText(elements)) return elements;

  const existingIds = new Set(elements.map(element => stringValue(element?.id)).filter(Boolean));

  visualPageBlockElements(input?.blocks || input?.page?.blocks).forEach(element => {
    const id = stringValue(element.id);
    if (id && existingIds.has(id)) return;
    elements.push(element);
    if (id) existingIds.add(id);
  });

  visualPageTextBlockElements(input?.textBlocks).forEach(element => {
    const id = stringValue(element.id);
    if (id && existingIds.has(id)) return;
    elements.push(element);
    if (id) existingIds.add(id);
  });

  return elements;
}

function visualPageBlockElements(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .map((block, index) => {
      if (!block || typeof block !== "object" || Array.isArray(block)) return null;
      const text = normalizePageLayoutTextValue(block);
      const type = stringValue(block.type || block.kind || block.role || "paragraph").toLowerCase();
      const elementType = TEXT_LAYOUT_TYPES.has(type) || type === "block" ? "paragraph" : type;
      return {
        ...block,
        id: stringValue(block.id || block.elementId) || `block_${index + 1}`,
        type: elementType,
        text,
        style: block.style || {}
      };
    })
    .filter(Boolean);
}

function hasPositionedVisualText(elements) {
  return (Array.isArray(elements) ? elements : []).some(element => {
    if (!element || typeof element !== "object") return false;
    if (stringValue(element.type).toLowerCase() === "group") {
      return hasPositionedVisualText(element.elements);
    }
    const type = normalizePageLayoutElementType(stringValue(element.type).toLowerCase());
    if (type !== "text") return false;
    const geometry = pageLayoutElementGeometry(element);
    return positiveNumber(geometry.width) &&
      positiveNumber(geometry.height) &&
      Boolean(normalizePageLayoutTextValue(element));
  });
}

function visualPageTextBlockElements(textBlocks) {
  const elements = [];
  (Array.isArray(textBlocks) ? textBlocks : []).forEach((block, blockIndex) => {
    const blockStyle = block?.style || {};
    (Array.isArray(block?.paragraphs) ? block.paragraphs : []).forEach((paragraph, paragraphIndex) => {
      elements.push({
        ...paragraph,
        id: stringValue(paragraph?.elementId || paragraph?.id) || `text_block_${blockIndex + 1}_paragraph_${paragraphIndex + 1}`,
        type: "paragraph",
        role: paragraph?.role || block?.type || "body-text",
        style: paragraph?.style || blockStyle
      });
    });
    (Array.isArray(block?.segments) ? block.segments : []).forEach((segment, segmentIndex) => {
      elements.push({
        ...segment,
        id: stringValue(segment?.elementId || segment?.id) || `text_block_${blockIndex + 1}_segment_${segmentIndex + 1}`,
        type: "paragraph",
        role: segment?.role || block?.type || "body-text",
        style: segment?.style || blockStyle
      });
    });
  });
  return elements;
}

function visualPageSizeFromInput(input, elements) {
  const normalized = normalizedVisualPageSize(input, elements);
  if (normalized) return normalized;

  const page = firstPlainObject(input?.page);
  const crop = firstPlainObject(page.crop);
  const sourceImage = firstPlainObject(input?.sourceImage);
  const contentBounds = rawPageLayoutContentBounds(elements);
  const width = positiveNumber(page.width) ||
    positiveNumber(crop.width) ||
    positiveNumber(sourceImage.width) ||
    contentBounds.width;
  const height = positiveNumber(page.height) ||
    positiveNumber(crop.height) ||
    positiveNumber(sourceImage.height) ||
    contentBounds.height;

  if (!width || !height) return null;
  return {
    width,
    height,
    unit: stringValue(page.unit || input?.document?.unit) || "px"
  };
}

function normalizedVisualPageSize(input, elements = []) {
  const preset = pageSizePresetFromInput(input);
  if (preset) return { ...preset };

  const pageSize = firstPlainObject(input?.pageSize, input?.page?.pageSize, input?.document?.pageSize);
  const width = positiveNumber(pageSize.width);
  const height = positiveNumber(pageSize.height);
  if (width && height) {
    return {
      width,
      height,
      unit: "px",
      ...(stringValue(pageSize.format) ? { format: stringValue(pageSize.format) } : {})
    };
  }

  const page = firstPlainObject(input?.page);
  const pageWidth = positiveNumber(page.width);
  const pageHeight = positiveNumber(page.height);
  if (pageWidth && pageHeight) {
    return {
      width: pageWidth,
      height: pageHeight,
      unit: "px",
      ...(pageSizeLooksLikeA4(pageWidth, pageHeight) ? { format: "A4" } : {})
    };
  }

  const contentBounds = rawPageLayoutContentBounds(elements);
  if (contentBounds.width && contentBounds.height && pageSizeLooksLikeA4(contentBounds.width, contentBounds.height)) {
    return { ...A4_PAGE_SIZE };
  }

  return null;
}

function pageSizePresetFromInput(input) {
  const candidates = [
    input?.pageSize,
    input?.page?.pageSize,
    input?.page?.size,
    input?.page?.format,
    input?.document?.pageSize,
    input?.document?.format
  ];
  for (const candidate of candidates) {
    const key = stringValue(typeof candidate === "object" ? candidate?.name || candidate?.format || candidate?.size : candidate)
      .toLocaleLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (PAGE_SIZE_PRESETS.has(key)) return PAGE_SIZE_PRESETS.get(key);
  }
  return null;
}

function pageSizeLooksLikeA4(width, height) {
  const ratio = width / height;
  const a4Ratio = A4_PAGE_SIZE.width / A4_PAGE_SIZE.height;
  return Math.abs(ratio - a4Ratio) <= 0.035 &&
    Math.abs(width - A4_PAGE_SIZE.width) <= 8 &&
    Math.abs(height - A4_PAGE_SIZE.height) <= 12;
}

function visualPageSourceSizeFromInput(input, elements = []) {
  const sourceSize = firstPlainObject(
    input?.sourcePageSize,
    input?.coordinateSystem,
    input?.document?.coordinateSystem,
    input?.page?.sourcePageSize,
    input?.page?.coordinateSystem
  );
  const sourceWidth = positiveNumber(sourceSize.width);
  const sourceHeight = positiveNumber(sourceSize.height);
  if (sourceWidth && sourceHeight) {
    return { width: sourceWidth, height: sourceHeight, unit: "px" };
  }

  const page = firstPlainObject(input?.page);
  const crop = firstPlainObject(page.crop);
  const sourceImage = firstPlainObject(input?.sourceImage);
  const pageWidth = positiveNumber(page.width) || positiveNumber(crop.width) || positiveNumber(sourceImage.width);
  const pageHeight = positiveNumber(page.height) || positiveNumber(crop.height) || positiveNumber(sourceImage.height);
  if (pageWidth && pageHeight) {
    return { width: pageWidth, height: pageHeight, unit: "px" };
  }

  return null;
}

function scaleVisualPageElementsToTarget(elements, sourcePageSize, targetPageSize) {
  const sourceWidth = positiveNumber(sourcePageSize?.width);
  const sourceHeight = positiveNumber(sourcePageSize?.height);
  const targetWidth = positiveNumber(targetPageSize?.width);
  const targetHeight = positiveNumber(targetPageSize?.height);
  if (!sourceWidth || !sourceHeight || !targetWidth || !targetHeight) return Array.isArray(elements) ? elements : [];

  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;
  if (Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001) return elements;

  return (Array.isArray(elements) ? elements : []).map(element => scaleVisualPageElement(element, scaleX, scaleY));
}

function scaleVisualPageElement(element, scaleX, scaleY) {
  if (!element || typeof element !== "object" || Array.isArray(element)) return element;
  const scaled = { ...element };
  if (element.x !== undefined) scaled.x = roundLayoutNumber(finiteNumber(element.x) * scaleX);
  if (element.y !== undefined) scaled.y = roundLayoutNumber(finiteNumber(element.y) * scaleY);
  if (element.width !== undefined) scaled.width = roundLayoutNumber(finiteNumber(element.width) * scaleX);
  if (element.height !== undefined) scaled.height = roundLayoutNumber(finiteNumber(element.height) * scaleY);
  if (Array.isArray(element.elements)) {
    scaled.elements = element.elements.map(child => scaleVisualPageElement(child, scaleX, scaleY));
  }
  return scaled;
}

function roundLayoutNumber(value) {
  return Math.round(value * 1000) / 1000;
}

function rawPageLayoutContentBounds(elements) {
  let width = 0;
  let height = 0;
  (Array.isArray(elements) ? elements : []).forEach(element => {
    const geometry = pageLayoutElementGeometry(element);
    width = Math.max(width, geometry.x + geometry.width);
    height = Math.max(height, geometry.y + geometry.height);
  });
  return {
    width: Math.ceil(width),
    height: Math.ceil(height)
  };
}

function normalizePageLayoutElement(element, createId, inheritedStyle = {}) {
  if (!element || typeof element !== "object" || Array.isArray(element)) return null;

  const sourceType = stringValue(element.type).toLowerCase();
  if (sourceType === "table") {
    return normalizePageLayoutTableElement(element, createId, inheritedStyle);
  }

  const type = normalizePageLayoutElementType(sourceType);
  if (!type) return null;

  const id = stringValue(element.id) || createId("layout");
  const rawStyle = { ...inheritedStyle, ...(element.style || {}) };
  const geometry = pageLayoutElementGeometry(element);
  const normalized = {
    id,
    type,
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    rotation: finiteNumber(element.rotation),
    zIndex: finiteNumber(element.zIndex),
    style: normalizePageLayoutStyle(rawStyle)
  };
  const role = stringValue(element.role || element.kind);
  const column = stringValue(element.column);
  const fitMode = normalizePageLayoutFitMode(element.fitMode || element.textFit || element.overflowMode);
  if (role) normalized.role = role;
  if (column) normalized.column = column;
  if (fitMode) normalized.fitMode = fitMode;
  if (element.minFontSize !== undefined) normalized.minFontSize = finiteNumber(element.minFontSize);
  if (Array.isArray(element.lines)) normalized.lines = element.lines.map(stringValue).filter(Boolean);

  if (type === "text") {
    normalized.text = normalizePageLayoutTextValue(element);
    normalized.style = normalizePageLayoutTextStyle(rawStyle);
    normalized.fitMode = fitMode || "shrink";
    if (normalized.minFontSize === undefined) {
      normalized.minFontSize = Math.max(7, Math.round(normalized.style.fontSize * 0.72));
    }
  }
  if (type === "image") {
    normalized.src = stringValue(element.src || element.source || element.url || element.href);
    normalized.preserveAspectRatio = stringValue(element.preserveAspectRatio);
  }
  if (type === "box" || type === "rectangle") {
    if (element.rx !== undefined) normalized.rx = finiteNumber(element.rx);
    if (element.ry !== undefined) normalized.ry = finiteNumber(element.ry);
  }
  if (type === "group") {
    normalized.elements = Array.isArray(element.elements)
      ? element.elements
        .map(child => normalizePageLayoutElement(child, createId, rawStyle))
        .filter(Boolean)
        .filter(isRenderablePageLayoutElement)
      : [];
  }
  if (sourceType === "blank") {
    if (normalized.height > 2) normalized.y += normalized.height;
    normalized.height = 0;
  }

  const shapeTextGroup = normalizePageLayoutShapeTextGroup(type, element, normalized);
  return shapeTextGroup || normalized;
}

function normalizePageLayoutElementType(type) {
  if (PAGE_LAYOUT_TYPES.has(type)) return type;
  if (TEXT_LAYOUT_TYPES.has(type)) return "text";
  if (RECTANGLE_LAYOUT_TYPES.has(type)) return type === "box" ? "box" : "rectangle";
  if (LINE_LAYOUT_TYPES.has(type)) return "line";
  return "";
}

function normalizePageLayoutTextValue(element) {
  if (Array.isArray(element.lines)) {
    const lines = element.lines.map(stringValue).filter(Boolean);
    if (lines.length) return lines.join("\n");
  }
  const text = stringValue(element.text || element.prompt || element.question || element.title || element.label);
  if (text) return text;
  if (Array.isArray(element.options)) {
    return element.options
      .map(option => [stringValue(option?.label), stringValue(option?.text)].filter(Boolean).join(" "))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function normalizePageLayoutFitMode(value) {
  const fitMode = stringValue(value).toLocaleLowerCase();
  if (fitMode === "visible") return "overflow";
  if (fitMode === "hidden") return "clip";
  return PAGE_LAYOUT_FIT_MODES.has(fitMode) ? fitMode : "";
}

function normalizePageLayoutShapeTextGroup(type, source, normalized) {
  if (!["box", "rectangle", "circle"].includes(type)) return null;

  const text = stringValue(source.text || source.label || source.content || source.caption || source.title);
  if (!text) return null;

  const fontSize = positiveNumber(source?.style?.fontSize) || 14;
  const padding = Math.max(6, Math.round(fontSize * (type === "circle" ? 0.7 : 0.55)));
  const textWidth = Math.max(0, normalized.width - padding * 2);
  const textHeight = Math.max(0, normalized.height - padding * 2);

  return {
    id: normalized.id,
    type: "group",
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    height: normalized.height,
    rotation: normalized.rotation,
    zIndex: normalized.zIndex,
    style: {},
    elements: [
      {
        ...normalized,
        id: `${normalized.id}__shape`,
        x: 0,
        y: 0,
        rotation: 0,
        zIndex: 0
      },
      {
        id: `${normalized.id}__text`,
        type: "text",
        x: padding,
        y: padding,
        width: textWidth,
        height: textHeight,
        rotation: 0,
        zIndex: 1,
        style: normalizePageLayoutShapeTextStyle(source.style),
        text
      }
    ]
  };
}

function normalizePageLayoutTableElement(source, createId, inheritedStyle = {}) {
  const geometry = pageLayoutElementGeometry(source);
  const rows = positiveInteger(source.rows);
  const columns = positiveInteger(source.columns);
  const style = normalizePageLayoutStyle({ ...inheritedStyle, ...(source.style || {}) });
  const id = stringValue(source.id) || createId("table");
  const elements = [
    {
      id: `${id}_outline`,
      type: "rectangle",
      x: 0,
      y: 0,
      width: geometry.width,
      height: geometry.height,
      rotation: 0,
      zIndex: 0,
      style
    }
  ];

  if (rows && geometry.height) {
    for (let row = 1; row < rows; row += 1) {
      elements.push({
        id: `${id}_row_${row}`,
        type: "line",
        x: 0,
        y: geometry.height * row / rows,
        width: geometry.width,
        height: 0,
        rotation: 0,
        zIndex: 1,
        style
      });
    }
  }

  if (columns && geometry.width) {
    for (let column = 1; column < columns; column += 1) {
      elements.push({
        id: `${id}_column_${column}`,
        type: "line",
        x: geometry.width * column / columns,
        y: 0,
        width: 0,
        height: geometry.height,
        rotation: 0,
        zIndex: 1,
        style
      });
    }
  }

  (Array.isArray(source.cells) ? source.cells : []).forEach((cell, index) => {
    const cellElement = normalizePageLayoutElement({
      ...cell,
      id: stringValue(cell.id) || `${id}_cell_${index + 1}`,
      type: cell.type || "text",
      style: cell.style || source.cellStyle || inheritedStyle
    }, createId, { ...inheritedStyle, ...(source.cellStyle || {}) });
    if (cellElement && isRenderablePageLayoutElement(cellElement)) elements.push(cellElement);
  });

  return {
    id,
    type: "group",
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    rotation: finiteNumber(source.rotation),
    zIndex: finiteNumber(source.zIndex),
    style: {},
    elements: elements.filter(isRenderablePageLayoutElement)
  };
}

function isRenderablePageLayoutElement(element) {
  if (!element || typeof element !== "object") return false;
  if (element.type === "group") return Array.isArray(element.elements) && element.elements.some(isRenderablePageLayoutElement);
  if (element.type === "text") return Boolean(stringValue(element.text)) && positiveNumber(element.width) && positiveNumber(element.height);
  if (element.type === "line") return Boolean(positiveNumber(element.width) || positiveNumber(element.height));
  return positiveNumber(element.width) && positiveNumber(element.height);
}

function removeDuplicatePageLayoutText(elements) {
  const source = Array.isArray(elements) ? elements : [];
  const siblingTexts = source.filter(element => element?.type === "text");
  const acceptedTexts = [];

  return source.reduce((unique, element) => {
    const normalized = element?.type === "group"
      ? { ...element, elements: removeDuplicatePageLayoutText(element.elements) }
      : element;

    if (normalized?.type !== "text") {
      unique.push(normalized);
      return unique;
    }

    const duplicate = acceptedTexts.some(existing => areDuplicateTextElements(existing, normalized)) ||
      isAggregateDuplicateTextElement(normalized, siblingTexts);
    if (!duplicate) {
      acceptedTexts.push(normalized);
      unique.push(normalized);
    }
    return unique;
  }, []);
}

function areDuplicateTextElements(first, second) {
  const firstKey = normalizedTextKey(first?.text);
  const secondKey = normalizedTextKey(second?.text);
  if (!firstKey || !secondKey) return false;

  const sameText = firstKey === secondKey;
  const nestedText = Math.min(firstKey.length, secondKey.length) >= 32 &&
    (firstKey.includes(secondKey) || secondKey.includes(firstKey));
  if (!sameText && !nestedText) return false;

  return textElementOverlap(first, second) >= 0.55;
}

function isAggregateDuplicateTextElement(candidate, siblings) {
  const candidateKey = normalizedTextKey(candidate?.text);
  if (candidateKey.length < 32) return false;

  let matches = 0;
  let matchedLength = 0;
  for (const sibling of siblings) {
    if (sibling === candidate) continue;
    const siblingKey = normalizedTextKey(sibling?.text);
    if (siblingKey.length < 8 || !candidateKey.includes(siblingKey)) continue;
    if (!textElementsShareVerticalSpace(candidate, sibling)) continue;
    matches += 1;
    matchedLength += siblingKey.length;
  }

  return matches >= 2 && matchedLength >= Math.min(60, Math.floor(candidateKey.length * 0.35));
}

function textElementsShareVerticalSpace(first, second) {
  const firstRect = textElementRect(first);
  const secondRect = textElementRect(second);
  const secondCenterY = secondRect.top + (secondRect.bottom - secondRect.top) / 2;
  const verticalPadding = Math.max(12, Math.min(48, (firstRect.bottom - firstRect.top) * 0.2));
  return secondCenterY >= firstRect.top - verticalPadding && secondCenterY <= firstRect.bottom + verticalPadding;
}

function textElementOverlap(first, second) {
  const firstRect = textElementRect(first);
  const secondRect = textElementRect(second);
  const overlapWidth = Math.max(0, Math.min(firstRect.right, secondRect.right) - Math.max(firstRect.left, secondRect.left));
  const overlapHeight = Math.max(0, Math.min(firstRect.bottom, secondRect.bottom) - Math.max(firstRect.top, secondRect.top));
  const overlapArea = overlapWidth * overlapHeight;
  const smallerArea = Math.min(firstRect.area, secondRect.area);
  return smallerArea ? overlapArea / smallerArea : 0;
}

function textElementRect(element) {
  const left = finiteNumber(element?.x);
  const top = finiteNumber(element?.y);
  const width = Math.max(0, finiteNumber(element?.width));
  const height = Math.max(0, finiteNumber(element?.height));
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    area: width * height
  };
}

function normalizePageLayoutShapeTextStyle(style) {
  const textStyle = normalizePageLayoutTextStyle(style);
  return {
    fontFamily: textStyle.fontFamily,
    fontSize: textStyle.fontSize,
    fontWeight: textStyle.fontWeight,
    fontStyle: textStyle.fontStyle,
    color: textStyle.color,
    lineHeight: textStyle.lineHeight,
    opacity: textStyle.opacity
  };
}

function pageLayoutElementGeometry(element) {
  const bounds = firstPlainObject(
    element.bounds,
    element.bound,
    element.bbox,
    element.rect,
    element.rectangle,
    element.frame,
    element.box
  );
  const position = firstPlainObject(element.position, element.pos, element.origin);
  const size = firstPlainObject(element.size, element.dimensions);
  const boxArray = firstNumberArray(element.bbox, element.bounds, element.rect, element.box);

  const x = firstFiniteValue(
    element.x,
    element.left,
    element.l,
    element.x0,
    element.xMin,
    position.x,
    position.left,
    bounds.x,
    bounds.left,
    bounds.x0,
    bounds.xMin,
    boxArray[0]
  ) ?? 0;
  const y = firstFiniteValue(
    element.y,
    element.top,
    element.t,
    element.y0,
    element.yMin,
    position.y,
    position.top,
    bounds.y,
    bounds.top,
    bounds.y0,
    bounds.yMin,
    boxArray[1]
  ) ?? 0;
  const right = firstFiniteValue(element.right, element.r, element.x1, element.xMax, bounds.right, bounds.x1, bounds.xMax);
  const bottom = firstFiniteValue(element.bottom, element.b, element.y1, element.yMax, bounds.bottom, bounds.y1, bounds.yMax);
  const width = firstPositiveValue(
    element.width,
    element.w,
    size.width,
    size.w,
    bounds.width,
    bounds.w,
    boxArray[2],
    right !== null ? right - x : undefined
  ) ?? 0;
  const height = firstPositiveValue(
    element.height,
    element.h,
    size.height,
    size.h,
    bounds.height,
    bounds.h,
    boxArray[3],
    bottom !== null ? bottom - y : undefined
  ) ?? 0;

  return { x, y, width, height };
}

function normalizePageLayoutTextStyle(style) {
  const normalized = normalizePageLayoutStyle(style);
  return {
    ...normalized,
    fontSize: positiveNumber(normalized.fontSize) || 16,
    fontWeight: normalized.fontWeight || "normal",
    fontStyle: normalized.fontStyle || "normal",
    color: normalized.color || "#222222",
    lineHeight: positiveNumber(normalized.lineHeight) || 1.2
  };
}

function normalizePageLayoutStyle(style) {
  if (!style || typeof style !== "object" || Array.isArray(style)) return {};

  const normalized = {};
  if (style.fontFamily !== undefined) {
    const fontFamily = stringValue(style.fontFamily);
    if (fontFamily && fontFamily.toLocaleLowerCase() !== "unknown") normalized.fontFamily = fontFamily;
  }
  ["fontStyle", "color", "direction"].forEach(key => {
    if (style[key] !== undefined) normalized[key] = stringValue(style[key]);
  });
  const backgroundColor = stringValue(style.backgroundColor || style.fillColor);
  if (backgroundColor) normalized.backgroundColor = backgroundColor;
  const fillColor = stringValue(style.fillColor || style.backgroundColor);
  if (fillColor) normalized.fillColor = fillColor;
  const strokeColor = stringValue(style.strokeColor || style.borderColor);
  if (strokeColor) normalized.strokeColor = strokeColor;
  if (style.fontWeight !== undefined) {
    normalized.fontWeight = typeof style.fontWeight === "number" ? finiteNumber(style.fontWeight) : stringValue(style.fontWeight);
  }
  ["fontSize", "lineHeight", "opacity"].forEach(key => {
    if (style[key] !== undefined) normalized[key] = finiteNumber(style[key]);
  });
  const strokeWidth = style.strokeWidth ?? style.borderWidth;
  if (strokeWidth !== undefined) normalized.strokeWidth = finiteNumber(strokeWidth);
  const textAlign = stringValue(style.textAlign);
  if (textAlign) normalized.textAlign = textAlign;
  return normalized;
}

function fitLayoutToContent(layout) {
  const contentBounds = pageLayoutContentBounds(layout.elements);
  return {
    pageSize: {
      ...layout.pageSize,
      width: Math.max(layout.pageSize.width, contentBounds.width),
      height: Math.max(layout.pageSize.height, contentBounds.height)
    },
    elements: layout.elements
  };
}

function repairCollapsedTextLayout(layout, pageInput) {
  if (!isCollapsedTextLayout(layout)) return layout;

  const repairedTextElements = collapsedTextLayoutElements(layout, pageInput);
  if (!repairedTextElements.length) return layout;

  const visibleNonTextElements = (Array.isArray(layout.elements) ? layout.elements : [])
    .filter(element => element?.type !== "text")
    .filter(element => positiveNumber(element.width) && positiveNumber(element.height));

  return {
    pageSize: layout.pageSize,
    elements: [
      ...visibleNonTextElements,
      ...repairedTextElements
    ]
  };
}

function isCollapsedTextLayout(layout) {
  const textElements = pageLayoutTextElements(layout?.elements);
  if (!textElements.length) return false;

  const textLength = textElements.reduce((sum, element) => sum + stringValue(element.text).length, 0);
  if (!textLength) return false;

  const collapsedCount = textElements.filter(element =>
    positiveNumber(element.width) < 8 || positiveNumber(element.height) < 8
  ).length;
  const originCount = textElements.filter(element =>
    Math.abs(finiteNumber(element.x)) <= 1 && Math.abs(finiteNumber(element.y)) <= 1
  ).length;

  return collapsedCount / textElements.length >= 0.5 && (
    originCount / textElements.length >= 0.5 ||
    collapsedCount === textElements.length
  );
}

function collapsedTextLayoutElements(layout, pageInput) {
  const blocks = collapsedTextBlocks(layout, pageInput);
  if (!blocks.length) return [];

  const pageWidth = positiveNumber(layout?.pageSize?.width, 800);
  const marginX = clampNumber(Math.round(pageWidth * 0.1), 36, 110);
  const marginTop = clampNumber(Math.round(positiveNumber(layout?.pageSize?.height, 1000) * 0.08), 40, 72);
  const contentWidth = Math.max(280, pageWidth - marginX * 2);
  const columnGap = clampNumber(Math.round(pageWidth * 0.04), 28, 44);
  const columnWidth = Math.max(220, Math.floor((contentWidth - columnGap) / 2));
  const canUseColumns = pageWidth >= 700 && blocks.length >= 4;
  const elements = [];
  let index = 0;
  let y = marginTop;

  if (isTitleLikeTextBlock(blocks[0])) {
    const element = repairedTextBlockElement(blocks[0], elements.length, marginX, y, contentWidth, "title");
    elements.push(element);
    y += element.height + 22;
    index = 1;
  }

  if (blocks[index] && isInstructionLikeTextBlock(blocks[index])) {
    const element = repairedTextBlockElement(blocks[index], elements.length, marginX, y, contentWidth, "instruction");
    elements.push(element);
    y += element.height + 26;
    index += 1;
  }

  const remaining = blocks.slice(index);
  if (canUseColumns && remaining.length >= 2) {
    let leftY = y;
    let rightY = y;
    let columnBlocks = remaining;

    if (remaining.length >= 3 && isLeadLikeTextBlock(remaining[0])) {
      const lead = repairedTextBlockElement(remaining[0], elements.length, marginX, leftY, columnWidth, "lead");
      elements.push(lead);
      leftY += lead.height + 22;
      columnBlocks = remaining.slice(1);
    }

    columnBlocks.forEach((block, blockIndex) => {
      const useLeft = columnBlocks.length === 2 ? blockIndex === 0 : leftY <= rightY;
      const x = useLeft ? marginX : marginX + columnWidth + columnGap;
      const elementY = useLeft ? leftY : rightY;
      const element = repairedTextBlockElement(block, elements.length, x, elementY, columnWidth, "body");
      elements.push(element);
      if (useLeft) {
        leftY += element.height + 18;
      } else {
        rightY += element.height + 18;
      }
    });
  } else {
    remaining.forEach(block => {
      const element = repairedTextBlockElement(block, elements.length, marginX, y, contentWidth, "body");
      elements.push(element);
      y += element.height + 18;
    });
  }

  return elements;
}

function collapsedTextBlocks(layout, pageInput) {
  const fromElements = pageLayoutTextElements(layout?.elements)
    .map((element, index) => ({
      id: stringValue(element.id) || `repaired_text_${index + 1}`,
      text: stringValue(element.text),
      style: normalizePageLayoutTextStyle(element.style)
    }))
    .filter(block => block.text);

  if (fromElements.length > 1) return fromElements;

  const sourceText = fromElements[0]?.text || formatNationalTestTextValue(
    pageInput?.extractedText || pageInput?.text || pageInput?.content
  );
  const paragraphs = sourceText
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean);

  if (paragraphs.length > 1) {
    return paragraphs.map((text, index) => ({
      id: fromElements[0]?.id && index === 0 ? fromElements[0].id : `repaired_text_${index + 1}`,
      text,
      style: fromElements[0]?.style || normalizePageLayoutTextStyle({})
    }));
  }

  return fromElements;
}

function pageLayoutTextElements(elements) {
  const texts = [];
  (Array.isArray(elements) ? elements : []).forEach(element => {
    if (!element || typeof element !== "object") return;
    if (element.type === "text") {
      texts.push(element);
    }
    if (element.type === "group" && Array.isArray(element.elements)) {
      texts.push(...pageLayoutTextElements(element.elements));
    }
  });
  return texts;
}

function repairedTextBlockElement(block, index, x, y, width, role) {
  const style = repairedTextStyle(block.style, role);
  const height = estimateLayoutTextHeight(block.text, width, style.fontSize, style.lineHeight);
  return {
    id: stringValue(block.id) || `repaired_text_${index + 1}`,
    type: "text",
    x,
    y,
    width,
    height,
    rotation: 0,
    zIndex: index + 1,
    style,
    text: block.text
  };
}

function repairedTextStyle(style, role) {
  const normalized = normalizePageLayoutTextStyle(style);
  const fontSize = positiveNumber(normalized.fontSize) || 16;
  const base = {
    ...normalized,
    fontSize: Math.max(15, fontSize),
    lineHeight: Math.max(1.2, positiveNumber(normalized.lineHeight) || 1.25)
  };

  if (role === "title") {
    return {
      ...base,
      fontSize: Math.max(26, Math.round(fontSize * 1.65)),
      fontWeight: "bold",
      lineHeight: 1.15
    };
  }

  if (role === "lead") {
    return {
      ...base,
      fontWeight: "bold"
    };
  }

  return base;
}

function isTitleLikeTextBlock(block) {
  const text = stringValue(block?.text);
  return Boolean(text) && text.length <= 100 && text.split(/\s+/).filter(Boolean).length <= 10;
}

function isInstructionLikeTextBlock(block) {
  const text = stringValue(block?.text);
  return /^(read|answer|listen|write|choose|mark|complete|use|look)\b/i.test(text) ||
    (text.length <= 280 && /\b(answer|question|following|alternative|mark|write)\b/i.test(text));
}

function isLeadLikeTextBlock(block) {
  const text = stringValue(block?.text);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return wordCount >= 6 && wordCount <= 32 && text.length <= 240;
}

function pageLayoutContentBounds(elements, offsetX = 0, offsetY = 0) {
  let width = 0;
  let height = 0;

  elements.forEach(element => {
    if (!element || typeof element !== "object") return;
    const x = offsetX + finiteNumber(element.x);
    const y = offsetY + finiteNumber(element.y);
    const right = x + Math.max(0, finiteNumber(element.width));
    const bottom = y + Math.max(0, finiteNumber(element.height));
    width = Math.max(width, right);
    height = Math.max(height, bottom);

    if (element.type === "group" && Array.isArray(element.elements) && element.elements.length) {
      const nested = pageLayoutContentBounds(element.elements, x, y);
      width = Math.max(width, nested.width);
      height = Math.max(height, nested.height);
    }
  });

  return {
    width: Math.ceil(width),
    height: Math.ceil(height)
  };
}

function reflowLikelySidewaysTextCardLayout(layout, pageInput) {
  if (!isLikelySidewaysTextCardLayout(layout, pageInput)) return layout;

  const background = largestPageLayoutBackground(layout.elements);
  const textFlow = sidewaysTextCardFlow(pageInput, layout);
  if (!background || !textFlow.title || !textFlow.body.length) return layout;

  const titleStyle = matchingTextStyle(layout.elements, element =>
    /title/i.test(stringValue(element?.id)) || normalizedTextKey(element?.text) === normalizedTextKey(textFlow.title)
  , {
    fontSize: 22,
    fontWeight: "bold",
    fontStyle: "normal",
    color: "#111111",
    lineHeight: 1.2
  });
  const bodyStyle = matchingTextStyle(layout.elements, element =>
    stringValue(element?.text).split(/\s+/).filter(Boolean).length > 18
  , {
    fontSize: 15,
    fontWeight: "normal",
    fontStyle: "normal",
    color: "#111111",
    lineHeight: 1.3
  });
  const introStyle = {
    ...bodyStyle,
    fontSize: Math.max(13, positiveNumber(bodyStyle.fontSize) ? positiveNumber(bodyStyle.fontSize) - 1 : 14),
    fontWeight: "normal"
  };
  const smallStyle = {
    ...bodyStyle,
    fontSize: 12,
    fontWeight: "normal",
    color: "#333333",
    lineHeight: 1.2
  };

  const cardWidth = Math.max(background.height, 620);
  const innerWidth = Math.max(360, cardWidth - 56);
  const titleHeight = estimateLayoutTextHeight(textFlow.title, innerWidth, titleStyle.fontSize, titleStyle.lineHeight);
  const introHeight = textFlow.intro
    ? estimateLayoutTextHeight(textFlow.intro, innerWidth, introStyle.fontSize, introStyle.lineHeight)
    : 0;
  const footerHeight = textFlow.footer
    ? estimateLayoutTextHeight(textFlow.footer, innerWidth, smallStyle.fontSize, smallStyle.lineHeight)
    : 0;
  const bodyHeights = textFlow.body.map(block =>
    estimateLayoutTextHeight(block, innerWidth, bodyStyle.fontSize, bodyStyle.lineHeight)
  );
  const bodyTotalHeight = bodyHeights.reduce((sum, item) => sum + item, 0);
  const bodyGap = textFlow.body.length > 1 ? (textFlow.body.length - 1) * 18 : 0;
  const cardHeight = Math.max(
    background.width,
    32 + titleHeight + 20 + bodyTotalHeight + bodyGap + (textFlow.footer ? 18 + footerHeight : 0) + 28
  );
  const pageWidth = Math.max(finiteNumber(layout.pageSize?.width), cardWidth + 120);
  const pageHeight = Math.max(finiteNumber(layout.pageSize?.height), cardHeight + 160 + (textFlow.intro ? introHeight + 28 : 0));
  const cardX = Math.max(40, Math.round((pageWidth - cardWidth) / 2));
  const cardY = textFlow.intro ? 80 + introHeight + 24 : Math.max(80, Math.round((pageHeight - cardHeight) / 2));

  const elements = [];

  if (textFlow.intro) {
    elements.push({
      id: "reflow_intro",
      type: "text",
      x: cardX,
      y: 80,
      width: cardWidth,
      height: introHeight,
      rotation: 0,
      zIndex: 1,
      style: introStyle,
      text: textFlow.intro
    });
  }

  elements.push({
    id: background.id || "reflow_card_background",
    type: background.type || "rectangle",
    x: cardX,
    y: cardY,
    width: cardWidth,
    height: cardHeight,
    rotation: 0,
    zIndex: 0,
    style: background.style || { backgroundColor: "#f5f1e2" }
  });

  let currentY = cardY + 28;
  elements.push({
    id: "reflow_card_title",
    type: "text",
    x: cardX + 28,
    y: currentY,
    width: innerWidth,
    height: titleHeight,
    rotation: 0,
    zIndex: 1,
    style: titleStyle,
    text: textFlow.title
  });
  currentY += titleHeight + 20;

  textFlow.body.forEach((block, index) => {
    const height = bodyHeights[index];
    elements.push({
      id: `reflow_body_${index + 1}`,
      type: "text",
      x: cardX + 28,
      y: currentY,
      width: innerWidth,
      height,
      rotation: 0,
      zIndex: 1,
      style: bodyStyle,
      text: block
    });
    currentY += height + 18;
  });

  if (textFlow.footer) {
    elements.push({
      id: "reflow_footer",
      type: "text",
      x: cardX + 28,
      y: currentY,
      width: innerWidth,
      height: footerHeight,
      rotation: 0,
      zIndex: 1,
      style: smallStyle,
      text: textFlow.footer
    });
  }

  return {
    pageSize: {
      width: pageWidth,
      height: pageHeight,
      unit: "px"
    },
    elements
  };
}

function isLikelySidewaysTextCardLayout(layout, pageInput) {
  const background = largestPageLayoutBackground(layout?.elements);
  if (!background || background.height < background.width * 1.35) return false;

  const textElements = Array.isArray(layout?.elements)
    ? layout.elements.filter(element =>
      element?.type === "text" &&
      !/camscanner/i.test(stringValue(element.text)) &&
      stringValue(element.text).split(/\s+/).filter(Boolean).length > 5
    )
    : [];
  const wideText = textElements.filter(element => positiveNumber(element.width) > background.width * 1.15);
  if (wideText.length < 2) return false;

  const ys = wideText.map(element => finiteNumber(element.y));
  const sameBand = Math.max(...ys) - Math.min(...ys) < Math.max(80, background.height * 0.12);
  const overhang = wideText.some(element =>
    finiteNumber(element.x) + positiveNumber(element.width) > background.x + background.width + 80
  );

  const textFlow = sidewaysTextCardFlow(pageInput, layout);
  return sameBand && overhang && Boolean(textFlow.title) && textFlow.body.length > 0;
}

function sidewaysTextCardFlow(pageInput, layout) {
  const blocks = sidewaysTextCardBlocks(pageInput, layout);
  const title = stringValue(pageInput?.title) || blocks.find(block => block.length <= 80) || "";
  const titleKey = normalizedTextKey(title);
  const remaining = blocks.filter(block => normalizedTextKey(block) !== titleKey);

  let intro = "";
  if (remaining[0] && /^(use|read|together|answer)\b/i.test(remaining[0])) {
    intro = remaining.shift();
  }

  let footer = "";
  const footerIndex = remaining.findIndex(block => isFooterLikeVisualText(block));
  if (footerIndex >= 0) {
    footer = remaining.splice(footerIndex, 1)[0];
  }

  return {
    title,
    intro,
    body: remaining.filter(Boolean),
    footer
  };
}

function sidewaysTextCardBlocks(pageInput, layout) {
  const extracted = formatNationalTestTextValue(
    pageInput?.extractedText || pageInput?.text || pageInput?.content
  )
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean);
  if (extracted.length) return extracted;

  return flattenedLayoutElements(layout?.elements)
    .filter(element =>
      element?.type === "text" &&
      !/camscanner/i.test(stringValue(element.text))
    )
    .sort((a, b) => finiteNumber(a.absX) - finiteNumber(b.absX) || finiteNumber(a.absY) - finiteNumber(b.absY))
    .map(element => stringValue(element.text))
    .filter(Boolean);
}

function largestPageLayoutBackground(elements) {
  return (Array.isArray(elements) ? elements : [])
    .filter(element =>
      BACKGROUND_TYPES.has(stringValue(element?.type).toLowerCase()) &&
      positiveNumber(element.width) &&
      positiveNumber(element.height)
    )
    .sort((a, b) => positiveNumber(b.width) * positiveNumber(b.height) - positiveNumber(a.width) * positiveNumber(a.height))[0] || null;
}

function matchingTextStyle(elements, predicate, fallback) {
  const match = (Array.isArray(elements) ? elements : []).find(element =>
    element?.type === "text" && predicate(element)
  );
  return match?.style ? normalizePageLayoutTextStyle(match.style) : normalizePageLayoutTextStyle(fallback);
}

function estimateLayoutTextHeight(text, width, fontSize, lineHeight) {
  const safeWidth = Math.max(120, positiveNumber(width) || 120);
  const safeFontSize = Math.max(10, positiveNumber(fontSize) || 14);
  const safeLineHeight = Math.max(1.1, positiveNumber(lineHeight) || 1.3);
  const charsPerLine = Math.max(12, Math.floor(safeWidth / (safeFontSize * 0.56)));
  const lines = String(text || "")
    .split(/\r?\n/)
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return Math.ceil(lines * safeFontSize * safeLineHeight + 6);
}

function extractedVisualBlocks(page) {
  return stringValue(page?.extractedText)
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean);
}

function flattenedLayoutElements(elements = [], offsetX = 0, offsetY = 0) {
  const flattened = [];
  (Array.isArray(elements) ? elements : []).forEach(element => {
    if (!element || typeof element !== "object") return;
    const x = offsetX + finiteNumber(element.x);
    const y = offsetY + finiteNumber(element.y);
    const width = Math.max(0, finiteNumber(element.width));
    const height = Math.max(0, finiteNumber(element.height));
    flattened.push({
      ...element,
      absX: x,
      absY: y,
      absBottom: y + height
    });
    if (element.type === "group" && Array.isArray(element.elements)) {
      flattened.push(...flattenedLayoutElements(element.elements, x, y));
    }
  });
  return flattened;
}

function isFooterLikeVisualText(text) {
  return /(?:scanned with|copyright|\u00a9|kursprov|delprov|camscanner|g.{1,4}teborgs universitet)/i.test(String(text || ""));
}

function normalizedTextKey(value) {
  return stringValue(value)
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .replace(/["'.,:;!?()\-\u2013\u2014\u2018\u2019\u201c\u201d]/g, "")
    .trim();
}

function firstPlainObject(...values) {
  return values.find(value => value && typeof value === "object" && !Array.isArray(value)) || {};
}

function firstNumberArray(...values) {
  return values.find(value =>
    Array.isArray(value) &&
    value.length >= 4 &&
    value.slice(0, 4).every(item => firstFiniteValue(item) !== null)
  ) || [];
}

function firstFiniteValue(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function firstPositiveValue(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value, fallback = 0) {
  const number = finiteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function defaultCreateId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
