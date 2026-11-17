// @ts-check
import path from 'node:path';
import { lineOf } from '../../lib/text.mjs';

/**
 * SL-T12 static: fade-in on scroll. Scroll-triggered reveal mechanisms (FD10 S12, FD14-F23, FD03-F19): Motion's
 * whileInView, useInView, an IntersectionObserver that reveals (the file toggles opacity, visibility or an
 * animation), AOS, GSAP ScrollTrigger, CSS scroll-driven animations, Magic UI's TextAnimate left at its in-view
 * default, and tw-animate fade-ins switched on by an in-view flag. Not counted (FD14-F12, F23): components no page
 * renders (8 of ETHDenver's 16 vendored effects), TextAnimate with startOnView={false}, and the vendored
 * component's own prop-gated whileInView when every mount turns that prop off, data-state overlay animations of
 * library primitives, on-mount entrances, infinite-scroll observers, comments.
 *
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-T12';
/** A file whose observer reveals content rather than loading more of it. */
const REVEALS = /\bopacity\b|\breveal|\bfade|\banimat|\bin-?view\b|\bisVisible\b|\bsetVisible\b|\bvisible\b|classList\.(?:add|toggle)\(\s*['"](?:show|shown|in|active|revealed|appear)/i;
/** @type {ReadonlyArray<[RegExp, string, boolean]>} pattern, detail, needs a revealing file */
const SIGNATURES = Object.freeze([
  [/\bwhileInView\s*=/g, 'Motion whileInView reveal', false],
  [/\bwhileInView\s*:/g, 'Motion whileInView reveal', false],
  [/\buseInView\s*\(/g, 'useInView reveal hook', true],
  [/\bnew\s+IntersectionObserver\s*\(/g, 'IntersectionObserver reveal', true],
  [/\bdata-aos\s*=/g, 'AOS data-aos reveal', false],
  [/\bAOS\.init\s*\(/g, 'AOS scroll reveals initialised', false],
  [/\bscrollTrigger\s*:|\bScrollTrigger\.create\s*\(/g, 'GSAP ScrollTrigger', false],
  [/\banimation-timeline\s*:\s*(?:view|scroll)\(|\banimationTimeline\s*:\s*['"`](?:view|scroll)\(/g, 'CSS scroll-driven animation', false],
]);
const TEXT_ANIMATE = /<TextAnimate(?=[\s>/])/g;
const IN_VIEW_FLAG = /\b(?:inView|isInView|isVisible|visible|shown|revealed)\s*(?:\?|&&)/;

/**
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  const files = shippedFiles(ctx);
  const mounted = mountedFiles(files);
  /** @type {StaticFinding[]} */
  const out = [];
  for (const file of files) {
    if (mounted && !mounted.has(file.path)) continue;
    const code = file.code;
    const reveals = REVEALS.test(code);
    const quoted = quotedRanges(file);
    for (const [pattern, detail, needsReveal] of SIGNATURES) {
      if (needsReveal && !reveals) continue;
      for (const m of code.matchAll(pattern)) {
        if (insideRanges(quoted, m.index) || disabledAtEveryMount(file, m.index + m[0].length, files, mounted)) continue;
        out.push(finding(file, m.index, m[0].trim(), detail));
      }
    }
    for (const m of code.matchAll(TEXT_ANIMATE)) {
      if (insideRanges(quoted, m.index)) continue;
      const end = openTagEnd(code, m.index);
      if (end > 0 && /\bstartOnView\s*=\s*\{\s*false\s*\}/.test(code.slice(m.index, end))) continue;
      out.push(finding(file, m.index, '<TextAnimate>', 'Magic UI TextAnimate animates in view by default'));
    }
    for (const context of classContexts(file)) {
      const rest = utilities(context.text).filter((u) => u.variants.length === 0).map((u) => u.utility);
      if (!rest.includes('animate-in') || !rest.some((u) => /^fade-in/.test(u))) continue;
      if (IN_VIEW_FLAG.test(code.slice(Math.max(0, context.index - 200), context.index))) {
        out.push(finding(file, context.index, 'animate-in fade-in', 'tw-animate fade-in switched on by an in-view flag'));
      }
    }
  }
  return unique(out);
}

/** A reveal gated by a boolean prop: whileInView={startOnView ? 'show' : undefined}. */
const GATED_BY_PROP = /^\s*\{\s*([A-Za-z_$][\w$]*)\s*\?/;
const EXPORTED_COMPONENT = /\bexport\s+(?:default\s+)?(?:const|let|function|class)\s+([A-Z][\w$]*)|\bexport\s*\{([^}]*)\}/g;

/**
 * True when the reveal at `after` (just past `whileInView=`) is gated by a prop of the component its file exports,
 * and every mount of that component in a mounted file sets the prop to false: Magic UI's TextAnimate with
 * startOnView={false} animates on mount, not on scroll (FD14-F12, inflexion hero.tsx). A component with no mount
 * found keeps its finding.
 * @param {SourceFile} file
 * @param {number} after
 * @param {SourceFile[]} files
 * @param {Set<string> | null} mounted
 * @returns {boolean}
 */
function disabledAtEveryMount(file, after, files, mounted) {
  const prop = GATED_BY_PROP.exec(file.code.slice(after, after + 80))?.[1];
  if (!prop) return false;
  /** @type {string[]} */
  const names = [];
  for (const m of file.code.matchAll(EXPORTED_COMPONENT)) {
    if (m[1]) names.push(m[1]);
    for (const part of (m[2] ?? '').split(',')) {
      const name = /([A-Z][\w$]*)\s*$/.exec(part.trim())?.[1];
      if (name) names.push(name);
    }
  }
  if (names.length === 0) return false;
  const tag = new RegExp(`<(?:${names.join('|')})(?=[\\s>/])`, 'g');
  const off = new RegExp(`\\b${prop.replace(/\$/g, '\\$')}\\s*=\\s*\\{\\s*false\\s*\\}`);
  let mounts = 0;
  for (const other of files) {
    if (other.path === file.path || (mounted && !mounted.has(other.path))) continue;
    for (const m of other.code.matchAll(tag)) {
      const end = openTagEnd(other.code, m.index);
      if (end < 0 || !off.test(other.code.slice(m.index, end))) return false;
      mounts += 1;
    }
  }
  return mounts > 0;
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

// ─── shared:quotes ───
const QUOTED = /"(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'/g;

/**
 * The ranges of single- and double-quoted string literals in a script file: JSX elements and kebab-case CSS never
 * live there (template literals, which hold CSS-in-JS and HTML templates, are left out).
 * @param {SourceFile} file
 * @returns {Array<[number, number]>}
 */
function quotedRanges(file) {
  if (file.kind !== 'js' && file.kind !== 'ts' && file.kind !== 'jsx' && file.kind !== 'tsx') return [];
  return [...file.code.matchAll(QUOTED)].map((m) => /** @type {[number, number]} */ ([m.index, m.index + m[0].length]));
}

/**
 * @param {Array<[number, number]>} ranges
 * @param {number} index
 * @returns {boolean}
 */
function insideRanges(ranges, index) {
  return ranges.some(([a, b]) => index > a && index < b);
}
// ─── end shared:quotes ───
