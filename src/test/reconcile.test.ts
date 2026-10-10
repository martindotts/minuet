import * as assert from 'assert';
import { Annotation } from '../model';
import { BreakpointRef, moveAnnotation, reconcile } from '../reconcile';
import { isStale, normalizeAnchor } from '../staleness';

const URI = 'file:///w/src/a.ts';
const OTHER = 'file:///w/src/b.ts';

function annotation(id: string, line: number, extra: Partial<Annotation> = {}): Annotation {
  return {
    id,
    location: { uri: URI, line },
    anchorText: `line ${line}`,
    order: 1,
    title: id,
    comment: '',
    highlights: [],
    watches: [],
    ...extra,
  };
}

function bp(id: string, line: number, uri = URI): BreakpointRef {
  return { id, uri, line };
}

const noChange = { added: [], removed: [], changed: [] };

suite('reconcile: annotation ↔ breakpoint', () => {
  test('associates by uri and line when the id is unknown (new session)', () => {
    const result = reconcile([annotation('a', 10, { breakpointId: 'old' })], [bp('new', 10)]);
    assert.strictEqual(result.annotations[0].breakpointId, 'new');
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.orphans, []);
  });

  test('does not associate a breakpoint of another file or line', () => {
    const result = reconcile([annotation('a', 10)], [bp('x', 10, OTHER), bp('y', 11)]);
    assert.strictEqual(result.annotations[0].breakpointId, undefined);
    assert.deepStrictEqual(
      result.orphans.map((a) => a.id),
      ['a'],
    );
  });

  test('without a change event nothing is deleted (activation)', () => {
    const result = reconcile([annotation('a', 10, { breakpointId: 'gone' })], []);
    assert.deepStrictEqual(result.removedIds, []);
    assert.strictEqual(result.annotations.length, 1);
    assert.strictEqual(result.orphans.length, 1);
  });

  test('deletes the annotation when its breakpoint is removed', () => {
    const annotations = [annotation('a', 10, { breakpointId: 'bp1' }), annotation('b', 20, { breakpointId: 'bp2' })];
    const result = reconcile(annotations, [bp('bp2', 20)], { ...noChange, removed: [bp('bp1', 10)] });
    assert.deepStrictEqual(result.removedIds, ['a']);
    assert.deepStrictEqual(
      result.annotations.map((a) => a.id),
      ['b'],
    );
  });

  test('deletes by location when the annotation was not associated yet', () => {
    const result = reconcile([annotation('a', 10)], [], { ...noChange, removed: [bp('bp1', 10)] });
    assert.deepStrictEqual(result.removedIds, ['a']);
  });

  test('keeps the annotation if another breakpoint remains on the same line', () => {
    const result = reconcile([annotation('a', 10, { breakpointId: 'bp1' })], [bp('bp2', 10)], {
      ...noChange,
      removed: [bp('bp1', 10)],
    });
    assert.deepStrictEqual(result.removedIds, []);
    assert.strictEqual(result.annotations[0].breakpointId, 'bp2');
  });

  test('does not delete when an unrelated breakpoint is removed', () => {
    const result = reconcile([annotation('a', 10, { breakpointId: 'bp1' })], [bp('bp1', 10)], {
      ...noChange,
      removed: [bp('bp9', 30)],
    });
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.annotations.length, 1);
  });

  test('follows a moved breakpoint and shifts its highlights', () => {
    const a = annotation('a', 10, {
      breakpointId: 'bp1',
      highlights: [{ startLine: 8, endLine: 12, note: 'n' }],
    });
    const result = reconcile([a], [bp('bp1', 13)], { ...noChange, changed: [bp('bp1', 13)] });
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.annotations[0].location, { uri: URI, line: 13 });
    assert.deepStrictEqual(result.annotations[0].highlights, [{ startLine: 11, endLine: 15, note: 'n' }]);
  });

  test('a change that keeps the line (e.g. condition) is a no-op', () => {
    const a = annotation('a', 10, { breakpointId: 'bp1' });
    const result = reconcile([a], [bp('bp1', 10)], { ...noChange, changed: [bp('bp1', 10)] });
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.annotations[0], a);
  });

  test('an added breakpoint at the location gets associated', () => {
    const result = reconcile([annotation('a', 10)], [bp('bp1', 10)], { ...noChange, added: [bp('bp1', 10)] });
    assert.strictEqual(result.annotations[0].breakpointId, 'bp1');
  });

  test('moveAnnotation never produces negative highlight lines', () => {
    const moved = moveAnnotation(annotation('a', 5, { highlights: [{ startLine: 0, endLine: 2 }] }), 2);
    assert.deepStrictEqual(moved.highlights, [{ startLine: 0, endLine: 0 }]);
  });
});

suite('staleness', () => {
  test('matching text is not stale, ignoring surrounding and inner whitespace', () => {
    assert.strictEqual(isStale('const a = 1;', '    const a = 1;'), false);
    assert.strictEqual(isStale('const  a =\t1;', 'const a = 1;'), false);
  });

  test('changed text is stale', () => {
    assert.strictEqual(isStale('const a = 1;', 'const a = 2;'), true);
  });

  test('a missing line or file is stale', () => {
    assert.strictEqual(isStale('const a = 1;', undefined), true);
  });

  test('normalizeAnchor trims and collapses whitespace', () => {
    assert.strictEqual(normalizeAnchor('  a   b\t c  '), 'a b c');
  });
});
