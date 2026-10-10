import { highlightsToFile } from './tourFormat';
import { Annotation, isFileContent, sortByOrder } from './model';
import { StepInfo, StepViewState, WatchView } from './webview/protocol';

/** How the shown step's content is presented. */
export interface ContentView {
  html: string;
  base?: string;
  file?: string;
  page: boolean;
  error?: string;
}

export interface StopInfo {
  annotationId: string;
  /** Undefined while evaluating. */
  watches: WatchView[] | undefined;
  generation: number;
}

export interface StepStateInput {
  annotations: readonly Annotation[];
  selectedId: string | undefined;
  stop: StopInfo | undefined;
  /** A debug session is active (running or stopped anywhere). */
  inSession: boolean;
  isStale: (id: string) => boolean;
  location: (annotation: Annotation) => string;
  content: ContentView;
}

/**
 * What "Current Step" shows: the step where execution is stopped, otherwise the selected one.
 * Navigation browses the tour and is not offered while a debug session is active.
 */
export function buildStepState(input: StepStateInput): StepViewState {
  const sorted = sortByOrder(input.annotations);
  const shownId = input.stop?.annotationId ?? input.selectedId;
  const index = sorted.findIndex((a) => a.id === shownId);
  const annotation = index >= 0 ? sorted[index] : undefined;
  const stopped = annotation !== undefined && input.stop?.annotationId === annotation.id;

  const base: StepViewState = {
    empty: sorted.length === 0,
    hasPrev: false,
    hasNext: false,
    navEnabled: !input.inSession && !stopped,
    stopped,
    watchStatus: 'idle',
    results: [],
  };
  if (!annotation) {
    return base;
  }

  const step: StepInfo = {
    id: annotation.id,
    order: annotation.order,
    total: sorted.length,
    title: annotation.title,
    contentText: isFileContent(annotation.content) ? undefined : annotation.content,
    contentHtml: input.content.html,
    contentBase: input.content.base,
    contentFile: input.content.file,
    contentPage: input.content.page,
    contentError: input.content.error,
    location: input.location(annotation),
    stale: input.isStale(annotation.id),
    anchorText: annotation.anchorText,
    highlights: highlightsToFile(annotation.highlights),
    watches: [...annotation.watches],
  };
  const results = stopped ? input.stop?.watches : undefined;
  return {
    ...base,
    step,
    hasPrev: index > 0,
    hasNext: index < sorted.length - 1,
    watchStatus: !stopped ? 'idle' : results ? 'values' : 'evaluating',
    results: results ?? [],
    generation: stopped ? input.stop?.generation : undefined,
  };
}

/** Id of the neighbour step in tour order, if any. */
export function neighbourId(annotations: readonly Annotation[], id: string, direction: -1 | 1): string | undefined {
  const sorted = sortByOrder(annotations);
  const index = sorted.findIndex((a) => a.id === id);
  return index < 0 ? undefined : sorted[index + direction]?.id;
}
