import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { MinuetApi } from '../extension';
import { Annotation, EMPTY_META } from '../model';

const EXTENSION_ID = 'martindotts.minuet';
const POLL_MS = 50;

async function waitFor<T>(
  probe: () => T | undefined | false,
  message: string,
  timeoutMs = 15000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined && value !== false) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for: ${message}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

function folder(): vscode.WorkspaceFolder {
  const f = vscode.workspace.workspaceFolders?.[0];
  assert.ok(f, 'the tests run with examples/sample-node as workspace');
  return f;
}

function sampleTourUri(): vscode.Uri {
  return vscode.Uri.joinPath(folder().uri, '.minuet', 'orders.tour.json');
}

function ordersUri(): vscode.Uri {
  return vscode.Uri.joinPath(folder().uri, 'src', 'orders.js');
}

function breakpointLines(): number[] {
  const uri = ordersUri().toString();
  return vscode.debug.breakpoints
    .filter((bp): bp is vscode.SourceBreakpoint => bp instanceof vscode.SourceBreakpoint)
    .filter((bp) => bp.location.uri.toString() === uri)
    .map((bp) => bp.location.range.start.line)
    .sort((a, b) => a - b);
}

suite('minuet (integration)', function () {
  this.timeout(90000);
  let api: MinuetApi;
  const step = (order: number): Annotation => {
    const a = api.store.all().find((x) => x.order === order);
    assert.ok(a, `step ${order} exists`);
    return a;
  };

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension<MinuetApi>(EXTENSION_ID);
    assert.ok(extension, 'extension is installed');
    api = await extension.activate();
    // State from a previous run lives in .vscode-test/user-data; start clean.
    await api.store.replaceAll([]);
    await api.store.setMeta(EMPTY_META);
    vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
    await waitFor(() => vscode.debug.breakpoints.length === 0, 'breakpoints cleared');
  });

  suiteTeardown(async () => {
    await vscode.debug.stopDebugging();
    await api.store.replaceAll([]);
    await api.store.setMeta(EMPTY_META);
    vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
  });

  test('importing the sample tour creates the steps, the breakpoints and the context', async () => {
    const tourUri = sampleTourUri();
    await vscode.commands.executeCommand('minuet.importTour', tourUri);

    const steps = api.store.all();
    assert.deepStrictEqual(
      steps.map((a) => [a.order, a.location.line]),
      [
        [1, 28],
        [2, 13],
        [3, 19],
        [4, 31],
        [5, 33],
      ],
    );
    assert.ok(steps.every((a) => a.location.uri === ordersUri().toString()));
    assert.ok(steps.every((a) => a.breakpointId), 'every annotation is associated with a breakpoint');
    assert.deepStrictEqual(breakpointLines(), [13, 19, 28, 31, 33]);
    assert.match(api.store.getMeta().title, /notification/);
    assert.match(api.store.getMeta().context, /Starting point/);
    assert.ok(steps.every((a) => !api.staleTracker.isStale(a.id)), 'no step is stale right after import');
  });

  test('each annotated line has a CodeLens that shows the step', async () => {
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      ordersUri(),
    );
    const ours = lenses
      .filter((l) => l.command?.command === 'minuet.focusStep')
      .sort((a, b) => a.range.start.line - b.range.start.line);
    assert.deepStrictEqual(
      ours.map((l) => l.range.start.line),
      [13, 19, 28, 31, 33],
    );
    assert.strictEqual(ours[2].command?.title, '◆ Step 1 of 5 · Entry: the order arrives');

    await vscode.commands.executeCommand('minuet.focusStep', step(3).id);
    assert.strictEqual(api.selection.selectedId, step(3).id);
    const state = await waitFor(
      () => (api.stepView.state?.step?.id === step(3).id ? api.stepView.state : undefined),
      'Current Step shows step 3',
    );
    assert.strictEqual(state.navEnabled, true);
    assert.strictEqual(state.watchStatus, 'idle');
    await waitFor(() => api.stepView.isReady, 'the Current Step webview script loads and reports ready');
    await waitFor(
      () => api.stepView.rendered?.stepId === step(3).id && !api.stepView.rendered.stopped,
      'Current Step draws step 3 without a debug session',
    );
    assert.deepStrictEqual(api.stepView.errors, []);
    assert.match(state.step?.commentHtml ?? '', /<code>DISCOUNTS<\/code>/, 'markdown is rendered');
    assert.strictEqual(api.decorations.paintedId, step(3).id, 'without a session the selected step is highlighted');
  });

  test('moving the cursor onto an annotated line selects its step', async () => {
    const editor = await vscode.window.showTextDocument(ordersUri());
    const line = step(2).location.line;
    editor.selection = new vscode.Selection(line, 4, line, 4);
    await waitFor(() => api.selection.selectedId === step(2).id, 'cursor selects step 2');
  });

  test('debugging the sample test stops on every step with real watch values', async () => {
    const started = await vscode.debug.startDebugging(folder(), {
      name: 'minuet integration',
      type: 'node',
      request: 'launch',
      runtimeArgs: ['--test'],
      program: '${workspaceFolder}/test/orders.test.js',
      skipFiles: ['<node_internals>/**'],
      console: 'internalConsole',
    });
    assert.ok(started, 'debug session started');

    const expectations: Array<[number, Record<string, RegExp>]> = [
      [1, { 'order.couponCode': /^'WELCOME'$/, 'order.items.length': /^2$/ }],
      [2, { 'items.length': /^2$/, lines: /Array\(2\)|\[/ }],
      [3, { couponCode: /^'WELCOME'$/, rate: /^0\.1$/, 'subtotal * rate': /^12$/ }],
      [4, { amountText: /\$108\.00/ }],
      [5, { 'order.customer.name': /^'Ana'$/, discountText: /you saved/ }],
    ];

    for (const [order, expected] of expectations) {
      const id = step(order).id;
      const stop = await waitFor(
        () => (api.stops.current?.annotationId === id && api.stops.current.watches ? api.stops.current : undefined),
        `stop at step ${order} with evaluated watches`,
        30000,
      );
      const view = await waitFor(
        () => (api.stepView.state?.step?.id === id && api.stepView.state.watchStatus === 'values' ? api.stepView.state : undefined),
        `Current Step shows the values of step ${order}`,
      );
      assert.strictEqual(view.stopped, true);
      assert.strictEqual(view.navEnabled, false, 'browsing is disabled while stopped');
      assert.strictEqual(view.generation, stop.generation);
      // Starting a session switches the sidebar to Run and Debug; a hidden webview draws nothing until shown.
      await vscode.commands.executeCommand('minuet.step.focus');
      await waitFor(
        () => api.stepView.rendered?.stepId === id && api.stepView.rendered.generation === stop.generation,
        `Current Step draws step ${order} while stopped`,
      );
      assert.deepStrictEqual(api.stepView.errors, []);
      assert.strictEqual(api.decorations.paintedId, id, 'the stopped step is highlighted');
      const values = new Map(stop.watches?.map((w) => [w.expression, w]));
      for (const [expression, pattern] of Object.entries(expected)) {
        const result = values.get(expression);
        assert.ok(result, `watch ${expression} evaluated at step ${order}`);
        assert.strictEqual(result.error, undefined, `watch ${expression} failed: ${result.error}`);
        assert.match(result.value ?? '', pattern, `watch ${expression} at step ${order}`);
      }
      if (order === 1) {
        const orderWatch = values.get('order');
        assert.ok(orderWatch && orderWatch.variablesReference > 0, 'objects can be expanded');
        const children = await api.stops.variables(stop.generation, orderWatch.variablesReference);
        assert.ok(children.some((v) => v.name === 'couponCode'), 'expanding `order` lists its properties');
      }

      const generation = stop.generation;
      await vscode.commands.executeCommand('workbench.action.debug.continue');
      await waitFor(
        () => !api.stops.current || api.stops.current.generation !== generation,
        `step ${order} is cleared after continuing`,
      );
    }

    await waitFor(() => vscode.debug.activeDebugSession === undefined, 'debug session ends', 30000);
    assert.strictEqual(api.stops.current, undefined);
    // The last stopped step stays selected and is previewed again once the session is over.
    assert.strictEqual(api.decorations.paintedId, step(5).id);
    assert.deepStrictEqual(
      api.stops.lastRunHits,
      [1, 2, 3, 4, 5].map((order) => step(order).id),
      'the run records the order in which each step was hit',
    );
  });

  test('a tour ordered by reading, not by execution, records the real hit order', async () => {
    // Swap steps 1 and 2: the tour now says "subtotal" before "entry", but entry runs first.
    const entry = step(1);
    const subtotal = step(2);
    await api.store.move(subtotal.id, -1);
    await vscode.debug.startDebugging(folder(), {
      name: 'minuet integration (order)',
      type: 'node',
      request: 'launch',
      runtimeArgs: ['--test'],
      program: '${workspaceFolder}/test/orders.test.js',
      skipFiles: ['<node_internals>/**'],
      console: 'internalConsole',
    });
    for (const expected of [entry, subtotal]) {
      await waitFor(() => api.stops.current?.annotationId === expected.id, `stop at ${expected.title}`, 30000);
      await vscode.commands.executeCommand('workbench.action.debug.continue');
    }
    await vscode.debug.stopDebugging();
    await waitFor(() => vscode.debug.activeDebugSession === undefined, 'debug session ends', 30000);
    assert.deepStrictEqual(api.stops.lastRunHits.slice(0, 2), [entry.id, subtotal.id]);
    await api.store.move(entry.id, -1);
    assert.deepStrictEqual(
      api.store.all().map((a) => a.id).slice(0, 2),
      [entry.id, subtotal.id],
    );
  });

  test('a failing watch shows the error without breaking the others', async () => {
    const first = step(1);
    await api.store.update(first.id, { watches: ['doesNotExist.value', 'order.id'] });
    await vscode.debug.startDebugging(folder(), {
      name: 'minuet integration (errors)',
      type: 'node',
      request: 'launch',
      runtimeArgs: ['--test'],
      program: '${workspaceFolder}/test/orders.test.js',
      skipFiles: ['<node_internals>/**'],
      console: 'internalConsole',
    });
    const stop = await waitFor(
      () => (api.stops.current?.annotationId === first.id && api.stops.current.watches ? api.stops.current : undefined),
      'stop at step 1',
      30000,
    );
    const [broken, ok] = stop.watches ?? [];
    assert.ok(broken.error, 'the missing variable reports an error');
    assert.match(ok.value ?? '', /A-1001/);
    await vscode.debug.stopDebugging();
    await waitFor(() => api.stops.current === undefined, 'cleared when the session ends');
    await api.store.update(first.id, { watches: first.watches });
  });

  test('editing the anchored line marks the step as stale', async () => {
    const first = step(1);
    const doc = await vscode.workspace.openTextDocument(ordersUri());
    const line = doc.lineAt(first.location.line);

    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, line.range.end, ' // changed');
    assert.ok(await vscode.workspace.applyEdit(edit));
    await waitFor(() => api.staleTracker.isStale(first.id), 'step 1 becomes stale');

    const undo = new vscode.WorkspaceEdit();
    undo.delete(doc.uri, new vscode.Range(line.range.end, line.range.end.translate(0, ' // changed'.length)));
    assert.ok(await vscode.workspace.applyEdit(undo));
    await waitFor(() => !api.staleTracker.isStale(first.id), 'step 1 is up to date again');
    await revert(doc);
  });

  test('inserting a line above a breakpoint moves the annotation with it', async () => {
    const second = step(2);
    const doc = await vscode.workspace.openTextDocument(ordersUri());
    await vscode.window.showTextDocument(doc);
    const original = second.location.line;

    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, new vscode.Position(original, 0), '  // inserted\n');
    assert.ok(await vscode.workspace.applyEdit(edit));
    await waitFor(() => api.store.get(second.id)?.location.line === original + 1, 'annotation follows its breakpoint');
    assert.deepStrictEqual(api.store.get(second.id)?.highlights[0], { startLine: 9, endLine: 13, note: 'price × quantity per item' });
    assert.strictEqual(api.staleTracker.isStale(second.id), false);

    const undo = new vscode.WorkspaceEdit();
    undo.delete(doc.uri, new vscode.Range(original, 0, original + 1, 0));
    assert.ok(await vscode.workspace.applyEdit(undo));
    await waitFor(() => api.store.get(second.id)?.location.line === original, 'annotation moves back');
    await revert(doc);
  });

  test('removing an annotated breakpoint deletes its annotation', async () => {
    const last = step(5);
    const bp = vscode.debug.breakpoints.find((b) => b.id === last.breakpointId);
    assert.ok(bp, 'step 5 breakpoint exists');
    vscode.debug.removeBreakpoints([bp]);
    await waitFor(() => api.store.get(last.id) === undefined, 'annotation removed with its breakpoint');
    assert.strictEqual(api.store.count(), 4);
  });

  test('deleting an annotation keeps its breakpoint', async () => {
    const first = step(1);
    await api.store.remove(first.id);
    assert.ok(vscode.debug.breakpoints.some((b) => b.id === first.breakpointId));
    assert.deepStrictEqual(
      api.store.all().map((a) => a.order),
      [1, 2, 3],
    );
  });
});

/** Discards in-memory edits so nothing is written to the sample project. */
async function revert(doc: vscode.TextDocument): Promise<void> {
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('workbench.action.files.revert');
  assert.strictEqual(doc.isDirty, false);
}

suite('minuet (saved tours)', function () {
  this.timeout(60000);
  let api: MinuetApi;
  // A copy saved next to the sample tour; the sample itself is never written.
  const savedUri = (): vscode.Uri => vscode.Uri.joinPath(folder().uri, '.minuet', 'test-copy.tour.json');
  const outsideUri = (): vscode.Uri => vscode.Uri.file(path.join(os.tmpdir(), 'minuet-outside.tour.json'));
  const readSaved = async (): Promise<{ title: string; steps: unknown[] }> =>
    JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(savedUri())));
  const reset = async (): Promise<void> => {
    await api.store.replaceAll([]);
    await api.store.setMeta(EMPTY_META);
    await api.store.setSource(undefined);
    vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
    for (const uri of [savedUri(), outsideUri()]) {
      await vscode.workspace.fs.delete(uri).then(undefined, () => undefined);
    }
  };

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension<MinuetApi>(EXTENSION_ID);
    assert.ok(extension, 'extension is installed');
    api = await extension.activate();
    await reset();
  });

  suiteTeardown(() => reset());

  test('the sample tour is listed in Saved Tours', async () => {
    await waitFor(
      () => api.library.saved.some((t) => t.uri.fsPath === sampleTourUri().fsPath && t.steps === 5),
      'Saved Tours lists .minuet/orders.tour.json',
    );
  });

  test('a tour imported from outside the tours folder starts unsaved', async () => {
    await vscode.workspace.fs.copy(sampleTourUri(), outsideUri(), { overwrite: true });
    await vscode.commands.executeCommand('minuet.importTour', outsideUri());
    assert.strictEqual(api.store.count(), 5);
    assert.strictEqual(api.store.getSource(), undefined);
    assert.ok(api.library.isDirty());
  });

  test('a tour imported from the tours folder opens as that saved tour', async () => {
    await reset();
    await vscode.commands.executeCommand('minuet.importTour', sampleTourUri());
    assert.ok(api.library.isOpen(sampleTourUri()));
    assert.ok(!api.library.isDirty());
  });

  test('saving to a new file writes it and lists it', async () => {
    await vscode.commands.executeCommand('minuet.saveTour', savedUri());
    const saved = await readSaved();
    assert.match(saved.title, /notification/);
    assert.strictEqual(saved.steps.length, 5);
    assert.ok(!api.library.isDirty(), 'nothing left to save');
    assert.ok(api.library.isOpen(savedUri()));
    await waitFor(
      () => api.library.saved.some((t) => t.uri.fsPath === savedUri().fsPath && t.steps === 5),
      'Saved Tours lists the new file',
    );
  });

  test('changes stay out of the file until saving again', async () => {
    await api.store.setMeta({ ...api.store.getMeta(), title: 'Order notification, revised' });
    assert.ok(api.library.isDirty());
    assert.match((await readSaved()).title, /^How/, 'the file still has the old title');

    await vscode.commands.executeCommand('minuet.saveTour');
    assert.strictEqual((await readSaved()).title, 'Order notification, revised');
    assert.ok(!api.library.isDirty());
  });

  test('closing a saved tour removes its annotations and breakpoints, not its file', async () => {
    await vscode.commands.executeCommand('minuet.closeTour');
    assert.strictEqual(api.store.count(), 0);
    assert.strictEqual(api.store.getSource(), undefined);
    await waitFor(() => breakpointLines().length === 0, 'the breakpoints of the tour are removed');
    assert.strictEqual((await readSaved()).steps.length, 5);
  });

  test('opening a saved tour brings back its steps and breakpoints', async () => {
    await vscode.commands.executeCommand('minuet.openSavedTour', savedUri());
    assert.strictEqual(api.store.count(), 5);
    assert.strictEqual(api.store.getMeta().title, 'Order notification, revised');
    assert.deepStrictEqual(breakpointLines(), [13, 19, 28, 31, 33]);
    assert.ok(api.library.isOpen(savedUri()));
    assert.ok(!api.library.isDirty());
  });
});
