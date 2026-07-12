export function repairMissingStudyDocumentNodeTypes(document) {
  const repairedDocument = structuredClone(document);
  const repairs = [];

  visitNodes(repairedDocument?.content, "$.content", repairs);
  return { document: repairedDocument, repairs };
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
