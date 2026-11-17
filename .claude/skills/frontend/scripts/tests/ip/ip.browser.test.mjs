// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GATES, buildCopyIndex, capturedCopy, run } from '../../ip-check.mjs';
import { launch } from '../../lib/browser.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { aggregate } from '../../lib/report.mjs';
import { serveStatic } from '../../lib/serve.mjs';
import { makeWorkspace } from './helpers.mjs';

/** @typedef {import('playwright-core').Browser} Browser */
/** @typedef {import('../../lib/report.mjs').GateResult} GateResult */

const DESKTOP = { name: 'desktop', width: 1280, height: 800, dpr: 1, isMobile: false, hasTouch: false };
const PHONE = { name: 'mobile', width: 390, height: 844, dpr: 2, isMobile: true, hasTouch: true };
const ROUTES = [{ path: '/', name: 'home', first: true, features: [], states: [] }];

/** @type {Browser} */
let browser;
/** @type {ReturnType<typeof makeWorkspace>} */
let ws;

/**
 * @param {string} root
 * @param {{state?: string | null, serve?: boolean, sponsors?: string[], viewports?: typeof DESKTOP[]}} [options]
 */
async function check(root, { state, serve = true, sponsors = ['testchain'], viewports = [DESKTOP] } = {}) {
  const site = serve ? await serveStatic(path.join(root, 'dist')) : null;
  try {
    const profile = defaultProfile({ sponsors });
    /** @type {import('../../ip-check.mjs').CheckContext} */
    const ctx = {
      root,
      profile,
      state: state === undefined ? ws.state : state,
      design: path.join(root, 'design'),
      routes: ROUTES,
      baseUrl: site ? site.url : null,
      browser: site ? browser : null,
      viewports,
      args: { serve: serve ? path.join(root, 'dist') : undefined, 'sponsor-allowlist': ws.sponsorFile },
      log: () => undefined,
    };
    const results = await run(ctx);
    return Object.fromEntries(results.map((r) => [r.id, r]));
  } finally {
    await site?.close();
  }
}

/**
 * @param {GateResult} g
 * @param {RegExp} pattern
 */
function hasEvidence(g, pattern) {
  return g.evidence.some((e) => pattern.test(JSON.stringify(e)));
}

describe('browser: ip-check gates', () => {
  /** @type {Record<string, GateResult>} */
  let pass;
  /** @type {Record<string, GateResult>} */
  let fail;

  before(async () => {
    ws = makeWorkspace();
    browser = await launch();
    pass = await check(ws.pass, { viewports: [DESKTOP, PHONE] });
    fail = await check(ws.fail);
  });

  after(async () => {
    await browser?.close();
    if (ws) rmSync(ws.tmp, { recursive: true, force: true });
  });

  test('the passing repository passes every gate', () => {
    for (const meta of GATES) assert.equal(pass[meta.id]?.state, 'ok', `${meta.id}: ${pass[meta.id]?.detail}`);
    assert.equal(aggregate(Object.values(pass)).ok, true);
  });

  test('ip.fonts: open licence beside the file passes; RFN subset, no licence and a sponsor-kit face fail', () => {
    assert.match(pass['ip.fonts'].detail, /1 font file/);
    const f = fail['ip.fonts'];
    assert.equal(f.state, 'fail');
    assert.ok(hasEvidence(f, /plexish-latin\.woff2.*Reserved Font Name.*Plexish/), 'the Plexish subset keeps its RFN');
    assert.ok(hasEvidence(f, /nolicence\.woff2.*no licence file/), 'a font without a licence file');
    assert.ok(hasEvidence(f, /kitgrotesk\.woff2.*brand kit/), 'a sponsor-kit face');
  });

  test('ip.hotlinks: sources, built files and runtime requests to Google Fonts fail', () => {
    assert.equal(pass['ip.hotlinks'].state, 'ok');
    const h = fail['ip.hotlinks'];
    assert.equal(h.state, 'fail');
    assert.ok(hasEvidence(h, /src\/styles\.css/), 'the @import in the sources');
    assert.ok(hasEvidence(h, /runtime request/), 'the stylesheet request, blocked');
    assert.ok(hasEvidence(h, /preconnect/), 'the preconnect link');
  });

  test('ip.logos: the allowed sponsor file passes; a logo row, partner files and a text-only sponsor file fail', () => {
    assert.ok(hasEvidence(pass['ip.logos'], /testchain horizontal-blue/), 'the allowed official file is listed');
    const l = fail['ip.logos'];
    assert.equal(l.state, 'fail');
    assert.ok(hasEvidence(l, /partner-northwind\.svg/));
    assert.ok(hasEvidence(l, /deniedchain.*text_only/));
    assert.ok(hasEvidence(l, /similar small images in a row|Trusted by/));
  });

  test('ip.provenance: complete entries pass (a stale entry is only a note); missing and invalid entries fail', () => {
    assert.ok(hasEvidence(pass['ip.provenance'], /old-banner\.png.*no longer exists/));
    const p = fail['ip.provenance'];
    assert.equal(p.state, 'fail');
    assert.ok(hasEvidence(p, /partner-fjord\.svg.*no provenance entry/));
    assert.ok(hasEvidence(p, /deniedchain-logo\.svg.*ai must be/));
  });

  test('ip.concept-label: a labelled section passes; a customer named without a label fails', () => {
    assert.match(pass['ip.concept-label'].detail, /labelled mention/);
    const c = fail['ip.concept-label'];
    assert.equal(c.state, 'fail');
    assert.ok(hasEvidence(c, /Fjord Pay/));
  });

  test('ip.copy-overlap: boilerplate shared by two references is ignored; a copied customer sentence fails', () => {
    assert.match(pass['ip.copy-overlap'].detail, /boilerplate/);
    const o = fail['ip.copy-overlap'];
    assert.equal(o.state, 'fail');
    assert.ok(hasEvidence(o, /settle every cross border invoice in seconds/));
    assert.ok(hasEvidence(o, /Fjord Pay/));
  });

  test('ip.sponsor-marks: treatment, size, lockup, notice and phrases', () => {
    assert.match(pass['ip.sponsor-marks'].detail, /sponsor logo rendering/);
    const s = fail['ip.sponsor-marks'];
    assert.equal(s.state, 'fail');
    assert.ok(hasEvidence(s, /rotated or skewed/), 'rotation');
    assert.ok(hasEvidence(s, /below the 64 px minimum/), 'minimum size');
    assert.ok(hasEvidence(s, /clear-space unit/), 'lockup with the project mark');
    assert.ok(hasEvidence(s, /trademark notice/), 'missing notice');
    assert.ok(hasEvidence(s, /Testchain's/), 'possessive');
    assert.ok(hasEvidence(s, /Official Testchain/), 'implied endorsement');
  });

  test('without rendered pages the runtime gates are skipped and the report is not ok', async () => {
    const results = await check(ws.pass, { serve: false });
    for (const id of ['ip.hotlinks', 'ip.logos', 'ip.concept-label', 'ip.copy-overlap', 'ip.sponsor-marks']) {
      assert.equal(results[id].state, 'skipped', `${id}: ${results[id].detail}`);
    }
    assert.equal(results['ip.fonts'].state, 'ok', 'fonts on disk are still checked');
    assert.equal(results['ip.provenance'].state, 'ok');
    const report = aggregate(Object.values(results));
    assert.equal(report.ok, false, 'a skipped gate never counts as passing');
    assert.equal(aggregate(Object.values(results), { allowSkip: ['ip'] }).ok, true, 'only an explicit allow-skip lets it pass');
  });

  test('a repository whose files already fail is failed even without pages', async () => {
    const results = await check(ws.fail, { serve: false });
    assert.equal(results['ip.hotlinks'].state, 'fail', 'the source @import fails without a browser');
    assert.equal(results['ip.logos'].state, 'fail', 'logo files fail without a browser');
  });

  test('ip.concept-label is skipped without a brief; ip.copy-overlap is skipped once captures are purged without an index', async () => {
    const results = await check(ws.pass, { state: ws.emptyState });
    assert.equal(results['ip.concept-label'].state, 'skipped');
    assert.match(results['ip.concept-label'].detail, /brief\.json/);
    assert.equal(results['ip.copy-overlap'].state, 'ok', 'no capture was ever listed: nothing to overlap');
  });
  test('ip.copy-overlap after the purge: skipped without an index, still measured with copy-shingles.json', async () => {
    const purged = path.join(ws.tmp, 'state-purged');
    mkdirSync(purged, { recursive: true });
    writeFileSync(path.join(purged, 'brief.json'), JSON.stringify({ customers: [{ name: 'Fjord Pay' }] }));
    writeFileSync(path.join(purged, 'refs-index.json'), JSON.stringify({ captures: [{ id: 'R1', customer: 'Fjord Pay', dir: path.join(ws.tmp, 'gone') }] }));
    const skipped = await check(ws.fail, { state: purged });
    assert.equal(skipped['ip.copy-overlap'].state, 'skipped');
    assert.match(skipped['ip.copy-overlap'].detail, /purged/);
    writeFileSync(path.join(purged, 'copy-shingles.json'), JSON.stringify(buildCopyIndex(capturedCopy(ws.state).captured)));
    const measured = await check(ws.fail, { state: purged });
    assert.equal(measured['ip.copy-overlap'].state, 'fail');
    assert.match(measured['ip.copy-overlap'].detail, /shared with captured customer copy/);
    const clean = await check(ws.pass, { state: purged });
    assert.equal(clean['ip.copy-overlap'].state, 'ok', clean['ip.copy-overlap'].detail);
  });

  test('CLI with --serve: exit 1 on the failing build, exit 0 on the passing one', () => {
    const cli = fileURLToPath(new URL('../../ip-check.mjs', import.meta.url));
    const args = (/** @type {string} */ root) => [cli, '--root', root, '--serve', path.join(root, 'dist'), '--state', ws.state, '--sponsor-allowlist', ws.sponsorFile, '--gates', 'ip.hotlinks,ip.logos', '--json'];
    const bad = spawnSync(process.execPath, args(ws.fail), { encoding: 'utf8' });
    assert.equal(bad.status, 1, bad.stderr);
    assert.deepEqual(JSON.parse(bad.stdout).gates.map((/** @type {{state: string}} */ g) => g.state), ['fail', 'fail']);
    const good = spawnSync(process.execPath, args(ws.pass), { encoding: 'utf8' });
    assert.equal(good.status, 0, [good.stdout, good.stderr].join(' | '));
  });
});
