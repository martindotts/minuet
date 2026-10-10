import * as vscode from 'vscode';
import { Annotation, EMPTY_META, TourMeta, renumber, sortByOrder } from './model';

/**
 * The steps and the context of the open tour, in memory. The tour file is the source of truth: the
 * Tours module loads it here and writes it back on every change.
 */
export class AnnotationStore implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  private annotations: Annotation[] = [];
  private meta: TourMeta = EMPTY_META;

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
    this.changeEmitter.fire();
  }

  async setMeta(meta: TourMeta): Promise<void> {
    this.meta = meta;
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
