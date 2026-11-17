// @ts-check
/**
 * critique.mjs: the deterministic half of /frontend's critique stage (ARCHITECTURE.md section 6, research FD17).
 *
 * prepare   DOM-marked viewport tiles at 1440x900 and 390x844 (DPR 2, animations disabled), marks.json, checklist.json,
 *           squint tiles blurred at 5, 10 and 20 px, the deterministic measurements and the critic task file.
 * measure   prepare plus the build-phase gates, the deterministic sub-scores and the git state: the object the
 *           feCritique fragment reads (assets/schemas/fragment-commands.schema.json, $defs.measure).
 * issues    the issues one round keeps: raised by two critics, or confirmed by a check on the same mark; at most five.
 * accept    the acceptance rule: no gate regresses, no deterministic sub-score drops, and the pairwise judge prefers the
 *           candidate in both orders; writes the round receipt and moves the best-so-far.
 * probes    the blind probe pass: at least 4 of 5 readers restate the proposition on every viewport.
 * ui-copy   the rendered text of every route as Markdown for /prose.
 * --verify-receipt <file>   the FE-20 proof: schema, checksum, ok, and the measured UI tree still in HEAD.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli, isMainModule } from './lib/args.mjs';
import { launch, withPage } from './lib/browser.mjs';
import { contrastRatio, parseColor } from './lib/color.mjs';
import { collectElements, collectText } from './lib/dom.mjs';
import { EnvError, FrontendError, UsageError, exitWith } from './lib/errors.mjs';
import { readText, toPosix, writeText } from './lib/fsutil.mjs';
import { designDir, stateDir } from './lib/paths.mjs';
import { loadProfile } from './lib/profile.mjs';
import { utcSeconds } from './lib/report.mjs';
import { loadRoutes, routeUrl } from './lib/routes.mjs';
import { serveStatic } from './lib/serve.mjs';
import { normaliseText } from './lib/text.mjs';
import { startServer } from './frontend-check.mjs';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('playwright-core').Page} Page
 * @typedef {import('./lib/profile.mjs').Profile} Profile
 * @typedef {import('./lib/routes.mjs').Route} Route
 * @typedef {import('./lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {import('./lib/dom.mjs').TextInfo} TextInfo
 * @typedef {import('./lib/dom.mjs').Box} Box
 * @typedef {import('./lib/report.mjs').GateReport} GateReport
 * @typedef {import('./lib/report.mjs').GateResult} GateResult
 *
 * @typedef {{name: string, width: number, height: number, dpr: number, isMobile: boolean, hasTouch: boolean}} CaptureViewport
 * @typedef {{id: string, title: string, status: string, group: string}} BriefFeature
 * @typedef {{projectName: string, h1: string, sentence: string, sponsors: string[], customers: string[],
 *   features: BriefFeature[], raw: Record<string, unknown>, path: string}} BriefInfo
 * @typedef {{box: Box, visible: boolean, styles: Record<string, string>, metrics: Record<string, number | string | boolean>}} MarkView
 * @typedef {{id: string, route: string, routeName: string, selector: string, kind: string, kinds: string[], tag: string,
 *   role: string, text: string, attrs: Record<string, string>, views: Record<string, MarkView>, tiles: string[]}} Mark
 * @typedef {{el: number, kind: string, check: string, item: string, problem: string, fix: string, value: string | number}} ProblemDraft
 * @typedef {{mark: string, check: string, item: string, problem: string, fix: string, route: string, viewport: string,
 *   selector: string, value: string | number}} Problem
 * @typedef {{dim: string, sub: string, ok: boolean}} ScoreItem
 * @typedef {{id: string, found: boolean, ok: boolean, el: number, missing: string[]}} FeatureResult
 * @typedef {{kinds: Map<number, Set<string>>, items: ScoreItem[], problems: ProblemDraft[], notes: string[],
 *   layoutIssues: number, features: FeatureResult[]}} PageAnalysis
 * @typedef {{viewport: string, route: string, route_name: string, index: number, scroll_y: number, path: string,
 *   marked: string, marks: string[]}} Tile
 * @typedef {{viewport: string, radius: number, path: string}} SquintTile
 * @typedef {{id: string, section: string, item: string, how: string, source: string, marks: string[], evidence: string[]}} ChecklistItem
 * @typedef {{dir: string, tiles: Tile[], squint: SquintTile[], first_view: Record<string, string>, marks: Mark[],
 *   problems: Problem[], notes: string[], scores: Record<string, number>, checklist: ChecklistItem[], checklistMarkdown: string,
 *   skipped: string[], proposition: string, url: string, viewports: CaptureViewport[]}} CaptureResult
 * @typedef {{ok: boolean, counts: {ok: number, fail: number, skipped: number}, failing: string[]}} GateSummary
 * @typedef {{round: number, sha: string, ui_tree: string, gates: GateSummary, scores: Record<string, number>}} Snapshot
 * @typedef {{key: string, mark: string, category: string, item: string, problem: string, fix: string, votes: number,
 *   confirmed: boolean}} KeptIssue
 * @typedef {{ab: string | null, ba: string | null, consistent: boolean}} Pairwise
 * @typedef {import('./lib/args.mjs').CliValues<typeof OPTIONS>} CliOptions
 */

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(SCRIPTS_DIR, '..');
const CHECKLIST_TEMPLATE = path.join(SKILL_DIR, 'assets', 'templates', 'critique-checklist.md');
const RECEIPT_SCHEMA = path.join(SKILL_DIR, 'assets', 'schemas', 'critique-receipt.schema.json');
const CRITIC_SCHEMA = path.join(SKILL_DIR, 'assets', 'schemas', 'critic-output.schema.json');
const PROBE_SCHEMA = path.join(SKILL_DIR, 'assets', 'schemas', 'probe-output.schema.json');
const DEFAULT_CHECKER = path.join(SCRIPTS_DIR, 'frontend-check.mjs');

/** The two capture viewports of ARCHITECTURE section 6 (FD15-F20 mockup sizes, FD06-F13 image limits). */
export const CAPTURE_VIEWPORTS = Object.freeze([
  Object.freeze({ name: 'desktop', width: 1440, height: 900, dpr: 1, isMobile: false, hasTouch: false }),
  Object.freeze({ name: 'mobile', width: 390, height: 844, dpr: 2, isMobile: true, hasTouch: true }),
]);
/** NN/g's illustrative squint radii (FD17-F18), in CSS px; uncalibrated. */
export const SQUINT_RADII = Object.freeze([5, 10, 20]);
/** A pairwise call reads two versions' tiles, so ten per version keeps every critic call at 20 images or fewer (FD06-F13). */
export const MAX_TILES = 10;
export const MAX_IMAGES_PER_CALL = 20;
/** Claude 4.7+ high-resolution tier: longest image edge before downscaling (FD17-F04). */
export const MAX_LONG_EDGE = 2576;
export const TILE_MARK_CAP = 40;
export const MAX_ISSUES = 5;
/** A first fix and two retries per issue (CR-09). */
export const MAX_ATTEMPTS = 3;
export const ISSUE_CATEGORIES = Object.freeze(['first-view', 'feature-proof', 'hierarchy', 'layout', 'typography', 'contrast', 'copy', 'states', 'motion', 'brand', 'other']);

/**
 * Thresholds of the deterministic sub-scores. Typography and contrast carry an external source (FD17-F22 USWDS,
 * FD17-F23 WCAG 2.2); the layout ones are FD17 Deliverable A's provisional values, to calibrate on the corpora.
 */
export const THRESHOLDS = Object.freeze({
  bodyMinPx: 16,
  bodyWords: 12,
  measureMin: 45,
  measureMax: 90,
  bodyLineHeight: 1.5,
  headingLineHeightMin: 1,
  headingLineHeightMax: 1.35,
  contrastText: 4.5,
  contrastLarge: 3,
  targetMin: 24,
  nearMissMin: 3,
  nearMissMax: 6,
  gapCvMax: 0.15,
  sectionPaddingsMax: 3,
  layoutPenalty: 20,
});

const MARKER_ATTRS = Object.freeze(['data-feature', 'data-hero', 'data-surface', 'data-metric', 'data-proof', 'data-status', 'data-ledger', 'data-source', 'data-concept-label']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'tab', 'checkbox', 'radio', 'switch', 'menuitem', 'option', 'combobox', 'textbox', 'searchbox', 'slider', 'spinbutton']);
const IMAGE_TAGS = new Set(['img', 'svg', 'video', 'canvas']);
const BODY_EXEMPT_TAGS = new Set(['table', 'pre', 'code', 'figcaption', 'small', 'footer', 'nav', 'caption', 'kbd', 'samp']);
/** Text flows set their own spacing (a caption close to its figure is proximity), so gap variance skips them. */
const TEXT_FLOW_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'label', 'small', 'strong', 'em', 'b', 'i', 'blockquote', 'pre', 'code', 'figcaption', 'dt', 'dd', 'br', 'hr']);
/** @type {Record<string, number>} */
const KIND_PRIORITY = { marker: 0, heading: 1, interactive: 2, image: 3, text: 4, group: 5, section: 6 };
const KEY_STYLES = Object.freeze(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform', 'textAlign', 'color', 'backgroundColor', 'borderRadius', 'marginTop', 'marginBottom', 'gap']);
const FE_ATTRS = Object.freeze(['data-fe-lines', 'data-fe-cpl', 'data-fe-lh', 'data-fe-words', 'data-fe-hlines', 'data-fe-last', 'data-fe-hwords', 'data-fe-clip', 'data-fe-inline']);

/** Checklist item each deterministic check informs (assets/templates/critique-checklist.md). */
const CHECK_ITEMS = Object.freeze(/** @type {Record<string, string>} */ ({
  'typography.body-size': 'T1',
  'typography.measure': 'T1',
  'typography.line-height': 'T1',
  'typography.heading-line-height': 'T1',
  'typography.orphan': 'T2',
  'contrast.text': 'C1',
  'layout.near-miss': 'L1',
  'layout.gap-variance': 'L2',
  'layout.section-padding': 'L2',
  'layout.clipped': 'L3',
  'first-view.h1': 'FV1',
  'first-view.sentence': 'FV2',
  'first-view.product': 'FV3',
  'first-view.figure': 'FV4',
  'first-view.sponsor': 'FV5',
}));

// ------------------------------------------------------------------------------------------------ small helpers

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function str(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * @param {number} x
 * @returns {number}
 */
function round1(x) {
  return Math.round(x * 10) / 10;
}

/**
 * @param {string | undefined} value
 * @param {number} [fallback]
 * @returns {number}
 */
function num(value, fallback = 0) {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Text compared the way a reader compares it: NFKC, collapsed whitespace, case-insensitive (CSS text-transform changes
 * innerText), trailing punctuation ignored.
 * @param {string} s
 * @returns {string}
 */
export function sameTextKey(s) {
  return normaliseText(s).toLowerCase().replace(/[\s.!?:;,]+$/, '');
}

/**
 * @param {string} file
 * @param {string} what
 * @returns {unknown}
 */
function readJson(file, what) {
  const abs = path.resolve(file);
  if (!existsSync(abs)) throw new UsageError(`${what} not found: ${toPosix(abs)}; check the path`);
  try {
    return JSON.parse(readText(abs));
  } catch (err) {
    throw new UsageError(`${what} ${toPosix(abs)} is not valid JSON (${err instanceof Error ? err.message : String(err)}); fix or regenerate it`, { cause: err });
  }
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
 * @param {string} file
 * @param {Buffer} data
 * @returns {string}
 */
function writeBinary(file, data) {
  const abs = path.resolve(file);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  return toPosix(abs);
}

/**
 * @param {string} name
 * @returns {string}
 */
function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'route';
}

/**
 * @param {string} message
 */
function logLine(message) {
  process.stderr.write(`critique: ${message}\n`);
}

/**
 * FNV-1a 32-bit over UTF-16 code units, as assets/wave-fragments/critique.js seals its receipt.
 * @param {string} s
 * @returns {string}
 */
export function fnv1a32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `00000000${h.toString(16)}`.slice(-8);
}

/**
 * The checksum a receipt carries: JSON.stringify of the receipt without its checksum key, keys in written order.
 * @param {Record<string, unknown>} receipt
 * @returns {string}
 */
export function receiptChecksum(receipt) {
  /** @type {Record<string, unknown>} */
  const unsealed = {};
  for (const key of Object.keys(receipt)) if (key !== 'checksum') unsealed[key] = receipt[key];
  return `fnv1a32:${fnv1a32(JSON.stringify(unsealed))}`;
}

// ------------------------------------------------------------------------------------------------ JSON schema subset

/**
 * Validates `value` against the JSON Schema subset the skill's schemas use (type, const, enum, required, properties,
 * additionalProperties, items, min/maxItems, minimum, maximum, min/maxLength, pattern, minProperties, $ref to
 * #/$defs, allOf, anyOf, oneOf, if/then/else). Returns one message per violation; [] when valid.
 * @param {unknown} schema
 * @param {unknown} value
 * @param {unknown} [root]
 * @param {string} [at]
 * @returns {string[]}
 */
export function validateSchema(schema, value, root = schema, at = '$') {
  if (schema === true || schema === undefined) return [];
  if (schema === false) return [`${at}: no value is allowed here`];
  if (!isObject(schema)) return [`${at}: invalid schema node`];
  if (typeof schema.$ref === 'string') return validateSchema(resolveRef(root, schema.$ref), value, root, at);
  /** @type {string[]} */
  const errors = [];
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(String(t), value))) {
      errors.push(`${at}: expected ${types.join(' or ')}, got ${jsonType(value)}`);
      return errors;
    }
  }
  if ('const' in schema && !deepEqual(schema.const, value)) errors.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => deepEqual(e, value))) {
    errors.push(`${at}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && [...value].length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (typeof schema.maxLength === 'number' && [...value].length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength}`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${at}: does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${at}: below ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${at}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} items`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errors.push(`${at}: more than ${schema.maxItems} items`);
    if (schema.items !== undefined) value.forEach((item, i) => errors.push(...validateSchema(schema.items, item, root, `${at}[${i}]`)));
  }
  if (isObject(value)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) if (!Object.hasOwn(value, String(key))) errors.push(`${at}: missing ${String(key)}`);
    }
    if (typeof schema.minProperties === 'number' && Object.keys(value).length < schema.minProperties) errors.push(`${at}: fewer than ${schema.minProperties} properties`);
    const props = isObject(schema.properties) ? schema.properties : {};
    for (const [key, sub] of Object.entries(value)) {
      if (Object.hasOwn(props, key)) errors.push(...validateSchema(props[key], sub, root, `${at}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${at}: unexpected property ${key}`);
      else if (isObject(schema.additionalProperties)) errors.push(...validateSchema(schema.additionalProperties, sub, root, `${at}.${key}`));
    }
  }
  if (Array.isArray(schema.allOf)) for (const sub of schema.allOf) errors.push(...validateSchema(sub, value, root, at));
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((sub) => validateSchema(sub, value, root, at).length === 0)) {
    errors.push(`${at}: matches none of anyOf`);
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((sub) => validateSchema(sub, value, root, at).length === 0).length;
    if (matches !== 1) errors.push(`${at}: matches ${matches} of oneOf, expected exactly 1`);
  }
  if (schema.if !== undefined) {
    const branch = validateSchema(schema.if, value, root, at).length === 0 ? schema.then : schema.else;
    if (branch !== undefined) errors.push(...validateSchema(branch, value, root, at));
  }
  return errors;
}

/**
 * @param {unknown} root
 * @param {string} ref
 * @returns {unknown}
 */
function resolveRef(root, ref) {
  if (!ref.startsWith('#')) throw new EnvError(`schema reference ${ref} is not local; only #/... references are supported`);
  /** @type {unknown} */
  let node = root;
  for (const token of ref.slice(1).split('/').filter(Boolean)) {
    if (!isObject(node)) throw new EnvError(`schema reference ${ref} does not resolve`);
    node = node[token.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  if (node === undefined) throw new EnvError(`schema reference ${ref} does not resolve`);
  return node;
}

/**
 * @param {string} type
 * @param {unknown} value
 * @returns {boolean}
 */
function typeMatches(type, value) {
  switch (type) {
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isObject(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    default:
      return typeof value === type;
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ao = /** @type {Record<string, unknown>} */ (a);
  const bo = /** @type {Record<string, unknown>} */ (b);
  const keys = Object.keys(ao);
  return keys.length === Object.keys(bo).length && keys.every((k) => Object.hasOwn(bo, k) && deepEqual(ao[k], bo[k]));
}

/**
 * @param {string} file
 * @returns {Record<string, unknown>}
 */
function loadSchema(file) {
  const raw = readJson(file, 'schema');
  if (!isObject(raw)) throw new EnvError(`schema ${toPosix(file)} is not a JSON object; restore the skill's assets`);
  return raw;
}

// ------------------------------------------------------------------------------------------------ brief and checklist

/**
 * Reads <state>/brief.json (CONTRACTS 6.4). With requireHero, a missing hero.h1 or hero.sentence is a UsageError: the
 * proposition and the first-screen items of the checklist come from them.
 * @param {string} state
 * @param {{requireHero?: boolean}} [options]
 * @returns {BriefInfo}
 */
export function loadBrief(state, { requireHero = true } = {}) {
  const file = path.join(state, 'brief.json');
  if (!existsSync(file)) {
    throw new UsageError(`brief not found: ${toPosix(file)}; run brief.mjs first (FE-00) or pass --state with the folder that holds brief.json`);
  }
  const raw = readJson(file, 'brief');
  if (!isObject(raw)) throw new UsageError(`brief ${toPosix(file)} must be a JSON object (CONTRACTS 6.4)`);
  const hero = isObject(raw.hero) ? raw.hero : {};
  const project = isObject(raw.project) ? raw.project : {};
  const h1 = normaliseText(str(hero.h1));
  const sentence = normaliseText(str(hero.sentence));
  if (requireHero && (!h1 || !sentence)) {
    throw new UsageError(`brief ${toPosix(file)} has no hero.h1 or hero.sentence; the critique needs the proposition, fill it in the brief first`);
  }
  const sponsors = Array.isArray(raw.sponsors) ? raw.sponsors.filter(isObject).map((s) => normaliseText(str(s.name))).filter(Boolean) : [];
  const customers = Array.isArray(raw.customers) ? raw.customers.filter(isObject).map((c) => normaliseText(str(c.name))).filter(Boolean) : [];
  const features = Array.isArray(raw.features)
    ? raw.features.filter(isObject).filter((f) => typeof f.id === 'string' && f.id).map((f) => ({
      id: str(f.id),
      title: normaliseText(str(f.title)),
      status: str(f.status),
      group: str(f.group),
    }))
    : [];
  return { projectName: normaliseText(str(project.name)), h1, sentence, sponsors, customers, features, raw, path: toPosix(file) };
}

/**
 * The brief's one-line proposition: the H1 and the sentence.
 * @param {BriefInfo} brief
 * @returns {string}
 */
export function proposition(brief) {
  if (!brief.h1) return brief.sentence;
  if (!brief.sentence) return brief.h1;
  return /[.!?:]$/.test(brief.h1) ? `${brief.h1} ${brief.sentence}` : `${brief.h1}. ${brief.sentence}`;
}

/**
 * Renders a template in the critique-checklist.md syntax: the leading HTML comment is dropped, `{{a.b}}` is a value of
 * `data`, and a line holding only `{{#each list}}` repeats the lines up to `{{/each}}` once per item of `data.list`,
 * where `{{this.field}}` is a field of the item. Values are made safe for a Markdown table cell.
 * @param {string} template
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
export function renderTemplate(template, data) {
  const body = template.replace(/^\s*<!--[\s\S]*?-->\s*/, '');
  const lines = body.split(/\r?\n/);
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^\s*\{\{#each\s+([\w.]+)\s*\}\}\s*$/.exec(lines[i]);
    if (!open) {
      out.push(fillPlaceholders(lines[i], data, undefined));
      continue;
    }
    let close = i + 1;
    while (close < lines.length && !/^\s*\{\{\/each\}\}\s*$/.test(lines[close])) close += 1;
    if (close >= lines.length) throw new EnvError(`template block {{#each ${open[1]}}} has no {{/each}}; fix the template`);
    const block = lines.slice(i + 1, close);
    const list = lookup(data, open[1]);
    if (Array.isArray(list)) for (const item of list) for (const line of block) out.push(fillPlaceholders(line, data, item));
    i = close;
  }
  return out.join('\n');
}

/**
 * @param {string} line
 * @param {Record<string, unknown>} data
 * @param {unknown} item
 * @returns {string}
 */
function fillPlaceholders(line, data, item) {
  return line.replace(/\{\{\s*(this\.)?([\w.]+)\s*\}\}/g, (_m, self, key) => cellText(lookup(self ? item : data, key)));
}

/**
 * @param {unknown} source
 * @param {string} dotted
 * @returns {unknown}
 */
function lookup(source, dotted) {
  /** @type {unknown} */
  let node = source;
  for (const part of dotted.split('.')) {
    if (!isObject(node)) return undefined;
    node = node[part];
  }
  return node;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cellText(value) {
  if (value === undefined || value === null) return '';
  return normaliseText(String(value)).replace(/\|/g, '\\|');
}

/**
 * The checklist items of a rendered checklist: every table row `| id | item | how | source |` under a `## ` heading.
 * @param {string} markdown
 * @returns {ChecklistItem[]}
 */
export function parseChecklist(markdown) {
  /** @type {ChecklistItem[]} */
  const items = [];
  let section = '';
  for (const line of markdown.split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      section = heading[1];
      continue;
    }
    if (!/^\s*\|/.test(line)) continue;
    const cells = splitRow(line);
    if (cells.length < 2 || /^-+$/.test(cells[0].replace(/:/g, '')) || cells[0].toLowerCase() === 'id') continue;
    items.push({ id: cells[0], section, item: cells[1] ?? '', how: cells[2] ?? '', source: cells[3] ?? '', marks: [], evidence: [] });
  }
  return items;
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function splitRow(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  /** @type {string[]} */
  const cells = [];
  let current = '';
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === '\\' && inner[i + 1] === '|') {
      current += '|';
      i += 1;
    } else if (inner[i] === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += inner[i];
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * The checklist of assets/templates/critique-checklist.md rendered from the brief.
 * @param {BriefInfo} brief
 * @param {string} [templateFile]
 * @returns {{markdown: string, items: ChecklistItem[]}}
 */
export function buildChecklist(brief, templateFile = CHECKLIST_TEMPLATE) {
  if (!existsSync(templateFile)) throw new EnvError(`checklist template missing: ${toPosix(templateFile)}; restore the skill's assets`);
  const data = { ...brief.raw, project: { ...(isObject(brief.raw.project) ? brief.raw.project : {}), name: brief.projectName || 'this project' } };
  const markdown = renderTemplate(readText(templateFile), data);
  return { markdown, items: parseChecklist(markdown) };
}

// ------------------------------------------------------------------------------------------------ viewports

/**
 * The capture viewports: the profile's `desktop` and `mobile` entries when it names them, else 1440x900 and 390x844
 * at DPR 2. The device pixel ratio is lowered when a tile would exceed the critic's 2576 px long edge.
 * @param {Pick<Profile, 'viewports'>} profile
 * @returns {CaptureViewport[]}
 */
export function captureViewports(profile) {
  const byName = new Map((profile?.viewports ?? []).map((v) => [v.name, v]));
  return CAPTURE_VIEWPORTS.map((def) => {
    const v = byName.get(def.name) ?? def;
    const longest = Math.max(v.width, v.height);
    const dpr = Math.min(v.dpr || 1, Math.floor((MAX_LONG_EDGE / longest) * 100) / 100);
    return { name: def.name, width: v.width, height: v.height, dpr, isMobile: Boolean(v.isMobile), hasTouch: Boolean(v.hasTouch) };
  });
}

/**
 * Tiles worth taking on a page `height` px tall: the first viewport, then one more per viewport of scroll while at
 * least a quarter of a viewport of new content remains.
 * @param {number} height
 * @param {number} vh
 * @returns {number}
 */
export function tilesFor(height, vh) {
  if (!(height > vh)) return 1;
  let n = 1;
  while (height - n * vh >= 0.25 * vh) n += 1;
  return n;
}

/**
 * Spreads `budget` tiles over pages breadth first: every first view, then every second tile, and so on.
 * @param {Array<{key: string, height: number, vh: number}>} pages in priority order
 * @param {number} budget
 * @returns {Map<string, number[]>}
 */
export function planTiles(pages, budget) {
  /** @type {Map<string, number[]>} */
  const plan = new Map(pages.map((p) => [p.key, []]));
  const counts = pages.map((p) => tilesFor(p.height, p.vh));
  let left = budget;
  for (let k = 0; left > 0; k += 1) {
    let any = false;
    for (let i = 0; i < pages.length && left > 0; i += 1) {
      if (k >= counts[i]) continue;
      /** @type {number[]} */ (plan.get(pages[i].key)).push(k);
      left -= 1;
      any = true;
    }
    if (!any) break;
  }
  return plan;
}

// ------------------------------------------------------------------------------------------------ in-page functions

/**
 * In-page: finishes finite animations and cancels infinite ones, as Playwright's `animations: "disabled"` does, so
 * boxes are measured in their final state.
 * @returns {{finished: number, cancelled: number, failed: number}}
 */
export const settleAnimations = function settleAnimations() {
  let finished = 0;
  let cancelled = 0;
  let failed = 0;
  for (const animation of document.getAnimations()) {
    try {
      const timing = animation.effect ? animation.effect.getComputedTiming() : null;
      if (timing && timing.endTime === Infinity) {
        animation.cancel();
        cancelled += 1;
      } else {
        animation.finish();
        finished += 1;
      }
    } catch {
      failed += 1;
    }
  }
  return { finished, cancelled, failed };
};

/**
 * In-page: scrolls the window without smooth behaviour and returns the scroll position reached.
 * @param {number} y
 * @returns {number}
 */
export const scrollPage = function scrollPage(y) {
  window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  return window.scrollY;
};

/**
 * In-page: page geometry.
 * @returns {{scrollHeight: number, innerWidth: number, innerHeight: number, scrollY: number, viewportMeta: boolean}}
 */
export const pageInfo = function pageInfo() {
  const doc = document.documentElement;
  const body = document.body;
  return {
    scrollHeight: Math.max(doc ? doc.scrollHeight : 0, body ? body.scrollHeight : 0),
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollY: window.scrollY,
    viewportMeta: Boolean(document.querySelector('meta[name="viewport"]')),
  };
};

/**
 * In-page: images intersecting the viewport that have not finished loading.
 * @returns {number}
 */
export const pendingImages = function pendingImages() {
  let pending = 0;
  for (const img of Array.from(document.images)) {
    if (img.complete) continue;
    const r = img.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth) pending += 1;
  }
  return pending;
};

/**
 * In-page: measures text and boxes the generic collectors do not, and stores the results as data-fe-* attributes so
 * collectElements carries them back with each element's selector (untagMetrics removes them):
 * per text block (an element whose own inline text it lays out) line count, characters per line, line-height ratio
 * and words; per heading line count, words and words on its last line; per element whose overflow clips text the
 * clipped amount; per link inside running text a flag (WCAG 2.5.8 inline exception).
 * @returns {{blocks: number, headings: number, clipped: number}}
 */
export const tagMetrics = function tagMetrics() {
  /** @type {Map<Element, string>} */
  const displays = new Map();
  /** @param {Element} el @returns {string} */
  const displayOf = (el) => {
    let d = displays.get(el);
    if (d === undefined) {
      d = getComputedStyle(el).display;
      displays.set(el, d);
    }
    return d;
  };
  /** @param {Node} node @returns {Element | null} */
  const blockOf = (node) => {
    let el = node.parentElement;
    while (el && (displayOf(el) === 'inline' || displayOf(el) === 'contents')) el = el.parentElement;
    return el;
  };
  const root = document.body || document.documentElement;
  /** @type {Map<Element, Text[]>} */
  const groups = new Map();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!/\S/.test(n.nodeValue || '')) continue;
    const parent = n.parentElement;
    if (!parent || parent.closest('script, style, noscript, template, svg, head')) continue;
    const block = blockOf(n);
    if (!block) continue;
    const list = groups.get(block);
    if (list) list.push(/** @type {Text} */ (n));
    else groups.set(block, [/** @type {Text} */ (n)]);
  }
  const range = document.createRange();
  let blocks = 0;
  for (const [block, nodes] of groups) {
    const cs = getComputedStyle(block);
    const fontSize = Number.parseFloat(cs.fontSize) || 16;
    /** @type {Array<{top: number, bottom: number, width: number}>} */
    const lines = [];
    let width = 0;
    let chars = 0;
    let words = 0;
    for (const node of nodes) {
      const text = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
      if (rects.length === 0) continue;
      chars += text.length;
      words += text.split(' ').filter(Boolean).length;
      for (const r of rects) {
        width += r.width;
        const mid = (r.top + r.bottom) / 2;
        const line = lines.find((l) => mid >= l.top - 1 && mid <= l.bottom + 1);
        if (line) {
          line.top = Math.min(line.top, r.top);
          line.bottom = Math.max(line.bottom, r.bottom);
          line.width += r.width;
        } else {
          lines.push({ top: r.top, bottom: r.bottom, width: r.width });
        }
      }
    }
    if (lines.length === 0 || chars === 0) continue;
    lines.sort((a, b) => a.top - b.top);
    const perChar = width / chars;
    const longest = Math.max(...lines.map((l) => l.width));
    let lh = Number.NaN;
    if (cs.lineHeight.endsWith('px')) {
      lh = Number.parseFloat(cs.lineHeight) / fontSize;
    } else if (lines.length >= 2) {
      const gaps = [];
      for (let i = 1; i < lines.length; i += 1) gaps.push(lines[i].top - lines[i - 1].top);
      gaps.sort((a, b) => a - b);
      lh = gaps[Math.floor(gaps.length / 2)] / fontSize;
    }
    block.setAttribute('data-fe-lines', String(lines.length));
    block.setAttribute('data-fe-cpl', String(perChar > 0 ? Math.round(longest / perChar) : 0));
    block.setAttribute('data-fe-words', String(words));
    if (Number.isFinite(lh)) block.setAttribute('data-fe-lh', lh.toFixed(2));
    blocks += 1;
  }
  let headings = 0;
  for (const h of Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'))) {
    /** @type {number[]} */
    const mids = [];
    const hw = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
    for (let n = hw.nextNode(); n; n = hw.nextNode()) {
      const value = n.nodeValue || '';
      const re = /\S+/g;
      for (let m = re.exec(value); m; m = re.exec(value)) {
        range.setStart(n, m.index);
        range.setEnd(n, m.index + m[0].length);
        const r = range.getClientRects()[0];
        if (r && r.width > 0 && r.height > 0) mids.push((r.top + r.bottom) / 2);
      }
    }
    if (mids.length === 0) continue;
    const fontSize = Number.parseFloat(getComputedStyle(h).fontSize) || 16;
    let lineCount = 1;
    let last = 1;
    let lineMid = mids[0];
    for (let i = 1; i < mids.length; i += 1) {
      if (mids[i] - lineMid > fontSize * 0.5) {
        lineCount += 1;
        last = 1;
        lineMid = mids[i];
      } else {
        last += 1;
      }
    }
    h.setAttribute('data-fe-hlines', String(lineCount));
    h.setAttribute('data-fe-last', String(last));
    h.setAttribute('data-fe-hwords', String(mids.length));
    headings += 1;
  }
  let clipped = 0;
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.closest('svg, script, style, noscript, template')) continue;
    const cs = getComputedStyle(el);
    const clipsX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
    const clipsY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
    if (!clipsX && !clipsY) continue;
    const clamp = Reflect.get(cs, 'webkitLineClamp');
    if ((typeof clamp === 'string' && clamp !== 'none' && clamp !== '') || cs.textOverflow === 'ellipsis') continue;
    if (!(el.textContent || '').trim()) continue;
    const dx = clipsX ? el.scrollWidth - el.clientWidth : 0;
    const dy = clipsY ? el.scrollHeight - el.clientHeight : 0;
    if (dx > 1 || dy > 1) {
      el.setAttribute('data-fe-clip', `${Math.max(0, dx)}x${Math.max(0, dy)}`);
      clipped += 1;
    }
  }
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    if (displayOf(a) !== 'inline' || !a.parentElement) continue;
    const own = (a.textContent || '').trim();
    const around = (a.parentElement.textContent || '').replace(own, '').trim();
    if (around.length > 0) a.setAttribute('data-fe-inline', '1');
  }
  return { blocks, headings, clipped };
};

/**
 * In-page: removes the data-fe-* attributes tagMetrics added.
 * @param {string[]} names
 * @returns {number}
 */
export const untagMetrics = function untagMetrics(names) {
  let removed = 0;
  for (const el of Array.from(document.querySelectorAll(names.map((n) => `[${n}]`).join(', ')))) {
    for (const n of names) {
      if (el.hasAttribute(n)) {
        el.removeAttribute(n);
        removed += 1;
      }
    }
  }
  return removed;
};

/**
 * In-page: the viewport rectangles of the given marks that are rendered and intersect the viewport.
 * @param {Array<{id: string, sel: string}>} items
 * @returns {Array<{id: string, x: number, y: number, w: number, h: number}>}
 */
export const markRects = function markRects(items) {
  /** @type {Array<{id: string, x: number, y: number, w: number, h: number}>} */
  const out = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  for (const item of items) {
    /** @type {Element | null} */
    let el = null;
    try {
      el = document.querySelector(item.sel);
    } catch {
      el = null;
    }
    if (!el) continue;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) continue;
    out.push({ id: item.id, x: r.left, y: r.top, w: r.width, h: r.height });
  }
  return out;
};

/**
 * In-page: draws numbered marks (Set-of-Mark, FD17-F03) in a fixed layer above the page: an outline on each box and a
 * badge with its id, placed where it does not cover another badge.
 * @param {Array<{id: string, x: number, y: number, w: number, h: number}>} marks
 * @returns {number}
 */
export const drawMarks = function drawMarks(marks) {
  const old = document.getElementById('__fe_critique_marks__');
  if (old) old.remove();
  const layer = document.createElement('div');
  layer.id = '__fe_critique_marks__';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;overflow:hidden;margin:0;padding:0;border:0;';
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  /** @type {Array<{x: number, y: number, w: number, h: number}>} */
  const placed = [];
  /** @param {{x: number, y: number, w: number, h: number}} a @param {{x: number, y: number, w: number, h: number}} b */
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const m of marks) {
    const x = Math.max(0, m.x);
    const y = Math.max(0, m.y);
    const w = Math.min(vw, m.x + m.w) - x;
    const h = Math.min(vh, m.y + m.h) - y;
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${Math.max(2, w)}px;height:${Math.max(2, h)}px;box-sizing:border-box;border:2px solid #d10074;box-shadow:0 0 0 1px #ffffff;`;
    layer.appendChild(box);
    const bw = 10 + 7 * m.id.length;
    const bh = 16;
    const options = [
      { x, y: y - bh - 1 },
      { x, y },
      { x: x + w - bw, y },
      { x, y: y + h + 1 },
    ];
    const fits = (/** @type {{x: number, y: number}} */ p) => p.x >= 0 && p.y >= 0 && p.x + bw <= vw && p.y + bh <= vh;
    const spot = options.find((p) => fits(p) && !placed.some((q) => overlaps({ x: p.x, y: p.y, w: bw, h: bh }, q)))
      ?? options.find(fits) ?? { x: Math.min(Math.max(0, x), vw - bw), y: Math.min(Math.max(0, y), vh - bh) };
    placed.push({ x: spot.x, y: spot.y, w: bw, h: bh });
    const badge = document.createElement('div');
    badge.textContent = m.id;
    badge.style.cssText = `position:absolute;left:${spot.x}px;top:${spot.y}px;min-width:${bw}px;height:${bh}px;box-sizing:border-box;padding:0 3px;font:700 12px/14px Arial,Helvetica,sans-serif;letter-spacing:0;text-align:center;color:#ffffff;background:#d10074;border:1px solid #ffffff;border-radius:3px;white-space:nowrap;`;
    layer.appendChild(badge);
  }
  document.documentElement.appendChild(layer);
  return marks.length;
};

/**
 * In-page: removes the mark layer.
 * @returns {boolean}
 */
export const clearMarks = function clearMarks() {
  const layer = document.getElementById('__fe_critique_marks__');
  if (layer) layer.remove();
  return Boolean(layer);
};

/**
 * In-page: a Gaussian blur of a PNG with clamped edges (the edge pixels are extended before blurring, so the border
 * does not fade to white). Returns base64 PNG of the same pixel size.
 * @param {{b64: string, radius: number}} req radius in image pixels
 * @returns {Promise<string>}
 */
export const blurPng = async function blurPng(req) {
  const img = new Image();
  img.src = `data:image/png;base64,${req.b64}`;
  await img.decode();
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const p = Math.ceil(req.radius * 3);
  const pad = document.createElement('canvas');
  pad.width = w + 2 * p;
  pad.height = h + 2 * p;
  const c = pad.getContext('2d');
  if (!c) throw new Error('no 2d canvas');
  c.imageSmoothingEnabled = false;
  c.drawImage(img, p, p);
  c.drawImage(img, 0, 0, 1, h, 0, p, p, h);
  c.drawImage(img, w - 1, 0, 1, h, p + w, p, p, h);
  c.drawImage(img, 0, 0, w, 1, p, 0, w, p);
  c.drawImage(img, 0, h - 1, w, 1, p, p + h, w, p);
  c.drawImage(img, 0, 0, 1, 1, 0, 0, p, p);
  c.drawImage(img, w - 1, 0, 1, 1, p + w, 0, p, p);
  c.drawImage(img, 0, h - 1, 1, 1, 0, p + h, p, p);
  c.drawImage(img, w - 1, h - 1, 1, 1, p + w, p + h, p, p);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const o = out.getContext('2d');
  if (!o) throw new Error('no 2d canvas');
  o.filter = `blur(${req.radius}px)`;
  o.drawImage(pad, -p, -p);
  return out.toDataURL('image/png').slice('data:image/png;base64,'.length);
};

// ------------------------------------------------------------------------------------------------ page analysis (pure)

/**
 * @param {ElementInfo} el
 * @returns {boolean}
 */
function isInteractive(el) {
  if (INTERACTIVE_ROLES.has(el.role)) return true;
  if (['button', 'select', 'textarea', 'summary'].includes(el.tag)) return true;
  if (el.tag === 'input') return el.meta.type !== 'hidden';
  return el.tag === 'a' && Object.hasOwn(el.meta, 'href');
}

/**
 * @param {ElementInfo} el
 * @returns {boolean}
 */
function isInlineFlow(el) {
  const d = el.styles.display ?? '';
  return d === 'inline' || d === 'contents';
}

/**
 * @param {ElementInfo[]} elements
 * @param {number} i
 * @returns {Generator<number>}
 */
function* selfAndAncestors(elements, i) {
  for (let j = i; j >= 0 && j < elements.length; j = elements[j].parent) yield j;
}

/**
 * The mark candidates of a page: headings, text blocks, interactive elements, images and every element carrying one of
 * the DOM markers of CONTRACTS 6.6. A text block is the nearest non-inline box laying out visible text, unless it sits
 * inside a heading or a control.
 * @param {ElementInfo[]} elements
 * @param {TextInfo[]} texts
 * @returns {Map<number, Set<string>>}
 */
export function classifyElements(elements, texts) {
  /** @type {Map<number, Set<string>>} */
  const kinds = new Map();
  const add = (/** @type {number} */ i, /** @type {string} */ kind) => {
    const set = kinds.get(i);
    if (set) set.add(kind);
    else kinds.set(i, new Set([kind]));
  };
  elements.forEach((el, i) => {
    if (!el.visible) return;
    if (MARKER_ATTRS.some((a) => Object.hasOwn(el.attrs, a))) add(i, 'marker');
    if (el.role === 'heading') add(i, 'heading');
    if (isInteractive(el)) add(i, 'interactive');
    if (IMAGE_TAGS.has(el.tag) || el.role === 'img') add(i, 'image');
  });
  const index = new Map(elements.map((el, i) => [el.sel, i]));
  for (const t of texts) {
    if (!t.visible || t.source !== 'text') continue;
    let i = index.get(t.sel);
    if (i === undefined) continue;
    while (i >= 0 && isInlineFlow(elements[i])) i = elements[i].parent;
    if (i < 0 || !elements[i].visible) continue;
    let inside = false;
    for (const j of selfAndAncestors(elements, i)) {
      const set = kinds.get(j);
      if (set && (set.has('heading') || set.has('interactive'))) {
        inside = true;
        break;
      }
    }
    if (!inside) add(i, 'text');
  }
  return kinds;
}

/**
 * The primary kind of a candidate (what it is, for the marks file) and its drawing priority (markers first).
 * @param {Set<string>} set
 * @returns {{kind: string, priority: number}}
 */
export function primaryKind(set) {
  const kind = ['heading', 'interactive', 'image', 'text', 'marker', 'group', 'section'].find((k) => set.has(k)) ?? 'text';
  return { kind, priority: set.has('marker') ? 0 : KIND_PRIORITY[kind] ?? 9 };
}

/**
 * @param {string} value
 * @returns {number}
 */
function px(value) {
  return num(value, 0);
}

/**
 * Deterministic measurements of one page at one viewport (FD17 Deliverable A, layers 0 and 1): typography (body size,
 * measure, line height, heading orphans), text contrast, target size, layout (near-miss alignment, gap variance,
 * section paddings, clipping), the first-screen contract on the first route, and the feature surfaces on desktop.
 * Pure: it reads the collectors' output only.
 * @param {{route: Route, viewport: CaptureViewport, elements: ElementInfo[], texts: TextInfo[], brief: BriefInfo,
 *   sponsorNames: string[], first: boolean, features: boolean, vw: number, vh: number}} input
 * @returns {PageAnalysis}
 */
export function analysePage(input) {
  const { elements, texts, brief, vw, vh } = input;
  const desktop = input.viewport.name === 'desktop';
  const kinds = classifyElements(elements, texts);
  /** @type {ScoreItem[]} */
  const items = [];
  /** @type {ProblemDraft[]} */
  const problems = [];
  /** @type {string[]} */
  const notes = [];
  const item = (/** @type {string} */ dim, /** @type {string} */ sub, /** @type {boolean} */ ok) => items.push({ dim, sub, ok });
  const problem = (/** @type {number} */ el, /** @type {string} */ kind, /** @type {string} */ check, /** @type {string} */ text, /** @type {string} */ fix, /** @type {string | number} */ value) =>
    problems.push({ el, kind, check, item: CHECK_ITEMS[check] ?? '', problem: text, fix, value });

  for (const [i, set] of kinds) {
    const el = elements[i];
    const a = el.attrs;
    const size = px(el.styles.fontSize ?? '');
    const lh = num(a['data-fe-lh'], Number.NaN);
    if (set.has('text') && !set.has('heading')) {
      const words = num(a['data-fe-words']);
      let exempt = false;
      for (const j of selfAndAncestors(elements, i)) if (BODY_EXEMPT_TAGS.has(elements[j].tag)) exempt = true;
      if (words >= THRESHOLDS.bodyWords && !exempt) {
        const lines = num(a['data-fe-lines']);
        const cpl = num(a['data-fe-cpl']);
        const sizeOk = size >= THRESHOLDS.bodyMinPx - 0.01;
        item('typography', 'body-size', sizeOk);
        if (!sizeOk) problem(i, 'text', 'typography.body-size', `body text at ${round1(size)}px, below ${THRESHOLDS.bodyMinPx}px`, `set this text to a body type style of at least ${THRESHOLDS.bodyMinPx}px from the tokens`, size);
        // Narrow phone columns hold about 40 characters at 16px, so the 45-character floor applies on desktop only.
        if (lines >= 2 || cpl > THRESHOLDS.measureMax) {
          const tooLong = cpl > THRESHOLDS.measureMax;
          const tooShort = desktop && lines >= 2 && cpl < THRESHOLDS.measureMin;
          item('typography', 'measure', !tooLong && !tooShort);
          if (tooLong) problem(i, 'text', 'typography.measure', `about ${cpl} characters per line, above ${THRESHOLDS.measureMax}`, 'cap the line length near 65 characters (max-width: 65ch, or a narrower column)', cpl);
          if (tooShort) problem(i, 'text', 'typography.measure', `about ${cpl} characters per line, below ${THRESHOLDS.measureMin}`, 'widen the column so a line holds 45 to 90 characters', cpl);
        }
        if (lines >= 2 && Number.isFinite(lh)) {
          const ok = lh >= THRESHOLDS.bodyLineHeight - 0.01;
          item('typography', 'line-height', ok);
          if (!ok) problem(i, 'text', 'typography.line-height', `line height ${lh.toFixed(2)} on ${lines} lines of body text, below ${THRESHOLDS.bodyLineHeight}`, `set line-height to at least ${THRESHOLDS.bodyLineHeight} for this body text`, lh);
        }
      }
    }
    if (set.has('heading')) {
      const hlines = num(a['data-fe-hlines']);
      const last = num(a['data-fe-last']);
      const hwords = num(a['data-fe-hwords']);
      if (hlines >= 2) {
        if (Number.isFinite(lh)) {
          const ok = lh >= THRESHOLDS.headingLineHeightMin - 0.01 && lh <= THRESHOLDS.headingLineHeightMax + 0.01;
          item('typography', 'heading-line-height', ok);
          if (!ok) problem(i, 'heading', 'typography.heading-line-height', `heading line height ${lh.toFixed(2)} over ${hlines} lines, outside 1 to 1.35`, 'set the heading line-height between 1 and 1.35', lh);
        }
        const orphan = last === 1 && hwords >= 3;
        item('typography', 'orphans', !orphan);
        if (orphan) problem(i, 'heading', 'typography.orphan', `the heading's last line holds one word (${hlines} lines, ${hwords} words)`, 'add text-wrap: balance to the heading so its last line holds more than one word', last);
      }
    }
  }

  contrastChecks(input, kinds, item, problem, notes);
  targetChecks(elements, kinds, item, problem);
  const layoutIssues = layoutChecks(elements, kinds, vw, problem);
  if (input.first) firstViewChecks(input, item, problem, notes);
  const features = input.features ? featureChecks(elements, brief) : [];
  return { kinds, items, problems, notes, layoutIssues, features };
}

/**
 * @typedef {(dim: string, sub: string, ok: boolean) => void} AddItem
 * @typedef {(el: number, kind: string, check: string, text: string, fix: string, value: string | number) => void} AddProblem
 */

/**
 * WCAG 2.2 text contrast (4.5:1, 3:1 for large text) per element, from the computed colour and the composited ancestor
 * background; text over a gradient or an image is left to a11y.contrast's pixel sampling (FD17-F24).
 * @param {{elements: ElementInfo[], texts: TextInfo[]}} input
 * @param {Map<number, Set<string>>} kinds
 * @param {AddItem} item
 * @param {AddProblem} problem
 * @param {string[]} notes
 */
function contrastChecks(input, kinds, item, problem, notes) {
  const { elements, texts } = input;
  const index = new Map(elements.map((el, i) => [el.sel, i]));
  /** @type {Map<number, {ratio: number, required: number, color: string, bg: string}>} */
  const worst = new Map();
  let unmeasured = 0;
  for (const t of texts) {
    if (!t.visible || t.opacity <= 0) continue;
    const owner = index.get(t.sel);
    if (owner === undefined) continue;
    let target = owner;
    for (const j of selfAndAncestors(elements, owner)) {
      if (kinds.has(j)) {
        target = j;
        break;
      }
    }
    if (t.bgImage) {
      unmeasured += 1;
      continue;
    }
    const fg = parseColor(t.color);
    if (!fg) continue;
    const ratio = contrastRatio({ ...fg, a: fg.a * t.opacity }, t.bg);
    if (ratio === null) continue;
    const large = t.fontSize >= 24 || (t.fontSize >= 18.66 && t.fontWeight >= 700);
    const required = large ? THRESHOLDS.contrastLarge : THRESHOLDS.contrastText;
    const prev = worst.get(target);
    if (!prev || ratio / required < prev.ratio / prev.required) worst.set(target, { ratio, required, color: t.color, bg: t.bg });
  }
  for (const [i, w] of worst) {
    const ok = w.ratio >= w.required - 1e-9;
    item('contrast', 'text', ok);
    if (!ok) {
      problem(i, kinds.has(i) ? primaryKind(/** @type {Set<string>} */ (kinds.get(i))).kind : 'text', 'contrast.text',
        `text contrast ${w.ratio.toFixed(2)}:1 (${w.color} on ${w.bg}), below ${w.required}:1`,
        `use a text colour token that reaches ${w.required}:1 on this ground`, round1(w.ratio * 100) / 100);
    }
  }
  if (unmeasured > 0) notes.push(`${unmeasured} text item(s) sit on a gradient or image ground; a11y.contrast resolves them by pixel sampling`);
}

/**
 * WCAG 2.5.8 target size: at least 24x24 CSS px, or a 24 px circle centred on the target that meets no other target
 * (nor another undersized target's circle). Links inside running text are exempt.
 * @param {ElementInfo[]} elements
 * @param {Map<number, Set<string>>} kinds
 * @param {AddItem} item
 * @param {AddProblem} problem
 */
function targetChecks(elements, kinds, item, problem) {
  /** @type {number[]} */
  const targets = [];
  for (const [i, set] of kinds) {
    const el = elements[i];
    if (!set.has('interactive') || el.attrs['data-fe-inline'] === '1' || el.box.w <= 0 || el.box.h <= 0) continue;
    targets.push(i);
  }
  const min = THRESHOLDS.targetMin;
  const contains = (/** @type {Box} */ a, /** @type {Box} */ b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
  for (const i of targets) {
    const box = elements[i].box;
    const big = box.w >= min - 0.01 && box.h >= min - 0.01;
    let ok = big;
    if (!big) {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      ok = targets.every((j) => {
        if (j === i) return true;
        const other = elements[j].box;
        if (contains(other, box) || contains(box, other)) return true;
        const nx = Math.max(other.x, Math.min(cx, other.x + other.w));
        const ny = Math.max(other.y, Math.min(cy, other.y + other.h));
        if (Math.hypot(cx - nx, cy - ny) < min / 2) return false;
        const otherSmall = other.w < min || other.h < min;
        return !otherSmall || Math.hypot(cx - (other.x + other.w / 2), cy - (other.y + other.h / 2)) >= min;
      });
    }
    item('targets', 'size', ok);
    if (!ok) {
      problem(i, 'interactive', 'targets.size', `target ${round1(box.w)}x${round1(box.h)} CSS px, below ${min}x${min} and too close to another target`,
        `make the target at least ${min}x${min} CSS px (padding or min-height), or keep ${min}px of space around it`, `${round1(box.w)}x${round1(box.h)}`);
    }
  }
}

/**
 * Layout checks of FD17 Deliverable A B4 (provisional thresholds): near-miss alignment between siblings (edges 3-6 px
 * apart, 2 px counts as aligned), the coefficient of variation of gaps between three or more repeated siblings, more
 * than three distinct section paddings, and text clipped by an overflow. Returns the number of issues.
 * @param {ElementInfo[]} elements
 * @param {Map<number, Set<string>>} kinds
 * @param {number} vw
 * @param {AddProblem} problem
 * @returns {number}
 */
function layoutChecks(elements, kinds, vw, problem) {
  let issues = 0;
  /** @type {Map<number, number[]>} */
  const children = new Map();
  elements.forEach((el, i) => {
    if (i === 0 || !el.visible || el.parent < 0) return;
    const pos = el.styles.position ?? '';
    if (pos === 'absolute' || pos === 'fixed' || isInlineFlow(el) || el.box.w < 24 || el.box.h < 8) return;
    const list = children.get(el.parent);
    if (list) list.push(i);
    else children.set(el.parent, [i]);
  });
  const kindOf = (/** @type {number} */ i) => {
    const set = kinds.get(i);
    return set ? primaryKind(set).kind : 'group';
  };
  for (const [, list] of children) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((p, q) => elements[p].box.y - elements[q].box.y || elements[p].box.x - elements[q].box.x);
    for (let k = 1; k < sorted.length; k += 1) {
      const a = elements[sorted[k - 1]].box;
      const b = elements[sorted[k]].box;
      const stacked = b.y >= a.y + a.h - 2;
      const dx = Math.abs(a.x - b.x);
      const sideBySide = !stacked && Math.abs(a.h - b.h) <= 2;
      const dy = Math.abs(a.y - b.y);
      const near = stacked ? dx : sideBySide ? dy : 0;
      if (near >= THRESHOLDS.nearMissMin && near <= THRESHOLDS.nearMissMax) {
        issues += 1;
        const edge = stacked ? 'left edge' : 'top edge';
        for (const idx of [sorted[k - 1], sorted[k]]) {
          problem(idx, kindOf(idx), 'layout.near-miss', `${edge} ${round1(near)}px off its sibling's (${elements[idx === sorted[k] ? sorted[k - 1] : sorted[k]].sel})`,
            `align the ${edge}s of these siblings exactly (2px or less apart)`, round1(near));
        }
      }
    }
    for (const run of repeatedRuns(elements, list)) {
      const boxes = run.indexes.map((i) => elements[i].box);
      const gaps = boxes.slice(1).map((b, k) => (run.axis === 'column' ? b.y - (boxes[k].y + boxes[k].h) : b.x - (boxes[k].x + boxes[k].w)));
      const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      if (mean < 2) continue;
      const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length);
      const cv = sd / mean;
      if (cv <= THRESHOLDS.gapCvMax) continue;
      issues += 1;
      const values = gaps.map((g) => `${round1(g)}`).join(', ');
      for (const i of run.indexes) {
        problem(i, kindOf(i), 'layout.gap-variance', `gaps of ${values} px between ${run.indexes.length} repeated siblings (variation ${cv.toFixed(2)}, above ${THRESHOLDS.gapCvMax})`,
          'use one spacing token for the gaps between these repeated siblings (gap on their container)', round1(cv * 100) / 100);
      }
    }
  }
  const mainIndex = elements.findIndex((el) => el.visible && (el.tag === 'main' || el.role === 'main'));
  const container = mainIndex >= 0 ? mainIndex : 0;
  const sections = (children.get(container) ?? []).filter((i) => elements[i].box.w >= 0.6 * vw && elements[i].box.h >= 120);
  /** @type {Map<number, number>} */
  const freq = new Map();
  /** @type {Map<number, number[]>} */
  const valuesOf = new Map();
  for (const i of sections) {
    const values = [px(elements[i].styles.paddingTop ?? ''), px(elements[i].styles.paddingBottom ?? '')].map((v) => Math.round(v)).filter((v) => v > 0);
    valuesOf.set(i, values);
    for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  }
  if (freq.size > THRESHOLDS.sectionPaddingsMax) {
    issues += 1;
    const common = [...freq.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0]).slice(0, THRESHOLDS.sectionPaddingsMax).map(([v]) => v);
    for (const i of sections) {
      const odd = (valuesOf.get(i) ?? []).filter((v) => !common.includes(v));
      if (odd.length === 0) continue;
      problem(i, 'section', 'layout.section-padding', `section padding ${odd.join('/')}px; the page uses ${freq.size} distinct section paddings (most common ${common.join(', ')}px)`,
        `use one of the section padding tokens (${common.join(', ')}px) for this section`, odd.join('/'));
    }
  }
  elements.forEach((el, i) => {
    const clip = el.attrs['data-fe-clip'];
    if (!clip || !el.visible) return;
    issues += 1;
    const [dx, dy] = clip.split('x').map((v) => num(v));
    problem(i, kindOf(i), 'layout.clipped', `content clipped by ${dx > 1 ? `${dx}px horizontally` : ''}${dx > 1 && dy > 1 ? ' and ' : ''}${dy > 1 ? `${dy}px vertically` : ''}`,
      'let the text wrap, or give its container the room it needs, instead of hiding the overflow', clip);
  });
  return issues;
}

/**
 * Runs of three or more repeated siblings: consecutive children of one parent with the same tag, stacked in a column
 * with widths within 4 px, or side by side in a row with widths or heights within 4 px. Classes are not compared:
 * modifier and generated class names differ between siblings that repeat.
 * @param {ElementInfo[]} elements
 * @param {number[]} children
 * @returns {Array<{axis: 'column' | 'row', indexes: number[]}>}
 */
export function repeatedRuns(elements, children) {
  /** @type {Array<{axis: 'column' | 'row', indexes: number[]}>} */
  const runs = [];
  const box = (/** @type {number} */ i) => elements[i].box;
  const near = (/** @type {number} */ a, /** @type {number} */ b) => Math.abs(a - b) <= 4;
  /** @type {Array<{axis: 'column' | 'row', order: number[], next: (a: Box, b: Box) => boolean, similar: (a: Box, b: Box) => boolean}>} */
  const passes = [
    {
      axis: 'column',
      order: [...children].sort((p, q) => box(p).y - box(q).y || box(p).x - box(q).x),
      next: (a, b) => b.y >= a.y + a.h - 2,
      similar: (a, b) => near(a.w, b.w),
    },
    {
      axis: 'row',
      order: [...children].sort((p, q) => box(p).x - box(q).x || box(p).y - box(q).y),
      next: (a, b) => b.x >= a.x + a.w - 2 && b.y < a.y + a.h && a.y < b.y + b.h,
      similar: (a, b) => near(a.w, b.w) || near(a.h, b.h),
    },
  ];
  for (const pass of passes) {
    /** @type {number[]} */
    let run = [];
    const flush = () => {
      if (run.length >= 3) runs.push({ axis: pass.axis, indexes: run });
      run = [];
    };
    for (const i of pass.order) {
      if (TEXT_FLOW_TAGS.has(elements[i].tag)) {
        flush();
        continue;
      }
      const prev = run[run.length - 1];
      if (prev !== undefined && elements[prev].tag === elements[i].tag && pass.next(box(prev), box(i)) && pass.similar(box(run[0]), box(i))) {
        run.push(i);
      } else {
        flush();
        run = [i];
      }
    }
    flush();
  }
  return runs;
}

/**
 * The first-screen contract on the first route (ARCHITECTURE P5, FD11): the H1 and the sentence equal to the brief, the
 * product visible, one sourced figure, and the sponsor named, all inside the first viewport.
 * @param {{elements: ElementInfo[], texts: TextInfo[], brief: BriefInfo, sponsorNames: string[], vh: number}} input
 * @param {AddItem} item
 * @param {AddProblem} problem
 * @param {string[]} notes
 */
function firstViewChecks(input, item, problem, notes) {
  const { elements, texts, brief, vh } = input;
  const inFirst = (/** @type {ElementInfo} */ el) => el.visible && el.box.w > 0 && el.box.h > 0 && el.box.y < vh && el.box.y + el.box.h > 0;
  const byHero = (/** @type {string} */ v) => elements.findIndex((el) => el.attrs['data-hero'] === v && el.visible);
  let h1 = byHero('h1');
  if (h1 < 0) h1 = elements.findIndex((el) => el.tag === 'h1' && el.visible);
  if (h1 < 0) {
    item('first_view', 'h1', false);
    notes.push('first view: no visible H1');
  } else {
    const el = elements[h1];
    const same = sameTextKey(el.text) === sameTextKey(brief.h1);
    const ok = same && inFirst(el);
    item('first_view', 'h1', ok);
    if (!ok) problem(h1, 'heading', 'first-view.h1', same ? 'the H1 sits below the first viewport' : `the H1 reads "${el.text.slice(0, 80)}", not the brief's "${brief.h1}"`,
      same ? 'move the H1 into the first viewport' : 'render brief.hero.h1 exactly in the data-hero="h1" element', el.text.slice(0, 80));
  }
  const sentence = byHero('sentence');
  if (sentence < 0) {
    item('first_view', 'sentence', false);
    notes.push('first view: no element marked data-hero="sentence"');
  } else {
    const el = elements[sentence];
    const same = sameTextKey(el.text) === sameTextKey(brief.sentence);
    const ok = same && inFirst(el);
    item('first_view', 'sentence', ok);
    if (!ok) problem(sentence, 'text', 'first-view.sentence', same ? 'the hero sentence sits below the first viewport' : `the hero sentence differs from brief.hero.sentence`,
      same ? 'move the sentence into the first viewport, under the H1' : 'render brief.hero.sentence exactly in the data-hero="sentence" element', el.text.slice(0, 80));
  }
  const product = elements.findIndex((el) => el.attrs['data-surface'] === 'product' && el.visible);
  if (product < 0) {
    item('first_view', 'product', false);
    notes.push('first view: no element marked data-surface="product"');
  } else {
    const ok = inFirst(elements[product]);
    item('first_view', 'product', ok);
    if (!ok) problem(product, 'marker', 'first-view.product', 'the product surface sits below the first viewport', 'bring the product surface (data-surface="product") into the first viewport', round1(elements[product].box.y));
  }
  const figures = elements.map((el, i) => ({ el, i })).filter(({ el }) => Object.hasOwn(el.attrs, 'data-metric') && el.visible);
  const sourced = figures.filter(({ el }) => inFirst(el) && (Object.hasOwn(el.attrs, 'data-ledger') || (Object.hasOwn(el.attrs, 'data-source') && Object.hasOwn(el.attrs, 'data-as-of'))));
  item('first_view', 'figure', sourced.length > 0);
  if (sourced.length === 0) {
    const first = figures.find(({ el }) => inFirst(el));
    if (first) problem(first.i, 'marker', 'first-view.figure', 'the figure in the first viewport carries no data-ledger, or data-source with data-as-of', 'tie the figure to its claims-ledger id (data-ledger) or its data source and as-of time', first.el.text.slice(0, 40));
    else notes.push('first view: no sourced figure (data-metric with data-ledger, or data-source and data-as-of)');
  }
  if (input.sponsorNames.length > 0) {
    const firstText = texts.filter((t) => t.visible && t.inViewport).map((t) => t.text).join(' ');
    const named = input.sponsorNames.some((name) => mentions(firstText, name));
    item('first_view', 'sponsor', named);
    if (!named) notes.push(`first view: no sponsor named in text (${input.sponsorNames.join(', ')})`);
  }
}

/**
 * @param {string} text
 * @param {string} name
 * @returns {boolean}
 */
export function mentions(text, name) {
  const n = normaliseText(name).toLowerCase();
  if (!n) return false;
  const t = normaliseText(text).toLowerCase();
  let from = 0;
  for (;;) {
    const at = t.indexOf(n, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : t[at - 1];
    const after = t[at + n.length] ?? '';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    from = at + 1;
  }
}

/**
 * Per brief feature (CONTRACTS 6.6): a visible data-feature root holding a heading, a data-status label equal to the
 * brief's status, and a proof marker (data-proof, data-ledger or data-source).
 * @param {ElementInfo[]} elements
 * @param {BriefInfo} brief
 * @returns {FeatureResult[]}
 */
function featureChecks(elements, brief) {
  return brief.features.map((f) => {
    const root = elements.findIndex((el) => el.attrs['data-feature'] === f.id && el.visible);
    if (root < 0) return { id: f.id, found: false, ok: false, el: -1, missing: ['surface'] };
    const depth = elements[root].depth;
    const subtree = [root];
    for (let j = root + 1; j < elements.length && elements[j].depth > depth; j += 1) subtree.push(j);
    const visible = subtree.filter((j) => elements[j].visible);
    const heading = visible.some((j) => elements[j].role === 'heading');
    const statusEl = visible.find((j) => Object.hasOwn(elements[j].attrs, 'data-status'));
    const status = statusEl === undefined ? '' : elements[statusEl].attrs['data-status'];
    const statusOk = Boolean(status) && (!f.status || status === f.status);
    const proof = visible.some((j) => ['data-proof', 'data-ledger', 'data-source'].some((a) => Object.hasOwn(elements[j].attrs, a)));
    /** @type {string[]} */
    const missing = [];
    if (!heading) missing.push('heading');
    if (!statusOk) missing.push(status ? `status ${status} (brief: ${f.status})` : 'status');
    if (!proof) missing.push('proof');
    return { id: f.id, found: true, ok: missing.length === 0, el: root, missing };
  });
}

// ------------------------------------------------------------------------------------------------ marks registry

/** The marks of one measure: ids are assigned once per route and selector, in document order. */
export class MarkRegistry {
  constructor() {
    /** @type {Map<string, Mark>} */
    this.byKey = new Map();
    /** @type {Mark[]} */
    this.list = [];
  }

  /**
   * @param {Route} route
   * @param {ElementInfo} el
   * @param {string[]} kinds
   * @param {string} viewport
   * @returns {Mark}
   */
  add(route, el, kinds, viewport) {
    const key = `${route.path} ${el.sel}`;
    let mark = this.byKey.get(key);
    if (!mark) {
      const set = new Set(kinds);
      /** @type {Record<string, string>} */
      const attrs = {};
      for (const [k, v] of Object.entries(el.attrs)) if (!k.startsWith('data-fe-')) attrs[k] = v;
      mark = {
        id: String(this.list.length + 1),
        route: route.path,
        routeName: route.name,
        selector: el.sel,
        kind: primaryKind(set).kind,
        kinds: [...set],
        tag: el.tag,
        role: el.role,
        text: el.text.slice(0, 160),
        attrs,
        views: {},
        tiles: [],
      };
      this.byKey.set(key, mark);
      this.list.push(mark);
    } else {
      for (const k of kinds) if (!mark.kinds.includes(k)) mark.kinds.push(k);
      mark.kind = primaryKind(new Set(mark.kinds)).kind;
    }
    if (!mark.views[viewport]) {
      /** @type {Record<string, string>} */
      const styles = {};
      for (const k of KEY_STYLES) if (el.styles[k] !== undefined) styles[k] = el.styles[k];
      styles.padding = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map((k) => el.styles[k] ?? '0px').join(' ');
      /** @type {Record<string, number | string | boolean>} */
      const metrics = {};
      for (const [attr, name] of [['data-fe-lines', 'lines'], ['data-fe-cpl', 'charsPerLine'], ['data-fe-lh', 'lineHeightRatio'], ['data-fe-words', 'words'], ['data-fe-hlines', 'headingLines'], ['data-fe-last', 'lastLineWords'], ['data-fe-clip', 'clipped']]) {
        const v = el.attrs[attr];
        if (v !== undefined) metrics[name] = attr === 'data-fe-clip' ? v : num(v);
      }
      mark.views[viewport] = { box: el.box, visible: el.visible, styles, metrics };
    }
    return mark;
  }

  /**
   * @param {string} routePath
   * @param {string} selector
   * @returns {Mark | undefined}
   */
  find(routePath, selector) {
    const exact = this.byKey.get(`${routePath} ${selector}`);
    if (exact) return exact;
    return this.list.find((m) => m.selector === selector);
  }
}

/**
 * The deterministic sub-scores, each 0-100 and higher-is-better (FD17 Deliverable A layer 1, deterministic parts):
 * typography (mean of the body-size, measure, line-height, heading line-height and orphan shares), contrast, targets,
 * layout (per page and viewport 100 minus 20 per issue, averaged), first_view and features. A score with nothing to
 * measure is left out rather than reported as 0.
 * @param {PageAnalysis[]} analyses
 * @param {FeatureResult[]} features merged over routes
 * @returns {Record<string, number>}
 */
export function aggregateScores(analyses, features) {
  /** @type {Record<string, number>} */
  const scores = {};
  const all = analyses.flatMap((a) => a.items);
  const share = (/** @type {ScoreItem[]} */ list) => (list.length === 0 ? null : (100 * list.filter((i) => i.ok).length) / list.length);
  const typo = all.filter((i) => i.dim === 'typography');
  const subs = [...new Set(typo.map((i) => i.sub))].map((sub) => share(typo.filter((i) => i.sub === sub))).filter((v) => v !== null);
  if (subs.length > 0) scores.typography = round1(subs.reduce((s, v) => s + /** @type {number} */ (v), 0) / subs.length);
  for (const dim of ['contrast', 'targets', 'first_view']) {
    const v = share(all.filter((i) => i.dim === dim));
    if (v !== null) scores[dim] = round1(v);
  }
  if (analyses.length > 0) {
    const per = analyses.map((a) => Math.max(0, 100 - THRESHOLDS.layoutPenalty * a.layoutIssues));
    scores.layout = round1(per.reduce((s, v) => s + v, 0) / per.length);
  }
  if (features.length > 0) scores.features = round1((100 * features.filter((f) => f.ok).length) / features.length);
  return scores;
}

/**
 * Merges per-route feature results: a feature passes when any route shows it complete.
 * @param {FeatureResult[][]} perRoute
 * @returns {Array<FeatureResult & {route: number}>}
 */
export function mergeFeatures(perRoute) {
  /** @type {Map<string, FeatureResult & {route: number}>} */
  const merged = new Map();
  perRoute.forEach((list, route) => {
    for (const f of list) {
      const prev = merged.get(f.id);
      if (!prev || (!prev.ok && f.ok) || (!prev.found && f.found)) merged.set(f.id, { ...f, route });
    }
  });
  return [...merged.values()];
}

// ------------------------------------------------------------------------------------------------ capture

/**
 * @param {Page} page
 * @returns {Promise<void>}
 */
async function twoFrames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))));
}

/**
 * @param {Page} page
 * @param {number} timeoutMs
 * @returns {Promise<number>}
 */
async function waitViewportImages(page, timeoutMs) {
  const started = Date.now();
  for (;;) {
    const pending = await page.evaluate(pendingImages);
    if (pending === 0 || Date.now() - started > timeoutMs) return pending;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Picks the marks drawn on one tile: markers and headings first, then controls, images and text, in document order,
 * at most `cap`.
 * @param {Array<{id: string, x: number, y: number, w: number, h: number}>} rects
 * @param {Map<string, number>} priority
 * @param {number} cap
 * @returns {Array<{id: string, x: number, y: number, w: number, h: number}>}
 */
export function chooseMarks(rects, priority, cap) {
  return [...rects]
    .sort((a, b) => (priority.get(a.id) ?? 9) - (priority.get(b.id) ?? 9) || Number(a.id) - Number(b.id))
    .slice(0, cap)
    .sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * Scrolls to `y`, lets scroll-triggered content arrive and settle, then takes the clean tile, draws the marks and takes
 * the marked tile.
 * @param {Page} page
 * @param {number} y
 * @param {Mark[]} marks
 * @param {string} viewport
 * @returns {Promise<{clean: Buffer, marked: Buffer, ids: string[], scrollY: number}>}
 */
async function shootTile(page, y, marks, viewport) {
  const scrollY = await page.evaluate(scrollPage, y);
  await twoFrames(page);
  await waitViewportImages(page, 3000);
  await page.evaluate(settleAnimations);
  await twoFrames(page);
  const clean = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const candidates = marks.filter((m) => m.views[viewport]);
  const rects = await page.evaluate(markRects, candidates.map((m) => ({ id: m.id, sel: m.selector })));
  const priority = new Map(candidates.map((m) => [m.id, primaryKind(new Set(m.kinds)).priority]));
  const chosen = chooseMarks(rects, priority, TILE_MARK_CAP);
  await page.evaluate(drawMarks, chosen);
  const marked = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  await page.evaluate(clearMarks);
  return { clean, marked, ids: chosen.map((c) => c.id), scrollY };
}

/**
 * The names a page may show for the sponsors: the brief's names plus the profile's sponsor ids.
 * @param {BriefInfo} brief
 * @param {Pick<Profile, 'sponsors'>} profile
 * @returns {string[]}
 */
function sponsorNamesOf(brief, profile) {
  const names = new Set(brief.sponsors);
  for (const id of profile?.sponsors ?? []) if (/^[a-z][a-z0-9-]{2,}$/.test(id)) names.add(id.replace(/-/g, ' '));
  return [...names];
}

/**
 * Captures every route at the two capture viewports: analyses each page, takes up to `maxTiles` clean and marked
 * viewport tiles breadth first (every first view, then second tiles, and so on), blurs the first route's first views
 * at 5, 10 and 20 px, and writes the tiles, marks.json and checklist.json under `dir`.
 * @param {{browser: Browser, baseUrl: string, routes: Route[], profile: Profile, brief: BriefInfo, dir: string,
 *   maxTiles?: number, log?: (line: string) => void}} options
 * @returns {Promise<CaptureResult>}
 */
export async function capture(options) {
  const { browser, baseUrl, profile, brief, dir } = options;
  const log = options.log ?? (() => {});
  const maxTiles = options.maxTiles ?? MAX_TILES;
  if (!Number.isInteger(maxTiles) || maxTiles < 1 || maxTiles > MAX_TILES) throw new UsageError(`--max-tiles must be 1 to ${MAX_TILES} (a pairwise call reads two versions)`);
  const viewports = captureViewports(profile);
  const routes = [...options.routes].sort((a, b) => Number(b.first) - Number(a.first));
  const sponsorNames = sponsorNamesOf(brief, profile);
  const registry = new MarkRegistry();
  /** @type {PageAnalysis[]} */
  const analyses = [];
  /** @type {Problem[]} */
  const problems = [];
  /** @type {string[]} */
  const notes = [];
  /** @type {FeatureResult[][]} */
  const featureRuns = [];
  /** @type {Array<{key: string, route: Route, viewport: CaptureViewport, url: string, height: number, vh: number}>} */
  const pages = [];
  /** @type {Map<string, {clean: Buffer, marked: Buffer, ids: string[], scrollY: number}>} */
  const shots = new Map();
  rmSync(path.join(dir, 'tiles'), { recursive: true, force: true });
  rmSync(path.join(dir, 'squint'), { recursive: true, force: true });

  for (const route of routes) {
    for (const viewport of viewports) {
      const url = routeUrl(baseUrl, route, profile);
      const key = `${slug(route.name)}-${viewport.name}`;
      const withinBudget = pages.length < maxTiles;
      log(`analyse ${route.path} at ${viewport.name} ${viewport.width}x${viewport.height}`);
      await withPage(browser, viewport, url, async (page) => {
        await page.evaluate(settleAnimations);
        await page.evaluate(tagMetrics);
        const elements = await page.evaluate(collectElements, { textMax: 200 });
        await page.evaluate(untagMetrics, [...FE_ATTRS]);
        const texts = await page.evaluate(collectText, {});
        const info = await page.evaluate(pageInfo);
        if (viewport.isMobile && !info.viewportMeta) notes.push(`${route.path}: no <meta name="viewport">, so phones lay the page out at 980px and zoom out`);
        const analysis = analysePage({
          route, viewport, elements, texts, brief, sponsorNames,
          first: route === routes[0], features: viewport.name === 'desktop', vw: info.innerWidth, vh: info.innerHeight,
        });
        analyses.push(analysis);
        if (viewport.name === 'desktop') featureRuns.push(analysis.features);
        for (const [i, set] of analysis.kinds) registry.add(route, elements[i], [...set], viewport.name);
        for (const p of analysis.problems) {
          const mark = registry.add(route, elements[p.el], [p.kind], viewport.name);
          problems.push({ mark: mark.id, check: p.check, item: p.item, problem: p.problem, fix: p.fix, route: route.path, viewport: viewport.name, selector: elements[p.el].sel, value: p.value });
        }
        for (const n of analysis.notes) notes.push(`${route.path} ${viewport.name}: ${n}`);
        for (const f of analysis.features) {
          if (f.found && !f.ok) {
            const mark = registry.add(route, elements[f.el], ['marker'], viewport.name);
            for (const miss of f.missing) {
              const letter = miss.startsWith('heading') ? 'a' : miss.startsWith('status') ? 'c' : 'd';
              problems.push({
                mark: mark.id, check: `features.${miss.split(' ')[0]}`, item: `F-${f.id}.${letter}`,
                problem: `feature ${f.id} has no ${miss} inside its data-feature root`,
                fix: miss.startsWith('heading') ? 'give the feature surface a heading in the user\'s words'
                  : miss.startsWith('status') ? 'add its data-status label with the status the brief gives'
                    : 'show its proof: a ledger id, a transaction link or a live value with its as-of time',
                route: route.path, viewport: viewport.name, selector: elements[f.el].sel, value: miss,
              });
            }
          }
        }
        pages.push({ key, route, viewport, url, height: info.scrollHeight, vh: info.innerHeight });
        if (withinBudget) shots.set(`${key}-0`, await shootTile(page, 0, registry.list.filter((m) => m.route === route.path), viewport.name));
      }, { readyFlag: profile.ready_flag });
    }
  }

  const shotPages = pages.slice(0, maxTiles);
  const plan = planTiles(shotPages, maxTiles);
  for (const p of shotPages) {
    const extra = (plan.get(p.key) ?? []).filter((k) => k > 0);
    if (extra.length === 0) continue;
    log(`tiles ${extra.join(', ')} of ${p.route.path} at ${p.viewport.name}`);
    await withPage(browser, p.viewport, p.url, async (page) => {
      await page.evaluate(settleAnimations);
      const marks = registry.list.filter((m) => m.route === p.route.path);
      for (const k of extra) {
        const y = Math.max(0, Math.min(k * p.vh, p.height - p.vh));
        shots.set(`${p.key}-${k}`, await shootTile(page, y, marks, p.viewport.name));
      }
    }, { readyFlag: profile.ready_flag });
  }

  /** @type {Tile[]} */
  const tiles = [];
  /** @type {Record<string, string>} */
  const firstView = {};
  /** @type {Array<{viewport: string, buffer: Buffer, dpr: number}>} */
  const firstBuffers = [];
  for (const p of shotPages) {
    for (const k of plan.get(p.key) ?? []) {
      const shot = shots.get(`${p.key}-${k}`);
      if (!shot) continue;
      const cleanRel = `tiles/${p.key}-${k}.png`;
      const markedRel = `tiles/${p.key}-${k}.marked.png`;
      const clean = writeBinary(path.join(dir, cleanRel), shot.clean);
      const marked = writeBinary(path.join(dir, markedRel), shot.marked);
      tiles.push({ viewport: p.viewport.name, route: p.route.path, route_name: p.route.name, index: k, scroll_y: Math.round(shot.scrollY), path: clean, marked, marks: shot.ids });
      for (const id of shot.ids) {
        const mark = registry.list[Number(id) - 1];
        if (mark && !mark.tiles.includes(markedRel)) mark.tiles.push(markedRel);
      }
      if (k === 0 && p.route === routes[0]) {
        firstView[p.viewport.name] = clean;
        firstBuffers.push({ viewport: p.viewport.name, buffer: shot.clean, dpr: p.viewport.dpr });
      }
    }
  }
  const skipped = pages.slice(maxTiles).map((p) => `${p.route.path} ${p.viewport.name}: analysed, no tile (budget of ${maxTiles} tiles)`);

  /** @type {SquintTile[]} */
  const squint = [];
  if (firstBuffers.length > 0) {
    const context = await browser.newContext({ viewport: { width: 320, height: 240 } });
    try {
      const page = await context.newPage();
      await page.setContent('<!doctype html><title>squint</title>');
      for (const fb of firstBuffers) {
        for (const r of SQUINT_RADII) {
          const b64 = await page.evaluate(blurPng, { b64: fb.buffer.toString('base64'), radius: r * fb.dpr });
          squint.push({ viewport: fb.viewport, radius: r, path: writeBinary(path.join(dir, 'squint', `${fb.viewport}-blur${r}.png`), Buffer.from(b64, 'base64')) });
        }
      }
    } finally {
      await context.close();
    }
  }

  const features = mergeFeatures(featureRuns);
  for (const f of features) if (!f.found) notes.push(`feature ${f.id}: no visible data-feature="${f.id}" root on any route`);
  const scores = aggregateScores(analyses, features);
  const { markdown, items } = buildChecklist(brief);
  annotateChecklist(items, registry, problems, brief);
  return {
    dir: toPosix(path.resolve(dir)), tiles, squint, first_view: firstView, marks: registry.list, problems, notes, scores,
    checklist: items, checklistMarkdown: markdown, skipped, proposition: proposition(brief), url: baseUrl, viewports,
  };
}

/**
 * Adds to each checklist item the marks it is about and the deterministic evidence behind it, so a critic answers
 * with measured values at hand (CR-04).
 * @param {ChecklistItem[]} items
 * @param {MarkRegistry} registry
 * @param {Problem[]} problems
 * @param {BriefInfo} brief
 */
function annotateChecklist(items, registry, problems, brief) {
  const byAttr = (/** @type {string} */ attr, /** @type {string | null} */ value) =>
    registry.list.filter((m) => Object.hasOwn(m.attrs, attr) && (value === null || m.attrs[attr] === value)).map((m) => m.id);
  for (const it of items) {
    if (it.id === 'FV1') {
      it.marks = byAttr('data-hero', 'h1');
      if (it.marks.length === 0) it.marks = registry.list.filter((m) => m.tag === 'h1').slice(0, 1).map((m) => m.id);
    }
    else if (it.id === 'FV2') it.marks = byAttr('data-hero', 'sentence');
    else if (it.id === 'FV3') it.marks = byAttr('data-surface', 'product');
    else if (it.id === 'FV4') it.marks = byAttr('data-metric', null);
    const feature = /^F-(.+)\.([a-d])$/.exec(it.id);
    if (feature) it.marks = byAttr('data-feature', feature[1]);
    for (const p of problems) if (p.item === it.id) it.evidence.push(`mark ${p.mark} (${p.route}, ${p.viewport}): ${p.problem}`);
    if (it.id === 'FV1' && brief.h1) it.evidence.unshift(`expected H1: "${brief.h1}"`);
    if (it.id === 'FV2' && brief.sentence) it.evidence.unshift(`expected sentence: "${brief.sentence}"`);
  }
}

// ------------------------------------------------------------------------------------------------ task file

/**
 * The critic task file of one version (CR-03, CR-04, CR-05): the images to read, the marks, the measured problems,
 * the checklist with the rubric text, the rubric slices per pass and both output formats.
 * @param {{capture: CaptureResult, brief: BriefInfo, round: number, label: string, root: string, uiRoot: string,
 *   design: string, skillDir?: string, gates?: GateSummary | null, gatesFile?: string | null, marksFile: string,
 *   checklistFile: string}} input
 * @returns {string}
 */
export function taskMarkdown(input) {
  const c = input.capture;
  const skill = toPosix(input.skillDir ?? SKILL_DIR);
  const images = [...c.tiles.map((t) => t.marked), ...c.squint.map((s) => s.path)];
  const lines = [
    `# Critic task: ${input.brief.projectName || 'this project'}, round ${input.round} (${input.label})`,
    '',
    'Your task message gives your pass id and your kind (critique or pairwise). Read this file to its end first, then read every image under "Images" in one message, one Read per file, then the marks file.',
    '',
    '## The page',
    '',
    `- Proposition the first view must carry: "${c.proposition}"`,
    `- Measured at ${c.url} on ${c.viewports.map((v) => `${v.name} ${v.width}x${v.height} (DPR ${v.dpr})`).join(' and ')}, animations disabled.`,
    `- Source: ${toPosix(input.root)} (UI under ${input.uiRoot}); tokens: ${toPosix(path.join(input.design, 'tokens.json'))}. Grep a mark's selector, data-feature id or text to find its source.`,
    `- Gates: ${input.gates ? (input.gates.failing.length === 0 ? 'every gate ok' : `failing or skipped: ${input.gates.failing.join(', ')}`) : 'not run for this capture'}${input.gatesFile ? ` (${toPosix(input.gatesFile)})` : ''}.`,
    `- Tells catalogue, for brand and originality judgements: ${skill}/references/11-tells.md.`,
    '',
    `## Images (${images.length})`,
    '',
    'Marked tiles: each numbered mark is an element listed in the marks file with its selector, box, text and key styles.',
    '',
  ];
  c.tiles.forEach((t, i) => lines.push(`${i + 1}. ${t.marked} (route ${t.route}, ${t.viewport}, scroll ${t.scroll_y}px; marks ${t.marks.join(', ') || 'none'})`));
  if (c.squint.length > 0) {
    lines.push('', 'Squint tiles: the first view blurred at 5, 10 and 20 px, for checklist item H1 (name the three most prominent elements in order and compare them with the headline, the product and the primary action).', '');
    c.squint.forEach((s, i) => lines.push(`${c.tiles.length + i + 1}. ${s.path} (${s.viewport}, blur ${s.radius}px)`));
  }
  lines.push('', '## Marks', '', `${toPosix(input.marksFile)}: ${c.marks.length} marks (id, route, selector, kind, text, attributes, and per viewport the box, key styles and text metrics).`, '');
  lines.push('## Measurements', '', 'Deterministic checks of this version. Cite these values; never estimate a size, spacing or colour from an image.', '');
  const scoreLine = Object.entries(c.scores).map(([k, v]) => `${k} ${v}`).join(', ');
  lines.push(`Sub-scores (0-100, higher is better): ${scoreLine || 'none measured'}.`, '');
  if (c.problems.length > 0) {
    lines.push('| mark | check | where | problem | fix |', '|---|---|---|---|---|');
    for (const p of c.problems.slice(0, 120)) lines.push(`| ${p.mark} | ${p.check} | ${p.route} ${p.viewport} | ${cellText(p.problem)} | ${cellText(p.fix)} |`);
    if (c.problems.length > 120) lines.push('', `${c.problems.length - 120} more in ${toPosix(path.join(c.dir, 'measure-problems.json'))}.`);
  } else {
    lines.push('No deterministic problem measured.');
  }
  if (c.notes.length > 0) lines.push('', ...c.notes.map((n) => `- ${n}`));
  lines.push('', '## Checklist', '', `${toPosix(input.checklistFile)} holds these items with the marks each one is about and its evidence.`, '');
  lines.push(c.checklistMarkdown.trim(), '');
  lines.push(
    '## Rubric',
    '',
    '- Judge one screen with contrast, repetition, alignment and proximity, and with Material\'s grouping principles: rhythm (consistent spacing between related groups), similarity (similar elements share spacing and size; leading elements align), proximity (an action sits near the content it affects). Nielsen\'s interaction heuristics need a flow, not a screenshot: leave them out.',
    '- Answer each checklist item yes, no or n/a for what the images and the measurements show; tie each no to a mark id.',
    '- Report defects, not taste: the owner chose the direction, palette and logo.',
    '- Your slice, from the end of your pass id: -c1 looks hardest at the first view, hierarchy and economy (FV, H, E); -c2 at layout and typography (L, T); -c3 at contrast, copy, states, motion and the features (C, W, S, M, F). Answer every item all the same.',
    '',
    '## Output',
    '',
    'kind critique: exactly one JSON object `{"pass_id": "<id>", "kind": "critique", "checklist": [{"id": "<item id>", "answer": "yes|no|n/a", "mark": "<id, for a no>"}], "issues": [{"mark": "<id>", "item": "<item id>", "category": "<category>", "problem": "<measured problem>", "fix": "<one concrete change in the tokens>"}]}`.',
    `Categories: ${ISSUE_CATEGORIES.join(', ')}. At most ${MAX_ISSUES} issues, most important first. An issue without a mark id from the marks file, a measured problem and a concrete fix is discarded.`,
    '',
    'kind pairwise: the task message lists the tiles of version A and of version B. Answer every checklist item for each, then exactly one JSON object `{"pass_id": "<id>", "kind": "pairwise", "checklist": [{"id": "<item id>", "a": "yes|no|n/a", "b": "yes|no|n/a"}], "preferred": "A|B|tie", "reason": "<one sentence>"}`. The order is swapped in another pass, so never guess which version is newer; when the difference is small, answer tie.',
    '',
    'The JSON shapes are $defs.critique and $defs.pairwise of the skill\'s assets/schemas/critic-output.schema.json.',
    '',
  );
  return lines.join('\n');
}

/**
 * Writes marks.json, checklist.json, the problems file and the task file of a capture; returns their paths.
 * @param {CaptureResult} c
 * @param {{brief: BriefInfo, round: number, label: string, root: string, uiRoot: string, design: string,
 *   gates?: GateSummary | null, gatesFile?: string | null}} context
 * @returns {{marks: string, checklist: string, problems: string, task: string}}
 */
function writeCaptureFiles(c, context) {
  const marksFile = path.join(c.dir, 'marks.json');
  const checklistFile = path.join(c.dir, 'checklist.json');
  const problemsFile = path.join(c.dir, 'measure-problems.json');
  const at = utcSeconds();
  writeJson(marksFile, {
    version: 1, at, url: c.url,
    viewports: c.viewports,
    marks: c.marks.map((m) => ({ id: m.id, route: m.route, route_name: m.routeName, selector: m.selector, kind: m.kind, kinds: m.kinds, tag: m.tag, role: m.role, text: m.text, attrs: m.attrs, views: m.views, tiles: m.tiles })),
  });
  writeJson(checklistFile, { version: 1, at, proposition: c.proposition, items: c.checklist });
  writeJson(problemsFile, { version: 1, at, scores: c.scores, problems: c.problems, notes: c.notes });
  const task = writeText(path.join(c.dir, 'task.md'), taskMarkdown({ capture: c, ...context, marksFile, checklistFile }));
  return { marks: toPosix(path.resolve(marksFile)), checklist: toPosix(path.resolve(checklistFile)), problems: toPosix(path.resolve(problemsFile)), task };
}

// ------------------------------------------------------------------------------------------------ targets, gates, git

/**
 * @typedef {{baseUrl: string, close: () => Promise<void>, kind: 'serve' | 'url' | 'start', serveDir: string | null,
 *   checkerArgs: string[]}} OpenTarget
 */

/**
 * Opens the target of the shared check flags: `--serve <dir>` (a static build), `--url <url>` (a running app), or
 * `--start "<cmd>" --url <url>` (the command is spawned and stopped afterwards).
 * @param {{serve?: string, url?: string, start?: string, 'start-timeout'?: string}} values
 * @param {(line: string) => void} log
 * @returns {Promise<OpenTarget>}
 */
export async function openTarget(values, log) {
  const given = ['serve', 'url'].filter((k) => typeof values[/** @type {'serve' | 'url'} */ (k)] === 'string');
  if (values.serve && values.url) throw new UsageError('pass one of --serve <dir> or --url <url>, not both');
  if (values.start && !values.url) throw new UsageError('--start needs --url http://127.0.0.1:<port> (where the started server answers)');
  if (given.length === 0) throw new UsageError('no target: pass --serve <built folder>, --url <url>, or --start "<cmd>" --url <url>');
  if (values.serve) {
    const dir = path.resolve(values.serve);
    const server = await serveStatic(dir);
    return { baseUrl: server.url, close: server.close, kind: 'serve', serveDir: toPosix(dir), checkerArgs: ['--serve', toPosix(dir)] };
  }
  const url = /** @type {string} */ (values.url);
  if (!values.start) return { baseUrl: url, close: async () => {}, kind: 'url', serveDir: null, checkerArgs: ['--url', url] };
  const seconds = values['start-timeout'] === undefined ? 60 : Number(values['start-timeout']);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new UsageError('--start-timeout must be a positive number of seconds');
  const handle = await startWatched(values.start, url, seconds * 1000, log);
  return { baseUrl: url, close: handle.close, kind: 'start', serveDir: null, checkerArgs: ['--url', url] };
}

/**
 * Starts the app with frontend-check's own startServer (same refusal of a URL that already answers, same tree kill
 * and survivor check), and kills the tree from an exit or signal handler if critique ends before close() runs.
 * @param {string} command
 * @param {string} url
 * @param {number} timeoutMs
 * @param {(line: string) => void} log
 * @returns {Promise<{close: () => Promise<void>}>}
 */
async function startWatched(command, url, timeoutMs, log) {
  /** @type {import('./frontend-check.mjs').StartedServer | null} */
  let started = null;
  const killStarted = () => started?.stopSync();
  /** @param {NodeJS.Signals} signal */
  const onSignal = (signal) => {
    killStarted();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('exit', killStarted);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const release = () => {
    process.off('exit', killStarted);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  };
  try {
    started = await startServer(command, url, { timeoutMs, log, onSpawn: (h) => { started = h; } });
  } catch (err) {
    release();
    throw err;
  }
  const handle = started;
  return {
    close: async () => {
      try {
        await handle.stop();
      } finally {
        release();
      }
    },
  };
}

/**
 * Closes the browser and the target together; one failing never leaves the other open (a started server running).
 * @param {{close: () => Promise<unknown>} | null} browser
 * @param {OpenTarget} target
 */
async function closeAll(browser, target) {
  const settled = await Promise.allSettled([browser ? browser.close() : Promise.resolve(), target.close()]);
  const failed = settled.filter((r) => r.status === 'rejected').map((r) => /** @type {PromiseRejectedResult} */ (r).reason);
  if (failed.length === 1) throw failed[0];
  if (failed.length > 1) throw new AggregateError(failed, 'closing the browser and the target both failed');
}

/**
 * Runs frontend-check (another process, so the gates run exactly as the proof runs them) and returns its report.
 * @param {{checker: string, root: string, profilePath: string | null, state: string, targetArgs: string[], gates?: string | null,
 *   log: (line: string) => void}} options
 * @returns {GateReport}
 */
export function runGates(options) {
  if (!existsSync(options.checker)) {
    throw new EnvError(`frontend-check not found at ${toPosix(options.checker)}; restore the skill's scripts, or pass --gates-report <file> with a report of this build`);
  }
  const args = [options.checker, '--json', ...(options.gates ? ['--gates', options.gates] : ['--phase', 'build']), '--root', options.root, '--state', options.state];
  if (options.profilePath) args.push('--profile', options.profilePath);
  args.push(...options.targetArgs);
  options.log(`gates: node ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
  const res = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000, windowsHide: true });
  if (res.error) throw new EnvError(`frontend-check could not run: ${res.error.message}`, { cause: res.error });
  const tail = (res.stderr ?? '').trim().split('\n').slice(-5).join(' | ');
  if (res.status !== 0 && res.status !== 1) {
    const message = `frontend-check exited with ${res.status}: ${tail}`;
    throw res.status === 2 ? new UsageError(message) : new EnvError(message);
  }
  return parseGateReport(res.stdout ?? '', 'frontend-check stdout');
}

/**
 * @param {string} text
 * @param {string} what
 * @returns {GateReport}
 */
function parseGateReport(text, what) {
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new EnvError(`${what} is not one JSON gate report (${err instanceof Error ? err.message : String(err)})`, { cause: err });
  }
  if (!isObject(raw) || !Array.isArray(raw.gates) || typeof raw.ok !== 'boolean') throw new EnvError(`${what} is not a gate report {ok, counts, gates} (CONTRACTS section 4)`);
  return /** @type {GateReport} */ (/** @type {unknown} */ (raw));
}

/**
 * The gate summary the fragment reads: ok, the counts, and every gate that is fail or skipped (a skipped gate never
 * counts as passing).
 * @param {GateReport} report
 * @returns {GateSummary}
 */
export function summariseGates(report) {
  /** @type {{ok: number, fail: number, skipped: number}} */
  const counts = { ok: 0, fail: 0, skipped: 0 };
  for (const g of report.gates) if (g.state in counts) counts[/** @type {'ok' | 'fail' | 'skipped'} */ (g.state)] += 1;
  const failing = report.gates.filter((g) => g.state !== 'ok').map((g) => g.id);
  return { ok: report.ok === true && failing.length === 0, counts, failing };
}

/**
 * Problems a failing gate measured on an element, tied to the mark of the same route and selector: they confirm a
 * critic's issue on that mark.
 * @param {GateReport} report
 * @param {MarkRegistry} registry
 * @returns {Problem[]}
 */
export function gateProblems(report, registry) {
  /** @type {Problem[]} */
  const out = [];
  for (const g of report.gates) {
    if (g.state !== 'fail') continue;
    for (const ev of g.evidence ?? []) {
      if (typeof ev.selector !== 'string' || !ev.selector) continue;
      const mark = registry.find(typeof ev.route === 'string' ? ev.route : '', ev.selector);
      if (!mark) continue;
      const value = ev.value === undefined || ev.value === null ? '' : String(ev.value);
      out.push({
        mark: mark.id, check: g.id, item: '', problem: `${g.detail}${value ? ` (${value})` : ''}`.slice(0, 300),
        fix: `fix the page until ${g.id} passes (gates.json has the evidence)`, route: typeof ev.route === 'string' ? ev.route : mark.route,
        viewport: typeof ev.viewport === 'string' ? ev.viewport : '', selector: ev.selector, value,
      });
    }
  }
  return out;
}

/**
 * @param {string} root
 * @param {string[]} args
 * @returns {string}
 */
function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
  } catch (err) {
    const stderr = isObject(err) && typeof err.stderr === 'string' ? err.stderr.trim() : '';
    throw new EnvError(`git ${args.join(' ')} failed in ${toPosix(root)}${stderr ? `: ${stderr.split('\n')[0]}` : ''}; the critique needs a git work tree with a commit`, { cause: err });
  }
}

/**
 * @param {string} root
 * @param {string} rel
 * @returns {string | null}
 */
function treeOf(root, rel) {
  try {
    return git(root, ['rev-parse', rel === '.' || rel === '' ? 'HEAD^{tree}' : `HEAD:${rel}`]);
  } catch {
    return null;
  }
}

/**
 * The git state of a measure: HEAD, the UI folder (`--ui-root`, else the tracked parent of the served build folder,
 * else the whole tree) and the tree id of that folder at HEAD, which survives a rebase when nothing else touched the UI.
 * @param {string} root
 * @param {string | null} uiRootFlag
 * @param {string | null} serveDir
 * @returns {{sha: string, uiRoot: string, uiTree: string, dirty: boolean}}
 */
export function gitState(root, uiRootFlag, serveDir) {
  const sha = git(root, ['rev-parse', 'HEAD']);
  let uiRoot = '.';
  if (uiRootFlag) {
    uiRoot = toPosix(path.relative(root, path.resolve(root, uiRootFlag))) || '.';
  } else if (serveDir) {
    const rel = toPosix(path.relative(root, serveDir));
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      for (let p = path.posix.dirname(rel); p && p !== '.'; p = path.posix.dirname(p)) {
        if (treeOf(root, p)) {
          uiRoot = p;
          break;
        }
      }
    }
  }
  const uiTree = treeOf(root, uiRoot);
  if (!uiTree) throw new EnvError(`the UI folder ${uiRoot} is not tracked at HEAD in ${toPosix(root)}; commit it, or pass --ui-root`);
  const status = git(root, ['status', '--porcelain', '--', uiRoot === '.' ? '.' : uiRoot]);
  return { sha, uiRoot, uiTree, dirty: status.length > 0 };
}

// ------------------------------------------------------------------------------------------------ issues, acceptance, probes

/**
 * The critic outputs of a round that match $defs.critique of critic-output.schema.json; the others are reported.
 * @param {string[]} files
 * @returns {{valid: Array<Record<string, unknown> & {file: string}>, invalid: Array<{file: string, errors: string[]}>}}
 */
export function loadCriticResults(files) {
  const schema = loadSchema(CRITIC_SCHEMA);
  const critique = resolveRef(schema, '#/$defs/critique');
  /** @type {Array<Record<string, unknown> & {file: string}>} */
  const valid = [];
  /** @type {Array<{file: string, errors: string[]}>} */
  const invalid = [];
  for (const file of files) {
    /** @type {unknown} */
    let raw;
    try {
      raw = JSON.parse(readText(file));
    } catch (err) {
      invalid.push({ file: toPosix(file), errors: [`not JSON: ${err instanceof Error ? err.message : String(err)}`] });
      continue;
    }
    const errors = validateSchema(critique, raw, schema);
    if (errors.length > 0 || !isObject(raw)) invalid.push({ file: toPosix(file), errors: errors.length > 0 ? errors : ['not an object'] });
    else valid.push({ ...raw, file: toPosix(file) });
  }
  return { valid, invalid };
}

/**
 * Keeps an issue when two critics raise it (same mark and same item, or same category without an item) or a
 * deterministic check measured a problem on its mark, while it has been tried fewer than `maxAttempts` times;
 * confirmed issues first, then by votes, then by order of appearance; at most `maxIssues` (CR-06, CR-07). The same
 * rule as feCritique's consolidate().
 * @param {Array<Record<string, unknown>>} results
 * @param {Array<{mark: string}>} deterministic
 * @param {Record<string, number>} attempts
 * @param {{maxIssues?: number, maxAttempts?: number}} [options]
 * @returns {{issues: KeptIssue[], dropped: number}}
 */
export function consolidateIssues(results, deterministic, attempts, { maxIssues = MAX_ISSUES, maxAttempts = MAX_ATTEMPTS } = {}) {
  const confirmed = new Set(deterministic.filter((d) => isObject(d) && typeof d.mark === 'string').map((d) => d.mark));
  /** @type {Array<{key: string, mark: string, category: string, item: string, problem: string, fix: string, voters: Set<number>, order: number}>} */
  const entries = [];
  /** @type {Map<string, (typeof entries)[number]>} */
  const byKey = new Map();
  results.forEach((result, critic) => {
    const seen = new Set();
    const issues = Array.isArray(result.issues) ? result.issues.slice(0, maxIssues) : [];
    for (const issue of issues) {
      if (!isObject(issue) || !str(issue.mark) || !str(issue.problem) || !str(issue.fix) || typeof issue.category !== 'string') continue;
      const item = str(issue.item);
      const key = `${issue.mark}|${item || issue.category}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let entry = byKey.get(key);
      if (!entry) {
        entry = { key, mark: str(issue.mark), category: issue.category, item, problem: str(issue.problem), fix: str(issue.fix), voters: new Set(), order: entries.length };
        byKey.set(key, entry);
        entries.push(entry);
      }
      entry.voters.add(critic);
    }
  });
  const kept = entries
    .map((entry) => ({ entry, votes: entry.voters.size, confirmed: confirmed.has(entry.mark) }))
    .filter((k) => (k.votes >= 2 || k.confirmed) && (attempts[k.entry.key] ?? 0) < maxAttempts)
    .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.votes - a.votes || a.entry.order - b.entry.order);
  const issues = kept.slice(0, maxIssues).map((k) => ({
    key: k.entry.key, mark: k.entry.mark, category: k.entry.category, item: k.entry.item, problem: k.entry.problem, fix: k.entry.fix, votes: k.votes, confirmed: k.confirmed,
  }));
  return { issues, dropped: entries.length - issues.length };
}

/**
 * A pairwise verdict file's preference, or null when the file is absent or invalid.
 * @param {string | null} file
 * @returns {{preferred: string | null, errors: string[]}}
 */
export function readPairwise(file) {
  if (!file || !existsSync(file)) return { preferred: null, errors: file ? [`missing ${toPosix(file)}`] : [] };
  const schema = loadSchema(CRITIC_SCHEMA);
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readText(file));
  } catch (err) {
    return { preferred: null, errors: [`${toPosix(file)} is not JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const errors = validateSchema(resolveRef(schema, '#/$defs/pairwise'), raw, schema);
  if (errors.length > 0 || !isObject(raw)) return { preferred: null, errors: errors.map((e) => `${toPosix(file)} ${e}`) };
  return { preferred: str(raw.preferred), errors: [] };
}

/**
 * The acceptance rule (ARCHITECTURE section 6, CR-09): a gate that passed on the best-so-far and does not pass on the
 * candidate rejects it; a sub-score that drops or disappears rejects it; and the candidate must win the pairwise
 * verdict in both orders (A = best and B = candidate gives B; A = candidate and B = best gives A). Disagreement across
 * the two orders counts as no improvement (FD17-F14, F28).
 * @param {Snapshot} best
 * @param {Snapshot} candidate
 * @param {string | null} ab verdict with A = best-so-far, B = candidate
 * @param {string | null} ba verdict with A = candidate, B = best-so-far
 * @returns {{accepted: boolean, reasons: string[], pairwise: Pairwise, improved: string[]}}
 */
export function decide(best, candidate, ab, ba) {
  /** @type {string[]} */
  const reasons = [];
  const regressions = candidate.gates.failing.filter((id) => !best.gates.failing.includes(id));
  if (regressions.length > 0) reasons.push(`gate regression: ${regressions.join(', ')}`);
  const improved = best.gates.failing.filter((id) => !candidate.gates.failing.includes(id));
  for (const [key, before] of Object.entries(best.scores)) {
    if (typeof before !== 'number') continue;
    const after = candidate.scores[key];
    if (typeof after !== 'number') reasons.push(`score ${key} missing`);
    else if (after < before) reasons.push(`score ${key} dropped from ${before} to ${after}`);
  }
  const consistent = (ab === 'B' && ba === 'A') || (ab === 'A' && ba === 'B') || (ab === 'tie' && ba === 'tie');
  if (!(ab === 'B' && ba === 'A')) reasons.push(`pairwise: the candidate was not preferred in both orders (best as A: ${ab}; candidate as A: ${ba})`);
  return { accepted: reasons.length === 0, reasons, pairwise: { ab, ba, consistent }, improved };
}

/**
 * The blind probe pass (CR-12): per viewport, the probe answers and the judge's verdicts; it passes when at least
 * `minMatch` of `of` probes restate the proposition on every viewport. A viewport without answers counts as 0.
 * @param {Array<{viewport: string, answers: Array<{probe: string, answer: string}>, verdicts: Record<string, boolean>}>} viewports
 * @param {{of: number, minMatch: number, measuredOn: number}} options
 * @returns {{pass: boolean, min_match: number, of: number, measured_on: number, viewports: Array<{viewport: string, matched: number, total: number, answers: Array<{probe: string, answer: string, restates: boolean}>}>}}
 */
export function evaluateProbes(viewports, { of, minMatch, measuredOn }) {
  const per = viewports.map((v) => {
    const answers = v.answers.map((a) => ({ probe: a.probe, answer: a.answer, restates: v.verdicts[a.probe] === true }));
    return { viewport: v.viewport, matched: answers.filter((a) => a.restates).length, total: of, answers };
  });
  return { pass: per.length > 0 && per.every((v) => v.matched >= minMatch), min_match: minMatch, of, measured_on: measuredOn, viewports: per };
}

/**
 * Reads a probes folder: one sub-folder per viewport holding the probe answers (any *.json except match.json, in name
 * order, probe-output.schema.json) and match.json (the judge's probe-match verdicts).
 * @param {string} dir
 * @param {string[]} viewports
 * @returns {{viewports: Array<{viewport: string, answers: Array<{probe: string, answer: string}>, verdicts: Record<string, boolean>}>, errors: string[]}}
 */
export function readProbes(dir, viewports) {
  const probeSchema = loadSchema(PROBE_SCHEMA);
  const criticSchema = loadSchema(CRITIC_SCHEMA);
  const matchSchema = resolveRef(criticSchema, '#/$defs/probeMatch');
  /** @type {string[]} */
  const errors = [];
  const out = viewports.map((viewport) => {
    const vdir = path.join(dir, viewport);
    /** @type {Array<{probe: string, answer: string}>} */
    const answers = [];
    /** @type {Record<string, boolean>} */
    const verdicts = {};
    if (!existsSync(vdir)) return { viewport, answers, verdicts };
    const files = readdirSync(vdir).filter((f) => f.endsWith('.json') && f !== 'match.json').sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    for (const f of files) {
      const raw = safeJson(path.join(vdir, f), errors);
      if (raw === undefined) continue;
      const bad = validateSchema(probeSchema, raw, probeSchema);
      if (bad.length > 0 || !isObject(raw)) {
        errors.push(`${toPosix(path.join(vdir, f))}: ${bad.join('; ')}`);
        continue;
      }
      answers.push({ probe: f.replace(/\.json$/, ''), answer: str(raw.answer) });
    }
    const matchFile = path.join(vdir, 'match.json');
    if (existsSync(matchFile)) {
      const raw = safeJson(matchFile, errors);
      const bad = raw === undefined ? ['unreadable'] : validateSchema(matchSchema, raw, criticSchema);
      if (bad.length > 0 || !isObject(raw)) errors.push(`${toPosix(matchFile)}: ${bad.join('; ')}`);
      else if (Array.isArray(raw.matches)) for (const m of raw.matches) if (isObject(m) && typeof m.probe === 'string') verdicts[m.probe] = m.restates === true;
    }
    return { viewport, answers, verdicts };
  });
  return { viewports: out, errors };
}

/**
 * @param {string} file
 * @param {string[]} errors
 * @returns {unknown}
 */
function safeJson(file, errors) {
  try {
    return JSON.parse(readText(file));
  } catch (err) {
    errors.push(`${toPosix(file)}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/**
 * The snapshot a receipt keeps of a measure.
 * @param {Record<string, unknown>} m
 * @returns {Snapshot}
 */
export function snapshotOf(m) {
  const gates = isObject(m.gates) ? m.gates : {};
  const counts = isObject(gates.counts) ? gates.counts : {};
  /** @type {Record<string, number>} */
  const scores = {};
  if (isObject(m.scores)) for (const [k, v] of Object.entries(m.scores)) if (typeof v === 'number') scores[k] = v;
  return {
    round: typeof m.round === 'number' ? m.round : 0,
    sha: str(m.sha),
    ui_tree: str(m.ui_tree),
    gates: {
      ok: gates.ok === true,
      counts: { ok: Number(counts.ok) | 0, fail: Number(counts.fail) | 0, skipped: Number(counts.skipped) | 0 },
      failing: Array.isArray(gates.failing) ? gates.failing.filter((id) => typeof id === 'string') : [],
    },
    scores,
  };
}

/**
 * @param {string} file
 * @returns {Record<string, unknown>}
 */
function loadMeasure(file) {
  const raw = readJson(file, 'measure');
  if (!isObject(raw) || typeof raw.sha !== 'string' || !isObject(raw.gates) || !isObject(raw.scores) || !Array.isArray(raw.deterministic)) {
    throw new UsageError(`${toPosix(file)} is not a measure file (critique.mjs measure writes measure.json)`);
  }
  return raw;
}

/**
 * @param {string} state
 * @returns {{attempts: Record<string, number>, rejected: Array<Record<string, unknown>>}}
 */
function loadHistory(state) {
  const file = path.join(state, 'critique', 'history.json');
  if (!existsSync(file)) return { attempts: {}, rejected: [] };
  const raw = readJson(file, 'critique history');
  if (!isObject(raw)) return { attempts: {}, rejected: [] };
  /** @type {Record<string, number>} */
  const attempts = {};
  if (isObject(raw.attempts)) for (const [k, v] of Object.entries(raw.attempts)) if (typeof v === 'number') attempts[k] = v;
  return { attempts, rejected: Array.isArray(raw.rejected) ? raw.rejected.filter(isObject) : [] };
}

/**
 * The measure file of the best-so-far: `--best`, else the pointer in <state>/critique/best.json.
 * @param {string} state
 * @param {string | undefined} flag
 * @returns {string}
 */
function bestMeasureFile(state, flag) {
  if (flag) return path.resolve(flag);
  const pointer = path.join(state, 'critique', 'best.json');
  if (!existsSync(pointer)) throw new UsageError(`no best-so-far: ${toPosix(pointer)} is missing; measure the baseline first (critique.mjs measure --round 0 --label baseline) or pass --best <measure.json>`);
  const raw = readJson(pointer, 'best-so-far pointer');
  if (!isObject(raw) || typeof raw.measure !== 'string') throw new UsageError(`${toPosix(pointer)} does not name a measure file`);
  return raw.measure;
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function jsonFilesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map((f) => path.join(dir, f));
}

// ------------------------------------------------------------------------------------------------ receipt verification

/**
 * The FE-20 proof: the receipt validates against critique-receipt.schema.json, its checksum matches, ok is true, and
 * best.ui_tree is still a tree of HEAD (at `--ui-root` when given, else anywhere in HEAD), so the UI was not changed
 * after the critique.
 * @param {string} file
 * @param {{root: string, uiRoot?: string | null}} options
 * @returns {{ok: boolean, errors: string[]}}
 */
export function verifyReceipt(file, { root, uiRoot = null }) {
  /** @type {string[]} */
  const errors = [];
  const abs = path.resolve(file);
  if (!existsSync(abs)) return { ok: false, errors: [`receipt not found: ${toPosix(abs)}`] };
  /** @type {unknown} */
  let receipt;
  try {
    receipt = JSON.parse(readText(abs));
  } catch (err) {
    return { ok: false, errors: [`receipt is not JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const schema = loadSchema(RECEIPT_SCHEMA);
  errors.push(...validateSchema(schema, receipt, schema).map((e) => `schema: ${e}`));
  if (!isObject(receipt)) return { ok: false, errors };
  const expected = receiptChecksum(receipt);
  if (receipt.checksum !== expected) errors.push(`checksum ${String(receipt.checksum)} does not match the content (${expected}); the receipt was edited or mis-transcribed`);
  if (receipt.ok !== true) errors.push(`receipt ok is ${JSON.stringify(receipt.ok)}${typeof receipt.stop_reason === 'string' ? ` (stop: ${receipt.stop_reason})` : ''}${receipt.error ? `: ${String(receipt.error)}` : ''}`);
  const best = isObject(receipt.best) ? receipt.best : null;
  const tree = best && typeof best.ui_tree === 'string' ? best.ui_tree : '';
  if (tree) {
    if (uiRoot) {
      const rel = toPosix(path.relative(root, path.resolve(root, uiRoot))) || '.';
      const head = treeOf(root, rel);
      if (!head) errors.push(`${rel} is not a tree at HEAD in ${toPosix(root)}`);
      else if (!head.startsWith(tree) && !tree.startsWith(head)) errors.push(`best.ui_tree ${tree} is not HEAD:${rel} (${head}); the UI changed after the critique, run it again`);
    } else {
      const trees = new Set([git(root, ['rev-parse', 'HEAD^{tree}'])]);
      for (const line of git(root, ['ls-tree', '-r', '-d', 'HEAD']).split('\n')) {
        const m = /^\d+\s+tree\s+([0-9a-f]+)\t/.exec(line);
        if (m) trees.add(m[1]);
      }
      if (![...trees].some((t) => t.startsWith(tree) || tree.startsWith(t))) errors.push(`best.ui_tree ${tree} is no longer a folder of HEAD; the UI changed after the critique, run it again`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// ------------------------------------------------------------------------------------------------ ui copy

/**
 * The rendered text of every route as Markdown for /prose (CT-21, CP-19), one section per route, grouped by element
 * kind (headings, text, controls, status and messages), each text its own paragraph; selectors go to ui-copy.json.
 * @param {{browser: Browser, baseUrl: string, routes: Route[], profile: Profile, projectName: string, log?: (line: string) => void}} options
 * @returns {Promise<{markdown: string, entries: Array<{route: string, kind: string, text: string, selector: string}>}>}
 */
export async function extractUiCopy(options) {
  const viewport = captureViewports(options.profile)[0];
  /** @type {Array<{route: string, kind: string, text: string, selector: string}>} */
  const entries = [];
  const lines = [`# UI copy: ${options.projectName || 'this project'}`, '', `Rendered text of every route at ${viewport.width}x${viewport.height}, extracted by critique.mjs ui-copy on ${utcSeconds()}. Edit the source, never this file.`, ''];
  const groups = /** @type {const} */ (['Headings', 'Text', 'Controls', 'Status and messages']);
  for (const route of options.routes) {
    const url = routeUrl(options.baseUrl, route, options.profile);
    options.log?.(`ui copy of ${route.path}`);
    await withPage(options.browser, viewport, url, async (page) => {
      const elements = await page.evaluate(collectElements, { textMax: 0, styles: false });
      const texts = await page.evaluate(collectText, {});
      const index = new Map(elements.map((el, i) => [el.sel, i]));
      /** @type {Record<string, string[]>} */
      const byGroup = { Headings: [], Text: [], Controls: [], 'Status and messages': [] };
      for (const t of texts) {
        if (!t.visible) continue;
        const i = index.get(t.sel) ?? -1;
        let group = 'Text';
        if (t.source === 'value' || t.source === 'placeholder') group = 'Controls';
        for (const j of i >= 0 ? selfAndAncestors(elements, i) : []) {
          const el = elements[j];
          if (el.role === 'heading') {
            group = 'Headings';
            break;
          }
          if (isInteractive(el) || el.tag === 'label') {
            group = 'Controls';
            break;
          }
          if (['status', 'alert', 'log'].includes(el.role) || Object.hasOwn(el.attrs, 'data-status')) {
            group = 'Status and messages';
            break;
          }
        }
        const text = normaliseText(t.text);
        const list = byGroup[group];
        if (!text || list[list.length - 1] === text) continue;
        list.push(text);
        entries.push({ route: route.path, kind: group, text, selector: t.sel });
      }
      lines.push(`## ${route.path} (${route.name})`, '');
      for (const g of groups) {
        if (byGroup[g].length === 0) continue;
        lines.push(`### ${g}`, '');
        for (const text of byGroup[g]) lines.push(text, '');
      }
    }, { readyFlag: options.profile.ready_flag });
  }
  return { markdown: `${lines.join('\n').trimEnd()}\n`, entries };
}

// ------------------------------------------------------------------------------------------------ CLI

const HELP = `Usage:
  node critique.mjs prepare  [target] [--round <n>] [--label <name>] [--out <dir>] [--max-tiles <n>] [common]
  node critique.mjs measure  [target] --round <n> --label <name> [--ui-root <dir>] [--gates <ids> | --gates-report <file>] [common]
  node critique.mjs issues   --round <n> [--best <measure.json>] [--critic <file>]... [common]
  node critique.mjs accept   --round <n> [--best <file>] [--candidate <file>] [--critic <file>]...
                             [--pairwise-ab <file>] [--pairwise-ba <file>] [--probes <dir>]
                             [--best-gates <report>] [--candidate-gates <report>] [common]
  node critique.mjs probes   --round <n> [--probes <dir>] [common]
  node critique.mjs ui-copy  [target] [--out <file>] [common]
  node critique.mjs --verify-receipt <receipt.json> [--root <repo>] [--ui-root <dir>] [--json]

The deterministic half of the critique stage (ARCHITECTURE.md section 6): marked tiles, marks, the checklist, squint
tiles and measurements for the critics; the acceptance rule and the receipts; the copy export for /prose.

Target (prepare, measure, ui-copy), as frontend-check: --serve <built folder> | --url <url> | --start "<cmd>" --url <url>
  --start-timeout <s>    how long to wait for a started server, in seconds as in frontend-check (default 60)

Common:
  --root <repo>          repository root (default: the working directory)
  --profile <file>       /execution profile.json or a bare frontend block (default: discovered from --root)
  --state <dir>          state folder (default: .execution/frontend in mode A, .frontend in mode B)
  --json                 print the result as one JSON object on stdout
  -h, --help             this text

prepare and measure write <state>/critique/round-<n>/<label>/ (or --out): tiles/ (clean and .marked.png, at most
--max-tiles per version, default and maximum ${MAX_TILES}, so a pairwise call reads at most ${MAX_IMAGES_PER_CALL} images), squint/ (first
view blurred at 5, 10 and 20 px), marks.json, checklist.json, measure-problems.json and task.md (the critic task
file). measure also runs frontend-check --phase build (or --gates <ids>) as a separate process (--checker <file>
replaces frontend-check.mjs; --gates-report <file> uses a report already made for this build), reads git HEAD and
the UI tree (--ui-root, else the tracked parent of the --serve folder), writes gates.json and measure.json, and prints
the measure object of assets/schemas/fragment-commands.schema.json. Round 0 labelled baseline becomes the
best-so-far (<state>/critique/best.json).

issues and accept read the round folder <state>/critique/round-<n>/: critics/*.json (critic outputs, kind critique),
pairwise-ab.json (A = best-so-far, B = candidate) and pairwise-ba.json (A = candidate, B = best-so-far),
candidate/measure.json, and probes/<viewport>/ (probe answers plus match.json). --best-gates and --candidate-gates
take frontend-check reports that replace the gate summaries of the two measures. accept writes receipt.json there,
moves best.json to an accepted candidate and records attempts and rejected fixes in <state>/critique/history.json.

Exit codes: 0 ok (prepared, measured, accepted or no issue kept, probes passed, receipt valid); 1 the candidate was
rejected, the probes failed or the receipt check failed; 2 usage (bad flags, missing input file); 3 environment (no
browser, no git, frontend-check missing or crashed).`;

const OPTIONS = /** @type {const} */ ({
  round: { type: 'string' },
  label: { type: 'string' },
  root: { type: 'string' },
  profile: { type: 'string' },
  state: { type: 'string' },
  serve: { type: 'string' },
  url: { type: 'string' },
  start: { type: 'string' },
  'start-timeout': { type: 'string' },
  out: { type: 'string' },
  'max-tiles': { type: 'string' },
  'ui-root': { type: 'string' },
  gates: { type: 'string' },
  'gates-report': { type: 'string' },
  checker: { type: 'string' },
  best: { type: 'string' },
  candidate: { type: 'string' },
  critic: { type: 'string', multiple: true },
  'pairwise-ab': { type: 'string' },
  'pairwise-ba': { type: 'string' },
  'best-gates': { type: 'string' },
  'candidate-gates': { type: 'string' },
  probes: { type: 'string' },
  'verify-receipt': { type: 'string' },
  json: { type: 'boolean' },
});

/**
 * @param {string | undefined} value
 * @param {string} flag
 * @param {number} fallback
 * @returns {number}
 */
function intFlag(value, flag, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new UsageError(`${flag} must be a non-negative integer (got ${JSON.stringify(value)})`);
  return Number(value);
}

/**
 * @param {string | undefined} value
 * @param {string} fallback
 * @returns {string}
 */
function labelFlag(value, fallback) {
  const label = value ?? fallback;
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(label)) throw new UsageError(`--label must be lowercase letters, digits and hyphens (got ${JSON.stringify(label)})`);
  return label;
}

/**
 * @param {Record<string, unknown>} values
 * @returns {{root: string, profile: Profile, profilePath: string | null, state: string, design: string}}
 */
function context(values) {
  const root = path.resolve(typeof values.root === 'string' ? values.root : '.');
  const profile = loadProfile(typeof values.profile === 'string' ? values.profile : undefined, { root });
  const state = stateDir(root, profile, typeof values.state === 'string' ? values.state : null);
  return { root: toPosix(root), profile, profilePath: profile.source.path, state, design: designDir(root, profile) };
}

/**
 * @param {unknown} result
 * @param {boolean} json
 * @param {string} summary
 */
function emit(result, json, summary) {
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  logLine(summary);
}

/**
 * Runs prepare or measure.
 * @param {'prepare' | 'measure'} command
 * @param {CliOptions} values
 * @returns {Promise<number>}
 */
async function runCapture(command, values) {
  const round = intFlag(values.round, '--round', 0);
  if (command === 'measure' && (values.round === undefined || values.label === undefined)) throw new UsageError('measure needs --round <n> and --label <name> (the fragment passes them)');
  const label = labelFlag(values.label, 'baseline');
  const ctx = context(values);
  const brief = loadBrief(ctx.state);
  const routes = loadRoutes(ctx.root, ctx.profile);
  const dir = path.resolve(values.out ?? path.join(ctx.state, 'critique', `round-${round}`, label));
  const maxTiles = intFlag(values['max-tiles'], '--max-tiles', MAX_TILES);
  const git0 = command === 'measure' ? gitState(ctx.root, values['ui-root'] ?? null, values.serve ? path.resolve(values.serve) : null) : null;
  if (git0?.dirty) logLine(`warning: ${git0.uiRoot} has uncommitted changes; the measure names HEAD ${git0.sha.slice(0, 12)}, not what was served`);
  const target = await openTarget(values, logLine);
  let browser = null;
  try {
    browser = await launch();
    const c = await capture({ browser, baseUrl: target.baseUrl, routes, profile: ctx.profile, brief, dir, maxTiles, log: logLine });
    /** @type {GateSummary | null} */
    let gates = null;
    /** @type {string | null} */
    let gatesFile = null;
    /** @type {Problem[]} */
    let confirmations = [];
    if (command === 'measure') {
      const report = values['gates-report']
        ? parseGateReport(readText(path.resolve(values['gates-report'])), toPosix(path.resolve(values['gates-report'])))
        : runGates({ checker: path.resolve(values.checker ?? DEFAULT_CHECKER), root: ctx.root, profilePath: ctx.profilePath, state: ctx.state, targetArgs: target.checkerArgs, gates: values.gates ?? null, log: logLine });
      gatesFile = writeJson(path.join(dir, 'gates.json'), report);
      gates = summariseGates(report);
      const registry = new MarkRegistry();
      for (const m of c.marks) {
        registry.list.push(m);
        registry.byKey.set(`${m.route} ${m.selector}`, m);
      }
      confirmations = gateProblems(report, registry);
    }
    const uiRoot = git0?.uiRoot ?? '.';
    const files = writeCaptureFiles(c, { brief, round, label, root: ctx.root, uiRoot, design: ctx.design, gates, gatesFile });
    const deterministic = [...c.problems, ...confirmations].map((p) => ({ mark: p.mark, check: p.check, problem: p.problem, fix: p.fix, item: p.item, route: p.route, viewport: p.viewport, selector: p.selector }));
    const base = {
      round, label, dir: c.dir, at: utcSeconds(),
      scores: c.scores, deterministic, task_file: files.task, marks_file: files.marks, checklist_file: files.checklist,
      tiles: c.tiles, squint: c.squint, first_view: c.first_view, proposition: c.proposition,
      images: { critique: c.tiles.length + c.squint.length, pairwise: 2 * c.tiles.length, probe: 1 },
      skipped: c.skipped, notes: c.notes,
    };
    if (command === 'prepare') {
      emit(base, Boolean(values.json), `prepared ${c.tiles.length} tiles, ${c.marks.length} marks, ${c.checklist.length} checklist items in ${c.dir}`);
      return 0;
    }
    const g = /** @type {{sha: string, uiRoot: string, uiTree: string, dirty: boolean}} */ (git0);
    const measure = {
      round, label, sha: g.sha, ui_tree: g.uiTree, ui_root: g.uiRoot, dirty: g.dirty, dir: c.dir, at: base.at,
      gates, gates_report: gatesFile, ...Object.fromEntries(Object.entries(base).filter(([k]) => !['round', 'label', 'dir', 'at'].includes(k))),
    };
    const measureFile = writeJson(path.join(dir, 'measure.json'), measure);
    if (round === 0 && label === 'baseline') {
      writeJson(path.join(ctx.state, 'critique', 'best.json'), { version: 1, measure: measureFile, round, label, sha: g.sha, ui_tree: g.uiTree, at: base.at });
    }
    emit(measure, Boolean(values.json), `measured round ${round} (${label}): gates ${gates?.ok ? 'ok' : `failing ${gates?.failing.join(', ')}`}, ${c.tiles.length} tiles, scores ${Object.entries(c.scores).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    return 0;
  } finally {
    await closeAll(browser, target);
  }
}

/**
 * @param {CliOptions} values
 * @param {string} state
 * @param {number} round
 * @returns {{files: string[], results: Array<Record<string, unknown> & {file: string}>, invalid: Array<{file: string, errors: string[]}>}}
 */
function criticsOf(values, state, round) {
  const files = Array.isArray(values.critic) && values.critic.length > 0
    ? values.critic.map((f) => path.resolve(String(f)))
    : jsonFilesIn(path.join(state, 'critique', `round-${round}`, 'critics'));
  for (const f of files) if (!existsSync(f)) throw new UsageError(`critic output not found: ${toPosix(f)}`);
  const { valid, invalid } = loadCriticResults(files);
  return { files, results: valid, invalid };
}

/**
 * @param {CliOptions} values
 * @returns {number}
 */
function runIssues(values) {
  const ctx = context(values);
  const round = intFlag(values.round, '--round', 1);
  const best = loadMeasure(bestMeasureFile(ctx.state, values.best));
  const { results, invalid, files } = criticsOf(values, ctx.state, round);
  const history = loadHistory(ctx.state);
  const picked = consolidateIssues(results, /** @type {Array<{mark: string}>} */ (best.deterministic), history.attempts);
  const out = { round, critics_found: files.length, critics_returned: results.length, invalid, issues: picked.issues, dropped: picked.dropped, task_file: best.task_file };
  writeJson(path.join(ctx.state, 'critique', `round-${round}`, 'issues.json'), out);
  emit(out, Boolean(values.json), `round ${round}: ${picked.issues.length} issue(s) kept, ${picked.dropped} dropped, ${results.length} of ${files.length} critic outputs valid`);
  return 0;
}

/**
 * @param {CliOptions} values
 * @param {Profile} profile
 * @param {string} dir
 * @param {number} measuredOn
 * @returns {ReturnType<typeof evaluateProbes> & {errors: string[]} | null}
 */
function probeResult(values, profile, dir, measuredOn) {
  const probesDir = path.resolve(values.probes ?? path.join(dir, 'probes'));
  if (!existsSync(probesDir)) return null;
  const viewports = captureViewports(profile).map((v) => v.name);
  const read = readProbes(probesDir, viewports);
  const of = profile.critique.probes || 5;
  const result = evaluateProbes(read.viewports, { of, minMatch: Math.min(4, of), measuredOn });
  return { ...result, errors: read.errors };
}

/**
 * @param {CliOptions} values
 * @returns {number}
 */
function runAccept(values) {
  if (values.round === undefined) throw new UsageError('accept needs --round <n>');
  const round = intFlag(values.round, '--round', 1);
  if (round < 1) throw new UsageError('--round must be 1 or more for accept (round 0 is the baseline)');
  const ctx = context(values);
  const dir = path.join(ctx.state, 'critique', `round-${round}`);
  const bestFile = bestMeasureFile(ctx.state, values.best);
  const best = loadMeasure(bestFile);
  const { results, invalid, files } = criticsOf(values, ctx.state, round);
  const history = loadHistory(ctx.state);
  const picked = consolidateIssues(results, /** @type {Array<{mark: string}>} */ (best.deterministic), history.attempts);
  const bestSnap = snapshotOf(best);
  if (values['best-gates']) bestSnap.gates = summariseGates(parseGateReport(readText(path.resolve(values['best-gates'])), toPosix(path.resolve(values['best-gates']))));
  const candidateFile = path.resolve(values.candidate ?? path.join(dir, 'candidate', 'measure.json'));
  /** @type {Record<string, unknown>} */
  const roundEntry = {
    round, critics_asked: ctx.profile.critique.critics, critics_returned: results.length, issues: picked.issues, dropped: picked.dropped,
    candidate: null, pairwise: null, verdict: 'no-issue', reasons: [], restored: null,
  };
  let bestAfter = bestSnap;
  /** @type {string[]} */
  const inputErrors = invalid.map((i) => `${i.file}: ${i.errors.join('; ')}`);
  let exitCode = 0;
  if (picked.issues.length > 0 || existsSync(candidateFile)) {
    if (!existsSync(candidateFile)) throw new UsageError(`round ${round} kept ${picked.issues.length} issue(s) but has no candidate measure at ${toPosix(candidateFile)}; fix, then measure --round ${round} --label candidate`);
    const candidate = loadMeasure(candidateFile);
    const candSnap = snapshotOf(candidate);
    if (values['candidate-gates']) candSnap.gates = summariseGates(parseGateReport(readText(path.resolve(values['candidate-gates'])), toPosix(path.resolve(values['candidate-gates']))));
    const ab = readPairwise(path.resolve(values['pairwise-ab'] ?? path.join(dir, 'pairwise-ab.json')));
    const ba = readPairwise(path.resolve(values['pairwise-ba'] ?? path.join(dir, 'pairwise-ba.json')));
    inputErrors.push(...ab.errors, ...ba.errors);
    const verdict = decide(bestSnap, candSnap, ab.preferred, ba.preferred);
    roundEntry.candidate = candSnap;
    roundEntry.pairwise = verdict.pairwise;
    roundEntry.reasons = verdict.reasons;
    roundEntry.verdict = verdict.accepted ? 'accepted' : 'rejected';
    for (const issue of picked.issues) history.attempts[issue.key] = (history.attempts[issue.key] ?? 0) + 1;
    if (verdict.accepted) {
      bestAfter = candSnap;
      writeJson(path.join(ctx.state, 'critique', 'best.json'), { version: 1, measure: toPosix(candidateFile), round, label: str(candidate.label), sha: candSnap.sha, ui_tree: candSnap.ui_tree, at: utcSeconds() });
    } else {
      for (const issue of picked.issues) history.rejected.push({ round, key: issue.key, fix: issue.fix, reasons: verdict.reasons });
      exitCode = 1;
    }
    writeJson(path.join(ctx.state, 'critique', 'history.json'), { version: 1, attempts: history.attempts, rejected: history.rejected });
  }
  const receiptSchema = loadSchema(RECEIPT_SCHEMA);
  const shapeErrors = validateSchema(resolveRef(receiptSchema, '#/$defs/round'), roundEntry, receiptSchema);
  if (shapeErrors.length > 0) throw new EnvError(`the round entry does not match critique-receipt.schema.json $defs.round: ${shapeErrors.join('; ')}`);
  const probes = probeResult(values, ctx.profile, dir, roundEntry.verdict === 'accepted' ? round : bestAfter.round);
  const receipt = {
    kind: 'critique-round', version: 1, at: utcSeconds(), round: roundEntry, best_before: bestSnap, best_after: bestAfter, probes,
    inputs: { best: toPosix(bestFile), candidate: existsSync(candidateFile) ? toPosix(candidateFile) : null, critics: files.map(toPosix), errors: inputErrors },
  };
  const file = writeJson(path.join(dir, 'receipt.json'), receipt);
  emit({ ...receipt, path: file }, Boolean(values.json), `round ${round}: ${String(roundEntry.verdict)}${(/** @type {string[]} */ (roundEntry.reasons)).length ? ` (${(/** @type {string[]} */ (roundEntry.reasons)).join('; ')})` : ''}; receipt ${file}`);
  return exitCode;
}

/**
 * @param {CliOptions} values
 * @returns {number}
 */
function runProbes(values) {
  const ctx = context(values);
  const round = intFlag(values.round, '--round', 0);
  const dir = path.join(ctx.state, 'critique', `round-${round}`);
  const result = probeResult(values, ctx.profile, dir, round);
  if (!result) throw new UsageError(`no probes folder: ${toPosix(path.resolve(values.probes ?? path.join(dir, 'probes')))}; save each probe answer under probes/<viewport>/ first`);
  writeJson(path.join(dir, 'probes.json'), result);
  emit(result, Boolean(values.json), `probes round ${round}: ${result.pass ? 'pass' : 'fail'} (${result.viewports.map((v) => `${v.viewport} ${v.matched}/${v.total}`).join(', ')})`);
  return result.pass ? 0 : 1;
}

/**
 * @param {CliOptions} values
 * @returns {Promise<number>}
 */
async function runUiCopy(values) {
  const ctx = context(values);
  const routes = loadRoutes(ctx.root, ctx.profile);
  const brief = existsSync(path.join(ctx.state, 'brief.json')) ? loadBrief(ctx.state, { requireHero: false }) : null;
  const out = path.resolve(values.out ?? path.join(ctx.state, 'ui-copy.md'));
  const target = await openTarget(values, logLine);
  let browser = null;
  try {
    browser = await launch();
    const { markdown, entries } = await extractUiCopy({ browser, baseUrl: target.baseUrl, routes, profile: ctx.profile, projectName: brief?.projectName ?? '', log: logLine });
    const file = writeText(out, markdown);
    writeJson(out.replace(/\.md$/i, '') + '.json', { version: 1, at: utcSeconds(), url: target.baseUrl, entries });
    emit({ ok: true, path: file, routes: routes.length, items: entries.length }, Boolean(values.json), `ui copy: ${entries.length} texts from ${routes.length} route(s) in ${file}`);
    return 0;
  } finally {
    await closeAll(browser, target);
  }
}

/**
 * @param {readonly string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const { values, positionals } = parseCli(argv, { options: OPTIONS, help: HELP });
  const v = values;
  if (typeof v['verify-receipt'] === 'string') {
    const root = path.resolve(typeof v.root === 'string' ? v.root : '.');
    const result = verifyReceipt(v['verify-receipt'], { root, uiRoot: v['ui-root'] ?? null });
    emit(result, Boolean(v.json), result.ok ? `receipt ok: ${toPosix(path.resolve(v['verify-receipt']))}` : `receipt check failed: ${result.errors.join('; ')}`);
    return result.ok ? 0 : 1;
  }
  const [command, ...rest] = positionals;
  if (rest.length > 0) throw new UsageError(`unexpected argument ${JSON.stringify(rest[0])}; run with --help for usage`);
  switch (command) {
    case 'prepare':
    case 'measure':
      return runCapture(command, v);
    case 'issues':
      return runIssues(v);
    case 'accept':
      return runAccept(v);
    case 'probes':
      return runProbes(v);
    case 'ui-copy':
      return runUiCopy(v);
    case undefined:
      throw new UsageError('missing command: prepare, measure, issues, accept, probes, ui-copy or --verify-receipt <file>; run with --help');
    default:
      throw new UsageError(`unknown command ${JSON.stringify(command)}; run with --help`);
  }
}

/**
 * True when this file is the script node was started with.
 * @returns {boolean}
 */
function isMain() {
  return isMainModule(import.meta.url);
}

if (isMain()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }, (err) => {
    exitWith(err instanceof FrontendError || err instanceof Error ? err : new Error(String(err)));
  });
}
