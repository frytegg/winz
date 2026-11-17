// @ts-check
import path from 'node:path';
import { lineOf } from '../../lib/text.mjs';

/**
 * SL-T08 static: three (or four, or six) icon boxes in a row. A grid of 3, 4 or 6 columns followed by repeated icon
 * tiles: a filled, rounded, centred box of 32 to 72px (w/h/size 8 to 16, or an arbitrary px size) whose own content
 * is an svg or an icon component (FD14-F23, FD10 S08), either written out three times or mapped over an array with
 * three or more icon: entries. Not counted (FD14-F10, F12): grids of real content (game boards, button pads, data
 * figures, numbered steps), components no page renders, comments. The pattern is common on human sites
 * (FD10-F12), so it stays a candidate until calibrated.
 *
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-T08';
const GRID = /^(?:grid-cols-(3|4|6)|grid-cols-\[repeat\((3|4|6),)/;
const TILE_SIZE = /^(?:w|h|size)-(?:8|9|10|11|12|14|16|\[(?:3[2-9]|[4-6]\d|7[0-2])px\])$/;
/** An svg, an icon component or prop, or an emoji standing in for an icon (FD10-F26). */
const ICON_CONTENT = /<svg\b|<[A-Z][\w.]*(?=[\s/>])|<[\w.]*\.icon\b|\{\s*[\w.]*[iI]con[\w.]*\s*(?:\(|\})|\p{Extended_Pictographic}/u;
const WINDOW = 6000;
const MIN_TILES = 3;

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
    const contexts = classContexts(file);
    const tiles = iconTiles(file, contexts);
    if (tiles.length === 0) continue;
    for (const grid of contexts) {
      const columns = utilities(grid.text).map((u) => GRID.exec(u.utility)).find(Boolean);
      if (!columns) continue;
      const inside = tiles.filter((t) => t > grid.index && t - grid.index < WINDOW);
      if (inside.length === 0) continue;
      const count = inside.length >= MIN_TILES ? inside.length : mappedIconEntries(file.code, grid.index, inside[0]);
      if (count >= MIN_TILES) {
        out.push(finding(file, grid.index, `${columns[1] ?? columns[2]} columns, ${count} icon tiles`, 'a row of equal icon tiles (an icon in a filled rounded box above each heading)'));
      }
    }
  }
  return unique(out);
}

/**
 * The offsets of the file's icon tiles, one per line: class lists of a 32-72px box, rounded, centring its content,
 * filled, on an element whose content starts with an svg or an icon component.
 * @param {SourceFile} file
 * @param {Array<{text: string, index: number}>} contexts
 * @returns {number[]}
 */
function iconTiles(file, contexts) {
  /** @type {Map<number, number>} */
  const byLine = new Map();
  for (const c of contexts) {
    const names = utilities(c.text).filter(atRest).map((u) => u.utility);
    const tile = names.some((u) => TILE_SIZE.test(u)) && names.some((u) => /^rounded(?:-(?!none$)[\w[\]./-]+)?$/.test(u)) &&
      names.includes('items-center') && names.includes('justify-center') &&
      names.some((u) => /^(?:bg-(?!clip-|origin-|cover$|contain$|center$|no-repeat$|transparent$|none$)|from-)/.test(u));
    if (!tile) continue;
    const tag = tagAt(file.code, c.index);
    const end = tag ? openTagEnd(file.code, tag.start) : -1;
    if (end < 0) continue;
    const close = file.code.indexOf('</', end);
    const content = file.code.slice(end + 1, close < 0 ? end + 400 : Math.min(close, end + 400));
    if (ICON_CONTENT.test(content)) byLine.set(lineOf(file.code, c.index), c.index);
  }
  return [...byLine.values()];
}

/**
 * The number of icon: entries in the array mapped between a grid and its first tile (features.map(...)); 0 when the
 * tile is not inside a .map over an array defined in the same file.
 * @param {string} code
 * @param {number} gridIndex
 * @param {number} tileIndex
 * @returns {number}
 */
function mappedIconEntries(code, gridIndex, tileIndex) {
  const maps = [...code.slice(gridIndex, tileIndex).matchAll(/\b([\w$]+)\s*\.map\s*\(/g)];
  const name = maps.length > 0 ? maps[maps.length - 1][1] : null;
  if (!name) return 0;
  const definition = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\s*(?::[^=]+)?=\\s*\\[`).exec(code);
  if (!definition) return 0;
  const open = definition.index + definition[0].length - 1;
  const close = closing(code, open);
  return close < 0 ? 0 : [...code.slice(open, close).matchAll(/\bicon\s*:/g)].length;
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
export function mountedFiles(files) {
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

/** Entries that wrap the pages below their folder: Next.js layouts and templates, pages/_app and _document,
 * SvelteKit layouts, Remix's root and Nuxt's app.vue. */
const WRAPPER = /(?:^|\/)(?:layout|template)\.[cm]?[jt]sx?$|(?:^|\/)pages\/_(?:app|document)\.[cm]?[jt]sx?$|(?:^|\/)\+layout\.svelte$|(?:^|\/)app\/root\.[jt]sx?$|(?:^|\/)app\.vue$/;

/**
 * The files each page can render, one set per page entry: the page, the wrappers above it (layouts, _app, root) and
 * everything they reach through used imports. Two files share a page only when one set holds both: a grain in one
 * page's stylesheet does not sit over a gradient another page paints. Null when the project has no recognisable
 * entry (callers then treat the whole project as one page).
 * @param {SourceFile[]} files
 * @returns {Array<{entry: string, files: Set<string>}> | null}
 */
export function mountedByEntry(files) {
  const paths = new Set(files.map((f) => f.path));
  const entries = files.filter((f) => ENTRY.test(f.path)).map((f) => f.path);
  if (entries.length === 0) return null;
  /** @type {Map<string, string[]>} */
  const edges = new Map(files.map((f) => [f.path, importsOf(f, paths)]));
  const wrappers = entries.filter((e) => WRAPPER.test(e));
  const pages = entries.filter((e) => !WRAPPER.test(e));
  /** @param {string} wrapper @returns {string} */
  const scope = (wrapper) => {
    const dir = path.posix.dirname(wrapper);
    return dir === '.' ? '' : dir;
  };
  const roots = pages.length > 0 ? pages : wrappers;
  return roots.map((entry) => {
    const seed = [entry, ...wrappers.filter((w) => w !== entry && (scope(w) === '' || entry.startsWith(`${scope(w)}/`)))];
    const seen = new Set(seed);
    const queue = [...seed];
    while (queue.length > 0) {
      for (const to of edges.get(/** @type {string} */ (queue.pop())) ?? []) {
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    return { entry, files: seen };
  });
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
