// @ts-check
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPTS = fileURLToPath(new URL('../../', import.meta.url));
export const CRITIQUE = path.join(SCRIPTS, 'critique.mjs');
export const FIXTURES = path.join(SCRIPTS, 'tests', 'fixtures', 'critique');

/**
 * A fresh temporary folder under FRONTEND_TEST_TMP (when set) or the OS temp folder.
 * @param {string} prefix
 * @returns {string}
 */
export function tempDir(prefix) {
  const base = process.env.FRONTEND_TEST_TMP || os.tmpdir();
  mkdirSync(base, { recursive: true });
  return mkdtempSync(path.join(base, prefix));
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
export function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * A git repository whose app/src holds `site` and whose app/dist (ignored) is a copy of it, as a build would leave it.
 * @param {string} site folder holding index.html
 * @returns {{root: string, dist: string, sha: string, appTree: string}}
 */
export function gitRepoWithSite(site) {
  const root = tempDir('fe-critique-repo-');
  cpSync(site, path.join(root, 'app', 'src'), { recursive: true });
  cpSync(site, path.join(root, 'app', 'dist'), { recursive: true });
  writeFileSync(path.join(root, 'app', '.gitignore'), 'dist/\n');
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  return { root, dist: path.join(root, 'app', 'dist'), sha: git(root, ['rev-parse', 'HEAD']), appTree: git(root, ['rev-parse', 'HEAD:app']) };
}

/**
 * A state folder holding the fixture brief.
 * @returns {string}
 */
export function stateWithBrief() {
  const state = tempDir('fe-critique-state-');
  cpSync(path.join(FIXTURES, 'state', 'brief.json'), path.join(state, 'brief.json'));
  return state;
}

/**
 * Runs critique.mjs in a child process.
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 * @returns {{status: number | null, stdout: string, stderr: string, json: any}}
 */
export function runCli(args, env = {}) {
  const res = spawnSync(process.execPath, [CRITIQUE, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 180000 });
  /** @type {any} */
  let json = null;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    json = null;
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

/**
 * Width and height of a PNG file, from its IHDR chunk.
 * @param {string} file
 * @returns {{width: number, height: number}}
 */
export function pngSize(file) {
  const b = readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} is not a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/**
 * @param {string} file
 * @param {unknown} value
 */
export function writeJsonFile(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
