// @ts-check
import { parseColor, relativeLuminance, toOklch } from '../../lib/color.mjs';
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-M08';
/** "body background luminance below 0.01 and neutral (chroma about 0)" (FD10 M08); chroma 0.02 keeps zinc-950 (0.0044) and excludes slate-900 (0.040) and gray-950 (0.027), computed 2026-10-01. */
const MAX_LUMINANCE = 0.01;
const MAX_CHROMA = 0.02;
const GROUND_SELECTOR = /(?:^|[\s,>])(?:html|body|:root|\.dark|\[data-theme=["']?dark["']?\]|main|#root|#__next|#app)(?=$|[\s,:.{[>])/i;
const GROUND_TOKEN = /^--(?:color-)?(?:background|bg|ground|canvas|page)(?:-base|-default)?$/i;
const GROUND_KEY = /\b(?:background|bg|ground|canvas|page)["']?\s*:\s*$/i;
const GROUND_OWNER = /^(?:|body|html|main)$/;
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
const DARK_CLASS = /(?<![\w-])(?:dark:)?bg-(?:(?:zinc|neutral|stone)-950|black|\[#[0-9a-fA-F]{3,6}\])(?![\w-])/;
const PAGE_WRAPPER = /(?<![\w-])(?:min-h-(?:screen|dvh|svh)|h-(?:screen|dvh|svh))(?![\w-])/;
const COLOR = /#[0-9a-f]{3,8}(?![0-9a-z])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^()\n]*\)|\bblack\b/gi;
const HSL_CHANNELS = /^\s*(-?[\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%\s*$/;

/**
 * A near-black, neutral page ground (FD10 M08: create-next-app's and shadcn's #0a0a0a / oklch(0.145 0 0), zinc-950,
 * bg-black, FD10-F06/F07; v3's "#0B0B0B, #111 standing in for black", FD15-F05). Reports each declaration of such a
 * ground: html, body, :root, .dark or main backgrounds, ground tokens (--background and the like, including shadcn v3's
 * bare HSL channels), ground keys in JS theme objects, and Tailwind page wrappers. Dark-first products are the false
 * positive; the waiver records why the category is dark.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  const zincText = ctx.files.some((f) => /(?<![\w-])text-zinc-(?:400|500)(?![\w-])/.test(f.code));
  const suffix = zincText ? ' with zinc grey text' : '';
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if (file.kind === 'json' || COMPILED.test(file.text)) continue;
    for (const { css, offset } of cssRegions(file)) {
      for (const block of css.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
        const selector = block[1].trim();
        const bodyStart = offset + (block.index ?? 0) + block[1].length + 1;
        for (const decl of block[2].matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) {
          const prop = decl[1].toLowerCase();
          const groundProp = GROUND_TOKEN.test(prop) || ((prop === 'background' || prop === 'background-color') && GROUND_SELECTOR.test(selector));
          if (!groundProp) continue;
          const colour = nearBlack(decl[2]);
          if (colour) findings.push(finding(file, bodyStart + (decl.index ?? 0), colour, `${prop} on ${selector || 'a rule'} is a near-black neutral (${colour})${suffix}; derive the ground and neutrals from the brand research`));
        }
      }
    }
    if (file.kind === 'css') continue;
    for (const m of file.code.matchAll(STRING)) {
      const value = m[0].slice(1, -1);
      const at = (m.index ?? 0) + 1;
      const cls = DARK_CLASS.exec(value);
      if (cls) {
        const owner = ownerTag(file.code, at);
        const arbitrary = /\[(#[0-9a-fA-F]{3,6})\]/.exec(cls[0]);
        const neutral = arbitrary ? nearBlack(arbitrary[1]) : cls[0].replace(/^dark:/, '');
        if (neutral && (owner === 'body' || owner === 'html' || PAGE_WRAPPER.test(value))) {
          findings.push(finding(file, at, cls[0], `page wrapper on ${neutral}${suffix}; derive the ground from the brand research`));
        }
        continue;
      }
      if (GROUND_KEY.test(file.code.slice(Math.max(0, at - 40), at - 1)) && GROUND_OWNER.test(ownerTag(file.code, at))) {
        const colour = nearBlack(value);
        if (colour) findings.push(finding(file, at, colour, `theme ground set to a near-black neutral (${colour})${suffix}`));
      }
    }
  }
  return findings;
}

/**
 * The first near-black neutral colour in a CSS value (solid colours only, not gradients), or null.
 * @param {string} value
 * @returns {string | null}
 */
function nearBlack(value) {
  if (/gradient\(|url\(/i.test(value)) return null;
  const channels = HSL_CHANNELS.exec(value);
  const candidates = channels ? [`hsl(${channels[1]} ${channels[2]}% ${channels[3]}%)`] : [...value.matchAll(COLOR)].map((m) => m[0]);
  for (const css of candidates) {
    const c = parseColor(css);
    if (!c || c.a < 0.9) continue;
    if (relativeLuminance(c) < MAX_LUMINANCE && toOklch(c).c < MAX_CHROMA) return channels ? value.trim() : css.toLowerCase();
  }
  return null;
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
 * Name of the markup tag whose attributes contain `index`, or '' outside a tag.
 * @param {string} code
 * @param {number} index
 * @returns {string}
 */
function ownerTag(code, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0 && index - i < 3000; i -= 1) {
    const c = code[i];
    if (c === '}') depth += 1;
    else if (c === '{') depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === '>' && code[i - 1] !== '=') return '';
    else if (depth === 0 && c === '<') {
      const m = /^<([A-Za-z][\w.:-]*)/.exec(code.slice(i, i + 80));
      return m ? m[1] : '';
    }
  }
  return '';
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
