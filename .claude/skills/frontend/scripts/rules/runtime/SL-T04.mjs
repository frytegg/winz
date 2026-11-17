// @ts-check
import { laidOut, laidOutText } from './SL-T01.mjs';

/*
 * SL-T04 runtime: Inter as the only rendered family (FD10 T04, R04), read from the fonts Chromium actually used
 * (CDP CSS.getPlatformFontsForNode, FD06-F12, FD17-F25), never from the declared stack: FD11-F19 counted Ethena as
 * Inter from an unrendered fallback. This module also exports the rendered-font helpers SL-T18 and SL-T19 use.
 */

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('playwright-core').Page} Page
 * @typedef {{familyName: string, postScriptName: string, isCustomFont: boolean, glyphCount: number}} PlatformFont
 * @typedef {{sel: string, heading: string | null, mono: boolean, fonts: PlatformFont[]}} FontNode
 * @typedef {{nodes: FontNode[], requested: number, measured: number}} FontUsage
 */

const RULE = 'SL-T04';

/** Inter and its own cuts (Inter Variable, Inter Display, Inter Tight), with weight or style words after the name. */
export const INTER = /^inter(?:[\s_-]*(?:var(?:iable)?|display|tight))?(?:[\s_-]+(?:thin|extra[\s_-]?light|light|regular|medium|semi[\s_-]?bold|bold|extra[\s_-]?bold|black|italic))*$/i;
/** "Only family": Inter renders at least this share of the glyphs, in the text and in the headings. */
export const SHARE_MIN = 0.9;
/** Below this many measured glyphs a page has too little text to judge its type. */
export const MIN_GLYPHS = 20;
/** Text owners measured per page; CDP answers one node at a time. */
export const MAX_NODES = 1500;
const BATCH = 100;
/** CDP errors for a node the page removed or a selector that stopped matching since the text was collected. */
const NODE_GONE = /could not find node|no node with given id|node with given id does not belong|dom error while querying/i;

/** @type {WeakMap<object, Promise<FontUsage>>} */
const usageMemo = new WeakMap();

/**
 * The platform fonts Chromium used for the text directly inside each selected element (CDP; Chromium only). A
 * selector that no longer matches is left out of the map; a CDP failure of the session itself is thrown.
 * @param {Page} page
 * @param {string[]} selectors
 * @returns {Promise<Map<string, PlatformFont[]>>}
 */
export async function platformFonts(page, selectors) {
  const cdp = await page.context().newCDPSession(page);
  /** @type {unknown} */
  let failure;
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    /** @type {Map<string, PlatformFont[]>} */
    const out = new Map();
    for (let i = 0; i < selectors.length; i += BATCH) {
      const chunk = selectors.slice(i, i + BATCH);
      const results = await Promise.all(chunk.map(async (selector) => {
        try {
          const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
          if (!nodeId) return null;
          const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
          return fonts.map((f) => ({ familyName: f.familyName, postScriptName: f.postScriptName ?? '', isCustomFont: f.isCustomFont, glyphCount: f.glyphCount }));
        } catch (err) {
          if (NODE_GONE.test(err instanceof Error ? err.message : String(err))) return null;
          throw err;
        }
      }));
      chunk.forEach((selector, k) => {
        const fonts = results[k];
        if (fonts) out.set(selector, fonts);
      });
    }
    return out;
  } catch (err) {
    failure = err;
    throw err;
  } finally {
    try {
      await cdp.detach();
    } catch (detachErr) {
      if (failure === undefined) throw detachErr;
    }
  }
}

/**
 * Rendered fonts of every laid-out text owner of the page (collectText's direct text, first MAX_NODES), with the
 * heading each sits in and whether it is code. Measured once per runtime context and shared by SL-T04 and SL-T19.
 * @param {RuntimeContext} ctx
 * @returns {Promise<FontUsage>}
 */
export function renderedFontUsage(ctx) {
  let pending = usageMemo.get(ctx.cache);
  if (!pending) {
    pending = measureUsage(ctx);
    usageMemo.set(ctx.cache, pending);
  }
  return pending;
}

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<FontUsage>}
 */
async function measureUsage(ctx) {
  const texts = await ctx.cache.text();
  /** @type {string[]} */
  const owners = [];
  const seen = new Set();
  for (const t of texts) {
    if (!laidOutText(t) || t.source !== 'text' || seen.has(t.sel)) continue;
    seen.add(t.sel);
    owners.push(t.sel);
  }
  const selectors = owners.slice(0, MAX_NODES);
  const roles = await ctx.page.evaluate((sels) => sels.map((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const h = el.closest('h1, h2, h3, h4, h5, h6, [role="heading"]');
    const level = h ? (/^h[1-6]$/.test(h.localName) ? h.localName : `h${h.getAttribute('aria-level') || '2'}`) : null;
    const mono = el.closest('code, pre, kbd, samp') !== null || /\bmonospace\b/i.test(getComputedStyle(el).fontFamily);
    return { heading: level, mono };
  }), selectors);
  const fonts = await platformFonts(ctx.page, selectors);
  /** @type {FontNode[]} */
  const nodes = [];
  selectors.forEach((sel, i) => {
    const role = roles[i];
    const used = fonts.get(sel);
    if (role && used) nodes.push({ sel, heading: role.heading, mono: role.mono, fonts: used });
  });
  return { nodes, requested: owners.length, measured: nodes.length };
}

/**
 * Glyphs per rendered family over a set of nodes.
 * @param {FontNode[]} nodes
 * @returns {Map<string, number>}
 */
export function glyphsByFamily(nodes) {
  /** @type {Map<string, number>} */
  const totals = new Map();
  for (const n of nodes) for (const f of n.fonts) totals.set(f.familyName, (totals.get(f.familyName) ?? 0) + f.glyphCount);
  return totals;
}

/**
 * @param {Map<string, number>} totals
 * @returns {number}
 */
export function sumGlyphs(totals) {
  let sum = 0;
  for (const n of totals.values()) sum += n;
  return sum;
}

/**
 * Families sorted by glyphs, as {family, glyphs, share}.
 * @param {Map<string, number>} totals
 * @returns {Array<{family: string, glyphs: number, share: number}>}
 */
export function familyTable(totals) {
  const sum = sumGlyphs(totals);
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([family, glyphs]) => ({ family, glyphs, share: sum > 0 ? Math.round((glyphs / sum) * 1000) / 1000 : 0 }));
}

/**
 * Sponsors of the profile whose published typography names a family matching `pattern` (a brand-mandated font is a
 * documented false positive; the gate decides on a category waiver).
 * @param {RuntimeContext} ctx
 * @param {RegExp} pattern
 * @returns {string[]}
 */
export function sponsorsUsing(ctx, pattern) {
  /** @type {string[]} */
  const out = [];
  for (const entry of ctx.allowlist?.sponsors ?? []) {
    const typography = Array.isArray(entry.typography) ? entry.typography : [];
    const names = typography.map((t) => (t && typeof t === 'object' && typeof t.family === 'string' ? t.family : ''));
    if (names.some((n) => pattern.test(n.trim()))) out.push(String(entry.sponsor ?? entry.id ?? ''));
  }
  return out;
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
 * Fires when Inter renders at least SHARE_MIN of the non-code glyphs, headings included. The value notes the
 * centred-hero pairing Krebs scores (FD10 R04) and any sponsor whose brand sets Inter.
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const usage = await renderedFontUsage(ctx);
  const prose = usage.nodes.filter((n) => !n.mono);
  const totals = glyphsByFamily(prose);
  const total = sumGlyphs(totals);
  if (total < MIN_GLYPHS) return [];
  const interIn = (/** @type {Map<string, number>} */ map) => [...map.entries()].filter(([f]) => INTER.test(f.trim())).reduce((s, [, n]) => s + n, 0);
  const share = interIn(totals) / total;
  const headingTotals = glyphsByFamily(prose.filter((n) => n.heading !== null));
  const headingGlyphs = sumGlyphs(headingTotals);
  const headingShare = headingGlyphs > 0 ? interIn(headingTotals) / headingGlyphs : share;
  if (share < SHARE_MIN || headingShare < SHARE_MIN) return [];
  const elements = await ctx.cache.elements();
  const h1 = elements.find((e) => laidOut(e) && e.tag === 'h1');
  const centredHero = h1 !== undefined && (h1.styles.textAlign === 'center' ||
    Math.abs(h1.box.x + h1.box.w / 2 - ctx.viewport.width / 2) <= 24 && h1.box.w < 0.9 * ctx.viewport.width);
  const sponsors = sponsorsUsing(ctx, INTER);
  const pct = (/** @type {number} */ x) => `${Math.round(x * 100)}%`;
  return [finding(ctx, 'body', {
    share: Math.round(share * 1000) / 1000,
    headingShare: Math.round(headingShare * 1000) / 1000,
    glyphs: total,
    families: familyTable(totals).slice(0, 5),
    centredHero,
    sponsorFont: sponsors,
    measured: usage.measured,
  }, `Inter renders ${pct(share)} of the text and ${pct(headingShare)} of the headings${centredHero ? ', with a centred hero' : ''}${sponsors.length ? `; the sponsor brand ${sponsors.join(', ')} sets Inter` : ''}`)];
}
