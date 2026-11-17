// @ts-check
import { lineOf } from '../../lib/text.mjs';
import { mountedFiles } from './SL-T08.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-MO1';
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
const TRANSITION_ALL = /(?<![\w-])(?:[\w-]+:)*transition-all(?![\w-])/;
const INTERACTIVE_TAG = /^(?:button|Button|a|Link|NavLink|input|select|textarea|summary|label|IconButton|[A-Z]\w*Button)$/;
/** A class string that is pressable or focusable whatever its tag: press, focus or pointer-cursor utilities. */
const INTERACTION_STATE = /(?<![\w-])(?:active|focus|focus-visible|aria-pressed):|(?<![\w-])cursor-pointer(?![\w-])/;
const BUTTON_FILE = /(?:^|\/)button\.(?:tsx|jsx|ts|js|vue|svelte)$/i;
const INTERACTIVE_SELECTOR = /(?:^|[\s,>+~(])(?:button|a|input|select|textarea|summary|\.btn[\w-]*|\.button[\w-]*|\.link[\w-]*|\.cta[\w-]*|\[role=["']?button["']?\])(?=$|[\s,:.[>+~)])/i;
/** `transition: all ...`, `transition-property: all`, or a shorthand that starts with a time and so animates all properties. */
const CSS_ALL = /(?:^|[;{\s])transition\s*:\s*(?:all\b|-?[\d.]+m?s\b)|(?:^|[;{\s])transition-property\s*:\s*all\b/i;
const INLINE_ALL = /\btransition\s*:\s*["'`](?:all\b|-?[\d.]+m?s\b)|\btransitionProperty\s*:\s*["'`]all\b/g;

/**
 * `transition: all` on buttons and links (FD03-F08: Tailwind's transition-all is the weak default Emil's skill
 * rejects, and Vercel's guidelines say "Never transition: all", FD03-F28). Reports transition-all class strings on
 * interactive elements, on class strings that carry hover, focus or active states, and in a button primitive; CSS
 * rules for interactive selectors whose transition is `all` or a shorthand with no property; and inline style
 * objects on interactive elements.
 * Only files an entry point mounts count (SL-T08 mountedFiles): a vendored effect or a components/ui primitive
 * that nothing imports never renders (FD14-F12, FD14-F22).
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {StaticFinding[]} */
  const findings = [];
  const mounted = mountedFiles(ctx.files);
  for (const file of ctx.files) {
    if (mounted && !mounted.has(file.path)) continue;
    if (file.kind === 'json' || COMPILED.test(file.text)) continue;
    const code = file.code;
    if (file.kind !== 'css') {
      const primitive = BUTTON_FILE.test(file.path) || /\bbuttonVariants\s*=/.test(code);
      for (const m of code.matchAll(STRING)) {
        const value = m[0].slice(1, -1);
        if (!TRANSITION_ALL.test(value)) continue;
        const at = (m.index ?? 0) + 1;
        const owner = ownerTag(code, at);
        if (INTERACTIVE_TAG.test(owner) || INTERACTION_STATE.test(value) || primitive) {
          findings.push(finding(file, at, 'transition-all', `transition-all on ${owner ? `<${owner}>` : 'an interactive element'}; name the properties (colour, opacity, transform) and use the motion tokens`));
        }
      }
      for (const m of code.matchAll(INLINE_ALL)) {
        const at = m.index ?? 0;
        const owner = ownerTag(code, at);
        if (INTERACTIVE_TAG.test(owner)) findings.push(finding(file, at, m[0], `inline transition on all properties of <${owner}>; name the properties`));
      }
    }
    for (const { css, offset } of cssRegions(file)) {
      for (const block of css.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
        const selector = block[1].trim();
        if (!INTERACTIVE_SELECTOR.test(selector)) continue;
        const all = CSS_ALL.exec(block[2]);
        if (all) {
          const at = offset + (block.index ?? 0) + block[1].length + 1 + (all.index ?? 0);
          findings.push(finding(file, at, all[0].replace(/^[;{\s]+/, ''), `${selector}: transition on all properties; name the properties and use the motion tokens`));
        }
      }
    }
  }
  return findings;
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
 * Name of the markup tag whose attributes contain `index`, or '' outside a tag.
 * @param {string} code
 * @param {number} index
 * @returns {string}
 */
function ownerTag(code, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0 && index - i < 3000; i -= 1) {
    const c = code[i];
    if (c === '}') depth += 1;
    else if (c === '{') depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === '>' && code[i - 1] !== '=') return '';
    else if (depth === 0 && c === '<') {
      const m = /^<([A-Za-z][\w.:-]*)/.exec(code.slice(i, i + 80));
      return m ? m[1] : '';
    }
  }
  return '';
}

/**
 * @param {SourceFile} file
 * @param {number} index
 * @param {unknown} value
 * @param {string} detail
 * @returns {StaticFinding}
 */
function finding(file, index, value, detail) {
  return { rule: RULE, layer: 'static', file: file.path, line: lineOf(file.text, index), excerpt: excerpt(file.text, index), value, detail };
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
