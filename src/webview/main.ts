/// <reference lib="dom" />
import { FromWebview, StepViewState, ToWebview, ValueView, VariableView } from './protocol';

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
let draftComment = '';
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

  const location = el('a', { className: 'location', text: step.location, title: 'Open in the editor' });
  location.href = '#';
  location.addEventListener('click', (e) => {
    e.preventDefault();
    post({ type: 'open' });
  });

  const titleRow = el(
    'div',
    { className: 'title-row' },
    el('h2', { text: step.title }),
    !editing && button('✎', 'Edit title and comment', startEditing),
  );
  return el('header', {}, nav, titleRow, location, s.stopped && el('div', { className: 'badge', text: '● Stopped at this step' }));
}

function startEditing(): void {
  if (!state?.step) {
    return;
  }
  editing = true;
  draftTitle = state.step.title;
  draftComment = state.step.comment;
  render();
  root.querySelector<HTMLTextAreaElement>('textarea')?.focus();
}

function renderEditor(): HTMLElement {
  const step = state!.step!;
  const title = el('input', { className: 'input' });
  title.dataset.role = 'title';
  title.value = draftTitle;
  title.placeholder = 'Title';
  title.addEventListener('input', () => (draftTitle = title.value));

  const comment = el('textarea', { className: 'input' });
  comment.dataset.role = 'comment';
  comment.value = draftComment;
  comment.placeholder = 'Comment in markdown';
  comment.rows = Math.min(20, Math.max(6, draftComment.split('\n').length + 1));
  comment.addEventListener('input', () => (draftComment = comment.value));

  const save = (): void => {
    editing = false;
    post({ type: 'save', id: step.id, title: draftTitle, comment: draftComment });
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
    comment,
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
    el('div', { text: '⚠ Outdated: the line no longer matches the annotated text:' }),
    el('code', { text: step.anchorText }),
    button('Re-anchor', 'Use the current text of the line as the reference', () => post({ type: 'reanchor', id: step.id }), 'secondary'),
  );
}

function renderComment(s: StepViewState): HTMLElement {
  if (editing) {
    return renderEditor();
  }
  const comment = el('div', { className: 'comment' });
  if (s.step!.commentHtml) {
    // Rendered by VS Code's markdown engine; the CSP blocks any script inside it.
    comment.innerHTML = s.step!.commentHtml;
  } else {
    comment.append(el('p', { className: 'muted', text: 'No comment.' }));
  }
  return comment;
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
      `Adds the lines selected in ${step.location.replace(/:\d+$/, '')}`,
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
  if (!s.step) {
    root.append(
      el('p', {
        className: 'empty',
        text: s.empty
          ? 'There are no annotations in this workspace. Import a tour or annotate a breakpoint.'
          : 'Select a step in Tour or click ◆ above an annotated line.',
      }),
    );
    return;
  }
  root.append(renderHeader(s));
  const stale = renderStale(s);
  if (stale) {
    root.append(stale);
  }
  root.append(renderComment(s), renderWatches(s), renderHighlights(s));
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
