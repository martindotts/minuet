import * as path from 'path';
import * as vscode from 'vscode';
import { isFolderTour, TourEntry, Tours } from '../tours/tours';

export const TOURS_VIEW_ID = 'minuet.tours';

/** The "Tours" tree: the files of the tours folder, with the open one marked. */
export class ToursView implements vscode.TreeDataProvider<TourEntry>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly tours: Tours) {
    const treeView = vscode.window.createTreeView(TOURS_VIEW_ID, { treeDataProvider: this });
    this.disposables.push(
      treeView,
      tours.onDidChange(() => {
        const folder = tours.folder;
        treeView.description = folder ? vscode.workspace.asRelativePath(folder) : undefined;
        this.changeEmitter.fire();
      }),
    );
  }

  getChildren(node?: TourEntry): TourEntry[] {
    return node ? [] : [...this.tours.list];
  }

  getTreeItem(tour: TourEntry): vscode.TreeItem {
    const open = this.tours.isOpen(tour.uri);
    const file = isFolderTour(tour.uri.fsPath)
      ? `${path.basename(path.dirname(tour.uri.fsPath))}/${path.basename(tour.uri.fsPath)}`
      : path.basename(tour.uri.fsPath);
    const item = new vscode.TreeItem(tour.title, vscode.TreeItemCollapsibleState.None);
    item.id = tour.uri.toString();
    item.resourceUri = tour.uri;
    if (tour.errors) {
      item.description = file;
      item.contextValue = 'tour.invalid';
      item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
      item.tooltip = `${file} is not a valid tour:\n${tour.errors.join('\n')}`;
      item.command = { command: 'vscode.open', title: 'Open File', arguments: [tour.uri] };
      return item;
    }
    item.description = open ? 'open' : `${tour.steps} steps`;
    item.contextValue = open ? 'tour.open' : 'tour';
    item.iconPath = new vscode.ThemeIcon(open ? 'debug-breakpoint-log' : 'debug-breakpoint-log-unverified');
    item.tooltip = `${tour.title}\n${file} · ${tour.steps} steps${open ? '\nOpen: its breakpoints are set.' : '\nClick to open it.'}`;
    item.command = { command: 'minuet.openTour', title: 'Open Tour', arguments: [tour.uri] };
    return item;
  }

  dispose(): void {
    this.changeEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
