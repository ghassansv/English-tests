import { validateStudyDocumentV1 } from "./study-document-v1.js";

const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;

export function renderStudyDocumentV1ToHtml(document, options = {}) {
  const validation = validateStudyDocumentV1(document);
  if (!validation.valid) {
    const first = validation.errors[0];
    throw new Error(`Invalid study-document/v1 at ${first?.path || "$"}: ${first?.message || "Validation failed."}`);
  }

  const markerPageId = options.markerPageId
    ? ` data-test-page-marker-page-id="${escapeAttribute(options.markerPageId)}"`
    : "";
  const language = options.language === "ar" ? "ar" : "en";
  const direction = language === "ar" ? "rtl" : "ltr";
  const renderOptions = {
    ...options,
    answerByQuestionId: new Map((Array.isArray(options.answers) ? options.answers : []).map(answer => [answer.questionId, answer]))
  };
  const body = document.content.map(node => renderNode(node, renderOptions)).join("");

  return `
    <div class="page-layout-scroll study-document-scroll">
      <div class="page-layout-viewport">
        <article
          class="page-layout-page study-document-rendered-page study-document-rendered-page--${language}"
          data-test-page-marker-surface${markerPageId}
          data-layout-language="${language}"
          lang="${language}"
          dir="${direction}"
          data-layout-width="${PAGE_WIDTH}"
          data-layout-height="${PAGE_HEIGHT}"
          data-study-document-id="${escapeAttribute(document.documentId)}"
          style="width:${PAGE_WIDTH}px;height:${PAGE_HEIGHT}px;"
        >
          ${body}
          ${options.overlayHtml || ""}
        </article>
      </div>
    </div>
  `;
}

function renderNode(node, options, context = {}) {
  switch (node.type) {
    case "group": return renderGroup(node, options, context);
    case "text": return renderText(node, options, context);
    case "flow": return renderFlow(node, options);
    case "gap": return renderGap(node, options);
    case "list": return renderList(node, options, context);
    case "graphic": return renderGraphic(node, options, context);
    case "table": return renderTable(node, options, context);
    case "rule": return `<hr class="study-document-rule study-document-rule--${escapeAttribute(node.role)}" data-study-node-id="${escapeAttribute(node.id)}">`;
    default: return "";
  }
}

function renderGroup(node, options, context = {}) {
  const classes = [
    "study-document-group",
    `study-document-group--${node.role}`,
    `study-document-layout--${node.layout}`
  ].join(" ");
  const columnStyle = node.columnCount ? ` style="--study-column-count:${node.columnCount}"` : "";
  const flowMode = node.flowMode ? ` data-study-flow-mode="${escapeAttribute(node.flowMode)}"` : "";
  const answer = node.role === "question" && options.showAnswers
    ? options.answerByQuestionId.get(node.id)
    : context.questionAnswer || null;
  const children = node.children.map(child => renderNode(child, options, { questionAnswer: answer })).join("");
  const textAnswer = node.role === "question" && answer?.kind === "text"
    ? `<div class="study-document-official-answer"><strong>${escapeText(answerLabel(options))}</strong><span>${escapeText(answer.value)}</span></div>`
    : "";
  return `<section class="${classes}${node.role === "question" && answer ? " study-document-question--answered" : ""}" data-study-node-id="${escapeAttribute(node.id)}"${flowMode}${columnStyle}>${children}${textAnswer}</section>`;
}

function renderText(node, options, context = {}) {
  const content = typeof options.renderText === "function"
    ? options.renderText(node.value, node)
    : escapeText(node.value).replace(/\r?\n/g, "<br>");
  const tag = context.inline ? "span" : textTag(node.role);
  return `<${tag} class="study-document-text study-document-text--${escapeAttribute(node.role)}" data-study-node-id="${escapeAttribute(node.id)}">${content}</${tag}>`;
}

function renderFlow(node, options) {
  return `<div class="study-document-flow" data-study-node-id="${escapeAttribute(node.id)}">${node.children.map(child => renderNode(child, options, { inline: true })).join("")}</div>`;
}

function renderGap(node, options) {
  const label = node.label ? `<span class="study-document-gap-label">${escapeText(node.label)}</span>` : "";
  const answer = options.showAnswers ? options.answerByQuestionId.get(node.id) : null;
  const answerText = answer?.kind === "gap" ? escapeText(answer.value) : "";
  if (node.display === "inline") {
    const value = answerText ? `<span class="study-document-gap-answer">${answerText}</span>` : "";
    return `<span class="study-document-gap study-document-gap--inline study-document-gap--${escapeAttribute(node.style)} study-document-gap-size--${escapeAttribute(node.size || "medium")}${answerText ? " study-document-gap--answered" : ""}" data-study-node-id="${escapeAttribute(node.id)}">${label}${value}</span>`;
  }
  const lines = Array.from({ length: node.lines || 1 }, (_, index) => (
    index === 0 && answerText ? `<span class="study-document-gap-answer">${answerText}</span>` : "<span></span>"
  )).join("");
  return `<div class="study-document-gap study-document-gap--block study-document-gap--${escapeAttribute(node.style)}${answerText ? " study-document-gap--answered" : ""}" data-study-node-id="${escapeAttribute(node.id)}">${label}${lines}</div>`;
}

function renderList(node, options, context = {}) {
  const tag = node.marker === "bullet" ? "ul" : "ol";
  const selectionClass = node.selectionControl ? ` study-document-selection--${escapeAttribute(node.selectionControl)}` : "";
  return `<${tag} class="study-document-list study-document-list--${escapeAttribute(node.role)} study-document-marker--${escapeAttribute(node.marker)}${selectionClass}" data-study-node-id="${escapeAttribute(node.id)}">${node.items.map(item => {
    const correct = node.role === "choices" && context.questionAnswer?.kind === "choice" && context.questionAnswer.choiceItemId === item.id;
    const itemContent = item.children.map(child => renderNode(child, options)).join("");
    const selectionControl = node.selectionControl === "checkbox"
      ? `<span class="study-document-choice-control study-document-choice-control--checkbox${correct ? " is-checked" : ""}" aria-hidden="true">${correct ? "✓" : ""}</span>`
      : "";
    const badge = correct
      ? `<span class="study-document-official-answer-badge">✓ ${escapeText(answerLabel(options))}</span>`
      : "";
    const row = selectionControl
      ? `<div class="study-document-choice-row"><div class="study-document-choice-content">${itemContent}</div>${selectionControl}</div>`
      : itemContent;
    return `<li class="${correct ? "study-document-choice--correct" : ""}" data-study-item-id="${escapeAttribute(item.id)}">${row}${badge}</li>`;
  }).join("")}</${tag}>`;
}

function renderGraphic(node, options, context = {}) {
  const source = typeof options.resolveAsset === "function" ? options.resolveAsset(node) : "";
  const aspectRatio = Number(node.aspectRatio) > 0 ? Number(node.aspectRatio) : 1.6;
  const style = `--study-graphic-aspect:${aspectRatio}`;
  const classes = `study-document-graphic study-document-graphic--${escapeAttribute(node.role)} study-document-graphic-size--${escapeAttribute(node.size)} study-document-graphic-placement--${escapeAttribute(node.placement)}`;
  const tag = context.inline ? "span" : "figure";
  const editAttributes = options.editGraphics
    ? ` data-edit-study-document-graphic="${escapeAttribute(node.id)}" role="button" tabindex="0" title="Crop or replace this ${escapeAttribute(graphicLabel(node.role).toLowerCase())}"`
    : "";
  if (source) {
    return `<${tag} class="${classes}${options.editGraphics ? " study-document-graphic--editable" : ""}" data-study-node-id="${escapeAttribute(node.id)}"${editAttributes} style="${style}"><img src="${escapeAttribute(source)}" alt=""></${tag}>`;
  }
  return `<${tag} class="${classes} study-document-graphic--placeholder${options.editGraphics ? " study-document-graphic--editable" : ""}" data-study-node-id="${escapeAttribute(node.id)}"${editAttributes} style="${style}"><span>${escapeText(graphicLabel(node.role))}</span></${tag}>`;
}

function renderTable(node, options, context = {}) {
  const rows = node.rows.map(row => `<tr data-study-row-id="${escapeAttribute(row.id)}">${row.cells.map(cell => `<td data-study-cell-id="${escapeAttribute(cell.id)}">${cell.children.map(child => renderNode(child, options, context)).join("")}</td>`).join("")}</tr>`).join("");
  return `<table class="study-document-table study-document-table--${escapeAttribute(node.role)}" data-study-node-id="${escapeAttribute(node.id)}"><tbody>${rows}</tbody></table>`;
}

function textTag(role) {
  if (role === "title") return "h1";
  if (role === "subtitle") return "h2";
  if (role === "heading") return "h3";
  return "p";
}

function graphicLabel(role) {
  return role === "unknown" ? "Visual" : `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

function answerLabel(options) {
  return options.language === "ar" ? "الإجابة الرسمية" : "Official answer";
}

function escapeText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeText(value)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
