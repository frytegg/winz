// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 * @typedef {{file: SourceFile, index: number, how: string}} Pair
 */

const RULE = 'SL-M02';
const MARKUP = new Set(['js', 'jsx', 'tsx', 'html', 'vue', 'svelte']);
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
const UPPERCASE = /(?<![\w-])(?:[\w-]+:)*uppercase(?![\w-])/;
const TRACKING = /(?<![\w-])(?:[\w-]+:)*tracking-(?:wide|wider|widest|\[[\d.]+(?:em|px|rem)\])(?![\w-])/;
const NAMED_CLASS = /(?<![\w-])(?:eyebrow|kicker|overline)(?![\w-])/;
const NAMED_TAG = /<(?:Eyebrow|Kicker|Overline)\b/g;
const NAMED_PROP = /(?<![\w.-])(?:eyebrow|kicker|overline)(?:\s*=\s*["'{`]|\s*:\s*["'`])/g;
const HEADING = /<h([1-3])\b/g;
const NOT_EYEBROW_TAG = /^(?:h[1-6]|button|a|Link|NavLink|Button|th|label|legend|option|nav|input|select|summary)$/;
/** The eyebrow is the block just above the heading: at most this many lines between them. */
const MAX_GAP_LINES = 4;

/**
 * Tracked ALL-CAPS eyebrows above section headings (FD10 M02, FD15-F05/F06: "a tracked-out ALL-CAPS eyebrow label
 * above every heading"). One eyebrow is a normal editorial device (Krebs dropped an all-caps detector for firing on
 * clean sites, FD10-F12), so the rule fires only when eyebrows sit above more than one heading in three, the fix
 * direction's own budget, and then reports each eyebrow-heading pair. An eyebrow is the heading's sibling just above
 * it with no other text between them; a CSS-defined class counts only in a class attribute, and a callout's key
 * ("Warning", "Note") is not an eyebrow.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  const cssClasses = eyebrowClasses(ctx.files);
  /** @type {Pair[]} */
  const pairs = [];
  let headings = 0;
  for (const file of ctx.files) {
    if (!MARKUP.has(file.kind)) continue;
    const code = file.code;
    const heads = [...code.matchAll(HEADING)].map((m) => ({ index: m.index ?? 0, level: Number(m[1]) }));
    headings += heads.filter((h) => h.level > 1).length;
    const brows = eyebrows(file, cssClasses);
    for (const brow of brows) {
      const next = heads.find((h) => h.index > brow.index);
      if (!next || next.level === 1) continue;
      const gap = lineOf(file.text, next.index) - lineOf(file.text, brow.index);
      if (gap <= MAX_GAP_LINES && directlyAbove(code, brow.index, next.index)) pairs.push({ file, index: brow.index, how: brow.how });
    }
    for (const m of code.matchAll(NAMED_PROP)) {
      pairs.push({ file, index: m.index ?? 0, how: `a "${m[0].replace(/[\s:=].*$/s, '')}" field rendered above a title` });
      headings += 1;
    }
  }
  const unique = dedupe(pairs);
  if (unique.length < 2 || unique.length * 3 <= headings) return [];
  return unique.map((p) => finding(p.file, p.index, { eyebrows: unique.length, headings },
    `${p.how}; ${unique.length} eyebrows over ${headings} section headings, keep at most one per three sections`));
}

/**
 * Class names defined in CSS as uppercase with letter-spacing of at least about 0.5px.
 * @param {SourceFile[]} files
 * @returns {Set<string>}
 */
function eyebrowClasses(files) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const file of files) {
    for (const { css } of cssRegions(file)) {
      for (const block of css.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
        const body = block[2];
        if (!/text-transform\s*:\s*uppercase/i.test(body)) continue;
        const spacing = /letter-spacing\s*:\s*([^;]+)/i.exec(body);
        if (!spacing || !trackedOut(spacing[1])) continue;
        for (const cls of block[1].matchAll(/\.([A-Za-z_][\w-]*)/g)) names.add(cls[1]);
      }
    }
  }
  return names;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function trackedOut(value) {
  const m = /(-?[\d.]+)(em|px|rem)/.exec(value);
  if (!m) return /var\([^)]*(?:track|wide|caps)/i.test(value);
  const n = Number(m[1]);
  return m[2] === 'px' ? n >= 0.5 : m[2] === 'em' ? n >= 0.04 : n >= 0.03;
}

/**
 * Eyebrow elements in one markup file: tracked uppercase class strings, eyebrow-named classes and components.
 * @param {SourceFile} file
 * @param {Set<string>} cssClasses
 * @returns {Array<{index: number, how: string}>}
 */
function eyebrows(file, cssClasses) {
  const code = file.code;
  /** @type {Array<{index: number, how: string}>} */
  const out = [];
  for (const m of code.matchAll(STRING)) {
    const at = (m.index ?? 0) + 1;
    const value = m[0].slice(1, -1);
    const tracked = UPPERCASE.test(value) && TRACKING.test(value);
    const named = NAMED_CLASS.test(value) || [...cssClasses].some((c) => new RegExp(`(?<![\\w-])${escape(c)}(?![\\w-])`).test(value));
    if (!tracked && !named) continue;
    const how = tracked ? 'a tracked uppercase label' : 'an eyebrow-styled label';
    const assigned = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(code.slice(Math.max(0, at - 80), at - 1));
    if (assigned) {
      for (const use of code.matchAll(new RegExp(`\\{\\s*${escape(assigned[1])}\\s*\\}|\\(\\s*${escape(assigned[1])}\\s*[,)]`, 'g'))) {
        if (!NOT_EYEBROW_TAG.test(ownerTag(code, use.index ?? 0))) out.push({ index: use.index ?? 0, how });
      }
      continue;
    }
    if (NOT_EYEBROW_TAG.test(ownerTag(code, at))) continue;
    if (!tracked && !CLASS_BEFORE.test(code.slice(Math.max(0, at - 120), at - 1))) continue;
    if (CALLOUT.test(code.slice(Math.max(0, at - 240), at))) continue;
    out.push({ index: at, how });
  }
  for (const m of code.matchAll(NAMED_TAG)) out.push({ index: m.index ?? 0, how: `an ${m[0].slice(1)} component` });
  return out.sort((a, b) => a.index - b.index);
}

/** A CSS-defined eyebrow class counts only as a class: in a class attribute or a class-joining call. */
const CLASS_BEFORE = /(?:\b(?:class|className|class:list)\s*=\s*\{?\s*|\b(?:cn|clsx|cx|twMerge|classNames|cva)\s*\([^()]*)$/;
/** A key inside a callout, admonition or alert ("Warning", "Note") labels the box, not a section heading. */
const CALLOUT = /<[A-Za-z][\w.-]*\b[^<>]*\bclass(?:Name)?\s*=\s*\{?\s*["'`][^"'`]*\b(?:callout|admonition|alert|notice)\b[^<>]*>[^<>]*<[^<>]*$/i;

/**
 * True when nothing but the eyebrow's own text sits between it and the heading: the label is the heading's sibling
 * just above it, not a paragraph or a code block a few lines up.
 * @param {string} code
 * @param {number} from the eyebrow's class string or tag
 * @param {number} heading
 * @returns {boolean}
 */
function directlyAbove(code, from, heading) {
  const tagEnd = code.indexOf('>', from);
  if (tagEnd < 0 || tagEnd > heading) return false;
  const segments = code.slice(tagEnd + 1, heading).split(/<[^<>]*>/).map((t) => t.trim()).filter(Boolean);
  return segments.length <= 1;
}

/**
 * @param {Pair[]} pairs
 * @returns {Pair[]}
 */
function dedupe(pairs) {
  /** @type {Map<string, Pair>} */
  const seen = new Map();
  for (const p of pairs) {
    const key = `${p.file.path}:${lineOf(p.file.text, p.index)}`;
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()];
}

/**
 * @param {string} s
 * @returns {string}
 */
function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
