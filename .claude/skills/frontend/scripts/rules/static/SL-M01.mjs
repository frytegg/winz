// @ts-check
import { parseColor, toOklch } from '../../lib/color.mjs';
import { lineOf } from '../../lib/text.mjs';
import { mountedByEntry } from './SL-T08.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 * @typedef {{file: SourceFile, index: number, value: string}} Hit
 */

const RULE = 'SL-M01';

/** The grounds Anthropic and FD10 name: #F4F1EA (v3, FD15-F05), #FAF9F5 (Anthropic ivory, FD15-F17), #f5efe2 (FD10 M01). */
const NAMED_GROUNDS = new Set(['#f4f1ea', '#faf9f5', '#f5efe2']);
/** Anthropic's clay accent (FD15-F05, FD15-F17). */
const CLAY = { r: 0xd9 / 255, g: 0x77 / 255, b: 0x57 / 255 };
/**
 * Candidate thresholds, computed with lib/color on 2026-10-01: ΔE_ok 0.05 keeps #cc785c (0.023) and #e07a5f (0.017) and
 * excludes Tailwind orange-500/600 (0.069); the cream band keeps #F4F1EA, #FAF9F5, #f5efe2, amber-50 and orange-50 and
 * excludes white, slate-50 and gray-50 (cool hue or no chroma).
 */
const CLAY_MAX_DISTANCE = 0.05;
const CREAM = { minL: 0.92, minC: 0.004, maxC: 0.035, minH: 50, maxH: 110 };

/** Serif display faces named by the research: Georgia, Fraunces, Playfair (FD15-F04), Newsreader, Crimson Pro (FD15-F12), Instrument Serif, Young Serif, Bodoni (FD10-F03), Recoleta (FD10-F31). */
const SERIF_FAMILIES = ['georgia', 'fraunces', 'playfair display', 'playfair', 'newsreader', 'crimson pro', 'instrument serif', 'young serif', 'recoleta', 'bodoni'];
const SERIF_IMPORT = /\b(?:Fraunces|Playfair_Display|Playfair|Newsreader|Crimson_Pro|Instrument_Serif|Young_Serif)\b(?=[^;]*from\s*['"]next\/font\/google['"])|family=(?:Fraunces|Playfair\+Display|Newsreader|Crimson\+Pro|Instrument\+Serif|Young\+Serif)\b|@fontsource(?:-variable)?\/(?:fraunces|playfair-display|newsreader|crimson-pro|instrument-serif|young-serif)\b/g;
const FONT_FAMILY = /(?:font-family|--font-[\w-]*(?:display|heading|head|title|serif)[\w-]*)\s*:\s*([^;{}]+)/gi;
const TAILWIND_GROUND = /(?<![\w-])(?:[\w-]+:)*bg-(?:amber|stone|orange)-50(?![\w-])/g;
const COLOR = /#[0-9a-f]{3,8}(?![0-9a-z])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^()\n]*\)/gi;
/** A ground-named token: --background, --bg, --page-bg, --paper; never a component's own surface. */
const GROUND_TOKEN = /--((?:[\w-]*-)?(?:background|bg|ground|canvas|page|paper|base|cream|ivory|parchment|sand)(?:-[\w-]*)?)\s*:\s*[^;{}]*$/i;
const COMPONENT_TOKEN = /card|popover|muted|input|button|btn|chip|badge|knob|toggle|code|pre|tooltip|menu|dialog|modal|sheet|accent|primary|secondary/i;
const BACKGROUND_DECLARATION = /\bbackground(?:-color)?\s*:\s*[^;{}]*$/i;
/** The page itself: html, body, :root, the app's mount point or a page-level wrapper class. */
const PAGE_SELECTOR = /(?:^|[\s,>~+(])(?:html|body|:root|main|#root|#app|#__next|\.(?:app|page|layout|site|shell|root|wrapper)(?![\w-]))(?=$|[\s,.:#[>~+)])/i;
const PAGE_TAG = /^(?:html|body|main)$/i;
const PAGE_WRAPPER_CLASS = /(?<![\w-])(?:min-h-(?:screen|dvh|svh)|h-screen)(?![\w-])/;
const QUOTED_FAMILY = new RegExp(`(["'])(${SERIF_FAMILIES.join('|')})\\1`, 'gi');
const DISPLAY_SIZE = /(?<![\w-])(?:[\w-]+:)*text-(?:[4-9]xl)(?![\w-])|<h[1-3]\b/;

/**
 * Anthropic's "tasteful default" cluster (FD15-F04, F05, F17): a warm cream ground, a serif display face and a clay
 * accent near #D97757. Fires once per project when the cream ground and at least one other part are declared on the
 * same page (files reachable from one page entry, SL-T08 mountedByEntry), because each one alone is a legitimate
 * choice for editorial, food and craft brands; the runtime layer decides what renders. The ground counts only as
 * the page's ground (a ground-named token, html, body, :root, main or a full-height wrapper), never a cream knob,
 * code block or tooltip.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {Hit[]} */
  const grounds = [];
  /** @type {Hit[]} */
  const accents = [];
  /** @type {Hit[]} */
  const serifs = [];
  for (const file of ctx.files) {
    if (file.kind === 'json' || COMPILED.test(file.text)) continue;
    const code = file.code;
    const tw = tailwindGround(file);
    if (tw) grounds.push(tw);
    let ground = false;
    let accent = false;
    for (const m of code.matchAll(COLOR)) {
      const at = m.index ?? 0;
      const css = m[0];
      if (!ground && isGround(css, file, at)) {
        grounds.push({ file, index: at, value: css.toLowerCase() });
        ground = true;
      }
      if (!accent && isClay(css)) {
        accents.push({ file, index: at, value: css.toLowerCase() });
        accent = true;
      }
    }
    const serif = serifFace(file);
    if (serif) serifs.push(serif);
  }
  const pages = mountedByEntry(ctx.files);
  /** @param {Hit} a @param {Hit} b @returns {boolean} */
  const samePage = (a, b) => a.file === b.file || pages === null || pages.some((p) => p.files.has(a.file.path) && p.files.has(b.file.path));
  /** @type {Hit[]} */
  let parts = [];
  for (const g of grounds) {
    const accent = accents.find((a) => samePage(g, a)) ?? null;
    const serif = serifs.find((s) => samePage(g, s)) ?? null;
    const found = [g, accent, serif].filter((h) => h !== null);
    if (found.length > parts.length) parts = found;
    if (parts.length === 3) break;
  }
  if (parts.length < 2) return [];
  const ground = parts[0];
  const accent = parts.find((h) => accents.includes(h)) ?? null;
  const serif = parts.find((h) => serifs.includes(h)) ?? null;
  const first = /** @type {Hit} */ (parts[0]);
  const value = { ground: ground?.value ?? null, accent: accent?.value ?? null, serif: serif?.value ?? null };
  const where = parts.map((h) => `${h.file.path}:${lineOf(h.file.text, h.index)}`).join(', ');
  return [{
    rule: RULE,
    layer: 'static',
    file: first.file.path,
    line: lineOf(first.file.text, first.index),
    excerpt: excerpt(first.file.text, first.index),
    value,
    detail: `${parts.length} of the cream ground, serif display and clay accent cluster declared (${where}); Anthropic names it as the generated default, so take the palette and type from the brand research`,
  }];
}

const COMPILED = /^(?:\s*@(?:import|charset)\b(?:"[^"]*"|'[^']*'|url\([^)]*\)|[^;"'])*;)*\s*\/\*!\s*tailwindcss\s+v/;

/**
 * A Tailwind cream ground (bg-amber-50, bg-stone-50, bg-orange-50 or a cream arbitrary value) on the page itself:
 * <html>, <body>, <main> or a full-height wrapper.
 * @param {SourceFile} file
 * @returns {Hit | null}
 */
function tailwindGround(file) {
  if (file.kind === 'css') return null;
  const code = file.code;
  TAILWIND_GROUND.lastIndex = 0;
  for (const m of code.matchAll(TAILWIND_GROUND)) {
    if (onPage(code, m.index ?? 0)) return { file, index: m.index ?? 0, value: m[0] };
  }
  return null;
}

/**
 * A warm cream colour used as the page's ground (FD15-F05: the ground, not any cream fill): a ground-named token
 * (--background, --bg, --paper, never a card's or a control's own token), a background declaration on html, body,
 * :root, main, the mount point or a page wrapper, or a `bg-[...]` value on the page element. A cream knob, a code
 * block or a tooltip is not a ground. The named grounds (#F4F1EA, #FAF9F5, #f5efe2) count in the same places only.
 * @param {string} css
 * @param {SourceFile} file
 * @param {number} at
 * @returns {boolean}
 */
function isGround(css, file, at) {
  if (!NAMED_GROUNDS.has(css.toLowerCase()) && !isCream(css)) return false;
  const code = file.code;
  const lineStart = code.lastIndexOf('\n', at - 1) + 1;
  const before = code.slice(Math.max(lineStart, at - 160), at);
  const token = GROUND_TOKEN.exec(before);
  if (token) return !COMPONENT_TOKEN.test(token[1]);
  if (/bg-\[$/.test(before)) return onPage(code, at);
  if (!BACKGROUND_DECLARATION.test(before)) return false;
  const selector = selectorAt(code, at);
  return selector !== null ? PAGE_SELECTOR.test(selector) : onPage(code, at);
}

/**
 * The selector of the CSS rule whose declaration block holds `at`, or null outside a rule (a script's style object).
 * @param {string} code
 * @param {number} at
 * @returns {string | null}
 */
function selectorAt(code, at) {
  const open = code.lastIndexOf('{', at);
  if (open < 0 || code.lastIndexOf('}', at) > open) return null;
  if (/\{\s*$/.test(code.slice(Math.max(0, open - 2), open))) return null;
  const start = Math.max(code.lastIndexOf('}', open), code.lastIndexOf(';', open), code.lastIndexOf('{', open - 1)) + 1;
  const selector = code.slice(start, open).trim();
  return /[=()'"`]/.test(selector.replace(/:(?:not|is|where|has)\([^)]*\)/g, '')) ? null : selector;
}

/**
 * True when the class string or style at `at` belongs to <html>, <body>, <main> or a full-height page wrapper.
 * @param {string} code
 * @param {number} at
 * @returns {boolean}
 */
function onPage(code, at) {
  const window = code.slice(Math.max(0, at - 600), at);
  const tags = [...window.matchAll(/<([A-Za-z][\w.-]*)/g)];
  const last = tags[tags.length - 1];
  if (!last) return false;
  const open = Math.max(0, at - 600) + (last.index ?? 0);
  const close = code.indexOf('>', at);
  const opening = code.slice(open, close < 0 ? code.length : close);
  return PAGE_TAG.test(last[1]) || PAGE_WRAPPER_CLASS.test(opening);
}

/**
 * @param {string} css
 * @returns {boolean}
 */
function isCream(css) {
  const c = parseColor(css);
  if (!c || c.a < 0.9) return false;
  const { l, c: chroma, h } = toOklch(c);
  return l >= CREAM.minL && chroma >= CREAM.minC && chroma <= CREAM.maxC && h >= CREAM.minH && h <= CREAM.maxH;
}

/**
 * @param {string} css
 * @returns {boolean}
 */
function isClay(css) {
  const c = parseColor(css);
  if (!c || c.a < 0.5) return false;
  return oklabDistance(c, CLAY) <= CLAY_MAX_DISTANCE;
}

/**
 * @param {{r: number, g: number, b: number}} x
 * @param {{r: number, g: number, b: number}} y
 * @returns {number}
 */
function oklabDistance(x, y) {
  const a = toLab(x);
  const b = toLab(y);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * @param {{r: number, g: number, b: number}} rgb
 * @returns {[number, number, number]}
 */
function toLab(rgb) {
  const { l, c, h } = toOklch(rgb);
  const rad = (h * Math.PI) / 180;
  return [l, c * Math.cos(rad), c * Math.sin(rad)];
}

/**
 * A serif display face: a font-family (or display/heading font token) whose first family is a listed serif or the
 * generic `serif`, a font import of one of those faces, or `font-serif` on a display-size or h1-h3 class string.
 * @param {SourceFile} file
 * @returns {Hit | null}
 */
function serifFace(file) {
  const code = file.code;
  for (const m of code.matchAll(FONT_FAMILY)) {
    const first = m[1].split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
    if (first === 'serif' || SERIF_FAMILIES.includes(first)) return { file, index: m.index ?? 0, value: first };
  }
  SERIF_IMPORT.lastIndex = 0;
  const imported = SERIF_IMPORT.exec(code);
  if (imported) return { file, index: imported.index, value: imported[0] };
  if (file.kind !== 'css' && file.kind !== 'html') {
    QUOTED_FAMILY.lastIndex = 0;
    const quoted = QUOTED_FAMILY.exec(code);
    if (quoted) return { file, index: quoted.index, value: quoted[2].toLowerCase() };
  }
  for (const m of code.matchAll(/(?<![\w-])font-serif(?![\w-])/g)) {
    const at = m.index ?? 0;
    const lineStart = code.lastIndexOf('\n', at - 1) + 1;
    const lineEnd = code.indexOf('\n', at);
    const line = code.slice(lineStart, lineEnd < 0 ? code.length : lineEnd);
    if (DISPLAY_SIZE.test(line)) return { file, index: at, value: 'font-serif' };
  }
  return null;
}

/**
 * The source line at `index`, trimmed, cut to a 120-character window around the match.
 * @param {string} text
 * @param {number} index
 * @returns {string}
 */
function excerpt(text, index) {
  const start = index > 0 ? text.lastIndexOf('\n', index - 1) + 1 : 0;
  const stop = text.indexOf('\n', index);
  const end = stop < 0 ? text.length : stop;
  const line = text.slice(start, end).trim();
  if (line.length <= 120) return line;
  const from = Math.max(start, Math.min(index - 40, end - 120));
  return text.slice(from, from + 120).trim();
}
