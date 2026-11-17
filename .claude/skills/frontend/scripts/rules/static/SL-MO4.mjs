// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-MO4';
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
/** scale(0), scale(0, 0), scale3d(0, 0, ...) or the individual `scale: 0` property. */
const SCALE_ZERO = /\bscale\(\s*0(?:\.0+)?\s*(?:,\s*0(?:\.0+)?\s*)?\)|\bscale3d\(\s*0(?:\.0+)?\s*,\s*0(?:\.0+)?\s*,|(?:^|[;{\s])scale\s*:\s*0(?![.\d%])/i;
const KEYFRAMES = /@keyframes\s+([\w-]+)\s*\{/g;
const TW_SCALE_ZERO = /(?<![\w-])((?:[\w[\]=-]+:)*)scale-0(?![\w-])/g;
const TW_GROWS = /(?<![\w-])(?:[\w[\]=-]+:)+scale-(?:9\d|100|105|110)(?![\w-])|(?<![\w-])(?:[\w[\]=-]+:)*(?:transition(?:-[\w-]+)?|duration-\d+|animate-in|zoom-in(?:-\d+)?)(?![\w-])/;
const MOTION_ZERO = /\b(initial|hidden|enter|from)\s*[:=]\s*\{\{?[^{}]*?\bscale\s*:\s*0(?![.\d])/g;
const WAAPI_ZERO = /\.animate\(\s*\[\s*\{[^{}]*?scale\(\s*0\s*\)/g;
const GSAP_ZERO = /\bgsap\s*\.\s*from\s*\([^()]*?,\s*\{[^{}]*?\bscale\s*:\s*0(?![.\d])/g;

/**
 * Entrances that start from scale(0) (FD03-F10: "An element should never animate in from scale(0) ... start from 0.9
 * or higher with opacity"). Reports keyframes whose first frame is scaled to zero, scale(0) start states of
 * transitions (a rule that also transitions, or an @starting-style block), Tailwind scale-0 with a transition or a
 * variant that grows it, Motion `initial`/`hidden` states at scale 0, Web Animations keyframes and GSAP from() tweens.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if (file.kind === 'json' || COMPILED.test(file.text)) continue;
    const code = file.code;
    for (const m of code.matchAll(KEYFRAMES)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      const body = code.slice(open + 1, blockEnd(code, open) - 1);
      const first = /(?<![\d.])(?:from|0%)\s*(?:,[^{]*)?\{([^}]*)\}/.exec(body);
      if (first && SCALE_ZERO.test(first[1])) {
        findings.push(finding(file, m.index ?? 0, `@keyframes ${m[1]}`, `keyframes ${m[1]} start at scale(0); start from scale(0.9) or more with opacity`));
      }
    }
    for (const { css, offset } of cssRegions(file)) {
      for (const block of css.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
        const selector = block[1].trim();
        if (/^(?:from|to|\d+%)/.test(selector)) continue;
        const zero = SCALE_ZERO.exec(block[2]);
        if (!zero) continue;
        const startingStyle = /@starting-style/.test(css.slice(Math.max(0, (block.index ?? 0) - 200), block.index ?? 0));
        if (/\btransition\b/i.test(block[2]) || startingStyle) {
          const at = offset + (block.index ?? 0) + block[1].length + 1 + (zero.index ?? 0);
          findings.push(finding(file, at, zero[0].replace(/^[;{\s]+/, ''), `${selector || 'a rule'} enters from scale(0); start from scale(0.9) or more with opacity`));
        }
      }
    }
    if (file.kind === 'css') continue;
    for (const m of code.matchAll(STRING)) {
      const value = m[0].slice(1, -1);
      for (const s of value.matchAll(TW_SCALE_ZERO)) {
        const variant = s[1];
        const startState = /(?:starting|data-\[state=closed\]|data-closed|closed):$/.test(variant);
        if (startState || (!variant && TW_GROWS.test(value))) {
          findings.push(finding(file, (m.index ?? 0) + 1 + (s.index ?? 0), s[0], 'an element that grows in from scale-0; start from scale-95 or more with opacity'));
        }
      }
    }
    for (const re of [MOTION_ZERO, WAAPI_ZERO, GSAP_ZERO]) {
      for (const m of code.matchAll(re)) {
        findings.push(finding(file, m.index ?? 0, 'scale: 0', 'an entrance animated from scale 0; start from 0.9 or more with opacity'));
      }
    }
  }
  return findings;
}

/**
 * Index just past the brace closing the block opened at `open`, or the end of the code.
 * @param {string} code
 * @param {number} open
 * @returns {number}
 */
function blockEnd(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}' && --depth === 0) return i + 1;
  }
  return code.length;
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
