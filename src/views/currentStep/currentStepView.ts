import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { toOneBased } from '../../core/lines';
import { Content, Highlight, isFileContent, isHtmlFile } from '../../core/model';
import { StopController } from '../../debug/stopController';
import { readLine, StaleTracker } from '../../tours/staleTracker';
import { StepStore } from '../../tours/stepStore';
import { Tours } from '../../tours/tours';
import { openStep, revealLines, selectionLines } from '../navigation';
import { StepSelection } from '../selection';
import { StepPage } from '../stepPage';
import { FromWebview, StepViewState, ToWebview, VariableView } from './protocol';
import { buildStepState, ContentView, neighbourId } from './state';

export const CURRENT_STEP_VIEW_ID = 'minuet.currentStep';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** "Current Step": the shown step's content and its watch values as an expandable tree. */
export class CurrentStepView implements vscode.WebviewViewProvider, vscode.Disposable {
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
    private readonly store: StepStore,
    private readonly staleTracker: StaleTracker,
    private readonly stops: StopController,
    private readonly selection: StepSelection,
    private readonly tours: Tours,
    private readonly page: StepPage,
  ) {
    this.disposables.push(
      vscode.window.registerWebviewViewProvider(CURRENT_STEP_VIEW_ID, this),
      tours.onDidChangeContent(() => void this.refresh()),
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
    view.webview.options = { enableScripts: true, localResourceRoots: [dist, media, ...this.contentRoots()] };
    view.webview.html = this.html(view.webview, dist, media);
    view.webview.onDidReceiveMessage((m: FromWebview) => void this.onMessage(m), undefined, this.disposables);
    view.onDidDispose(() => {
      this.view = undefined;
      this.ready = false;
    });
  }

  /** Shows a step and switches its content to edit mode. */
  async edit(id: string): Promise<void> {
    this.selection.select(id);
    this.pendingEdit = true;
    await vscode.commands.executeCommand(`${CURRENT_STEP_VIEW_ID}.focus`);
    if (this.ready) {
      await this.refresh();
    }
  }

  async refresh(): Promise<void> {
    const seq = ++this.renderSeq;
    const stop = this.stops.current;
    const shown = this.store.get(stop?.stepId ?? this.selection.selectedId ?? '');
    const content = shown ? await this.renderContent(shown.content) : { html: '', page: false };
    if (seq !== this.renderSeq) {
      return;
    }
    const state = buildStepState({
      steps: this.store.all(),
      selectedId: this.selection.selectedId,
      stop: stop && { stepId: stop.stepId, watches: stop.watches, generation: stop.generation },
      inSession: vscode.debug.activeDebugSession !== undefined,
      isStale: (id) => this.staleTracker.isStale(id),
      content,
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

  private async renderContent(content: Content): Promise<ContentView> {
    const tourDir = this.tours.activeFile ? vscode.Uri.joinPath(this.tours.activeFile, '..') : undefined;
    if (!isFileContent(content)) {
      return { html: await this.renderMarkdown(content), base: this.baseUrl(tourDir), page: false };
    }
    const file = content.file;
    const page = isHtmlFile(file);
    const resolved = this.tours.resolveContentFile(file);
    if ('error' in resolved) {
      return { html: '', file, page, error: resolved.error };
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(resolved.uri));
    } catch {
      return { html: '', file, page, error: `The file ${file} does not exist (looked for ${resolved.uri.fsPath}).` };
    }
    const base = this.baseUrl(vscode.Uri.joinPath(resolved.uri, '..'));
    // A page is sent as written: the webview drops its scripts and draws it isolated.
    return { html: page ? text : await this.renderMarkdown(text), base, file, page };
  }

  /** URL of a folder inside the webview, so relative paths of the content resolve against it. */
  private baseUrl(folder: vscode.Uri | undefined): string | undefined {
    return folder && this.view ? `${this.view.webview.asWebviewUri(folder).toString()}/` : undefined;
  }

  /** The folders content may come from: the workspace and the tours folder. */
  private contentRoots(): vscode.Uri[] {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri);
    return this.tours.folder ? [...folders, this.tours.folder] : folders;
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

  private shownStep() {
    const id = this.lastState?.step?.id;
    return id ? this.store.get(id) : undefined;
  }

  private async onMessage(message: FromWebview): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        await this.refresh();
        return;
      case 'prev':
      case 'next': {
        const current = this.shownStep();
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
        const step = this.store.get(message.id);
        if (step) {
          const text = await readLine(vscode.Uri.parse(step.location.uri), step.location.line);
          if (text !== undefined) {
            await this.store.update(step.id, { anchorText: text.trim() });
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
        await this.store.update(message.id, message.content === undefined ? { title } : { title, content: message.content });
        return;
      }
      case 'openPage':
        await this.page.showStep(message.id);
        return;
      case 'openContentFile': {
        const step = this.store.get(message.id);
        if (step && isFileContent(step.content)) {
          const resolved = this.tours.resolveContentFile(step.content.file);
          if ('uri' in resolved) {
            await vscode.window.showTextDocument(resolved.uri, { viewColumn: vscode.ViewColumn.Beside });
          } else {
            void vscode.window.showWarningMessage(resolved.error);
          }
        }
        return;
      }
      case 'addWatch': {
        const step = this.store.get(message.id);
        const expression = message.expression.trim();
        if (step && expression && !step.watches.includes(expression)) {
          await this.store.update(step.id, { watches: [...step.watches, expression] });
        }
        return;
      }
      case 'removeWatch': {
        const step = this.store.get(message.id);
        if (step) {
          await this.store.update(step.id, {
            watches: step.watches.filter((w) => w !== message.expression),
          });
        }
        return;
      }
      case 'revealHighlight': {
        const step = this.store.get(message.id);
        const h = step?.highlights[message.index];
        if (step && h) {
          await revealLines(step, h.startLine, h.endLine);
        }
        return;
      }
      case 'editHighlight': {
        const step = this.store.get(message.id);
        const h = step?.highlights[message.index];
        if (!step || !h) {
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
        await this.store.update(step.id, {
          highlights: step.highlights.map((x, i) => (i === message.index ? updated : x)),
        });
        return;
      }
      case 'removeHighlight': {
        const step = this.store.get(message.id);
        if (step) {
          await this.store.update(step.id, {
            highlights: step.highlights.filter((_, i) => i !== message.index),
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
        console.error('[minuet] Current Step failed to render:', message.message);
        return;
    }
  }

  /** Adds the lines selected in the editor showing the step's file (focus is in this view, not the editor). */
  private async addHighlightFromEditor(id: string): Promise<void> {
    const step = this.store.get(id);
    if (!step) {
      return;
    }
    const uri = step.location.uri;
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
      highlights: [...step.highlights, highlight].sort((a, b) => a.startLine - b.startLine),
    });
  }

  private html(webview: vscode.Webview, dist: vscode.Uri, media: vscode.Uri): string {
    const nonce = randomBytes(16).toString('base64');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(media, 'currentStep.css'));
    // Content (markdown and pages) may bring its own css and images, but only from local files: nothing from
    // the network, and no script but ours.
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource} data:`,
      `media-src ${webview.cspSource} data:`,
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
