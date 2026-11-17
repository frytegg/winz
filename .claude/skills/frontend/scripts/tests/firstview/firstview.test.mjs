// @ts-check
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import {
  GATES, H1_WORDS, PROVISIONAL_BAND, SENTENCE_WORDS, contractProblems, evaluateComplexity, evaluateContract,
  firstViewports, namesSponsor, parseBand, resolveBand, run,
} from '../../firstview.mjs';
import { EnvError, UsageError } from '../../lib/errors.mjs';
import { DEFAULT_VIEWPORTS, defaultProfile, loadProfile } from '../../lib/profile.mjs';
import { aggregate } from '../../lib/report.mjs';

/**
 * @typedef {import('../../firstview.mjs').FirstviewProbe} FirstviewProbe
 * @typedef {import('../../firstview.mjs').Item} Item
 */

const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-firstview-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const SPONSORS = [{ id: 'cardano', name: 'Cardano' }];

/** @param {string} sel @param {string} text @param {{x?: number, y: number, w?: number, h: number}} box @returns {Item} */
const item = (sel, text, box) => ({ sel, text, visible: true, box: { x: box.x ?? 20, y: box.y, w: box.w ?? 600, h: box.h } });

/** @param {Partial<FirstviewProbe>} [over] @returns {FirstviewProbe} a first viewport that meets the contract at 1440x900 */
function goodProbe(over = {}) {
  return {
    viewport: { w: 1440, h: 900 },
    scroll: { x: 0, y: 0 },
    h1s: [item('h1', 'See when your withdrawal clears', { y: 60, h: 44 })],
    sentences: [item('p.lede', 'Lenders see where their withdrawal stands in the queue and when it becomes claimable.', { y: 112, h: 26 })],
    metrics: [{ ...item('span.figure', '2,100,000 tADA', { y: 200, h: 34, w: 220 }), ledger: null, source: 'testnet', asOf: '2026-10-01T10:00:00Z' }],
    surfaces: [item('section.product', 'Position 12', { y: 260, h: 320, w: 1060 })],
    texts: [{ sel: 'p.meta', text: 'Built on the Cardano blockchain, running on the preprod testnet.' }],
    ...over,
  };
}

describe('first-view contract (pure)', () => {
  test('a complete first viewport has no problem and reports what it found', () => {
    const { problems, found } = contractProblems(goodProbe(), SPONSORS);
    assert.deepEqual(problems, []);
    assert.deepEqual(found, [
      'h1 "See when your withdrawal clears" (5 words)',
      'sentence (14 words)',
      'sponsor Cardano (p.meta)',
      'figure "2,100,000 tADA" (testnet, as of 2026-10-01T10:00:00Z)',
      'product 320 px above the fold',
    ]);
  });

  test('each clause fails on its own defect', () => {
    const cases = /** @type {Array<[Partial<FirstviewProbe>, RegExp]>} */ ([
      [{ h1s: [] }, /no visible h1 in the first viewport/],
      [{ h1s: [item('h1', 'Below', { y: 1200, h: 40 })] }, /the h1 sits below the fold \(top at 1200 px of 900\)/],
      [{ h1s: [item('h1.a', 'Two words', { y: 10, h: 40 }), item('h1.b', 'Two more', { y: 60, h: 40 })] }, /2 h1 elements in the first viewport/],
      [{ h1s: [item('h1', 'One', { y: 60, h: 40 })] }, /the h1 has 1 word/],
      [{ h1s: [item('h1', 'A long headline that says many things at the same time', { y: 60, h: 40 })] }, /has 11 words .* keep it to 2 to 8/],
      [{ h1s: [item('h1', 'Cut at the fold', { y: 880, h: 60 })] }, /the h1 is cut by the edge of the first viewport/],
      [{ sentences: [] }, /no visible \[data-hero="sentence"\] in the first viewport/],
      [{ sentences: [item('p', 'Too short', { y: 120, h: 20 })] }, /the sentence has 2 words/],
      [{ texts: [{ sel: 'p', text: 'Built on a blockchain' }] }, /no sponsor name in the first viewport's text \(looked for Cardano\)/],
      [{ metrics: [] }, /no visible data-metric figure in the first viewport/],
      [{ metrics: [{ ...item('span', '12', { y: 200, h: 30 }), ledger: null, source: null, asOf: null }] }, /the figure "12" has no data-ledger, nor data-source with data-as-of/],
      [{ metrics: [{ ...item('span', '12', { y: 200, h: 30 }), ledger: null, source: 'testnet', asOf: '' }] }, /has no data-ledger, nor data-source with data-as-of/],
      [{ metrics: [{ ...item('span', 'not yet verified', { y: 200, h: 30 }), ledger: 'C-1', source: null, asOf: null }] }, /no visible data-metric figure/],
      [{ surfaces: [] }, /no visible \[data-surface="product"\]/],
      [{ surfaces: [item('section', 'p', { y: 1500, h: 300 })] }, /starts below the fold \(top at 1500 px of 900\)/],
      [{ surfaces: [item('section', 'p', { y: 840, h: 600 })] }, /only 60 px of the product surface show above the fold; at least 225 px are needed/],
    ]);
    for (const [over, expected] of cases) {
      const { problems } = contractProblems(goodProbe(over), SPONSORS);
      assert.equal(problems.length, 1, `${expected}: ${JSON.stringify(problems)}`);
      assert.match(problems[0].value, expected);
    }
  });

  test('a ledger id counts as a source; a project without sponsors needs no sponsor name', () => {
    const ledger = goodProbe({ metrics: [{ ...item('span', '2.1M', { y: 200, h: 30 }), ledger: 'C-001', source: null, asOf: null }] });
    assert.deepEqual(contractProblems(ledger, SPONSORS).problems, []);
    const { problems, found } = contractProblems(goodProbe({ texts: [] }), []);
    assert.deepEqual(problems, []);
    assert.match(found.join('\n'), /no sponsor in brief\.json or the profile/);
  });

  test('namesSponsor matches whole words, any case, any whitespace inside the name', () => {
    assert.equal(namesSponsor('BNB Chain', 'Settles on BNB\n  chain today'), true);
    assert.equal(namesSponsor('Cardano', 'cardano-based'), true);
    assert.equal(namesSponsor('Cardano', 'Cardanos'), false);
    assert.equal(namesSponsor('Ledger', 'the claims ledger'), true);
  });

  test('evaluateContract fails when any viewport fails, and when no page was loaded', () => {
    const route = { path: '/', name: 'home', first: true, features: [], states: [] };
    const desktop = { name: 'desktop', width: 1440, height: 900, dpr: 1, isMobile: false, hasTouch: false };
    const mobile = { name: 'mobile', width: 390, height: 844, dpr: 2, isMobile: true, hasTouch: true };
    const ok = evaluateContract({ pages: [{ route, viewport: desktop, url: '/', status: 200, probe: goodProbe(), error: null }], sponsors: SPONSORS });
    assert.equal(ok.ok, true, ok.detail);
    const bad = evaluateContract({
      pages: [
        { route, viewport: desktop, url: '/', status: 200, probe: goodProbe(), error: null },
        { route, viewport: mobile, url: '/', status: 200, probe: goodProbe({ viewport: { w: 390, h: 844 }, surfaces: [] }), error: null },
      ],
      sponsors: SPONSORS,
    });
    assert.equal(bad.ok, false);
    assert.match(bad.detail, /^first viewport incomplete at mobile: the h1 is cut by the edge of the first viewport/);
    const mobileProblems = bad.evidence.filter((e) => e.viewport === 'mobile' && e.selector !== undefined).map((e) => String(e.value));
    assert.ok(mobileProblems.includes('no visible [data-surface="product"]'), mobileProblems.join('\n'));
    assert.ok(!bad.evidence.some((e) => e.viewport === 'desktop' && /cut|no visible/.test(String(e.value))));
    assert.equal(evaluateContract({ pages: [], sponsors: SPONSORS }).ok, false);
  });

  test('firstViewports keeps desktop and mobile, else everything but reflow', () => {
    assert.deepEqual(firstViewports(DEFAULT_VIEWPORTS.map((v) => ({ ...v }))).map((v) => v.name), ['desktop', 'mobile']);
    const custom = [{ name: 'stage', width: 1536, height: 864, dpr: 1, isMobile: false, hasTouch: false }, { name: 'reflow', width: 320, height: 640, dpr: 1, isMobile: false, hasTouch: false }];
    assert.deepEqual(firstViewports(custom).map((v) => v.name), ['stage']);
  });

  test('the word bounds are the documented ones', () => {
    assert.deepEqual([H1_WORDS.min, H1_WORDS.max, SENTENCE_WORDS.min, SENTENCE_WORDS.max], [2, 8, 5, 40]);
  });
});

describe('first-view complexity (pure)', () => {
  test('the provisional band is advisory: out of band still passes, and says so', () => {
    const above = evaluateComplexity({ kib: 150, band: { ...PROVISIONAL_BAND }, from: 'provisional band' });
    assert.equal(above.ok, true);
    assert.equal(above.advisory, true, 'the report marks it advisory, never a passed check');
    assert.match(above.detail, /^advisory until calibrated: 150\.0 KiB as JPEG q70 at 1440x900, above the provisional band 38\.1-119\.7 KiB/);
  });

  test('a calibrated band passes within and fails above or below', () => {
    const band = { ...PROVISIONAL_BAND, min_kib: 40, max_kib: 120, calibrated: true };
    assert.equal(evaluateComplexity({ kib: 80, band, from: 'calibration' }).ok, true);
    assert.equal(evaluateComplexity({ kib: 80, band, from: 'calibration' }).advisory, false);
    const above = evaluateComplexity({ kib: 130.04, band, from: 'calibration' });
    assert.equal(above.ok, false);
    assert.match(above.detail, /130\.0 KiB .* above the calibrated band 40-120 KiB .*remove texture/);
    assert.match(evaluateComplexity({ kib: 12, band, from: 'calibration' }).detail, /emptier than every calibrated exemplar/);
  });

  test('parseBand fills the geometry defaults and refuses incoherent bands', () => {
    assert.deepEqual(parseBand({ min_kib: 10, max_kib: 50, calibrated: true }, 'x'), { ...PROVISIONAL_BAND, min_kib: 10, max_kib: 50, calibrated: true, source: 'x' });
    assert.throws(() => parseBand({ min_kib: 50, max_kib: 10 }, 'x'), (err) => err instanceof UsageError && /min_kib must be below max_kib/.test(err.message));
    assert.throws(() => parseBand({ max_kib: 10 }, 'x'), /min_kib and max_kib are required/);
    assert.throws(() => parseBand({ min_kib: 1, max_kib: 10, width: 0 }, 'x'), /width 0 is not valid/);
    assert.throws(() => parseBand('47-133', 'x'), UsageError);
  });

  test('resolveBand: the profile block, else the calibration file, else the provisional band', () => {
    const profileFile = path.join(tmp, 'profile.json');
    writeFileSync(profileFile, JSON.stringify({ judged_surface: 'site', stack: 'existing', hosting: 'local', firstview: { complexity: { min_kib: 20, max_kib: 90, calibrated: true, source: 'category exemplars' } } }));
    const fromProfile = resolveBand(loadProfile(profileFile));
    assert.deepEqual([fromProfile.band.min_kib, fromProfile.band.max_kib, fromProfile.band.calibrated, fromProfile.from], [20, 90, true, `profile ${loadProfile(profileFile).source.path}`]);
    const calibration = path.join(tmp, 'band.json');
    writeFileSync(calibration, JSON.stringify({ width: 1440, height: 900, min_kib: 30, max_kib: 110, calibrated: true, source: 'calibrate.mjs' }));
    assert.equal(resolveBand(defaultProfile(), { calibrationFile: calibration }).band.max_kib, 110);
    assert.deepEqual(resolveBand(defaultProfile(), { calibrationFile: path.join(tmp, 'absent.json') }), { band: { ...PROVISIONAL_BAND }, from: 'provisional band' });
    writeFileSync(calibration, JSON.stringify({ min_kib: 'low' }));
    assert.throws(() => resolveBand(defaultProfile(), { calibrationFile: calibration }), EnvError);
    writeFileSync(profileFile, JSON.stringify({ judged_surface: 'site', stack: 'existing', hosting: 'local', firstview: { complexity: { min_kib: 5 } } }));
    assert.throws(() => resolveBand(loadProfile(profileFile)), UsageError);
  });
});

describe('run without a page to load', () => {
  test('both gates are skipped, and a skipped gate makes the report not ok', async () => {
    const results = await run({ root: tmp, profile: defaultProfile(), routes: [], browser: null, baseUrl: null }, ['firstview']);
    assert.deepEqual(results.map((r) => [r.id, r.state]), [['firstview.contract', 'skipped'], ['firstview.complexity', 'skipped']]);
    assert.equal(aggregate(results, { requested: GATES }).ok, false);
  });
});
