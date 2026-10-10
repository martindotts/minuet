import * as path from 'path';
import * as vscode from 'vscode';
import { toOneBased } from '../core/lines';
import { Step } from '../core/model';
import { StopController } from '../debug/stopController';
import { StaleTracker } from '../tours/staleTracker';
import { StepStore } from '../tours/stepStore';
import { isFolderTour, TourEntry, Tours } from '../tours/tours';
import { StepSelection } from './selection';

export const TOURS_VIEW_ID = 'minuet.tours';

/** A tour of the tours folder, or a step of the open tour. */
export type TourNode = { kind: 'tour'; tour: TourEntry } | { kind: 'step'; step: Step };

/**
 * The "Tours" tree: the tours of the tours folder, with the open one expanded into its steps. The steps
 * follow the selected step (cursor, CodeLens, a stop) and show where execution is stopped.
 */
export class ToursView implements vscode.TreeDataProvider<TourNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<TourNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  readonly treeView: vscode.TreeView<TourNode>;
  private openFile: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly tours: Tours,
    private readonly store: StepStore,
    private readonly staleTracker: StaleTracker,
    private readonly stops: StopController,
    private readonly selection: StepSelection,
  ) {
    this.treeView = vscode.window.createTreeView(TOURS_VIEW_ID, { treeDataProvider: this });
    this.disposables.push(
      this.treeView,
      tours.onDidChange(() => this.onToursChange()),
      store.onDidChange(() => this.refresh()),
      staleTracker.onDidChange(() => this.refresh()),
      stops.onDidChange(() => this.refresh()),
      // Revealing shows the tree's container. Selections made from elsewhere (CodeLens, a stop) usually
      // come with a switch to Run and Debug, and the visibility we see here may still be stale, so those
      // are revealed when the tree becomes visible again instead.
      selection.onDidChange(({ id, source }) => {
        if (source === 'cursor') {
          this.revealStep(id);
        }
      }),
      this.treeView.onDidChangeVisibility(({ visible }) => {
        if (visible) {
          this.revealStep(this.selection.selectedId);
        }
      }),
      this.treeView.onDidChangeSelection((e) => {
        const node = e.selection[0];
        if (node?.kind === 'step') {
          this.selection.select(node.step.id, 'tree');
        }
      }),
    );
    this.refresh();
  }

  private onToursChange(): void {
    this.refresh();
    const active = this.tours.activeFile?.toString();
    if (active === this.openFile) {
      return;
    }
    this.openFile = active;
    // A tour was just opened: show it expanded into its steps.
    const node = this.openTourNode();
    if (node) {
      void this.treeView.reveal(node, { expand: true, select: false, focus: false }).then(undefined, () => undefined);
    }
  }

  private refresh(): void {
    const folder = this.tours.folder;
    this.treeView.description = folder ? vscode.workspace.asRelativePath(folder) : undefined;
    void vscode.commands.executeCommand('setContext', 'minuet.hasTour', this.tours.activeFile !== undefined);
    const stop = this.stops.current;
    const step = stop ? this.store.get(stop.stepId) : undefined;
    this.treeView.message = step ? `Stopped at step ${step.order}: ${step.title}` : undefined;
    this.changeEmitter.fire(undefined);
  }

  private openTourNode(): TourNode | undefined {
    const tour = this.tours.list.find((t) => this.tours.isOpen(t.uri));
    return tour ? { kind: 'tour', tour } : undefined;
  }

  /** Selects the step in the tree. Only while visible: revealing would otherwise open the sidebar. */
  private revealStep(id: string | undefined): void {
    if (!id || !this.treeView.visible) {
      return;
    }
    const current = this.treeView.selection[0];
    if (current?.kind === 'step' && current.step.id === id) {
      return;
    }
    const step = this.store.get(id);
    if (step) {
      void this.treeView.reveal({ kind: 'step', step }, { select: true, focus: false }).then(undefined, () => undefined);
    }
  }

  getParent(node: TourNode): TourNode | undefined {
    return node.kind === 'step' ? this.openTourNode() : undefined;
  }

  getChildren(node?: TourNode): TourNode[] {
    if (!node) {
      return this.tours.list.map((tour) => ({ kind: 'tour', tour }));
    }
    if (node.kind === 'tour' && this.tours.isOpen(node.tour.uri)) {
      return this.store.all().map((step) => ({ kind: 'step', step }));
    }
    return [];
  }

  getTreeItem(node: TourNode): vscode.TreeItem {
    return node.kind === 'tour' ? this.tourItem(node.tour) : this.stepItem(node.step);
  }

  private tourItem(tour: TourEntry): vscode.TreeItem {
    const open = this.tours.isOpen(tour.uri);
    const file = isFolderTour(tour.uri.fsPath)
      ? `${path.basename(path.dirname(tour.uri.fsPath))}/${path.basename(tour.uri.fsPath)}`
      : path.basename(tour.uri.fsPath);
    // Only the open tour has its steps loaded (and their breakpoints set): the others do not expand.
    const item = new vscode.TreeItem(
      tour.title,
      open ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );
    // The id changes when the tour opens, so the tree applies its expanded state.
    item.id = `tour/${tour.uri.toString()}${open ? '/open' : ''}`;
    item.resourceUri = tour.uri;
    if (tour.errors) {
      item.description = file;
      item.contextValue = 'tour.invalid';
      item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
      item.tooltip = `${file} is not a valid tour:\n${tour.errors.join('\n')}`;
      item.command = { command: 'vscode.open', title: 'Open File', arguments: [tour.uri] };
      return item;
    }
    item.description = open ? undefined : `${tour.steps} steps`;
    item.contextValue = open ? 'tour.open' : 'tour';
    item.iconPath = new vscode.ThemeIcon(open ? 'book' : 'debug-breakpoint-log-unverified');
    item.tooltip = `${tour.title}\n${file}${open ? '\nOpen: click to read its context.' : `\n${tour.steps} steps. Click to open it.`}`;
    item.command = { command: 'minuet.openTour', title: 'Open Tour', arguments: [tour.uri] };
    return item;
  }

  private stepItem(step: Step): vscode.TreeItem {
    const isCurrent = this.stops.current?.stepId === step.id;
    const stale = this.staleTracker.isStale(step.id);
    const uri = vscode.Uri.parse(step.location.uri);
    const line = toOneBased(step.location.line);

    const item = new vscode.TreeItem(`${step.order}. ${step.title}`, vscode.TreeItemCollapsibleState.None);
    item.id = `step/${step.id}`;
    item.description = `${path.basename(uri.fsPath)}:${line}`;
    item.contextValue = 'step';
    if (isCurrent) {
      item.iconPath = new vscode.ThemeIcon('debug-stackframe', new vscode.ThemeColor('debugIcon.continueForeground'));
    } else if (stale) {
      item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
    } else {
      item.iconPath = new vscode.ThemeIcon('debug-breakpoint-log-unverified');
    }

    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown(`**${step.order}. ${step.title}**  \n`);
    tooltip.appendMarkdown(`\`${vscode.workspace.asRelativePath(uri)}:${line}\``);
    if (isCurrent) {
      tooltip.appendMarkdown('\n\n$(debug-stackframe) Execution is stopped at this step.');
    }
    if (stale) {
      tooltip.appendMarkdown('\n\n$(warning) **Outdated:** the line no longer matches its anchor text.');
    }
    item.tooltip = tooltip;
    item.command = { command: 'minuet.openStep', title: 'Open', arguments: [step.id] };
    return item;
  }

  dispose(): void {
    this.changeEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
