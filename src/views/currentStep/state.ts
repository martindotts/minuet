import { Step, isFileContent, sortByOrder } from '../../core/model';
import { highlightsToFile } from '../../core/tourFormat';
import { StepInfo, StepViewState, WatchView } from './protocol';

/** How the shown step's content is presented. */
export interface ContentView {
  html: string;
  base?: string;
  file?: string;
  page: boolean;
  error?: string;
}

export interface StopInfo {
  stepId: string;
  /** Undefined while evaluating. */
  watches: WatchView[] | undefined;
  generation: number;
}

export interface StepStateInput {
  steps: readonly Step[];
  selectedId: string | undefined;
  stop: StopInfo | undefined;
  /** A debug session is active (running or stopped anywhere). */
  inSession: boolean;
  isStale: (id: string) => boolean;
  location: (step: Step) => string;
  content: ContentView;
}

/**
 * What "Current Step" shows: the step where execution is stopped, otherwise the selected one.
 * Navigation browses the tour and is not offered while a debug session is active.
 */
export function buildStepState(input: StepStateInput): StepViewState {
  const sorted = sortByOrder(input.steps);
  const shownId = input.stop?.stepId ?? input.selectedId;
  const index = sorted.findIndex((a) => a.id === shownId);
  const shown = index >= 0 ? sorted[index] : undefined;
  const stopped = shown !== undefined && input.stop?.stepId === shown.id;

  const base: StepViewState = {
    empty: sorted.length === 0,
    hasPrev: false,
    hasNext: false,
    navEnabled: !input.inSession && !stopped,
    stopped,
    watchStatus: 'idle',
    results: [],
  };
  if (!shown) {
    return base;
  }

  const step: StepInfo = {
    id: shown.id,
    order: shown.order,
    total: sorted.length,
    title: shown.title,
    contentText: isFileContent(shown.content) ? undefined : shown.content,
    contentHtml: input.content.html,
    contentBase: input.content.base,
    contentFile: input.content.file,
    contentPage: input.content.page,
    contentError: input.content.error,
    location: input.location(shown),
    stale: input.isStale(shown.id),
    anchorText: shown.anchorText,
    highlights: highlightsToFile(shown.highlights),
    watches: [...shown.watches],
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
export function neighbourId(steps: readonly Step[], id: string, direction: -1 | 1): string | undefined {
  const sorted = sortByOrder(steps);
  const index = sorted.findIndex((a) => a.id === id);
  return index < 0 ? undefined : sorted[index + direction]?.id;
}
