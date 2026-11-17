// @ts-check
/**
 * calibrate.mjs measures every rule of the registry on the calibration corpus (ARCHITECTURE.md section 5.2) and
 * proposes a tier for each. For each ready entry it obtains the target (a served folder, a URL, or a Wayback replay
 * whose toolbar is removed and whose requests outside the archive are blocked), runs the static layer when the
 * entry's source_root is a local folder and the runtime layer on every route at desktop and mobile, and records per
 * rule whether it fired. It writes calibration/results/<UTC>/{per-entry.json, per-rule.json, summary.md,
 * proposal.json}. Tiers are only proposed: `--apply <proposal.json>` writes tiers, counts and the date into the
 * registry, and only when the owner runs it.
 *
 * No network by default: URL and Wayback entries need --network (or a HAR recorded earlier, replayed with --har),
 * and a served build's own external requests are blocked unless --network is given.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli, isMainModule } from './lib/args.mjs';
import { goto, launch, newContext } from './lib/browser.mjs';
import { FrontendError, UsageError, exitWith } from './lib/errors.mjs';
import { readText, sha256File, toPosix, writeText } from './lib/fsutil.mjs';
import { DEFAULT_VIEWPORTS, defaultProfile } from './lib/profile.mjs';
import { waitReady } from './lib/ready.mjs';
import { utcSeconds, utcStamp } from './lib/report.mjs';
import { serveStatic } from './lib/serve.mjs';
import { TIERS, loadAllowlists, loadRegistry, runRuntime, runStatic, runtimeContext, staticContext } from './rules/load.mjs';

/**
 * @typedef {import('./rules/load.mjs').Rule} Rule
 * @typedef {import('./rules/load.mjs').Registry} Registry
 * @typedef {import('./rules/load.mjs').Finding} Finding
 * @typedef {import('./rules/load.mjs').Allowlist} Allowlist
 * @typedef {import('./rules/load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('./lib/profile.mjs').Profile} Profile
 * @typedef {import('./lib/profile.mjs').Viewport} Viewport
 * @typedef {import('./lib/routes.mjs').Route} Route
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('playwright-core').BrowserContext} BrowserContext
 * @typedef {import('playwright-core').Page} Page
 *
 * @typedef {'positive' | 'control' | 'exemplar' | 'synthetic'} CorpusSet
 * @typedef {{path: string, name: string, first?: boolean, viewport?: string}} CorpusRoute
 * @typedef {{type: 'url' | 'serve' | 'build' | 'wayback', url?: string | null, replay_url?: string | null,
 *   dir?: string, build_cmd?: string, routes: CorpusRoute[]}} CorpusRender
 * @typedef {{id: string, set: CorpusSet, name?: string, made_by?: string, category?: string,
 *   label_owner?: string | null, render: CorpusRender, source_root?: string, source_paths?: string[],
 *   status: 'ready' | 'needs-build' | 'unavailable', hold_until?: string, notes?: string,
 *   check?: Record<string, unknown>}} CorpusEntry
 * @typedef {{path: string, sha256: string, entries: CorpusEntry[]}} Corpus
 *
 * @typedef {{kind: 'serve', dir: string} | {kind: 'url', base: string} |
 *   {kind: 'wayback', prefix: string, original: string, replay: string}} Target
 * @typedef {{root: string, paths: string[] | null}} StaticSource
 * @typedef {{entry: CorpusEntry, skip: string | null, target: Target | null, targetSkip: string | null,
 *   targetSkipIsData: boolean, staticSource: StaticSource | null, staticSkip: string | null,
 *   staticSkipIsData: boolean}} EntryPlan
 *   A skip "is data" when the corpus entry itself is wrong (a ready entry whose folder does not exist); other skips
 *   follow from the options (no --network) or from the entry's kind (a remote control source).
 * @typedef {'loopback' | 'archive' | 'open'} NetPolicy
 * @typedef {{mode: 'live'} | {mode: 'record' | 'replay', file: string}} HarPlan
 *
 * @typedef {'fired' | 'silent' | 'error' | 'not-run'} RuleState
 * @typedef {{route?: string, viewport?: string, selector?: string, file?: string, line?: number, value?: string,
 *   detail?: string}} Example
 * @typedef {{state: RuleState, static: RuleState | null, runtime: RuleState | null,
 *   findings: {static: number, runtime: number}, examples: Example[], errors: string[]}} EntryRule
 * @typedef {{route: string, viewport: string, url: string, mode: 'live' | 'record' | 'replay', status: number | null,
 *   ok: boolean, error: string | null, ms: number}} PageRecord
 * @typedef {{id: string, set: CorpusSet, name: string, made_by: string | null, category: string | null,
 *   status: 'measured' | 'partial' | 'failed' | 'skipped', reason: string | null,
 *   target: {type: string, location: string | null},
 *   static: {ran: boolean, reason: string | null, root: string | null, files: number, findings: number},
 *   runtime: {ran: boolean, reason: string | null, pages: PageRecord[]},
 *   rules: Record<string, EntryRule>}} EntryResult
 * @typedef {{fired: number, total: number}} Count
 * @typedef {{fired: string[], silent: string[], error: string[], notRun: string[]}} StateLists
 * @typedef {{entries: number, both: number, ownerOnly: number, detectorOnly: number, neither: number}} LabelAgreement
 * @typedef {{tier: 'tier1' | 'tier2' | 'advisory' | null, reason: string}} TierProposal
 * @typedef {{id: string, title: string, family: string, tier: string, layers: string[],
 *   authoritative: 'runtime' | 'static', positives: Count & {rate: number | null}, synthetic: Count,
 *   controls: Count & {rate: number | null}, exemplars: Count, states: Record<'positives' | 'controls' | 'exemplars', StateLists>,
 *   staticLayer: {positives: Count, controls: Count}, unconfirmed: string[],
 *   errors: Array<{entry: string, error: string}>, labels: LabelAgreement | null, proposal: TierProposal,
 *   fingerprint: string}} RuleResult
 * @typedef {{offered: Set<string>, entries: Map<string, {verdict: string, tells: Record<string, number>}>}} Labels
 *
 * @typedef {{corpus: string, registry: string, base: string, out: string | null, sets: CorpusSet[],
 *   entries: string[] | null, viewports: Viewport[], layers: {static: boolean, runtime: boolean}, network: boolean,
 *   har: string | null, labels: string | null, tier1Share: number, minPositives: number, minControls: number,
 *   readyTimeoutMs: number, detectorTimeoutMs: number, waybackDelayMs: number, json: boolean}} CalibrateOptions
 */

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
/** The skill folder: relative paths in the corpus resolve against it unless --base says otherwise. */
export const SKILL_ROOT = path.resolve(SCRIPTS_DIR, '..');
const DEFAULT_CORPUS = path.join(SKILL_ROOT, 'calibration', 'corpus.json');
const DEFAULT_REGISTRY = path.join(SCRIPTS_DIR, 'rules', 'registry.json');
const DEFAULT_RESULTS = path.join(SKILL_ROOT, 'calibration', 'results');
const DEFAULT_LABELS = path.join(SKILL_ROOT, 'calibration', 'labels.json');

export const SETS = Object.freeze(/** @type {const} */ (['positive', 'control', 'exemplar', 'synthetic']));
const DEFAULT_SETS = /** @type {CorpusSet[]} */ (['positive', 'control', 'synthetic']);
const STATUSES = Object.freeze(['ready', 'needs-build', 'unavailable']);
const RENDER_TYPES = Object.freeze(['url', 'serve', 'build', 'wayback']);
/** Statuses that mean a wall or an authentication step: stop that entry, never retry (FD19). */
const WALL_STATUSES = Object.freeze([401, 403, 407, 429]);
const MAX_EXAMPLES = 5;

/** @type {Readonly<Record<string, Viewport>>} */
export const VIEWPORTS = Object.freeze({
  desktop: { ...DEFAULT_VIEWPORTS[0] },
  mobile: { ...DEFAULT_VIEWPORTS[1] },
  reflow: { ...DEFAULT_VIEWPORTS[2] },
  projector: { name: 'projector', width: 1600, height: 900, dpr: 1, isMobile: false, hasTouch: false },
});

const HELP = `Usage: node calibrate.mjs [--corpus <file>] [--registry <file>] [--out <dir>] [--sets <list>]
         [--entries <ids>] [--viewports <list>] [--layers static,runtime] [--network] [--har <dir>]
         [--labels <file>] [--tier1-share <0..1>] [--min-positives <n>] [--min-controls <n>] [--timeout <s>]
         [--detector-timeout <s>] [--wayback-delay <s>] [--base <dir>] [--json]
       node calibrate.mjs --apply <proposal.json> [--registry <file>] [--json]

Measures every registry rule on the ready entries of the calibration corpus and proposes tiers. Writes
per-entry.json, per-rule.json, summary.md and proposal.json under calibration/results/<UTC>/ (or --out).
The registry is never written except by --apply.

Options:
  --corpus <file>          corpus manifest (default calibration/corpus.json)
  --registry <file>        rule registry; detectors are read from its folder (default scripts/rules/registry.json)
  --base <dir>             folder that relative corpus paths resolve against (default: the skill folder)
  --out <dir>              results folder (default calibration/results/<UTC>)
  --sets <list>            positive, control, synthetic, exemplar (default positive,control,synthetic; exemplars
                           feed category allowlists, never tiers)
  --entries <ids>          only these corpus entries
  --viewports <list>       desktop, mobile, reflow, projector (default desktop,mobile)
  --layers <list>          static, runtime (default both)
  --network                allow URL and Wayback entries and a served build's external requests
  --har <dir>              HAR folder outside any git work tree: <dir>/<entry>/<viewport>.har is replayed offline
                           when it exists and recorded otherwise (never for exemplars)
  --labels <file>          owner labels (default calibration/labels.json when it exists)
  --tier1-share <x>        tier 1 needs firing on at least this share of positives (default 0.3)
  --min-positives <n>      fewest measured positives for any proposal (default 1)
  --min-controls <n>       fewest measured controls for any proposal (default 1)
  --timeout <s>            page readiness timeout (default 20)
  --detector-timeout <s>   per detector and page (default 30)
  --wayback-delay <s>      pause between two Wayback entries (default 5)
  --apply <proposal.json>  write the proposal's tiers, counts and date into the registry
  --json                   print the summary (or the apply result) on stdout
  -h, --help               this text

Tiers proposed per rule (positives = positive and synthetic entries; a rule counts only where its authoritative
layer ran: runtime when the rule has a runtime detector, static otherwise):
  tier1     fires on at least --tier1-share of the positives and on no control (no detector error on a control)
  tier2     fires on at least one control, at a higher rate on positives than on controls
  advisory  otherwise
  none      fewer than --min-positives positives or --min-controls controls measured

Exit codes: 0 results written and every selected ready entry measured; 1 results written but an entry could not
be measured, a detector failed, or nothing was measured; 2 usage error (bad flag, corpus, registry or a stale
proposal); 3 environment error (no browser).`;

/**
 * Reads and validates the corpus manifest: version 1, unique entry ids usable as file names, known sets, statuses
 * and render types, routes starting with '/'. Every problem is listed in one UsageError.
 * @param {string} file
 * @returns {Corpus}
 */
export function loadCorpus(file) {
  const where = toPosix(path.resolve(file));
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readText(file));
  } catch (err) {
    if (err instanceof FrontendError) throw err;
    throw new UsageError(`corpus ${where} is not valid JSON (${err instanceof Error ? err.message : String(err)}); fix the file`, { cause: err });
  }
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.entries)) {
    throw new UsageError(`corpus ${where} must be {version: 1, entries: [...]} (calibration/corpus.json conventions)`);
  }
  /** @type {string[]} */
  const problems = [];
  const ids = new Set();
  raw.entries.forEach((e, i) => {
    const at = isObject(e) && typeof e.id === 'string' ? e.id : `entries[${i}]`;
    if (!isObject(e)) {
      problems.push(`${at} must be an object`);
      return;
    }
    if (typeof e.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(e.id)) problems.push(`${at}: id must be letters, digits, dots, hyphens`);
    else if (ids.has(e.id)) problems.push(`${at}: id used twice`);
    ids.add(e.id);
    if (!SETS.includes(/** @type {CorpusSet} */ (e.set))) problems.push(`${at}: set must be one of ${SETS.join('|')}`);
    if (!STATUSES.includes(/** @type {string} */ (e.status))) problems.push(`${at}: status must be one of ${STATUSES.join('|')}`);
    const render = e.render;
    if (!isObject(render) || !RENDER_TYPES.includes(/** @type {string} */ (render.type))) {
      problems.push(`${at}: render.type must be one of ${RENDER_TYPES.join('|')}`);
      return;
    }
    if (!Array.isArray(render.routes) || render.routes.length === 0) {
      problems.push(`${at}: render.routes must be a non-empty array of {path, name}`);
      return;
    }
    render.routes.forEach((r, j) => {
      if (!isObject(r) || typeof r.path !== 'string' || !r.path.startsWith('/') || typeof r.name !== 'string') {
        problems.push(`${at}: render.routes[${j}] must be {path: "/...", name}`);
      }
    });
    if (e.source_paths !== undefined && !(Array.isArray(e.source_paths) && e.source_paths.every((p) => typeof p === 'string' && p !== ''))) {
      problems.push(`${at}: source_paths must be an array of relative paths`);
    }
  });
  if (problems.length > 0) throw new UsageError(`corpus ${where} has ${problems.length} problem(s): ${problems.join('; ')}; fix the manifest`);
  return { path: where, sha256: sha256File(file), entries: /** @type {CorpusEntry[]} */ (raw.entries) };
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isLoopback(url) {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/**
 * Splits a Wayback memento URL into the replay prefix (always with the `if_` modifier, which serves the page
 * without the toolbar frame) and the original URL.
 * @param {string} url
 * @returns {{prefix: string, original: string, replay: string} | null}
 */
export function parseWayback(url) {
  const m = /^(https?:\/\/[^/]+\/web\/)(\d{1,14})(?:[a-z]{2}_)?\/(.+)$/.exec(url);
  if (!m) return null;
  let original = m[3];
  if (/^https?:\/[^/]/.test(original)) original = original.replace(/^(https?:)\//, '$1//');
  try {
    original = new URL(original).href;
  } catch {
    return null;
  }
  const prefix = `${m[1]}${m[2]}if_/`;
  return { prefix, original, replay: `${prefix}${original}` };
}

/**
 * The URL of a corpus route on a target: absolute path on the served folder or the site, or the same snapshot of
 * another path of the original site for a Wayback entry.
 * @param {Target} target
 * @param {string} serverUrl the local server's URL for 'serve' targets
 * @param {CorpusRoute} route
 * @returns {string}
 */
export function routeTargetUrl(target, serverUrl, route) {
  if (target.kind === 'serve') return new URL(route.path, `${serverUrl}/`).href;
  if (target.kind === 'url') return new URL(route.path, target.base).href;
  const original = new URL(target.original);
  const wanted = new URL(route.path, original);
  const same = (/** @type {URL} */ u) => `${u.pathname.replace(/\/+$/, '') || '/'}${u.search}`;
  return same(wanted) === same(original) ? target.replay : `${target.prefix}${wanted.href}`;
}

/**
 * Decides, without touching the network or the browser, what can be measured for one entry and why not.
 * @param {CorpusEntry} entry
 * @param {CalibrateOptions} opts
 * @returns {EntryPlan}
 */
export function planEntry(entry, opts) {
  /** @type {EntryPlan} */
  const plan = { entry, skip: null, target: null, targetSkip: null, targetSkipIsData: false, staticSource: null, staticSkip: null, staticSkipIsData: false };
  /** @param {string} reason */
  const dataProblem = (reason) => {
    plan.targetSkip = reason;
    plan.targetSkipIsData = true;
  };
  if (entry.status !== 'ready') {
    const held = entry.hold_until ? `, held until ${entry.hold_until}` : '';
    plan.skip = `status ${entry.status}${held}: ${firstSentence(entry.notes) || 'see the corpus notes'}`;
    return plan;
  }
  const r = entry.render;
  if (r.type === 'build') {
    dataProblem('build entries are never built here: build it, then set render.type to serve (with dir) or url');
  } else if (r.type === 'serve') {
    const dir = r.dir ? resolveCorpusPath(r.dir, opts.base) : null;
    if (!dir) dataProblem('render.dir is missing');
    else if (r.dir?.includes('<scratch>')) dataProblem(`render.dir still holds the <scratch> placeholder (${r.dir}); point it at the built folder`);
    else if (!isDirectory(dir)) dataProblem(`serve folder not found: ${toPosix(dir)}`);
    else plan.target = { kind: 'serve', dir };
  } else if (r.type === 'url') {
    try {
      const u = new URL(String(r.url ?? ''));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('not http');
      plan.target = { kind: 'url', base: u.href };
    } catch {
      dataProblem(`render.url ${JSON.stringify(r.url)} is not an http(s) URL`);
    }
  } else {
    const parsed = parseWayback(String(r.replay_url ?? r.url ?? ''));
    if (!r.replay_url && !r.url) dataProblem('no Wayback snapshot recorded (replay_url and url are null)');
    else if (!parsed) dataProblem(`replay URL ${JSON.stringify(r.replay_url ?? r.url)} is not a Wayback memento URL`);
    else plan.target = { kind: 'wayback', ...parsed };
  }
  if (plan.target && plan.target.kind !== 'serve') {
    const remote = !isLoopback(plan.target.kind === 'url' ? plan.target.base : plan.target.replay);
    const replayable = opts.har !== null && opts.viewports.every((v) => existsSync(harFile(opts.har ?? '', entry.id, v.name)));
    if (remote && !opts.network && !replayable) {
      plan.targetSkip = `${r.type} entry needs the network: pass --network (or --har with a HAR recorded earlier)`;
      plan.target = null;
    } else if (remote && entry.set === 'exemplar' && !replayable && !robotsAllow(entry)) {
      plan.targetSkip = 'exemplar without a recorded robots.txt verdict allowing frontend-capture (FD19): not rendered';
      plan.target = null;
    }
  }
  const src = entry.source_root;
  if (!src) plan.staticSkip = 'no source_root';
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(src)) plan.staticSkip = `source_root is remote (${src}): fetch its UI paths at the pinned commit into a local folder first`;
  else {
    const root = resolveCorpusPath(src, opts.base);
    if (!existsSync(root)) {
      plan.staticSkip = `source_root not found: ${toPosix(root)}`;
      plan.staticSkipIsData = true;
    } else if (!isDirectory(root)) {
      plan.staticSkip = `source_root is a file (${path.basename(root)}): extract it into a folder first`;
    } else {
      plan.staticSource = { root, paths: entry.source_paths ?? null };
    }
  }
  return plan;
}

/**
 * @param {CorpusEntry} entry
 * @returns {boolean}
 */
function robotsAllow(entry) {
  const tokens = isObject(entry.check) && isObject(entry.check.skill_tokens) ? entry.check.skill_tokens : null;
  const verdict = tokens && isObject(tokens['frontend-capture']) ? tokens['frontend-capture'] : null;
  return verdict !== null && verdict.allowed === true;
}

/**
 * @param {string | undefined} text
 * @returns {string}
 */
function firstSentence(text) {
  if (!text) return '';
  const m = /^(.*?[.!?])(\s|$)/.exec(text.trim());
  return (m ? m[1] : text.trim()).slice(0, 200);
}

/**
 * @param {string} p
 * @param {string} base
 * @returns {string}
 */
function resolveCorpusPath(p, base) {
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(base, p);
}

/**
 * @param {string} dir
 * @param {string} entryId
 * @param {string} viewport
 * @returns {string}
 */
function harFile(dir, entryId, viewport) {
  return path.join(dir, entryId, `${viewport}.har`);
}

/**
 * The git work tree containing `dir` (a `.git` folder holding HEAD, or a `.git` file naming a git dir), or null.
 * @param {string} dir
 * @returns {string | null}
 */
export function gitWorkTree(dir) {
  let at = path.resolve(dir);
  for (;;) {
    const dotGit = path.join(at, '.git');
    if (existsSync(dotGit)) {
      const st = statSync(dotGit);
      if (st.isDirectory() && existsSync(path.join(dotGit, 'HEAD'))) return toPosix(at);
      if (st.isFile() && /^gitdir:/m.test(readFileSync(dotGit, 'utf8'))) return toPosix(at);
    }
    const parent = path.dirname(at);
    if (parent === at) return null;
    at = parent;
  }
}

/**
 * Removes what the Wayback Machine adds to a replayed page: the toolbar and its print banner, anything between the
 * toolbar-insert comments, and the playback stylesheets and scripts from the archive's static host. Runs inside the
 * page; returns how many nodes it removed.
 * @returns {number}
 */
export const stripWaybackChrome = function stripWaybackChrome() {
  let removed = 0;
  /** @param {Node | null} node */
  const drop = (node) => {
    if (node && node.parentNode) {
      node.parentNode.removeChild(node);
      removed += 1;
    }
  };
  /** @type {Comment[]} */
  const comments = [];
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
  while (walker.nextNode()) comments.push(/** @type {Comment} */ (walker.currentNode));
  const begin = comments.find((c) => /BEGIN WAYBACK TOOLBAR INSERT/i.test(c.nodeValue ?? ''));
  const end = comments.find((c) => /END WAYBACK TOOLBAR INSERT/i.test(c.nodeValue ?? ''));
  if (begin && end && begin.parentNode === end.parentNode) {
    for (let n = begin.nextSibling; n && n !== end; ) {
      const next = n.nextSibling;
      drop(n);
      n = next;
    }
  }
  const selectors = [
    '[id^="wm-ipp"]', '#donato', '[id^="wm-capinfo"]', 'wb-autocomplete-runner',
    'link[href*="web-static.archive.org"]', 'link[href*="archive.org/_static/"]',
    'script[src*="web-static.archive.org"]', 'script[src*="archive.org/_static/"]',
  ];
  for (const el of Array.from(document.querySelectorAll(selectors.join(',')))) drop(el);
  return removed;
};

/**
 * Whether a request may go out under a network policy: loopback only, the replay host plus archive.org hosts, or
 * anything. Non-HTTP schemes (data:, blob:) are never routed out.
 * @param {string} url
 * @param {NetPolicy} policy
 * @param {string | null} replayHost host:port of the Wayback replay
 * @returns {boolean}
 */
export function requestAllowed(url, policy, replayHost) {
  if (policy === 'open') return true;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'ws:' && u.protocol !== 'wss:') return true;
  if (policy === 'loopback') return isLoopback(url);
  return u.host === replayHost || u.hostname === 'archive.org' || u.hostname.endsWith('.archive.org');
}

/**
 * The request policy of a page load, or null when a HAR replay is the whole network (it serves only what was
 * recorded, under the policy of the recording run, and aborts everything else). A Wayback replay only reaches the
 * archive; anything else is open with --network and loopback-only without it.
 * @param {Target['kind']} kind
 * @param {boolean} network
 * @param {HarPlan['mode']} harMode
 * @returns {NetPolicy | null}
 */
export function policyFor(kind, network, harMode) {
  if (harMode === 'replay') return null;
  if (kind === 'wayback') return 'archive';
  return network ? 'open' : 'loopback';
}

/**
 * A browser context for one viewport with the entry's network rules: a HAR replayed offline (unmatched requests
 * aborted), or the request policy, plus HAR recording when asked.
 * @param {Browser} browser
 * @param {Viewport} viewport
 * @param {{policy: NetPolicy | null, replayHost: string | null, har: HarPlan}} net
 * @returns {Promise<BrowserContext>}
 */
async function openContext(browser, viewport, net) {
  const context = await newContext(browser, viewport, { network: net.policy === 'open' || net.policy === 'archive' });
  try {
    if (net.har.mode === 'replay') {
      await context.routeFromHAR(net.har.file, { notFound: 'abort' });
      return context;
    }
    const policy = net.policy;
    if (policy !== null && policy !== 'open') {
      await context.route('**/*', (route) => (requestAllowed(route.request().url(), policy, net.replayHost) ? route.continue() : route.abort('blockedbyclient')));
    }
    if (net.har.mode === 'record') {
      mkdirSync(path.dirname(net.har.file), { recursive: true });
      await context.routeFromHAR(net.har.file, { update: true, updateContent: 'embed', updateMode: 'full' });
    }
    return context;
  } catch (err) {
    await context.close().catch(() => {});
    throw err;
  }
}

/**
 * Drops the entries of a just-recorded HAR whose request never got a response (blocked, refused, aborted): Playwright
 * replays such an entry as a request that never completes, which would hold the page's load event forever. Without
 * the entry, replay aborts the request, as it was aborted when recorded.
 * @param {string} file
 * @returns {number} entries removed
 */
export function dropFailedHarEntries(file) {
  if (!existsSync(file)) return 0;
  const har = JSON.parse(readFileSync(file, 'utf8'));
  const entries = isObject(har) && isObject(har.log) && Array.isArray(har.log.entries) ? har.log.entries : null;
  if (!entries) return 0;
  const kept = entries.filter((e) => isObject(e) && isObject(e.response) && typeof e.response.status === 'number' && e.response.status > 0);
  if (kept.length === entries.length) return 0;
  har.log.entries = kept;
  writeFileSync(file, JSON.stringify(har));
  return entries.length - kept.length;
}

/**
 * @param {Page} page
 * @returns {Promise<void>}
 */
async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))));
}

/**
 * @typedef {{browser: Browser | null, registry: Registry, profile: Profile, allowlist: Allowlist, opts: CalibrateOptions,
 *   log: (message: string) => void}} MeasureEnv
 */

/**
 * Measures one planned entry: the static layer on its local source, then the runtime layer on every route at every
 * viewport. Never throws for a page or a detector: failures are recorded on the entry.
 * @param {EntryPlan} plan
 * @param {MeasureEnv} env
 * @returns {Promise<EntryResult>}
 */
export async function measureEntry(plan, env) {
  const { entry } = plan;
  /** @type {EntryResult} */
  const result = {
    id: entry.id,
    set: entry.set,
    name: entry.name ?? entry.id,
    made_by: entry.made_by ?? null,
    category: entry.category ?? null,
    status: 'skipped',
    reason: plan.skip,
    target: { type: entry.render.type, location: targetLocation(plan) },
    static: { ran: false, reason: null, root: null, files: 0, findings: 0 },
    runtime: { ran: false, reason: null, pages: [] },
    rules: {},
  };
  if (plan.skip) return result;
  /** @type {Finding[]} */
  let staticFindings = [];
  /** @type {string | null} */
  let staticFailure = null;
  if (!env.opts.layers.static) result.static.reason = 'static layer not selected (--layers)';
  else if (!plan.staticSource) result.static.reason = plan.staticSkip;
  else {
    try {
      const measured = await measureStatic(plan.staticSource, env);
      staticFindings = measured.findings;
      result.static = { ran: true, reason: measured.note, root: toPosix(plan.staticSource.root), files: measured.files, findings: measured.findings.filter((f) => !('error' in f)).length };
    } catch (err) {
      staticFailure = `static layer failed: ${describe(err)}`;
      result.static = { ran: false, reason: staticFailure, root: toPosix(plan.staticSource.root), files: 0, findings: 0 };
      env.log(`calibrate:   ${staticFailure}`);
    }
  }
  /** @type {Array<{page: PageRecord, findings: Finding[]}>} */
  let pages = [];
  if (!env.opts.layers.runtime) result.runtime.reason = 'runtime layer not selected (--layers)';
  else if (!plan.target) result.runtime.reason = plan.targetSkip;
  else if (!env.browser) result.runtime.reason = 'no browser';
  else {
    pages = await measureRuntime(plan, /** @type {Target} */ (plan.target), env);
    result.runtime = { ran: pages.some((p) => p.page.ok), reason: pages.length === 0 ? 'no page measured' : null, pages: pages.map((p) => p.page) };
  }
  for (const rule of env.registry.rules) result.rules[rule.id] = entryRule(rule, result.static.ran, staticFindings, pages);
  const failedPages = pages.filter((p) => !p.page.ok);
  const dataProblems = [
    env.opts.layers.runtime && plan.targetSkipIsData ? plan.targetSkip : null,
    env.opts.layers.static && plan.staticSkipIsData ? plan.staticSkip : null,
    staticFailure,
  ].filter((x) => x !== null);
  const anything = result.static.ran || pages.some((p) => p.page.ok);
  const reasons = [
    ...dataProblems,
    ...(failedPages.length ? [`${failedPages.length} of ${pages.length} page(s) failed`] : []),
  ];
  if (!anything) {
    result.status = reasons.length > 0 ? 'failed' : 'skipped';
    result.reason = [...new Set([...reasons, result.runtime.reason, result.static.reason].filter(Boolean))].join('; ') || 'nothing to measure';
  } else if (reasons.length > 0) {
    result.status = 'partial';
    result.reason = reasons.join('; ');
  } else {
    result.status = 'measured';
    const notRun = [!plan.target && env.opts.layers.runtime ? `runtime layer not run: ${plan.targetSkip}` : null, !result.static.ran && env.opts.layers.static ? `static layer not run: ${plan.staticSkip}` : null].filter(Boolean);
    result.reason = notRun.length ? notRun.join('; ') : null;
  }
  return result;
}

/**
 * @param {EntryPlan} plan
 * @returns {string | null}
 */
function targetLocation(plan) {
  const t = plan.target;
  if (!t) return plan.entry.render.url ?? plan.entry.render.dir ?? null;
  if (t.kind === 'serve') return toPosix(t.dir);
  if (t.kind === 'url') return t.base;
  return t.replay;
}

/**
 * Runs the static detectors on an entry's local source, limited to its source_paths (plus the package.json files
 * on the way down to them) when the corpus names them.
 * @param {StaticSource} source
 * @param {MeasureEnv} env
 * @returns {Promise<{findings: Finding[], files: number, note: string | null}>}
 */
async function measureStatic(source, env) {
  const ctx = staticContext(source.root, env.profile, env.allowlist);
  let note = null;
  if (source.paths) {
    const wanted = source.paths.map((p) => toPosix(p).replace(/^\.\//, '').replace(/\/+$/, ''));
    const missing = wanted.filter((p) => !existsSync(path.join(source.root, p)));
    const manifests = new Set();
    for (const p of wanted) {
      const parts = p.split('/');
      for (let i = 0; i < parts.length; i += 1) manifests.add([...parts.slice(0, i), 'package.json'].join('/'));
    }
    ctx.files = ctx.files.filter((f) => manifests.has(f.path) || wanted.some((p) => f.path === p || f.path.startsWith(`${p}/`)));
    if (missing.length > 0) note = `source_paths not found: ${missing.join(', ')}`;
  }
  env.log(`calibrate:   static layer on ${ctx.files.length} files under ${toPosix(source.root)}`);
  const findings = await runStatic(env.registry, ctx, { dir: env.registry.dir });
  return { findings, files: ctx.files.length, note };
}

/**
 * Loads every route at every viewport and runs the runtime detectors. One browser context per viewport (so a HAR
 * recording covers the entry's routes), one page per route; fresh pages a detector opens get the same network rules
 * and, for Wayback, the same toolbar removal. A wall status (401, 403, 407, 429) stops the entry.
 * @param {EntryPlan} plan
 * @param {Target} target
 * @param {MeasureEnv} env
 * @returns {Promise<Array<{page: PageRecord, findings: Finding[]}>>}
 */
async function measureRuntime(plan, target, env) {
  const { entry } = plan;
  const browser = /** @type {Browser} */ (env.browser);
  const opts = env.opts;
  /** @type {Array<{page: PageRecord, findings: Finding[]}>} */
  const out = [];
  /** @type {{url: string, close: () => Promise<void>} | null} */
  let server = null;
  try {
    if (target.kind === 'serve') server = await serveStatic(target.dir);
    const serverUrl = server?.url ?? '';
    const location = target.kind === 'url' ? target.base : target.kind === 'wayback' ? target.replay : serverUrl;
    const remote = !isLoopback(location);
    const replayHost = target.kind === 'wayback' ? new URL(target.replay).host : null;
    let walled = '';
    for (const viewport of opts.viewports) {
      const har = harPlan(entry, viewport, opts, remote);
      if (har === null) {
        for (const route of entry.render.routes) {
          out.push({ page: pageRecord(route.path, viewport.name, routeTargetUrl(target, serverUrl, route), 'live', null, 'no HAR for this viewport and no --network'), findings: [] });
        }
        continue;
      }
      if (har.mode === 'replay') dropFailedHarEntries(har.file);
      const policy = policyFor(target.kind, opts.network, har.mode);
      /** @type {BrowserContext | null} */
      let context = null;
      try {
        context = await openContext(browser, viewport, { policy, replayHost, har });
        for (const route of entry.render.routes) {
          const url = routeTargetUrl(target, serverUrl, route);
          if (walled) {
            out.push({ page: pageRecord(route.path, viewport.name, url, har.mode, null, `not loaded: ${walled}`), findings: [] });
            continue;
          }
          const measured = await measurePage(context, url, route, viewport, { policy, replayHost, har, wayback: target.kind === 'wayback' }, env);
          out.push(measured);
          const status = measured.page.status;
          if (remote && status !== null && WALL_STATUSES.includes(status)) walled = `HTTP ${status} on ${route.path}: a wall or a login, stopped without retry (FD19)`;
        }
      } catch (err) {
        out.push({ page: pageRecord('*', viewport.name, location, har.mode, null, `context failed: ${describe(err)}`), findings: [] });
      } finally {
        if (context) await context.close().catch((err) => env.log(`calibrate:   closing the ${viewport.name} context failed: ${describe(err)}`));
        if (context && har.mode === 'record') {
          try {
            const dropped = dropFailedHarEntries(har.file);
            if (dropped > 0) env.log(`calibrate:   ${toPosix(har.file)}: ${dropped} failed request(s) left out of the HAR`);
          } catch (err) {
            env.log(`calibrate:   could not clean ${toPosix(har.file)}: ${describe(err)}`);
          }
        }
      }
    }
  } catch (err) {
    out.push({ page: pageRecord('*', '*', targetLocation(plan) ?? '', 'live', null, `target failed: ${describe(err)}`), findings: [] });
  } finally {
    if (server) await server.close().catch(() => {});
  }
  return out;
}

/**
 * How one viewport of an entry is loaded: replayed from its HAR when the file exists, recorded into it when --har
 * is given (never for exemplars, whose captures are not stored), live otherwise; null when the page needs the
 * network and neither --network nor a HAR allows it.
 * @param {CorpusEntry} entry
 * @param {Viewport} viewport
 * @param {CalibrateOptions} opts
 * @param {boolean} remote
 * @returns {HarPlan | null}
 */
function harPlan(entry, viewport, opts, remote) {
  if (opts.har) {
    const file = harFile(opts.har, entry.id, viewport.name);
    if (existsSync(file)) return { mode: 'replay', file };
    if (remote && !opts.network) return null;
    if (entry.set !== 'exemplar') return { mode: 'record', file };
  }
  if (remote && !opts.network) return null;
  return { mode: 'live' };
}

/**
 * @param {string} route
 * @param {string} viewport
 * @param {string} url
 * @param {PageRecord['mode']} mode
 * @param {number | null} status
 * @param {string | null} error
 * @param {number} [ms]
 * @returns {PageRecord}
 */
function pageRecord(route, viewport, url, mode, status, error, ms = 0) {
  return { route, viewport, url, mode, status, ok: error === null, error, ms };
}

/**
 * Loads one route in the viewport's context, waits for readiness, strips Wayback chrome, and runs the runtime
 * detectors with fresh pages that follow the same network rules.
 * @param {BrowserContext} context
 * @param {string} url
 * @param {CorpusRoute} corpusRoute
 * @param {Viewport} viewport
 * @param {{policy: NetPolicy | null, replayHost: string | null, har: HarPlan, wayback: boolean}} net
 * @param {MeasureEnv} env
 * @returns {Promise<{page: PageRecord, findings: Finding[]}>}
 */
async function measurePage(context, url, corpusRoute, viewport, net, env) {
  const started = Date.now();
  const { browser, opts } = env;
  const page = await context.newPage();
  /** @type {BrowserContext[]} */
  const fresh = [];
  try {
    const response = await goto(page, url, 45000);
    const status = response ? response.status() : null;
    if (status !== null && status >= 400) {
      return { page: pageRecord(corpusRoute.path, viewport.name, url, net.har.mode, status, `HTTP ${status}`, Date.now() - started), findings: [] };
    }
    await waitReady(page, { timeoutMs: opts.readyTimeoutMs });
    if (net.wayback) {
      await page.evaluate(stripWaybackChrome);
      await settle(page);
    }
    /** @type {Route} */
    const route = { path: corpusRoute.path, name: corpusRoute.name, first: corpusRoute.first === true, features: [], states: [] };
    const rctx = await runtimeContext(/** @type {Browser} */ (browser), page, route, viewport, env.profile, env.allowlist);
    const freshNet = { ...net, har: net.har.mode === 'replay' ? net.har : /** @type {HarPlan} */ ({ mode: 'live' }) };
    rctx.freshPage = async () => {
      const c = await openContext(/** @type {Browser} */ (browser), viewport, freshNet);
      fresh.push(c);
      const p = await c.newPage();
      await goto(p, page.url(), 45000);
      await waitReady(p, { timeoutMs: opts.readyTimeoutMs });
      if (net.wayback) {
        await p.evaluate(stripWaybackChrome);
        await settle(p);
      }
      return p;
    };
    rctx.closeFresh = async () => {
      await Promise.allSettled(fresh.splice(0).map((c) => c.close()));
    };
    const findings = await runRuntime(env.registry, rctx, { dir: env.registry.dir, timeoutMs: opts.detectorTimeoutMs });
    const fired = new Set(findings.filter((f) => !('error' in f)).map((f) => f.rule)).size;
    env.log(`calibrate:   ${viewport.name} ${corpusRoute.path}: ${fired} rule(s) fired (${net.har.mode})`);
    return { page: pageRecord(corpusRoute.path, viewport.name, url, net.har.mode, status, null, Date.now() - started), findings };
  } catch (err) {
    env.log(`calibrate:   ${viewport.name} ${corpusRoute.path}: ${describe(err)}`);
    return { page: pageRecord(corpusRoute.path, viewport.name, url, net.har.mode, null, describe(err), Date.now() - started), findings: [] };
  } finally {
    await Promise.allSettled(fresh.splice(0).map((c) => c.close()));
    await page.close().catch(() => {});
  }
}

/**
 * One rule's outcome on one entry. The runtime layer decides for rules that have a runtime detector (a static hit it
 * does not confirm stays unconfirmed); the static layer decides for static-only rules.
 * @param {Rule} rule
 * @param {boolean} staticRan
 * @param {Finding[]} staticFindings
 * @param {Array<{page: PageRecord, findings: Finding[]}>} pages
 * @returns {EntryRule}
 */
export function entryRule(rule, staticRan, staticFindings, pages) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Example[]} */
  const examples = [];
  /** @type {RuleState | null} */
  let staticState = null;
  let staticCount = 0;
  if (rule.static) {
    const mine = staticFindings.filter((f) => f.rule === rule.id);
    const hits = mine.filter((f) => !('error' in f));
    const errs = mine.filter((f) => 'error' in f);
    staticCount = hits.length;
    for (const e of errs) errors.push(`static: ${'error' in e ? e.error : ''}`);
    staticState = !staticRan ? 'not-run' : hits.length > 0 ? 'fired' : errs.length > 0 ? 'error' : 'silent';
    for (const f of hits.slice(0, MAX_EXAMPLES)) {
      const s = /** @type {import('./rules/load.mjs').StaticFinding} */ (f);
      examples.push({ file: s.file, line: s.line, value: clip(scalar(s.value), 80), detail: clip(s.detail, 160) });
    }
  }
  /** @type {RuleState | null} */
  let runtimeState = null;
  let runtimeCount = 0;
  if (rule.runtime) {
    const measured = pages.filter((p) => p.page.ok);
    let anyError = false;
    for (const p of measured) {
      const mine = p.findings.filter((f) => f.rule === rule.id);
      const hits = mine.filter((f) => !('error' in f));
      runtimeCount += hits.length;
      for (const e of mine.filter((f) => 'error' in f)) {
        anyError = true;
        errors.push(`runtime ${p.page.viewport} ${p.page.route}: ${'error' in e ? e.error : ''}`);
      }
      for (const f of hits.slice(0, Math.max(0, MAX_EXAMPLES - examples.length))) {
        const r = /** @type {import('./rules/load.mjs').RuntimeFinding} */ (f);
        examples.push({ route: r.route, viewport: r.viewport, selector: clip(r.selector, 120), value: clip(scalar(r.value), 80), detail: clip(r.detail, 160) });
      }
    }
    runtimeState = measured.length === 0 ? 'not-run' : runtimeCount > 0 ? 'fired' : anyError ? 'error' : 'silent';
  }
  const state = /** @type {RuleState} */ (rule.runtime ? runtimeState : staticState);
  return { state, static: staticState, runtime: runtimeState, findings: { static: staticCount, runtime: runtimeCount }, examples, errors: errors.slice(0, 20) };
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function scalar(v) {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : JSON.stringify(v) ?? String(v);
}

/**
 * @param {string} s
 * @param {number} n
 * @returns {string}
 */
function clip(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * The tier a rule's counts support (CONTRACTS section 5, ARCHITECTURE 5.1 and 5.2). Positives are positive and
 * synthetic entries. "More positives than controls" compares firing rates, since the sets differ in size.
 * @param {{positives: Count, controls: Count, controlErrors: number}} counts
 * @param {{tier1Share: number, minPositives: number, minControls: number}} opts
 * @returns {TierProposal}
 */
export function proposeTier({ positives, controls, controlErrors }, { tier1Share, minPositives, minControls }) {
  if (positives.total < Math.max(1, minPositives)) {
    return { tier: null, reason: `measured on ${positives.total} positive(s), fewer than ${Math.max(1, minPositives)}` };
  }
  if (controls.total < Math.max(1, minControls)) {
    return { tier: null, reason: `measured on ${controls.total} control(s), fewer than ${Math.max(1, minControls)}` };
  }
  const pr = positives.fired / positives.total;
  const cr = controls.fired / controls.total;
  const pos = `${positives.fired}/${positives.total} positives (${pct(pr)})`;
  const ctl = `${controls.fired}/${controls.total} controls (${pct(cr)})`;
  if (controls.fired === 0 && pr >= tier1Share) {
    if (controlErrors > 0) {
      return { tier: null, reason: `fires on ${pos} and on no measured control, but its detector failed on ${controlErrors} control(s): fix it and re-run before tiering` };
    }
    return { tier: 'tier1', reason: `fires on ${pos}, at least ${pct(tier1Share)}, and on no control (${ctl})` };
  }
  if (controls.fired >= 1 && pr > cr) return { tier: 'tier2', reason: `fires on ${pos}, more often than on ${ctl}` };
  if (controls.fired === 0) return { tier: 'advisory', reason: `fires on ${pos}, below the ${pct(tier1Share)} tier-1 share, and on no control` };
  return { tier: 'advisory', reason: `fires on ${ctl}, as often as or more often than on ${pos}` };
}

/**
 * @param {number} x
 * @returns {string}
 */
function pct(x) {
  return `${Math.round(x * 100)}%`;
}

/**
 * A rule's fingerprint: its registry entry without tier and calibration, plus the bytes of its detector files.
 * A proposal is applied only to rules whose fingerprint is unchanged.
 * @param {Rule} rule
 * @param {string} rulesDir
 * @returns {string}
 */
export function ruleFingerprint(rule, rulesDir) {
  const hash = createHash('sha256');
  const { tier: _tier, calibration: _calibration, ...entry } = rule;
  hash.update(stableJson(entry));
  for (const layer of /** @type {const} */ (['static', 'runtime'])) {
    const file = path.join(rulesDir, layer, `${rule.id}.mjs`);
    hash.update(`\n${layer}:`);
    hash.update(rule[layer] && existsSync(file) ? readFileSync(file) : Buffer.from('none'));
  }
  return hash.digest('hex');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/**
 * Per-rule totals over the measured entries, owner-label agreement when labels exist, and the tier proposal.
 * @param {Registry} registry
 * @param {EntryResult[]} entries
 * @param {Labels | null} labels
 * @param {CalibrateOptions} opts
 * @returns {RuleResult[]}
 */
export function summariseRules(registry, entries, labels, opts) {
  return registry.rules.map((rule) => {
    /** @type {Record<'positives' | 'controls' | 'exemplars', StateLists>} */
    const states = { positives: emptyLists(), controls: emptyLists(), exemplars: emptyLists() };
    const synthetic = { fired: 0, total: 0 };
    const staticLayer = { positives: { fired: 0, total: 0 }, controls: { fired: 0, total: 0 } };
    /** @type {string[]} */
    const unconfirmed = [];
    /** @type {Array<{entry: string, error: string}>} */
    const errors = [];
    for (const e of entries) {
      const r = e.rules[rule.id];
      if (!r || e.status === 'skipped') continue;
      const bucket = e.set === 'control' ? 'controls' : e.set === 'exemplar' ? 'exemplars' : 'positives';
      const list = r.state === 'not-run' ? 'notRun' : r.state;
      states[bucket][list].push(e.id);
      if (e.set === 'synthetic' && (r.state === 'fired' || r.state === 'silent')) {
        synthetic.total += 1;
        if (r.state === 'fired') synthetic.fired += 1;
      }
      if (bucket !== 'exemplars' && (r.static === 'fired' || r.static === 'silent')) {
        staticLayer[bucket].total += 1;
        if (r.static === 'fired') staticLayer[bucket].fired += 1;
      }
      if (rule.runtime && r.static === 'fired' && r.runtime === 'silent') unconfirmed.push(e.id);
      for (const err of r.errors) if (errors.length < 30) errors.push({ entry: e.id, error: err });
    }
    const count = (/** @type {StateLists} */ s) => ({ fired: s.fired.length, total: s.fired.length + s.silent.length });
    const positives = count(states.positives);
    const controls = count(states.controls);
    const proposal = proposeTier({ positives, controls, controlErrors: states.controls.error.length }, opts);
    return {
      id: rule.id,
      title: rule.title,
      family: rule.family,
      tier: rule.tier,
      layers: [rule.static ? 'static' : '', rule.runtime ? 'runtime' : ''].filter(Boolean),
      authoritative: rule.runtime ? 'runtime' : 'static',
      positives: { ...positives, rate: positives.total ? round(positives.fired / positives.total) : null },
      synthetic,
      controls: { ...controls, rate: controls.total ? round(controls.fired / controls.total) : null },
      exemplars: count(states.exemplars),
      states,
      staticLayer,
      unconfirmed,
      errors,
      labels: labels ? labelAgreement(rule.id, entries, labels) : null,
      proposal,
      fingerprint: ruleFingerprint(rule, registry.dir),
    };
  });
}

/**
 * @returns {StateLists}
 */
function emptyLists() {
  return { fired: [], silent: [], error: [], notRun: [] };
}

/**
 * @param {number} x
 * @returns {number}
 */
function round(x) {
  return Math.round(x * 1000) / 1000;
}

/**
 * Entry-level agreement between the owner's labels (a tell marked on any screen of the entry) and the detector
 * (the rule fired on the entry), over measured entries that have labels and only for rules the session offered.
 * @param {string} ruleId
 * @param {EntryResult[]} entries
 * @param {Labels} labels
 * @returns {LabelAgreement | null}
 */
function labelAgreement(ruleId, entries, labels) {
  if (!labels.offered.has(ruleId)) return null;
  const a = { entries: 0, both: 0, ownerOnly: 0, detectorOnly: 0, neither: 0 };
  for (const e of entries) {
    const label = labels.entries.get(e.id);
    const r = e.rules[ruleId];
    if (!label || !r || (r.state !== 'fired' && r.state !== 'silent')) continue;
    const owner = (label.tells[ruleId] ?? 0) > 0;
    const detector = r.state === 'fired';
    a.entries += 1;
    if (owner && detector) a.both += 1;
    else if (owner) a.ownerOnly += 1;
    else if (detector) a.detectorOnly += 1;
    else a.neither += 1;
  }
  return a;
}

/**
 * Reads calibration/labels.json (labelling-plan.md section 6): the rules each session offered and the derived
 * per-entry verdicts and tell counts. Returns null when the file does not exist.
 * @param {string | null} file
 * @returns {Labels | null}
 */
export function loadLabels(file) {
  if (!file || !existsSync(file)) return null;
  const where = toPosix(path.resolve(file));
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readText(file));
  } catch (err) {
    throw new UsageError(`labels ${where} is not valid JSON (${err instanceof Error ? err.message : String(err)}); fix it or pass --labels`, { cause: err });
  }
  const derived = isObject(raw) && isObject(raw.derived) && Array.isArray(raw.derived.entries) ? raw.derived.entries : null;
  const sessions = isObject(raw) && Array.isArray(raw.sessions) ? raw.sessions : null;
  if (!isObject(raw) || raw.version !== 1 || !derived || !sessions) {
    throw new UsageError(`labels ${where} must be {version: 1, sessions: [...], derived: {entries: [...]}} (labelling-plan.md section 6)`);
  }
  /** @type {Set<string>} */
  const offered = new Set();
  for (const s of sessions) {
    const t = isObject(s) && isObject(s.tells_offered) ? s.tells_offered : {};
    for (const row of [t.row_a, t.row_b]) if (Array.isArray(row)) for (const id of row) if (typeof id === 'string') offered.add(id);
  }
  /** @type {Labels['entries']} */
  const entries = new Map();
  for (const d of derived) {
    if (!isObject(d) || typeof d.entry !== 'string') continue;
    /** @type {Record<string, number>} */
    const tells = {};
    if (isObject(d.tells)) for (const [k, v] of Object.entries(d.tells)) if (typeof v === 'number') tells[k] = v;
    entries.set(d.entry, { verdict: typeof d.verdict === 'string' ? d.verdict : 'unsure', tells });
  }
  return { offered, entries };
}

/**
 * Runs a calibration: plans every selected entry, measures them one at a time with one browser, and writes the
 * four result files.
 * @param {CalibrateOptions} opts
 * @param {{now?: Date, log?: (message: string) => void}} [deps]
 * @returns {Promise<{outDir: string, entries: EntryResult[], rules: RuleResult[], exitCode: number, files: string[]}>}
 */
export async function calibrate(opts, { now = new Date(), log = stderrLog } = {}) {
  const corpus = loadCorpus(opts.corpus);
  const registry = loadRegistry(opts.registry);
  const labels = loadLabels(opts.labels);
  if (opts.har) {
    const tree = gitWorkTree(opts.har);
    if (tree) throw new UsageError(`--har ${toPosix(path.resolve(opts.har))} is inside the git work tree ${tree}; HAR files hold captured pages, so keep them in a private folder outside any repository (labelling-plan.md section 3, FD19)`);
  }
  if (opts.entries) {
    const unknown = opts.entries.filter((id) => !corpus.entries.some((e) => e.id === id));
    if (unknown.length > 0) throw new UsageError(`--entries: ${unknown.join(', ')} not in ${corpus.path}`);
  }
  const selected = corpus.entries.filter((e) => opts.sets.includes(e.set) && (!opts.entries || opts.entries.includes(e.id)));
  if (selected.length === 0) throw new UsageError('no corpus entry selected; check --sets and --entries');
  const plans = selected.map((e) => planEntry(e, opts));
  const madeAt = utcSeconds(now);
  const outDir = opts.out ? path.resolve(opts.out) : uniqueDir(path.join(DEFAULT_RESULTS, utcStamp(now)));
  mkdirSync(outDir, { recursive: true });
  const profile = defaultProfile();
  const allowlist = loadAllowlists(outDir, profile);
  /** @type {Browser | null} */
  let browser = null;
  /** @type {EntryResult[]} */
  const results = [];
  try {
    if (opts.layers.runtime && plans.some((p) => p.target !== null && !p.skip)) browser = await launch();
    let lastWayback = 0;
    for (const plan of plans) {
      log(`calibrate: ${plan.entry.id} (${plan.entry.set})${plan.skip ? `: skipped, ${plan.skip}` : ''}`);
      if (plan.target?.kind === 'wayback' && !plan.skip && !isLoopback(plan.target.replay)) {
        const wait = lastWayback + opts.waybackDelayMs - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
      results.push(await measureEntry(plan, { browser, registry, profile, allowlist, opts, log }));
      if (plan.target?.kind === 'wayback') lastWayback = Date.now();
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  const rules = summariseRules(registry, results, labels, opts);
  const meta = {
    made_at: madeAt,
    corpus: { path: corpus.path, sha256: corpus.sha256 },
    registry: { path: registry.path, sha256: sha256File(registry.path), rules: registry.rules.length },
    labels: labels && opts.labels ? toPosix(path.resolve(opts.labels)) : null,
    options: {
      sets: opts.sets,
      entries: opts.entries,
      viewports: opts.viewports.map((v) => v.name),
      layers: Object.entries(opts.layers).filter(([, on]) => on).map(([k]) => k),
      network: opts.network,
      har: opts.har ? toPosix(path.resolve(opts.har)) : null,
      tier1_share: opts.tier1Share,
      min_positives: opts.minPositives,
      min_controls: opts.minControls,
    },
  };
  const files = [
    writeJson(path.join(outDir, 'per-entry.json'), { version: 1, tool: 'calibrate', ...meta, entries: results }),
    writeJson(path.join(outDir, 'per-rule.json'), { version: 1, tool: 'calibrate', ...meta, rules: rules.map(({ fingerprint: _f, ...r }) => r) }),
    writeJson(path.join(outDir, 'proposal.json'), proposalOf(meta, rules, outDir)),
    writeText(path.join(outDir, 'summary.md'), summaryMarkdown(meta, results, rules, outDir)),
  ];
  const measured = results.filter((r) => r.status === 'measured' || r.status === 'partial').length;
  const incomplete = results.some((r) => r.status === 'partial' || r.status === 'failed');
  const detectorErrors = rules.some((r) => r.errors.length > 0);
  const exitCode = measured === 0 || incomplete || detectorErrors ? 1 : 0;
  return { outDir: toPosix(outDir), entries: results, rules, exitCode, files };
}

/**
 * @param {string} dir
 * @returns {string}
 */
function uniqueDir(dir) {
  let candidate = dir;
  for (let n = 2; existsSync(candidate); n += 1) candidate = `${dir}-${n}`;
  return candidate;
}

/**
 * @param {string} file
 * @param {unknown} value
 * @returns {string}
 */
function writeJson(file, value) {
  return writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * @param {{made_at: string, corpus: {path: string, sha256: string}, registry: {path: string, sha256: string},
 *   options: Record<string, unknown>}} meta
 * @param {RuleResult[]} rules
 * @param {string} outDir
 * @returns {Record<string, unknown>}
 */
function proposalOf(meta, rules, outDir) {
  return {
    version: 1,
    tool: 'calibrate',
    made_at: meta.made_at,
    results: toPosix(outDir),
    corpus: meta.corpus,
    registry: meta.registry,
    options: meta.options,
    note: 'Review each proposed_tier; set apply to false for a rule to leave it unchanged, then run node scripts/calibrate.mjs --apply <this file>.',
    rules: rules.map((r) => ({
      rule: r.id,
      title: r.title,
      current_tier: r.tier,
      proposed_tier: r.proposal.tier,
      apply: r.proposal.tier !== null,
      reason: r.proposal.reason,
      counts: { positives: pick(r.positives), controls: pick(r.controls), exemplars: pick(r.exemplars) },
      rates: { positives: r.positives.rate, controls: r.controls.rate },
      fingerprint: r.fingerprint,
    })),
  };
}

/**
 * @param {Count} c
 * @returns {Count}
 */
function pick(c) {
  return { fired: c.fired, total: c.total };
}

/**
 * @param {string} s
 * @returns {string}
 */
function cell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

/**
 * @param {Count & {rate?: number | null}} c
 * @returns {string}
 */
function ratio(c) {
  return c.total === 0 ? '-' : `${c.fired}/${c.total} (${pct(c.fired / c.total)})`;
}

/**
 * @param {string} p
 * @returns {string}
 */
function shown(p) {
  const rel = path.relative(SKILL_ROOT, p);
  return toPosix(rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : p);
}

/**
 * The human summary of a run.
 * @param {{made_at: string, corpus: {path: string, sha256: string}, registry: {path: string, sha256: string},
 *   labels: string | null, options: Record<string, unknown>}} meta
 * @param {EntryResult[]} entries
 * @param {RuleResult[]} rules
 * @param {string} outDir
 * @returns {string}
 */
export function summaryMarkdown(meta, entries, rules, outDir) {
  const o = meta.options;
  const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.join(', ') : String(v));
  const lines = [
    `# Calibration run ${meta.made_at}`,
    '',
    `Corpus \`${shown(meta.corpus.path)}\` (SHA-256 ${meta.corpus.sha256.slice(0, 12)}), registry \`${shown(meta.registry.path)}\` ` +
      `(SHA-256 ${meta.registry.sha256.slice(0, 12)}, ${rules.length} rules).`,
    `Sets ${list(o.sets)}; viewports ${list(o.viewports)}; layers ${list(o.layers)}; network ${o.network ? 'on' : 'off'}; ` +
      `HAR ${o.har ?? 'none'}; tier-1 share ${pct(Number(o.tier1_share))}; minimum ${o.min_positives} positive(s) and ${o.min_controls} control(s).`,
    meta.labels ? `Owner labels: \`${shown(meta.labels)}\`.` : 'Owner labels: none yet (labelling-plan.md).',
    '',
    '## Entries',
    '',
    '| entry | set | result | static layer | runtime pages | rules fired |',
    '|---|---|---|---|---|---|',
  ];
  for (const e of entries) {
    const pagesOk = e.runtime.pages.filter((p) => p.ok).length;
    const fired = Object.values(e.rules).filter((r) => r.state === 'fired').length;
    const result = e.reason ? `${e.status}: ${e.reason}` : e.status;
    const stat = e.static.ran ? `${e.static.files} files` : e.static.reason ?? '-';
    const run = e.runtime.pages.length ? `${pagesOk} of ${e.runtime.pages.length}` : e.runtime.reason ?? '-';
    lines.push(`| ${cell(e.id)} | ${e.set} | ${cell(result)} | ${cell(stat)} | ${cell(run)} | ${e.status === 'skipped' ? '-' : fired} |`);
  }
  lines.push('', '## Rules', '', 'Positives are positive and synthetic entries; counts include only entries where the rule\'s authoritative layer ran.', '');
  lines.push('| rule | title | current | positives | controls | exemplars | proposed | reason |', '|---|---|---|---|---|---|---|---|');
  for (const r of rules) {
    lines.push(`| ${r.id} | ${cell(r.title)} | ${r.tier} | ${ratio(r.positives)} | ${ratio(r.controls)} | ${ratio(r.exemplars)} | ${r.proposal.tier ?? 'none'} | ${cell(r.proposal.reason)} |`);
  }
  const unconfirmed = rules.filter((r) => r.unconfirmed.length > 0);
  if (unconfirmed.length > 0) {
    lines.push('', '## Static hits the runtime layer did not confirm', '');
    for (const r of unconfirmed) lines.push(`- ${r.id}: ${r.unconfirmed.join(', ')}`);
  }
  const labelled = rules.filter((r) => r.labels && r.labels.entries > 0);
  if (labelled.length > 0) {
    lines.push('', '## Owner labels against detectors (entries)', '', '| rule | entries | both | owner only | detector only | neither |', '|---|---|---|---|---|---|');
    for (const r of labelled) {
      const a = /** @type {LabelAgreement} */ (r.labels);
      lines.push(`| ${r.id} | ${a.entries} | ${a.both} | ${a.ownerOnly} | ${a.detectorOnly} | ${a.neither} |`);
    }
  }
  const problems = [];
  for (const e of entries) {
    for (const p of e.runtime.pages.filter((x) => !x.ok)) problems.push(`- ${e.id} ${p.viewport} ${p.route}: ${p.error}`);
    if (e.static.reason && e.static.ran) problems.push(`- ${e.id} static layer: ${e.static.reason}`);
  }
  const errored = rules.filter((r) => r.errors.length > 0);
  for (const r of errored) problems.push(`- ${r.id}: detector errors on ${[...new Set(r.errors.map((x) => x.entry))].join(', ')} (first: ${r.errors[0].error})`);
  if (problems.length > 0) lines.push('', '## Problems', '', ...problems.map(cell));
  lines.push(
    '',
    '## Next step',
    '',
    `Review \`${shown(path.join(outDir, 'proposal.json'))}\` (set \`apply\` to false to keep a rule as it is), then run ` +
      `\`node scripts/calibrate.mjs --apply ${shown(path.join(outDir, 'proposal.json'))}\`. The registry is not changed until then.`,
    '',
  );
  return lines.join('\n');
}

/**
 * @typedef {{rule: string, from: string, to: string}} AppliedChange
 * @typedef {{registry: string, applied: AppliedChange[], skipped: Array<{rule: string, reason: string}>}} ApplyResult
 */

/**
 * Writes a reviewed proposal into the registry: for each rule with `apply` not false and a proposed tier, its tier,
 * its calibration counts, the run's date and a note. Refuses the whole proposal (nothing written) when a rule is
 * unknown, a tier or count is invalid, or a rule's fingerprint changed since the run (its detector or entry was
 * edited: re-run calibrate.mjs). The new registry is validated before it replaces the old one.
 * @param {string} proposalFile
 * @param {string} registryFile
 * @returns {ApplyResult}
 */
export function applyProposal(proposalFile, registryFile) {
  const where = toPosix(path.resolve(proposalFile));
  /** @type {unknown} */
  let proposal;
  try {
    proposal = JSON.parse(readText(proposalFile));
  } catch (err) {
    if (err instanceof FrontendError) throw err;
    throw new UsageError(`proposal ${where} is not valid JSON (${err instanceof Error ? err.message : String(err)})`, { cause: err });
  }
  if (!isObject(proposal) || proposal.version !== 1 || !Array.isArray(proposal.rules) || typeof proposal.made_at !== 'string') {
    throw new UsageError(`proposal ${where} must be the proposal.json a calibrate.mjs run wrote ({version: 1, made_at, rules})`);
  }
  const registry = loadRegistry(registryFile);
  const rawText = readText(registryFile);
  /** @type {{rules: Array<Record<string, unknown>>}} */
  const raw = JSON.parse(rawText);
  /** @type {string[]} */
  const problems = [];
  /** @type {AppliedChange[]} */
  const applied = [];
  /** @type {Array<{rule: string, reason: string}>} */
  const skipped = [];
  const madeAt = proposal.made_at;
  for (const [i, p] of proposal.rules.entries()) {
    if (!isObject(p) || typeof p.rule !== 'string') {
      problems.push(`rules[${i}] has no rule id`);
      continue;
    }
    const id = p.rule;
    const rule = registry.rules.find((r) => r.id === id);
    const target = raw.rules.find((r) => r.id === id);
    if (!rule || !target) {
      problems.push(`${id} is not in ${registry.path}`);
      continue;
    }
    if (p.apply === false || p.proposed_tier === null || p.proposed_tier === undefined) {
      skipped.push({ rule: id, reason: p.apply === false ? 'apply is false' : 'no tier proposed' });
      continue;
    }
    if (typeof p.proposed_tier !== 'string' || !TIERS.includes(p.proposed_tier)) {
      problems.push(`${id}: proposed_tier ${JSON.stringify(p.proposed_tier)} is not one of ${TIERS.join('|')}`);
      continue;
    }
    const counts = isObject(p.counts) ? p.counts : {};
    const valid = ['positives', 'controls', 'exemplars'].every((k) => isCount(counts[k]));
    if (!valid) {
      problems.push(`${id}: counts must hold positives, controls and exemplars as {fired, total} with 0 <= fired <= total`);
      continue;
    }
    if (p.fingerprint !== ruleFingerprint(rule, registry.dir)) {
      problems.push(`${id}: its registry entry or detector changed after the run (fingerprint differs); re-run calibrate.mjs`);
      continue;
    }
    const c = /** @type {Record<'positives' | 'controls' | 'exemplars', Count>} */ (/** @type {unknown} */ (counts));
    const from = String(target.tier);
    target.tier = p.proposed_tier;
    target.calibration = {
      positives: { fired: c.positives.fired, total: c.positives.total },
      controls: { fired: c.controls.fired, total: c.controls.total },
      exemplars: { fired: c.exemplars.fired, total: c.exemplars.total },
      date: madeAt,
      notes: typeof p.notes === 'string' && p.notes.trim()
        ? p.notes
        : `calibrate.mjs ${madeAt}: ${typeof p.reason === 'string' ? p.reason : ''}${typeof proposal.results === 'string' ? `; results ${proposal.results}` : ''}`,
    };
    applied.push({ rule: id, from, to: p.proposed_tier });
  }
  if (problems.length > 0) {
    throw new UsageError(`proposal ${where} not applied (${problems.length} problem(s)): ${problems.join('; ')}; nothing was written`);
  }
  if (applied.length > 0) writeRegistry(registryFile, raw);
  return { registry: registry.path, applied, skipped };
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isCount(v) {
  return isObject(v) && Number.isInteger(v.fired) && Number.isInteger(v.total) &&
    /** @type {number} */ (v.fired) >= 0 && /** @type {number} */ (v.fired) <= /** @type {number} */ (v.total);
}

/**
 * Writes the registry through a temporary file that loadRegistry validates first, then renames it into place.
 * @param {string} file
 * @param {unknown} raw
 */
function writeRegistry(file, raw) {
  const target = path.resolve(file);
  const temp = path.join(path.dirname(target), `.registry-${process.pid}-${Date.now()}.json`);
  writeFileSync(temp, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  try {
    loadRegistry(temp);
    renameSync(temp, target);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function describe(err) {
  if (err instanceof FrontendError) return err.message;
  if (err instanceof Error) return `${err.name}: ${err.message.split('\n')[0]}`;
  return String(err);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
 * @param {string} message
 */
function stderrLog(message) {
  process.stderr.write(`${message}\n`);
}

const OPTIONS = /** @type {const} */ ({
  corpus: { type: 'string' },
  registry: { type: 'string' },
  base: { type: 'string' },
  out: { type: 'string' },
  sets: { type: 'string' },
  entries: { type: 'string' },
  viewports: { type: 'string' },
  layers: { type: 'string' },
  network: { type: 'boolean' },
  har: { type: 'string' },
  labels: { type: 'string' },
  'tier1-share': { type: 'string' },
  'min-positives': { type: 'string' },
  'min-controls': { type: 'string' },
  timeout: { type: 'string' },
  'detector-timeout': { type: 'string' },
  'wayback-delay': { type: 'string' },
  apply: { type: 'string' },
  json: { type: 'boolean' },
});

/**
 * @param {string | undefined} value
 * @returns {string[]}
 */
function listOf(value) {
  return value === undefined ? [] : [...new Set(value.split(',').map((s) => s.trim()).filter(Boolean))];
}

/**
 * @param {string | undefined} value
 * @param {string} flag
 * @param {{min: number, max: number, integer?: boolean}} range
 * @param {number} fallback
 * @returns {number}
 */
function numberFlag(value, flag, { min, max, integer = false }, fallback) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new UsageError(`${flag} ${value}: give ${integer ? 'an integer' : 'a number'} from ${min} to ${max}`);
  }
  return n;
}

/**
 * Turns parsed flags into options; throws UsageError on a bad value.
 * @param {Record<string, string | boolean | undefined>} values
 * @returns {CalibrateOptions}
 */
export function optionsFrom(values) {
  const str = (/** @type {string} */ k) => (typeof values[k] === 'string' ? /** @type {string} */ (values[k]) : undefined);
  const sets = listOf(str('sets'));
  for (const s of sets) if (!SETS.includes(/** @type {CorpusSet} */ (s))) throw new UsageError(`--sets ${s}: one of ${SETS.join(', ')}`);
  const viewportNames = listOf(str('viewports'));
  for (const v of viewportNames) if (!Object.hasOwn(VIEWPORTS, v)) throw new UsageError(`--viewports ${v}: one of ${Object.keys(VIEWPORTS).join(', ')}`);
  const layers = listOf(str('layers'));
  for (const l of layers) if (l !== 'static' && l !== 'runtime') throw new UsageError(`--layers ${l}: static or runtime`);
  const entries = listOf(str('entries'));
  const labelsFlag = str('labels');
  if (labelsFlag !== undefined && !existsSync(labelsFlag)) throw new UsageError(`--labels ${labelsFlag}: file not found`);
  return {
    corpus: path.resolve(str('corpus') ?? DEFAULT_CORPUS),
    registry: path.resolve(str('registry') ?? DEFAULT_REGISTRY),
    base: path.resolve(str('base') ?? SKILL_ROOT),
    out: str('out') ? path.resolve(/** @type {string} */ (str('out'))) : null,
    sets: sets.length ? /** @type {CorpusSet[]} */ (sets) : DEFAULT_SETS,
    entries: entries.length ? entries : null,
    viewports: (viewportNames.length ? viewportNames : ['desktop', 'mobile']).map((n) => ({ ...VIEWPORTS[n] })),
    layers: { static: layers.length === 0 || layers.includes('static'), runtime: layers.length === 0 || layers.includes('runtime') },
    network: values.network === true,
    har: str('har') ? path.resolve(/** @type {string} */ (str('har'))) : null,
    labels: labelsFlag ? path.resolve(labelsFlag) : existsSync(DEFAULT_LABELS) ? DEFAULT_LABELS : null,
    tier1Share: numberFlag(str('tier1-share'), '--tier1-share', { min: 0.01, max: 1 }, 0.3),
    minPositives: numberFlag(str('min-positives'), '--min-positives', { min: 1, max: 1000, integer: true }, 1),
    minControls: numberFlag(str('min-controls'), '--min-controls', { min: 1, max: 1000, integer: true }, 1),
    readyTimeoutMs: numberFlag(str('timeout'), '--timeout', { min: 1, max: 600 }, 20) * 1000,
    detectorTimeoutMs: numberFlag(str('detector-timeout'), '--detector-timeout', { min: 1, max: 600 }, 30) * 1000,
    waybackDelayMs: numberFlag(str('wayback-delay'), '--wayback-delay', { min: 0, max: 600 }, 5) * 1000,
    json: values.json === true,
  };
}

/**
 * The CLI. Returns the exit code; usage and environment errors are thrown.
 * @param {string[]} argv
 * @param {{now?: Date, log?: (message: string) => void}} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const { values, positionals } = parseCli(argv, { help: HELP, options: OPTIONS, allowPositionals: false });
  if (positionals.length > 0) throw new UsageError(`unexpected argument ${positionals[0]}; run with --help for usage`);
  if (values.apply !== undefined) {
    const others = Object.keys(values).filter((k) => !['apply', 'registry', 'json'].includes(k));
    if (others.length > 0) throw new UsageError(`--apply takes only --registry and --json (got --${others.join(', --')})`);
    const result = applyProposal(values.apply, path.resolve(values.registry ?? DEFAULT_REGISTRY));
    for (const c of result.applied) process.stderr.write(`calibrate: ${c.rule} ${c.from} -> ${c.to}\n`);
    process.stderr.write(`calibrate: applied ${result.applied.length} rule(s), skipped ${result.skipped.length}; registry ${result.registry}\n`);
    if (values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  const opts = optionsFrom(/** @type {Record<string, string | boolean | undefined>} */ (values));
  const run = await calibrate(opts, deps);
  const counts = { measured: 0, partial: 0, failed: 0, skipped: 0 };
  for (const e of run.entries) counts[e.status] += 1;
  const proposed = run.rules.filter((r) => r.proposal.tier !== null).length;
  process.stderr.write(
    `calibrate: ${counts.measured} measured, ${counts.partial} partial, ${counts.failed} failed, ${counts.skipped} skipped; ` +
      `${proposed} of ${run.rules.length} rules have a proposed tier; results ${run.outDir}\n`,
  );
  if (opts.json) {
    const summary = {
      ok: run.exitCode === 0,
      out: run.outDir,
      files: run.files,
      entries: counts,
      rules: run.rules.map((r) => ({ id: r.id, positives: pick(r.positives), controls: pick(r.controls), exemplars: r.exemplars, proposed_tier: r.proposal.tier })),
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
  if (run.exitCode !== 0) {
    process.stderr.write('calibrate: incomplete run (an entry or a detector failed, or nothing was measured); see summary.md\n');
  }
  return run.exitCode;
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

