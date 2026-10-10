import * as vscode from 'vscode';
import { Annotation, EMPTY_META, TourMeta, renumber, sortByOrder } from './model';

const ANNOTATIONS_KEY = 'minuet.annotations';
const META_KEY = 'minuet.tourMeta';
const SOURCE_KEY = 'minuet.tourSource';

/** The saved tour file the current tour was opened from or last saved to. */
export interface TourSource {
  /** fsPath of the file. */
  file: string;
  /** The tour as it was written to the file, to tell whether there are unsaved changes. */
  snapshot: string;
}

/** Annotations persisted in the extension's workspaceState (never in the user's repository). */
export class AnnotationStore implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  private annotations: Annotation[];
  private meta: TourMeta;
  private source: TourSource | undefined;

  constructor(private readonly state: vscode.Memento) {
    this.annotations = renumber(state.get<Annotation[]>(ANNOTATIONS_KEY, []));
    this.meta = { ...EMPTY_META, ...state.get<TourMeta>(META_KEY, EMPTY_META) };
    this.source = state.get<TourSource>(SOURCE_KEY);
  }

  /** All annotations sorted by order. */
  all(): Annotation[] {
    return sortByOrder(this.annotations);
  }

  get(id: string): Annotation | undefined {
    return this.annotations.find((a) => a.id === id);
  }

  getMeta(): TourMeta {
    return this.meta;
  }

  getSource(): TourSource | undefined {
    return this.source;
  }

  count(): number {
    return this.annotations.length;
  }

  findAt(uri: string, line: number): Annotation | undefined {
    return this.annotations.find((a) => a.location.uri === uri && a.location.line === line);
  }

  inFile(uri: string): Annotation[] {
    return this.all().filter((a) => a.location.uri === uri);
  }

  nextOrder(): number {
    return this.annotations.reduce((max, a) => Math.max(max, a.order), 0) + 1;
  }

  async add(annotation: Annotation): Promise<void> {
    await this.replaceAll([...this.annotations, annotation]);
  }

  async update(id: string, patch: Partial<Omit<Annotation, 'id'>>): Promise<void> {
    await this.replaceAll(this.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  async remove(id: string): Promise<void> {
    await this.replaceAll(this.annotations.filter((a) => a.id !== id));
  }

  /** Swaps the order of an annotation with its neighbour. */
  async move(id: string, direction: -1 | 1): Promise<void> {
    const sorted = sortByOrder(this.annotations);
    const index = sorted.findIndex((a) => a.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sorted.length) {
      return;
    }
    [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
    await this.replaceAll(sorted.map((a, i) => ({ ...a, order: i + 1 })));
  }

  async replaceAll(annotations: Annotation[]): Promise<void> {
    this.annotations = renumber(annotations);
    await this.state.update(ANNOTATIONS_KEY, this.annotations);
    this.changeEmitter.fire();
  }

  async setMeta(meta: TourMeta): Promise<void> {
    this.meta = meta;
    await this.state.update(META_KEY, meta);
    this.changeEmitter.fire();
  }

  async setSource(source: TourSource | undefined): Promise<void> {
    this.source = source;
    await this.state.update(SOURCE_KEY, source);
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
