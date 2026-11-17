// @ts-check
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as g from '../../capture-gate.mjs';
import { resolveCaptureViewports, runCapture } from '../../capture.mjs';
import { extractAll, ledgerGates } from '../../extract.mjs';
import { launch } from '../../lib/browser.mjs';
import { sha256File } from '../../lib/fsutil.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { serveStatic } from '../../lib/serve.mjs';
import { fakeSleep, fixture, htmlPage, removeDir, startServer, tempDir, writeJsonFile } from './helpers.mjs';

/**
 * @typedef {import('../../capture.mjs').CaptureOptions} CaptureOptions
 * @typedef {import('../../capture.mjs').CaptureReport} CaptureReport
 */

const CAPTURE_CLI = fileURLToPath(new URL('../../capture.mjs', import.meta.url));
const VIEWPORTS = resolveCaptureViewports(undefined, defaultProfile().viewports);
const DESKTOP_ONLY = VIEWPORTS.slice(0, 1);

/** @type {import('playwright-core').Browser} */
let browser;
/** @type {Record<string, import('../../lib/serve.mjs').StaticServer>} */
const sites = {};
/** @type {import('./helpers.mjs').TestServer[]} */
const servers = [];
/** @type {string[]} */
const cleanup = [];
let project = '';

/**
 * @param {string} prefix
 * @returns {string}
 */
function scratch(prefix) {
  const dir = tempDir(prefix);
  cleanup.push(dir);
  return dir;
}

/**
 * @param {Record<string, import('./helpers.mjs').Route>} routes
 */
async function serve(routes) {
  const s = await startServer(routes);
  servers.push(s);
  return s;
}

/**
 * @param {string} url
 * @param {Partial<CaptureOptions>} [over]
 * @returns {CaptureOptions}
 */
function options(url, over = {}) {
  return { url, root: project, out: scratch('caps'), termsReviewed: null, dryRun: false, viewports: VIEWPORTS, slices: 3, deleteBy: null, state: null, ...over };
}

/**
 * @param {CaptureOptions} opts
 * @param {(ms: number) => Promise<void>} [sleep]
 * @returns {Promise<CaptureReport>}
 */
function capture(opts, sleep = fakeSleep().sleep) {
  return runCapture(opts, { browser, sleep, log: () => {} });
}

/**
 * @param {string} file
 * @returns {any}
 */
function json(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * Runs a CLI in a child process without blocking this process, whose fixture servers must keep answering.
 * @param {string[]} args
 * @returns {Promise<{status: number | null, stdout: string, stderr: string}>}
 */
function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

before(async () => {
  browser = await launch();
  for (const name of ['site-light', 'site-dark', 'site-flagged', 'site-tdm-meta', 'site-interstitial']) sites[name] = await serveStatic(fixture(name));
  project = scratch('project');
});

after(async () => {
  await browser?.close();
  await Promise.all([...Object.values(sites).map((s) => s.close()), ...servers.map((s) => s.close())]);
  for (const dir of cleanup) removeDir(dir);
});

describe('capture and extract, end to end', () => {
  /** @type {CaptureReport} */
  let light;
  /** @type {CaptureReport} */
  let dark;
  const state = { dir: '' };
  const pacing = fakeSleep();

  test('captures a reference page: slices per viewport, styles, CDP fonts, landmarks, reveal, manifest and receipt', async () => {
    state.dir = scratch('state');
    const url = `${sites['site-light'].url}/`;
    light = await capture(options(url, { termsReviewed: `${sites['site-light'].url}/terms`, state: state.dir }), pacing.sleep);
    assert.equal(light.verdict, 'captured', light.reason);
    const dir = String(light.captureDir);
    for (const name of ['slices/desktop-00.png', 'slices/desktop-01.png', 'slices/desktop-02.png', 'slices/mobile-00.png', 'styles.json', 'fonts.json', 'landmarks.json', 'reveal.json', 'manifest.json', 'gate-receipt.json']) {
      assert.equal(existsSync(path.join(dir, name)), true, name);
    }
    const manifest = json(path.join(dir, 'manifest.json'));
    for (const f of manifest.files) assert.equal(sha256File(path.join(dir, f.name)), f.sha256, f.name);
    assert.ok(Date.parse(manifest.deleteBy) > Date.parse(manifest.capturedAt));
    const receipt = json(path.join(dir, 'gate-receipt.json'));
    assert.equal(receipt.verdict, 'captured');
    assert.match(receipt.userAgent, /HeadlessChrome/);
    assert.ok(receipt.userAgent.endsWith(g.UA_SUFFIX));
    assert.equal(receipt.termsReviewed, `${sites['site-light'].url}/terms`);
    assert.equal(receipt.manifest.sha256, sha256File(path.join(dir, 'manifest.json')));
    assert.deepEqual(receipt.terms.flagged, []);

    const log = json(path.join(path.dirname(dir), g.HOST_LOG));
    assert.equal(log.navigations.length, 2);
    // At most one wait: none when the desktop capture itself outlasted MIN_DELAY_MS (a loaded machine), so the
    // invariant is the planned gap (real time plus the faked wait), not the number of waits.
    assert.ok(pacing.waits.length <= 1, `at most one wait before the second navigation, got ${pacing.waits.length}`);
    const waited = pacing.waits.reduce((sum, ms) => sum + ms, 0);
    const gap = Date.parse(log.navigations[1].at) - Date.parse(log.navigations[0].at) + waited;
    assert.ok(gap >= g.MIN_DELAY_MS - 100, `navigations planned ${gap} ms apart`);

    const styles = json(path.join(dir, 'styles.json'));
    assert.deepEqual(Object.keys(styles.viewports), ['desktop', 'mobile']);
    assert.ok(styles.viewports.desktop.elements.length > 40);
    assert.ok(styles.viewports.desktop.elements.every((/** @type {{visible: boolean}} */ e) => e.visible));
    assert.deepEqual(styles.mediaQueries.widths.map((/** @type {{px: number}} */ w) => w.px), [640, 1024]);
    assert.ok(styles.viewports.desktop.declared.customProperties.includes('--accent'));
    const button = styles.viewports.desktop.states.find((/** @type {{role: string}} */ s) => s.role === 'button');
    assert.ok(button && 'background-color' in button.hover, 'hover state of the primary button read through forcePseudoState');
    const fonts = json(path.join(dir, 'fonts.json'));
    const h1 = fonts.viewports.desktop.samples.find((/** @type {{role: string}} */ s) => s.role === 'h1');
    assert.ok(h1 && h1.fonts.length > 0 && h1.fonts[0].familyName, 'rendered font of the h1');
    const landmarks = json(path.join(dir, 'landmarks.json')).viewports.desktop;
    assert.ok(landmarks.landmarks.some((/** @type {{role: string}} */ l) => l.role === 'navigation'));
    assert.deepEqual(landmarks.consent.map((/** @type {{sel: string}} */ c) => c.sel), ['#cookie-consent']);
    const reveal = json(path.join(dir, 'reveal.json')).viewports.desktop;
    assert.ok(reveal.revealed.some((/** @type {{sel: string, kinds: string[]}} */ r) => r.sel === '#later' && r.kinds.includes('opacity')));
    assert.equal(reveal.slices.length, 3);

    const index = g.readRefsIndex(state.dir);
    assert.equal(index.captures.length, 1);
    assert.equal(index.captures[0].purged, false);
  });

  test('extract measures the light reference as it was designed', () => {
    const { result } = extractAll([String(light.captureDir)], { out: path.join(scratch('extract'), 'refs-extract.json') });
    const r = result.references[0];
    assert.equal(r.type.body?.px, 16);
    assert.equal(r.type.headings.h1?.px, 48.83);
    assert.equal(r.type.scale.ratio, 1.25);
    assert.equal(r.type.scale.named, 'major third');
    assert.equal(r.spacing.base, 8);
    assert.equal(r.radius.family, 'rounded');
    assert.deepEqual(r.radius.buttons, { count: 3, shape: 'rounded', px: 6 });
    assert.equal(r.palette.ground?.color, '#ffffff');
    assert.equal(r.ground.mode, 'light');
    assert.equal(r.palette.ink?.color, '#1a1a1a');
    assert.equal(r.palette.accent?.color, '#2f5bd3');
    assert.equal(r.palette.accent?.chromatic, true);
    assert.equal(r.palette.accentCount, 1);
    assert.ok(r.palette.neutralRampDepth >= 4);
    assert.ok(r.palette.excluded.some((e) => /consent/.test(e)), 'the cookie widget is left out');
    assert.deepEqual(r.cta.aboveFold, { filled: 2, outline: 1, inNav: 1, outsideNav: 2, total: 3 });
    assert.equal(r.nav.present, true);
    assert.equal(r.nav.items, 4);
    assert.equal(r.nav.sticky, true);
    assert.equal(r.nav.position, 'top');
    assert.deepEqual({ ...r.figures.row, y: null, sizePx: null }, { present: true, count: 3, y: null, inFirstViewport: true, sizePx: null, labels: 'below' });
    assert.equal(r.numbers.tabular.share, 1);
    assert.deepEqual(r.numbers.decimals, { 0: 2, 2: 1 });
    assert.equal(r.numbers.currency.prefix, 1);
    assert.equal(r.numbers.percent, 1);
    assert.ok(r.numbers.shapes.some((s) => s.shape === '$99,999,999'));
    assert.ok(r.reveal.hiddenAtRest >= 1);
    assert.deepEqual(r.breakpoints, [640, 1024]);
    assert.ok((r.density.firstViewport.jpegQ70KiB ?? 0) > 0);
    assert.equal(r.ledger_reference.receipt, r.receipt);
    assert.equal(r.warnings.length, 0, r.warnings.join('; '));
  });

  test('the dark reference reads the other way: dark ground, pill call to action, no nav, no figures row, canvas hero', async () => {
    dark = await capture(options(`${sites['site-dark'].url}/`, { termsReviewed: `${sites['site-dark'].url}/legal/terms`, state: state.dir }));
    assert.equal(dark.verdict, 'captured', dark.reason);
    const { result } = extractAll([String(dark.captureDir)], { out: path.join(scratch('extract-dark'), 'refs-extract.json') });
    const r = result.references[0];
    assert.equal(r.ground.mode, 'dark');
    assert.equal(r.palette.accent?.color, '#f0b90b');
    assert.equal(r.radius.buttons?.shape, 'pill');
    assert.equal(r.figures.row.present, false);
    assert.equal(r.numbers.tabular.share, 0);
    assert.equal(r.nav.present, false);
    assert.equal(r.spacing.base, 4);
    assert.equal(r.type.body?.px, 18);
    assert.ok(r.canvases.firstViewportShare >= 0.3);
    assert.ok(r.warnings.some((w) => /vision-only/.test(w)));
    assert.deepEqual(r.cta.aboveFold.filled, 1);
  });

  test('a ledger written from the two references passes refs.ledger, and refs.receipts once the captures are purged', () => {
    const { result } = extractAll([String(light.captureDir), String(dark.captureDir)], { out: path.join(scratch('extract-both'), 'refs-extract.json') });
    assert.deepEqual(Object.keys(result.comparison.groundMode), ['R1', 'R2']);
    const [r1, r2] = result.references;
    const ledger = {
      references: [{ ...r1.ledger_reference, customer: 'Ledgerline Ltd' }, { ...r2.ledger_reference, customer: 'Nightdesk Inc' }],
      patterns: [
        { id: 'P1', kind: 'convention', statement: 'At most two filled calls to action above the fold', values: { R1: r1.cta.aboveFold.filled, R2: r2.cta.aboveFold.filled }, from: ['R1', 'R2'], not_borrowed: 'labels and colours' },
        { id: 'P2', kind: 'fact', statement: 'R1 shows three figures in a row with labels below', values: { count: 3 }, from: ['R1'], not_borrowed: 'the figures' },
      ],
      excluded: ['logos and wordmarks', { what: 'the canvas hero of R2', why: 'a signature visual', ref: 'R2' }],
    };
    const file = path.join(state.dir, 'pattern-ledger.json');
    writeJsonFile(file, ledger);
    const before = ledgerGates(file, ['refs.ledger', 'refs.receipts'], { state: state.dir });
    assert.equal(before[0].state, 'ok', before[0].detail);
    assert.equal(before[1].state, 'fail');
    assert.match(before[1].detail, /still stored/);
    g.purge(String(light.captureDir), { state: state.dir });
    g.purge(String(dark.captureDir), { state: state.dir });
    assert.equal(existsSync(path.join(String(light.captureDir), 'slices')), false);
    writeJsonFile(file, { ...ledger, references: ledger.references.map((r) => ({ ...r, purged: true })) });
    const afterPurge = ledgerGates(file, ['refs.ledger', 'refs.receipts'], { state: state.dir });
    assert.deepEqual(afterPurge.map((r) => r.state), ['ok', 'ok'], afterPurge.map((r) => r.detail).join(' | '));
  });
});

describe('the gate refuses before storing anything', () => {
  test('a dry run checks everything, navigates once and stores nothing', async () => {
    const opts = options(`${sites['site-light'].url}/`, { dryRun: true });
    const report = await capture(opts);
    assert.equal(report.verdict, 'allowed', report.reason);
    const host = g.hostKey(new URL(opts.url));
    assert.equal(existsSync(path.join(opts.out, host, 'index')), false);
    const log = json(path.join(opts.out, host, g.HOST_LOG));
    assert.deepEqual(log.navigations.map((/** @type {{purpose: string}} */ n) => n.purpose), ['dry-run']);
  });

  test('without --terms-reviewed nothing is stored', async () => {
    const opts = options(`${sites['site-light'].url}/`);
    const report = await capture(opts);
    assert.equal(report.verdict, 'needs-human-review');
    assert.equal(report.code, 'terms-unreviewed');
    assert.equal(existsSync(path.join(opts.out, g.hostKey(new URL(opts.url)), 'index')), false);
  });

  test('a flagged terms clause needs that very page in --terms-reviewed', async () => {
    const base = sites['site-flagged'].url;
    const dry = await capture(options(`${base}/`, { dryRun: true }));
    assert.equal(dry.verdict, 'needs-human-review');
    assert.equal(dry.code, 'terms-flagged');
    assert.match(dry.reason, /robot, spider, scraper/);
    const other = await capture(options(`${base}/`, { termsReviewed: `${base}/privacy` }));
    assert.equal(other.code, 'terms-flagged');
    const reviewed = await capture(options(`${base}/`, { termsReviewed: `${base}/terms`, viewports: DESKTOP_ONLY, slices: 1 }));
    assert.equal(reviewed.verdict, 'captured', reviewed.reason);
  });

  test('a 403 page stops the run; the host is never tried again', async () => {
    const wall = await serve({ '/robots.txt': { body: 'User-agent: *\nAllow: /\n' }, '/': { status: 403, headers: { 'content-type': 'text/html' }, body: htmlPage('Forbidden') } });
    const opts = options(`${wall.url}/`, { termsReviewed: `${wall.url}/terms` });
    const report = await capture(opts);
    assert.equal(report.verdict, 'stop');
    assert.equal(report.code, 'bot-wall');
    const navigation = wall.requests.find((r) => r.url === '/');
    assert.ok(navigation, 'the page was requested once');
    assert.match(navigation.userAgent, /HeadlessChrome/);
    assert.ok(navigation.userAgent.endsWith(g.UA_SUFFIX));
    assert.equal(existsSync(path.join(opts.out, g.hostKey(new URL(opts.url)), 'index')), false);
    const seen = wall.requests.length;
    const again = await capture({ ...opts });
    assert.equal(again.verdict, 'stop');
    assert.equal(again.code, 'blocked-before');
    assert.equal(wall.requests.length, seen, 'no request after a block');
  });

  test('an error page (404, 500) is never stored as a reference, and is not a block', async () => {
    const broken = await serve({ '/robots.txt': { body: 'User-agent: *\nAllow: /\n' }, '/gone': { status: 404, headers: { 'content-type': 'text/html' }, body: htmlPage('Not found') }, '/down': { status: 500, headers: { 'content-type': 'text/html' }, body: htmlPage('Server error') } });
    const out = scratch('errors');
    for (const page of ['gone', 'down']) {
      const report = await capture(options(`${broken.url}/${page}`, { out, termsReviewed: `${broken.url}/terms`, viewports: DESKTOP_ONLY }));
      assert.equal(report.verdict, 'skip-site', page);
      assert.equal(report.code, 'http-error');
      assert.equal(existsSync(path.join(out, g.hostKey(new URL(broken.url)), page)), false);
    }
    assert.equal(json(path.join(out, g.hostKey(new URL(broken.url)), g.HOST_LOG)).blocked, null);
  });

  test('a challenge interstitial gets one passive wait with the same identity, then stops', async () => {
    const waits = fakeSleep();
    const report = await capture(options(`${sites['site-interstitial'].url}/`, { termsReviewed: `${sites['site-interstitial'].url}/terms` }), waits.sleep);
    assert.equal(report.verdict, 'stop');
    assert.ok(waits.waits.includes(g.SILENT_CHALLENGE_GRACE_MS));
  });

  test('a TDM reservation on the page (meta or header) skips the site', async () => {
    const meta = await capture(options(`${sites['site-tdm-meta'].url}/`, { dryRun: true }));
    assert.equal(meta.verdict, 'skip-site');
    assert.equal(meta.code, 'tdm');
    const header = await serve({ '/robots.txt': { body: 'User-agent: *\nAllow: /\n' }, '/': { headers: { 'content-type': 'text/html', 'content-usage': 'ai-use=n' }, body: htmlPage('Reserved by header') } });
    const byHeader = await capture(options(`${header.url}/`, { dryRun: true }));
    assert.equal(byHeader.verdict, 'skip-site');
    assert.equal(byHeader.code, 'tdm');
  });

  test('redirects: another origin or a disallowed path is aborted before any request reaches it; an allowed hop is followed', async () => {
    const elsewhere = await serve({ '/': { headers: { 'content-type': 'text/html' }, body: htmlPage('Elsewhere') } });
    const moving = await serve({
      '/robots.txt': { body: 'User-agent: *\nDisallow: /private\n' },
      '/': { status: 302, headers: { location: `${elsewhere.url}/` } },
      '/old': { status: 301, headers: { location: '/private/page' } },
      '/hop': { status: 302, headers: { location: '/landing' } },
      '/landing': { headers: { 'content-type': 'text/html' }, body: htmlPage('Landing') },
      '/private/page': { headers: { 'content-type': 'text/html' }, body: htmlPage('Private') },
    });
    const away = await capture(options(`${moving.url}/`, { dryRun: true }));
    assert.equal(away.verdict, 'skip-site');
    assert.equal(away.code, 'redirect');
    assert.equal(elsewhere.requests.length, 0);
    const disallowed = await capture(options(`${moving.url}/old`, { dryRun: true }));
    assert.equal(disallowed.code, 'redirect');
    assert.match(disallowed.reason, /robots\.txt disallows/);
    assert.equal(moving.requests.some((r) => r.url.startsWith('/private')), false);
    const followed = await capture(options(`${moving.url}/hop`, { dryRun: true }));
    assert.equal(followed.verdict, 'allowed', followed.reason);
    assert.equal(followed.finalUrl, `${moving.url}/landing`);
  });

  test('a captures folder inside the project is refused before any request', async () => {
    const quiet = await serve({ '/robots.txt': { body: 'User-agent: *\nAllow: /\n' }, '/': { headers: { 'content-type': 'text/html' }, body: htmlPage('Quiet') } });
    const report = await capture(options(`${quiet.url}/`, { out: path.join(project, 'captures'), termsReviewed: `${quiet.url}/terms` }));
    assert.equal(report.verdict, 'refused');
    assert.equal(report.code, 'storage');
    assert.equal(quiet.requests.length, 0);
  });
});

describe('capture.mjs CLI', () => {
  test('--help exits 0 and offers no identity, headed, proxy or retry option; an identity flag exits 2', () => {
    const help = spawnSync(process.execPath, [CAPTURE_CLI, '--help'], { encoding: 'utf8', windowsHide: true });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^Usage:/);
    for (const forbidden of ['--user-agent', '--ua', '--headed', '--headless', '--proxy', '--stealth', '--retry']) assert.equal(help.stdout.includes(forbidden), false, forbidden);
    const bad = spawnSync(process.execPath, [CAPTURE_CLI, '--url', 'https://example.com/', '--dry-run', '--headed'], { encoding: 'utf8', windowsHide: true });
    assert.equal(bad.status, 2);
    const noRoot = spawnSync(process.execPath, [CAPTURE_CLI, '--url', 'https://example.com/'], { encoding: 'utf8', windowsHide: true });
    assert.equal(noRoot.status, 2);
    assert.match(noRoot.stderr, /--root/);
  });

  test('a dry run exits 0 with the JSON report; a refusal exits 1 and still prints the verdict', async () => {
    const out = scratch('cli');
    const ok = await runCli([CAPTURE_CLI, '--url', `${sites['site-light'].url}/`, '--dry-run', '--out', out, '--json']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).verdict, 'allowed');
    const wall = await serve({ '/robots.txt': { status: 429, body: 'slow down' } });
    const state = scratch('cli-state');
    const refused = await runCli([CAPTURE_CLI, '--url', `${wall.url}/`, '--root', project, '--state', state, '--terms-reviewed', `${wall.url}/terms`, '--out', out, '--json']);
    assert.equal(refused.status, 1, refused.stderr);
    const report = JSON.parse(refused.stdout);
    assert.equal(report.verdict, 'stop');
    assert.equal(report.code, 'robots-refused');
  });
});
