import * as vscode from 'vscode';
import { Step, EMPTY_META, TourMeta, renumber, sortByOrder } from '../core/model';

/**
 * The steps and the context of the open tour, in memory. The tour file is the source of truth: the
 * Tours module loads it here and writes it back on every change.
 */
export class StepStore implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  private steps: Step[] = [];
  private meta: TourMeta = EMPTY_META;

  /** All steps sorted by order. */
  all(): Step[] {
    return sortByOrder(this.steps);
  }

  get(id: string): Step | undefined {
    return this.steps.find((a) => a.id === id);
  }

  getMeta(): TourMeta {
    return this.meta;
  }

  count(): number {
    return this.steps.length;
  }

  findAt(uri: string, line: number): Step | undefined {
    return this.steps.find((a) => a.location.uri === uri && a.location.line === line);
  }

  inFile(uri: string): Step[] {
    return this.all().filter((a) => a.location.uri === uri);
  }

  nextOrder(): number {
    return this.steps.reduce((max, a) => Math.max(max, a.order), 0) + 1;
  }

  async add(step: Step): Promise<void> {
    await this.replaceAll([...this.steps, step]);
  }

  async update(id: string, patch: Partial<Omit<Step, 'id'>>): Promise<void> {
    await this.replaceAll(this.steps.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  async remove(id: string): Promise<void> {
    await this.replaceAll(this.steps.filter((a) => a.id !== id));
  }

  /** Swaps the order of a step with its neighbour. */
  async move(id: string, direction: -1 | 1): Promise<void> {
    const sorted = sortByOrder(this.steps);
    const index = sorted.findIndex((a) => a.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sorted.length) {
      return;
    }
    [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
    await this.replaceAll(sorted.map((a, i) => ({ ...a, order: i + 1 })));
  }

  async replaceAll(steps: Step[]): Promise<void> {
    this.steps = renumber(steps);
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
