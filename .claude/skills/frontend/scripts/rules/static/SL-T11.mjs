// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * SL-T11 static: untouched shadcn/ui. Two signals, values rather than presence (FD14-F05: a rethemed shadcn is not
 * the tell): a theme block whose shadcn tokens mostly keep the registry defaults (three or more, at least half),
 * named with the key ones (--radius 0.625rem, --primary oklch(0.205 0 0), a dark --background oklch(0.145 0 0)) and
 * flagged dead when nothing applies the dark class; and the registry's default Button variant string
 * (bg-primary text-primary-foreground hover:bg-primary/90, or /80 in nova; FD10-F08), only while every theme's
 * --primary is still a registry default or a generator palette primary (a rethemed primary makes the same string a
 * themed button, FD14-F05 and F23 T11 FP). Default values span shadcn
 * versions (FD14-F05): the chroma-0 neutral family, the CLI's greyscale chart tokens, the docs palette's indigo and
 * purple (FD16-F23), and the v3 HSL backgrounds FD14 matched. Registry-identical component files would need the
 * registry's copies to hash against, which this offline check does not have.
 *
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-T11';
const SHADCN_TOKEN = /^--(?:background|foreground|card(?:-foreground)?|popover(?:-foreground)?|primary(?:-foreground)?|secondary(?:-foreground)?|muted(?:-foreground)?|accent(?:-foreground)?|destructive(?:-foreground)?|border|input|ring|radius|chart-[1-5]|sidebar(?:-[\w-]+)?)$/;
const DEFAULT_VALUE = /^(?:oklch\((?:0\.145|0\.205|0\.269|0\.371|0\.439|0\.556|0\.708|0\.87|0\.922|0\.97|0\.985|1) 0 0(?: \/ [\d.]+%?)?\)|oklch\(0\.488 0\.243 264\.376\)|oklch\(0\.646 0\.222 41\.116\)|oklch\(0\.627 0\.265 303\.9\)|222\.2 84% 4\.9%|240 10% 3\.9%|0 0% 3\.9%|0\.625rem)$/;
const THEME_SELECTOR = /^(?::root|\.dark|html|:host|@theme(?: inline)?|\[data-theme[^\]]*\]|\.light)$/;
const DARK_APPLIED = /classList\.(?:add|toggle)\(\s*['"]dark|class(?:Name)?\s*=\s*\{?\s*['"`][^'"`]*\bdark\b|next-themes|\bsetTheme\b|\bThemeProvider\b|\bdarkMode\s*:\s*['"]class/;
const DEFAULT_BUTTON = /^hover:bg-primary\/(?:90|80)$/;
const MIN_DEFAULTS = 3;

/**
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  const all = shippedFiles(ctx, { library: true });
  const darkApplied = all.some((f) => f.kind !== 'css' && DARK_APPLIED.test(f.code));
  const primaryDefault = primaryIsDefault(all);
  /** @type {StaticFinding[]} */
  const out = [];
  for (const file of all) {
    for (const block of declarationBlocks(file.code)) {
      if (!THEME_SELECTOR.test(block.selector)) continue;
      const tokens = [...block.body.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)].filter((m) => SHADCN_TOKEN.test(m[1]));
      const defaults = tokens.filter((m) => DEFAULT_VALUE.test(m[2].trim()));
      if (defaults.length < MIN_DEFAULTS || defaults.length / tokens.length < 0.5) continue;
      const key = defaults.map((m) => `${m[1]}: ${m[2].trim()}`).filter((d) => /^--(?:radius|primary|background):/.test(d));
      const dead = block.selector === '.dark' && !darkApplied ? '; this .dark block is never applied (nothing sets the dark class)' : '';
      const named = key.length > 0 ? ` (${key.join(', ')})` : '';
      out.push(finding(file, block.index + /** @type {number} */ (defaults[0].index), `${defaults.length} of ${tokens.length}`,
        `${block.selector} keeps ${defaults.length} of its ${tokens.length} shadcn tokens at the registry defaults${named}${dead}`));
    }
    for (const context of primaryDefault ? classContexts(file) : []) {
      const names = utilities(context.text).map((u) => u.token);
      const hover = names.find((n) => DEFAULT_BUTTON.test(n));
      if (hover && names.includes('bg-primary') && names.includes('text-primary-foreground')) {
        out.push(finding(file, context.index, `bg-primary text-primary-foreground ${hover}`, `shadcn's default Button variant left as installed (${hover})`));
      }
      if (/(?:^|\s)cn-button-variant-default(?:\s|$)/.test(context.text)) {
        out.push(finding(file, context.index, 'cn-button-variant-default', "shadcn's default nova Button variant class"));
      }
    }
  }
  return unique(out);
}

/**
 * Generator palette primaries: Tailwind's blue, indigo, violet and purple 500 and 600, the stock primaries of the
 * exports FD14-F07 read (SUI #3b82f6 from Figma Make, BaseBatches #8b5cf6). A brand colour is anything else.
 */
const GENERATOR_PRIMARY = /^#(?:3b82f6|2563eb|6366f1|4f46e5|8b5cf6|7c3aed|a855f7|9333ea)$/i;

/**
 * True when the theme still paints --primary with a registry default or a generator palette primary in every theme
 * block that sets it (light and dark), after following var() references: only then is the installed Button variant
 * the untouched look. A project that declares no --primary, or rethemes it (XRPL's `--primary: var(--amber)`, gold
 * #C9A45F; its radix-nova primitive keeps hover:bg-primary/80 and FD14-F03 rates T11 not a hit), is judged by its
 * theme blocks alone (FD14-F05).
 * @param {SourceFile[]} files
 * @returns {boolean}
 */
function primaryIsDefault(files) {
  /** @type {Map<string, string>} */
  const props = new Map();
  /** @type {string[]} */
  const values = [];
  for (const file of files) {
    for (const block of declarationBlocks(file.code)) {
      for (const m of block.body.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) if (!props.has(m[1])) props.set(m[1], m[2].trim());
      if (!THEME_SELECTOR.test(block.selector)) continue;
      for (const m of block.body.matchAll(/(?:^|[;{\s])--(?:color-)?primary\s*:\s*([^;{}]+)/g)) values.push(m[1].trim());
    }
  }
  /** @param {string} value @returns {string} */
  const resolve = (value) => {
    let v = value;
    for (let depth = 0; depth < 5; depth += 1) {
      const ref = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(v);
      const next = ref ? props.get(ref[1]) : undefined;
      if (next === undefined || next === v) break;
      v = next;
    }
    return v;
  };
  const resolved = values.map(resolve).filter((v) => !/^var\(/.test(v));
  return resolved.length > 0 && resolved.every((v) => DEFAULT_VALUE.test(v) || GENERATOR_PRIMARY.test(v));
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
