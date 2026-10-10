import { Annotation } from './model';

/** Minimal view of a vscode.SourceBreakpoint. Lines are 0-based. */
export interface BreakpointRef {
  id: string;
  uri: string;
  line: number;
}

export interface BreakpointDelta {
  added: readonly BreakpointRef[];
  removed: readonly BreakpointRef[];
  changed: readonly BreakpointRef[];
}

export interface ReconcileResult {
  annotations: Annotation[];
  /** Ids of annotations deleted because their breakpoint was removed. */
  removedIds: string[];
  /** Annotations kept but with no breakpoint at their location. */
  orphans: Annotation[];
  /** True when anything differs from the input. */
  changed: boolean;
}

function sameLocation(a: Annotation, bp: BreakpointRef): boolean {
  return a.location.uri === bp.uri && a.location.line === bp.line;
}

/** Moves an annotation to a new line, shifting its highlights by the same amount. */
export function moveAnnotation(a: Annotation, line: number): Annotation {
  const delta = line - a.location.line;
  if (delta === 0) {
    return a;
  }
  return {
    ...a,
    location: { ...a.location, line },
    highlights: a.highlights.map((h) => ({
      ...h,
      startLine: Math.max(0, h.startLine + delta),
      endLine: Math.max(0, h.endLine + delta),
    })),
  };
}

/**
 * Re-associates annotations with the current breakpoints.
 *
 * - `current` is the full list of source breakpoints after the change.
 * - `delta` is the change event, if any. Without it (activation), nothing is deleted: annotations with
 *   no breakpoint are reported as orphans so the caller can decide what to do.
 */
export function reconcile(
  annotations: readonly Annotation[],
  current: readonly BreakpointRef[],
  delta?: BreakpointDelta,
): ReconcileResult {
  const currentById = new Map(current.map((bp) => [bp.id, bp]));
  const removedIds = new Set(delta?.removed.map((bp) => bp.id) ?? []);
  const result: Annotation[] = [];
  const deleted: string[] = [];
  const orphans: Annotation[] = [];
  let changed = false;

  for (const original of annotations) {
    let a = original;
    const own = a.breakpointId ? currentById.get(a.breakpointId) : undefined;

    if (own) {
      // Same breakpoint, possibly moved to another line.
      if (own.uri === a.location.uri && own.line !== a.location.line) {
        a = moveAnnotation(a, own.line);
      }
    } else {
      const wasRemoved =
        (a.breakpointId !== undefined && removedIds.has(a.breakpointId)) ||
        (delta?.removed.some((bp) => sameLocation(a, bp)) ?? false);
      const atLocation = current.find((bp) => sameLocation(a, bp));
      if (atLocation) {
        if (a.breakpointId !== atLocation.id) {
          a = { ...a, breakpointId: atLocation.id };
        }
      } else if (wasRemoved) {
        deleted.push(a.id);
        changed = true;
        continue;
      } else {
        orphans.push(a);
      }
    }

    if (a !== original) {
      changed = true;
    }
    result.push(a);
  }

  return { annotations: result, removedIds: deleted, orphans, changed };
}
