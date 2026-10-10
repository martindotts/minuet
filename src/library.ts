import * as path from 'path';
import * as vscode from 'vscode';
import { findBreakpointAt, findBreakpointById } from './breakpointSync';
import { importTour, serializeCurrentTour, toursFolder } from './importExport';
import { EMPTY_META } from './model';
import { normalizeFsPath, tourFileName } from './paths';
import { StaleTracker } from './staleTracker';
import { AnnotationStore } from './store';
import { parseTourJson } from './tourFormat';
import { VIEW_ID } from './tourView';

export const LIBRARY_VIEW_ID = 'minuet.library';

/** A tour file in the tours folder. */
export interface SavedTour {
  uri: vscode.Uri;
  title: string;
  steps: number;
  /** Set when the file is not a valid tour. */
  errors?: string[];
}

function sameFile(a: string, b: string): boolean {
  return normalizeFsPath(a) === normalizeFsPath(b);
}

/**
 * The tours saved in the tours folder (`.minuet/` by default) and whether the current tour has
 * changes that are not in its file yet. Nothing is written until the user saves.
 */
export class TourLibrary implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  private tours: SavedTour[] = [];
  private watcher: vscode.FileSystemWatcher | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly store: AnnotationStore) {
    this.disposables.push(
      store.onDidChange(() => this.changeEmitter.fire()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('minuet.toursFolder')) {
          this.watch();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.watch()),
    );
    this.watch();
  }

  get folder(): vscode.Uri | undefined {
    return toursFolder();
  }

  get saved(): readonly SavedTour[] {
    return this.tours;
  }

  /** The saved tour that is open now, if the current tour came from (or was saved to) one. */
  get openFile(): vscode.Uri | undefined {
    const source = this.store.getSource();
    return source ? vscode.Uri.file(source.file) : undefined;
  }

  /** The current tour has steps that are not saved: it is new, or it changed since it was saved. */
  isDirty(): boolean {
    if (this.store.count() === 0) {
      return false;
    }
    const source = this.store.getSource();
    return !source || serializeCurrentTour(this.store) !== source.snapshot;
  }

  isOpen(uri: vscode.Uri): boolean {
    const source = this.store.getSource();
    return source !== undefined && sameFile(source.file, uri.fsPath);
  }

  async markSaved(uri: vscode.Uri): Promise<void> {
    await this.store.setSource({ file: uri.fsPath, snapshot: serializeCurrentTour(this.store) });
  }

  /** Reads the tours folder again. */
  async refresh(): Promise<void> {
    const folder = this.folder;
    const tours: SavedTour[] = [];
    if (folder) {
      let entries: [string, vscode.FileType][] = [];
      try {
        entries = await vscode.workspace.fs.readDirectory(folder);
      } catch {
        entries = [];
      }
      for (const [name, type] of entries) {
        if (type !== vscode.FileType.File || !/\.jsonc?$/i.test(name)) {
          continue;
        }
        const uri = vscode.Uri.joinPath(folder, name);
        tours.push(await readSavedTour(uri));
      }
    }
    this.tours = tours.sort((a, b) => a.title.localeCompare(b.title));
    this.changeEmitter.fire();
  }

  private watch(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    const folder = this.folder;
    if (folder) {
      this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '*.{json,jsonc}'));
      const refresh = (): void => void this.refresh();
      this.watcher.onDidCreate(refresh);
      this.watcher.onDidChange(refresh);
      this.watcher.onDidDelete(refresh);
    }
    void this.refresh();
  }

  dispose(): void {
    this.watcher?.dispose();
    this.changeEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

async function readSavedTour(uri: vscode.Uri): Promise<SavedTour> {
  const name = path.basename(uri.fsPath).replace(/(\.tour)?\.jsonc?$/i, '');
  try {
    const parsed = parseTourJson(new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri)));
    if (!parsed.ok) {
      return { uri, title: name, steps: 0, errors: parsed.errors };
    }
    return { uri, title: parsed.tour.title || name, steps: parsed.tour.steps.length };
  } catch (err) {
    return { uri, title: name, steps: 0, errors: [err instanceof Error ? err.message : String(err)] };
  }
}

/** The "Saved Tours" tree: the files of the tours folder, with the open one marked. */
export class LibraryView implements vscode.TreeDataProvider<SavedTour>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly library: TourLibrary) {
    const treeView = vscode.window.createTreeView(LIBRARY_VIEW_ID, { treeDataProvider: this });
    this.disposables.push(
      treeView,
      library.onDidChange(() => {
        const folder = library.folder;
        treeView.description = folder ? vscode.workspace.asRelativePath(folder) : undefined;
        this.changeEmitter.fire();
      }),
    );
  }

  getChildren(node?: SavedTour): SavedTour[] {
    return node ? [] : [...this.library.saved];
  }

  getTreeItem(tour: SavedTour): vscode.TreeItem {
    const open = this.library.isOpen(tour.uri);
    const item = new vscode.TreeItem(tour.title, vscode.TreeItemCollapsibleState.None);
    item.id = tour.uri.toString();
    item.resourceUri = tour.uri;
    item.contextValue = 'savedTour';
    const file = path.basename(tour.uri.fsPath);
    if (tour.errors) {
      item.description = file;
      item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
      item.tooltip = `${file} is not a valid tour:\n${tour.errors.join('\n')}`;
      item.command = { command: 'vscode.open', title: 'Open File', arguments: [tour.uri] };
      return item;
    }
    const state = open ? (this.library.isDirty() ? 'open · unsaved changes' : 'open') : `${tour.steps} steps`;
    item.description = state;
    item.iconPath = new vscode.ThemeIcon(open ? 'debug-breakpoint-log' : 'debug-breakpoint-log-unverified');
    item.tooltip = `${tour.title}\n${file} · ${tour.steps} steps${open ? '\nOpen in VS Code' : ''}`;
    item.command = { command: 'minuet.openSavedTour', title: 'Open Tour', arguments: [tour.uri] };
    return item;
  }

  dispose(): void {
    this.changeEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

/**
 * Writes the current tour to `target`, to the file it came from, or to a new file the user names.
 * Returns whether it was saved.
 */
export async function saveTour(
  store: AnnotationStore,
  library: TourLibrary,
  asNew = false,
  target: vscode.Uri | undefined = asNew ? undefined : library.openFile,
): Promise<boolean> {
  if (store.count() === 0) {
    void vscode.window.showInformationMessage('There are no steps to save.');
    return false;
  }
  if (!target) {
    const folder = library.folder;
    if (!folder) {
      void vscode.window.showErrorMessage('Open a folder to save tours, or set an absolute path in minuet.toursFolder.');
      return false;
    }
    const name = await vscode.window.showInputBox({
      title: 'Save Tour',
      prompt: `File name in ${vscode.workspace.asRelativePath(folder)}/`,
      value: tourFileName(store.getMeta().title),
      validateInput: (value) =>
        !value.trim() ? 'Enter a name.' : /[\\/]/.test(value) ? 'Enter a file name, without folders.' : undefined,
    });
    if (!name) {
      return false;
    }
    const fileName = /\.jsonc?$/i.test(name.trim()) ? name.trim() : `${name.trim()}.tour.json`;
    target = vscode.Uri.joinPath(folder, fileName);
    if (await exists(target)) {
      const replace = 'Replace';
      const choice = await vscode.window.showWarningMessage(
        `${vscode.workspace.asRelativePath(target)} already exists.`,
        { modal: true, detail: 'It will be replaced with the current tour.' },
        replace,
      );
      if (choice !== replace) {
        return false;
      }
    }
  }
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(serializeCurrentTour(store)));
  await library.markSaved(target);
  void vscode.window.showInformationMessage(`Tour saved: ${vscode.workspace.asRelativePath(target)}`);
  return true;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Takes the current tour out of VS Code: its annotations and the breakpoints of its steps. Offers to
 * save unsaved changes first. Returns false when the user cancels.
 */
export async function closeCurrentTour(store: AnnotationStore, library: TourLibrary): Promise<boolean> {
  if (store.count() === 0 && !store.getMeta().title && !store.getMeta().context) {
    await store.setSource(undefined);
    return true;
  }
  if (library.isDirty()) {
    const title = store.getMeta().title || 'the current tour';
    const save = 'Save';
    const discard = "Don't Save";
    const choice = await vscode.window.showWarningMessage(
      `Save the changes to ${title}?`,
      { modal: true, detail: 'The tour is closed afterwards. Without saving, its changes are lost.' },
      save,
      discard,
    );
    if (!choice || (choice === save && !(await saveTour(store, library)))) {
      return false;
    }
  }
  const breakpoints = store
    .all()
    .map((a) => findBreakpointById(a.breakpointId) ?? findBreakpointAt(a.location.uri, a.location.line))
    .filter((bp): bp is vscode.SourceBreakpoint => bp !== undefined);
  // Annotations first, so removing the breakpoints does not delete them one by one.
  await store.replaceAll([]);
  await store.setMeta(EMPTY_META);
  await store.setSource(undefined);
  if (breakpoints.length > 0) {
    vscode.debug.removeBreakpoints(breakpoints);
  }
  return true;
}

/** Closes the current tour and opens a saved one in its place. */
export async function openSavedTour(
  store: AnnotationStore,
  staleTracker: StaleTracker,
  library: TourLibrary,
  uri: vscode.Uri,
): Promise<void> {
  if (library.isOpen(uri) && !library.isDirty()) {
    void vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    return;
  }
  if (!(await closeCurrentTour(store, library))) {
    return;
  }
  await importTour(store, staleTracker, uri, { replace: true });
}
