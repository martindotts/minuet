import * as assert from 'assert';
import * as vscode from 'vscode';
import { Step } from '../../core/model';
import { MinuetApi } from '../../extension';

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
  assert.ok(f, 'the tests run with src/test/fixtures/orders as workspace');
  return f;
}

function sampleTourUri(): vscode.Uri {
  return vscode.Uri.joinPath(folder().uri, '.minuet', 'orders', 'tour.json');
}

/** Tours are written on every change, so the tests work on a copy of the sample tour's folder. */
function testTourDir(): vscode.Uri {
  return vscode.Uri.joinPath(folder().uri, '.minuet', 'test-run');
}

function testTourUri(): vscode.Uri {
  return vscode.Uri.joinPath(testTourDir(), 'tour.json');
}

async function copySample(): Promise<void> {
  await vscode.workspace.fs.copy(vscode.Uri.joinPath(sampleTourUri(), '..'), testTourDir(), { overwrite: true });
}

async function readTour(uri = testTourUri()): Promise<{ title: string; steps: { line: number }[] }> {
  return JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
}

/** No open tour, no breakpoints and no test copy: state from a previous run lives in .vscode-test. */
async function startClean(api: MinuetApi): Promise<void> {
  await api.tours.close();
  vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
  await waitFor(() => vscode.debug.breakpoints.length === 0, 'breakpoints cleared');
  await vscode.workspace.fs.delete(testTourDir(), { recursive: true }).then(undefined, () => undefined);
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
  const step = (order: number): Step => {
    const a = api.store.all().find((x) => x.order === order);
    assert.ok(a, `step ${order} exists`);
    return a;
  };

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension<MinuetApi>(EXTENSION_ID);
    assert.ok(extension, 'extension is installed');
    api = await extension.activate();
    await startClean(api);
    await copySample();
  });

  suiteTeardown(async () => {
    await vscode.debug.stopDebugging();
    await startClean(api);
  });

  test('opening a tour creates the steps, the breakpoints and the context', async () => {
    await vscode.commands.executeCommand('minuet.openTour', testTourUri());
    assert.ok(api.tours.isOpen(testTourUri()));

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
    assert.ok(steps.every((a) => a.breakpointId), 'every step is associated with a breakpoint');
    assert.deepStrictEqual(breakpointLines(), [13, 19, 28, 31, 33]);
    assert.match(api.store.getMeta().title, /notification/);
    assert.deepStrictEqual(api.store.getMeta().context, { file: 'context.md' });
    assert.ok(steps.every((a) => !api.staleTracker.isStale(a.id)), 'no step is stale right after opening');
  });

  test('the line of each step has a CodeLens that shows the step', async () => {
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
      () => (api.currentStep.state?.step?.id === step(3).id ? api.currentStep.state : undefined),
      'Current Step shows step 3',
    );
    assert.strictEqual(state.navEnabled, true);
    assert.strictEqual(state.watchStatus, 'idle');
    await waitFor(() => api.currentStep.isReady, 'the Current Step webview script loads and reports ready');
    await waitFor(
      () => api.currentStep.rendered?.stepId === step(3).id && !api.currentStep.rendered.stopped,
      'Current Step draws step 3 without a debug session',
    );
    assert.deepStrictEqual(api.currentStep.errors, []);
    assert.strictEqual(state.step?.contentPage, true, 'step 3 is explained in an HTML page');
    assert.strictEqual(state.step?.contentFile, 'discount.html');
    assert.strictEqual(api.decorations.paintedId, step(3).id, 'without a session the selected step is highlighted');

    await vscode.commands.executeCommand('minuet.focusStep', step(2).id);
    const second = await waitFor(
      () => (api.currentStep.state?.step?.id === step(2).id ? api.currentStep.state : undefined),
      'Current Step shows step 2',
    );
    assert.match(second.step?.contentHtml ?? '', /<code>total = unitPrice × quantity<\/code>/, 'markdown is rendered');
  });

  test('moving the cursor onto the line of a step selects its step', async () => {
    const editor = await vscode.window.showTextDocument(ordersUri());
    const line = step(2).location.line;
    editor.selection = new vscode.Selection(line, 4, line, 4);
    await waitFor(() => api.selection.selectedId === step(2).id, 'cursor selects step 2');
  });

  test('debugging the sample test stops on every step with real watch values', async () => {
    // The run configuration comes from the tour file.
    await vscode.commands.executeCommand('minuet.runTour');
    await waitFor(() => vscode.debug.activeDebugSession, 'Run Tour starts a debug session');

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
        () => (api.stops.current?.stepId === id && api.stops.current.watches ? api.stops.current : undefined),
        `stop at step ${order} with evaluated watches`,
        30000,
      );
      const view = await waitFor(
        () => (api.currentStep.state?.step?.id === id && api.currentStep.state.watchStatus === 'values' ? api.currentStep.state : undefined),
        `Current Step shows the values of step ${order}`,
      );
      assert.strictEqual(view.stopped, true);
      assert.strictEqual(view.navEnabled, false, 'browsing is disabled while stopped');
      assert.strictEqual(view.generation, stop.generation);
      // Starting a session switches the sidebar to Run and Debug; a hidden webview draws nothing until shown.
      await api.currentStep.reveal();
      await waitFor(
        () => api.currentStep.rendered?.stepId === id && api.currentStep.rendered.generation === stop.generation,
        `Current Step draws step ${order} while stopped`,
      );
      assert.deepStrictEqual(api.currentStep.errors, []);
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

        // "Add to Step" from the Variables view: the expression is added and evaluated right away.
        await vscode.commands.executeCommand('minuet.addVariableToStep', { variable: { name: 'id', evaluateName: 'order.id' } });
        const added = await waitFor(
          () => api.stops.current?.watches?.find((w) => w.expression === 'order.id'),
          'the variable is evaluated in the step',
        );
        assert.strictEqual(added.value, "'A-1001'");
        await api.store.update(step(1).id, { watches: step(1).watches.filter((w) => w !== 'order.id') });
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
      await waitFor(() => api.stops.current?.stepId === expected.id, `stop at ${expected.title}`, 30000);
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
      () => (api.stops.current?.stepId === first.id && api.stops.current.watches ? api.stops.current : undefined),
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

  test('inserting a line above a breakpoint moves the step with it', async () => {
    const second = step(2);
    const doc = await vscode.workspace.openTextDocument(ordersUri());
    await vscode.window.showTextDocument(doc);
    const original = second.location.line;

    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, new vscode.Position(original, 0), '  // inserted\n');
    assert.ok(await vscode.workspace.applyEdit(edit));
    await waitFor(() => api.store.get(second.id)?.location.line === original + 1, 'step follows its breakpoint');
    assert.deepStrictEqual(api.store.get(second.id)?.highlights[0], { startLine: 9, endLine: 13, note: 'price × quantity per item' });
    assert.strictEqual(api.staleTracker.isStale(second.id), false);

    const undo = new vscode.WorkspaceEdit();
    undo.delete(doc.uri, new vscode.Range(original, 0, original + 1, 0));
    assert.ok(await vscode.workspace.applyEdit(undo));
    await waitFor(() => api.store.get(second.id)?.location.line === original, 'step moves back');
    await revert(doc);
  });

  test('removing the breakpoint of a step deletes the step', async () => {
    const last = step(5);
    const bp = vscode.debug.breakpoints.find((b) => b.id === last.breakpointId);
    assert.ok(bp, 'step 5 breakpoint exists');
    vscode.debug.removeBreakpoints([bp]);
    await waitFor(() => api.store.get(last.id) === undefined, 'step removed with its breakpoint');
    assert.strictEqual(api.store.count(), 4);
    await api.tours.flush();
    assert.strictEqual((await readTour()).steps.length, 4, 'the tour file loses the step too');
  });

  test('deleting a step keeps its breakpoint', async () => {
    const first = step(1);
    await api.store.remove(first.id);
    assert.ok(vscode.debug.breakpoints.some((b) => b.id === first.breakpointId));
    assert.deepStrictEqual(
      api.store.all().map((a) => a.order),
      [1, 2, 3],
    );
    await api.tours.flush();
    assert.strictEqual((await readTour()).steps.length, 3);
  });
});

/** Discards in-memory edits so nothing is written to the sample project. */
async function revert(doc: vscode.TextDocument): Promise<void> {
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('workbench.action.files.revert');
  assert.strictEqual(doc.isDirty, false);
}

suite('minuet (tour files)', function () {
  this.timeout(60000);
  let api: MinuetApi;
  const lines = (tour: { steps: { line: number }[] }): number[] => tour.steps.map((st) => st.line - 1).sort((a, b) => a - b);

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension<MinuetApi>(EXTENSION_ID);
    assert.ok(extension, 'extension is installed');
    api = await extension.activate();
    await startClean(api);
    await copySample();
  });

  suiteTeardown(() => startClean(api));

  test('the tours folder lists its tour files', async () => {
    await waitFor(
      () =>
        api.tours.list.some((t) => t.uri.fsPath === sampleTourUri().fsPath && t.steps === 5) &&
        api.tours.list.some((t) => t.uri.fsPath === testTourUri().fsPath),
      'Tours lists the sample and the test copy',
    );
  });

  test('changes are written to the tour file right away', async () => {
    await vscode.commands.executeCommand('minuet.openTour', testTourUri());
    await api.store.setMeta({ ...api.store.getMeta(), title: 'Order notification, revised' });
    await api.tours.flush();
    assert.strictEqual((await readTour()).title, 'Order notification, revised');
    assert.match((await readTour(sampleTourUri())).title, /^How/, 'the sample is untouched');
  });

  test('editing the open tour file reloads the steps and their breakpoints', async () => {
    const tour = await readTour();
    tour.steps = tour.steps.filter((st) => st.line - 1 !== 33);
    await vscode.workspace.fs.writeFile(testTourUri(), new TextEncoder().encode(JSON.stringify(tour, null, 2)));
    await waitFor(() => api.store.count() === 4, 'the tour reloads with 4 steps');
    await waitFor(() => breakpointLines().join() === '13,19,28,31', 'the removed step loses its breakpoint');
  });

  test('an HTML page is drawn in Current Step, without scripts or network', async () => {
    const third = api.store.all().find((a) => a.order === 3);
    assert.ok(third);
    await vscode.commands.executeCommand('minuet.focusStep', third.id);
    const state = await waitFor(
      () => (api.currentStep.state?.step?.id === third.id && api.currentStep.state.step.contentBase ? api.currentStep.state : undefined),
      'Current Step gets the page and its folder',
    );
    assert.strictEqual(state.step?.contentPage, true);
    assert.match(state.step?.contentHtml ?? '', /<table>/, 'the page is sent as written');
    assert.match(state.step?.contentBase ?? '', /\/test-run\/$/, 'relative files resolve next to the page');
    await waitFor(() => api.currentStep.rendered?.stepId === third.id, 'Current Step draws the page');
    assert.deepStrictEqual(api.currentStep.errors, []);

    // The tab's policy: only the extension's own script, and nothing from the network.
    const html = api.currentStep.html ?? '';
    assert.match(html, /script-src 'nonce-[^']+'(;|")/, 'no scripts but the view\'s own');
    assert.doesNotMatch(html, /connect-src/, 'no requests');
    const images = /img-src ([^;"]+)/.exec(html)?.[1].trim().split(/\s+/) ?? [];
    for (const source of images) {
      assert.ok(source === "'self'" || source === 'data:' || /vscode-(cdn|resource)/.test(source), `no images from the network (${source})`);
    }
  });

  test('clicking the open tour shows its context in Current Step', async () => {
    await vscode.commands.executeCommand('minuet.openTour', testTourUri());
    const state = await waitFor(
      () => (api.currentStep.state?.context ? api.currentStep.state : undefined),
      'Current Step shows the tour context',
    );
    assert.strictEqual(state.step, undefined);
    assert.strictEqual(state.context?.title, 'Order notification, revised');
    assert.strictEqual(state.context?.contentFile, 'context.md');
    assert.match(state.context?.contentHtml ?? '', /Starting point/);

    const first = api.store.all()[0];
    await vscode.commands.executeCommand('minuet.focusStep', first.id);
    await waitFor(() => api.currentStep.state?.step?.id === first.id, 'selecting a step leaves the context');
    assert.strictEqual(api.currentStep.state?.context, undefined);
  });

  test('a markdown file is rendered, and edits to it show up', async () => {
    await api.currentStep.showContext();
    await waitFor(() => api.currentStep.state?.context?.contentHtml.includes('Starting point'), 'context.md is rendered');
    const contextFile = vscode.Uri.joinPath(testTourDir(), 'context.md');
    await vscode.workspace.fs.writeFile(contextFile, new TextEncoder().encode('## Changed by hand\n'));
    await waitFor(
      () => api.currentStep.state?.context?.contentHtml.includes('Changed by hand'),
      'Current Step reloads when the file changes',
    );
  });

  test('closing a tour removes its steps and breakpoints, not its file', async () => {
    await vscode.commands.executeCommand('minuet.closeTour');
    assert.strictEqual(api.store.count(), 0);
    assert.strictEqual(api.tours.activeFile, undefined);
    await waitFor(() => breakpointLines().length === 0, 'the breakpoints of the tour are removed');
    assert.deepStrictEqual(lines(await readTour()), [13, 19, 28, 31]);
  });

  test('removing every breakpoint of the tour closes it instead of emptying the file', async () => {
    await vscode.commands.executeCommand('minuet.openTour', testTourUri());
    assert.deepStrictEqual(breakpointLines(), [13, 19, 28, 31]);
    vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
    await waitFor(() => api.tours.activeFile === undefined, 'the tour is closed');
    await api.tours.flush();
    assert.deepStrictEqual(lines(await readTour()), [13, 19, 28, 31], 'the file keeps its steps');
  });

  test('deleting the file of the open tour closes it', async () => {
    await vscode.commands.executeCommand('minuet.openTour', testTourUri());
    assert.strictEqual(api.store.count(), 4);
    await vscode.workspace.fs.delete(testTourDir(), { recursive: true });
    await waitFor(() => api.tours.activeFile === undefined && api.store.count() === 0, 'the tour is closed');
    await waitFor(() => breakpointLines().length === 0, 'its breakpoints are removed');
  });
});
