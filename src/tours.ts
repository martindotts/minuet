import { randomUUID } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { findBreakpointAt, findBreakpointById, newBreakpoint } from './breakpointSync';
import { Annotation, EMPTY_META } from './model';
import { FolderRef, isDirectlyIn, normalizeFsPath, relativizePath, resolveToursFolder, resolveTourPath, tourFileName } from './paths';
import { readLine, StaleTracker } from './staleTracker';
import { AnnotationStore } from './store';
import { buildTourFile, parseTourJson, serializeTour, stepToAnnotation, TourFile } from './tourFormat';
import { VIEW_ID } from './tourView';

export const TOURS_VIEW_ID = 'minuet.tours';
const ACTIVE_KEY = 'minuet.activeTour';
/** File name of a tour stored as a folder: `.minuet/<name>/tour.json`, next to its content files. */
export const TOUR_FILE_NAME = 'tour.json';

/** `<folder>/tour.json(c)`: a tour stored as a folder with its content files. */
export function isFolderTour(fsPath: string): boolean {
  return /^tour\.jsonc?$/i.test(path.basename(fsPath));
}

/** A tour file name: `tour.json` inside its folder, or `<name>.tour.json` on its own. */
export function isTourFileName(name: string): boolean {
  return /^tour\.jsonc?$/i.test(name) || /\.tour\.jsonc?$/i.test(name);
}

/** True when the tour file belongs to the tours folder (directly, or as `<name>/tour.json`). */
export function isInToursFolder(fsPath: string, folder: string): boolean {
  return isFolderTour(fsPath) ? isDirectlyIn(path.dirname(fsPath), folder) : isDirectlyIn(fsPath, folder);
}

/** A tour file in the tours folder. */
export interface TourEntry {
  uri: vscode.Uri;
  title: string;
  steps: number;
  /** Set when the file is not a valid tour. */
  errors?: string[];
}

function workspaceFolders(): FolderRef[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => ({ name: f.name, fsPath: f.uri.fsPath }));
}

function sameFile(a: vscode.Uri, b: vscode.Uri): boolean {
  return normalizeFsPath(a.fsPath) === normalizeFsPath(b.fsPath);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Folder of the tours (`minuet.toursFolder`), or undefined when it is relative and no folder is open. */
export function toursFolder(): vscode.Uri | undefined {
  const setting = vscode.workspace.getConfiguration('minuet').get<string>('toursFolder');
  const fsPath = resolveToursFolder(setting, workspaceFolders());
  return fsPath ? vscode.Uri.file(fsPath) : undefined;
}

/** The open tour in the file format. */
export function serializeStore(store: AnnotationStore): string {
  const folders = workspaceFolders();
  return serializeTour(
    buildTourFile(store.all(), store.getMeta(), (uri) => relativizePath(vscode.Uri.parse(uri).fsPath, folders)),
  );
}

/** Resolves every step's file. Returns the uris, or the list of problems. */
async function resolveFiles(tour: TourFile): Promise<{ uris: vscode.Uri[] } | { errors: string[] }> {
  const folders = workspaceFolders();
  const errors: string[] = [];
  const uris: vscode.Uri[] = [];
  for (const [index, step] of tour.steps.entries()) {
    const fsPath = resolveTourPath(step.file, folders);
    if (!fsPath) {
      errors.push(`steps[${index}].file: "${step.file}" is relative but no folder is open in VS Code.`);
      continue;
    }
    const uri = vscode.Uri.file(fsPath);
    if (!(await exists(uri))) {
      errors.push(`steps[${index}].file: file "${step.file}" does not exist (looked for ${fsPath}).`);
      continue;
    }
    uris.push(uri);
  }
  return errors.length > 0 ? { errors } : { uris };
}

type Loaded = { tour: TourFile; uris: vscode.Uri[] } | { errors: string[] };

/** Reads, validates and resolves a tour file. */
async function readTour(text: string): Promise<Loaded> {
  const parsed = parseTourJson(text);
  if (!parsed.ok) {
    return { errors: parsed.errors };
  }
  const resolved = await resolveFiles(parsed.tour);
  return 'errors' in resolved ? resolved : { tour: parsed.tour, uris: resolved.uris };
}

async function showErrors(title: string, errors: string[]): Promise<void> {
  await vscode.window.showErrorMessage(title, { modal: true, detail: errors.join('\n') });
}

/**
 * Tours are the `.tour.json` files of the tours folder (`.minuet/` by default); that folder is the only
 * source of truth. One tour is open at a time: its steps are loaded in the store, its breakpoints are
 * set, and every change is written back to its file right away. VS Code only remembers which one is open.
 */
export class Tours implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly contentEmitter = new vscode.EventEmitter<vscode.Uri>();
  /** A file of the tours folder that is not a tour changed (a step's .md or .html, its css, data…). */
  readonly onDidChangeContent = this.contentEmitter.event;

  private entries: TourEntry[] = [];
  private active: vscode.Uri | undefined;
  /** The open tour as last read from or written to its file, to skip writes and reloads of our own. */
  private written: string | undefined;
  private diskText: string | undefined;
  /** While > 0, store changes come from loading a file and are not written back. */
  private loading = 0;
  private writes: Promise<void> = Promise.resolve();
  private watcher: vscode.FileSystemWatcher | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly state: vscode.Memento,
    private readonly store: AnnotationStore,
    private readonly staleTracker: StaleTracker,
  ) {
    this.disposables.push(
      store.onDidChange(() => {
        if (this.loading === 0 && this.active) {
          this.queueWrite();
        }
      }),
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

  get list(): readonly TourEntry[] {
    return this.entries;
  }

  get activeFile(): vscode.Uri | undefined {
    return this.active;
  }

  isOpen(uri: vscode.Uri): boolean {
    return this.active !== undefined && sameFile(this.active, uri);
  }

  /**
   * The file of a `content` (or `context`) of the open tour: relative to the tour file's folder, and never
   * outside the workspace or the tours folder.
   */
  resolveContentFile(file: string): { uri: vscode.Uri } | { error: string } {
    if (!this.active) {
      return { error: 'No tour is open.' };
    }
    const fsPath = path.resolve(path.dirname(this.active.fsPath), file);
    const roots = [...workspaceFolders().map((f) => f.fsPath), ...(this.folder ? [this.folder.fsPath] : [])];
    if (!roots.some((root) => isInside(root, fsPath))) {
      return { error: `"${file}" is outside the workspace.` };
    }
    return { uri: vscode.Uri.file(fsPath) };
  }

  /** Resolves once the pending writes of the open tour are on disk. */
  flush(): Promise<void> {
    return this.writes;
  }

  /**
   * Loads the tour that was open in the last session. Its breakpoints are still in VS Code; the ones
   * missing are recreated by the breakpoint sync.
   */
  async restore(): Promise<void> {
    const file = this.state.get<string>(ACTIVE_KEY);
    if (!file) {
      return;
    }
    const uri = vscode.Uri.file(file);
    try {
      const text = decode(await vscode.workspace.fs.readFile(uri));
      const loaded = await readTour(text);
      if ('errors' in loaded) {
        throw new Error(loaded.errors.join('\n'));
      }
      await this.load(uri, text, loaded, { setBreakpoints: false });
    } catch {
      await this.setActive(undefined);
    }
  }

  /**
   * Opens a tour file, closing the open one first. A file outside the tours folder is copied into it, so
   * the folder stays the only place tours live. Returns whether the tour was opened.
   */
  async open(source: vscode.Uri, options: { external?: boolean } = {}): Promise<boolean> {
    if (this.isOpen(source)) {
      void vscode.commands.executeCommand(`${VIEW_ID}.focus`);
      return true;
    }
    const folder = this.folder;
    if (!folder) {
      void vscode.window.showErrorMessage('Open a folder to use tours, or set an absolute path in minuet.toursFolder.');
      return false;
    }
    let text: string;
    try {
      text = decode(await vscode.workspace.fs.readFile(source));
    } catch (err) {
      await showErrors('Could not read the tour file.', [err instanceof Error ? err.message : String(err)]);
      return false;
    }
    const loaded = await readTour(text);
    if ('errors' in loaded) {
      await showErrors(`The tour is not valid: ${vscode.workspace.asRelativePath(source)}`, loaded.errors);
      return false;
    }

    const inFolder = isInToursFolder(source.fsPath, folder.fsPath);
    const asFolder = isFolderTour(source.fsPath);
    const target = inFolder
      ? source
      : asFolder
        ? vscode.Uri.joinPath(await this.freeName(folder, path.basename(path.dirname(source.fsPath)), ''), TOUR_FILE_NAME)
        : await this.freeName(folder, path.basename(source.fsPath));
    const where = vscode.workspace.asRelativePath(target);
    if (options.external || !inFolder) {
      const accept = inFolder ? 'Open' : 'Copy and Open';
      const detail = [
        options.external ? 'Requested by an agent or a link (vscode://).' : '',
        `Tour: "${loaded.tour.title || 'untitled'}", ${loaded.tour.steps.length} steps.`,
        inFolder
          ? `File: ${where}`
          : `Tours live in ${vscode.workspace.asRelativePath(folder)}/. It is copied to ${where}${asFolder ? ', with its folder' : ''}.`,
        'A breakpoint is set for each step.',
      ].filter(Boolean);
      const choice = await vscode.window.showInformationMessage(
        'Open this tour?',
        { modal: true, detail: detail.join('\n') },
        accept,
      );
      if (choice !== accept) {
        return false;
      }
    }

    if (!(await this.close())) {
      return false;
    }
    if (!inFolder) {
      await this.ensureFolder(folder);
      if (asFolder) {
        // The content files of the steps live next to tour.json: copy the whole folder.
        await vscode.workspace.fs.copy(vscode.Uri.joinPath(source, '..'), vscode.Uri.joinPath(target, '..'));
      } else {
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
      }
    }
    await this.load(target, text, loaded, { setBreakpoints: true });
    await this.staleTracker.refresh();
    const stale = this.store.all().filter((a) => this.staleTracker.isStale(a.id)).length;
    void vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    if (stale > 0) {
      void vscode.window.showWarningMessage(
        `${stale} of ${this.store.count()} steps are outdated: their line no longer matches anchorText.`,
      );
    }
    return true;
  }

  /** Takes the open tour out of VS Code with the breakpoints of its steps. Its file is not touched. */
  async close(): Promise<boolean> {
    if (!this.active) {
      return true;
    }
    await this.flush();
    const breakpoints = this.store
      .all()
      .map((a) => findBreakpointById(a.breakpointId) ?? findBreakpointAt(a.location.uri, a.location.line))
      .filter((bp): bp is vscode.SourceBreakpoint => bp !== undefined);
    await this.setActive(undefined);
    await this.withoutWriting(async () => {
      await this.store.replaceAll([]);
      await this.store.setMeta(EMPTY_META);
    });
    if (breakpoints.length > 0) {
      vscode.debug.removeBreakpoints(breakpoints);
    }
    return true;
  }

  /** Asks for a title, writes an empty tour file and opens it. */
  async create(): Promise<boolean> {
    const folder = this.folder;
    if (!folder) {
      void vscode.window.showErrorMessage('Open a folder to use tours, or set an absolute path in minuet.toursFolder.');
      return false;
    }
    const title = await vscode.window.showInputBox({
      title: 'New Tour',
      prompt: `Title of the tour. It is saved in its own folder in ${vscode.workspace.asRelativePath(folder)}/.`,
      placeHolder: 'e.g. How the order confirmation email is built',
      validateInput: (v) => (v.trim() ? undefined : 'The title cannot be empty.'),
    });
    if (!title) {
      return false;
    }
    const target = vscode.Uri.joinPath(await this.freeName(folder, tourFileName(title), ''), TOUR_FILE_NAME);
    const text = serializeTour({ version: 1, title: title.trim(), context: '', steps: [] });
    await this.ensureFolder(folder);
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
    return this.open(target);
  }

  /** Deletes a tour (its folder, for a `<name>/tour.json` tour), closing it first if it is open. */
  async delete(uri: vscode.Uri): Promise<void> {
    const remove = 'Delete';
    const target = isFolderTour(uri.fsPath) ? vscode.Uri.joinPath(uri, '..') : uri;
    const choice = await vscode.window.showWarningMessage(
      `Delete the tour ${vscode.workspace.asRelativePath(target)}${target === uri ? '' : '/'}?`,
      {
        modal: true,
        detail: `${target === uri ? 'The file is' : 'The folder and all its files are'} moved to the trash. If it is in git, it can be recovered from there.`,
      },
      remove,
    );
    if (choice !== remove) {
      return;
    }
    if (this.isOpen(uri)) {
      await this.close();
    }
    await vscode.workspace.fs.delete(target, { recursive: true, useTrash: true });
  }

  /** Makes sure a tour is open: the open one, or one the user picks or creates. False when the user cancels. */
  async ensureOpen(): Promise<boolean> {
    if (this.active) {
      return true;
    }
    type Pick = vscode.QuickPickItem & { uri?: vscode.Uri };
    const items: Pick[] = [
      { label: '$(add) New Tour…' },
      ...this.entries.filter((t) => !t.errors).map((t) => ({ label: t.title, description: `${t.steps} steps`, uri: t.uri })),
    ];
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'No tour is open. Add the step to…' });
    if (!picked) {
      return false;
    }
    return picked.uri ? this.open(picked.uri) : this.create();
  }

  /** Reads the tours folder again. */
  async refresh(): Promise<void> {
    const folder = this.folder;
    const entries: TourEntry[] = [];
    if (folder) {
      let files: [string, vscode.FileType][] = [];
      try {
        files = await vscode.workspace.fs.readDirectory(folder);
      } catch {
        files = [];
      }
      for (const [name, type] of files) {
        if (type === vscode.FileType.File && isTourFileName(name)) {
          entries.push(await readEntry(vscode.Uri.joinPath(folder, name)));
        } else if (type === vscode.FileType.Directory) {
          for (const candidate of [TOUR_FILE_NAME, 'tour.jsonc']) {
            const uri = vscode.Uri.joinPath(folder, name, candidate);
            if (await exists(uri)) {
              entries.push(await readEntry(uri));
              break;
            }
          }
        }
      }
    }
    this.entries = entries.sort((a, b) => a.title.localeCompare(b.title));
    this.changeEmitter.fire();
  }

  private async load(
    uri: vscode.Uri,
    text: string,
    loaded: { tour: TourFile; uris: vscode.Uri[] },
    options: { setBreakpoints: boolean; previous?: readonly Annotation[] },
  ): Promise<void> {
    const previous = options.previous ?? [];
    const annotations: Annotation[] = [];
    const breakpoints: vscode.SourceBreakpoint[] = [];
    for (const [index, step] of loaded.tour.steps.entries()) {
      const fileUri = loaded.uris[index].toString();
      const line = step.line - 1;
      // Keep the id of a step that is still on the same line, so selections survive a reload.
      const same = previous.find((a) => a.location.uri === fileUri && a.location.line === line);
      const annotation = stepToAnnotation(step, fileUri, same?.id ?? randomUUID(), await readLine(loaded.uris[index], line));
      const existing = findBreakpointAt(fileUri, line);
      if (existing) {
        annotation.breakpointId = existing.id;
      } else if (options.setBreakpoints) {
        const bp = newBreakpoint(fileUri, line);
        annotation.breakpointId = bp.id;
        breakpoints.push(bp);
      }
      annotations.push(annotation);
    }
    await this.withoutWriting(async () => {
      // Annotations first, so the "added" breakpoint events find them already associated.
      await this.store.replaceAll(annotations);
      await this.store.setMeta({ title: loaded.tour.title, context: loaded.tour.context });
    });
    this.written = serializeStore(this.store);
    this.diskText = text;
    await this.setActive(uri);
    if (breakpoints.length > 0) {
      vscode.debug.addBreakpoints(breakpoints);
    }
  }

  /** The open tour's file changed on disk (git pull, an agent, a hand edit): load it again. */
  private async reload(uri: vscode.Uri): Promise<void> {
    await this.flush();
    if (!this.isOpen(uri)) {
      return;
    }
    let text: string;
    try {
      text = decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return;
    }
    if (text === this.diskText) {
      return;
    }
    const loaded = await readTour(text);
    if ('errors' in loaded) {
      this.diskText = text;
      void vscode.window.showWarningMessage(
        `The open tour file has errors and was not reloaded: ${loaded.errors[0]}${loaded.errors.length > 1 ? ' (and more)' : ''}`,
      );
      return;
    }
    const previous = this.store.all();
    await this.load(uri, text, loaded, { setBreakpoints: true, previous });
    const kept = new Set(this.store.all().map((a) => a.breakpointId));
    const gone = previous
      .filter((a) => !kept.has(a.breakpointId))
      .map((a) => findBreakpointById(a.breakpointId))
      .filter((bp): bp is vscode.SourceBreakpoint => bp !== undefined);
    if (gone.length > 0) {
      vscode.debug.removeBreakpoints(gone);
    }
    await this.staleTracker.refresh();
  }

  private queueWrite(): void {
    const uri = this.active;
    this.writes = this.writes
      .then(async () => {
        if (!uri || !this.isOpen(uri)) {
          return;
        }
        const text = serializeStore(this.store);
        if (text === this.written) {
          return;
        }
        this.written = text;
        this.diskText = text;
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
      })
      .catch((err) => {
        void vscode.window.showErrorMessage(`Could not save the tour: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  private async withoutWriting(task: () => Promise<void>): Promise<void> {
    this.loading++;
    try {
      await task();
    } finally {
      this.loading--;
    }
  }

  private async setActive(uri: vscode.Uri | undefined): Promise<void> {
    this.active = uri;
    if (!uri) {
      this.written = undefined;
      this.diskText = undefined;
    }
    await this.state.update(ACTIVE_KEY, uri?.fsPath);
    this.changeEmitter.fire();
  }

  /** `name`, or `name-2`, `name-3`… when taken. `ext` is '' for a folder. */
  private async freeName(folder: vscode.Uri, name: string, ext?: string): Promise<vscode.Uri> {
    const match = ext === undefined ? /^(.*?)((\.tour)?\.jsonc?)$/i.exec(name) : null;
    const base = match ? match[1] : name;
    ext = ext ?? (match ? match[2] : '.tour.json');
    for (let n = 1; ; n++) {
      const uri = vscode.Uri.joinPath(folder, n === 1 ? `${base}${ext}` : `${base}-${n}${ext}`);
      if (!(await exists(uri))) {
        return uri;
      }
    }
  }

  /**
   * Creates the tours folder. The first time, in a git repository, offers to keep the tours out of git
   * (through .git/info/exclude, which is local and not committed).
   */
  private async ensureFolder(folder: vscode.Uri): Promise<void> {
    if (await exists(folder)) {
      return;
    }
    await vscode.workspace.fs.createDirectory(folder);
    const root = vscode.workspace.workspaceFolders?.find((f) => isInside(f.uri.fsPath, folder.fsPath))?.uri;
    if (!root || !(await exists(vscode.Uri.joinPath(root, '.git', 'info')))) {
      return;
    }
    const share = 'Share Through Git';
    const local = 'Keep Them Local';
    const relative = path.relative(root.fsPath, folder.fsPath).split(path.sep).join('/');
    void vscode.window
      .showInformationMessage(
        `Tours are saved in ${relative}/. Share them with your team through git, or keep them on this machine only?`,
        share,
        local,
      )
      .then(async (choice) => {
        if (choice !== local) {
          return;
        }
        const exclude = vscode.Uri.joinPath(root, '.git', 'info', 'exclude');
        let current = '';
        try {
          current = decode(await vscode.workspace.fs.readFile(exclude));
        } catch {
          current = '';
        }
        const line = `/${relative}/`;
        if (!current.split(/\r?\n/).includes(line)) {
          const prefix = current && !current.endsWith('\n') ? '\n' : '';
          await vscode.workspace.fs.writeFile(exclude, new TextEncoder().encode(`${current}${prefix}${line}\n`));
        }
        void vscode.window.showInformationMessage(`${relative}/ is now ignored by git on this machine (.git/info/exclude).`);
      });
  }

  private watch(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    const folder = this.folder;
    if (folder) {
      // The whole tree: tour files, tour folders and the content files of their steps.
      this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'));
      this.watcher.onDidCreate((uri) => {
        void this.refresh();
        this.contentEmitter.fire(uri);
      });
      this.watcher.onDidChange((uri) => {
        if (isTourFileName(path.basename(uri.fsPath))) {
          void this.refresh();
          void this.reload(uri);
        } else {
          this.contentEmitter.fire(uri);
        }
      });
      this.watcher.onDidDelete((uri) => {
        void this.refresh();
        const active = this.active;
        // Deleting a tour folder reports the folder, not the tour.json inside it.
        if (active && (this.isOpen(uri) || isInside(uri.fsPath, active.fsPath))) {
          void this.close().then(() =>
            vscode.window.showInformationMessage(`The open tour was closed: ${vscode.workspace.asRelativePath(uri)} was deleted.`),
          );
        } else {
          this.contentEmitter.fire(uri);
        }
      });
    }
    void this.refresh();
  }

  dispose(): void {
    this.watcher?.dispose();
    this.changeEmitter.dispose();
    this.contentEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

function isInside(folder: string, file: string): boolean {
  const rel = path.relative(folder, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function readEntry(uri: vscode.Uri): Promise<TourEntry> {
  const name = isFolderTour(uri.fsPath) ? path.basename(path.dirname(uri.fsPath)) : path.basename(uri.fsPath).replace(/(\.tour)?\.jsonc?$/i, '');
  try {
    const parsed = parseTourJson(decode(await vscode.workspace.fs.readFile(uri)));
    if (!parsed.ok) {
      return { uri, title: name, steps: 0, errors: parsed.errors };
    }
    return { uri, title: parsed.tour.title || name, steps: parsed.tour.steps.length };
  } catch (err) {
    return { uri, title: name, steps: 0, errors: [err instanceof Error ? err.message : String(err)] };
  }
}

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
