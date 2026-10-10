import { Annotation, Highlight, TourMeta, sortByOrder } from './model';
import { toOneBased, toZeroBased } from './lines';

/**
 * Import/export file format (the contract used by agents). All lines are 1-based.
 * See README.md, section "Tour file format".
 */
export interface TourFileHighlight {
  startLine: number;
  endLine: number;
  note?: string;
}

export interface TourFileStep {
  order: number;
  /** Path relative to the workspace folder (or absolute). */
  file: string;
  line: number;
  anchorText?: string;
  title: string;
  comment: string;
  highlights: TourFileHighlight[];
  watches: string[];
}

export interface TourFile {
  version: 1;
  title: string;
  context: string;
  steps: TourFileStep[];
}

export type ParseResult = { ok: true; tour: TourFile } | { ok: false; errors: string[] };

const MAX_ERRORS = 25;

/**
 * Removes // and /* *\/ comments outside of strings, replacing them with spaces so that
 * positions reported by JSON.parse still point to the right line and column.
 */
export function stripJsonComments(text: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < text.length) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      i++;
    } else if (ch === '"') {
      inString = true;
      out += ch;
      i++;
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < text.length) {
        out += '  ';
        i += 2;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function positionToLineColumn(text: string, position: number): { line: number; column: number } {
  const before = text.slice(0, position);
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function describe(value: unknown): string {
  if (value === undefined) {
    return 'nothing';
  }
  const json = JSON.stringify(value);
  return json.length > 40 ? json.slice(0, 37) + '...' : json;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Parses and validates the text of a tour file. Accepts comments (JSONC). */
export function parseTourJson(text: string): ParseResult {
  const clean = stripJsonComments(text.replace(/^﻿/, ''));
  let raw: unknown;
  try {
    raw = JSON.parse(clean);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const match = /position (\d+)/.exec(message);
    if (match) {
      const { line, column } = positionToLineColumn(clean, Number(match[1]));
      return { ok: false, errors: [`Invalid JSON at line ${line}, column ${column}: ${message}`] };
    }
    return { ok: false, errors: [`Invalid JSON: ${message}`] };
  }
  return validateTour(raw);
}

/** Validates an already parsed value against the tour format. */
export function validateTour(raw: unknown): ParseResult {
  const errors: string[] = [];
  const fail = (path: string, expected: string, value: unknown): void => {
    errors.push(`${path}: ${expected} (got ${describe(value)}).`);
  };

  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['The file must contain a JSON object with "version" and "steps".'] };
  }
  if (raw.version !== 1) {
    fail('version', 'must be 1', raw.version);
  }
  if (raw.title !== undefined && typeof raw.title !== 'string') {
    fail('title', 'must be a string', raw.title);
  }
  if (raw.context !== undefined && typeof raw.context !== 'string') {
    fail('context', 'must be a string (markdown)', raw.context);
  }
  if (!Array.isArray(raw.steps)) {
    fail('steps', 'must be a list of steps', raw.steps);
    return { ok: false, errors };
  }

  const steps: TourFileStep[] = [];
  const seenOrders = new Map<number, number>();
  const seenLocations = new Map<string, number>();

  raw.steps.forEach((rawStep: unknown, index: number) => {
    const p = `steps[${index}]`;
    if (!isPlainObject(rawStep)) {
      fail(p, 'must be an object', rawStep);
      return;
    }
    const before = errors.length;
    const s = rawStep;

    if (!isPositiveInt(s.order)) {
      fail(`${p}.order`, 'must be an integer >= 1', s.order);
    } else if (seenOrders.has(s.order)) {
      errors.push(`${p}.order: order ${s.order} is already used by steps[${seenOrders.get(s.order)}].`);
    } else {
      seenOrders.set(s.order, index);
    }
    if (typeof s.file !== 'string' || s.file.trim() === '') {
      fail(`${p}.file`, 'must be the file path, relative to the workspace folder', s.file);
    }
    if (!isPositiveInt(s.line)) {
      fail(`${p}.line`, 'must be an integer >= 1 (lines start at 1)', s.line);
    }
    if (typeof s.file === 'string' && isPositiveInt(s.line)) {
      const key = `${s.file}:${s.line}`;
      if (seenLocations.has(key)) {
        errors.push(`${p}: ${key} is already used by steps[${seenLocations.get(key)}]; only one step per line is allowed.`);
      } else {
        seenLocations.set(key, index);
      }
    }
    if (s.anchorText !== undefined && typeof s.anchorText !== 'string') {
      fail(`${p}.anchorText`, 'must be a string', s.anchorText);
    }
    if (typeof s.title !== 'string' || s.title.trim() === '') {
      fail(`${p}.title`, 'must be a non-empty string', s.title);
    }
    if (s.comment !== undefined && typeof s.comment !== 'string') {
      fail(`${p}.comment`, 'must be a string (markdown)', s.comment);
    }

    const highlights: TourFileHighlight[] = [];
    if (s.highlights !== undefined && !Array.isArray(s.highlights)) {
      fail(`${p}.highlights`, 'must be a list', s.highlights);
    } else if (Array.isArray(s.highlights)) {
      s.highlights.forEach((h: unknown, hi: number) => {
        const hp = `${p}.highlights[${hi}]`;
        if (!isPlainObject(h)) {
          fail(hp, 'must be an object with startLine and endLine', h);
          return;
        }
        let valid = true;
        if (!isPositiveInt(h.startLine)) {
          fail(`${hp}.startLine`, 'must be an integer >= 1', h.startLine);
          valid = false;
        }
        if (!isPositiveInt(h.endLine)) {
          fail(`${hp}.endLine`, 'must be an integer >= 1', h.endLine);
          valid = false;
        }
        if (valid && (h.endLine as number) < (h.startLine as number)) {
          errors.push(`${hp}: endLine (${h.endLine}) is less than startLine (${h.startLine}).`);
          valid = false;
        }
        if (h.note !== undefined && typeof h.note !== 'string') {
          fail(`${hp}.note`, 'must be a string', h.note);
          valid = false;
        }
        if (valid) {
          const highlight: TourFileHighlight = { startLine: h.startLine as number, endLine: h.endLine as number };
          if (typeof h.note === 'string' && h.note !== '') {
            highlight.note = h.note;
          }
          highlights.push(highlight);
        }
      });
    }

    const watches: string[] = [];
    if (s.watches !== undefined && !Array.isArray(s.watches)) {
      fail(`${p}.watches`, 'must be a list of expressions', s.watches);
    } else if (Array.isArray(s.watches)) {
      s.watches.forEach((w: unknown, wi: number) => {
        if (typeof w !== 'string' || w.trim() === '') {
          fail(`${p}.watches[${wi}]`, 'must be a non-empty expression', w);
        } else {
          watches.push(w.trim());
        }
      });
    }

    if (errors.length === before) {
      const step: TourFileStep = {
        order: s.order as number,
        file: (s.file as string).trim(),
        line: s.line as number,
        title: (s.title as string).trim(),
        comment: (s.comment as string | undefined) ?? '',
        highlights,
        watches,
      };
      if (typeof s.anchorText === 'string') {
        step.anchorText = s.anchorText.trim();
      }
      steps.push(step);
    }
  });

  if (errors.length > 0) {
    const shown = errors.slice(0, MAX_ERRORS);
    if (errors.length > MAX_ERRORS) {
      shown.push(`... and ${errors.length - MAX_ERRORS} more errors.`);
    }
    return { ok: false, errors: shown };
  }

  return {
    ok: true,
    tour: {
      version: 1,
      title: (raw.title as string | undefined) ?? '',
      context: (raw.context as string | undefined) ?? '',
      steps: [...steps].sort((a, b) => a.order - b.order),
    },
  };
}

/** Converts file highlights (1-based) to internal highlights (0-based). */
export function highlightsFromFile(highlights: readonly TourFileHighlight[]): Highlight[] {
  return highlights.map((h) => {
    const out: Highlight = { startLine: toZeroBased(h.startLine), endLine: toZeroBased(h.endLine) };
    if (h.note !== undefined) {
      out.note = h.note;
    }
    return out;
  });
}

/** Converts internal highlights (0-based) to file highlights (1-based). */
export function highlightsToFile(highlights: readonly Highlight[]): TourFileHighlight[] {
  return highlights.map((h) => {
    const out: TourFileHighlight = { startLine: toOneBased(h.startLine), endLine: toOneBased(h.endLine) };
    if (h.note !== undefined && h.note !== '') {
      out.note = h.note;
    }
    return out;
  });
}

/**
 * Builds an annotation from a file step. `currentLineText` is the text of the target line in the
 * workspace, used as anchor when the step does not provide one.
 */
export function stepToAnnotation(
  step: TourFileStep,
  uri: string,
  id: string,
  currentLineText: string | undefined,
): Annotation {
  return {
    id,
    location: { uri, line: toZeroBased(step.line) },
    anchorText: (step.anchorText ?? currentLineText ?? '').trim(),
    order: step.order,
    title: step.title,
    comment: step.comment,
    highlights: highlightsFromFile(step.highlights),
    watches: [...step.watches],
  };
}

export function annotationToStep(annotation: Annotation, file: string): TourFileStep {
  return {
    order: annotation.order,
    file,
    line: toOneBased(annotation.location.line),
    anchorText: annotation.anchorText,
    title: annotation.title,
    comment: annotation.comment,
    highlights: highlightsToFile(annotation.highlights),
    watches: [...annotation.watches],
  };
}

/** Builds the exported file. `relativize` maps an annotation uri to the path written in the file. */
export function buildTourFile(
  annotations: readonly Annotation[],
  meta: TourMeta,
  relativize: (uri: string) => string,
): TourFile {
  return {
    version: 1,
    title: meta.title,
    context: meta.context,
    steps: sortByOrder(annotations).map((a, i) => ({
      ...annotationToStep(a, relativize(a.location.uri)),
      order: i + 1,
    })),
  };
}

export function serializeTour(tour: TourFile): string {
  return JSON.stringify(tour, null, 2) + '\n';
}
