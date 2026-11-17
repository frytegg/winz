// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 * @typedef {{file: SourceFile, index: number, pill: boolean, component: boolean, classes: string}} ButtonUse
 */

const RULE = 'SL-C01';
const MARKUP = new Set(['js', 'jsx', 'tsx', 'html', 'vue', 'svelte']);
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
const TAG = /(?<![\w$.)\]])<(button|Button|a|Link|NavLink)\b((?:[^>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*?)\/?>/g;
const ROLE_BUTTON = /<[A-Za-z][\w.]*\b(?=[^>]*\brole\s*=\s*["']button["'])((?:[^>"'{}]|"[^"]*"|'[^']*'|\{[^{}]*\})*?)\/?>/g;
const PILL = /(?<![\w:-])rounded-(?:full|\[(?:9{3,}|\d{4,})px\])(?![\w-])/;
const OTHER_RADIUS = /(?<![\w:-])rounded(?:-(?:none|xs|sm|md|lg|xl|2xl|3xl))?(?![\w-])/;
const LINK_AS_BUTTON = /(?<![\w:-])(?:bg-[\w[\]#/.-]+|btn[\w-]*|button[\w-]*)(?![\w-])/;
const BUTTON_FILE = /(?:^|\/)button\.(?:tsx|jsx|ts|js|vue|svelte)$/i;
const CVA = /\b(?:cva|tv)\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
const BUTTON_SELECTOR = /(?:^|[\s,>+~])(?:button|\.btn[\w-]*|\.button[\w-]*|\.cta[\w-]*|\[role=["']?button["']?\]|a\.btn[\w-]*)(?=$|[\s,:.[>+~{])/i;
const PILL_RADIUS = /border-radius\s*:\s*(?:(\d+(?:\.\d+)?)px|9{3,}\w*|100vmax|50vh|calc\(\s*infinity)/i;
/** "Most buttons" (FD15 Anthropic-named list: "button border-radius >= half its height"): three or more, at least 60%. */
const MIN_PILLS = 3;
const MIN_SHARE = 0.6;
/** A radius of 40px or more makes a pill of any button up to 80px tall. */
const PILL_PX = 40;

/**
 * Pill-shaped buttons everywhere (FD15-F04: Anthropic's Opus 5.5 page lists "pill-shaped buttons" among the defaults
 * to ban). Counts buttons in markup (button elements, Button components, links styled as buttons, role="button"), the
 * button primitive's base classes and CSS button rules; fires once per project when pills are most of them, or when
 * the button primitive itself is a pill.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {ButtonUse[]} */
  const uses = [];
  /** @type {{file: SourceFile, index: number} | null} */
  let primitive = null;
  for (const file of ctx.files) {
    if (file.kind === 'json' || COMPILED.test(file.text)) continue;
    const code = file.code;
    if (BUTTON_FILE.test(file.path) || /\bbuttonVariants\s*=\s*(?:cva|tv)\(/.test(code)) {
      for (const m of code.matchAll(CVA)) {
        if (PILL.test(m[2])) primitive ??= { file, index: (m.index ?? 0) + m[0].indexOf(m[2]) };
        break;
      }
    }
    if (MARKUP.has(file.kind)) {
      for (const m of code.matchAll(TAG)) {
        const classes = [...m[2].matchAll(STRING)].map((s) => s[0].slice(1, -1)).join(' ');
        const isLink = m[1] === 'a' || m[1] === 'Link' || m[1] === 'NavLink';
        if (isLink && !LINK_AS_BUTTON.test(classes)) continue;
        uses.push({ file, index: m.index ?? 0, pill: PILL.test(classes), component: m[1] === 'Button', classes });
      }
      for (const m of code.matchAll(ROLE_BUTTON)) {
        const classes = [...m[1].matchAll(STRING)].map((s) => s[0].slice(1, -1)).join(' ');
        uses.push({ file, index: m.index ?? 0, pill: PILL.test(classes), component: false, classes });
      }
    }
    for (const { css, offset } of cssRegions(file)) {
      for (const block of css.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
        if (!BUTTON_SELECTOR.test(block[1])) continue;
        const radius = PILL_RADIUS.exec(block[2]);
        const index = offset + (block.index ?? 0) + block[1].search(/\S|$/);
        const pill = radius !== null && (radius[1] === undefined || Number(radius[1]) >= PILL_PX);
        if (/border-radius\s*:/i.test(block[2])) uses.push({ file, index, pill, component: false, classes: '' });
      }
    }
  }
  if (primitive) {
    for (const u of uses) if (u.component && !OTHER_RADIUS.test(u.classes)) u.pill = true;
  }
  const pills = uses.filter((u) => u.pill);
  const share = uses.length > 0 ? pills.length / uses.length : 0;
  if (!primitive && (pills.length < MIN_PILLS || share < MIN_SHARE)) return [];
  const at = primitive ?? pills[0];
  const value = { pills: pills.length, buttons: uses.length, primitive: primitive !== null };
  const why = primitive ? 'the button primitive is rounded-full, so every Button renders as a pill' : `${pills.length} of ${uses.length} buttons are pills`;
  return [{
    rule: RULE,
    layer: 'static',
    file: at.file.path,
    line: lineOf(at.file.text, at.index),
    excerpt: excerpt(at.file.text, at.index),
    value,
    detail: `${why}; set the radius by role from the tokens`,
  }];
}

const STYLE_ELEMENT = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const CSS_TEMPLATE = /(?:\b(?:css|keyframes|createGlobalStyle|injectGlobal)|\bstyled(?:\.\w+|\([^()]*\))(?:\.attrs\([^()]*\))?|__html\s*:)\s*`([^`]*)`/g;
const COMPILED = /^(?:\s*@(?:import|charset)\b(?:"[^"]*"|'[^']*'|url\([^)]*\)|[^;"'])*;)*\s*\/\*!\s*tailwindcss\s+v/;

/**
 * The CSS a file carries, with offsets into the file: a whole stylesheet (not a compiled Tailwind bundle), `<style>`
 * elements and CSS template literals.
 * @param {SourceFile} file
 * @returns {Array<{css: string, offset: number}>}
 */
function cssRegions(file) {
  if (file.kind === 'json') return [];
  if (file.kind === 'css') return COMPILED.test(file.text) ? [] : [{ css: file.code, offset: 0 }];
  /** @type {Array<{css: string, offset: number}>} */
  const regions = [];
  for (const m of file.code.matchAll(STYLE_ELEMENT)) regions.push({ css: m[1], offset: (m.index ?? 0) + m[0].indexOf('>') + 1 });
  for (const m of file.code.matchAll(CSS_TEMPLATE)) regions.push({ css: m[1], offset: (m.index ?? 0) + m[0].length - m[1].length - 1 });
  return regions;
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
