export function pipe(value, ...steps) {
  return steps.reduce((current, step) => step(current), value);
}

export function joinHtml(items, render) {
  return (Array.isArray(items) ? items : []).map(render).join("");
}

export function classNames(...values) {
  return values
    .flatMap(value => Array.isArray(value) ? value : [value])
    .filter(Boolean)
    .join(" ");
}

export function emptyStateHtml(message) {
  return statusBlockHtml("empty-state", message);
}

export function lookupStateHtml(message) {
  return statusBlockHtml("lookup-empty", message);
}

export function imageMapperStateHtml(message) {
  return statusBlockHtml("image-mapper-empty", message);
}

export function icon(name, className = "") {
  return `<i class="${escapeHtml(className)}" data-lucide="${escapeHtml(name)}"></i>`;
}

export function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function statusBlockHtml(className, message) {
  return `<div class="${className}">${escapeHtml(message)}</div>`;
}
