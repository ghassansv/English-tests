import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  STUDY_DOCUMENT_V1_CONTENT_DENSITIES,
  STUDY_DOCUMENT_V1_FORBIDDEN_FIELDS,
  STUDY_DOCUMENT_V1_NODE_TYPES,
  STUDY_DOCUMENT_V1_SCHEMA_VERSION,
  StudyDocumentV1ValidationError,
  assertStudyDocumentV1,
  validateStudyDocumentV1
} from "../public/js/study-document-v1.js";

function validDocument() {
  return {
    schemaVersion: "study-document/v1",
    documentId: "doc-complete",
    pageNumber: 1,
    source: { kind: "page-image", sourcePageIndex: 0 },
    contentDensity: "spread",
    content: [
      {
        type: "group",
        id: "group-1",
        role: "section",
        layout: "columns",
        columnCount: 2,
        flowMode: "continuous",
        children: [
          { type: "text", id: "text-1", role: "heading", value: "Heading" },
          {
            type: "flow",
            id: "flow-1",
            children: [
              { type: "text", id: "text-2", role: "body", value: "Answer " },
              { type: "gap", id: "gap-1", display: "inline", style: "line", size: "medium", label: "answer" },
              { type: "graphic", id: "graphic-1", role: "icon", assetId: "asset-1", placement: "inline", size: "small", placeholder: false }
            ]
          },
          { type: "gap", id: "gap-2", display: "block", style: "box", lines: 3 },
          {
            type: "list",
            id: "list-1",
            role: "choices",
            marker: "letters",
            selectionControl: "checkbox",
            items: [
              { id: "item-1", children: [{ type: "text", id: "text-3", role: "option", value: "Choice" }] }
            ]
          },
          { type: "graphic", id: "graphic-2", role: "photo", assetId: null, placement: "block", size: "full", placeholder: true, aspectRatio: 1.6 },
          {
            type: "table",
            id: "table-1",
            role: "data-table",
            rows: [
              { id: "row-1", cells: [{ id: "cell-1", children: [{ type: "text", id: "text-4", role: "body", value: "Cell" }] }] }
            ]
          },
          { type: "rule", id: "rule-1", role: "section-separator" }
        ]
      }
    ]
  };
}

function clone(value = validDocument()) {
  return structuredClone(value);
}

function fixedColumnsGroup() {
  return {
    type: "group",
    id: "fixed-columns-1",
    role: "article",
    layout: "columns",
    columnCount: 2,
    flowMode: "fixed",
    children: [
      {
        type: "group",
        id: "fixed-column-1",
        role: "generic",
        layout: "block",
        children: [{ type: "text", id: "fixed-text-1", role: "body", value: "First paragraph." }]
      },
      {
        type: "group",
        id: "fixed-column-2",
        role: "generic",
        layout: "block",
        children: [{ type: "text", id: "fixed-text-2", role: "body", value: "Second paragraph." }]
      }
    ]
  };
}

function expectValid(document, label = "document") {
  const result = validateStudyDocumentV1(document);
  assert.equal(result.valid, true, `${label}: ${JSON.stringify(result.errors, null, 2)}`);
  assert.deepEqual(result.errors, []);
}

function expectInvalid(label, mutate, code, path) {
  const document = clone();
  mutate(document);
  const result = validateStudyDocumentV1(document);
  assert.equal(result.valid, false, `${label} should be invalid`);
  assert.ok(
    result.errors.some(error => error.code === code && (path === undefined || error.path === path)),
    `${label}: expected ${code}${path ? ` at ${path}` : ""}, got ${JSON.stringify(result.errors, null, 2)}`
  );
}

assert.equal(STUDY_DOCUMENT_V1_SCHEMA_VERSION, "study-document/v1");
assert.deepEqual(STUDY_DOCUMENT_V1_CONTENT_DENSITIES, ["compact", "balanced", "spread"]);
assert.deepEqual(STUDY_DOCUMENT_V1_NODE_TYPES, ["group", "text", "flow", "gap", "list", "graphic", "table", "rule"]);
const jsonSchema = JSON.parse(await readFile(new URL("../public/StudyDocumentV1Schema.json", import.meta.url), "utf8"));
assert.equal(jsonSchema.properties.schemaVersion.const, STUDY_DOCUMENT_V1_SCHEMA_VERSION);
assert.equal(jsonSchema.additionalProperties, false);
assert.deepEqual(jsonSchema.properties.contentDensity.enum, ["compact", "balanced", "spread"]);
assert.equal(jsonSchema.$defs.list.properties.selectionControl.const, "checkbox");
assert.match(JSON.stringify(jsonSchema.$defs.group), /"flowMode":\{"const":"fixed"\}/);
assert.deepEqual(Object.keys(jsonSchema.$defs).filter(key => STUDY_DOCUMENT_V1_NODE_TYPES.includes(key)), STUDY_DOCUMENT_V1_NODE_TYPES);
expectValid(validDocument(), "complete document containing all eight node types");
assert.equal(assertStudyDocumentV1(validDocument()).documentId, "doc-complete");

{
  const invalid = validDocument();
  invalid.schemaVersion = "study-document/v2";
  assert.throws(() => assertStudyDocumentV1(invalid), error => (
    error instanceof StudyDocumentV1ValidationError &&
    error.errors.some(issue => issue.code === "invalid-schema-version")
  ));
}

assert.equal(validateStudyDocumentV1(null).valid, false);
assert.equal(validateStudyDocumentV1(null).errors[0].path, "$");

expectInvalid("wrong schema version", document => { document.schemaVersion = "study-document/v2"; }, "invalid-schema-version", "$.schemaVersion");
expectInvalid("unknown root field", document => { document.pageType = "exam"; }, "unknown-field", "$.pageType");
expectInvalid("missing root field", document => { delete document.content; }, "missing-field", "$.content");
expectInvalid("invalid document id", document => { document.documentId = ""; }, "invalid-type", "$.documentId");
expectInvalid("invalid page number", document => { document.pageNumber = 0; }, "invalid-type", "$.pageNumber");
expectInvalid("invalid content density", document => { document.contentDensity = "full"; }, "invalid-enum", "$.contentDensity");
expectInvalid("unknown source field", document => { document.source.url = "/page.jpg"; }, "unknown-field", "$.source.url");
expectInvalid("invalid source index", document => { document.source.sourcePageIndex = -1; }, "invalid-type", "$.source.sourcePageIndex");
expectInvalid("non-array content", document => { document.content = {}; }, "invalid-type", "$.content");

expectInvalid("unknown node type", document => { document.content[0].type = "question"; }, "unknown-node-type", "$.content[0].type");
expectInvalid("missing node type", document => { delete document.content[0].type; }, "missing-field", "$.content[0].type");
expectInvalid("unknown node field", document => { document.content[0].template = "exam"; }, "unknown-field", "$.content[0].template");
expectInvalid("unknown list item field", document => { document.content[0].children[3].items[0].marker = "A"; }, "unknown-field");
expectInvalid("unknown table row field", document => { document.content[0].children[5].rows[0].columns = []; }, "unknown-field");
expectInvalid("unknown table cell field", document => { document.content[0].children[5].rows[0].cells[0].span = 2; }, "unknown-field");

for (const field of STUDY_DOCUMENT_V1_FORBIDDEN_FIELDS) {
  expectInvalid(`forbidden field ${field}`, document => { document.content[0].children[0][field] = 1; }, "forbidden-field", `$.content[0].children[0].${field}`);
}
expectInvalid("forbidden source geometry", document => { document.source.bbox = [0, 0, 1, 1]; }, "forbidden-field", "$.source.bbox");

expectInvalid("duplicate node id", document => { document.content[0].children[0].id = "group-1"; }, "duplicate-id");
expectInvalid("duplicate list item id", document => { document.content[0].children[3].items[0].id = "text-1"; }, "duplicate-id");
expectInvalid("duplicate row id", document => { document.content[0].children[5].rows[0].id = "item-1"; }, "duplicate-id");
expectInvalid("duplicate cell id", document => { document.content[0].children[5].rows[0].cells[0].id = "row-1"; }, "duplicate-id");

const enumCases = [
  ["group role", document => { document.content[0].role = "exam"; }, "$.content[0].role"],
  ["group layout", document => { document.content[0].layout = "absolute"; }, "$.content[0].layout"],
  ["text role", document => { document.content[0].children[0].role = "paragraph"; }, "$.content[0].children[0].role"],
  ["gap display", document => { document.content[0].children[2].display = "line"; }, "$.content[0].children[2].display"],
  ["gap style", document => { document.content[0].children[2].style = "underline"; }, "$.content[0].children[2].style"],
  ["gap size", document => { document.content[0].children[1].children[1].size = "wide"; }, "$.content[0].children[1].children[1].size"],
  ["gap lines", document => { document.content[0].children[2].lines = 7; }, "$.content[0].children[2].lines"],
  ["list role", document => { document.content[0].children[3].role = "options"; }, "$.content[0].children[3].role"],
  ["list marker", document => { document.content[0].children[3].marker = "roman"; }, "$.content[0].children[3].marker"],
  ["list selectionControl", document => { document.content[0].children[3].selectionControl = "radio"; }, "$.content[0].children[3].selectionControl"],
  ["graphic role", document => { document.content[0].children[4].role = "image"; }, "$.content[0].children[4].role"],
  ["graphic placement", document => { document.content[0].children[4].placement = "absolute"; }, "$.content[0].children[4].placement"],
  ["graphic size", document => { document.content[0].children[4].size = "page"; }, "$.content[0].children[4].size"],
  ["table role", document => { document.content[0].children[5].role = "layout-table"; }, "$.content[0].children[5].role"],
  ["rule role", document => { document.content[0].children[6].role = "line"; }, "$.content[0].children[6].role"]
];
for (const [label, mutate, path] of enumCases) expectInvalid(`invalid ${label}`, mutate, "invalid-enum", path);

expectInvalid("invalid columnCount value", document => { document.content[0].columnCount = 5; }, "invalid-enum", "$.content[0].columnCount");
expectInvalid("invalid flowMode value", document => { document.content[0].flowMode = "balanced"; }, "invalid-enum", "$.content[0].flowMode");
expectInvalid("columnCount on block", document => { document.content[0].layout = "block"; }, "invalid-field-context", "$.content[0].columnCount");
expectInvalid("flowMode on grid", document => { document.content[0].layout = "grid"; }, "invalid-field-context", "$.content[0].flowMode");
expectInvalid("flowMode on row", document => { document.content[0].layout = "row"; delete document.content[0].columnCount; }, "invalid-field-context", "$.content[0].flowMode");
expectInvalid("selectionControl on non-choice list", document => { document.content[0].children[3].role = "steps"; }, "invalid-field-context", "$.content[0].children[3].selectionControl");
expectInvalid("selectionControl without letter markers", document => { document.content[0].children[3].marker = "none"; }, "invalid-field-context", "$.content[0].children[3].selectionControl");

{
  const document = validDocument();
  document.content.push(fixedColumnsGroup());
  expectValid(document, "fixed columns with one block group per column");
}

for (const [label, mutate, code, path] of [
  ["fixed columns without columnCount", group => { delete group.columnCount; }, "missing-field", "$.content[1].columnCount"],
  ["fixed columns with wrong child count", group => { group.children.pop(); }, "invalid-fixed-columns", "$.content[1].children"],
  ["fixed columns with non-block column", group => { group.children[0].layout = "row"; }, "invalid-fixed-column-child", "$.content[1].children[0]"],
  ["fixed columns with direct text", group => { group.children[0] = { type: "text", id: "fixed-direct-text", role: "body", value: "Wrong level" }; }, "invalid-fixed-column-child", "$.content[1].children[0]"]
]) {
  const document = validDocument();
  document.content.push(fixedColumnsGroup());
  mutate(document.content[1]);
  const result = validateStudyDocumentV1(document);
  assert.equal(result.valid, false, `${label} should be invalid`);
  assert.ok(result.errors.some(error => error.code === code && error.path === path), `${label}: ${JSON.stringify(result.errors)}`);
}

expectInvalid("unsupported flow child", document => {
  document.content[0].children[1].children.push({ type: "rule", id: "flow-rule", role: "decorative" });
}, "invalid-flow-child");
expectInvalid("non-inline flow graphic", document => {
  document.content[0].children[1].children[2].placement = "block";
}, "invalid-flow-graphic-placement");

expectInvalid("size on block gap", document => { document.content[0].children[2].size = "small"; }, "invalid-field-context", "$.content[0].children[2].size");
expectInvalid("lines on inline gap", document => { document.content[0].children[1].children[1].lines = 1; }, "invalid-field-context");

expectInvalid("null asset without placeholder", document => { document.content[0].children[4].placeholder = false; }, "invalid-graphic-asset-combination");
expectInvalid("asset marked as placeholder", document => { document.content[0].children[1].children[2].placeholder = true; }, "invalid-graphic-asset-combination");
expectInvalid("empty graphic asset id", document => { document.content[0].children[1].children[2].assetId = ""; }, "invalid-type");
expectInvalid("non-boolean graphic placeholder", document => { document.content[0].children[4].placeholder = 1; }, "invalid-type");
for (const aspectRatio of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "1.6"]) {
  expectInvalid(`invalid aspect ratio ${String(aspectRatio)}`, document => { document.content[0].children[4].aspectRatio = aspectRatio; }, "invalid-aspect-ratio");
}

expectInvalid("non-string text", document => { document.content[0].children[0].value = 42; }, "invalid-type");
expectInvalid("non-string gap label", document => { document.content[0].children[1].children[1].label = 42; }, "invalid-type");
expectInvalid("missing required node field", document => { delete document.content[0].children[4].assetId; }, "missing-field");
expectInvalid("non-array node children", document => { document.content[0].children = {}; }, "invalid-type");

{
  const document = validDocument();
  document.content.push({ type: "group", id: "grid-1", role: "generic", layout: "grid", columnCount: 4, children: [] });
  document.content.push({ type: "group", id: "row-group-1", role: "generic", layout: "row", children: [] });
  document.content.push({ type: "gap", id: "minimal-inline-gap", display: "inline", style: "blank" });
  document.content.push({ type: "gap", id: "minimal-block-gap", display: "block", style: "line" });
  expectValid(document, "valid optional-field combinations");
}

{
  const document = validDocument();
  document.content = [];
  expectValid(document, "empty page content");
}

{
  const document = validDocument();
  delete document.contentDensity;
  expectValid(document, "content density defaults when omitted");
}

{
  const document = validDocument();
  document.content[0].children.push(document.content[0]);
  const result = validateStudyDocumentV1(document);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === "cyclic-reference"));
}

console.log("study-document/v1 conformance tests passed");
