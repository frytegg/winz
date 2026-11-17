// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * SL-T15 static: inconsistent spacing, two narrow source checks (FD10 S15, FD10-F27): Tailwind arbitrary spacing
 * values off the 4px scale (p-[13px], gap-[1.1rem]), and sections whose vertical paddings disagree (four or more
 * distinct paddings across four or more <section> elements; each section off the most common one is reported).
 * Static spacing diversity as such is not measured: it fired on hand-written CSS, the winning frontend included,
 * and stayed silent on generator output (FD14-F14), so layout-level consistency is left to the rendered page. Not
 * counted (registry): clamp() and calc() fluid values, optical tweaks of 2px or less, on-scale arbitrary values.
 *
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-T15';
const ARBITRARY_SPACING = /^-?(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y)-\[(-?\d*\.?\d+)(px|rem)\]$/;
const SECTION_PADDING = /^(py|pt|pb)-(\d+(?:\.\d+)?|px|\[[^\]]+\])$/;
const SECTION = /<section(?=[\s>])/g;
const OPTICAL_PX = 2;
const MIN_SECTIONS = 4;
const MIN_DISTINCT = 4;

/**
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  const files = shippedFiles(ctx);
  /** @type {StaticFinding[]} */
  const out = [];
  /** @type {Array<{file: SourceFile, index: number, padding: string}>} */
  const sections = [];
  for (const file of files) {
    for (const context of classContexts(file)) {
      for (const u of utilities(context.text)) {
        const m = ARBITRARY_SPACING.exec(u.utility);
        if (!m) continue;
        const px = Math.abs(Number(m[1]) * (m[2] === 'rem' ? 16 : 1));
        if (px > OPTICAL_PX && Math.abs(px - Math.round(px / 4) * 4) > 0.01) {
          out.push(finding(file, context.index, u.token, `arbitrary spacing of ${Number(px.toFixed(2))}px, off the 4px scale`));
        }
      }
    }
    for (const m of file.code.matchAll(SECTION)) {
      const end = openTagEnd(file.code, m.index);
      if (end < 0) continue;
      const attribute = /\bclass(?:Name)?\s*=\s*\{?\s*(['"`])([^'"`]*)\1/.exec(file.code.slice(m.index, end));
      if (!attribute) continue;
      const padding = utilities(attribute[2]).filter((u) => u.variants.length === 0 && SECTION_PADDING.test(u.utility)).map((u) => u.utility).sort().join(' ');
      if (padding) sections.push({ file, index: m.index, padding });
    }
  }
  const counts = new Map();
  for (const s of sections) counts.set(s.padding, (counts.get(s.padding) ?? 0) + 1);
  if (sections.length >= MIN_SECTIONS && counts.size >= MIN_DISTINCT) {
    const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    for (const s of sections) {
      if (s.padding !== common) {
        out.push(finding(s.file, s.index, s.padding, `section padding ${s.padding} differs from the most common ${common} (${counts.size} distinct values across ${sections.length} sections)`));
      }
    }
  }
  return unique(out);
}

// ─── shared:files ───
/**
 * Test, spec and story files, test folders, type declarations and the repository's own scripts/ and tools/ folders
 * never reach the judged page.
 */
const NOT_SHIPPED = /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|__stories__|tests?|e2e|cypress|playwright|stories|\.storybook)\/|^(?:scripts|tools)\/|\.(?:test|spec|stories|story|cy|e2e)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/i;
/** shadcn and Figma Make primitives: library code, judged through the files that use it. */
const LIBRARY = /(?:^|\/)components\/(?:ui|figma)\//i;
/** A CSS comment inside one template literal (CSS-in-JS): it never crosses a backtick. */
const TEMPLATE_CSS_COMMENT = /\/\*(?:(?!\*\/)[^`])*\*\//g;

/**
 * The files a detector reads: shipped sources only, never precompiled Tailwind output (it repeats its source,
 * FD14-F23), and library primitives only when asked. Their code also has the CSS comments of CSS-in-JS template
 * literals blanked (string content to the JavaScript comment stripper), same length and lines: comments never count.
 * @param {StaticContext} ctx
 * @param {{library?: boolean}} [options]
 * @returns {SourceFile[]}
 */
function shippedFiles(ctx, { library = false } = {}) {
  return ctx.files
    .filter((f) => !NOT_SHIPPED.test(f.path) && (library || !LIBRARY.test(f.path)) && !f.text.slice(0, 600).includes('/*! tailwindcss v'))
    .map((f) => (f.kind === 'css' || f.kind === 'json' || !f.code.includes('/*')
      ? f
      : { ...f, code: f.code.replace(TEMPLATE_CSS_COMMENT, (m) => m.replace(/[^\n]/g, ' ')) }));
}
// ─── end shared:files ───

// ─── shared:findings ───
/**
 * @param {SourceFile} file
 * @param {number} index offset in file.code
 * @param {unknown} value
 * @param {string} detail
 * @returns {StaticFinding}
 */
function finding(file, index, value, detail) {
  return {
    rule: RULE, layer: 'static', file: file.path, line: lineOf(file.code, index), excerpt: excerptAt(file.code, index),
    value, detail,
  };
}

/**
 * The source line holding `index`, whitespace collapsed, at most 120 characters, centred on the match when the line
 * is longer.
 * @param {string} code
 * @param {number} index
 * @returns {string}
 */
function excerptAt(code, index) {
  const at = Math.max(0, Math.min(index, code.length));
  const start = at > 0 ? code.lastIndexOf('\n', at - 1) + 1 : 0;
  const newline = code.indexOf('\n', at);
  const line = code.slice(start, newline < 0 ? code.length : newline);
  const flat = line.replace(/\s+/g, ' ').trim();
  if (flat.length <= 120) return flat;
  const from = Math.max(0, at - start - 30);
  return line.slice(from, from + 240).replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * One finding per file, line and detail, ordered by file then line.
 * @param {StaticFinding[]} findings
 * @returns {StaticFinding[]}
 */
function unique(findings) {
  const seen = new Set();
  return findings
    .filter((f) => {
      const key = `${f.file}\n${f.line}\n${f.detail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
}
// ─── end shared:findings ───

// ─── shared:brackets ───
/** @type {Readonly<Record<string, string>>} */
const CLOSERS = Object.freeze({ '{': '}', '(': ')', '[': ']' });

/**
 * The index of the bracket that closes the one at `open` ('{', '(' or '['), or -1 when it does not close within
 * 6000 characters.
 * @param {string} code
 * @param {number} open
 * @returns {number}
 */
function closing(code, open) {
  const opener = code[open];
  const closer = CLOSERS[opener];
  if (!closer) return -1;
  let depth = 0;
  for (let i = open; i < code.length && i - open < 6000; i += 1) {
    if (code[i] === opener) depth += 1;
    else if (code[i] === closer) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}
// ─── end shared:brackets ───

// ─── shared:classes ───
const LITERAL = /"((?:[^"\\\r\n]|\\.)*)"|'((?:[^'\\\r\n]|\\.)*)'|`((?:[^`\\]|\\[\s\S])*)`/g;
/** In markup, attribute values may wrap lines. */
const MARKUP_LITERAL = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\\r\n]|\\.)*)'|`((?:[^`\\]|\\[\s\S])*)`/g;
const CLASS_EXPRESSION = /(?:\bclass(?:Name)?|:class|\bclass:list)\s*=\s*\{/g;
const APPLY = /@apply\s+([^;{}]+)/g;
const RESPONSIVE_VARIANT = /^(?:sm|md|lg|xl|2xl|max-[\w-]+|min-[\w-]+|@[\w/-]+|dark|light|print|motion-safe|motion-reduce|portrait|landscape|rtl|ltr|supports-[\w[\]()-]+)$/;

/**
 * Where class lists live: every string literal (a class attribute, a cva variant, a template literal), every class
 * attribute expression with its additive literals joined (cn("a", cond && "b"); ternary branches stay on their own)
 * and every @apply.
 * @param {SourceFile} file
 * @returns {Array<{text: string, index: number}>}
 */
function classContexts(file) {
  const code = file.code;
  const pattern = file.kind === 'html' || file.kind === 'vue' || file.kind === 'svelte' ? MARKUP_LITERAL : LITERAL;
  /** @type {Array<{text: string, index: number}>} */
  const out = [];
  for (const m of code.matchAll(pattern)) {
    const text = m[1] ?? m[2] ?? m[3] ?? '';
    if (text.trim() && text.length <= 4000) out.push({ text, index: m.index + 1 });
  }
  for (const m of code.matchAll(CLASS_EXPRESSION)) {
    const open = m.index + m[0].length - 1;
    const close = closing(code, open);
    if (close < 0) continue;
    const expression = code.slice(open + 1, close);
    /** @type {string[]} */
    const parts = [];
    for (const s of expression.matchAll(LITERAL)) {
      if (!/[?:]\s*$/.test(expression.slice(0, s.index))) parts.push(s[1] ?? s[2] ?? s[3] ?? '');
    }
    if (parts.length > 1) out.push({ text: parts.join(' '), index: m.index });
  }
  for (const m of code.matchAll(APPLY)) out.push({ text: m[1], index: m.index });
  return out;
}

/**
 * A class list split into utilities with their variants: 'md:hover:bg-primary/90' gives
 * {variants: ['md', 'hover'], utility: 'bg-primary/90'}.
 * @param {string} text
 * @returns {Array<{variants: string[], utility: string, token: string}>}
 */
function utilities(text) {
  return text.split(/\s+/).filter(Boolean).map((token) => {
    /** @type {string[]} */
    const variants = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < token.length; i += 1) {
      const c = token[i];
      if (c === '[' || c === '(') depth += 1;
      else if (c === ']' || c === ')') depth = Math.max(0, depth - 1);
      else if (c === ':' && depth === 0) {
        variants.push(token.slice(from, i));
        from = i + 1;
      }
    }
    return { variants, utility: token.slice(from).replace(/^!|!$/g, ''), token };
  });
}

/**
 * True when a utility applies at rest: no variant, or only breakpoint, container, theme and media variants.
 * @param {{variants: string[]}} u
 * @returns {boolean}
 */
function atRest(u) {
  return u.variants.every((v) => RESPONSIVE_VARIANT.test(v));
}
// ─── end shared:classes ───

// ─── shared:markup ───
const TAG_NAME = /^<([A-Za-z][\w.:-]*)/;

/**
 * The opening tag whose attributes hold `index` (a class attribute value, say): its name and where it starts.
 * Null when `index` is not inside an opening tag.
 * @param {string} code
 * @param {number} index
 * @returns {{name: string, start: number} | null}
 */
function tagAt(code, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0 && index - i < 4000; i -= 1) {
    const c = code[i];
    if (c === '}') depth += 1;
    else if (c === '{') depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === '>' && code[i - 1] !== '=') return null;
    else if (depth === 0 && c === '<') {
      const m = TAG_NAME.exec(code.slice(i, i + 80));
      return m ? { name: m[1], start: i } : null;
    }
  }
  return null;
}

/**
 * The index of the '>' that ends the opening tag starting at `start`, skipping attribute expressions and quoted
 * values; -1 when it does not end within 4000 characters.
 * @param {string} code
 * @param {number} start index of '<'
 * @returns {number}
 */
function openTagEnd(code, start) {
  let depth = 0;
  let quote = '';
  for (let i = start + 1; i < code.length && i - start < 4000; i += 1) {
    const c = code[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (depth === 0 && (c === '"' || c === "'")) {
      quote = c;
    } else if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth = Math.max(0, depth - 1);
    } else if (c === '>' && depth === 0 && code[i - 1] !== '=') {
      return i;
    }
  }
  return -1;
}

/**
 * Every element whose tag name matches `names` (a regular-expression alternation such as 'h1|h2'), with the span of
 * its content up to the first matching closing tag. Self-closing tags have no content.
 * @param {string} code
 * @param {string} names
 * @returns {Array<{tag: string, start: number, contentStart: number, contentEnd: number}>}
 */
function elementSpans(code, names) {
  /** @type {Array<{tag: string, start: number, contentStart: number, contentEnd: number}>} */
  const out = [];
  for (const m of code.matchAll(new RegExp(`<(${names})(?=[\\s>/])`, 'g'))) {
    const end = openTagEnd(code, m.index);
    if (end < 0 || code[end - 1] === '/') continue;
    const close = code.indexOf(`</${m[1]}`, end);
    if (close >= 0) out.push({ tag: m[1], start: m.index, contentStart: end + 1, contentEnd: close });
  }
  return out;
}
// ─── end shared:markup ───
