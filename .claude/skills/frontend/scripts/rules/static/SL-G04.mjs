// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 * @typedef {{file: SourceFile, index: number, component: string, library: string}} Mount
 */

const RULE = 'SL-G04';
const REACT_BITS = 'React Bits';
const MAGIC_UI = 'Magic UI';
const ACETERNITY = 'Aceternity UI';
/**
 * Catalogue component names verified against the libraries: React Bits (FD14-F12, the 16 ETHDenver names plus
 * FloatingLines, StaggeredMenu and Grainient), Magic UI's registry (FD10-F09, FD14-F12) and Aceternity's catalogue and
 * the cursor effects FD10's S13 lists.
 */
export const CATALOGUE = Object.freeze(new Map([
  ...['AnimatedContent', 'BlurText', 'CardNav', 'CircularText', 'CurvedLoop', 'DotGrid', 'ElectricBorder', 'FadeContent',
    'Folder', 'GlareHover', 'GlitchText', 'MagicBento', 'PixelTransition', 'SplitText', 'SpotlightCard', 'TiltedCard',
    'FloatingLines', 'StaggeredMenu', 'Grainient'].map((n) => /** @type {[string, string]} */ ([n, REACT_BITS])),
  ...['BlurFade', 'MagicCard', 'NoiseTexture', 'NumberTicker', 'Marquee', 'BentoGrid', 'BorderBeam', 'AnimatedBeam',
    'AnimatedGradientText', 'AuroraText', 'ScrollProgress', 'ShimmerButton', 'ShineBorder', 'TextAnimate', 'SmoothCursor']
    .map((n) => /** @type {[string, string]} */ ([n, MAGIC_UI])),
  ...['Spotlight', 'BackgroundBeams', 'TracingBeam', 'FollowingPointer', 'AuroraBackground', 'SparklesCore', 'Meteors',
    'LampContainer', 'CardSpotlight'].map((n) => /** @type {[string, string]} */ ([n, ACETERNITY])),
]));
/** Names other packages also export (lucide's Folder, react-fast-marquee, GSAP's SplitText...): they need a catalogue path. */
const AMBIGUOUS = new Set(['Folder', 'Spotlight', 'Marquee', 'Meteors', 'SparklesCore', 'DotGrid', 'SplitText']);
const ICON_SOURCE = /lucide|heroicons|react-icons|phosphor|tabler|radix-ui\/react-icons|iconify|@mui\/icons/i;
const CATALOGUE_SOURCE = /magic-?ui|react-?bits|aceternity/i;
const LOCAL_SOURCE = /^(?:\.{1,2}\/|@\/|~\/|src\/|components\/|#)/;
const IMPORT = /\bimport\s+(?:type\s+)?([A-Za-z_$][\w$]*)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g;
/** next/dynamic and React.lazy: const DotGrid = dynamic(() => import('@/components/DotGrid'), { ssr: false }). */
const LAZY_IMPORT = /\b(?:const|let)\s+([A-Z][\w$]*)\s*=\s*(?:dynamic|lazy|React\.lazy)\s*\(\s*\(\s*\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)/g;
/**
 * Props that carry product data into an effect (a ticker's value, a flash re-keyed on a changed price); a non-literal
 * value there means the effect may encode real state. UI triggers (animate, show, open, play) do not count: FD14-F12's
 * legitimate case is a flash fired by a real data change.
 */
const STATE_PROPS = /\b(?:value|startValue|count|amount|price|balance|data|number|key)\s*=\s*\{([^{}]*)\}/g;
const LITERAL = /^\s*(?:-?[\d_.]+|(["'`])[^"'`]*\1|true|false|null|undefined)\s*$/;
/** Files a page renders from: the Next app and pages routers, and the Vite or CRA entry and root component. */
const ENTRY = /(?:^|\/)(?:app\/(?:.*\/)?(?:page|layout|template)|pages\/.+|(?:src\/)?(?:main|index|App|_app|_document))\.[cm]?[jt]sx?$/;
const EXPORTED = /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class)\s+([A-Z][\w$]*)|\bexport\s+default\s+([A-Z][\w$]*)|\bexport\s*\{([^}]*)\}/g;
const JSX_NAME = /<([A-Z][\w$]*)/g;

/**
 * Effect-catalogue components mounted for decoration (FD14-F12: "Maintain a denylist of catalogue names ... and judge
 * only mounted components with their actual props"; FD10-F09). A component counts when it is imported from a
 * catalogue path or from a local copy named after it, rendered as JSX in a file a page can reach (half of one past
 * frontend's vendored effects were never mounted, FD14-F12), and none of its state props takes a non-literal value.
 * One finding per component; there is no runtime layer.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  const reached = reachable(ctx.files);
  /** @type {Map<string, Mount[]>} */
  const mounts = new Map();
  for (const file of ctx.files) {
    if (!['js', 'jsx', 'tsx', 'vue', 'svelte'].includes(file.kind) || !reached.has(file.path)) continue;
    const code = file.code;
    /** @type {Array<{source: string, imported: string, local: string}>} */
    const bindings = [];
    for (const m of code.matchAll(IMPORT)) {
      const source = m[3];
      if (m[1]) bindings.push({ source, imported: lastSegmentName(source) ?? m[1], local: m[1] });
      for (const part of (m[2] ?? '').split(',')) {
        const named = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
        if (named) bindings.push({ source, imported: named[1], local: named[2] ?? named[1] });
      }
    }
    for (const m of code.matchAll(LAZY_IMPORT)) bindings.push({ source: m[2], imported: lastSegmentName(m[2]) ?? m[1], local: m[1] });
    for (const { source, imported, local } of bindings) {
      if (ICON_SOURCE.test(source)) continue;
      const library = catalogueLibrary(imported, source);
      if (!library) continue;
      for (const use of code.matchAll(new RegExp(`<${local}\\b`, 'g'))) {
        const start = (use.index ?? 0) + use[0].length;
        if (boundToState(code.slice(start, tagEnd(code, start)))) continue;
        const list = mounts.get(imported) ?? [];
        list.push({ file, index: use.index ?? 0, component: imported, library });
        mounts.set(imported, list);
      }
    }
  }
  return [...mounts.values()].map((list) => {
    const first = list[0];
    return {
      rule: RULE,
      layer: 'static',
      file: first.file.path,
      line: lineOf(first.file.text, first.index),
      excerpt: excerpt(first.file.text, first.index),
      value: { component: first.component, library: first.library, mounts: list.length },
      detail: `${first.library} ${first.component} mounted ${list.length} time(s) with no state driving it; remove it, or bind the effect to a real state change`,
    };
  });
}

/**
 * Paths of the files a page can render: entry files, then, until nothing changes, every file exporting a component
 * that a reached file renders as JSX. With no recognisable entry file every script file counts as reached.
 * @param {SourceFile[]} files
 * @returns {Set<string>}
 */
export function reachable(files) {
  const scripts = files.filter((f) => ['js', 'jsx', 'ts', 'tsx', 'vue', 'svelte'].includes(f.kind));
  const reached = new Set(scripts.filter((f) => ENTRY.test(f.path)).map((f) => f.path));
  if (reached.size === 0) return new Set(scripts.map((f) => f.path));
  /** @type {Map<string, string[]>} */
  const exported = new Map(scripts.map((f) => [f.path, exportedNames(f.code)]));
  /** @type {Set<string>} */
  const rendered = new Set();
  const addRendered = (/** @type {SourceFile} */ f) => {
    for (const m of f.code.matchAll(JSX_NAME)) rendered.add(m[1]);
  };
  for (const f of scripts) if (reached.has(f.path)) addRendered(f);
  for (let grew = true; grew;) {
    grew = false;
    for (const f of scripts) {
      if (reached.has(f.path) || !(exported.get(f.path) ?? []).some((n) => rendered.has(n))) continue;
      reached.add(f.path);
      addRendered(f);
      grew = true;
    }
  }
  return reached;
}

/**
 * PascalCase names a module exports (declarations, default exports and export lists).
 * @param {string} code
 * @returns {string[]}
 */
function exportedNames(code) {
  /** @type {string[]} */
  const names = [];
  for (const m of code.matchAll(EXPORTED)) {
    if (m[1] || m[2]) names.push(m[1] ?? m[2]);
    for (const part of (m[3] ?? '').split(',')) {
      const name = /([A-Z][\w$]*)\s*$/.exec(part.trim())?.[1];
      if (name) names.push(name);
    }
  }
  return names;
}

/**
 * The catalogue library a binding comes from, or null.
 * @param {string} name
 * @param {string} source
 * @returns {string | null}
 */
function catalogueLibrary(name, source) {
  const library = CATALOGUE.get(name);
  if (!library) return null;
  if (CATALOGUE_SOURCE.test(source)) return library;
  const named = lastSegmentName(source) === name;
  if (AMBIGUOUS.has(name)) return named && LOCAL_SOURCE.test(source) ? library : null;
  return LOCAL_SOURCE.test(source) || named ? library : null;
}

/**
 * The PascalCase component name a module path's last segment spells (blur-text, BlurText.tsx -> BlurText).
 * @param {string} source
 * @returns {string | null}
 */
function lastSegmentName(source) {
  const segment = source.split('/').pop()?.replace(/\.(?:t|j)sx?$/, '') ?? '';
  if (!segment) return null;
  return segment.split(/[-_]/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join('');
}

/**
 * Index of the `>` that ends the opening tag whose attributes start at `start`, skipping quoted values and braced
 * expressions of any depth (JSX inside an attribute included); the end of the code when the tag never closes.
 * @param {string} code
 * @param {number} start
 * @returns {number}
 */
function tagEnd(code, start) {
  let depth = 0;
  for (let i = start; i < code.length && i - start < 20000; i += 1) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      const close = code.indexOf(c, i + 1);
      if (close < 0) return code.length;
      i = close;
    } else if (c === '{') depth += 1;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if (c === '>' && depth === 0) return i;
  }
  return code.length;
}

/**
 * True when a state prop takes a value that is not a literal.
 * @param {string} attrs
 * @returns {boolean}
 */
function boundToState(attrs) {
  for (const m of attrs.matchAll(STATE_PROPS)) if (!LITERAL.test(m[1])) return true;
  return false;
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
