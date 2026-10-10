import * as assert from 'assert';
import { isInExecutionOrder, orderByExecution } from '../executionOrder';
import { Annotation } from '../model';

function step(id: string, order: number): Annotation {
  return {
    id,
    location: { uri: 'file:///a.js', line: order },
    anchorText: '',
    order,
    title: id,
    comment: '',
    highlights: [],
    watches: [],
  };
}

// Tour as written: entry (29), pricing (30), subtotal (14)… but subtotal runs before pricing.
const tour = [step('entry', 1), step('pricing', 2), step('subtotal', 3), step('discount', 4)];

suite('execution order', () => {
  test('detects steps visited out of tour order', () => {
    assert.strictEqual(isInExecutionOrder(tour, ['entry', 'subtotal', 'pricing', 'discount']), false);
    assert.strictEqual(isInExecutionOrder(tour, ['entry', 'pricing', 'subtotal', 'discount']), true);
  });

  test('skipped steps do not count as out of order', () => {
    assert.strictEqual(isInExecutionOrder(tour, ['entry', 'subtotal']), true);
  });

  test('reorders following the hits and renumbers', () => {
    const result = orderByExecution(tour, ['entry', 'subtotal', 'pricing', 'discount']);
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(
      result.annotations.map((a) => [a.order, a.id]),
      [
        [1, 'entry'],
        [2, 'subtotal'],
        [3, 'pricing'],
        [4, 'discount'],
      ],
    );
  });

  test('steps that were not hit go last, keeping their relative order', () => {
    const result = orderByExecution(tour, ['subtotal', 'entry']);
    assert.deepStrictEqual(
      result.annotations.map((a) => a.id),
      ['subtotal', 'entry', 'pricing', 'discount'],
    );
    assert.deepStrictEqual(
      result.notHit.map((a) => a.id),
      ['pricing', 'discount'],
    );
  });

  test('ignores repeated hits and deleted annotations', () => {
    const result = orderByExecution(tour, ['entry', 'gone', 'subtotal', 'entry', 'pricing', 'discount']);
    assert.deepStrictEqual(
      result.annotations.map((a) => a.id),
      ['entry', 'subtotal', 'pricing', 'discount'],
    );
  });

  test('no change when the tour already follows execution', () => {
    const result = orderByExecution(tour, ['entry', 'pricing', 'subtotal', 'discount']);
    assert.strictEqual(result.changed, false);
  });
});
