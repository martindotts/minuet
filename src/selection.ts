import * as vscode from 'vscode';
import { StopController } from './stopController';
import { AnnotationStore } from './store';

/** Where a selection came from. Only 'cursor' asks the tour tree to reveal the step right away. */
export type SelectionSource = 'cursor' | 'tree' | 'lens' | 'stop' | 'other';

export interface SelectionChange {
  id: string | undefined;
  source: SelectionSource;
}

/**
 * The step the user is looking at: picked in the tour panel, through the CodeLens, by moving the
 * cursor onto an annotated line, or the step where execution stopped.
 */
export class StepSelection implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<SelectionChange>();
  readonly onDidChange = this.changeEmitter.event;

  private selected: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly store: AnnotationStore,
    stops: StopController,
  ) {
    this.disposables.push(
      stops.onDidChange((stop) => {
        if (stop) {
          this.select(stop.annotationId, 'stop');
        }
      }),
      store.onDidChange(() => {
        if (this.selected && !this.store.get(this.selected)) {
          this.select(undefined);
        }
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => this.followCursor(e)),
    );
  }

  get selectedId(): string | undefined {
    return this.selected;
  }

  select(id: string | undefined, source: SelectionSource = 'other'): void {
    if (id === this.selected) {
      return;
    }
    this.selected = id;
    this.changeEmitter.fire({ id, source });
  }

  private followCursor(e: vscode.TextEditorSelectionChangeEvent): void {
    if (!vscode.workspace.getConfiguration('minuet').get<boolean>('followCursor', true)) {
      return;
    }
    if (e.textEditor !== vscode.window.activeTextEditor || e.selections.length !== 1) {
      return;
    }
    const annotation = this.store.findAt(e.textEditor.document.uri.toString(), e.selections[0].active.line);
    if (annotation) {
      this.select(annotation.id, 'cursor');
    }
  }

  dispose(): void {
    this.changeEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
