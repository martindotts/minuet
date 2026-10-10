import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { findBreakpointAt, newBreakpoint } from './breakpointSync';
import { Annotation, TourMeta } from './model';
import { FolderRef, isDirectlyIn, relativizePath, resolveToursFolder, resolveTourPath } from './paths';
import { readLine, StaleTracker } from './staleTracker';
import { AnnotationStore } from './store';
import { buildTourFile, parseTourJson, serializeTour, stepToAnnotation, TourFile } from './tourFormat';
import { VIEW_ID } from './tourView';

function workspaceFolders(): FolderRef[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => ({ name: f.name, fsPath: f.uri.fsPath }));
}

/** Folder of saved tours (`minuet.toursFolder`), or undefined when it is relative and no folder is open. */
export function toursFolder(): vscode.Uri | undefined {
  const setting = vscode.workspace.getConfiguration('minuet').get<string>('toursFolder');
  const fsPath = resolveToursFolder(setting, workspaceFolders());
  return fsPath ? vscode.Uri.file(fsPath) : undefined;
}

/** The current tour in the file format, as Save and Export write it. */
export function serializeCurrentTour(store: AnnotationStore): string {
  const folders = workspaceFolders();
  return serializeTour(
    buildTourFile(store.all(), store.getMeta(), (uri) => relativizePath(vscode.Uri.parse(uri).fsPath, folders)),
  );
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.File) !== 0;
  } catch {
    return false;
  }
}

async function showErrors(title: string, errors: string[]): Promise<void> {
  await vscode.window.showErrorMessage(title, { modal: true, detail: errors.join('\n') });
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
    if (!(await fileExists(uri))) {
      errors.push(`steps[${index}].file: file "${step.file}" does not exist (looked for ${fsPath}).`);
      continue;
    }
    uris.push(uri);
  }
  return errors.length > 0 ? { errors } : { uris };
}

export interface ImportOptions {
  /**
   * The import was requested from outside the editor (an agent or a link through a vscode:// URI):
   * always ask before touching anything, even when there are no annotations yet.
   */
  external?: boolean;
  /** Replace the current tour without asking (opening a saved tour, after closing the current one). */
  replace?: boolean;
}

export async function importTour(
  store: AnnotationStore,
  staleTracker: StaleTracker,
  source?: vscode.Uri,
  options: ImportOptions = {},
): Promise<boolean> {
  let uri = source;
  if (!uri) {
    const picked = await vscode.window.showOpenDialog({
      title: 'Import Tour',
      openLabel: 'Import',
      canSelectMany: false,
      filters: { 'Tour (JSON)': ['json', 'jsonc'] },
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    });
    uri = picked?.[0];
  }
  if (!uri) {
    return false;
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
  } catch (err) {
    await showErrors('Could not read the tour file.', [err instanceof Error ? err.message : String(err)]);
    return false;
  }

  const parsed = parseTourJson(text);
  if (!parsed.ok) {
    await showErrors(`The tour is not valid: ${vscode.workspace.asRelativePath(uri)}`, parsed.errors);
    return false;
  }
  const tour = parsed.tour;

  const resolved = await resolveFiles(tour);
  if ('errors' in resolved) {
    await showErrors('Could not import the tour: files are missing.', resolved.errors);
    return false;
  }

  const origin = options.external
    ? `Requested by an agent or a link (vscode://).\nFile: ${uri.fsPath}\nTour: "${tour.title || 'untitled'}", ${tour.steps.length} steps.\n\n`
    : '';
  let append = false;
  if (store.count() === 0 && options.external) {
    const accept = 'Import';
    const choice = await vscode.window.showInformationMessage(
      'Import a tour into this workspace?',
      { modal: true, detail: origin + 'A breakpoint is created for each step.' },
      accept,
    );
    if (choice !== accept) {
      return false;
    }
  } else if (store.count() > 0 && !options.replace) {
    const replace = 'Replace';
    const add = 'Append';
    const choice = await vscode.window.showWarningMessage(
      `This workspace already has ${store.count()} annotations.`,
      {
        modal: true,
        detail:
          origin +
          'Replace deletes the current annotations (their breakpoints are kept). ' +
          'Append adds the imported steps at the end of the current tour.',
      },
      replace,
      add,
    );
    if (!choice) {
      return false;
    }
    append = choice === add;
  }

  const base = append ? store.all() : [];
  const offset = append ? store.nextOrder() - 1 : 0;
  const created: Annotation[] = [];
  const breakpoints: vscode.SourceBreakpoint[] = [];
  let skipped = 0;

  for (const [index, step] of tour.steps.entries()) {
    const fileUri = resolved.uris[index].toString();
    const line = step.line - 1;
    if (base.some((a) => a.location.uri === fileUri && a.location.line === line)) {
      skipped++;
      continue;
    }
    const annotation: Annotation = {
      ...stepToAnnotation(step, fileUri, randomUUID(), await readLine(resolved.uris[index], line)),
      order: offset + index + 1,
    };
    const existing = findBreakpointAt(fileUri, line);
    const bp = existing ?? newBreakpoint(fileUri, line);
    annotation.breakpointId = bp.id;
    if (!existing) {
      breakpoints.push(bp);
    }
    created.push(annotation);
  }

  const currentMeta = store.getMeta();
  const meta: TourMeta =
    append && (currentMeta.title || currentMeta.context) ? currentMeta : { title: tour.title, context: tour.context };

  // Annotations first, so the "added" breakpoint events find them already associated.
  await store.replaceAll([...base, ...created]);
  await store.setMeta(meta);
  if (breakpoints.length > 0) {
    vscode.debug.addBreakpoints(breakpoints);
  }

  if (!append) {
    // A tour opened from the tours folder is that saved tour; any other file starts an unsaved one.
    const folder = toursFolder();
    const saved = folder && isDirectlyIn(uri.fsPath, folder.fsPath);
    await store.setSource(saved ? { file: uri.fsPath, snapshot: serializeCurrentTour(store) } : undefined);
  }

  await staleTracker.refresh();
  const stale = created.filter((a) => staleTracker.isStale(a.id)).length;
  const parts = [`Tour imported: ${created.length} ${created.length === 1 ? 'step' : 'steps'}.`];
  if (stale > 0) {
    parts.push(`${stale} outdated: the line does not match anchorText.`);
  }
  if (skipped > 0) {
    parts.push(`${skipped} skipped: that line already had an annotation.`);
  }
  void vscode.commands.executeCommand(`${VIEW_ID}.focus`);
  void (stale > 0 ? vscode.window.showWarningMessage(parts.join(' ')) : vscode.window.showInformationMessage(parts.join(' ')));
  return true;
}

export async function exportTour(store: AnnotationStore): Promise<void> {
  if (store.count() === 0) {
    void vscode.window.showInformationMessage('There are no annotations to export.');
    return;
  }
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const target = await vscode.window.showSaveDialog({
    title: 'Export Tour',
    saveLabel: 'Export',
    filters: { 'Tour (JSON)': ['json'] },
    defaultUri: folder ? vscode.Uri.joinPath(folder, 'tour.json') : undefined,
  });
  if (!target) {
    return;
  }
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(serializeCurrentTour(store)));
  const open = 'Open';
  const choice = await vscode.window.showInformationMessage(
    `Tour exported (${store.count()} steps): ${vscode.workspace.asRelativePath(target)}`,
    open,
  );
  if (choice === open) {
    await vscode.window.showTextDocument(target);
  }
}
