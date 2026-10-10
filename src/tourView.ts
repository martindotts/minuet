import * as path from 'path';
import * as vscode from 'vscode';
import { Annotation, contentText, isFileContent } from './model';
import { toOneBased } from './lines';
import { StepSelection } from './selection';
import { StaleTracker } from './staleTracker';
import { StopController } from './stopController';
import { AnnotationStore } from './store';

export const VIEW_ID = 'minuet.tour';

export type TourNode =
  | { kind: 'context' }
  | { kind: 'contextLine'; text: string; index: number }
  | { kind: 'step'; annotation: Annotation };

function nodeId(node: TourNode): string {
  switch (node.kind) {
    case 'context':
      return 'context';
    case 'contextLine':
      return `context/${node.index}`;
    case 'step':
      return `step/${node.annotation.id}`;
  }
}

/** The "Tour" tree: tour context and steps in order, kept in sync with the selected step. */
export class TourView implements vscode.TreeDataProvider<TourNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<TourNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  readonly treeView: vscode.TreeView<TourNode>;
  private stepNodes = new Map<string, TourNode>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly store: AnnotationStore,
    private readonly staleTracker: StaleTracker,
    private readonly stops: StopController,
    private readonly selection: StepSelection,
    /** Whether a tour is open (it can have no steps yet). */
    private readonly tourOpen: { isOpen(): boolean; onDidChange: vscode.Event<void> },
  ) {
    this.treeView = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: this });
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
          this.selection.select(node.annotation.id, 'tree');
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
    const annotation = stop ? this.store.get(stop.annotationId) : undefined;
    this.treeView.message = annotation ? `Stopped at step ${annotation.order}: ${annotation.title}` : undefined;
    this.changeEmitter.fire(undefined);
  }

  /** Selects the step in the tree. Only while visible: revealing would otherwise open the sidebar. */
  private reveal(id: string | undefined): void {
    if (!id || !this.treeView.visible) {
      return;
    }
    const current = this.treeView.selection[0];
    if (current?.kind === 'step' && current.annotation.id === id) {
      return;
    }
    const annotation = this.store.get(id);
    if (annotation) {
      void this.treeView
        .reveal(this.stepNode(annotation), { select: true, focus: false })
        .then(undefined, () => undefined);
    }
  }

  private stepNode(annotation: Annotation): TourNode {
    const node: TourNode = { kind: 'step', annotation };
    this.stepNodes.set(annotation.id, node);
    return node;
  }

  getParent(node: TourNode): TourNode | undefined {
    return node.kind === 'contextLine' ? { kind: 'context' } : undefined;
  }

  getChildren(node?: TourNode): TourNode[] {
    if (!node) {
      const meta = this.store.getMeta();
      const roots: TourNode[] = [];
      if (meta.title || meta.context) {
        roots.push({ kind: 'context' });
      }
      this.stepNodes = new Map();
      for (const annotation of this.store.all()) {
        roots.push(this.stepNode(annotation));
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

  getTreeItem(node: TourNode): vscode.TreeItem {
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
        return this.stepItem(node.annotation);
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

  private stepItem(annotation: Annotation): vscode.TreeItem {
    const isCurrent = this.stops.current?.annotationId === annotation.id;
    const stale = this.staleTracker.isStale(annotation.id);
    const uri = vscode.Uri.parse(annotation.location.uri);
    const line = toOneBased(annotation.location.line);

    const item = new vscode.TreeItem(`${annotation.order}. ${annotation.title}`, vscode.TreeItemCollapsibleState.None);
    item.id = nodeId({ kind: 'step', annotation });
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
    tooltip.appendMarkdown(`**${annotation.order}. ${annotation.title}**  \n`);
    tooltip.appendMarkdown(`\`${vscode.workspace.asRelativePath(uri)}:${line}\``);
    if (isCurrent) {
      tooltip.appendMarkdown('\n\n$(debug-stackframe) Execution is stopped at this step.');
    }
    if (stale) {
      tooltip.appendMarkdown('\n\n$(warning) **Outdated:** the line no longer matches the annotated text.');
    }
    item.tooltip = tooltip;
    item.command = { command: 'minuet.openStep', title: 'Open', arguments: [annotation.id] };
    return item;
  }

  dispose(): void {
    this.changeEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
