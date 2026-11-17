// @ts-check
import { ACHROMATIC_CHROMA, toHex, toOklch } from '../../lib/color.mjs';
import { selectorFor } from '../../lib/dom.mjs';
import { gradientStops } from './SL-T01.mjs';

/*
 * SL-T20 runtime: grain over a gradient (FD10 T20, R20): a full-size fixed or absolute overlay, pointer-events none,
 * opacity below 0.3, painting noise (a noise or grain image, an SVG feTurbulence, inline or as a data URL), over an
 * element painted with a chromatic gradient. A grain over a luminance-only vignette is not the tell (FD14-F16: XRPL's
 * paper grain over a black radial vignette).
 */

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').Box} Box
 * @typedef {import('playwright-core').Page} Page
 * @typedef {{sel: string, kind: string, box: Box, opacity: number, source: string, under: number[], cover: Box}} Overlay
 * @typedef {{sel: string, backgroundImage: string, box: Box}} GradientLayer
 * @typedef {{overlays: Overlay[], gradients: GradientLayer[]}} GrainScan
 */

const RULE = 'SL-T20';

export const OPACITY_MAX = 0.3;
/** Full size: the overlay covers half the viewport (fixed) or 80% of the box it sits in (absolute). */
export const VIEWPORT_COVER = 0.5;
export const CONTAINER_COVER = 0.8;
/** The gradient under the grain must share at least half of the smaller box. */
export const SHARED_AREA = 0.5;
export const MAX_FINDINGS = 10;

/**
 * In-page: noise overlays (elements and ::before / ::after) and the gradients painted under each of them.
 * @param {(el: Element) => string} selectorOf
 * @param {{opacityMax: number, viewportCover: number, containerCover: number}} arg
 * @returns {GrainScan}
 */
function scanGrain(selectorOf, arg) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  /** @param {DOMRect} r @returns {Box} */
  const doc = (r) => ({ x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height });
  /** @param {string} css @returns {string} */
  const noiseIn = (css) => {
    for (const m of css.matchAll(/url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^"'\s)]+))\s*\)/g)) {
      const url = m[1] ?? m[2] ?? m[3] ?? '';
      if (/^data:image\/svg\+xml/i.test(url)) {
        let body = url.slice(url.indexOf(',') + 1);
        try {
          body = /;base64,/i.test(url) ? atob(body) : decodeURIComponent(body);
        } catch {
          body = url;
        }
        if (/feturbulence/i.test(body)) return 'svg data URL with feTurbulence';
      } else if (/noise|grain/i.test(url.split(/[?#]/)[0])) {
        return `image ${url.slice(0, 120)}`;
      }
    }
    return '';
  };
  /** @param {Element} el @returns {string} */
  const filterNoise = (el) => {
    const filter = getComputedStyle(el).filter;
    const ref = /url\(\s*["']?#([^"')]+)["']?\s*\)/.exec(filter);
    if (ref) {
      const target = document.getElementById(ref[1]);
      if (target && target.querySelector('feTurbulence')) return `filter url(#${ref[1]}) with feTurbulence`;
    }
    if (el.localName === 'svg' && el.querySelector('feTurbulence')) return 'inline svg feTurbulence';
    const svg = el.querySelector(':scope > svg');
    if (svg && svg.querySelector('feTurbulence')) return 'inline svg feTurbulence';
    return '';
  };
  /** @type {Element[]} */
  const gradientEls = [];
  /** @type {GradientLayer[]} */
  const gradients = [];
  const root = document.documentElement;
  const rootImage = getComputedStyle(root).backgroundImage;
  if (rootImage.includes('gradient(')) {
    gradientEls.push(root);
    gradients.push({ sel: 'html', backgroundImage: rootImage, box: { x: 0, y: 0, w: root.scrollWidth, h: root.scrollHeight } });
  }
  /** @type {Array<{el: Element, kind: string, box: Box, opacity: number, source: string, cover: Box}>} */
  const found = [];
  const skip = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'title', 'head', 'base']);
  for (const el of Array.from(document.querySelectorAll('body, body *'))) {
    if (skip.has(el.localName) || (el.localName !== 'svg' && el.closest('svg'))) continue;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (cs.backgroundImage.includes('gradient(') && rect.width > 0 && rect.height > 0) {
      gradientEls.push(el);
      gradients.push({ sel: selectorOf(el), backgroundImage: cs.backgroundImage, box: doc(rect) });
    }
    for (const which of ['', '::before', '::after']) {
      const ps = which ? getComputedStyle(el, which) : cs;
      if (which && (!ps.content || ps.content === 'none' || ps.content === 'normal')) continue;
      if (ps.display === 'none' || ps.visibility === 'hidden') continue;
      if (ps.position !== 'fixed' && ps.position !== 'absolute') continue;
      if (ps.pointerEvents !== 'none') continue;
      const opacity = Number.parseFloat(ps.opacity);
      if (!(opacity > 0 && opacity < arg.opacityMax)) continue;
      const source = noiseIn(ps.backgroundImage) || (which ? '' : filterNoise(el));
      if (!source) continue;
      const w = which ? Number.parseFloat(ps.width) || rect.width : rect.width;
      const h = which ? Number.parseFloat(ps.height) || rect.height : rect.height;
      const box = which
        ? (ps.position === 'fixed' ? { x: window.scrollX, y: window.scrollY, w, h } : { x: rect.left + window.scrollX, y: rect.top + window.scrollY, w, h })
        : doc(rect);
      const container = ps.position === 'fixed' ? null : which ? el : (el instanceof HTMLElement && el.offsetParent) || el.parentElement;
      const cover = container ? doc(container.getBoundingClientRect()) : { x: window.scrollX, y: window.scrollY, w: vw, h: vh };
      const area = box.w * box.h;
      const full = ps.position === 'fixed' ? area >= arg.viewportCover * vw * vh : area >= arg.containerCover * cover.w * cover.h;
      if (!full) continue;
      found.push({ el, kind: which || 'element', box, opacity, source, cover });
    }
  }
  // A pseudo-element paints over its own element's background; an element's own gradient is not under it.
  /** @type {Overlay[]} */
  const overlays = found.map((o) => ({
    sel: `${selectorOf(o.el)}${o.kind === 'element' ? '' : o.kind}`,
    kind: o.kind, box: o.box, opacity: o.opacity, source: o.source, cover: o.cover,
    under: gradientEls
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => (g === o.el ? o.kind !== 'element' : g === root || g.contains(o.el) || (g.compareDocumentPosition(o.el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0))
      .map(({ i }) => i),
  }));
  return { overlays, gradients };
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
 * @param {Box} a
 * @param {Box} b
 * @returns {number}
 */
function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * A gradient with at least two stops, one of them a visible colour with a hue.
 * @param {string} backgroundImage
 * @returns {string[] | null} the stops as hex, or null when it is luminance-only
 */
export function chromaticGradient(backgroundImage) {
  for (const stops of gradientStops(backgroundImage)) {
    if (stops.length >= 2 && stops.some((c) => c.a >= 0.3 && toOklch(c).c >= ACHROMATIC_CHROMA)) return stops.map(toHex);
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
 * One finding per grain overlay painted over a chromatic gradient.
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const scan = await inPage(ctx.page, scanGrain, { opacityMax: OPACITY_MAX, viewportCover: VIEWPORT_COVER, containerCover: CONTAINER_COVER });
  /** @type {RuntimeFinding[]} */
  const out = [];
  for (const o of scan.overlays) {
    const ground = [...o.under]
      .reverse()
      .map((i) => scan.gradients[i])
      .map((g) => ({ g, stops: chromaticGradient(g.backgroundImage) }))
      .find(({ g, stops }) => stops !== null && overlap(g.box, o.box) >= SHARED_AREA * Math.min(g.box.w * g.box.h, o.box.w * o.box.h));
    if (!ground) continue;
    out.push(finding(ctx, o.sel, {
      kind: o.kind, opacity: o.opacity, source: o.source, gradient: { selector: ground.g.sel, stops: ground.stops },
    }, `grain overlay (${o.source}, opacity ${o.opacity}) over the gradient of ${ground.g.sel}`));
    if (out.length >= MAX_FINDINGS) break;
  }
  return out;
}
