export function normalizedSearchText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function searchTerms(query) {
  const normalized = normalizedSearchText(query);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

export function normalizedPageSearchText(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function pageSearchTokens(value) {
  return [...new Set(normalizedPageSearchText(value).split(" ").filter(Boolean))];
}
