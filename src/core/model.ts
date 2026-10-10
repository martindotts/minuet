/** A highlighted range inside the step's file. Lines are 0-based and inclusive. */
export interface Highlight {
  startLine: number;
  endLine: number;
  note?: string;
}

/**
 * What a step (or the tour context) explains: inline markdown, or a `.md` / `.html` file whose path is
 * relative to the folder of the tour file.
 */
export type Content = string | { file: string };

export const CONTENT_FILE_EXTENSIONS = ['.md', '.markdown', '.html', '.htm'];

export function isFileContent(content: Content): content is { file: string } {
  return typeof content === 'object' && content !== null;
}

export function isHtmlFile(file: string): boolean {
  return /\.html?$/i.test(file);
}

/** The inline markdown, or '' when the content is a file. */
export function contentText(content: Content): string {
  return isFileContent(content) ? '' : content;
}

/** One step per breakpoint. Lines are 0-based. */
export interface Step {
  id: string;
  /** vscode.Breakpoint.id of the associated breakpoint. Not stable across sessions. */
  breakpointId?: string;
  location: {
    /** File uri, as produced by vscode.Uri.toString(). */
    uri: string;
    line: number;
  };
  /** Trimmed text of the breakpoint line when the step was created. */
  anchorText: string;
  order: number;
  title: string;
  content: Content;
  highlights: Highlight[];
  watches: string[];
}

/**
 * How to run the flow of a tour under the debugger: a debug configuration (the same object as in
 * launch.json), or the name of a configuration of the workspace.
 */
export type RunConfig = string | { type: string; request: string; [key: string]: unknown };

/** Tour-level data that is not attached to a single breakpoint. */
export interface TourMeta {
  title: string;
  context: Content;
  run?: RunConfig;
}

export const EMPTY_META: TourMeta = { title: '', context: '' };

export function sortByOrder(steps: readonly Step[]): Step[] {
  return [...steps].sort((a, b) => a.order - b.order);
}

/** Returns a copy whose orders are 1..n, preserving the current relative order. */
export function renumber(steps: readonly Step[]): Step[] {
  return sortByOrder(steps).map((a, i) => (a.order === i + 1 ? a : { ...a, order: i + 1 }));
}
