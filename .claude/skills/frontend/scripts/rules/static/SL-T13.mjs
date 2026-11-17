// @ts-check
import path from 'node:path';
import { lineOf } from '../../lib/text.mjs';

/**
 * SL-T13 static: cursor-following effects. A mousemove or pointermove listener whose handler reads pointer
 * coordinates and writes them into styles (a custom property, a transform or position, a radial gradient, a Motion
 * spring), and the pointer-effect components of the effect catalogues mounted on a page (Magic UI MagicCard,
 * Aceternity Spotlight, CardSpotlight and FollowingPointer, SmoothCursor, React Bits SpotlightCard and DotGrid;
 * FD10 S13, FD14-F12). Not counted (FD14-F23, F12): charts, maps, games, editors and 3D viewers (a crosshair or a
 * drag is function), handlers that write no coordinates (an idle-cursor hider), components rendered only with
 * interactive={false} or never rendered, comments.
 *
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-T13';
const LISTENER = /\bon(?:Mouse|Pointer)Move\s*=|\baddEventListener\s*\(\s*['"`](?:mouse|pointer)move['"`]|\bon(?:mouse|pointer)move\s*=/g;
const COORDINATES = /\b(?:clientX|clientY|pageX|pageY|offsetX|offsetY|screenX|layerX)\b/;
const STYLE_WRITE = /setProperty\s*\(\s*['"`]--|\.style\.(?:left|top|transform|translate|background(?:Image|Position)?|maskImage|WebkitMaskImage)\s*=|\.style\s*\[|radial-gradient\([^)]*\$\{|\buse(?:Spring|MotionValue|MotionTemplate)\s*\(|\.set\(\s*(?:e|event|evt)\.client[XY]|--(?:mouse|pointer|cursor|spotlight|glow)-?[xy]?\b/;
const EFFECT = /<(MagicCard|CardSpotlight|SpotlightCard|Spotlight|FollowingPointer|FollowerPointerCard|SmoothCursor|DotGrid)(?=[\s>/])/g;
const FUNCTIONAL = /chart|graph|plot|crosshair|(?:^|[/_-])map|canvas|game|three|scene|viewer|editor|draw|whiteboard|slider|resiz|drag|sortable|sign(?:ature|pad)/i;
const SPAN = 1500;

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
    const quoted = quotedRanges(file);
    if (!FUNCTIONAL.test(file.path) && !onlyRenderedInert(file, files)) {
      for (const m of code.matchAll(LISTENER)) {
        if (insideRanges(quoted, m.index)) continue;
        const handler = code.slice(Math.max(0, m.index - SPAN), m.index + SPAN);
        if (COORDINATES.test(handler) && STYLE_WRITE.test(handler)) {
          out.push(finding(file, m.index, m[0].trim(), 'pointer-move handler writes pointer coordinates into styles (a cursor-following effect)'));
        }
      }
    }
    for (const m of code.matchAll(EFFECT)) {
      if (insideRanges(quoted, m.index)) continue;
      const end = openTagEnd(code, m.index);
      if (end > 0 && /\binteractive\s*=\s*\{\s*false\s*\}/.test(code.slice(m.index, end))) continue;
      out.push(finding(file, m.index, m[1], `${m[1]} from an effect catalogue follows the pointer`));
    }
  }
  return unique(out);
}

/**
 * True when every page that renders the component this file defines passes interactive={false} (FD14-F12:
 * FloatingLines mounted with its pointer code switched off).
 * @param {SourceFile} file
 * @param {SourceFile[]} files
 * @returns {boolean}
 */
function onlyRenderedInert(file, files) {
  const name = path.posix.basename(file.path).replace(/\.[^.]+$/, '');
  const component = /^[a-z]/.test(name) ? name.replace(/(?:^|-)(\w)/g, (m, c) => c.toUpperCase()) : name;
  const tag = new RegExp(`<${component}(?=[\\s>/])`, 'g');
  const uses = files.flatMap((f) => (f === file ? [] : [...f.code.matchAll(tag)].map((m) => ({ f, index: m.index }))));
  if (uses.length === 0) return false;
  return uses.every(({ f, index }) => {
    const end = openTagEnd(f.code, index);
    return end > 0 && /\binteractive\s*=\s*\{\s*false\s*\}/.test(f.code.slice(index, end));
  });
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
