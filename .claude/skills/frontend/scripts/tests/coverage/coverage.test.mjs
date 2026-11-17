// @ts-check
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadNeverShow } from '../../brief.mjs';
import {
  GATES, comparable, evaluateFeatures, evaluateHero, evaluateMetrics, evaluateNeverShow, evaluatePlaceholders,
  featureProblems, featureWaivers, findPlaceholders, isStatLike, ledgerFor, neverShowMatcher, parseFeatureList,
  parseGateList, requestedFeatures, run,
} from '../../coverage.mjs';
import { UsageError } from '../../lib/errors.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { aggregate } from '../../lib/report.mjs';

/**
 * @typedef {import('../../coverage.mjs').PageResult} PageResult
 * @typedef {import('../../coverage.mjs').CoverageProbe} CoverageProbe
 * @typedef {import('../../coverage.mjs').FeatureProbe} FeatureProbe
 * @typedef {import('../../lib/routes.mjs').Route} Route
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(HERE, '..', 'fixtures', 'coverage');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-coverage-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const DESKTOP = { name: 'desktop', width: 1280, height: 800, dpr: 1, isMobile: false, hasTouch: false };
const MOBILE = { name: 'mobile', width: 390, height: 844, dpr: 1, isMobile: true, hasTouch: true };
/** @type {Route[]} */
const ROUTES = [
  { path: '/', name: 'home', first: true, features: ['FR-001'], states: [] },
  { path: '/queue', name: 'queue', first: false, features: ['FR-002'], states: [] },
];

/** @param {Partial<CoverageProbe>} parts @returns {CoverageProbe} */
function probe(parts) {
  return {
    url: 'http://x/', title: '', bodyFontSize: 16, metas: [], features: [], metrics: [], hero: [], texts: [], visibleText: '',
    allText: '', attributes: [], dataScripts: [], truncated: false, ...parts,
  };
}

/** @param {Partial<FeatureProbe>} parts @returns {FeatureProbe} */
function feature(parts) {
  return {
    ids: ['FR-001'], sel: '[data-feature="FR-001"]', visible: true,
    headings: [{ sel: 'h2', text: 'Heading', visible: true }],
    statuses: [{ sel: 'span', value: 'testnet', text: 'Testnet', visible: true }],
    proofs: [{ sel: 'a', kind: 'data-proof', visible: true }],
    ...parts,
  };
}

/**
 * @param {Route} route
 * @param {typeof DESKTOP} viewport
 * @param {CoverageProbe | null} p
 * @param {string | null} [error]
 * @returns {PageResult}
 */
function page(route, viewport, p, error = null) {
  return { route, viewport, url: `http://x${route.path}`, status: 200, probe: p, error };
}

/** @param {string} text @param {Partial<import('../../coverage.mjs').TextProbe>} [over] */
function text(text, over = {}) {
  return { sel: 'p', text, visible: true, tag: 'p', code: false, time: false, marked: false, fontSize: 16, fontWeight: 400, ...over };
}

describe('helpers', () => {
  test('comparable applies NFKC, drops soft hyphens and zero-width characters, collapses whitespace', () => {
    const zw = String.fromCharCode(0x200b);
    assert.equal(comparable(`  With\xaddrawal${zw}s \n  clear  `), 'Withdrawals clear');
  });

  test('parseFeatureList splits commas and spaces, dedupes, and refuses what is not an FR id', () => {
    assert.deepEqual(parseFeatureList('FR-003, FR-007 FR-003'), ['FR-003', 'FR-007']);
    assert.deepEqual(parseFeatureList(['FR-001', 'FR-002']), ['FR-001', 'FR-002']);
    assert.deepEqual(parseFeatureList(undefined), []);
    assert.throws(() => parseFeatureList('coverage:FR-1'), UsageError);
  });

  test('parseGateList takes ids or the group, and refuses unknown gates', () => {
    assert.deepEqual(parseGateList('coverage', GATES), GATES.map((g) => g.id));
    assert.deepEqual(parseGateList('coverage.hero,coverage.metrics', GATES), ['coverage.metrics', 'coverage.hero']);
    assert.throws(() => parseGateList('render.console', GATES), UsageError);
  });
});

describe('stat-like figures and placeholders', () => {
  test('isStatLike flags big figures and figures with a claim unit', () => {
    for (const t of ['$12.4M', '7.25% APY', '2.3M', '10x faster', '1,234 ADA', 'TVL $26,295,181,692', '-12.5%', '25 bps']) {
      assert.equal(isStatLike({ text: t, fontSize: 16 }, 16), true, t);
    }
    assert.equal(isStatLike({ text: '41 min', fontSize: 40 }, 16), true, 'big styled figure');
    assert.equal(isStatLike({ text: '1,204', fontSize: 24 }, 16), true, 'big plain number');
  });

  test('isStatLike leaves dates, times, versions, ordinals, steps, hashes, prose and small plain numbers alone', () => {
    for (const t of ['2026', '2026-10-01', '12:00 UTC', 'v1.2.3', '1.2.3', '01', '#12', '3rd', 'Step 2', '2/5', 'Oct 1, 2026',
      '0x9f2c4e1a7b', 'Saves 30% of gas on every swap you make', 'Position 12 of 40.', '41 min', 'Updated 2 min ago']) {
      assert.equal(isStatLike({ text: t, fontSize: t === '2026' || t === 'Step 2' ? 40 : 16 }, 16), false, t);
    }
  });

  test('findPlaceholders finds each kind, and only the whole text for undefined and null', () => {
    const kinds = (/** @type {string} */ t) => findPlaceholders(t).map((h) => h.kind);
    assert.deepEqual(kinds('TODO: write'), ['TODO']);
    assert.deepEqual(kinds('fixme later'), ['FIXME']);
    assert.deepEqual(kinds('Fees: TBD'), ['TBD']);
    assert.deepEqual(kinds('Lorem ipsum dolor sit amet'), ['lorem ipsum']);
    assert.deepEqual(kinds('Fee: XXX ADA'), ['xxx']);
    assert.deepEqual(kinds('Hi [Your Name]'), ['[YOUR ...]']);
    assert.deepEqual(kinds('Key: {YOUR_API_KEY}'), ['[YOUR ...]']);
    assert.deepEqual(kinds('Hello {{user}}'), ['unrendered template']);
    assert.deepEqual(kinds('Project ${PROJECT}'), ['unrendered template']);
    assert.deepEqual(kinds('mail me@example.com'), ['example domain']);
    assert.deepEqual(kinds('By John Doe'), ['placeholder name']);
    assert.deepEqual(kinds('Acme Corp'), ['placeholder name']);
    assert.deepEqual(kinds('Mainnet: coming soon'), ['coming soon stub']);
    assert.deepEqual(kinds('APY NaN%'), ['broken value']);
    assert.deepEqual(kinds('[object Object]'), ['broken value']);
    assert.deepEqual(kinds('undefined'), ['broken value']);
  });

  test('findPlaceholders stays silent on ordinary copy', () => {
    for (const t of ['Your keys never leave the device (your wallet signs)', 'A todo list app', 'Max 0xxxx', 'SOXX tracks semis',
      'an undefined behaviour in the spec', 'Nanotech', 'Exact example of a receipt', 'The null address burns tokens']) {
      assert.deepEqual(findPlaceholders(t), [], t);
    }
  });
});

describe('coverage.features', () => {
  test('featureProblems requires visibility, a valid visible status, a heading and a proof unless planned', () => {
    assert.deepEqual(featureProblems(feature({})), []);
    assert.deepEqual(featureProblems(feature({ statuses: [], proofs: [] })), ['no data-status label', 'no visible proof (data-proof, data-ledger or data-source)']);
    assert.deepEqual(featureProblems(feature({ statuses: [{ sel: 's', value: 'beta', text: 'Beta', visible: true }] })), ['data-status "beta" is not one of live|testnet|simulated|planned']);
    assert.deepEqual(featureProblems(feature({ visible: false, headings: [] })), ['the data-feature element is not visible', 'no visible heading']);
    assert.deepEqual(featureProblems(feature({ statuses: [{ sel: 's', value: 'planned', text: 'Planned', visible: true }], proofs: [] })), []);
    assert.deepEqual(featureProblems(feature({ statuses: [{ sel: 's', value: 'live', text: '', visible: true }] })), ['its data-status label is hidden or empty']);
  });

  test('passes when each id is visible on its route at every viewport; fails on a defect at one viewport', () => {
    const ok = probe({ features: [feature({})] });
    const planned = probe({ features: [feature({ ids: ['FR-002'], statuses: [{ sel: 's', value: 'planned', text: 'Planned', visible: true }], proofs: [] })] });
    const pages = [page(ROUTES[0], DESKTOP, ok), page(ROUTES[1], DESKTOP, planned), page(ROUTES[0], MOBILE, ok), page(ROUTES[1], MOBILE, planned)];
    const result = evaluateFeatures({ ids: ['FR-001', 'FR-002'], from: 'test', pages, routes: ROUTES, routesFile: true });
    assert.equal(result.ok, true, result.detail);
    const broken = probe({ features: [feature({ visible: false })] });
    const bad = evaluateFeatures({ ids: ['FR-001'], from: 'test', pages: [page(ROUTES[0], DESKTOP, ok), page(ROUTES[0], MOBILE, broken)], routes: ROUTES, routesFile: true });
    assert.equal(bad.ok, false);
    assert.match(bad.detail, /FR-001 at mobile on \/: the data-feature element is not visible/);
  });

  test('an id on the wrong route, an unmapped id, a missing id and a page that did not load all fail', () => {
    const elsewhere = probe({ features: [feature({ ids: ['FR-002'] })] });
    const r1 = evaluateFeatures({ ids: ['FR-002'], from: 't', pages: [page(ROUTES[0], DESKTOP, elsewhere), page(ROUTES[1], DESKTOP, probe({}))], routes: ROUTES, routesFile: true });
    assert.match(r1.detail, /not found: no \[data-feature="FR-002"\] on \/queue/);
    const r2 = evaluateFeatures({ ids: ['FR-009'], from: 't', pages: [page(ROUTES[0], DESKTOP, probe({ features: [feature({ ids: ['FR-009'] })] }))], routes: ROUTES, routesFile: true });
    assert.equal(r2.ok, false);
    assert.match(JSON.stringify(r2.evidence), /not mapped to any route in routes\.json; rendered on \/;/);
    const r3 = evaluateFeatures({ ids: ['FR-009'], from: 't', pages: [page(ROUTES[0], DESKTOP, probe({ features: [feature({ ids: ['FR-009'] })] }))], routes: ROUTES, routesFile: false });
    assert.equal(r3.ok, true, 'without routes.json every route is searched and nothing needs mapping');
    const r4 = evaluateFeatures({ ids: ['FR-001'], from: 't', pages: [page(ROUTES[0], DESKTOP, null, 'page not ready')], routes: ROUTES, routesFile: true });
    assert.match(r4.detail, /page did not load \(page not ready\)/);
    assert.equal(evaluateFeatures({ ids: ['FR-001'], from: 't', pages: [], routes: ROUTES, routesFile: true }).ok, false);
  });

  test('an owner waiver keeps a row off the page; reports the plan/status mismatch as a note', () => {
    const p = probe({ features: [feature({ statuses: [{ sel: 's', value: 'simulated', text: 'Simulated', visible: true }] })] });
    const result = evaluateFeatures({
      ids: ['FR-001', 'FR-003'], from: 't', expected: new Map([['FR-001', 'live']]), pages: [page(ROUTES[0], DESKTOP, p)], routes: ROUTES, routesFile: true,
      waivers: new Map([['FR-003', 'CLI only']]),
    });
    assert.equal(result.ok, true, result.detail);
    assert.match(result.detail, /1 kept off the page by owner waiver/);
    assert.match(JSON.stringify(result.evidence), /status simulated \(the plan expected live\)/);
  });

  test('featureWaivers accepts owner waivers with reason and evidence only', () => {
    const w = featureWaivers(path.join(FIX, 'design'));
    assert.deepEqual([...w.ids.keys()], ['FR-003']);
    assert.equal(featureWaivers(path.join(tmp, 'no-design')).ids.size, 0);
    const bad = path.join(tmp, 'bad-design');
    mkdirSync(bad, { recursive: true });
    writeFileSync(path.join(bad, 'waivers.json'), '{');
    assert.match(String(featureWaivers(bad).problem), /not valid JSON/);
  });

  test('requestedFeatures: --features, else the catalogue, else brief.json, else routes.json', () => {
    const base = { root: FIX, routes: ROUTES, state: path.join(FIX, 'state') };
    const withCatalogue = defaultProfile({ paths: { feature_catalogue: path.join(FIX, 'catalogue.json') } });
    assert.deepEqual(requestedFeatures({ ...base, profile: withCatalogue, args: { features: 'FR-002' } }).ids, ['FR-002']);
    const fromCatalogue = requestedFeatures({ ...base, profile: withCatalogue });
    assert.deepEqual([fromCatalogue.ids, fromCatalogue.expected.get('FR-001')], [['FR-001', 'FR-002'], 'testnet']);
    const absent = requestedFeatures({ ...base, profile: defaultProfile({ paths: { feature_catalogue: path.join(tmp, 'none.json') } }) });
    assert.match(String(absent.problem), /does not exist/);
    assert.deepEqual(requestedFeatures({ ...base, profile: defaultProfile() }).ids, ['FR-001', 'FR-002']);
  });
});

describe('coverage.metrics', () => {
  const ledger = { available: true, file: 'ledger.md', statusById: new Map([['c-001', 'verified'], ['c-002', 'unverified']]), problem: null };

  test('passes on verified ledger ids, sourced data regions and marked or unstyled numbers', () => {
    const p = probe({
      metrics: [
        { sel: 'a', text: '2.1M', visible: true, ledger: 'C-001', source: null, asOf: null },
        { sel: 'b', text: '3', visible: true, ledger: null, source: 'testnet', asOf: '2026-10-01T10:00:00Z' },
      ],
      texts: [text('$5M', { marked: true }), text('Position 12 of 40.'), text('9%', { code: true })],
    });
    assert.equal(evaluateMetrics({ pages: [page(ROUTES[0], DESKTOP, p)], ledger }).ok, true);
  });

  test('fails on an unmarked metric, an unverified or unknown id, a bad source, a missing as-of and a stat-like figure', () => {
    const p = probe({
      metrics: [
        { sel: 'a', text: '12', visible: true, ledger: null, source: null, asOf: null },
        { sel: 'b', text: '41', visible: true, ledger: 'C-002', source: null, asOf: null },
        { sel: 'c', text: '99', visible: true, ledger: 'C-999', source: null, asOf: null },
        { sel: 'd', text: '7', visible: true, ledger: null, source: 'mock', asOf: 'now' },
        { sel: 'e', text: '8', visible: true, ledger: null, source: 'live', asOf: '' },
      ],
      texts: [text('$12.4M', { sel: 'p.figure', fontSize: 40 })],
    });
    const pages = [page(ROUTES[0], DESKTOP, p), page(ROUTES[0], MOBILE, p)];
    const result = evaluateMetrics({ pages, ledger });
    assert.equal(result.ok, false);
    const all = result.evidence.map((e) => String(e.value)).join('\n');
    assert.match(all, /data-metric without data-ledger or data-source/);
    assert.match(all, /data-ledger="C-002" is unverified in the claims ledger/);
    assert.match(all, /data-ledger="C-999" is not a row of the claims ledger/);
    assert.match(all, /data-source="mock" is not one of live\|testnet\|simulated/);
    assert.match(all, /data-source="live" has no data-as-of time/);
    assert.match(all, /stat-like figure "\$12\.4M"/);
    assert.equal(result.evidence.length, 6, 'the same finding at two viewports is reported once');
    assert.equal(result.evidence[0].viewport, 'desktop, mobile');
  });

  test('a ledger id with no ledger to read cannot pass', () => {
    const p = probe({ metrics: [{ sel: 'a', text: '1', visible: true, ledger: 'C-001', source: null, asOf: null }] });
    const result = evaluateMetrics({ pages: [page(ROUTES[0], DESKTOP, p)], ledger: { available: false, file: null, statusById: new Map(), problem: 'no claims ledger' } });
    assert.equal(result.ok, false);
    assert.match(result.detail, /cannot be checked: no claims ledger/);
  });

  test('ledgerFor reads the profile ledger, else the brief claims path', () => {
    const profile = defaultProfile({ paths: { claims_ledger: path.join(FIX, 'ledger.md') } });
    const l = ledgerFor({ root: FIX, profile, routes: ROUTES, state: null });
    assert.deepEqual([l.available, l.statusById.get('c-001'), l.statusById.get('c-002')], [true, 'verified', 'unverified']);
    assert.equal(ledgerFor({ root: FIX, profile: defaultProfile(), routes: ROUTES, state: path.join(FIX, 'state') }).available, false);
  });
});

describe('coverage.hero', () => {
  const hero = { h1: 'See when your withdrawal clears', sentence: 'Lenders see where it stands.', source: 'a.md:1' };
  const heroEls = (/** @type {string} */ h1Inner, /** @type {string} */ h1Content) => [
    { role: 'h1', sel: 'h1', tag: 'h1', visible: true, inner: h1Inner, content: h1Content },
    { role: 'sentence', sel: 'p', tag: 'p', visible: true, inner: 'Lenders see where it stands.', content: 'Lenders see where it stands.' },
  ];

  test('equal after normalisation, through the rendered text or the DOM text (text-transform)', () => {
    const p = probe({ hero: heroEls('SEE WHEN YOUR WITHDRAWAL CLEARS', 'See when your\n   withdrawal clears') });
    assert.equal(evaluateHero({ pages: [page(ROUTES[0], DESKTOP, p)], hero }).ok, true);
  });

  test('a different headline, a missing marker or two visible markers fail', () => {
    const differs = evaluateHero({ pages: [page(ROUTES[0], DESKTOP, probe({ hero: heroEls('Withdrawals, finally visible', 'Withdrawals, finally visible') }))], hero });
    assert.equal(differs.ok, false);
    assert.match(differs.detail, /\[data-hero="h1"\] reads "Withdrawals, finally visible" but brief\.hero\.h1 is "See when your withdrawal clears"/);
    const none = evaluateHero({ pages: [page(ROUTES[0], DESKTOP, probe({}))], hero });
    assert.match(none.detail, /no visible \[data-hero="h1"\]/);
    const two = heroEls('See when your withdrawal clears', 'See when your withdrawal clears');
    two.push({ ...two[0], sel: 'h1.copy' });
    assert.match(evaluateHero({ pages: [page(ROUTES[0], DESKTOP, probe({ hero: two }))], hero }).detail, /2 visible \[data-hero="h1"\] elements/);
  });
});

describe('coverage.nevershow', () => {
  const list = loadNeverShow(path.join(FIX, 'never-show.json'));
  const now = new Date('2026-10-01T00:00:00Z');

  test('neverShowMatcher: literal or regular expression, case-insensitive unless case_sensitive', () => {
    assert.equal(neverShowMatcher({ pattern: 'hot key', regex: false, case_sensitive: false })('A HOT\n key leak'), true);
    assert.equal(neverShowMatcher({ pattern: 'Ref', regex: false, case_sensitive: true })('ref'), false);
    assert.equal(neverShowMatcher({ pattern: '\\brace\\b', regex: true, case_sensitive: false })('a RACE here'), true);
  });

  test('neverShowMatcher folds as agreed with /execution (Q-F9): NFKC then toLowerCase on both sides, i flag on regex', () => {
    const ch = (/** @type {number} */ c) => String.fromCharCode(c);
    const fullwidth = `${ch(0xff33)}${ch(0xff25)}CRET`;
    assert.equal(neverShowMatcher({ pattern: 'secret', regex: false, case_sensitive: false })(`a ${fullwidth} here`), true, 'NFKC folds fullwidth letters');
    assert.equal(neverShowMatcher({ pattern: '^a secret', regex: true, case_sensitive: false })(`A ${fullwidth} here`), true, 'a regex entry sees the folded text');
    assert.equal(neverShowMatcher({ pattern: 'strasse', regex: false, case_sensitive: false })(`STRA${ch(0xdf)}E`), false, 'lower(), never casefold(): sharp s is not ss');
    assert.equal(neverShowMatcher({ pattern: `stra${ch(0xdf)}e`, regex: false, case_sensitive: false })(`STRA${ch(0xdf)}E`), true);
    assert.equal(neverShowMatcher({ pattern: 'Secret', regex: true, case_sensitive: true })('secret'), false, 'case_sensitive regex: no i flag, no folding');
    assert.equal(neverShowMatcher({ pattern: `S${ch(0xff25)}`, regex: false, case_sensitive: true })('SE'), true, 'NFKC still applies when case_sensitive');
  });

  test('a regex entry outside the JS/Python common subset cannot be checked and fails the gate', () => {
    const file = path.join(os.tmpdir(), `fe-cov-ns-${process.pid}.json`);
    writeFileSync(file, JSON.stringify({ version: 1, entries: [
      { id: 'LB', class: 'never-public', pattern: '(?<=x)y', regex: true, case_sensitive: false, until_utc: null, scope: 'both', source: 'a.md:1' },
      { id: 'OK', class: 'never-public', pattern: 'plain', regex: false, case_sensitive: false, until_utc: null, scope: 'both', source: 'a.md:2' },
    ] }));
    try {
      const subsetList = loadNeverShow(file);
      assert.deepEqual(subsetList.entries.map((e) => e.id), ['OK']);
      assert.match(subsetList.problems.join(), /LB: pattern is outside the regex subset JavaScript and Python share: it uses a lookbehind/);
      assert.doesNotMatch(subsetList.problems.join(), /\(\?<=x\)y/, 'the private pattern is never printed');
      const result = evaluateNeverShow({ pages: [page(ROUTES[0], DESKTOP, probe({ visibleText: 'clean', allText: 'clean' }))], list: subsetList, now });
      assert.equal(result.ok, false);
      assert.match(JSON.stringify(result.evidence), /entry cannot be checked/);
    } finally {
      rmSync(file, { force: true });
    }
  });

  test('clean text passes; expired and repository-only entries are not scanned', () => {
    const p = probe({ visibleText: 'REPO-ONLY-TOKEN shown', allText: 'REPO-ONLY-TOKEN shown\nEXPIRED-EMBARGO-TOKEN', texts: [text('EXPIRED-EMBARGO-TOKEN', { visible: false })] });
    const result = evaluateNeverShow({ pages: [page(ROUTES[0], DESKTOP, p)], list, now });
    assert.equal(result.ok, true, result.detail);
    assert.match(result.detail, /4 active entries .*\(1 past their until_utc\)/);
  });

  test('every place a page can carry text is scanned, and the report never repeats the matched text', () => {
    const p = probe({
      title: 'Falcon Advisory preview',
      metas: [{ key: 'description', content: 'internal ref 42' }],
      visibleText: 'Project Nightjar launches',
      allText: 'Project Nightjar launches\nThe withdrawal race',
      texts: [text('Project Nightjar launches', { sel: 'p.launch' }), text('The withdrawal race', { sel: 'div.hidden', visible: false })],
      attributes: [{ sel: 'img', name: 'alt', value: 'Project Nightjar logo' }],
      dataScripts: [{ sel: 'script#data', text: '{"note":"withdrawal-race"}' }],
    });
    const result = evaluateNeverShow({ pages: [page(ROUTES[0], DESKTOP, p)], list, now });
    assert.equal(result.ok, false);
    const where = result.evidence.map((e) => `${e.entry} ${String(e.value).replace(/^.* found in /, '')}`);
    assert.deepEqual(where.sort(), [
      'NS-ACTIVE attribute alt',
      'NS-ACTIVE visible text',
      'NS-META meta description',
      'NS-REGEX a JSON data script',
      'NS-REGEX hidden page text',
      'NS-TITLE the document title',
    ]);
    assert.doesNotMatch(JSON.stringify(result.evidence), /Nightjar|withdrawal race|falcon|internal ref/i);
  });

  test('a clock before an embargo ends makes the entry active again', () => {
    const p = probe({ allText: 'EXPIRED-EMBARGO-TOKEN', texts: [text('EXPIRED-EMBARGO-TOKEN', { visible: false })] });
    const result = evaluateNeverShow({ pages: [page(ROUTES[0], DESKTOP, p)], list, now: new Date('1999-06-01T00:00:00Z') });
    assert.equal(result.ok, false);
    assert.equal(result.evidence[0].entry, 'NS-EXPIRED');
  });

  test('an entry that cannot be checked fails the gate', () => {
    const broken = { ...list, problems: ['BAD-1: pattern does not compile'] };
    const result = evaluateNeverShow({ pages: [page(ROUTES[0], DESKTOP, probe({}))], list: broken, now });
    assert.equal(result.ok, false);
    assert.match(result.detail, /entry cannot be checked: BAD-1/);
  });
});

describe('coverage.placeholders', () => {
  test('visible text, the title and preview meta are scanned; code and hidden text are not', () => {
    const clean = probe({ title: 'Queue Clock', texts: [text('TODO in code', { code: true }), text('lorem hidden', { visible: false })] });
    assert.equal(evaluatePlaceholders({ pages: [page(ROUTES[0], DESKTOP, clean)] }).ok, true);
    const dirty = probe({ title: 'TODO title', metas: [{ key: 'description', content: 'Lorem ipsum' }, { key: 'generator', content: 'TODO' }], texts: [text('Hello {{user}}', { sel: 'p.hello' })] });
    const result = evaluatePlaceholders({ pages: [page(ROUTES[0], DESKTOP, dirty), page(ROUTES[0], MOBILE, dirty)] });
    assert.equal(result.ok, false);
    assert.deepEqual(result.evidence.map((e) => e.kind), ['unrendered template', 'TODO', 'lorem ipsum']);
    assert.equal(result.evidence[0].viewport, 'desktop, mobile');
  });
});

describe('run without a page to load', () => {
  test('every selected gate is skipped, and skipped gates make the report not ok', async () => {
    const ctx = { root: FIX, profile: defaultProfile(), routes: ROUTES, browser: null, baseUrl: null };
    const results = await run(ctx, ['coverage']);
    assert.deepEqual(results.map((r) => r.state), ['skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
    const report = aggregate(results, { requested: GATES });
    assert.equal(report.ok, false);
    assert.equal(report.counts.skipped, 5);
    assert.deepEqual(await run(ctx, ['firstview.contract']), []);
  });
});
