/** Collapses runs of whitespace and trims, so indentation or spacing changes do not count. */
export function normalizeAnchor(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * An annotation is stale when the current text of its line no longer matches the text it was
 * anchored to. `lineText` is undefined when the line (or the file) no longer exists.
 */
export function isStale(anchorText: string, lineText: string | undefined): boolean {
  if (lineText === undefined) {
    return true;
  }
  return normalizeAnchor(anchorText) !== normalizeAnchor(lineText);
}
