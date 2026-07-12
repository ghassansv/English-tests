export function repairStudyDocumentImport(document) {
  const repairedDocument = structuredClone(document);
  const repairs = [];

  visitNodes(repairedDocument?.content, "$.content", repairs);
  return { document: repairedDocument, repairs };
}

export function repairMissingStudyDocumentNodeTypes(document) {
  return repairStudyDocumentImport(document);
}

function visitNodes(nodes, path, repairs) {
  if (!Array.isArray(nodes)) return;
  nodes.forEach((node, index) => visitNode(node, `${path}[${index}]`, repairs));
}

function visitNode(node, path, repairs) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;

  if (!Object.hasOwn(node, "type")) {
    const inferredType = inferUnambiguousNodeType(node);
    if (inferredType) {
      node.type = inferredType;
      repairs.push({ path: `${path}.type`, value: inferredType });
    }
  }

  if (node.type === "group" && node.role === "generic" && isUnambiguousQuestionGroup(node)) {
    node.role = "question";
    repairs.push({ path: `${path}.role`, value: "question" });
  }

  if (node.type === "group" || node.type === "flow") {
    visitNodes(node.children, `${path}.children`, repairs);
    return;
  }
  if (node.type === "list" && Array.isArray(node.items)) {
    node.items.forEach((item, index) => visitNodes(item?.children, `${path}.items[${index}].children`, repairs));
    return;
  }
  if (node.type === "table" && Array.isArray(node.rows)) {
    node.rows.forEach((row, rowIndex) => {
      if (!Array.isArray(row?.cells)) return;
      row.cells.forEach((cell, cellIndex) => {
        visitNodes(cell?.children, `${path}.rows[${rowIndex}].cells[${cellIndex}].children`, repairs);
      });
    });
  }
}

function isUnambiguousQuestionGroup(group) {
  let hasNumber = false;
  let hasQuestionText = false;
  let hasResponseStructure = false;

  const visit = nodes => {
    (Array.isArray(nodes) ? nodes : []).forEach(node => {
      if (!node || typeof node !== "object" || Array.isArray(node)) return;
      if (node.type === "text" && node.role === "number" && String(node.value || "").trim()) hasNumber = true;
      if (node.type === "text" && node.role === "question" && String(node.value || "").trim()) hasQuestionText = true;
      if (node.type === "list" && node.role === "choices") hasResponseStructure = true;
      if (node.type === "gap" && node.display === "block") hasResponseStructure = true;
      visit(node.children);
    });
  };

  visit(group.children);
  return hasNumber && (hasQuestionText || hasResponseStructure);
}

function inferUnambiguousNodeType(node) {
  if (Object.hasOwn(node, "value")) return "text";
  if (Object.hasOwn(node, "display") || Object.hasOwn(node, "style") || Object.hasOwn(node, "lines")) return "gap";
  if (Object.hasOwn(node, "assetId") || Object.hasOwn(node, "placement") || Object.hasOwn(node, "placeholder") || Object.hasOwn(node, "aspectRatio")) return "graphic";
  if (Object.hasOwn(node, "items") || Object.hasOwn(node, "marker") || Object.hasOwn(node, "selectionControl")) return "list";
  if (Object.hasOwn(node, "rows")) return "table";
  if (Array.isArray(node.children)) {
    if (Object.hasOwn(node, "layout") || Object.hasOwn(node, "role")) return "group";
    return "flow";
  }
  return null;
}
