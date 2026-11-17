// @ts-check
/**
 * board.mjs: the directions of P2 and the review board of H1 and H2 (ARCHITECTURE.md P2, references/03-directions.md).
 *
 * render   renders a direction's hero comp at 1440x900 and 390x844 (DPR 2) to hero-desktop.png and hero-mobile.png,
 *          plus hero-*.board.png with every customer, sponsor and event name masked (DR-16). The comp is the
 *          direction's own hero.html; a direction without one gets a comp generated from a template driven only by
 *          its tokens.json and the brief's real copy, with a labelled product surface where the product goes.
 * screen   the runtime tells on the comp, the token contrast table, the comp's palette and fonts, the brief's copy, the
 *          similar-prompt test against a plan drawn from a generic brief, and the ledger of past directions.
 * board    board.json (artboards with titles, PNG paths and captions, and every direction's case at equal length)
 *          and a Claude Design canvas skeleton with {{ASSET:<file>}} placeholders, which the orchestrator publishes.
 * logos    the logo candidates sheets of H2 and their canvas skeleton.
 * record   appends the directions to the cross-project ledger of past directions once H1 is answered (DR-10).
 * gates    directions.present and directions.screened (module API: GATES and run(ctx, selected)).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mentions, sameTextKey } from './critique.mjs';
import { parseCli, isMainModule } from './lib/args.mjs';
import { goto, launch, newContext } from './lib/browser.mjs';
import { contrastRatio, parseColor, toHex, toOklch } from './lib/color.mjs';
import { collectText } from './lib/dom.mjs';
import { EnvError, UsageError, exitWith } from './lib/errors.mjs';
import { readText, sha256File, toPosix, writeText } from './lib/fsutil.mjs';
import { stateDir } from './lib/paths.mjs';
import { loadProfile } from './lib/profile.mjs';
import { waitReady } from './lib/ready.mjs';
import { aggregate, gate, utcSeconds, writeReport } from './lib/report.mjs';
import { serveStatic } from './lib/serve.mjs';
import { normaliseText } from './lib/text.mjs';
import { loadAllowlists, loadRegistry, runRuntime, runtimeContext } from './rules/load.mjs';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('playwright-core').BrowserContext} BrowserContext
 * @typedef {import('playwright-core').Page} Page
 * @typedef {import('./lib/profile.mjs').Profile} Profile
 * @typedef {import('./lib/report.mjs').GateResult} GateResult
 * @typedef {import('./rules/load.mjs').Finding} Finding
 * @typedef {import('./rules/load.mjs').Rule} Rule
 * @typedef {import('./rules/load.mjs').Allowlist} Allowlist
 *
 * @typedef {{name: string, value: Record<string, string>, usage: string}} ColorToken
 * @typedef {{name: string, value: unknown, usage: string}} PlainToken
 * @typedef {{name: string, group: string, family: string, fontSize: string, lineHeight: string, fontWeight: string,
 *   letterSpacing: string}} TypeStyle
 * @typedef {{family: string, file: string, weight: string, style: string}} FontFile
 * @typedef {{file: string, sha256: string, name: string, themes: string[], colors: ColorToken[],
 *   families: {display: string, body: string, mono: string | null}, styles: TypeStyle[], fonts: FontFile[],
 *   spacing: PlainToken[], radius: PlainToken[], shadow: PlainToken[], meta: Record<string, unknown>}} DirectionTokens
 * @typedef {'ground' | 'surface' | 'text' | 'muted' | 'inverse' | 'accent' | 'on-accent' | 'border' | 'status' | 'other'} Role
 * @typedef {{theme: string, fg: string, bg: string, fgValue: string, bgValue: string, ratio: number | null, required: number,
 *   kind: string, blocking: boolean, ok: boolean}} ContrastPair
 * @typedef {{check: string, detail: string, blocking: boolean, viewport?: string, rule?: string, selector?: string}} ScreenFinding
 * @typedef {{name: string, anchor: string, reference: string, signature: string, rationale: string, tradeOff: string,
 *   reuse: string, placeholders: string[], similarRows: string[][], layout: string, raw: string}} DirectionNotes
 * @typedef {{name: string, width: number, height: number, dpr: number, isMobile: boolean, hasTouch: boolean}} CompViewport
 * @typedef {{project: string, direction: string, name: string, picked: boolean, recorded_at: string, ground: string | null,
 *   accent: string | null, display: string | null, body: string | null, signature: string | null, tokens_sha256: string}} PastEntry
 * @typedef {{name: string, label: string}} MaskName
 * @typedef {{root: string, profile: Profile, state: string, design?: string, browser?: Browser | null,
 *   args?: Record<string, unknown>, log?: (line: string) => void}} CheckContext
 */

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPTS_DIR, '..');
const DEFAULT_REGISTRY = path.join(SCRIPTS_DIR, 'rules', 'registry.json');
const DEFAULT_RULES_DIR = path.join(SCRIPTS_DIR, 'rules');
const DEFAULT_SPONSOR_FILE = path.join(SKILL_DIR, 'assets', 'sponsor-allowlist.json');
/** The cross-project ledger of past directions (DR-10); FRONTEND_PAST_DIRECTIONS or --past replaces it. */
export const DEFAULT_PAST_FILE = path.join(SKILL_DIR, 'ledger', 'past-directions.json');

export const DIRECTION_IDS = Object.freeze(['A', 'B', 'C']);
/** Mockup sizes of FD15-F20; the mobile comp renders in a phone context (FD06-F08). */
export const COMP_VIEWPORTS = Object.freeze([
  Object.freeze({ name: 'desktop', width: 1440, height: 900, dpr: 1, isMobile: false, hasTouch: false }),
  Object.freeze({ name: 'mobile', width: 390, height: 844, dpr: 2, isMobile: true, hasTouch: true }),
]);
export const TEMPLATE_GENERATOR = 'frontend board.mjs template v1';
const TEMPLATE_PATH = '/__frontend_template__.html';
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', '-apple-system', 'blinkmacsystemfont', 'inherit', 'initial']);
/** Uncalibrated thresholds (FD15-F08, FD15-F29 give the method, not numbers): OKLab distances and word overlap. */
export const SIMILARITY = Object.freeze({ sameColor: 0.03, paletteTolerance: 0.02, signatureJaccard: 0.5, layoutJaccard: 0.6 });
const LOGO_SIZES = Object.freeze([16, 32, 180]);

export const GATES = Object.freeze([
  Object.freeze({
    id: 'directions.present',
    title: 'Two or three directions (one or two in small mode), each from its own anchor, with tokens, notes and hero comps at both sizes',
    ifDropped: 'the owner would choose between shades of one look, or a direction with a missing comp',
  }),
  Object.freeze({
    id: 'directions.screened',
    title: 'Every direction passes the tells on its comp, the token contrast table, the similar-prompt test and the past-directions ledger',
    ifDropped: "the model's default palette and fonts could reach the owner as a real option",
  }),
]);

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
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
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
 * @param {string} message
 */
function logLine(message) {
  process.stderr.write(`board: ${message}\n`);
}

/**
 * Width and height of a PNG, from its IHDR chunk; null for anything else.
 * @param {string} file
 * @returns {{width: number, height: number} | null}
 */
export function pngSize(file) {
  try {
    const b = readFileSync(file);
    if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/**
 * The first family of a CSS font stack, unquoted and lower-cased.
 * @param {string | null | undefined} stack
 * @returns {string}
 */
export function primaryFamily(stack) {
  const first = String(stack ?? '').split(',')[0] ?? '';
  return first.trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
}

/**
 * @param {string} s
 * @returns {Set<string>}
 */
function wordSet(s) {
  return new Set(normaliseText(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
}

/**
 * Word-set Jaccard similarity.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function jaccard(a, b) {
  const x = wordSet(a);
  const y = wordSet(b);
  if (x.size === 0 || y.size === 0) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter += 1;
  return inter / (x.size + y.size - inter);
}

/**
 * Distance of two CSS colours in OKLab (Euclidean; about 0.02 is a just-noticeable difference); null if either does
 * not parse. Alpha is ignored.
 * @param {string} a
 * @param {string} b
 * @returns {number | null}
 */
export function oklabDistance(a, b) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return null;
  const pa = toOklch(ca);
  const pb = toOklch(cb);
  const ax = pa.c * Math.cos((pa.h * Math.PI) / 180);
  const ay = pa.c * Math.sin((pa.h * Math.PI) / 180);
  const bx = pb.c * Math.cos((pb.h * Math.PI) / 180);
  const by = pb.c * Math.sin((pb.h * Math.PI) / 180);
  return Math.hypot(pa.l - pb.l, ax - bx, ay - by);
}

/**
 * @param {string} css
 * @returns {string | null}
 */
function hexOf(css) {
  const c = parseColor(css);
  return c ? toHex(c) : null;
}

// ------------------------------------------------------------------------------------------------ tokens

/**
 * @param {unknown} value
 * @param {string[]} themes
 * @returns {Record<string, string>}
 */
function themeValues(value, themes) {
  if (typeof value === 'string' || typeof value === 'number') return { [themes[0] ?? 'default']: String(value) };
  /** @type {Record<string, string>} */
  const out = {};
  if (isObject(value)) for (const [k, v] of Object.entries(value)) if (typeof v === 'string' || typeof v === 'number') out[k] = String(v);
  return out;
}

/**
 * @param {unknown} list
 * @returns {PlainToken[]}
 */
function plainTokens(list) {
  if (!isObject(list) || !Array.isArray(list.tokens)) return [];
  return list.tokens.filter(isObject).map((t) => ({ name: str(t.name), value: t.value, usage: str(t.usage) }));
}

/**
 * Reads a direction's tokens.json (the list shape of CONTRACTS 6.2 / assets/schemas/tokens.schema.json). Only the
 * colour list is required; missing type, spacing or radius lists come back empty and the screen reports them.
 * @param {string} file
 * @returns {DirectionTokens}
 */
export function loadTokens(file) {
  const raw = readJson(file, 'tokens');
  if (!isObject(raw) || !isObject(raw.color) || !Array.isArray(raw.color.tokens)) {
    throw new UsageError(`${toPosix(file)} is not a token plan: it needs color.tokens (assets/schemas/tokens.schema.json)`);
  }
  let themes = Array.isArray(raw.color.themes) ? raw.color.themes.filter(isObject).map((t) => str(t.id)).filter(Boolean) : [];
  const firstValue = raw.color.tokens.find(isObject)?.value;
  if (themes.length === 0) themes = isObject(firstValue) ? Object.keys(firstValue) : ['default'];
  const colors = raw.color.tokens.filter(isObject).map((t) => ({ name: str(t.name), value: themeValues(t.value, themes), usage: str(t.usage) }));
  const type = isObject(raw.type) ? raw.type : {};
  const fams = isObject(type.families) ? type.families : {};
  const families = { display: str(fams.display), body: str(fams.body), mono: typeof fams.mono === 'string' && fams.mono ? fams.mono : null };
  /** @type {TypeStyle[]} */
  const styles = [];
  for (const g of Array.isArray(type.groups) ? type.groups.filter(isObject) : []) {
    for (const s of Array.isArray(g.styles) ? g.styles.filter(isObject) : []) {
      styles.push({
        name: str(s.name), group: str(g.name), family: str(g.family),
        fontSize: str(s.fontSize), lineHeight: str(s.lineHeight), fontWeight: str(s.fontWeight), letterSpacing: str(s.letterSpacing),
      });
    }
  }
  const fonts = (Array.isArray(type.fonts) ? type.fonts.filter(isObject) : []).map((f) => ({ family: str(f.family), file: str(f.file), weight: str(f.weight) || '400', style: str(f.style) || 'normal' }));
  return {
    file: toPosix(path.resolve(file)), sha256: sha256File(file), name: str(raw.name), themes, colors, families, styles, fonts,
    spacing: plainTokens(raw.spacing), radius: plainTokens(raw.radius), shadow: plainTokens(raw.shadow), meta: isObject(raw.meta) ? raw.meta : {},
  };
}

/**
 * The role of a colour token, from its name first and its usage second: on-accent, border, status, muted text,
 * inverse text, surface, ground, accent, text, or other.
 * @param {ColorToken} token
 * @returns {Role}
 */
export function roleOf(token) {
  const words = token.name.toLowerCase().split(/[-_]+/).filter(Boolean);
  const usage = token.usage.toLowerCase();
  const has = (/** @type {RegExp} */ re) => words.some((w) => re.test(w));
  const accentWord = /^(accent|primary|brand|action|cta|signature|highlight)$/;
  const textWord = /^(text|fg|foreground|ink|copy|body|heading|title|content|label)$/;
  if (words[0] === 'on' || (has(accentWord) && has(/^(fg|foreground|contrast)$/))) return 'on-accent';
  if (has(/^(inverse|inverted|reverse|reversed)$/) || /\bon (a )?dark\b/.test(usage)) return 'inverse';
  if (has(/^(border|line|lines|rule|stroke|divider|hairline|outline|separator|grid|ring|focus)$/)) return 'border';
  if (has(/^(success|error|danger|warning|warn|positive|negative|live|testnet|simulated|planned|status|info|alert|critical|caution|ok|fail|pending)$/)) return 'status';
  const muted = has(/^(muted|subtle|secondary|tertiary|caption|dim|faint|quiet|soft|meta|weak)$/);
  if (muted && (has(textWord) || /\b(text|label|caption|copy)\b/.test(usage))) return 'muted';
  if (muted || has(/^(surface|card|panel|raised|elevated|sheet|well|field|container|layer|overlay|popover|tint)$/)) return 'surface';
  if (has(/^(bg|background|ground|canvas|page|base|paper|backdrop)$/)) return 'ground';
  if (has(accentWord) || has(/^(link|interactive)$/)) return 'accent';
  if (has(textWord) || has(/^(default|strong|primary-text)$/)) return 'text';
  if (/\b(page|background|ground)\b/.test(usage)) return 'ground';
  if (/\b(card|panel|surface)\b/.test(usage)) return 'surface';
  if (/\b(border|rule|divider|outline)\b/.test(usage)) return 'border';
  if (/\b(button|link|accent|action|highlight)\b/.test(usage)) return 'accent';
  if (/\b(success|error|warning|status)\b/.test(usage)) return 'status';
  if (/\b(text|copy|heading|label)\b/.test(usage)) return 'text';
  return 'other';
}

/**
 * @param {DirectionTokens} tokens
 * @returns {Map<Role, ColorToken[]>}
 */
export function colorRoles(tokens) {
  /** @type {Map<Role, ColorToken[]>} */
  const roles = new Map();
  for (const t of tokens.colors) {
    const role = roleOf(t);
    const list = roles.get(role);
    if (list) list.push(t);
    else roles.set(role, [t]);
  }
  return roles;
}

/**
 * @param {ColorToken} t
 * @returns {boolean}
 */
function usedAsText(t) {
  return /\b(text|link|label|copy|heading|ink|type)\b/.test(t.usage.toLowerCase()) || /(^|-)(text|link|ink)(-|$)/.test(t.name);
}

/**
 * @param {ColorToken} t
 * @returns {boolean}
 */
function controlBorder(t) {
  return /\b(input|field|control|focus|ring|form)\b/.test(`${t.name.replace(/-/g, ' ')} ${t.usage}`.toLowerCase());
}

/**
 * The token-pair contrast table of each theme (TK-08, TK-09, TK-11): text and muted text against every ground and
 * surface at 4.5:1; an accent used as text at 4.5:1, a filled accent at 3:1 with a text token reaching 4.5:1 on it;
 * status colours at 3:1; control borders and focus rings at 3:1 (other borders are reported, not blocking); inverse
 * text needs one ground it reads on at 4.5:1. Values that do not parse are pairs with a null ratio.
 * @param {DirectionTokens} tokens
 * @returns {ContrastPair[]}
 */
export function contrastTable(tokens) {
  const roles = colorRoles(tokens);
  const get = (/** @type {Role} */ r) => roles.get(r) ?? [];
  /** @type {ContrastPair[]} */
  const pairs = [];
  for (const theme of tokens.themes) {
    const value = (/** @type {ColorToken} */ t) => t.value[theme] ?? Object.values(t.value)[0] ?? '';
    const grounds = [...get('ground'), ...get('surface')].filter((t) => value(t));
    const pair = (/** @type {ColorToken} */ fg, /** @type {ColorToken} */ bg, /** @type {number} */ required, /** @type {string} */ kind, /** @type {boolean} */ blocking) => {
      const ratio = contrastRatio(value(fg), value(bg));
      pairs.push({ theme, fg: fg.name, bg: bg.name, fgValue: value(fg), bgValue: value(bg), ratio: ratio === null ? null : Math.round(ratio * 100) / 100, required, kind, blocking, ok: ratio !== null && ratio >= required - 1e-9 });
    };
    for (const fg of [...get('text'), ...get('muted')]) for (const bg of grounds) pair(fg, bg, 4.5, fg.name.includes('muted') || roleOf(fg) === 'muted' ? 'muted text' : 'text', true);
    for (const fg of get('accent')) {
      if (usedAsText(fg)) {
        for (const bg of grounds) pair(fg, bg, 4.5, 'accent as text', true);
      } else {
        for (const bg of grounds) pair(fg, bg, 3, 'accent as a fill or mark', true);
        const onAccent = get('on-accent');
        if (onAccent.length > 0) {
          for (const on of onAccent) pair(on, fg, 4.5, 'text on the accent', true);
        } else {
          const candidates = [...get('text'), ...get('ground')];
          let best = /** @type {ColorToken | null} */ (null);
          let bestRatio = -1;
          for (const c of candidates) {
            const r = contrastRatio(value(c), value(fg));
            if (r !== null && r > bestRatio) {
              best = c;
              bestRatio = r;
            }
          }
          if (best) pair(best, fg, 4.5, 'text on the accent (no on-accent token; best text or ground token)', true);
        }
      }
    }
    for (const fg of get('status')) for (const bg of grounds) pair(fg, bg, usedAsText(fg) ? 4.5 : 3, usedAsText(fg) ? 'status text' : 'status mark', true);
    for (const fg of get('border')) for (const bg of grounds) pair(fg, bg, 3, controlBorder(fg) ? 'control border or focus ring' : 'border (reported)', controlBorder(fg));
    for (const fg of get('inverse')) {
      const bgs = [...get('accent'), ...tokens.colors.filter((t) => /\bdark\b/.test(t.usage.toLowerCase()) || /(^|-)(dark|inverse)(-|$)/.test(t.name))].filter((t) => t !== fg);
      let best = /** @type {ColorToken | null} */ (null);
      let bestRatio = -1;
      for (const bg of bgs) {
        const r = contrastRatio(value(fg), value(bg));
        if (r !== null && r > bestRatio) {
          best = bg;
          bestRatio = r;
        }
      }
      if (best) pair(fg, best, 4.5, 'inverse text on its darkest ground', true);
    }
  }
  return pairs;
}

/**
 * A comparable size in px of a CSS length (px, rem, em at 16 px; clamp() and max() by their largest term).
 * @param {string} css
 * @returns {number}
 */
export function cssPx(css) {
  const values = [...String(css).matchAll(/(-?\d*\.?\d+)(px|rem|em)?/g)].map((m) => Number(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1));
  if (values.length === 0) return Number.NaN;
  return /^\s*(min)\(/.test(css) ? Math.min(...values) : Math.max(...values);
}

/**
 * @param {DirectionTokens} tokens
 * @param {string} family a role (display, body, mono) or a family name
 * @returns {string}
 */
function familyOf(tokens, family) {
  if (family === 'display' || family === 'body') return tokens.families[family];
  if (family === 'mono') return tokens.families.mono ?? '';
  return family;
}

/**
 * The type styles the template uses: the largest style in the display family (h1), the body style, a lead style and
 * the smallest style.
 * @param {DirectionTokens} tokens
 * @returns {{display: TypeStyle | null, body: TypeStyle | null, lead: TypeStyle | null, small: TypeStyle | null}}
 */
export function pickStyles(tokens) {
  const sized = tokens.styles.filter((s) => Number.isFinite(cssPx(s.fontSize)));
  const displayFamily = primaryFamily(tokens.families.display);
  const inDisplay = sized.filter((s) => s.group.includes('display') || s.family === 'display' || primaryFamily(familyOf(tokens, s.family)) === displayFamily);
  const largest = (/** @type {TypeStyle[]} */ list) => [...list].sort((a, b) => cssPx(b.fontSize) - cssPx(a.fontSize))[0] ?? null;
  const display = largest(inDisplay) ?? largest(sized);
  const named = (/** @type {RegExp} */ re, /** @type {TypeStyle[]} */ list = sized) => list.find((s) => re.test(s.name) || re.test(s.group)) ?? null;
  const body = named(/(^|-)(body|text|base|paragraph|copy)(-|$)/) ?? [...sized].sort((a, b) => Math.abs(cssPx(a.fontSize) - 16) - Math.abs(cssPx(b.fontSize) - 16))[0] ?? null;
  const notDisplay = sized.filter((s) => s !== display);
  const lead = named(/(^|-)(lead|intro|subtitle|subhead|sub)(-|$)/, notDisplay) ?? named(/(^|-)(large|lg|xl)(-|$)/, notDisplay) ?? body;
  const small = [...sized].filter((s) => cssPx(s.fontSize) >= 11).sort((a, b) => cssPx(a.fontSize) - cssPx(b.fontSize))[0] ?? body;
  return { display, body, lead, small };
}

/**
 * @param {PlainToken[]} list
 * @param {string} [theme]
 * @returns {Array<{name: string, css: string, px: number, usage: string}>}
 */
function lengths(list, theme) {
  return list.map((t) => {
    const css = typeof t.value === 'string' || typeof t.value === 'number' ? String(t.value) : isObject(t.value) ? str(t.value[theme ?? ''] ?? Object.values(t.value)[0]) : '';
    return { name: t.name, css, px: cssPx(css), usage: t.usage };
  }).filter((t) => t.css);
}

// ------------------------------------------------------------------------------------------------ brief and notes

/**
 * The parts of brief.json the comps use: the project name, the hero copy, sponsors, customers and features.
 * @param {string} state
 * @returns {{projectName: string, h1: string, sentence: string, sponsors: Array<{id: string, name: string}>, customers: string[],
 *   features: Array<{id: string, title: string, status: string}>, sha256: string} | null}
 */
export function readBrief(state) {
  const file = path.join(state, 'brief.json');
  if (!existsSync(file)) return null;
  const raw = readJson(file, 'brief');
  if (!isObject(raw)) throw new UsageError(`brief ${toPosix(file)} must be a JSON object`);
  const hero = isObject(raw.hero) ? raw.hero : {};
  const project = isObject(raw.project) ? raw.project : {};
  return {
    projectName: normaliseText(str(project.name)),
    h1: normaliseText(str(hero.h1)),
    sentence: normaliseText(str(hero.sentence)),
    sponsors: (Array.isArray(raw.sponsors) ? raw.sponsors.filter(isObject) : []).map((s) => ({ id: str(s.id), name: normaliseText(str(s.name)) })).filter((s) => s.name || s.id),
    customers: (Array.isArray(raw.customers) ? raw.customers.filter(isObject) : []).map((c) => normaliseText(str(c.name))).filter(Boolean),
    features: (Array.isArray(raw.features) ? raw.features.filter(isObject) : []).map((f) => ({ id: str(f.id), title: normaliseText(str(f.title)), status: str(f.status) })).filter((f) => f.title),
    sha256: sha256File(file),
  };
}

/**
 * Reads a direction's notes.md (assets/templates/direction.md): name, anchor, concrete reference, signature,
 * rationale, trade-off, an owner's reuse request, unreplaced placeholders, the similar-prompt table rows and the
 * layout concept.
 * @param {string} file
 * @returns {DirectionNotes | null}
 */
export function readNotes(file) {
  if (!existsSync(file)) return null;
  const raw = readText(file).replace(/\r\n?/g, '\n');
  const body = raw.replace(/<!--[\s\S]*?-->/g, '');
  const line = (/** @type {RegExp} */ re) => normaliseText((re.exec(body) ?? [])[1] ?? '');
  const title = /^#\s+Direction\s+[A-C]\s*[:.]\s*(.+)$/m.exec(body) ?? /^#\s+(.+)$/m.exec(body);
  const anchor = line(/^\s*-\s*Anchor\s*:\s*(.+)$/im).replace(/\s*\(one of:[\s\S]*$/i, '').replace(/[.;]\s*$/, '');
  /** @type {string[][]} */
  const similarRows = [];
  const section = /^##\s+Similar-prompt test\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(body);
  if (section) {
    for (const row of section[1].split('\n')) {
      if (!/^\s*\|/.test(row) || /^\s*\|\s*-/.test(row)) continue;
      const cells = row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells[0] && cells[0].toLowerCase() !== 'token') similarRows.push(cells);
    }
  }
  const layout = /^##\s+Layout concept\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(body);
  return {
    name: normaliseText(title ? title[1] : ''),
    anchor,
    reference: line(/^\s*-\s*Concrete reference\s*:\s*(.+)$/im),
    signature: line(/^\s*-\s*Signature element\s*:\s*(.+)$/im).replace(/\.\s*One, and tied[\s\S]*$/i, ''),
    rationale: line(/^\s*-\s*(?:Why this direction fits the brief|Rationale)\s*:\s*(.+)$/im),
    tradeOff: line(/^\s*-\s*(?:What it costs|Trade-?off)\s*:\s*(.+)$/im),
    reuse: line(/^\s*-\s*Reuse requested by the owner\s*:\s*(.+)$/im),
    placeholders: [...new Set([...body.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]))],
    similarRows,
    layout: normaliseText(layout ? layout[1].replace(/```[\s\S]*?```/g, ' ') : ''),
    raw,
  };
}

/**
 * The names the board masks (DR-16): customers (brief and profile references) as [Customer], sponsors (brief, profile
 * and the sponsor allowlist's display names and naming blocklist) as [Sponsor], longest first.
 * @param {ReturnType<typeof readBrief>} brief
 * @param {Profile} profile
 * @param {{sponsorFile?: string}} [options]
 * @returns {MaskName[]}
 */
export function maskNamesFor(brief, profile, { sponsorFile = DEFAULT_SPONSOR_FILE } = {}) {
  /** @type {Map<string, MaskName>} */
  const names = new Map();
  const add = (/** @type {string} */ name, /** @type {string} */ label) => {
    const n = normaliseText(name);
    if (n.length >= 2 && !names.has(n.toLowerCase())) names.set(n.toLowerCase(), { name: n, label });
  };
  for (const c of brief?.customers ?? []) add(c, '[Customer]');
  for (const r of profile.references ?? []) add(r.customer, '[Customer]');
  const ids = new Set((profile.sponsors ?? []).map((s) => s.toLowerCase()));
  for (const s of brief?.sponsors ?? []) {
    add(s.name, '[Sponsor]');
    if (s.id) ids.add(s.id.toLowerCase());
  }
  if (ids.size > 0 && existsSync(sponsorFile)) {
    const raw = readJson(sponsorFile, 'sponsor allowlist');
    const list = Array.isArray(raw) ? raw : isObject(raw) && Array.isArray(raw.sponsor_allowlist) ? raw.sponsor_allowlist : [];
    for (const entry of list.filter(isObject)) {
      const id = str(entry.sponsor ?? entry.id).toLowerCase();
      if (!ids.has(id)) continue;
      add(id.replace(/-/g, ' '), '[Sponsor]');
      add(str(entry.display_name).split('(')[0], '[Sponsor]');
      for (const n of Array.isArray(entry.naming_blocklist) ? entry.naming_blocklist : []) if (typeof n === 'string' && n.length >= 3) add(n, '[Sponsor]');
    }
  }
  for (const id of ids) add(id.replace(/-/g, ' '), '[Sponsor]');
  return [...names.values()].sort((a, b) => b.name.length - a.name.length);
}

/**
 * @param {string} text
 * @param {MaskName[]} names
 * @returns {string}
 */
export function maskText(text, names) {
  let out = text;
  for (const { name, label } of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'), label);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ template comp

/**
 * @param {string} s
 * @returns {string}
 */
function html(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A CSS value safe inside a declaration: no braces, semicolons or angle brackets.
 * @param {string} v
 * @returns {string}
 */
function cssSafe(v) {
  return String(v).replace(/[{};<>]/g, '').trim();
}

/**
 * @param {string} family
 * @returns {string}
 */
function cssFamily(family) {
  const stack = cssSafe(family);
  if (!stack) return 'sans-serif';
  return stack.split(',').map((f) => {
    const t = f.trim().replace(/^["']|["']$/g, '');
    return GENERIC_FAMILIES.has(t.toLowerCase()) ? t : `"${t}"`;
  }).join(', ');
}

/**
 * The font files of the plan the comp can load, looked up beside tokens.json and under the repository.
 * @param {DirectionTokens} tokens
 * @param {string} dir
 * @param {string} root
 * @returns {Array<{family: string, weight: string, style: string, file: string}>}
 */
export function fontFilesFor(tokens, dir, root) {
  /** @type {Array<{family: string, weight: string, style: string, file: string}>} */
  const out = [];
  for (const f of tokens.fonts) {
    if (!f.file || !f.family) continue;
    const candidates = [path.resolve(dir, f.file), path.resolve(dir, path.basename(f.file)), path.resolve(root, f.file)];
    const found = candidates.find((p) => existsSync(p) && statSync(p).isFile());
    if (found) out.push({ family: f.family, weight: f.weight, style: f.style, file: found });
  }
  return out;
}

/**
 * The comp generated for a direction without its own hero.html: every colour, family, size, spacing and radius comes
 * from tokens.json and every word from the brief, with a labelled product surface where the product goes, a figure
 * marked "not yet verified" (DR-05) and no external request. Structural values (grid, borders of 1 px) are the only
 * literals.
 * @param {{id: string, tokens: DirectionTokens, brief: NonNullable<ReturnType<typeof readBrief>>, fonts: Array<{family: string, weight: string, style: string}>}} input
 * @returns {{html: string, missing: string[]}}
 */
export function templateComp({ id, tokens, brief, fonts }) {
  /** @type {string[]} */
  const missing = [];
  const roles = colorRoles(tokens);
  const theme = tokens.themes[0];
  const color = (/** @type {Role[]} */ order, /** @type {string} */ what) => {
    for (const r of order) {
      const t = roles.get(r)?.[0];
      if (t) return cssSafe(t.value[theme] ?? Object.values(t.value)[0] ?? '');
    }
    missing.push(what);
    return '';
  };
  const ground = color(['ground'], 'a ground colour token');
  const text = color(['text'], 'a text colour token');
  const surface = color(['surface', 'ground'], 'a surface colour token');
  const muted = color(['muted', 'text'], 'a muted text token');
  const accent = color(['accent', 'text'], 'an accent colour token');
  const border = color(['border', 'muted', 'text'], 'a border token');
  let onAccent = '';
  const onToken = roles.get('on-accent')?.[0];
  if (onToken) onAccent = cssSafe(onToken.value[theme] ?? '');
  else {
    const options = [...(roles.get('text') ?? []), ...(roles.get('ground') ?? [])].map((t) => t.value[theme] ?? '').filter(Boolean);
    onAccent = options.sort((a, b) => (contrastRatio(b, accent) ?? 0) - (contrastRatio(a, accent) ?? 0))[0] ?? text;
  }
  const statuses = roles.get('status') ?? [];
  const statusColor = (/** @type {string} */ status) => cssSafe((statuses.find((t) => t.name.includes(status)) ?? statuses[0])?.value[theme] ?? muted);
  const styles = pickStyles(tokens);
  if (!styles.display) missing.push('type styles (type.groups)');
  const families = {
    display: cssFamily(tokens.families.display || tokens.families.body),
    body: cssFamily(tokens.families.body || tokens.families.display),
    mono: tokens.families.mono ? cssFamily(tokens.families.mono) : cssFamily(tokens.families.body),
  };
  if (!tokens.families.display && !tokens.families.body) missing.push('type families');
  const space = lengths(tokens.spacing).filter((t) => Number.isFinite(t.px) && t.px > 0).sort((a, b) => a.px - b.px);
  if (space.length === 0) missing.push('spacing tokens');
  const step = (/** @type {number} */ q) => (space.length === 0 ? '' : space[Math.min(space.length - 1, Math.round(q * (space.length - 1)))].css);
  const radii = lengths(tokens.radius).filter((t) => Number.isFinite(t.px)).sort((a, b) => a.px - b.px);
  const radius = (/** @type {RegExp} */ re, /** @type {'min' | 'max'} */ fallback) => {
    const named = radii.find((r) => re.test(r.name) || re.test(r.usage.toLowerCase()));
    if (named) return named.css;
    return fallback === 'min' ? (radii.find((r) => r.px > 0) ?? radii[0])?.css ?? '0' : (radii.filter((r) => r.px <= 32).pop() ?? radii[0])?.css ?? '0';
  };
  const panelShadow = tokens.shadow.find((s) => /card|panel|raised|elevat|surface/.test(`${s.name} ${s.usage}`.toLowerCase()));
  const shadowCss = panelShadow ? cssSafe(str(isObject(panelShadow.value) ? panelShadow.value[theme] ?? Object.values(panelShadow.value)[0] : panelShadow.value)) : 'none';
  const style = (/** @type {TypeStyle | null} */ s, /** @type {string} */ prop) => (s ? cssSafe(String(Reflect.get(s, prop) ?? '')) : '');
  const fontFaces = fonts.map((f, i) => `@font-face { font-family: "${cssSafe(f.family)}"; src: url("/__fonts/${i}"); font-weight: ${cssSafe(f.weight)}; font-style: ${cssSafe(f.style)}; font-display: block; }`).join('\n');
  const vars = {
    '--ground': ground, '--text': text, '--surface': surface, '--muted': muted, '--accent': accent, '--on-accent': onAccent, '--border': border,
    '--font-display': families.display, '--font-body': families.body, '--font-mono': families.mono,
    '--h1-size': style(styles.display, 'fontSize'), '--h1-lh': style(styles.display, 'lineHeight'), '--h1-weight': style(styles.display, 'fontWeight'), '--h1-ls': style(styles.display, 'letterSpacing') || 'normal',
    '--body-size': style(styles.body, 'fontSize'), '--body-lh': style(styles.body, 'lineHeight'), '--body-weight': style(styles.body, 'fontWeight'),
    '--lead-size': style(styles.lead, 'fontSize'), '--lead-lh': style(styles.lead, 'lineHeight'),
    '--small-size': style(styles.small, 'fontSize'), '--small-lh': style(styles.small, 'lineHeight'),
    '--space-1': step(0), '--space-2': step(0.35), '--space-3': step(0.7), '--space-4': step(1),
    '--radius-control': radius(/control|button|input|(^|-)sm$|small/, 'min'), '--radius-panel': radius(/panel|card|surface|(^|-)(md|lg)$|large/, 'max'),
    '--shadow-panel': shadowCss,
  };
  const root = Object.entries(vars).filter(([, v]) => v !== '').map(([k, v]) => `  ${k}: ${v};`).join('\n');
  const features = brief.features.slice(0, 3);
  const statusClass = (/** @type {string} */ s) => `status-${/^(live|testnet|simulated|planned)$/.test(s) ? s : 'other'}`;
  const statusRules = ['live', 'testnet', 'simulated', 'planned', 'other'].map((s) => `.${statusClass(s)} { color: ${statusColor(s)}; }`).join('\n');
  const sponsors = brief.sponsors.map((s) => s.name || s.id).filter(Boolean);
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${TEMPLATE_GENERATOR}">
<title>${html(brief.projectName || 'Project')}: direction ${html(id)}</title>
<style>
${fontFaces}
:root {
${root}
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--ground); color: var(--text); }
body { font-family: var(--font-body); font-size: var(--body-size); line-height: var(--body-lh); font-weight: var(--body-weight); }
.top { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--border); }
.wordmark { font-family: var(--font-display); font-weight: var(--h1-weight); font-size: var(--lead-size); line-height: var(--lead-lh); }
.hero { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: var(--space-4); padding: var(--space-4); align-items: start; }
h1 { font-family: var(--font-display); font-size: var(--h1-size); line-height: var(--h1-lh); font-weight: var(--h1-weight); letter-spacing: var(--h1-ls); margin: 0 0 var(--space-3); text-wrap: balance; }
.sentence { font-size: var(--lead-size); line-height: var(--lead-lh); max-width: 52ch; margin: 0 0 var(--space-3); }
.figure { display: grid; gap: var(--space-1); margin: 0 0 var(--space-3); padding: var(--space-2) 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.figure .label, .sponsors, .surface-label, .feature .status { font-size: var(--small-size); line-height: var(--small-lh); }
.figure .label, .sponsors, .surface-label { color: var(--muted); }
.figure .value { font-family: var(--font-mono); font-size: var(--lead-size); }
.sponsors { margin: 0; }
.product { background: var(--surface); border: 1px dashed var(--border); border-radius: var(--radius-panel); box-shadow: var(--shadow-panel); padding: var(--space-3); display: grid; gap: var(--space-2); align-content: start; min-height: 360px; }
.surface-label { margin: 0; }
.core { margin: 0; font-family: var(--font-display); font-size: var(--lead-size); line-height: var(--lead-lh); }
.feature { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); padding: var(--space-2) 0; border-top: 1px solid var(--border); }
.feature .status { font-family: var(--font-mono); border: 1px solid currentColor; border-radius: var(--radius-control); padding: 0 var(--space-1); }
${statusRules}
.action { justify-self: start; margin-top: var(--space-2); background: var(--accent); color: var(--on-accent); border: 0; border-radius: var(--radius-control); padding: var(--space-2) var(--space-3); font: inherit; min-height: 44px; }
@media (max-width: 720px) {
  .top { padding: var(--space-2) var(--space-3); }
  .hero { grid-template-columns: minmax(0, 1fr); padding: var(--space-3); gap: var(--space-3); }
}
</style>
</head>
<body>
<header class="top"><span class="wordmark">${html(brief.projectName || 'Project')}</span></header>
<main class="hero">
  <section class="copy" aria-label="Hero">
    <h1 data-hero="h1">${html(brief.h1)}</h1>
    <p class="sentence" data-hero="sentence">${html(brief.sentence)}</p>
    <div class="figure"><span class="label">Key figure</span><span class="value">not yet verified</span></div>
    ${sponsors.length > 0 ? `<p class="sponsors">Sponsor: ${html(sponsors.join(', '))}</p>` : ''}
  </section>
  <section class="product" data-surface="product" aria-label="Product surface">
    <p class="surface-label">Product surface, to be built</p>
    ${features[0] ? `<p class="core">Core action: ${html(features[0].title)}</p>` : ''}
${features.map((f) => `    <div class="feature"><span>${html(f.title)}</span><span class="status ${statusClass(f.status)}" data-status="${html(f.status || 'planned')}">${html(f.status || 'planned')}</span></div>`).join('\n')}
    <button class="action" type="button">Primary action</button>
  </section>
</main>
</body>
</html>
`;
  return { html: page, missing };
}

/**
 * @param {string} file
 * @returns {boolean}
 */
function isTemplateFile(file) {
  return existsSync(file) && readText(file).includes(`content="${TEMPLATE_GENERATOR}"`);
}

// ------------------------------------------------------------------------------------------------ in-page functions

/**
 * In-page: replaces each name in rendered text, field values and placeholders by its role label; returns the count.
 * @param {Array<{name: string, label: string}>} names
 * @returns {number}
 */
export const maskInPage = function maskInPage(names) {
  const patterns = names.map((n) => ({
    re: new RegExp(`(?<![\\p{L}\\p{N}])${n.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu'),
    label: n.label,
  }));
  /** @param {string} s */
  const mask = (s) => {
    let hits = 0;
    let out = s;
    for (const p of patterns) {
      out = out.replace(p.re, () => {
        hits += 1;
        return p.label;
      });
    }
    return { out, hits };
  };
  let replaced = 0;
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const r = mask(n.nodeValue || '');
    if (r.hits > 0) {
      n.nodeValue = r.out;
      replaced += r.hits;
    }
  }
  for (const field of Array.from(document.querySelectorAll('input, textarea'))) {
    const f = /** @type {HTMLInputElement} */ (field);
    for (const attr of ['value', 'placeholder']) {
      const r = mask(String(Reflect.get(f, attr) ?? ''));
      if (r.hits > 0) {
        Reflect.set(f, attr, r.out);
        replaced += r.hits;
      }
    }
  }
  document.title = mask(document.title).out;
  return replaced;
};

/**
 * In-page: every colour the comp paints (text, backgrounds, borders, outlines, SVG fills and strokes, gradient stops),
 * one entry per distinct colour and property with the first element that uses it.
 * @returns {Array<{color: string, prop: string, where: string}>}
 */
export const paletteOf = function paletteOf() {
  /** @type {Map<string, {color: string, prop: string, where: string}>} */
  const seen = new Map();
  /** @param {string} color @param {string} prop @param {Element} el */
  const add = (color, prop, el) => {
    if (!color || color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color) || / \/ 0\)$/.test(color)) return;
    const key = `${prop} ${color}`;
    if (seen.has(key)) return;
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
    seen.set(key, { color, prop, where: `${el.localName}${el.id ? `#${el.id}` : ''}${cls}` });
  };
  for (const el of Array.from((document.body || document.documentElement).querySelectorAll('*'))) {
    if (el.closest('script, style, head, template, noscript')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const cs = getComputedStyle(el);
    const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && /\S/.test(n.nodeValue || ''));
    if (ownText) add(cs.color, 'color', el);
    add(cs.backgroundColor, 'background-color', el);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (Number.parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && cs.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none') {
        add(cs.getPropertyValue(`border-${side.toLowerCase()}-color`), 'border-color', el);
      }
    }
    if (cs.outlineStyle !== 'none' && Number.parseFloat(cs.outlineWidth) > 0) add(cs.outlineColor, 'outline-color', el);
    if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) {
      if (cs.fill && cs.fill !== 'none' && !cs.fill.startsWith('url(')) add(cs.fill, 'fill', el);
      if (cs.stroke && cs.stroke !== 'none' && !cs.stroke.startsWith('url(')) add(cs.stroke, 'stroke', el);
    }
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      for (const m of cs.backgroundImage.matchAll(/(rgba?|oklch|oklab|lab|lch|hsla?|color)\([^()]*\)/g)) add(m[0], 'gradient stop', el);
    }
  }
  return [...seen.values()];
};

/**
 * In-page: whether the document declares a viewport and its visible text.
 * @returns {{viewportMeta: boolean, text: string}}
 */
export const compFacts = function compFacts() {
  const body = document.body;
  return { viewportMeta: Boolean(document.querySelector('meta[name="viewport"]')), text: body ? body.innerText : '' };
};

// ------------------------------------------------------------------------------------------------ rendering

/**
 * @typedef {{kind: 'hero' | 'template', file: string, html: string | null, fonts: Array<{family: string, weight: string, style: string, file: string}>,
 *   missing: string[]}} CompSource
 */

/**
 * Which comp a direction renders: `hero` (the designer's hero.html, required), `template` (generated; written to
 * hero.html unless a designer's hero.html is there, then to hero.template.html), or `auto` (the designer's hero.html
 * when there is one, else the template).
 * @param {{dir: string, id: string, tokens: DirectionTokens, brief: ReturnType<typeof readBrief>, root: string, mode: string}} input
 * @returns {CompSource}
 */
export function compSource({ dir, id, tokens, brief, root, mode }) {
  const hero = path.join(dir, 'hero.html');
  const designed = existsSync(hero) && !isTemplateFile(hero);
  if (mode === 'hero' && !designed) throw new UsageError(`${toPosix(hero)} is missing; the designer writes hero.html, or run with --comp template`);
  if (designed && mode !== 'template') return { kind: 'hero', file: toPosix(hero), html: null, fonts: [], missing: [] };
  if (!brief || !brief.h1 || !brief.sentence) {
    throw new UsageError('the template comp needs brief.json with hero.h1 and hero.sentence in the state folder (FE-00); run brief.mjs first');
  }
  const fonts = fontFilesFor(tokens, dir, root);
  const { html: page, missing } = templateComp({ id, tokens, brief, fonts });
  const file = designed ? path.join(dir, 'hero.template.html') : hero;
  return { kind: 'template', file: toPosix(file), html: page, fonts, missing };
}

/**
 * @typedef {{context: BrowserContext, page: Page, blocked: string[], errors: string[], close: () => Promise<void>}} OpenComp
 */

/**
 * Opens a comp in a fresh context at one viewport: the direction folder is served on 127.0.0.1, every request to
 * another origin is blocked and recorded (a comp is self-contained), and the template's fonts are served from their
 * files. Waits for fonts, images and two frames.
 * @param {Browser} browser
 * @param {CompViewport} viewport
 * @param {string} baseUrl
 * @param {CompSource} comp
 * @returns {Promise<OpenComp>}
 */
async function openComp(browser, viewport, baseUrl, comp) {
  const context = await newContext(browser, viewport);
  /** @type {string[]} */
  const blocked = [];
  /** @type {string[]} */
  const errors = [];
  const origin = new URL(baseUrl).origin;
  try {
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        blocked.push(url.href);
        await route.abort('blockedbyclient');
        return;
      }
      const font = /^\/__fonts\/(\d+)$/.exec(url.pathname);
      if (font && comp.fonts[Number(font[1])]) {
        await route.fulfill({ path: comp.fonts[Number(font[1])].file, contentType: fontType(comp.fonts[Number(font[1])].file) });
        return;
      }
      if (url.pathname === TEMPLATE_PATH && comp.html) {
        await route.fulfill({ body: comp.html, contentType: 'text/html; charset=utf-8' });
        return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', (err) => errors.push(err.message));
    const target = comp.html !== null && !existsSync(comp.file) ? `${baseUrl}${TEMPLATE_PATH}` : `${baseUrl}/${path.basename(comp.file)}`;
    await goto(page, target);
    await waitReady(page, { timeoutMs: 15000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))));
    return { context, page, blocked, errors, close: () => context.close() };
  } catch (err) {
    await context.close();
    throw err;
  }
}

/**
 * @param {string} file
 * @returns {string}
 */
function fontType(file) {
  const ext = path.extname(file).toLowerCase();
  return ext === '.woff2' ? 'font/woff2' : ext === '.woff' ? 'font/woff' : ext === '.otf' ? 'font/otf' : 'font/ttf';
}

/**
 * The family that rendered most glyphs of the first element matching `selector` (CDP CSS.getPlatformFontsForNode,
 * FD17-F25), or null.
 * @param {Page} page
 * @param {string} selector
 * @returns {Promise<string | null>}
 */
export async function renderedFamily(page, selector) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const { root } = await client.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) return null;
    const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
    const top = [...fonts].sort((a, b) => b.glyphCount - a.glyphCount)[0];
    return top ? top.familyName : null;
  } finally {
    await client.detach();
  }
}

/**
 * Renders one direction: both viewports to hero-<viewport>.png, then the same with names masked to
 * hero-<viewport>.board.png, and writes render.json with the inputs' hashes, the outputs and the masking result.
 * @param {{browser: Browser, state: string, id: string, profile: Profile, root: string, mode?: string, names?: MaskName[],
 *   log?: (line: string) => void}} options
 * @returns {Promise<Record<string, unknown>>}
 */
export async function renderDirection(options) {
  const { browser, state, id, profile, root } = options;
  const log = options.log ?? (() => {});
  if (!DIRECTION_IDS.includes(id)) throw new UsageError(`--direction must be A, B or C (got ${JSON.stringify(id)})`);
  const dir = path.join(state, 'directions', id);
  const tokensFile = path.join(dir, 'tokens.json');
  if (!existsSync(tokensFile)) throw new UsageError(`${toPosix(tokensFile)} is missing; the direction's token plan comes first (DR-03)`);
  const tokens = loadTokens(tokensFile);
  const brief = readBrief(state);
  const comp = compSource({ dir, id, tokens, brief, root, mode: options.mode ?? 'auto' });
  if (comp.html !== null) writeText(comp.file, comp.html);
  const names = options.names ?? maskNamesFor(brief, profile);
  const server = await serveStatic(dir, { spaFallback: false });
  /** @type {Record<string, unknown>} */
  const outputs = {};
  /** @type {string[]} */
  const blocked = [];
  /** @type {string[]} */
  const errors = [];
  /** @type {Record<string, {replaced: number, remaining: string[]}>} */
  const masked = {};
  /** @type {Record<string, boolean>} */
  const viewportMeta = {};
  try {
    for (const viewport of COMP_VIEWPORTS) {
      log(`render ${id} at ${viewport.name} ${viewport.width}x${viewport.height}`);
      const open = await openComp(browser, viewport, server.url, comp);
      try {
        const facts = await open.page.evaluate(compFacts);
        viewportMeta[viewport.name] = facts.viewportMeta;
        const shot = await open.page.screenshot({ animations: 'disabled', caret: 'hide' });
        const file = writeBinary(path.join(dir, `hero-${viewport.name}.png`), shot);
        const replaced = names.length > 0 ? await open.page.evaluate(maskInPage, names) : 0;
        const after = await open.page.evaluate(collectText, {});
        const visible = after.filter((t) => t.visible).map((t) => t.text).join(' ');
        const remaining = names.filter((n) => mentions(visible, n.name)).map((n) => n.name);
        const boardShot = await open.page.screenshot({ animations: 'disabled', caret: 'hide' });
        const boardFile = writeBinary(path.join(dir, `hero-${viewport.name}.board.png`), boardShot);
        masked[viewport.name] = { replaced, remaining };
        outputs[`hero_${viewport.name}`] = { path: file, sha256: sha256File(file), ...pngSize(file) };
        outputs[`board_${viewport.name}`] = { path: boardFile, sha256: sha256File(boardFile), ...pngSize(boardFile) };
        blocked.push(...open.blocked.map((u) => `${viewport.name}: ${u}`));
        errors.push(...open.errors.map((e) => `${viewport.name}: ${e}`));
      } finally {
        await open.close();
      }
    }
  } finally {
    await server.close();
  }
  const record = {
    version: 1, direction: id, at: utcSeconds(), comp: comp.kind, comp_file: comp.file, missing_tokens: comp.missing,
    inputs: { tokens_sha256: tokens.sha256, comp_sha256: sha256File(comp.file), brief_sha256: brief?.sha256 ?? null },
    outputs, masked, blocked, errors, viewport_meta: viewportMeta, names: names.map((n) => n.label === '[Sponsor]' ? 'sponsor' : 'customer'),
  };
  writeJson(path.join(dir, 'render.json'), record);
  return record;
}

// ------------------------------------------------------------------------------------------------ screening

/**
 * The tier rules of the tells gates applied to one comp (CONTRACTS section 5): a confirmed tier-1 finding not covered
 * by the category allowlist or a waiver blocks; a tier-2 finding without a waiver carrying a reason and evidence
 * blocks; candidate and advisory findings add their weight (anchors count double) to a score that blocks only above
 * profile.tells.score_max; a detector that failed blocks, because the comp was not fully screened.
 * @param {Finding[]} findings
 * @param {Rule[]} rules
 * @param {Allowlist} allowlist
 * @param {number | null} scoreMax
 * @returns {{findings: ScreenFinding[], score: number, fired: string[], errors: number}}
 */
export function judgeTells(findings, rules, allowlist, scoreMax) {
  const byId = new Map(rules.map((r) => [r.id, r]));
  /** @type {ScreenFinding[]} */
  const out = [];
  let score = 0;
  let errors = 0;
  const fired = new Set();
  const waived = (/** @type {string} */ id) => allowlist.waivers.some((w) => w.rule === id && w.reason.trim() !== '' && (Array.isArray(w.evidence) ? w.evidence.some((e) => e.trim()) : String(w.evidence ?? '').trim() !== ''));
  const category = (/** @type {string} */ id) => allowlist.category.some((c) => c.rule === id && c.reason.trim() !== '');
  /** @type {Map<string, Finding[]>} */
  const perRule = new Map();
  for (const f of findings) {
    if ('error' in f) {
      errors += 1;
      const viewport = typeof f.viewport === 'string' ? f.viewport : undefined;
      out.push({ check: 'tells.error', detail: `${f.rule}: ${String(f.error)}`, blocking: true, rule: f.rule, viewport });
      continue;
    }
    const list = perRule.get(f.rule);
    if (list) list.push(f);
    else perRule.set(f.rule, [f]);
  }
  for (const [id, list] of perRule) {
    const rule = byId.get(id);
    if (!rule) continue;
    fired.add(id);
    const first = /** @type {import('./rules/load.mjs').RuntimeFinding} */ (list[0]);
    const where = `${list.length} finding(s), first at ${first.viewport ?? ''} ${first.selector ?? ''}`.trim();
    const detail = `${id} ${rule.title} (${rule.tier}): ${first.detail || String(first.value ?? '')}; ${where}`;
    if (rule.tier === 'tier1') {
      const exempt = category(id) || waived(id);
      out.push({ check: 'tells.tier1', detail: exempt ? `${detail}; exempt by the category allowlist or a waiver` : detail, blocking: !exempt, rule: id, viewport: first.viewport, selector: first.selector });
    } else if (rule.tier === 'tier2') {
      const ok = waived(id);
      out.push({ check: 'tells.tier2', detail: ok ? `${detail}; waived` : `${detail}; no waiver with a reason and evidence`, blocking: !ok, rule: id, viewport: first.viewport, selector: first.selector });
    } else {
      score += (rule.weight ?? 1) * (rule.anchor ? 2 : 1);
      out.push({ check: 'tells.candidate', detail, blocking: false, rule: id, viewport: first.viewport, selector: first.selector });
    }
  }
  if (scoreMax !== null && score > scoreMax) out.push({ check: 'tells.score', detail: `tells score ${score} above profile.tells.score_max ${scoreMax}`, blocking: true });
  return { findings: out, score, fired: [...fired], errors };
}

/**
 * The similar-prompt test (DR-08, FD15-F08): colours with the same value and families with the same name as the
 * plan a fresh agent drew from a generic brief, plus the closest colour pairs. An identical item is kept, not
 * blocking, only when notes.md's similar-prompt table gives it a row whose last cell starts with "keep" and a reason.
 * @param {DirectionTokens} tokens
 * @param {DirectionTokens} generic
 * @param {DirectionNotes | null} notes
 * @param {DirectionNotes | null} genericNotes
 * @returns {{identical: string[], kept: string[], closest: Array<{token: string, generic: string, distance: number}>}}
 */
export function similarPrompt(tokens, generic, notes, genericNotes) {
  /** @type {Array<{label: string, keys: string[]}>} */
  const identical = [];
  for (const t of tokens.colors) {
    for (const [theme, v] of Object.entries(t.value)) {
      const hex = hexOf(v);
      if (!hex) continue;
      const match = generic.colors.find((g) => Object.values(g.value).some((gv) => hexOf(gv) === hex));
      if (match) identical.push({ label: `colour ${t.name} ${hex}${tokens.themes.length > 1 ? ` (${theme})` : ''} equals the generic plan's ${match.name}`, keys: [t.name, hex] });
    }
  }
  for (const role of /** @type {const} */ (['display', 'body', 'mono'])) {
    const a = primaryFamily(tokens.families[role]);
    const b = primaryFamily(generic.families[role]);
    if (a && b && a === b && !GENERIC_FAMILIES.has(a)) identical.push({ label: `font ${role} ${a} equals the generic plan's`, keys: [`font ${role}`, role, a] });
  }
  if (notes?.layout && genericNotes?.layout && jaccard(notes.layout, genericNotes.layout) >= SIMILARITY.layoutJaccard) {
    identical.push({ label: 'layout concept close to the generic plan\'s', keys: ['layout'] });
  }
  /** @type {Array<{token: string, generic: string, distance: number}>} */
  const closest = [];
  for (const t of tokens.colors) {
    let best = { generic: '', distance: Number.POSITIVE_INFINITY };
    for (const g of generic.colors) {
      for (const v of Object.values(t.value)) {
        for (const gv of Object.values(g.value)) {
          const d = oklabDistance(v, gv);
          if (d !== null && d < best.distance) best = { generic: g.name, distance: d };
        }
      }
    }
    if (Number.isFinite(best.distance)) closest.push({ token: t.name, generic: best.generic, distance: Math.round(best.distance * 1000) / 1000 });
  }
  closest.sort((a, b) => a.distance - b.distance);
  /** @type {string[]} */
  const keep = [];
  /** @type {string[]} */
  const block = [];
  for (const item of identical) {
    const row = (notes?.similarRows ?? []).find((cells) => item.keys.some((k) => cells[0].toLowerCase().includes(k.toLowerCase())));
    const last = row ? row[row.length - 1] : '';
    if (/^keep\b/i.test(last) && last.split(/\s+/).length >= 4) keep.push(`${item.label}; kept: ${last}`);
    else block.push(item.label);
  }
  return { identical: block, kept: keep, closest: closest.slice(0, 3) };
}

/**
 * The fields of a direction the past-directions ledger compares (DR-10).
 * @param {DirectionTokens} tokens
 * @param {DirectionNotes | null} notes
 * @returns {{ground: string | null, accent: string | null, display: string | null, body: string | null, signature: string | null}}
 */
export function ledgerFields(tokens, notes) {
  const roles = colorRoles(tokens);
  const first = (/** @type {Role} */ r) => {
    const t = roles.get(r)?.[0];
    const v = t ? t.value[tokens.themes[0]] ?? Object.values(t.value)[0] : null;
    return v ? hexOf(v) : null;
  };
  return {
    ground: first('ground'),
    accent: first('accent'),
    display: primaryFamily(tokens.families.display) || null,
    body: primaryFamily(tokens.families.body) || null,
    signature: notes?.signature || null,
  };
}

/**
 * Past directions this one repeats on most fields: ground and accent within the same-colour distance, the same
 * display and body families, a signature element with overlapping words; a repeat matches at least three fields and
 * more than half of those both sides fill. The entry recorded from these very tokens is skipped.
 * @param {ReturnType<typeof ledgerFields>} fields
 * @param {string} tokensSha
 * @param {PastEntry[]} past
 * @returns {Array<{entry: PastEntry, matched: string[]}>}
 */
export function nearDuplicates(fields, tokensSha, past) {
  /** @type {Array<{entry: PastEntry, matched: string[]}>} */
  const out = [];
  for (const entry of past) {
    if (entry.tokens_sha256 === tokensSha) continue;
    /** @type {string[]} */
    const matched = [];
    let comparable = 0;
    const colour = (/** @type {'ground' | 'accent'} */ key) => {
      if (!fields[key] || !entry[key]) return;
      comparable += 1;
      const d = oklabDistance(/** @type {string} */ (fields[key]), /** @type {string} */ (entry[key]));
      if (d !== null && d <= SIMILARITY.sameColor) matched.push(key);
    };
    colour('ground');
    colour('accent');
    for (const key of /** @type {const} */ (['display', 'body'])) {
      if (!fields[key] || !entry[key]) continue;
      comparable += 1;
      if (fields[key] === String(entry[key]).toLowerCase()) matched.push(key);
    }
    if (fields.signature && entry.signature) {
      comparable += 1;
      if (jaccard(fields.signature, entry.signature) >= SIMILARITY.signatureJaccard) matched.push('signature');
    }
    if (matched.length >= 3 && matched.length > comparable / 2) out.push({ entry, matched });
  }
  return out;
}

/**
 * One finding per check and detail, with the viewports it was seen at joined ("desktop, mobile").
 * @param {ScreenFinding[]} findings
 * @returns {ScreenFinding[]}
 */
export function mergeFindings(findings) {
  /** @type {Map<string, ScreenFinding>} */
  const byKey = new Map();
  for (const f of findings) {
    const key = `${f.check}\n${f.detail}\n${f.blocking}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...f });
    } else if (f.viewport && prev.viewport !== undefined && !prev.viewport.split(', ').includes(f.viewport)) {
      prev.viewport = `${prev.viewport}, ${f.viewport}`;
    }
  }
  return [...byKey.values()];
}

/**
 * @param {string} file
 * @returns {PastEntry[]}
 */
export function readPast(file) {
  if (!existsSync(file)) return [];
  const raw = readJson(file, 'past-directions ledger');
  if (!isObject(raw) || !Array.isArray(raw.entries)) throw new UsageError(`${toPosix(file)} must be {version: 1, entries: [...]}`);
  return /** @type {PastEntry[]} */ (raw.entries.filter(isObject));
}

/**
 * Screens one direction (DR-09): the comp rendered by `render` is current; the runtime tells on the comp at both
 * viewports; the token contrast table; the comp paints only token colours and renders the planned families; it
 * carries the brief's H1 and sentence, declares a viewport and requests nothing from another origin; the
 * similar-prompt test; and the past-directions ledger.
 * @param {{browser: Browser, state: string, id: string, profile: Profile, root: string, generic?: string | null, past?: string | null,
 *   registry?: string | null, rulesDir?: string | null, log?: (line: string) => void}} options
 * @returns {Promise<{direction: string, ok: boolean, findings: ScreenFinding[], identical_to_generic: string[], near_duplicate_of: string[],
 *   kept: string[], closest: Array<{token: string, generic: string, distance: number}>, contrast: ContrastPair[], tells: {score: number, fired: string[], errors: number},
 *   palette: Array<{color: string, prop: string, where: string, viewport: string}>, fonts: Record<string, string | null>, at: string, inputs: Record<string, string | null>}>}
 */
export async function screenDirection(options) {
  const { browser, state, id, profile, root } = options;
  const log = options.log ?? (() => {});
  const dir = path.join(state, 'directions', id);
  /** @type {ScreenFinding[]} */
  const findings = [];
  const block = (/** @type {string} */ check, /** @type {string} */ detail, /** @type {Partial<ScreenFinding>} */ extra = {}) => findings.push({ check, detail, blocking: true, ...extra });
  const tokensFile = path.join(dir, 'tokens.json');
  if (!existsSync(tokensFile)) throw new UsageError(`${toPosix(tokensFile)} is missing; nothing to screen`);
  const registryFile = options.registry ?? DEFAULT_REGISTRY;
  const registry = loadRegistry(registryFile === DEFAULT_REGISTRY ? undefined : registryFile);
  const rulesDir = options.rulesDir ?? DEFAULT_RULES_DIR;
  const missingDetectors = registry.rules.filter((r) => r.runtime && !existsSync(path.join(rulesDir, 'runtime', `${r.id}.mjs`))).map((r) => r.id);
  if (missingDetectors.length > 0) {
    throw new EnvError(`the runtime detectors of ${missingDetectors.join(', ')} are missing from ${toPosix(path.join(rulesDir, 'runtime'))}; the skill's install is incomplete, so no comp can be screened`);
  }
  const tokens = loadTokens(tokensFile);
  const notes = readNotes(path.join(dir, 'notes.md'));
  const brief = readBrief(state);
  const renderFile = path.join(dir, 'render.json');
  const render = existsSync(renderFile) ? readJson(renderFile, 'render record') : null;
  /** @type {CompSource | null} */
  let comp = null;
  if (!isObject(render)) {
    block('render.missing', `render.json is missing; run board.mjs render --direction ${id} first`);
  } else {
    const compFile = str(render.comp_file);
    const inputs = isObject(render.inputs) ? render.inputs : {};
    if (inputs.tokens_sha256 !== tokens.sha256) block('render.stale', 'tokens.json changed after the comps were rendered; render again');
    if (!compFile || !existsSync(compFile)) block('render.missing', `the rendered comp ${compFile || '(none)'} is gone; render again`);
    else if (inputs.comp_sha256 !== sha256File(compFile)) block('render.stale', `${path.basename(compFile)} changed after the comps were rendered; render again`);
    const outputs = isObject(render.outputs) ? render.outputs : {};
    for (const key of ['hero_desktop', 'hero_mobile', 'board_desktop', 'board_mobile']) {
      const out = isObject(outputs[key]) ? outputs[key] : {};
      const p = str(out.path);
      if (!p || !existsSync(p)) block('render.missing', `${key.replace('_', '-')} PNG is missing; render again`);
      else if (out.sha256 !== sha256File(p)) block('render.stale', `${path.basename(p)} changed after rendering; render again`);
    }
    const masked = isObject(render.masked) ? render.masked : {};
    for (const [vp, m] of Object.entries(masked)) {
      const remaining = isObject(m) && Array.isArray(m.remaining) ? m.remaining.map(String) : [];
      if (remaining.length > 0) block('board.names', `the ${vp} board image still shows ${remaining.join(', ')} after masking (an image or CSS content?); remove the name from the comp`);
    }
    if (compFile && existsSync(compFile)) {
      comp = render.comp === 'template' ? { kind: 'template', file: toPosix(compFile), html: null, fonts: fontFilesFor(tokens, dir, root), missing: [] } : { kind: 'hero', file: toPosix(compFile), html: null, fonts: [], missing: [] };
    }
    if (Array.isArray(render.missing_tokens) && render.missing_tokens.length > 0) block('tokens.plan', `the plan lacks ${render.missing_tokens.join(', ')}; the comp fell back to the browser's defaults there`);
  }

  const contrast = contrastTable(tokens);
  for (const p of contrast.filter((x) => !x.ok && x.blocking)) {
    block('tokens.contrast', `${p.theme}: ${p.fg} on ${p.bg} ${p.ratio === null ? 'cannot be computed (unparsable value)' : `${p.ratio}:1`}, needs ${p.required}:1 (${p.kind})`);
  }
  const roles = colorRoles(tokens);
  if (!roles.get('ground')?.length) block('tokens.roles', 'no ground colour token: name one ground, bg or background, or say background in its usage');
  if (!roles.get('text')?.length) block('tokens.roles', 'no text colour token: name one text, ink or fg, or say text in its usage');
  if (tokens.colors.length < 4) block('tokens.plan', `${tokens.colors.length} colour token(s); a direction names 4 to 6 colours with roles (DR-03)`);

  /** @type {Array<{color: string, prop: string, where: string, viewport: string}>} */
  const palette = [];
  /** @type {Record<string, string | null>} */
  const fonts = {};
  let tellScore = { score: 0, fired: /** @type {string[]} */ ([]), errors: 0 };
  if (comp) {
    const allowlist = loadAllowlists(root, profile);
    const server = await serveStatic(dir, { spaFallback: false });
    /** @type {Finding[]} */
    const tellFindings = [];
    try {
      for (const viewport of COMP_VIEWPORTS) {
        log(`screen ${id} at ${viewport.name}`);
        const open = await openComp(browser, viewport, server.url, comp);
        try {
          const facts = await open.page.evaluate(compFacts);
          if (!facts.viewportMeta && viewport.isMobile) block('render.viewport-meta', 'the comp has no <meta name="viewport">, so a phone lays it out at 980 px and zooms out', { viewport: viewport.name });
          for (const u of open.blocked) block('render.network', `the comp requests ${u}; a comp loads nothing from another origin (no CDN font, no remote image)`, { viewport: viewport.name });
          for (const e of open.errors) block('render.errors', `script error in the comp: ${e}`, { viewport: viewport.name });
          if (brief) {
            const text = sameTextKey(facts.text);
            if (brief.h1 && !text.includes(sameTextKey(brief.h1))) block('copy.hero', `the comp does not show the brief's H1 "${brief.h1}"`, { viewport: viewport.name });
            if (brief.sentence && !text.includes(sameTextKey(brief.sentence))) block('copy.hero', 'the comp does not show the brief\'s hero sentence', { viewport: viewport.name });
          }
          if (/\blorem ipsum\b/i.test(facts.text)) block('copy.placeholder', 'the comp shows lorem ipsum; use the brief\'s copy', { viewport: viewport.name });
          for (const p of await open.page.evaluate(paletteOf)) palette.push({ ...p, viewport: viewport.name });
          for (const [role, selector] of /** @type {const} */ ([['display', '[data-hero="h1"], h1'], ['body', '[data-hero="sentence"], p']])) {
            const planned = primaryFamily(tokens.families[role]);
            const rendered = await renderedFamily(open.page, selector);
            fonts[`${viewport.name}.${role}`] = rendered;
            if (planned && !GENERIC_FAMILIES.has(planned) && rendered && rendered.toLowerCase() !== planned) {
              block('fonts.fallback', `the ${role} text renders in ${rendered}, not the planned ${tokens.families[role]}; put the font file beside tokens.json (type.fonts[].file)`, { viewport: viewport.name });
            }
          }
          const ctx = await runtimeContext(browser, open.page, { path: `/${path.basename(comp.file)}`, name: `direction-${id}`, first: true, features: [], states: [] }, { ...viewport }, profile, allowlist);
          tellFindings.push(...await runRuntime(registry, ctx, { dir: rulesDir }));
        } finally {
          await open.close();
        }
      }
    } finally {
      await server.close();
    }
    const judged = judgeTells(tellFindings, registry.rules, allowlist, profile.tells.score_max);
    findings.push(...judged.findings);
    tellScore = { score: judged.score, fired: judged.fired, errors: judged.errors };
    const tokenValues = tokens.colors.flatMap((t) => Object.values(t.value));
    /** @type {Set<string>} */
    const reported = new Set();
    for (const p of palette) {
      const near = tokenValues.some((v) => {
        const d = oklabDistance(p.color, v);
        return d !== null && d <= SIMILARITY.paletteTolerance;
      });
      const key = `${p.prop} ${hexOf(p.color) ?? p.color}`;
      if (!near && !reported.has(key)) {
        reported.add(key);
        block('tokens.palette', `${p.where} paints ${p.prop} ${p.color}, which is no token of the plan; use the plan's colours only`, { viewport: p.viewport });
      }
    }
  }

  const genericDir = options.generic ?? path.join(state, 'similar-prompt');
  const genericFile = path.join(genericDir, 'tokens.json');
  let identical = /** @type {string[]} */ ([]);
  let kept = /** @type {string[]} */ ([]);
  let closest = /** @type {Array<{token: string, generic: string, distance: number}>} */ ([]);
  if (!existsSync(genericFile)) {
    block('similar-prompt.missing', `no generic plan at ${toPosix(genericFile)}: a fresh agent draws one from the generic brief first (DR-08)`);
  } else {
    const sp = similarPrompt(tokens, loadTokens(genericFile), notes, readNotes(path.join(genericDir, 'notes.md')));
    identical = sp.identical;
    kept = sp.kept;
    closest = sp.closest;
    for (const item of identical) block('similar-prompt', `${item}: a value the generic brief also produces came from the prior; change it and say why in notes.md, or keep it with a reason in the similar-prompt table`);
  }

  const pastFile = options.past ?? process.env.FRONTEND_PAST_DIRECTIONS ?? DEFAULT_PAST_FILE;
  const dupes = nearDuplicates(ledgerFields(tokens, notes), tokens.sha256, readPast(pastFile));
  const nearDuplicateOf = dupes.map((d) => `${d.entry.project}/${d.entry.direction} ${d.entry.name} (${d.matched.join(', ')})`);
  for (const d of nearDuplicateOf) {
    if (notes?.reuse) findings.push({ check: 'past', detail: `repeats ${d}; reuse requested by the owner: ${notes.reuse}`, blocking: false });
    else block('past', `repeats the past direction ${d}; replace it, or record the owner's reuse request in notes.md (DR-10)`);
  }
  if (!notes) block('notes.missing', 'notes.md is missing (assets/templates/direction.md)');

  const merged = mergeFindings(findings);
  const ok = merged.every((f) => !f.blocking);
  return {
    direction: id, ok, findings: merged, identical_to_generic: identical, near_duplicate_of: dupes.map((d) => `${d.entry.project}/${d.entry.direction}`),
    kept, closest, contrast, tells: tellScore, palette, fonts, at: utcSeconds(),
    inputs: { tokens_sha256: tokens.sha256, generic: existsSync(genericFile) ? toPosix(genericFile) : null, past: existsSync(pastFile) ? toPosix(pastFile) : null },
  };
}

// ------------------------------------------------------------------------------------------------ gates

/**
 * @param {string} state
 * @returns {{dir: string, ids: string[], others: string[]}}
 */
export function listDirections(state) {
  const dir = path.join(state, 'directions');
  if (!existsSync(dir)) return { dir, ids: [], others: [] };
  const entries = readdirSync(dir, { withFileTypes: true });
  const ids = entries.filter((e) => e.isDirectory() && DIRECTION_IDS.includes(e.name)).map((e) => e.name).sort();
  const others = entries.filter((e) => !(e.isDirectory() && DIRECTION_IDS.includes(e.name))).map((e) => e.name);
  return { dir, ids, others };
}

/** The anchors feDirections assigns (assets/wave-fragments/directions.js). */
export const ANCHORS = Object.freeze(['customer-a', 'customer-b', 'domain', 'utilitarian', 'category']);

/**
 * The source an anchor names: one of ANCHORS when the text starts with it ("customer-a (the conventions of ...)"),
 * else the normalised text.
 * @param {string} anchor
 * @returns {string}
 */
export function anchorKey(anchor) {
  const text = normaliseText(anchor).toLowerCase();
  const known = ANCHORS.find((a) => text === a || text.startsWith(`${a} `) || text.startsWith(`${a}:`) || text.startsWith(`${a},`) || text.startsWith(`${a} (`));
  return known ?? text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * @param {{width: number, height: number} | null} size
 * @param {number} w
 * @param {number} h
 * @returns {boolean}
 */
function sizeMatches(size, w, h) {
  if (!size) return false;
  return [1, 2, 3].some((k) => size.width === w * k && Math.abs(size.height - h * k) <= 1);
}

/**
 * directions.present: 2-3 directions (1-2 in small mode) under directions/<A|B|C>/, each with tokens.json (4 colours
 * or more), notes.md (name, anchor, rationale, trade-off, no placeholder left), hero-desktop.png at 1440x900 and
 * hero-mobile.png at 390x844 (any device pixel ratio), each anchored in a different source.
 * @param {string} state
 * @param {Pick<Profile, 'mode'>} profile
 * @returns {GateResult}
 */
export function checkPresent(state, profile) {
  const g = gate(GATES[0]);
  const { ids, others } = listDirections(state);
  const [min, max] = profile.mode === 'small' ? [1, 2] : [2, 3];
  /** @type {import('./lib/report.mjs').Evidence[]} */
  const evidence = [];
  /** @type {string[]} */
  const problems = [];
  if (ids.length < min || ids.length > max) problems.push(`${ids.length} direction(s) under ${toPosix(path.join(state, 'directions'))}, ${profile.mode} mode needs ${min} to ${max}`);
  /** @type {Map<string, string>} */
  const anchors = new Map();
  for (const id of ids) {
    const dir = path.join(state, 'directions', id);
    const fail = (/** @type {string} */ what, /** @type {string} */ file) => {
      problems.push(`${id}: ${what}`);
      evidence.push({ file: toPosix(path.join(dir, file)), value: what });
    };
    const tokensFile = path.join(dir, 'tokens.json');
    if (!existsSync(tokensFile)) fail('tokens.json is missing', 'tokens.json');
    else {
      try {
        const t = loadTokens(tokensFile);
        if (t.colors.length < 4) fail(`tokens.json names ${t.colors.length} colour(s); a plan names 4 to 6 with roles`, 'tokens.json');
      } catch (err) {
        fail(`tokens.json is not a token plan (${err instanceof Error ? err.message : String(err)})`, 'tokens.json');
      }
    }
    const desktop = pngSize(path.join(dir, 'hero-desktop.png'));
    if (!sizeMatches(desktop, 1440, 900)) fail(desktop ? `hero-desktop.png is ${desktop.width}x${desktop.height}, not 1440x900` : 'hero-desktop.png is missing', 'hero-desktop.png');
    const mobile = pngSize(path.join(dir, 'hero-mobile.png'));
    if (!sizeMatches(mobile, 390, 844)) fail(mobile ? `hero-mobile.png is ${mobile.width}x${mobile.height}, not 390x844 at any device pixel ratio` : 'hero-mobile.png is missing', 'hero-mobile.png');
    const notes = readNotes(path.join(dir, 'notes.md'));
    if (!notes) fail('notes.md is missing', 'notes.md');
    else {
      for (const [field, value] of /** @type {const} */ ([['name', notes.name], ['anchor', notes.anchor], ['rationale', notes.rationale], ['trade-off', notes.tradeOff]])) {
        if (!value) fail(`notes.md has no ${field}`, 'notes.md');
      }
      if (notes.placeholders.length > 0) fail(`notes.md still has template placeholders (${notes.placeholders.slice(0, 5).join(', ')})`, 'notes.md');
      const key = anchorKey(notes.anchor);
      if (key) {
        const other = anchors.get(key);
        if (other) fail(`anchored in the same source as ${other} (${notes.anchor}); anchor each direction in a different source`, 'notes.md');
        else anchors.set(key, id);
      }
    }
  }
  if (others.length > 0) evidence.push({ value: `ignored under directions/: ${others.join(', ')}` });
  if (problems.length > 0) return g.fail(problems.join('; '), evidence);
  return g.ok(`${ids.length} direction(s) (${ids.join(', ')}) with tokens, notes, and comps at 1440x900 and 390x844, each from its own anchor`, evidence);
}

/**
 * directions.screened: every direction folder with tokens.json passes screenDirection.
 * @param {{browser: Browser, state: string, profile: Profile, root: string, generic?: string | null, past?: string | null,
 *   registry?: string | null, rulesDir?: string | null, log?: (line: string) => void}} options
 * @returns {Promise<GateResult>}
 */
export async function checkScreened(options) {
  const g = gate(GATES[1]);
  const { ids } = listDirections(options.state);
  const withTokens = ids.filter((id) => existsSync(path.join(options.state, 'directions', id, 'tokens.json')));
  if (withTokens.length === 0) return g.fail(`no direction with tokens.json under ${toPosix(path.join(options.state, 'directions'))}`);
  /** @type {import('./lib/report.mjs').Evidence[]} */
  const evidence = [];
  /** @type {string[]} */
  const failed = [];
  for (const id of withTokens) {
    /** @type {Awaited<ReturnType<typeof screenDirection>>} */
    let result;
    try {
      result = await screenDirection({ ...options, id });
    } catch (err) {
      if (err instanceof EnvError) return g.skip(`cannot screen ${id}: ${err.message}`);
      throw err;
    }
    for (const f of result.findings.filter((x) => x.blocking)) evidence.push({ route: id, viewport: f.viewport ?? '', selector: f.selector ?? '', value: `${f.check}: ${f.detail}` });
    if (!result.ok) failed.push(`${id} (${result.findings.filter((x) => x.blocking).length} finding(s))`);
  }
  if (failed.length > 0) return g.fail(`not screened clean: ${failed.join(', ')}`, evidence.slice(0, 200));
  return g.ok(`${withTokens.length} direction(s) screened clean: tells, token contrast, palette, fonts, copy, similar-prompt test and past directions`);
}

/**
 * The module API of CONTRACTS section 4: the gates of this module selected by id, run on the check context. A browser
 * from the context is used, else one is launched for the screen. ctx.args may carry generic, past, registry and
 * rulesDir (the board.mjs CLI flags of the same names).
 * @param {CheckContext} ctx
 * @param {string[]} selected
 * @returns {Promise<GateResult[]>}
 */
export async function run(ctx, selected) {
  const want = new Set(selected.length > 0 ? selected : GATES.map((g) => g.id));
  /** @type {GateResult[]} */
  const results = [];
  if (want.has('directions.present')) results.push(checkPresent(ctx.state, ctx.profile));
  if (want.has('directions.screened')) {
    const args = ctx.args ?? {};
    const own = ctx.browser ? null : await launch();
    try {
      results.push(await checkScreened({
        browser: /** @type {Browser} */ (ctx.browser ?? own), state: ctx.state, profile: ctx.profile, root: ctx.root,
        generic: typeof args.generic === 'string' ? args.generic : null, past: typeof args.past === 'string' ? args.past : null,
        registry: typeof args.registry === 'string' ? args.registry : null, rulesDir: typeof args.rulesDir === 'string' ? args.rulesDir : null,
        log: ctx.log,
      }));
    } finally {
      await own?.close();
    }
  }
  return results;
}

// ------------------------------------------------------------------------------------------------ board and canvas

/**
 * The image-only artboard of the Design type for one PNG (references/03-directions.md, "Publishing the board"): the
 * image at its CSS size, its src a {{ASSET:<file>}} placeholder the orchestrator replaces with the uploaded asset url.
 * @param {{title: string, alt: string, asset: string, width: number, height: number}} a
 * @returns {string}
 */
export function artboardHtml({ title, alt, asset, width, height }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${html(title)}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
body{margin:0}
</style>
</helmet>
<div style="width: ${width}px; height: ${height}px">
<img src="{{ASSET:${asset}}}" alt="${html(alt)}" style="display: block; width: ${width}px; height: ${height}px">
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${width},"height":${height}}}'>
class Component extends DCLogic {
renderVals() {
return {};
}
}
</script>
</body>
</html>
`;
}

/**
 * Writes a Design canvas skeleton: project/canvas.json and one image-only artboard per row cell. The first artboard is
 * Main.dc.html (the index's entry). Rows sit 120 px apart; within a row the cells sit 80 px apart.
 * @param {string} root folder that receives project/
 * @param {string} title
 * @param {Array<Array<{key: string, title: string, alt: string, asset: string, width: number, height: number}>>} rows
 * @returns {{root: string, index: string, files: Record<string, string>}}
 */
export function writeCanvas(root, title, rows) {
  rmSync(path.join(root, 'project'), { recursive: true, force: true });
  /** @type {Record<string, {x: number, y: number, w: number, h: number, title: string}>} */
  const boards = {};
  /** @type {string[]} */
  const order = [];
  /** @type {Record<string, string>} */
  const files = {};
  let y = 0;
  let first = true;
  for (const row of rows) {
    let x = 0;
    let tallest = 0;
    for (const cell of row) {
      const name = first ? 'Main.dc.html' : `${cell.key}.dc.html`;
      first = false;
      boards[name] = { x, y, w: cell.width, h: cell.height, title: cell.title };
      order.push(name);
      const file = writeText(path.join(root, 'project', name), artboardHtml(cell));
      files[`project/${name}`] = file;
      x += cell.width + 80;
      tallest = Math.max(tallest, cell.height);
    }
    y += tallest + 120;
  }
  const canvas = { v: 3, createdOnFiles: { v: 1, at: utcSeconds() }, title, launch: { view: 'canvas' }, pages: [], boards, order, notes: {}, designSystems: [] };
  const index = writeText(path.join(root, 'project', 'canvas.json'), `${JSON.stringify(canvas)}\n`);
  files['project/canvas.json'] = index;
  return { root: toPosix(path.resolve(root)), index, files };
}

/**
 * Builds the H1 board: every direction whose render and screen are current and clean becomes a desktop and a mobile
 * artboard of its masked images, with the same parts for every direction (name, anchor, token summary, signature,
 * motivation, trade-off, screen results) under `cases` for the question text (DR-12); names are masked everywhere
 * (DR-16). ok when every direction folder is on the board.
 * @param {{state: string, profile: Profile, root: string, names?: MaskName[], title?: string}} options
 * @returns {Record<string, unknown> & {ok: boolean, path: string, directions: string[]}}
 */
export function buildBoard(options) {
  const { state, profile } = options;
  const brief = readBrief(state);
  const names = options.names ?? maskNamesFor(brief, profile);
  const mask = (/** @type {string} */ s) => maskText(s, names);
  const { ids } = listDirections(state);
  const boardDir = path.join(state, 'board');
  /** @type {Array<Record<string, unknown>>} */
  const artboards = [];
  /** @type {Array<Record<string, unknown>>} */
  const cases = [];
  /** @type {Array<{direction: string, reason: string}>} */
  const excluded = [];
  /** @type {Array<Array<{key: string, title: string, alt: string, asset: string, width: number, height: number}>>} */
  const rows = [];
  /** @type {Array<{placeholder: string, path: string}>} */
  const assets = [];
  for (const id of ids) {
    const dir = path.join(state, 'directions', id);
    const why = boardBlocker(dir);
    if (why) {
      excluded.push({ direction: id, reason: why });
      continue;
    }
    const tokens = loadTokens(path.join(dir, 'tokens.json'));
    const notes = readNotes(path.join(dir, 'notes.md'));
    const screen = /** @type {Record<string, unknown>} */ (readJson(path.join(dir, 'screen.json'), 'screen record'));
    const name = mask(notes?.name || str(tokens.meta.direction) || `Direction ${id}`);
    /** @type {Array<{key: string, title: string, alt: string, asset: string, width: number, height: number}>} */
    const row = [];
    for (const vp of COMP_VIEWPORTS) {
      const file = path.join(dir, `hero-${vp.name}.board.png`);
      const rel = `directions/${id}/hero-${vp.name}.board.png`;
      const title = `${id} ${name}, ${vp.name} ${vp.width}x${vp.height}`;
      const size = pngSize(file);
      artboards.push({ id: `${id}-${vp.name}`, direction: id, viewport: vp.name, title, caption: `${id} ${name}: ${vp.name} at ${vp.width}x${vp.height} CSS px`, png: toPosix(file), unmasked_png: toPosix(path.join(dir, `hero-${vp.name}.png`)), width: vp.width, height: vp.height, pixels: size });
      row.push({ key: `${id}-${vp.name}`, title, alt: `Direction ${id} hero at ${vp.width} by ${vp.height}`, asset: rel, width: vp.width, height: vp.height });
      assets.push({ placeholder: `{{ASSET:${rel}}}`, path: toPosix(file) });
    }
    rows.push(row);
    const roles = colorRoles(tokens);
    const swatch = (/** @type {Role} */ r) => (roles.get(r) ?? []).slice(0, 2).map((t) => `${t.name} ${Object.values(t.value)[0]}`).join(', ');
    cases.push({
      direction: id,
      name,
      anchor: mask(notes?.anchor ?? ''),
      reference: mask(notes?.reference ?? ''),
      tokens: mask(`ground: ${swatch('ground') || 'none'}; text: ${swatch('text') || 'none'}; accent: ${swatch('accent') || 'none'}; type: ${tokens.families.display || 'none'} / ${tokens.families.body || 'none'}${tokens.families.mono ? ` / ${tokens.families.mono}` : ''}`),
      signature: mask(notes?.signature ?? ''),
      motivation: mask(notes?.rationale ?? ''),
      trade_off: mask(notes?.tradeOff ?? ''),
      screen: { ok: screen.ok === true, findings: Array.isArray(screen.findings) ? screen.findings.length : 0, identical_to_generic: Array.isArray(screen.identical_to_generic) ? screen.identical_to_generic.length : 0, kept: Array.isArray(screen.kept) ? screen.kept.map(String).map(mask) : [] },
    });
  }
  const project = mask(brief?.projectName || profile.project?.name || 'Project');
  const title = mask(options.title ?? `${project} directions H1`);
  const canvas = rows.length > 0 ? writeCanvas(path.join(boardDir, 'canvas'), title, rows) : null;
  const ok = rows.length > 0 && excluded.length === 0;
  const file = path.join(boardDir, 'board.json');
  const board = {
    version: 1, kind: 'direction-board', at: utcSeconds(), ok, title, project,
    directions: ids.filter((id) => !excluded.some((e) => e.direction === id)), excluded, artboards, cases,
    canvas: canvas ? { ...canvas, assets } : null,
    publish: 'references/03-directions.md, "Publishing the board (orchestrator only)": upload each assets[].path, replace its placeholder in the .dc.html files with the returned url, then publish canvas.root',
    path: toPosix(path.resolve(file)),
  };
  writeJson(file, board);
  return board;
}

/**
 * Why a direction cannot go on the board: comps or the screen missing, stale or failing, or a name left after masking.
 * @param {string} dir
 * @returns {string | null}
 */
function boardBlocker(dir) {
  const renderFile = path.join(dir, 'render.json');
  const screenFile = path.join(dir, 'screen.json');
  if (!existsSync(renderFile)) return 'not rendered (render.json missing)';
  if (!existsSync(screenFile)) return 'not screened (screen.json missing)';
  const render = readJson(renderFile, 'render record');
  const screen = readJson(screenFile, 'screen record');
  if (!isObject(render) || !isObject(screen)) return 'render.json or screen.json is malformed';
  if (screen.ok !== true) return 'the screen failed';
  const tokensSha = existsSync(path.join(dir, 'tokens.json')) ? sha256File(path.join(dir, 'tokens.json')) : '';
  const screenInputs = isObject(screen.inputs) ? screen.inputs : {};
  if (screenInputs.tokens_sha256 !== tokensSha) return 'tokens.json changed after the screen; screen again';
  const outputs = isObject(render.outputs) ? render.outputs : {};
  for (const key of ['board_desktop', 'board_mobile']) {
    const out = isObject(outputs[key]) ? outputs[key] : {};
    if (!str(out.path) || !existsSync(str(out.path)) || out.sha256 !== sha256File(str(out.path))) return `${key.replace('_', ' ')} image missing or changed; render again`;
  }
  const masked = isObject(render.masked) ? render.masked : {};
  for (const m of Object.values(masked)) if (isObject(m) && Array.isArray(m.remaining) && m.remaining.length > 0) return `a name is left on the masked image (${m.remaining.join(', ')})`;
  return null;
}

// ------------------------------------------------------------------------------------------------ logo sheets

/**
 * In-page: draws each mark into small canvases at its real pixel size for the nearest-neighbour enlargements, then
 * raises the ready flag.
 * @returns {Promise<number>}
 */
export const drawPixelCanvases = async function drawPixelCanvases() {
  const canvases = Array.from(document.querySelectorAll('canvas[data-src]'));
  for (const c of canvases) {
    const canvas = /** @type {HTMLCanvasElement} */ (c);
    const img = new Image();
    img.src = canvas.getAttribute('data-src') || '';
    await img.decode();
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = canvas.getAttribute('data-ground') || '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
  }
  Reflect.set(window, '__FRONTEND_READY__', true);
  return canvases.length;
};

/**
 * @param {string} svg
 * @param {string} ink
 * @returns {string}
 */
function markDataUrl(svg, ink) {
  const coloured = svg.replace(/currentColor/gi, ink);
  return `data:image/svg+xml;base64,${Buffer.from(coloured, 'utf8').toString('base64')}`;
}

/**
 * The sheet of one logo candidate (BR-08, CR-17): the mark at 16, 32 and 180 px, 16x nearest-neighbour enlargements of
 * the 16 and 32 px renders, and a one-colour silhouette, on a light and on a dark ground.
 * @param {{n: string, svg: string, label: string}} c
 * @returns {string}
 */
export function candidateSheetHtml(c) {
  const grounds = [{ name: 'On light', ground: '#ffffff', ink: '#111111', silhouette: 'brightness(0)' }, { name: 'On dark', ground: '#111111', ink: '#f5f5f5', silhouette: 'brightness(0) invert(1)' }];
  const rows = grounds.map((g) => {
    const src = markDataUrl(c.svg, g.ink);
    const sizes = LOGO_SIZES.map((s) => `<figure><img src="${src}" width="${s}" height="${s}" alt=""><figcaption>${s} px</figcaption></figure>`).join('');
    const pixels = [16, 32].map((s) => `<figure><canvas data-src="${src}" data-ground="${g.ground}" width="${s}" height="${s}" style="width:${s * 16}px;height:${s * 16}px;image-rendering:pixelated"></canvas><figcaption>${s} px at 16x</figcaption></figure>`).join('');
    const silhouette = `<figure><img src="${src}" width="180" height="180" alt="" style="filter:${g.silhouette}"><figcaption>silhouette</figcaption></figure>`;
    return `<section style="background:${g.ground};color:${g.ink}"><h2>${g.name}</h2><div class="row">${sizes}${pixels}${silhouette}</div></section>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Candidate ${html(c.n)}</title><style>
body{margin:0;font:14px/1.4 Arial,Helvetica,sans-serif;background:#ffffff;color:#111111}
header{padding:16px 24px;border-bottom:1px solid #d0d0d0}
h1{margin:0;font-size:20px}
h2{margin:0 0 12px;font-size:14px;font-weight:700}
section{padding:16px 24px}
.row{display:flex;align-items:flex-end;gap:24px;flex-wrap:nowrap}
figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:6px}
figcaption{font-size:12px;opacity:.8}
img,canvas{display:block}
</style></head><body><header><h1>Candidate ${html(c.n)}${c.label ? `: ${html(c.label)}` : ''}</h1></header>${rows}</body></html>`;
}

/**
 * The overview sheet: every candidate at 16, 32 and 180 px on light and on dark, one row each.
 * @param {Array<{n: string, svg: string, label: string}>} candidates
 * @returns {string}
 */
export function overviewSheetHtml(candidates) {
  const cell = (/** @type {string} */ svg, /** @type {string} */ ground, /** @type {string} */ ink) => `<div class="cell" style="background:${ground}">${LOGO_SIZES.map((s) => `<img src="${markDataUrl(svg, ink)}" width="${s}" height="${s}" alt="">`).join('')}</div>`;
  const rows = candidates.map((c) => `<div class="cand"><div class="n">${html(c.n)}</div>${cell(c.svg, '#ffffff', '#111111')}${cell(c.svg, '#111111', '#f5f5f5')}</div>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Logo candidates</title><style>
body{margin:0;padding:24px;font:14px/1.4 Arial,Helvetica,sans-serif;background:#ffffff;color:#111111}
.cand{display:flex;align-items:stretch;gap:16px;margin:0 0 16px}
.n{width:40px;font-size:20px;font-weight:700;align-self:center}
.cell{display:flex;align-items:flex-end;gap:24px;padding:16px 24px;border:1px solid #d0d0d0}
img{display:block}
</style></head><body>${rows}<script>window.__FRONTEND_READY__ = true;</script></body></html>`;
}

/**
 * Renders the H2 sheets from <state>/brand/candidates/<n>/mark.svg: one sheet per candidate and an overview, then the
 * logo board.json and its canvas skeleton (one row per sheet).
 * @param {{browser: Browser, state: string, profile: Profile, title?: string, log?: (line: string) => void}} options
 * @returns {Promise<Record<string, unknown> & {ok: boolean, path: string}>}
 */
export async function buildLogoBoard(options) {
  const { browser, state, profile } = options;
  const log = options.log ?? (() => {});
  const candDir = path.join(state, 'brand', 'candidates');
  if (!existsSync(candDir)) throw new UsageError(`no logo candidates: ${toPosix(candDir)} is missing; brand.mjs draws them (FE-05)`);
  const brief = readBrief(state);
  const names = maskNamesFor(brief, profile);
  const candidates = readdirSync(candDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(candDir, e.name, 'mark.svg')))
    .map((e) => {
      const meta = existsSync(path.join(candDir, e.name, 'candidate.json')) ? readJson(path.join(candDir, e.name, 'candidate.json'), 'candidate') : {};
      const label = isObject(meta) ? maskText(normaliseText(str(meta.intervention) || str(meta.one_feature)), names).slice(0, 80) : '';
      return { n: e.name, svg: readText(path.join(candDir, e.name, 'mark.svg')), label };
    })
    .sort((a, b) => a.n.localeCompare(b.n, 'en', { numeric: true }));
  if (candidates.length === 0) throw new UsageError(`no candidate under ${toPosix(candDir)} has a mark.svg`);
  const outDir = path.join(state, 'board', 'logos');
  /** @type {Array<{n: string, path: string, width: number, height: number}>} */
  const sheets = [];
  const shoot = async (/** @type {string} */ page, /** @type {string} */ file) => {
    const context = await newContext(browser, { width: 1440, height: 120 });
    try {
      await context.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort('blockedbyclient')));
      const p = await context.newPage();
      await p.setContent(page, { waitUntil: 'load' });
      await p.evaluate(drawPixelCanvases);
      await waitReady(p, { timeoutMs: 15000, readyFlag: true });
      const shot = await p.screenshot({ fullPage: true, animations: 'disabled' });
      const out = writeBinary(file, shot);
      const size = pngSize(out);
      return { path: out, width: size?.width ?? 0, height: size?.height ?? 0 };
    } finally {
      await context.close();
    }
  };
  log(`logo overview of ${candidates.length} candidate(s)`);
  const overview = await shoot(overviewSheetHtml(candidates), path.join(outDir, 'sheet.png'));
  for (const c of candidates) {
    log(`logo sheet of candidate ${c.n}`);
    sheets.push({ n: c.n, ...(await shoot(candidateSheetHtml(c), path.join(outDir, `candidate-${c.n}.png`))) });
  }
  for (const s of [overview, ...sheets]) {
    if (Math.max(s.width, s.height) > 2576) throw new EnvError(`${toPosix(s.path)} is ${s.width}x${s.height}, above the 2576 px a critic or reviewer image allows; fewer candidates per sheet`);
  }
  const project = maskText(brief?.projectName || profile.project?.name || 'Project', names);
  const title = maskText(options.title ?? `${project} logo candidates H2`, names);
  const rows = [[{ key: 'overview', title: 'All candidates at 16, 32 and 180 px', alt: 'All logo candidates on light and dark', asset: 'board/logos/sheet.png', width: overview.width, height: overview.height }],
    ...sheets.map((s) => [{ key: `candidate-${s.n}`, title: `Candidate ${s.n}`, alt: `Logo candidate ${s.n} at 16, 32 and 180 px, enlarged and as a silhouette`, asset: `board/logos/candidate-${s.n}.png`, width: s.width, height: s.height }])];
  const canvas = writeCanvas(path.join(outDir, 'canvas'), title, rows);
  const assets = [{ placeholder: '{{ASSET:board/logos/sheet.png}}', path: overview.path }, ...sheets.map((s) => ({ placeholder: `{{ASSET:board/logos/candidate-${s.n}.png}}`, path: s.path }))];
  const file = path.join(outDir, 'board.json');
  const board = {
    version: 1, kind: 'logo-board', at: utcSeconds(), ok: true, title, project,
    candidates: sheets.map((s) => s.n), overview, sheets, canvas: { ...canvas, assets }, path: toPosix(path.resolve(file)),
  };
  writeJson(file, board);
  return board;
}

// ------------------------------------------------------------------------------------------------ past-directions ledger

/**
 * Appends every direction to the ledger of past directions once H1 is answered (DR-10), with the pick from --pick or
 * from choices.json H1. Recording the same tokens twice is a no-op.
 * @param {{state: string, profile: Profile, root: string, pick?: string | null, project?: string | null, past?: string | null}} options
 * @returns {{path: string, added: PastEntry[], pick: string}}
 */
export function recordPast(options) {
  const { state, profile } = options;
  let pick = options.pick ?? null;
  if (!pick) {
    const choices = path.join(state, 'choices.json');
    const raw = existsSync(choices) ? readJson(choices, 'choices') : null;
    pick = isObject(raw) && isObject(raw.H1) ? str(raw.H1.pick) : null;
  }
  if (!pick || !(DIRECTION_IDS.includes(pick) || pick === 'none')) throw new UsageError('no H1 pick: pass --pick A|B|C|none, or record H1 in choices.json first');
  const file = path.resolve(options.past ?? process.env.FRONTEND_PAST_DIRECTIONS ?? DEFAULT_PAST_FILE);
  const entries = readPast(file);
  const brief = readBrief(state);
  const project = options.project ?? (brief?.projectName || profile.project?.name || path.basename(path.resolve(options.root)));
  /** @type {PastEntry[]} */
  const added = [];
  for (const id of listDirections(state).ids) {
    const tokensFile = path.join(state, 'directions', id, 'tokens.json');
    if (!existsSync(tokensFile)) continue;
    const tokens = loadTokens(tokensFile);
    if (entries.some((e) => e.tokens_sha256 === tokens.sha256)) continue;
    const notes = readNotes(path.join(state, 'directions', id, 'notes.md'));
    const entry = { project, direction: id, name: notes?.name || str(tokens.meta.direction) || id, picked: id === pick, recorded_at: utcSeconds(), ...ledgerFields(tokens, notes), tokens_sha256: tokens.sha256 };
    entries.push(entry);
    added.push(entry);
  }
  writeJson(file, { version: 1, entries });
  return { path: toPosix(file), added, pick };
}

// ------------------------------------------------------------------------------------------------ CLI

const HELP = `Usage:
  node board.mjs render [--direction <A|B|C>] [--comp auto|hero|template] [common]
  node board.mjs screen [--direction <A|B|C>] [--generic <dir>] [--past <file>] [common]
  node board.mjs board  [--title <text>] [common]
  node board.mjs logos  [--title <text>] [common]
  node board.mjs record [--pick <A|B|C|none>] [--project <name>] [--past <file>] [common]
  node board.mjs [--gates directions | directions.present,directions.screened] [--out <dir>] [common]

The directions of P2 and the review boards of H1 and H2 (references/03-directions.md). render and screen take one
direction with --direction, or every direction folder holding a tokens.json without it.

  render   hero comp of <state>/directions/<id>/ at 1440x900 and 390x844 (DPR 2): hero-desktop.png,
           hero-mobile.png, and hero-*.board.png with customer and sponsor names masked; render.json. The comp is
           hero.html (the designer's), or one generated from tokens.json and brief.json when there is none
           (--comp template forces it, written to hero.template.html beside a designer's hero.html).
  screen   runtime tells on the comp (rules/registry.json), the token contrast table, palette and fonts of the comp,
           the brief's copy, the similar-prompt test against <generic>/tokens.json (default <state>/similar-prompt),
           and the past-directions ledger (--past, else $FRONTEND_PAST_DIRECTIONS, else ledger/past-directions.json
           in the skill); writes screen.json; exit 1 when a blocking finding remains.
  board    board.json and a Claude Design canvas skeleton (<state>/board/canvas/project/: canvas.json and
           image-only .dc.html artboards with {{ASSET:<file>}} placeholders) of every rendered and screened direction.
  logos    sheets of <state>/brand/candidates/<n>/mark.svg at 16, 32 and 180 px, 16x enlargements and silhouettes on
           light and dark, plus their board.json and canvas skeleton under <state>/board/logos/.
  record   appends the directions to the past-directions ledger after H1 (pick from --pick or choices.json).
  gates    directions.present and directions.screened as a gate report (CONTRACTS section 4).

Common:
  --root <repo>        repository root (default: the working directory)
  --profile <file>     /execution profile.json or a bare frontend block (default: discovered from --root)
  --state <dir>        state folder (default: .execution/frontend in mode A, .frontend in mode B)
  --registry <file>    another rule registry (tests); --rules-dir <dir> the folder holding its runtime/ detectors
  --json               print the result as one JSON object on stdout
  -h, --help           this text

Exit codes: 0 ok; 1 a gate failed, a screen found a blocking problem, or the board is incomplete; 2 usage (bad flags,
missing input file); 3 environment (no browser, broken registry).`;

const OPTIONS = /** @type {const} */ ({
  direction: { type: 'string' },
  comp: { type: 'string' },
  generic: { type: 'string' },
  past: { type: 'string' },
  title: { type: 'string' },
  pick: { type: 'string' },
  project: { type: 'string' },
  gates: { type: 'string' },
  out: { type: 'string' },
  registry: { type: 'string' },
  'rules-dir': { type: 'string' },
  root: { type: 'string' },
  profile: { type: 'string' },
  state: { type: 'string' },
  json: { type: 'boolean' },
});

/** @typedef {import('./lib/args.mjs').CliValues<typeof OPTIONS>} BoardOptions */

/**
 * @param {BoardOptions} values
 * @returns {{root: string, profile: Profile, state: string}}
 */
function context(values) {
  const root = path.resolve(values.root ?? '.');
  const profile = loadProfile(values.profile, { root });
  return { root: toPosix(root), profile, state: stateDir(root, profile, values.state ?? null) };
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
 * @param {BoardOptions} values
 * @returns {string}
 */
function directionFlag(values) {
  const id = values.direction;
  if (!id || !DIRECTION_IDS.includes(id)) throw new UsageError(`--direction must be A, B or C (got ${JSON.stringify(id ?? null)})`);
  return id;
}

/**
 * @param {string | undefined} gates
 * @returns {string[]}
 */
function selectGates(gates) {
  if (!gates) return GATES.map((g) => g.id);
  /** @type {string[]} */
  const out = [];
  for (const part of gates.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (part === 'directions') out.push(...GATES.map((g) => g.id));
    else if (GATES.some((g) => g.id === part)) out.push(part);
    else throw new UsageError(`unknown gate ${JSON.stringify(part)}; this module has ${GATES.map((g) => g.id).join(', ')} (group: directions)`);
  }
  return [...new Set(out)];
}

/**
 * @param {readonly string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const { values, positionals } = parseCli(argv, { options: OPTIONS, help: HELP });
  const [command, ...rest] = positionals;
  if (rest.length > 0) throw new UsageError(`unexpected argument ${JSON.stringify(rest[0])}; run with --help`);
  const json = Boolean(values.json);
  if (command !== undefined && !['render', 'screen', 'board', 'logos', 'record', 'check'].includes(command)) {
    throw new UsageError(`unknown command ${JSON.stringify(command)}; run with --help`);
  }
  if (values.comp && !['auto', 'hero', 'template'].includes(values.comp)) throw new UsageError('--comp must be auto, hero or template');
  const selected = command === undefined || command === 'check' ? selectGates(values.gates) : [];
  if ((command === 'render' || command === 'screen') && values.direction !== undefined) directionFlag(values);
  const ctx = context(values);
  if (command === 'board') {
    const board = buildBoard({ state: ctx.state, profile: ctx.profile, root: ctx.root, title: values.title });
    emit(board, json, `board ${board.ok ? 'ok' : 'incomplete'}: ${board.directions.length} direction(s) in ${board.path}`);
    return board.ok ? 0 : 1;
  }
  if (command === 'record') {
    const res = recordPast({ state: ctx.state, profile: ctx.profile, root: ctx.root, pick: values.pick ?? null, project: values.project ?? null, past: values.past ?? null });
    emit(res, json, `recorded ${res.added.length} direction(s) (pick ${res.pick}) in ${res.path}`);
    return 0;
  }
  const all = listDirections(ctx.state).ids.filter((id) => existsSync(path.join(ctx.state, 'directions', id, 'tokens.json')));
  if ((command === 'render' || command === 'screen') && values.direction === undefined && all.length === 0) {
    throw new UsageError(`no direction with tokens.json under ${toPosix(path.join(ctx.state, 'directions'))}; pass --direction or draw the directions first`);
  }
  const browser = await launch();
  try {
    if (command === 'render') {
      /** @type {Array<Record<string, unknown>>} */
      const results = [];
      for (const id of values.direction === undefined ? all : [directionFlag(values)]) {
        const record = await renderDirection({ browser, state: ctx.state, id, profile: ctx.profile, root: ctx.root, mode: values.comp ?? 'auto', log: logLine });
        const outputs = /** @type {Record<string, {path: string}>} */ (record.outputs);
        results.push({ direction: id, hero_desktop: outputs.hero_desktop.path, hero_mobile: outputs.hero_mobile.path, board_desktop: outputs.board_desktop.path, board_mobile: outputs.board_mobile.path, comp: record.comp, comp_file: record.comp_file, masked: record.masked, blocked: record.blocked, errors: record.errors });
      }
      emit(values.direction === undefined ? { directions: results } : results[0], json, `rendered ${results.map((r) => `${String(r.direction)} (${String(r.comp)} comp)`).join(', ')}`);
      return 0;
    }
    if (command === 'screen') {
      /** @type {Array<Awaited<ReturnType<typeof screenDirection>>>} */
      const results = [];
      for (const id of values.direction === undefined ? all : [directionFlag(values)]) {
        const result = await screenDirection({ browser, state: ctx.state, id, profile: ctx.profile, root: ctx.root, generic: values.generic ?? null, past: values.past ?? null, registry: values.registry ?? null, rulesDir: values['rules-dir'] ?? null, log: logLine });
        writeJson(path.join(ctx.state, 'directions', id, 'screen.json'), result);
        results.push(result);
      }
      const ok = results.every((r) => r.ok);
      emit(values.direction === undefined ? { ok, directions: results } : results[0], json, results.map((r) => `screened ${r.direction}: ${r.ok ? 'clean' : `${r.findings.filter((f) => f.blocking).length} blocking finding(s)`}`).join('; '));
      return ok ? 0 : 1;
    }
    if (command === 'logos') {
      const board = await buildLogoBoard({ browser, state: ctx.state, profile: ctx.profile, title: values.title, log: logLine });
      emit(board, json, `logo board: ${Array.isArray(board.candidates) ? board.candidates.length : 0} candidate(s) in ${board.path}`);
      return 0;
    }
    const results = await run({ root: ctx.root, profile: ctx.profile, state: ctx.state, browser, args: { generic: values.generic, past: values.past, registry: values.registry, rulesDir: values['rules-dir'] }, log: logLine }, selected);
    const report = aggregate(results, { requested: GATES.filter((g) => selected.includes(g.id)), tool: 'board', target: { root: ctx.root, state: ctx.state } });
    if (values.out) writeReport(report, values.out, 'directions');
    emit(report, json, `gates: ${report.counts.ok} ok, ${report.counts.fail} fail, ${report.counts.skipped} skipped`);
    return report.ok ? 0 : 1;
  } finally {
    await browser.close();
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
    exitWith(err);
  });
}
