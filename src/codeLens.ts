import * as vscode from 'vscode';
import { StaleTracker } from './staleTracker';
import { AnnotationStore } from './store';

/** "◆ Step 3 of 6 · title" above each annotated line; clicking it shows the step. */
export class StepCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly store: AnnotationStore,
    private readonly staleTracker: StaleTracker,
  ) {
    this.disposables.push(
      vscode.languages.registerCodeLensProvider({ scheme: 'file' }, this),
      store.onDidChange(() => this.changeEmitter.fire()),
      staleTracker.onDidChange(() => this.changeEmitter.fire()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('minuet.showCodeLens')) {
          this.changeEmitter.fire();
        }
      }),
    );
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!vscode.workspace.getConfiguration('minuet').get<boolean>('showCodeLens', true)) {
      return [];
    }
    const total = this.store.count();
    return this.store
      .inFile(document.uri.toString())
      .filter((a) => a.location.line < document.lineCount)
      .map((a) => {
        const stale = this.staleTracker.isStale(a.id) ? '⚠ ' : '';
        return new vscode.CodeLens(new vscode.Range(a.location.line, 0, a.location.line, 0), {
          title: `${stale}◆ Step ${a.order} of ${total} · ${a.title}`,
          tooltip: stale ? 'Outdated step: the line changed since it was annotated' : 'Show the step in minuet',
          command: 'minuet.focusStep',
          arguments: [a.id],
        });
      });
  }

  dispose(): void {
    this.changeEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
