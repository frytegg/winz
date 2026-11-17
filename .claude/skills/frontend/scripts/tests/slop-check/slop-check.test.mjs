// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../../lib/errors.mjs';
import { DEFAULT_VIEWPORTS, defaultProfile } from '../../lib/profile.mjs';
import { aggregate } from '../../lib/report.mjs';
import { loadRegistry } from '../../rules/load.mjs';
import {
  GATES, GATE_TIERS, checkWaivers, claimedSponsors, decodeDataUrl, evaluate, fileMatches, judgeGates, parseLayers,
  parseScope, routeMatches, run, scoreOf, selectGates, selectRules, tellViewports,
} from '../../slop-check.mjs';

/**
 * @typedef {import('../../rules/load.mjs').Rule} Rule
 * @typedef {import('../../rules/load.mjs').Allowlist} Allowlist
 * @typedef {import('../../rules/load.mjs').Waiver} Waiver
 * @typedef {import('../../rules/load.mjs').ErrorFinding} ErrorFinding
 * @typedef {import('../../lib/report.mjs').GateResult} GateResult
 * @typedef {import('../../slop-check.mjs').Observation} Observation
 * @typedef {import('../../slop-check.mjs').PageError} PageError
 * @typedef {import('../../slop-check.mjs').ClaimedSponsor} ClaimedSponsor
 * @typedef {'static' | 'runtime'} Layer
 */

const SCRIPTS = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../fixtures/slop-check/', import.meta.url));
const REGISTRY = path.join(FIXTURES, 'rules', 'registry.json');
const ERRORS_REGISTRY = path.join(FIXTURES, 'rules', 'registry-errors.json');
const CLI = path.join(SCRIPTS, 'slop-check.mjs');
const ROUTES = [{ path: '/' }, { path: '/about' }];
const registry = loadRegistry(REGISTRY);
const ruleIds = new Set(registry.rules.map((r) => r.id));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-slop-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * @param {string} id
 * @returns {Rule}
 */
function ruleOf(id) {
  const rule = registry.rules.find((r) => r.id === id);
  assert.ok(rule, `fixture registry has ${id}`);
  return rule;
}

/**
 * @param {Partial<Allowlist>} [over]
 * @returns {Allowlist}
 */
function allowlist(over = {}) {
  return { sponsorHashes: new Set(), sponsors: [], waivers: [], category: [], ...over };
}

/**
 * @param {string} rule
 * @param {string} file
 * @param {number} line
 * @param {Record<string, unknown>} [extra]
 * @returns {Observation}
 */
function staticObs(rule, file, line, extra = {}) {
  return { finding: { rule, layer: 'static', file, line, excerpt: '', value: 'v', detail: '', ...extra }, digests: [], selectorHits: [], notes: [] };
}

/**
 * @param {string} rule
 * @param {string} route
 * @param {string} viewport
 * @param {string} selector
 * @returns {Observation}
 */
function runtimeObs(rule, route, viewport, selector) {
  return { finding: { rule, layer: 'runtime', route, viewport, selector, value: 'v', detail: '' }, digests: [], selectorHits: [], notes: [] };
}

/**
 * @param {Partial<Waiver>} w
 * @returns {Waiver}
 */
function waiver(w) {
  return { rule: 'SL-T02', scope: '/ #title', reason: 'the sponsor documents this heading style', evidence: 'FD11-F19', approved_by: 'owner', date: '2026-10-01', ...w };
}

/**
 * Evaluates synthetic observations against the fixture registry and judges the three gates.
 * @param {Observation[]} observations
 * @param {{rules?: Rule[], layers?: Layer[], allowlist?: Allowlist, waivers?: Waiver[], claimed?: ClaimedSponsor[],
 *   errors?: ErrorFinding[], pageErrors?: PageError[], scoreMax?: number | null, narrowed?: boolean}} [opts]
 */
function judge(observations, opts = {}) {
  const al = opts.allowlist ?? allowlist({ waivers: opts.waivers ?? [] });
  const checks = checkWaivers(al.waivers, ruleIds, opts.claimed ?? []);
  const ev = evaluate({
    rules: opts.rules ?? registry.rules, registryRules: registry.rules, observations, errors: opts.errors, pageErrors: opts.pageErrors,
    layers: opts.layers ?? ['static', 'runtime'], allowlist: al, waiverChecks: checks,
  });
  const score = scoreOf(ev, ROUTES);
  const results = judgeGates(ev, GATES, { score, scoreMax: opts.scoreMax ?? null, narrowed: opts.narrowed ?? false, registryRules: registry.rules });
  /** @type {Record<string, GateResult>} */
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  return { ev, score, results, gates: byId };
}

/**
 * @param {ReturnType<typeof judge>} out
 * @param {string} rule
 */
function judgedOf(out, rule) {
  return out.ev.judged.filter((j) => j.rule === rule);
}

describe('gate metadata and selection', () => {
  test('GATES declares the three tells gates with titles and what dropping them would let through', () => {
    assert.deepEqual(GATES.map((g) => g.id), ['tells.tier1', 'tells.tier2', 'tells.score']);
    for (const g of GATES) {
      assert.ok(g.title.trim() && g.ifDropped.trim(), g.id);
      assert.ok(Object.isFrozen(g));
    }
    assert.deepEqual(GATE_TIERS['tells.score'], ['candidate', 'advisory']);
  });

  test('selectGates: undefined and the group select all, ids select one, other groups are ignored unless strict', () => {
    assert.equal(selectGates(undefined).length, 3);
    assert.equal(selectGates('tells').length, 3);
    assert.deepEqual(selectGates('tells.score,tells.tier1').map((g) => g.id), ['tells.tier1', 'tells.score']);
    assert.deepEqual(selectGates(['tells.tier2', 'render.console']).map((g) => g.id), ['tells.tier2']);
    assert.deepEqual(selectGates([]), []);
    assert.throws(() => selectGates('render.console', { strict: true }), UsageError);
    assert.throws(() => selectGates('tells.tier3'), (e) => e instanceof UsageError && /unknown gate tells\.tier3/.test(e.message));
  });

  test('parseLayers: both by default, static or runtime alone, anything else is a usage error', () => {
    assert.deepEqual(parseLayers(undefined), ['static', 'runtime']);
    assert.deepEqual(parseLayers('static'), ['static']);
    assert.deepEqual(parseLayers(['runtime', 'static']), ['static', 'runtime']);
    assert.deepEqual(parseLayers('both'), ['static', 'runtime']);
    assert.throws(() => parseLayers('dom'), (e) => e instanceof UsageError && /--layers dom/.test(e.message));
  });

  test('selectRules keeps the tiers the gates judge and narrows by --rules ids and wildcards', () => {
    const all = new Set(['tier1', 'tier2', 'candidate', 'advisory']);
    assert.equal(selectRules(registry, undefined, all).length, registry.rules.length);
    assert.deepEqual(selectRules(registry, undefined, new Set(['tier1'])).map((r) => r.id), ['SL-T02', 'SL-X02']);
    assert.deepEqual(selectRules(registry, 'sl-t0*', new Set(['tier2', 'advisory'])).map((r) => r.id), ['SL-T04', 'SL-T09', 'SL-T08']);
    assert.deepEqual(selectRules(registry, ['SL-G01', 'SL-M04'], all).map((r) => r.id), ['SL-G01', 'SL-M04']);
    assert.throws(() => selectRules(registry, 'SL-Z99', all), (e) => e instanceof UsageError && /SL-Z99 matches no rule/.test(e.message));
    assert.throws(() => selectRules(registry, 'SL-G01', new Set(['tier1'])), (e) => e instanceof UsageError && /selects no rule judged/.test(e.message));
  });

  test('tellViewports: desktop and mobile by name, never the reflow viewport; flags decide without the names', () => {
    assert.deepEqual(tellViewports(DEFAULT_VIEWPORTS).map((v) => v.name), ['desktop', 'mobile']);
    const custom = [
      { name: 'narrow', width: 320, height: 640, dpr: 1, isMobile: false, hasTouch: false },
      { name: 'wide', width: 1920, height: 1080, dpr: 1, isMobile: false, hasTouch: false },
      { name: 'phone', width: 390, height: 844, dpr: 2, isMobile: true, hasTouch: true },
    ];
    assert.deepEqual(tellViewports(custom).map((v) => v.name), ['wide', 'phone']);
    assert.deepEqual(tellViewports([custom[2]]).map((v) => v.name), ['phone']);
    assert.deepEqual(tellViewports(undefined), []);
  });
});

describe('waiver scopes and validation', () => {
  test('parseScope reads route, route plus selector, and selector-or-file scopes', () => {
    assert.deepEqual(parseScope('/ #title').scope, { kind: 'route', route: '/', selector: '#title' });
    assert.deepEqual(parseScope('/about').scope, { kind: 'route', route: '/about', selector: null });
    assert.deepEqual(parseScope('/docs/* main  h1').scope, { kind: 'route', route: '/docs/*', selector: 'main h1' });
    assert.deepEqual(parseScope('  src/Hero.tsx:12 ').scope, { kind: 'element-or-file', text: 'src/Hero.tsx:12' });
    assert.deepEqual(parseScope('/** .hero').scope, { kind: 'route', route: '/**', selector: '.hero' });
  });

  test('parseScope refuses empty scopes and scopes that cover the whole site', () => {
    for (const bad of ['', '   ', '*', 'site', 'body', ':root', 'HTML', '/**', '/*', '/** body', '/* *']) {
      const { scope, problem } = parseScope(bad);
      assert.equal(scope, null, JSON.stringify(bad));
      assert.match(String(problem), /empty|whole site/, JSON.stringify(bad));
    }
    assert.equal(parseScope(42).scope, null);
  });

  test('routeMatches: exact (trailing slash ignored), * one segment, ** any depth', () => {
    assert.ok(routeMatches('/', '/'));
    assert.ok(routeMatches('/about/', '/about'));
    assert.ok(!routeMatches('/about', '/'));
    assert.ok(routeMatches('/docs/*', '/docs/intro'));
    assert.ok(!routeMatches('/docs/*', '/docs/a/b'));
    assert.ok(routeMatches('/docs/**', '/docs/a/b'));
    assert.ok(!routeMatches('/', undefined));
  });

  test('fileMatches: exact paths, globs, base names at any depth and a :line suffix', () => {
    assert.ok(fileMatches('src/App.jsx', 'src/App.jsx', 4));
    assert.ok(fileMatches('src/**', 'src/App.jsx', 4));
    assert.ok(fileMatches('App.jsx', 'src/App.jsx', 4));
    assert.ok(fileMatches('src/App.jsx:4', 'src/App.jsx', 4));
    assert.ok(!fileMatches('src/App.jsx:5', 'src/App.jsx', 4));
    assert.ok(!fileMatches('src/Other.jsx', 'src/App.jsx', 4));
    assert.ok(!fileMatches('src/App.jsx', undefined, 4));
  });

  test('claimedSponsors keeps only sponsors whose colours are claimed as a mark, with the names they are cited by', () => {
    const claimed = claimedSponsors([
      { sponsor: 'cardano', display_name: 'Cardano (protocol marks)', colours: { claimed_as_mark: false } },
      { sponsor: 'solana', display_name: 'Solana (Solana Foundation)', colours: { claimed_as_mark: true } },
      { sponsor: 'bnb-chain', display_name: 'BNB Chain', claimed_as_mark: true },
      'not an entry',
    ]);
    assert.deepEqual(claimed, [
      { id: 'solana', names: ['Solana', 'solana'] },
      { id: 'bnb-chain', names: ['BNB Chain', 'bnb-chain', 'bnb chain'] },
    ]);
  });

  test('checkWaivers: rule, scope, reason, evidence, and refusal of waivers citing a claimed-mark sponsor', () => {
    const claimed = claimedSponsors([{ sponsor: 'solana', display_name: 'Solana (Solana Foundation)', colours: { claimed_as_mark: true } }]);
    const checks = checkWaivers([
      waiver({}),
      waiver({ rule: 'SL-Z99' }),
      waiver({ reason: '  ', evidence: ['', ' '] }),
      waiver({ scope: 'body' }),
      waiver({ reason: 'Matches the SOLANA logo gradient' }),
      waiver({ evidence: ['FD21-F14', 'solana kit'] }),
      waiver({ reason: 'Solanaceae palette, a botany reference' }),
      waiver({ evidence: ['FD11-F19', 'brief.md'] }),
    ], ruleIds, claimed);
    assert.deepEqual(checks.map((c) => c.valid), [true, false, false, false, false, false, true, true]);
    assert.match(checks[1].problems[0], /rule "SL-Z99" is not in the registry/);
    assert.ok(checks[2].problems.some((p) => /reason is empty/.test(p)) && checks[2].problems.some((p) => /evidence is empty/.test(p)));
    assert.match(checks[3].problems[0], /whole site/);
    assert.match(checks[4].problems[0], /cites Solana, whose colours and look are claimed as trademarks/);
    assert.match(checks[5].problems[0], /cites Solana/, 'matched case-insensitively, reported by the display name');
  });

  test('decodeDataUrl yields the exact bytes of base64 and percent-encoded data: URLs', () => {
    const svg = readFileSync(path.join(FIXTURES, 'sloppy', 'public', 'sponsor.svg'));
    const digest = (/** @type {Buffer | undefined} */ b) => createHash('sha256').update(b ?? Buffer.alloc(0)).digest('hex');
    const base64 = decodeDataUrl(`data:image/svg+xml;base64,${svg.toString('base64')}`);
    assert.equal(digest(base64.bytes), digest(svg));
    const percent = decodeDataUrl(`data:image/svg+xml,${encodeURIComponent(svg.toString('utf8'))}`);
    assert.equal(digest(percent.bytes), digest(svg));
    assert.deepEqual(decodeDataUrl('data:text/plain,%E2%82%ACx').bytes, Buffer.from([0xe2, 0x82, 0xac, 0x78]));
    assert.match(String(decodeDataUrl('data:no-comma').note), /malformed/);
  });
});

describe('confirmation: the runtime layer is authoritative', () => {
  test('a static finding of a runtime rule without a rendered finding is unconfirmed and passes tier 1', () => {
    const out = judge([staticObs('SL-T02', 'src/App.jsx', 4)]);
    assert.deepEqual(judgedOf(out, 'SL-T02').map((j) => [j.confirmed, j.counts]), [[false, false]]);
    assert.equal(out.gates['tells.tier1'].state, 'ok');
    assert.match(out.gates['tells.tier1'].detail, /not counted: 1 unconfirmed static/);
  });

  test('a rendered finding of the same rule confirms the static one and fails tier 1 (failing fixture)', () => {
    const out = judge([staticObs('SL-T02', 'src/App.jsx', 4), runtimeObs('SL-T02', '/', 'desktop', '#title')]);
    assert.deepEqual(judgedOf(out, 'SL-T02').map((j) => [j.layer, j.confirmed, j.counts]), [['runtime', true, true], ['static', true, true]]);
    const tier1 = out.gates['tells.tier1'];
    assert.equal(tier1.state, 'fail');
    assert.match(tier1.detail, /1 tier-1 rule fires with confirmed findings: SL-T02 \(2 findings\)/);
    assert.deepEqual(tier1.evidence.map((e) => e.selector ?? `${e.file}:${e.line}`), ['#title', 'src/App.jsx:4']);
  });

  test('a rendered finding of another rule confirms nothing', () => {
    const out = judge([staticObs('SL-T02', 'src/App.jsx', 4), runtimeObs('SL-T04', '/', 'desktop', '#body-copy')]);
    assert.equal(judgedOf(out, 'SL-T02')[0].confirmed, false);
    assert.equal(out.gates['tells.tier1'].state, 'ok');
  });

  test('a rule without a runtime detector is confirmed by its static finding alone', () => {
    const out = judge([staticObs('SL-X02', 'src/placeholder.js', 1)]);
    assert.equal(judgedOf(out, 'SL-X02')[0].confirmed, true);
    assert.equal(out.gates['tells.tier1'].state, 'fail');
    assert.equal(judge([]).gates['tells.tier1'].state, 'ok', 'passing fixture: nothing fires');
  });
});

describe('exemptions: sponsor hash, category, waiver; never by colour or name', () => {
  const SHA = 'a'.repeat(64);

  test('a sponsor hash exempts only rules whose allowlist is sponsor-hash', () => {
    const hashes = allowlist({ sponsorHashes: new Set([SHA]) });
    const logo = runtimeObs('SL-T01', '/', 'desktop', '#sponsor-logo');
    logo.digests = [SHA];
    const other = runtimeObs('SL-T01', '/', 'desktop', '#hero-bg');
    other.digests = ['b'.repeat(64)];
    const pill = runtimeObs('SL-C01', '/', 'desktop', '#go');
    pill.digests = [SHA];
    const out = judge([logo, other, pill], { allowlist: hashes });
    const t01 = judgedOf(out, 'SL-T01');
    assert.deepEqual(t01.map((j) => [j.selector, j.exempt?.kind ?? null]), [['#hero-bg', null], ['#sponsor-logo', 'sponsor-hash']]);
    assert.equal(judgedOf(out, 'SL-C01')[0].exempt, null, 'a matching hash never exempts a rule without the sponsor-hash allowlist');
  });

  test('a category entry exempts rules whose allowlist is category, and is reported as ignored elsewhere', () => {
    const al = allowlist({ category: [
      { rule: 'SL-T04', category: 'defi-lending', reason: 'lending dashboards set body text in Inter', source: 'FD11-F19' },
      { rule: 'SL-T09', category: 'defi-lending', reason: 'badges are common', source: 'FD11-F19' },
      { rule: 'SL-Q01', category: 'x', reason: 'unknown rule', source: '' },
    ] });
    const out = judge([runtimeObs('SL-T04', '/', 'desktop', '#body-copy'), runtimeObs('SL-T09', '/', 'desktop', '#badge')], { allowlist: al });
    assert.equal(judgedOf(out, 'SL-T04')[0].exempt?.kind, 'category');
    assert.equal(judgedOf(out, 'SL-T09')[0].exempt, null);
    assert.deepEqual(out.ev.category.map((c) => [c.rule, c.applies]), [['SL-T04', true], ['SL-T09', false], ['SL-Q01', false]]);
    assert.match(out.ev.category[1].note, /SL-T09 takes no category exemption \(its allowlist is none\)/);
    assert.match(out.ev.category[2].note, /not in the registry/);
    assert.equal(out.gates['tells.tier2'].state, 'fail', 'SL-T09 still fires');
  });

  test('a route plus selector waiver covers only findings whose element the page matched', () => {
    const hit = runtimeObs('SL-T09', '/', 'desktop', '#badge');
    hit.selectorHits = [0];
    const miss = runtimeObs('SL-T09', '/', 'mobile', '#badge');
    const out = judge([hit, miss], { waivers: [waiver({ rule: 'SL-T09', scope: '/ #badge' })] });
    assert.deepEqual(judgedOf(out, 'SL-T09').map((j) => [j.viewport, j.exempt?.kind ?? null]), [['desktop', 'waiver'], ['mobile', null]]);
    assert.equal(out.ev.waivers[0].covered, 1);
  });

  test('a route-only waiver covers every finding on its route and none elsewhere; an element waiver needs a page match', () => {
    const home = runtimeObs('SL-T09', '/', 'desktop', '#badge');
    const about = runtimeObs('SL-T09', '/about', 'desktop', '#badge');
    const element = runtimeObs('SL-T04', '/about', 'desktop', '#body-copy');
    element.selectorHits = [1];
    const out = judge([home, about, element], { waivers: [waiver({ rule: 'SL-T09', scope: '/' }), waiver({ rule: 'SL-T04', scope: 'main #body-copy' })] });
    assert.deepEqual(judgedOf(out, 'SL-T09').map((j) => [j.route, j.exempt?.kind ?? null]), [['/', 'waiver'], ['/about', null]]);
    assert.equal(judgedOf(out, 'SL-T04')[0].exempt?.kind, 'waiver');
  });

  test('a file waiver covers static findings, with an optional line', () => {
    const out = judge([staticObs('SL-X02', 'src/placeholder.js', 1), staticObs('SL-X02', 'src/other.js', 3), staticObs('SL-X02', 'src/other.js', 9)], {
      waivers: [waiver({ rule: 'SL-X02', scope: 'src/placeholder.js' }), waiver({ rule: 'SL-X02', scope: 'src/other.js:3' })],
    });
    assert.deepEqual(judgedOf(out, 'SL-X02').map((j) => [j.file, j.line, j.counts]), [
      ['src/other.js', 3, false], ['src/other.js', 9, true], ['src/placeholder.js', 1, false],
    ]);
    assert.equal(out.gates['tells.tier1'].state, 'fail');
  });

  test('an invalid or refused waiver never covers, and the tier-2 detail names the refusal', () => {
    const obs = runtimeObs('SL-T09', '/', 'desktop', '#badge');
    obs.selectorHits = [0];
    const out = judge([obs], { waivers: [waiver({ rule: 'SL-T09', scope: '/ #badge', evidence: '' })] });
    assert.equal(judgedOf(out, 'SL-T09')[0].exempt, null);
    assert.equal(out.gates['tells.tier2'].state, 'fail');
    assert.match(out.gates['tells.tier2'].detail, /waiver 0 for SL-T09 is refused: evidence is empty/);
  });

  test('when every rendered finding is exempt, the rule\'s static findings are exempt too', () => {
    const rendered = runtimeObs('SL-T02', '/', 'desktop', '#title');
    rendered.selectorHits = [0];
    const out = judge([rendered, staticObs('SL-T02', 'src/App.jsx', 4)], { waivers: [waiver({})] });
    assert.deepEqual(judgedOf(out, 'SL-T02').map((j) => j.exempt?.kind), ['waiver', 'rendered']);
    assert.equal(out.gates['tells.tier1'].state, 'ok', 'passing fixture: the waived tell');
    const open = runtimeObs('SL-T02', '/about', 'desktop', '#about-title');
    const partly = judge([rendered, open, staticObs('SL-T02', 'src/App.jsx', 4)], { waivers: [waiver({})] });
    assert.deepEqual(judgedOf(partly, 'SL-T02').map((j) => j.counts), [false, true, true]);
    assert.equal(partly.gates['tells.tier1'].state, 'fail');
  });

  test('a valid waiver that matched nothing is reported for cleanup', () => {
    const out = judge([], { waivers: [waiver({ scope: '/pricing h1' })] });
    assert.deepEqual(out.ev.waivers[0].notes, ['matched no finding in this run: check the scope']);
  });
});

describe('tells.score: co-occurrence, each rule once, anchors double', () => {
  const sloppy = () => [
    staticObs('SL-G01', 'src/figma.js', 1),
    staticObs('SL-G01', 'src/figma2.js', 1),
    runtimeObs('SL-M04', '/', 'desktop', '#stats'),
    runtimeObs('SL-M04', '/', 'mobile', '#stats'),
    runtimeObs('SL-T01', '/about', 'desktop', '#remote-mark'),
    runtimeObs('SL-C01', '/', 'desktop', '#go'),
    runtimeObs('SL-T08', '/', 'desktop', '#boxes'),
    runtimeObs('SL-T02', '/', 'desktop', '#title'),
    staticObs('SL-C01', 'src/App.jsx', 7),
  ];

  test('sums each firing candidate and advisory rule once, anchors counted double; tier rules never add', () => {
    const { score } = judge(sloppy());
    assert.deepEqual(score.rules.map((r) => [r.rule, r.points, r.findings]), [
      ['SL-G01', 4, 2], ['SL-M04', 4, 2], ['SL-T01', 2, 1], ['SL-T08', 2, 1], ['SL-C01', 1, 2],
    ]);
    assert.equal(score.total, 13);
    assert.equal(score.anchors, 2);
    assert.deepEqual(score.byRoute, [
      { route: '/', score: 11, rules: ['SL-G01', 'SL-M04', 'SL-T08', 'SL-C01'] },
      { route: '/about', score: 6, rules: ['SL-G01', 'SL-T01'] },
    ]);
  });

  test('report only while score_max is null; ok at the limit (passing fixture), fail above it (failing fixture)', () => {
    const open = judge(sloppy()).gates['tells.score'];
    assert.equal(open.state, 'ok');
    assert.equal(open.advisory, true, 'report only is advisory, never a passed check');
    assert.match(open.detail, /^advisory: score 13 from 5 rules \(2 anchors counted double\): SL-G01 4, SL-M04 4/);
    assert.match(open.detail, /report only: profile\.tells\.score_max is null/);
    const within = judge(sloppy(), { scoreMax: 13 }).gates['tells.score'];
    assert.equal(within.state, 'ok');
    assert.equal(within.advisory, undefined, 'a set score_max is binding');
    assert.match(within.detail, /within score_max 13/);
    const above = judge(sloppy(), { scoreMax: 12 }).gates['tells.score'];
    assert.equal(above.state, 'fail');
    assert.match(above.detail, /above score_max 12; remove co-occurring patterns, anchor rules first/);
    assert.deepEqual(above.evidence[0], { rule: 'SL-G01', file: 'src/figma.js', line: 1, value: '4 points: weight 2 x2 (anchor), 2 findings' });
  });

  test('exempt and unconfirmed findings never add to the score', () => {
    const hashed = runtimeObs('SL-T01', '/', 'desktop', '#sponsor-logo');
    hashed.digests = ['c'.repeat(64)];
    const out = judge([hashed, staticObs('SL-T08', 'src/App.jsx', 8), staticObs('SL-C01', 'src/App.jsx', 7)], {
      allowlist: allowlist({ sponsorHashes: new Set(['c'.repeat(64)]) }),
    });
    assert.equal(out.score.total, 0);
    assert.equal(out.gates['tells.score'].state, 'ok');
    assert.match(out.gates['tells.score'].detail, /^advisory: score 0 from 0 rules; report only/);
    assert.match(out.gates['tells.score'].detail, /not counted: 1 exempt, 2 unconfirmed static/);
  });
});

describe('gate states', () => {
  test('a tier with no rule in the registry is an advisory ok that judged nothing; one dropped by --rules is skipped', () => {
    const candidates = registry.rules.filter((r) => r.tier === 'candidate');
    const vacuous = judge([], { rules: candidates });
    assert.equal(vacuous.gates['tells.tier1'].state, 'ok');
    assert.equal(vacuous.gates['tells.tier1'].advisory, true, 'counted apart, so no reader takes it for a passed check');
    assert.match(vacuous.gates['tells.tier1'].detail, /^advisory: no tier-1 rule in the registry, so nothing binding was judged/);
    const fired = [runtimeObs('SL-M04', '/', 'desktop', '#stats'), runtimeObs('SL-C01', '/', 'desktop', '#go')];
    const sloppyCandidates = judge(fired, { rules:registry.rules.map((r) => ({ ...r, tier: /** @type {const} */ ('candidate') })) });
    assert.equal(sloppyCandidates.gates['tells.tier2'].advisory, true);
    assert.match(sloppyCandidates.gates['tells.tier2'].detail, /\d+ confirmed findings? from \d+ candidate rules? are scored by tells\.score only/);
    const narrowed = judge([], { rules: candidates, narrowed: true });
    assert.equal(narrowed.gates['tells.tier1'].state, 'skipped');
    assert.match(narrowed.gates['tells.tier1'].detail, /--rules selects no tier-1 rule/);
  });

  test('a rule whose layer did not run is undecidable: the gate is skipped and the report is not ok', () => {
    const out = judge([staticObs('SL-X02', 'src/other.js', 1)], { layers: ['static'], waivers: [waiver({ rule: 'SL-X02', scope: 'src/other.js' })] });
    for (const id of ['tells.tier1', 'tells.tier2', 'tells.score']) assert.equal(out.gates[id].state, 'skipped', id);
    assert.match(out.gates['tells.tier1'].detail, /1 tier-1 rule cannot be judged: the runtime layer did not run \(not requested\) \(SL-T02\)/);
    const report = aggregate(out.results, { requested: GATES });
    assert.equal(report.ok, false, 'a skipped gate never counts as passing');
    assert.equal(aggregate(out.results, { requested: GATES, allowSkip: ['tells'] }).ok, true);
  });

  test('a confirmed finding fails the gate even when other rules are undecidable', () => {
    const out = judge([staticObs('SL-X02', 'src/placeholder.js', 1)], { layers: ['static'] });
    assert.equal(out.gates['tells.tier1'].state, 'fail');
  });

  test('without the static layer, rules without a runtime detector are undecidable', () => {
    const out = judge([], { layers: ['runtime'] });
    assert.equal(out.gates['tells.tier1'].state, 'skipped');
    assert.match(out.gates['tells.tier1'].detail, /the static layer did not run .*\(SL-X02\)/);
    assert.equal(out.gates['tells.tier2'].state, 'ok', 'tier-2 rules all have a runtime detector');
  });

  test('detector errors fail only the gate that judges the broken rule', () => {
    /** @type {ErrorFinding[]} */
    const errors = [{ rule: 'SL-T01', layer: 'runtime', error: 'TypeError: boom', route: '/', viewport: 'mobile' }];
    const out = judge([], { errors });
    assert.equal(out.gates['tells.tier1'].state, 'ok');
    assert.equal(out.gates['tells.score'].state, 'fail');
    assert.match(out.gates['tells.score'].detail, /1 detector error \(a skill defect, not a product finding\): SL-T01 runtime \/ at mobile: TypeError: boom/);
    assert.deepEqual(out.gates['tells.score'].evidence[0], { rule: 'SL-T01', route: '/', viewport: 'mobile', value: 'detector error (runtime): TypeError: boom' });
  });

  test('a page that never became ready fails every gate whose rules need rendering', () => {
    const pageErrors = [{ route: '/about', viewport: 'desktop', error: 'CheckError: page not ready after 15000 ms' }];
    const out = judge([], { pageErrors });
    for (const id of ['tells.tier1', 'tells.tier2', 'tells.score']) {
      assert.equal(out.gates[id].state, 'fail', id);
      assert.match(out.gates[id].detail, /runtime layer incomplete on 1 page: \/about at desktop: CheckError: page not ready/);
    }
    const staticOnly = judge([], { pageErrors, rules: [ruleOf('SL-X02')] });
    assert.equal(staticOnly.gates['tells.tier1'].state, 'ok', 'a rule with no runtime detector does not depend on pages');
  });

  test('gate evidence is capped and every value is a scalar', () => {
    const many = Array.from({ length: 40 }, (_, i) => runtimeObs('SL-T02', '/', 'desktop', `#h${i}`));
    many[0].finding.value = { nested: ['object'] };
    const tier1 = judge(many).gates['tells.tier1'];
    assert.equal(tier1.evidence.length, 25);
    assert.equal(tier1.evidence[0].value, '{"nested":["object"]}');
    assert.match(tier1.detail, /SL-T02 \(40 findings\)/);
  });
});

/**
 * A temporary copy of a fixture repository (outside any git work tree).
 * @param {string} name
 * @param {{waivers?: boolean}} [options]
 * @returns {string}
 */
function repoCopy(name, { waivers = false } = {}) {
  const dir = mkdtempSync(path.join(tmp, `${name}-`));
  cpSync(path.join(FIXTURES, name), dir, { recursive: true });
  if (waivers) cpSync(path.join(FIXTURES, 'waivers.json'), path.join(dir, 'design', 'waivers.json'));
  return dir;
}

/**
 * @param {string} state
 * @returns {string[]}
 */
function findingFiles(state) {
  const dir = path.join(state, 'tells');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
}

/**
 * @param {string} state
 * @returns {Record<string, any>}
 */
function lastFindings(state) {
  const files = findingFiles(state);
  assert.ok(files.length > 0, 'a findings file was written');
  return JSON.parse(readFileSync(path.join(state, 'tells', files[files.length - 1]), 'utf8'));
}

/**
 * @param {GateResult[]} results
 * @returns {Record<string, GateResult>}
 */
function byGate(results) {
  return Object.fromEntries(results.map((r) => [r.id, r]));
}

describe('run() on the static layer (no browser)', () => {
  test('sloppy repository: tier 1 fails on the static-only rule, gates needing rendering are skipped, findings are written', async () => {
    const root = repoCopy('sloppy');
    const state = path.join(root, '.frontend');
    /** @type {string[]} */
    const lines = [];
    const results = await run({ root, profile: defaultProfile(), state, args: { registry: REGISTRY, layers: 'static' }, log: (m) => lines.push(m) });
    const gates = byGate(results);
    assert.deepEqual(results.map((r) => [r.id, r.state]), [['tells.tier1', 'fail'], ['tells.tier2', 'skipped'], ['tells.score', 'skipped']]);
    assert.deepEqual(gates['tells.tier1'].evidence, [{ rule: 'SL-X02', file: 'src/placeholder.js', line: 1, value: 'fx-x02' }]);
    assert.match(gates['tells.tier1'].detail, /findings: \.frontend\/tells\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(-\d+)?\.json$/);
    assert.match(gates['tells.score'].detail, /the runtime layer did not run \(--layers static\)/);
    const doc = lastFindings(state);
    assert.equal(doc.tool, 'slop-check');
    assert.deepEqual(doc.layers, { requested: ['static'], ran: ['static'], notes: { runtime: '--layers static' } });
    const located = doc.findings.map((/** @type {any} */ f) => `${f.rule} ${f.file}:${f.line}`);
    assert.deepEqual(located, [
      'SL-T02 src/App.jsx:4', 'SL-X02 src/placeholder.js:1', 'SL-T04 src/App.jsx:5', 'SL-T01 index.html:6',
      'SL-T01 public/sponsor.svg:1', 'SL-T01 src/App.jsx:6', 'SL-G01 src/figma.js:1', 'SL-C01 src/App.jsx:7', 'SL-T08 src/App.jsx:8',
    ], 'markers inside JS, CSS and HTML comments are never findings');
    assert.equal(doc.findings.find((/** @type {any} */ f) => f.file === 'index.html').asset, 'public/sponsor.svg');
    assert.deepEqual(doc.counts, { findings: 9, counted: 2, exempt: 0, unconfirmed: 7, errors: 0, pageErrors: 0 });
    assert.ok(lines.some((l) => /^static layer: 7 rules over 6 files: 9 findings, 0 detector errors$/.test(l)), lines.join('\n'));
  });

  test('clean repository on the static layer only: every gate is skipped and the report is not ok', async () => {
    const root = repoCopy('clean');
    const state = path.join(root, '.frontend');
    const results = await run({ root, profile: defaultProfile(), state, args: { registry: REGISTRY, layers: 'static' } });
    assert.deepEqual(results.map((r) => r.state), ['skipped', 'skipped', 'skipped']);
    assert.equal(aggregate(results, { requested: GATES }).ok, false);
  });

  test('no browser or base URL: the runtime layer cannot run, so gates whose rules need it are skipped', async () => {
    const root = repoCopy('clean');
    const results = await run({ root, profile: defaultProfile(), state: path.join(root, '.frontend'), args: { registry: REGISTRY } });
    assert.ok(results.every((r) => r.state === 'skipped'));
    assert.match(results[0].detail, /no app to render: pass --serve <dir> or --url <url>/);
  });

  test('--rules narrows the run; a gate whose rules it dropped is skipped', async () => {
    const root = repoCopy('clean');
    const state = path.join(root, '.frontend');
    const results = await run({ root, profile: defaultProfile(), state, args: { registry: REGISTRY, layers: 'static', rules: 'SL-X02,SL-G01' } });
    assert.deepEqual(results.map((r) => [r.id, r.state]), [['tells.tier1', 'ok'], ['tells.tier2', 'skipped'], ['tells.score', 'ok']]);
    assert.deepEqual(lastFindings(state).registry.run, ['SL-X02', 'SL-G01']);
  });

  test('a file waiver clears the static-only tier-1 finding; refused and invalid waivers are reported', async () => {
    const root = repoCopy('sloppy', { waivers: true });
    const state = path.join(root, '.frontend');
    const sponsors = path.join(root, 'sponsors.json');
    writeFileSync(sponsors, JSON.stringify({ sponsor_allowlist: [{ sponsor: 'claimco', display_name: 'ClaimCo (Claim Foundation)', colours: { claimed_as_mark: true } }] }));
    const results = await run({ root, profile: defaultProfile(), state, args: { registry: REGISTRY, layers: 'static', rules: 'SL-X02', 'sponsor-allowlist': sponsors } });
    assert.deepEqual(results.map((r) => r.state), ['ok', 'skipped', 'skipped']);
    assert.deepEqual(results[0].evidence, [{ rule: 'SL-X02', file: 'src/placeholder.js', line: 1, value: 'exempt: waiver 2 (src/placeholder.js)' }]);
    const doc = lastFindings(state);
    assert.equal(doc.waivers.length, 8);
    assert.match(doc.waivers[5].problems[0], /cites ClaimCo, whose colours and look are claimed as trademarks/);
    assert.equal(doc.waivers[6].problems.length, 2, 'empty reason and empty evidence');
    assert.equal(doc.waivers[2].covered, 1);
  });

  test('without a test sponsor file, the skill\'s own allowlist decides which sponsors are claimed (Solana)', async () => {
    const root = repoCopy('clean');
    writeFileSync(path.join(root, 'design', 'waivers.json'), JSON.stringify({ waivers: [waiver({ rule: 'SL-X02', scope: 'src/x.js', reason: 'Solana gradient copied from the kit' })] }));
    const state = path.join(root, '.frontend');
    await run({ root, profile: defaultProfile(), state, args: { registry: REGISTRY, layers: 'static', rules: 'SL-X02' } });
    assert.match(lastFindings(state).waivers[0].problems[0], /cites Solana/);
  });

  test('a missing static detector fails the gate that judges its rule', async () => {
    const root = repoCopy('clean');
    const results = byGate(await run({ root, profile: defaultProfile(), state: path.join(root, '.frontend'), args: { registry: ERRORS_REGISTRY, layers: 'static' } }));
    assert.equal(results['tells.tier1'].state, 'ok');
    assert.equal(results['tells.score'].state, 'fail');
    assert.match(results['tells.score'].detail, /1 detector error \(a skill defect, not a product finding\): SL-T20 static: Error: detector file missing: rules\/static\/SL-T20\.mjs/);
  });

  test('every run writes its own findings file; selecting no gate writes nothing', async () => {
    const root = repoCopy('clean');
    const state = path.join(root, '.frontend');
    const ctx = { root, profile: defaultProfile(), state, args: { registry: REGISTRY, layers: 'static', rules: 'SL-X02' } };
    await run(ctx, ['tells.tier1']);
    await run(ctx, ['tells.tier1']);
    assert.equal(findingFiles(state).length, 2);
    assert.deepEqual(await run(ctx, []), []);
    assert.deepEqual(await run(ctx, ['render.console']), [], 'ids of other modules are ignored');
    assert.equal(findingFiles(state).length, 2);
  });

  test('with --out (Q-F14) the findings go under outDir and the state folder is not written', async () => {
    const root = repoCopy('clean');
    const state = path.join(root, 'state-readonly');
    const out = path.join(root, 'proof-out');
    const ctx = { root, profile: defaultProfile(), state, args: { registry: REGISTRY, layers: 'static', rules: 'SL-X02', out, outDir: out } };
    const results = await run(ctx, ['tells.tier1']);
    assert.equal(results.length, 1);
    assert.equal(existsSync(state), false, 'nothing created in the state folder');
    assert.equal(findingFiles(out).length, 1);
  });

  test('a malformed waivers file stops the run with a usage error; an unknown sponsor only exempts nothing (Q-FX-5)', async () => {
    const root = repoCopy('clean');
    writeFileSync(path.join(root, 'design', 'waivers.json'), '{"waivers": [{"scope": "x"}]}');
    await assert.rejects(run({ root, profile: defaultProfile(), state: path.join(root, '.frontend'), args: { registry: REGISTRY, layers: 'static' } }), UsageError);
    const other = repoCopy('clean');
    const results = await run({ root: other, profile: defaultProfile({ sponsors: ['no-such-sponsor'] }), state: path.join(other, '.frontend'), args: { registry: REGISTRY, layers: 'static' } });
    assert.ok(Array.isArray(results) && results.length > 0, 'the run completes');
  });

  test('with waivers to check, a --sponsor-allowlist that does not exist is a usage error, never a silent pass', async () => {
    const root = repoCopy('sloppy', { waivers: true });
    const missing = path.join(root, 'no-such-sponsors.json');
    await assert.rejects(
      run({ root, profile: defaultProfile(), state: path.join(root, '.frontend'), args: { registry: REGISTRY, layers: 'static', 'sponsor-allowlist': missing } }),
      (err) => err instanceof UsageError && /sponsor allowlist not found at .*no-such-sponsors\.json/.test(err.message),
    );
  });
});

/**
 * @param {string[]} args
 * @returns {{status: number | null, stdout: string, stderr: string}}
 */
function cli(args) {
  const res = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000 });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/**
 * @param {string} root
 * @param {Record<string, unknown>} [block]
 * @returns {string}
 */
function profileFile(root, block = {}) {
  const file = path.join(root, 'profile.json');
  writeFileSync(file, JSON.stringify({ judged_surface: 'site', stack: 'static-html', hosting: 'local', ...block }));
  return file;
}

describe('CLI', () => {
  test('--help prints the usage and exits 0; bad flags and gates exit 2', () => {
    const help = cli(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^Usage: node slop-check\.mjs/);
    assert.match(help.stdout, /Exit codes: 0 every requested gate ok/);
    assert.equal(cli(['--bogus']).status, 2);
    assert.equal(cli(['--gates', 'render.console']).status, 2);
    assert.equal(cli(['--layers', 'dom']).status, 2);
    assert.equal(cli(['--serve', 'a', '--url', 'http://127.0.0.1:1']).status, 2);
  });

  test('--layers static --json on the sloppy repository: tier 1 fails, exit 1, report on stdout', () => {
    const root = repoCopy('sloppy');
    const state = path.join(root, 'state');
    const res = cli(['--root', root, '--profile', profileFile(root), '--state', state, '--registry', REGISTRY, '--layers', 'static', '--json']);
    assert.equal(res.status, 1, res.stderr);
    const report = JSON.parse(res.stdout);
    assert.equal(report.tool, 'slop-check');
    assert.equal(report.version, '1');
    assert.equal(report.ok, false);
    assert.deepEqual(report.gates.map((/** @type {any} */ g) => [g.id, g.state]), [['tells.tier1', 'fail'], ['tells.tier2', 'skipped'], ['tells.score', 'skipped']]);
    assert.deepEqual(report.target, { root: root.replace(/\\/g, '/'), url: null, routes: 2, viewports: [] });
    assert.match(res.stderr, /slop-check: static layer: 7 rules over \d+ files/);
    assert.equal(findingFiles(state).length, 1);
  });

  test('a passing selection exits 0; --out writes the report; --allow-skip lets a skipped gate pass', () => {
    const root = repoCopy('clean');
    const out = path.join(root, 'out');
    const pass = cli(['--root', root, '--profile', profileFile(root), '--state', path.join(root, 'state'), '--registry', REGISTRY,
      '--layers', 'static', '--rules', 'SL-X02,SL-G01', '--gates', 'tells.tier1,tells.score', '--out', out]);
    assert.equal(pass.status, 0, pass.stderr + pass.stdout);
    assert.match(pass.stdout, /^ok\s+tells\.tier1/m);
    assert.match(pass.stdout, /^ok: 2 ok, 0 fail, 0 skipped$/m);
    assert.equal(JSON.parse(readFileSync(path.join(out, 'slop-check.json'), 'utf8')).ok, true);
    const skipped = cli(['--root', root, '--profile', profileFile(root), '--state', path.join(root, 'state'), '--registry', REGISTRY,
      '--layers', 'static', '--rules', 'SL-X02,SL-G01', '--allow-skip', 'tells.tier2']);
    assert.equal(skipped.status, 0, skipped.stdout);
    assert.match(skipped.stdout, /^skipped tells\.tier2 +--rules selects no tier-2 rule/m);
  });

  test('without --serve or --url the gates that need rendering are skipped (exit 1), as in frontend-check', () => {
    const root = repoCopy('clean');
    const res = cli(['--root', root, '--profile', profileFile(root), '--state', path.join(root, 'state'), '--registry', REGISTRY]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /no --serve or --url: the runtime layer cannot run/);
    assert.match(res.stdout, /^not ok: 0 ok, 0 fail, 3 skipped$/m);
  });

  test('a static-only run on a repository with no state folder changes nothing in it; --out keeps the state read-only', () => {
    const root = repoCopy('sloppy');
    const res = cli(['--root', root, '--profile', profileFile(root), '--registry', REGISTRY, '--layers', 'static', '--json']);
    assert.equal(res.status, 1, res.stderr);
    assert.equal(existsSync(path.join(root, '.frontend')), false, 'no state folder is created in the checked repository');
    const where = /findings go to (.+?); the repository is left untouched/.exec(res.stderr);
    assert.ok(where, res.stderr);
    assert.equal(findingFiles(where[1]).length, 1, 'the findings are in the temp folder the log names');
    rmSync(where[1], { recursive: true, force: true });
    const out = path.join(root, 'out-dir');
    const state = path.join(root, 'state-never');
    const withOut = cli(['--root', root, '--profile', profileFile(root), '--state', state, '--registry', REGISTRY, '--layers', 'static', '--out', out]);
    assert.equal(withOut.status, 1, withOut.stderr);
    assert.equal(existsSync(state), false, 'with --out the state folder is neither created nor written (Q-F14)');
    assert.equal(findingFiles(out).length, 1, 'the findings go under --out');
  });

  test('--report --json prints the findings with per-rule counts and exits 0 when no detector failed; --ui-paths narrows the static layer', () => {
    const root = repoCopy('sloppy');
    const state = path.join(root, 'state');
    const res = cli(['--root', root, '--profile', profileFile(root), '--state', state, '--registry', REGISTRY, '--layers', 'static', '--report', '--json']);
    assert.equal(res.status, 0, res.stderr);
    const doc = JSON.parse(res.stdout);
    assert.ok(doc.findings.length > 0, 'the sloppy repository has static findings');
    assert.ok(doc.byRule.length > 0);
    assert.equal(doc.byRule.reduce((/** @type {number} */ n, /** @type {any} */ r) => n + r.findings, 0), doc.findings.length);
    assert.ok(doc.gates.some((/** @type {any} */ g) => g.id === 'tells.tier1' && g.state === 'fail'), 'the gates are still judged in the document');
    const narrowed = cli(['--root', root, '--profile', profileFile(root), '--state', state, '--registry', REGISTRY, '--layers', 'static', '--report', '--json', '--ui-paths', 'no-such-folder']);
    assert.equal(narrowed.status, 0, narrowed.stderr);
    const kept = JSON.parse(narrowed.stdout).findings;
    assert.ok(kept.length < doc.findings.length, 'fewer findings once narrowed');
    assert.deepEqual(kept.filter((/** @type {any} */ f) => /\.(?:[cm]?[jt]sx?|html?|css|scss|vue|svelte)$/.test(f.file)), [], 'no source file outside the named UI paths is read (the fixture detector still names its asset file)');
  });

  test('a profile naming an unknown sponsor runs as one naming none (Q-FX-5: no marks to exempt, never exit 2)', () => {
    const root = repoCopy('clean');
    const res = cli(['--root', root, '--profile', profileFile(root, { sponsors: ['nobody'] }), '--state', path.join(root, 'state'), '--registry', REGISTRY, '--layers', 'static']);
    const plain = cli(['--root', root, '--profile', profileFile(root), '--state', path.join(root, 'state-plain'), '--registry', REGISTRY, '--layers', 'static']);
    assert.notEqual(res.status, 2, res.stderr);
    assert.equal(res.status, plain.status);
    assert.doesNotMatch(res.stderr, /have no entry/);
  });
});

test('fixtures: the official sponsor file and its served copy are byte-identical', () => {
  const sha = (/** @type {string} */ p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  assert.equal(sha(path.join(FIXTURES, 'sloppy', 'public', 'sponsor.svg')), sha(path.join(FIXTURES, 'sloppy', 'dist', 'sponsor.svg')));
});

describe('tells.score: overlapping rules on the same place', () => {
  test('a rule whose every counted finding sits where a higher-scoring rule counted is folded into it', () => {
    const same = judge([runtimeObs('SL-M04', '/', 'desktop', '#stats'), runtimeObs('SL-C01', '/', 'desktop', '#stats')]);
    assert.deepEqual(same.score.rules.map((r) => r.rule), ['SL-M04']);
    assert.deepEqual(same.score.collapsed, [{ rule: 'SL-C01', into: 'SL-M04' }]);
    assert.equal(same.score.total, 4);
    assert.match(same.gates['tells.score'].detail, /SL-C01 folded into SL-M04 \(same places\)/);
    const apart = judge([runtimeObs('SL-M04', '/', 'desktop', '#stats'), runtimeObs('SL-C01', '/', 'desktop', '#stats'), runtimeObs('SL-C01', '/', 'desktop', '#go')]);
    assert.deepEqual(apart.score.rules.map((r) => r.rule), ['SL-M04', 'SL-C01'], 'one finding elsewhere keeps the rule');
    assert.equal(apart.score.total, 5);
  });
});
