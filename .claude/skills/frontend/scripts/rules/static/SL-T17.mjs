// @ts-check
import { existsSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../../lib/errors.mjs';
import { readText, toPosix } from '../../lib/fsutil.mjs';
import { designDir } from '../../lib/paths.mjs';
import { lineOf, wordCount } from '../../lib/text.mjs';

/**
 * SL-T17 static: generic buzzword copy, in two parts. Promotional phrases (impeccable's 29, FD10-F19) fire on every
 * hit in the UI copy unless the sentence names something checkable: a claim-like number (a percentage, an amount, a
 * multiplier, a count with a unit; never digits inside a name such as "0G Chain" or "ERC-7857", never a bare year)
 * or one of the profile's sponsors (the registry's specificity test; a mechanism or a user cannot be told from
 * source). Stock template phrases measured on the owner's corpus (FD14-F15: "get started", "learn more", "how it
 * works", "join thousands", "join the", "ready to ...?", "built for the", "ultimate", "legendary", "transparent
 * and", "decentralized", "autonomous", "ecosystem") fire by density, more than 2.0 per 1,000 words of copy and
 * three hits. On that list FD14-F15 measured SUI's Figma Make export at 14.53, ETHDenver (a teammate build, a full
 * T17 hit) at 3.52 and BaseBatches at 2.10, against inflexion 0.81, Hedera's template 0.50 and 0 for XRPL, BNB and
 * Monad; the threshold stays a candidate until the controls are run. The three protocol words are vocabulary in
 * some projects, so the project glossary (`<design>/glossary.json`, `{"terms": [...]}` or an array, written from the
 * domain research) removes any of them it lists. Not counted: quoted text (a sponsor's tagline in a blockquote or in
 * quotation marks), page titles, comments.
 * adapted from pbakaus/impeccable, Apache-2.0 (crates/detect/src/regex_matchers.rs at commit 909726c, BUZZWORDS);
 * changed: matched on extracted UI copy of every file kind instead of whole HTML pages, with the specificity and
 * quotation exemptions.
 *
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-T17';
const PROMOTIONAL = /\b(?:streamline your|empower your|supercharge your|unleash (?:your|the power)|leverage the power|built for the modern|trusted by (?:leading|the world)|best-in-class|industry-leading|world-class|enterprise-grade|next-generation|cutting-edge|transform your business|revolutioniz\w*|game[- ]chang\w*|mission-critical|best of breed|future[- ]proof|seamless(?:ly integrate| experience)|drive (?:engagement|growth|results)|harness the power)\b/gi;
/** Whole words only: "ultimately" and "join them" are not the template phrases. */
const STOCK_PHRASES = Object.freeze(['get started', 'learn more', 'how it works', 'join thousands', 'join the', 'built for the',
  'ultimate', 'legendary', 'transparent and']);
/** Protocol vocabulary in some projects: counted unless the project glossary lists the word (FD14-F15). */
const VOCABULARY = Object.freeze(['decentralized', 'decentralised', 'autonomous', 'ecosystem']);
/** A number that makes a claim checkable: $2.5M, 12.4%, 10K, 3x, "in 2 seconds"; not 0G, ERC-7857 or 2026. */
const CLAIM_NUMBER = /[$€£¥]\s?\d|\d(?:[\d,.]*\d)?\s?(?:%|×|x\b|[kKmMbB]\b|bps\b)|(?<![\p{L}\d.,-])(?!(?:19|20)\d\d(?![\d.,]))\d(?:[\d,.]*\d)?(?![\p{L}\d-])/u;

/**
 * The stock-phrase pattern, without the vocabulary words the glossary lists.
 * @param {Set<string>} terms
 * @returns {RegExp}
 */
function stockPattern(terms) {
  const words = [...STOCK_PHRASES, ...VOCABULARY.filter((w) => !terms.has(w))].map((w) => w.replace(/ /g, '\\s+'));
  return new RegExp(`\\b(?:(?:${words.join('|')})\\b|ready to\\b[^.?!]{0,60}\\?)`, 'gi');
}
const STOCK_PER_1000_WORDS = 2.0;
const MIN_STOCK_HITS = 3;
const MIN_WORDS = 300;
const MAX_LOCATIONS = 12;

/**
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  const sponsors = (ctx.profile?.sponsors ?? []).map((s) => String(s).toLowerCase()).filter(Boolean);
  const STOCK = stockPattern(glossary(ctx));
  /** @type {StaticFinding[]} */
  const out = [];
  /** @type {StaticFinding[]} */
  const stock = [];
  let words = 0;
  for (const file of shippedFiles(ctx)) {
    for (const segment of copySegments(file)) {
      if (segment.title || segment.quoted) continue;
      words += wordCount(segment.text);
      const specific = CLAIM_NUMBER.test(segment.text) || sponsors.some((s) => segment.text.toLowerCase().includes(s));
      if (!specific) {
        for (const m of segment.text.matchAll(PROMOTIONAL)) {
          if (insideQuotation(segment.text, m.index)) continue;
          out.push(finding(file, locate(file.code, segment.index, m[0]), m[0], `promotional phrase "${m[0]}" in copy that names no number or sponsor`));
        }
      }
      for (const m of segment.text.matchAll(STOCK)) {
        if (insideQuotation(segment.text, m.index)) continue;
        stock.push(finding(file, locate(file.code, segment.index, m[0]), m[0], `stock template phrase "${m[0].toLowerCase()}"`));
      }
    }
  }
  const rate = words > 0 ? (stock.length * 1000) / words : 0;
  if (words >= MIN_WORDS && stock.length >= MIN_STOCK_HITS && rate > STOCK_PER_1000_WORDS) {
    for (const f of stock.slice(0, MAX_LOCATIONS)) {
      out.push({ ...f, detail: `${f.detail}: ${rate.toFixed(2)} stock phrases per 1,000 words of UI copy (${stock.length} in ${words})` });
    }
  }
  return unique(out);
}

/**
 * The project glossary's terms, lower-cased: `<design>/glossary.json` as `{"terms": [...]}` or an array of strings.
 * No file, or a context without a root, gives none.
 * @param {StaticContext} ctx
 * @returns {Set<string>}
 */
function glossary(ctx) {
  if (typeof ctx.root !== 'string') return new Set();
  const file = toPosix(path.join(designDir(ctx.root, ctx.profile), 'glossary.json'));
  if (!existsSync(file)) return new Set();
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readText(file));
  } catch (err) {
    throw new UsageError(`${file} is not valid JSON (${err instanceof Error ? err.message : String(err)}); fix the glossary`, { cause: err });
  }
  const list = Array.isArray(raw) ? raw : raw !== null && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw).terms : null;
  if (!Array.isArray(list) || !list.every((t) => typeof t === 'string')) {
    throw new UsageError(`${file} must hold an array of terms, or {"terms": [...]}`);
  }
  return new Set(list.map((t) => t.trim().toLowerCase()).filter(Boolean));
}

/**
 * True when the phrase at `index` sits inside quotation marks within the copy ("...", “...”, «...»): a quoted
 * tagline or testimonial, not the project's own voice.
 * @param {string} text
 * @param {number} index
 * @returns {boolean}
 */
function insideQuotation(text, index) {
  for (const m of text.matchAll(/"[^"]+"|“[^”]+”|«[^»]+»/g)) {
    if (index > m.index && index < m.index + m[0].length) return true;
  }
  return false;
}

/**
 * The source offset of a phrase found in a copy segment (whitespace in the source may differ), or the segment's
 * start when the phrase cannot be found within 4000 characters.
 * @param {string} code
 * @param {number} from
 * @param {string} phrase
 * @returns {number}
 */
function locate(code, from, phrase) {
  const pattern = phrase.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const offset = code.slice(from, from + 4000).search(new RegExp(pattern, 'i'));
  return offset < 0 ? from : from + offset;
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

// ─── shared:copy ───
/**
 * @typedef {{text: string, index: number, title: boolean, quoted: boolean}} CopySegment
 */
const TEXT_NODE = />([^<>{}]+)</g;
/**
 * Quotation marks or apostrophes inside a markup text node are words, not a string literal: TEXT_NODE reads that
 * text already. An arrow (=>) or a comment-like (->) closer is code.
 */
const JSX_TEXT_BEFORE = /(?<![=-])>[^<>{}=]*$/;
/** Text beside a JSX expression; a text node between two tags is TEXT_NODE's and is skipped where this is read. */
const BRACED_TEXT = /([>}])([^<>{}`'"]*\p{L}[^<>{}`'"]*)(?=[<{])/gu;
const COPY_LITERAL = /"((?:[^"\\\r\n]|\\.)*)"|'((?:[^'\\\r\n]|\\.)*)'|`((?:[^`\\]|\\[\s\S])*)`/g;
const CODE_LIKE = /[;=]|=>|&&|\|\||\b(?:return|const|let|var|function|import|export|typeof|else|catch|finally|case)\b|\b(?:if|for|while|switch)\s*\(/;
/** Props that carry behaviour, styling or hover-only text rather than words on the page. */
const TECHNICAL_PROP = /^(?:className|class|style|sx|css|href|src|srcSet|id|key|ref|type|name|role|htmlFor|for|rel|target|variant|size|as|to|icon|color|fill|stroke|d|viewBox|xmlns|width|height|lang|charset|method|action|value|defaultValue|placeholder|alt|content|property|media|sizes|loading|decoding|crossOrigin|integrity|slot|mode|align|side|position|layout|format|locale|currency|pattern|accept|autoComplete|inputMode|tabIndex|data-[\w-]+|aria-[\w-]+|on[A-Z]\w*)$/;
const NOT_COPY_BEFORE = /(?:\b(?:cn|clsx|cx|cva|twMerge|classNames|querySelector(?:All)?|getElementById|addEventListener|removeEventListener|require|fetch|matchMedia|setAttribute|getAttribute|removeAttribute|getItem|setItem|removeItem|createElement|dispatchEvent|RegExp|Symbol|import|t|i18n\.t|console\.\w+)\s*\(\s*(?:[^()]*,\s*)?|\b(?:from|import|case)\s+|[=!]==?\s*|\b(?:className|class|variant|size|type|key|id|href|src|path|url|route|method|role|icon|color|mode|status|kind|align|side|as|to|ref|style|target|rel|lang|locale|format|pattern|easing|ease|transition|animation|display|position|ariaLabel|aria-?label|alt|placeholder|tooltip|testId)\s*[:=]\s*\{?\s*|\bclassList\.\w+\(\s*(?:[^()]*,\s*)?)$/;
const ENTITIES = /&(?:mdash|#8212|#x2014|ndash|#8211|nbsp|#160|amp|quot|#39|apos|rsquo|lsquo|rdquo|ldquo|hellip);|\\u(?:2014|2013|00a0|2019|201[cd])|\\u\{2014\}/gi;
/** @type {Readonly<Record<string, string>>} */
const ENTITY_TEXT = Object.freeze({
  '&mdash;': '—', '&#8212;': '—', '&#x2014;': '—', '\\u2014': '—', '\\u{2014}': '—',
  '&ndash;': '–', '&#8211;': '–', '\\u2013': '–', '&nbsp;': ' ', '&#160;': ' ', '\\u00a0': ' ',
  '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&rsquo;': '’', '&lsquo;': '‘',
  '\\u2019': '’', '&rdquo;': '”', '&ldquo;': '“', '\\u201c': '“', '\\u201d': '”',
  '&hellip;': '…',
});

/**
 * The words a reader sees, approximated from source (FD14-F06): JSX and HTML text nodes, text between JSX
 * expressions, string literals that read as copy (not class lists, keys, routes or DOM attributes), and CSS content
 * strings. Page titles (<title>, og:title and twitter:title, Next.js metadata, document.title, *TITLE* constants)
 * are flagged; text inside <blockquote>, <q> and <cite> is flagged as quoted. HTML pages declaring another language
 * are skipped, as are config files.
 * @param {SourceFile} file
 * @returns {CopySegment[]}
 */
function copySegments(file) {
  const code = file.code;
  if (file.kind === 'json' || /(?:^|\/)[\w.-]+\.config\.[cm]?[jt]s$/.test(file.path)) return [];
  if (/<html\b[^>]*\blang\s*=\s*['"](?!en\b|en-)[a-z]/i.test(code)) return [];
  /** @type {CopySegment[]} */
  const out = [];
  const quotes = elementSpans(code, 'blockquote|q|cite').map((s) => [s.contentStart, s.contentEnd]);
  const titles = titleRanges(code);
  /** @param {string} raw @param {number} index @param {boolean} [title] */
  const add = (raw, index, title = false) => {
    const text = raw.replace(ENTITIES, (e) => ENTITY_TEXT[e.toLowerCase()] ?? e).replace(/\s+/g, ' ').trim();
    if (!looksLikeCopy(text)) return;
    const inTitle = title || titles.some(([a, b]) => index >= a && index < b);
    const quoted = quotes.some(([a, b]) => index >= a && index < b) || /^[“"«].*[”"»]$/.test(text);
    out.push({ text, index, title: inTitle, quoted });
  };
  if (file.kind === 'css') {
    for (const m of code.matchAll(/\bcontent\s*:\s*(['"])(.*?)\1/g)) add(m[2], m.index);
    return out;
  }
  const markup = file.kind !== 'js' && file.kind !== 'ts';
  const masked = markup ? maskRawText(code) : '';
  if (markup) {
    for (const m of masked.matchAll(TEXT_NODE)) {
      add(m[1], m.index + 1, /<title\b[^>]*>$/i.test(masked.slice(Math.max(0, m.index - 40), m.index + 1)));
    }
    if (file.kind !== 'html') {
      for (const m of masked.matchAll(BRACED_TEXT)) {
        if (m[1] === '>' && masked[m.index + m[0].length] === '<') continue;
        const text = m[2].trim();
        if (text.split(/\s+/).length >= 3 && !CODE_LIKE.test(text)) add(text, m.index + 1);
      }
    }
    for (const m of code.matchAll(/<meta\b[^>]*>/gi)) {
      if (!/\b(?:property|name)\s*=\s*['"](?:og|twitter):title['"]/i.test(m[0])) continue;
      const content = /\bcontent\s*=\s*(['"])(.*?)\1/i.exec(m[0]);
      if (content) add(content[2], m.index, true);
    }
  }
  const scripts = file.kind === 'html' ? scriptRanges(code) : [[0, code.length]];
  for (const m of code.matchAll(COPY_LITERAL)) {
    if (!scripts.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const before = code.slice(Math.max(0, m.index - 60), m.index);
    if (NOT_COPY_BEFORE.test(before)) continue;
    if (markup && JSX_TEXT_BEFORE.test(code.slice(Math.max(0, m.index - 2000), m.index))) continue;
    if (/[{,]\s*$/.test(before) && /^\s*:/.test(code.slice(m.index + m[0].length, m.index + m[0].length + 8))) continue;
    const attribute = /\b([\w:@.-]+)\s*=\s*\{?\s*$/.exec(before);
    if (attribute) {
      const tag = tagAt(code, m.index);
      if (tag && (/^[a-z]/.test(tag.name) || TECHNICAL_PROP.test(attribute[1]))) continue;
    }
    let body = m[1] ?? m[2] ?? m[3] ?? '';
    if (m[3] !== undefined) body = body.replace(/\$\{[^{}]*\}/g, ' ');
    if (/<[a-z][^<>]*>/i.test(body)) {
      for (const piece of body.split(/<[^<>]*>/)) add(piece, m.index + 1);
    } else if (!/\b(?:d|viewBox|transform|stroke|fill)=/.test(body) && !/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/.test(body)) {
      add(body, m.index + 1);
    }
  }
  return out;
}

/**
 * True when a string reads as words, not as a class list, a path, a key or code (FD14's extraction rule).
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeCopy(text) {
  if (!text) return false;
  if (!/\p{L}{2}/u.test(text)) return /^[—– ]+$/.test(text);
  if (/^(?:https?:|mailto:|tel:|\/|\.\.?\/|@|#|data:|var\(|--)/.test(text)) return false;
  if (/\b(?:import|from|require)\b/.test(text) && text.includes(';')) return false;
  const words = text.split(' ');
  if (words.length === 1) return /^\p{Lu}\p{Ll}{2,}[.!?]?$/u.test(text);
  const classy = words.filter((w) => /[-:/[\]]|^\d/.test(w) && !/^\p{L}+-\p{Ll}+[.,]?$/u.test(w)).length / words.length;
  if (classy > 0.5) return false;
  return !(/\b(?:flex|grid|px-|py-|text-|bg-|rounded|border|items-|justify-|w-|h-)/.test(text) && classy > 0.3);
}

/**
 * The source ranges holding page titles: Next.js metadata objects and generateMetadata, document.title
 * assignments and *TITLE* constants. (<title> text and og:title meta tags are told apart where they are read.)
 * @param {string} code
 * @returns {Array<[number, number]>}
 */
function titleRanges(code) {
  /** @type {Array<[number, number]>} */
  const out = [];
  for (const m of code.matchAll(/\b(?:metadata\s*(?::\s*[\w.<>]+\s*)?=|generateMetadata\s*\([^)]*\)[^{]*)\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = closing(code, open);
    if (close > open) out.push([open, close]);
  }
  for (const m of code.matchAll(/\b(?:document\.title\s*=|[A-Z][A-Z0-9_]*TITLE[A-Z0-9_]*\s*[:=])\s*/g)) {
    out.push([m.index, m.index + m[0].length + 400]);
  }
  return out;
}

/**
 * The code with the content of <script> and <style> elements blanked (same length), so text nodes are only page
 * text.
 * @param {string} code
 * @returns {string}
 */
function maskRawText(code) {
  return code.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (all, open, name, body, close) =>
    open + body.replace(/[^\n]/g, ' ') + close);
}

/**
 * The ranges of <script> element content in an HTML page.
 * @param {string} code
 * @returns {Array<[number, number]>}
 */
function scriptRanges(code) {
  /** @type {Array<[number, number]>} */
  const out = [];
  for (const m of code.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const start = m.index + m[0].indexOf('>') + 1;
    out.push([start, start + m[1].length]);
  }
  return out;
}
// ─── end shared:copy ───
