// @ts-check
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import * as g from '../../capture-gate.mjs';
import * as x from '../../extract.mjs';
import { UsageError, CheckError } from '../../lib/errors.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { aggregate } from '../../lib/report.mjs';
import { fixture, readFixture, removeDir, tempDir, writeJsonFile } from './helpers.mjs';

/**
 * @typedef {import('../../extract.mjs').El} El
 * @typedef {import('../../extract.mjs').TextRec} TextRec
 * @typedef {import('../../extract.mjs').NumRec} NumRec
 * @typedef {import('../../extract.mjs').ViewportData} ViewportData
 */

/** @type {string[]} */
const cleanup = [];
after(() => {
  for (const dir of cleanup) removeDir(dir);
});

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
 * @param {number} i
 * @param {Partial<El>} over
 * @returns {El}
 */
function el(i, over = {}) {
  return { sel: `e${i}`, tag: 'div', role: '', box: { x: 0, y: 0, w: 100, h: 40 }, visible: true, text: '', styles: {}, attrs: {}, meta: {}, parent: i === 0 ? -1 : 0, depth: i === 0 ? 0 : 1, ...over };
}

/**
 * @param {string} sel
 * @param {string} text
 * @param {Partial<TextRec>} [over]
 * @returns {TextRec}
 */
function txt(sel, text, over = {}) {
  return { sel, text, fontSize: 16, fontFamily: 'Arial, sans-serif', fontWeight: 400, color: 'rgb(26, 26, 26)', bg: 'rgb(255, 255, 255)', bgImage: null, box: { x: 0, y: 100, w: 300, h: 24 }, inViewport: true, visible: true, tag: 'p', ...over };
}

/**
 * @param {string} text
 * @param {Partial<NumRec>} [over]
 * @returns {NumRec}
 */
function num(text, over = {}) {
  return { sel: `n-${text}`, tag: 'div', text, context: '', fontSize: 16, fontWeight: 400, fontFamily: 'Arial', fontVariantNumeric: 'normal', fontFeatureSettings: 'normal', color: 'rgb(0, 0, 0)', box: { x: 0, y: 500, w: 100, h: 40 }, inViewport: true, interactive: false, ...over };
}

/**
 * @param {Partial<ViewportData>} over
 * @returns {ViewportData}
 */
function viewport(over = {}) {
  return {
    name: 'desktop',
    page: { width: 1440, height: 900, dpr: 1, scrollWidth: 1440, scrollHeight: 2000, colorScheme: 'normal', rootBackground: 'rgb(255, 255, 255)', bodyBackground: 'rgb(255, 255, 255)', rootFontSize: 16, jpegQ70Bytes: 64_000 },
    readiness: { ok: true, detail: '' },
    elements: [el(0, { tag: 'body', box: { x: 0, y: 0, w: 1440, h: 2000 }, styles: { backgroundColor: 'rgb(255, 255, 255)' } })],
    text: [],
    numbers: [],
    landmarks: { landmarks: [], sections: [], canvases: [], consent: [] },
    reveal: {},
    fonts: {},
    declared: {},
    states: [],
    ...over,
  };
}

describe('type: histogram, body size, scale ratio', () => {
  test('the body is the size with most characters between 12 and 24 px', () => {
    const hist = x.fontSizeHistogram([txt('a', 'x'.repeat(300), { fontSize: 16 }), txt('b', 'y'.repeat(100), { fontSize: 20 }), txt('c', 'z'.repeat(400), { fontSize: 11 })]);
    assert.equal(hist.total, 800);
    assert.equal(x.bodySize(hist.bins), 16);
    assert.equal(x.bodySize([]), null);
  });

  test('positive: a modular scale is fitted and named; negative: irregular steps have no fit', () => {
    const fit = x.fitScaleRatio([16, 20, 31.25, 39.06, 48.83], 16);
    assert.equal(fit.fit, 'exact');
    assert.equal(fit.ratio, 1.25);
    assert.equal(fit.named, 'major third');
    assert.deepEqual(fit.powers, [1, 3, 4, 5]);
    const fourth = x.fitScaleRatio([16, 21.33, 28.43, 37.9], 16);
    assert.equal(fourth.named, 'perfect fourth');
    assert.equal(x.fitScaleRatio([16, 16.5, 24], 16).fit, 'none');
    assert.equal(x.fitScaleRatio([16, 20], 16).fit, 'insufficient');
  });
});

describe('spacing and radius', () => {
  test('positive: an 8 px rhythm gives base 8; negative: scattered values give no base', () => {
    const grid = x.spacingOf(x.prepare(viewport({ elements: [8, 24, 40, 8, 24, 56, 8, 24].map((v, i) => el(i, { styles: { paddingTop: `${v}px` } })) })));
    assert.equal(grid.base, 8);
    assert.equal(grid.coverage['8'], 1);
    const scattered = x.spacingOf(x.prepare(viewport({ elements: [7, 13, 22, 31, 9, 17].map((v, i) => el(i, { styles: { paddingTop: `${v}px` } })) })));
    assert.equal(scattered.base, null);
  });

  test('positive: pill buttons make a pill family; negative: square corners make a sharp one', () => {
    /** @param {string} radius */
    const page = (radius) => {
      const elements = [el(0, { tag: 'body', box: { x: 0, y: 0, w: 1440, h: 2000 } })];
      for (let i = 1; i <= 4; i += 1) elements.push(el(i, { tag: 'a', text: 'Go', meta: { href: '/go' }, box: { x: 100 * i, y: 300, w: 120, h: 40 }, styles: { backgroundColor: 'rgb(240, 185, 11)', borderRadius: radius } }));
      const prep = x.prepare(viewport({ elements }));
      return x.radiusOfPage(prep, x.callsToAction(prep));
    };
    const pill = page('9999px');
    assert.equal(pill.family, 'pill');
    assert.equal(pill.buttons?.shape, 'pill');
    const sharp = page('0px');
    assert.equal(sharp.family, 'sharp');
    assert.equal(sharp.buttons?.shape, 'sharp');
  });
});

describe('palette, ground and calls to action', () => {
  const elements = [
    el(0, { tag: 'body', box: { x: 0, y: 0, w: 1440, h: 2000 }, styles: { backgroundColor: 'rgb(255, 255, 255)' } }),
    el(1, { tag: 'section', box: { x: 0, y: 1200, w: 1440, h: 400 }, styles: { backgroundColor: 'rgb(17, 17, 17)' } }),
    el(2, { tag: 'a', text: 'Get started', meta: { href: '/go' }, box: { x: 100, y: 400, w: 160, h: 44 }, styles: { backgroundColor: 'rgb(47, 91, 211)', borderRadius: '6px' } }),
    el(3, { tag: 'a', text: 'Read the docs', meta: { href: '/docs' }, box: { x: 300, y: 400, w: 160, h: 44 }, styles: { borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderTopColor: 'rgb(26, 26, 26)', borderRightColor: 'rgb(26, 26, 26)', borderBottomColor: 'rgb(26, 26, 26)', borderLeftColor: 'rgb(26, 26, 26)' } }),
    el(4, { tag: 'a', text: 'plain link', meta: { href: '/x' }, box: { x: 500, y: 400, w: 80, h: 24 } }),
    el(5, { meta: { id: 'cookie-banner' }, box: { x: 1000, y: 800, w: 400, h: 100 }, styles: { backgroundColor: 'rgb(255, 0, 170)' } }),
    el(6, { tag: 'button', text: 'Accept', parent: 5, depth: 2, box: { x: 1100, y: 820, w: 100, h: 40 }, styles: { backgroundColor: 'rgb(255, 0, 170)' } }),
  ];
  const text = [
    txt('e0', 'Body text '.repeat(40)),
    txt('e2', 'Get started', { color: 'rgb(255, 255, 255)', bg: 'rgb(47, 91, 211)', tag: 'a' }),
    txt('e4', 'a default link', { color: 'rgb(0, 0, 238)', tag: 'a' }),
    txt('e6', 'Accept', { color: 'rgb(255, 255, 255)', bg: 'rgb(255, 0, 170)', tag: 'button' }),
  ];

  test('positive: ground by painted area, ink by text, accent by the filled call to action; consent and browser defaults left out', () => {
    const prep = x.prepare(viewport({ elements, text }));
    const ctas = x.callsToAction(prep);
    assert.deepEqual(ctas.map((c) => [prep.els[c.i].sel, c.filled, c.outline]), [['e2', true, false], ['e3', false, true]]);
    const paint = x.paintGrid(prep);
    const palette = x.paletteOf(prep, paint, ctas);
    assert.equal(palette.ground?.color, '#ffffff');
    assert.equal(palette.ink?.color, '#1a1a1a');
    assert.equal(palette.accent?.color, '#2f5bd3');
    assert.equal(palette.accent?.chromatic, true);
    assert.equal(palette.accentCount, 1);
    assert.ok(palette.excluded.includes('#0000ee (browser default link colour)'));
    assert.ok(palette.excluded.some((e) => /2 elements of cookie or consent widgets/.test(e)));
    assert.ok(!palette.ctaBackgrounds.some((c) => c.color === '#ff00aa'));
    assert.equal(x.groundMode(palette, paint).mode, 'light');
    assert.ok(paint.darkShare > 0.1 && paint.darkShare < 0.3);
    assert.deepEqual(x.ctaCounts(ctas).aboveFold, { filled: 1, outline: 1, inNav: 0, outsideNav: 2, total: 2 });
  });

  test('negative: a dark ground reads dark; a page with no filled call to action takes its accent from link text', () => {
    const dark = viewport({
      page: { width: 1440, height: 900, dpr: 1, scrollWidth: 1440, scrollHeight: 900, colorScheme: 'dark', rootBackground: 'rgb(11, 13, 18)', bodyBackground: 'rgb(11, 13, 18)', rootFontSize: 16 },
      elements: [el(0, { tag: 'body', box: { x: 0, y: 0, w: 1440, h: 900 } }), el(1, { tag: 'a', text: 'Docs', meta: { href: '/d' }, box: { x: 10, y: 10, w: 60, h: 24 } })],
      text: [txt('e0', 'x'.repeat(200), { color: 'rgb(230, 230, 230)', bg: 'rgb(11, 13, 18)' }), txt('e1', 'Docs and more docs', { color: 'rgb(0, 200, 120)', bg: 'rgb(11, 13, 18)', tag: 'a' })],
    });
    const prep = x.prepare(dark);
    const ctas = x.callsToAction(prep);
    assert.equal(ctas.length, 0);
    const paint = x.paintGrid(prep);
    const palette = x.paletteOf(prep, paint, ctas);
    assert.equal(x.groundMode(palette, paint).mode, 'dark');
    assert.equal(palette.accent?.color, '#00c878');
    assert.match(String(palette.accent?.basis), /link text/);
  });

  test('hue families and neutral steps are counted, not listed', () => {
    assert.equal(x.clusterHues([]), 0);
    assert.equal(x.clusterHues([250, 260, 265]), 1);
    assert.equal(x.clusterHues([10, 250, 355]), 2);
    assert.equal(x.clusterLightness([0.1, 0.11, 0.5, 0.95, 0.97]), 3);
  });
});

describe('nav, figures and number formatting', () => {
  test('positive: a top navigation with its items; negative: none', () => {
    const vp = viewport({
      elements: [el(0, { tag: 'body' }), el(1, { tag: 'header', box: { x: 0, y: 0, w: 1440, h: 64 }, styles: { position: 'sticky' } }), el(2, { tag: 'nav', parent: 1, depth: 2, sel: 'nav', box: { x: 200, y: 20, w: 400, h: 24 } })],
      landmarks: { landmarks: [{ sel: 'nav', tag: 'nav', role: 'navigation', box: { x: 200, y: 20, w: 400, h: 24 }, depth: 1, position: 'static', label: '', heading: null, links: 4, buttons: 0, consent: false }], sections: [], canvases: [], consent: [] },
    });
    const nav = x.navOf(x.prepare(vp), null);
    assert.deepEqual({ present: nav.present, position: nav.position, items: nav.items, sticky: nav.sticky }, { present: true, position: 'top', items: 4, sticky: true });
    assert.equal(x.navOf(x.prepare(viewport()), null).present, false);
  });

  test('positive: three large figures side by side with labels below; negative: numbers in running text', () => {
    const figures = ['$16,661,271', '2.30%', '1,240'].map((t, i) => num(t, { sel: `f${i}`, fontSize: 39, box: { x: 100 + 300 * i, y: 500, w: 240, h: 48 }, fontVariantNumeric: 'tabular-nums' }));
    const labels = ['Settled', 'Fee', 'Teams'].map((t, i) => txt(`l${i}`, t, { fontSize: 12.8, box: { x: 100 + 300 * i, y: 552, w: 120, h: 16 } }));
    const body = txt('p', 'x'.repeat(300), { fontSize: 16 });
    const prep = x.prepare(viewport({ numbers: figures, text: [body, ...labels] }));
    const found = x.figuresOf(prep, 16);
    assert.equal(found.row.present, true);
    assert.equal(found.row.count, 3);
    assert.equal(found.row.labels, 'below');
    assert.equal(found.row.inFirstViewport, true);
    const prose = x.figuresOf(x.prepare(viewport({ numbers: [num('founded in 2019 and run from 3 cities', { fontSize: 18 })] })), 18);
    assert.equal(prose.row.present, false);
    assert.equal(prose.figures, 0);
  });

  test('number tokens: thousands, decimals and the ambiguous single separator', () => {
    assert.deepEqual(x.numberFormat('16,661,271'), { decimals: 0, thousands: ',', decimal: null, ambiguous: false });
    assert.deepEqual(x.numberFormat('2.30'), { decimals: 2, decimal: '.', thousands: null, ambiguous: false });
    assert.deepEqual(x.numberFormat('1.234,56'), { decimals: 2, decimal: ',', thousands: '.', ambiguous: false });
    assert.equal(x.numberFormat('1,240').ambiguous, true);
    assert.equal(x.numberFormat('2019').decimals, 0);
  });

  test('positive: tabular figures, currency prefix and masked shapes; negative: proportional digits', () => {
    const tabular = x.numbersOf(x.prepare(viewport({ numbers: [num('$16,661,271', { fontVariantNumeric: 'tabular-nums' }), num('2.30%', { fontFeatureSettings: '"tnum"' })] })));
    assert.equal(tabular.tabular.share, 1);
    assert.equal(tabular.currency.prefix, 1);
    assert.equal(tabular.percent, 1);
    assert.deepEqual(tabular.shapes.map((s) => s.shape).sort(), ['$99,999,999', '9.99%']);
    const proportional = x.numbersOf(x.prepare(viewport({ numbers: [num('Total supply 5.4B', { fontFeatureSettings: '"tnum" 0' })] })));
    assert.equal(proportional.tabular.share, 0);
    assert.equal(proportional.magnitudeSuffix, 1);
    assert.deepEqual(proportional.shapes.map((s) => s.shape), ['9.9B'], 'the words around a number are never kept');
  });
});

describe('related references', () => {
  test('registrable domains, owner keys and groups', () => {
    assert.equal(x.registrableDomain('www.app.example.com'), 'example.com');
    assert.equal(x.registrableDomain('shop.example.co.uk'), 'example.co.uk');
    assert.equal(x.registrableDomain('acme.github.io'), 'acme.github.io');
    assert.equal(x.ownerKey('Uniswap Labs'), x.ownerKey('Uniswap'));
    assert.equal(x.ownerKey('Stripe, Inc.'), 'stripe');
    const groups = x.relatedGroups([
      { id: 'R1', customer: 'Ledgerline Ltd', url: 'https://light.example/' },
      { id: 'R2', customer: 'Ledgerline Labs', url: 'https://other.example/' },
      { id: 'R3', customer: 'Nightdesk', url: 'https://app.light.example/' },
      { id: 'R4', customer: 'Clearline', url: 'https://clear.example/' },
      { id: 'R5', customer: 'Fixture A', url: 'http://127.0.0.1:5001/' },
      { id: 'R6', customer: 'Fixture B', url: 'http://127.0.0.1:5002/' },
    ]);
    assert.equal(groups.get('R1'), groups.get('R2'));
    assert.equal(groups.get('R1'), groups.get('R3'));
    assert.notEqual(groups.get('R1'), groups.get('R4'));
    assert.notEqual(groups.get('R5'), groups.get('R6'), 'loopback ports are separate sites');
  });
});

describe('refs.ledger', () => {
  /** @param {string} name */
  const problems = (name) => x.checkLedger(JSON.parse(readFixture('ledger', name))).problems;

  test('passing fixture: two unrelated owners plus the owner\'s notes, facts and conventions, exclusions', () => {
    assert.deepEqual(problems('pass.json'), []);
  });

  test('failing fixtures each name their problem', () => {
    assert.ok(problems('fail-related.json').some((p) => /P1 \(convention\) rests on R1, R2, which share an owner/.test(p)));
    assert.ok(problems('fail-unknown-ref.json').some((p) => /unknown reference\(s\) R9/.test(p)));
    assert.ok(problems('fail-no-excluded.json').some((p) => /excluded must be present/.test(p)));
    assert.ok(problems('fail-hex-statement.json').some((p) => /carries a colour value \(#2f5bd3\)/.test(p)));
    const oneSite = problems('fail-one-site.json');
    assert.ok(oneSite.some((p) => /two pages of light\.example/.test(p)));
    assert.ok(oneSite.some((p) => /1 unrelated owner/.test(p)));
    assert.ok(problems('fail-too-many-hosts.json').some((p) => /5 hosts referenced/.test(p)));
    const shape = problems('fail-shape.json');
    for (const re of [/customer is empty/, /url must be an absolute http/, /captured_at/, /viewports must list/, /purged must be true or false/, /unknown field\(s\) screenshot/, /kind must be one of/, /statement is empty/, /not_borrowed is empty/, /duplicate pattern id/, /from lists a reference twice/, /excluded\[0\]/, /unknown top-level key\(s\) notes/]) {
      assert.ok(shape.some((p) => re.test(p)), String(re));
    }
  });
});

describe('refs.receipts and the gate wiring', () => {
  /**
   * A capture folder with real records (manifest, gate receipt), optionally purged.
   * @param {string} root the ledger folder
   * @param {string} host
   * @param {{purge?: boolean, url?: string}} [options]
   * @returns {string}
   */
  function makeCapture(root, host, { purge = true, url = `https://${host}/` } = {}) {
    const dir = path.join(root, 'captures', host, 'index');
    mkdirSync(path.join(dir, 'slices'), { recursive: true });
    writeFileSync(path.join(dir, 'slices', 'desktop-00.png'), 'png');
    writeFileSync(path.join(dir, 'styles.json'), '{}\n');
    const at = host === 'light.example' ? '2026-10-01T10:00:00.000Z' : '2026-10-01T10:05:00.000Z';
    g.writeCaptureRecords(dir, {
      manifest: { url, host, slug: 'index', capturedAt: at, deleteBy: '2099-01-01T00:00:00.000Z', viewports: [{ name: 'desktop' }, { name: 'mobile' }], files: g.fileEntries(dir, ['slices/desktop-00.png', 'styles.json']) },
      receipt: { tool: 'capture-gate', url, host, slug: 'index', capturedAt: at, verdict: 'captured', userAgent: `Mozilla/5.0 HeadlessChrome/147${g.UA_SUFFIX}`, termsReviewed: `https://${host}/terms` },
    });
    if (purge) g.purgeCapture(dir);
    return dir;
  }

  /**
   * @param {{purge?: boolean, darkUrl?: string}} [options]
   * @returns {{root: string, ledger: string}}
   */
  function setup({ purge = true, darkUrl } = {}) {
    const root = scratch('receipts');
    makeCapture(root, 'light.example', { purge });
    makeCapture(root, 'dark.example', { purge, url: darkUrl });
    const ledger = path.join(root, 'pattern-ledger.json');
    copyFileSync(fixture('ledger', 'pass.json'), ledger);
    return { root, ledger };
  }

  test('passing: receipts check out and every capture is purged; manual notes need nothing', () => {
    const { ledger } = setup();
    const [ledgerGate, receipts] = x.ledgerGates(ledger, ['refs.ledger', 'refs.receipts']);
    assert.equal(ledgerGate.state, 'ok', ledgerGate.detail);
    assert.equal(receipts.state, 'ok', receipts.detail);
    assert.match(receipts.detail, /2 captured reference\(s\) and 1 from the owner's notes/);
    assert.equal(aggregate([ledgerGate, receipts]).ok, true);
  });

  test('failing: captures still on disk, whether the ledger claims they were purged or not', () => {
    const { ledger } = setup({ purge: false });
    const [claimed] = x.ledgerGates(ledger, ['refs.receipts']);
    assert.equal(claimed.state, 'fail');
    const claimedText = claimed.evidence.map((e) => String(e.value)).join('\n');
    assert.match(claimedText, /R1: purged is true but .*deletion-receipt\.json does not exist/);
    assert.match(claimedText, /R1: 2 captured file\(s\) are still on disk/);
    const data = JSON.parse(readFileSync(ledger, 'utf8'));
    data.references = data.references.map((/** @type {Record<string, unknown>} */ r) => (r.receipt === 'manual-notes' ? r : { ...r, purged: false }));
    writeJsonFile(ledger, data);
    const [honest] = x.ledgerGates(ledger, ['refs.receipts']);
    assert.equal(honest.state, 'fail');
    assert.match(honest.detail, /captures still stored/);
    assert.match(honest.detail, /capture-gate\.mjs" purge/);
  });

  test('failing: a receipt for another URL, a manifest changed since the capture, a missing receipt', () => {
    const { root, ledger } = setup({ darkUrl: 'https://dark.example/pricing' });
    const manifest = path.join(root, 'captures', 'light.example', 'index', 'manifest.json');
    writeFileSync(manifest, readFileSync(manifest, 'utf8').replace('"slug": "index"', '"slug": "edited"'));
    const data = JSON.parse(readFileSync(ledger, 'utf8'));
    data.references.push({ id: 'R4', customer: 'Fourth', url: 'https://fourth.example/', page: '/', captured_at: '2026-10-01T10:20:00Z', viewports: ['desktop'], receipt: 'captures/fourth.example/index', purged: true });
    writeJsonFile(ledger, data);
    const [receipts] = x.ledgerGates(ledger, ['refs.receipts']);
    assert.equal(receipts.state, 'fail');
    const all = receipts.evidence.map((e) => String(e.value));
    assert.ok(all.some((p) => /R1: .*changed since the capture/.test(p)), all.join('\n'));
    assert.ok(all.some((p) => /R2: the ledger url https:\/\/dark\.example\/ differs/.test(p)), all.join('\n'));
    assert.ok(all.some((p) => /R4: receipt .* not found/.test(p)), all.join('\n'));
  });

  test('a capture listed in refs-index.json but not in the ledger must be purged too', () => {
    const { root, ledger } = setup();
    const stray = makeCapture(root, 'stray.example', { purge: false });
    const state = scratch('index-state');
    g.upsertRefsIndex(state, path.join(root, 'captures'), { dir: stray.replace(/\\/g, '/'), purged: false });
    const [receipts] = x.ledgerGates(ledger, ['refs.receipts'], { state });
    assert.equal(receipts.state, 'fail');
    assert.match(String(receipts.evidence.map((e) => e.value).join(' ')), /stray\.example.*not in the ledger/);
  });

  test('a missing ledger fails refs.ledger and skips refs.receipts, and a skipped gate makes the report fail', () => {
    const missing = path.join(scratch('nothing'), 'pattern-ledger.json');
    const results = x.ledgerGates(missing, ['refs.ledger', 'refs.receipts']);
    assert.deepEqual(results.map((r) => r.state), ['fail', 'skipped']);
    assert.equal(aggregate(results).ok, false);
    const receiptsOnly = x.ledgerGates(missing, ['refs.receipts']);
    assert.equal(aggregate(receiptsOnly).ok, false);
    assert.equal(aggregate(receiptsOnly, { allowSkip: ['refs.receipts'] }).ok, true);
  });

  test('run(ctx, selected) reads <state>/pattern-ledger.json and returns only the refs gates asked for', async () => {
    const { root } = setup();
    const results = await x.run({ root, profile: defaultProfile(), state: root }, ['refs.ledger', 'render.console']);
    assert.deepEqual(results.map((r) => [r.id, r.state]), [['refs.ledger', 'ok']]);
    assert.deepEqual(await x.run({ root, profile: defaultProfile(), state: root }, ['tells.tier1']), []);
    assert.deepEqual(x.GATES.map((gm) => gm.id), ['refs.ledger', 'refs.receipts']);
    for (const meta of x.GATES) assert.ok(meta.title && meta.ifDropped);
  });

  test('validate-ledger CLI: exit 0 on a passing ledger, a CheckError on a failing one, a UsageError on a missing path', async () => {
    const { ledger } = setup();
    let out = '';
    const code = await x.main(['validate-ledger', ledger, '--json'], { stdout: (s) => { out += s; }, stderr: () => {} });
    assert.equal(code, 0);
    const report = JSON.parse(out);
    assert.equal(report.ok, true);
    assert.equal(report.tool, 'extract');
    assert.deepEqual(report.counts, { ok: 2, fail: 0, skipped: 0 });
    const failing = path.join(scratch('failing'), 'pattern-ledger.json');
    copyFileSync(fixture('ledger', 'fail-related.json'), failing);
    await assert.rejects(x.main(['validate-ledger', failing, '--gates', 'refs.ledger'], { stdout: () => {}, stderr: () => {} }), CheckError);
    await assert.rejects(x.main(['validate-ledger', path.join(scratch('none'), 'nope.json')], { stdout: () => {}, stderr: () => {} }), UsageError);
    await assert.rejects(x.main(['validate-ledger', ledger, '--gates', 'refs.nonsense'], { stdout: () => {}, stderr: () => {} }), UsageError);
  });
});

describe('extract CLI on capture folders', () => {
  /**
   * A synthetic capture folder in capture.mjs's format.
   * @param {string} root
   * @returns {string}
   */
  function synthetic(root) {
    const dir = path.join(root, 'synthetic.example', 'index');
    const vp = viewport({
      elements: [
        el(0, { tag: 'body', box: { x: 0, y: 0, w: 1440, h: 2000 }, styles: { backgroundColor: 'rgb(255, 255, 255)' } }),
        el(1, { tag: 'a', text: 'Start', meta: { href: '/s' }, box: { x: 10, y: 300, w: 120, h: 40 }, styles: { backgroundColor: 'rgb(47, 91, 211)', paddingTop: '8px', paddingBottom: '8px' } }),
      ],
      text: [txt('e0', 'x'.repeat(200))],
    });
    writeJsonFile(path.join(dir, 'styles.json'), { kind: 'styles', mediaQueries: { count: 1, widths: [{ feature: 'max-width', px: 640, count: 1 }], texts: [] }, viewports: { desktop: { page: vp.page, readiness: vp.readiness, elements: vp.elements, text: vp.text, numbers: [], declared: {}, states: [] } } });
    writeJsonFile(path.join(dir, 'fonts.json'), { kind: 'fonts', viewports: { desktop: { samples: [{ role: 'h1', fonts: [{ familyName: 'Arial', isCustomFont: false }] }], loadedFaces: [] } } });
    writeJsonFile(path.join(dir, 'landmarks.json'), { kind: 'landmarks', viewports: { desktop: vp.landmarks } });
    writeJsonFile(path.join(dir, 'reveal.json'), { kind: 'reveal', viewports: { desktop: { revealedCount: 0 } } });
    g.writeCaptureRecords(dir, {
      manifest: { url: 'https://synthetic.example/', host: 'synthetic.example', slug: 'index', capturedAt: '2026-10-01T10:00:00.000Z', viewports: [{ name: 'desktop' }], files: g.fileEntries(dir, ['styles.json', 'fonts.json', 'landmarks.json', 'reveal.json']) },
      receipt: { tool: 'capture-gate', url: 'https://synthetic.example/', host: 'synthetic.example', slug: 'index', capturedAt: '2026-10-01T10:00:00.000Z', verdict: 'captured', userAgent: `UA${g.UA_SUFFIX}`, termsReviewed: 'https://synthetic.example/terms' },
    });
    return dir;
  }

  test('writes refs-extract.json next to the captures with a ledger_reference per reference', async () => {
    const root = scratch('extract-cli');
    synthetic(root);
    let out = '';
    const code = await x.main(['extract', root, '--json'], { stdout: (s) => { out += s; }, stderr: () => {} });
    assert.equal(code, 0);
    const result = JSON.parse(out);
    assert.equal(result.references.length, 1);
    assert.equal(result.references[0].ledger_reference.url, 'https://synthetic.example/');
    assert.deepEqual(result.references[0].breakpoints, [640]);
    assert.equal(existsSync(path.join(root, 'refs-extract.json')), true);
  });

  test('a capture whose files changed since the manifest, or a purged one, is not read', async () => {
    const root = scratch('extract-tampered');
    const dir = synthetic(root);
    writeFileSync(path.join(dir, 'reveal.json'), '{"edited": true}\n');
    assert.throws(() => x.loadCapture(dir), (err) => err instanceof UsageError && /changed since the capture/.test(err.message));
    const purgedRoot = scratch('extract-purged');
    g.purgeCapture(synthetic(purgedRoot));
    await assert.rejects(x.main(['extract', purgedRoot], { stdout: () => {}, stderr: () => {} }), (err) => err instanceof UsageError && /no capture folder/.test(err.message));
  });
});
