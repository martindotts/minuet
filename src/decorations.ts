import * as vscode from 'vscode';
import { Annotation } from './model';
import { StepSelection } from './selection';
import { StopController } from './stopController';
import { AnnotationStore } from './store';

/**
 * Paints the highlighted ranges (and their notes) of one step: during a debug session, the step where
 * execution is stopped (nothing while running); without a session, the selected step, as a preview.
 */
export class StepDecorations implements vscode.Disposable {
  private readonly highlightType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('stepwise.highlightBackground'),
    borderColor: new vscode.ThemeColor('stepwise.highlightBorder'),
    borderStyle: 'solid',
    borderWidth: '0 0 0 3px',
    overviewRulerColor: new vscode.ThemeColor('stepwise.highlightBorder'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });

  private readonly noteType = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor('stepwise.noteForeground'),
      fontStyle: 'italic',
      margin: '0 0 0 2em',
    },
  });

  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly store: AnnotationStore,
    private readonly stops: StopController,
    private readonly selection: StepSelection,
  ) {
    this.disposables.push(
      stops.onDidChange(() => this.render()),
      selection.onDidChange(() => this.render()),
      store.onDidChange(() => this.render()),
      vscode.debug.onDidStartDebugSession(() => this.render()),
      vscode.debug.onDidTerminateDebugSession(() => this.render()),
      vscode.debug.onDidChangeActiveDebugSession(() => this.render()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.render()),
    );
  }

  /** Id of the step whose highlights are painted, if any. */
  get paintedId(): string | undefined {
    const stop = this.stops.current;
    if (stop) {
      return stop.annotationId;
    }
    return vscode.debug.activeDebugSession ? undefined : this.selection.selectedId;
  }

  private render(): void {
    const id = this.paintedId;
    const annotation = id ? this.store.get(id) : undefined;
    for (const editor of vscode.window.visibleTextEditors) {
      if (annotation && editor.document.uri.toString() === annotation.location.uri) {
        this.paint(editor, annotation);
      } else {
        editor.setDecorations(this.highlightType, []);
        editor.setDecorations(this.noteType, []);
      }
    }
  }

  private paint(editor: vscode.TextEditor, annotation: Annotation): void {
    const doc = editor.document;
    const lastLine = doc.lineCount - 1;
    const clamp = (line: number): number => Math.min(Math.max(line, 0), lastLine);

    const highlights: vscode.Range[] = [];
    const notes: vscode.DecorationOptions[] = [];
    for (const h of annotation.highlights) {
      const start = clamp(h.startLine);
      const end = clamp(Math.max(h.startLine, h.endLine));
      highlights.push(new vscode.Range(start, 0, end, doc.lineAt(end).text.length));
      if (h.note) {
        const lineEnd = doc.lineAt(start).range.end;
        notes.push({
          range: new vscode.Range(lineEnd, lineEnd),
          // ◆ is the extension's mark: also used by the CodeLens and the tour panel.
          renderOptions: { after: { contentText: `◆ ${h.note}` } },
        });
      }
    }
    editor.setDecorations(this.highlightType, highlights);
    editor.setDecorations(this.noteType, notes);
  }

  dispose(): void {
    this.highlightType.dispose();
    this.noteType.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
