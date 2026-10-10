import * as path from 'path';
import * as vscode from 'vscode';
import { toOneBased } from '../core/lines';
import { Step, contentText, isFileContent } from '../core/model';
import { StopController } from '../debug/stopController';
import { StaleTracker } from '../tours/staleTracker';
import { StepStore } from '../tours/stepStore';
import { StepSelection } from './selection';

export const STEPS_VIEW_ID = 'minuet.steps';

export type StepsNode =
  | { kind: 'context' }
  | { kind: 'contextLine'; text: string; index: number }
  | { kind: 'step'; step: Step };

function nodeId(node: StepsNode): string {
  switch (node.kind) {
    case 'context':
      return 'context';
    case 'contextLine':
      return `context/${node.index}`;
    case 'step':
      return `step/${node.step.id}`;
  }
}

/** The "Tour" tree: tour context and steps in order, kept in sync with the selected step. */
export class StepsView implements vscode.TreeDataProvider<StepsNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<StepsNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  readonly treeView: vscode.TreeView<StepsNode>;
  private stepNodes = new Map<string, StepsNode>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly store: StepStore,
    private readonly staleTracker: StaleTracker,
    private readonly stops: StopController,
    private readonly selection: StepSelection,
    /** Whether a tour is open (it can have no steps yet). */
    private readonly tourOpen: { isOpen(): boolean; onDidChange: vscode.Event<void> },
  ) {
    this.treeView = vscode.window.createTreeView(STEPS_VIEW_ID, { treeDataProvider: this });
    this.disposables.push(
      this.treeView,
      store.onDidChange(() => this.refresh()),
      tourOpen.onDidChange(() => this.refresh()),
      staleTracker.onDidChange(() => this.refresh()),
      stops.onDidChange(() => this.refresh()),
      // Revealing shows the tree's container. Selections made from elsewhere (CodeLens, a stop) usually
      // come with a switch to Run and Debug, and the visibility we see here may still be stale, so those
      // are revealed when the tree becomes visible again instead.
      selection.onDidChange(({ id, source }) => {
        if (source === 'cursor') {
          this.reveal(id);
        }
      }),
      this.treeView.onDidChangeVisibility(({ visible }) => {
        if (visible) {
          this.reveal(this.selection.selectedId);
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

  private refresh(): void {
    const meta = this.store.getMeta();
    this.treeView.description = meta.title || undefined;
    void vscode.commands.executeCommand('setContext', 'minuet.hasTour', this.tourOpen.isOpen());
    const stop = this.stops.current;
    const step = stop ? this.store.get(stop.stepId) : undefined;
    this.treeView.message = step ? `Stopped at step ${step.order}: ${step.title}` : undefined;
    this.changeEmitter.fire(undefined);
  }

  /** Selects the step in the tree. Only while visible: revealing would otherwise open the sidebar. */
  private reveal(id: string | undefined): void {
    if (!id || !this.treeView.visible) {
      return;
    }
    const current = this.treeView.selection[0];
    if (current?.kind === 'step' && current.step.id === id) {
      return;
    }
    const step = this.store.get(id);
    if (step) {
      void this.treeView
        .reveal(this.stepNode(step), { select: true, focus: false })
        .then(undefined, () => undefined);
    }
  }

  private stepNode(step: Step): StepsNode {
    const node: StepsNode = { kind: 'step', step };
    this.stepNodes.set(step.id, node);
    return node;
  }

  getParent(node: StepsNode): StepsNode | undefined {
    return node.kind === 'contextLine' ? { kind: 'context' } : undefined;
  }

  getChildren(node?: StepsNode): StepsNode[] {
    if (!node) {
      const meta = this.store.getMeta();
      const roots: StepsNode[] = [];
      if (meta.title || meta.context) {
        roots.push({ kind: 'context' });
      }
      this.stepNodes = new Map();
      for (const step of this.store.all()) {
        roots.push(this.stepNode(step));
      }
      return roots;
    }
    if (node.kind === 'context') {
      return contentText(this.store.getMeta().context)
        .split(/\r?\n/)
        .map((text, index) => ({ text: text.trimEnd(), index }))
        .filter((l) => l.text.trim() !== '')
        .map((l) => ({ kind: 'contextLine', text: l.text, index: l.index }));
    }
    return [];
  }

  getTreeItem(node: StepsNode): vscode.TreeItem {
    switch (node.kind) {
      case 'context':
        return this.contextItem();
      case 'contextLine': {
        const item = new vscode.TreeItem(node.text.trim(), vscode.TreeItemCollapsibleState.None);
        item.id = nodeId(node);
        item.tooltip = node.text;
        return item;
      }
      case 'step':
        return this.stepItem(node.step);
    }
  }

  private contextItem(): vscode.TreeItem {
    const meta = this.store.getMeta();
    const file = isFileContent(meta.context) ? meta.context.file : undefined;
    const text = contentText(meta.context);
    const item = new vscode.TreeItem(
      meta.title || 'Tour context',
      text.trim() ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    item.id = 'context';
    item.description = file ?? (meta.title ? 'context' : undefined);
    item.iconPath = new vscode.ThemeIcon('book');
    item.contextValue = 'context';
    if (file || text.trim()) {
      item.tooltip = file ? `Context in ${file}` : new vscode.MarkdownString(text);
      item.command = { command: 'minuet.showContext', title: 'Show context' };
    }
    return item;
  }

  private stepItem(step: Step): vscode.TreeItem {
    const isCurrent = this.stops.current?.stepId === step.id;
    const stale = this.staleTracker.isStale(step.id);
    const uri = vscode.Uri.parse(step.location.uri);
    const line = toOneBased(step.location.line);

    const item = new vscode.TreeItem(`${step.order}. ${step.title}`, vscode.TreeItemCollapsibleState.None);
    item.id = nodeId({ kind: 'step', step });
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
