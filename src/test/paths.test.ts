import * as assert from 'assert';
import * as path from 'path';
import { isDirectlyIn, normalizeFsPath, relativizePath, resolveToursFolder, resolveTourPath, tourFileName } from '../paths';

const root = path.resolve('/work/mono');
const other = path.resolve('/work/other');

suite('paths', () => {
  test('relative to the single workspace folder, with forward slashes', () => {
    const file = path.join(root, 'packages', 'core', 'a.ts');
    assert.strictEqual(relativizePath(file, [{ name: 'mono', fsPath: root }]), 'packages/core/a.ts');
  });

  test('multi-root paths are prefixed with the folder name and resolve back', () => {
    const folders = [
      { name: 'mono', fsPath: root },
      { name: 'other', fsPath: other },
    ];
    const file = path.join(other, 'src', 'b.ts');
    const rel = relativizePath(file, folders);
    assert.strictEqual(rel, 'other/src/b.ts');
    assert.strictEqual(resolveTourPath(rel, folders), file);
  });

  test('files outside every folder are exported as absolute paths', () => {
    const file = path.resolve('/elsewhere/c.ts');
    const rel = relativizePath(file, [{ name: 'mono', fsPath: root }]);
    assert.ok(path.isAbsolute(rel));
    assert.strictEqual(resolveTourPath(rel, [{ name: 'mono', fsPath: root }]), file);
  });

  test('relative paths resolve against the first folder', () => {
    const folders = [{ name: 'mono', fsPath: root }];
    assert.strictEqual(resolveTourPath('./src/a.ts', folders), path.join(root, 'src', 'a.ts'));
    assert.strictEqual(resolveTourPath('src\\a.ts', folders), path.join(root, 'src', 'a.ts'));
  });

  test('relative paths need a workspace folder', () => {
    assert.strictEqual(resolveTourPath('src/a.ts', []), undefined);
  });

  test('normalizeFsPath is case-insensitive only where the filesystem is', () => {
    assert.strictEqual(normalizeFsPath('/A/b.ts', 'darwin'), normalizeFsPath('/a/B.ts', 'darwin'));
    assert.notStrictEqual(normalizeFsPath('/A/b.ts', 'linux'), normalizeFsPath('/a/B.ts', 'linux'));
  });
});

suite('paths: saved tours', () => {
  const folders = [{ name: 'mono', fsPath: root }];

  test('the tours folder defaults to .minuet in the first workspace folder', () => {
    assert.strictEqual(resolveToursFolder(undefined, folders), path.join(root, '.minuet'));
    assert.strictEqual(resolveToursFolder('  ', folders), path.join(root, '.minuet'));
    assert.strictEqual(resolveToursFolder('docs/tours', folders), path.join(root, 'docs', 'tours'));
  });

  test('an absolute tours folder is used as is; a relative one needs an open folder', () => {
    assert.strictEqual(resolveToursFolder(other, folders), other);
    assert.strictEqual(resolveToursFolder('.minuet', []), undefined);
  });

  test('only files directly inside the folder belong to it', () => {
    const folder = path.join(root, '.minuet');
    assert.ok(isDirectlyIn(path.join(folder, 'a.tour.json'), folder));
    assert.ok(!isDirectlyIn(path.join(folder, 'sub', 'a.tour.json'), folder));
    assert.ok(!isDirectlyIn(path.join(root, 'a.tour.json'), folder));
  });

  test('file names come from the title', () => {
    assert.strictEqual(tourFileName('How the order confirmation email is built'), 'how-the-order-confirmation-email-is-built');
    assert.strictEqual(tourFileName('  Cómo se arma el envío — v2!  '), 'como-se-arma-el-envio-v2');
    assert.strictEqual(tourFileName('???'), 'tour');
    assert.ok(tourFileName('x'.repeat(100)).length <= 60);
  });
});
