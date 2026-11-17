// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-M14';
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
const LINE_GRADIENT = /linear-gradient\([^;{}]*?(?<![\d.])(?:0\.5|1|2)px(?![a-z])/i;
const TILE_SIZE = /background-size\s*:\s*[\d.]+(?:px|rem|em)\b|backgroundSize\s*:\s*["'`][\d.]+(?:px|rem|em)\b|(?<![\w-])bg-\[size:[\d.]+(?:px|rem)|\[background-size:[\d.]+(?:px|rem)/i;
const PULSE = /(?<![\w-])(?:[\w-]+:)*animate-(?:pulse|ping)(?![\w-])/;
const DOT_SHAPE = /(?<![\w-])rounded-full(?![\w-])/;
/** A 6 to 10 px dot (FD10 M14): Tailwind steps 1.5 (6px), 2 (8px), 2.5 (10px), or an arbitrary 4-10px size. */
const DOT_SIZE = /(?<![\w-])(?:size|w|h)-(?:1\.5|2|2\.5|\[(?:[4-9]|10)px\])(?![\w-])/;
const BLINK_CLASS = /(?<![\w-])(?:[\w-]+:)*animate-(?:blink|cursor|caret)(?![\w-])/g;
const BLINK_KEYFRAMES = /@keyframes\s+((?:[\w-]*-)?(?:blink|cursor)(?:-[\w-]*)?)\s*\{/gi;
/** "on 6 to 10px dots" and "not tied to live data" (FD10 M14): a class chosen by a condition is treated as bound to state. */
const CONDITIONAL = /(?:\?|&&|\|\|)\s*$|["'`)\]]\s*:\s*$/;

/**
 * Decorative chrome (FD10 M14, impeccable's codex-grid-background, pulsing-dot and blinking-cursor entries, FD10-F28):
 * a background tiled from 1px line gradients at a fixed size, a 6-10px dot pulsing unconditionally, and a blinking
 * cursor. A pulse whose class is chosen by a condition (live && 'animate-pulse') counts as bound to state and is left to
 * the runtime layer; skeleton loaders are larger than a dot and do not match.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if (file.kind === 'json' || COMPILED.test(file.text)) continue;
    const code = file.code;
    let coveredTo = -1;
    for (const m of code.matchAll(/linear-gradient\(/gi)) {
      const at = m.index ?? 0;
      if (at < coveredTo) continue;
      const around = code.slice(Math.max(0, at - 300), Math.min(code.length, at + 600));
      const lines = [...around.matchAll(/linear-gradient\(/gi)].length;
      if (lines >= 2 && LINE_GRADIENT.test(code.slice(at, at + 200)) && TILE_SIZE.test(around)) {
        findings.push(finding(file, at, 'linear-gradient grid tile', 'background tiled from thin line gradients at a fixed size (a decorative grid): remove it, or draw a grid only where the product is a canvas'));
        coveredTo = at + 600;
      }
    }
    if (file.kind !== 'css') {
      for (const m of code.matchAll(STRING)) {
        const value = m[0].slice(1, -1);
        const at = (m.index ?? 0) + 1;
        if (!(PULSE.test(value) && DOT_SHAPE.test(value) && DOT_SIZE.test(value))) continue;
        if (CONDITIONAL.test(code.slice(Math.max(0, at - 30), at - 1))) continue;
        findings.push(finding(file, at, PULSE.exec(value)?.[0] ?? 'animate-pulse', 'a small dot pulsing unconditionally (a fake live indicator): bind it to real state or remove it'));
      }
    }
    for (const m of code.matchAll(BLINK_CLASS)) findings.push(finding(file, m.index ?? 0, m[0], 'a blinking cursor animation: remove it unless it marks a real text caret'));
    for (const m of code.matchAll(BLINK_KEYFRAMES)) {
      if (/caret-blink/i.test(m[1])) continue;
      findings.push(finding(file, m.index ?? 0, `@keyframes ${m[1]}`, 'a blinking cursor animation: remove it unless it marks a real text caret'));
    }
  }
  return dedupe(findings);
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
