// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 * @typedef {{file: SourceFile, index: number, value: string}} Hit
 */

const RULE = 'SL-M13';
/** Test and story files are never rendered to the jury; demo data in mocks/ or fixtures/ often is, so it stays in. */
const NOT_SHIPPED = /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|tests?|spec|stories|storybook|e2e|cypress|playwright)\/|\.(?:test|spec|stories|story)\.[cm]?[jt]sx?$/i;
const MARKUP = new Set(['js', 'jsx', 'tsx', 'html', 'vue', 'svelte']);
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
const TEXT_NODE = /(?<![=\-])>([^<>{}]+)</g;
const ARROW_END = /(?:→|&rarr;|&#8594;|&#x2192;|\\u2192)\s*$/i;
const MIDDOT = /(?:\s|^)(?:·|&middot;|&#183;|&#xb7;|\\u00b7)(?=\s|$)/gi;
const MIDDOT_JOIN = /\.join\(\s*(["'`])\s*(?:·|&middot;|\\u00b7)\s*\1\s*\)/gi;
const MONO = /(?<![\w-])font-mono(?![\w-])/;
const UPPER = /(?<![\w-])(?:[\w-]+:)*uppercase(?![\w-])/;
const MICRO = /(?<![\w-])(?:[\w-]+:)*text-(?:xs|\[(?:9|10|11|12)px\]|\[0?\.(?:5625|6|625|65|6875|7|75)rem\])(?![\w-])/;
const MONO_FAMILY = /font-family\s*:\s*[^;]*(?:mono|courier|menlo|consolas|monaco)/i;
const MICRO_SIZE = /font-size\s*:\s*(?:(?:9|10|11|12)(?:\.\d+)?px|0?\.(?:5625|6|625|65|6875|7|75)rem)/i;
/** v3's limits note that middle dots in bylines, arrows on "read more" and mono for hashes are human conventions: count density, never a single occurrence (FD15-F05). */
const MIN_PER_PATTERN = 3;

/**
 * Template chrome that "appears whatever the subject" (FD10 M13, FD15-F05 cluster 5): a "→" appended to link and
 * button text, meta strings joined with middle dots ("A · B · C"), and uppercase monospace micro-labels. Each pattern
 * fires only at three or more occurrences in the project, and then reports each occurrence. Only text that can reach
 * the page counts: markup text and string literals, never a string handed to logging, assertions, tests or the
 * terminal, nor an object field in a module that renders nothing (a pool registry, a CLI report table).
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {Hit[]} */
  const arrows = [];
  /** @type {Hit[]} */
  const dots = [];
  /** @type {Hit[]} */
  const labels = [];
  for (const file of ctx.files) {
    if (file.kind === 'json' || COMPILED.test(file.text) || NOT_SHIPPED.test(file.path)) continue;
    const code = file.code;
    if (file.kind !== 'css') {
      for (const t of texts(file)) {
        if (ARROW_END.test(t.value) && /[\p{L}\p{N}]|^\s*(?:→|&rarr;)/u.test(t.value) && !t.svgLabel) arrows.push(t);
        if ([...t.value.matchAll(MIDDOT)].length >= 2) dots.push(t);
      }
      for (const m of code.matchAll(MIDDOT_JOIN)) dots.push({ file, index: m.index ?? 0, value: m[0] });
      for (const m of code.matchAll(/\}\s*(?:·|&middot;)\s*\{[^\n]*\}\s*(?:·|&middot;)\s*\{/g)) dots.push({ file, index: m.index ?? 0, value: 'A · B · C' });
      for (const m of code.matchAll(STRING)) {
        const value = m[0].slice(1, -1);
        if (MONO.test(value) && UPPER.test(value) && MICRO.test(value)) labels.push({ file, index: (m.index ?? 0) + 1, value: 'font-mono uppercase micro text' });
      }
    }
    for (const { css, offset } of cssRegions(file)) {
      for (const block of css.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
        const body = block[2];
        if (MONO_FAMILY.test(body) && /text-transform\s*:\s*uppercase/i.test(body) && MICRO_SIZE.test(body)) {
          labels.push({ file, index: offset + (block.index ?? 0) + block[1].search(/\S|$/), value: `${block[1].trim()} (mono, uppercase, micro size)` });
        }
      }
    }
  }
  return [
    ...report(dedupe(arrows), (n) => `"→" appended to link or button text (${n} in the project); use plain labels that say what happens`),
    ...report(dedupe(dots), (n) => `meta string joined with middle dots (${n} in the project); write the facts as plain text`),
    ...report(dedupe(labels), (n) => `uppercase monospace micro-label (${n} in the project); keep monospace for hashes and addresses`),
  ];
}

/** A chart axis label ("price →") states a direction, so SVG text is not template chrome. */
const SVG_TEXT_TAG = /^(?:text|tspan|textPath)$/;

/**
 * Text a user reads: markup text nodes and string literals, with their positions. `svgLabel` marks the text of an
 * SVG `<text>`, `<tspan>` or `<textPath>` element.
 * @param {SourceFile} file
 * @returns {Array<Hit & {svgLabel?: boolean}>}
 */
function texts(file) {
  /** @type {Array<Hit & {svgLabel?: boolean}>} */
  const out = [];
  if (MARKUP.has(file.kind)) {
    for (const m of file.code.matchAll(TEXT_NODE)) {
      const value = m[1].trim();
      if (!value) continue;
      const svgLabel = SVG_TEXT_TAG.test(openingTag(file.code, m.index ?? 0));
      out.push({ file, index: (m.index ?? 0) + m[0].indexOf(value), value, svgLabel });
    }
  }
  if (file.kind !== 'html') {
    const renders = RENDERS.test(file.code);
    for (const m of file.code.matchAll(STRING)) {
      const value = m[0].slice(1, -1).trim();
      if (!value) continue;
      const before = file.code.slice(Math.max(0, (m.index ?? 0) - 80), m.index ?? 0);
      if (NON_RENDER_CALL.test(before) || (!renders && OBJECT_FIELD.test(before))) continue;
      out.push({ file, index: (m.index ?? 0) + 1, value });
    }
  }
  return out;
}

/** A file that puts text on a page: JSX or HTML tags, or a DOM text write. A file without any is a data or logic module. */
const RENDERS = /<[A-Za-z][\w.-]*[\s/>]|\b(?:textContent|innerText|innerHTML|outerHTML|insertAdjacentHTML|createTextNode|document\.write)\b/;
/** A string handed to logging, assertions, tests or the terminal never reaches the page. */
const NON_RENDER_CALL = /\b(?:console\.\w+|(?:logger|log|pino)\.\w+|assert(?:\.\w+)?|expect|describe|it|test|process\.(?:stdout|stderr)\.write|new\s+\w*Error)\s*\(\s*(?:[^()]*,\s*)?$/;
/** An object field's value (`label: '…'`), which a data module only stores. */
const OBJECT_FIELD = /[{,]\s*(?:[\w$]+|'[^']*'|"[^"]*")\s*:\s*$/;

/**
 * @param {Hit[]} hits
 * @param {(n: number) => string} detail
 * @returns {StaticFinding[]}
 */
function report(hits, detail) {
  if (hits.length < MIN_PER_PATTERN) return [];
  return hits.map((h) => ({
    rule: RULE, layer: /** @type {const} */ ('static'), file: h.file.path, line: lineOf(h.file.text, h.index),
    excerpt: excerpt(h.file.text, h.index), value: h.value, detail: detail(hits.length),
  }));
}

/**
 * Name of the element whose opening tag ends with the `>` at `gt` ('' when none is found): the nearest `<` before it
 * outside JSX braces, within 2,000 characters.
 * @param {string} code
 * @param {number} gt
 * @returns {string}
 */
function openingTag(code, gt) {
  let depth = 0;
  for (let i = gt - 1; i >= 0 && gt - i < 2000; i -= 1) {
    const c = code[i];
    if (c === '}') depth += 1;
    else if (c === '{') depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === '>') return '';
    else if (depth === 0 && c === '<') {
      const m = /^<([A-Za-z][\w.:-]*)/.exec(code.slice(i, i + 80));
      return m ? m[1] : '';
    }
  }
  return '';
}

/**
 * @param {Hit[]} hits
 * @returns {Hit[]}
 */
function dedupe(hits) {
  /** @type {Map<string, Hit>} */
  const seen = new Map();
  for (const h of hits) {
    const key = `${h.file.path}:${lineOf(h.file.text, h.index)}`;
    if (!seen.has(key)) seen.set(key, h);
  }
  return [...seen.values()];
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
