// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 * @typedef {{name: string, card: boolean, index: number}} Open
 */

const RULE = 'SL-M15';
const MARKUP = new Set(['js', 'jsx', 'tsx', 'html', 'vue', 'svelte']);
/** A closing tag, or an opening tag not preceded by an identifier, a dot or a closing bracket (a TypeScript generic). */
const TAG = /<\/([A-Za-z][\w.:-]*)\s*>|(?<![\w$.)\]])<([A-Za-z][\w.:-]*)((?:[^>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*?)(\/?)>/g;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const CARD_COMPONENT = /(?:^|\.)(?:[A-Z][\w$]*)?Card$/;
const BLOCK = new Set(['div', 'section', 'article', 'li', 'aside']);
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
const RADIUS = /(?<![\w:-])rounded-(?:md|lg|xl|2xl|3xl|\[[^\]\s]+\])(?![\w-])/;
const EDGE = /(?<![\w:-])(?:border(?:-(?:[a-z]+(?:-\d{2,3})?(?:\/\d+)?|\[[^\]]+\]))?|ring-1|shadow(?:-(?:sm|md|lg|xl|2xl))?)(?![\w-])/;
const PADDED = /(?<![\w:-])(?:p-(?:[3-9]|1[0-2])|px-(?:[3-9]|1[0-2])(?=[\s\S]*(?<![\w:-])py-\d))(?![\w-])/;
const CARD_CLASS = /(?<![\w-])(?:[\w-]+-)?card(?![\w-])/i;

/**
 * Cards inside cards (FD10 M15; impeccable's nested-cards entry, FD10-F28): a bordered or filled, rounded, padded
 * container (or a *Card component) opened while another one is still open. Flat layouts that use spacing instead are
 * the fix; dashboards with real grouping are the documented false positive.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if (!MARKUP.has(file.kind)) continue;
    /** @type {Open[]} */
    const stack = [];
    for (const m of file.code.matchAll(TAG)) {
      const [, closing, name, attrs, selfClosing] = m;
      const at = m.index ?? 0;
      if (closing) {
        const open = stack.map((s) => s.name).lastIndexOf(closing);
        if (open >= 0) stack.length = open;
        continue;
      }
      if (selfClosing || VOID.has(name.toLowerCase())) continue;
      const card = isCard(name, attrs);
      const outer = card ? [...stack].reverse().find((s) => s.card) : undefined;
      if (outer) {
        findings.push(finding(file, at, `<${name}> in <${outer.name}>`, `a card nested in the card opened at line ${lineOf(file.text, outer.index)}; flatten it and group with spacing`));
      }
      stack.push({ name, card, index: at });
    }
  }
  return findings;
}

/**
 * @param {string} name
 * @param {string} attrs
 * @returns {boolean}
 */
function isCard(name, attrs) {
  if (CARD_COMPONENT.test(name)) return true;
  if (!BLOCK.has(name)) return false;
  const classes = [...attrs.matchAll(STRING)].map((s) => s[0].slice(1, -1)).join(' ');
  if (CARD_CLASS.test(classes)) return true;
  return RADIUS.test(classes) && EDGE.test(classes) && PADDED.test(classes);
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
