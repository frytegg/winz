// @ts-check
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { goto, newContext } from '../lib/browser.mjs';
import { collectAnimations, collectElements, collectText } from '../lib/dom.mjs';
import { EnvError, UsageError } from '../lib/errors.mjs';
import { readText, toPosix, walk } from '../lib/fsutil.mjs';
import { designDir } from '../lib/paths.mjs';
import { waitReady } from '../lib/ready.mjs';
import { stripComments } from '../lib/text.mjs';

/**
 * @typedef {import('../lib/profile.mjs').Profile} Profile
 * @typedef {import('../lib/profile.mjs').Viewport} Viewport
 * @typedef {import('../lib/routes.mjs').Route} Route
 * @typedef {import('../lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {import('../lib/dom.mjs').TextInfo} TextInfo
 * @typedef {import('../lib/dom.mjs').AnimationInfo} AnimationInfo
 * @typedef {import('../lib/dom.mjs').CollectElementsOptions} CollectElementsOptions
 * @typedef {import('../lib/dom.mjs').CollectTextOptions} CollectTextOptions
 * @typedef {import('../lib/dom.mjs').CollectAnimationsOptions} CollectAnimationsOptions
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('playwright-core').BrowserContext} BrowserContext
 * @typedef {import('playwright-core').Page} Page
 *
 * @typedef {{fired: number, total: number}} CalibrationCount
 * @typedef {{positives: CalibrationCount, controls: CalibrationCount, exemplars: CalibrationCount,
 *   date: string | null, notes: string}} Calibration
 * @typedef {'owner-tell' | 'missing-tell' | 'claude-era' | 'generator' | 'invented' | 'motion' | 'copy' | 'web3'} RuleFamily
 * @typedef {'candidate' | 'tier1' | 'tier2' | 'advisory'} RuleTier
 * @typedef {{id: string, family: RuleFamily, title: string, tell: number | null, static: boolean, runtime: boolean,
 *   tier: RuleTier, anchor: boolean, weight: number, scope: string, falsePositives: string, fix: string,
 *   sources: string[], allowlist: 'sponsor-hash' | 'category' | 'none', calibration: Calibration,
 *   [key: string]: unknown}} Rule
 * @typedef {{version: number, rules: Rule[], path: string, dir: string}} Registry
 *
 * @typedef {'js' | 'jsx' | 'ts' | 'tsx' | 'vue' | 'svelte' | 'html' | 'css' | 'json'} FileKind
 * @typedef {{path: string, kind: FileKind, text: string, code: string}} SourceFile
 * @typedef {{rule: string, scope: string, reason: string, evidence: string | string[], approved_by: string,
 *   date: string | null, [key: string]: unknown}} Waiver
 * @typedef {{rule: string, category: string, reason: string, source: string, [key: string]: unknown}} CategoryEntry
 * @typedef {{sponsorHashes: Set<string>, sponsors: Array<Record<string, unknown>>, waivers: Waiver[],
 *   category: CategoryEntry[], unknownSponsors?: string[]}} Allowlist
 *   `unknownSponsors`: profile sponsor ids with no entry in the sponsor allowlist; they exempt nothing (Q-FX-5).
 * @typedef {{root: string, files: SourceFile[], profile: Profile, allowlist: Allowlist, rule?: Rule, surface?: Surface}} StaticContext
 *
 * @typedef {{elements: (opts?: CollectElementsOptions) => Promise<ElementInfo[]>,
 *   text: (opts?: CollectTextOptions) => Promise<TextInfo[]>,
 *   animations: (opts?: CollectAnimationsOptions) => Promise<AnimationInfo[]>}} CollectorCache
 * @typedef {{browser: Browser, page: Page, route: Route, viewport: Viewport, profile: Profile, allowlist: Allowlist,
 *   cache: CollectorCache, freshPage: () => Promise<Page>, closeFresh: () => Promise<void>, rule?: Rule}} RuntimeContext
 *
 * @typedef {{rule: string, layer: 'static', file: string, line: number, excerpt: string, value: unknown,
 *   detail: string, [key: string]: unknown}} StaticFinding
 * @typedef {{rule: string, layer: 'runtime', route: string, viewport: string, selector: string, value: unknown,
 *   detail: string, [key: string]: unknown}} RuntimeFinding
 * @typedef {{rule: string, layer: 'static' | 'runtime', error: string, route?: string, viewport?: string}} ErrorFinding
 * @typedef {StaticFinding | RuntimeFinding | ErrorFinding} Finding
 */

const RULES_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY = path.join(RULES_DIR, 'registry.json');
const DEFAULT_SPONSOR_FILE = path.join(RULES_DIR, '..', '..', 'assets', 'sponsor-allowlist.json');

export const RULE_ID = /^SL-[A-Z]{1,3}\d{1,3}$/;
export const FAMILIES = Object.freeze(['owner-tell', 'missing-tell', 'claude-era', 'generator', 'invented', 'motion', 'copy', 'web3']);
export const TIERS = Object.freeze(['candidate', 'tier1', 'tier2', 'advisory']);
export const ALLOWLIST_KINDS = Object.freeze(['sponsor-hash', 'category', 'none']);
export const EXCERPT_MAX = 120;

/**
 * Loads and validates the rule registry (section 5): version 1, unique well-formed ids, known family, tier and
 * allowlist, boolean layer flags with at least one layer, sources, calibration counts. With `{strict: true}` it also
 * checks the detector files against the flags: every flagged layer has `<dir>/<layer>/<id>.mjs`, no detector file
 * exists for an unflagged layer or an unknown id. Every problem is listed in one error: UsageError for a registry
 * path given by the caller, EnvError for the skill's own registry (a broken install).
 * @param {string} [file]
 * @param {{strict?: boolean}} [options]
 * @returns {Registry}
 */
export function loadRegistry(file, { strict = false } = {}) {
  const registryPath = path.resolve(file ?? DEFAULT_REGISTRY);
  const where = toPosix(registryPath);
  /** @type {(message: string, cause?: unknown) => Error} */
  const fail = (message, cause) => (file ? new UsageError(message, { cause }) : new EnvError(message, { cause }));
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readText(registryPath));
  } catch (err) {
    throw fail(`rule registry ${where} cannot be read (${err instanceof Error ? err.message : String(err)}); restore the file`, err);
  }
  const problems = validateRegistry(raw);
  const dir = path.dirname(registryPath);
  const rules = isObject(raw) && Array.isArray(raw.rules) ? /** @type {Rule[]} */ (raw.rules) : [];
  if (strict && problems.length === 0) problems.push(...detectorProblems(rules, dir));
  if (problems.length > 0) {
    const what = `${problems.length} problem${problems.length > 1 ? 's' : ''}`;
    throw fail(`rule registry ${where} has ${what}: ${problems.join('; ')}; fix the registry entries or the detector files named here`);
  }
  return { version: /** @type {number} */ (/** @type {Record<string, unknown>} */ (raw).version), rules, path: where, dir: toPosix(dir) };
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function validateRegistry(raw) {
  if (!isObject(raw)) return ['the registry must be a JSON object {version, rules}'];
  /** @type {string[]} */
  const problems = [];
  if (raw.version !== 1) problems.push(`version must be 1 (got ${JSON.stringify(raw.version)})`);
  if (!Array.isArray(raw.rules)) return [...problems, 'rules must be an array'];
  const ids = new Set();
  raw.rules.forEach((rule, i) => {
    if (!isObject(rule)) {
      problems.push(`rules[${i}] must be an object`);
      return;
    }
    const label = typeof rule.id === 'string' && rule.id ? rule.id : `rules[${i}]`;
    const bad = (/** @type {string} */ what) => problems.push(`${label}: ${what}`);
    if (typeof rule.id !== 'string' || !RULE_ID.test(rule.id)) bad(`id must look like SL-T01 (got ${JSON.stringify(rule.id)})`);
    else if (ids.has(rule.id)) bad('id is used twice');
    ids.add(rule.id);
    if (!FAMILIES.includes(/** @type {string} */ (rule.family))) bad(`family must be one of ${FAMILIES.join('|')}`);
    if (!nonEmpty(rule.title)) bad('title must be a non-empty string');
    if (rule.tell !== null && rule.tell !== undefined && !(Number.isInteger(rule.tell) && /** @type {number} */ (rule.tell) >= 1)) {
      bad('tell must be null or a positive integer');
    }
    if (typeof rule.static !== 'boolean' || typeof rule.runtime !== 'boolean') bad('static and runtime must be booleans');
    else if (!rule.static && !rule.runtime) bad('at least one of static and runtime must be true');
    if (!TIERS.includes(/** @type {string} */ (rule.tier))) bad(`tier must be one of ${TIERS.join('|')}`);
    if (typeof rule.anchor !== 'boolean') bad('anchor must be a boolean');
    if (typeof rule.weight !== 'number' || !Number.isFinite(rule.weight) || rule.weight < 0) bad('weight must be a number >= 0');
    for (const key of ['scope', 'falsePositives', 'fix']) if (!nonEmpty(rule[key])) bad(`${key} must be a non-empty string`);
    if (!Array.isArray(rule.sources) || rule.sources.length === 0 || !rule.sources.every(nonEmpty)) {
      bad('sources must be a non-empty array of finding ids');
    }
    if (!ALLOWLIST_KINDS.includes(/** @type {string} */ (rule.allowlist))) bad(`allowlist must be one of ${ALLOWLIST_KINDS.join('|')}`);
    problems.push(...calibrationProblems(label, rule.calibration));
  });
  return problems;
}

/**
 * @param {string} label
 * @param {unknown} calibration
 * @returns {string[]}
 */
function calibrationProblems(label, calibration) {
  if (!isObject(calibration)) return [`${label}: calibration must be an object`];
  /** @type {string[]} */
  const problems = [];
  for (const key of ['positives', 'controls', 'exemplars']) {
    const count = calibration[key];
    const ok = isObject(count) && Number.isInteger(count.fired) && Number.isInteger(count.total) &&
      /** @type {number} */ (count.fired) >= 0 && /** @type {number} */ (count.fired) <= /** @type {number} */ (count.total);
    if (!ok) problems.push(`${label}: calibration.${key} must be {fired, total} with 0 <= fired <= total`);
  }
  if (calibration.date !== null && typeof calibration.date !== 'string') problems.push(`${label}: calibration.date must be null or a date string`);
  if (typeof calibration.notes !== 'string') problems.push(`${label}: calibration.notes must be a string`);
  return problems;
}

/**
 * @param {Rule[]} rules
 * @param {string} dir
 * @returns {string[]}
 */
function detectorProblems(rules, dir) {
  /** @type {string[]} */
  const problems = [];
  const known = new Set(rules.map((r) => r.id));
  for (const layer of /** @type {const} */ (['static', 'runtime'])) {
    const layerDir = path.join(dir, layer);
    for (const rule of rules) {
      const present = existsSync(path.join(layerDir, `${rule.id}.mjs`));
      if (rule[layer] && !present) problems.push(`${rule.id}: ${layer} detector missing (rules/${layer}/${rule.id}.mjs)`);
      if (!rule[layer] && present) problems.push(`${rule.id}: rules/${layer}/${rule.id}.mjs exists but ${layer} is false`);
    }
    const files = existsSync(layerDir) ? readdirSync(layerDir).filter((f) => f.endsWith('.mjs')) : [];
    for (const f of files) {
      const id = f.slice(0, -4);
      if (!known.has(id)) problems.push(`rules/${layer}/${f} has no entry in the registry`);
    }
  }
  return problems;
}

/** Globs of the files static detectors read (CONTRACTS section 5, plus the .cjs/.mts/.cts/.htm spellings). */
export const SOURCE_GLOBS = Object.freeze(['*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,vue,svelte,html,htm,css,scss}', 'package.json']);
/** Minified third-party bundles are not the project's source. */
export const SOURCE_EXCLUDES = Object.freeze(['*.min.js', '*.min.css']);

/**
 * The files static detectors read, each with its raw `text` and its comment-stripped `code` (same length and line
 * numbers). `.scss` files are kind 'css' with SCSS comment rules; `package.json` is kind 'json'. Left out before
 * any detector runs: walk()'s default excludes (dependencies, Python virtual environments, Yarn releases, build
 * output), minified bundles, any private workspace or research folder the profile places inside the root, and every
 * nested git work tree (a submodule or a vendored repository: a folder below the root holding a `.git`). Inside a
 * git work tree only the files git would track are read (gitVisibleFiles), so a git-ignored docs site, saved
 * third-party page or virtual environment is never judged as the UI. With
 * `profile.paths.ui` (or `options.paths`, which replaces it: slop-check --ui-paths, a calibration corpus's
 * source_paths), only those paths and the package.json files on the way down to them are read. staticContext then
 * applies the shipped-surface cuts (tests, tooling, non-UI packages).
 * @param {string} root
 * @param {Profile} profile
 * @param {{paths?: readonly string[] | null}} [options]
 * @returns {SourceFile[]}
 */
export function sourceFiles(root, profile, { paths } = {}) {
  const abs = path.resolve(root);
  const exclude = [...SOURCE_EXCLUDES];
  for (const dir of [profile?.workspace?.private_dir, profile?.paths?.research]) {
    if (!dir) continue;
    const rel = path.relative(abs, path.resolve(dir));
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) exclude.push(`${toPosix(rel)}/**`);
  }
  const scope = uiScope(paths === undefined ? profile?.paths?.ui ?? null : paths);
  const nested = nestedRepoTest(abs);
  const visible = gitVisibleFiles(abs);
  return walk(abs, { include: [...SOURCE_GLOBS], exclude })
    .filter((rel) => (visible === null || visible.has(rel)) && scope(rel) && !nested(rel))
    .map((rel) => {
      const text = readText(path.join(abs, rel));
      const { kind, syntax } = kindOf(rel);
      return { path: rel, kind, text, code: syntax === 'json' ? text : stripComments(text, syntax) };
    });
}

/**
 * The files git would track under `root` (tracked, plus untracked files no ignore rule covers), as root-relative
 * POSIX paths. A submodule appears as its folder only, so none of its files is listed. Null when `root` is not in
 * a git work tree, git cannot run, or git lists nothing there (the root sits in an ignored folder of an enclosing
 * repository, so that repository says nothing about it): the walk alone then decides.
 * @param {string} root
 * @returns {Set<string> | null}
 */
export function gitVisibleFiles(root) {
  const r = spawnSync('git', ['-C', path.resolve(root), 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'], {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 60000, windowsHide: true,
  });
  if (r.error || r.status !== 0) return null;
  const files = r.stdout.split('\0').filter((f) => f !== '');
  return files.length === 0 ? null : new Set(files);
}

/**
 * A predicate: whether a root-relative file sits inside a nested git work tree below `root` (a submodule, whose
 * `.git` is a file, or a cloned repository, whose `.git` is a folder). Such code belongs to another project.
 * @param {string} root absolute
 * @returns {(rel: string) => boolean}
 */
export function nestedRepoTest(root) {
  /** @type {Map<string, boolean>} */
  const memo = new Map();
  /** @param {string} dir root-relative POSIX folder, '' for the root @returns {boolean} */
  const inNested = (dir) => {
    if (dir === '') return false;
    const known = memo.get(dir);
    if (known !== undefined) return known;
    const parent = path.posix.dirname(dir);
    const result = existsSync(path.join(root, dir, '.git')) || inNested(parent === '.' ? '' : parent);
    memo.set(dir, result);
    return result;
  };
  return (rel) => {
    const dir = path.posix.dirname(rel);
    return inNested(dir === '.' ? '' : dir);
  };
}

/**
 * A predicate over root-relative paths: everything when `paths` is null; else the listed paths, what is under them,
 * and the package.json files on the way down to them (detectors read dependencies from those).
 * @param {readonly string[] | null} paths
 * @returns {(rel: string) => boolean}
 */
export function uiScope(paths) {
  if (paths === null) return () => true;
  const wanted = paths.map((p) => toPosix(p).replace(/^\.\//, '').replace(/\/+$/, '')).filter((p) => p !== '');
  if (wanted.length === 0 || wanted.includes('.')) return () => true;
  const manifests = new Set();
  for (const p of wanted) {
    const parts = p.split('/');
    for (let i = 0; i < parts.length; i += 1) manifests.add([...parts.slice(0, i), 'package.json'].join('/'));
  }
  return (rel) => manifests.has(rel) || wanted.some((p) => rel === p || rel.startsWith(`${p}/`));
}

/**
 * @param {string} rel
 * @returns {{kind: FileKind, syntax: string}}
 */
function kindOf(rel) {
  if (path.posix.basename(rel) === 'package.json') return { kind: 'json', syntax: 'json' };
  const ext = path.posix.extname(rel).toLowerCase();
  switch (ext) {
    case '.jsx':
      return { kind: 'jsx', syntax: 'jsx' };
    case '.ts':
    case '.mts':
    case '.cts':
      return { kind: 'ts', syntax: 'ts' };
    case '.tsx':
      return { kind: 'tsx', syntax: 'tsx' };
    case '.vue':
      return { kind: 'vue', syntax: 'vue' };
    case '.svelte':
      return { kind: 'svelte', syntax: 'svelte' };
    case '.html':
    case '.htm':
      return { kind: 'html', syntax: 'html' };
    case '.css':
      return { kind: 'css', syntax: 'css' };
    case '.scss':
      return { kind: 'css', syntax: 'scss' };
    default:
      return { kind: 'js', syntax: 'js' };
  }
}

/**
 * The exemptions detectors and gates may honour (section 5):
 * - `sponsors`: the entries of assets/sponsor-allowlist.json for `profile.sponsors` (matched on `sponsor` or `id`,
 *   case-insensitive), and `sponsorHashes`: every SHA-256 recorded in those entries (`logo_sources[].sha256` and any
 *   other `sha256` field). A profile sponsor without an entry has no marks to exempt: it is listed in
 *   `unknownSponsors` and never an error (agreed with /execution, Q-FX-5). A missing or unreadable allowlist file
 *   while sponsors are named is an EnvError (the skill's own assets are broken).
 * - `waivers`: `<design>/waivers.json` -> `waivers` (tier-2 waivers, validated, kept even when reason or evidence
 *   is empty: the gate decides).
 * - `category`: `<design>/waivers.json` -> `category`, the category allowlist `[{rule, category, reason, source}]`
 *   ("rule id plus a recorded reason"; an entry without a reason is a UsageError).
 * @param {string} root
 * @param {Profile} profile
 * @param {{sponsorFile?: string}} [options] another sponsor allowlist file (tests)
 * @returns {Allowlist}
 */
export function loadAllowlists(root, profile, { sponsorFile } = {}) {
  const wanted = (profile?.sponsors ?? []).map((s) => String(s).toLowerCase());
  /** @type {Array<Record<string, unknown>>} */
  const sponsors = [];
  /** @type {Set<string>} */
  const sponsorHashes = new Set();
  /** @type {string[]} */
  const unknownSponsors = [];
  if (wanted.length > 0) {
    const file = path.resolve(sponsorFile ?? DEFAULT_SPONSOR_FILE);
    if (!existsSync(file)) {
      throw new EnvError(`sponsor allowlist not found at ${toPosix(file)} while the profile names sponsors (${wanted.join(', ')}); restore the skill's assets`);
    }
    /** @type {unknown} */
    let raw;
    try {
      raw = JSON.parse(readText(file));
    } catch (err) {
      throw new EnvError(`sponsor allowlist ${toPosix(file)} is not valid JSON (${err instanceof Error ? err.message : String(err)})`, { cause: err });
    }
    const entries = sponsorEntries(raw, file);
    for (const id of wanted) {
      const entry = entries.find((e) => entryId(e) === id);
      if (!entry) {
        if (!unknownSponsors.includes(id)) unknownSponsors.push(id);
        continue;
      }
      sponsors.push(entry);
      collectHashes(entry, sponsorHashes);
    }
  }
  const { waivers, category } = loadWaivers(root, profile);
  return { sponsorHashes, sponsors, waivers, category, unknownSponsors };
}

/**
 * @param {unknown} raw
 * @param {string} file
 * @returns {Array<Record<string, unknown>>}
 */
function sponsorEntries(raw, file) {
  const list = Array.isArray(raw)
    ? raw
    : isObject(raw)
      ? [raw.sponsor_allowlist, raw.sponsors, raw.entries].find(Array.isArray)
      : undefined;
  if (!Array.isArray(list)) {
    throw new EnvError(`sponsor allowlist ${toPosix(file)} must hold an array of entries (top level, or under "sponsor_allowlist")`);
  }
  return list.filter(isObject);
}

/**
 * @param {Record<string, unknown>} entry
 * @returns {string}
 */
function entryId(entry) {
  const id = entry.sponsor ?? entry.id;
  return typeof id === 'string' ? id.toLowerCase() : '';
}

/**
 * @param {unknown} value
 * @param {Set<string>} into
 */
function collectHashes(value, into) {
  if (Array.isArray(value)) {
    for (const item of value) collectHashes(item, into);
  } else if (isObject(value)) {
    for (const [key, v] of Object.entries(value)) {
      if (key === 'sha256' && typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v)) into.add(v.toLowerCase());
      else collectHashes(v, into);
    }
  }
}

/**
 * @param {string} root
 * @param {Profile} profile
 * @returns {{waivers: Waiver[], category: CategoryEntry[]}}
 */
function loadWaivers(root, profile) {
  const file = path.join(designDir(root, profile ?? {}), 'waivers.json');
  if (!existsSync(file)) return { waivers: [], category: [] };
  const where = toPosix(file);
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readText(file));
  } catch (err) {
    throw new UsageError(`${where} is not valid JSON (${err instanceof Error ? err.message : String(err)}); fix the file`, { cause: err });
  }
  if (!isObject(raw)) throw new UsageError(`${where} must be an object {waivers: [...], category: [...]}`);
  /** @type {string[]} */
  const problems = [];
  const waivers = listOf(raw.waivers, 'waivers', problems).map((w, i) => {
    const at = `waivers[${i}]`;
    if (!nonEmpty(w.rule)) problems.push(`${at}.rule must name a rule id`);
    const evidence = w.evidence;
    if (evidence !== undefined && typeof evidence !== 'string' && !(Array.isArray(evidence) && evidence.every((e) => typeof e === 'string'))) {
      problems.push(`${at}.evidence must be a string or an array of strings`);
    }
    if (w.approved_by !== undefined && !['owner', 'research'].includes(/** @type {string} */ (w.approved_by))) {
      problems.push(`${at}.approved_by must be owner or research`);
    }
    for (const key of ['scope', 'reason']) if (w[key] !== undefined && typeof w[key] !== 'string') problems.push(`${at}.${key} must be a string`);
    if (w.date !== undefined && w.date !== null && typeof w.date !== 'string') problems.push(`${at}.date must be a date string or null`);
    return /** @type {Waiver} */ ({
      ...w,
      rule: String(w.rule ?? ''),
      scope: typeof w.scope === 'string' ? w.scope : '',
      reason: typeof w.reason === 'string' ? w.reason : '',
      evidence: typeof evidence === 'string' || Array.isArray(evidence) ? /** @type {string | string[]} */ (evidence) : '',
      approved_by: typeof w.approved_by === 'string' ? w.approved_by : '',
      date: typeof w.date === 'string' ? w.date : null,
    });
  });
  const category = listOf(raw.category, 'category', problems).map((c, i) => {
    const at = `category[${i}]`;
    if (!nonEmpty(c.rule)) problems.push(`${at}.rule must name a rule id`);
    if (!nonEmpty(c.reason)) problems.push(`${at}.reason must record why the category uses this pattern`);
    return /** @type {CategoryEntry} */ ({
      ...c,
      rule: String(c.rule ?? ''),
      category: typeof c.category === 'string' ? c.category : '',
      reason: typeof c.reason === 'string' ? c.reason : '',
      source: typeof c.source === 'string' ? c.source : '',
    });
  });
  if (problems.length > 0) throw new UsageError(`${where}: ${problems.join('; ')}; fix the file`);
  return { waivers, category };
}

/**
 * @param {unknown} value
 * @param {string} key
 * @param {string[]} problems
 * @returns {Array<Record<string, unknown>>}
 */
function listOf(value, key, problems) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    problems.push(`${key} must be an array`);
    return [];
  }
  return value.filter((item, i) => {
    if (isObject(item)) return true;
    problems.push(`${key}[${i}] must be an object`);
    return false;
  });
}

/**
 * Test, spec and story files and folders, type declarations, vendored package-manager releases (.yarn/), Python
 * environments and tool caches or framework outputs never reach the judged page as source, at any depth.
 */
export const NOT_SHIPPED = /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|__stories__|tests?|spec|e2e|cypress|playwright|stories|storybook|\.storybook|\.yarn|\.pnpm-store|\.venv|venv|site-packages|__pycache__|\.cache|\.turbo|\.vercel|\.output|\.svelte-kit|\.nuxt|\.docusaurus|\.astro|\.idea|\.vscode)\/|\.(?:test|spec|stories|story|cy|e2e)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/i;
/** Tooling folders: excluded when they sit directly in a package folder or the repository root (not app/tools/ routes). */
const TOOLING_DIRS = Object.freeze(['scripts', 'tools']);
/** Dependencies that make a package a UI package. */
const UI_DEPENDENCY = /^(?:react|react-dom|preact|vue|nuxt|svelte|@sveltejs\/kit|next|solid-js|astro|lit|@angular\/core|@remix-run\/react|@builder\.io\/qwik|gatsby|vite|@vitejs\/[\w-]+)$/;
/** Folder names of a package that serves pages without a UI framework (BNB apps/web renders HTML strings). */
const UI_FOLDER = /^(?:web|www|frontend|front|front-end|ui|site|website|client|app|webapp|web-app|dashboard|landing|nextjs)$/i;

/**
 * @typedef {{uiPackages: string[], notShipped: number, outsideUi: number, keep: (paths: string[]) => string[]}} Surface
 *   What the static layer reads: the UI package folders ('' is the repository root; empty when no package is a UI
 *   package, so every shipped file counts), how many source files each exclusion left out, and `keep`, the same
 *   cuts (git visibility included) for other repo-relative paths a detector walks itself (favicons, Markdown).
 */

/**
 * The context of a static detector: `{root, files, profile, allowlist}` (root is extra: the absolute repository
 * path with forward slashes, for detectors that open binary files). `files` holds the shipped UI surface only
 * (shippedSources): every detector judges the same files, and a proof re-run from a clean checkout sees them too.
 * @param {string} root
 * @param {Profile} profile
 * @param {Allowlist} allowlist
 * @returns {StaticContext & {surface: Surface}}
 */
export function staticContext(root, profile, allowlist) {
  const ui = profile?.paths?.ui ?? null;
  const { files, surface } = shippedSources(root, sourceFiles(root, profile), { uiPaths: ui });
  return { root: toPosix(path.resolve(root)), files, profile, allowlist, surface };
}

/**
 * The source files that can reach the judged page, in three cuts:
 * 1. files git would not track (sourceFiles already leaves them out; `keep` applies gitVisibleFiles to the paths a
 *    detector walks itself): they are not in the commit a verifier checks out;
 * 2. NOT_SHIPPED paths, and scripts/ and tools/ folders that sit directly in a package folder or the root;
 * 3. outside the UI packages: when some package (a folder with a package.json, the root included) depends on a UI
 *    framework, is named like a web app, or holds an index.html, files whose nearest package is not one of them
 *    are left out (backend services, CLIs, decks, docs sites, print reports). With no UI package, every file counts.
 * @param {string} root
 * Named UI paths (profile.paths.ui, slop-check --ui-paths) replace the third cut: the owner's list beats the
 * inference, and `keep` applies the same list to walked paths.
 * @param {SourceFile[]} files
 * @param {{uiPaths?: readonly string[] | null}} [options]
 * @returns {{files: SourceFile[], surface: Surface}}
 */
export function shippedSources(root, files, { uiPaths = null } = {}) {
  const named = uiPaths !== null && uiPaths.length > 0;
  const inScope = uiScope(named ? uiPaths : null);
  /** @type {Set<string> | null | undefined} */
  let visible;
  const gitVisible = () => (visible === undefined ? (visible = gitVisibleFiles(path.resolve(root))) : visible);
  const tracked = files;
  const packages = packageDirs(tracked);
  const shipped = tracked.filter((f) => !NOT_SHIPPED.test(f.path) && !inToolingDir(f.path, packages));
  const ui = named ? [] : packages.filter((dir) => isUiPackage(dir, shipped));
  const kept = ui.length === 0 ? shipped : shipped.filter((f) => ui.includes(nearestPackage(f.path, packages)));
  /** @param {string[]} paths @returns {string[]} */
  const keep = (paths) => {
    const candidates = paths.filter((p) => inScope(p) && !NOT_SHIPPED.test(p) && !inToolingDir(p, packages)
      && (ui.length === 0 || ui.includes(nearestPackage(p, packages))));
    const seen = candidates.length === 0 ? null : gitVisible();
    return seen === null ? candidates : candidates.filter((p) => seen.has(p));
  };
  return {
    files: kept,
    surface: {
      uiPackages: ui,
      notShipped: tracked.length - shipped.length,
      outsideUi: shipped.length - kept.length,
      keep,
    },
  };
}

/**
 * Package folders, deepest first: every folder holding a package.json, plus the root ('').
 * @param {SourceFile[]} files
 * @returns {string[]}
 */
function packageDirs(files) {
  const dirs = new Set(['']);
  for (const f of files) {
    if (path.posix.basename(f.path) !== 'package.json') continue;
    const dir = path.posix.dirname(f.path);
    dirs.add(dir === '.' ? '' : dir);
  }
  return [...dirs].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
}

/**
 * @param {string} file
 * @param {string[]} packages deepest first
 * @returns {string}
 */
function nearestPackage(file, packages) {
  return packages.find((dir) => dir === '' || file.startsWith(`${dir}/`)) ?? '';
}

/**
 * @param {string} file
 * @param {string[]} packages
 * @returns {boolean}
 */
function inToolingDir(file, packages) {
  return packages.some((dir) => TOOLING_DIRS.some((t) => file.startsWith(dir === '' ? `${t}/` : `${dir}/${t}/`)));
}

/**
 * @param {string} dir
 * @param {SourceFile[]} files
 * @returns {boolean}
 */
function isUiPackage(dir, files) {
  const prefix = dir === '' ? '' : `${dir}/`;
  if (files.some((f) => f.path === `${prefix}index.html`)) return true;
  if (dir !== '' && UI_FOLDER.test(path.posix.basename(dir))) return true;
  const manifest = files.find((f) => f.path === `${prefix}package.json`);
  if (!manifest) return false;
  /** @type {unknown} */
  let pkg;
  try {
    pkg = JSON.parse(manifest.text);
  } catch {
    return false;
  }
  if (!isObject(pkg)) return false;
  return ['dependencies', 'devDependencies', 'peerDependencies'].some((key) => {
    const deps = pkg[key];
    return isObject(deps) && Object.keys(deps).some((name) => UI_DEPENDENCY.test(name));
  });
}

/**
 * The context of a runtime detector on an already loaded and ready page. `cache.elements()`, `cache.text()` and
 * `cache.animations()` run their collector once per page (per distinct options) and share the result.
 * `freshPage()` opens a new context and page at the same URL and viewport, waits until it is ready and returns it,
 * for detectors that hover, scroll or move the mouse; `closeFresh()` closes every fresh page opened so far
 * (runRuntime calls it after each detector).
 * @param {Browser} browser
 * @param {Page} page
 * @param {Route} route
 * @param {Viewport} viewport
 * @param {Profile} profile
 * @param {Allowlist} allowlist
 * @returns {Promise<RuntimeContext>}
 */
export async function runtimeContext(browser, page, route, viewport, profile, allowlist) {
  /** @type {Map<string, Promise<ElementInfo[]>>} */
  const elements = new Map();
  /** @type {Map<string, Promise<TextInfo[]>>} */
  const texts = new Map();
  /** @type {Map<string, Promise<AnimationInfo[]>>} */
  const animations = new Map();
  /** @type {BrowserContext[]} */
  const fresh = [];
  /**
   * @template T
   * @param {Map<string, Promise<T>>} memo @param {unknown} opts @param {() => Promise<T>} run @returns {Promise<T>}
   */
  const once = (memo, opts, run) => {
    const key = JSON.stringify(opts ?? {});
    let pending = memo.get(key);
    if (!pending) {
      pending = run();
      memo.set(key, pending);
    }
    return pending;
  };
  return {
    browser,
    page,
    route,
    viewport,
    profile,
    allowlist,
    cache: {
      elements: (opts) => once(elements, opts, () => page.evaluate(collectElements, opts ?? {})),
      text: (opts) => once(texts, opts, () => page.evaluate(collectText, opts ?? {})),
      animations: (opts) => once(animations, opts, () => page.evaluate(collectAnimations, opts ?? {})),
    },
    freshPage: async () => {
      const context = await newContext(browser, viewport);
      fresh.push(context);
      const p = await context.newPage();
      await goto(p, page.url());
      await waitReady(p, { readyFlag: profile?.ready_flag === true });
      return p;
    },
    closeFresh: async () => {
      const results = await Promise.allSettled(fresh.splice(0).map((c) => c.close()));
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        throw new AggregateError(failed.map((r) => /** @type {PromiseRejectedResult} */ (r).reason), `${failed.length} fresh page(s) failed to close`);
      }
    },
  };
}

/**
 * Runs the static detector of every rule with `static: true`, in registry order. A detector that is missing,
 * exports no `detect`, throws, or returns something other than an array of objects yields one error finding
 * `{rule, layer: 'static', error}`; the run always continues. Findings are normalised: `rule` and `layer` set,
 * `file` with forward slashes, `line` an integer, `excerpt` cut at 120 characters.
 * @param {Rule[] | Registry} rules
 * @param {StaticContext} ctx
 * @param {{dir?: string}} [options] the rules folder holding static/ (default: this folder)
 * @returns {Promise<Finding[]>}
 */
export async function runStatic(rules, ctx, { dir } = {}) {
  const base = path.resolve(dir ?? RULES_DIR);
  /** @type {Finding[]} */
  const findings = [];
  for (const rule of ruleList(rules)) {
    if (!rule.static) continue;
    try {
      const detect = await loadDetector(base, 'static', rule.id);
      const result = await detect({ ...ctx, rule });
      findings.push(...findingObjects(result).map((f) => normaliseStatic(rule.id, f)));
    } catch (err) {
      findings.push({ rule: rule.id, layer: 'static', error: describe(err) });
    }
  }
  return findings;
}

/**
 * Runs the runtime detector of every rule with `runtime: true` against one page, in registry order. A detector
 * that is missing, throws, returns a non-array or exceeds `timeoutMs` (default 30 s) yields one error finding
 * `{rule, layer: 'runtime', error, route, viewport}` and never aborts the run. Fresh pages a detector opened are
 * closed after it. Findings get `rule`, `layer`, and the context's route path and viewport name when missing.
 * @param {Rule[] | Registry} rules
 * @param {RuntimeContext} ctx
 * @param {{dir?: string, timeoutMs?: number}} [options]
 * @returns {Promise<Finding[]>}
 */
export async function runRuntime(rules, ctx, { dir, timeoutMs = 30000 } = {}) {
  const base = path.resolve(dir ?? RULES_DIR);
  const route = ctx?.route?.path ?? '';
  const viewport = ctx?.viewport?.name ?? '';
  /** @type {Finding[]} */
  const findings = [];
  for (const rule of ruleList(rules)) {
    if (!rule.runtime) continue;
    try {
      const detect = await loadDetector(base, 'runtime', rule.id);
      const result = await withTimeout(Promise.resolve().then(() => detect({ ...ctx, rule })), timeoutMs, `${rule.id} runtime detector`);
      findings.push(...findingObjects(result).map((f) => normaliseRuntime(rule.id, f, route, viewport)));
    } catch (err) {
      findings.push({ rule: rule.id, layer: 'runtime', error: describe(err), route, viewport });
    } finally {
      try {
        if (typeof ctx?.closeFresh === 'function') await ctx.closeFresh();
      } catch (err) {
        findings.push({ rule: rule.id, layer: 'runtime', error: `closing its fresh pages failed: ${describe(err)}`, route, viewport });
      }
    }
  }
  return findings;
}

/**
 * @param {Rule[] | Registry} rules
 * @returns {Rule[]}
 */
function ruleList(rules) {
  if (Array.isArray(rules)) return rules;
  if (rules && Array.isArray(rules.rules)) return rules.rules;
  throw new TypeError('expected the registry rules (an array, or the object loadRegistry returns)');
}

/**
 * @param {string} base
 * @param {'static' | 'runtime'} layer
 * @param {string} id
 * @returns {Promise<(ctx: StaticContext | RuntimeContext) => unknown>}
 */
async function loadDetector(base, layer, id) {
  if (!RULE_ID.test(id)) throw new Error(`invalid rule id ${JSON.stringify(id)}`);
  const file = path.join(base, layer, `${id}.mjs`);
  if (!existsSync(file)) throw new Error(`detector file missing: rules/${layer}/${id}.mjs`);
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod.detect !== 'function') throw new Error(`rules/${layer}/${id}.mjs exports no detect() function`);
  return mod.detect;
}

/**
 * @param {unknown} result
 * @returns {Array<Record<string, unknown>>}
 */
function findingObjects(result) {
  if (!Array.isArray(result)) throw new TypeError(`detect() must return an array of findings, got ${result === null ? 'null' : typeof result}`);
  return result.map((f, i) => {
    if (!isObject(f)) throw new TypeError(`finding[${i}] must be an object, got ${JSON.stringify(f)}`);
    return f;
  });
}

/**
 * @param {string} rule
 * @param {Record<string, unknown>} f
 * @returns {StaticFinding}
 */
function normaliseStatic(rule, f) {
  const excerpt = String(f.excerpt ?? '');
  return {
    ...f,
    rule,
    layer: 'static',
    file: toPosix(String(f.file ?? '')),
    line: Number.isInteger(f.line) ? /** @type {number} */ (f.line) : 0,
    excerpt: excerpt.length > EXCERPT_MAX ? excerpt.slice(0, EXCERPT_MAX) : excerpt,
    value: f.value ?? '',
    detail: String(f.detail ?? ''),
  };
}

/**
 * @param {string} rule
 * @param {Record<string, unknown>} f
 * @param {string} route
 * @param {string} viewport
 * @returns {RuntimeFinding}
 */
function normaliseRuntime(rule, f, route, viewport) {
  return {
    ...f,
    rule,
    layer: 'runtime',
    route: typeof f.route === 'string' ? f.route : route,
    viewport: typeof f.viewport === 'string' ? f.viewport : viewport,
    selector: String(f.selector ?? ''),
    value: f.value ?? '',
    detail: String(f.detail ?? ''),
  };
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} what
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, what) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return /** @type {Promise<T>} */ (Promise.race([promise, timeout])).finally(() => clearTimeout(timer));
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function describe(err) {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
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
function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}
