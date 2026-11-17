// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * SL-T03 static: emoji in headings. Fires on an emoji inside a heading element (h1-h6 and the shadcn title
 * components), inside a title or heading prop that feeds one (a data array of features), and on navigation where
 * three or more links or labels in one file start with an emoji (Krebs's sidebar rule, FD10 R03). Not counted
 * (FD14-F23): typographic glyphs that are Extended_Pictographic yet read as text (copyright, trademark, arrows, the
 * play triangle, check and star marks), page metadata titles, flags (not pictographs), and emoji in toasts, badges
 * or game content outside headings.
 *
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-T03';
const PICTOGRAPH = /\p{Extended_Pictographic}/gu;
/** Extended_Pictographic glyphs that read as typography: ©, ®, ™, arrows, ▶, ✓ and ✦ (FD14-F23). */
const GLYPH = /^[©®™←-⇿▶✓✦]$/u;
const HEADING_ELEMENTS = 'h[1-6]|CardTitle|DialogTitle|SheetTitle|AlertTitle|DrawerTitle';
const HEADING_PROP = /\b(title|heading|headline)\s*:\s*(['"`])((?:(?!\2)[^\\\n]|\\.)*)\2/g;
const METADATA_CONTEXT = /\bmetadata\b|\bMetadata\b|\bopenGraph\b|\btwitter\s*:|\buseHead\b|\buseSeoMeta\b|<Head\b|<title\b|document\.title/;
const NAV_LINK = /<(?:a|Link|NavLink|NuxtLink|RouterLink)(?=[\s>])/g;
const NAV_LABEL = /\blabel\s*:\s*(['"`])\s*/g;
const MIN_NAV_EMOJI = 3;

/**
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {StaticFinding[]} */
  const out = [];
  for (const file of shippedFiles(ctx)) {
    const code = file.code;
    for (const span of elementSpans(code, HEADING_ELEMENTS)) {
      const hit = firstEmoji(code.slice(span.contentStart, span.contentEnd));
      if (hit) out.push(finding(file, span.contentStart + hit.index, hit.char, `emoji in a <${span.tag}> heading`));
    }
    if (file.kind !== 'html' && file.kind !== 'css') {
      for (const m of code.matchAll(HEADING_PROP)) {
        const hit = firstEmoji(m[3]);
        if (!hit || METADATA_CONTEXT.test(code.slice(Math.max(0, m.index - 400), m.index))) continue;
        out.push(finding(file, m.index, hit.char, `emoji in a ${m[1]} prop that renders as a heading`));
      }
    }
    /** @type {Array<{index: number, char: string}>} */
    const nav = [];
    for (const m of code.matchAll(NAV_LINK)) {
      const end = openTagEnd(code, m.index);
      if (end < 0) continue;
      const lead = /^\s*(?:\{\s*['"`])?\s*(\S{1,4})/u.exec(code.slice(end + 1, end + 40));
      const hit = lead ? firstEmoji(lead[1]) : null;
      if (hit) nav.push({ index: end + 1, char: hit.char });
    }
    for (const m of code.matchAll(NAV_LABEL)) {
      const hit = firstEmoji(code.slice(m.index + m[0].length, m.index + m[0].length + 4));
      if (hit && hit.index === 0) nav.push({ index: m.index, char: hit.char });
    }
    if (nav.length >= MIN_NAV_EMOJI) {
      for (const n of nav) out.push(finding(file, n.index, n.char, `emoji-prefixed navigation item (${nav.length} in this file)`));
    }
  }
  return unique(out);
}

/**
 * The first emoji in a text, glyphs that read as typography excepted.
 * @param {string} text
 * @returns {{char: string, index: number} | null}
 */
function firstEmoji(text) {
  for (const m of text.matchAll(PICTOGRAPH)) if (!GLYPH.test(m[0])) return { char: m[0], index: m.index };
  return null;
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
