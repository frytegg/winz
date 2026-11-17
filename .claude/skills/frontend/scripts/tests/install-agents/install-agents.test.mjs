// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EnvError } from '../../lib/errors.mjs';
import { AGENTS, TEMPLATE_DIR, compareAgents, installAgents, resolveAgentsDir } from '../../install-agents.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '..', '..', 'install-agents.mjs');
const FIXTURES = path.resolve(HERE, '..', 'fixtures', 'install-agents');
const SCRATCH = mkdtempSync(path.join(os.tmpdir(), 'frontend-install-agents-'));

after(() => rmSync(SCRATCH, { recursive: true, force: true }));

let counter = 0;
/** A fresh, empty home folder under the test's scratch directory. */
function freshHome() {
  counter += 1;
  const home = path.join(SCRATCH, `home-${counter}`);
  mkdirSync(home, { recursive: true });
  return home;
}

/**
 * Runs the CLI with a sandboxed environment: HOME, USERPROFILE and CLAUDE_CONFIG_DIR never point at the real ones.
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
function cli(args, env = {}) {
  const sandbox = path.join(SCRATCH, 'sandbox-home');
  mkdirSync(sandbox, { recursive: true });
  /** @type {NodeJS.ProcessEnv} */
  const base = { ...process.env, HOME: sandbox, USERPROFILE: sandbox };
  delete base.CLAUDE_CONFIG_DIR;
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...base, ...env } });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

/**
 * @param {string} home
 * @param {string} name
 */
const installed = (home, name) => path.join(home, '.claude', 'agents', `${name}.md`);
/** @param {string} name */
const template = (name) => readFileSync(path.join(TEMPLATE_DIR, `${name}.md`));

describe('install-agents.mjs', () => {
  test('ships exactly the two read-only agents', () => {
    assert.deepEqual([...AGENTS], ['frontend-critic', 'frontend-probe']);
    for (const name of AGENTS) assert.ok(existsSync(path.join(TEMPLATE_DIR, `${name}.md`)));
  });

  test('agents folder precedence: --agents-dir, --home, CLAUDE_CONFIG_DIR, then the user home', () => {
    const env = { CLAUDE_CONFIG_DIR: path.join(SCRATCH, 'cfg') };
    assert.equal(resolveAgentsDir({ agentsDir: path.join(SCRATCH, 'x'), home: path.join(SCRATCH, 'h'), env }), path.join(SCRATCH, 'x'));
    assert.equal(resolveAgentsDir({ home: path.join(SCRATCH, 'h'), env }), path.join(SCRATCH, 'h', '.claude', 'agents'));
    assert.equal(resolveAgentsDir({ env }), path.join(SCRATCH, 'cfg', 'agents'));
    assert.equal(resolveAgentsDir({ env: {} }), path.join(os.homedir(), '.claude', 'agents'));
  });

  test('installs both files byte for byte, then --check passes and a second install changes nothing', () => {
    const home = freshHome();
    const first = cli(['--home', home, '--json']);
    assert.equal(first.code, 0, first.stderr);
    const report = JSON.parse(first.stdout);
    assert.equal(report.ok, true);
    assert.deepEqual(report.results.map((/** @type {any} */ r) => r.action), ['installed', 'installed']);
    assert.equal(report.restartNeeded, true, 'a new agents folder needs a new session');
    for (const name of AGENTS) assert.ok(readFileSync(installed(home, name)).equals(template(name)), `${name} copied exactly`);
    assert.match(first.stderr, /start a new Claude Code session/);
    const check = cli(['--check', '--home', home]);
    assert.equal(check.code, 0, check.stderr);
    const again = cli(['--home', home, '--json']);
    assert.equal(again.code, 0);
    assert.deepEqual(JSON.parse(again.stdout).results.map((/** @type {any} */ r) => r.action), ['unchanged', 'unchanged']);
  });

  test('--check fails on a missing or a different file and writes nothing', () => {
    const home = freshHome();
    const missing = cli(['--check', '--home', home]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /frontend-critic: not installed/);
    assert.ok(!existsSync(path.join(home, '.claude')), '--check created nothing');
    assert.equal(cli(['--home', home]).code, 0);
    writeFileSync(installed(home, 'frontend-probe'), readFileSync(path.join(FIXTURES, 'edited-probe.md')));
    const different = cli(['--check', '--home', home, '--json']);
    assert.equal(different.code, 1);
    const report = JSON.parse(different.stdout);
    assert.deepEqual(report.results.map((/** @type {any} */ r) => r.status), ['same', 'different']);
  });

  test('a different installed file is never overwritten without --force; --force keeps a .md.bak', () => {
    const home = freshHome();
    assert.equal(cli(['--home', home]).code, 0);
    const edited = readFileSync(path.join(FIXTURES, 'edited-probe.md'));
    writeFileSync(installed(home, 'frontend-probe'), edited);
    const refused = cli(['--home', home]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /frontend-probe: differs from its template; not replaced/);
    assert.ok(readFileSync(installed(home, 'frontend-probe')).equals(edited), 'the edited file is untouched');
    const dry = cli(['--dry-run', '--force', '--home', home, '--json']);
    assert.equal(dry.code, 0);
    assert.equal(JSON.parse(dry.stdout).results[1].action, 'would-update');
    assert.ok(readFileSync(installed(home, 'frontend-probe')).equals(edited), '--dry-run wrote nothing');
    const forced = cli(['--force', '--home', home, '--json']);
    assert.equal(forced.code, 0, forced.stderr);
    const result = JSON.parse(forced.stdout).results[1];
    assert.equal(result.action, 'updated');
    assert.ok(readFileSync(installed(home, 'frontend-probe')).equals(template('frontend-probe')));
    assert.ok(readFileSync(`${installed(home, 'frontend-probe')}.bak`).equals(edited), 'the previous file is kept');
  });

  test('--dry-run on an empty home reports would-install and creates nothing', () => {
    const home = freshHome();
    const dry = cli(['--dry-run', '--home', home, '--json']);
    assert.equal(dry.code, 0);
    assert.deepEqual(JSON.parse(dry.stdout).results.map((/** @type {any} */ r) => r.action), ['would-install', 'would-install']);
    assert.ok(!existsSync(path.join(home, '.claude')));
  });

  test('CLAUDE_CONFIG_DIR is honoured when no folder flag is given', () => {
    const config = path.join(freshHome(), 'claude-config');
    const res = cli([], { CLAUDE_CONFIG_DIR: config });
    assert.equal(res.code, 0, res.stderr);
    for (const name of AGENTS) assert.ok(existsSync(path.join(config, 'agents', `${name}.md`)));
  });

  test('usage errors exit 2 and --help exits 0', () => {
    assert.equal(cli(['--bogus']).code, 2);
    assert.equal(cli(['--check', '--dry-run', '--home', freshHome()]).code, 2);
    assert.equal(cli(['--check', '--force', '--home', freshHome()]).code, 2);
    assert.equal(cli(['--home', freshHome(), '--agents-dir', freshHome()]).code, 2);
    assert.equal(cli(['extra-argument']).code, 2);
    const help = cli(['--help']);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /^Usage: node install-agents\.mjs/);
    assert.match(help.stdout, /Exit codes: 0/);
  });

  test('a missing or malformed template is an environment error (exit code 3), never a silent skip', () => {
    const empty = path.join(freshHome(), 'templates');
    mkdirSync(empty);
    assert.throws(() => compareAgents({ templateDir: empty, agentsDir: freshHome() }), (err) => err instanceof EnvError && err.exitCode === 3);
    const bad = path.join(freshHome(), 'templates');
    mkdirSync(bad);
    for (const name of AGENTS) writeFileSync(path.join(bad, `${name}.md`), '---\nname: someone-else\n---\nbody\n');
    assert.throws(() => installAgents({ templateDir: bad, agentsDir: freshHome() }), /no frontmatter naming frontend-critic/);
  });

  test('installAgents reports without a CLI: check mode never writes', () => {
    const dir = path.join(freshHome(), 'agents');
    const check = installAgents({ mode: 'check', agentsDir: dir });
    assert.equal(check.ok, false);
    assert.deepEqual(check.results.map((r) => r.action), ['missing', 'missing']);
    assert.ok(!existsSync(dir));
    const install = installAgents({ agentsDir: dir });
    assert.equal(install.ok, true);
    assert.ok(install.results.every((r) => r.templateSha256 === r.installedSha256 || r.installedSha256 === null));
    assert.equal(installAgents({ mode: 'check', agentsDir: dir }).ok, true);
  });
});
