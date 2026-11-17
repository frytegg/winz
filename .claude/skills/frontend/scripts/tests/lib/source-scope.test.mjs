// @ts-check
/**
 * What the static tells layer reads (rules/load.mjs sourceFiles): the project's own UI source only. A Python virtual
 * environment, Yarn's checked-in release, a git-ignored docs site, a nested repository (a submodule) and paths
 * outside profile paths.ui are never judged as the UI.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { defaultProfile } from '../../lib/profile.mjs';
import { gitVisibleFiles, nestedRepoTest, sourceFiles, uiScope } from '../../rules/load.mjs';

const tmp = mkdtempSync(path.join(process.env.FRONTEND_TEST_TMP || os.tmpdir(), 'fe-source-scope-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * @param {string} root
 * @param {Record<string, string>} files
 */
function write(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
}

const TELL = 'export const C = () => "background: linear-gradient(90deg, #7c3aed, #2563eb)";\n';

test('uiScope: the named paths, what is under them and the package.json files on the way down', () => {
  const scope = uiScope(['packages/web']);
  assert.equal(scope('packages/web/src/App.tsx'), true);
  assert.equal(scope('packages/web'), true);
  assert.equal(scope('packages/web/package.json'), true);
  assert.equal(scope('packages/package.json'), true);
  assert.equal(scope('package.json'), true);
  assert.equal(scope('packages/sources/src/pools.ts'), false);
  assert.equal(scope('packages/webapp/x.ts'), false, 'a sibling with the same prefix is outside');
  assert.equal(uiScope(null)('anything.ts'), true);
});

test('sourceFiles leaves out virtual environments, Yarn releases and nested repositories, and honours paths.ui', () => {
  const root = path.join(tmp, 'plain');
  write(root, {
    'src/App.tsx': TELL,
    'quant/.venv/Lib/site-packages/notebook/static/core.js': TELL,
    'tools/venv/lib/site-packages/x.js': TELL,
    '.yarn/releases/yarn-3.2.3.cjs': TELL,
    'packages/contracts/lib/solady/.git': 'gitdir: ../../../../.git/modules/solady\n',
    'packages/contracts/lib/solady/docs/index.html': '<!doctype html><title>x</title>',
    'packages/sources/src/pools.ts': TELL,
  });
  const all = sourceFiles(root, defaultProfile()).map((f) => f.path);
  assert.deepEqual(all, ['packages/sources/src/pools.ts', 'src/App.tsx']);
  const narrowed = sourceFiles(root, defaultProfile({ paths: { ui: ['src'] } })).map((f) => f.path);
  assert.deepEqual(narrowed, ['src/App.tsx']);
  assert.deepEqual(sourceFiles(root, defaultProfile(), { paths: ['packages/sources'] }).map((f) => f.path), ['packages/sources/src/pools.ts'], 'options.paths replaces the profile');
  const nested = nestedRepoTest(root);
  assert.equal(nested('packages/contracts/lib/solady/docs/index.html'), true);
  assert.equal(nested('packages/contracts/src/x.ts'), false);
});

test('inside a git work tree only git-visible files are read; a root git lists nothing about is walked whole', { skip: spawnSync('git', ['--version']).status !== 0 && 'git is not installed' }, () => {
  const root = path.join(tmp, 'repo');
  write(root, {
    '.gitignore': 'documentation/site/\nreference/probes/_sandbox/\n',
    'src/App.tsx': TELL,
    'documentation/site/index.html': '<!doctype html><title>docs</title>',
    'reference/probes/_sandbox/p1-gate/saved.html': '<!doctype html><title>saved</title>',
  });
  assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
  const visible = gitVisibleFiles(root);
  assert.ok(visible && visible.has('src/App.tsx') && !visible.has('documentation/site/index.html'));
  assert.deepEqual(sourceFiles(root, defaultProfile()).map((f) => f.path), ['src/App.tsx']);
  const ignoredRoot = path.join(root, 'documentation', 'site');
  assert.equal(gitVisibleFiles(ignoredRoot), null, 'a root inside an ignored folder is not described by the enclosing repository');
  assert.deepEqual(sourceFiles(ignoredRoot, defaultProfile()).map((f) => f.path), ['index.html']);
});
