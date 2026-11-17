// @ts-check
import { lineOf } from '../../lib/text.mjs';
import { mountedFiles } from './SL-T08.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-M11';
const BENTO_COMPONENT = /<Bento(?:Grid|Card|Item)\b|\bfrom\s+["'][^"']*bento-grid["']/g;
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
const SPAN = /(?<![\w-])(?:[\w-]+:)*((?:col|row)-span-(?:\d+|full))(?![\w-])/g;
const GRID = /(?<![\w-])(?:[\w-]+:)*grid-(?:cols|rows)-(?:[2-9]|1[0-2]|\[[^\]]+\])(?![\w-])/;
const CSS_SPAN = /grid-(column|row)\s*:\s*(?:auto\s*\/\s*)?span\s+(\d+)/gi;

/**
 * A bento grid (FD10 M11: Magic UI's bento-grid component, or a grid whose tiles mix spans; the catalogue's runtime
 * rule is "more than 4 cells of unequal spans"). Statically: bento components; a grid whose tiles span rows as well as
 * columns, or a grid of at most four columns with more than four mixed-span tiles; CSS tiles spanning both rows and
 * columns. A 12-column layout system (span 7 beside span 5) is not a bento and stays silent. The tell is contested
 * (0.1% of Reddit comments, FD10-F10), so real hierarchy in the content is a documented false positive.
 * Only files an entry point mounts count (SL-T08 mountedFiles): a vendored effect or a components/ui primitive
 * that nothing imports never renders (FD14-F12, FD14-F22).
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {StaticFinding[]} */
  const findings = [];
  const mounted = mountedFiles(ctx.files);
  for (const file of ctx.files) {
    if (mounted && !mounted.has(file.path)) continue;
    if (file.kind === 'json' || COMPILED.test(file.text)) continue;
    const code = file.code;
    const component = [...code.matchAll(BENTO_COMPONENT)][0];
    if (component) findings.push(finding(file, component.index ?? 0, component[0].trim(), 'Magic UI bento-grid component; use a bento layout only when the content has that shape'));
    if (file.kind !== 'css') {
      /** @type {{index: number, columns: number} | null} */
      let grid = null;
      /** @type {string[]} */
      const spans = [];
      for (const m of code.matchAll(STRING)) {
        const value = m[0].slice(1, -1);
        const cols = GRID.exec(value);
        if (!grid && cols) grid = { index: (m.index ?? 0) + 1, columns: Number(/\d+/.exec(cols[0])?.[0] ?? 0) };
        for (const s of value.matchAll(SPAN)) spans.push(s[1]);
      }
      const distinct = [...new Set(spans)];
      const rowSpan = spans.some((s) => /^row-span-(?:[2-9]|full)/.test(s));
      const colSpans = new Set(spans.filter((s) => s.startsWith('col-')));
      const smallGridMixed = grid !== null && grid.columns <= 4 && spans.length > 4 && colSpans.size >= 2;
      if (grid && spans.length >= 3 && (rowSpan || smallGridMixed)) {
        findings.push(finding(file, grid.index, distinct, `grid whose tiles mix spans (${distinct.join(', ')}); use a bento layout only when the content has that shape`));
      }
    }
    const cssSpans = [...code.matchAll(CSS_SPAN)].map((m) => ({ index: m.index ?? 0, axis: m[1].toLowerCase(), n: Number(m[2]) }));
    const tallTile = cssSpans.some((s) => s.axis === 'row' && s.n >= 2);
    const wideTile = cssSpans.some((s) => s.axis === 'column' && s.n >= 2);
    if (tallTile && wideTile) {
      const spans = [...new Set(cssSpans.map((s) => `${s.axis} span ${s.n}`))];
      findings.push(finding(file, cssSpans[0].index, spans, `CSS grid tiles spanning both rows and columns (${spans.join(', ')}); use a bento layout only when the content has that shape`));
    }
  }
  return findings;
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
