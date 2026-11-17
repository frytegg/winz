// @ts-check
import { contrastRatio, parseColor, relativeLuminance } from '../../lib/color.mjs';
import { lineOf } from '../../lib/text.mjs';

/**
 * SL-T07 static: low-contrast text on dark grounds. Three source signals; the rendered share of text below 7:1 is
 * the runtime's (FD10-F24): a text colour token, used as text, that composites below 4.5:1 on a dark surface token
 * of the same theme (FD14-F09: ETHDenver's muted text at 2.19:1, inflexion's tertiary at 4.14:1), Tailwind's -500
 * to -800 grey text steps on a dark ground (3.7 to 4.1:1 and lower on 900 and 950 grounds, FD10-F24), and white or
 * foreground text at 40% alpha or less on a dark ground. A dark ground is a dark background on the same element, a
 * dark: variant, or a page whose html, body or root background is dark. Not counted (FD14-F09): disabled and
 * placeholder text, decorative icons, light pages, comments.
 *
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 * @typedef {{name: string, value: string, index: number}} Declared
 */

const RULE = 'SL-T07';
const AA = 4.5;
const DARK_LUMINANCE = 0.2;
const GREY_TEXT = /^text-(?:gray|slate|zinc|neutral|stone)-(?:500|600|700|800)$/;
const DARK_BG = /^bg-(?:black|(?:gray|slate|zinc|neutral|stone)-(?:900|950)|\[#(?:0[0-9a-f]|1[0-9a-f]){3}\])$/i;
const ALPHA_TEXT = /^text-(white|foreground|muted-foreground|base-content|fg|card-foreground|popover-foreground)\/(\d{1,2})$/;
const MAX_TEXT_ALPHA = 40;
const SKIPPED_VARIANT = /^(?:disabled|placeholder|aria-disabled|group-disabled|peer-disabled|file|selection|marker)$/;
/** Text tokens are named for text first (--text-faint, --muted-foreground, DaisyUI's base-content), not for a component (--tooltip-fg). */
const TEXT_TOKEN = /^(?:(?:muted|secondary|tertiary|subtle|dim|faint|quiet|soft|fg|foreground|text|ink|content|caption|meta)(?:-[\w-]+)?|base-content|card-foreground)$/;
const NOT_TEXT_WORD = /disabled|placeholder|border|ring|outline|shadow|(?:^|-)bg(?:-|$)|background|surface|canvas|chart/;
/** Page-level grounds only: a switch track or a tooltip is not where body text sits. */
const SURFACE_TOKEN = /^(?:bg|background|surface|canvas|base|card|panel|body|page|raised|elevated|sunken|well|ground)(?:-[\w-]+)?$/;
const FOREGROUND_WORD = /(?:^|-)(?:foreground|fg|text|content|ink)(?:-|$)/;
const ROOT_SELECTOR = /^(?:html|body|:root|#root|#__next|#app|main|\*)(?:\s*,\s*(?:html|body|:root|#root|#__next|#app|main|\*))*$/;
const DARK_HTML = /<html\b[^>]*\bclass(?:Name)?\s*=\s*\{?\s*['"`][^'"`]*\bdark\b/;
const DEFAULT_DARK = Object.freeze({ r: 10 / 255, g: 10 / 255, b: 10 / 255, a: 1 });

/**
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  const files = shippedFiles(ctx);
  const vars = themeVariables(files);
  const asText = textTokens(files);
  const ground = pageGround(files, vars);
  /** @type {StaticFinding[]} */
  const out = [];
  for (const file of files) {
    for (const block of declarationBlocks(file.code)) {
      const declared = [...block.body.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)].map((m) => ({ name: m[1], value: m[2].trim(), index: block.index + m.index }));
      out.push(...tokenFindings(file, declared, vars, asText));
    }
    if (/(?:^|\/)tailwind\.config\.[cm]?[jt]s$/.test(file.path)) out.push(...tokenFindings(file, configTokens(file), vars, asText));
    for (const context of classContexts(file)) out.push(...classFindings(file, context, ground));
  }
  return unique(out);
}

/**
 * Findings for one class list: grey steps and low-alpha text on a dark ground.
 * @param {SourceFile} file
 * @param {{text: string, index: number}} context
 * @param {import('../../lib/color.mjs').Rgba | null} ground
 * @returns {StaticFinding[]}
 */
function classFindings(file, context, ground) {
  if (/\b(?:disabled|cursor-not-allowed)\b/.test(context.text)) return [];
  const tag = tagAt(file.code, context.index);
  if (tag && isIcon(file.code, tag)) return [];
  const parsed = utilities(context.text).filter((u) => atRest(u) && !u.variants.some((v) => SKIPPED_VARIANT.test(v)));
  const darkHere = parsed.some((u) => DARK_BG.test(u.utility));
  /** @type {StaticFinding[]} */
  const out = [];
  for (const u of parsed) {
    const onDark = u.variants.includes('dark') || darkHere || ground !== null;
    if (GREY_TEXT.test(u.utility)) {
      if (onDark) out.push(finding(file, context.index, u.token, 'mid-grey text step on a dark ground (below 4.5:1, FD10-F24)'));
      continue;
    }
    const alpha = ALPHA_TEXT.exec(u.utility);
    if (!alpha || Number(alpha[2]) > MAX_TEXT_ALPHA || (alpha[1] !== 'white' && !onDark)) continue;
    const ratio = alpha[1] === 'white' ? contrastRatio({ r: 1, g: 1, b: 1, a: Number(alpha[2]) / 100 }, ground ?? DEFAULT_DARK) : null;
    if (ratio === null || ratio < AA) {
      out.push(finding(file, context.index, ratio === null ? u.token : `${u.token} ${ratio.toFixed(2)}:1`, `text at ${alpha[2]}% alpha on a dark ground`));
    }
  }
  return out;
}

/**
 * Findings for the text colour tokens of one theme (a declaration block, or a Tailwind config's colours) that are
 * used as text and composite below 4.5:1 on one of the same theme's dark surface tokens.
 * @param {SourceFile} file
 * @param {Declared[]} declared
 * @param {Map<string, string>} vars
 * @param {Set<string>} asText the tokens applied as a text colour
 * @returns {StaticFinding[]}
 */
function tokenFindings(file, declared, vars, asText) {
  if (declared.length < 2) return [];
  const local = new Map([...vars, ...declared.map((d) => /** @type {[string, string]} */ ([d.name, d.value]))]);
  const surfaces = [];
  for (const d of declared) {
    const bare = d.name.replace(/^--(?:color-)?/, '');
    if (!SURFACE_TOKEN.test(bare) || FOREGROUND_WORD.test(bare)) continue;
    const colour = resolveColour(d.value, local);
    if (colour && colour.a >= 0.99 && relativeLuminance(colour) < DARK_LUMINANCE) surfaces.push({ name: d.name, colour });
  }
  if (surfaces.length === 0) return [];
  /** @type {StaticFinding[]} */
  const out = [];
  for (const d of declared) {
    const bare = d.name.replace(/^--(?:color-)?/, '');
    if (!TEXT_TOKEN.test(bare) || NOT_TEXT_WORD.test(bare) || /^var\(\s*--[\w-]+\s*\)$/.test(d.value) || !asText.has(d.name)) continue;
    const colour = resolveColour(d.value, local);
    if (!colour) continue;
    let worst = { ratio: Infinity, surface: '' };
    for (const s of surfaces) {
      const ratio = contrastRatio(colour, s.colour);
      if (ratio !== null && ratio < worst.ratio) worst = { ratio, surface: s.name };
    }
    if (worst.ratio < AA) {
      const ratio = worst.ratio.toFixed(2);
      out.push(finding(file, d.index, `${ratio}:1`, `${d.name} on ${worst.surface} composites to ${ratio}:1 (below 4.5:1 on a dark ground)`));
    }
  }
  return out;
}

/**
 * The colours of a Tailwind v3 config as --color-* tokens with the offset of their key.
 * @param {SourceFile} file
 * @returns {Declared[]}
 */
function configTokens(file) {
  /** @type {Declared[]} */
  const out = [];
  for (const m of file.code.matchAll(/\bcolors\s*:\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = closing(file.code, open);
    if (close < 0) continue;
    /** @type {Map<string, string>} */
    const flat = new Map();
    flattenColours(file.code.slice(open + 1, close), '', flat);
    for (const [name, value] of flat) {
      const key = name.split('-').pop() ?? '';
      const at = file.code.slice(open, close).search(new RegExp(`['"]?\\b${key}\\b['"]?\\s*:`));
      out.push({ name, value, index: at < 0 ? open : open + at });
    }
  }
  return out;
}

/**
 * The custom properties the project applies as a text colour, placeholder and disabled states aside (FD14-F09):
 * color: var(--x) in a declaration block or style object, and text-x (Tailwind names theme colours without
 * --color-), text-[var(--x)] or text-(--x) utilities at rest.
 * @param {SourceFile[]} files
 * @returns {Set<string>}
 */
function textTokens(files) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const file of files) {
    for (const block of declarationBlocks(file.code)) {
      if (/placeholder|disabled/i.test(block.scope)) continue;
      for (const m of block.body.matchAll(/(?:^|[;{\s])color\s*:\s*[^;]*?var\(\s*(--[\w-]+)|\bcolor\s*:\s*['"`]\s*var\(\s*(--[\w-]+)/g)) {
        out.add(m[1] ?? m[2]);
      }
    }
    for (const context of classContexts(file)) {
      if (/\b(?:disabled|cursor-not-allowed)\b/.test(context.text)) continue;
      for (const u of utilities(context.text)) {
        if (!atRest(u) || u.variants.some((v) => SKIPPED_VARIANT.test(v))) continue;
        const m = /^text-(?:\[var\((--[\w-]+)\)\]|\((--[\w-]+)\)|([a-z][\w-]*?))(?:\/\d+)?$/.exec(u.utility);
        if (m && (m[1] ?? m[2])) out.add(m[1] ?? m[2]);
        else if (m) out.add(`--${m[3]}`).add(`--color-${m[3]}`);
      }
    }
  }
  return out;
}

/**
 * The page ground when it is dark: the background of html, body or the root element (a rule or a utility), the root
 * --background token, or a dark class on <html> (then the .dark --background, or #0a0a0a). Null for a light or
 * unknown ground.
 * @param {SourceFile[]} files
 * @param {Map<string, string>} vars
 * @returns {import('../../lib/color.mjs').Rgba | null}
 */
function pageGround(files, vars) {
  /** @type {Array<import('../../lib/color.mjs').Rgba | null>} */
  const candidates = [];
  let darkClass = false;
  /** @type {import('../../lib/color.mjs').Rgba | null} */
  let darkBackground = null;
  for (const file of files) {
    for (const block of declarationBlocks(file.code)) {
      if (/^\.dark$/.test(block.selector)) {
        const bg = /(--(?:color-)?background)\s*:\s*([^;]+)/.exec(block.body);
        if (bg) darkBackground = resolveColour(bg[2], vars);
      }
      if (!ROOT_SELECTOR.test(block.selector)) continue;
      const bg = /\bbackground(?:-color)?\s*:\s*([^;]+)/.exec(block.body);
      if (bg) candidates.push(resolveColour(bg[1], vars));
      if (/color-scheme\s*:\s*dark\b/.test(block.body) && !/light/.test(block.body)) darkClass = true;
    }
    for (const m of file.code.matchAll(/<(?:html|body|main)\b[^>]*\bclass(?:Name)?\s*=\s*\{?\s*['"`]([^'"`]*)/g)) {
      if (utilities(m[1]).some((u) => u.variants.length === 0 && DARK_BG.test(u.utility))) candidates.push(DEFAULT_DARK);
    }
    if (DARK_HTML.test(file.code)) darkClass = true;
  }
  const root = vars.get('--background') ?? vars.get('--color-background');
  if (root) candidates.push(resolveColour(root, vars));
  const dark = candidates.find((c) => c !== null && c.a >= 0.99 && relativeLuminance(c) < DARK_LUMINANCE);
  if (dark) return dark;
  if (!darkClass) return null;
  return darkBackground && relativeLuminance(darkBackground) < DARK_LUMINANCE ? darkBackground : DEFAULT_DARK;
}

/**
 * True for an icon element: an svg, an *Icon component, or a self-closing PascalCase component (icon components
 * have no children).
 * @param {string} code
 * @param {{name: string, start: number}} tag
 * @returns {boolean}
 */
function isIcon(code, tag) {
  if (tag.name === 'svg' || /Icon$/.test(tag.name)) return true;
  const end = openTagEnd(code, tag.start);
  return /^[A-Z]/.test(tag.name) && end > 0 && code[end - 1] === '/';
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
