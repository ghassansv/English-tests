import { escapeHtml, icon, joinHtml } from "./render-utils.js";

export function metaLineHtml(items = []) {
  return `
    <div class="meta-line">
      ${joinHtml(items.filter(Boolean), item => `<span>${escapeHtml(item)}</span>`)}
    </div>
  `;
}

export function iconButtonHtml({ iconName, title, data = {}, danger = false }) {
  const dataAttrs = Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([name, value]) => ` data-${name}="${escapeHtml(value)}"`)
    .join("");
  return `<button class="icon-button${danger ? " danger-button" : ""}" type="button" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"${dataAttrs}>${icon(iconName)}</button>`;
}

export function cardHeaderHtml({ titleHtml, chips = [], meta = [], actions = [] }) {
  return `
    <div class="study-text-header">
      <div class="study-text-title">
        <div class="title-line">
          ${titleHtml}
          ${joinHtml(chips.filter(Boolean), chip => `<span class="pos-chip">${escapeHtml(chip)}</span>`)}
        </div>
        ${metaLineHtml(meta)}
      </div>
      <div class="row-actions">
        ${joinHtml(actions, action => action)}
      </div>
    </div>
  `;
}
