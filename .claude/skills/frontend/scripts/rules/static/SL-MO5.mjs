// @ts-check
import { lineOf } from '../../lib/text.mjs';
import { mountedFiles } from './SL-T08.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 * @typedef {{index: number, what: string, via: 'css' | 'class' | 'motion' | 'gsap'}} Site
 */

const RULE = 'SL-MO5';
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
/** Properties whose animation moves, scales or resizes something (WCAG 2.3.3's "motion animation" excludes colour, blur and opacity, FD03-F15). */
const MOVEMENT = /\b(?:transform|translate[XYZ3d]*|scale[XYZ3d]*|rotate[XYZ3d]*|top|left|right|bottom|margin[\w-]*|width|height|inset|offset-distance)\s*[:(]/i;
const KEYFRAMES = /@keyframes\s+([\w-]+)\s*\{/g;
const REDUCE_MEDIA = /@media[^{]*prefers-reduced-motion/i;
/** A reduce query whose block resets animation or transition for the universal selector covers every CSS animation. */
const GLOBAL_REDUCE = /@media[^{]*prefers-reduced-motion\s*:\s*reduce[^{]*\{[^{}]*?(?:^|[\s,{])\*(?=\s*(?:,|\{|::?(?:before|after)))[^{}]*\{[^{}]*(?:animation|transition)/im;
const MOTION_CONFIG = /<MotionConfig\b[^>]*\breducedMotion\s*=\s*["'{]\s*["']?(?:user|always)/;
const JS_HANDLERS = /\buseReducedMotion\b|\bprefersReducedMotion\b|matchMedia\(\s*["'`]\(\s*prefers-reduced-motion|\bgsap\s*\.\s*matchMedia\b|\breducedMotion\s*[:=]/;
const TW_HANDLED = /(?<![\w-])motion-(?:reduce|safe):/;
/** Moving Tailwind animations (loading spinners are left out as essential feedback) and hover or press transforms. */
const TW_MOVING = /(?<![\w-])(?:[\w[\]=-]+:)*(?:animate-(?:bounce|ping|marquee|\[[^\]]*\]|[\w-]*(?:slide|float|wiggle|shake|scroll|zoom|rise|drop|bounce|marquee)[\w-]*)|slide-in-from-[\w-]+|zoom-in-\d+|spin-in-\d+)(?![\w-])|(?<![\w-])(?:hover|group-hover|focus|active):(?:-?translate-[xy]|scale|-?rotate)-[\w[\].-]+(?![\w-])/;
const MOTION_COMPONENT = /<motion\.[\w]+\b[^>]*?\b(?:initial|animate|whileInView|whileHover|whileTap|exit)\s*=\s*\{\{[^{}]*\b(?:x|y|scale|rotate|scaleX|scaleY|translateX|translateY)\s*:/g;
const GSAP_MOVE = /\bgsap\s*\.\s*(?:to|from|fromTo)\s*\([^()]*?,\s*\{[^{}]*\b(?:x|y|xPercent|yPercent|scale|rotation|rotate)\s*:/g;

/**
 * Motion that runs unchanged under prefers-reduced-motion: reduce (FD03-F15: "Reduced motion means fewer and gentler
 * animations, not zero", and nothing in /harden's axe pass checks it; FD16-F21: MotionConfig reducedMotion="user").
 * Finds movement (keyframes that move, scale or resize, transform transitions, moving Tailwind animations and hover
 * transforms, Motion components and GSAP tweens with x, y, scale or rotation) and reports each file whose movement
 * has no handling: a reduced-motion media query in the file or a global one, motion-reduce/motion-safe variants on the
 * element, MotionConfig reducedMotion, useReducedMotion or a matchMedia check. Opacity and colour only is fine.
 * Only files an entry point mounts count (SL-T08 mountedFiles): a vendored effect or a components/ui primitive
 * that nothing imports never renders (FD14-F12, FD14-F22).
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  const sources = ctx.files.filter((f) => f.kind !== 'json' && !COMPILED.test(f.text));
  const globalCss = sources.some((f) => GLOBAL_REDUCE.test(f.code));
  const globalMotion = sources.some((f) => MOTION_CONFIG.test(f.code));
  const movingKeyframes = keyframesThatMove(sources);
  /** @type {StaticFinding[]} */
  const findings = [];
  const mounted = mountedFiles(ctx.files);
  for (const file of sources) {
    if (mounted && !mounted.has(file.path)) continue;
    const code = file.code;
    const fileHandled = REDUCE_MEDIA.test(code) || JS_HANDLERS.test(code);
    /** @type {Site[]} */
    const sites = [];
    for (const { css, offset } of cssRegions(file)) {
      for (const block of css.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
        const body = block[2];
        const at = offset + (block.index ?? 0) + block[1].search(/\S|$/);
        const animation = /\banimation(?:-name)?\s*:\s*([^;]+)/i.exec(body);
        const moving = animation?.[1].split(/[\s,]+/).find((n) => movingKeyframes.has(n));
        if (moving) sites.push({ index: at, what: `animation ${moving}`, via: 'css' });
        const transition = /\btransition(?:-property)?\s*:\s*([^;]+)/i.exec(body);
        if (transition && /\b(?:transform|translate|scale|rotate|all)\b/i.test(transition[1]) && /:hover|:focus|:active|\[data-state|\.(?:open|active|is-)/i.test(block[1])) {
          sites.push({ index: at, what: `transition of ${transition[1].trim().split(/\s+/)[0]}`, via: 'css' });
        }
      }
    }
    if (file.kind !== 'css') {
      for (const m of code.matchAll(STRING)) {
        const value = m[0].slice(1, -1);
        const moving = TW_MOVING.exec(value);
        if (moving && !TW_HANDLED.test(value)) sites.push({ index: (m.index ?? 0) + 1, what: moving[0], via: 'class' });
      }
      for (const m of code.matchAll(MOTION_COMPONENT)) sites.push({ index: m.index ?? 0, what: 'a Motion component that moves', via: 'motion' });
      for (const m of code.matchAll(GSAP_MOVE)) sites.push({ index: m.index ?? 0, what: 'a GSAP tween that moves', via: 'gsap' });
    }
    const unhandled = sites.filter((s) => {
      if (fileHandled) return false;
      if (s.via === 'css' || s.via === 'class') return !globalCss;
      if (s.via === 'motion') return !globalMotion;
      return true;
    }).sort((a, b) => a.index - b.index);
    if (unhandled.length === 0) continue;
    const first = unhandled[0];
    findings.push({
      rule: RULE,
      layer: 'static',
      file: file.path,
      line: lineOf(file.text, first.index),
      excerpt: excerpt(file.text, first.index),
      value: { sites: unhandled.length, first: first.what },
      detail: `${unhandled.length} moving animation(s) with no prefers-reduced-motion handling (first: ${first.what}); keep opacity and colour, remove movement under reduce`,
    });
  }
  return findings;
}

/**
 * Names of keyframes that animate a movement property in any frame.
 * @param {SourceFile[]} files
 * @returns {Set<string>}
 */
function keyframesThatMove(files) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const file of files) {
    for (const m of file.code.matchAll(KEYFRAMES)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      if (MOVEMENT.test(file.code.slice(open, blockEnd(file.code, open)))) names.add(m[1]);
    }
  }
  return names;
}

/**
 * Index just past the brace closing the block opened at `open`, or the end of the code.
 * @param {string} code
 * @param {number} open
 * @returns {number}
 */
function blockEnd(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}' && --depth === 0) return i + 1;
  }
  return code.length;
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
