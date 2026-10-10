import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { installAgentSkill } from './agents/agentSkills';
import { isInExecutionOrder, orderByExecution } from './core/executionOrder';
import { toOneBased, toZeroBased } from './core/lines';
import { Step, contentText, Highlight, isFileContent, sortByOrder } from './core/model';
import { findBreakpointAt, newBreakpoint } from './debug/breakpointSync';
import { StopController } from './debug/stopController';
import { readLine, StaleTracker } from './tours/staleTracker';
import { StepStore } from './tours/stepStore';
import { TourEntry, Tours } from './tours/tours';
import { CURRENT_STEP_VIEW_ID, CurrentStepView } from './views/currentStep/currentStepView';
import { openStep, selectionLines } from './views/navigation';
import { StepSelection } from './views/selection';
import { StepPage } from './views/stepPage';
import { StepsNode } from './views/stepsView';

export const CONTEXT_SCHEME = 'minuet';
const CONTEXT_URI = vscode.Uri.from({ scheme: CONTEXT_SCHEME, path: '/Tour context.md' });

interface Services {
  extensionUri: vscode.Uri;
  store: StepStore;
  staleTracker: StaleTracker;
  stops: StopController;
  selection: StepSelection;
  currentStepView: CurrentStepView;
  tours: Tours;
  page: StepPage;
}

interface Target {
  uri: vscode.Uri;
  line: number;
}

/** Argument passed by the `editor/lineNumber/context` menu (1-based line). */
interface LineNumberArg {
  lineNumber: number;
  uri: vscode.Uri | { scheme: string; path: string };
}

function isLineNumberArg(arg: unknown): arg is LineNumberArg {
  if (typeof arg !== 'object' || arg === null) {
    return false;
  }
  const { lineNumber, uri } = arg as Partial<LineNumberArg>;
  return typeof lineNumber === 'number' && typeof uri === 'object' && uri !== null && 'scheme' in uri && 'path' in uri;
}

function toUri(uri: LineNumberArg['uri']): vscode.Uri {
  return uri instanceof vscode.Uri ? uri : vscode.Uri.from(uri);
}

function isStepNode(arg: unknown): arg is Extract<StepsNode, { kind: 'step' }> {
  return typeof arg === 'object' && arg !== null && (arg as StepsNode).kind === 'step';
}

/** Line targeted by a command: gutter menu, editor menu (uri) or the active editor's cursor. */
function resolveTarget(arg: unknown): Target | undefined {
  if (isLineNumberArg(arg)) {
    return { uri: toUri(arg.uri), line: toZeroBased(arg.lineNumber) };
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }
  if (arg instanceof vscode.Uri && arg.toString() !== editor.document.uri.toString()) {
    return undefined;
  }
  return { uri: editor.document.uri, line: editor.selection.active.line };
}

function stepLabel(a: Step): string {
  return `${a.order}. ${a.title}`;
}

function stepDescription(a: Step): string {
  return `${vscode.workspace.asRelativePath(vscode.Uri.parse(a.location.uri))}:${toOneBased(a.location.line)}`;
}

type StepPick = vscode.QuickPickItem & { step: Step };

/**
 * Picks a step. The nearest step at or above `near` in the same file is offered first;
 * the other steps of that file follow, then the rest of the tour.
 */
async function pickStep(
  store: StepStore,
  placeHolder: string,
  near: Target | undefined,
  options: { sameFileOnly?: boolean } = {},
): Promise<Step | undefined> {
  const all = store.all();
  const uri = near?.uri.toString();
  const sameFile = uri ? all.filter((a) => a.location.uri === uri) : [];
  const nearest =
    near && sameFile.length > 0
      ? ([...sameFile].filter((a) => a.location.line <= near.line).sort((a, b) => b.location.line - a.location.line)[0] ??
        sameFile[0])
      : undefined;
  const candidates = options.sameFileOnly ? sameFile : all;
  if (candidates.length === 0) {
    return undefined;
  }
  const ordered = [
    ...(nearest ? [nearest] : []),
    ...sortByOrder(sameFile).filter((a) => a !== nearest),
    ...sortByOrder(candidates).filter((a) => a.location.uri !== uri),
  ].filter((a) => candidates.includes(a));
  if (ordered.length === 1) {
    return ordered[0];
  }
  const items: StepPick[] = ordered.map((a) => ({
    label: stepLabel(a),
    description: stepDescription(a),
    detail: a === nearest ? 'Nearest one above in this file' : undefined,
    step: a,
  }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder, matchOnDescription: true });
  return picked?.step;
}

/** Step addressed by a command argument (tree item, comment, gutter, editor) or picked. */
async function stepFromArg(
  services: Services,
  arg: unknown,
  placeHolder: string,
): Promise<Step | undefined> {
  const { store } = services;
  if (isStepNode(arg)) {
    return store.get(arg.step.id);
  }
  if (typeof arg === 'string') {
    return store.get(arg);
  }
  const target = resolveTarget(arg);
  if (target) {
    const exact = store.findAt(target.uri.toString(), target.line);
    if (exact) {
      return exact;
    }
  }
  if (store.count() === 0) {
    void vscode.window.showInformationMessage('There are no steps in this workspace.');
    return undefined;
  }
  return pickStep(store, placeHolder, target);
}

async function addStep(services: Services, arg: unknown): Promise<void> {
  const { store, selection } = services;
  const target = resolveTarget(arg);
  if (!target) {
    void vscode.window.showWarningMessage('Open a file and place the cursor on the line for the step.');
    return;
  }
  if (target.uri.scheme !== 'file') {
    void vscode.window.showWarningMessage('Only files saved on disk can have steps.');
    return;
  }
  if (!(await services.tours.ensureOpen())) {
    return;
  }
  const uri = target.uri.toString();
  const existing = store.findAt(uri, target.line);
  if (existing) {
    void vscode.window.showInformationMessage(`This line already has a step: ${stepLabel(existing)}.`);
    await editStep(services, existing.id);
    return;
  }

  const title = await vscode.window.showInputBox({
    title: `Add a step on line ${toOneBased(target.line)}`,
    prompt: 'Short title for the step',
    placeHolder: 'e.g. The notification text is built',
    validateInput: (v) => (v.trim() ? undefined : 'The title cannot be empty.'),
  });
  if (title === undefined) {
    return;
  }
  const content = await vscode.window.showInputBox({
    title: `Add a step on line ${toOneBased(target.line)}`,
    prompt: 'Content in markdown (optional; it can be edited later in the Current Step view)',
  });
  if (content === undefined) {
    return;
  }

  const lineText = (await readLine(target.uri, target.line)) ?? '';
  const breakpoint = findBreakpointAt(uri, target.line);
  const bp = breakpoint ?? newBreakpoint(uri, target.line);
  const step: Step = {
    id: randomUUID(),
    breakpointId: bp.id,
    location: { uri, line: target.line },
    anchorText: lineText.trim(),
    order: store.nextOrder(),
    title: title.trim(),
    content,
    highlights: [],
    watches: [],
  };
  await store.add(step);
  if (!breakpoint) {
    vscode.debug.addBreakpoints([bp]);
  }
  selection.select(step.id);
}

async function addHighlight(services: Services): Promise<void> {
  const { store } = services;
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('Select the lines to highlight in the editor.');
    return;
  }
  const uri = editor.document.uri.toString();
  if (store.inFile(uri).length === 0) {
    void vscode.window.showWarningMessage(
      'There are no steps in this file. Highlights belong to a step in the same file: add a step first.',
    );
    return;
  }
  const { startLine, endLine } = selectionLines(editor.selection);
  const step = await pickStep(
    store,
    `Highlight lines ${toOneBased(startLine)}–${toOneBased(endLine)} in the step…`,
    { uri: editor.document.uri, line: startLine },
    { sameFileOnly: true },
  );
  if (!step) {
    return;
  }
  const note = await vscode.window.showInputBox({
    title: `Highlight in ${stepLabel(step)}`,
    prompt: 'Note for the highlight (optional; press Enter to leave it empty)',
  });
  if (note === undefined) {
    return;
  }
  const highlight: Highlight = { startLine, endLine };
  if (note.trim()) {
    highlight.note = note.trim();
  }
  await store.update(step.id, {
    highlights: [...step.highlights, highlight].sort((a, b) => a.startLine - b.startLine),
  });
}

async function addWatch(services: Services, arg: unknown): Promise<void> {
  const { store } = services;
  if (store.count() === 0) {
    void vscode.window.showWarningMessage('There are no steps. Add a step first.');
    return;
  }
  const editor = vscode.window.activeTextEditor;
  const selected = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection).trim() : '';
  let step: Step | undefined;
  if (isStepNode(arg) || typeof arg === 'string') {
    step = await stepFromArg(services, arg, '');
  } else {
    const target = resolveTarget(arg);
    step = await pickStep(store, 'Add the expression to the step…', target);
  }
  if (!step) {
    return;
  }
  const expression = await vscode.window.showInputBox({
    title: `Expression to evaluate in ${stepLabel(step)}`,
    prompt: 'Evaluated against the current frame every time execution stops at this step',
    value: selected.includes('\n') ? '' : selected,
    placeHolder: 'e.g. event.body.operation',
    validateInput: (v) => {
      if (!v.trim()) {
        return 'The expression cannot be empty.';
      }
      return step.watches.includes(v.trim()) ? 'That expression is already in the step.' : undefined;
    },
  });
  if (expression === undefined) {
    return;
  }
  await store.update(step.id, { watches: [...step.watches, expression.trim()] });
}

type EditAction = vscode.QuickPickItem & { action: () => Promise<void> };

async function editStep(services: Services, arg: unknown): Promise<void> {
  const { store, staleTracker, currentStepView } = services;
  const step = await stepFromArg(services, arg, 'Edit the step…');
  if (!step) {
    return;
  }
  const id = step.id;
  const actions: EditAction[] = [
    {
      label: '$(edit) Title',
      description: step.title,
      action: async () => {
        const title = await vscode.window.showInputBox({
          title: `Title of step ${step.order}`,
          value: step.title,
          validateInput: (v) => (v.trim() ? undefined : 'The title cannot be empty.'),
        });
        if (title !== undefined) {
          await store.update(id, { title: title.trim() });
        }
      },
    },
    {
      label: '$(markdown) Content',
      description: isFileContent(step.content)
        ? `In ${step.content.file}`
        : 'Edited as markdown in the Current Step view',
      action: () => currentStepView.edit(id),
    },
    {
      label: '$(list-ordered) Order',
      description: `Step ${step.order} of ${store.count()}`,
      action: async () => {
        const value = await vscode.window.showInputBox({
          title: `New position for "${step.title}"`,
          value: String(step.order),
          validateInput: (v) => {
            const n = Number(v);
            return Number.isInteger(n) && n >= 1 && n <= store.count()
              ? undefined
              : `Enter a number between 1 and ${store.count()}.`;
          },
        });
        if (value === undefined) {
          return;
        }
        const others = store.all().filter((a) => a.id !== id);
        const current = store.get(id);
        if (!current) {
          return;
        }
        others.splice(Number(value) - 1, 0, current);
        await store.replaceAll(others.map((a, i) => ({ ...a, order: i + 1 })));
      },
    },
    {
      label: '$(eye) Add expression to evaluate…',
      action: () => addWatch(services, id),
    },
  ];
  if (step.watches.length > 0) {
    actions.push({
      label: '$(eye-closed) Remove expressions…',
      description: step.watches.join(', '),
      action: async () => {
        const picked = await vscode.window.showQuickPick(
          step.watches.map((w) => ({ label: w })),
          { canPickMany: true, placeHolder: 'Expressions to remove' },
        );
        if (picked && picked.length > 0) {
          const remove = new Set(picked.map((p) => p.label));
          await store.update(id, { watches: step.watches.filter((w) => !remove.has(w)) });
        }
      },
    });
  }
  if (step.highlights.length > 0) {
    actions.push({
      label: '$(symbol-color) Remove highlights…',
      action: async () => {
        const picked = await vscode.window.showQuickPick(
          step.highlights.map((h, index) => ({
            label: `Lines ${toOneBased(h.startLine)}–${toOneBased(h.endLine)}`,
            description: h.note,
            index,
          })),
          { canPickMany: true, placeHolder: 'Highlights to remove' },
        );
        if (picked && picked.length > 0) {
          const remove = new Set(picked.map((p) => p.index));
          await store.update(id, { highlights: step.highlights.filter((_, i) => !remove.has(i)) });
        }
      },
    });
  }
  if (staleTracker.isStale(id)) {
    actions.push({
      label: '$(pinned) Re-anchor to the current text of the line',
      description: 'Marks the step as up to date again',
      action: async () => {
        const text = await readLine(vscode.Uri.parse(step.location.uri), step.location.line);
        if (text !== undefined) {
          await store.update(id, { anchorText: text.trim() });
        }
      },
    });
  }
  const picked = await vscode.window.showQuickPick(actions, {
    title: `Edit ${stepLabel(step)}`,
    placeHolder: 'What do you want to change?',
  });
  await picked?.action();
}

async function deleteStep(services: Services, arg: unknown): Promise<void> {
  const step = await stepFromArg(services, arg, 'Delete the step…');
  if (!step) {
    return;
  }
  const remove = 'Delete';
  const choice = await vscode.window.showWarningMessage(
    `Delete the step "${stepLabel(step)}"?`,
    { modal: true, detail: 'The breakpoint is kept.' },
    remove,
  );
  if (choice === remove) {
    await services.store.remove(step.id);
  }
}

/** A tour file addressed by a command argument (tree item or uri), or picked from the tours folder. */
async function tourFromArg(tours: Tours, arg: unknown, placeHolder: string): Promise<vscode.Uri | undefined> {
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  if (typeof arg === 'object' && arg !== null && (arg as TourEntry).uri instanceof vscode.Uri) {
    return (arg as TourEntry).uri;
  }
  const items = tours.list.map((t) => ({ label: t.title, description: t.errors ? 'not valid' : `${t.steps} steps`, uri: t.uri }));
  if (items.length === 0) {
    void vscode.window.showInformationMessage('There are no tours yet. Create one with "minuet: New Tour".');
    return undefined;
  }
  return (await vscode.window.showQuickPick(items, { placeHolder }))?.uri;
}

async function moveStep(services: Services, arg: unknown, direction: -1 | 1): Promise<void> {
  const step = await stepFromArg(services, arg, direction < 0 ? 'Move the step up…' : 'Move the step down…');
  if (step) {
    await services.store.move(step.id, direction);
  }
}

function describeHits(store: StepStore, hits: readonly string[]): string {
  return hits
    .map((id) => store.get(id)?.order)
    .filter((order): order is number => order !== undefined)
    .join(' → ');
}

/** Renumbers the tour following the hit order of the last run. Asks first unless `confirmed`. */
async function orderStepsByExecution(services: Services, confirmed = false): Promise<void> {
  const { store, stops } = services;
  const hits = stops.lastRunHits;
  if (hits.length === 0) {
    void vscode.window.showInformationMessage(
      'No run has been recorded yet: debug the program or the test and let it go through the steps.',
    );
    return;
  }
  const result = orderByExecution(store.all(), hits);
  if (!result.changed) {
    void vscode.window.showInformationMessage('The tour already follows the order of the last run.');
    return;
  }
  if (!confirmed) {
    const lines = result.steps.map((a) => {
      const before = store.get(a.id)?.order;
      const skipped = result.notHit.includes(a) ? '  (not executed)' : '';
      return `${a.order}. ${a.title}${before !== a.order ? `  (was ${before})` : ''}${skipped}`;
    });
    const apply = 'Reorder';
    const choice = await vscode.window.showWarningMessage(
      `Reorder the tour to match the last run (${describeHits(store, hits)})?`,
      { modal: true, detail: lines.join('\n') },
      apply,
    );
    if (choice !== apply) {
      return;
    }
  }
  await store.replaceAll(result.steps);
  const notHit = result.notHit.length;
  void vscode.window.showInformationMessage(
    notHit > 0
      ? `Tour reordered. ${notHit} step(s) were not executed and were moved to the end.`
      : 'Tour reordered to match the run.',
  );
}

/** After a run, offers to reorder when execution visited the steps out of tour order. */
async function suggestExecutionOrder(services: Services, hits: string[]): Promise<void> {
  const { store } = services;
  const enabled = vscode.workspace.getConfiguration('minuet').get<boolean>('suggestExecutionOrder', true);
  if (!enabled || hits.length < 2 || isInExecutionOrder(store.all(), hits)) {
    return;
  }
  const apply = 'Order by Execution';
  const never = "Don't Ask Again";
  const choice = await vscode.window.showInformationMessage(
    `Execution went through the steps in a different order: ${describeHits(store, hits)}.`,
    apply,
    never,
  );
  if (choice === apply) {
    await orderStepsByExecution(services, true);
  } else if (choice === never) {
    await vscode.workspace
      .getConfiguration('minuet')
      .update('suggestExecutionOrder', false, vscode.ConfigurationTarget.Global);
  }
}

async function showContext(store: StepStore, page: StepPage): Promise<void> {
  const meta = store.getMeta();
  if (isFileContent(meta.context)) {
    await page.showContext();
    return;
  }
  if (!meta.context.trim()) {
    return;
  }
  try {
    await vscode.commands.executeCommand('markdown.showPreview', CONTEXT_URI);
  } catch {
    await vscode.window.showTextDocument(CONTEXT_URI, { preview: true });
  }
}

/** Read-only virtual document with the tour context, used by the markdown preview. */
export function contextContentProvider(store: StepStore): vscode.TextDocumentContentProvider & vscode.Disposable {
  const emitter = new vscode.EventEmitter<vscode.Uri>();
  const subscription = store.onDidChange(() => emitter.fire(CONTEXT_URI));
  return {
    onDidChange: emitter.event,
    provideTextDocumentContent: () => {
      const meta = store.getMeta();
      return `# ${meta.title || 'Tour context'}\n\n${contentText(meta.context)}\n`;
    },
    dispose: () => {
      subscription.dispose();
      emitter.dispose();
    },
  };
}

export function registerCommands(services: Services): vscode.Disposable[] {
  const { store, stops, selection } = services;
  const register = (id: string, handler: (...args: unknown[]) => unknown): vscode.Disposable =>
    vscode.commands.registerCommand(`minuet.${id}`, handler);

  return [
    register('addStep', (arg) => addStep(services, arg)),
    register('addHighlight', () => addHighlight(services)),
    register('addWatch', (arg) => addWatch(services, arg)),
    register('editStep', (arg) => editStep(services, arg)),
    register('deleteStep', (arg) => deleteStep(services, arg)),
    register('moveUp', (arg) => moveStep(services, arg, -1)),
    register('moveDown', (arg) => moveStep(services, arg, 1)),
    register('newTour', () => services.tours.create()),
    register('openTour', async (arg) => {
      const uri = await tourFromArg(services.tours, arg, 'Open the tour…');
      if (uri) {
        await services.tours.open(uri);
      }
    }),
    register('closeTour', async () => {
      if (!services.tours.activeFile) {
        void vscode.window.showInformationMessage('No tour is open.');
        return;
      }
      await services.tours.close();
    }),
    register('deleteTour', async (arg) => {
      const uri = await tourFromArg(services.tours, arg, 'Delete the tour…');
      if (uri) {
        await services.tours.delete(uri);
      }
    }),
    register('openTourFile', async (arg) => {
      const uri = arg === undefined ? services.tours.activeFile : await tourFromArg(services.tours, arg, 'Open the file of the tour…');
      if (uri) {
        await vscode.window.showTextDocument(uri);
      }
    }),
    register('refreshTours', () => services.tours.refresh()),
    register('orderByExecution', () => orderStepsByExecution(services)),
    stops.onDidFinishRun((hits) => void suggestExecutionOrder(services, hits)),
    register('openStep', async (arg) => {
      const step = typeof arg === 'string' ? store.get(arg) : undefined;
      if (step) {
        selection.select(step.id, 'tree');
        await openStep(step);
      }
    }),
    register('focusStep', async (arg) => {
      const step = typeof arg === 'string' ? store.get(arg) : undefined;
      if (step) {
        selection.select(step.id, 'lens');
        await vscode.commands.executeCommand(`${CURRENT_STEP_VIEW_ID}.focus`);
      }
    }),
    register('showContext', () => showContext(store, services.page)),
    register('installAgentSkill', () => installAgentSkill(services.extensionUri)),
  ];
}
