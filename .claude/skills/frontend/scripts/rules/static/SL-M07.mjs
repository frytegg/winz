// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 * @typedef {{file: SourceFile, index: number, signature: string, weight: number}} CardUse
 */

const RULE = 'SL-M07';
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
const RADIUS = /(?<![\w:-])rounded-(?:lg|xl|2xl|3xl|\[[^\]\s]+\])(?![\w-])/;
const SHADOW = /(?<![\w:-])shadow(?:-(?:sm|md|lg|xl|2xl|\[[^\]\s]+\]))?(?![\w-])/;
const SOFT_SHADOW = /box-shadow\s*:\s*[^;]*rgba?\(\s*0\s*,?\s*0\s*,?\s*0\s*(?:,|\/)\s*0?\.1\s*\)/i;
/** "content chopped into identical rounded cards" (FD15-F05): at least this many uses of one card signature. */
const MIN_USES = 4;
/** "one border-radius on everything regardless of hierarchy": the dominant signature's share of all card uses. */
const MIN_SHARE = 0.75;
const MAPPED_WEIGHT = 3;

/**
 * The SaaS-card kit (FD10 M07; FD15-F05 cluster 4: "identical rounded cards, one border-radius on everything
 * regardless of hierarchy, the same soft grey shadow (rgba(0,0,0,.1)) under each"; Tailwind's shadow scale is
 * rgb(0 0 0 / 0.1), FD10-F08). Counts class strings carrying a large radius and a shadow, a card rendered in a .map()
 * counting as several, and CSS rules with the rgba(0,0,0,.1) shadow. Fires once per project when one signature
 * dominates.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {CardUse[]} */
  const uses = [];
  /** @type {Map<string, string>} card component name -> its signature */
  const components = new Map();
  for (const file of ctx.files) {
    if (file.kind === 'json' || COMPILED.test(file.text)) continue;
    if (file.kind !== 'css') {
      for (const m of file.code.matchAll(STRING)) {
        const value = m[0].slice(1, -1);
        const radius = RADIUS.exec(value);
        const shadow = SHADOW.exec(value);
        if (!radius || !shadow) continue;
        const at = (m.index ?? 0) + 1;
        const signature = `${radius[0]} ${shadow[0]}`;
        const owner = /(?:function|const|let)\s+((?:[A-Z][\w$]*)?Card)\b(?![\s\S]*(?:function|const|let)\s+[A-Z])/.exec(file.code.slice(Math.max(0, at - 600), at));
        if (owner) components.set(owner[1], signature);
        else uses.push({ file, index: at, signature, weight: insideMap(file.code, at) ? MAPPED_WEIGHT : 1 });
      }
    }
    for (const { css, offset } of cssRegions(file)) {
      for (const block of css.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
        const body = block[2];
        if (!SOFT_SHADOW.test(body)) continue;
        const radius = /border-radius\s*:\s*([^;]+)/i.exec(body);
        if (!radius) continue;
        uses.push({ file, index: offset + (block.index ?? 0) + block[1].search(/\S|$/), signature: `border-radius: ${radius[1].trim()} + rgba(0,0,0,.1) shadow`, weight: 1 });
      }
    }
  }
  for (const [name, signature] of components) {
    const tag = new RegExp(`<${name}\\b`, 'g');
    for (const file of ctx.files) {
      if (file.kind === 'json' || file.kind === 'css') continue;
      for (const m of file.code.matchAll(tag)) {
        const at = m.index ?? 0;
        uses.push({ file, index: at, signature, weight: insideMap(file.code, at) ? MAPPED_WEIGHT : 1 });
      }
    }
  }
  const total = uses.reduce((n, u) => n + u.weight, 0);
  /** @type {Map<string, CardUse[]>} */
  const bySignature = new Map();
  for (const u of uses) bySignature.set(u.signature, [...(bySignature.get(u.signature) ?? []), u]);
  const [signature, group] = [...bySignature.entries()].sort((a, b) => weight(b[1]) - weight(a[1]))[0] ?? ['', []];
  const count = weight(group);
  if (count < MIN_USES || count / total < MIN_SHARE) return [];
  const files = new Set(group.map((u) => u.file.path));
  const first = group[0];
  return [{
    rule: RULE,
    layer: 'static',
    file: first.file.path,
    line: lineOf(first.file.text, first.index),
    excerpt: excerpt(first.file.text, first.index),
    value: { signature, uses: count, share: Math.round((count / total) * 100) / 100, files: files.size },
    detail: `one card recipe (${signature}) on ${count} of ${total} card uses across ${files.size} file(s); give radius and shadow by hierarchy and use fewer containers`,
  }];
}

/**
 * @param {CardUse[]} group
 * @returns {number}
 */
function weight(group) {
  return group.reduce((n, u) => n + u.weight, 0);
}

/**
 * True when `index` sits inside the callback of a `.map(` call opened within the previous 600 characters.
 * @param {string} code
 * @param {number} index
 * @returns {boolean}
 */
function insideMap(code, index) {
  const before = code.slice(Math.max(0, index - 600), index);
  const at = before.lastIndexOf('.map(');
  if (at < 0) return false;
  let depth = 0;
  for (const c of before.slice(at + 4)) {
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
  }
  return depth > 0;
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
