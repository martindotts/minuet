import * as vscode from 'vscode';
import { Annotation } from './model';
import { BreakpointRef, reconcile } from './reconcile';
import { AnnotationStore } from './store';

/** How long to wait for the initial breakpoint snapshot before reconciling anyway. */
const INITIAL_SYNC_TIMEOUT_MS = 2000;

function toRef(bp: vscode.Breakpoint): BreakpointRef | undefined {
  if (!(bp instanceof vscode.SourceBreakpoint)) {
    return undefined;
  }
  return { id: bp.id, uri: bp.location.uri.toString(), line: bp.location.range.start.line };
}

function toRefs(bps: readonly vscode.Breakpoint[]): BreakpointRef[] {
  return bps.map(toRef).filter((r): r is BreakpointRef => r !== undefined);
}

export function findBreakpointAt(uri: string, line: number): vscode.SourceBreakpoint | undefined {
  return vscode.debug.breakpoints.find(
    (bp): bp is vscode.SourceBreakpoint =>
      bp instanceof vscode.SourceBreakpoint &&
      bp.location.uri.toString() === uri &&
      bp.location.range.start.line === line,
  );
}

export function findBreakpointById(id: string | undefined): vscode.SourceBreakpoint | undefined {
  if (!id) {
    return undefined;
  }
  return vscode.debug.breakpoints.find(
    (bp): bp is vscode.SourceBreakpoint => bp instanceof vscode.SourceBreakpoint && bp.id === id,
  );
}

export function newBreakpoint(uri: string, line: number): vscode.SourceBreakpoint {
  return new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.parse(uri), new vscode.Position(line, 0)));
}

/**
 * Keeps annotations attached to their breakpoints: deletes an annotation when its breakpoint is
 * removed and follows the breakpoint when it moves.
 */
export class BreakpointSync implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly store: AnnotationStore) {}

  /**
   * The extension host receives the breakpoint list asynchronously after the first subscription, so
   * `vscode.debug.breakpoints` can be empty right after activation. Wait for the first change event
   * (the initial snapshot) or a timeout before the full reconciliation.
   */
  start(): void {
    let resolveInitial: () => void = () => undefined;
    const initial = new Promise<void>((resolve) => (resolveInitial = resolve));
    const timer = setTimeout(resolveInitial, INITIAL_SYNC_TIMEOUT_MS);

    this.disposables.push(
      vscode.debug.onDidChangeBreakpoints((e) => {
        resolveInitial();
        this.enqueue(() => this.onChange(e));
      }),
      { dispose: () => clearTimeout(timer) },
    );
    // Touching the list also starts the breakpoint stream from the main process.
    void vscode.debug.breakpoints;

    void initial.then(() => this.enqueue(() => this.initialReconcile()));
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((err) => {
      console.error('[stepwise] breakpoint sync failed', err);
    });
  }

  private async onChange(e: vscode.BreakpointsChangeEvent): Promise<void> {
    const result = reconcile(this.store.all(), toRefs(vscode.debug.breakpoints), {
      added: toRefs(e.added),
      removed: toRefs(e.removed),
      changed: toRefs(e.changed),
    });
    if (result.changed) {
      await this.store.replaceAll(result.annotations);
    }
  }

  /**
   * Annotations without a breakpoint at activation get their breakpoint recreated. Deleting them
   * instead would lose the whole tour if the initial snapshot arrived late.
   */
  private async initialReconcile(): Promise<void> {
    const result = reconcile(this.store.all(), toRefs(vscode.debug.breakpoints));
    if (result.orphans.length > 0) {
      await this.recreateBreakpoints(result.annotations, result.orphans);
    } else if (result.changed) {
      await this.store.replaceAll(result.annotations);
    }
  }

  private async recreateBreakpoints(annotations: Annotation[], orphans: Annotation[]): Promise<void> {
    const created = new Map<string, vscode.SourceBreakpoint>();
    for (const a of orphans) {
      created.set(a.id, newBreakpoint(a.location.uri, a.location.line));
    }
    const updated = annotations.map((a) => {
      const bp = created.get(a.id);
      return bp ? { ...a, breakpointId: bp.id } : a;
    });
    // Persist the new ids first so the "added" event finds them already associated.
    await this.store.replaceAll(updated);
    vscode.debug.addBreakpoints([...created.values()]);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
