import * as path from 'path';
import * as vscode from 'vscode';
import { findBreakpointAt, findBreakpointById } from './breakpointSync';
import { Annotation } from './model';
import { normalizeFsPath } from './paths';
import { AnnotationStore } from './store';

/** Client requests that resume execution, so the current step stops being valid. */
const RESUME_COMMANDS: ReadonlySet<string> = new Set([
  'continue',
  'next',
  'stepIn',
  'stepOut',
  'stepBack',
  'reverseContinue',
  'goto',
  'restartFrame',
  'restart',
]);

const EVALUATE_TIMEOUT_MS = 5000;
/** Grace period for the editor to focus a frame after a DAP "stopped" event. */
const STOPPED_FALLBACK_DELAY_MS = 400;
const STACK_PAGE_SIZE = 50;
const MAX_STACK_FRAMES = 500;

export interface WatchResult {
  expression: string;
  value?: string;
  type?: string;
  variablesReference: number;
  error?: string;
}

export interface VariableResult {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

export interface ActiveStop {
  session: vscode.DebugSession;
  threadId: number;
  frameId: number;
  annotationId: string;
  /** Undefined while the evaluations are running. */
  watches: WatchResult[] | undefined;
  /** Increases on every stop and every resume; references from older stops are invalid. */
  generation: number;
}

/**
 * A run starts with a top-level process session: a launch/attach without parent, or a process started
 * from a JavaScript Debug Terminal (whose own session only spawns them). Child sessions (vitest workers,
 * `node --test` files, subprocesses) belong to the same run.
 */
function isRunRoot(session: vscode.DebugSession): boolean {
  if (session.type === 'node-terminal') {
    return false;
  }
  const parent = session.parentSession;
  return !parent || parent.type === 'node-terminal';
}

interface DapStackFrame {
  id: number;
  line: number;
  source?: { path?: string };
}

interface FrameLocation {
  fsPath: string;
  /** 0-based. */
  line: number;
}

function withTimeout<T>(promise: Thenable<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no response from the debugger after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toLocation(frame: DapStackFrame): FrameLocation | undefined {
  const p = frame.source?.path;
  if (!p || !path.isAbsolute(p)) {
    return undefined;
  }
  return { fsPath: p, line: frame.line - 1 };
}

/**
 * Watches the debugger and exposes the annotated step where execution is stopped, together with
 * the values of its watch expressions evaluated against the stopped frame.
 */
export class StopController implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<ActiveStop | undefined>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly runEndEmitter = new vscode.EventEmitter<string[]>();
  /** Fires with the hit order when the root session of a run terminates. */
  readonly onDidFinishRun = this.runEndEmitter.event;

  private active: ActiveStop | undefined;
  private generation = 0;
  private readonly pendingStops = new Map<string, ReturnType<typeof setTimeout>>();
  /** Sessions with a "stopped" event not yet matched to a frame. */
  private readonly freshStops = new Set<string>();
  private runRootId: string | undefined;
  private runHits: string[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly store: AnnotationStore) {
    this.disposables.push(
      vscode.debug.onDidChangeActiveStackItem((item) => this.onActiveStackItem(item)),
      vscode.debug.registerDebugAdapterTrackerFactory('*', {
        createDebugAdapterTracker: (session) => this.createTracker(session),
      }),
      vscode.debug.onDidStartDebugSession((session) => this.onSessionStart(session)),
      vscode.debug.onDidTerminateDebugSession((session) => this.onSessionEnd(session)),
      store.onDidChange(() => this.onStoreChange()),
    );
    this.onActiveStackItem(vscode.debug.activeStackItem);
  }

  /** Annotation ids in the order execution first stopped on them, in the current or last run. */
  get lastRunHits(): string[] {
    return [...this.runHits];
  }

  private onSessionStart(session: vscode.DebugSession): void {
    if (isRunRoot(session)) {
      this.runRootId = session.id;
      this.runHits = [];
    }
  }

  private onSessionEnd(session: vscode.DebugSession): void {
    this.freshStops.delete(session.id);
    this.clear(session);
    if (session.id === this.runRootId) {
      this.runRootId = undefined;
      this.runEndEmitter.fire(this.lastRunHits);
    }
  }

  get current(): ActiveStop | undefined {
    return this.active;
  }

  /** Children of an expandable value. Empty when the stop it belongs to is gone. */
  async variables(generation: number, variablesReference: number): Promise<VariableResult[]> {
    const stop = this.active;
    if (!stop || stop.generation !== generation || variablesReference <= 0) {
      return [];
    }
    const res = (await withTimeout(
      stop.session.customRequest('variables', { variablesReference }),
      EVALUATE_TIMEOUT_MS,
    )) as { variables?: VariableResult[] };
    return res.variables ?? [];
  }

  /** Evaluates the watches of the current step again (after editing them). */
  async reevaluate(): Promise<void> {
    const stop = this.active;
    if (!stop) {
      return;
    }
    const annotation = this.store.get(stop.annotationId);
    if (!annotation) {
      this.clear();
      return;
    }
    await this.show(stop.session, stop.threadId, stop.frameId, annotation);
  }

  private createTracker(session: vscode.DebugSession): vscode.DebugAdapterTracker {
    return {
      onWillReceiveMessage: (message: { type?: string; command?: string }) => {
        if (message.type === 'request' && message.command && RESUME_COMMANDS.has(message.command)) {
          this.clear(session);
        }
      },
      onDidSendMessage: (message: { type?: string; event?: string; body?: { threadId?: number } }) => {
        if (message.type !== 'event') {
          return;
        }
        switch (message.event) {
          case 'stopped':
            if (message.body?.threadId !== undefined) {
              this.freshStops.add(session.id);
              this.scheduleFallback(session, message.body.threadId);
            }
            break;
          case 'continued':
          case 'terminated':
          case 'exited':
            this.clear(session);
            break;
        }
      },
      onExit: () => this.clear(session),
    };
  }

  private onActiveStackItem(item: vscode.DebugThread | vscode.DebugStackFrame | undefined): void {
    if (!(item instanceof vscode.DebugStackFrame)) {
      return;
    }
    this.cancelFallback(item.session);
    void this.handleFrame(item.session, item.threadId, item.frameId);
  }

  /**
   * Backup path: if no frame gets focused shortly after a "stopped" event (for example a child
   * session that the editor does not focus), resolve the top frame ourselves.
   */
  private scheduleFallback(session: vscode.DebugSession, threadId: number): void {
    this.cancelFallback(session);
    const timer = setTimeout(() => {
      this.pendingStops.delete(session.id);
      if (this.active) {
        return;
      }
      void this.handleTopFrame(session, threadId);
    }, STOPPED_FALLBACK_DELAY_MS);
    this.pendingStops.set(session.id, timer);
  }

  private cancelFallback(session: vscode.DebugSession): void {
    const timer = this.pendingStops.get(session.id);
    if (timer) {
      clearTimeout(timer);
      this.pendingStops.delete(session.id);
    }
  }

  private async handleTopFrame(session: vscode.DebugSession, threadId: number): Promise<void> {
    try {
      const res = (await session.customRequest('stackTrace', { threadId, startFrame: 0, levels: 1 })) as {
        stackFrames?: DapStackFrame[];
      };
      const top = res.stackFrames?.[0];
      if (top) {
        await this.handleFrame(session, threadId, top.id, top);
      }
    } catch {
      // The session may already be running again; nothing to show.
    }
  }

  private async handleFrame(
    session: vscode.DebugSession,
    threadId: number,
    frameId: number,
    knownFrame?: DapStackFrame,
  ): Promise<void> {
    const stop = this.active;
    if (stop && stop.session.id === session.id && stop.threadId === threadId && stop.frameId === frameId) {
      return;
    }
    const generation = ++this.generation;
    // Only the first frame handled after a "stopped" event counts as a hit (not call stack clicks).
    const fresh = this.freshStops.delete(session.id);
    let location: FrameLocation | undefined;
    try {
      location = knownFrame ? toLocation(knownFrame) : await this.locateFrame(session, threadId, frameId);
    } catch {
      location = undefined;
    }
    if (generation !== this.generation) {
      return;
    }
    const annotation = location ? await this.findAnnotation(session, location) : undefined;
    if (generation !== this.generation) {
      return;
    }
    if (!annotation) {
      this.setActive(undefined);
      return;
    }
    if (fresh && !this.runHits.includes(annotation.id)) {
      this.runHits.push(annotation.id);
    }
    await this.show(session, threadId, frameId, annotation);
  }

  private async show(
    session: vscode.DebugSession,
    threadId: number,
    frameId: number,
    annotation: Annotation,
  ): Promise<void> {
    const generation = ++this.generation;
    this.setActive({ session, threadId, frameId, annotationId: annotation.id, watches: undefined, generation });

    const watches: WatchResult[] = [];
    for (const expression of annotation.watches) {
      watches.push(await this.evaluate(session, frameId, expression));
      if (generation !== this.generation) {
        return;
      }
    }
    this.setActive({ session, threadId, frameId, annotationId: annotation.id, watches, generation });
  }

  private async evaluate(session: vscode.DebugSession, frameId: number, expression: string): Promise<WatchResult> {
    try {
      const res = (await withTimeout(
        session.customRequest('evaluate', { expression, frameId, context: 'watch' }),
        EVALUATE_TIMEOUT_MS,
      )) as { result?: string; type?: string; variablesReference?: number };
      return {
        expression,
        value: res.result ?? '',
        type: res.type,
        variablesReference: res.variablesReference ?? 0,
      };
    } catch (err) {
      return { expression, error: errorMessage(err), variablesReference: 0 };
    }
  }

  private async locateFrame(
    session: vscode.DebugSession,
    threadId: number,
    frameId: number,
  ): Promise<FrameLocation | undefined> {
    for (let startFrame = 0; startFrame < MAX_STACK_FRAMES; startFrame += STACK_PAGE_SIZE) {
      const res = (await session.customRequest('stackTrace', {
        threadId,
        startFrame,
        levels: STACK_PAGE_SIZE,
      })) as { stackFrames?: DapStackFrame[]; totalFrames?: number };
      const frames = res.stackFrames ?? [];
      const frame = frames.find((f) => f.id === frameId);
      if (frame) {
        return toLocation(frame);
      }
      const total = res.totalFrames ?? 0;
      if (frames.length < STACK_PAGE_SIZE || (total > 0 && startFrame + STACK_PAGE_SIZE >= total)) {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Matches the frame location against annotations. Besides the annotated line, it accepts the line
   * where the debugger actually bound the breakpoint (source maps can shift it).
   */
  private async findAnnotation(session: vscode.DebugSession, location: FrameLocation): Promise<Annotation | undefined> {
    const key = normalizeFsPath(location.fsPath);
    const candidates = this.store
      .all()
      .filter((a) => {
        const uri = vscode.Uri.parse(a.location.uri);
        return uri.scheme === 'file' && normalizeFsPath(uri.fsPath) === key;
      });
    const exact = candidates.find((a) => a.location.line === location.line);
    if (exact) {
      return exact;
    }
    for (const a of candidates) {
      const bp = findBreakpointById(a.breakpointId) ?? findBreakpointAt(a.location.uri, a.location.line);
      if (!bp) {
        continue;
      }
      try {
        const dap = (await session.getDebugProtocolBreakpoint(bp)) as { line?: number } | undefined;
        if (dap?.line !== undefined && dap.line - 1 === location.line) {
          return a;
        }
      } catch {
        // Breakpoint unknown to this session.
      }
    }
    return undefined;
  }

  private onStoreChange(): void {
    const stop = this.active;
    if (!stop) {
      return;
    }
    const annotation = this.store.get(stop.annotationId);
    if (!annotation) {
      this.clear();
      return;
    }
    const evaluated = stop.watches?.map((w) => w.expression);
    if (evaluated && evaluated.join('\n') !== annotation.watches.join('\n')) {
      void this.reevaluate();
    } else {
      // Title, comment or highlights may have changed; let views refresh.
      this.changeEmitter.fire(this.active);
    }
  }

  /** Clears the current step (only if it belongs to `session`, when given). */
  clear(session?: vscode.DebugSession): void {
    if (session) {
      this.cancelFallback(session);
    }
    if (!this.active || (session && this.active.session.id !== session.id)) {
      return;
    }
    this.generation++;
    this.setActive(undefined);
  }

  private setActive(stop: ActiveStop | undefined): void {
    if (!stop && !this.active) {
      return;
    }
    this.active = stop;
    this.changeEmitter.fire(stop);
  }

  dispose(): void {
    this.pendingStops.forEach((t) => clearTimeout(t));
    this.changeEmitter.dispose();
    this.runEndEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
