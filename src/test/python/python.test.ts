import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as vscode from 'vscode';
import { MinuetApi } from '../../extension';
import { Annotation } from '../../model';

// Runs with `npm run test:python`: the workspace is examples/sample-python and the Python debugger
// extension (debugpy) is installed in the test instance.

const EXTENSION_ID = 'martindotts.minuet';

async function waitFor<T>(probe: () => T | undefined | false, message: string, timeoutMs = 15000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined && value !== false) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for: ${message}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

function folder(): vscode.WorkspaceFolder {
  const f = vscode.workspace.workspaceFolders?.[0];
  assert.ok(f, 'the tests run with examples/sample-python as workspace');
  return f;
}

const sampleTour = (): vscode.Uri => vscode.Uri.joinPath(folder().uri, '.minuet', 'orders.tour.json');
const testTour = (): vscode.Uri => vscode.Uri.joinPath(folder().uri, '.minuet', 'test-run.tour.json');

/** The interpreter for debugpy: MINUET_PYTHON, or python3 from the PATH. */
function python(): string {
  return process.env.MINUET_PYTHON ?? execFileSync('which', ['python3'], { encoding: 'utf8' }).trim();
}

suite('minuet (Python, debugpy)', function () {
  this.timeout(120000);
  let api: MinuetApi;
  const step = (order: number): Annotation => {
    const a = api.store.all().find((x) => x.order === order);
    assert.ok(a, `step ${order} exists`);
    return a;
  };

  const clean = async (): Promise<void> => {
    await vscode.debug.stopDebugging();
    await api.tours.close();
    vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
    await vscode.workspace.fs.delete(testTour()).then(undefined, () => undefined);
  };

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension<MinuetApi>(EXTENSION_ID);
    assert.ok(extension, 'extension is installed');
    api = await extension.activate();
    assert.ok(vscode.extensions.getExtension('ms-python.debugpy'), 'the Python debugger extension is installed');
    await clean();
    await vscode.workspace.fs.copy(sampleTour(), testTour());
  });

  suiteTeardown(() => clean());

  test('debugging a Python test stops on every step with real watch values', async () => {
    await vscode.commands.executeCommand('minuet.openTour', testTour());
    assert.strictEqual(api.store.count(), 5);

    const started = await vscode.debug.startDebugging(folder(), {
      name: 'minuet integration (Python)',
      type: 'debugpy',
      request: 'launch',
      program: '${workspaceFolder}/test_orders.py',
      cwd: '${workspaceFolder}',
      python: python(),
      console: 'internalConsole',
      justMyCode: true,
    });
    assert.ok(started, 'debug session started');

    const expectations: Array<[number, Record<string, RegExp>]> = [
      [1, { "order['coupon_code']": /^'WELCOME'$/, "len(order['items'])": /^2$/ }],
      [2, { subtotal: /^120$/, lines: /'MUG'/ }],
      [3, { coupon_code: /^'WELCOME'$/, rate: /^0\.1$/, 'subtotal * rate': /^12(\.0+\d*)?$/ }],
      [4, { amount_text: /^'\$108\.00'$/ }],
      [5, { "order['customer']['name']": /^'Ana'$/, discount_text: /you saved \$12\.00/ }],
    ];

    for (const [order, expected] of expectations) {
      const id = step(order).id;
      const stop = await waitFor(
        () => (api.stops.current?.annotationId === id && api.stops.current.watches ? api.stops.current : undefined),
        `stop at step ${order} with evaluated watches`,
        60000,
      );
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
        assert.ok(orderWatch && orderWatch.variablesReference > 0, 'dicts can be expanded');
        const children = await api.stops.variables(stop.generation, orderWatch.variablesReference);
        assert.ok(children.some((v) => v.name.includes('coupon_code')), 'expanding `order` lists its keys');
      }
      const generation = stop.generation;
      await vscode.commands.executeCommand('workbench.action.debug.continue');
      await waitFor(
        () => !api.stops.current || api.stops.current.generation !== generation,
        `step ${order} is cleared after continuing`,
      );
    }

    await waitFor(() => vscode.debug.activeDebugSession === undefined, 'debug session ends', 60000);
    assert.deepStrictEqual(
      api.stops.lastRunHits,
      [1, 2, 3, 4, 5].map((order) => step(order).id),
      'the run records the order in which each step was hit',
    );
  });
});
