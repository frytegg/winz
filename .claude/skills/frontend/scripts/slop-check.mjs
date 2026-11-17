// @ts-check
/**
 * The tells gates of the /frontend checker (scripts/CONTRACTS.md section 5): `tells.tier1`, `tells.tier2` and
 * `tells.score` over the rule registry. The static layer runs each rule's static detector over the repository's
 * comment-stripped sources; the runtime layer renders every route at the desktop and mobile viewports and runs each
 * rule's runtime detector. The runtime layer is authoritative: a static finding counts only when the same rule has a
 * rendered finding left after exemptions, or when the rule has no runtime detector.
 *
 * Exemptions, never by colour or by name alone:
 * - sponsor-hash (rules whose `allowlist` is "sponsor-hash"): the bytes of the finding's `file`, of its `asset` (a
 *   repository path for a static finding, a same-origin or data: URL for a runtime one) or its `sha256` match an
 *   official file of a profile sponsor in assets/sponsor-allowlist.json (FD21);
 * - category (rules whose `allowlist` is "category"): an entry of `<design>/waivers.json` `category` for the rule,
 *   with its recorded reason;
 * - waiver (any rule): a `<design>/waivers.json` waiver for the rule whose scope covers the finding and whose reason
 *   and evidence are non-empty. A waiver citing a sponsor whose colours are claimed as a mark is refused (FD21).
 * Waiver scopes: `/route` (every finding on that route), `/route <css selector>` (the matching element and what it
 * contains), a bare CSS selector (on every route), or a repository file path or glob with an optional `:line`
 * (static findings). Scopes that cover the whole site are refused.
 *
 * `tells.score` adds, once per rule, the weight of every candidate or advisory rule with a counted finding, anchors
 * counted double (co-occurrence, FD10-F12), and fails above `profile.tells.score_max` (null: report only). A gate that
 * judges nothing binding is ok with `advisory: true` (lib/report.mjs advise), so the report counts it apart and no
 * reader takes it for a passed check: tells.tier1 and tells.tier2 while no rule has their tier (every rule is a
 * candidate until calibrate.mjs and the owner set tiers), tells.score while score_max is null. Detector
 * errors and pages that never become ready fail the gates they touch. Every run writes its findings to
 * `<state>/tells/<UTC>.json`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli, isMainModule } from './lib/args.mjs';
import { launch, withPage } from './lib/browser.mjs';
import { EnvError, UsageError, exitWith } from './lib/errors.mjs';
import { compileGlob, readText, sha256File, toPosix, writeText } from './lib/fsutil.mjs';
import { designDir, stateDir, statePath } from './lib/paths.mjs';
import { loadProfile } from './lib/profile.mjs';
import { REPORT_VERSION, aggregate, gate, utcSeconds, utcStamp, writeReport } from './lib/report.mjs';
import { loadRoutes, routeUrl } from './lib/routes.mjs';
import { serveStatic } from './lib/serve.mjs';
import { loadAllowlists, loadRegistry, runRuntime, runStatic, runtimeContext, staticContext } from './rules/load.mjs';

/**
 * @typedef {import('./lib/profile.mjs').Profile} Profile
 * @typedef {import('./lib/profile.mjs').Viewport} Viewport
 * @typedef {import('./lib/routes.mjs').Route} Route
 * @typedef {import('./lib/report.mjs').GateMeta} GateMeta
 * @typedef {import('./lib/report.mjs').GateResult} GateResult
 * @typedef {import('./lib/report.mjs').Evidence} Evidence
 * @typedef {import('./lib/serve.mjs').StaticServer} StaticServer
 * @typedef {import('./rules/load.mjs').Rule} Rule
 * @typedef {import('./rules/load.mjs').Registry} Registry
 * @typedef {import('./rules/load.mjs').Allowlist} Allowlist
 * @typedef {import('./rules/load.mjs').Waiver} Waiver
 * @typedef {import('./rules/load.mjs').Finding} Finding
 * @typedef {import('./rules/load.mjs').StaticFinding} StaticFinding
 * @typedef {import('./rules/load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('./rules/load.mjs').ErrorFinding} ErrorFinding
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('playwright-core').Page} Page
 *
 * @typedef {'static' | 'runtime'} Layer
 * @typedef {{root: string, profile: Profile, state?: string | null, design?: string, routes?: Route[],
 *   baseUrl?: string | null, browser?: Browser | null, viewports?: ReadonlyArray<Viewport>,
 *   args?: Record<string, unknown>, log?: (message: string) => void}} CheckContext
 *   What frontend-check (or this CLI) passes to run(). Flags read from `args`: `rules`, `layers`, `registry`,
 *   `sponsor-allowlist`; all optional.
 *
 * @typedef {{kind: 'route', route: string, selector: string | null} | {kind: 'element-or-file', text: string}} Scope
 * @typedef {{index: number, waiver: Waiver, scope: Scope | null, valid: boolean, problems: string[], notes: string[]}} WaiverCheck
 * @typedef {{id: string, names: string[]}} ClaimedSponsor
 * @typedef {{kind: 'sponsor-hash', sha256: string, detail: string}
 *   | {kind: 'category', category: string, source: string, detail: string}
 *   | {kind: 'waiver', waiver: number, scope: string, detail: string}
 *   | {kind: 'rendered', detail: string}} Exemption
 * @typedef {{finding: StaticFinding | RuntimeFinding, digests: string[], selectorHits: number[], notes: string[]}} Observation
 *   A detector's finding plus what the run measured around it: SHA-256 digests of the files it points at, the
 *   waivers whose selector matched its element, and notes.
 * @typedef {{route: string, viewport: string, error: string}} PageError
 * @typedef {(StaticFinding | RuntimeFinding) & {tier: string, anchor: boolean, weight: number, confirmed: boolean,
 *   exempt: Exemption | null, counts: boolean, notes?: string[]}} Judged
 * @typedef {{rule: Rule, judged: Judged[], counting: Judged[], exempt: Judged[], unconfirmed: Judged[],
 *   errors: ErrorFinding[], undecidable: string | null}} RuleOutcome
 * @typedef {{index: number, rule: string, scope: string, valid: boolean, problems: string[], notes: string[],
 *   covered: number}} WaiverReport
 * @typedef {{index: number, rule: string, category: string, reason: string, source: string, applies: boolean,
 *   note: string}} CategoryReport
 * @typedef {{rules: Rule[], layers: Layer[], judged: Judged[], outcomes: Map<string, RuleOutcome>,
 *   errors: ErrorFinding[], pageErrors: PageError[], waivers: WaiverReport[], category: CategoryReport[]}} Evaluation
 * @typedef {{rule: string, tier: string, weight: number, anchor: boolean, points: number, findings: number}} ScoreRow
 * @typedef {{total: number, anchors: number, rules: ScoreRow[], byRoute: Array<{route: string, score: number,
 *   rules: string[]}>, collapsed?: Array<{rule: string, into: string}>}} Score
 * @typedef {{static?: string, runtime?: string}} LayerNotes why a layer did not run
 */

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The sponsor allowlist shipped with the skill (FD21 deliverable). */
export const DEFAULT_SPONSOR_FILE = path.join(SCRIPTS_DIR, '..', 'assets', 'sponsor-allowlist.json');

export const TOOL = 'slop-check';

/** @type {ReadonlyArray<Readonly<GateMeta>>} */
export const GATES = Object.freeze([
  Object.freeze({
    id: 'tells.tier1',
    title: 'No confirmed tier-1 tell',
    ifDropped: 'a calibrated AI tell that stays silent on human sites would ship',
  }),
  Object.freeze({
    id: 'tells.tier2',
    title: 'Every tier-2 tell waived with a reason',
    ifDropped: 'a tell allowed only for a stated reason would ship without one',
  }),
  Object.freeze({
    id: 'tells.score',
    title: 'Weighted tell score within the limit',
    ifDropped: 'several weak tells together would pass because none alone is tier 1',
  }),
]);

/** The rule tiers each gate judges. */
export const GATE_TIERS = /** @type {Readonly<Record<string, readonly string[]>>} */ (Object.freeze({
  'tells.tier1': Object.freeze(['tier1']),
  'tells.tier2': Object.freeze(['tier2']),
  'tells.score': Object.freeze(['candidate', 'advisory']),
}));

const TIER_LABEL = /** @type {Readonly<Record<string, string>>} */ (Object.freeze({
  'tells.tier1': 'tier-1',
  'tells.tier2': 'tier-2',
  'tells.score': 'candidate or advisory',
}));

/** @type {ReadonlyArray<Layer>} */
export const LAYERS = Object.freeze(['static', 'runtime']);

const EVIDENCE_MAX = 25;
const TEXT_MAX = 120;
const ASSET_MAX_BYTES = 20 * 1024 * 1024;
const SHA256_HEX = /^[0-9a-f]{64}$/i;
const REGEX_SPECIALS = /[.+?^${}()|[\]\\]/g;
/** Scope words and selectors that would waive a rule on every page. */
const WHOLE_SITE = new Set(['*', '**', 'site', 'all', 'global', 'everywhere', 'html', ':root', 'body', 'document']);
const ROUTE_WILDCARDS = new Set(['/*', '/**', '/**/*']);

/**
 * A list flag as a string array: accepts undefined, one string, a comma-separated string or an array of them.
 * @param {unknown} value
 * @returns {string[]}
 */
export function splitList(value) {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return items.flatMap((v) => String(v).split(',')).map((s) => s.trim()).filter((s) => s !== '');
}

/**
 * The gates to run. `undefined` selects all three; `tells` selects the group. In run() ids of other groups are
 * ignored (frontend-check passes each module its own ids); with `strict` (the CLI) any unknown id is a UsageError.
 * @param {unknown} selected
 * @param {{strict?: boolean}} [options]
 * @returns {GateMeta[]}
 */
export function selectGates(selected, { strict = false } = {}) {
  if (selected === undefined || selected === null) return GATES.map((g) => ({ ...g }));
  const wanted = new Set();
  /** @type {string[]} */
  const unknown = [];
  for (const id of splitList(selected)) {
    if (id === 'tells') for (const g of GATES) wanted.add(g.id);
    else if (GATES.some((g) => g.id === id)) wanted.add(id);
    else if (strict || id.startsWith('tells.')) unknown.push(id);
  }
  if (unknown.length > 0) {
    throw new UsageError(`unknown gate ${unknown.join(', ')}; slop-check runs tells or ${GATES.map((g) => g.id).join(', ')}`);
  }
  return GATES.filter((g) => wanted.has(g.id)).map((g) => ({ ...g }));
}

/**
 * `--layers`: static, runtime, both (default) or all.
 * @param {unknown} value
 * @returns {Layer[]}
 */
export function parseLayers(value) {
  const items = splitList(value).map((s) => s.toLowerCase());
  if (items.length === 0) return [...LAYERS];
  const wanted = new Set();
  for (const item of items) {
    if (item === 'both' || item === 'all') {
      wanted.add('static');
      wanted.add('runtime');
    } else if (item === 'static' || item === 'runtime') {
      wanted.add(item);
    } else {
      throw new UsageError(`--layers ${item} is not a layer; use static, runtime or static,runtime`);
    }
  }
  return LAYERS.filter((l) => wanted.has(l));
}

/**
 * The rules a run executes: those whose tier one of the requested gates judges, narrowed by `--rules` (ids, case
 * insensitive, `*` matching any characters). A pattern that matches no registry rule, or a selection that leaves no
 * rule for any requested gate, is a UsageError.
 * @param {Registry} registry
 * @param {unknown} patterns
 * @param {ReadonlySet<string>} tiers
 * @returns {Rule[]}
 */
export function selectRules(registry, patterns, tiers) {
  const judged = registry.rules.filter((r) => tiers.has(r.tier));
  const list = splitList(patterns);
  if (list.length === 0) return judged;
  const matchers = list.map((p) => ({ p, re: idPattern(p) }));
  const unknown = matchers.filter((m) => !registry.rules.some((r) => m.re.test(r.id))).map((m) => m.p);
  if (unknown.length > 0) {
    throw new UsageError(`--rules ${unknown.join(', ')} matches no rule of ${registry.path}; ids look like SL-T01 and * matches any characters`);
  }
  const chosen = judged.filter((r) => matchers.some((m) => m.re.test(r.id)));
  if (chosen.length === 0) {
    throw new UsageError(`--rules ${list.join(',')} selects no rule judged by the requested gates (tiers ${[...tiers].join(', ')}); widen --gates or --rules`);
  }
  return chosen;
}

/**
 * @param {string} pattern
 * @returns {RegExp}
 */
function idPattern(pattern) {
  const source = pattern.toUpperCase().split('*').map((part) => part.replace(REGEX_SPECIALS, '\\$&')).join('.*');
  return new RegExp(`^${source}$`);
}

/**
 * The viewports of the runtime layer: the ones named desktop and mobile; without those names, the widest viewport
 * that is not mobile and the first mobile one.
 * @param {ReadonlyArray<Viewport> | undefined} viewports
 * @returns {Viewport[]}
 */
export function tellViewports(viewports) {
  const list = Array.isArray(viewports) ? viewports.filter((v) => v && Number.isInteger(v.width) && Number.isInteger(v.height)) : [];
  const named = (/** @type {string} */ name) => list.find((v) => v.name === name);
  const desktop = named('desktop') ?? [...list].filter((v) => !v.isMobile).sort((a, b) => b.width - a.width)[0];
  const mobile = named('mobile') ?? list.find((v) => v.isMobile && v !== desktop);
  /** @type {Viewport[]} */
  const out = [];
  for (const v of [desktop, mobile]) if (v && !out.includes(v)) out.push(v);
  return out;
}

/**
 * Reads a waiver scope. `/route` and `/route <selector>` address runtime findings; anything else is tried as a CSS
 * selector on every route (runtime findings) and as a repository file path or glob with an optional `:line` (static
 * findings). Empty scopes and scopes covering the whole site are refused.
 * @param {unknown} raw
 * @returns {{scope: Scope | null, problem: string | null}}
 */
export function parseScope(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') return { scope: null, problem: 'scope is empty: name a route and selector, or a file' };
  if (WHOLE_SITE.has(text.toLowerCase())) {
    return { scope: null, problem: `scope "${text}" covers the whole site: name a route and selector, or a file` };
  }
  if (text.startsWith('/')) {
    const [route, ...rest] = text.split(/\s+/);
    const selector = rest.join(' ').trim() || null;
    if (ROUTE_WILDCARDS.has(route) && (selector === null || WHOLE_SITE.has(selector.toLowerCase()))) {
      return { scope: null, problem: `scope "${text}" covers the whole site: name a route and selector, or a file` };
    }
    return { scope: { kind: 'route', route, selector }, problem: null };
  }
  return { scope: { kind: 'element-or-file', text }, problem: null };
}

/**
 * Whether a route path matches a waiver's route pattern: exact (trailing slash ignored), `*` one path segment,
 * `**` any depth.
 * @param {string} pattern
 * @param {unknown} route
 * @returns {boolean}
 */
export function routeMatches(pattern, route) {
  if (typeof route !== 'string') return false;
  const norm = (/** @type {string} */ p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
  const want = norm(pattern);
  const have = norm(route);
  if (!want.includes('*')) return want === have;
  const source = want
    .split(/(\*\*|\*)/)
    .map((part) => (part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(REGEX_SPECIALS, '\\$&')))
    .join('');
  return new RegExp(`^${source}$`).test(have);
}

/**
 * Whether a file scope (`src/Hero.tsx`, `src/**`, `Hero.tsx` at any depth, `src/Hero.tsx:12`) covers a static
 * finding.
 * @param {string} text
 * @param {unknown} file
 * @param {unknown} line
 * @returns {boolean}
 */
export function fileMatches(text, file, line) {
  if (typeof file !== 'string' || file === '') return false;
  const m = /^(.*?)(?::(\d+))?$/.exec(text);
  const pattern = m && m[1] ? m[1] : text;
  let matcher;
  try {
    matcher = compileGlob(pattern);
  } catch {
    return false;
  }
  if (!matcher(file)) return false;
  return !m || m[2] === undefined || Number(m[2]) === line;
}

/**
 * The sponsors whose colours and look are claimed as marks (FD21 `colours.claimed_as_mark`), with the names a waiver
 * may cite them by: the id, the id with spaces, and the display name before any parenthesis.
 * @param {ReadonlyArray<unknown>} entries sponsor allowlist entries
 * @returns {ClaimedSponsor[]}
 */
export function claimedSponsors(entries) {
  /** @type {Map<string, ClaimedSponsor>} */
  const out = new Map();
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const colours = isObject(entry.colours) ? entry.colours : {};
    if (colours.claimed_as_mark !== true && entry.claimed_as_mark !== true) continue;
    const id = typeof entry.sponsor === 'string' ? entry.sponsor : typeof entry.id === 'string' ? entry.id : '';
    /** @type {Set<string>} */
    const names = new Set();
    if (typeof entry.display_name === 'string') {
      const short = entry.display_name.split(' (')[0].trim();
      if (short) names.add(short);
    }
    if (id) {
      names.add(id);
      names.add(id.replace(/-/g, ' '));
    }
    const key = (id || [...names][0] || '').toLowerCase();
    if (key) out.set(key, { id: id || [...names][0], names: [...names] });
  }
  return [...out.values()];
}

/**
 * Validates every waiver once: a registry rule, a usable scope, a non-empty reason and evidence, and no citation of
 * a sponsor whose look is claimed as a mark. Invalid waivers never cover a finding; their problems are reported.
 * @param {ReadonlyArray<Waiver>} waivers
 * @param {ReadonlySet<string>} ruleIds every rule id of the registry
 * @param {ReadonlyArray<ClaimedSponsor>} claimed
 * @returns {WaiverCheck[]}
 */
export function checkWaivers(waivers, ruleIds, claimed) {
  return waivers.map((waiver, index) => {
    /** @type {string[]} */
    const problems = [];
    if (!ruleIds.has(waiver.rule)) problems.push(`rule ${JSON.stringify(waiver.rule)} is not in the registry`);
    const { scope, problem } = parseScope(waiver.scope);
    if (problem) problems.push(problem);
    if (!nonBlank(waiver.reason)) problems.push('reason is empty: say why the tell is deliberate (a finding, the brief, the sponsor\'s real brand)');
    if (!evidenceText(waiver.evidence)) problems.push('evidence is empty: cite the finding id, file or URL behind the reason');
    const cited = citedClaimed(waiver, claimed);
    if (cited) problems.push(`cites ${cited}, whose colours and look are claimed as trademarks (FD21): such waivers are refused`);
    return { index, waiver, scope, valid: problems.length === 0, problems, notes: [] };
  });
}

/**
 * @param {Waiver} waiver
 * @param {ReadonlyArray<ClaimedSponsor>} claimed
 * @returns {string | null}
 */
function citedClaimed(waiver, claimed) {
  const text = `${waiver.reason ?? ''} ${evidenceText(waiver.evidence)}`;
  for (const sponsor of claimed) {
    for (const name of sponsor.names) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(REGEX_SPECIALS, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');
      if (re.test(text)) return name;
    }
  }
  return null;
}

/**
 * @param {unknown} evidence
 * @returns {string}
 */
function evidenceText(evidence) {
  if (typeof evidence === 'string') return evidence.trim();
  if (Array.isArray(evidence)) return evidence.filter((e) => typeof e === 'string' && e.trim() !== '').join(', ');
  return '';
}

/**
 * The selector a waiver asks the page to test for a runtime finding on `route`, or null when the waiver needs no
 * element (route-only scope) or cannot cover that route.
 * @param {WaiverCheck} check
 * @param {unknown} route
 * @returns {string | null}
 */
export function waiverSelector(check, route) {
  const scope = check.scope;
  if (!check.valid || !scope) return null;
  if (scope.kind === 'route') return scope.selector !== null && routeMatches(scope.route, route) ? scope.selector : null;
  return scope.text;
}

/**
 * @param {WaiverCheck} check
 * @param {Observation} obs
 * @returns {boolean}
 */
function covers(check, obs) {
  const scope = check.scope;
  if (!check.valid || !scope || check.waiver.rule !== obs.finding.rule) return false;
  const f = obs.finding;
  if (f.layer === 'static') return scope.kind === 'element-or-file' && fileMatches(scope.text, f.file, f.line);
  if (scope.kind === 'route') {
    if (!routeMatches(scope.route, f.route)) return false;
    return scope.selector === null || obs.selectorHits.includes(check.index);
  }
  return obs.selectorHits.includes(check.index);
}

/**
 * The finding's own exemption, in order: sponsor file hash, category entry, waiver.
 * @param {Rule} rule
 * @param {Observation} obs
 * @param {Allowlist} allowlist
 * @param {ReadonlyArray<WaiverCheck>} checks
 * @returns {Exemption | null}
 */
function ownExemption(rule, obs, allowlist, checks) {
  if (rule.allowlist === 'sponsor-hash') {
    const sha = obs.digests.find((d) => allowlist.sponsorHashes.has(d));
    if (sha) return { kind: 'sponsor-hash', sha256: sha, detail: `official sponsor file, sha256 ${sha.slice(0, 12)}` };
  }
  if (rule.allowlist === 'category') {
    const entry = allowlist.category.find((c) => c.rule === rule.id && nonBlank(c.reason));
    if (entry) return { kind: 'category', category: entry.category, source: entry.source, detail: entry.reason };
  }
  const check = checks.find((c) => covers(c, obs));
  if (check) return { kind: 'waiver', waiver: check.index, scope: check.waiver.scope, detail: check.waiver.reason };
  return null;
}

/**
 * @param {Rule} rule
 * @param {ReadonlySet<Layer>} layers
 * @param {LayerNotes} notes
 * @returns {string | null}
 */
function undecidableReason(rule, layers, notes) {
  if (rule.runtime && !layers.has('runtime')) return `the runtime layer did not run (${notes.runtime ?? 'not requested'})`;
  if (!rule.runtime && !layers.has('static')) return `the static layer did not run (${notes.static ?? 'not requested'})`;
  return null;
}

/**
 * @typedef {{rules: Rule[], registryRules?: Rule[], observations: Observation[], errors?: ErrorFinding[],
 *   pageErrors?: PageError[], layers: ReadonlyArray<Layer>, layerNotes?: LayerNotes, allowlist: Allowlist,
 *   waiverChecks?: WaiverCheck[]}} EvaluateInput
 */

/**
 * Judges every finding of a run (pure). A runtime finding is confirmed; a static finding is confirmed when its rule
 * has no runtime detector, or when the runtime layer ran and found the rule rendered. A confirmed static finding
 * whose rule's rendered findings are all exempt is exempt too ('rendered'). A finding counts when it is confirmed
 * and not exempt. A rule is undecidable when the layer it depends on did not run.
 * @param {EvaluateInput} input
 * @returns {Evaluation}
 */
export function evaluate({ rules, registryRules, observations, errors = [], pageErrors = [], layers, layerNotes = {}, allowlist, waiverChecks = [] }) {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const layerSet = new Set(layers);
  /** @type {Array<{obs: Observation, rule: Rule, exempt: Exemption | null}>} */
  const own = [];
  for (const obs of observations) {
    const rule = byId.get(obs.finding.rule);
    if (rule) own.push({ obs, rule, exempt: ownExemption(rule, obs, allowlist, waiverChecks) });
  }
  /** @type {Map<string, {total: number, open: number}>} */
  const rendered = new Map();
  for (const { obs, rule, exempt } of own) {
    if (obs.finding.layer !== 'runtime') continue;
    const s = rendered.get(rule.id) ?? { total: 0, open: 0 };
    s.total += 1;
    if (!exempt) s.open += 1;
    rendered.set(rule.id, s);
  }
  /** @type {Judged[]} */
  const judged = own.map(({ obs, rule, exempt }) => {
    let confirmed = true;
    let ex = exempt;
    if (obs.finding.layer === 'static' && rule.runtime) {
      const s = rendered.get(rule.id);
      confirmed = layerSet.has('runtime') && s !== undefined && s.total > 0;
      if (confirmed && !ex && s && s.open === 0) ex = { kind: 'rendered', detail: `every rendered finding of ${rule.id} is exempt` };
    }
    return {
      ...obs.finding,
      tier: rule.tier,
      anchor: rule.anchor,
      weight: rule.weight,
      confirmed,
      exempt: ex,
      counts: confirmed && ex === null,
      ...(obs.notes.length > 0 ? { notes: [...obs.notes] } : {}),
    };
  });
  const order = new Map(rules.map((r, i) => [r.id, i]));
  judged.sort((a, b) => compareJudged(a, b, order));
  /** @type {Map<string, RuleOutcome>} */
  const outcomes = new Map();
  for (const rule of rules) {
    const mine = judged.filter((j) => j.rule === rule.id);
    outcomes.set(rule.id, {
      rule,
      judged: mine,
      counting: mine.filter((j) => j.counts),
      exempt: mine.filter((j) => j.confirmed && j.exempt !== null),
      unconfirmed: mine.filter((j) => !j.confirmed),
      errors: errors.filter((e) => e.rule === rule.id),
      undecidable: undecidableReason(rule, layerSet, layerNotes),
    });
  }
  const waivers = waiverChecks.map((c) => {
    const covered = observations.filter((o) => covers(c, o)).length;
    const notes = [...c.notes];
    if (c.valid && covered === 0 && byId.has(c.waiver.rule)) notes.push('matched no finding in this run: check the scope');
    return { index: c.index, rule: c.waiver.rule, scope: c.waiver.scope, valid: c.valid, problems: [...c.problems], notes, covered };
  });
  const ruleIndex = new Map((registryRules ?? rules).map((r) => [r.id, r]));
  const category = allowlist.category.map((c, index) => {
    const rule = ruleIndex.get(c.rule);
    const applies = rule?.allowlist === 'category';
    const note = !rule
      ? `rule ${c.rule} is not in the registry`
      : applies
        ? ''
        : `${c.rule} takes no category exemption (its allowlist is ${rule.allowlist}); record a waiver instead`;
    return { index, rule: c.rule, category: c.category, reason: c.reason, source: c.source, applies, note };
  });
  return { rules, layers: LAYERS.filter((l) => layerSet.has(l)), judged, outcomes, errors: [...errors], pageErrors: [...pageErrors], waivers, category };
}

/**
 * @param {Judged} a
 * @param {Judged} b
 * @param {Map<string, number>} order
 * @returns {number}
 */
function compareJudged(a, b, order) {
  const text = (/** @type {unknown} */ v) => (v === undefined || v === null ? '' : String(v));
  const cmp = (/** @type {string} */ x, /** @type {string} */ y) => (x < y ? -1 : x > y ? 1 : 0);
  return (order.get(a.rule) ?? 0) - (order.get(b.rule) ?? 0)
    || cmp(a.layer, b.layer)
    || cmp(text(a.file ?? a.route), text(b.file ?? b.route))
    || (Number(a.line) || 0) - (Number(b.line) || 0)
    || cmp(text(a.viewport), text(b.viewport))
    || cmp(text(a.selector), text(b.selector));
}

/**
 * The co-occurrence score: each candidate or advisory rule with a counted finding adds its weight once, twice for an
 * anchor rule. A rule whose every counted finding sits where a higher-scoring rule already counted (the same file and
 * line, or the same element on the same route and viewport) adds nothing and is listed in `collapsed`: one installed
 * primitive line is one decision, not three tells (FD10-F29 notes the T11 and T14 overlap). `byRoute` scores each
 * route from the rules rendered there plus the static-only rules (site-wide).
 * @param {Evaluation} ev
 * @param {ReadonlyArray<{path: string}>} routes
 * @returns {Score}
 */
export function scoreOf(ev, routes) {
  const tiers = GATE_TIERS['tells.score'];
  /** @type {ScoreRow[]} */
  const candidates = [];
  for (const o of ev.outcomes.values()) {
    if (!tiers.includes(o.rule.tier) || o.counting.length === 0) continue;
    candidates.push({
      rule: o.rule.id,
      tier: o.rule.tier,
      weight: o.rule.weight,
      anchor: o.rule.anchor,
      points: o.rule.weight * (o.rule.anchor ? 2 : 1),
      findings: o.counting.length,
    });
  }
  candidates.sort((a, b) => b.points - a.points || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
  /** @type {ScoreRow[]} */
  const rows = [];
  /** @type {Array<{rule: string, into: string}>} */
  const collapsed = [];
  /** @type {Map<string, string>} */
  const claimed = new Map();
  for (const row of candidates) {
    const keys = /** @type {RuleOutcome} */ (ev.outcomes.get(row.rule)).counting.map(locationKey);
    const owner = keys.every((k) => claimed.has(k)) ? claimed.get(keys[0]) : undefined;
    if (owner !== undefined) {
      collapsed.push({ rule: row.rule, into: owner });
      continue;
    }
    for (const k of keys) if (!claimed.has(k)) claimed.set(k, row.rule);
    rows.push(row);
  }
  const sum = (/** @type {ScoreRow[]} */ list) => round(list.reduce((s, r) => s + r.points, 0));
  const byRoute = routes.map((route) => {
    const here = rows.filter((row) => {
      const o = ev.outcomes.get(row.rule);
      return o !== undefined && (!o.rule.runtime || o.counting.some((j) => j.layer === 'runtime' && j.route === route.path));
    });
    return { route: route.path, score: sum(here), rules: here.map((r) => r.rule) };
  });
  return { total: sum(rows), anchors: rows.filter((r) => r.anchor).length, rules: rows, byRoute, collapsed };
}

/**
 * Where a counted finding sits: a static finding's file and line, a runtime finding's route, viewport and element.
 * @param {Judged} j
 * @returns {string}
 */
function locationKey(j) {
  return j.layer === 'static'
    ? `static ${String(j.file)}:${String(j.line)}`
    : `runtime ${String(j.route)} ${String(j.viewport)} ${String(j.selector)}`;
}

/**
 * The gate results of `metas` for an evaluation.
 * @param {Evaluation} ev
 * @param {ReadonlyArray<GateMeta>} metas
 * @param {{score: Score, scoreMax?: number | null, findings?: string, narrowed?: boolean, registryRules?: Rule[]}} options
 *   `findings`: the findings file to name in each detail; `narrowed`: --rules was given, so a gate whose tiers the
 *   registry has but the selection dropped is skipped instead of vacuously ok
 * @returns {GateResult[]}
 */
export function judgeGates(ev, metas, { score, scoreMax = null, findings = '', narrowed = false, registryRules = [] }) {
  return metas.map((meta) => judgeGate(meta, ev, { score, scoreMax, findings, narrowed, registryRules }));
}

/**
 * @param {GateMeta} meta
 * @param {Evaluation} ev
 * @param {{score: Score, scoreMax: number | null, findings: string, narrowed: boolean, registryRules: Rule[]}} options
 * @returns {GateResult}
 */
function judgeGate(meta, ev, { score, scoreMax, findings, narrowed, registryRules }) {
  const g = gate(meta);
  const tiers = GATE_TIERS[meta.id] ?? [];
  const label = TIER_LABEL[meta.id] ?? meta.id;
  /** @type {RuleOutcome[]} */
  const outcomes = [];
  for (const rule of ev.rules) {
    const o = ev.outcomes.get(rule.id);
    if (o && tiers.includes(rule.tier)) outcomes.push(o);
  }
  const where = findings ? `; findings: ${findings}` : '';
  if (outcomes.length === 0) {
    if (narrowed && registryRules.some((r) => tiers.includes(r.tier))) {
      return g.skip(`--rules selects no ${label} rule, so ${meta.id} was not judged`);
    }
    return g.advise(`advisory: no ${label} rule in the registry, so nothing binding was judged until calibrate.mjs and the owner set tiers${uncalibrated(ev)}${where}`);
  }
  const errors = outcomes.flatMap((o) => o.errors);
  const pageErrors = ev.layers.includes('runtime') && outcomes.some((o) => o.rule.runtime) ? ev.pageErrors : [];
  const broken = brokenText(errors, pageErrors);
  const brokenEvidence = [...errors.map(errorEvidence), ...pageErrors.map(pageErrorEvidence)];
  const firing = outcomes.filter((o) => o.counting.length > 0);
  const undecidable = outcomes.filter((o) => o.undecidable !== null);
  const tail = `${notCounted(outcomes)}${where}`;

  if (meta.id === 'tells.score') {
    const rows = score.rules;
    const listed = rows.slice(0, 6).map((r) => `${r.rule} ${fmt(r.points)}`).join(', ') + (rows.length > 6 ? `, +${rows.length - 6} more` : '');
    const head = `score ${fmt(score.total)} from ${count(rows.length, 'rule')}`
      + (score.anchors > 0 ? ` (${count(score.anchors, 'anchor')} counted double)` : '')
      + ((score.collapsed ?? []).length > 0 ? `, ${(score.collapsed ?? []).map((c) => `${c.rule} folded into ${c.into}`).join(', ')} (same places)` : '')
      + (rows.length > 0 ? `: ${listed}` : '');
    const evidence = capped([...brokenEvidence, ...rows.map((row) => scoreEvidence(row, ev))]);
    if (broken) return g.fail(`${head}; ${broken}${tail}`, evidence);
    if (scoreMax !== null && score.total > scoreMax) {
      return g.fail(`${head}, above score_max ${fmt(scoreMax)}; remove co-occurring patterns, anchor rules first${tail}`, evidence);
    }
    if (undecidable.length > 0) return g.skip(`${undecidableText(undecidable, label)}; partial ${head}`);
    if (scoreMax === null) return g.advise(`advisory: ${head}; report only: profile.tells.score_max is null until calibration sets it${tail}`, evidence);
    return g.ok(`${head}, within score_max ${fmt(scoreMax)}${tail}`, evidence);
  }

  if (firing.length > 0 || broken) {
    /** @type {string[]} */
    const parts = [];
    if (firing.length > 0) parts.push(meta.id === 'tells.tier1' ? tier1Text(firing) : tier2Text(firing, ev));
    if (broken) parts.push(broken);
    const found = firing.flatMap((o) => o.counting.map((j) => findingEvidence(j)));
    return g.fail(`${parts.join('; ')}${tail}`, capped([...brokenEvidence, ...found]));
  }
  if (undecidable.length > 0) return g.skip(undecidableText(undecidable, label));
  const exempt = outcomes.flatMap((o) => o.exempt.map((j) => findingEvidence(j, `exempt: ${exemptionText(j.exempt)}`)));
  return g.ok(`no confirmed ${label} finding outside an exemption (${count(outcomes.length, 'rule')} judged)${tail}`, capped(exempt));
}

/**
 * What an uncalibrated registry leaves unjudged: the confirmed candidate and advisory findings only tells.score sees.
 * @param {Evaluation} ev
 * @returns {string}
 */
function uncalibrated(ev) {
  const firing = [...ev.outcomes.values()].filter((o) => GATE_TIERS['tells.score'].includes(o.rule.tier) && o.counting.length > 0);
  if (firing.length === 0) return '';
  const findings = firing.reduce((n, o) => n + o.counting.length, 0);
  return `; ${count(findings, 'confirmed finding')} from ${count(firing.length, 'candidate rule')} are scored by tells.score only`;
}

/**
 * @param {RuleOutcome[]} firing
 * @returns {string}
 */
function tier1Text(firing) {
  const verb = firing.length === 1 ? 'fires' : 'fire';
  return `${count(firing.length, 'tier-1 rule')} ${verb} with confirmed findings: ${ruleList(firing)}; apply each rule's fix from the registry`;
}

/**
 * @param {RuleOutcome[]} firing
 * @param {Evaluation} ev
 * @returns {string}
 */
function tier2Text(firing, ev) {
  const verb = firing.length === 1 ? 'fires' : 'fire';
  const refused = ev.waivers.find((w) => !w.valid && firing.some((o) => o.rule.id === w.rule));
  const hint = refused ? `; waiver ${refused.index} for ${refused.rule} is refused: ${refused.problems[0]}` : '';
  return `${count(firing.length, 'tier-2 rule')} ${verb} without a valid waiver: ${ruleList(firing)}; remove the pattern or record a waiver (rule, scope, reason, evidence) in design/waivers.json${hint}`;
}

/**
 * @param {RuleOutcome[]} outcomes
 * @returns {string}
 */
function ruleList(outcomes) {
  const shown = outcomes.slice(0, 6).map((o) => `${o.rule.id} (${count(o.counting.length, 'finding')})`).join(', ');
  return outcomes.length > 6 ? `${shown}, +${outcomes.length - 6} more` : shown;
}

/**
 * @param {RuleOutcome[]} undecidable
 * @param {string} label
 * @returns {string}
 */
function undecidableText(undecidable, label) {
  const ids = undecidable.slice(0, 6).map((o) => o.rule.id).join(', ') + (undecidable.length > 6 ? `, +${undecidable.length - 6} more` : '');
  return `${count(undecidable.length, `${label} rule`)} cannot be judged: ${undecidable[0].undecidable} (${ids})`;
}

/**
 * @param {RuleOutcome[]} outcomes
 * @returns {string}
 */
function notCounted(outcomes) {
  const exempt = outcomes.reduce((n, o) => n + o.exempt.length, 0);
  const unconfirmed = outcomes.reduce((n, o) => n + o.unconfirmed.length, 0);
  /** @type {string[]} */
  const parts = [];
  if (exempt > 0) parts.push(`${exempt} exempt`);
  if (unconfirmed > 0) parts.push(`${unconfirmed} unconfirmed static`);
  return parts.length > 0 ? `; not counted: ${parts.join(', ')}` : '';
}

/**
 * @param {ErrorFinding[]} errors
 * @param {PageError[]} pageErrors
 * @returns {string}
 */
function brokenText(errors, pageErrors) {
  /** @type {string[]} */
  const parts = [];
  if (errors.length > 0) {
    const shown = errors.slice(0, 3).map((e) => `${e.rule} ${e.layer}${e.route ? ` ${e.route}` : ''}${e.viewport ? ` at ${e.viewport}` : ''}: ${clip(e.error, 80)}`);
    parts.push(`${count(errors.length, 'detector error')} (a skill defect, not a product finding): ${shown.join('; ')}`);
  }
  if (pageErrors.length > 0) {
    const shown = pageErrors.slice(0, 2).map((p) => `${p.route} at ${p.viewport}: ${clip(p.error, 100)}`);
    parts.push(`runtime layer incomplete on ${count(pageErrors.length, 'page')}: ${shown.join('; ')}`);
  }
  return parts.join('; ');
}

/**
 * @param {Exemption | null} ex
 * @returns {string}
 */
function exemptionText(ex) {
  if (!ex) return 'none';
  switch (ex.kind) {
    case 'sponsor-hash':
      return `official sponsor file (sha256 ${ex.sha256.slice(0, 12)})`;
    case 'category':
      return `category ${ex.category || '(unnamed)'}: ${ex.detail}`;
    case 'waiver':
      return `waiver ${ex.waiver} (${ex.scope})`;
    default:
      return ex.detail;
  }
}

/**
 * @param {Judged} j
 * @param {string} [value]
 * @returns {Evidence}
 */
function findingEvidence(j, value) {
  /** @type {Evidence} */
  const e = { rule: j.rule };
  if (j.layer === 'runtime') {
    e.route = String(j.route ?? '');
    e.viewport = String(j.viewport ?? '');
    e.selector = String(j.selector ?? '');
  } else {
    e.file = String(j.file ?? '');
    e.line = Number.isInteger(j.line) ? Number(j.line) : 0;
  }
  e.value = value === undefined ? evidenceValue(j.value) : clip(value);
  return e;
}

/**
 * @param {ScoreRow} row
 * @param {Evaluation} ev
 * @returns {Evidence}
 */
function scoreEvidence(row, ev) {
  const first = ev.outcomes.get(row.rule)?.counting[0];
  const value = `${fmt(row.points)} point${row.points === 1 ? '' : 's'}: weight ${fmt(row.weight)}${row.anchor ? ' x2 (anchor)' : ''}, ${count(row.findings, 'finding')}`;
  return first ? findingEvidence(first, value) : { rule: row.rule, value };
}

/**
 * @param {ErrorFinding} e
 * @returns {Evidence}
 */
function errorEvidence(e) {
  /** @type {Evidence} */
  const out = { rule: e.rule };
  if (e.route) out.route = e.route;
  if (e.viewport) out.viewport = e.viewport;
  out.value = clip(`detector error (${e.layer}): ${e.error}`);
  return out;
}

/**
 * @param {PageError} p
 * @returns {Evidence}
 */
function pageErrorEvidence(p) {
  return { route: p.route, viewport: p.viewport, value: clip(`page error: ${p.error}`) };
}

/**
 * @param {Evidence[]} list
 * @returns {Evidence[]}
 */
function capped(list) {
  return list.slice(0, EVIDENCE_MAX);
}

/**
 * @param {unknown} v
 * @returns {string | number | boolean | null}
 */
function evidenceValue(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return clip(v);
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'boolean') return v;
  try {
    return clip(JSON.stringify(jsonSafe(v)) ?? String(v));
  } catch {
    return clip(String(v));
  }
}

/**
 * Decodes a data: URL into its bytes (base64 or percent-encoded).
 * @param {string} url
 * @returns {{bytes?: Buffer, note?: string}}
 */
export function decodeDataUrl(url) {
  const comma = url.indexOf(',');
  if (!/^data:/i.test(url) || comma < 0) return { note: 'malformed data: URL' };
  const meta = url.slice(5, comma);
  const data = url.slice(comma + 1);
  if (/;base64$/i.test(meta)) return { bytes: Buffer.from(data, 'base64') };
  /** @type {Buffer[]} */
  const parts = [];
  let last = 0;
  for (const m of data.matchAll(/%([0-9a-fA-F]{2})/g)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(Buffer.from(data.slice(last, at), 'utf8'));
    parts.push(Buffer.from([parseInt(m[1], 16)]));
    last = at + 3;
  }
  if (last < data.length) parts.push(Buffer.from(data.slice(last), 'utf8'));
  return { bytes: Buffer.concat(parts) };
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function declaredSha(value) {
  return typeof value === 'string' && SHA256_HEX.test(value) ? value.toLowerCase() : null;
}

/**
 * Digests of the files a static finding points at: its `file` and its `asset` (repository paths, only inside the
 * root), plus a `sha256` the detector computed.
 * @param {string} root
 * @param {StaticFinding} finding
 * @returns {string[]}
 */
function staticDigests(root, finding) {
  /** @type {Set<string>} */
  const digests = new Set();
  for (const rel of [finding.file, finding.asset]) {
    if (typeof rel !== 'string' || rel.trim() === '') continue;
    const abs = path.resolve(root, rel.trim().replace(/^\/+/, ''));
    const inside = path.relative(root, abs);
    if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside) || !isFile(abs)) continue;
    digests.add(sha256File(abs));
  }
  const declared = declaredSha(finding.sha256);
  if (declared) digests.add(declared);
  return [...digests];
}

/**
 * Digests for a runtime finding: a `sha256` the detector computed, and the bytes of its `asset` (a data: URL, or a
 * URL on the page's own origin fetched through the page's request context; any other origin is never fetched).
 * @param {Page} page
 * @param {RuntimeFinding} finding
 * @param {string[]} notes
 * @param {Map<string, {sha256?: string, note?: string}>} cache per page, by asset
 * @returns {Promise<string[]>}
 */
async function runtimeDigests(page, finding, notes, cache) {
  /** @type {Set<string>} */
  const digests = new Set();
  const declared = declaredSha(finding.sha256);
  if (declared) digests.add(declared);
  if (typeof finding.asset === 'string' && finding.asset.trim() !== '') {
    const asset = finding.asset.trim();
    let known = cache.get(asset);
    if (!known) {
      const got = await assetBytes(page, asset);
      known = got.bytes ? { sha256: sha256Bytes(got.bytes) } : { note: got.note ?? `asset ${asset} gave no bytes` };
      cache.set(asset, known);
    }
    if (known.sha256) digests.add(known.sha256);
    else if (known.note) notes.push(known.note);
  }
  return [...digests];
}

/**
 * @param {Page} page
 * @param {string} asset
 * @returns {Promise<{bytes?: Buffer, note?: string}>}
 */
async function assetBytes(page, asset) {
  if (/^data:/i.test(asset)) return decodeDataUrl(asset);
  let url;
  try {
    url = new URL(asset, page.url());
  } catch {
    return { note: `asset ${JSON.stringify(asset)} is not a URL` };
  }
  const origin = new URL(page.url()).origin;
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== origin) {
    return { note: `asset ${url.href} is not served by the app under test; only its own files can match a sponsor hash` };
  }
  let response;
  try {
    response = await page.request.get(url.href, { failOnStatusCode: false, maxRedirects: 0, timeout: 15000 });
  } catch (err) {
    return { note: `asset ${url.href} could not be fetched: ${describeError(err)}` };
  }
  try {
    if (!response.ok()) return { note: `asset ${url.href} answered HTTP ${response.status()}` };
    const length = Number(response.headers()['content-length'] ?? 0);
    if (length > ASSET_MAX_BYTES) return { note: `asset ${url.href} is larger than 20 MB and was not hashed` };
    return { bytes: await response.body() };
  } finally {
    await response.dispose();
  }
}

/**
 * In-page and self-contained: for each finding selector, which waiver selectors match its element or one of its
 * ancestors. An empty or root selector stands for the document element; a trailing pseudo-element is dropped.
 * @param {Array<{sel: string, waivers: Array<{i: number, sel: string}>}>} items
 * @returns {Array<Array<{i: number, hit: boolean, invalid: boolean}>>}
 */
const selectorProbe = function selectorProbe(items) {
  /** @param {string} sel @returns {Element | null} */
  const resolve = (sel) => {
    const clean = String(sel || '').trim().replace(/::?(?:before|after|placeholder|marker|selection|first-line|first-letter|backdrop|file-selector-button)\s*$/i, '');
    if (clean === '' || clean === 'html' || clean === ':root' || clean === 'document') return document.documentElement;
    try {
      return document.querySelector(clean);
    } catch {
      return null;
    }
  };
  const probe = document.createDocumentFragment();
  return items.map((item) => {
    const el = resolve(item.sel);
    return item.waivers.map((w) => {
      let valid = true;
      try {
        probe.querySelector(w.sel);
      } catch {
        valid = false;
      }
      return { i: w.i, hit: valid && el !== null && el.closest(w.sel) !== null, invalid: !valid };
    });
  });
};

/**
 * Asks the page which waiver selectors cover each runtime finding, and records refused selectors on the waiver.
 * @param {Page} page
 * @param {Observation[]} observations
 * @param {WaiverCheck[]} checks
 * @returns {Promise<void>}
 */
async function probeSelectors(page, observations, checks) {
  /** @type {Array<{obs: Observation, sel: string, waivers: Array<{i: number, sel: string}>}>} */
  const items = [];
  for (const obs of observations) {
    const f = obs.finding;
    /** @type {Array<{i: number, sel: string}>} */
    const waivers = [];
    for (const check of checks) {
      if (check.waiver.rule !== f.rule) continue;
      const sel = waiverSelector(check, f.route);
      if (sel !== null) waivers.push({ i: check.index, sel });
    }
    if (waivers.length > 0) items.push({ obs, sel: String(f.selector ?? ''), waivers });
  }
  if (items.length === 0) return;
  const results = await page.evaluate(selectorProbe, items.map(({ sel, waivers }) => ({ sel, waivers })));
  results.forEach((hits, k) => {
    for (const hit of hits) {
      if (hit.hit) items[k].obs.selectorHits.push(hit.i);
      if (hit.invalid) refuseSelector(checks[hit.i]);
    }
  });
}

/**
 * @param {WaiverCheck | undefined} check
 */
function refuseSelector(check) {
  if (!check || !check.scope) return;
  if (check.scope.kind === 'route') {
    const problem = `selector "${check.scope.selector}" is not valid CSS`;
    if (!check.problems.includes(problem)) check.problems.push(problem);
    check.valid = false;
    return;
  }
  const note = `"${check.scope.text}" is not a CSS selector: it covers static findings by file only`;
  if (!check.notes.includes(note)) check.notes.push(note);
}

/**
 * @typedef {{root: string, profile: Profile, allowlist: Allowlist, rules: Rule[], registry: Registry,
 *   log: (message: string) => void}} StaticInput
 */

/**
 * Where a registry's detectors live: the static/ and runtime/ folders beside it, or the skill's own rules/ for a
 * registry file that has none (a tiered copy or a calibration proposal judges the shipped detectors).
 * @param {Registry} registry
 * @returns {string}
 */
function detectorDir(registry) {
  const own = ['static', 'runtime'].some((layer) => existsSync(path.join(registry.dir, layer)));
  return own ? registry.dir : path.join(SCRIPTS_DIR, 'rules');
}

/**
 * @param {StaticInput} input
 * @returns {Promise<{observations: Observation[], errors: ErrorFinding[]}>}
 */
async function collectStatic({ root, profile, allowlist, rules, registry, log }) {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const sctx = staticContext(root, profile, allowlist);
  const raw = await runStatic(rules, sctx, { dir: detectorDir(registry) });
  /** @type {Observation[]} */
  const observations = [];
  /** @type {ErrorFinding[]} */
  const errors = [];
  for (const f of raw) {
    if (isErrorFinding(f)) {
      errors.push(f);
      continue;
    }
    const finding = /** @type {StaticFinding} */ (f);
    const digests = byId.get(finding.rule)?.allowlist === 'sponsor-hash' ? staticDigests(root, finding) : [];
    observations.push({ finding, digests, selectorHits: [], notes: [] });
  }
  const ran = rules.filter((r) => r.static).length;
  log(`static layer: ${count(ran, 'rule')} over ${count(sctx.files.length, 'file')}: ${count(observations.length, 'finding')}, ${count(errors.length, 'detector error')}`);
  return { observations, errors };
}

/**
 * @typedef {{browser: Browser, baseUrl: string, routes: Route[], viewports: Viewport[], profile: Profile,
 *   allowlist: Allowlist, rules: Rule[], registry: Registry, checks: WaiverCheck[],
 *   log: (message: string) => void}} RuntimeInput
 */

/**
 * Renders every route at every viewport and runs the runtime detectors on each page. A page that cannot be reached
 * is an EnvError; a page that never becomes ready (or breaks while observed) is recorded as a page error.
 * @param {RuntimeInput} input
 * @returns {Promise<{observations: Observation[], errors: ErrorFinding[], pageErrors: PageError[]}>}
 */
async function collectRuntime(input) {
  const { browser, baseUrl, routes, viewports, profile, log } = input;
  /** @type {Observation[]} */
  const observations = [];
  /** @type {ErrorFinding[]} */
  const errors = [];
  /** @type {PageError[]} */
  const pageErrors = [];
  for (const route of routes) {
    const url = routeUrl(baseUrl, route, profile);
    for (const viewport of viewports) {
      try {
        const got = await withPage(browser, viewport, url, (page) => observePage(page, route, viewport, input), {
          readyFlag: profile.ready_flag === true,
        });
        observations.push(...got.observations);
        errors.push(...got.errors);
        log(`runtime layer ${route.path} at ${viewport.name}: ${count(got.observations.length, 'finding')}, ${count(got.errors.length, 'detector error')}`);
      } catch (err) {
        if (err instanceof EnvError || err instanceof UsageError) throw err;
        pageErrors.push({ route: route.path, viewport: viewport.name, error: describeError(err) });
        log(`runtime layer ${route.path} at ${viewport.name}: page error: ${describeError(err)}`);
      }
    }
  }
  return { observations, errors, pageErrors };
}

/**
 * @param {Page} page
 * @param {Route} route
 * @param {Viewport} viewport
 * @param {RuntimeInput} input
 * @returns {Promise<{observations: Observation[], errors: ErrorFinding[]}>}
 */
async function observePage(page, route, viewport, { browser, profile, allowlist, rules, registry, checks }) {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const rctx = await runtimeContext(browser, page, route, viewport, profile, allowlist);
  const raw = await runRuntime(rules, rctx, { dir: detectorDir(registry) });
  /** @type {Observation[]} */
  const observations = [];
  /** @type {ErrorFinding[]} */
  const errors = [];
  for (const f of raw) {
    if (isErrorFinding(f)) errors.push(f);
    else observations.push({ finding: /** @type {RuntimeFinding} */ (f), digests: [], selectorHits: [], notes: [] });
  }
  /** @type {Map<string, {sha256?: string, note?: string}>} */
  const assets = new Map();
  for (const obs of observations) {
    if (byId.get(obs.finding.rule)?.allowlist !== 'sponsor-hash') continue;
    obs.digests = await runtimeDigests(page, /** @type {RuntimeFinding} */ (obs.finding), obs.notes, assets);
  }
  await probeSelectors(page, observations, checks);
  return { observations, errors };
}

/**
 * @param {Finding} f
 * @returns {f is ErrorFinding}
 */
function isErrorFinding(f) {
  return typeof (/** @type {Record<string, unknown>} */ (f)).error === 'string';
}

/**
 * Entries of a sponsor allowlist file (top-level array, or under sponsor_allowlist, sponsors or entries). A file the
 * caller named that is missing is a UsageError; the skill's own file missing or unreadable is an EnvError.
 * @param {string | undefined} given the --sponsor-allowlist path, or undefined for the skill's own file
 * @returns {unknown[]}
 */
function readSponsorEntries(given) {
  const file = given ?? DEFAULT_SPONSOR_FILE;
  const fail = (/** @type {string} */ message, /** @type {unknown} */ cause) => (given ? new UsageError(message, { cause }) : new EnvError(message, { cause }));
  if (!existsSync(file)) {
    throw fail(`sponsor allowlist not found at ${toPosix(file)}; it is needed to refuse waivers that cite a sponsor whose look is claimed as a mark`, undefined);
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readText(file));
  } catch (err) {
    throw fail(`sponsor allowlist ${toPosix(file)} is not valid JSON (${describeError(err)}); fix or restore the file`, err);
  }
  if (Array.isArray(raw)) return raw;
  if (!isObject(raw)) return [];
  const list = [raw.sponsor_allowlist, raw.sponsors, raw.entries].find(Array.isArray);
  return Array.isArray(list) ? list : [];
}

/**
 * Runs the selected tells gates (CONTRACTS section 4 and 5) and writes the run's findings to
 * `<state>/tells/<UTC>.json`. Without a browser and a base URL the runtime layer cannot run, and every gate whose
 * rules need it is skipped (never passed).
 * @param {CheckContext} ctx
 * @param {unknown} [selected] gate ids of this module (`tells` for all); undefined selects all three
 * @returns {Promise<GateResult[]>}
 */
export async function run(ctx, selected) {
  return (await runDetailed(ctx, selected)).results;
}

/**
 * @typedef {{rule: string, tier: string, findings: number, confirmed: number, unconfirmed: number, exempt: number,
 *   counted: number, errors: number}} RuleCount
 */

/**
 * run(), plus the findings document it wrote and where: the CLI's --report mode prints that document.
 * @param {CheckContext} ctx
 * @param {unknown} [selected]
 * @returns {Promise<{results: GateResult[], doc: Record<string, unknown> | null, file: string | null}>}
 */
export async function runDetailed(ctx, selected) {
  const metas = selectGates(selected);
  if (metas.length === 0) return { results: [], doc: null, file: null };
  if (!ctx || typeof ctx.root !== 'string' || !ctx.profile) throw new TypeError('run(ctx, selected): ctx needs root and profile');
  const log = typeof ctx.log === 'function' ? ctx.log : () => {};
  const args = ctx.args ?? {};
  const root = path.resolve(ctx.root);
  const profile = ctx.profile;
  const requested = parseLayers(args.layers);
  const registry = loadRegistry(optionalPath(args.registry));
  const tiers = new Set(metas.flatMap((m) => GATE_TIERS[m.id] ?? []));
  const narrowed = splitList(args.rules).length > 0;
  const rules = selectRules(registry, args.rules, tiers);
  const sponsorFile = optionalPath(args['sponsor-allowlist'] ?? args.sponsorAllowlist);
  const allowlist = loadAllowlists(root, profile, { sponsorFile });
  const claimed = allowlist.waivers.length > 0 ? claimedSponsors([...allowlist.sponsors, ...readSponsorEntries(sponsorFile)]) : [];
  const checks = checkWaivers(allowlist.waivers, new Set(registry.rules.map((r) => r.id)), claimed);
  const routes = ctx.routes ?? loadRoutes(root, profile);
  const at = new Date();

  /** @type {Observation[]} */
  const observations = [];
  /** @type {ErrorFinding[]} */
  const errors = [];
  /** @type {PageError[]} */
  const pageErrors = [];
  /** @type {Set<Layer>} */
  const ran = new Set();
  /** @type {LayerNotes} */
  const layerNotes = {};
  if (!requested.includes('static')) layerNotes.static = '--layers runtime';
  if (!requested.includes('runtime')) layerNotes.runtime = '--layers static';

  if (requested.includes('static')) {
    if (rules.some((r) => r.static)) {
      const got = await collectStatic({ root, profile, allowlist, rules, registry, log });
      observations.push(...got.observations);
      errors.push(...got.errors);
    }
    ran.add('static');
  }
  /** @type {Viewport[]} */
  let viewports = [];
  if (requested.includes('runtime')) {
    const runtimeRules = rules.filter((r) => r.runtime);
    viewports = tellViewports(ctx.viewports ?? profile.viewports);
    if (runtimeRules.length === 0) {
      ran.add('runtime');
    } else if (!ctx.browser || !ctx.baseUrl) {
      layerNotes.runtime = 'no app to render: pass --serve <dir> or --url <url>';
      log('runtime layer: no browser or base URL, so gates whose rules need rendering are skipped');
    } else if (viewports.length === 0) {
      throw new UsageError('the profile has no desktop or mobile viewport for the runtime layer; add one to profile.viewports');
    } else {
      const got = await collectRuntime({
        browser: ctx.browser, baseUrl: ctx.baseUrl, routes, viewports, profile, allowlist, rules: runtimeRules, registry, checks, log,
      });
      observations.push(...got.observations);
      errors.push(...got.errors);
      pageErrors.push(...got.pageErrors);
      ran.add('runtime');
    }
  }

  const ev = evaluate({ rules, registryRules: registry.rules, observations, errors, pageErrors, layers: LAYERS.filter((l) => ran.has(l)), layerNotes, allowlist, waiverChecks: checks });
  const score = scoreOf(ev, routes);
  const scoreMax = typeof profile.tells?.score_max === 'number' ? profile.tells.score_max : null;
  // Q-F14 (CONTRACTS section 1): with --out the state folder is read-only, so the findings go under the run's outDir.
  const outDir = typeof args.out === 'string' && args.out && typeof args.outDir === 'string' && args.outDir ? path.resolve(args.outDir) : null;
  // Without a state folder from the caller, nothing is written into the checked repository (no .frontend, no exclude line).
  const state = outDir ?? (ctx.state ? path.resolve(ctx.state) : mkdtempSync(path.join(os.tmpdir(), 'frontend-slop-check-')));
  const file = findingsFile(state, at);
  const shown = displayPath(file, root);
  const results = judgeGates(ev, metas, { score, scoreMax, findings: shown, narrowed, registryRules: registry.rules });
  const doc = {
    tool: TOOL,
    version: REPORT_VERSION,
    at: utcSeconds(at),
    target: { root: toPosix(root), url: ctx.baseUrl ?? null, routes: routes.length, viewports: ran.has('runtime') ? viewports.map((v) => v.name) : [] },
    registry: { path: registry.path, rules: registry.rules.length, run: rules.map((r) => r.id) },
    layers: { requested, ran: ev.layers, notes: layerNotes },
    gates: results,
    score: { ...score, max: scoreMax },
    counts: {
      findings: ev.judged.length,
      counted: ev.judged.filter((j) => j.counts).length,
      exempt: ev.judged.filter((j) => j.confirmed && j.exempt !== null).length,
      unconfirmed: ev.judged.filter((j) => !j.confirmed).length,
      errors: ev.errors.length,
      pageErrors: ev.pageErrors.length,
    },
    byRule: countByRule(ev),
    findings: ev.judged,
    errors: ev.errors,
    pageErrors: ev.pageErrors,
    waivers: ev.waivers,
    category: ev.category,
    sponsors: { ids: allowlist.sponsors.map((s) => String(s.sponsor ?? s.id ?? '')), hashes: allowlist.sponsorHashes.size },
  };
  writeText(file, `${JSON.stringify(jsonSafe(doc), null, 2)}\n`);
  log(`findings: ${shown}`);
  return { results, doc, file };
}

/**
 * One row per rule that found something or failed to run, in registry order: how many findings, how many of them
 * the run confirmed, left unconfirmed, exempted or counted, and how many detector errors.
 * @param {Evaluation} ev
 * @returns {RuleCount[]}
 */
export function countByRule(ev) {
  /** @type {RuleCount[]} */
  const rows = [];
  for (const rule of ev.rules) {
    const judged = ev.judged.filter((j) => j.rule === rule.id);
    const errors = ev.errors.filter((e) => e.rule === rule.id).length;
    if (judged.length === 0 && errors === 0) continue;
    rows.push({
      rule: rule.id,
      tier: rule.tier,
      findings: judged.length,
      confirmed: judged.filter((j) => j.confirmed).length,
      unconfirmed: judged.filter((j) => !j.confirmed).length,
      exempt: judged.filter((j) => j.confirmed && j.exempt !== null).length,
      counted: judged.filter((j) => j.counts).length,
      errors,
    });
  }
  return rows;
}

/**
 * `<state>/tells/<UTC>.json`, or `<UTC>-<n>.json` when a run of the same second already wrote one.
 * @param {string} state
 * @param {Date} at
 * @returns {string}
 */
function findingsFile(state, at) {
  const dir = path.join(state, 'tells');
  const stamp = utcStamp(at);
  let file = path.join(dir, `${stamp}.json`);
  for (let n = 2; existsSync(file); n += 1) file = path.join(dir, `${stamp}-${n}.json`);
  return file;
}

/**
 * @param {string} file
 * @param {string} root
 * @returns {string}
 */
function displayPath(file, root) {
  const rel = path.relative(root, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? toPosix(rel) : toPosix(file);
}

/**
 * A JSON-ready copy: BigInt as a string, non-finite numbers as strings, functions and symbols dropped, cycles cut.
 * @param {unknown} value
 * @param {WeakSet<object>} [seen]
 * @returns {unknown}
 */
function jsonSafe(value, seen = new WeakSet()) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  /** @type {unknown} */
  let out;
  if (Array.isArray(value)) {
    out = value.map((v) => jsonSafe(v, seen) ?? null);
  } else if (value instanceof Set) {
    out = [...value].map((v) => jsonSafe(v, seen) ?? null);
  } else if (value instanceof Map) {
    out = Object.fromEntries([...value].map(([k, v]) => [String(k), jsonSafe(v, seen)]));
  } else {
    /** @type {Record<string, unknown>} */
    const obj = {};
    for (const [k, v] of Object.entries(value)) {
      const safe = jsonSafe(v, seen);
      if (safe !== undefined) obj[k] = safe;
    }
    out = obj;
  }
  seen.delete(value);
  return out;
}

const HELP = `Usage: node slop-check.mjs (--serve <dir> | --url <url>) [options]
       node slop-check.mjs --layers static [options]

Runs the tells gates of the /frontend checker over the rule registry (scripts/CONTRACTS.md section 5):
  tells.tier1  no confirmed tier-1 tell outside an exemption
  tells.tier2  every firing tier-2 tell has a waiver with a reason and evidence
  tells.score  co-occurring candidate and advisory tells, each rule's weight once, anchors double, at most
               profile.tells.score_max (null: report only)
The static layer reads the repository's comment-stripped UI sources (git-visible files only, no dependencies,
virtual environments, nested repositories, tests or tooling; profile paths.ui narrows it); the runtime layer
renders every route of <design>/routes.json at the desktop and mobile viewports and is authoritative. Findings,
exemptions and waiver problems go to <state>/tells/<UTC>.json, or <out>/tells/ with --out. This CLI never creates
a state folder in a repository that has none: without --state or --out, and with no existing state folder, the
findings go to a fresh folder under the system temp directory and the repository is left untouched.

Options:
  --root <repo>              repository root (default: the working directory)
  --profile <abs path>       /execution profile.json or a frontend block file (default: found under --root)
  --state <dir>              state folder (default: .execution/frontend in mode A, .frontend in mode B)
  --serve <dir>              serve a static build and render it
  --url <url>                render a running app
  --gates <ids>              tells, or any of tells.tier1,tells.tier2,tells.score (default: all three)
  --rules <ids>              only these rules (comma-separated, * wildcard), for example SL-T01,SL-M*
  --layers <list>            static, runtime or static,runtime (default); a gate whose rules need a layer that
                             did not run is skipped
  --registry <file>          another rule registry; detectors are read from static/ and runtime/ beside it, or
                             from the skill's own rules/ when there are none (a tiered copy, a calibration proposal)
  --sponsor-allowlist <file> another sponsor allowlist (default: the skill's assets/sponsor-allowlist.json)
  --allow-skip <ids>         gates that may be skipped without failing the run
  --ui-paths <list>          read only these repository-relative paths in the static layer (comma-separated;
                             replaces the profile's paths.ui); package.json files on the way down are read too
  --report                   report mode, for calibration and audits: print the findings document (per-rule
                             counts in byRule, every finding, detector errors) instead of the gate report, and
                             exit 0 unless a detector failed (exit 1); the gates are still in the document
  --out <dir>                write the gate report to <dir>/slop-check.json and the findings to <dir>/tells/;
                             the state folder is then only read (Q-F14)
  --json                     print the gate report (CONTRACTS section 4) on stdout
  -h, --help                 this text

Waiver scopes in <design>/waivers.json: "/route" (every finding on that route), "/route <css selector>" (the
matching element and what it contains), "<css selector>" (on every route), or a repository file path or glob with
an optional ":line" (static findings). Scopes that cover the whole site are refused, and so is a waiver that cites
a sponsor whose look is claimed as a trademark.

Exit codes: 0 every requested gate ok; 1 a gate failed or was skipped (detector errors and pages that never become
ready fail the gates they touch); 2 usage error; 3 environment error (no browser, unreachable URL, broken install).`;

/**
 * The CLI: builds its own context with the same flags as frontend-check and prints the gate report. Without
 * --serve or --url the runtime layer cannot run, so the gates whose rules need it are skipped (exit 1), as in
 * frontend-check.
 * @param {readonly string[]} argv
 * @returns {Promise<number>} the exit code
 */
export async function main(argv) {
  const { values } = parseCli(argv, {
    options: {
      root: { type: 'string' },
      profile: { type: 'string' },
      state: { type: 'string' },
      serve: { type: 'string' },
      url: { type: 'string' },
      gates: { type: 'string', multiple: true },
      rules: { type: 'string', multiple: true },
      layers: { type: 'string', multiple: true },
      registry: { type: 'string' },
      'sponsor-allowlist': { type: 'string' },
      'allow-skip': { type: 'string', multiple: true },
      'ui-paths': { type: 'string', multiple: true },
      report: { type: 'boolean' },
      out: { type: 'string' },
      json: { type: 'boolean' },
    },
    help: HELP,
    allowPositionals: false,
  });
  const metas = selectGates(values.gates, { strict: true });
  if (metas.length === 0) throw new UsageError('--gates selects no gate; use tells or tells.tier1, tells.tier2, tells.score');
  const layers = parseLayers(values.layers);
  if (values.serve !== undefined && values.url !== undefined) throw new UsageError('pass either --serve <dir> or --url <url>, not both');
  for (const key of /** @type {const} */ (['root', 'profile', 'state', 'serve', 'registry', 'sponsor-allowlist', 'out'])) {
    if (values[key] === '') throw new UsageError(`--${key} needs a path`);
  }
  const log = (/** @type {string} */ message) => process.stderr.write(`slop-check: ${message}\n`);
  const root = path.resolve(values.root ?? process.cwd());
  const loaded = loadProfile(values.profile, { root });
  const uiPaths = splitList(values['ui-paths']);
  const profile = uiPaths.length > 0 ? { ...loaded, paths: { ...loaded.paths, ui: uiPaths } } : loaded;
  const routes = loadRoutes(root, profile);
  const { state, outDir } = cliState(root, profile, values, log);
  const wantsRuntime = layers.includes('runtime');
  if (wantsRuntime && values.url !== undefined) routeUrl(values.url, { path: '/' }, profile);
  if (wantsRuntime && values.serve === undefined && values.url === undefined) {
    log('no --serve or --url: the runtime layer cannot run, so gates whose rules need rendering are skipped');
  }
  /** @type {StaticServer | null} */
  let server = null;
  /** @type {Browser | null} */
  let browser = null;
  try {
    /** @type {string | null} */
    let baseUrl = null;
    if (wantsRuntime && values.serve !== undefined) {
      server = await serveStatic(values.serve);
      baseUrl = server.url;
      log(`serving ${toPosix(path.resolve(values.serve))} at ${server.url}`);
    } else if (wantsRuntime && values.url !== undefined) {
      baseUrl = values.url;
    }
    if (baseUrl !== null) browser = await launch();
    const ctx = {
      root,
      profile,
      state,
      design: designDir(root, profile),
      routes,
      baseUrl,
      browser,
      viewports: profile.viewports,
      args: { ...values, ...(outDir ? { out: outDir, outDir } : {}) },
      log,
    };
    const { results, doc } = await runDetailed(ctx, metas.map((m) => m.id));
    const target = {
      root: toPosix(root),
      url: baseUrl,
      routes: routes.length,
      viewports: baseUrl !== null ? tellViewports(profile.viewports).map((v) => v.name) : [],
    };
    const report = aggregate(results, { requested: metas, allowSkip: splitList(values['allow-skip']), tool: TOOL, target });
    if (values.out !== undefined) log(`gate report: ${writeReport(report, values.out, TOOL)}`);
    if (values.report) {
      const errors = Array.isArray(doc?.errors) ? doc.errors.length : 0;
      if (values.json) process.stdout.write(`${JSON.stringify(jsonSafe(doc), null, 2)}\n`);
      else {
        const rows = /** @type {RuleCount[]} */ (doc?.byRule ?? []);
        const lines = rows.map((r) => `${r.rule.padEnd(8)} ${String(r.findings).padStart(4)} finding(s): ${r.confirmed} confirmed, ${r.unconfirmed} unconfirmed, ${r.exempt} exempt${r.errors ? `, ${r.errors} detector error(s)` : ''}`);
        process.stdout.write(`${lines.length ? `${lines.join('\n')}\n` : ''}report: ${rows.length} rule(s) with findings, ${errors} detector error(s)\n`);
      }
      return errors > 0 ? 1 : 0;
    }
    if (values.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      const lines = report.gates.map((g) => `${g.state.padEnd(7)} ${g.id.padEnd(12)} ${g.detail}`);
      process.stdout.write(`${lines.join('\n')}\n${report.ok ? 'ok' : 'not ok'}: ${report.counts.ok} ok, ${report.counts.fail} fail, ${report.counts.skipped} skipped\n`);
    }
    return report.ok ? 0 : 1;
  } finally {
    await closeQuietly(browser, server, log);
  }
}

/**
 * Where the CLI keeps its state and writes its findings. With --out, the state folder is only read and everything
 * goes under --out (Q-F14). With --state, or when the root already has its state folder (the active project), that
 * folder is used as before. Otherwise nothing in the checked repository is created or changed: no state folder, no
 * .git/info/exclude line; the findings go to a fresh temp folder, and the log says where.
 * @param {string} root
 * @param {Profile} profile
 * @param {{state?: string, out?: string}} values
 * @param {(message: string) => void} log
 * @returns {{state: string, outDir: string | null}}
 */
function cliState(root, profile, values, log) {
  const existing = statePath(root, profile, values.state);
  if (values.out !== undefined) return { state: existing, outDir: path.resolve(values.out) };
  if (values.state !== undefined || isDirectory(existing)) return { state: stateDir(root, profile, values.state), outDir: null };
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'frontend-slop-check-'));
  log(`no state folder at ${toPosix(existing)} and no --state or --out: findings go to ${toPosix(outDir)}; the repository is left untouched`);
  return { state: existing, outDir };
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Closes the browser and the server, logging (never throwing) a failure, so the run's own outcome stands.
 * @param {Browser | null} browser
 * @param {StaticServer | null} server
 * @param {(message: string) => void} log
 * @returns {Promise<void>}
 */
async function closeQuietly(browser, server, log) {
  const settled = await Promise.allSettled([browser ? browser.close() : Promise.resolve(), server ? server.close() : Promise.resolve()]);
  for (const s of settled) if (s.status === 'rejected') log(`cleanup failed: ${describeError(s.reason)}`);
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function optionalPath(value) {
  return typeof value === 'string' && value.trim() !== '' ? path.resolve(value) : undefined;
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function describeError(err) {
  if (err instanceof Error) return `${err.name}: ${err.message.split('\n')[0]}`;
  return String(err);
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function nonBlank(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * @param {string} s
 * @param {number} [max]
 * @returns {string}
 */
function clip(s, max = TEXT_MAX) {
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

/**
 * @param {number} n
 * @param {string} noun
 * @returns {string}
 */
function count(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * @param {number} n
 * @returns {number}
 */
function round(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * @param {number} n
 * @returns {string}
 */
function fmt(n) {
  return String(round(n));
}

/**
 * True when this file is the script node was started with.
 * @returns {boolean}
 */
function isMain() {
  return isMainModule(import.meta.url);
}

if (isMain()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => exitWith(err),
  );
}
