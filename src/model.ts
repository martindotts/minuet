/** A highlighted range inside the annotation's file. Lines are 0-based and inclusive. */
export interface Highlight {
  startLine: number;
  endLine: number;
  note?: string;
}

/** One annotation per breakpoint. Lines are 0-based. */
export interface Annotation {
  id: string;
  /** vscode.Breakpoint.id of the associated breakpoint. Not stable across sessions. */
  breakpointId?: string;
  location: {
    /** File uri, as produced by vscode.Uri.toString(). */
    uri: string;
    line: number;
  };
  /** Trimmed text of the breakpoint line when the annotation was created. */
  anchorText: string;
  order: number;
  title: string;
  /** Markdown. */
  comment: string;
  highlights: Highlight[];
  watches: string[];
}

/** Tour-level data that is not attached to a single breakpoint. */
export interface TourMeta {
  title: string;
  /** Markdown. */
  context: string;
}

export const EMPTY_META: TourMeta = { title: '', context: '' };

export function sortByOrder(annotations: readonly Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => a.order - b.order);
}

/** Returns a copy whose orders are 1..n, preserving the current relative order. */
export function renumber(annotations: readonly Annotation[]): Annotation[] {
  return sortByOrder(annotations).map((a, i) => (a.order === i + 1 ? a : { ...a, order: i + 1 }));
}
