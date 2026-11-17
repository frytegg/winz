// @ts-check
/*
 * SL-M01: the "tasteful default": a warm cream ground near #F4F1EA or #FAF9F5, a serif display face and a clay accent
 * near #D97757, the cluster Anthropic names as AI-generated design's habit and its own accent [FD15-F04] [FD15-F05]
 * [FD15-F17] [FD10-F04]. The ground is what the first viewport paints (sampled with elementsFromPoint); the display
 * face is the font the first-viewport h1 (else the largest first-viewport text) actually renders in, read through
 * CDP (FD06-F12) with the declared stack as fallback. Fires on the cream ground plus at least one of the other two.
 *
 * Hosts the ground sampler that SL-M08 imports.
 */
import { parseColor, toOklch } from '../../lib/color.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {import('../../lib/dom.mjs').TextInfo} TextInfo
 * @typedef {import('playwright-core').Page} Page
 * @typedef {{hex: string | null, share: number, samples: number, image: number, media: number}} Ground
 */

export const RULE = 'SL-M01';
export const MAX_ITEMS = 12;
/** Cream: light, faintly chromatic, warm (OKLCH). #F4F1EA is L 0.959 C 0.010 h 88; #FAF9F5 L 0.982 C 0.005 h 95. */
export const CREAM = Object.freeze({ minL: 0.9, minC: 0.004, maxC: 0.06, minHue: 55, maxHue: 110 });
/** OKLab distance to #D97757 that still reads as the same clay (about three just-noticeable differences). */
export const CLAY_DISTANCE = 0.06;
export const CLAY = '#D97757';
/** Share of the sampled first-viewport points the dominant ground must cover. */
export const GROUND_SHARE = 0.4;

const SERIF = /serif|georgia|times|cambria|fraunces|playfair|newsreader|recoleta|\blora\b|garamond|crimson|merriweather|cormorant|baskerville|caslon|bodoni|didot|spectral|literata|tiempos|canela/i;
const SANS = /sans|grotesk|grotesque|mono/i;
const GENERIC_SERIF = /^(?:serif|ui-serif)$/i;
const GENERIC_OTHER = /^(?:sans-serif|ui-sans-serif|system-ui|ui-monospace|monospace|cursive|fantasy|-apple-system|blinkmacsystemfont)$/i;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const [ground, elements, texts] = await Promise.all([pageGround(ctx.page), ctx.cache.elements(), ctx.cache.text()]);
  if (!ground.hex || ground.share < GROUND_SHARE || !isCream(ground.hex)) return [];
  const display = displayText(elements, texts, ctx.viewport?.height ?? 900);
  /** @type {string[]} */
  const notes = [];
  let serif = null;
  if (display) {
    const rendered = await renderedFamily(ctx.page, display.selector, notes);
    const isSerif = rendered ? SERIF.test(rendered) && !SANS.test(rendered) : stackIsSerif(display.stack);
    if (isSerif) serif = { selector: display.selector, family: rendered ?? display.stack, box: display.box };
  }
  const clay = clayPaints(elements, texts);
  if (!serif && clay.length === 0) return [];
  const parts = ['cream ground', serif ? 'serif display' : '', clay.length ? 'clay accent' : ''].filter(Boolean);
  const first = serif ?? clay[0];
  return [{
    rule: RULE,
    layer: 'runtime',
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector: first.selector,
    box: first.box,
    value: { count: parts.length, ground: ground.hex, groundShare: ground.share, serif, clay: { count: clay.length, items: clay.slice(0, MAX_ITEMS) }, notes },
    detail: `${parts.join(' + ')} (ground ${ground.hex} on ${Math.round(ground.share * 100)}% of the first viewport${serif ? `, display in ${serif.family}` : ''}${clay.length ? `, ${clay.length} clay paint(s)` : ''}); derive the palette and type from the research`,
  }];
}

/**
 * True for a warm cream: CREAM lightness, faint chroma and a hue between orange and yellow.
 * @param {string} css
 * @returns {boolean}
 */
export function isCream(css) {
  const c = parseColor(css);
  if (!c || c.a < 0.99) return false;
  const { l, c: chroma, h } = toOklch(c);
  return l >= CREAM.minL && chroma >= CREAM.minC && chroma <= CREAM.maxC && h >= CREAM.minHue && h <= CREAM.maxHue;
}

/**
 * Euclidean distance in OKLab between two CSS colours (Infinity when one cannot be parsed).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function oklabDistance(a, b) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return Infinity;
  const p = toOklch(ca);
  const q = toOklch(cb);
  const rad = Math.PI / 180;
  return Math.hypot(p.l - q.l, p.c * Math.cos(p.h * rad) - q.c * Math.cos(q.h * rad), p.c * Math.sin(p.h * rad) - q.c * Math.sin(q.h * rad));
}

/**
 * Serif judged from a declared font stack when the rendered face is unknown: a serif-named first family, or an
 * unnamed first family whose generic fallback is serif.
 * @param {string} stack
 * @returns {boolean}
 */
export function stackIsSerif(stack) {
  const families = String(stack ?? '').split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  if (families.length === 0) return false;
  if (SERIF.test(families[0]) && !SANS.test(families[0])) return true;
  const generic = families.find((f) => GENERIC_SERIF.test(f) || GENERIC_OTHER.test(f));
  return generic !== undefined && GENERIC_SERIF.test(generic);
}

/**
 * The first-viewport display text: the first rendered h1 in the first viewport, else the largest first-viewport text
 * of 28 px or more.
 * @param {ElementInfo[]} elements
 * @param {TextInfo[]} texts
 * @param {number} viewHeight
 * @returns {{selector: string, stack: string, box: import('../../lib/dom.mjs').Box} | null}
 */
export function displayText(elements, texts, viewHeight) {
  const h1 = elements.find((el) => el.tag === 'h1' && rendered(el) && el.box.y < viewHeight);
  if (h1) return { selector: h1.sel, stack: h1.styles.fontFamily, box: h1.box };
  const largest = texts.filter((t) => textRendered(t) && t.inViewport && t.fontSize >= 28).sort((a, b) => b.fontSize - a.fontSize)[0];
  return largest ? { selector: largest.sel, stack: largest.fontFamily, box: largest.box } : null;
}

/**
 * Laid out and not visibility:hidden. Opacity is ignored: content waiting at opacity 0 for a scroll reveal is what a
 * visitor sees after one scroll.
 * @param {ElementInfo} el
 * @returns {boolean}
 */
export function rendered(el) {
  return el.box.w >= 1 && el.box.h >= 1 && el.styles.display !== 'none' && el.styles.visibility !== 'hidden';
}

/**
 * The text counterpart of `rendered`: visible, or invisible only because its effective opacity is 0.
 * @param {TextInfo} t
 * @returns {boolean}
 */
export function textRendered(t) {
  return t.box.w >= 1 && t.box.h >= 1 && (t.visible || t.opacity === 0);
}

/**
 * Rendered paints within CLAY_DISTANCE of #D97757: text colour, opaque-ish backgrounds and borders.
 * @param {ElementInfo[]} elements
 * @param {TextInfo[]} texts
 * @returns {Array<{selector: string, box: import('../../lib/dom.mjs').Box, property: string, color: string}>}
 */
export function clayPaints(elements, texts) {
  /** @type {Array<{selector: string, box: import('../../lib/dom.mjs').Box, property: string, color: string}>} */
  const out = [];
  const near = (/** @type {string} */ css) => {
    const c = parseColor(css);
    return c !== null && c.a >= 0.5 && oklabDistance(css, CLAY) <= CLAY_DISTANCE;
  };
  for (const t of texts) if (textRendered(t) && near(t.color)) out.push({ selector: t.sel, box: t.box, property: 'color', color: t.color });
  for (const el of elements) {
    if (!rendered(el)) continue;
    if (near(el.styles.backgroundColor)) out.push({ selector: el.sel, box: el.box, property: 'background-color', color: el.styles.backgroundColor });
    else if (Number.parseFloat(el.styles.borderTopWidth) >= 1 && near(el.styles.borderTopColor)) out.push({ selector: el.sel, box: el.box, property: 'border-color', color: el.styles.borderTopColor });
  }
  return out;
}

/**
 * The family that renders most glyphs of the element (CDP CSS.getPlatformFontsForNode), or null when CDP is not
 * available; the reason goes to `notes`.
 * @param {Page} page
 * @param {string} selector
 * @param {string[]} notes
 * @returns {Promise<string | null>}
 */
export async function renderedFamily(page, selector, notes) {
  /** @type {import('playwright-core').CDPSession | null} */
  let session = null;
  try {
    session = await page.context().newCDPSession(page);
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) {
      notes.push(`rendered font: ${selector} not found through CDP; declared stack used`);
      return null;
    }
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
    const top = [...fonts].sort((a, b) => b.glyphCount - a.glyphCount)[0];
    return top ? top.familyName : null;
  } catch (err) {
    notes.push(`rendered font unavailable (${err instanceof Error ? err.message.split('\n')[0] : String(err)}); declared stack used`);
    return null;
  } finally {
    if (session) await session.detach().catch((err) => notes.push(`CDP detach: ${err instanceof Error ? err.message : String(err)}`));
  }
}

/**
 * The colour the first viewport paints behind content: 25 points on a 5x5 grid, each resolved through
 * elementsFromPoint to its stack of backgrounds composited over the canvas. Points over images, video, canvas or
 * inline SVG and points over a background image are counted apart. Returns the dominant colour and its share of the
 * colour samples.
 * @param {Page} page
 * @returns {Promise<Ground>}
 */
export async function pageGround(page) {
  const samples = /** @type {Array<string | null>} */ (await page.evaluate(groundSamples));
  /** @type {Map<string, number>} */
  const counts = new Map();
  let image = 0;
  let media = 0;
  for (const s of samples) {
    if (s === null) media += 1;
    else if (s === 'image') image += 1;
    else counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const colourSamples = samples.length - media;
  const [hex, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return { hex, share: colourSamples > 0 ? n / colourSamples : 0, samples: samples.length, image, media };
}

/**
 * In-page: one sample per grid point: '#rrggbb' of the composited ground, 'image' over a background image, null over
 * media. Self-contained: it runs inside the page.
 * @returns {Array<string | null>}
 */
export const groundSamples = function groundSamples() {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const paint = canvas.getContext('2d', { willReadFrequently: true });
  /** @param {string} css @returns {[number, number, number, number]} */
  const rgba = (css) => {
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(css);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : m[5] === '%' ? Number(m[4]) / 100 : Number(m[4])];
    if (!paint) return [0, 0, 0, 0];
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = 'rgba(0, 0, 0, 0)';
    paint.fillStyle = css;
    paint.fillRect(0, 0, 1, 1);
    const d = paint.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const scheme = getComputedStyle(document.documentElement).colorScheme || '';
  const dark = /\bdark\b/.test(scheme) && (!/\blight\b/.test(scheme) || window.matchMedia('(prefers-color-scheme: dark)').matches);
  /** @type {[number, number, number]} */
  let canvasColor = dark ? [18, 18, 18] : [255, 255, 255];
  // The root's background paints the whole canvas; when the root has none, the body's propagates to it (CSS 2.2 14.2).
  const root = rgba(getComputedStyle(document.documentElement).backgroundColor);
  const propagated = root[3] > 0 || !document.body ? root : rgba(getComputedStyle(document.body).backgroundColor);
  if (propagated[3] > 0) {
    const [pr, pg, pb, pa] = propagated;
    canvasColor = [pr * pa + canvasColor[0] * (1 - pa), pg * pa + canvasColor[1] * (1 - pa), pb * pa + canvasColor[2] * (1 - pa)];
  }
  /** @type {Array<string | null>} */
  const out = [];
  for (let iy = 0; iy < 5; iy += 1) {
    for (let ix = 0; ix < 5; ix += 1) {
      const x = Math.round(window.innerWidth * (0.1 + 0.2 * ix));
      const y = Math.round(window.innerHeight * (0.1 + 0.2 * iy));
      /** @type {Array<[number, number, number, number]>} */
      const layers = [];
      let result = /** @type {string | null | undefined} */ (undefined);
      for (const el of document.elementsFromPoint(x, y)) {
        if (el.matches('img, video, canvas, iframe, picture, object, embed') || (el instanceof SVGSVGElement && el.getBoundingClientRect().width * el.getBoundingClientRect().height > 2500)) {
          result = null;
          break;
        }
        const cs = getComputedStyle(el);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') {
          result = 'image';
          break;
        }
        const c = rgba(cs.backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] >= 0.99) break;
      }
      if (result === undefined) {
        let [r, g, b] = canvasColor;
        for (let k = layers.length - 1; k >= 0; k -= 1) {
          const [lr, lg, lb, la] = layers[k];
          r = lr * la + r * (1 - la);
          g = lg * la + g * (1 - la);
          b = lb * la + b * (1 - la);
        }
        result = `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
      }
      out.push(result);
    }
  }
  return out;
};
