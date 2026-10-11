import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { toOneBased, toZeroBased } from '../../core/lines';
import { Step } from '../../core/model';
import {
  buildTourFile,
  highlightsFromFile,
  highlightsToFile,
  parseTourJson,
  serializeTour,
  stepFromFile,
  stripJsonComments,
  TourFile,
} from '../../core/tourFormat';

const SAMPLE_TOUR = path.resolve(__dirname, '../../../src/test/fixtures/orders/.minuet/orders/tour.json');

function validTour(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    title: 'Tour',
    context: 'Context',
    steps: [
      {
        order: 1,
        file: 'src/a.ts',
        line: 10,
        anchorText: 'const a = 1;',
        title: 'Step one',
        content: '**md**',
        highlights: [{ startLine: 10, endLine: 12, note: 'a note' }],
        watches: ['a'],
      },
    ],
    ...overrides,
  };
}

function parseObject(value: unknown) {
  return parseTourJson(JSON.stringify(value));
}

function errorsOf(value: unknown): string[] {
  const result = parseObject(value);
  assert.strictEqual(result.ok, false, 'expected the tour to be invalid');
  return result.ok ? [] : result.errors;
}

suite('lines', () => {
  test('converts between 1-based and 0-based', () => {
    assert.strictEqual(toZeroBased(1), 0);
    assert.strictEqual(toZeroBased(106), 105);
    assert.strictEqual(toOneBased(0), 1);
    assert.strictEqual(toOneBased(toZeroBased(42)), 42);
  });

  test('highlights are converted in both directions', () => {
    const internal = highlightsFromFile([{ startLine: 154, endLine: 170, note: 'body data' }, { startLine: 1, endLine: 1 }]);
    assert.deepStrictEqual(internal, [{ startLine: 153, endLine: 169, note: 'body data' }, { startLine: 0, endLine: 0 }]);
    assert.deepStrictEqual(highlightsToFile(internal), [
      { startLine: 154, endLine: 170, note: 'body data' },
      { startLine: 1, endLine: 1 },
    ]);
  });
});

suite('tourFormat: parsing', () => {
  test('accepts a valid tour and applies defaults', () => {
    const result = parseObject({
      version: 1,
      steps: [{ order: 1, file: 'a.ts', line: 3, title: 'T' }],
    });
    assert.ok(result.ok);
    assert.deepStrictEqual(result.tour, {
      version: 1,
      title: '',
      context: '',
      steps: [{ order: 1, file: 'a.ts', line: 3, title: 'T', content: '', highlights: [], watches: [] }],
    });
  });

  test('parses the sample tour shipped in examples/', () => {
    const result = parseTourJson(fs.readFileSync(SAMPLE_TOUR, 'utf8'));
    assert.ok(result.ok, result.ok ? '' : result.errors.join('\n'));
    assert.strictEqual(result.tour.steps.length, 5);
    assert.deepStrictEqual(
      result.tour.steps.map((s) => s.order),
      [1, 2, 3, 4, 5],
    );
  });

  test('sorts steps by order', () => {
    const tour = validTour({
      steps: [
        { order: 2, file: 'a.ts', line: 5, title: 'B' },
        { order: 1, file: 'a.ts', line: 1, title: 'A' },
      ],
    });
    const result = parseObject(tour);
    assert.ok(result.ok);
    assert.deepStrictEqual(
      result.tour.steps.map((s) => s.title),
      ['A', 'B'],
    );
  });

  test('accepts comments (JSONC), as in the README example', () => {
    const text = `{
      // tour
      "version": 1, /* inline */
      "steps": [{ "order": 1, "file": "a.ts", "line": 106, // 1-based
        "title": "url // not a comment", "content": "/* kept */" }]
    }`;
    const result = parseTourJson(text);
    assert.ok(result.ok, result.ok ? '' : result.errors.join('\n'));
    assert.strictEqual(result.tour.steps[0].title, 'url // not a comment');
    assert.strictEqual(result.tour.steps[0].content, '/* kept */');
  });

  test('stripJsonComments keeps line numbers', () => {
    const text = '{\n/* a\nb */\n"x": 1 // c\n}';
    assert.strictEqual(stripJsonComments(text).split('\n').length, text.split('\n').length);
  });

  test('reports the line and column of a JSON syntax error', () => {
    const result = parseTourJson('{\n  "version": 1,\n  "steps": [}\n}');
    assert.strictEqual(result.ok, false);
    assert.match(result.ok ? '' : result.errors[0], /Invalid JSON/);
  });

  test('rejects a non-object root', () => {
    assert.match(errorsOf([1, 2])[0], /JSON object/);
  });

  test('rejects an unsupported version', () => {
    assert.ok(errorsOf(validTour({ version: 2 })).some((e) => e.startsWith('version:')));
  });

  test('rejects missing steps; a new tour can have none yet', () => {
    assert.ok(errorsOf(validTour({ steps: undefined })).some((e) => e.startsWith('steps:')));
    assert.ok(parseObject(validTour({ steps: [] })).ok);
  });

  test('names the failing field of each step', () => {
    const errors = errorsOf(
      validTour({
        steps: [
          { order: 0, file: '', line: 1.5, title: '', watches: ['', 3], highlights: [{ startLine: 5, endLine: 2 }] },
        ],
      }),
    );
    for (const field of [
      'steps[0].order',
      'steps[0].file',
      'steps[0].line',
      'steps[0].title',
      'steps[0].watches[0]',
      'steps[0].watches[1]',
      'steps[0].highlights[0]',
    ]) {
      assert.ok(
        errors.some((e) => e.startsWith(field)),
        `missing error for ${field} in:\n${errors.join('\n')}`,
      );
    }
  });

  test('rejects line 0 (lines are 1-based in the file)', () => {
    const errors = errorsOf(validTour({ steps: [{ order: 1, file: 'a.ts', line: 0, title: 'T' }] }));
    assert.match(errors.join('\n'), /steps\[0\]\.line: .*lines start at 1/);
  });

  test('rejects duplicated orders and duplicated locations', () => {
    const errors = errorsOf(
      validTour({
        steps: [
          { order: 1, file: 'a.ts', line: 1, title: 'A' },
          { order: 1, file: 'a.ts', line: 2, title: 'B' },
          { order: 3, file: 'a.ts', line: 1, title: 'C' },
        ],
      }),
    );
    assert.ok(errors.some((e) => e.startsWith('steps[1].order')));
    assert.ok(errors.some((e) => e.startsWith('steps[2]: a.ts:1')));
  });

  test('rejects wrong types in optional fields', () => {
    const errors = errorsOf(
      validTour({
        title: 3,
        context: {},
        steps: [{ order: 1, file: 'a.ts', line: 1, title: 'T', content: 1, anchorText: 2, highlights: {}, watches: 'x' }],
      }),
    );
    for (const field of ['title', 'context', 'steps[0].content', 'steps[0].anchorText', 'steps[0].highlights', 'steps[0].watches']) {
      assert.ok(
        errors.some((e) => e.startsWith(field + ':')),
        `missing error for ${field}`,
      );
    }
  });
});

suite('tourFormat: conversion', () => {
  test('stepFromFile converts lines to 0-based', () => {
    const result = parseObject(validTour());
    assert.ok(result.ok);
    const a = stepFromFile(result.tour.steps[0], 'file:///w/src/a.ts', 'id-1', 'ignored');
    assert.deepStrictEqual(a.location, { uri: 'file:///w/src/a.ts', line: 9 });
    assert.deepStrictEqual(a.highlights, [{ startLine: 9, endLine: 11, note: 'a note' }]);
    assert.strictEqual(a.anchorText, 'const a = 1;');
  });

  test('stepFromFile anchors to the current line when anchorText is missing', () => {
    const a = stepFromFile(
      { order: 1, file: 'a.ts', line: 1, title: 'T', content: '', highlights: [], watches: [] },
      'file:///a.ts',
      'id',
      '   return x;  ',
    );
    assert.strictEqual(a.anchorText, 'return x;');
  });

  test('export then import produces the same tour', () => {
    const steps: Step[] = [
      {
        id: 'b',
        breakpointId: 'bp-2',
        location: { uri: 'file:///w/src/b.ts', line: 4 },
        anchorText: 'b()',
        order: 2,
        title: 'Second',
        content: 'two',
        highlights: [],
        watches: ['b.value'],
      },
      {
        id: 'a',
        location: { uri: 'file:///w/src/a.ts', line: 105 },
        anchorText: 'const x = 1;',
        order: 1,
        title: 'First',
        content: { file: 'one.md' },
        highlights: [{ startLine: 153, endLine: 169, note: 'body data' }, { startLine: 3, endLine: 3 }],
        watches: ['event.body.operation'],
      },
    ];
    const meta = { title: 'Title', context: 'ctx' };
    const relativize = (uri: string) => uri.replace('file:///w/', '');
    const tour: TourFile = buildTourFile(steps, meta, relativize);

    assert.strictEqual(tour.steps[0].file, 'src/a.ts');
    assert.strictEqual(tour.steps[0].line, 106);
    assert.deepStrictEqual(tour.steps[0].highlights[0], { startLine: 154, endLine: 170, note: 'body data' });

    const reparsed = parseTourJson(serializeTour(tour));
    assert.ok(reparsed.ok, reparsed.ok ? '' : reparsed.errors.join('\n'));
    assert.deepStrictEqual(reparsed.tour, tour);

    const reimported = reparsed.tour.steps.map((s) => stepFromFile(s, `file:///w/${s.file}`, 'new', undefined));
    const strip = (a: Step) => ({ ...a, id: '', breakpointId: undefined });
    const expected = [steps[1], steps[0]].map(strip);
    assert.deepStrictEqual(reimported.map(strip), expected);
  });

  test('content is markdown text or a .md / .html file', () => {
    const step = (content: unknown) => validTour({ steps: [{ order: 1, file: 'a.ts', line: 1, title: 'T', content }] });
    const ok = (content: unknown) => {
      const result = parseObject(step(content));
      assert.ok(result.ok, JSON.stringify(content));
      return result.tour.steps[0].content;
    };
    assert.strictEqual(ok('**md**'), '**md**');
    assert.deepStrictEqual(ok({ file: ' page.html ' }), { file: 'page.html' });
    assert.deepStrictEqual(ok({ file: 'notes/step.md' }), { file: 'notes/step.md' });
    for (const bad of [{ file: 'data.json' }, { file: '' }, { path: 'x.md' }, 3]) {
      assert.ok(errorsOf(step(bad)).some((e) => e.startsWith('steps[0].content:')), JSON.stringify(bad));
    }
    assert.deepStrictEqual(parseObject(validTour({ context: { file: 'context.md' } })).ok && 'ok', 'ok');
  });

  test('run is the name of a launch configuration or a debug configuration', () => {
    const run = (value: unknown) => parseObject(validTour({ run: value }));
    const ok = run({ type: 'node', request: 'launch', program: 'x.js' });
    assert.ok(ok.ok && typeof ok.tour.run === 'object' && ok.tour.run.program === 'x.js');
    const named = run(' Debug: orders test ');
    assert.ok(named.ok && named.tour.run === 'Debug: orders test');
    const none = parseObject(validTour({}));
    assert.ok(none.ok && none.tour.run === undefined, 'run is optional');
    for (const bad of ['', { type: 'node' }, 3]) {
      assert.ok(errorsOf(validTour({ run: bad })).some((e) => e.startsWith('run:')), JSON.stringify(bad));
    }
  });
});
