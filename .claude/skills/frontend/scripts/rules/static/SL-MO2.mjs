// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-MO2';
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
/** CSS `ease-in` (not ease-in-out) or Tailwind's ease-in curve cubic-bezier(0.4, 0, 1, 1) (FD03-F08). */
const CSS_EASE_IN = /(?<![\w-])ease-in(?![\w-])|cubic-bezier\(\s*0?\.4\s*,\s*0\s*,\s*1\s*,\s*1\s*\)/i;
const ENTRANCE_NAME = /(?:^|[-_])(?:in|enter|appear|show|reveal|open|pop)(?:$|[-_])|(?:In|Enter|Appear|Show|Reveal|Open)(?:$|[A-Z_-])|^(?:fade|slide|zoom|scale|grow|rise|drop)(?:[-_]?(?:up|down|left|right))?$/;
const EXIT_NAME = /out|exit|leave|close|hide|dismiss|disappear/i;
const ENTRANCE_SELECTOR = /\[data-state=["']?open["']?\]|\[open\]|:popover-open|[-_](?:enter|appear)(?:[-_]active|[-_]to)?\b|\.(?:show|open|visible|is-visible|is-open|in)\b|@starting-style/i;
const TW_EASE_IN = /(?<![\w-])((?:[\w[\]=-]+:)*)ease-in(?![\w-])/g;
const TW_ENTRANCE = /(?<![\w-])(?:animate-in|fade-in(?:-\d+)?|zoom-in(?:-\d+)?|slide-in-from-[\w-]+|(?:data-\[state=open\]|data-open|open|starting):[\w[\]-]+)(?![\w-])/;
const MOTION_EASE_IN = /\bease\s*:\s*(?:(["'`])easeIn\1|\[\s*0?\.4\s*,\s*0\s*,\s*1\s*,\s*1\s*\])/g;
const GSAP_EASE_IN = /\bease\s*:\s*(["'`])(?:power[0-4]|expo|circ|back|sine|quad|cubic|quart|quint)\.in\1/g;
const MOTION_KEYS = /\b(exit|hidden|out|leave|close|initial|animate|whileInView|whileHover|visible|show|enter|open)\s*[:=]/g;

/**
 * ease-in on UI entrances (FD03-F06: "Never use ease-in for UI animations. It starts slow, which makes the interface
 * feel sluggish"; enter and exit use ease-out). Reports CSS animations of entrance keyframes or entrance-state
 * transitions timed ease-in (or Tailwind's ease-in curve), Tailwind entrance utilities paired with ease-in, Motion
 * transitions with easeIn outside an exit, and GSAP `.in` eases on from() tweens. Exits that leave along the same path
 * are the documented exception and are skipped.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  const keyframes = entranceKeyframes(ctx.files);
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if (file.kind === 'json' || COMPILED.test(file.text)) continue;
    const code = file.code;
    for (const { css, offset } of cssRegions(file)) {
      for (const block of css.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
        const selector = block[1].trim();
        const body = block[2];
        const ease = CSS_EASE_IN.exec(body);
        if (!ease) continue;
        const at = offset + (block.index ?? 0) + block[1].length + 1 + (ease.index ?? 0);
        const animation = /\banimation(?:-name)?\s*:\s*([^;]+)/i.exec(body);
        const names = animation ? animation[1].split(/[\s,]+/).filter((n) => keyframes.has(n)) : [];
        const entering = names.find((n) => !EXIT_NAME.test(n));
        if (entering) {
          findings.push(finding(file, at, ease[0], `entrance animation ${entering} timed ease-in; use the ease-out token`));
        } else if (/\btransition/i.test(body) && ENTRANCE_SELECTOR.test(selector) && !EXIT_NAME.test(selector)) {
          findings.push(finding(file, at, ease[0], `${selector}: entrance transition timed ease-in; use the ease-out token`));
        }
      }
    }
    if (file.kind === 'css') continue;
    for (const m of code.matchAll(STRING)) {
      const value = m[0].slice(1, -1);
      for (const e of value.matchAll(TW_EASE_IN)) {
        const variant = e[1];
        const enteringVariant = /(?:data-\[state=open\]|data-open|open|starting):$/.test(variant);
        const exitVariant = /closed\]?:$|close:$/.test(variant);
        if (enteringVariant || (!exitVariant && TW_ENTRANCE.test(value))) {
          findings.push(finding(file, (m.index ?? 0) + 1 + (e.index ?? 0), e[0], 'entrance utilities timed ease-in; use the ease-out token'));
        }
      }
    }
    for (const m of code.matchAll(MOTION_EASE_IN)) {
      const at = m.index ?? 0;
      const key = [...code.slice(Math.max(0, at - 300), at).matchAll(MOTION_KEYS)].pop()?.[1];
      if (key && /^(?:exit|hidden|out|leave|close)$/.test(key)) continue;
      findings.push(finding(file, at, m[0], 'Motion entrance with easeIn; use the ease-out token'));
    }
    for (const m of code.matchAll(GSAP_EASE_IN)) {
      const at = m.index ?? 0;
      if (/gsap\s*\.\s*(?:from|fromTo)\s*\(|\.from(?:To)?\s*\(/.test(code.slice(Math.max(0, at - 200), at))) {
        findings.push(finding(file, at, m[0], 'GSAP from() entrance with an .in ease; use an .out ease'));
      }
    }
  }
  return findings;
}

/**
 * Names of keyframes that bring something in: named as an entrance, or starting transparent, scaled or offset and
 * ending at rest.
 * @param {SourceFile[]} files
 * @returns {Set<string>}
 */
function entranceKeyframes(files) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const file of files) {
    if (file.kind === 'json') continue;
    for (const m of file.code.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\}\s*)\}/g)) {
      const [, name, body] = m;
      if (EXIT_NAME.test(name)) continue;
      const from = /(?<![\d.])(?:from|0%)\s*\{([^}]*)\}/.exec(body)?.[1] ?? '';
      const startsHidden = /opacity\s*:\s*0(?![.\d])|translate|scale\(\s*0?\.\d|scale\(\s*0\s*\)/i.test(from);
      if (ENTRANCE_NAME.test(name) || startsHidden) names.add(name);
    }
  }
  return names;
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
