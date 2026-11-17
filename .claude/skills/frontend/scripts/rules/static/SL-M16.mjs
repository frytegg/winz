// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-M16';
const MARKUP = new Set(['js', 'jsx', 'tsx', 'html', 'vue', 'svelte']);
const SVG = /<svg\b([^>]*)>([\s\S]*?)<\/svg\s*>/gi;
const PRIMITIVE = /<(circle|ellipse|rect|polygon|polyline|line|path)\b/gi;
/** "many primitives" is the catalogue's word (FD10 M16); 12 is a candidate threshold until calibration. */
const MIN_PRIMITIVES = 12;
/** Icons and logos are mostly paths; a shape-assembled illustration is mostly geometric primitives. */
const MIN_GEOMETRIC_SHARE = 0.5;
const ICON_BOX = 64;
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
const LIGHTS = [
  /(?<![\w:-])bg-(?:red|rose)-(?:300|400|500|600)(?![\w-])/,
  /(?<![\w:-])bg-(?:yellow|amber)-(?:300|400|500|600)(?![\w-])/,
  /(?<![\w:-])bg-(?:green|emerald|lime)-(?:300|400|500|600)(?![\w-])/,
];
const DOT = /(?<![\w-])rounded-full(?![\w-])/;
/** Three traffic lights within this many lines form a window title bar. */
const LIGHTS_SPAN_LINES = 8;
/** FD15: "do NOT draw a fake iOS status bar"; the measurable signal is a 9:41 string in a mockup. */
const STATUS_BAR_TIME = /(?<![=\-])>\s*9:41\s*</g;

/**
 * Hand-assembled visuals standing in for the product (FD10 M16; impeccable's shape-assembled-illustration, FD10-F28;
 * FD15 "fake device chrome"): a large inline SVG built mostly from circles, rects and polygons with no text (a diagram
 * labels its parts), a div window mockup with red, yellow and green dots, and a 9:41 status-bar time.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if (!MARKUP.has(file.kind)) continue;
    const code = file.code;
    for (const m of code.matchAll(SVG)) {
      const [, attrs, inner] = m;
      if (/<(?:text|marker|image|foreignObject)\b/i.test(inner) || iconSized(attrs)) continue;
      const kinds = [...inner.matchAll(PRIMITIVE)].map((p) => p[1].toLowerCase());
      const geometric = kinds.filter((k) => k !== 'path').length;
      if (kinds.length >= MIN_PRIMITIVES && geometric / kinds.length >= MIN_GEOMETRIC_SHARE) {
        findings.push(finding(file, m.index ?? 0, { primitives: kinds.length, geometric }, `inline SVG assembled from ${kinds.length} primitives with no labels: show a real screenshot, the live product or a labelled protocol diagram`));
      }
    }
    const dots = [...code.matchAll(STRING)]
      .filter((s) => DOT.test(s[0]))
      .map((s) => ({ index: (s.index ?? 0) + 1, light: LIGHTS.findIndex((re) => re.test(s[0])) }))
      .filter((d) => d.light >= 0);
    for (let i = 0; i < dots.length; i += 1) {
      if (dots[i].light !== 0) continue;
      const startLine = lineOf(file.text, dots[i].index);
      const near = dots.filter((d) => d.index > dots[i].index && lineOf(file.text, d.index) - startLine <= LIGHTS_SPAN_LINES);
      if (near.some((d) => d.light === 1) && near.some((d) => d.light === 2)) {
        findings.push(finding(file, dots[i].index, 'red-yellow-green dots', 'a div-built window title bar (fake screenshot): show a real screenshot or the live product'));
      }
    }
    for (const m of code.matchAll(STATUS_BAR_TIME)) {
      findings.push(finding(file, m.index ?? 0, '9:41', 'a fake device status bar (9:41): show the product without drawn device chrome'));
    }
  }
  return findings;
}

/**
 * True for an SVG small enough to be an icon (width, height or viewBox at most ICON_BOX, or a small size class).
 * @param {string} attrs
 * @returns {boolean}
 */
function iconSized(attrs) {
  const box = /viewBox\s*=\s*["'{]*\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(attrs);
  if (box && Number(box[1]) <= ICON_BOX && Number(box[2]) <= ICON_BOX) return true;
  const width = /\bwidth\s*=\s*["'{]*\s*([\d.]+)/i.exec(attrs);
  if (width && Number(width[1]) <= ICON_BOX) return true;
  return /(?<![\w-])(?:size|[wh])-(?:3|3\.5|4|5|6|8|10|12)(?![\w-])/.test(attrs);
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
