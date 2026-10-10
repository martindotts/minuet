import * as assert from 'assert';
import { Step } from '../../core/model';
import { buildStepState, neighbourId, StepStateInput } from '../../views/currentStep/state';

function step(id: string, order: number, watches: string[] = []): Step {
  return {
    id,
    location: { uri: 'file:///w/a.js', line: order * 10 },
    anchorText: '',
    order,
    title: `Step ${id}`,
    content: `content ${id}`,
    highlights: [],
    watches,
  };
}

const steps = [
  step('c', 3),
  { ...step('a', 1, ['x', 'y']), highlights: [{ startLine: 8, endLine: 12, note: 'n' }, { startLine: 2, endLine: 2 }] },
  step('b', 2),
];

function input(overrides: Partial<StepStateInput> = {}): StepStateInput {
  return {
    steps,
    selectedId: undefined,
    stop: undefined,
    inSession: false,
    isStale: () => false,
    location: (a) => `a.js:${a.location.line + 1}`,
    content: { html: '<p>html</p>', page: false },
    ...overrides,
  };
}

suite('step view state', () => {
  test('nothing selected: no step, but the tour is not empty', () => {
    const state = buildStepState(input());
    assert.strictEqual(state.step, undefined);
    assert.strictEqual(state.empty, false);
  });

  test('an empty workspace is reported as empty', () => {
    assert.strictEqual(buildStepState(input({ steps: [] })).empty, true);
  });

  test('shows the selected step with its position and neighbours', () => {
    const state = buildStepState(input({ selectedId: 'b' }));
    assert.strictEqual(state.step?.id, 'b');
    assert.strictEqual(state.step?.order, 2);
    assert.strictEqual(state.step?.total, 3);
    assert.strictEqual(state.step?.location, 'a.js:21');
    assert.strictEqual(state.hasPrev, true);
    assert.strictEqual(state.hasNext, true);
    assert.strictEqual(state.navEnabled, true);
    assert.strictEqual(state.stopped, false);
    assert.strictEqual(state.watchStatus, 'idle');
  });

  test('first and last steps have no previous/next', () => {
    assert.strictEqual(buildStepState(input({ selectedId: 'a' })).hasPrev, false);
    assert.strictEqual(buildStepState(input({ selectedId: 'c' })).hasNext, false);
  });

  test('navigation is not offered while a debug session is active, even if stopped elsewhere', () => {
    const state = buildStepState(input({ selectedId: 'b', inSession: true }));
    assert.strictEqual(state.step?.id, 'b');
    assert.strictEqual(state.stopped, false);
    assert.strictEqual(state.navEnabled, false);
  });

  test('the stopped step wins over the selection and disables navigation', () => {
    const state = buildStepState(
      input({ selectedId: 'c', inSession: true, stop: { stepId: 'a', watches: undefined, generation: 7 } }),
    );
    assert.strictEqual(state.step?.id, 'a');
    assert.strictEqual(state.stopped, true);
    assert.strictEqual(state.navEnabled, false);
    assert.strictEqual(state.watchStatus, 'evaluating');
    assert.strictEqual(state.generation, 7);
  });

  test('values are exposed once evaluated', () => {
    const watches = [{ expression: 'x', value: '1', variablesReference: 0 }];
    const state = buildStepState(input({ stop: { stepId: 'a', watches, generation: 2 } }));
    assert.strictEqual(state.watchStatus, 'values');
    assert.deepStrictEqual(state.results, watches);
  });

  test('stale flag and raw content are passed through', () => {
    const state = buildStepState(input({ selectedId: 'a', isStale: (id) => id === 'a' }));
    assert.strictEqual(state.step?.stale, true);
    assert.strictEqual(state.step?.contentText, 'content a');
    assert.strictEqual(state.step?.contentHtml, '<p>html</p>');
    assert.strictEqual(state.step?.contentPage, false);
    assert.deepStrictEqual(state.step?.watches, ['x', 'y']);
  });

  test('content from a file is not editable inline', () => {
    const steps = input().steps.map((a) => (a.id === 'a' ? { ...a, content: { file: 'page.html' } } : a));
    const state = buildStepState(input({ steps, selectedId: 'a', content: { html: '', file: 'page.html', page: true } }));
    assert.strictEqual(state.step?.contentText, undefined);
    assert.strictEqual(state.step?.contentFile, 'page.html');
    assert.strictEqual(state.step?.contentPage, true);
  });

  test('highlights are shown 1-based', () => {
    const state = buildStepState(input({ selectedId: 'a' }));
    assert.deepStrictEqual(state.step?.highlights, [
      { startLine: 9, endLine: 13, note: 'n' },
      { startLine: 3, endLine: 3 },
    ]);
  });

  test('neighbourId follows tour order', () => {
    assert.strictEqual(neighbourId(steps, 'a', 1), 'b');
    assert.strictEqual(neighbourId(steps, 'b', -1), 'a');
    assert.strictEqual(neighbourId(steps, 'c', 1), undefined);
    assert.strictEqual(neighbourId(steps, 'missing', 1), undefined);
  });
});
