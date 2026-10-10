/** Messages between the extension and the "Current Step" webview. Types only: shared by both sides. */

export interface ValueView {
  value?: string;
  type?: string;
  error?: string;
  variablesReference: number;
}

export interface WatchView extends ValueView {
  expression: string;
}

export interface VariableView extends ValueView {
  name: string;
}

/** A highlighted range, 1-based and inclusive (as shown to people). */
export interface HighlightView {
  startLine: number;
  endLine: number;
  note?: string;
}

export interface StepInfo {
  id: string;
  order: number;
  total: number;
  title: string;
  /** The inline markdown, for editing; undefined when the content comes from a file. */
  contentText?: string;
  /** Rendered markdown (inline or from a .md file), or the HTML of a page as written in its file. */
  contentHtml: string;
  /** Base URL for the relative paths of the content (its file's folder, or the tour's). */
  contentBase?: string;
  /** Path of the content file as written in the tour, when the content is a file. */
  contentFile?: string;
  /** The content is an HTML page: drawn isolated (Shadow DOM), without its scripts. */
  contentPage: boolean;
  /** The content file could not be read. */
  contentError?: string;
  /** "src/orders.js:14" */
  location: string;
  stale: boolean;
  anchorText: string;
  highlights: HighlightView[];
  watches: string[];
}

export type WatchStatus =
  /** Execution is not stopped on this step: no values. */
  | 'idle'
  | 'evaluating'
  | 'values';

export interface StepViewState {
  /** No steps in the workspace at all. */
  empty: boolean;
  step?: StepInfo;
  hasPrev: boolean;
  hasNext: boolean;
  /** Prev/next only browse the tour; hidden while a debug session is running (use the native controls). */
  navEnabled: boolean;
  /** Execution is stopped on the shown step. */
  stopped: boolean;
  watchStatus: WatchStatus;
  results: WatchView[];
  /** Identifies the stop the values belong to; expansion requests must send it back. */
  generation?: number;
}

export type ToWebview =
  | { type: 'state'; state: StepViewState }
  | { type: 'children'; requestId: number; children?: VariableView[]; error?: string }
  | { type: 'edit' };

export type FromWebview =
  | { type: 'ready' }
  | { type: 'open' }
  | { type: 'prev' }
  | { type: 'next' }
  | { type: 'reanchor'; id: string }
  /** `content` is undefined when the step's content is a file (only the title is edited here). */
  | { type: 'save'; id: string; title: string; content?: string }
  /** Shows the step's content in the Step Page tab. */
  | { type: 'openPage'; id: string }
  /** Opens the step's content file in the editor. */
  | { type: 'openContentFile'; id: string }
  | { type: 'addWatch'; id: string; expression: string }
  | { type: 'removeWatch'; id: string; expression: string }
  | { type: 'revealHighlight'; id: string; index: number }
  | { type: 'editHighlight'; id: string; index: number }
  | { type: 'removeHighlight'; id: string; index: number }
  /** Adds the lines selected in the editor as a highlight of the step. */
  | { type: 'addHighlight'; id: string }
  | { type: 'expand'; requestId: number; generation: number; variablesReference: number }
  | { type: 'copy'; text: string }
  /** Sent after every successful render, so the extension (and tests) know what is on screen. */
  | { type: 'rendered'; stepId?: string; stopped: boolean; generation?: number }
  /** A render failed; the view may be blank. */
  | { type: 'error'; message: string };
