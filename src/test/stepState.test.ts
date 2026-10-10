import * as assert from 'assert';
import { Annotation } from '../model';
import { buildStepState, neighbourId, StepStateInput } from '../stepState';

function step(id: string, order: number, watches: string[] = []): Annotation {
  return {
    id,
    location: { uri: 'file:///w/a.js', line: order * 10 },
    anchorText: '',
    order,
    title: `Step ${id}`,
    comment: `comment ${id}`,
    highlights: [],
    watches,
  };
}

const annotations = [
  step('c', 3),
  { ...step('a', 1, ['x', 'y']), highlights: [{ startLine: 8, endLine: 12, note: 'n' }, { startLine: 2, endLine: 2 }] },
  step('b', 2),
];

function input(overrides: Partial<StepStateInput> = {}): StepStateInput {
  return {
    annotations,
    selectedId: undefined,
    stop: undefined,
    inSession: false,
    isStale: () => false,
    location: (a) => `a.js:${a.location.line + 1}`,
    commentHtml: '<p>html</p>',
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
    assert.strictEqual(buildStepState(input({ annotations: [] })).empty, true);
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
      input({ selectedId: 'c', inSession: true, stop: { annotationId: 'a', watches: undefined, generation: 7 } }),
    );
    assert.strictEqual(state.step?.id, 'a');
    assert.strictEqual(state.stopped, true);
    assert.strictEqual(state.navEnabled, false);
    assert.strictEqual(state.watchStatus, 'evaluating');
    assert.strictEqual(state.generation, 7);
  });

  test('values are exposed once evaluated', () => {
    const watches = [{ expression: 'x', value: '1', variablesReference: 0 }];
    const state = buildStepState(input({ stop: { annotationId: 'a', watches, generation: 2 } }));
    assert.strictEqual(state.watchStatus, 'values');
    assert.deepStrictEqual(state.results, watches);
  });

  test('stale flag and raw comment are passed through', () => {
    const state = buildStepState(input({ selectedId: 'a', isStale: (id) => id === 'a' }));
    assert.strictEqual(state.step?.stale, true);
    assert.strictEqual(state.step?.comment, 'comment a');
    assert.strictEqual(state.step?.commentHtml, '<p>html</p>');
    assert.deepStrictEqual(state.step?.watches, ['x', 'y']);
  });

  test('highlights are shown 1-based', () => {
    const state = buildStepState(input({ selectedId: 'a' }));
    assert.deepStrictEqual(state.step?.highlights, [
      { startLine: 9, endLine: 13, note: 'n' },
      { startLine: 3, endLine: 3 },
    ]);
  });

  test('neighbourId follows tour order', () => {
    assert.strictEqual(neighbourId(annotations, 'a', 1), 'b');
    assert.strictEqual(neighbourId(annotations, 'b', -1), 'a');
    assert.strictEqual(neighbourId(annotations, 'c', 1), undefined);
    assert.strictEqual(neighbourId(annotations, 'missing', 1), undefined);
  });
});
