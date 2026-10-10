import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Annotation } from '../model';
import { toOneBased, toZeroBased } from '../lines';
import {
  buildTourFile,
  highlightsFromFile,
  highlightsToFile,
  parseTourJson,
  serializeTour,
  stepToAnnotation,
  stripJsonComments,
  TourFile,
} from '../tourFormat';

const SAMPLE_TOUR = path.resolve(__dirname, '../../examples/sample-node/tour.json');

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
        comment: '**md**',
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
      steps: [{ order: 1, file: 'a.ts', line: 3, title: 'T', comment: '', highlights: [], watches: [] }],
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
        "title": "url // not a comment", "comment": "/* kept */" }]
    }`;
    const result = parseTourJson(text);
    assert.ok(result.ok, result.ok ? '' : result.errors.join('\n'));
    assert.strictEqual(result.tour.steps[0].title, 'url // not a comment');
    assert.strictEqual(result.tour.steps[0].comment, '/* kept */');
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

  test('rejects missing or empty steps', () => {
    assert.ok(errorsOf(validTour({ steps: undefined })).some((e) => e.startsWith('steps:')));
    assert.ok(errorsOf(validTour({ steps: [] })).some((e) => e.startsWith('steps:')));
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
        steps: [{ order: 1, file: 'a.ts', line: 1, title: 'T', comment: 1, anchorText: 2, highlights: {}, watches: 'x' }],
      }),
    );
    for (const field of ['title', 'context', 'steps[0].comment', 'steps[0].anchorText', 'steps[0].highlights', 'steps[0].watches']) {
      assert.ok(
        errors.some((e) => e.startsWith(field + ':')),
        `missing error for ${field}`,
      );
    }
  });
});

suite('tourFormat: conversion', () => {
  test('stepToAnnotation converts lines to 0-based', () => {
    const result = parseObject(validTour());
    assert.ok(result.ok);
    const a = stepToAnnotation(result.tour.steps[0], 'file:///w/src/a.ts', 'id-1', 'ignored');
    assert.deepStrictEqual(a.location, { uri: 'file:///w/src/a.ts', line: 9 });
    assert.deepStrictEqual(a.highlights, [{ startLine: 9, endLine: 11, note: 'a note' }]);
    assert.strictEqual(a.anchorText, 'const a = 1;');
  });

  test('stepToAnnotation anchors to the current line when anchorText is missing', () => {
    const a = stepToAnnotation(
      { order: 1, file: 'a.ts', line: 1, title: 'T', comment: '', highlights: [], watches: [] },
      'file:///a.ts',
      'id',
      '   return x;  ',
    );
    assert.strictEqual(a.anchorText, 'return x;');
  });

  test('export then import produces the same tour', () => {
    const annotations: Annotation[] = [
      {
        id: 'b',
        breakpointId: 'bp-2',
        location: { uri: 'file:///w/src/b.ts', line: 4 },
        anchorText: 'b()',
        order: 2,
        title: 'Second',
        comment: 'two',
        highlights: [],
        watches: ['b.value'],
      },
      {
        id: 'a',
        location: { uri: 'file:///w/src/a.ts', line: 105 },
        anchorText: 'const x = 1;',
        order: 1,
        title: 'First',
        comment: '# one\n\ntext',
        highlights: [{ startLine: 153, endLine: 169, note: 'body data' }, { startLine: 3, endLine: 3 }],
        watches: ['event.body.operation'],
      },
    ];
    const meta = { title: 'Title', context: 'ctx' };
    const relativize = (uri: string) => uri.replace('file:///w/', '');
    const tour: TourFile = buildTourFile(annotations, meta, relativize);

    assert.strictEqual(tour.steps[0].file, 'src/a.ts');
    assert.strictEqual(tour.steps[0].line, 106);
    assert.deepStrictEqual(tour.steps[0].highlights[0], { startLine: 154, endLine: 170, note: 'body data' });

    const reparsed = parseTourJson(serializeTour(tour));
    assert.ok(reparsed.ok, reparsed.ok ? '' : reparsed.errors.join('\n'));
    assert.deepStrictEqual(reparsed.tour, tour);

    const reimported = reparsed.tour.steps.map((s) => stepToAnnotation(s, `file:///w/${s.file}`, 'new', undefined));
    const strip = (a: Annotation) => ({ ...a, id: '', breakpointId: undefined });
    const expected = [annotations[1], annotations[0]].map(strip);
    assert.deepStrictEqual(reimported.map(strip), expected);
  });
});
