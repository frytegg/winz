// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-MO3';
/** "UI animations should stay under 300ms"; the registry's line is 500 ms (FD03-F07). */
const MAX_MS = 500;
/** "Full-height sheets 500 ms" is the documented exception (Ionic's iOS sheet, Vaul, FD03-F06/F23). */
const SHEET_MS = 500;
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
const TW_DURATION = /(?<![\w-])((?:[\w[\]=-]+:)*)duration-(?:(\d+)|\[([\d.]+)(ms|s)\])(?![\w-])/g;
const TW_MOTION = /(?<![\w-])(?:[\w[\]=-]+:)*(?:transition(?:-[\w-]+)?|animate-[\w[\]-]+|ease-[\w-]+)(?![\w-])/;
/** Loops are indicators or decoration (SL-M10, SL-M14 own them), not UI transitions: their duration is a period. */
const TW_LOOP = /(?<![\w-])animate-(?:spin|pulse|ping|bounce|caret-blink|blink|marquee[\w-]*|shimmer|\[[^\]]*infinite[^\]]*\])(?![\w-])/;
const TW_SHEET = /(?<![\w-])(?:inset-y-0|h-full|h-screen|inset-x-0|slide-in-from-(?:left|right|top|bottom))(?![\w-])/;
const PAGE_SELECTOR = /^(?:html|body|:root)\b|::view-transition|page-transition|route-transition/i;
const SHEET_SELECTOR = /sheet|drawer|vaul/i;
/** A sheet or drawer component file (shadcn's ui/sheet.tsx, ui/drawer.tsx): cva keeps the side classes in sibling strings. */
const SHEET_FILE = /(?:^|\/)[^/]*(?:sheet|drawer|vaul)[^/]*$/i;
/** How far around a class string its sibling strings (the same cva call or className expression) are read. */
const SHEET_WINDOW = 600;
const TIME = /(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g;
const JS_DURATION = /\b(?:transition\s*=\s*\{\{|transition\s*:\s*\{|gsap\s*\.\s*(?:to|from|fromTo|set)\s*\([^()]*?,\s*\{|\.(?:to|from|fromTo)\s*\([^()]*?,\s*\{)[^{}]*?\bduration\s*:\s*(\d*\.?\d+)/g;
const INLINE_TIME = /\b(?:transition|transitionDuration|animation|animationDuration)\s*:\s*["'`]([^"'`]+)["'`]/g;

/**
 * Transitions and animations of 500 ms or more on UI elements (FD03-F07: press 100-160, tooltip 125-200, dropdown
 * 150-250, modal 200-300 ms; FD03-F08: duration-500/700/1000 are the Tailwind signatures). Reads Tailwind duration
 * utilities next to a transition or animation, CSS transitions and animations (the first time in each shorthand is
 * the duration), Motion and GSAP duration fields (seconds below 20, milliseconds above), and inline styles. Loops
 * (spinners, pulses), page-level transitions and 500 ms full-height sheets are left out.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if (file.kind === 'json' || COMPILED.test(file.text)) continue;
    const code = file.code;
    for (const { css, offset } of cssRegions(file)) {
      for (const block of css.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
        const selector = block[1].trim();
        if (PAGE_SELECTOR.test(selector) || /^(?:from|to|\d+%)/.test(selector)) continue;
        for (const decl of block[2].matchAll(/\b(transition|transition-duration|animation|animation-duration)\s*:\s*([^;]+)/gi)) {
          if (/^animation/i.test(decl[1]) && /\binfinite\b/i.test(decl[2])) continue;
          const ms = longest(decl[2]);
          if (ms < MAX_MS || (ms === SHEET_MS && SHEET_SELECTOR.test(selector))) continue;
          const at = offset + (block.index ?? 0) + block[1].length + 1 + (decl.index ?? 0);
          findings.push(finding(file, at, `${ms}ms`, `${selector}: ${decl[1]} of ${ms} ms; keep UI motion within its role budget (press 160, tooltip 200, dropdown 250, modal 300 ms)`));
        }
      }
    }
    if (file.kind === 'css') continue;
    for (const m of code.matchAll(STRING)) {
      const value = m[0].slice(1, -1);
      if (!TW_MOTION.test(value) || TW_LOOP.test(value)) continue;
      for (const d of value.matchAll(TW_DURATION)) {
        const ms = d[2] ? Number(d[2]) : d[4] === 's' ? Number(d[3]) * 1000 : Number(d[3]);
        if (ms < MAX_MS || (ms === SHEET_MS && isSheet(file, code, m.index ?? 0, value))) continue;
        findings.push(finding(file, (m.index ?? 0) + 1 + (d.index ?? 0), d[0], `${ms} ms UI transition; keep UI motion within its role budget (press 160, tooltip 200, dropdown 250, modal 300 ms)`));
      }
    }
    for (const m of code.matchAll(JS_DURATION)) {
      const raw = Number(m[1]);
      const ms = raw < 20 ? raw * 1000 : raw;
      const object = code.slice(m.index ?? 0, (m.index ?? 0) + m[0].length + 120);
      if (ms < MAX_MS || /\brepeat\s*:\s*(?:Infinity|-1)\b|\byoyo\s*:\s*true/.test(object)) continue;
      const at = (m.index ?? 0) + m[0].lastIndexOf('duration');
      findings.push(finding(file, at, `${ms}ms`, `${ms} ms animation in script; keep UI motion within its role budget (press 160, tooltip 200, dropdown 250, modal 300 ms)`));
    }
    for (const m of code.matchAll(INLINE_TIME)) {
      if (/\binfinite\b/i.test(m[1])) continue;
      const ms = longest(m[1]);
      if (ms >= MAX_MS) findings.push(finding(file, m.index ?? 0, `${ms}ms`, `${ms} ms inline transition or animation; keep UI motion within its role budget`));
    }
  }
  return findings;
}

/**
 * A 500 ms class string on a full-height sheet: the string itself, a sibling string nearby or the file is a sheet.
 * @param {SourceFile} file
 * @param {string} code
 * @param {number} at
 * @param {string} value
 * @returns {boolean}
 */
function isSheet(file, code, at, value) {
  if (TW_SHEET.test(value) || SHEET_FILE.test(file.path)) return true;
  return TW_SHEET.test(code.slice(Math.max(0, at - SHEET_WINDOW), at + value.length + SHEET_WINDOW));
}

/**
 * The longest duration in a transition or animation value, in milliseconds: the first time of each comma-separated
 * part (a second time in a part is its delay).
 * @param {string} value
 * @returns {number}
 */
function longest(value) {
  let max = 0;
  for (const part of value.split(/,(?![^(]*\))/)) {
    const first = [...part.matchAll(TIME)][0];
    if (!first) continue;
    const ms = first[2] === 's' ? Number(first[1]) * 1000 : Number(first[1]);
    max = Math.max(max, Math.round(ms));
  }
  return max;
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
