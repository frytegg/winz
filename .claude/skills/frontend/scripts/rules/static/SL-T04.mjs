// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * SL-T04 static: Inter everywhere. Fires where Inter (or Inter Tight) is applied as a text family while no other
 * chosen family is applied anywhere in the project, monospace and system faces aside: the "only typeface" reading
 * of FD14-F25, since human-designed controls load Inter too. Applied means a font-family declaration, a Tailwind
 * --font-sans token or fontFamily entry, a font-[...] utility or a next/font Inter whose className or variable is
 * used (create-next-app's root layout from v13.4.0 to v14.2.7, FD10-F06). Not counted (FD14-F26, F17): a font
 * that is only requested (Google Fonts URL, @fontsource), rules inside Figma Make's guard selector, Inter in a
 * fallback position, @font-face declarations and comments.
 *
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-T04';
const INTER = /^inter(?: var| variable| tight| display)?$/;

/**
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  const files = shippedFiles(ctx);
  const applied = fontApplications(files, customProperties(files));
  const inter = applied.filter((a) => INTER.test(a.family));
  const others = new Set(applied.map((a) => a.family).filter((f) => !INTER.test(f) && !SYSTEM_FAMILIES.has(f) && !MONOSPACE.test(f)));
  if (inter.length === 0 || others.size > 0) return [];
  return unique(inter.map((a) => finding(a.file, a.index, a.family, `Inter applied (${a.how}) and no other text family is applied`)));
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

// ─── shared:properties ───
const CUSTOM_PROPERTY = /(--[\w-]+)\s*:\s*([^;{}]+)/g;

/**
 * The first value of every CSS custom property declared in these files (a :root value wins over a later .dark one).
 * @param {SourceFile[]} files
 * @returns {Map<string, string>}
 */
function customProperties(files) {
  /** @type {Map<string, string>} */
  const vars = new Map();
  for (const f of files) {
    for (const block of declarationBlocks(f.code)) {
      for (const m of block.body.matchAll(CUSTOM_PROPERTY)) if (!vars.has(m[1])) vars.set(m[1], m[2].trim());
    }
  }
  return vars;
}
// ─── end shared:properties ───

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

// ─── shared:fonts ───
/**
 * @typedef {{file: SourceFile, index: number, family: string, how: string}} FontUse
 */
/** Figma Make's base-typography guard fails on any page with spaced text- utilities, so its rules never apply (FD14-F26). */
const FIGMA_GUARD = /:where\(\s*:not\(\s*:has\(\s*\[class\*=/;
const FONT_FAMILY = /(?:^|[;{\s])font-family\s*:\s*([^;}]+)|\bfontFamily\s*:\s*(['"`])((?:(?!\2)[^\n])+)\2/g;
const FONT_TOKEN = /(--(?:font-[\w-]+|default-font-family))\s*:\s*([^;{}]+)/g;
const NOT_A_FAMILY_TOKEN = /^--font-(?:weight|size|feature|variation|style|stretch|smoothing|optical|synthesis|kerning|display-swap)/;
const NEXT_FONT_IMPORT = /\bimport\s*\{([^}]*)\}\s*from\s*['"]next\/font\/google['"]/g;
/** System and generic families: present by default, never a typeface someone chose for the brand. */
const SYSTEM_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace',
  'ui-rounded', 'math', 'emoji', 'fangsong', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica',
  'helvetica neue', 'arial', 'noto sans', 'ubuntu', 'cantarell', 'oxygen', 'inherit', 'initial', 'unset', 'revert',
]);
const MONOSPACE = /mono|code|courier|consolas|menlo/;

/**
 * Where the project applies a font family, with the first family lower-cased: font-family declarations (not
 * @font-face, not inside Figma Make's guard), --font-* tokens that are applied (--font-sans, which Tailwind v4
 * sets on html, or one referenced by var() or a font-* utility), Tailwind v3 fontFamily entries in use,
 * font-[...] utilities, and next/font/google bindings whose className, variable or style is used. A font that is
 * only requested (a Google Fonts URL, an @fontsource import) is not applied.
 * @param {SourceFile[]} files
 * @param {Map<string, string>} vars
 * @returns {FontUse[]}
 */
function fontApplications(files, vars) {
  /** @type {FontUse[]} */
  const out = [];
  const used = usedClassTokens(files);
  const allCode = files.map((f) => f.code).join('\n');
  /** @param {SourceFile} file @param {number} index @param {string} list @param {string} how */
  const add = (file, index, list, how) => {
    const family = firstFamily(list, vars);
    if (/^[a-z]/.test(family)) out.push({ file, index, family, how });
  };
  for (const file of files) {
    for (const block of declarationBlocks(file.code)) {
      if (/^@font-face\b/i.test(block.selector) || FIGMA_GUARD.test(block.scope)) continue;
      const where = block.selector ? `font-family of ${block.selector}` : 'font-family of an inline style';
      for (const m of block.body.matchAll(FONT_FAMILY)) add(file, block.index + m.index, m[1] ?? m[3] ?? '', where);
      for (const m of block.body.matchAll(FONT_TOKEN)) {
        const token = m[1];
        if (NOT_A_FAMILY_TOKEN.test(token) || MONOSPACE.test(token)) continue;
        const applied = token === '--font-sans' || token === '--default-font-family' ||
          allCode.includes(`var(${token})`) || used.has(`font-${token.slice('--font-'.length)}`);
        if (applied) add(file, block.index + m.index, m[2], `${token} token`);
      }
    }
    if (/(?:^|\/)tailwind\.config\.[cm]?[jt]s$/.test(file.path)) {
      for (const m of file.code.matchAll(/\bfontFamily\s*:\s*\{/g)) {
        const open = m.index + m[0].length - 1;
        const close = closing(file.code, open);
        if (close < 0) continue;
        for (const e of file.code.slice(open + 1, close).matchAll(/['"]?([\w-]+)['"]?\s*:\s*\[\s*(['"`])((?:(?!\2)[^\n])+)\2/g)) {
          if ((e[1] === 'sans' || used.has(`font-${e[1]}`)) && !MONOSPACE.test(e[1])) {
            add(file, open + 1 + e.index, e[3], `Tailwind fontFamily.${e[1]}`);
          }
        }
      }
    }
    for (const context of classContexts(file)) {
      for (const u of utilities(context.text)) {
        const m = /^font-\[(?:family-name:)?([^\]]+)\]$/.exec(u.utility) ?? /^font-\((?:family-name:)?(--[\w-]+)\)$/.exec(u.utility);
        if (m) add(file, context.index, m[1].startsWith('--') ? `var(${m[1]})` : m[1].replace(/_/g, ' '), `${u.utility} utility`);
      }
    }
    for (const m of file.code.matchAll(NEXT_FONT_IMPORT)) {
      for (const spec of m[1].split(',')) {
        const [imported, local = imported] = spec.trim().split(/\s+as\s+/).map((s) => s.trim());
        if (!/^[\w$]+$/.test(local)) continue;
        for (const call of file.code.matchAll(new RegExp(`\\b(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*${local.replace(/\$/g, '\\$')}\\s*\\(`, 'g'))) {
          if (new RegExp(`\\b${call[1].replace(/\$/g, '\\$')}\\.(?:className|variable|style)\\b`).test(allCode)) {
            add(file, call.index, imported.replace(/_/g, ' '), `next/font ${imported} applied`);
          }
        }
      }
    }
  }
  return out;
}

/**
 * The first family of a font-family list, lower case and unquoted ('"Inter", sans-serif' gives 'inter'), a leading
 * var() resolved through custom properties.
 * @param {string} list
 * @param {Map<string, string>} vars
 * @param {number} [depth]
 * @returns {string}
 */
function firstFamily(list, vars, depth = 0) {
  const text = list.replace(/!important/i, '').trim();
  if (text.startsWith('var(')) {
    const close = closing(text, 3);
    const inner = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/.exec(close > 0 ? text.slice(0, close + 1) : text);
    const next = inner ? vars.get(inner[1]) ?? inner[2] : undefined;
    return next && depth < 5 ? firstFamily(next, vars, depth + 1) : '';
  }
  return text.split(',')[0].trim().replace(/^['"]|['"]$/g, '').trim().toLowerCase();
}
// ─── end shared:fonts ───
