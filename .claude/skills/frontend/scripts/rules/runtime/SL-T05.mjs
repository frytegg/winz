// @ts-check
import { parseColor, toHex } from '../../lib/color.mjs';
import { chainOf, gradientStops, laidOut, toHsl } from './SL-T01.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {import('../../lib/color.mjs').Rgba} Rgba
 * @typedef {{sel: string, which: string, width: number, height: number, left: number, top: number,
 *   background: string, backgroundImage: string}} PseudoStripe
 */

const RULE = 'SL-T05';

/** Krebs's accent-stripe rule (FD10-F21, R05): left or top edge only. */
export const STRIPE_MIN = 2;
/** The stripe edge must be more than this many px wider than every other edge. */
export const STRIPE_LEAD = 1;
export const COLOR_ALPHA_MIN = 0.3;
export const SATURATION_MIN = 0.2;
export const ELEMENT_MIN = Object.freeze({ w: 40, h: 20 });
/** `::before` / `::after` stripes of 2 to 10 px on the left or top edge. */
export const PSEUDO_STRIPE = Object.freeze([2, 10]);
/** Krebs skips these elements and anything inside a blockquote or footer. */
export const EXCLUDED_TAGS = Object.freeze(['blockquote', 'footer', 'button', 'hr', 'table', 'td', 'th', 'tr', 'thead', 'tbody']);
/** A "prominent text leaf": bold text, or text this large, inside the card. */
export const PROMINENT = Object.freeze({ weight: 600, size: 18 });
export const MAX_FINDINGS = 20;

/**
 * @param {string} css
 * @returns {number}
 */
function px(css) {
  const n = Number.parseFloat(css);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A colour that reads as an accent: visible enough and saturated (Krebs: alpha >= 0.3, saturation >= 0.2).
 * @param {Rgba | null} c
 * @returns {boolean}
 */
export function accentColor(c) {
  return c !== null && c.a >= COLOR_ALPHA_MIN && toHsl(c).s >= SATURATION_MIN;
}

/**
 * Index range [start, end) of the collected descendants of `index` (collectElements lists in document order, so a
 * subtree is contiguous).
 * @param {ElementInfo[]} elements
 * @param {number} index
 * @returns {[number, number]}
 */
export function subtree(elements, index) {
  const depth = elements[index].depth;
  let end = index + 1;
  while (end < elements.length && elements[end].depth > depth) end += 1;
  return [index + 1, end];
}

/**
 * Whether the card holds what makes a stripe a card accent: a heading, a title- or heading-class child, or a
 * prominent text leaf.
 * @param {ElementInfo[]} elements
 * @param {number} index
 * @returns {boolean}
 */
function holdsHeading(elements, index) {
  const [start, end] = subtree(elements, index);
  for (let i = start; i < end; i += 1) {
    const d = elements[i];
    if (!laidOut(d)) continue;
    if (/^h[1-6]$/.test(d.tag) || d.role === 'heading') return true;
    if (/(?:^|[\s_-])(?:title|heading)(?:$|[\s_-])/i.test(d.meta.class ?? '')) return true;
    const hasText = d.text !== '' && (i + 1 >= end || elements[i + 1].depth <= d.depth);
    if (hasText && (Number(d.styles.fontWeight) >= PROMINENT.weight || px(d.styles.fontSize) >= PROMINENT.size)) return true;
  }
  return false;
}

/**
 * The stripe side of an element's own borders, or null.
 * @param {ElementInfo} e
 * @returns {{side: 'left' | 'top', width: number, color: string} | null}
 */
export function borderStripe(e) {
  const w = { top: px(e.styles.borderTopWidth), right: px(e.styles.borderRightWidth), bottom: px(e.styles.borderBottomWidth), left: px(e.styles.borderLeftWidth) };
  for (const side of /** @type {const} */ (['left', 'top'])) {
    const others = Object.entries(w).filter(([k]) => k !== side).map(([, v]) => v);
    if (w[side] < STRIPE_MIN || w[side] <= Math.max(...others) + STRIPE_LEAD) continue;
    const css = side === 'left' ? e.styles.borderLeftColor : e.styles.borderTopColor;
    if (accentColor(parseColor(css))) return { side, width: w[side], color: css };
  }
  return null;
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
 * Accent stripes on cards: a saturated left or top border edge wider than the others, or a 2-10 px pseudo-element
 * stripe on that edge, on an element of at least 40x20 that holds a heading. Blockquotes, footers, tables, buttons
 * and rules are skipped, as is anything inside a blockquote or footer.
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  /** @type {RuntimeFinding[]} */
  const out = [];
  /** @type {Array<{index: number, e: ElementInfo}>} */
  const pseudoCandidates = [];
  elements.forEach((e, i) => {
    if (!laidOut(e) || e.box.w < ELEMENT_MIN.w || e.box.h < ELEMENT_MIN.h) return;
    if (EXCLUDED_TAGS.includes(e.tag)) return;
    if ([...chainOf(elements, i)].some((k) => k !== i && (elements[k].tag === 'blockquote' || elements[k].tag === 'footer'))) return;
    if (!holdsHeading(elements, i)) return;
    const stripe = borderStripe(e);
    if (stripe) {
      out.push(finding(ctx, e.sel, { source: 'border', ...stripe, color: toHex(/** @type {Rgba} */ (parseColor(stripe.color))) },
        `${stripe.width}px ${stripe.side} accent border on a card <${e.tag}> holding a heading`));
    } else {
      pseudoCandidates.push({ index: i, e });
    }
  });
  if (pseudoCandidates.length > 0) {
    const pseudos = await ctx.page.evaluate((sels) => {
      /** @type {PseudoStripe[]} */
      const found = [];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (!el) continue;
        for (const which of ['::before', '::after']) {
          const cs = getComputedStyle(el, which);
          if (!cs.content || cs.content === 'none' || cs.content === 'normal' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
          found.push({
            sel, which, width: Number.parseFloat(cs.width) || 0, height: Number.parseFloat(cs.height) || 0,
            left: Number.parseFloat(cs.left) || 0, top: Number.parseFloat(cs.top) || 0,
            background: cs.backgroundColor, backgroundImage: cs.backgroundImage,
          });
        }
      }
      return found;
    }, pseudoCandidates.map(({ e }) => e.sel));
    const bySel = new Map(pseudoCandidates.map(({ e }) => [e.sel, e]));
    const reported = new Set();
    for (const p of pseudos) {
      const host = bySel.get(p.sel);
      if (!host || reported.has(p.sel)) continue;
      const fill = parseColor(p.background);
      const painted = accentColor(fill) || gradientStops(p.backgroundImage).flat().some(accentColor);
      if (!painted) continue;
      const [lo, hi] = PSEUDO_STRIPE;
      const left = p.width >= lo && p.width <= hi && p.height >= 0.5 * host.box.h && Math.abs(p.left) <= 2;
      const top = p.height >= lo && p.height <= hi && p.width >= 0.5 * host.box.w && Math.abs(p.top) <= 2;
      if (!left && !top) continue;
      reported.add(p.sel);
      const side = left ? 'left' : 'top';
      out.push(finding(ctx, `${p.sel}${p.which}`, { source: p.which, side, width: left ? p.width : p.height, color: fill && fill.a > 0 ? toHex(fill) : p.backgroundImage.slice(0, 120) },
        `${left ? p.width : p.height}px ${side} accent stripe drawn by ${p.which} on a card <${host.tag}> holding a heading`));
    }
  }
  return out.slice(0, MAX_FINDINGS);
}
