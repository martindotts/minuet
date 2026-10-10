import * as vscode from 'vscode';
import { isStale } from '../core/staleness';
import { StepStore } from './stepStore';

const RECOMPUTE_DELAY_MS = 300;

/** Tracks which steps no longer match the text of their breakpoint line. */
export class StaleTracker implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  private stale = new Set<string>();
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  constructor(private readonly store: StepStore) {
    this.disposables.push(
      store.onDidChange(() => this.schedule()),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.store.all().some((a) => a.location.uri === e.document.uri.toString())) {
          this.schedule();
        }
      }),
    );
    this.schedule(0);
  }

  isStale(id: string): boolean {
    return this.stale.has(id);
  }

  /** Recomputes right away; used after imports to report how many steps are stale. */
  async refresh(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.recompute();
  }

  private schedule(delay = RECOMPUTE_DELAY_MS): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.recompute();
    }, delay);
  }

  private async recompute(): Promise<void> {
    const generation = ++this.generation;
    const next = new Set<string>();
    for (const a of this.store.all()) {
      const lineText = await readLine(vscode.Uri.parse(a.location.uri), a.location.line);
      if (isStale(a.anchorText, lineText)) {
        next.add(a.id);
      }
    }
    if (generation !== this.generation) {
      return;
    }
    const changed = next.size !== this.stale.size || [...next].some((id) => !this.stale.has(id));
    this.stale = next;
    if (changed) {
      this.changeEmitter.fire();
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.changeEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

/** Text of a line, or undefined when the file or the line does not exist. */
export async function readLine(uri: vscode.Uri, line: number): Promise<string | undefined> {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    return line >= 0 && line < doc.lineCount ? doc.lineAt(line).text : undefined;
  } catch {
    return undefined;
  }
}
