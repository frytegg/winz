// @ts-check
/**
 * Captures one third-party reference page (ARCHITECTURE P1) through the FD19 gate of capture-gate.mjs and writes
 * `<captures root>/<host>/<slug>/`, outside the project and outside every git work tree:
 *   slices/<viewport>-NN.png   viewport-sized screenshots taken while really scrolling (never a tall full-page image)
 *   styles.json                collectElements (visible elements, initial values left out), collectText, numerals,
 *                              page metrics, declared values and custom-property names, hover and focus states, breakpoints
 *   fonts.json                 CDP CSS.getPlatformFontsForNode on headings, body text, buttons, nav links and figures
 *   landmarks.json             landmarks, top-level sections with column counts, canvases (vision-only), consent widgets
 *   reveal.json                what is hidden at rest and revealed by scrolling, what mounts on scroll
 *   manifest.json              SHA-256 of every file above and the deletion deadline
 *   gate-receipt.json          the gate's steps, verdict, identity and terms attestation
 * and records the folder in <state>/refs-index.json. Nothing is stored unless every gate step passes and someone has
 * attested the terms review with --terms-reviewed.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as gate from './capture-gate.mjs';
import { parseCli, isMainModule } from './lib/args.mjs';
import { launch } from './lib/browser.mjs';
import { collectElements, collectText, selectorFor } from './lib/dom.mjs';
import { CheckError, UsageError, exitWith } from './lib/errors.mjs';
import { toPosix } from './lib/fsutil.mjs';
import { stateDir } from './lib/paths.mjs';
import { loadProfile } from './lib/profile.mjs';
import { waitReady } from './lib/ready.mjs';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('playwright-core').BrowserContext} BrowserContext
 * @typedef {import('playwright-core').Page} Page
 * @typedef {import('playwright-core').CDPSession} CDPSession
 * @typedef {import('./lib/profile.mjs').Viewport} Viewport
 * @typedef {import('./lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {import('./capture-gate.mjs').Verdict} Verdict
 * @typedef {import('./capture-gate.mjs').FetchImpl} FetchImpl
 * @typedef {import('./capture-gate.mjs').Step} Step
 *
 * @typedef {{mark: string, role: string, sel: string, owner: string, tag: string, aboveFold: boolean}} Sample
 * @typedef {{what: string, error: string}} CdpError
 *
 * The parts of the DevTools protocol's CSS domain read here (playwright-core does not export its Protocol types):
 * @typedef {{familyName: string, postScriptName: string, isCustomFont: boolean, glyphCount: number}} CdpFont
 * @typedef {{name: string, value: string, disabled?: boolean, parsedOk?: boolean}} CdpProperty
 * @typedef {{cssProperties: CdpProperty[]}} CdpStyle
 * @typedef {{rule: {origin: string, selectorList: {text: string}, style: CdpStyle, media?: Array<{text: string}>}}} CdpRuleMatch
 * @typedef {{inlineStyle?: CdpStyle, matchedCSSRules?: CdpRuleMatch[], inherited?: Array<{matchedCSSRules?: CdpRuleMatch[]}>}} CdpMatched
 * @typedef {{value: number, unit: string, feature: string, computedLength?: number}} CdpMediaExpression
 * @typedef {{text: string, mediaList?: Array<{expressions?: CdpMediaExpression[]}>}} CdpMedia
 *
 * @typedef {{fonts: Array<Sample & {fonts: CdpFont[]}>,
 *   matched: Array<Record<string, unknown>>, states: Array<Record<string, unknown>>, customProperties: string[],
 *   mediaQueries: Record<string, unknown> | null, errors: CdpError[]}} CdpData
 * @typedef {{url: string, root: string | null, out: string, termsReviewed: string | null, dryRun: boolean,
 *   viewports: Viewport[], slices: number, deleteBy: Date | null, state: string | null}} CaptureOptions
 * @typedef {{browser?: Browser, sleep?: (ms: number) => Promise<void>, now?: () => Date,
 *   log?: (line: string) => void, fetchImpl?: FetchImpl}} CaptureDeps
 * @typedef {{tool: 'capture', policy: string, version: string, url: string, finalUrl: string | null, host: string,
 *   slug: string, checkedAt: string, dryRun: boolean, verdict: Verdict | 'error', code: string | null, reason: string,
 *   steps: Step[], userAgent: string | null, plainUserAgent: string, termsReviewed: string | null,
 *   terms: Record<string, unknown> | null, crawlDelay: number, captureDir: string | null,
 *   files: import('./capture-gate.mjs').FileEntry[], manifest: string | null, receipt: string | null,
 *   deleteBy: string | null, purgeCommand: string | null, refsIndex: string | null,
 *   readiness: Record<string, {ok: boolean, detail: string}>, discarded: boolean}} CaptureReport
 */

export const CAPTURE_VERSION = '1';
/** The first three screenfuls hold about 81% of viewing time (FD11-F10); the rest of the page is read from the DOM. */
export const DEFAULT_SLICES = 3;
const MAX_SCROLL_STEPS = 40;
const SAMPLE_ATTR = 'data-frontend-capture-sample';
const DAY_MS = 86_400_000;
const STATE_PROPS = Object.freeze([
  'background-color', 'color', 'border-top-color', 'box-shadow', 'transform', 'opacity', 'text-decoration-line',
  'outline-style', 'outline-color', 'outline-width', 'filter',
]);
const DECLARED_PROPS = new Set([
  'color', 'background', 'background-color', 'background-image', 'font-family', 'font-size', 'font-weight',
  'line-height', 'letter-spacing', 'text-transform', 'font-variant-numeric', 'font-feature-settings', 'border',
  'border-color', 'border-width', 'border-radius', 'padding', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'margin', 'margin-top', 'margin-bottom', 'gap', 'row-gap', 'column-gap', 'box-shadow', 'transition',
  'transition-duration', 'transition-timing-function', 'grid-template-columns', 'max-width',
]);
const STYLES_FORMAT = Object.freeze({
  elements: 'lib/dom.mjs collectElements; visible elements only, parent re-pointed at the nearest kept ancestor; a style key equal to capture-gate DEFAULT_STYLE_VALUES is left out (and a border colour whose side has no width)',
  text: 'lib/dom.mjs collectText; visible text only',
  numbers: 'elements owning text with digits: numeric font features, size, box',
  declared: 'CDP CSS.getMatchedStylesForNode on sampled elements (author rules only), var() names, custom-property names',
  states: 'CDP CSS.forcePseudoState hover and focus/focus-visible: properties that change',
  mediaQueries: 'CDP CSS.getMediaQueries: width breakpoints',
});

// ---------- in-page collectors (each travels as source text: it may use nothing outside its body) ----------

/**
 * @returns {{url: string, title: string, lang: string, width: number, height: number, dpr: number, scrollWidth: number,
 *   scrollHeight: number, colorScheme: string, rootBackground: string, bodyBackground: string, rootFontSize: number}}
 */
function pageMetrics() {
  const doc = document.documentElement;
  const body = document.body;
  const rootStyle = getComputedStyle(doc);
  return {
    url: location.href,
    title: document.title || '',
    lang: doc.lang || '',
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio,
    scrollWidth: Math.max(doc.scrollWidth, body ? body.scrollWidth : 0),
    scrollHeight: Math.max(doc.scrollHeight, body ? body.scrollHeight : 0),
    colorScheme: rootStyle.colorScheme || '',
    rootBackground: rootStyle.backgroundColor,
    bodyBackground: body ? getComputedStyle(body).backgroundColor : '',
    rootFontSize: Number.parseFloat(rootStyle.fontSize) || 16,
  };
}

/**
 * Remembers each element's opacity, visibility, transform and clip-path before any scrolling.
 * @returns {number}
 */
function revealBefore() {
  const skip = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'head', 'title', 'br', 'wbr']);
  /** @type {Map<Element, {o: number, v: string, t: string, c: string}>} */
  const store = new Map();
  for (const el of Array.from(document.body ? document.body.querySelectorAll('*') : [])) {
    if (store.size >= 20000) break;
    if (skip.has(el.localName)) continue;
    const cs = getComputedStyle(el);
    store.set(el, { o: Number.parseFloat(cs.opacity), v: cs.visibility, t: cs.transform, c: cs.clipPath });
  }
  Reflect.set(window, '__frontendCaptureReveal', store);
  return store.size;
}

/**
 * After scrolling through the page: the elements that were hidden at rest and are now shown (opacity, visibility,
 * a translate of 16 px or more, a clip-path) and the elements mounted while scrolling.
 * @param {typeof selectorFor} select
 * @param {{max: number}} arg
 */
function revealAfter(select, arg) {
  const store = /** @type {Map<Element, {o: number, v: string, t: string, c: string}> | undefined} */ (Reflect.get(window, '__frontendCaptureReveal'));
  const empty = { elements: 0, revealedCount: 0, revealed: /** @type {unknown[]} */ ([]), kinds: {}, mounted: 0, mountedRoots: /** @type {string[]} */ ([]) };
  if (!(store instanceof Map) || !document.body) return empty;
  const skip = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'head', 'title', 'br', 'wbr']);
  const counts = new Map();
  /** @param {string} t */
  const shift = (t) => {
    if (!t || t === 'none') return 0;
    const m2 = /^matrix\(([^)]+)\)$/.exec(t);
    if (m2) {
      const p = m2[1].split(',').map(Number);
      return Math.hypot(p[4] || 0, p[5] || 0);
    }
    const m3 = /^matrix3d\(([^)]+)\)$/.exec(t);
    if (m3) {
      const p = m3[1].split(',').map(Number);
      return Math.hypot(p[12] || 0, p[13] || 0);
    }
    return 0;
  };
  /** @type {Array<{sel: string, tag: string, top: number, kinds: string[], before: unknown, after: unknown}>} */
  const revealed = [];
  /** @type {Record<string, number>} */
  const kinds = {};
  let count = 0;
  let mounted = 0;
  /** @type {string[]} */
  const mountedRoots = [];
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (skip.has(el.localName)) continue;
    const before = store.get(el);
    if (!before) {
      mounted += 1;
      if (el.parentElement && store.has(el.parentElement) && mountedRoots.length < 20) mountedRoots.push(select(el, counts));
      continue;
    }
    const cs = getComputedStyle(el);
    const after = { o: Number.parseFloat(cs.opacity), v: cs.visibility, t: cs.transform, c: cs.clipPath };
    /** @type {string[]} */
    const found = [];
    if (before.o < 0.1 && after.o > 0.9) found.push('opacity');
    if (before.v === 'hidden' && after.v === 'visible') found.push('visibility');
    if (shift(before.t) >= 16 && shift(after.t) < 2) found.push('transform');
    if (before.c !== 'none' && after.c === 'none') found.push('clip-path');
    if (found.length === 0) continue;
    count += 1;
    for (const k of found) kinds[k] = (kinds[k] || 0) + 1;
    if (revealed.length < arg.max) {
      const r = el.getBoundingClientRect();
      revealed.push({ sel: select(el, counts), tag: el.localName, top: Math.round(r.top + window.scrollY), kinds: found, before, after });
    }
  }
  return { elements: store.size, revealedCount: count, revealed, kinds, mounted, mountedRoots };
}

/**
 * Landmarks, the top-level content sections (with column counts), canvases and consent widgets.
 * @param {typeof selectorFor} select
 * @param {{max: number, maxSections: number, consent: string}} arg
 */
function collectLandmarks(select, arg) {
  const counts = new Map();
  const consent = new RegExp(arg.consent, 'i');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const sx = window.scrollX;
  const sy = window.scrollY;
  const LANDMARKS = 'header, nav, main, footer, aside, section, article, form, [role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], [role="complementary"], [role="region"], [role="search"], [role="form"]';
  /** @param {Element} el */
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return typeof el.checkVisibility === 'function' ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;
  };
  /** @param {Element} el */
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height) };
  };
  /** @param {Element | null} el */
  const inConsent = (el) => {
    for (let n = el; n; n = n.parentElement) {
      if (consent.test(n.id || '') || consent.test(n.getAttribute('class') || '')) return true;
    }
    return false;
  };
  /** @param {Element} el */
  const roleOf = (el) => {
    const explicit = (el.getAttribute('role') || '').trim().split(/\s+/)[0];
    if (explicit) return explicit;
    const sectioning = 'article, aside, main, nav, section';
    switch (el.localName) {
      case 'header':
        return el.parentElement && el.parentElement.closest(sectioning) ? '' : 'banner';
      case 'footer':
        return el.parentElement && el.parentElement.closest(sectioning) ? '' : 'contentinfo';
      case 'nav':
        return 'navigation';
      case 'main':
        return 'main';
      case 'aside':
        return 'complementary';
      case 'form':
        return 'form';
      case 'section':
        return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : '';
      case 'article':
        return 'article';
      default:
        return '';
    }
  };
  /** @param {Element} el @param {string} selector */
  const countShown = (el, selector) => Array.from(el.querySelectorAll(selector)).filter(shown).length;
  /** @param {Element} el */
  const headingOf = (el) => {
    const h = Array.from(el.querySelectorAll('h1, h2, h3')).find(shown);
    if (!h) return null;
    return { level: Number(h.localName.slice(1)), size: Number.parseFloat(getComputedStyle(h).fontSize) || 0, text: (h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) };
  };
  /** @param {Element} el */
  const columnsOf = (el) => {
    let best = 1;
    for (const c of [el, ...Array.from(el.querySelectorAll('*')).slice(0, 400)]) {
      const kids = Array.from(c.children).filter(shown).map((k) => k.getBoundingClientRect()).filter((r) => r.width >= 120);
      if (kids.length < 2) continue;
      for (const a of kids) {
        const row = kids.filter((b) => Math.abs(b.top - a.top) < 8).length;
        if (row > best) best = row;
      }
    }
    return best;
  };
  const landmarks = [];
  for (const el of Array.from(document.querySelectorAll(LANDMARKS))) {
    if (landmarks.length >= arg.max) break;
    if (!shown(el)) continue;
    let depth = 0;
    for (let p = el.parentElement; p; p = p.parentElement) if (p.matches(LANDMARKS)) depth += 1;
    landmarks.push({
      sel: select(el, counts),
      tag: el.localName,
      role: roleOf(el),
      box: box(el),
      depth,
      position: getComputedStyle(el).position,
      label: (el.getAttribute('aria-label') || '').slice(0, 80),
      heading: headingOf(el),
      links: countShown(el, 'a[href]'),
      buttons: countShown(el, 'button, [role="button"], input[type="submit"], input[type="button"]'),
      consent: inConsent(el),
    });
  }
  /** @type {Element | null} */
  let container = document.querySelector('main, [role="main"]') || document.body;
  for (let i = 0; i < 4 && container; i += 1) {
    /** @type {Element[]} */
    const kids = Array.from(container.children).filter(shown);
    if (kids.length === 1) container = kids[0];
    else break;
  }
  const sections = Array.from(container ? container.children : [])
    .filter((el) => shown(el) && el.getBoundingClientRect().height >= 40)
    .slice(0, arg.maxSections)
    .map((el) => {
      const cs = getComputedStyle(el);
      return {
        sel: select(el, counts),
        tag: el.localName,
        box: box(el),
        background: cs.backgroundColor,
        backgroundImage: cs.backgroundImage === 'none' ? null : cs.backgroundImage.slice(0, 120),
        heading: headingOf(el),
        columns: columnsOf(el),
        images: countShown(el, 'img, picture, video, svg[role="img"]'),
        canvases: countShown(el, 'canvas'),
        links: countShown(el, 'a[href]'),
        buttons: countShown(el, 'button, [role="button"]'),
        consent: inConsent(el),
      };
    });
  const canvases = Array.from(document.querySelectorAll('canvas')).filter(shown).slice(0, 40).map((c) => {
    const b = box(c);
    return { sel: select(c, counts), box: b, engine: c.getAttribute('data-engine') || '', aboveFold: b.y < vh };
  });
  const consentRoots = Array.from(document.querySelectorAll('body *'))
    .filter((el) => (consent.test(el.id || '') || consent.test(el.getAttribute('class') || '')) && shown(el) && !inConsent(el.parentElement))
    .slice(0, 10)
    .map((el) => ({ sel: select(el, counts), box: box(el) }));
  return { viewport: { width: vw, height: vh }, landmarks, sections, canvases, consent: consentRoots };
}

/**
 * Every visible element owning text with a digit: its numeric font features, size, family, colour and box.
 * @param {typeof selectorFor} select
 * @param {{max: number, textMax: number}} arg
 */
function collectNumerals(select, arg) {
  const counts = new Map();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  /** @type {Map<Element, string>} */
  const owners = new Map();
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const value = n.nodeValue || '';
    if (!/\d/.test(value)) continue;
    const el = n.parentElement;
    if (!el || el.closest('script, style, noscript, template, title, head')) continue;
    owners.set(el, `${owners.get(el) || ''} ${value}`);
  }
  const out = [];
  for (const [el, raw] of owners) {
    if (out.length >= arg.max) break;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const cs = getComputedStyle(el);
    const around = el.parentElement ? (el.parentElement.textContent || '').replace(/\s+/g, ' ').trim() : '';
    out.push({
      sel: select(el, counts),
      tag: el.localName,
      text: raw.replace(/\s+/g, ' ').trim().slice(0, arg.textMax),
      context: around.slice(0, 48),
      fontSize: Number.parseFloat(cs.fontSize) || 0,
      fontWeight: Number(cs.fontWeight) || 400,
      fontFamily: cs.fontFamily,
      fontVariantNumeric: cs.fontVariantNumeric,
      fontFeatureSettings: cs.fontFeatureSettings,
      color: cs.color,
      box: { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      inViewport: r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw,
      interactive: Boolean(el.closest('a[href], button, [role="button"]')),
    });
  }
  return out;
}

/**
 * Marks the elements CDP will be asked about (headings, body text, buttons, nav links, figures) with a temporary
 * attribute on the element that owns their first text, and describes them.
 * @param {typeof selectorFor} select
 * @param {{attr: string, consent: string}} arg
 * @returns {Sample[]}
 */
function markSamples(select, arg) {
  const counts = new Map();
  const consent = new RegExp(arg.consent, 'i');
  const vh = window.innerHeight;
  /** @param {Element} el */
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return typeof el.checkVisibility === 'function' ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;
  };
  /** @param {Element} el */
  const inConsent = (el) => {
    for (let n = /** @type {Element | null} */ (el); n; n = n.parentElement) {
      if (consent.test(n.id || '') || consent.test(n.getAttribute('class') || '')) return true;
    }
    return false;
  };
  /** @param {Element} el @returns {Element | null} */
  const ownerOf = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if ((n.nodeValue || '').trim() && n.parentElement && shown(n.parentElement)) return n.parentElement;
    }
    return null;
  };
  /** @param {Element} el */
  const filled = (el) => {
    const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor);
    if (!m) return false;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return parts.length < 4 || parts[3] > 0.5;
  };
  /** @param {Element[]} list */
  const byTop = (list) => list
    .map((el) => /** @type {[Element, number]} */ ([el, el.getBoundingClientRect().top]))
    .sort((a, b) => a[1] - b[1])
    .map((x) => x[0]);
  /** @type {Sample[]} */
  const picks = [];
  /** @param {string} role @param {Element[]} list @param {number} n */
  const take = (role, list, n) => {
    let k = 0;
    for (const el of list) {
      if (k >= n) break;
      if (!shown(el) || inConsent(el)) continue;
      const owner = ownerOf(el);
      if (!owner) continue;
      let mark = owner.getAttribute(arg.attr);
      if (!mark) {
        mark = `${role}-${k}`;
        owner.setAttribute(arg.attr, mark);
      }
      picks.push({ mark, role, sel: select(el, counts), owner: select(owner, counts), tag: el.localName, aboveFold: el.getBoundingClientRect().top < vh });
      k += 1;
    }
  };
  take('h1', Array.from(document.querySelectorAll('h1')), 2);
  take('h2', Array.from(document.querySelectorAll('h2')), 2);
  take('h3', Array.from(document.querySelectorAll('h3')), 1);
  take('body', Array.from(document.querySelectorAll('p, li, dd, blockquote')).filter((el) => (el.textContent || '').replace(/\s+/g, ' ').trim().length >= 40), 3);
  take('button', byTop(Array.from(document.querySelectorAll('button, [role="button"], a[href]')).filter((el) => el.localName === 'button' || el.getAttribute('role') === 'button' || filled(el))), 3);
  take('nav', Array.from(document.querySelectorAll('nav a[href], [role="navigation"] a[href]')), 2);
  take('figure', byTop(Array.from(document.querySelectorAll('body *')).filter((el) => {
    const own = Array.from(el.childNodes).filter((c) => c.nodeType === 3).map((c) => c.nodeValue || '').join('').trim();
    return own.length > 0 && own.length <= 24 && /\d/.test(own) && Number.parseFloat(getComputedStyle(el).fontSize) >= 20;
  })), 2);
  return picks;
}

/**
 * @returns {Array<{family: string, weight: string, style: string, status: string}>}
 */
function loadedFaces() {
  /** @type {Array<{family: string, weight: string, style: string, status: string}>} */
  const out = [];
  if (!document.fonts) return out;
  for (const f of Array.from(document.fonts)) {
    if (out.length >= 200) break;
    out.push({ family: f.family.replace(/^["']|["']$/g, ''), weight: f.weight, style: f.style, status: f.status });
  }
  return out;
}

/**
 * Runs an in-page function whose first parameter is lib/dom selectorFor. Both travel as source text and are
 * evaluated through the DevTools protocol, which a page's content security policy does not block.
 * @template A
 * @param {Page} page
 * @param {(select: typeof selectorFor, arg: A) => unknown} fn
 * @param {A} arg
 * @returns {Promise<any>}
 */
function evaluateWith(page, fn, arg) {
  return page.evaluate(`(${fn.toString()})((${selectorFor.toString()}), ${JSON.stringify(arg)})`);
}

// ---------- Node side ----------

/**
 * Keeps the visible elements of a collectElements result, re-points `parent` at the nearest kept ancestor and leaves
 * out style values equal to DEFAULT_STYLE_VALUES (and the colour of a border side with no width).
 * @param {ElementInfo[]} elements
 * @returns {ElementInfo[]}
 */
export function compactElements(elements) {
  const defaults = /** @type {Record<string, string>} */ (gate.DEFAULT_STYLE_VALUES);
  /** @type {Map<number, number>} */
  const kept = new Map();
  /** @type {ElementInfo[]} */
  const out = [];
  elements.forEach((el, i) => {
    if (!el.visible) return;
    let p = el.parent;
    while (p >= 0 && !kept.has(p)) p = elements[p] ? elements[p].parent : -1;
    const parent = p >= 0 ? /** @type {number} */ (kept.get(p)) : -1;
    /** @type {Record<string, string>} */
    const styles = {};
    for (const [key, value] of Object.entries(el.styles)) {
      if (defaults[key] === value) continue;
      const side = /^border(Top|Right|Bottom|Left)Color$/.exec(key);
      if (side && (el.styles[`border${side[1]}Width`] ?? '0px') === '0px') continue;
      styles[key] = value;
    }
    kept.set(i, out.length);
    out.push({ ...el, styles, parent, depth: parent >= 0 ? out[parent].depth + 1 : 0 });
  });
  return out;
}

/**
 * The viewports of one capture: the profile's first MAX_VIEWPORTS_PER_PAGE, or `spec` (profile viewport names or
 * WIDTHxHEIGHT, at most MAX_VIEWPORTS_PER_PAGE). A WIDTHxHEIGHT under 600 px wide is emulated as a phone.
 * @param {string | undefined} spec
 * @param {readonly Viewport[]} profileViewports
 * @returns {Viewport[]}
 */
export function resolveCaptureViewports(spec, profileViewports) {
  const max = gate.MAX_VIEWPORTS_PER_PAGE;
  if (spec === undefined) return profileViewports.slice(0, max).map((v) => ({ ...v }));
  const items = spec.split(',').map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) throw new UsageError('--viewports is empty; name profile viewports or give WIDTHxHEIGHT, for example 1440x900,390x844');
  if (items.length > max) throw new UsageError(`--viewports names ${items.length} viewports; the policy keeps at most ${max} per page (P11)`);
  if (new Set(items).size !== items.length) throw new UsageError('--viewports names one viewport twice');
  return items.map((item) => {
    const named = profileViewports.find((v) => v.name === item);
    if (named) return { ...named };
    const m = /^(\d{2,5})x(\d{2,5})$/i.exec(item);
    if (!m) {
      throw new UsageError(`--viewports item "${item}" is neither a profile viewport (${profileViewports.map((v) => v.name).join(', ')}) nor WIDTHxHEIGHT`);
    }
    const width = Number(m[1]);
    const height = Number(m[2]);
    const same = profileViewports.find((v) => v.width === width && v.height === height);
    if (same) return { ...same };
    const phone = width < 600;
    return { name: `${width}x${height}`, width, height, dpr: phone ? 2 : 1, isMobile: phone, hasTouch: phone };
  });
}

/**
 * @param {string | undefined} raw
 * @returns {number}
 */
export function parseSlices(raw) {
  if (raw === undefined) return DEFAULT_SLICES;
  if (!/^\d+$/.test(raw)) throw new UsageError(`--slices needs a whole number from 1 to ${gate.MAX_SLICES_PER_VIEWPORT}`);
  const n = Number(raw);
  if (n < 1 || n > gate.MAX_SLICES_PER_VIEWPORT) {
    throw new UsageError(`--slices ${n} is outside 1-${gate.MAX_SLICES_PER_VIEWPORT}, the policy's cap per viewport (P11)`);
  }
  return n;
}

/**
 * @param {string | undefined} raw
 * @param {Date} now
 * @returns {Date | null}
 */
export function parseDeleteBy(raw, now) {
  if (raw === undefined) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) throw new UsageError(`--delete-by ${raw} is not an ISO 8601 date`);
  if (t <= now.getTime()) throw new UsageError('--delete-by must be in the future');
  if (t > now.getTime() + gate.MAX_RETENTION_DAYS * DAY_MS) {
    throw new UsageError(`--delete-by is more than ${gate.MAX_RETENTION_DAYS} days away; captures are kept only until the ledger is written, at the latest the end of the event (P13)`);
  }
  return new Date(t);
}

/**
 * @param {string} name
 * @returns {string}
 */
function fileSafe(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'viewport';
}

/**
 * @param {string | undefined} durations
 * @param {string | undefined} delays
 * @returns {number} the longest transition, ms
 */
function transitionMs(durations, delays) {
  const ms = (/** @type {string} */ v) => (v.endsWith('ms') ? Number.parseFloat(v) : Number.parseFloat(v) * 1000) || 0;
  const d = String(durations ?? '0s').split(',').map((s) => ms(s.trim()));
  const l = String(delays ?? '0s').split(',').map((s) => ms(s.trim()));
  return Math.max(0, ...d.map((x, i) => x + (l[i % l.length] ?? 0)));
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function messageOf(err) {
  return (err instanceof Error ? err.message : String(err)).split('\n')[0].trim();
}

/**
 * Declared values from author rules (and the style attribute) for the properties a design reading uses, the var()
 * names they reference, and every custom property name declared on the element or inherited by it.
 * @param {CdpMatched} m
 * @param {Set<string>} custom
 */
function summarizeMatched(m, custom) {
  /** @type {Array<{prop: string, value: string, selector: string, media: string[]}>} */
  const declared = [];
  /** @type {Set<string>} */
  const vars = new Set();
  /**
   * @param {CdpStyle} style
   * @param {string} selector
   * @param {string[]} media
   */
  const take = (style, selector, media) => {
    for (const p of style.cssProperties ?? []) {
      if (p.disabled || p.parsedOk === false) continue;
      if (p.name.startsWith('--')) {
        custom.add(p.name);
        continue;
      }
      for (const v of String(p.value).matchAll(/var\(\s*(--[\w-]+)/g)) vars.add(v[1]);
      if (DECLARED_PROPS.has(p.name) && declared.length < 80) declared.push({ prop: p.name, value: String(p.value).slice(0, 160), selector: selector.slice(0, 120), media });
    }
  };
  if (m.inlineStyle) take(m.inlineStyle, 'style attribute', []);
  for (const { rule } of m.matchedCSSRules ?? []) {
    if (rule.origin === 'regular') take(rule.style, rule.selectorList.text, (rule.media ?? []).map((x) => x.text));
  }
  for (const entry of m.inherited ?? []) {
    for (const { rule } of entry.matchedCSSRules ?? []) {
      if (rule.origin !== 'regular') continue;
      for (const p of rule.style.cssProperties ?? []) if (p.name.startsWith('--')) custom.add(p.name);
    }
  }
  return { declared, vars: [...vars].sort().slice(0, 100) };
}

/**
 * Width breakpoints of every media query the engine parsed (expressions first, the query text as a fallback, range
 * syntax included).
 * @param {CdpMedia[]} medias
 */
export function summarizeMedia(medias) {
  /** @type {Map<string, number>} */
  const widths = new Map();
  /** @type {Set<string>} */
  const texts = new Set();
  /** @param {string} feature @param {number} px */
  const add = (feature, px) => {
    if (!Number.isFinite(px) || px <= 0) return;
    const key = `${feature}:${Math.round(px * 100) / 100}`;
    widths.set(key, (widths.get(key) ?? 0) + 1);
  };
  /** @param {number} value @param {string} unit */
  const toPx = (value, unit) => (unit === 'px' ? value : /^r?em$/i.test(unit) ? value * 16 : Number.NaN);
  for (const m of medias) {
    if (texts.size < 120) texts.add(m.text);
    let found = false;
    for (const q of m.mediaList ?? []) {
      for (const e of q.expressions ?? []) {
        if (!/^(min|max)-width$/.test(e.feature)) continue;
        add(e.feature, e.computedLength ?? toPx(e.value, e.unit));
        found = true;
      }
    }
    if (found) continue;
    for (const mm of m.text.matchAll(/\(\s*(min|max)-width\s*:\s*([\d.]+)\s*(px|r?em)\s*\)/gi)) add(`${mm[1].toLowerCase()}-width`, toPx(Number(mm[2]), mm[3]));
    for (const mm of m.text.matchAll(/\(\s*width\s*(>=|>|<=|<)\s*([\d.]+)\s*(px|r?em)\s*\)/gi)) {
      add(mm[1].startsWith('>') ? 'min-width' : 'max-width', toPx(Number(mm[2]), mm[3]));
    }
  }
  return {
    count: medias.length,
    widths: [...widths].map(([key, count]) => {
      const [feature, px] = key.split(':');
      return { feature, px: Number(px), count };
    }).sort((a, b) => a.px - b.px || a.feature.localeCompare(b.feature)),
    texts: [...texts],
  };
}

/**
 * Hover and focus states through CDP forcePseudoState: the listed properties that change, read after the element's
 * own transition time (at most 1 s).
 * @param {CDPSession} cdp
 * @param {Page} page
 * @param {number} nodeId
 */
async function pseudoStates(cdp, page, nodeId) {
  const read = async () => {
    const { computedStyle } = await cdp.send('CSS.getComputedStyleForNode', { nodeId });
    /** @type {Record<string, string>} */
    const out = {};
    for (const p of computedStyle) if (STATE_PROPS.includes(p.name) || p.name === 'transition-duration' || p.name === 'transition-delay') out[p.name] = p.value;
    return out;
  };
  const base = await read();
  const settle = Math.min(1000, transitionMs(base['transition-duration'], base['transition-delay']));
  /** @type {Record<string, Record<string, {from: string, to: string}>>} */
  const states = {};
  for (const [name, classes] of /** @type {const} */ ([['hover', ['hover']], ['focus', ['focus', 'focus-visible']]])) {
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [...classes] });
    if (settle > 0) await page.waitForTimeout(settle + 50);
    const now = await read();
    /** @type {Record<string, {from: string, to: string}>} */
    const changed = {};
    for (const prop of STATE_PROPS) if (now[prop] !== base[prop]) changed[prop] = { from: base[prop] ?? '', to: now[prop] ?? '' };
    states[name] = changed;
  }
  await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
  /** @type {Record<string, string>} */
  const at = {};
  for (const prop of STATE_PROPS) at[prop] = base[prop] ?? '';
  return { base: at, transitionMs: settle, hover: states.hover, focus: states.focus };
}

/**
 * CDP measurements on the marked samples (FD08-F30, FD06-F12): fonts that actually rendered, declared values,
 * hover and focus states, and (once per page) the media queries. A failed call is recorded, never fatal.
 * @param {BrowserContext} context
 * @param {Page} page
 * @param {Sample[]} samples
 * @param {{media: boolean}} options
 * @returns {Promise<CdpData>}
 */
async function cdpCollect(context, page, samples, { media }) {
  /** @type {CdpData} */
  const out = { fonts: [], matched: [], states: [], customProperties: [], mediaQueries: null, errors: [] };
  /** @param {string} what @param {unknown} err */
  const fail = (what, err) => {
    out.errors.push({ what, error: messageOf(err) });
  };
  /** @type {CDPSession} */
  let cdp;
  try {
    cdp = await context.newCDPSession(page);
  } catch (err) {
    fail('CDP session', err);
    return out;
  }
  /** @type {Set<string>} */
  const custom = new Set();
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    /** @type {Set<string>} */
    const done = new Set();
    for (const sample of samples) {
      let nodeId = 0;
      try {
        ({ nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[${SAMPLE_ATTR}="${sample.mark}"]` }));
      } catch (err) {
        fail(`DOM.querySelector ${sample.mark}`, err);
        continue;
      }
      if (!nodeId) {
        out.errors.push({ what: sample.mark, error: 'the sampled element left the DOM' });
        continue;
      }
      try {
        const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        out.fonts.push({ ...sample, fonts });
      } catch (err) {
        fail(`CSS.getPlatformFontsForNode ${sample.mark}`, err);
      }
      if (done.has(sample.mark)) continue;
      done.add(sample.mark);
      try {
        const matched = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
        out.matched.push({ mark: sample.mark, role: sample.role, sel: sample.sel, ...summarizeMatched(matched, custom) });
      } catch (err) {
        fail(`CSS.getMatchedStylesForNode ${sample.mark}`, err);
      }
      if (sample.role === 'button' || sample.role === 'nav') {
        try {
          out.states.push({ mark: sample.mark, role: sample.role, sel: sample.sel, ...(await pseudoStates(cdp, page, nodeId)) });
        } catch (err) {
          fail(`CSS.forcePseudoState ${sample.mark}`, err);
        }
      }
    }
    if (media) {
      try {
        const { medias } = await cdp.send('CSS.getMediaQueries');
        out.mediaQueries = summarizeMedia(medias);
      } catch (err) {
        fail('CSS.getMediaQueries', err);
      }
    }
  } catch (err) {
    fail('CDP', err);
  } finally {
    try {
      await cdp.detach();
    } catch (err) {
      fail('CDP detach', err);
    }
  }
  out.customProperties = [...custom].sort().slice(0, 300);
  return out;
}

/**
 * Viewport slices while really scrolling (the first `slices` screens), then on to the end of the page (at most
 * MAX_SCROLL_STEPS screens) so scroll-triggered content is revealed and mounted.
 * @param {Page} page
 * @param {Viewport} view
 * @param {string} dir
 * @param {number} slices
 * @returns {Promise<Array<{name: string, scrollY: number}>>}
 */
async function scrollAndSlice(page, view, dir, slices) {
  /** @type {Array<{name: string, scrollY: number}>} */
  const shots = [];
  const height = () => page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
  let total = await height();
  for (let step = 0; step < MAX_SCROLL_STEPS; step += 1) {
    const y = step * view.height;
    if (step > 0 && y >= total) break;
    await page.evaluate((top) => window.scrollTo({ top, left: 0, behavior: 'instant' }), y);
    await page.waitForTimeout(step === 0 ? 50 : 250);
    if (step < slices) {
      const name = `${gate.CAPTURE_FILES.slices}/${fileSafe(view.name)}-${String(step).padStart(2, '0')}.png`;
      await page.screenshot({ path: path.join(dir, ...name.split('/')), animations: 'disabled', caret: 'hide', scale: 'css' });
      shots.push({ name, scrollY: await page.evaluate(() => Math.round(window.scrollY)) });
    }
    total = await height();
  }
  await page.waitForTimeout(800);
  return shots;
}

/**
 * Everything measured in one viewport, after readiness (a page that never becomes ready is measured as it is, and
 * the receipt says so).
 * @param {Page} page
 * @param {BrowserContext} context
 * @param {Viewport} view
 * @param {{dir: string, slices: number, first: boolean, log: (line: string) => void}} options
 */
async function captureViewport(page, context, view, { dir, slices, first, log }) {
  let readiness = { ok: true, detail: '' };
  try {
    const r = await waitReady(page, { timeoutMs: 15_000 });
    readiness = { ok: true, detail: `ready after ${r.elapsedMs} ms` };
  } catch (err) {
    if (!(err instanceof CheckError)) throw err;
    readiness = { ok: false, detail: err.message };
    log(`capture: ${view.name}: ${err.message}; measuring the page as it is`);
  }
  const metrics = await page.evaluate(pageMetrics);
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 70, animations: 'disabled', scale: 'css' });
  await page.evaluate(revealBefore);
  const shots = await scrollAndSlice(page, view, dir, slices);
  const reveal = await evaluateWith(page, revealAfter, { max: 200 });
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await page.waitForTimeout(300);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))));
  const elements = compactElements(await page.evaluate(collectElements, { max: 6000, textMax: 120 }));
  const text = (await page.evaluate(collectText, { max: 8000 })).filter((t) => t.visible);
  const numbers = await evaluateWith(page, collectNumerals, { max: 1500, textMax: 60 });
  const landmarks = await evaluateWith(page, collectLandmarks, { max: 200, maxSections: 60, consent: gate.CONSENT_PATTERN.source });
  const faces = await page.evaluate(loadedFaces);
  /** @type {Sample[]} */
  const samples = await evaluateWith(page, markSamples, { attr: SAMPLE_ATTR, consent: gate.CONSENT_PATTERN.source });
  const cdp = await cdpCollect(context, page, samples, { media: first });
  await page.evaluate((attr) => {
    for (const el of Array.from(document.querySelectorAll(`[${attr}]`))) el.removeAttribute(attr);
  }, SAMPLE_ATTR);
  for (const e of cdp.errors) log(`capture: ${view.name}: CDP ${e.what}: ${e.error}`);
  return {
    readiness,
    metrics: { ...metrics, jpegQ70Bytes: jpeg.length, jpegEncoder: 'chromium' },
    shots,
    reveal,
    elements,
    text,
    numbers,
    landmarks,
    faces,
    samples,
    cdp,
  };
}

/**
 * Runs the gate and, when every step passes and the terms review is attested, captures the page. Returns the
 * report whatever the verdict; throws only on usage, environment and unexpected errors (a capture interrupted by
 * one is deleted, never left half-written).
 * @param {CaptureOptions} options
 * @param {CaptureDeps} [deps]
 * @returns {Promise<CaptureReport>}
 */
export async function runCapture(options, deps = {}) {
  const sleep = deps.sleep ?? gate.defaultSleep;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line) => process.stderr.write(`${line}\n`));
  const fetchImpl = deps.fetchImpl ?? gate.fetchText;
  const target = gate.validateTargetUrl(options.url);
  if (options.viewports.length === 0 || options.viewports.length > gate.MAX_VIEWPORTS_PER_PAGE) {
    throw new UsageError(`a capture takes 1 to ${gate.MAX_VIEWPORTS_PER_PAGE} viewports (P11), got ${options.viewports.length}`);
  }
  const slices = Math.min(Math.max(1, Math.trunc(options.slices)), gate.MAX_SLICES_PER_VIEWPORT);
  const host = gate.hostKey(target);
  const slug = gate.pageSlug(target);
  const capturesRoot = path.resolve(options.out);
  const dir = path.join(capturesRoot, host, slug);
  /** @type {CaptureReport} */
  const report = {
    tool: 'capture', policy: gate.POLICY_ID, version: CAPTURE_VERSION, url: target.href, finalUrl: null, host, slug,
    checkedAt: now().toISOString(), dryRun: options.dryRun, verdict: 'error', code: null, reason: '', steps: [],
    userAgent: null, plainUserAgent: gate.PLAIN_USER_AGENT, termsReviewed: options.termsReviewed, terms: null,
    crawlDelay: 0, captureDir: null, files: [], manifest: null, receipt: null, deleteBy: null, purgeCommand: null,
    refsIndex: null, readiness: {}, discarded: false,
  };
  /** @param {Verdict} verdict @param {string | null} code @param {string} reason */
  const done = (verdict, code, reason) => {
    Object.assign(report, { verdict, code, reason });
    log(`capture: ${host}/${slug}: ${verdict}${reason ? `: ${reason}` : ''}`);
    return report;
  };

  const rootGuard = gate.checkStorage(capturesRoot, options.root);
  if (!rootGuard.ok) return done('refused', 'storage', rootGuard.reason);
  if (!options.dryRun) {
    const g = gate.checkStorage(dir, options.root);
    if (!g.ok) return done('refused', 'storage', g.reason);
  }
  const hostLog = gate.HostLog.open(capturesRoot, host, { now: now() });
  let stored = false;
  const discard = () => {
    if (!stored) return;
    rmSync(dir, { recursive: true, force: true });
    stored = false;
    report.discarded = true;
    log(`capture: ${host}/${slug}: the partial capture was deleted`);
  };
  try {
    if (hostLog.blocked) {
      return done('stop', 'blocked-before', `${host} blocked this client at ${hostLog.blocked.at} (${hostLog.blocked.signal}); there is no retry after a block (P9, P17): use the owner's own notes (RF-12)`);
    }
    if (!options.dryRun) {
      const limit = gate.captureLimits(capturesRoot, host, slug);
      if (limit) return done('refused', limit.code, limit.reason);
    }
    const pre = await gate.preflight(target, { fetchImpl, log });
    report.steps.push(...pre.steps);
    report.crawlDelay = pre.crawlDelay;
    if (pre.verdict) {
      if (pre.verdict === 'stop') hostLog.recordBlock({ at: now().toISOString(), url: target.href, signal: pre.reason });
      return done(pre.verdict, pre.code, pre.reason);
    }
    const browser = deps.browser ?? (await launch({ headless: true }));
    try {
      const identity = await gate.browserIdentity(browser);
      report.userAgent = identity;
      /** @type {Array<{view: Viewport, data: Awaited<ReturnType<typeof captureViewport>>}>} */
      const collected = [];
      for (const [i, view] of options.viewports.entries()) {
        const wait = hostLog.waitMs(now(), pre.crawlDelay);
        if (wait > 0) {
          log(`capture: waiting ${(wait / 1000).toFixed(1)} s before the next navigation on ${host} (P17)`);
          await sleep(wait);
        }
        const context = await gate.captureContext(browser, view, identity);
        try {
          const page = await context.newPage();
          const guard = await gate.guardNavigation(page, target, pre.groups);
          hostLog.recordNavigation({ at: now().toISOString(), url: target.href, viewport: view.name, purpose: options.dryRun ? 'dry-run' : 'capture' });
          const nav = await gate.navigate(page, target, pre.groups, guard);
          if (guard.blocked) {
            report.steps.push({ name: 'navigation', viewport: view.name, aborted: guard.url, redirects: guard.hops, note: guard.reason });
            discard();
            return done('skip-site', 'redirect', `${target.href} ${guard.reason}; capture ${guard.url} directly if it is the page you need, so its own robots.txt is read`);
          }
          const nv = await gate.classifyNavigation(page, nav.response, { sleep, navError: nav.error });
          report.finalUrl = page.url();
          report.steps.push({
            name: 'navigation', viewport: view.name, status: nv.seen.status, title: nv.seen.title.slice(0, 120),
            visibleElements: nv.seen.visibleElements, waited: nv.waited, redirects: guard.hops,
            botWall: nv.blocked ? nv.signal : null, navError: nav.error ?? (guard.reason || null),
          });
          if (nv.blocked) {
            hostLog.recordBlock({ at: now().toISOString(), url: target.href, signal: nv.signal ?? 'blocked navigation' });
            discard();
            return done('stop', 'bot-wall', `bot wall or blocked navigation (${nv.signal}); no retry with another identity, headed mode or a proxy: use the owner's own notes (RF-12)`);
          }
          if (nv.seen.status >= 400) {
            discard();
            return done('skip-site', 'http-error', `the page answered HTTP ${nv.seen.status}: an error page is not a design reference; check the URL or take the next candidate`);
          }
          if (i === 0) {
            const reservation = gate.pageReservation(nv.seen);
            if (reservation) return done('skip-site', 'tdm', `${reservation}: no automated capture of this page`);
            const terms = await gate.scanTerms(page, { target, groups: pre.groups, fetchImpl });
            report.terms = terms;
            report.steps.push({ name: 'terms', candidates: terms.candidates, scanned: terms.scanned, reviewed: options.termsReviewed });
            if (terms.wall) {
              const wallHost = terms.wall.host;
              if (wallHost === host) hostLog.recordBlock({ at: now().toISOString(), url: terms.wall.url, signal: terms.wall.signal });
              else {
                const other = gate.HostLog.open(capturesRoot, wallHost, { now: now() });
                try {
                  other.recordBlock({ at: now().toISOString(), url: terms.wall.url, signal: terms.wall.signal });
                } finally {
                  other.release();
                }
              }
              return done('stop', 'bot-wall', `bot wall on a terms link ${terms.wall.url} (${terms.wall.signal}); no retry with another identity: read the terms in a browser and use the owner's own notes (RF-12)`);
            }
            const flagged = terms.flagged;
            if (flagged.length > 0 && !flagged.some((f) => gate.sameDocument(f.url, options.termsReviewed))) {
              return done('needs-human-review', 'terms-flagged', `${flagged.map((f) => f.url).join(' and ')} mentions automated access or data mining ("${String(flagged[0].excerpt ?? '').slice(0, 240)}"); read that clause: if it forbids automated access or reserves TDM, drop the site (RF-12); if it does not, rerun with --terms-reviewed ${flagged[0].url}`);
            }
            if (options.dryRun) {
              return done('allowed', null, 'every gate step passed and nothing was stored; read the site terms, then rerun without --dry-run and with --terms-reviewed <terms url>');
            }
            if (!options.termsReviewed) {
              return done('needs-human-review', 'terms-unreviewed', 'nothing was stored: read the site terms as rendered, then rerun with --terms-reviewed <terms url> (RF-06)');
            }
            if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
            mkdirSync(path.join(dir, gate.CAPTURE_FILES.slices), { recursive: true });
            stored = true;
          }
          const data = await captureViewport(page, context, view, { dir, slices, first: i === 0, log });
          report.readiness[view.name] = data.readiness;
          report.steps.push({ name: 'capture', viewport: view.name, slices: data.shots.length, elements: data.elements.length, readiness: data.readiness.ok });
          collected.push({ view, data });
        } finally {
          await context.close().catch((err) => log(`capture: closing the ${view.name} context failed: ${messageOf(err)}`));
        }
      }
      const capturedAt = now();
      const deleteBy = options.deleteBy ?? new Date(capturedAt.getTime() + gate.DEFAULT_RETENTION_DAYS * DAY_MS);
      const names = writeCaptureFiles(dir, target, capturedAt, collected);
      const files = gate.fileEntries(dir, names);
      const viewports = collected.map(({ view, data }) => ({
        name: view.name, width: view.width, height: view.height, dpr: view.dpr ?? 1, isMobile: view.isMobile ?? false,
        hasTouch: view.hasTouch ?? false, slices: data.shots.length,
      }));
      const purge = gate.purgeCommand(dir);
      const records = gate.writeCaptureRecords(dir, {
        manifest: {
          url: target.href, finalUrl: report.finalUrl, host, slug, capturedAt: capturedAt.toISOString(),
          deleteBy: deleteBy.toISOString(), deleteWhen: gate.POLICY.storage.deleteWhen, userAgent: report.userAgent,
          termsReviewed: options.termsReviewed, viewports, files,
          note: 'third-party capture for text and data mining only: private, outside every git work tree, never redistributed (P12, P14), purged once the pattern ledger passes',
        },
        receipt: {
          tool: 'capture-gate', version: gate.GATE_VERSION, url: target.href, finalUrl: report.finalUrl, origin: target.origin,
          host, slug, checkedAt: report.checkedAt, capturedAt: capturedAt.toISOString(), verdict: 'captured',
          reason: 'robots.txt, TDM reservations, bot-wall checks and the terms attestation passed',
          userAgent: report.userAgent, plainUserAgent: gate.PLAIN_USER_AGENT, termsReviewed: options.termsReviewed,
          terms: report.terms, robots: pre.robots, crawlDelay: pre.crawlDelay, steps: report.steps, viewports,
          readiness: report.readiness, deleteBy: deleteBy.toISOString(), purgeCommand: purge, limits: gate.POLICY.limits,
        },
      });
      stored = false;
      hostLog.recordCapture({ slug, url: target.href, at: capturedAt.toISOString() });
      Object.assign(report, {
        captureDir: toPosix(dir), files, manifest: records.manifestPath, receipt: records.receiptPath,
        deleteBy: deleteBy.toISOString(), purgeCommand: purge,
      });
      if (options.state) {
        report.refsIndex = gate.upsertRefsIndex(options.state, capturesRoot, {
          host, slug, url: target.href, dir: toPosix(dir), receipt: records.receiptPath, manifest: records.manifestPath,
          captured_at: capturedAt.toISOString(), delete_by: deleteBy.toISOString(), viewports: viewports.map((v) => v.name),
          purged: false, deletion_receipt: null,
        });
      }
      return done('captured', null, `${files.length} files stored with SHA-256 in ${toPosix(records.manifestPath)}; delete them once the ledger passes refs.ledger, by ${deleteBy.toISOString()} at the latest: ${purge}`);
    } finally {
      if (!deps.browser) await browser.close();
    }
  } catch (err) {
    discard();
    Object.assign(report, { verdict: 'error', code: 'error', reason: messageOf(err) });
    throw err;
  } finally {
    hostLog.recordRun({ at: now().toISOString(), slug, url: target.href, verdict: report.verdict, reason: report.reason });
    hostLog.release();
  }
}

/**
 * Writes styles.json, fonts.json, landmarks.json and reveal.json; returns every stored file name (slices included).
 * @param {string} dir
 * @param {URL} target
 * @param {Date} capturedAt
 * @param {Array<{view: Viewport, data: Awaited<ReturnType<typeof captureViewport>>}>} collected
 * @returns {string[]}
 */
function writeCaptureFiles(dir, target, capturedAt, collected) {
  const at = capturedAt.toISOString();
  const first = collected[0]?.data;
  /** @param {(d: Awaited<ReturnType<typeof captureViewport>>) => unknown} pick */
  const perViewport = (pick) => Object.fromEntries(collected.map(({ view, data }) => [view.name, pick(data)]));
  const F = gate.CAPTURE_FILES;
  gate.writeJson(path.join(dir, F.styles), {
    kind: 'styles', url: target.href, capturedAt: at, format: STYLES_FORMAT,
    mediaQueries: first ? first.cdp.mediaQueries : null,
    viewports: perViewport((d) => ({
      page: d.metrics, readiness: d.readiness, elements: d.elements, text: d.text, numbers: d.numbers,
      declared: { matched: d.cdp.matched, customProperties: d.cdp.customProperties }, states: d.cdp.states,
    })),
  });
  gate.writeJson(path.join(dir, F.fonts), {
    kind: 'fonts', url: target.href, capturedAt: at,
    viewports: perViewport((d) => ({ samples: d.cdp.fonts, loadedFaces: d.faces, errors: d.cdp.errors })),
  });
  gate.writeJson(path.join(dir, F.landmarks), { kind: 'landmarks', url: target.href, capturedAt: at, viewports: perViewport((d) => d.landmarks) });
  gate.writeJson(path.join(dir, F.reveal), {
    kind: 'reveal', url: target.href, capturedAt: at,
    viewports: perViewport((d) => ({ ...d.reveal, slices: d.shots })),
  });
  return [...collected.flatMap(({ data }) => data.shots.map((s) => s.name)), F.styles, F.fonts, F.landmarks, F.reveal];
}

// ---------- CLI ----------

const HELP = `Usage:
  node capture.mjs --url <https url> --root <repo> --terms-reviewed <terms url> [options]
  node capture.mjs --url <https url> --dry-run [--root <repo>] [options]
  node capture.mjs --purge <capture folder | captures root> [--state <dir>] [--json]

Captures one third-party reference page through the FD19 gate (capture-gate.mjs; not legal advice): robots.txt for
frontend-capture and Claude-User (the stricter wins), TDMRep, ai.txt and Content-Usage reservations, bot walls
(stop at once; a silent challenge gets one passive wait), the terms scan, then viewport slices, computed styles,
CDP-rendered fonts, landmarks and a reveal probe for at most ${gate.MAX_VIEWPORTS_PER_PAGE} viewports, written with a SHA-256 manifest and
a gate receipt to <captures root>/<host>/<slug>/. Navigations on one host are ${gate.MIN_DELAY_MS / 1000} s apart at least (or the
robots.txt Crawl-delay), at most ${gate.MAX_PAGES_PER_HOST} pages per host and ${gate.MAX_HOSTS} hosts are kept, and a host that blocked once is never
tried again.

Options:
  --url <url>              the one page to capture (https; plain http only on loopback, for fixtures)
  --root <repo>            the product repository (alias --project-root); captures must lie outside it
  --profile <abs path>     /execution profile.json or frontend block: viewports, workspace.private_dir
  --state <dir>            state folder that gets refs-index.json (default: the profile's state folder)
  --out <dir>              captures root (default <workspace.private_dir>/frontend/captures, else
                           <os tmp>/frontend-captures); never inside a git work tree or a synced folder
  --terms-reviewed <url>   attests that someone read the site terms at <url> and that they neither forbid automated
                           access nor reserve text and data mining; nothing is stored without it. When the terms scan
                           flags a page, <url> must be that page.
  --dry-run                every check, one navigation, nothing stored
  --viewports <list>       profile viewport names or WIDTHxHEIGHT, at most ${gate.MAX_VIEWPORTS_PER_PAGE} (default: the profile's first two)
  --slices <n>             viewport slices per viewport, 1-${gate.MAX_SLICES_PER_VIEWPORT} (default ${DEFAULT_SLICES}); the full page is still scrolled
  --delete-by <date>       ISO date by which the capture must be purged, within ${gate.MAX_RETENTION_DAYS} days (default +${gate.DEFAULT_RETENTION_DAYS} days)
  --purge <dir>            delete a capture's files and write its deletion-receipt.json (capture-gate.mjs purge)
  --json                   the report on stdout
  -h, --help               this text

There is no option to change the user agent, run headed, use a proxy or retry after a block.

Exit codes: 0 captured (or --dry-run: every check passed); 1 a policy refusal: read "verdict" (skip-site, stop,
needs-human-review, refused) and "reason" in the JSON, never the exit code alone, or a purge that left files;
2 usage error; 3 environment error (no browser, captures root not writable, the host's capture lock held).`;

/**
 * @param {readonly string[]} argv
 * @param {CaptureDeps & {stdout?: (s: string) => void}} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? ((s) => process.stdout.write(s));
  const log = deps.log ?? ((line) => process.stderr.write(`${line}\n`));
  const now = deps.now ?? (() => new Date());
  const { values } = parseCli(argv, {
    help: HELP,
    allowPositionals: false,
    options: {
      url: { type: 'string' },
      root: { type: 'string' },
      'project-root': { type: 'string' },
      profile: { type: 'string' },
      state: { type: 'string' },
      out: { type: 'string' },
      'terms-reviewed': { type: 'string' },
      'dry-run': { type: 'boolean' },
      viewports: { type: 'string' },
      slices: { type: 'string' },
      'delete-by': { type: 'string' },
      purge: { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  if (values.purge !== undefined) {
    const extra = ['url', 'root', 'project-root', 'profile', 'out', 'terms-reviewed', 'dry-run', 'viewports', 'slices', 'delete-by']
      .find((k) => values[/** @type {keyof typeof values} */ (k)] !== undefined);
    if (extra) throw new UsageError(`--purge does not combine with --${extra}`);
    const results = gate.purge(values.purge, { state: values.state ? path.resolve(values.state) : null, now: now() });
    for (const { dir, receipt } of results) log(`purge: ${dir}: ${receipt.alreadyPurged ? 'already purged' : 'files deleted'}${receipt.ok ? '' : ', SOME FILES REMAIN'}`);
    if (values.json) stdout(`${JSON.stringify(results, null, 2)}\n`);
    const failed = results.filter((r) => r.receipt.ok !== true);
    if (failed.length) throw new CheckError(`${failed.length} capture(s) still hold files (${failed.map((f) => f.dir).join(', ')}); close what holds them and purge again`);
    return 0;
  }
  if (values.root && values['project-root'] && path.resolve(values.root) !== path.resolve(values['project-root'])) {
    throw new UsageError('--root and --project-root name different folders; pass one');
  }
  const root = values.root ?? values['project-root'] ?? null;
  const dryRun = Boolean(values['dry-run']);
  if (!dryRun && !root) {
    throw new UsageError('--root <repo> is required to store a capture: captures must stay outside the product repository (P12); add --dry-run to check without storing');
  }
  const termsReviewed = values['terms-reviewed'] ?? null;
  if (termsReviewed !== null && !/^https?:\/\/\S+$/i.test(termsReviewed)) {
    throw new UsageError('--terms-reviewed needs the URL of the terms page that was read');
  }
  gate.validateTargetUrl(values.url);
  const profile = loadProfile(values.profile, { root: root ?? undefined });
  const viewports = resolveCaptureViewports(values.viewports, profile.viewports);
  const slices = parseSlices(values.slices);
  const deleteBy = parseDeleteBy(values['delete-by'], now());
  const out = gate.resolveCapturesRoot(values.out, profile.workspace.private_dir);
  if (!values.out && !profile.workspace.private_dir) log(`capture: no --out and no workspace.private_dir in the profile: the captures root is ${toPosix(out)}`);
  const state = dryRun || !root ? null : stateDir(root, profile, values.state ?? null);
  const report = await runCapture({ url: /** @type {string} */ (values.url), root, out, termsReviewed, dryRun, viewports, slices, deleteBy, state }, deps);
  if (values.json) stdout(`${JSON.stringify(report, null, 2)}\n`);
  if (report.verdict === 'captured' || report.verdict === 'allowed') return 0;
  throw new CheckError(`capture of ${report.url} refused (${report.verdict}${report.code ? `, ${report.code}` : ''}): ${report.reason}`);
}

/**
 * @returns {boolean}
 */
function isMain() {
  return isMainModule(import.meta.url);
}

if (isMain()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }, exitWith);
}
