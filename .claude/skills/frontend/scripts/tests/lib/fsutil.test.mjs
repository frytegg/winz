// @ts-check
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { UsageError } from '../../lib/errors.mjs';
import {
  DEFAULT_EXCLUDES, compileGlob, matchGlob, readText, sha256File, sha256Text, toPosix, walk, writeText,
} from '../../lib/fsutil.mjs';

const BOM = String.fromCharCode(0xfeff);
/** @type {string} */
let tmp;

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-fsutil-'));
  const files = [
    'index.html', 'README.md', 'src/App.tsx', 'src/main.ts', 'src/util/a.js', 'src/util/b.mjs', 'src/legacy/old.js',
    'src/style.css', 'public/logo.svg', 'docs/guide/intro.md',
    'node_modules/react/index.js', 'deep/node_modules/x/y.js', '.git/HEAD', 'dist/app.js', 'build/x.js', 'out/x.js',
    '.next/x.js', 'coverage/x.js', '.execution/frontend/brief.json', '.frontend/brief.json', 'vendor/lib.js',
  ];
  for (const rel of files) {
    mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    writeFileSync(path.join(tmp, rel), `${rel}\n`);
  }
});

after(() => rmSync(tmp, { recursive: true, force: true }));

test('glob: * stays in one segment, ** spans segments, ? is one character', () => {
  assert.equal(matchGlob('src/*.tsx', 'src/App.tsx'), true);
  assert.equal(matchGlob('src/*.tsx', 'src/a/App.tsx'), false);
  assert.equal(matchGlob('src/**/*.js', 'src/a.js'), true, '** matches zero segments');
  assert.equal(matchGlob('src/**/*.js', 'src/a/b/c.js'), true);
  assert.equal(matchGlob('**/*.js', 'a.js'), true);
  assert.equal(matchGlob('**', 'any/thing/at/all'), true);
  assert.equal(matchGlob('src/**', 'src'), true, 'a trailing /** also matches the folder itself');
  assert.equal(matchGlob('src/**', 'src/x/y'), true);
  assert.equal(matchGlob('src/**', 'srcx/y'), false);
  assert.equal(matchGlob('file?.txt', 'file1.txt'), true);
  assert.equal(matchGlob('file?.txt', 'file12.txt'), false);
  assert.equal(matchGlob('a/**/b', 'a/b'), true);
  assert.equal(matchGlob('a/**/b', 'a/x/y/b'), true);
  assert.equal(matchGlob('a/**/b', 'a/xb'), false);
});

test('glob: braces expand, nest, and stay literal without a comma', () => {
  assert.equal(matchGlob('*.{ts,tsx}', 'x.ts'), true);
  assert.equal(matchGlob('*.{ts,tsx}', 'x.tsx'), true);
  assert.equal(matchGlob('*.{ts,tsx}', 'x.js'), false);
  assert.equal(matchGlob('{src,lib}/**/*.{js,{m,c}js}', 'lib/a/b.cjs'), true);
  assert.equal(matchGlob('{src,lib}/**/*.{js,{m,c}js}', 'app/a.mjs'), false);
  assert.equal(matchGlob('{a}.txt', '{a}.txt'), true);
  assert.equal(matchGlob('{a,b.txt', '{a,b.txt'), true, 'unbalanced braces are literal');
});

test('glob: a pattern without a slash matches the base name at any depth', () => {
  assert.equal(matchGlob('*.min.js', 'public/js/vendor.min.js'), true);
  assert.equal(matchGlob('node_modules', 'a/b/node_modules'), true);
  assert.equal(matchGlob('node_modules', 'a/b/node_modulesx'), false);
  assert.equal(matchGlob('/src/*.ts', 'src/a.ts'), true, 'a leading slash anchors at the root');
  assert.equal(matchGlob('./src/*.ts', 'src/a.ts'), true);
  assert.equal(matchGlob('dist/', 'x/dist'), true, 'a trailing slash is dropped');
});

test('glob: regex metacharacters are literal and backslashes are separators', () => {
  assert.equal(matchGlob('a+b(1).[x]', 'a+b(1).[x]'), true);
  assert.equal(matchGlob('a+b(1).[x]', 'aab(1)x[x]'), false);
  assert.equal(compileGlob(String.raw`src\*.ts`)('src/a.ts'), true);
  assert.equal(compileGlob('*.TSX', { nocase: true })('a.tsx'), true);
  assert.equal(compileGlob('*.TSX')('a.tsx'), false);
  assert.throws(() => compileGlob(''), TypeError);
});

test('walk lists sorted POSIX paths and skips the default folders at any depth', () => {
  const files = walk(tmp);
  assert.deepEqual(files, [...files].sort());
  assert.ok(files.includes('src/util/a.js'));
  assert.ok(files.every((f) => !f.includes('\\')));
  for (const dir of DEFAULT_EXCLUDES) {
    assert.ok(!files.some((f) => f.split('/').includes(dir)), `${dir} is excluded`);
  }
  assert.ok(!files.includes('deep/node_modules/x/y.js'));
  assert.deepEqual(DEFAULT_EXCLUDES, ['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', '.execution', '.frontend', 'vendor', '.venv', 'venv', 'site-packages', '__pycache__', '.yarn']);
});

test('walk include keeps matching files; exclude prunes folders and adds to the defaults', () => {
  assert.deepEqual(walk(tmp, { include: '*.{js,mjs}' }), ['src/legacy/old.js', 'src/util/a.js', 'src/util/b.mjs']);
  assert.deepEqual(walk(tmp, { include: ['*.{js,mjs}'], exclude: ['src/legacy/**'] }), ['src/util/a.js', 'src/util/b.mjs']);
  assert.deepEqual(walk(tmp, { include: 'src/*' }), ['src/App.tsx', 'src/main.ts', 'src/style.css']);
  const all = walk(tmp, { include: '*.js', defaultExcludes: false });
  assert.ok(all.includes('node_modules/react/index.js') && all.includes('vendor/lib.js'));
});

test('walk does not follow symbolic links', (t) => {
  const link = path.join(tmp, 'linked');
  try {
    symlinkSync(path.join(tmp, 'src'), link, 'junction');
  } catch (err) {
    t.skip(`cannot create a link here: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  try {
    assert.ok(!walk(tmp).some((f) => f.startsWith('linked/')));
  } finally {
    rmSync(link, { recursive: true, force: true });
  }
});

test('walk refuses a missing folder or a file with a UsageError', () => {
  assert.throws(() => walk(path.join(tmp, 'nope')), UsageError);
  assert.throws(() => walk(path.join(tmp, 'index.html')), UsageError);
});

test('readText strips a byte-order mark; a missing file is a UsageError', () => {
  const file = path.join(tmp, 'bom.txt');
  writeFileSync(file, `${BOM}hello`, 'utf8');
  assert.equal(readText(file), 'hello');
  assert.throws(() => readText(path.join(tmp, 'missing.txt')), (err) => err instanceof UsageError && /file not found/.test(err.message));
  assert.throws(() => readText(path.join(tmp, 'src')), UsageError);
});

test('writeText writes UTF-8 with LF only, no BOM, creating folders', () => {
  const file = path.join(tmp, 'new', 'deep', 'out.md');
  const returned = writeText(file, `${BOM}a\r\nb\rc\n`);
  assert.equal(returned, toPosix(path.resolve(file)));
  const bytes = readFileSync(file);
  assert.equal(bytes.toString('utf8'), 'a\nb\nc\n');
  assert.ok(!bytes.includes(13), 'no CR byte');
  assert.notEqual(bytes[0], 0xef, 'no BOM');
});

test('sha256File and sha256Text give the standard digests', () => {
  const file = path.join(tmp, 'abc.txt');
  writeFileSync(file, 'abc');
  const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(sha256File(file), abc);
  assert.equal(sha256Text('abc'), abc);
  const big = path.join(tmp, 'big.bin');
  writeFileSync(big, Buffer.alloc(3 * 1024 * 1024 + 7, 7));
  assert.match(sha256File(big), /^[0-9a-f]{64}$/);
  assert.throws(() => sha256File(path.join(tmp, 'missing.bin')), UsageError);
});
