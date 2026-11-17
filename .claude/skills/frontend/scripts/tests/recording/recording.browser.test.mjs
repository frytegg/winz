// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { launch } from '../../lib/browser.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { aggregate } from '../../lib/report.mjs';
import { serveStatic } from '../../lib/serve.mjs';
import { ADVISORY, run } from '../../recording-check.mjs';
import { ffmpegFeatures, makeMaster } from './helpers.mjs';

/** @typedef {import('playwright-core').Browser} Browser */
/** @typedef {import('../../lib/report.mjs').GateResult} GateResult */

const FIXTURES = fileURLToPath(new URL('../fixtures/recording/', import.meta.url));
const CLI = fileURLToPath(new URL('../../recording-check.mjs', import.meta.url));
const RENDERED = Array.from({ length: 14 }, (_, i) => `recording.g${String(i + 1).padStart(2, '0')}`);
const ff = ffmpegFeatures();
/** @type {string} */
let tmp;

/** @type {Browser} */
let browser;

/**
 * @param {string} site
 * @param {{gates?: string[], args?: Record<string, unknown>, out?: string}} [options]
 * @returns {Promise<Record<string, GateResult>>}
 */
async function check(site, { gates = RENDERED, args = {}, out } = {}) {
  const server = await serveStatic(site);
  try {
    const ctx = { root: tmp, profile: defaultProfile(), state: null, design: path.join(tmp, 'design'), routes: [{ path: '/', name: 'home', first: true, features: [], states: [] }], baseUrl: server.url, browser, viewports: [], args: { out: out ?? path.join(tmp, `out-${Math.random().toString(36).slice(2)}`), ...args }, log: () => undefined };
    const results = await run(ctx, gates);
    return Object.fromEntries(results.map((r) => [r.id, r]));
  } finally {
    await server.close();
  }
}

/**
 * @param {GateResult} g
 * @param {string} severity
 * @param {RegExp} [pattern]
 * @returns {boolean}
 */
function has(g, severity, pattern = /./) {
  return g.evidence.some((e) => e.severity === severity && pattern.test(JSON.stringify(e)));
}

describe('browser: recording-check gates', () => {
  /** @type {Record<string, GateResult>} */
  let pass;
  /** @type {Record<string, GateResult>} */
  let fail;
  /** @type {Record<string, GateResult>} */
  let failAgain;
  /** @type {string} */
  let passOut;
  /** @type {string | null} */
  let master = null;

  before(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-rec-'));
    passOut = path.join(tmp, 'pass-out');
    browser = await launch();
    if (ff.x264 && ff.probe) master = makeMaster(tmp);
    pass = await check(path.join(FIXTURES, 'pass'), { out: passOut, args: master ? { master } : {} });
    fail = await check(path.join(FIXTURES, 'fail'));
    failAgain = await check(path.join(FIXTURES, 'fail'));
  });

  after(async () => {
    await browser?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test('the record-ready page passes g01 to g14 with no warning', () => {
    for (const id of RENDERED) {
      if (id === 'recording.g07' && !(ff.x264 && ff.vmaf)) {
        assert.equal(pass[id].state, 'skipped', 'g07 needs ffmpeg with libx264 and libvmaf');
        continue;
      }
      assert.equal(pass[id].state, 'ok', `${id}: ${pass[id].detail}`);
      assert.ok(!has(pass[id], 'warn'), `${id} has no warning: ${pass[id].detail}`);
    }
    if (ff.x264 && ff.vmaf) assert.match(pass['recording.g07'].detail, /CAMBI/);
    if (master) assert.match(pass['recording.g10'].detail, /limited range/);
    for (const id of ADVISORY) assert.equal(pass[id].advisory, true, `${id} cannot fail, so even a clean pass is advisory`);
    assert.equal(pass['recording.g01'].advisory, undefined, 'a gate that can fail passes for real');
  });

  test('captures, judge copies, zoom frames and the blind-read prompt are written under --out', () => {
    const dir = path.join(passOut, 'recording-check', 'home');
    for (const name of ['capture-1080.png', 'capture-720.png', 'capture-540.png', 'capture-zoom125.png', 'capture-zoom150.png', 'blind-read-prompt.md']) {
      assert.ok(existsSync(path.join(dir, name)), name);
    }
  });

  test('FAIL rows fail their gate: small text, small key text, pixel contrast, hover-only text, a fast blink, zoom overflow', () => {
    assert.equal(fail['recording.g01'].state, 'fail');
    assert.ok(has(fail['recording.g01'], 'fail', /Fees are estimated/));
    assert.equal(fail['recording.g03'].state, 'fail');
    assert.ok(has(fail['recording.g03'], 'fail', /412 payments settled/));
    assert.equal(fail['recording.g05'].state, 'fail');
    assert.ok(has(fail['recording.g05'], 'fail', /Low contrast on a light band/));
    assert.equal(fail['recording.g11'].state, 'fail');
    assert.ok(has(fail['recording.g11'], 'fail', /Network fee/), 'the live hover probe saw the tooltip text appear');
    assert.ok(has(fail['recording.g11'], 'warn', /:hover/), 'the :hover rule is listed');
    assert.ok(has(fail['recording.g11'], 'warn', /Updated every block/), 'the title tooltip is listed');
    assert.equal(fail['recording.g12'].state, 'fail');
    assert.ok(has(fail['recording.g12'], 'fail', /blink 200 ms/));
    assert.ok(has(fail['recording.g12'], 'warn', /infinite|blink/), 'the loop is listed for record mode');
    assert.equal(fail['recording.g14'].state, 'fail');
    assert.match(fail['recording.g14'].detail, /150% zoom/);
    assert.ok(has(fail['recording.g14'], 'warn', /Receipt hash/), 'key text below the fold at zoom');
  });

  test('g03 fails when no route marks key text: a gate that measured nothing never passes', async () => {
    const noKey = await check(path.join(FIXTURES, 'no-key'), { gates: ['recording.g03'] });
    assert.equal(noKey['recording.g03'].state, 'fail');
    assert.match(noKey['recording.g03'].detail, /no element on any of the 1 route\(s\) carries data-rec-role="key"/);
    assert.equal(pass['recording.g03'].state, 'ok', 'the same page with its key markers passes');
  });

  test('WARN rows pass with their warnings as evidence (g02, g04, g06, g08, g09, g10, g13); warn-only gates are advisory', () => {
    /** @type {Array<[string, RegExp]>} */
    const expected = [
      ['recording.g02', /Treasury teams batch/],
      ['recording.g04', /weight 300/],
      ['recording.g06', /15:1 projector floor/],
      ['recording.g08', /css/],
      ['recording.g09', /1\.16:1/],
      ['recording.g10', /rgb\(13, 13, 13\) on rgb\(10, 10, 10\)/],
      ['recording.g13', /no visible label/],
    ];
    for (const [id, pattern] of expected) {
      assert.equal(fail[id].state, 'ok', `${id}: ${fail[id].detail}`);
      assert.equal(fail[id].advisory, id === 'recording.g10' ? undefined : true, `${id} can only warn, so its ok is advisory`);
      assert.ok(has(fail[id], 'warn', pattern), `${id} carries its warning: ${JSON.stringify(fail[id].evidence).slice(0, 300)}`);
      assert.match(fail[id].detail, /warning/);
    }
  });

  test('g07: the dark gradient is flagged, and with libvmaf its CAMBI fails the gate', { skip: ff.x264 && ff.vmaf ? false : 'ffmpeg with libx264 and libvmaf is not installed' }, () => {
    assert.equal(fail['recording.g07'].state, 'fail');
    assert.match(fail['recording.g07'].detail, /CAMBI \d/);
    assert.ok(has(fail['recording.g07'], 'warn', /brightest stop/));
  });

  test('the frozen frame is deterministic: two runs on the animated page give the same verdicts, counts and CAMBI', () => {
    for (const id of RENDERED) {
      assert.equal(failAgain[id].state, fail[id].state, id);
      assert.equal(failAgain[id].detail, fail[id].detail, `${id} detail`);
      assert.equal(failAgain[id].evidence.length, fail[id].evidence.length, `${id} evidence count`);
    }
  });

  test('g07 is skipped with its reason when ffmpeg is absent; the gradient warning stays in the detail', async () => {
    const saved = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = path.join(tmp, 'no-ffmpeg-here.exe');
    try {
      const r = await check(path.join(FIXTURES, 'fail'), { gates: ['recording.g07', 'recording.g01'] });
      assert.equal(r['recording.g07'].state, 'skipped');
      assert.match(r['recording.g07'].detail, /ffmpeg not found/);
      assert.match(r['recording.g07'].detail, /dark gradient/);
      assert.equal(r['recording.g01'].state, 'fail', 'the other gates still run, with browser-made copies');
      assert.equal(aggregate(Object.values(r)).ok, false);
    } finally {
      if (saved === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = saved;
    }
  });

  test('g10 with an unreadable master fails', { skip: ff.probe ? false : 'ffprobe is not installed' }, async () => {
    const broken = path.join(tmp, 'broken.mp4');
    writeFileSync(broken, 'not a video');
    const r = await check(path.join(FIXTURES, 'pass'), { gates: ['recording.g10'], args: { master: broken } });
    assert.equal(r['recording.g10'].state, 'fail');
    assert.match(r['recording.g10'].detail, /ffprobe cannot read/);
  });

  test('CLI with --serve: exit 0 on the passing page and 1 on the failing one', () => {
    const args = (/** @type {string} */ site) => [CLI, '--root', tmp, '--state', path.join(tmp, 'state'), '--out', path.join(tmp, 'cli'), '--serve', site, '--gates', 'G1,G12', '--json'];
    const good = spawnSync(process.execPath, args(path.join(FIXTURES, 'pass')), { encoding: 'utf8' });
    assert.equal(good.status, 0, good.stdout + good.stderr);
    const bad = spawnSync(process.execPath, args(path.join(FIXTURES, 'fail')), { encoding: 'utf8' });
    assert.equal(bad.status, 1, bad.stderr);
    assert.deepEqual(JSON.parse(bad.stdout).gates.map((/** @type {{state: string}} */ g) => g.state), ['fail', 'fail']);
  });
});
