// @ts-check
import { parseColor, toHex } from '../../lib/color.mjs';
import { selectorFor } from '../../lib/dom.mjs';
import { laidOut } from './SL-T01.mjs';
import { platformFonts } from './SL-T04.mjs';

/*
 * SL-T18 runtime: Krebs's hero-font-mix (FD10 T18, R18): the largest heading, at 32 px or more, mixes two rendered
 * families, roman and italic, or two paints. Display text only (critic C11): prose emphasis in serif italic, as on
 * Emil Kowalski's own blog, is never looked at.
 */

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {import('playwright-core').Page} Page
 * @typedef {{sel: string, text: string, family: string, style: string, paint: string, mono: boolean}} Segment
 */

const RULE = 'SL-T18';

export const DISPLAY_MIN = 32;
/** Krebs ignores monospace and icon fonts when he compares families. */
export const ICON_FONT = /icon|awesome|material symbols|material icons|glyph|emoji/i;

/**
 * In-page: the text segments of one heading, each with its owner element, computed family, style and paint (a
 * gradient clipped to the text counts as its own paint).
 * @param {(el: Element) => string} selectorOf
 * @param {{sel: string}} arg
 * @returns {Segment[]}
 */
function headingSegments(selectorOf, arg) {
  const heading = document.querySelector(arg.sel);
  if (!heading) return [];
  /** @type {Segment[]} */
  const out = [];
  const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.nodeValue || '').replace(/\s+/g, ' ').trim();
    const owner = n.parentElement;
    if (!text || !owner) continue;
    if (typeof owner.checkVisibility === 'function' && !owner.checkVisibility({ visibilityProperty: true })) continue;
    const cs = getComputedStyle(owner);
    const clip = cs.backgroundClip === 'text' || cs.getPropertyValue('-webkit-background-clip') === 'text';
    const fill = cs.getPropertyValue('-webkit-text-fill-color') || cs.color;
    const paint = clip && cs.backgroundImage.includes('gradient(') ? `gradient ${cs.backgroundImage}` : fill;
    out.push({
      sel: selectorOf(owner), text: text.slice(0, 60), family: cs.fontFamily, style: cs.fontStyle, paint,
      mono: /\bmonospace\b/i.test(cs.fontFamily) || owner.closest('code, kbd, samp') !== null,
    });
  }
  return out;
}

/**
 * Runs `fn(selectorFor, arg)` inside the page with lib/dom.mjs's selector function in scope.
 * @template A, R
 * @param {Page} page
 * @param {(selectorOf: (el: Element) => string, arg: A) => R} fn
 * @param {A} arg
 * @returns {Promise<R>}
 */
function inPage(page, fn, arg) {
  return /** @type {Promise<R>} */ (page.evaluate(`(${fn.toString()})(${selectorFor.toString()}, ${JSON.stringify(arg) ?? 'undefined'})`));
}

/**
 * One comparable key per paint: the hex of a colour, or the gradient itself.
 * @param {string} paint
 * @returns {string}
 */
function paintKey(paint) {
  if (paint.startsWith('gradient ')) return paint;
  const c = parseColor(paint);
  return c ? toHex(c) : paint;
}

/**
 * @param {RuntimeContext} ctx
 * @param {string} selector
 * @param {unknown} value
 * @param {string} detail
 * @returns {RuntimeFinding}
 */
function finding(ctx, selector, value, detail) {
  return { rule: RULE, layer: 'runtime', route: ctx.route?.path ?? '', viewport: ctx.viewport?.name ?? '', selector, value, detail };
}

/**
 * The largest laid-out heading (h1-h6 or role=heading, first on ties); when it is 32 px or more and its text
 * segments, monospace and icon fonts aside, render in two families, mix roman and italic, or carry two paints.
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  /** @type {ElementInfo | null} */
  let largest = null;
  let size = 0;
  for (const e of elements) {
    if (!laidOut(e) || !(/^h[1-6]$/.test(e.tag) || e.role === 'heading') || e.text === '') continue;
    const fontSize = Number.parseFloat(e.styles.fontSize) || 0;
    if (fontSize > size) {
      largest = e;
      size = fontSize;
    }
  }
  if (!largest || size < DISPLAY_MIN) return [];
  const segments = (await inPage(ctx.page, headingSegments, { sel: largest.sel })).filter((s) => !s.mono);
  if (segments.length < 2) return [];
  const fonts = await platformFonts(ctx.page, [...new Set(segments.map((s) => s.sel))]);
  /** @param {Segment} s @returns {string} */
  const familyOf = (s) => {
    const used = (fonts.get(s.sel) ?? []).filter((f) => !ICON_FONT.test(f.familyName)).sort((a, b) => b.glyphCount - a.glyphCount);
    return used.length > 0 ? used[0].familyName : '';
  };
  const measured = segments.map((s) => ({ ...s, rendered: familyOf(s) })).filter((s) => s.rendered !== '' && !ICON_FONT.test(s.family));
  if (measured.length < 2) return [];
  const families = [...new Set(measured.map((s) => s.rendered))];
  const styles = [...new Set(measured.map((s) => (s.style === 'normal' ? 'roman' : 'italic')))];
  const paints = [...new Set(measured.map((s) => paintKey(s.paint)))];
  /** @type {string[]} */
  const mixes = [];
  if (families.length >= 2) mixes.push(`families ${families.join(' + ')}`);
  if (styles.length >= 2) mixes.push('roman + italic');
  if (paints.length >= 2) mixes.push(`${paints.length} paints`);
  if (mixes.length === 0) return [];
  return [finding(ctx, largest.sel, {
    tag: largest.tag, fontSize: size, families, styles, paints: paints.map((p) => p.slice(0, 120)),
    segments: measured.map((s) => ({ text: s.text, family: s.rendered, style: s.style, paint: paintKey(s.paint).slice(0, 80) })),
  }, `largest heading <${largest.tag}> at ${size}px mixes ${mixes.join(', ')}`)];
}
