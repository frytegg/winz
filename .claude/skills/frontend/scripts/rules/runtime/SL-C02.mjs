// @ts-check
/*
 * SL-C02: the 100vh hero. "Size a hero to its content instead of to the viewport; a 100vh opener pushes the rest of
 * the page out of that first frame" [FD15-F09] [FD15 Anthropic-named tells]. The hero is the first-viewport h1's
 * nearest ancestor that starts near the top, fills at least 90% of the viewport height and is sized by the viewport:
 * a computed min-height equal to the viewport height, or a matching height/min-height rule (style sheet or inline) of
 * 80 viewport units or more. A box that merely happens to be as tall as the viewport never counts, a wrapper holding
 * the whole page pushes nothing out, and a full-bleed product canvas is the documented false positive.
 */
import { selectorFor } from '../../lib/dom.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').Box} Box
 * @typedef {{sel: string, box: Box, via: string, height: string, minHeight: string, viewport: number}} Hero
 */

export const RULE = 'SL-C02';
/** The hero fills at least this share of the viewport height. */
export const MIN_FILL = 0.9;
/** A declared height of at least this many viewport units sizes the box by the viewport. */
export const MIN_VH = 80;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const hero = /** @type {Hero | null} */ (
    await ctx.page.evaluate(`(${viewportHero.toString()})(${selectorFor.toString()}, ${JSON.stringify({ minFill: MIN_FILL, minVh: MIN_VH })})`)
  );
  if (!hero) return [];
  return [{
    rule: RULE,
    layer: 'runtime',
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector: hero.sel,
    box: hero.box,
    value: { count: 1, items: [{ selector: hero.sel, box: hero.box, via: hero.via, height: hero.height, minHeight: hero.minHeight }], viewportHeight: hero.viewport },
    detail: `the hero ${hero.sel} is sized to the viewport (${hero.via}; ${Math.round(hero.box.h)} of ${hero.viewport} px) and pushes the next section out of the first frame; size it to its content`,
  }];
}

/**
 * In-page: the viewport-sized hero around the first-viewport h1, or null. Receives the selectorFor of lib/dom.mjs.
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorOf
 * @param {{minFill: number, minVh: number}} limits
 * @returns {Hero | null}
 */
export const viewportHero = function viewportHero(selectorOf, limits) {
  const vh = window.innerHeight;
  const h1 = Array.from(document.querySelectorAll('h1')).find((h) => {
    const r = h.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top + window.scrollY < vh;
  });
  if (!h1) return null;
  /** @param {string} value @returns {boolean} */
  const viewportUnits = (value) => [...value.matchAll(/([\d.]+)\s*[dsl]?vh\b/g)].some((m) => Number(m[1]) >= limits.minVh);
  /** @type {string[]} */
  const selectors = [];
  /** @param {CSSRuleList} rules */
  const visit = (rules) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSMediaRule && !window.matchMedia(rule.media.mediaText).matches) continue;
      if (rule instanceof CSSStyleRule) {
        const s = rule.style;
        if (['height', 'min-height', 'block-size', 'min-block-size'].some((p) => viewportUnits(s.getPropertyValue(p)))) selectors.push(rule.selectorText);
      }
      if ('cssRules' in rule && rule.cssRules) visit(/** @type {CSSRuleList} */ (rule.cssRules));
    }
  };
  let unreadable = 0;
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visit(sheet.cssRules);
    } catch {
      unreadable += 1;
    }
  }
  const docHeight = document.documentElement.scrollHeight;
  for (let el = h1.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    const r = el.getBoundingClientRect();
    const top = r.top + window.scrollY;
    if (r.height < limits.minFill * vh || top > 0.25 * vh) continue;
    const cs = getComputedStyle(el);
    const minHeight = Number.parseFloat(cs.minHeight);
    /** @type {string[]} */
    const via = [];
    if (Number.isFinite(minHeight) && Math.abs(minHeight - vh) <= 2) via.push(`min-height ${cs.minHeight}`);
    if (el instanceof HTMLElement && (viewportUnits(el.style.height) || viewportUnits(el.style.minHeight))) via.push('inline style in vh');
    const rule = selectors.find((s) => {
      try {
        return el.matches(s);
      } catch {
        unreadable += 1;
        return false;
      }
    });
    if (rule) via.push(`rule "${rule.slice(0, 60)}"`);
    if (via.length === 0) continue;
    if (top + r.height >= docHeight - 50) return null;
    const area = r.width * r.height;
    const canvas = Array.from(el.querySelectorAll('canvas, video, iframe')).some((m) => {
      const b = m.getBoundingClientRect();
      return b.width * b.height >= 0.5 * area;
    });
    if (canvas) return null;
    return {
      sel: selectorOf(el, new Map()),
      box: { x: Math.round(r.left + window.scrollX), y: Math.round(top), w: Math.round(r.width), h: Math.round(r.height) },
      via: via.join(', ') + (unreadable ? ` (${unreadable} style sheet(s) or selector(s) unreadable)` : ''),
      height: cs.height,
      minHeight: cs.minHeight,
      viewport: vh,
    };
  }
  return null;
};
