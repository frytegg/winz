// @ts-check
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runChecks } from '../../frontend-check.mjs';
import { serveStatic } from '../../lib/serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(HERE, '..', 'fixtures', 'frontend-check');
const STUBS = path.join(FIX, 'stubs');
const REPO = path.join(FIX, 'repo');
const SITE = path.join(FIX, 'site');
const WRAPPER = path.join(FIX, 'run-with-stubs.mjs');
const SERVER = path.join(FIX, 'server.mjs');

/** @type {string} */
let tmp = '';
const log = () => {};

/**
 * @param {Record<string, unknown>} values
 */
function run(values) {
  return runChecks({ root: REPO, profile: path.join(REPO, 'profile.json'), state: path.join(tmp, 'state'), ...values }, { modulesDir: STUBS, log });
}

/**
 * @returns {Array<Record<string, any>>}
 */
function calls() {
  return /** @type {Array<Record<string, any>>} */ (Reflect.get(globalThis, '__feStubCalls') ?? []);
}

/**
 * @returns {Promise<number>}
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ (err).code === 'EPERM';
  }
}

/**
 * @param {number[]} pids
 * @returns {Promise<boolean>} true once every pid is gone (polls up to 5 s)
 */
async function allGone(pids) {
  for (let i = 0; i < 50; i += 1) {
    if (pids.every((p) => !alive(p))) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/**
 * Runs the stub-module CLI in a child process.
 * @param {string[]} args
 * @returns {Promise<{status: number | null, stdout: string, stderr: string}>}
 */
function cli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WRAPPER, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/**
 * @param {string} state
 * @returns {string[]}
 */
function baseArgs(state) {
  return ['--json', '--root', REPO, '--profile', path.join(REPO, 'profile.json'), '--state', state];
}

describe('browser: frontend-check targets and the shared browser', () => {
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-check-br-'));
    mkdirSync(path.join(tmp, 'state'));
    Reflect.set(globalThis, '__feStubCalls', []);
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('--serve: modules get the served URL, the routes, the features and one shared browser', async () => {
    const outcome = await run({ gates: ['render,coverage'], features: ['FR-003,FR-007'], serve: SITE });
    assert.equal(outcome.exitCode, 0, JSON.stringify(outcome.report.gates.filter((x) => x.state !== 'ok')));
    assert.deepEqual(outcome.report.counts, { ok: 12, fail: 0, skipped: 0 });
    assert.match(String(outcome.report.target?.url), /^http:\/\/127\.0\.0\.1:\d+$/);
    const [qa, coverage] = calls();
    assert.equal(qa.module, 'qa');
    assert.equal(qa.title, 'Fixture site', 'the stub loaded the served page');
    assert.equal(coverage.features, 'FR-003,FR-007');
    assert.deepEqual(coverage.featureIds, ['FR-003', 'FR-007']);
    assert.ok(qa.browserObject && qa.browserObject === coverage.browserObject, 'one browser for every module');
    assert.equal(qa.browserObject.isConnected(), false, 'the browser is closed after the run');
    assert.deepEqual(qa.routes, ['/', '/about.html']);
    assert.equal(outcome.report.gates.find((x) => x.id === 'render.console')?.evidence[0].value, 'Fixture site');
  });

  test('--url: a running app is used as is', async () => {
    const site = await serveStatic(SITE);
    try {
      const outcome = await run({ gates: ['render.console'], url: site.url });
      assert.equal(outcome.exitCode, 0);
      assert.equal(calls()[0].title, 'Fixture site');
      assert.equal(outcome.report.target?.url, `${site.url}/`);
    } finally {
      await site.close();
    }
  });

  test('modules that fail to import or lack run() fail their gates and exit 3', async () => {
    const outcome = await run({ gates: ['ip.fonts,tells.tier1'] });
    assert.deepEqual(outcome.report.gates.map((x) => [x.id, x.state]), [['tells.tier1', 'fail'], ['ip.fonts', 'fail']]);
    assert.match(outcome.report.gates[0].detail, /cannot load: TypeError: slop-check\.mjs exports no run/);
    assert.match(outcome.report.gates[1].detail, /stub ip-check fails at import/);
    assert.equal(outcome.exitCode, 3);
  });

  test('--start: waits for the URL, runs, then kills the whole process tree', async () => {
    const port = await freePort();
    const pidFile = path.join(tmp, 'pids.json');
    const start = `"${process.execPath}" "${SERVER}" ${port} "${pidFile}"`;
    const r = await cli([...baseArgs(path.join(tmp, 'state')), '--gates', 'render.console', '--start', start, '--url', `http://127.0.0.1:${port}/`]);
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.gates[0].evidence[0].value, 'Started fixture');
    const pids = JSON.parse(readFileSync(pidFile, 'utf8'));
    assert.ok(await allGone([pids.server, pids.grandchild]), `server ${pids.server} and grandchild ${pids.grandchild} must be gone`);
  });

  test('--start refuses a port that already answers (exit 3) and starts nothing', async () => {
    const site = await serveStatic(SITE);
    try {
      const marker = path.join(tmp, 'never.json');
      const start = `"${process.execPath}" "${SERVER}" ${site.port} "${marker}"`;
      const r = await cli([...baseArgs(path.join(tmp, 'state')), '--gates', 'render.console', '--start', start, '--url', `${site.url}/`]);
      assert.equal(r.status, 3);
      assert.match(r.stderr, /already answers before --start ran/);
      assert.equal(r.stdout, '');
      assert.equal(existsSync(marker), false);
    } finally {
      await site.close();
    }
  });

  test('--start: a command that exits before the URL answers is an environment error', async () => {
    const port = await freePort();
    const start = `"${process.execPath}" -e "console.log('bye'); process.exit(4)"`;
    const r = await cli([...baseArgs(path.join(tmp, 'state')), '--gates', 'render.console', '--start', start, '--url', `http://127.0.0.1:${port}/`]);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /exited \(code 4\) before .* answered.*bye/);
  });

  test('--start: a URL that never answers times out, and the started process is killed', async () => {
    const port = await freePort();
    const pidFile = path.join(tmp, 'sleeper.pid');
    const start = `"${process.execPath}" "${path.join(FIX, 'sleeper.mjs')}" "${pidFile}"`;
    const r = await cli([...baseArgs(path.join(tmp, 'state')), '--gates', 'render.console', '--start', start, '--url', `http://127.0.0.1:${port}/`, '--start-timeout', '2']);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /did not answer within 2 s/);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    assert.ok(await allGone([pid]), `sleeper ${pid} must be gone`);
  });
});
