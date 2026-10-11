import * as assert from 'assert';
import * as vscode from 'vscode';
import { MinuetApi } from '../../extension';

// Runs with the examples/checkout workspace: the showcase tour must open and run end to end, whatever its
// content becomes. It works on a copy of the tour, since tours are written on every change.

const EXTENSION_ID = 'martindotts.minuet';

async function waitFor<T>(probe: () => T | undefined | false, message: string, timeoutMs = 30000): Promise<T> {
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
  assert.ok(f, 'the tests run with examples/checkout as workspace');
  return f;
}

const tourDir = (): vscode.Uri => vscode.Uri.joinPath(folder().uri, '.minuet', 'checkout');
const copyDir = (): vscode.Uri => vscode.Uri.joinPath(folder().uri, '.minuet', 'test-run');

suite('example: checkout tour', function () {
  this.timeout(120000);
  let api: MinuetApi;

  const clean = async (): Promise<void> => {
    await vscode.debug.stopDebugging();
    await api.tours.close();
    vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
    await vscode.workspace.fs.delete(copyDir(), { recursive: true }).then(undefined, () => undefined);
  };

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension<MinuetApi>(EXTENSION_ID);
    assert.ok(extension, 'extension is installed');
    api = await extension.activate();
    await clean();
    await vscode.workspace.fs.copy(tourDir(), copyDir());
  });

  suiteTeardown(() => clean());

  test('opens with no outdated step and its pages readable', async () => {
    await vscode.commands.executeCommand('minuet.openTour', vscode.Uri.joinPath(copyDir(), 'tour.json'));
    const steps = api.store.all();
    assert.ok(steps.length > 0, 'the tour has steps');
    await api.staleTracker.refresh();
    assert.deepStrictEqual(
      steps.filter((s) => api.staleTracker.isStale(s.id)).map((s) => s.title),
      [],
      'every anchorText matches its line',
    );
    const context = await waitFor(() => api.currentStep.state?.context, 'the context is shown');
    assert.strictEqual(context.contentError, undefined, context.contentError);
  });

  test('runs with ▶ and stops at every step, in order, with every expression evaluated', async () => {
    const steps = api.store.all();
    await vscode.commands.executeCommand('minuet.runTour');
    for (const step of steps) {
      const stop = await waitFor(
        () => (api.stops.current?.stepId === step.id && api.stops.current.watches ? api.stops.current : undefined),
        `stop at step ${step.order} (${step.title})`,
      );
      const failed = (stop.watches ?? []).filter((w) => w.error).map((w) => `${w.expression}: ${w.error}`);
      assert.deepStrictEqual(failed, [], `expressions of step ${step.order}`);
      const state = await waitFor(() => (api.currentStep.state?.step?.id === step.id ? api.currentStep.state : undefined), 'Current Step');
      assert.strictEqual(state.step?.contentError, undefined, state.step?.contentError);
      const generation = stop.generation;
      await vscode.commands.executeCommand('workbench.action.debug.continue');
      await waitFor(() => !api.stops.current || api.stops.current.generation !== generation, `leave step ${step.order}`);
    }
    await waitFor(() => vscode.debug.activeDebugSession === undefined, 'the run ends');
    assert.deepStrictEqual(api.stops.lastRunHits, steps.map((s) => s.id), 'the steps are in execution order');
  });
});
