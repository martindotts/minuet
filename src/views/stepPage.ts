import * as path from 'path';
import * as vscode from 'vscode';
import { Content, isFileContent, isHtmlFile } from '../core/model';
import { StopController } from '../debug/stopController';
import { StepStore } from '../tours/stepStore';
import { Tours } from '../tours/tours';
import { StepSelection } from './selection';

const PANEL_TYPE = 'minuet.page';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

type Shown = { kind: 'step'; id: string } | { kind: 'context' };

/** What a page draws: rendered markdown, a whole HTML document, or why it could not be read. */
type Page =
  | { kind: 'markdown'; html: string; base: vscode.Uri }
  | { kind: 'html'; document: string; base: vscode.Uri }
  | { kind: 'error'; message: string };

/** Puts our <base> and CSP first in the document's <head>, creating it when there is none. */
export function injectHead(document: string, head: string): string {
  if (/<head(\s[^>]*)?>/i.test(document)) {
    return document.replace(/<head(\s[^>]*)?>/i, (tag) => `${tag}\n${head}`);
  }
  if (/<html(\s[^>]*)?>/i.test(document)) {
    return document.replace(/<html(\s[^>]*)?>/i, (tag) => `${tag}\n<head>\n${head}\n</head>`);
  }
  return `<head>\n${head}\n</head>\n${document}`;
}

/**
 * "Step Page": the content of a step (or of the tour context) in an editor tab, with room for it. An
 * HTML file is shown with its local css and images; never its scripts, and nothing from the network.
 */
export class StepPage implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private shown: Shown | undefined;
  private renderSeq = 0;
  private lastDocument: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly store: StepStore,
    private readonly tours: Tours,
    private readonly stops: StopController,
    selection: StepSelection,
  ) {
    this.disposables.push(
      // While the tab is open, it follows the step where execution stops.
      stops.onDidChange((stop) => {
        if (stop && this.panel) {
          void this.showStep(stop.stepId, { preserveFocus: true });
        }
      }),
      selection.onDidChange(({ id }) => {
        if (this.panel && id && !this.stops.current) {
          void this.showStep(id, { preserveFocus: true });
        }
      }),
      store.onDidChange(() => void this.render()),
      tours.onDidChangeContent(() => void this.render()),
    );
  }

  /** The document last given to the tab; used by tests. */
  get document(): string | undefined {
    return this.lastDocument;
  }

  get isOpen(): boolean {
    return this.panel !== undefined;
  }

  async showStep(id: string, options: { preserveFocus?: boolean } = {}): Promise<void> {
    this.shown = { kind: 'step', id };
    this.reveal(options.preserveFocus ?? false);
    await this.render();
  }

  async showContext(): Promise<void> {
    this.shown = { kind: 'context' };
    this.reveal(false);
    await this.render();
  }

  private reveal(preserveFocus: boolean): void {
    if (this.panel) {
      this.panel.reveal(undefined, preserveFocus);
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      PANEL_TYPE,
      'Step',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus },
      { enableScripts: false, localResourceRoots: [] },
    );
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.lastDocument = undefined;
    });
  }

  private async render(): Promise<void> {
    const panel = this.panel;
    const shown = this.shown;
    if (!panel || !shown) {
      return;
    }
    const seq = ++this.renderSeq;
    let title: string;
    let content: Content;
    if (shown.kind === 'step') {
      const step = this.store.get(shown.id);
      if (!step) {
        return;
      }
      title = `Step ${step.order}: ${step.title}`;
      content = step.content;
    } else {
      const meta = this.store.getMeta();
      title = meta.title || 'Tour context';
      content = meta.context;
    }
    const page = await this.load(content, title);
    if (seq !== this.renderSeq || this.panel !== panel) {
      return;
    }
    panel.title = title;
    const webview = panel.webview;
    const roots = [this.tours.folder, page.kind !== 'error' ? page.base : undefined].filter(
      (u): u is vscode.Uri => u !== undefined,
    );
    webview.options = { enableScripts: false, localResourceRoots: roots };
    const document = this.buildDocument(webview, page, title);
    this.lastDocument = document;
    webview.html = document;
  }

  private async load(content: Content, title: string): Promise<Page> {
    const tourDir = this.tours.activeFile ? vscode.Uri.joinPath(this.tours.activeFile, '..') : this.tours.folder;
    if (!isFileContent(content)) {
      const html = content.trim()
        ? await vscode.commands.executeCommand<string>('markdown.api.render', content)
        : '<p><em>No content.</em></p>';
      return { kind: 'markdown', html: `<h1>${escapeHtml(title)}</h1>\n${html}`, base: tourDir ?? vscode.Uri.file('/') };
    }
    const resolved = this.tours.resolveContentFile(content.file);
    if ('error' in resolved) {
      return { kind: 'error', message: resolved.error };
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(resolved.uri));
    } catch {
      return { kind: 'error', message: `The file ${content.file} does not exist (looked for ${resolved.uri.fsPath}).` };
    }
    const base = vscode.Uri.file(path.dirname(resolved.uri.fsPath));
    if (isHtmlFile(content.file)) {
      return { kind: 'html', document: text, base };
    }
    const html = await vscode.commands.executeCommand<string>('markdown.api.render', text);
    return { kind: 'markdown', html, base };
  }

  /** Builds the webview document: our base and CSP, then the page. */
  private buildDocument(webview: vscode.Webview, page: Page, title: string): string {
    const src = webview.cspSource;
    if (page.kind === 'error') {
      return shell(`default-src 'none'; style-src 'unsafe-inline'`, '', title, `<p class="error">${escapeHtml(page.message)}</p>`);
    }
    const base = `${webview.asWebviewUri(page.base).toString()}/`;
    // Only the tour's own files, nothing from the network, and no scripts.
    const csp = [
      "default-src 'none'",
      `img-src ${src} data:`,
      `media-src ${src} data:`,
      `font-src ${src} data:`,
      `style-src ${src} 'unsafe-inline'`,
      "script-src 'none'",
    ].join('; ');
    if (page.kind === 'markdown') {
      return shell(csp, base, title, page.html);
    }
    const head = `<base href="${base}">\n<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    return injectHead(page.document, head);
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

function shell(csp: string, base: string, title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  ${base ? `<base href="${base}">` : ''}
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground);
      line-height: 1.6; max-width: 860px; padding: 8px 24px 32px; }
    code, pre { font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); }
    pre { background: var(--vscode-textCodeBlock-background); padding: 8px 12px; overflow-x: auto; }
    :not(pre) > code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
    a { color: var(--vscode-textLink-foreground); }
    table { border-collapse: collapse; } th, td { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; }
    img { max-width: 100%; }
    .error { color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}
