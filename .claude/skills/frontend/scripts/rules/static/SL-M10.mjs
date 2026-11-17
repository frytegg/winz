// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-M10';
/** Signatures from FD10 M10 (Marquee, animate-marquee, @keyframes marquee), the HTML element, and ETHDenver's prop (FD14-F15). */
const SIGNS = [
  { re: /<Marquee\b/g, what: 'a <Marquee> component (Magic UI or react-fast-marquee)' },
  { re: /(?<![\w:-])(?:[\w-]+:)*animate-marquee(?:-[\w-]+)?(?![\w-])/g, what: 'the animate-marquee utility' },
  { re: /<marquee\b/g, what: 'the obsolete <marquee> element' },
  { re: /\bmarqueeText=["'{`]/g, what: 'a marqueeText prop' },
];
const KEYFRAMES = /@keyframes\s+([\w-]+)\s*\{/g;
const NAMED_MARQUEE = /marquee|ticker|scroll-?x|scroll-?left|infinite-?scroll/i;
const TRANSLATE_AWAY = /translate(?:X|3d)?\(\s*(?:calc\(\s*)?-\s*(?:50|100)%|translate\(\s*-\s*(?:50|100)%\s*,\s*0/i;
/** A light travelling along a border or across a surface (React Bits' StarBorder, shine and beam effects) slides the same way but moves no row: SL-M09 and SL-G04 own it. */
const LIGHT_EFFECT = /star|glow|shine|shimmer|sheen|beam|sparkle|gradient|border|light/i;

/**
 * A continuously scrolling row of logos or text (FD10 M10; impeccable's marquee entry: "Continuously auto-scrolling
 * content demands attention it has not earned and hides half its content at any moment", FD10-F28). Reports marquee
 * components, utilities and elements, keyframes named as a marquee, and any keyframes that slide a row by -50% or
 * -100% when an animation runs them linear and infinite.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  const allCode = ctx.files.filter((f) => f.kind !== 'json').map((f) => f.code).join('\n');
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if (file.kind === 'json' || COMPILED.test(file.text)) continue;
    const code = file.code;
    for (const { re, what } of SIGNS) {
      for (const m of code.matchAll(re)) findings.push(finding(file, m.index ?? 0, m[0].trim(), `${what}: replace with a static, linked list`));
    }
    for (const m of code.matchAll(KEYFRAMES)) {
      const name = m[1];
      const open = (m.index ?? 0) + m[0].length - 1;
      const body = code.slice(open, blockEnd(code, open));
      const looping = declarationsNaming(allCode, name).some((u) => /(?<![a-z])infinite(?![a-z])/i.test(u) && /(?<![a-z])linear(?![a-z-])/i.test(u));
      if (NAMED_MARQUEE.test(name) || (TRANSLATE_AWAY.test(body) && looping && !LIGHT_EFFECT.test(name))) {
        findings.push(finding(file, m.index ?? 0, `@keyframes ${name}`, 'keyframes that scroll a row continuously (a marquee): replace with a static, linked list'));
      }
    }
  }
  return dedupe(findings);
}

/**
 * Every declaration or string that names `name` as a whole word (underscores allowed around it, as in
 * animate-[scroll_30s_linear_infinite]), cut at the nearest ; { } quote or line break on each side.
 * @param {string} code
 * @param {string} name
 * @returns {string[]}
 */
function declarationsNaming(code, name) {
  const boundary = /[;{}\n"'`]/;
  /** @type {string[]} */
  const out = [];
  for (const m of code.matchAll(new RegExp(`(?<![A-Za-z0-9-])${name}(?![A-Za-z0-9-])`, 'g'))) {
    let start = m.index ?? 0;
    while (start > 0 && !boundary.test(code[start - 1])) start -= 1;
    let end = (m.index ?? 0) + m[0].length;
    while (end < code.length && !boundary.test(code[end])) end += 1;
    out.push(code.slice(start, end));
  }
  return out;
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

/**
 * @param {StaticFinding[]} findings
 * @returns {StaticFinding[]}
 */
function dedupe(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.file}:${f.line}:${String(f.value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const COMPILED = /^(?:\s*@(?:import|charset)\b(?:"[^"]*"|'[^']*'|url\([^)]*\)|[^;"'])*;)*\s*\/\*!\s*tailwindcss\s+v/;

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
