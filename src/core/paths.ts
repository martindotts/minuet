import * as path from 'path';

export interface FolderRef {
  name: string;
  fsPath: string;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function isInside(folder: string, file: string): boolean {
  const rel = path.relative(folder, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Path written to an exported tour: relative to the workspace folder that contains the file
 * (prefixed with the folder name in multi-root workspaces), or absolute when outside every folder.
 */
export function relativizePath(fsPath: string, folders: readonly FolderRef[]): string {
  const folder = folders.find((f) => isInside(f.fsPath, fsPath));
  if (!folder) {
    return toPosix(fsPath);
  }
  const rel = toPosix(path.relative(folder.fsPath, fsPath));
  return folders.length > 1 ? `${folder.name}/${rel}` : rel;
}

/**
 * Resolves a step path from a tour file. Absolute paths are kept. In multi-root workspaces a leading
 * segment equal to a folder name selects that folder; otherwise the first folder is used.
 * Returns undefined when the path is relative and there is no workspace folder.
 */
export function resolveTourPath(file: string, folders: readonly FolderRef[]): string | undefined {
  if (path.isAbsolute(file)) {
    return path.normalize(file);
  }
  if (folders.length === 0) {
    return undefined;
  }
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (folders.length > 1) {
    const [first, ...rest] = normalized.split('/');
    const named = folders.find((f) => f.name === first);
    if (named && rest.length > 0) {
      return path.join(named.fsPath, ...rest);
    }
  }
  return path.join(folders[0].fsPath, ...normalized.split('/'));
}

/** Normalizes a filesystem path for comparisons (case-insensitive on macOS and Windows). */
export function normalizeFsPath(p: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = path.normalize(p);
  return platform === 'darwin' || platform === 'win32' ? normalized.toLowerCase() : normalized;
}

const DEFAULT_TOURS_FOLDER = '.minuet';

/**
 * Folder where tours live: the `minuet.toursFolder` setting, relative to the first workspace
 * folder unless absolute. Undefined when it is relative and no folder is open.
 */
export function resolveToursFolder(setting: string | undefined, folders: readonly FolderRef[]): string | undefined {
  const value = setting?.trim() || DEFAULT_TOURS_FOLDER;
  if (path.isAbsolute(value)) {
    return path.normalize(value);
  }
  if (folders.length === 0) {
    return undefined;
  }
  return path.join(folders[0].fsPath, value);
}

/** True when the file sits directly inside the folder. */
export function isDirectlyIn(file: string, folder: string, platform: NodeJS.Platform = process.platform): boolean {
  return normalizeFsPath(path.dirname(file), platform) === normalizeFsPath(folder, platform);
}

/** File name (without extension) for a new tour, from its title: "Cómo se arma" → "como-se-arma". */
export function tourFileName(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'tour';
}
