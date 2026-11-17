// @ts-check
import { parseColor } from '../../lib/color.mjs';
import { lineOf } from '../../lib/text.mjs';
import { mountedFiles } from './SL-T08.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 * @typedef {{file: SourceFile, index: number, value: string, what: string}} Glow
 */

const RULE = 'SL-M09';
/** Krebs's colored-glow rule: blur of 15px or more, saturation above 0.3, two or more elements (FD10 M09). */
const MIN_BLUR_PX = 15;
const MIN_SATURATION = 0.3;
const MIN_ELEMENTS = 2;
const HUES = 'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
/** Tailwind's blur scale from lg up is 16px or more (v3 and v4: lg 16, xl 24, 2xl 40, 3xl 64). */
const BLUR_CLASS = /(?<![\w:-])blur-(?:lg|xl|2xl|3xl)(?![\w-])|(?<![\w:-])blur-\[([\d.]+)px\]/;
const POSITIONED = /(?<![\w:-])(?:absolute|fixed)(?![\w-])/;
const CHROMATIC_FILL = new RegExp(String.raw`(?<![\w:-])(?:bg|from|via|to)-(?:${HUES})-\d{2,3}(?:\/\d+)?(?![\w-])|(?<![\w:-])bg-(?:primary|accent|secondary|brand)(?:\/\d+)?(?![\w-])`);
const ARBITRARY_FILL = /(?<![\w:-])bg-\[([^\]]+)\]/;
const GLOW_SHADOW = /(?<![\w-])(?:shadow|drop-shadow)-\[0_0_([\d.]+)px[^\]]*\]/g;
const COLORED_SHADOW = new RegExp(String.raw`(?<![\w-])shadow-(?:${HUES})-\d{2,3}(?:\/\d+)?(?![\w-])`);
const LARGE_SHADOW = /(?<![\w-])shadow-(?:lg|xl|2xl)(?![\w-])/;
const COLOR = /#[0-9a-f]{3,8}(?![0-9a-z])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^()\n]*\)/gi;

/**
 * Coloured glows, radial halos and blurred blobs (FD10 M09; impeccable dark-glow and radial-halo, Krebs colored
 * glows at 5.5% of Show HN pages, FD10-F11). Finds positioned, blurred, chromatic shapes and zero-offset coloured
 * shadows in class strings and CSS, and reports each one once the project has at least two.
 * Only files an entry point mounts count (SL-T08 mountedFiles): a vendored effect or a components/ui primitive
 * that nothing imports never renders (FD14-F12, FD14-F22).
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {Glow[]} */
  const glows = [];
  const mounted = mountedFiles(ctx.files);
  for (const file of ctx.files) {
    if (mounted && !mounted.has(file.path)) continue;
    if (file.kind === 'json' || COMPILED.test(file.text)) continue;
    if (file.kind !== 'css') glows.push(...classGlows(file));
    for (const { css, offset } of cssRegions(file)) glows.push(...cssGlows(file, css, offset));
  }
  /** @type {Map<string, Glow>} */
  const byLine = new Map();
  for (const g of glows) {
    const key = `${g.file.path}:${lineOf(g.file.text, g.index)}`;
    if (!byLine.has(key)) byLine.set(key, g);
  }
  const unique = [...byLine.values()];
  if (unique.length < MIN_ELEMENTS) return [];
  return unique.map((g) => finding(g.file, g.index, g.value,
    `${g.what}; ${unique.length} decorative glows or blobs in the project: use neutral elevation and no decorative blobs`));
}

/**
 * @param {SourceFile} file
 * @returns {Glow[]}
 */
function classGlows(file) {
  /** @type {Glow[]} */
  const out = [];
  for (const m of file.code.matchAll(STRING)) {
    const value = m[0].slice(1, -1);
    const at = (m.index ?? 0) + 1;
    const blur = BLUR_CLASS.exec(value);
    const blurPx = blur ? (blur[1] ? Number(blur[1]) : 16) : 0;
    if (blurPx >= MIN_BLUR_PX && POSITIONED.test(value) && chromaticFill(value)) {
      out.push({ file, index: at, value: blur ? blur[0] : '', what: 'a positioned, blurred, coloured shape (a blob or halo)' });
      continue;
    }
    for (const glow of value.matchAll(GLOW_SHADOW)) {
      if (Number(glow[1]) >= MIN_BLUR_PX && saturatedIn(glow[0].replace(/_/g, ' '))) {
        out.push({ file, index: at, value: glow[0], what: 'a zero-offset coloured glow shadow' });
      }
    }
    if (COLORED_SHADOW.test(value) && LARGE_SHADOW.test(value)) {
      out.push({ file, index: at, value: `${LARGE_SHADOW.exec(value)?.[0]} ${COLORED_SHADOW.exec(value)?.[0]}`, what: 'a large coloured shadow (a glow)' });
    }
  }
  return out;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function chromaticFill(value) {
  if (CHROMATIC_FILL.test(value)) return true;
  const arbitrary = ARBITRARY_FILL.exec(value);
  return arbitrary !== null && saturatedIn(arbitrary[1].replace(/_/g, ' '));
}

/**
 * @param {SourceFile} file
 * @param {string} css
 * @param {number} offset
 * @returns {Glow[]}
 */
function cssGlows(file, css, offset) {
  /** @type {Glow[]} */
  const out = [];
  for (const block of css.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
    const body = block[2];
    const bodyAt = offset + (block.index ?? 0) + block[1].length + 1;
    for (const decl of body.matchAll(/(box-shadow|text-shadow)\s*:\s*([^;]+)/gi)) {
      const glow = splitTop(decl[2]).find((s) => zeroOffsetGlow(s));
      if (glow) out.push({ file, index: bodyAt + (decl.index ?? 0), value: `${decl[1]}: ${glow.trim()}`, what: `a zero-offset coloured ${decl[1].toLowerCase()}` });
    }
    const dropShadow = /drop-shadow\(\s*([^()]*(?:\([^()]*\)[^()]*)*)\)/i.exec(body);
    if (dropShadow && zeroOffsetGlow(dropShadow[1])) out.push({ file, index: bodyAt + dropShadow.index, value: dropShadow[0], what: 'a zero-offset coloured drop-shadow' });
    const blur = /filter\s*:\s*[^;]*\bblur\(\s*([\d.]+)px\s*\)/i.exec(body);
    const fill = /background(?:-color|-image)?\s*:\s*([^;]+)/i.exec(body);
    if (blur && Number(blur[1]) >= MIN_BLUR_PX && fill && saturatedIn(fill[1])) {
      out.push({ file, index: bodyAt + blur.index, value: `blur(${blur[1]}px)`, what: 'a blurred, coloured shape (a blob or halo)' });
    }
  }
  return out;
}

/**
 * A shadow "0 0 <blur> [spread] <colour>" with blur of at least MIN_BLUR_PX and a saturated colour.
 * @param {string} shadow
 * @returns {boolean}
 */
function zeroOffsetGlow(shadow) {
  const lengths = [...shadow.replace(COLOR, ' ').matchAll(/(-?[\d.]+)(px)?/g)].map((m) => Number(m[1]));
  if (lengths.length < 3 || lengths[0] !== 0 || lengths[1] !== 0 || lengths[2] < MIN_BLUR_PX) return false;
  return saturatedIn(shadow);
}

/**
 * True when the text holds a colour with HSL saturation above MIN_SATURATION and some opacity.
 * @param {string} text
 * @returns {boolean}
 */
function saturatedIn(text) {
  for (const m of text.matchAll(COLOR)) {
    const c = parseColor(m[0]);
    if (!c || c.a < 0.15) continue;
    const max = Math.max(c.r, c.g, c.b);
    const min = Math.min(c.r, c.g, c.b);
    const l = (max + min) / 2;
    const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    if (s > MIN_SATURATION && l > 0.1 && l < 0.9) return true;
  }
  return false;
}

/**
 * Splits a comma-separated list at top-level commas (not inside parentheses).
 * @param {string} value
 * @returns {string[]}
 */
function splitTop(value) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === ',' && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

const STYLE_ELEMENT = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const CSS_TEMPLATE = /(?:\b(?:css|keyframes|createGlobalStyle|injectGlobal)|\bstyled(?:\.\w+|\([^()]*\))(?:\.attrs\([^()]*\))?|__html\s*:)\s*`([^`]*)`/g;
const COMPILED = /^(?:\s*@(?:import|charset)\b(?:"[^"]*"|'[^']*'|url\([^)]*\)|[^;"'])*;)*\s*\/\*!\s*tailwindcss\s+v/;

/**
 * The CSS a file carries, with offsets into the file: a whole stylesheet (not a compiled Tailwind bundle), `<style>`
 * elements and CSS template literals.
 * @param {SourceFile} file
 * @returns {Array<{css: string, offset: number}>}
 */
function cssRegions(file) {
  if (file.kind === 'json') return [];
  if (file.kind === 'css') return COMPILED.test(file.text) ? [] : [{ css: file.code, offset: 0 }];
  /** @type {Array<{css: string, offset: number}>} */
  const regions = [];
  for (const m of file.code.matchAll(STYLE_ELEMENT)) regions.push({ css: m[1], offset: (m.index ?? 0) + m[0].indexOf('>') + 1 });
  for (const m of file.code.matchAll(CSS_TEMPLATE)) regions.push({ css: m[1], offset: (m.index ?? 0) + m[0].length - m[1].length - 1 });
  return regions;
}

/**
 * @param {SourceFile} file
 * @param {number} index
 * @param {unknown} value
 * @param {string} detail
 * @returns {StaticFinding}
 */
function finding(file, index, value, detail) {
  return { rule: RULE, layer: 'static', file: file.path, line: lineOf(file.text, index), excerpt: excerpt(file.text, index), value, detail };
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
