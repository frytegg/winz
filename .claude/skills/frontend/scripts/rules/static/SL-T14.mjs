// @ts-check
import path from 'node:path';
import { lineOf } from '../../lib/text.mjs';

/**
 * SL-T14 static: buttons that only fade on hover. On a button, a link styled as one, or a variant of a button
 * component (library primitives included, FD14-F13), every hover change lowers opacity below 100 or the alpha of
 * the button's own fill (bg-primary to hover:bg-primary/90, shadcn's default; FD10-F08, FD03-F21). CSS: a :hover
 * rule on a button-like selector whose only visible change is opacity below 1. Not counted (FD14-F13, FD03-F21):
 * opacity that rises on hover, a ghost button gaining a translucent background, hovers that also change colour,
 * shadow or position, components and stylesheets no page loads, unused CSS classes, comments.
 *
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-T14';
const BUTTONISH_TAG = /^(?:button|a|Link|NavLink|NextLink|RouterLink|Button|IconButton|Anchor|motion\.button|motion\.a)$/;
const BUTTON_FILE = /(?:^|\/)[\w-]*button[\w-]*\.[cm]?[jt]sx?$/i;
const BUTTON_CLASS = /(?:^|\s)(?:btn|button|cta)(?:$|[\s_-])/i;
const HOVER = /^(?:hover|group-hover)$/;
const FILL = /^(bg|from|via|to)-(.+?)(?:\/(\d{1,3}|\[[\d.]+\]))?$/;
const BUTTONISH_SELECTOR = /(?:^|[\s,>+~(])(?:button|a)\b|\.(?:btn|button|cta|link)[\w-]*|\[role=['"]?button/i;
const HOVER_OPACITY = /(?:^|[;{\s])opacity\s*:\s*(0?\.\d+|[1-9]\d?%)/;
const OTHER_HOVER_CHANGE = /(?:^|[;{\s])(?:background(?:-color|-image)?|color|transform|translate|scale|box-shadow|filter|border(?:-color)?|outline|text-decoration)\s*:/;

/**
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  const files = shippedFiles(ctx, { library: true });
  const mounted = mountedFiles(files);
  const used = usedClassTokens(files);
  /** @type {StaticFinding[]} */
  const out = [];
  for (const file of files) {
    if (mounted && !mounted.has(file.path)) continue;
    for (const context of classContexts(file)) {
      const fade = hoverFade(context.text);
      if (!fade || !isButtonish(file, context)) continue;
      out.push(finding(file, context.index, fade, 'the hover only fades the button (opacity or fill alpha)'));
    }
    for (const block of declarationBlocks(file.code)) {
      if (!/:hover\b/.test(block.selector) || !BUTTONISH_SELECTOR.test(block.selector)) continue;
      const m = HOVER_OPACITY.exec(block.body);
      if (!m || OTHER_HOVER_CHANGE.test(block.body) || deadSelector(block.selector.replace(/:hover\b/g, ''), file, used)) continue;
      out.push(finding(file, block.index + m.index, `opacity: ${m[1]}`, `${block.selector} only lowers opacity on hover`));
    }
  }
  return unique(out);
}

/**
 * The hover utilities of a class list when every one of them is a fade: opacity below 100, or the element's own
 * fill at a lower alpha. Null when nothing fades or something else changes too.
 * @param {string} text
 * @returns {string | null}
 */
function hoverFade(text) {
  const parsed = utilities(text);
  const hovers = parsed.filter((u) => u.variants.some((v) => HOVER.test(v)));
  if (hovers.length === 0) return null;
  const restFills = new Map();
  for (const u of parsed.filter(atRest)) {
    const m = FILL.exec(u.utility);
    if (m) restFills.set(`${m[1]}-${m[2]}`, m[3] === undefined ? 100 : alphaPercent(m[3]));
  }
  const fades = hovers.filter((u) => {
    const opacity = /^opacity-(\d{1,3})$/.exec(u.utility);
    if (opacity) return Number(opacity[1]) < 100;
    const fill = FILL.exec(u.utility);
    if (!fill || fill[3] === undefined) return false;
    const base = restFills.get(`${fill[1]}-${fill[2]}`);
    return base !== undefined && alphaPercent(fill[3]) < base;
  });
  const transitionOnly = (/** @type {{utility: string}} */ u) => /^(?:transition|duration|ease|delay)(?:-|$)/.test(u.utility);
  if (fades.length === 0 || hovers.some((u) => !fades.includes(u) && !transitionOnly(u))) return null;
  return fades.map((u) => u.token).join(' ');
}

/**
 * @param {string} modifier '90' or '[0.9]'
 * @returns {number} percent
 */
function alphaPercent(modifier) {
  return modifier.startsWith('[') ? Number(modifier.slice(1, -1)) * 100 : Number(modifier);
}

/**
 * True when a class list belongs to a button: a button or link element, a Button component, an element with
 * role="button" or a btn/button/cta class, or any class list of a button component's own file (its variants).
 * @param {SourceFile} file
 * @param {{text: string, index: number}} context
 * @returns {boolean}
 */
function isButtonish(file, context) {
  if (BUTTON_FILE.test(file.path) || BUTTON_CLASS.test(context.text)) return true;
  const tag = tagAt(file.code, context.index);
  if (!tag) return false;
  if (BUTTONISH_TAG.test(tag.name)) return true;
  const end = openTagEnd(file.code, tag.start);
  return end > 0 && /\brole\s*=\s*['"{]*button/.test(file.code.slice(tag.start, end));
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

// ─── shared:css ───
const STYLE_ATTRIBUTE = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
/** A comment inside one template literal: it never crosses a backtick, so a string such as "image/*" cannot open one. */
const CSS_COMMENT = /\/\*(?:(?!\*\/)[^`])*\*\//g;

/**
 * Every declaration block with the selector text before it and its scope (the selectors of the blocks around it,
 * then its own): CSS rules (a nested rule keeps only its own declarations), <style> blocks, CSS-in-JS, JSX style
 * objects (empty selector) and style="" attributes (selector "[style]"). CSS comments left in CSS-in-JS template
 * literals (string content to the JavaScript comment stripper) are blanked too: comments never count.
 * @param {string} source
 * @returns {Array<{selector: string, scope: string, body: string, index: number}>} index: offset of the body in code
 */
function declarationBlocks(source) {
  const code = source.replace(CSS_COMMENT, (m) => m.replace(/[^\n]/g, ' '));
  /** @type {Array<{selector: string, scope: string, body: string, index: number}>} */
  const out = [];
  /** @typedef {{open: number, selector: string, scope: string, children: Array<[number, number]>}} OpenBlock */
  /** @type {OpenBlock[]} */
  const stack = [];
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < code.length && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
      if (code[j] === c) i = j;
      continue;
    }
    if (c === '{') {
      const selector = selectorBefore(code, i);
      const parent = stack.length > 0 ? stack[stack.length - 1].scope : '';
      stack.push({ open: i, selector, scope: parent && selector ? `${parent} ${selector}` : parent || selector, children: [] });
    } else if (c === '}' && stack.length > 0) {
      const block = /** @type {OpenBlock} */ (stack.pop());
      let body = code.slice(block.open + 1, i);
      for (const [a, b] of block.children) {
        body = body.slice(0, a - block.open - 1) + ' '.repeat(b - a + 1) + body.slice(b - block.open);
      }
      out.push({ selector: block.selector, scope: block.scope, body, index: block.open + 1 });
      if (stack.length > 0) stack[stack.length - 1].children.push([block.open, i]);
    }
  }
  for (const m of code.matchAll(STYLE_ATTRIBUTE)) {
    const body = m[1] ?? m[2] ?? '';
    out.push({ selector: '[style]', scope: '[style]', body, index: m.index + m[0].indexOf(body) });
  }
  return out;
}

/**
 * @param {string} code
 * @param {number} open index of '{'
 * @returns {string}
 */
function selectorBefore(code, open) {
  let s = open - 1;
  while (s >= 0 && open - s < 2000 && code[s] !== '{' && code[s] !== '}' && code[s] !== ';') s -= 1;
  return code.slice(s + 1, open).replace(/\s+/g, ' ').trim();
}
// ─── end shared:css ───

// ─── shared:usage ───
const CSS_SELECTOR_START = /^(?:[.#:[*&]|[a-z][a-z0-9-]*(?:$|[\s.:#[,>+~]))/i;
/** @type {WeakMap<Set<string>, string[]>} */
const PREFIXES = new WeakMap();
const TAILWIND_ROOT = /^(?:text|bg|border|from|via|to|size|w|h|min-w|min-h|max-w|max-h|p[xytrblse]?|m[xytrblse]?|gap|rounded|shadow|ring|fill|stroke|font|leading|tracking|opacity|z|top|left|right|bottom|inset|translate-[xy]|scale|rotate|duration|delay|ease|grid-cols|col-span|row-span|order|basis|flex|outline|decoration|underline-offset|space-[xy])-$/;

/**
 * Every class token the project uses: class attributes, string literals (HTML written inside template literals
 * included), @apply, Svelte class: directives. A class built in a template literal (`verdict-${kind}`) is kept as its
 * prefix followed by '*', unless the prefix is a bare Tailwind root (text-, bg-), too broad to vouch for a class.
 * @param {SourceFile[]} files
 * @returns {Set<string>}
 */
function usedClassTokens(files) {
  /** @type {Set<string>} */
  const used = new Set();
  for (const f of files) {
    for (const context of classContexts(f)) {
      for (const token of context.text.replace(/["'`<>=]/g, ' ').split(/\s+/)) {
        const dynamic = /^([a-z][\w-]*-)\$\{/i.exec(token);
        if (dynamic && !TAILWIND_ROOT.test(dynamic[1])) used.add(`${dynamic[1]}*`);
        else if (token && !token.includes('*')) used.add(utilities(token)[0]?.utility ?? token);
      }
    }
    if (f.kind === 'svelte') for (const m of f.code.matchAll(/\bclass:([\w-]+)/g)) used.add(m[1]);
  }
  return used;
}

/**
 * True when no element can match a CSS selector because the classes of its subject (the last compound of each
 * selector in the list) are used nowhere in the project: a dead definition, which never renders (FD14-F22). CSS
 * modules are read as object properties, so they are never judged dead, nor is anything that is not a CSS selector.
 * @param {string} selector
 * @param {SourceFile} file
 * @param {Set<string>} used
 * @returns {boolean}
 */
function deadSelector(selector, file, used) {
  if (/\.module\.s?css$/i.test(file.path) || !CSS_SELECTOR_START.test(selector)) return false;
  if (/[=;]|\b(?:return|if|const|let|function)\b/.test(selector.replace(/\[[^\]]*\]/g, ''))) return false;
  let prefixes = PREFIXES.get(used);
  if (!prefixes) {
    prefixes = [...used].filter((t) => t.endsWith('*')).map((t) => t.slice(0, -1));
    PREFIXES.set(used, prefixes);
  }
  const known = prefixes;
  /** @param {string} c */
  const isUsed = (c) => used.has(c) || known.some((p) => c.startsWith(p));
  return selector.split(',').every((item) => {
    const compounds = item.trim().split(/\s*[\s>+~]\s*/).filter(Boolean);
    const subject = compounds[compounds.length - 1] ?? '';
    const classes = [...subject.matchAll(/\.((?:[\w-]|\\.)+)/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
    return classes.length > 0 && classes.some((c) => !isUsed(c));
  });
}
// ─── end shared:usage ───

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

// ─── shared:mounts ───
const IMPORT_FROM = /\bimport\s+(?:type\s+)?([^'";]*?)\s*\bfrom\s*['"]([^'"]+)['"]/g;
const IMPORT_BARE = /\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g;
const REEXPORT = /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g;
const REQUIRE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const CSS_IMPORT = /@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)/g;
const HTML_REFERENCE = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g;
/** Pages and roots a framework renders on its own: HTML pages, Next.js app and pages routes, Vite and CRA entries, SvelteKit, Remix and Nuxt routes. */
const ENTRY = /(?:^|\/)[^/]+\.html?$|(?:^|\/)app\/(?:.+\/)?(?:page|layout|template|loading|error|global-error|not-found|default)\.[cm]?[jt]sx?$|(?:^|\/)pages\/.+\.(?:[cm]?[jt]sx?|vue|svelte)$|(?:^|\/)src\/(?:main|index)\.[cm]?[jt]sx?$|(?:^|\/)\+(?:page|layout)\.svelte$|(?:^|\/)app\/(?:root|entry\.client)\.[jt]sx?$|(?:^|\/)app\/routes\/.+\.[jt]sx?$|(?:^|\/)app\.vue$/;
const RESOLVE_SUFFIXES = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.vue', '.svelte', '.css', '.scss', '/index.tsx', '/index.ts', '/index.jsx', '/index.js', '/index.mjs'];

/**
 * The files a page can render: everything reachable from an entry through imports whose bindings are used (FD14:
 * count only mounted components; a vendored effect nobody imports never renders). Null when the project has no
 * recognisable entry, so callers treat every file as mounted instead of guessing.
 * @param {SourceFile[]} files
 * @returns {Set<string> | null}
 */
function mountedFiles(files) {
  const paths = new Set(files.map((f) => f.path));
  const entries = files.filter((f) => ENTRY.test(f.path)).map((f) => f.path);
  if (entries.length === 0) return null;
  /** @type {Map<string, string[]>} */
  const edges = new Map(files.map((f) => [f.path, importsOf(f, paths)]));
  const seen = new Set(entries);
  const queue = [...entries];
  while (queue.length > 0) {
    for (const to of edges.get(/** @type {string} */ (queue.pop())) ?? []) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return seen;
}

/**
 * The project files one file loads: imports whose bindings it uses, side-effect and dynamic imports, re-exports,
 * require(), CSS import rules and HTML script and stylesheet references.
 * @param {SourceFile} file
 * @param {Set<string>} paths
 * @returns {string[]}
 */
function importsOf(file, paths) {
  const code = file.code;
  /** @type {string[]} */
  const out = [];
  /** @param {string} specifier */
  const add = (specifier) => {
    const hit = resolveSpecifier(file.path, specifier, paths);
    if (hit) out.push(hit);
  };
  for (const m of code.matchAll(IMPORT_FROM)) {
    const names = localNames(m[1]);
    const rest = code.slice(0, m.index) + code.slice(m.index + m[0].length);
    const used = names.some((name) => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(rest));
    if (names.length === 0 || used) add(m[2]);
  }
  for (const pattern of [IMPORT_BARE, REEXPORT, REQUIRE]) for (const m of code.matchAll(pattern)) add(m[1]);
  if (file.kind === 'css') for (const m of code.matchAll(CSS_IMPORT)) add(m[1]);
  if (file.kind === 'html') for (const m of code.matchAll(HTML_REFERENCE)) add(m[1]);
  return out;
}

/**
 * The local names an import clause binds: 'X, { a, b as c }' gives X, a and c; '* as ns' gives ns.
 * @param {string} clause
 * @returns {string[]}
 */
function localNames(clause) {
  /** @type {string[]} */
  const names = [];
  const braces = /\{([^}]*)\}/.exec(clause);
  if (braces) {
    for (const spec of braces[1].split(',')) {
      const parts = spec.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
      const name = (parts[1] ?? parts[0]).trim();
      if (/^[\w$]+$/.test(name)) names.push(name);
    }
  }
  const outside = clause.replace(/\{[^}]*\}/, ' ');
  const namespace = /\*\s*as\s+([\w$]+)/.exec(outside);
  if (namespace) names.push(namespace[1]);
  const fallback = /^\s*([\w$]+)\s*(?:,|$)/.exec(outside.replace(/\*\s*as\s+[\w$]+/, ''));
  if (fallback) names.push(fallback[1]);
  return names;
}

/**
 * A project path for an import specifier: relative, root-absolute ('/src/main.tsx'), alias ('@/x', '~/x', '~~/x',
 * '#/x') or a baseUrl path, tried against the folders above the importing file and their src/ folders; null for
 * packages.
 * @param {string} from
 * @param {string} specifier
 * @param {Set<string>} paths
 * @returns {string | null}
 */
function resolveSpecifier(from, specifier, paths) {
  const clean = specifier.split(/[?#]/)[0];
  /** @param {string} base @returns {string | null} */
  const attempt = (base) => {
    for (const suffix of RESOLVE_SUFFIXES) if (paths.has(base + suffix)) return base + suffix;
    return null;
  };
  if (clean.startsWith('.')) return attempt(path.posix.join(path.posix.dirname(from), clean));
  if (clean.startsWith('/')) return attempt(clean.slice(1));
  const rest = clean.replace(/^(?:@|~~?|#)\//, '');
  for (let dir = path.posix.dirname(from); ; dir = path.posix.dirname(dir)) {
    const prefix = dir === '.' ? '' : `${dir}/`;
    const hit = attempt(`${prefix}${rest}`) ?? attempt(`${prefix}src/${rest}`);
    if (hit || dir === '.') return hit;
  }
}
// ─── end shared:mounts ───
