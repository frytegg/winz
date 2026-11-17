// @ts-check
import { existsSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './errors.mjs';
import { readText } from './fsutil.mjs';

/**
 * @typedef {'light' | 'dark' | 'no-preference'} ColorScheme
 * @typedef {'reduce' | 'no-preference'} ReducedMotion
 * @typedef {{name: string, width: number, height: number, dpr: number, isMobile: boolean, hasTouch: boolean,
 *   colorScheme?: ColorScheme, reducedMotion?: ReducedMotion}} Viewport
 * @typedef {{max_s: number, width: number, height: number, embed: 'pptx' | 'key' | 'mp4'}} VideoFormat
 * @typedef {{stage: boolean, projector_zoom: number, video: VideoFormat | null, async_readme: boolean}} Format
 * @typedef {{customer: string, url: string, source: string, owner_confirmed: boolean}} Reference
 * @typedef {{design: string, claims_ledger: string | null, never_show: string | null,
 *   feature_catalogue: string | null, spec: string | null, research: string | null, ui: string[] | null}} ProfilePaths
 *   `ui`: the repository-relative folders or files that hold the judged UI's source; the static tells layer reads
 *   only those (plus the package.json files on the way down). Null reads the whole repository.
 * @typedef {{code: boolean | null, designs: boolean | null, until_utc: string | null}} Prework
 * @typedef {{path: string | null, kind: 'execution' | 'block' | 'defaults', unknown: string[]}} ProfileSource
 * @typedef {{
 *   mode: 'full' | 'small',
 *   run_mode: 'A' | 'B',
 *   judged_surface: 'site' | 'app' | 'site+app' | 'video' | 'readme',
 *   format: Format,
 *   viewports: Viewport[],
 *   record_mode: boolean,
 *   ready_flag: boolean,
 *   stack: 'vite-react' | 'next' | 'static-html' | 'existing',
 *   hosting: 'vercel' | 'gh-pages' | 'fly' | 'existing' | 'local',
 *   external_requests: boolean,
 *   prework_designs: {allowed: boolean, until_utc: string | null},
 *   review_surface: 'claude-design' | 'board' | 'terminal',
 *   critique: {rounds_max: number, critics: number, probes: number},
 *   budget: {ui_hours: number | null, tokens: number | null},
 *   references: Reference[],
 *   sponsors: string[],
 *   tells: {score_max: number | null},
 *   firstview?: {complexity: FirstviewBand | null},
 *   paths: ProfilePaths,
 *   workspace: {private_dir: string | null},
 *   prework: Prework | null,
 *   project: {name: string | null, name_owner_confirmed: boolean | null} | null,
 *   source: ProfileSource
 * }} Profile
 * @typedef {{min_kib: number, max_kib: number, width?: number, height?: number, dpr?: number, quality?: number,
 *   calibrated?: boolean, source?: string}} FirstviewBand
 *   The firstview.complexity band of the block's `firstview.complexity` (CONTRACTS 6.1 v1.1); firstview.mjs reads it.
 */

/** @type {ReadonlyArray<Readonly<Viewport>>} */
export const DEFAULT_VIEWPORTS = Object.freeze([
  Object.freeze({ name: 'desktop', width: 1440, height: 900, dpr: 1, isMobile: false, hasTouch: false }),
  Object.freeze({ name: 'mobile', width: 390, height: 844, dpr: 2, isMobile: true, hasTouch: true }),
  Object.freeze({ name: 'reflow', width: 320, height: 640, dpr: 1, isMobile: false, hasTouch: false }),
]);

/** Fields of the frontend block that have no default: they describe the project and are never guessed. */
export const REQUIRED_FIELDS = Object.freeze(['judged_surface', 'stack', 'hosting']);

const ENUMS = Object.freeze(/** @type {const} */ ({
  mode: ['full', 'small'],
  run_mode: ['A', 'B'],
  judged_surface: ['site', 'app', 'site+app', 'video', 'readme'],
  stack: ['vite-react', 'next', 'static-html', 'existing'],
  hosting: ['vercel', 'gh-pages', 'fly', 'existing', 'local'],
  review_surface: ['claude-design', 'board', 'terminal'],
  embed: ['pptx', 'key', 'mp4'],
  colorScheme: ['light', 'dark', 'no-preference'],
  reducedMotion: ['reduce', 'no-preference'],
}));

/** Used only when no profile file exists at all (a quick standalone run); a profile file must state them. */
const NEUTRAL_REQUIRED = Object.freeze({ judged_surface: 'site', stack: 'existing', hosting: 'local' });

const BLOCK_KEYS = new Set([
  'mode', 'run_mode', 'judged_surface', 'format', 'viewports', 'record_mode', 'ready_flag', 'stack', 'hosting',
  'external_requests', 'prework_designs', 'review_surface', 'critique', 'budget', 'references', 'sponsors',
  'sponsor_allowlist', 'tells', 'firstview', 'paths', 'workspace',
]);

/** Top-level keys that only an /execution profile has. */
const EXECUTION_KEYS = ['event', 'team', 'channels', 'machine', 'notion', 'phase_b', 'prework', 'freezes', 'project'];

const PATH_KEYS = /** @type {const} */ (['claims_ledger', 'never_show', 'feature_catalogue', 'spec', 'research']);

/**
 * Reads a profile and returns it complete: defaults applied, paths absolute, every field validated.
 *
 * - An /execution `profile.json` (it has a `frontend` block): the block is merged with the top-level facts it does
 *   not own. Top-level `prework` is authoritative (`frontend.prework_designs` only overrides it),
 *   `phase_b.claims_ledger` is the claims ledger, `paths.never_show` / `paths.feature_catalogue` and
 *   `workspace.private_dir` may sit at top level or in the block; two different values for one fact are an error.
 *   `run_mode` defaults to 'A'.
 * - A bare frontend block file (mode B, `.frontend/profile.json`): `run_mode` defaults to 'B'.
 * - No path: looks for `<root>/.execution/profile.json`, then `<root>/.frontend/profile.json` (root defaults to the
 *   working directory); when neither exists, returns the defaults with `source.kind = 'defaults'`.
 *
 * Relative paths inside the profile resolve against the profile file's folder. Throws UsageError listing every
 * problem: a missing required field (REQUIRED_FIELDS), a value outside its enumeration, a malformed viewport.
 * @param {string} [file]
 * @param {{root?: string}} [options]
 * @returns {Profile}
 */
export function loadProfile(file, { root } = {}) {
  const found = file ? path.resolve(file) : discoverProfile(root ?? process.cwd());
  if (!found) return resolveProfile({}, { kind: 'defaults' });
  if (!existsSync(found)) {
    throw new UsageError(
      `profile not found: ${toPosix(found)}; pass --profile with the absolute path of an /execution profile.json ` +
        'or of a frontend block file',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readText(found));
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new UsageError(`profile ${toPosix(found)} is not valid JSON (${why}); fix the file`, { cause: err });
  }
  return resolveProfile(raw, { path: found });
}

/**
 * A complete profile from defaults only, for tools that run without a project (calibration, tests). `overrides`
 * is a partial frontend block, validated like a file.
 * @param {Record<string, unknown>} [overrides]
 * @returns {Profile}
 */
export function defaultProfile(overrides = {}) {
  return resolveProfile(overrides, { kind: 'defaults' });
}

/**
 * The pure part of loadProfile: merges, applies defaults and validates an already-parsed profile object.
 * @param {unknown} raw
 * @param {{path?: string | null, kind?: 'defaults'}} [options] kind 'defaults' lets the required fields default
 * @returns {Profile}
 */
export function resolveProfile(raw, { path: file = null, kind: forcedKind } = {}) {
  const label = file ? `profile ${toPosix(file)}` : 'profile';
  if (!isObject(raw)) throw new UsageError(`${label} must be a JSON object; fix the file`);
  const isExecution = Object.hasOwn(raw, 'frontend');
  if (!isExecution && forcedKind !== 'defaults' && EXECUTION_KEYS.some((k) => Object.hasOwn(raw, k))) {
    throw new UsageError(
      `${label} looks like an /execution profile but has no "frontend" block; add one with at least ` +
        `${REQUIRED_FIELDS.join(', ')}`,
    );
  }
  const block = isExecution ? raw.frontend : raw;
  if (!isObject(block)) throw new UsageError(`${label}: "frontend" must be an object; fix the file`);
  const kind = forcedKind ?? (isExecution ? 'execution' : 'block');
  const top = isExecution ? raw : {};
  const prefix = isExecution ? 'frontend.' : '';
  const baseDir = file ? path.dirname(file) : process.cwd();
  /** @type {string[]} */
  const problems = [];
  const v = new Validator(problems, prefix);

  const mode = v.enumOf('mode', block.mode, ENUMS.mode, 'full');
  const requireFields = kind !== 'defaults';
  const required = /** @type {(key: 'judged_surface' | 'stack' | 'hosting') => string} */ (
    (key) => {
      if (block[key] === undefined || block[key] === null || block[key] === '') {
        if (requireFields) {
          problems.push(`missing required field ${prefix}${key} (one of ${ENUMS[key].join('|')})`);
        }
        return NEUTRAL_REQUIRED[key];
      }
      return v.enumOf(key, block[key], ENUMS[key], NEUTRAL_REQUIRED[key]);
    }
  );

  const paths = resolvePaths(v, block.paths, baseDir);
  const workspaceBlock = isObject(block.workspace) ? block.workspace : {};
  if (block.workspace !== undefined && block.workspace !== null && !isObject(block.workspace)) {
    problems.push(`${prefix}workspace must be an object`);
  }
  let privateDir = v.absPath('workspace.private_dir', workspaceBlock.private_dir, baseDir);
  /** @type {Prework | null} */
  let prework = null;
  /** @type {Profile['project']} */
  let project = null;
  if (isExecution) {
    const top0 = /** @type {Record<string, unknown>} */ (top);
    const topV = new Validator(problems, '');
    const topPaths = isObject(top0.paths) ? top0.paths : {};
    const phaseB = isObject(top0.phase_b) ? top0.phase_b : {};
    const topWorkspace = isObject(top0.workspace) ? top0.workspace : {};
    paths.claims_ledger = oneTruth(
      problems,
      'claims ledger',
      ['phase_b.claims_ledger', topV.absPath('phase_b.claims_ledger', phaseB.claims_ledger, baseDir)],
      [`${prefix}paths.claims_ledger`, paths.claims_ledger],
    );
    paths.never_show = oneTruth(
      problems,
      'never-show list',
      ['paths.never_show', topV.absPath('paths.never_show', topPaths.never_show, baseDir)],
      [`${prefix}paths.never_show`, paths.never_show],
    );
    paths.feature_catalogue = oneTruth(
      problems,
      'feature catalogue',
      ['paths.feature_catalogue', topV.absPath('paths.feature_catalogue', topPaths.feature_catalogue, baseDir)],
      [`${prefix}paths.feature_catalogue`, paths.feature_catalogue],
    );
    privateDir = oneTruth(
      problems,
      'private workspace',
      ['workspace.private_dir', topV.absPath('workspace.private_dir', topWorkspace.private_dir, baseDir)],
      [`${prefix}workspace.private_dir`, privateDir],
    );
    prework = resolvePrework(topV, top0.prework);
    project = resolveProject(topV, top0.project);
  }

  /** @type {Profile} */
  const profile = {
    mode,
    run_mode: v.enumOf('run_mode', block.run_mode, ENUMS.run_mode, kind === 'execution' ? 'A' : 'B'),
    judged_surface: /** @type {Profile['judged_surface']} */ (required('judged_surface')),
    format: resolveFormat(v, block.format),
    viewports: resolveViewports(v, block.viewports),
    record_mode: v.bool('record_mode', block.record_mode, false),
    ready_flag: v.bool('ready_flag', block.ready_flag, false),
    stack: /** @type {Profile['stack']} */ (required('stack')),
    hosting: /** @type {Profile['hosting']} */ (required('hosting')),
    external_requests: v.bool('external_requests', block.external_requests, false),
    prework_designs: resolvePreworkDesigns(v, block.prework_designs, prework),
    review_surface: v.enumOf('review_surface', block.review_surface, ENUMS.review_surface, 'claude-design'),
    critique: resolveCritique(v, block.critique, mode),
    budget: resolveBudget(v, block.budget),
    references: resolveReferences(v, block.references),
    sponsors: resolveSponsors(v, block.sponsors, block.sponsor_allowlist),
    tells: resolveTells(v, block.tells),
    firstview: resolveFirstview(v, block.firstview),
    paths,
    workspace: { private_dir: privateDir },
    prework,
    project,
    source: {
      path: file ? toPosix(file) : null,
      kind,
      unknown: Object.keys(block).filter((k) => !BLOCK_KEYS.has(k)).map((k) => `${prefix}${k}`),
    },
  };
  if (problems.length > 0) {
    throw new UsageError(
      `${label} has ${problems.length} problem${problems.length > 1 ? 's' : ''}: ${problems.join('; ')}; fix the profile`,
    );
  }
  return profile;
}

/**
 * @param {string} root
 * @returns {string | null}
 */
function discoverProfile(root) {
  for (const rel of ['.execution/profile.json', '.frontend/profile.json']) {
    const candidate = path.resolve(root, rel);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Accumulates problems instead of stopping at the first, so one run of the CLI lists everything to fix. */
class Validator {
  /** @param {string[]} problems @param {string} prefix */
  constructor(problems, prefix) {
    this.problems = problems;
    this.prefix = prefix;
  }

  /** @param {string} key @param {string} what */
  fail(key, what) {
    this.problems.push(`${this.prefix}${key} ${what}`);
  }

  /**
   * @template {string} T
   * @param {string} key @param {unknown} value @param {readonly T[]} allowed @param {T} fallback
   * @returns {T}
   */
  enumOf(key, value, allowed, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'string' && /** @type {readonly string[]} */ (allowed).includes(value)) {
      return /** @type {T} */ (value);
    }
    this.fail(key, `must be one of ${allowed.join('|')} (got ${JSON.stringify(value)})`);
    return fallback;
  }

  /** @param {string} key @param {unknown} value @param {boolean} fallback @returns {boolean} */
  bool(key, value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    this.fail(key, `must be true or false (got ${JSON.stringify(value)})`);
    return fallback;
  }

  /**
   * @param {string} key @param {unknown} value @param {{min?: number, integer?: boolean}} rule @param {number} fallback
   * @returns {number}
   */
  num(key, value, { min = -Infinity, integer = false }, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'number' && Number.isFinite(value) && value >= min && (!integer || Number.isInteger(value))) {
      return value;
    }
    this.fail(key, `must be ${integer ? 'an integer' : 'a number'}${min > -Infinity ? ` >= ${min}` : ''} (got ${JSON.stringify(value)})`);
    return fallback;
  }

  /** @param {string} key @param {unknown} value @param {{min?: number, integer?: boolean}} rule @returns {number | null} */
  numOrNull(key, value, rule) {
    if (value === undefined || value === null) return null;
    const n = this.num(key, value, rule, Number.NaN);
    return Number.isNaN(n) ? null : n;
  }

  /** @param {string} key @param {unknown} value @param {string} fallback @returns {string} */
  str(key, value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'string') return value;
    this.fail(key, `must be a string (got ${JSON.stringify(value)})`);
    return fallback;
  }

  /** @param {string} key @param {unknown} value @returns {string | null} */
  utc(key, value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
    this.fail(key, `must be an ISO 8601 UTC date or null (got ${JSON.stringify(value)})`);
    return null;
  }

  /**
   * A path field: null when unset or empty, else absolute (relative paths resolve against the profile's folder),
   * with forward slashes.
   * @param {string} key @param {unknown} value @param {string} baseDir @returns {string | null}
   */
  absPath(key, value, baseDir) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') {
      this.fail(key, `must be a path string or null (got ${JSON.stringify(value)})`);
      return null;
    }
    return toPosix(path.resolve(baseDir, value));
  }
}

/**
 * @param {string[]} problems
 * @param {string} fact
 * @param {[string, string | null]} a
 * @param {[string, string | null]} b
 * @returns {string | null}
 */
function oneTruth(problems, fact, [whereA, valueA], [whereB, valueB]) {
  if (valueA && valueB && samePath(valueA, valueB) === false) {
    problems.push(`two different ${fact} paths (${whereA}=${valueA}, ${whereB}=${valueB}); keep one`);
  }
  return valueA ?? valueB;
}

/**
 * @param {string} a @param {string} b @returns {boolean}
 */
function samePath(a, b) {
  const norm = (/** @type {string} */ p) => {
    const n = toPosix(path.resolve(p));
    return process.platform === 'win32' ? n.toLowerCase() : n;
  };
  return norm(a) === norm(b);
}

/**
 * @param {Validator} v @param {unknown} raw @param {string} baseDir @returns {ProfilePaths}
 */
function resolvePaths(v, raw, baseDir) {
  if (raw !== undefined && raw !== null && !isObject(raw)) v.fail('paths', 'must be an object');
  const obj = isObject(raw) ? raw : {};
  const design = v.str('paths.design', obj.design, 'design');
  if (design.trim() === '') v.fail('paths.design', 'must not be empty');
  /** @type {ProfilePaths} */
  const out = { design, claims_ledger: null, never_show: null, feature_catalogue: null, spec: null, research: null, ui: null };
  for (const key of PATH_KEYS) out[key] = v.absPath(`paths.${key}`, obj[key], baseDir);
  out.ui = uiPaths(v, obj.ui);
  return out;
}

/**
 * `paths.ui`: null, or a non-empty list of repository-relative paths (forward slashes, no '..', not absolute).
 * @param {Validator} v @param {unknown} raw @returns {string[] | null}
 */
function uiPaths(v, raw) {
  if (raw === undefined || raw === null) return null;
  const list = typeof raw === 'string' ? [raw] : raw;
  if (!Array.isArray(list) || list.length === 0) {
    v.fail('paths.ui', 'must be a non-empty list of repository-relative paths, or null for the whole repository');
    return null;
  }
  /** @type {string[]} */
  const out = [];
  for (const item of list) {
    const p = typeof item === 'string' ? item.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') : '';
    if (p === '' || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..')) {
      v.fail('paths.ui', `${JSON.stringify(item)} must be a repository-relative path without '..'`);
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * @param {Validator} v @param {unknown} raw @returns {Format}
 */
function resolveFormat(v, raw) {
  if (raw !== undefined && raw !== null && !isObject(raw)) v.fail('format', 'must be an object');
  const obj = isObject(raw) ? raw : {};
  /** @type {VideoFormat | null} */
  let video = null;
  if (obj.video !== undefined && obj.video !== null && obj.video !== false) {
    if (!isObject(obj.video)) {
      v.fail('format.video', 'must be an object or null');
    } else {
      video = {
        max_s: v.num('format.video.max_s', obj.video.max_s, { min: 1 }, 180),
        width: v.num('format.video.width', obj.video.width, { min: 1, integer: true }, 1920),
        height: v.num('format.video.height', obj.video.height, { min: 1, integer: true }, 1080),
        embed: v.enumOf('format.video.embed', obj.video.embed, /** @type {const} */ (['pptx', 'key', 'mp4']), 'mp4'),
      };
    }
  }
  return {
    stage: v.bool('format.stage', obj.stage, false),
    projector_zoom: v.num('format.projector_zoom', obj.projector_zoom, { min: 0.25 }, 1.25),
    video,
    async_readme: v.bool('format.async_readme', obj.async_readme, false),
  };
}

/**
 * @param {Validator} v @param {unknown} raw @returns {Viewport[]}
 */
function resolveViewports(v, raw) {
  if (raw === undefined || raw === null) return DEFAULT_VIEWPORTS.map((vp) => ({ ...vp }));
  if (!Array.isArray(raw) || raw.length === 0) {
    v.fail('viewports', 'must be a non-empty array of {name, width, height}');
    return DEFAULT_VIEWPORTS.map((vp) => ({ ...vp }));
  }
  /** @type {Viewport[]} */
  const out = [];
  const names = new Set();
  raw.forEach((item, i) => {
    const key = `viewports[${i}]`;
    if (!isObject(item)) {
      v.fail(key, 'must be an object {name, width, height}');
      return;
    }
    for (const field of ['name', 'width', 'height']) {
      if (item[field] === undefined || item[field] === null) {
        v.problems.push(`missing required field ${v.prefix}${key}.${field}`);
      }
    }
    const name = v.str(`${key}.name`, item.name, '');
    if (item.name !== undefined && name.trim() === '') v.fail(`${key}.name`, 'must not be empty');
    if (name && names.has(name)) v.fail(`${key}.name`, `duplicates the viewport name "${name}"`);
    names.add(name);
    /** @type {Viewport} */
    const vp = {
      name,
      width: v.num(`${key}.width`, item.width, { min: 1, integer: true }, 0),
      height: v.num(`${key}.height`, item.height, { min: 1, integer: true }, 0),
      dpr: v.num(`${key}.dpr`, item.dpr, { min: 0.25 }, 1),
      isMobile: v.bool(`${key}.isMobile`, item.isMobile, false),
      hasTouch: v.bool(`${key}.hasTouch`, item.hasTouch, false),
    };
    if (item.colorScheme !== undefined) {
      vp.colorScheme = v.enumOf(`${key}.colorScheme`, item.colorScheme, /** @type {const} */ (['light', 'dark', 'no-preference']), 'light');
    }
    if (item.reducedMotion !== undefined) {
      vp.reducedMotion = v.enumOf(`${key}.reducedMotion`, item.reducedMotion, /** @type {const} */ (['reduce', 'no-preference']), 'no-preference');
    }
    out.push(vp);
  });
  return out;
}

/**
 * @param {Validator} v @param {unknown} raw @param {'full' | 'small'} mode
 * @returns {Profile['critique']}
 */
function resolveCritique(v, raw, mode) {
  if (raw !== undefined && raw !== null && !isObject(raw)) v.fail('critique', 'must be an object');
  const obj = isObject(raw) ? raw : {};
  return {
    rounds_max: v.num('critique.rounds_max', obj.rounds_max, { min: 0, integer: true }, mode === 'small' ? 1 : 3),
    critics: v.num('critique.critics', obj.critics, { min: 1, integer: true }, 3),
    probes: v.num('critique.probes', obj.probes, { min: 0, integer: true }, 5),
  };
}

/**
 * @param {Validator} v @param {unknown} raw @returns {Profile['budget']}
 */
function resolveBudget(v, raw) {
  if (raw !== undefined && raw !== null && !isObject(raw)) v.fail('budget', 'must be an object');
  const obj = isObject(raw) ? raw : {};
  return {
    ui_hours: v.numOrNull('budget.ui_hours', obj.ui_hours, { min: 0 }),
    tokens: v.numOrNull('budget.tokens', obj.tokens, { min: 0 }),
  };
}

/**
 * @param {Validator} v @param {unknown} raw @returns {Reference[]}
 */
function resolveReferences(v, raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    v.fail('references', 'must be an array of {customer, url, source, owner_confirmed}');
    return [];
  }
  return raw.flatMap((item, i) => {
    const key = `references[${i}]`;
    if (!isObject(item)) {
      v.fail(key, 'must be an object {customer, url, source, owner_confirmed}');
      return [];
    }
    return [{
      customer: v.str(`${key}.customer`, item.customer, ''),
      url: v.str(`${key}.url`, item.url, ''),
      source: v.str(`${key}.source`, item.source, ''),
      owner_confirmed: v.bool(`${key}.owner_confirmed`, item.owner_confirmed, false),
    }];
  });
}

/**
 * Sponsor ids. /execution's block may name the field `sponsor_allowlist` (its ARCHITECTURE 4.3) and may hold the
 * full FD21 entries there; only their ids are taken, the entries themselves come from assets/sponsor-allowlist.json.
 * @param {Validator} v @param {unknown} sponsors @param {unknown} alias @returns {string[]}
 */
function resolveSponsors(v, sponsors, alias) {
  const key = sponsors !== undefined && sponsors !== null ? 'sponsors' : 'sponsor_allowlist';
  const raw = sponsors !== undefined && sponsors !== null ? sponsors : alias;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    v.fail(key, 'must be an array of sponsor ids');
    return [];
  }
  /** @type {string[]} */
  const ids = [];
  raw.forEach((item, i) => {
    let id = null;
    if (typeof item === 'string') id = item;
    else if (isObject(item) && typeof item.sponsor === 'string') id = item.sponsor;
    else if (isObject(item) && typeof item.id === 'string') id = item.id;
    if (!id || id.trim() === '') v.fail(`${key}[${i}]`, 'must be a sponsor id string');
    else if (!ids.includes(id.trim().toLowerCase())) ids.push(id.trim().toLowerCase());
  });
  return ids;
}

/**
 * @param {Validator} v @param {unknown} raw @returns {Profile['tells']}
 */
function resolveTells(v, raw) {
  if (raw !== undefined && raw !== null && !isObject(raw)) v.fail('tells', 'must be an object');
  const obj = isObject(raw) ? raw : {};
  return { score_max: v.numOrNull('tells.score_max', obj.score_max, { min: 0 }) };
}

/**
 * `firstview.complexity`, the band firstview.complexity compares the first viewport with: min_kib and max_kib required
 * (min at most max), the measuring settings optional. Absent means the calibration file or the provisional band.
 * @param {Validator} v @param {unknown} raw @returns {{complexity: FirstviewBand | null}}
 */
function resolveFirstview(v, raw) {
  if (raw === undefined || raw === null) return { complexity: null };
  if (!isObject(raw)) {
    v.fail('firstview', 'must be an object');
    return { complexity: null };
  }
  const c = raw.complexity;
  if (c === undefined || c === null) return { complexity: null };
  if (!isObject(c)) {
    v.fail('firstview.complexity', 'must be an object {min_kib, max_kib, ...}');
    return { complexity: null };
  }
  const min = v.num('firstview.complexity.min_kib', c.min_kib ?? Number.NaN, { min: 0 }, 0);
  const max = v.num('firstview.complexity.max_kib', c.max_kib ?? Number.NaN, { min: 0 }, 0);
  if (min > max) v.fail('firstview.complexity', `min_kib ${min} is above max_kib ${max}`);
  /** @type {FirstviewBand} */
  const band = { min_kib: min, max_kib: max };
  if (c.width !== undefined) band.width = v.num('firstview.complexity.width', c.width, { min: 1, integer: true }, 1440);
  if (c.height !== undefined) band.height = v.num('firstview.complexity.height', c.height, { min: 1, integer: true }, 900);
  if (c.dpr !== undefined) band.dpr = v.num('firstview.complexity.dpr', c.dpr, { min: 0.1 }, 1);
  if (c.quality !== undefined) band.quality = v.num('firstview.complexity.quality', c.quality, { min: 1, integer: true }, 70);
  if (c.calibrated !== undefined) band.calibrated = v.bool('firstview.complexity.calibrated', c.calibrated, false);
  if (c.source !== undefined) band.source = v.str('firstview.complexity.source', c.source, '');
  return { complexity: band };
}

/**
 * Top-level `prework` of an /execution profile. `designs` and `code` accept booleans or the words
 * allowed/forbidden, yes/no.
 * @param {Validator} v @param {unknown} raw @returns {Prework | null}
 */
function resolvePrework(v, raw) {
  if (raw === undefined || raw === null) return null;
  if (!isObject(raw)) {
    v.fail('prework', 'must be an object {code, designs, until_utc}');
    return null;
  }
  return {
    code: allowance(v, 'prework.code', raw.code),
    designs: allowance(v, 'prework.designs', raw.designs),
    until_utc: v.utc('prework.until_utc', raw.until_utc),
  };
}

/**
 * @param {Validator} v @param {string} key @param {unknown} value @returns {boolean | null}
 */
function allowance(v, key, value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const word = value.trim().toLowerCase();
    if (['allowed', 'allow', 'yes', 'true'].includes(word)) return true;
    if (['forbidden', 'forbid', 'no', 'false', 'none'].includes(word)) return false;
  }
  v.fail(key, `must be true, false, "allowed" or "forbidden" (got ${JSON.stringify(value)})`);
  return null;
}

/**
 * @param {Validator} v @param {unknown} raw @param {Prework | null} prework
 * @returns {Profile['prework_designs']}
 */
function resolvePreworkDesigns(v, raw, prework) {
  if (raw !== undefined && raw !== null) {
    if (!isObject(raw)) {
      v.fail('prework_designs', 'must be an object {allowed, until_utc}');
    } else {
      return {
        allowed: v.bool('prework_designs.allowed', raw.allowed, prework?.designs ?? true),
        until_utc: raw.until_utc === undefined ? prework?.until_utc ?? null : v.utc('prework_designs.until_utc', raw.until_utc),
      };
    }
  }
  return { allowed: prework?.designs ?? true, until_utc: prework?.until_utc ?? null };
}

/**
 * @param {Validator} v @param {unknown} raw @returns {Profile['project']}
 */
function resolveProject(v, raw) {
  if (raw === undefined || raw === null) return null;
  if (!isObject(raw)) {
    v.fail('project', 'must be an object');
    return null;
  }
  const name = raw.name === undefined || raw.name === null ? null : v.str('project.name', raw.name, '');
  const confirmed = raw.name_owner_confirmed;
  return {
    name,
    name_owner_confirmed: confirmed === undefined || confirmed === null ? null : v.bool('project.name_owner_confirmed', confirmed, false),
  };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string} p
 * @returns {string}
 */
function toPosix(p) {
  return p.replace(/\\/g, '/');
}
