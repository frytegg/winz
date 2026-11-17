// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../../lib/errors.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { aggregate } from '../../lib/report.mjs';
import {
  GATES, THRESHOLDS, blinkRisk, captureRoot, deliveredXHeight, gradientStopLuminance, inspectDeck, ledgerMirror,
  moovFirst, probeMaster, projected, redOnDark, run, selectGates, zipEntries,
} from '../../recording-check.mjs';
import { fakeMp4, ffmpegFeatures, makeMaster, makeZip } from './helpers.mjs';

const CLI = fileURLToPath(new URL('../../recording-check.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../fixtures/recording/', import.meta.url));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-rec-unit-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const ff = ffmpegFeatures();

/**
 * @param {string} name
 * @param {Buffer} data
 * @returns {string}
 */
function put(name, data) {
  const file = path.join(tmp, name);
  writeFileSync(file, data);
  return file;
}

/**
 * @param {Partial<import('../../recording-check.mjs').CheckContext>} [over]
 * @returns {import('../../recording-check.mjs').CheckContext}
 */
function context(over = {}) {
  return { root: tmp, profile: defaultProfile(), state: null, design: path.join(tmp, 'design'), routes: [{ path: '/', name: 'home', first: true, features: [], states: [] }], baseUrl: null, browser: null, viewports: [], args: {}, log: () => undefined, ...over };
}

describe('recording-check gates and pure rules', () => {
  test('GATES are recording.g01 to recording.g16; selectGates accepts G7, g07, recording.g07 and the group', () => {
    assert.deepEqual(GATES.map((g) => g.id), Array.from({ length: 16 }, (_, i) => `recording.g${String(i + 1).padStart(2, '0')}`));
    assert.deepEqual(selectGates(['G7', 'g07', 'recording.g7', 'recording.g16']), ['recording.g07', 'recording.g16']);
    assert.equal(selectGates(['recording']).length, 16);
    assert.throws(() => selectGates(['g17']), UsageError);
    assert.throws(() => selectGates(['recording.cambi']), UsageError);
  });

  test('thresholds are the FD20 values', () => {
    assert.equal(THRESHOLDS.minDeliveredXHeight720, 5.8);
    assert.equal(THRESHOLDS.warnDeliveredXHeight720, 6.5);
    assert.equal(THRESHOLDS.minDeliveredXHeight540Key, 6.5);
    assert.equal(THRESHOLDS.maxCambi, 5);
    assert.equal(THRESHOLDS.minBlinkPeriodMs, 333);
  });

  test('deliveredXHeight scales with the copy; Inter 16 px at 1080p delivers about 5.8 px at 720p', () => {
    assert.equal(deliveredXHeight(9, 720, 1080), 6);
    assert.ok(Math.abs(deliveredXHeight(16 * 0.546, 720, 1080) - 5.82) < 0.01);
  });

  test('projected contrast: the 21:1 floor is WCAG; a 15:1 floor costs dark UIs more than light ones', () => {
    assert.ok(Math.abs(projected(1, 0, 21) - 21) < 0.01);
    const darkUi = projected(0.246, 0.0045, 15);
    const lightUi = projected(0.0056, 1, 15);
    assert.ok(darkUi < 4.5, `dark ${darkUi}`);
    assert.ok(lightUi > 10, `light ${lightUi}`);
  });

  test('redOnDark: saturated red on a dark background only; blue on dark is not a trigger (FD20-F08 corrected)', () => {
    assert.equal(redOnDark('rgb(239, 68, 68)', 'rgb(10, 10, 10)'), true);
    assert.equal(redOnDark('rgb(239, 68, 68)', 'rgb(255, 255, 255)'), false);
    assert.equal(redOnDark('rgb(59, 130, 246)', 'rgb(10, 10, 10)'), false);
    assert.equal(redOnDark('rgb(200, 200, 200)', 'rgb(10, 10, 10)'), false);
  });

  test('gradientStopLuminance reads every colour syntax and composites translucent stops', () => {
    const dark = gradientStopLuminance('linear-gradient(rgb(10, 10, 10) 0%, rgb(23, 23, 39) 100%)', 'rgb(255, 255, 255)');
    assert.equal(dark.length, 2);
    assert.ok(Math.max(...dark) < 0.1);
    const translucent = gradientStopLuminance('linear-gradient(rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.5) 100%)', 'rgb(255, 255, 255)');
    assert.ok(translucent[0] > 0.99, 'a transparent stop shows the white below');
    assert.ok(gradientStopLuminance('radial-gradient(oklch(0.2 0.05 270), #fff)', 'rgb(0, 0, 0)').length === 2);
  });

  test('blinkRisk: infinite opacity or colour cycles under 333 ms', () => {
    assert.equal(blinkRisk({ iterations: 'infinite', duration: 200, properties: ['opacity'] }), true);
    assert.equal(blinkRisk({ iterations: 'infinite', duration: 400, properties: ['opacity'] }), false);
    assert.equal(blinkRisk({ iterations: 3, duration: 200, properties: ['opacity'] }), false);
    assert.equal(blinkRisk({ iterations: 'infinite', duration: 200, properties: ['transform'] }), false);
  });

  test('captureRoot: --out, then frontend-check outDir, then the state folder', () => {
    assert.match(captureRoot(context({ args: { out: path.join(tmp, 'o') } })).replace(/\\/g, '/'), /\/o\/recording-check$/);
    assert.match(captureRoot(context({ args: { outDir: path.join(tmp, 'gates', 'x') } })).replace(/\\/g, '/'), /\/gates\/x\/recording-check$/);
    assert.match(captureRoot(context({ state: path.join(tmp, 'state') })).replace(/\\/g, '/'), /\/state\/recording\/[^/]+$/);
  });
});

describe('recording-check files: master and deck', () => {
  test('moovFirst reads the top-level box order', () => {
    assert.equal(moovFirst(put('fast.mp4', fakeMp4({ codec: 'avc1' }))), true);
    assert.equal(moovFirst(put('slow.mp4', fakeMp4({ codec: 'avc1', moovFirst: false }))), false);
    assert.equal(moovFirst(put('junk.mp4', Buffer.from('not an mp4 file at all'))), null);
  });

  test('zipEntries lists stored and deflated entries', () => {
    const file = put('z.zip', makeZip([{ name: 'a.txt', data: 'hello' }, { name: 'b/c.xml', data: '<x/>'.repeat(50), deflate: true }]));
    assert.deepEqual(zipEntries(file).map((e) => [e.name, e.method]), [['a.txt', 0], ['b/c.xml', 8]]);
  });

  test('inspectDeck: a .pptx with an H.264 MP4 passes; .ppt, HEVC, no video and a non-MP4 video fail', async () => {
    const types = { name: '[Content_Types].xml', data: '<Types/>' };
    const good = put('deck.pptx', makeZip([types, { name: 'ppt/slides/slide1.xml', data: '<p/>', deflate: true }, { name: 'ppt/media/media1.mp4', data: fakeMp4({ codec: 'avc1' }) }]));
    const ok = await inspectDeck(good);
    assert.deepEqual(ok.fail, []);
    assert.match(ok.ok.join(), /H\.264 \(avc1\)/);
    const deflated = await inspectDeck(put('deck2.pptx', makeZip([types, { name: 'ppt/media/media1.mp4', data: fakeMp4({ codec: 'avc3' }), deflate: true }])));
    assert.match(deflated.ok.join(), /avc3/);
    const hevc = await inspectDeck(put('hevc.pptx', makeZip([types, { name: 'ppt/media/media1.mp4', data: fakeMp4({ codec: 'hvc1' }) }])));
    assert.match(hevc.fail.join(), /HEVC/);
    const ole = Buffer.alloc(64);
    ole.writeUInt32BE(0xd0cf11e0, 0);
    assert.match((await inspectDeck(put('old.ppt', ole))).fail.join(), /97-2003/);
    assert.match((await inspectDeck(put('novideo.pptx', makeZip([types])))).fail.join(), /no embedded MP4/);
    assert.match((await inspectDeck(put('avi.pptx', makeZip([types, { name: 'ppt/media/media1.avi', data: 'RIFF' }])))).fail.join(), /not MP4/);
    assert.match((await inspectDeck(put('deck.pdf', Buffer.from('%PDF-1.7')))).fail.join(), /unexpected deck type/);
    const key = await inspectDeck(put('talk.key', makeZip([{ name: 'Data/demo.mov', data: fakeMp4({ codec: 'avc1' }) }])));
    assert.deepEqual(key.fail, [], 'a single-file Keynote deck with an H.264 movie');
    mkdirSync(path.join(tmp, 'pkg.key'), { recursive: true });
    assert.match((await inspectDeck(path.join(tmp, 'pkg.key'))).fail.join(), /folder/);
  });

  test('recording.g16: ok without a deck when nothing embeds one, skipped while the deck is due, fail or ok on the file', async () => {
    const noVideo = await run(context(), ['recording.g16']);
    assert.equal(noVideo[0].state, 'ok');
    const mp4 = await run(context({ profile: defaultProfile({ format: { video: { embed: 'mp4' } } }) }), ['recording.g16']);
    assert.equal(mp4[0].state, 'ok');
    const due = await run(context({ profile: defaultProfile({ format: { video: { embed: 'pptx' } } }) }), ['recording.g16']);
    assert.equal(due[0].state, 'skipped');
    assert.match(due[0].detail, /--deck/);
    assert.equal(aggregate(due).ok, false, 'a skipped gate never passes');
    const types = { name: '[Content_Types].xml', data: '<Types/>' };
    const good = put('g16.pptx', makeZip([types, { name: 'ppt/media/media1.mp4', data: fakeMp4({ codec: 'avc1' }) }]));
    assert.equal((await run(context({ args: { deck: good } }), ['recording.g16']))[0].state, 'ok');
    const ole = Buffer.alloc(64);
    ole.writeUInt32BE(0xd0cf11e0, 0);
    assert.equal((await run(context({ args: { deck: put('g16.ppt', ole) } }), ['recording.g16']))[0].state, 'fail');
  });

  test('recording.g15: no Ledger package is ok, a device kit without a mirrored step fails, a mirrored step passes', async () => {
    assert.equal(ledgerMirror(tmp, defaultProfile()).applicable, false);
    const pass = ledgerMirror(path.join(FIXTURES, 'ledger-pass'), defaultProfile());
    assert.equal(pass.applicable, true);
    assert.ok(pass.evidence.some((e) => e.value === 'requiredUserInteraction'));
    assert.ok(pass.evidence.some((e) => /Approve the transfer on your Ledger/i.test(String(e.value))));
    const [ok] = await run(context({ root: path.join(FIXTURES, 'ledger-pass') }), ['recording.g15']);
    assert.equal(ok.state, 'ok', ok.detail);
    const [bad] = await run(context({ root: path.join(FIXTURES, 'ledger-fail') }), ['recording.g15']);
    assert.equal(bad.state, 'fail');
    assert.match(bad.detail, /requiredUserInteraction/);
    const [none] = await run(context(), ['recording.g15']);
    assert.equal(none.state, 'ok');
  });

  test('probeMaster reads the colour tags of a limited-range H.264 master and reports an unreadable file', { skip: ff.x264 && ff.probe ? false : 'ffmpeg with libx264 and ffprobe are not installed' }, () => {
    const tv = makeMaster(tmp);
    const facts = probeMaster('ffprobe', tv);
    assert.equal(facts.error, null);
    assert.equal(facts.stream?.color_range, 'tv');
    assert.equal(facts.stream?.codec_name, 'h264');
    assert.equal(facts.faststart, true);
    assert.notEqual(probeMaster('ffprobe', put('broken.mp4', Buffer.from('nope'))).error, null);
  });
});

describe('recording-check without pages and CLI', () => {
  test('rendered gates are skipped without a base URL and the report is not ok', async () => {
    const results = await run(context(), ['recording.g01', 'recording.g11', 'recording.g14']);
    assert.deepEqual(results.map((r) => r.state), ['skipped', 'skipped', 'skipped']);
    assert.equal(aggregate(results).ok, false);
  });

  test('--help exits 0; an unknown gate and a missing --deck exit 2', () => {
    const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /recording\.g01 to recording\.g16/);
    assert.equal(spawnSync(process.execPath, [CLI, '--root', tmp, '--gates', 'G99'], { encoding: 'utf8' }).status, 2);
    assert.equal(spawnSync(process.execPath, [CLI, '--root', tmp, '--deck', path.join(tmp, 'absent.pptx')], { encoding: 'utf8' }).status, 2);
  });

  test('CLI on file gates only: g15 on the Ledger fixtures exits 0 and 1', () => {
    const ok = spawnSync(process.execPath, [CLI, '--root', path.join(FIXTURES, 'ledger-pass'), '--state', path.join(tmp, 's1'), '--gates', 'G15', '--json'], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).gates[0].id, 'recording.g15');
    const bad = spawnSync(process.execPath, [CLI, '--root', path.join(FIXTURES, 'ledger-fail'), '--state', path.join(tmp, 's2'), '--gates', 'G15'], { encoding: 'utf8' });
    assert.equal(bad.status, 1, bad.stderr);
  });
});
