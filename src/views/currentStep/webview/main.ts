/// <reference lib="dom" />
import { ContentInfo, FromWebview, StepViewState, ToWebview, ValueView, VariableView } from '../protocol';

interface VsCodeApi {
  postMessage(message: FromWebview): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById('root') as HTMLElement;

/** Expansion state of a value in the tree, keyed by its path ("0", "0/3", ...). */
interface NodeState {
  expanded: boolean;
  children?: VariableView[];
  error?: string;
  loading?: boolean;
}

let state: StepViewState | undefined;
let nodes = new Map<string, NodeState>();
/** Values belong to one step and one stop; expansion is reset when either changes. */
let nodesOwner = '';
const pendingRequests = new Map<number, string>();
let nextRequestId = 1;

let editing = false;
let draftTitle = '';
let draftContent = '';
let draftWatch = '';

function post(message: FromWebview): void {
  vscode.postMessage(message);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string; title?: string } = {},
  ...children: Array<Node | string | undefined | false>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) {
    node.className = options.className;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  if (options.title) {
    node.title = options.title;
  }
  for (const child of children) {
    if (child !== undefined && child !== false) {
      node.append(child);
    }
  }
  return node;
}

function button(label: string, title: string, onClick: () => void, className = 'icon'): HTMLButtonElement {
  const b = el('button', { className, text: label, title });
  b.type = 'button';
  b.setAttribute('aria-label', title);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function valueClass(v: ValueView): string {
  const type = v.type ?? '';
  const text = v.value ?? '';
  if (type === 'string' || /^['"`]/.test(text)) {
    return 'string';
  }
  if (type === 'number' || type === 'bigint' || /^-?(\d|Infinity\b|NaN\b)/.test(text)) {
    return 'number';
  }
  if (type === 'boolean' || text === 'true' || text === 'false') {
    return 'boolean';
  }
  if (text === 'null' || text === 'undefined' || type === 'undefined') {
    return 'null';
  }
  if (type === 'function' || /^(async )?(function|ƒ|class)\b/.test(text)) {
    return 'function';
  }
  return 'object';
}

function nodeFor(path: string): NodeState {
  let node = nodes.get(path);
  if (!node) {
    node = { expanded: false };
    nodes.set(path, node);
  }
  return node;
}

function toggle(path: string, value: ValueView): void {
  const node = nodeFor(path);
  node.expanded = !node.expanded;
  if (node.expanded && !node.children && !node.loading && state?.generation !== undefined) {
    node.loading = true;
    node.error = undefined;
    const requestId = nextRequestId++;
    pendingRequests.set(requestId, path);
    post({ type: 'expand', requestId, generation: state.generation, variablesReference: value.variablesReference });
  }
  render();
}

function renderValueRow(
  container: HTMLElement,
  path: string,
  depth: number,
  name: string,
  value: ValueView | undefined,
  onRemove?: () => void,
): void {
  const expandable = !!value && value.variablesReference > 0 && state?.watchStatus === 'values';
  const node = expandable ? nodeFor(path) : undefined;

  const row = el('div', { className: 'row' + (expandable ? ' expandable' : '') });
  row.style.setProperty('--depth', String(depth));
  row.append(el('span', { className: 'twisty', text: expandable ? (node?.expanded ? '▾' : '▸') : '' }));
  row.append(el('span', { className: depth === 0 ? 'expr' : 'name', text: name }));

  if (!value) {
    row.append(el('span', { className: 'muted', text: '—' }));
  } else if (value.error !== undefined) {
    row.append(el('span', { className: 'sep', text: ':' }), el('span', { className: 'error', text: value.error }));
  } else {
    const text = value.value ?? '';
    row.append(el('span', { className: 'sep', text: '=' }), el('span', { className: `value ${valueClass(value)}`, text, title: text }));
  }

  const actions = el('span', { className: 'actions' });
  if (value && value.error === undefined) {
    actions.append(button('⧉', 'Copy value', () => post({ type: 'copy', text: value.value ?? '' })));
  }
  if (onRemove) {
    actions.append(button('✕', 'Remove expression', onRemove));
  }
  row.append(actions);

  if (expandable && value) {
    row.addEventListener('click', () => toggle(path, value));
  }
  container.append(row);

  if (node?.expanded) {
    if (node.loading) {
      container.append(messageRow(depth + 1, 'Loading…'));
    } else if (node.error) {
      container.append(messageRow(depth + 1, node.error, 'error'));
    } else if (node.children) {
      if (node.children.length === 0) {
        container.append(messageRow(depth + 1, '(empty)'));
      }
      node.children.forEach((child, i) => renderValueRow(container, `${path}/${i}`, depth + 1, child.name, child));
    }
  }
}

function messageRow(depth: number, text: string, className = 'muted'): HTMLElement {
  const row = el('div', { className: 'row' }, el('span', { className: 'twisty' }), el('span', { className, text }));
  row.style.setProperty('--depth', String(depth));
  return row;
}

function renderHeader(s: StepViewState): HTMLElement {
  const step = s.step!;
  const position = el('span', { className: 'position', text: `Step ${step.order} of ${step.total}` });
  let nav: HTMLElement;
  if (s.navEnabled) {
    // Browsing the tour; during a debug session the native controls drive the steps.
    const prev = button('◀', 'Previous step', () => post({ type: 'prev' }));
    const next = button('▶', 'Next step', () => post({ type: 'next' }));
    prev.disabled = !s.hasPrev;
    next.disabled = !s.hasNext;
    nav = el('div', { className: 'nav' }, prev, position, next);
  } else {
    nav = el('div', { className: 'nav' }, position);
  }

  const titleRow = el(
    'div',
    { className: 'title-row' },
    el('h2', { text: step.title }),
    !editing && button('✎', step.contentText === undefined ? 'Edit the title' : 'Edit title and content', startEditing),
  );
  return el('header', {}, nav, titleRow);
}

function startEditing(): void {
  if (!state?.step) {
    return;
  }
  editing = true;
  draftTitle = state.step.title;
  draftContent = state.step.contentText ?? '';
  render();
  (root.querySelector<HTMLTextAreaElement>('textarea') ?? root.querySelector<HTMLInputElement>('input'))?.focus();
}

function renderEditor(): HTMLElement {
  const step = state!.step!;
  const title = el('input', { className: 'input' });
  title.dataset.role = 'title';
  title.value = draftTitle;
  title.placeholder = 'Title';
  title.addEventListener('input', () => (draftTitle = title.value));

  // Content from a file is edited in its file; here only the title.
  const fromFile = step.contentText === undefined;
  let content: HTMLElement;
  if (fromFile) {
    content = el(
      'p',
      { className: 'muted' },
      `The content is in ${step.contentFile ?? 'a file'}. `,
      button('Open file', 'Open the content file in the editor', () => post({ type: 'openContentFile', id: step.id }), 'secondary'),
    );
  } else {
    const textarea = el('textarea', { className: 'input' });
    textarea.dataset.role = 'content';
    textarea.value = draftContent;
    textarea.placeholder = 'Content in markdown';
    textarea.rows = Math.min(20, Math.max(6, draftContent.split('\n').length + 1));
    textarea.addEventListener('input', () => (draftContent = textarea.value));
    content = textarea;
  }

  const save = (): void => {
    editing = false;
    post({ type: 'save', id: step.id, title: draftTitle, content: fromFile ? undefined : draftContent });
    render();
  };
  const cancel = (): void => {
    editing = false;
    render();
  };
  const form = el(
    'form',
    { className: 'editor' },
    title,
    content,
    el(
      'div',
      { className: 'editor-actions' },
      button('Cancel', 'Discard the changes', cancel, 'secondary'),
      button('Save', 'Save (⌘/Ctrl+Enter)', save, 'primary'),
    ),
  );
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  return form;
}

function renderStale(s: StepViewState): HTMLElement | undefined {
  const step = s.step!;
  if (!step.stale) {
    return undefined;
  }
  return el(
    'div',
    { className: 'stale' },
    el('div', { text: '⚠ Outdated: the line no longer matches its anchor text:' }),
    el('code', { text: step.anchorText }),
    button('Re-anchor', 'Use the current text of the line as the reference', () => post({ type: 'reanchor', id: step.id }), 'secondary'),
  );
}

/** Drops everything that could run code: scripts, frames, plugins, `on…` handlers and `javascript:` URLs. */
function sanitize(root: ParentNode): void {
  root.querySelectorAll('script, iframe, frame, frameset, object, embed, base, meta, noscript').forEach((n) => n.remove());
  root.querySelectorAll('*').forEach((node) => {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      const isUrl = ['href', 'src', 'action', 'formaction', 'xlink:href'].includes(name);
      if (name.startsWith('on') || (isUrl && /^\s*javascript:/i.test(attr.value))) {
        node.removeAttribute(attr.name);
      }
    }
  });
}

const ABSOLUTE = /^([a-z][a-z0-9+.-]*:|#|\/\/)/i;

function resolveCssUrls(css: string, base: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote: string, url: string) =>
    ABSOLUTE.test(url.trim()) ? match : `url(${quote}${new URL(url.trim(), base).toString()}${quote})`,
  );
}

/** Makes the relative paths of the content (images, stylesheets, css url()) point to its folder. */
function resolveUrls(root: ParentNode, base: string | undefined): void {
  if (!base) {
    return;
  }
  root.querySelectorAll('[src], [href], [poster]').forEach((node) => {
    for (const name of ['src', 'href', 'poster']) {
      const value = node.getAttribute(name);
      if (value && !ABSOLUTE.test(value.trim())) {
        node.setAttribute(name, new URL(value.trim(), base).toString());
      }
    }
  });
  root.querySelectorAll('style').forEach((style) => (style.textContent = resolveCssUrls(style.textContent ?? '', base)));
  root.querySelectorAll('[style]').forEach((node) => node.setAttribute('style', resolveCssUrls(node.getAttribute('style') ?? '', base)));
}

/**
 * Draws an HTML page inside the view, isolated in a shadow root so its css and ours do not mix. Its scripts
 * never run: they are dropped here and the view's CSP blocks any left.
 */
function renderPage(html: string, base: string | undefined): HTMLElement {
  const host = el('div', { className: 'page' });
  const shadow = host.attachShadow({ mode: 'open' });
  const page = new DOMParser().parseFromString(html, 'text/html');
  sanitize(page);
  resolveUrls(page, base);
  const styles = [...page.head.querySelectorAll('link[rel~="stylesheet"], style')];
  // <html> and <body> wrappers, so the page's own `html { }` and `body { }` rules still apply.
  const pageHtml = document.createElement('html');
  const pageBody = document.createElement('body');
  for (const attr of [...page.body.attributes]) {
    pageBody.setAttribute(attr.name, attr.value);
  }
  pageBody.append(...[...page.body.childNodes].map((n) => document.importNode(n, true)));
  pageHtml.append(pageBody);
  shadow.append(...styles.map((n) => document.importNode(n, true)), pageHtml);
  return host;
}

function renderContent(s: StepViewState): HTMLElement {
  if (editing) {
    return renderEditor();
  }
  const step = s.step!;
  return renderContentBody(step, () => post({ type: 'openContentFile', id: step.id }));
}

/** The content of a step or of the tour context: markdown, or an HTML page drawn isolated. */
function renderContentBody(info: ContentInfo, openFile: () => void): HTMLElement {
  const content = el('div', { className: 'content' });
  const fileLink = (): HTMLElement => {
    const link = el('a', { text: info.contentFile ?? '', title: 'Open the file in the editor' });
    link.href = '#';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openFile();
    });
    return link;
  };
  if (info.contentError) {
    content.append(el('p', { className: 'error', text: info.contentError }));
  } else if (info.contentPage) {
    content.append(renderPage(info.contentHtml, info.contentBase), el('p', { className: 'muted source' }, 'From ', fileLink()));
  } else if (info.contentHtml) {
    // Rendered by VS Code's markdown engine; the CSP blocks any script inside it.
    content.innerHTML = info.contentHtml;
    sanitize(content);
    resolveUrls(content, info.contentBase);
    if (info.contentFile) {
      content.append(el('p', { className: 'muted source' }, 'From ', fileLink()));
    }
  } else {
    content.append(el('p', { className: 'muted', text: 'No content.' }));
  }
  return content;
}

/** The tour context: what the tour is about, before its first step. */
function renderContext(s: StepViewState): HTMLElement[] {
  const context = s.context!;
  const position = el('span', { className: 'position', text: `${context.steps} ${context.steps === 1 ? 'step' : 'steps'}` });
  const start = button('▶', 'Go to the first step', () => post({ type: 'next' }));
  start.disabled = !s.navEnabled || context.steps === 0;
  const titleRow = el('div', { className: 'title-row' }, el('h2', { text: context.title }));
  return [
    el('header', {}, el('div', { className: 'nav' }, position, start), titleRow),
    renderContentBody(context, () => post({ type: 'openContextFile' })),
  ];
}

function renderHighlights(s: StepViewState): HTMLElement {
  const step = s.step!;
  const section = el('section', { className: 'highlights' }, el('h3', { text: 'Highlights' }));
  if (step.highlights.length === 0) {
    section.append(el('p', { className: 'muted status', text: 'No highlights.' }));
  }
  step.highlights.forEach((h, index) => {
    const range = h.startLine === h.endLine ? `L${h.startLine}` : `L${h.startLine}–${h.endLine}`;
    const row = el(
      'div',
      { className: 'row highlight', title: 'Show in the editor' },
      el('span', { className: 'range', text: range }),
      el('span', { className: h.note ? 'note' : 'note muted', text: h.note ?? 'no note' }),
      el(
        'span',
        { className: 'actions' },
        button('✎', 'Edit the note', () => post({ type: 'editHighlight', id: step.id, index })),
        button('✕', 'Remove the highlight', () => post({ type: 'removeHighlight', id: step.id, index })),
      ),
    );
    row.addEventListener('click', () => post({ type: 'revealHighlight', id: step.id, index }));
    section.append(row);
  });
  section.append(
    button(
      '+ Highlight the editor selection',
      "Adds the lines selected in the step's file",
      () => post({ type: 'addHighlight', id: step.id }),
      'link',
    ),
  );
  return section;
}

function renderWatches(s: StepViewState): HTMLElement {
  const step = s.step!;
  const section = el('section', { className: 'watches' }, el('h3', { text: 'Expressions' }));
  const status =
    s.watchStatus === 'evaluating'
      ? 'Evaluating…'
      : s.watchStatus === 'idle' && step.watches.length > 0
        ? 'Values appear when execution stops at this step.'
        : '';
  if (status) {
    section.append(el('p', { className: 'muted status', text: status }));
  }

  const tree = el('div', { className: 'tree' });
  step.watches.forEach((expression, i) => {
    const result = s.results.find((r) => r.expression === expression);
    renderValueRow(tree, String(i), 0, expression, s.watchStatus === 'values' ? result : undefined, () =>
      post({ type: 'removeWatch', id: step.id, expression }),
    );
  });
  section.append(tree);

  const input = el('input', { className: 'input' });
  input.dataset.role = 'watch';
  input.placeholder = 'Add expression…  (Enter)';
  input.value = draftWatch;
  input.addEventListener('input', () => (draftWatch = input.value));
  const form = el('form', { className: 'add-watch' }, input);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const expression = draftWatch.trim();
    if (expression) {
      post({ type: 'addWatch', id: step.id, expression });
      draftWatch = '';
      render();
    }
  });
  section.append(form);
  return section;
}

/** Re-rendering replaces the DOM; keep the focused text field and its cursor across it. */
function captureFocus(): (() => void) | undefined {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) || !active.dataset.role) {
    return undefined;
  }
  const { selectionStart, selectionEnd } = active;
  const role = active.dataset.role;
  return () => {
    const next = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-role="${role}"]`);
    if (next) {
      next.focus();
      next.setSelectionRange(selectionStart, selectionEnd);
    }
  };
}

function render(): void {
  try {
    renderView();
    post({ type: 'rendered', stepId: state?.step?.id, stopped: state?.stopped ?? false, generation: state?.generation });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  }
}

function renderView(): void {
  const restoreFocus = captureFocus();
  root.replaceChildren();
  const s = state;
  if (!s) {
    return;
  }
  if (!s.step && s.context) {
    root.append(...renderContext(s));
    return;
  }
  if (!s.step) {
    root.append(
      el('p', {
        className: 'empty',
        text: s.empty
          ? 'There are no steps in this workspace. Open a tour in Tours, or add a step on a line.'
          : 'Select a step in Tours, or click ◆ above the line of a step.',
      }),
    );
    return;
  }
  root.append(renderHeader(s));
  const stale = renderStale(s);
  if (stale) {
    root.append(stale);
  }
  root.append(renderContent(s), renderWatches(s), renderHighlights(s));
  restoreFocus?.();
}

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
  const message = event.data;
  switch (message.type) {
    case 'state': {
      const owner = `${message.state.step?.id ?? ''}:${message.state.generation ?? ''}`;
      if (owner !== nodesOwner) {
        nodes = new Map();
        pendingRequests.clear();
        nodesOwner = owner;
        if (message.state.step?.id !== state?.step?.id) {
          editing = false;
          draftWatch = '';
        }
      }
      state = message.state;
      render();
      break;
    }
    case 'children': {
      const path = pendingRequests.get(message.requestId);
      pendingRequests.delete(message.requestId);
      const node = path !== undefined ? nodes.get(path) : undefined;
      if (node) {
        node.loading = false;
        node.children = message.children;
        node.error = message.error;
        render();
      }
      break;
    }
    case 'edit':
      startEditing();
      break;
  }
});

post({ type: 'ready' });
