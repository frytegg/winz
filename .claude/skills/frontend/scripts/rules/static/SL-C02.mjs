// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-C02';
const MARKUP = new Set(['js', 'jsx', 'tsx', 'html', 'vue', 'svelte']);
const TAG = /(?<![\w$.)\]])<([A-Za-z][\w.:-]*)\b((?:[^>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*?)\/?>/g;
const VIEWPORT_CLASS = /(?<![\w:-])(?:min-)?h-(?:screen|dvh|svh|lvh|\[(?:100|9\d)(?:vh|dvh|svh|lvh)\])(?![\w-])/;
const VIEWPORT_STYLE = /\b(?:minHeight|height)\s*:\s*["'`](?:100|9\d)(?:vh|dvh|svh|lvh)["'`]/;
const VIEWPORT_CSS = /(?:^|[;{\s])(?:min-)?height\s*:\s*(?:(?:100|9\d)(?:vh|dvh|svh|lvh)|calc\(\s*100(?:vh|dvh|svh|lvh)\s*-\s*\d{1,2}px\s*\))/i;
const HERO_MARK = /hero|banner|splash|landing-top/i;
const HERO_TAG = /^(?:section|header)$|Hero/;
const HERO_SELECTOR = /(?:^|[\s,>.#\[])(?:[\w-]*hero[\w-]*|header|section:first-(?:of-type|child)|\.landing[\w-]*)(?=$|[\s,:.#\[>{])/i;
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;

/**
 * A hero sized to the viewport (FD15-F09, artifact-design: "Size a hero to its content instead of to the viewport; a
 * `100vh` opener pushes the rest of the page out of that first frame"). Fires on h-screen / min-h-screen / 100vh (and
 * dvh, svh, lvh, or a few pixels short of it) on a hero: a section or header element, a Hero component, or an element
 * or selector named hero or banner. App shells that use min-h-screen on body, main or a layout wrapper do not count.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if (file.kind === 'json' || COMPILED.test(file.text)) continue;
    if (MARKUP.has(file.kind)) {
      for (const m of file.code.matchAll(TAG)) {
        const [, name, attrs] = m;
        const classes = [...attrs.matchAll(STRING)].map((s) => s[0].slice(1, -1)).join(' ');
        const sized = VIEWPORT_CLASS.exec(classes)?.[0] ?? VIEWPORT_STYLE.exec(attrs)?.[0];
        if (!sized) continue;
        const hero = HERO_TAG.test(name) || HERO_MARK.test(classes) || /\bid\s*=\s*["'][^"']*(?:hero|banner)/i.test(attrs);
        if (hero && !/^(?:body|html|main)$/i.test(name)) {
          findings.push(finding(file, m.index ?? 0, sized, `<${name}> hero sized to the viewport (${sized}); size it to its content so the proof shows in the first viewport`));
        }
      }
    }
    for (const { css, offset } of cssRegions(file)) {
      for (const block of css.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
        const selector = block[1].trim();
        if (!HERO_SELECTOR.test(selector) || /^(?:html|body|main)\b/i.test(selector)) continue;
        const height = VIEWPORT_CSS.exec(block[2]);
        if (height) findings.push(finding(file, offset + (block.index ?? 0) + block[1].search(/\S|$/), height[0].replace(/^[;{\s]+/, '').trim(), `${selector} sized to the viewport; size the hero to its content`));
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
