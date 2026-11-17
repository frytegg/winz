// @ts-check
import { NAMED_COLORS, parseColor } from '../../lib/color.mjs';
import { lineOf } from '../../lib/text.mjs';
import { mountedByEntry } from './SL-T08.mjs';

/**
 * SL-T20 static: grain over a gradient. A grain source (an feTurbulence or fractalNoise filter, a noise, grain or
 * paper texture asset, Magic UI's NoiseTexture, or a low-opacity blend overlay carrying a background image) in a
 * file that also paints a gradient with a saturated stop (HSL saturation 0.3 or more, lightness between 0.12 and
 * 0.92; FD14-F23), or a full-screen grain layer on a page that paints one: the grain's file and the gradient's file
 * must be reachable from the same page entry (its layouts included; SL-T08 mountedByEntry), so a gradient on an
 * unrelated page never pairs with it. The saturation condition keeps a paper grain over a black vignette silent
 * (XRPL, FD14-F16). Not counted: grain over luminance-only
 * gradients, comments. Film, print and photographic brands are left to a category waiver (registry).
 *
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-T20';
const GRAIN_SOURCE = /<feTurbulence\b|\bfeTurbulence\b|\bfractalNoise\b|\b(?:noise|grain|film-grain|paper)[\w-]*\.(?:png|webp|svg|gif|avif|jpe?g)\b|<NoiseTexture(?=[\s>/])|<(?:Grain|Noise)(?:Overlay|Texture|Layer)?(?=[\s>/])/g;
const BLEND = /^mix-blend-(?:overlay|soft-light|multiply|screen)$/;
const LOW_OPACITY = /^opacity-(?:[5-9]|[12]\d|30|\[0?\.(?:0[5-9]|[12]\d?|30?)\])$/;
const FULL_SCREEN = /\b(?:fixed|absolute)\b[\s\S]{0,300}\binset-0\b|\bposition\s*:\s*fixed\b[\s\S]{0,300}\binset\s*:\s*0\b|\binset-0\b[\s\S]{0,300}\bfixed\b/;
const SATURATION = 0.3;

/**
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  const files = shippedFiles(ctx);
  const vars = themeVariables(files);
  const used = usedClassTokens(files);
  /** @type {Map<string, {index: number, text: string}>} */
  const gradients = new Map();
  /** @type {Map<string, (index: number) => boolean>} */
  const live = new Map(files.map((f) => [f.path, liveAt(f, used)]));
  for (const file of files) {
    const hit = saturatedGradient(file, vars, /** @type {(index: number) => boolean} */ (live.get(file.path)));
    if (hit) gradients.set(file.path, hit);
  }
  if (gradients.size === 0) return [];
  const pages = mountedByEntry(files);
  /** @param {string} a @param {string} b @returns {boolean} */
  const samePage = (a, b) => pages === null || pages.some((p) => p.files.has(a) && p.files.has(b));
  /** @type {StaticFinding[]} */
  const out = [];
  for (const file of files) {
    const isLive = /** @type {(index: number) => boolean} */ (live.get(file.path));
    for (const source of grainSources(file).filter((s) => isLive(s.index))) {
      const local = gradients.get(file.path);
      const nearby = file.code.slice(Math.max(0, source.index - 300), source.index + 300);
      const anywhere = FULL_SCREEN.test(nearby) ? [...gradients.entries()].find(([other]) => samePage(file.path, other)) ?? null : null;
      if (local) {
        out.push(finding(file, source.index, source.text, `grain texture in the same file as a saturated gradient (line ${lineOf(file.code, local.index)})`));
      } else if (anywhere) {
        out.push(finding(file, source.index, source.text, `full-screen grain layer over a page that paints a saturated gradient (${anywhere[0]})`));
      }
    }
  }
  return unique(out);
}

/**
 * The grain sources of a file: noise filters and textures, and low-opacity blend overlays with an image.
 * @param {SourceFile} file
 * @returns {Array<{index: number, text: string}>}
 */
function grainSources(file) {
  const found = [...file.code.matchAll(GRAIN_SOURCE)].map((m) => ({ index: m.index, text: m[0].replace(/^</, '') }));
  for (const context of classContexts(file)) {
    const names = utilities(context.text).filter(atRest).map((u) => u.utility);
    if (names.some((u) => BLEND.test(u)) && names.some((u) => LOW_OPACITY.test(u)) && names.some((u) => /^bg-\[url\(/.test(u))) {
      found.push({ index: context.index, text: names.filter((u) => BLEND.test(u) || LOW_OPACITY.test(u)).join(' ') });
    }
  }
  return found;
}

/**
 * The first gradient of a file with a saturated stop: a CSS gradient function, or Tailwind stops on a gradient.
 * @param {SourceFile} file
 * @param {Map<string, string>} vars
 * @param {(index: number) => boolean} isLive
 * @returns {{index: number, text: string} | null}
 */
function saturatedGradient(file, vars, isLive) {
  for (const call of gradientCalls(file.code)) {
    if (isLive(call.index) && stopColours(call.text, vars).some((c) => isChromatic(c, SATURATION))) return { index: call.index, text: call.text };
  }
  for (const context of classContexts(file)) {
    const stops = tailwindStops(context.text, vars);
    if (stops.some((s) => s.family !== null && s.family !== 'neutral')) return { index: context.index, text: stops.map((s) => s.utility).join(' ') };
  }
  return null;
}

/**
 * A predicate telling whether an offset of a stylesheet (a CSS file or an HTML <style> block) sits in a rule some
 * shipped file can match: a grain or gradient defined on a class nobody uses never renders (FD14-F22). Script and
 * component code is always live here; its reachability is the runtime's question.
 * @param {SourceFile} file
 * @param {Set<string>} used
 * @returns {(index: number) => boolean}
 */
function liveAt(file, used) {
  if (file.kind !== 'css' && file.kind !== 'html') return () => true;
  const blocks = declarationBlocks(file.code);
  return (index) => {
    const inner = blocks
      .filter((b) => index >= b.index && index <= b.index + b.body.length)
      .sort((a, b) => b.index - a.index)[0];
    return inner === undefined || !deadSelector(inner.selector, file, used);
  };
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

// ─── shared:colour ───
/**
 * @typedef {import('../../lib/color.mjs').Rgba} Rgba
 * @typedef {'purple' | 'blue' | 'arc' | 'warm' | 'green' | 'neutral'} HueFamily
 */

/** Tailwind palette families by the hue they paint (FD10-F05); indigo reads blue in HSL (FD14-F07). */
const PALETTE = new Map(/** @type {Array<[string, HueFamily]>} */ (Object.entries({
  purple: 'purple', violet: 'purple', fuchsia: 'purple', indigo: 'blue', blue: 'blue', sky: 'blue', cyan: 'blue',
  teal: 'arc', pink: 'arc', red: 'warm', orange: 'warm', amber: 'warm', yellow: 'warm', rose: 'warm',
  lime: 'green', green: 'green', emerald: 'green', slate: 'neutral', gray: 'neutral', zinc: 'neutral',
  neutral: 'neutral', stone: 'neutral',
})));
const NEUTRAL_WORDS = new Set(['white', 'black', 'transparent', 'current', 'currentcolor', 'inherit', 'initial']);

/**
 * HSL of a gamma-encoded sRGB colour: hue in degrees, saturation and lightness in 0..1.
 * @param {Rgba} c
 * @returns {{h: number, s: number, l: number}}
 */
function hsl({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/**
 * The hue family a colour reads as under Krebs's purple test (saturation above 0.25, lightness 0.15 to 0.85, alpha
 * 0.3 or more; FD10-F23): purple 250 to 300 degrees, blue and cyan 180 to 250, pink and teal on the same arc, then
 * warm or green. Anything paler, darker, greyer or more transparent is neutral.
 * @param {Rgba} c
 * @returns {HueFamily}
 */
function hueFamily(c) {
  const { h, s, l } = hsl(c);
  if (c.a < 0.3 || s <= 0.25 || l <= 0.15 || l >= 0.85) return 'neutral';
  if (h >= 250 && h <= 300) return 'purple';
  if (h >= 180 && h < 250) return 'blue';
  if ((h > 300 && h <= 345) || (h >= 170 && h < 180)) return 'arc';
  return h >= 70 && h < 170 ? 'green' : 'warm';
}

/**
 * True for a visibly coloured paint: alpha 0.3 or more, HSL saturation at least `minSaturation`, lightness
 * strictly between 0.12 and 0.92.
 * @param {Rgba} c
 * @param {number} minSaturation
 * @returns {boolean}
 */
function isChromatic(c, minSaturation) {
  const { s, l } = hsl(c);
  return c.a >= 0.3 && s >= minSaturation && l > 0.12 && l < 0.92;
}

/**
 * Resolves a CSS colour value through custom properties: var(--x, fallback), shadcn's bare "H S% L%" triplets and
 * colour functions that wrap var(). Null when it is not a colour.
 * @param {string} value
 * @param {Map<string, string>} vars
 * @param {number} [depth]
 * @returns {Rgba | null}
 */
function resolveColour(value, vars, depth = 0) {
  const v = value.replace(/!important/i, '').trim();
  if (depth > 6 || v === '') return null;
  const whole = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(v);
  if (whole) {
    const next = vars.get(whole[1]) ?? whole[2];
    return next === undefined ? null : resolveColour(next, vars, depth + 1);
  }
  if (/^-?[\d.]+(?:deg)?\s+[\d.]+%\s+[\d.]+%$/.test(v)) return parseColor(`hsl(${v})`);
  return parseColor(v.replace(/var\(\s*(--[\w-]+)\s*\)/g, (m, name) => vars.get(name) ?? m));
}

/**
 * The hue family a Tailwind colour name paints ('violet-600', 'violet-600/40', 'primary', '[#8b5cf6]', '(--brand)'),
 * theme tokens resolved through custom properties; null when it cannot be told. Palette shades below 300 are washes
 * too pale to carry a hue.
 * @param {string} name
 * @param {Map<string, string>} vars
 * @returns {HueFamily | null}
 */
function colourFamily(name, vars) {
  const slash = /^(.*?)\/(?:(\d{1,3})|\[([\d.]+)(%?)\])$/.exec(name);
  const base = slash ? slash[1] : name;
  const alpha = !slash ? 1 : slash[2] !== undefined ? Number(slash[2]) / 100 : Number(slash[3]) / (slash[4] ? 100 : 1);
  if (alpha < 0.3 || NEUTRAL_WORDS.has(base.toLowerCase())) return 'neutral';
  const palette = /^([a-z]+)-(\d{2,3})$/.exec(base);
  const family = palette ? PALETTE.get(palette[1]) : undefined;
  if (palette && family) return Number(palette[2]) < 300 ? 'neutral' : family;
  const arbitrary = /^\[(.+)\]$/.exec(base) ?? /^\((--[\w-]+)\)$/.exec(base);
  /** @type {Rgba | null} */
  let colour = null;
  if (arbitrary) {
    const inner = arbitrary[1].replace(/_/g, ' ').replace(/^color:/, '');
    colour = resolveColour(inner.startsWith('--') ? `var(${inner})` : inner, vars);
  } else if (/^[a-z][\w-]*$/i.test(base)) {
    const token = vars.get(`--color-${base}`) ?? vars.get(`--${base}`);
    colour = token === undefined ? null : resolveColour(token, vars);
  }
  return colour ? hueFamily({ ...colour, a: colour.a * alpha }) : null;
}

/**
 * Custom properties plus the colours of a Tailwind v3 config (theme.colors and theme.extend.colors), flattened the
 * way Tailwind names them: fg.tertiary becomes --color-fg-tertiary, DEFAULT takes the parent's name.
 * @param {SourceFile[]} files
 * @returns {Map<string, string>}
 */
function themeVariables(files) {
  const vars = customProperties(files);
  for (const f of files) {
    if (!/(?:^|\/)tailwind\.config\.[cm]?[jt]s$/.test(f.path)) continue;
    for (const m of f.code.matchAll(/\bcolors\s*:\s*\{/g)) {
      const open = m.index + m[0].length - 1;
      const close = closing(f.code, open);
      if (close > open) flattenColours(f.code.slice(open + 1, close), '', vars);
    }
  }
  return vars;
}

/**
 * @param {string} body
 * @param {string} prefix
 * @param {Map<string, string>} into
 */
function flattenColours(body, prefix, into) {
  const entry = /['"]?([\w-]+)['"]?\s*:\s*(?:(['"`])(.*?)\2|\{)/g;
  for (let m = entry.exec(body); m; m = entry.exec(body)) {
    const name = m[1] === 'DEFAULT' ? prefix : prefix ? `${prefix}-${m[1]}` : m[1];
    if (m[2]) {
      if (name && !into.has(`--color-${name}`)) into.set(`--color-${name}`, m[3]);
      continue;
    }
    const open = m.index + m[0].length - 1;
    const close = closing(body, open);
    if (close < 0) break;
    flattenColours(body.slice(open + 1, close), name, into);
    entry.lastIndex = close + 1;
  }
}
// ─── end shared:colour ───

// ─── shared:gradients ───
const GRADIENT_CALL = /\b(?:repeating-)?(?:linear|radial|conic)-gradient\(/gi;
const COLOUR_TOKEN = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|\bvar\(\s*--[\w-]+\s*(?:,[^()]*)?\)|\b[a-z]{3,20}\b/gi;
const STOP_UTILITY = /^(from|via|to)-(.+)$/;

/**
 * Every CSS gradient function call with its argument text (also inside Tailwind arbitrary values).
 * @param {string} code
 * @returns {Array<{index: number, text: string}>}
 */
function gradientCalls(code) {
  /** @type {Array<{index: number, text: string}>} */
  const out = [];
  for (const m of code.matchAll(GRADIENT_CALL)) {
    const open = m.index + m[0].length - 1;
    const close = closing(code, open);
    if (close > open) out.push({ index: m.index, text: code.slice(m.index, close + 1) });
  }
  return out;
}

/**
 * The colours of a gradient's stops: hex, colour functions, named colours and custom properties resolved.
 * @param {string} gradient
 * @param {Map<string, string>} vars
 * @returns {Rgba[]}
 */
function stopColours(gradient, vars) {
  const args = gradient.slice(gradient.indexOf('(') + 1, -1).replace(/_/g, ' ');
  /** @type {Rgba[]} */
  const out = [];
  for (const m of args.matchAll(COLOUR_TOKEN)) {
    const token = m[0];
    if (/^[a-z]+$/i.test(token) && !Object.hasOwn(NAMED_COLORS, token.toLowerCase()) && token.toLowerCase() !== 'transparent') continue;
    const c = resolveColour(token, vars);
    if (c) out.push(c);
  }
  return out;
}

/**
 * The Tailwind gradient stops of a class list (from-, via-, to-), with the hue family each paints; stop positions
 * (from-10%) are not colours.
 * @param {string} text
 * @param {Map<string, string>} vars
 * @returns {Array<{utility: string, family: HueFamily | null}>}
 */
function tailwindStops(text, vars) {
  /** @type {Array<{utility: string, family: HueFamily | null}>} */
  const out = [];
  for (const u of utilities(text)) {
    const m = STOP_UTILITY.exec(u.utility);
    if (!m || /^(?:\[?[\d.]+%\]?)$/.test(m[2])) continue;
    out.push({ utility: u.token, family: colourFamily(m[2], vars) });
  }
  return out;
}
// ─── end shared:gradients ───

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
