// @ts-check
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EnvError, UsageError } from './errors.mjs';
import { toPosix } from './fsutil.mjs';

/** @typedef {import('./profile.mjs').Profile} Profile */

const MODE_B_PATTERN = '.frontend/';

/**
 * The state folder (section 6.3), created if needed, as an absolute path with forward slashes.
 * - `override` (the `--state <dir>` flag, for example `<workspace.private_dir>/frontend/` before T0) wins.
 * - Mode A: `<root>/.execution/frontend`, inside /execution's private state repository, which must already exist
 *   (EnvError otherwise: creating `.execution` here would leave an untracked folder in the product repository).
 * - Mode B: `<root>/.frontend`, and `.frontend/` is appended once to the `info/exclude` of the git repository
 *   whose work tree holds the root, so the state never shows as untracked (worktrees and submodules, whose `.git` is
 *   a file, are followed to their git dir). A `.git` folder that is not a repository (no HEAD, objects or refs, such
 *   as a stray `~/.git/info/`) is skipped as git itself skips it; outside any repository nothing is excluded.
 * A root that is not an existing folder is a UsageError (a mistyped --root is never created).
 * @param {string} root
 * @param {Pick<Profile, 'run_mode'>} profile
 * @param {string | null} [override]
 * @returns {string}
 */
export function stateDir(root, profile, override) {
  if (override) {
    const dir = path.resolve(override);
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      throw new UsageError(`--state ${toPosix(dir)} cannot be created as a folder; pass a folder path`, { cause: err });
    }
    return toPosix(dir);
  }
  const base = path.resolve(root);
  if (!isDirectory(base)) throw new UsageError(`--root ${toPosix(base)} is not an existing folder; pass the repository root`);
  if (profile.run_mode === 'A') {
    const stateRepo = path.join(base, '.execution');
    if (!isDirectory(stateRepo)) {
      throw new EnvError(
        `mode A expects /execution's state repository at ${toPosix(stateRepo)}; run /execution's bootstrap first, ` +
          'or pass --state <dir> (for example <workspace.private_dir>/frontend before T0)',
      );
    }
    const dir = path.join(stateRepo, 'frontend');
    mkdirSync(dir, { recursive: true });
    return toPosix(dir);
  }
  const dir = path.join(base, '.frontend');
  mkdirSync(dir, { recursive: true });
  const exclude = gitExcludeFile(base);
  if (exclude) ensureExcluded(exclude, MODE_B_PATTERN);
  return toPosix(dir);
}

/**
 * Where stateDir() puts the state, without creating, checking or excluding anything: the override, else
 * `<root>/.execution/frontend` in mode A, else `<root>/.frontend`. For runs that must leave the state untouched
 * (frontend-check with --out, CONTRACTS section 4) and for dry runs; the folder may not exist.
 * @param {string} root
 * @param {Pick<Profile, 'run_mode'>} profile
 * @param {string | null} [override]
 * @returns {string}
 */
export function statePath(root, profile, override) {
  if (override) return toPosix(path.resolve(override));
  const base = path.resolve(root);
  return toPosix(profile.run_mode === 'A' ? path.join(base, '.execution', 'frontend') : path.join(base, '.frontend'));
}

/**
 * The state folder of a check CLI (Q-F14): given `--out`, only resolved (statePath: nothing created, written or
 * excluded, every output goes under --out), else created as stateDir does. A root that is not an existing folder is a
 * UsageError either way.
 * @param {string} root
 * @param {Pick<Profile, 'run_mode'>} profile
 * @param {string | null | undefined} override `--state`
 * @param {string | null | undefined} out `--out`
 * @returns {string}
 */
export function checkStateDir(root, profile, override, out) {
  if (!out) return stateDir(root, profile, override);
  const base = path.resolve(root);
  if (!isDirectory(base)) throw new UsageError(`--root ${toPosix(base)} is not an existing folder; pass the repository root`);
  return statePath(root, profile, override);
}

/**
 * The design folder in the product repository: `<root>/design` unless `profile.paths.design` names another folder
 * (relative to the root, or absolute). Not created: the gates check that it exists.
 * @param {string} root
 * @param {{paths?: {design?: string}}} profile
 * @returns {string}
 */
export function designDir(root, profile) {
  const design = profile?.paths?.design || 'design';
  return toPosix(path.resolve(root, design));
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The `info/exclude` file of the git repository whose work tree contains `start`, or null outside a repository.
 * Walks up as git's own discovery does: a `.git` folder counts only when it is a git dir (HEAD, objects and refs), a
 * `.git` file only when its `gitdir:` names one; anything else (a stray `.git/info/` in a home folder, a broken
 * gitdir pointer) is skipped and the walk goes on, so the exclude file of a non-repository is never written.
 * @param {string} start
 * @returns {string | null}
 */
export function gitExcludeFile(start) {
  let dir = path.resolve(start);
  for (;;) {
    const gitDir = resolveGitDir(path.join(dir, '.git'));
    if (gitDir) return path.join(commonDir(gitDir), 'info', 'exclude');
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The git dir a `.git` entry stands for, or null when it is missing or not a repository.
 * @param {string} dotGit a `.git` folder, or a `.git` file holding `gitdir: <path>`
 * @returns {string | null}
 */
function resolveGitDir(dotGit) {
  /** @type {import('node:fs').Stats} */
  let st;
  try {
    st = statSync(dotGit);
  } catch {
    return null;
  }
  if (st.isDirectory()) return isGitDir(dotGit) ? dotGit : null;
  if (!st.isFile()) return null;
  let text = '';
  try {
    text = readFileSync(dotGit, 'utf8');
  } catch {
    return null;
  }
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(text);
  if (!match) return null;
  const gitDir = path.resolve(path.dirname(dotGit), match[1]);
  return isGitDir(gitDir) ? gitDir : null;
}

/**
 * Git's own test for a repository: a HEAD file, and objects/ and refs/ folders in the common dir (a linked
 * worktree's git dir holds HEAD and a `commondir` pointer to them).
 * @param {string} gitDir
 * @returns {boolean}
 */
function isGitDir(gitDir) {
  if (!isFile(path.join(gitDir, 'HEAD'))) return false;
  const common = commonDir(gitDir);
  return isDirectory(path.join(common, 'objects')) && isDirectory(path.join(common, 'refs'));
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * A linked worktree's git dir names the shared repository in `commondir`; `info/exclude` lives there.
 * @param {string} gitDir
 * @returns {string}
 */
function commonDir(gitDir) {
  const file = path.join(gitDir, 'commondir');
  if (!existsSync(file)) return gitDir;
  return path.resolve(gitDir, readFileSync(file, 'utf8').trim());
}

/**
 * Appends `pattern` to an exclude file unless an equivalent line is already there.
 * @param {string} file
 * @param {string} pattern a folder pattern such as `.frontend/`
 * @returns {boolean} true when the line was added
 */
export function ensureExcluded(file, pattern) {
  const bare = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
  const equivalents = new Set([bare, `${bare}/`, `/${bare}`, `/${bare}/`]);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current.split(/\r?\n/).some((line) => equivalents.has(line.trim()))) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  const separator = current === '' || current.endsWith('\n') ? '' : '\n';
  writeFileSync(file, `${current}${separator}${pattern}\n`, 'utf8');
  return true;
}
