import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { Highlight } from './model';
import { toOneBased } from './lines';
import { openStep, revealLines, selectionLines, stepLocation } from './navigation';
import { StepSelection } from './selection';
import { readLine, StaleTracker } from './staleTracker';
import { buildStepState, neighbourId } from './stepState';
import { StopController } from './stopController';
import { AnnotationStore } from './store';
import { FromWebview, StepViewState, ToWebview, VariableView } from './webview/protocol';

export const STEP_VIEW_ID = 'stepwise.step';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** "Current Step": the shown step's comment and its watch values as an expandable tree. */
export class StepView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private ready = false;
  private pendingEdit = false;
  private renderSeq = 0;
  private readonly markdownCache = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private lastState: StepViewState | undefined;
  private lastRendered: Extract<FromWebview, { type: 'rendered' }> | undefined;
  private readonly renderErrors: string[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: AnnotationStore,
    private readonly staleTracker: StaleTracker,
    private readonly stops: StopController,
    private readonly selection: StepSelection,
  ) {
    this.disposables.push(
      vscode.window.registerWebviewViewProvider(STEP_VIEW_ID, this),
      store.onDidChange(() => void this.refresh()),
      staleTracker.onDidChange(() => void this.refresh()),
      stops.onDidChange(() => void this.refresh()),
      selection.onDidChange(() => void this.refresh()),
      vscode.debug.onDidStartDebugSession(() => void this.refresh()),
      vscode.debug.onDidTerminateDebugSession(() => void this.refresh()),
      vscode.debug.onDidChangeActiveDebugSession(() => void this.refresh()),
    );
  }

  /** True once the webview script loaded and said hello; used by tests. */
  get isReady(): boolean {
    return this.ready;
  }

  /** What the webview last reported as drawn; used by tests. */
  get rendered(): { stepId?: string; stopped: boolean; generation?: number } | undefined {
    return this.lastRendered;
  }

  /** Render failures reported by the webview; used by tests. */
  get errors(): readonly string[] {
    return this.renderErrors;
  }

  /** Last state sent (or that would be sent) to the webview; used by tests. */
  get state(): StepViewState | undefined {
    return this.lastState;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.ready = false;
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [dist, media] };
    view.webview.html = this.html(view.webview, dist, media);
    view.webview.onDidReceiveMessage((m: FromWebview) => void this.onMessage(m), undefined, this.disposables);
    view.onDidDispose(() => {
      this.view = undefined;
      this.ready = false;
    });
  }

  /** Shows a step and switches its comment to edit mode. */
  async edit(id: string): Promise<void> {
    this.selection.select(id);
    this.pendingEdit = true;
    await vscode.commands.executeCommand(`${STEP_VIEW_ID}.focus`);
    if (this.ready) {
      await this.refresh();
    }
  }

  async refresh(): Promise<void> {
    const seq = ++this.renderSeq;
    const stop = this.stops.current;
    const shown = this.store.get(stop?.annotationId ?? this.selection.selectedId ?? '');
    const commentHtml = shown ? await this.renderMarkdown(shown.comment) : '';
    if (seq !== this.renderSeq) {
      return;
    }
    const state = buildStepState({
      annotations: this.store.all(),
      selectedId: this.selection.selectedId,
      stop: stop && { annotationId: stop.annotationId, watches: stop.watches, generation: stop.generation },
      inSession: vscode.debug.activeDebugSession !== undefined,
      isStale: (id) => this.staleTracker.isStale(id),
      location: stepLocation,
      commentHtml,
    });
    this.lastState = state;
    if (this.view && this.ready) {
      await this.post({ type: 'state', state });
      if (this.pendingEdit && state.step) {
        this.pendingEdit = false;
        await this.post({ type: 'edit' });
      }
    }
  }

  private async renderMarkdown(markdown: string): Promise<string> {
    if (!markdown.trim()) {
      return '';
    }
    const cached = this.markdownCache.get(markdown);
    if (cached !== undefined) {
      return cached;
    }
    let html: string;
    try {
      // Built-in markdown extension: same rendering as the rest of the editor, no extra dependency.
      html = await vscode.commands.executeCommand<string>('markdown.api.render', markdown);
    } catch {
      html = `<pre>${escapeHtml(markdown)}</pre>`;
    }
    if (this.markdownCache.size > 100) {
      this.markdownCache.clear();
    }
    this.markdownCache.set(markdown, html);
    return html;
  }

  private async post(message: ToWebview): Promise<void> {
    await this.view?.webview.postMessage(message);
  }

  private shownAnnotation() {
    const id = this.lastState?.step?.id;
    return id ? this.store.get(id) : undefined;
  }

  private async onMessage(message: FromWebview): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        await this.refresh();
        return;
      case 'open': {
        const annotation = this.shownAnnotation();
        if (annotation) {
          await openStep(annotation);
        }
        return;
      }
      case 'prev':
      case 'next': {
        const current = this.shownAnnotation();
        if (!current || !this.lastState?.navEnabled) {
          return;
        }
        const id = neighbourId(this.store.all(), current.id, message.type === 'prev' ? -1 : 1);
        const target = id ? this.store.get(id) : undefined;
        if (target) {
          this.selection.select(target.id);
          await openStep(target, true);
        }
        return;
      }
      case 'reanchor': {
        const annotation = this.store.get(message.id);
        if (annotation) {
          const text = await readLine(vscode.Uri.parse(annotation.location.uri), annotation.location.line);
          if (text !== undefined) {
            await this.store.update(annotation.id, { anchorText: text.trim() });
          }
        }
        return;
      }
      case 'save': {
        const title = message.title.trim();
        if (!title) {
          void vscode.window.showWarningMessage('The title cannot be empty.');
          return;
        }
        await this.store.update(message.id, { title, comment: message.comment });
        return;
      }
      case 'addWatch': {
        const annotation = this.store.get(message.id);
        const expression = message.expression.trim();
        if (annotation && expression && !annotation.watches.includes(expression)) {
          await this.store.update(annotation.id, { watches: [...annotation.watches, expression] });
        }
        return;
      }
      case 'removeWatch': {
        const annotation = this.store.get(message.id);
        if (annotation) {
          await this.store.update(annotation.id, {
            watches: annotation.watches.filter((w) => w !== message.expression),
          });
        }
        return;
      }
      case 'revealHighlight': {
        const annotation = this.store.get(message.id);
        const h = annotation?.highlights[message.index];
        if (annotation && h) {
          await revealLines(annotation, h.startLine, h.endLine);
        }
        return;
      }
      case 'editHighlight': {
        const annotation = this.store.get(message.id);
        const h = annotation?.highlights[message.index];
        if (!annotation || !h) {
          return;
        }
        const note = await vscode.window.showInputBox({
          title: `Highlight note (lines ${toOneBased(h.startLine)}–${toOneBased(h.endLine)})`,
          prompt: 'Shown at the end of the first line of the block. Leave empty to remove it.',
          value: h.note ?? '',
        });
        if (note === undefined) {
          return;
        }
        const updated: Highlight = { startLine: h.startLine, endLine: h.endLine };
        if (note.trim()) {
          updated.note = note.trim();
        }
        await this.store.update(annotation.id, {
          highlights: annotation.highlights.map((x, i) => (i === message.index ? updated : x)),
        });
        return;
      }
      case 'removeHighlight': {
        const annotation = this.store.get(message.id);
        if (annotation) {
          await this.store.update(annotation.id, {
            highlights: annotation.highlights.filter((_, i) => i !== message.index),
          });
        }
        return;
      }
      case 'addHighlight':
        await this.addHighlightFromEditor(message.id);
        return;
      case 'expand': {
        if (this.stops.current?.generation !== message.generation) {
          await this.post({
            type: 'children',
            requestId: message.requestId,
            error: 'Execution continued; the value is no longer available.',
          });
          return;
        }
        try {
          const variables = await this.stops.variables(message.generation, message.variablesReference);
          const children: VariableView[] = variables.map((v) => ({
            name: v.name,
            value: v.value,
            type: v.type,
            variablesReference: v.variablesReference,
          }));
          await this.post({ type: 'children', requestId: message.requestId, children });
        } catch (err) {
          await this.post({
            type: 'children',
            requestId: message.requestId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      case 'copy':
        await vscode.env.clipboard.writeText(message.text);
        return;
      case 'rendered':
        this.lastRendered = message;
        return;
      case 'error':
        this.renderErrors.push(message.message);
        console.error('[stepwise] Current Step failed to render:', message.message);
        return;
    }
  }

  /** Adds the lines selected in the editor showing the step's file (focus is in this view, not the editor). */
  private async addHighlightFromEditor(id: string): Promise<void> {
    const annotation = this.store.get(id);
    if (!annotation) {
      return;
    }
    const uri = annotation.location.uri;
    const active = vscode.window.activeTextEditor;
    const editor =
      active?.document.uri.toString() === uri
        ? active
        : vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri);
    if (!editor) {
      void vscode.window.showWarningMessage(
        `Open ${vscode.workspace.asRelativePath(vscode.Uri.parse(uri))} and select the lines to highlight.`,
      );
      return;
    }
    const { startLine, endLine } = selectionLines(editor.selection);
    const note = await vscode.window.showInputBox({
      title: `Highlight lines ${toOneBased(startLine)}–${toOneBased(endLine)}`,
      prompt: 'Note for the highlight (optional; press Enter to leave it empty)',
    });
    if (note === undefined) {
      return;
    }
    const highlight: Highlight = { startLine, endLine };
    if (note.trim()) {
      highlight.note = note.trim();
    }
    await this.store.update(id, {
      highlights: [...annotation.highlights, highlight].sort((a, b) => a.startLine - b.startLine),
    });
  }

  private html(webview: vscode.Webview, dist: vscode.Uri, media: vscode.Uri): string {
    const nonce = randomBytes(16).toString('base64');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(media, 'stepView.css'));
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} https: data:`,
      `font-src ${webview.cspSource}`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${style}" rel="stylesheet">
  <title>Current Step</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
