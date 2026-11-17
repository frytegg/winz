// @ts-check
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { EnvError, UsageError } from '../../lib/errors.mjs';
import { checkStateDir, designDir, ensureExcluded, gitExcludeFile, stateDir, statePath } from '../../lib/paths.mjs';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-paths-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const posix = (/** @type {string} */ p) => p.replace(/\\/g, '/');

/** @param {string} gitDir a folder made into the smallest git dir git itself accepts (HEAD, objects, refs) */
function gitDirAt(gitDir) {
  mkdirSync(path.join(gitDir, 'objects'), { recursive: true });
  mkdirSync(path.join(gitDir, 'refs'), { recursive: true });
  mkdirSync(path.join(gitDir, 'info'), { recursive: true });
  writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
}

/** @param {string} name @returns {string} a fresh repository with a .git folder */
function repo(name) {
  const root = path.join(tmp, name);
  gitDirAt(path.join(root, '.git'));
  return root;
}

test('mode B: <root>/.frontend is created and .frontend/ is excluded exactly once', () => {
  const root = repo('b');
  const dir = stateDir(root, { run_mode: 'B' });
  assert.equal(dir, posix(path.join(root, '.frontend')));
  assert.ok(statSync(dir).isDirectory());
  stateDir(root, { run_mode: 'B' });
  const exclude = readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8');
  assert.equal(exclude, '.frontend/\n');
});

test('mode B keeps existing exclude lines and recognises an equivalent pattern', () => {
  const root = repo('b2');
  const file = path.join(root, '.git', 'info', 'exclude');
  writeFileSync(file, '# git ls-files --others --exclude-from=.git/info/exclude\n*.log');
  stateDir(root, { run_mode: 'B' });
  assert.equal(readFileSync(file, 'utf8'), '# git ls-files --others --exclude-from=.git/info/exclude\n*.log\n.frontend/\n');
  const root2 = repo('b3');
  const file2 = path.join(root2, '.git', 'info', 'exclude');
  writeFileSync(file2, '/.frontend\n');
  stateDir(root2, { run_mode: 'B' });
  assert.equal(readFileSync(file2, 'utf8'), '/.frontend\n', 'an equivalent line is not duplicated');
});

test('mode A: <root>/.execution/frontend inside the existing state repository, and no exclude edit', () => {
  const root = repo('a');
  mkdirSync(path.join(root, '.execution'));
  const dir = stateDir(root, { run_mode: 'A' });
  assert.equal(dir, posix(path.join(root, '.execution', 'frontend')));
  assert.ok(existsSync(dir));
  assert.ok(!existsSync(path.join(root, '.git', 'info', 'exclude')));
});

test('mode A without /execution\'s state repository is an EnvError, and nothing is created', () => {
  const root = repo('a-missing');
  assert.throws(() => stateDir(root, { run_mode: 'A' }), (err) => err instanceof EnvError && /run \/execution's bootstrap first, or pass --state/.test(err.message));
  assert.ok(!existsSync(path.join(root, '.execution')));
});

test('a root that does not exist is a UsageError and is never created', () => {
  const root = path.join(tmp, 'typo', 'repo');
  assert.throws(() => stateDir(root, { run_mode: 'B' }), (err) => err instanceof UsageError && /is not an existing folder/.test(err.message));
  assert.ok(!existsSync(path.join(tmp, 'typo')));
});

test('an override that cannot be a folder is a UsageError', () => {
  const file = path.join(tmp, 'a-file');
  writeFileSync(file, 'x');
  assert.throws(() => stateDir(tmp, { run_mode: 'B' }, path.join(file, 'state')), UsageError);
});

test('an override (--state) wins and is created as given', () => {
  const root = repo('o');
  const target = path.join(tmp, 'private', 'frontend');
  assert.equal(stateDir(root, { run_mode: 'B' }, target), posix(target));
  assert.ok(existsSync(target));
  assert.ok(!existsSync(path.join(root, '.frontend')));
});

test('outside a git repository, mode B still works', () => {
  const root = path.join(tmp, 'plain', 'project');
  mkdirSync(root, { recursive: true });
  if (gitExcludeFile(root) !== null) return;
  assert.equal(stateDir(root, { run_mode: 'B' }), posix(path.join(root, '.frontend')));
});

test('a worktree or submodule .git file is followed to its git dir and common dir', () => {
  const main = repo('main');
  const worktreeGitDir = path.join(main, '.git', 'worktrees', 'wt');
  mkdirSync(worktreeGitDir, { recursive: true });
  writeFileSync(path.join(worktreeGitDir, 'HEAD'), 'ref: refs/heads/wt\n');
  writeFileSync(path.join(worktreeGitDir, 'commondir'), '../..\n');
  const wt = path.join(tmp, 'wt');
  mkdirSync(wt, { recursive: true });
  writeFileSync(path.join(wt, '.git'), `gitdir: ${worktreeGitDir}\n`);
  assert.equal(gitExcludeFile(wt), path.join(main, '.git', 'info', 'exclude'));
  stateDir(wt, { run_mode: 'B' });
  assert.equal(readFileSync(path.join(main, '.git', 'info', 'exclude'), 'utf8'), '.frontend/\n');

  const sub = path.join(main, 'packages', 'sub');
  const subGitDir = path.join(main, '.git', 'modules', 'sub');
  mkdirSync(sub, { recursive: true });
  gitDirAt(subGitDir);
  writeFileSync(path.join(sub, '.git'), 'gitdir: ../../.git/modules/sub\n');
  assert.equal(gitExcludeFile(sub), path.join(subGitDir, 'info', 'exclude'));
});

test('gitExcludeFile walks up from a subfolder of the repository', () => {
  const root = repo('up');
  const deep = path.join(root, 'apps', 'web');
  mkdirSync(deep, { recursive: true });
  assert.equal(gitExcludeFile(deep), path.join(root, '.git', 'info', 'exclude'));
});

test('a .git folder that is not a repository is skipped: its exclude file is never written', () => {
  // The home folder of this machine once held a stray .git/ with only info/ in it, and stateDir appended to it.
  const home = path.join(tmp, 'stray-home');
  mkdirSync(path.join(home, '.git', 'info'), { recursive: true });
  const strayExclude = path.join(home, '.git', 'info', 'exclude');
  writeFileSync(strayExclude, '# stray\n');
  const project = path.join(home, 'scratch', 'project');
  mkdirSync(project, { recursive: true });
  const outer = gitExcludeFile(home);
  assert.notEqual(outer, strayExclude, 'the stray folder is not taken for a repository');
  assert.equal(gitExcludeFile(project), outer, 'the walk goes past the stray folder, as git discovery does');
  stateDir(project, { run_mode: 'B' });
  assert.equal(readFileSync(strayExclude, 'utf8'), '# stray\n', 'the stray exclude file is untouched');
  assert.ok(existsSync(path.join(project, '.frontend')));
});

test('a .git file whose gitdir is not a repository is skipped too', () => {
  const root = path.join(tmp, 'broken-pointer');
  mkdirSync(path.join(tmp, 'not-a-gitdir', 'info'), { recursive: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, '.git'), `gitdir: ${path.join(tmp, 'not-a-gitdir')}\n`);
  assert.notEqual(gitExcludeFile(root), path.join(tmp, 'not-a-gitdir', 'info', 'exclude'));
});

test('a repository inside a stray .git home still gets its own exclude line', () => {
  const home = path.join(tmp, 'stray-home-2');
  mkdirSync(path.join(home, '.git', 'info'), { recursive: true });
  const root = path.join(home, 'code', 'app');
  gitDirAt(path.join(root, '.git'));
  stateDir(root, { run_mode: 'B' });
  assert.equal(readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8'), '.frontend/\n');
  assert.ok(!existsSync(path.join(home, '.git', 'info', 'exclude')));
});

test('statePath resolves the state folder without creating, checking or excluding anything', () => {
  const root = repo('sp');
  assert.equal(statePath(root, { run_mode: 'B' }), posix(path.join(root, '.frontend')));
  assert.equal(statePath(root, { run_mode: 'A' }), posix(path.join(root, '.execution', 'frontend')));
  const override = path.join(tmp, 'sp-override', 'state');
  assert.equal(statePath(root, { run_mode: 'B' }, override), posix(override));
  assert.ok(!existsSync(path.join(root, '.frontend')));
  assert.ok(!existsSync(path.join(root, '.execution')));
  assert.ok(!existsSync(override));
  assert.ok(!existsSync(path.join(root, '.git', 'info', 'exclude')));
});

test('ensureExcluded reports whether it added the line', () => {
  const file = path.join(tmp, 'exclude-test', 'exclude');
  assert.equal(ensureExcluded(file, '.frontend/'), true);
  assert.equal(ensureExcluded(file, '.frontend/'), false);
  assert.equal(readFileSync(file, 'utf8'), '.frontend/\n');
});

test('designDir: <root>/design by default, profile.paths.design relative or absolute', () => {
  const root = path.join(tmp, 'd');
  assert.equal(designDir(root, {}), posix(path.join(root, 'design')));
  assert.equal(designDir(root, { paths: { design: 'ui/design' } }), posix(path.join(root, 'ui', 'design')));
  const abs = path.join(tmp, 'elsewhere');
  assert.equal(designDir(root, { paths: { design: abs } }), posix(abs));
  assert.ok(!existsSync(path.join(root, 'design')), 'designDir never creates the folder');
});

test('checkStateDir: with --out the state is only resolved, without it created as stateDir does', () => {
  const root = mkdtempSync(path.join(tmp, 'check-state-'));
  gitDirAt(path.join(root, '.git'));
  const resolved = checkStateDir(root, { run_mode: 'B' }, null, path.join(tmp, 'out'));
  assert.equal(resolved, posix(path.join(root, '.frontend')));
  assert.equal(existsSync(path.join(root, '.frontend')), false, 'nothing is created under --out');
  assert.equal(existsSync(path.join(root, '.git', 'info', 'exclude')), false, 'no exclude line is added under --out');
  assert.throws(() => checkStateDir(path.join(root, 'missing'), { run_mode: 'B' }, null, path.join(tmp, 'out')), UsageError);
  assert.equal(checkStateDir(root, { run_mode: 'B' }, null, null), posix(path.join(root, '.frontend')));
  assert.equal(statSync(path.join(root, '.frontend')).isDirectory(), true, 'without --out the folder is created');
});
