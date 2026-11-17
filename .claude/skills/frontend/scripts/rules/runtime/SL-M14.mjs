// @ts-check
/*
 * SL-M14: decorative grid-line backgrounds, pulsing status dots and blinking cursors (impeccable's
 * codex-grid-background, pulsing-dot and blinking-cursor) [FD10-F28] [FD10 M14]. A grid background is a tiled layer
 * of 1-2 px line gradients; a pulsing dot is a small round element under an endless opacity, scale or shadow loop; a
 * blinking cursor is an endless on-off opacity loop on a caret-sized element or glyph. Real live indicators are the
 * documented false positive: a dot inside an element with a data-source, an aria-live region or a status role is left
 * alone. getAnimations() lists the loops; rAF-driven ones stay invisible to it [FD03-F25].
 */
import { selectorFor } from '../../lib/dom.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').Box} Box
 * @typedef {{kind: 'grid-lines' | 'pulsing-dot' | 'blinking-cursor', sel: string, box: Box, detail: string}} Hit
 */

export const RULE = 'SL-M14';
export const MAX_FINDINGS = 20;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const hits = /** @type {Hit[]} */ (await ctx.page.evaluate(`(${decorativeLoops.toString()})(${selectorFor.toString()})`));
  return hits.slice(0, MAX_FINDINGS).map((h) => ({
    rule: RULE,
    layer: /** @type {const} */ ('runtime'),
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector: h.sel,
    box: h.box,
    value: { kind: h.kind, measured: h.detail, total: hits.length },
    detail: `decorative ${h.kind} (${h.detail}); remove it or bind it to real state`,
  }));
}

/**
 * In-page: tiled hairline grid backgrounds, pulsing dots not tied to live data, and blinking cursors. Receives the
 * selectorFor of lib/dom.mjs.
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorOf
 * @returns {Hit[]}
 */
export const decorativeLoops = function decorativeLoops(selectorOf) {
  const counts = new Map();
  /** @type {Hit[]} */
  const out = [];
  /** @param {Element} el */
  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };
  /** @param {string} value @returns {string[]} */
  const layers = (value) => {
    /** @type {string[]} */
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < value.length; i += 1) {
      if (value[i] === '(') depth += 1;
      else if (value[i] === ')') depth -= 1;
      else if (value[i] === ',' && depth === 0) {
        parts.push(value.slice(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(value.slice(start).trim());
    return parts;
  };
  const hairline = /([\d.]+)px,\s*(?:rgba\([^()]*,\s*0\)|transparent)\s+\1px/;
  const seen = new Set();
  for (const el of Array.from(document.querySelectorAll('body, body *'))) {
    const cs = getComputedStyle(el);
    if (!cs.backgroundImage || cs.backgroundImage === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 200 || r.height < 120) continue;
    const imageLayers = layers(cs.backgroundImage);
    const sizes = layers(cs.backgroundSize);
    const lines = imageLayers.filter((layer, i) => {
      const m = hairline.exec(layer);
      if (!m || Number(m[1]) > 2) return false;
      if (/^repeating-linear-gradient\(/.test(layer)) return true;
      if (!/^linear-gradient\(/.test(layer)) return false;
      const size = sizes[i % sizes.length] || 'auto';
      const first = Number.parseFloat(size);
      return /px/.test(size) && first > 0 && first <= 200;
    });
    if (lines.length > 0) {
      out.push({ kind: 'grid-lines', sel: selectorOf(el, counts), box: boxOf(el), detail: `${lines.length} hairline gradient layer(s) tiled at ${cs.backgroundSize}` });
      seen.add(el);
    }
  }
  /** @param {Element} el */
  const live = (el) => Boolean(el.closest('[aria-live], [role="status"], [role="log"], [data-source]:not([data-source=""])'));
  for (const animation of document.getAnimations()) {
    const effect = animation.effect;
    if (!(effect instanceof KeyframeEffect) || !effect.target) continue;
    if (effect.getTiming().iterations !== Infinity) continue;
    const el = effect.target;
    if (seen.has(el)) continue;
    const frames = effect.getKeyframes();
    const props = new Set(frames.flatMap((f) => Object.keys(f)));
    const r = el.getBoundingClientRect();
    const w = el instanceof HTMLElement ? el.offsetWidth : r.width;
    const h = el instanceof HTMLElement ? el.offsetHeight : r.height;
    const cs = getComputedStyle(el);
    const radius = cs.borderTopLeftRadius.endsWith('%') ? (Number.parseFloat(cs.borderTopLeftRadius) / 100) * w : Number.parseFloat(cs.borderTopLeftRadius) || 0;
    const opacities = frames.map((f) => Number(f.opacity)).filter((n) => Number.isFinite(n));
    const pulses = ['opacity', 'transform', 'scale', 'boxShadow'].some((p) => props.has(p));
    const name = typeof CSSAnimation !== 'undefined' && animation instanceof CSSAnimation ? animation.animationName : animation.id;
    if (w >= 4 && w <= 16 && h >= 4 && h <= 16 && Math.abs(w - h) <= 3 && radius >= 0.4 * w && pulses) {
      if (!live(el)) {
        out.push({ kind: 'pulsing-dot', sel: selectorOf(el, counts), box: boxOf(el), detail: `${Math.round(w)}x${Math.round(h)} px dot, loop ${name || 'unnamed'}` });
        seen.add(el);
      }
      continue;
    }
    const onOff = opacities.some((o) => o <= 0.1) && opacities.some((o) => o >= 0.9);
    if (!onOff) continue;
    const stepped = frames.some((f) => /step/.test(String(f.easing))) || /step/.test(String(effect.getTiming().easing));
    const abrupt = frames.some((f, i) => i > 0 && Math.abs(Number(f.computedOffset) - Number(frames[i - 1].computedOffset)) <= 0.05 && Number(f.opacity) !== Number(frames[i - 1].opacity));
    const pseudo = effect.pseudoElement ? getComputedStyle(el, effect.pseudoElement).content : '';
    const glyph = /^["']?[|_▋▌▍▏█]["']?$/.test(pseudo) || /^[|_▋▌▍▏█]$/.test((el.textContent || '').trim());
    const caretSized = w <= 6 && h >= 8 && h <= 64;
    if ((stepped || abrupt || /blink|caret|cursor/i.test(name)) && (glyph || caretSized)) {
      out.push({ kind: 'blinking-cursor', sel: selectorOf(el, counts), box: boxOf(el), detail: `on-off opacity loop ${name || 'unnamed'}` });
      seen.add(el);
    }
  }
  return out;
};
