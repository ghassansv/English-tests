const ELEMENT_TYPES = ["text", "image", "circle", "rectangle", "box", "line", "group"];
const STYLE_PROPERTIES = {
  fontFamily: { type: "string" },
  fontSize: { type: "number" },
  fontWeight: { oneOf: [{ type: "string" }, { type: "number" }] },
  fontStyle: { type: "string" },
  color: { type: "string" },
  textAlign: { type: "string" },
  direction: { type: "string" },
  lineHeight: { type: "number" },
  backgroundColor: { type: "string" },
  fillColor: { type: "string" },
  strokeColor: { type: "string" },
  strokeWidth: { type: "number" },
  opacity: { type: "number", minimum: 0, maximum: 1 }
};

const baseElementProperties = {
  id: { type: "string" },
  type: { enum: ELEMENT_TYPES },
  x: { type: "number" },
  y: { type: "number" },
  width: { type: "number" },
  height: { type: "number" },
  rotation: { type: "number" },
  zIndex: { type: "number" },
  role: { type: "string" },
  column: { type: "string" },
  fitMode: { enum: ["shrink", "clip", "overflow"] },
  minFontSize: { type: "number" },
  style: {
    type: "object",
    additionalProperties: false,
    properties: STYLE_PROPERTIES
  }
};

export const PageLayoutSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "PageLayoutSchema",
  title: "PageLayoutSchema",
  type: "object",
  additionalProperties: false,
  required: ["pageSize", "elements"],
  properties: {
    pageSize: {
      type: "object",
      additionalProperties: false,
      required: ["width", "height", "unit"],
      properties: {
        width: { type: "number", exclusiveMinimum: 0 },
        height: { type: "number", exclusiveMinimum: 0 },
        unit: { enum: ["px"] },
        format: { type: "string" },
        orientation: { type: "string" }
      }
    },
    elements: {
      type: "array",
      items: { $ref: "#/$defs/element" }
    }
  },
  $defs: {
    style: {
      type: "object",
      additionalProperties: false,
      properties: STYLE_PROPERTIES
    },
    element: {
      oneOf: [
        { $ref: "#/$defs/textElement" },
        { $ref: "#/$defs/imageElement" },
        { $ref: "#/$defs/circleElement" },
        { $ref: "#/$defs/rectangleElement" },
        { $ref: "#/$defs/boxElement" },
        { $ref: "#/$defs/lineElement" },
        { $ref: "#/$defs/groupElement" }
      ]
    },
    textElement: {
      type: "object",
      additionalProperties: false,
      required: ["id", "type", "x", "y", "width", "height", "text", "style"],
      properties: {
        ...baseElementProperties,
        type: { const: "text" },
        text: { type: "string" },
        lines: {
          type: "array",
          items: { type: "string" }
        },
        style: {
          type: "object",
          additionalProperties: false,
          required: ["fontSize", "fontWeight", "fontStyle", "color", "lineHeight"],
          properties: STYLE_PROPERTIES
        }
      }
    },
    imageElement: {
      type: "object",
      additionalProperties: false,
      required: ["id", "type", "x", "y", "width", "height", "src"],
      properties: {
        ...baseElementProperties,
        type: { const: "image" },
        src: { type: "string" },
        preserveAspectRatio: { type: "string" }
      }
    },
    circleElement: {
      type: "object",
      additionalProperties: false,
      required: ["id", "type", "x", "y", "width", "height"],
      properties: {
        ...baseElementProperties,
        type: { const: "circle" }
      }
    },
    rectangleElement: {
      type: "object",
      additionalProperties: false,
      required: ["id", "type", "x", "y", "width", "height"],
      properties: {
        ...baseElementProperties,
        type: { const: "rectangle" },
        rx: { type: "number" },
        ry: { type: "number" }
      }
    },
    boxElement: {
      type: "object",
      additionalProperties: false,
      required: ["id", "type", "x", "y", "width", "height"],
      properties: {
        ...baseElementProperties,
        type: { const: "box" },
        rx: { type: "number" },
        ry: { type: "number" }
      }
    },
    lineElement: {
      type: "object",
      additionalProperties: false,
      required: ["id", "type", "x", "y", "width", "height"],
      properties: {
        ...baseElementProperties,
        type: { const: "line" }
      }
    },
    groupElement: {
      type: "object",
      additionalProperties: false,
      required: ["id", "type", "x", "y", "width", "height", "elements"],
      properties: {
        ...baseElementProperties,
        type: { const: "group" },
        elements: {
          type: "array",
          items: { $ref: "#/$defs/element" }
        }
      }
    }
  }
};

export function validatePageLayout(layout) {
  const errors = [];
  validatePage(layout, errors);
  return {
    valid: errors.length === 0,
    errors
  };
}

export function renderPageLayoutToSvg(layout, options = {}) {
  const validation = validatePageLayout(layout);
  if (!validation.valid && options.validate !== false) {
    throw new Error(`Invalid PageLayoutSchema document: ${validation.errors.join("; ")}`);
  }

  const width = numberValue(layout?.pageSize?.width, 0);
  const height = numberValue(layout?.pageSize?.height, 0);
  const body = sortedElements(layout?.elements || [])
    .map(element => renderElement(element))
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
    body,
    "</svg>"
  ].join("");
}

export function renderPageLayoutToHtml(layout, options = {}) {
  const validation = validatePageLayout(layout);
  if (!validation.valid && options.validate !== false) {
    throw new Error(`Invalid PageLayoutSchema document: ${validation.errors.join("; ")}`);
  }

  const width = numberValue(layout?.pageSize?.width, 0);
  const height = numberValue(layout?.pageSize?.height, 0);
  const unit = layout?.pageSize?.unit || "px";
  const body = sortedElements(layout?.elements || [])
    .map(element => renderHtmlElement(element, options))
    .join("");
  const overlayHtml = options.overlayHtml || "";
  const markerPageId = options.markerPageId ? ` data-test-page-marker-page-id="${escapeAttribute(options.markerPageId)}"` : "";
  const language = options.language ? ` data-layout-language="${escapeAttribute(options.language)}"` : "";

  return `
    <div class="page-layout-scroll">
      <div class="page-layout-viewport">
        <div class="page-layout-page" data-test-page-marker-surface${markerPageId}${language} data-layout-width="${width}" data-layout-height="${height}" style="width:${width}${unit};height:${height}${unit};">
          ${body}
          ${overlayHtml}
        </div>
      </div>
    </div>
  `;
}

function validatePage(layout, errors) {
  if (!isPlainObject(layout)) {
    errors.push("layout must be an object");
    return;
  }
  if (!isPlainObject(layout.pageSize)) {
    errors.push("pageSize must be an object");
  } else {
    if (!isPositiveNumber(layout.pageSize.width)) errors.push("pageSize.width must be a positive number");
    if (!isPositiveNumber(layout.pageSize.height)) errors.push("pageSize.height must be a positive number");
    if (layout.pageSize.unit !== "px") errors.push("pageSize.unit must be px");
  }
  if (!Array.isArray(layout.elements)) {
    errors.push("elements must be an array");
  } else {
    layout.elements.forEach((element, index) => validateElement(element, `elements[${index}]`, errors));
  }
}

function validateElement(element, path, errors) {
  if (!isPlainObject(element)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!element.id || typeof element.id !== "string") errors.push(`${path}.id must be a string`);
  if (!ELEMENT_TYPES.includes(element.type)) errors.push(`${path}.type must be one of ${ELEMENT_TYPES.join(", ")}`);
  ["x", "y", "width", "height"].forEach(key => {
    if (!isNumber(element[key])) errors.push(`${path}.${key} must be a number`);
  });
  if (element.rotation !== undefined && !isNumber(element.rotation)) errors.push(`${path}.rotation must be a number`);
  if (element.zIndex !== undefined && !isNumber(element.zIndex)) errors.push(`${path}.zIndex must be a number`);
  validateStyle(element.style, `${path}.style`, errors);

  if (element.type === "text" && typeof element.text !== "string") {
    errors.push(`${path}.text must be a string`);
  }
  if (element.type === "text") {
    if (!isPlainObject(element.style)) {
      errors.push(`${path}.style is required for text elements`);
    } else {
      ["fontSize", "fontWeight", "fontStyle", "color", "lineHeight"].forEach(key => {
        if (element.style[key] === undefined) errors.push(`${path}.style.${key} is required for text elements`);
      });
    }
  }
  if (element.type === "image" && typeof element.src !== "string") {
    errors.push(`${path}.src must be a string`);
  }
  if (element.type === "group") {
    if (!Array.isArray(element.elements)) {
      errors.push(`${path}.elements must be an array`);
    } else {
      element.elements.forEach((child, index) => validateElement(child, `${path}.elements[${index}]`, errors));
    }
  }
}

function validateStyle(style, path, errors) {
  if (style === undefined) return;
  if (!isPlainObject(style)) {
    errors.push(`${path} must be an object`);
    return;
  }
  Object.keys(style).forEach(key => {
    if (!STYLE_PROPERTIES[key]) errors.push(`${path}.${key} is not supported`);
  });
  ["fontSize", "lineHeight", "strokeWidth", "opacity"].forEach(key => {
    if (style[key] !== undefined && !isNumber(style[key])) errors.push(`${path}.${key} must be a number`);
  });
  ["fontFamily", "fontStyle", "color", "textAlign", "direction", "backgroundColor", "fillColor", "strokeColor"].forEach(key => {
    if (style[key] !== undefined && typeof style[key] !== "string") errors.push(`${path}.${key} must be a string`);
  });
  if (style.fontWeight !== undefined && typeof style.fontWeight !== "string" && !isNumber(style.fontWeight)) {
    errors.push(`${path}.fontWeight must be a string or number`);
  }
  if (isNumber(style.opacity) && (style.opacity < 0 || style.opacity > 1)) {
    errors.push(`${path}.opacity must be between 0 and 1`);
  }
}

function renderElement(element) {
  const transform = transformAttribute(element);
  const commonAttrs = [
    `id="${escapeAttribute(element.id)}"`,
    transform,
    styleAttribute(element.style, element.type)
  ].filter(Boolean).join(" ");

  if (element.type === "text") {
    return renderText(element, commonAttrs);
  }
  if (element.type === "image") {
    return `<image ${commonAttrs} x="${numberValue(element.x)}" y="${numberValue(element.y)}" width="${numberValue(element.width)}" height="${numberValue(element.height)}" href="${escapeAttribute(element.src)}" preserveAspectRatio="${escapeAttribute(element.preserveAspectRatio || "xMidYMid meet")}" />`;
  }
  if (element.type === "circle") {
    return `<ellipse ${commonAttrs} cx="${numberValue(element.x) + numberValue(element.width) / 2}" cy="${numberValue(element.y) + numberValue(element.height) / 2}" rx="${Math.max(0, numberValue(element.width) / 2)}" ry="${Math.max(0, numberValue(element.height) / 2)}" />`;
  }
  if (element.type === "rectangle") {
    const rounded = [
      element.rx !== undefined ? `rx="${numberValue(element.rx)}"` : "",
      element.ry !== undefined ? `ry="${numberValue(element.ry)}"` : ""
    ].filter(Boolean).join(" ");
    return `<rect ${commonAttrs} x="${numberValue(element.x)}" y="${numberValue(element.y)}" width="${numberValue(element.width)}" height="${numberValue(element.height)}" ${rounded} />`;
  }
  if (element.type === "box") {
    const rounded = [
      element.rx !== undefined ? `rx="${numberValue(element.rx)}"` : "",
      element.ry !== undefined ? `ry="${numberValue(element.ry)}"` : ""
    ].filter(Boolean).join(" ");
    return `<rect ${commonAttrs} x="${numberValue(element.x)}" y="${numberValue(element.y)}" width="${numberValue(element.width)}" height="${numberValue(element.height)}" ${rounded} />`;
  }
  if (element.type === "line") {
    return `<line ${commonAttrs} x1="${numberValue(element.x)}" y1="${numberValue(element.y)}" x2="${numberValue(element.x) + numberValue(element.width)}" y2="${numberValue(element.y) + numberValue(element.height)}" />`;
  }
  if (element.type === "group") {
    const children = sortedElements(element.elements || []).map(child => renderElement(child)).join("");
    return `<g ${commonAttrs}>${children}</g>`;
  }
  return "";
}

function renderText(element, commonAttrs) {
  const fontSize = textFontSizeValue(element.style?.fontSize, 16);
  const lineHeight = fontSize * numberValue(element.style?.lineHeight, 1.25);
  const lines = String(element.text || "").split(/\r?\n/);
  const tspans = lines.map((line, index) => {
    const attrs = index === 0
      ? `x="${numberValue(element.x)}" dy="0"`
      : `x="${numberValue(element.x)}" dy="${lineHeight}"`;
    return `<tspan ${attrs}>${escapeText(line)}</tspan>`;
  }).join("");

  const backgroundTransform = transformAttribute(element);
  const background = element.style?.backgroundColor
    ? `<rect ${backgroundTransform} x="${numberValue(element.x)}" y="${numberValue(element.y)}" width="${numberValue(element.width)}" height="${numberValue(element.height)}" fill="${escapeAttribute(element.style.backgroundColor)}" opacity="${numberValue(element.style.opacity, 1)}" />`
    : "";

  return `${background}<text ${commonAttrs} x="${numberValue(element.x)}" y="${numberValue(element.y) + fontSize}" dominant-baseline="alphabetic">${tspans}</text>`;
}

function renderHtmlElement(element, options = {}) {
  const style = htmlElementStyle(element);
  const id = escapeAttribute(element.id);

  if (element.type === "text") {
    const textHtml = options.renderText
      ? options.renderText(String(element.text || ""), element)
      : escapeText(element.text || "").replace(/\r?\n/g, "<br>");
    const fitMode = pageLayoutFitMode(element);
    const minFontSize = numberValue(element.minFontSize, 8);
    const fontSize = textFontSizeValue(element.style?.fontSize, 16);
    const targetLineCount = Math.max(0, Math.floor(numberValue(element.targetLineCount, 0)));
    const role = element.role ? ` data-layout-role="${escapeAttribute(element.role)}"` : "";
    const column = element.column ? ` data-layout-column="${escapeAttribute(element.column)}"` : "";
    const targetLines = targetLineCount ? ` data-layout-target-lines="${targetLineCount}"` : "";
    return `<div class="page-layout-element page-layout-text" data-layout-element-id="${id}" data-layout-fit-mode="${fitMode}" data-layout-font-size="${fontSize}" data-layout-min-font-size="${minFontSize}"${targetLines}${role}${column} style="${escapeAttribute(style)}">${textHtml}</div>`;
  }

  if (element.type === "image") {
    if (!element.src) {
      return `<div class="page-layout-element page-layout-box page-layout-image-placeholder" data-layout-element-id="${id}" style="${escapeAttribute(style)}"></div>`;
    }
    return `<img class="page-layout-element page-layout-image" data-layout-element-id="${id}" alt="" src="${escapeAttribute(element.src || "")}" style="${escapeAttribute(style)}" />`;
  }

  if (element.type === "line") {
    return `<div class="page-layout-element page-layout-line" data-layout-element-id="${id}" style="${escapeAttribute(style)}"></div>`;
  }

  if (element.type === "group") {
    const children = sortedElements(element.elements || []).map(child => renderHtmlElement(child, options)).join("");
    return `<div class="page-layout-element page-layout-group" data-layout-element-id="${id}" style="${escapeAttribute(style)}">${children}</div>`;
  }

  return `<div class="page-layout-element page-layout-box" data-layout-element-id="${id}" style="${escapeAttribute(style)}"></div>`;
}

function htmlElementStyle(element) {
  const style = element.style || {};
  const rotation = numberValue(element.rotation, 0);
  const zIndex = numberValue(element.zIndex, 0);
  const width = Math.max(0, numberValue(element.width));
  const height = Math.max(0, numberValue(element.height));
  const rules = {
    position: "absolute",
    left: `${numberValue(element.x)}px`,
    top: `${numberValue(element.y)}px`,
    width: `${width}px`,
    "min-width": element.type === "text" ? `${width}px` : undefined,
    height: `${height}px`,
    "min-height": undefined,
    "z-index": zIndex,
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
    "transform-origin": rotation ? "center center" : undefined,
    opacity: style.opacity,
    "font-family": style.fontFamily,
    "font-size": element.type === "text" && style.fontSize !== undefined ? `${textFontSizeValue(style.fontSize)}px` : undefined,
    "font-weight": style.fontWeight,
    "font-style": style.fontStyle,
    color: style.color,
    "text-align": style.textAlign,
    direction: style.direction,
    "unicode-bidi": style.direction ? "plaintext" : undefined,
    "line-height": style.lineHeight,
    "background-color": style.backgroundColor || style.fillColor,
    border: style.strokeColor || style.strokeWidth ? `${numberValue(style.strokeWidth, 1)}px solid ${style.strokeColor || "#111111"}` : undefined,
    overflow: element.type === "text" ? textOverflowValue(element) : element.type === "group" ? "visible" : undefined,
    "white-space": element.type === "text" ? "pre-wrap" : undefined,
    "overflow-wrap": element.type === "text" ? "normal" : undefined,
    "word-break": element.type === "text" ? "normal" : undefined,
    hyphens: element.type === "text" ? "manual" : undefined
  };

  if (element.type === "circle") {
    rules["border-radius"] = "50%";
  }

  if (element.type === "line") {
    const length = Math.hypot(numberValue(element.width), numberValue(element.height));
    const angle = Math.atan2(numberValue(element.height), numberValue(element.width)) * 180 / Math.PI;
    rules.width = `${length}px`;
    rules.height = "0";
    rules.border = "0";
    rules["border-top"] = `${numberValue(style.strokeWidth, 1)}px solid ${style.strokeColor || style.color || "#111111"}`;
    rules.transform = `rotate(${angle + rotation}deg)`;
    rules["transform-origin"] = "0 0";
  }

  return Object.entries(rules)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}:${String(value).replace(/;/g, "")}`)
    .join(";");
}

function pageLayoutFitMode(element) {
  const fitMode = String(element?.fitMode || "").toLowerCase();
  if (fitMode === "clip" || fitMode === "overflow") return fitMode;
  return "shrink";
}

function textOverflowValue(element) {
  return pageLayoutFitMode(element) === "overflow" ? "visible" : "hidden";
}

function sortedElements(elements) {
  return [...elements]
    .map((element, index) => ({ element, index }))
    .sort((a, b) =>
      numberValue(a.element?.zIndex, 0) - numberValue(b.element?.zIndex, 0) ||
      elementLayerPriority(a.element) - elementLayerPriority(b.element) ||
      a.index - b.index
    )
    .map(entry => entry.element);
}

function elementLayerPriority(element) {
  switch (String(element?.type || "").toLowerCase()) {
    case "box":
    case "rectangle":
    case "circle":
    case "image":
      return 0;
    case "line":
      return 1;
    case "group":
      return 2;
    case "text":
      return 3;
    default:
      return 0;
  }
}

function transformAttribute(element) {
  const rotation = numberValue(element.rotation, 0);
  if (element.type === "group") {
    const transforms = [
      `translate(${numberValue(element.x)} ${numberValue(element.y)})`,
      rotation ? `rotate(${rotation} ${numberValue(element.width) / 2} ${numberValue(element.height) / 2})` : ""
    ].filter(Boolean);
    return transforms.length ? `transform="${transforms.join(" ")}"` : "";
  }
  if (!rotation) return "";
  const cx = numberValue(element.x) + numberValue(element.width) / 2;
  const cy = numberValue(element.y) + numberValue(element.height) / 2;
  return `transform="rotate(${rotation} ${cx} ${cy})"`;
}

function styleAttribute(style = {}, type = "") {
  const textFill = style.color || "#111111";
  const lineStroke = style.strokeColor || style.color || "#111111";
  const shapeFill = style.fillColor || style.backgroundColor || "transparent";
  const shapeStroke = style.strokeColor || "none";
  const styles = {
    "font-family": style.fontFamily,
    "font-size": type === "text" && style.fontSize !== undefined ? textFontSizeValue(style.fontSize) : style.fontSize,
    "font-weight": style.fontWeight,
    "font-style": style.fontStyle,
    "line-height": style.lineHeight,
    "text-align": style.textAlign,
    direction: style.direction,
    color: style.color,
    fill: type === "text" ? textFill : type === "line" || type === "group" || type === "image" ? undefined : shapeFill,
    stroke: type === "line" ? lineStroke : type === "group" || type === "image" ? undefined : shapeStroke,
    "stroke-width": style.strokeWidth,
    opacity: style.opacity
  };

  const value = Object.entries(styles)
    .filter(([, item]) => item !== undefined && item !== "")
    .map(([key, item]) => `${key}:${String(item).replace(/;/g, "")}`)
    .join(";");

  return value ? `style="${escapeAttribute(value)}"` : "";
}

function escapeText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeText(value)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function textFontSizeValue(value, fallback = 15) {
  return Math.max(15, numberValue(value, fallback));
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveNumber(value) {
  return isNumber(value) && value > 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
