export const STUDY_DOCUMENT_V1_SCHEMA_VERSION = "study-document/v1";

export const STUDY_DOCUMENT_V1_NODE_TYPES = Object.freeze([
  "group",
  "text",
  "flow",
  "gap",
  "list",
  "graphic",
  "table",
  "rule"
]);

export const STUDY_DOCUMENT_V1_CONTENT_DENSITIES = Object.freeze([
  "compact",
  "balanced",
  "spread"
]);

export const STUDY_DOCUMENT_V1_FORBIDDEN_FIELDS = Object.freeze([
  "x",
  "y",
  "left",
  "top",
  "right",
  "bottom",
  "width",
  "height",
  "boundingBox",
  "bbox",
  "polygon",
  "coordinates",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "color"
]);

const NODE_TYPES = new Set(STUDY_DOCUMENT_V1_NODE_TYPES);
const FORBIDDEN_FIELDS = new Set(STUDY_DOCUMENT_V1_FORBIDDEN_FIELDS);
const ROOT_FIELDS = new Set(["schemaVersion", "documentId", "pageNumber", "source", "contentDensity", "content"]);
const SOURCE_FIELDS = new Set(["kind", "sourcePageIndex"]);
const CONTENT_DENSITIES = new Set(STUDY_DOCUMENT_V1_CONTENT_DENSITIES);

const GROUP_ROLES = new Set([
  "page-header", "page-footer", "section", "article", "question", "question-set",
  "instruction-box", "quote-box", "quote-bubble", "answer-area", "content-box",
  "score-area", "caption-group", "generic"
]);
const GROUP_LAYOUTS = new Set(["block", "row", "columns", "grid"]);
const COLUMN_COUNTS = new Set([2, 3, 4]);
const FLOW_MODES = new Set(["continuous", "fixed"]);
const TEXT_ROLES = new Set([
  "title", "subtitle", "heading", "body", "instruction", "question", "number",
  "option", "caption", "attribution", "label", "footer", "header", "note"
]);
const GAP_DISPLAYS = new Set(["inline", "block"]);
const GAP_STYLES = new Set(["line", "box", "blank"]);
const GAP_SIZES = new Set(["small", "medium", "large"]);
const GAP_LINES = new Set([1, 2, 3, 4, 5, 6]);
const LIST_ROLES = new Set(["choices", "questions", "steps", "bullets", "checklist", "generic"]);
const LIST_MARKERS = new Set(["none", "bullet", "number", "letters", "checkbox"]);
const LIST_SELECTION_CONTROLS = new Set(["checkbox"]);
const GRAPHIC_ROLES = new Set(["photo", "illustration", "diagram", "map", "chart", "icon", "decorative", "unknown"]);
const GRAPHIC_PLACEMENTS = new Set(["block", "center", "left", "right", "float-left", "float-right", "inline"]);
const GRAPHIC_SIZES = new Set(["small", "medium", "large", "full"]);
const TABLE_ROLES = new Set(["data-table", "score-table", "answer-table", "comparison-table", "generic"]);
const RULE_ROLES = new Set(["section-separator", "title-extension", "content-divider", "footer-divider", "decorative"]);
const FLOW_CHILD_TYPES = new Set(["text", "gap", "graphic"]);

const NODE_FIELDS = Object.freeze({
  group: new Set(["type", "id", "role", "layout", "children", "columnCount", "flowMode"]),
  text: new Set(["type", "id", "role", "value"]),
  flow: new Set(["type", "id", "children"]),
  gap: new Set(["type", "id", "display", "style", "size", "lines", "label"]),
  list: new Set(["type", "id", "role", "marker", "selectionControl", "items"]),
  graphic: new Set(["type", "id", "role", "assetId", "placement", "size", "placeholder", "aspectRatio"]),
  table: new Set(["type", "id", "role", "rows"]),
  rule: new Set(["type", "id", "role"])
});

const REQUIRED_NODE_FIELDS = Object.freeze({
  group: ["type", "id", "role", "layout", "children"],
  text: ["type", "id", "role", "value"],
  flow: ["type", "id", "children"],
  gap: ["type", "id", "display", "style"],
  list: ["type", "id", "role", "marker", "items"],
  graphic: ["type", "id", "role", "assetId", "placement", "size", "placeholder"],
  table: ["type", "id", "role", "rows"],
  rule: ["type", "id", "role"]
});

/**
 * Strictly validates a semantic page against docs/STUDY_DOCUMENT_V1_SPEC.md.
 * The validator never normalizes, coerces, or adds fields to the input.
 */
export function validateStudyDocumentV1(document) {
  const validator = new StudyDocumentV1Validator();
  validator.validate(document);
  return { valid: validator.errors.length === 0, errors: validator.errors };
}

export function assertStudyDocumentV1(document) {
  const result = validateStudyDocumentV1(document);
  if (!result.valid) throw new StudyDocumentV1ValidationError(result.errors);
  return document;
}

export class StudyDocumentV1ValidationError extends Error {
  constructor(errors) {
    super(`Invalid ${STUDY_DOCUMENT_V1_SCHEMA_VERSION} document (${errors.length} validation error${errors.length === 1 ? "" : "s"}).`);
    this.name = "StudyDocumentV1ValidationError";
    this.errors = errors;
  }
}

class StudyDocumentV1Validator {
  constructor() {
    this.errors = [];
    this.ids = new Map();
  }

  validate(document) {
    if (!isObject(document)) {
      this.issue("invalid-type", "$", "The study document must be an object.");
      return;
    }

    if (this.scanForForbiddenFieldsAndCycles(document, "$")) return;

    this.shape(document, "$", ROOT_FIELDS, ["schemaVersion", "documentId", "pageNumber", "source", "content"]);
    if (document.schemaVersion !== STUDY_DOCUMENT_V1_SCHEMA_VERSION) {
      this.issue("invalid-schema-version", "$.schemaVersion", `schemaVersion must equal ${STUDY_DOCUMENT_V1_SCHEMA_VERSION}.`);
    }
    this.nonEmptyString(document.documentId, "$.documentId", "documentId");
    this.integer(document.pageNumber, "$.pageNumber", "pageNumber", 1);
    this.validateSource(document.source, "$.source");
    if (has(document, "contentDensity")) {
      this.enum(document.contentDensity, "$.contentDensity", CONTENT_DENSITIES, "contentDensity");
    }
    this.nodes(document.content, "$.content");
  }

  validateSource(source, path) {
    if (!this.object(source, path, "source")) return;
    this.shape(source, path, SOURCE_FIELDS, ["kind", "sourcePageIndex"]);
    this.nonEmptyString(source.kind, `${path}.kind`, "source.kind");
    this.integer(source.sourcePageIndex, `${path}.sourcePageIndex`, "source.sourcePageIndex", 0);
  }

  nodes(nodes, path) {
    if (!this.array(nodes, path, "node collection")) return;
    nodes.forEach((node, index) => this.node(node, `${path}[${index}]`));
  }

  node(node, path) {
    if (!this.object(node, path, "node")) return;
    if (!has(node, "type")) {
      this.issue("missing-field", `${path}.type`, "Missing required field type.");
      return;
    }
    if (typeof node.type !== "string") {
      this.issue("invalid-type", `${path}.type`, "Node type must be a string.");
      return;
    }
    if (!NODE_TYPES.has(node.type)) {
      this.issue("unknown-node-type", `${path}.type`, `Unknown node type: ${node.type}.`);
      return;
    }

    this.shape(node, path, NODE_FIELDS[node.type], REQUIRED_NODE_FIELDS[node.type]);
    this.id(node.id, `${path}.id`);

    switch (node.type) {
      case "group": this.group(node, path); break;
      case "text": this.text(node, path); break;
      case "flow": this.flow(node, path); break;
      case "gap": this.gap(node, path); break;
      case "list": this.list(node, path); break;
      case "graphic": this.graphic(node, path); break;
      case "table": this.table(node, path); break;
      case "rule": this.rule(node, path); break;
    }
  }

  group(node, path) {
    this.enum(node.role, `${path}.role`, GROUP_ROLES, "group role");
    this.enum(node.layout, `${path}.layout`, GROUP_LAYOUTS, "group layout");
    if (has(node, "columnCount")) {
      this.enum(node.columnCount, `${path}.columnCount`, COLUMN_COUNTS, "columnCount");
      if (node.layout !== "columns" && node.layout !== "grid") {
        this.issue("invalid-field-context", `${path}.columnCount`, "columnCount is allowed only for columns or grid groups.");
      }
    }
    if (has(node, "flowMode")) {
      this.enum(node.flowMode, `${path}.flowMode`, FLOW_MODES, "flowMode");
      if (node.layout !== "columns") {
        this.issue("invalid-field-context", `${path}.flowMode`, "flowMode is allowed only for columns groups.");
      }
      if (node.flowMode === "fixed") {
        if (!has(node, "columnCount")) {
          this.issue("missing-field", `${path}.columnCount`, "Fixed columns require columnCount.");
        }
        if (Array.isArray(node.children)) {
          if (COLUMN_COUNTS.has(node.columnCount) && node.children.length !== node.columnCount) {
            this.issue(
              "invalid-fixed-columns",
              `${path}.children`,
              `Fixed columns require exactly ${node.columnCount} direct column groups.`
            );
          }
          node.children.forEach((child, index) => {
            if (!isObject(child) || child.type !== "group" || child.layout !== "block") {
              this.issue(
                "invalid-fixed-column-child",
                `${path}.children[${index}]`,
                "Each fixed-column child must be a group with block layout."
              );
            }
          });
        }
      }
    }
    this.nodes(node.children, `${path}.children`);
  }

  text(node, path) {
    this.enum(node.role, `${path}.role`, TEXT_ROLES, "text role");
    if (typeof node.value !== "string") this.issue("invalid-type", `${path}.value`, "Text value must be a string.");
  }

  flow(node, path) {
    if (!this.array(node.children, `${path}.children`, "flow children")) return;
    node.children.forEach((child, index) => {
      const childPath = `${path}.children[${index}]`;
      this.node(child, childPath);
      if (isObject(child) && typeof child.type === "string" && !FLOW_CHILD_TYPES.has(child.type)) {
        this.issue("invalid-flow-child", `${childPath}.type`, "flow children must be text, gap, or graphic nodes.");
      }
      if (isObject(child) && child.type === "graphic" && child.placement !== "inline") {
        this.issue("invalid-flow-graphic-placement", `${childPath}.placement`, "A graphic inside flow must use inline placement.");
      }
    });
  }

  gap(node, path) {
    this.enum(node.display, `${path}.display`, GAP_DISPLAYS, "gap display");
    this.enum(node.style, `${path}.style`, GAP_STYLES, "gap style");
    if (has(node, "label") && typeof node.label !== "string") {
      this.issue("invalid-type", `${path}.label`, "Gap label must be a string.");
    }
    if (has(node, "size")) {
      this.enum(node.size, `${path}.size`, GAP_SIZES, "gap size");
      if (node.display === "block") this.issue("invalid-field-context", `${path}.size`, "size is allowed only on inline gaps.");
    }
    if (has(node, "lines")) {
      this.enum(node.lines, `${path}.lines`, GAP_LINES, "gap lines");
      if (node.display === "inline") this.issue("invalid-field-context", `${path}.lines`, "lines is allowed only on block gaps.");
    }
  }

  list(node, path) {
    this.enum(node.role, `${path}.role`, LIST_ROLES, "list role");
    this.enum(node.marker, `${path}.marker`, LIST_MARKERS, "list marker");
    if (has(node, "selectionControl")) {
      this.enum(node.selectionControl, `${path}.selectionControl`, LIST_SELECTION_CONTROLS, "list selectionControl");
      if (node.role !== "choices" || node.marker !== "letters") {
        this.issue(
          "invalid-field-context",
          `${path}.selectionControl`,
          "selectionControl is allowed only on choices lists with marker letters."
        );
      }
    }
    if (!this.array(node.items, `${path}.items`, "list items")) return;
    node.items.forEach((item, index) => {
      const itemPath = `${path}.items[${index}]`;
      if (!this.object(item, itemPath, "list item")) return;
      this.shape(item, itemPath, new Set(["id", "children"]), ["id", "children"]);
      this.id(item.id, `${itemPath}.id`);
      this.nodes(item.children, `${itemPath}.children`);
    });
  }

  graphic(node, path) {
    this.enum(node.role, `${path}.role`, GRAPHIC_ROLES, "graphic role");
    this.enum(node.placement, `${path}.placement`, GRAPHIC_PLACEMENTS, "graphic placement");
    this.enum(node.size, `${path}.size`, GRAPHIC_SIZES, "graphic size");
    const validAssetId = node.assetId === null || (typeof node.assetId === "string" && node.assetId.length > 0);
    if (!validAssetId) this.issue("invalid-type", `${path}.assetId`, "assetId must be null or a non-empty string.");
    if (typeof node.placeholder !== "boolean") {
      this.issue("invalid-type", `${path}.placeholder`, "placeholder must be a boolean.");
    } else if ((node.assetId === null && node.placeholder !== true) || (typeof node.assetId === "string" && node.assetId.length > 0 && node.placeholder !== false)) {
      this.issue("invalid-graphic-asset-combination", path, "A missing asset requires assetId null and placeholder true; an available asset requires a non-empty assetId and placeholder false.");
    }
    if (has(node, "aspectRatio") && (!Number.isFinite(node.aspectRatio) || node.aspectRatio <= 0)) {
      this.issue("invalid-aspect-ratio", `${path}.aspectRatio`, "aspectRatio must be a positive finite number.");
    }
  }

  table(node, path) {
    this.enum(node.role, `${path}.role`, TABLE_ROLES, "table role");
    if (!this.array(node.rows, `${path}.rows`, "table rows")) return;
    node.rows.forEach((row, rowIndex) => {
      const rowPath = `${path}.rows[${rowIndex}]`;
      if (!this.object(row, rowPath, "table row")) return;
      this.shape(row, rowPath, new Set(["id", "cells"]), ["id", "cells"]);
      this.id(row.id, `${rowPath}.id`);
      if (!this.array(row.cells, `${rowPath}.cells`, "table cells")) return;
      row.cells.forEach((cell, cellIndex) => {
        const cellPath = `${rowPath}.cells[${cellIndex}]`;
        if (!this.object(cell, cellPath, "table cell")) return;
        this.shape(cell, cellPath, new Set(["id", "children"]), ["id", "children"]);
        this.id(cell.id, `${cellPath}.id`);
        this.nodes(cell.children, `${cellPath}.children`);
      });
    });
  }

  rule(node, path) {
    this.enum(node.role, `${path}.role`, RULE_ROLES, "rule role");
  }

  scanForForbiddenFieldsAndCycles(value, path, active = new WeakSet(), visited = new WeakSet()) {
    if (!value || typeof value !== "object") return false;
    if (active.has(value)) {
      this.issue("cyclic-reference", path, "The semantic document must be JSON and cannot contain cyclic references.");
      return true;
    }
    if (visited.has(value)) return false;
    active.add(value);
    visited.add(value);
    let cyclic = false;
    for (const [key, child] of Object.entries(value)) {
      const childPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
      if (FORBIDDEN_FIELDS.has(key)) this.issue("forbidden-field", childPath, `Field ${key} is forbidden by ${STUDY_DOCUMENT_V1_SCHEMA_VERSION}.`);
      cyclic = this.scanForForbiddenFieldsAndCycles(child, childPath, active, visited) || cyclic;
    }
    active.delete(value);
    return cyclic;
  }

  shape(value, path, allowed, required) {
    for (const field of required) {
      if (!has(value, field)) this.issue("missing-field", `${path}.${field}`, `Missing required field ${field}.`);
    }
    for (const field of Object.keys(value)) {
      if (!allowed.has(field) && !FORBIDDEN_FIELDS.has(field)) {
        this.issue("unknown-field", `${path}.${field}`, `Unknown field ${field}.`);
      }
    }
  }

  id(value, path) {
    if (!this.nonEmptyString(value, path, "id")) return;
    if (this.ids.has(value)) {
      this.issue("duplicate-id", path, `Duplicate id ${value}; first declared at ${this.ids.get(value)}.`);
    } else {
      this.ids.set(value, path);
    }
  }

  enum(value, path, values, label) {
    if (!values.has(value)) this.issue("invalid-enum", path, `Invalid ${label}: ${String(value)}.`);
  }

  object(value, path, label) {
    if (isObject(value)) return true;
    this.issue("invalid-type", path, `${label} must be an object.`);
    return false;
  }

  array(value, path, label) {
    if (Array.isArray(value)) return true;
    this.issue("invalid-type", path, `${label} must be an array.`);
    return false;
  }

  nonEmptyString(value, path, label) {
    if (typeof value === "string" && value.length > 0) return true;
    this.issue("invalid-type", path, `${label} must be a non-empty string.`);
    return false;
  }

  integer(value, path, label, minimum) {
    if (!Number.isInteger(value) || value < minimum) {
      this.issue("invalid-type", path, `${label} must be an integer greater than or equal to ${minimum}.`);
    }
  }

  issue(code, path, message) {
    this.errors.push({ code, path, message });
  }
}

function has(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
