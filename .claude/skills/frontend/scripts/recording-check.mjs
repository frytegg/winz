// @ts-check
/*
 * recording-check: renders each route the way a judge sees the demo video (a 1920x1080 capture, a 720p and a 540p
 * H.264 copy, a projector at 125% and 150% zoom) and reports what will not survive: gates recording.g01 to g16 of
 * research/technique-recording-readiness.md (FD20) Deliverable B, ported from research/_scripts/fd20/recording-check.mjs.
 * Corrections applied: the frame is frozen deterministically before it is measured (finite animations finished,
 * infinite ones cancelled to their resting style, then two painted frames, and the screenshot itself disables
 * animations), because the research checker's CAMBI and contrast counts drifted with a blinking badge (FD20-F20);
 * nothing is fetched from the network; the 333 ms blink rule is a design choice aligned with WCAG 2.3.2, stricter
 * than 2.3.1 (FD20-F16); blue on dark is not a size-step trigger (FD20-F08). Gates that the research marks WARN pass
 * with their warnings in the evidence; manual parts are checked where a file can be read (--master, --deck).
 */
import { spawnSync } from 'node:child_process';
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInflateRaw } from 'node:zlib';
import { parseCli, isMainModule } from './lib/args.mjs';
import { goto, launch, newContext } from './lib/browser.mjs';
import { composite, contrastRatio, parseColor, relativeLuminance, toOklch } from './lib/color.mjs';
import { collectAnimations, selectorFor } from './lib/dom.mjs';
import { EnvError, UsageError, exitWith } from './lib/errors.mjs';
import { toPosix, walk, writeText } from './lib/fsutil.mjs';
import { checkStateDir, designDir } from './lib/paths.mjs';
import { loadProfile } from './lib/profile.mjs';
import { waitReady } from './lib/ready.mjs';
import { aggregate, gate, utcStamp, writeReport } from './lib/report.mjs';
import { loadRoutes, routeUrl } from './lib/routes.mjs';
import { serveStatic } from './lib/serve.mjs';
import { lineOf } from './lib/text.mjs';
import { sourceFiles } from './rules/load.mjs';

/**
 * @typedef {import('./lib/report.mjs').GateResult} GateResult
 * @typedef {import('./lib/report.mjs').Evidence} Evidence
 * @typedef {import('./lib/profile.mjs').Profile} Profile
 * @typedef {import('./lib/profile.mjs').Viewport} Viewport
 * @typedef {import('./lib/routes.mjs').Route} Route
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('playwright-core').Page} Page
 * @typedef {{root: string, profile: Profile, state: string | null, design: string, routes: Route[],
 *   baseUrl: string | null, browser: Browser | null, viewports: Viewport[], args: Record<string, unknown>,
 *   log: (message: string) => void}} CheckContext
 */

const TOOL = 'recording-check';

/** Thresholds and their sources (FD20 finding ids). */
export const THRESHOLDS = Object.freeze({
  // F04: 720p copies read the embedded number in 47-48 of 48 strings at 18 px Inter (6.6 px x-height delivered),
  // 36-41 of 48 at 16 px (5.8 px), 19-27 of 48 at 14 px (5.1 px). FAIL under the 16 px level, WARN under 18 px.
  minDeliveredXHeight720: 5.8,
  warnDeliveredXHeight720: 6.5,
  // F04: in a 540p copy (half-size slide pane) 24 px Inter held in 48 of 48 strings. Key text must survive it.
  minDeliveredXHeight540Key: 6.5,
  // F08 / WCAG 2.2 SC 1.4.3 (large text: 24 px, or 18.66 px at 700 or bolder).
  minContrast: 4.5,
  minContrastLarge: 3,
  // F17: PISCR minimum system contrast, basic decision making 15:1, passive viewing 7:1.
  projectorSystemContrast: 15,
  projectorPassiveContrast: 7,
  // F09: Netflix CAMBI rule of thumb, about 5 is where banding becomes slightly annoying.
  maxCambi: 5,
  // F09: every gradient whose stops all stayed below this relative luminance banded after encoding.
  darkGradientMaxLuminance: 0.1,
  minGradientAreaRatio: 0.05,
  // F11: 1 px lines at 1.48:1 or less fell to 1.26:1 or less at 720p.
  hairlineMinContrast: 1.5,
  // F12: dark surfaces keep steps of 1.1:1 or more.
  darkSurfaceMinStep: 1.1,
  darkSurfaceMaxLuminance: 0.06,
  minSurfaceAreaRatio: 0.01,
  // F16: no blink faster than 333 ms per cycle (WCAG 2.3.2's three flashes a second; stricter than 2.3.1).
  minBlinkPeriodMs: 333,
  // F08: weights of 300 or lighter and red on dark need one size step more (the 18 px level).
  thinWeight: 300,
});

export const GATES = Object.freeze([
  ['g01', 'Text a judge must read keeps 5.8 px of x-height in the 720p copy (Inter 16 px)', 'body text could blur away in the 720p copy a judge streams'],
  ['g02', 'Reading text keeps 6.5 px of x-height in the 720p copy (Inter 18 px)', 'reading text could sit where OCR already misreads numbers (warning)'],
  ['g03', 'Key text (data-rec-role="key") keeps 6.5 px of x-height in the 540p copy (Inter 24 px)', 'the claim and the proof values could be unreadable when the video plays at half size in a slide'],
  ['g04', 'Thin weights and red on dark sit one size step up (18 px level)', 'thin or red-on-dark text could lose a step of legibility after encoding (warning)'],
  ['g05', 'Rendered contrast sampled from pixels meets WCAG 1.4.3 against the worst background', 'text could pass in CSS and fail on the frame the judge actually sees'],
  ['g06', 'Text keeps 4.5:1 on a projector at the 15:1 system floor', 'dark-UI text could wash out on a stage projector (warning)'],
  ['g07', 'No banding: CAMBI at most 5 on the 720p H.264 copy; no large all-dark gradient', 'a dark gradient hero could band into visible steps after encoding'],
  ['g08', 'No grain or noise overlay on recorded screens', 'grain would be erased by the encoder, cost bytes and still not stop banding (warning)'],
  ['g09', 'No structural 1 px border under 1.5:1', 'table rules and card edges could vanish in the 720p copy (warning)'],
  ['g10', 'Dark surfaces keep 1.1:1 steps; the master is tagged limited range', 'near-black surfaces could crush into one black after a colour-range mismatch (warning)'],
  ['g11', 'No text revealed only on hover; no hover-only rules or title tooltips', 'content a recording never hovers would never appear on video'],
  ['g12', 'No blink faster than 333 ms per cycle; loops frozen for the recording', 'a fast blink could flicker on video, and loops pull the eye and cost bitrate'],
  ['g13', 'Every data region shows live, testnet or simulated plus an as-of time or block', 'a recorded figure could not be told from a mock-up (warning)'],
  ['g14', 'No horizontal overflow at 125% and 150% zoom; key elements in the first viewport', 'the layout could break on the stage laptop at 125% or 150% zoom'],
  ['g15', 'A Ledger device flow mirrors the device step in the page', 'a judge watching the video could not see what the hardware signer asks'],
  ['g16', 'The deck is .pptx or single-file .key with the H.264 MP4 embedded, never 97-2003 .ppt', 'the embedded demo video could arrive as a still picture or not play on stage'],
].map(([n, title, ifDropped]) => Object.freeze({ id: `recording.${n}`, title, ifDropped })));

// ---------------------------------------------------------------------------------------------------------------
// In-page code (self-contained; selectorFor is passed in).
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{x: number, y: number, w: number, h: number}} Rect
 * @typedef {{sel: string, text: string, size: number, weight: number, family: string, xHeight: number,
 *   role: string, inFirstViewport: boolean, rect: Rect, color: string, bg: string}} TextRun
 * @typedef {{vw: number, vh: number, runs: TextRun[],
 *   hoverRules: Array<{selector: string, props: string[], triggers: string[]}>, unreadableSheets: string[],
 *   titles: Array<{sel: string, tag: string, title: string, key: boolean}>,
 *   gradients: Array<{sel: string, image: string, under: string, areaRatio: number}>,
 *   grain: Array<{sel: string, via: string, animated: boolean}>,
 *   hairlines: Array<{sel: string, side: string, color: string, bg: string}>,
 *   surfaces: Array<{sel: string, own: string, under: string, border: number, borderColor: string, areaRatio: number}>,
 *   marquees: number,
 *   regions: Array<{sel: string, source: string | null, asOfAttr: string | null, label: string | null, stamp: string | null}>,
 *   firstViewText: string, keys: number}} Analysis
 */

/**
 * Measures the frozen first frame: text runs with x-height from canvas metrics at 1000 px, their colour and the
 * composited background; :hover rules that change visibility; title tooltips; gradients; grain; 1 px borders; dark
 * surfaces; marquees; data regions with their provenance label and as-of stamp.
 * @param {(el: Element, counts?: Map<string, number>) => string} sel
 * @param {{minGradientAreaRatio: number, minSurfaceAreaRatio: number}} T
 * @returns {Analysis}
 */
export function recordingAnalysis(sel, T) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const counts = new Map();
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const paint = canvas.getContext('2d', { willReadFrequently: true });
  /** @type {Map<string, [number, number, number, number]>} */
  const cache = new Map();
  /** @param {string} css @returns {[number, number, number, number]} */
  const rgba = (css) => {
    const hit = cache.get(css);
    if (hit) return hit;
    /** @type {[number, number, number, number]} */
    let v = [0, 0, 0, 0];
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(css);
    if (m) v = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : m[5] === '%' ? Number(m[4]) / 100 : Number(m[4])];
    else if (paint) {
      paint.clearRect(0, 0, 1, 1);
      paint.fillStyle = 'rgba(0, 0, 0, 0)';
      paint.fillStyle = css;
      paint.fillRect(0, 0, 1, 1);
      const d = paint.getImageData(0, 0, 1, 1).data;
      v = [d[0], d[1], d[2], d[3] / 255];
    }
    cache.set(css, v);
    return v;
  };
  /** @param {[number, number, number, number]} c */
  const css = (c) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${Math.round(c[3] * 1000) / 1000})`;
  /** @type {Map<Element | null, [number, number, number]>} */
  const bgMemo = new Map();
  /** @param {Element | null} el @returns {[number, number, number]} */
  const bgOf = (el) => {
    if (!el) return [255, 255, 255];
    const hit = bgMemo.get(el);
    if (hit) return hit;
    const below = bgOf(el.parentElement);
    const own = rgba(getComputedStyle(el).backgroundColor);
    const a = own[3];
    /** @type {[number, number, number]} */
    const v = a >= 1 ? [own[0], own[1], own[2]] : a <= 0 ? below : [own[0] * a + below[0] * (1 - a), own[1] * a + below[1] * (1 - a), own[2] * a + below[2] * (1 - a)];
    bgMemo.set(el, v);
    return v;
  };
  /** @param {[number, number, number]} c */
  const rgb = (c) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
  /** @param {Element} el */
  const visible = (el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true);
  /** @param {DOMRect} r */
  const inView = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
  const metricCanvas = document.createElement('canvas').getContext('2d');
  /** @type {Map<string, number>} */
  const metricMemo = new Map();
  /** @param {CSSStyleDeclaration} cs */
  const xRatio = (cs) => {
    const key = `${cs.fontStyle} ${cs.fontWeight} 1000px ${cs.fontFamily}`;
    const hit = metricMemo.get(key);
    if (hit !== undefined) return hit;
    let ratio = 0.5;
    if (metricCanvas) {
      metricCanvas.font = key;
      ratio = metricCanvas.measureText('x').actualBoundingBoxAscent / 1000;
    }
    metricMemo.set(key, ratio);
    return ratio;
  };

  /** @type {TextRun[]} */
  const runs = [];
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && runs.length < 3000; n = walker.nextNode()) {
    const text = (n.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || el.closest('script, style, noscript, template, title, head') || !visible(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
    if (rects.length === 0) continue;
    const cs = getComputedStyle(el);
    const size = Number.parseFloat(cs.fontSize) || 0;
    const roleEl = el.closest('[data-rec-role]');
    const role = roleEl ? roleEl.getAttribute('data-rec-role') || 'text' : el.closest('[aria-hidden="true"]') ? 'decor' : 'text';
    const r0 = rects[0];
    runs.push({
      sel: sel(el, counts),
      text: text.slice(0, 80),
      size,
      weight: Number(cs.fontWeight) || 400,
      family: cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''),
      xHeight: Math.round(xRatio(cs) * size * 100) / 100,
      role,
      inFirstViewport: rects.some(inView),
      rect: { x: r0.x, y: r0.y, w: r0.width, h: r0.height },
      color: css(rgba(cs.color)),
      bg: rgb(bgOf(el)),
    });
  }

  /** @type {Analysis['hoverRules']} */
  const hoverRules = [];
  /** @type {string[]} */
  const unreadableSheets = [];
  /** @param {CSSRuleList} rules */
  const walkRules = (rules) => {
    for (const r of Array.from(rules)) {
      if (!(r instanceof CSSStyleRule)) {
        const nested = /** @type {{cssRules?: CSSRuleList}} */ (r).cssRules;
        if (nested) walkRules(nested);
        continue;
      }
      if (r.selectorText.includes(':hover')) {
        const props = ['display', 'visibility', 'opacity', 'max-height', 'height', 'clip-path', 'transform'].filter((p) => r.style.getPropertyValue(p));
        if (props.length > 0) {
          const triggers = r.selectorText.split(',').map((s) => {
            const i = s.indexOf(':hover');
            if (i < 0) return null;
            const rest = s.slice(i + 6);
            const end = rest.search(/[\s>+~]/);
            return (s.slice(0, i) + (end < 0 ? rest : rest.slice(0, end))).trim() || '*';
          }).filter((t) => typeof t === 'string');
          hoverRules.push({ selector: r.selectorText.slice(0, 160), props, triggers: /** @type {string[]} */ (triggers) });
        }
      }
      if (r.cssRules && r.cssRules.length) walkRules(r.cssRules);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walkRules(sheet.cssRules);
    } catch {
      unreadableSheets.push(sheet.href || '(inline)');
    }
  }
  const titles = Array.from(document.querySelectorAll('[title]'))
    .filter((e) => visible(e) && inView(e.getBoundingClientRect()))
    .map((e) => ({ sel: sel(e, counts), tag: e.localName, title: (e.getAttribute('title') || '').slice(0, 80), key: Boolean(e.closest('[data-rec-role="key"]')) }));

  /** @type {Analysis['gradients']} */
  const gradients = [];
  /** @type {Analysis['grain']} */
  const grain = [];
  /** @type {Analysis['hairlines']} */
  const hairlines = [];
  /** @type {Analysis['surfaces']} */
  const surfaces = [];
  for (const el of Array.from(document.querySelectorAll('body, body *'))) {
    if (el.closest('svg') && el.localName !== 'svg') continue;
    const r = el.getBoundingClientRect();
    if (!inView(r) || !visible(el)) continue;
    const cs = getComputedStyle(el);
    const area = (Math.min(r.right, vw) - Math.max(r.left, 0)) * (Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const ratio = area / (vw * vh);
    if (cs.backgroundImage.includes('gradient(') && ratio >= T.minGradientAreaRatio) {
      gradients.push({ sel: sel(el, counts), image: cs.backgroundImage.slice(0, 600), under: rgb(bgOf(el)), areaRatio: Math.round(ratio * 100) / 100 });
    }
    const bgi = cs.backgroundImage.toLowerCase();
    const cls = String(el.getAttribute('class') || '').toLowerCase();
    if (/feturbulence|noise|grain/.test(bgi) || /(^|[\s_-])(noise|grain)([\s_-]|$)/.test(cls)) {
      grain.push({ sel: sel(el, counts), via: 'css', animated: cs.animationName !== 'none' });
    }
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`);
      const width = Number.parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`));
      if (style === 'none' || style === 'hidden' || width !== 1) continue;
      hairlines.push({ sel: sel(el, counts), side: side.toLowerCase(), color: css(rgba(cs.getPropertyValue(`border-${side.toLowerCase()}-color`))), bg: rgb(bgOf(el)) });
      break;
    }
    const own = rgba(cs.backgroundColor);
    if (own[3] >= 0.9 && ratio >= T.minSurfaceAreaRatio && el.parentElement) {
      const width = Math.max(...['top', 'right', 'bottom', 'left'].map((s) => Number.parseFloat(cs.getPropertyValue(`border-${s}-width`)) || 0));
      surfaces.push({ sel: sel(el, counts), own: rgb(bgOf(el)), under: rgb(bgOf(el.parentElement)), border: width, borderColor: css(rgba(cs.borderTopColor)), areaRatio: Math.round(ratio * 1000) / 1000 });
    }
  }
  for (const f of Array.from(document.querySelectorAll('feTurbulence'))) {
    const host = f.closest('svg');
    grain.push({ sel: host ? sel(host, counts) : 'feTurbulence', via: 'svg feTurbulence', animated: Boolean(host && host.querySelector('animate, animateTransform')) });
  }

  const LABEL = /\b(?:simulated|simulation|mock(?:ed)?|fixture|demo data|sample data|testnet|preprod|pre-prod|preview|devnet|sepolia|holesky|mainnet|live)\b/i;
  const STAMP = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:UTC|GMT|SGT|CET|CEST)\b|\bblock\s#?[\d,]{3,}|\bas of\b/i;
  const regions = Array.from(document.querySelectorAll('[data-source], [data-provenance], [data-metric]'))
    .filter((e) => visible(e) && inView(e.getBoundingClientRect()))
    .map((e) => {
      const scope = e.closest('[data-feature], section, article, figure') || e;
      const text = `${e instanceof HTMLElement ? e.innerText : e.textContent || ''} ${scope instanceof HTMLElement ? scope.innerText : scope.textContent || ''}`.replace(/\s+/g, ' ');
      const label = LABEL.exec(text);
      const stamp = STAMP.exec(text);
      return {
        sel: sel(e, counts),
        source: e.getAttribute('data-source') || e.getAttribute('data-provenance'),
        asOfAttr: e.getAttribute('data-as-of') || (scope.getAttribute && scope.getAttribute('data-as-of')),
        label: label ? label[0] : null,
        stamp: stamp ? stamp[0] : null,
      };
    });
  const firstViewText = runs.filter((r) => r.inFirstViewport).map((r) => r.text).join(' • ').slice(0, 20000);
  return {
    vw, vh, runs, hoverRules, unreadableSheets, titles, gradients, grain, hairlines, surfaces,
    marquees: document.querySelectorAll('marquee').length,
    regions,
    firstViewText,
    keys: document.querySelectorAll('[data-rec-role="key"]').length,
  };
}

/** Freezes the frame: finite animations jump to their end, infinite ones are cancelled to the resting style. */
function freezeAnimations() {
  for (const a of document.getAnimations()) {
    const timing = a.effect ? a.effect.getComputedTiming() : null;
    try {
      if (timing && timing.iterations === Infinity) a.cancel();
      else a.finish();
    } catch {
      try {
        a.cancel();
      } catch {
        continue;
      }
    }
  }
}

/** Visible text in the first viewport, for the live hover probe. */
function visibleTexts() {
  const out = new Set();
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!t || !el) continue;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > window.innerHeight) continue;
    out.add(t.slice(0, 120));
  }
  return [...out];
}

/**
 * Elements that may reveal content on hover, in the first viewport, with selectors (at most `limit`).
 * @param {(el: Element, counts?: Map<string, number>) => string} sel
 * @param {{triggers: string[], limit: number}} opts
 * @returns {Array<{sel: string, label: string}>}
 */
export function hoverTriggers(sel, opts) {
  const counts = new Map();
  const base = 'a, button, [role="button"], [tabindex], summary, [data-tooltip], [aria-describedby], [title]';
  /** @type {Element[]} */
  let list = [];
  try {
    list = Array.from(document.querySelectorAll([base, ...opts.triggers].join(', ')));
  } catch {
    list = Array.from(document.querySelectorAll(base));
  }
  const out = [];
  for (const el of list) {
    if (out.length >= opts.limit) break;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.top > window.innerHeight || r.bottom < 0) continue;
    out.push({ sel: sel(el, counts), label: `${el.localName} ${(el.textContent || '').trim().slice(0, 40)}` });
  }
  return out;
}

/**
 * @template T
 * @param {Page} page
 * @param {(sel: (el: Element, counts?: Map<string, number>) => string, arg: any) => T} fn
 * @param {unknown} [arg]
 * @returns {Promise<T>}
 */
async function evaluateWithSelector(page, fn, arg) {
  return /** @type {Promise<T>} */ (page.evaluate(`(${fn.toString()})(${selectorFor.toString()}, ${JSON.stringify(arg ?? null)})`));
}

// ---------------------------------------------------------------------------------------------------------------
// Pure rules (exported for tests).
// ---------------------------------------------------------------------------------------------------------------

/**
 * Projector model (FD20-F17): a black floor of 1/C added to both colours (white = 1); WCAG's +0.05 is C = 21.
 * @param {number} fgL
 * @param {number} bgL
 * @param {number} C
 * @returns {number}
 */
export function projected(fgL, bgL, C) {
  const f = 1 / C;
  const a = f + (1 - f) * fgL;
  const b = f + (1 - f) * bgL;
  return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
}

/**
 * x-height of a run in a copy of `copyHeight` lines made from a capture `captureHeight` tall.
 * @param {number} xHeight
 * @param {number} copyHeight
 * @param {number} captureHeight
 * @returns {number}
 */
export function deliveredXHeight(xHeight, copyHeight, captureHeight) {
  return (xHeight * copyHeight) / captureHeight;
}

/**
 * True for a red text colour (OKLCH hue 0-40 or 340-360, chroma 0.1 or more) on a dark background (relative
 * luminance under 0.1), the F08 case that needs one size step more. Blue is not included (corrected at verification).
 * @param {string} color
 * @param {string} bg
 * @returns {boolean}
 */
export function redOnDark(color, bg) {
  const c = parseColor(color);
  const b = parseColor(bg);
  if (!c || !b) return false;
  const { c: chroma, h } = toOklch(c);
  return chroma >= 0.1 && (h <= 40 || h >= 340) && relativeLuminance(b) < 0.1;
}

/**
 * Colour stops of a computed gradient, composited over the background under it: relative luminance of each.
 * @param {string} image computed background-image
 * @param {string} under
 * @returns {number[]}
 */
export function gradientStopLuminance(image, under) {
  const base = parseColor(under) ?? { r: 1, g: 1, b: 1, a: 1 };
  const stops = [...image.matchAll(/(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi)].map((m) => parseColor(m[0])).filter((c) => c !== null);
  return stops.map((c) => relativeLuminance(composite(/** @type {import('./lib/color.mjs').Rgba} */ (c), { ...base, a: 1 })));
}

/**
 * True when an infinite animation that changes opacity, visibility or a colour cycles faster than 333 ms.
 * @param {{iterations: number | 'infinite', duration: number, properties: string[]}} a
 * @returns {boolean}
 */
export function blinkRisk(a) {
  return a.iterations === 'infinite' && a.duration > 0 && a.duration < THRESHOLDS.minBlinkPeriodMs && a.properties.some((p) => /opacity|visibility|color|background/i.test(p));
}

// ---------------------------------------------------------------------------------------------------------------
// ffmpeg: judge copies and CAMBI.
// ---------------------------------------------------------------------------------------------------------------

/**
 * The ffmpeg build available: `FFMPEG_PATH` or `ffmpeg` on PATH, with libx264 and libvmaf flags, and ffprobe
 * (`FFPROBE_PATH`, next to ffmpeg, or on PATH). Null fields when absent.
 * @returns {{bin: string | null, x264: boolean, vmaf: boolean, probe: string | null, why: string}}
 */
export function ffmpegInfo() {
  const bin = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
  const run = (/** @type {string} */ exe, /** @type {string[]} */ args) => spawnSync(exe, args, { encoding: 'utf8', timeout: 20000, windowsHide: true });
  const encoders = run(bin, ['-hide_banner', '-encoders']);
  let probe = process.env.FFPROBE_PATH?.trim() || null;
  if (!probe) {
    const sibling = path.join(path.dirname(bin), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    probe = path.isAbsolute(bin) && existsSync(sibling) ? sibling : 'ffprobe';
  }
  const probeOk = run(probe, ['-version']).status === 0;
  if (encoders.status !== 0 || encoders.error) {
    return { bin: null, x264: false, vmaf: false, probe: probeOk ? probe : null, why: `ffmpeg not found (${bin}); set FFMPEG_PATH to an ffmpeg with libx264 and libvmaf` };
  }
  const filters = run(bin, ['-hide_banner', '-filters']);
  const x264 = /\blibx264\b/.test(encoders.stdout);
  const vmaf = /\blibvmaf\b/.test(filters.stdout ?? '');
  const why = !x264 ? `${bin} has no libx264 encoder` : !vmaf ? `${bin} has no libvmaf filter` : '';
  return { bin, x264, vmaf, probe: probeOk ? probe : null, why };
}

/**
 * Encodes the capture as a judge's copy (bicubic downscale, H.264 CRF 23, 4:2:0, BT.709 limited range, FD20
 * Deliverable E), extracts frame 30 as a PNG and, with libvmaf, scores CAMBI on the copy.
 * @param {{bin: string | null, vmaf: boolean}} ff
 * @param {string} src
 * @param {string} dst
 * @param {number} width
 * @param {number} height
 * @param {string} outDir
 * @returns {number | null} mean CAMBI, or null without libvmaf
 */
function simulate(ff, src, dst, width, height, outDir) {
  const bin = /** @type {string} */ (ff.bin);
  const mp4 = path.join(outDir, `copy-${height}.mp4`);
  /**
   * @param {string[]} args
   * @param {string} [cwd]
   */
  const exec = (args, cwd) => {
    const r = spawnSync(bin, args, { cwd, encoding: 'utf8', timeout: 180000, windowsHide: true });
    if (r.status !== 0) throw new EnvError(`ffmpeg failed (${args.slice(0, 6).join(' ')} ...): ${(r.stderr || String(r.error ?? '')).trim().split('\n').slice(-3).join(' ')}`);
  };
  exec(['-v', 'error', '-y', '-loop', '1', '-framerate', '30', '-t', '2', '-i', src, '-vf',
    `scale=${width}:${height}:flags=bicubic:out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv`,
    '-c:v', 'libx264', '-crf', '23', mp4]);
  exec(['-v', 'error', '-y', '-i', mp4, '-vf', 'select=eq(n\\,30),scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24', '-frames:v', '1', '-update', '1', dst]);
  let cambi = null;
  if (ff.vmaf) {
    const log = path.join(outDir, 'cambi.json');
    exec(['-v', 'error', '-y', '-i', path.basename(mp4), '-i', path.basename(mp4), '-lavfi', '[0:v][1:v]libvmaf=feature=name=cambi:log_path=cambi.json:log_fmt=json', '-f', 'null', '-'], outDir);
    const data = JSON.parse(readFileSync(log, 'utf8'));
    /** @type {Array<{metrics?: Record<string, number>}>} */
    const frames = Array.isArray(data.frames) ? data.frames : [];
    const values = frames.map((f) => Number(f.metrics?.cambi)).filter((v) => Number.isFinite(v));
    cambi = values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 1000) / 1000 : null;
    rmSync(log, { force: true });
  }
  rmSync(mp4, { force: true });
  return cambi;
}

// ---------------------------------------------------------------------------------------------------------------
// Contrast sampled from the capture.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Background = the most frequent colour on a ring just outside the text box; foreground = the pixel inside the box
 * farthest in luminance from it; `worst` uses the ring pixel closest to the foreground (XAG 102).
 * @param {Browser} browser
 * @param {string} pngPath
 * @param {Rect[]} rects
 * @returns {Promise<Array<{fgL: number, bgL: number, contrast: number, worst: number} | null>>}
 */
async function sampleContrast(browser, pngPath, rects) {
  const context = await browser.newContext({ viewport: { width: 64, height: 64 } });
  try {
    const page = await context.newPage();
    const b64 = readFileSync(pngPath).toString('base64');
    await page.setContent(`<img id="i" src="data:image/png;base64,${b64}">`);
    await page.waitForFunction(() => {
      const img = document.getElementById('i');
      return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
    });
    return await page.evaluate((list) => {
      const img = /** @type {HTMLImageElement} */ (document.getElementById('i'));
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));
      ctx.drawImage(img, 0, 0);
      /** @param {number} v */
      const lin = (v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      /** @param {number} r @param {number} g @param {number} b */
      const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      /** @param {number} a @param {number} b */
      const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      return list.map((r) => {
        const x0 = Math.max(0, Math.floor(r.x) - 2);
        const y0 = Math.max(0, Math.floor(r.y) - 2);
        const x1 = Math.min(c.width - 1, Math.ceil(r.x + r.w) + 2);
        const y1 = Math.min(c.height - 1, Math.ceil(r.y + r.h) + 2);
        if (x1 <= x0 + 4 || y1 <= y0 + 4) return null;
        const W = x1 - x0 + 1;
        const H = y1 - y0 + 1;
        const d = ctx.getImageData(x0, y0, W, H).data;
        /** @type {Map<string, number>} */
        const ring = new Map();
        /** @type {number[]} */
        const ringL = [];
        for (let y = 0; y < H; y += 1) {
          for (let x = 0; x < W; x += 1) {
            if (x > 0 && y > 0 && x < W - 1 && y < H - 1) continue;
            const i = (y * W + x) * 4;
            const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
            ring.set(k, (ring.get(k) || 0) + 1);
            ringL.push(L(d[i], d[i + 1], d[i + 2]));
          }
        }
        const top = [...ring.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
        const bgL = L(top[0], top[1], top[2]);
        let fgL = bgL;
        let best = 0;
        for (let y = 2; y < H - 2; y += 1) {
          for (let x = 2; x < W - 2; x += 1) {
            const i = (y * W + x) * 4;
            const l = L(d[i], d[i + 1], d[i + 2]);
            if (Math.abs(l - bgL) > best) {
              best = Math.abs(l - bgL);
              fgL = l;
            }
          }
        }
        const worstBg = ringL.reduce((w, l) => (Math.abs(l - fgL) < Math.abs(w - fgL) ? l : w), bgL);
        return { fgL, bgL, contrast: Math.round(ratio(fgL, bgL) * 100) / 100, worst: Math.round(ratio(fgL, worstBg) * 100) / 100 };
      });
    }, rects);
  } finally {
    await context.close();
  }
}

/**
 * Downscales a PNG in the browser (no codec loss): the judge copies when ffmpeg lacks libx264.
 * @param {Browser} browser
 * @param {string} src
 * @param {string} dst
 * @param {number} width
 * @param {number} height
 */
async function browserDownscale(browser, src, dst, width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  try {
    const page = await context.newPage();
    const b64 = readFileSync(src).toString('base64');
    await page.setContent(`<body style="margin:0"><img id="i" src="data:image/png;base64,${b64}" style="width:${width}px;height:${height}px;display:block"></body>`);
    await page.waitForFunction(() => {
      const img = document.getElementById('i');
      return img instanceof HTMLImageElement && img.complete;
    });
    await page.screenshot({ path: dst });
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Manual-gate files: the master (g10) and the deck (g16).
// ---------------------------------------------------------------------------------------------------------------

/**
 * ffprobe facts of a recorded master (video stream) and whether `moov` precedes `mdat` in an MP4.
 * @param {string} probe
 * @param {string} file
 * @returns {{stream: Record<string, unknown> | null, faststart: boolean | null, error: string | null}}
 */
export function probeMaster(probe, file) {
  const r = spawnSync(probe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,profile,pix_fmt,color_range,color_space,color_primaries,color_transfer,width,height', '-of', 'json', file], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  if (r.status !== 0) return { stream: null, faststart: null, error: (r.stderr || String(r.error ?? 'ffprobe failed')).trim().split('\n')[0] };
  let stream = null;
  try {
    stream = JSON.parse(r.stdout).streams?.[0] ?? null;
  } catch {
    stream = null;
  }
  return { stream, faststart: /\.(?:mp4|m4v|mov)$/i.test(file) ? moovFirst(file) : null, error: null };
}

/**
 * True when the top-level `moov` box comes before `mdat` (fast start), false when after, null if neither is found.
 * @param {string} file
 * @returns {boolean | null}
 */
export function moovFirst(file) {
  const fd = openSync(file, 'r');
  try {
    const size = statSync(file).size;
    const head = Buffer.alloc(16);
    let offset = 0;
    for (let i = 0; i < 64 && offset + 8 <= size; i += 1) {
      readSync(fd, head, 0, 16, offset);
      let boxSize = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      if (boxSize === 1) boxSize = Number(head.readBigUInt64BE(8));
      else if (boxSize === 0) boxSize = size - offset;
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      if (boxSize < 8) return null;
      offset += boxSize;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

/**
 * Entries of a ZIP's central directory: name, method, sizes, local header offset.
 * @param {string} file
 * @returns {Array<{name: string, method: number, compressed: number, size: number, offset: number}>}
 */
export function zipEntries(file) {
  const fd = openSync(file, 'r');
  try {
    const size = statSync(file).size;
    const tailLength = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLength);
    readSync(fd, tail, 0, tailLength, size - tailLength);
    let eocd = -1;
    for (let i = tailLength - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('no ZIP end-of-central-directory record');
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    readSync(fd, cd, 0, cdSize, cdOffset);
    const out = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i += 1) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
      const method = cd.readUInt16LE(p + 10);
      const compressed = cd.readUInt32LE(p + 20);
      const uncompressed = cd.readUInt32LE(p + 24);
      const nameLength = cd.readUInt16LE(p + 28);
      const extraLength = cd.readUInt16LE(p + 30);
      const commentLength = cd.readUInt16LE(p + 32);
      const offset = cd.readUInt32LE(p + 42);
      out.push({ name: cd.toString('utf8', p + 46, p + 46 + nameLength), method, compressed, size: uncompressed, offset });
      p += 46 + nameLength + extraLength + commentLength;
    }
    return out;
  } finally {
    closeSync(fd);
  }
}

/**
 * Scans one ZIP entry (stored or deflated) for the first of several byte needles, streaming.
 * @param {string} file
 * @param {{method: number, compressed: number, offset: number}} entry
 * @param {string[]} needles
 * @returns {Promise<string | null>}
 */
async function scanZipEntry(file, entry, needles) {
  const fd = openSync(file, 'r');
  const header = Buffer.alloc(30);
  try {
    readSync(fd, header, 0, 30, entry.offset);
  } finally {
    closeSync(fd);
  }
  if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('corrupt ZIP local header');
  const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  if (entry.compressed === 0) return null;
  const raw = createReadStream(file, { start, end: start + entry.compressed - 1 });
  const stream = entry.method === 8 ? raw.pipe(createInflateRaw()) : raw;
  const bufs = needles.map((n) => Buffer.from(n, 'latin1'));
  let carry = Buffer.alloc(0);
  try {
    for await (const chunk of stream) {
      const data = Buffer.concat([carry, /** @type {Buffer} */ (chunk)]);
      for (let i = 0; i < bufs.length; i += 1) if (data.includes(bufs[i])) return needles[i];
      carry = data.subarray(Math.max(0, data.length - 8));
    }
  } finally {
    raw.destroy();
  }
  return null;
}

/**
 * Checks a presentation file for the stage (FD20-F02, F25): .pptx or a single-file .key (a ZIP), never a 97-2003
 * .ppt (OLE2), with an embedded video whose sample entry is H.264 (avc1/avc3), never HEVC.
 * @param {string} file
 * @returns {Promise<{fail: string[], warn: string[], ok: string[]}>}
 */
export async function inspectDeck(file) {
  /** @type {{fail: string[], warn: string[], ok: string[]}} */
  const out = { fail: [], warn: [], ok: [] };
  if (!existsSync(file)) return { ...out, fail: [`${toPosix(file)} does not exist`] };
  if (statSync(file).isDirectory()) return { ...out, fail: ['the deck is a folder (a Keynote package): save it as a single file so Google Drive stores one file'] };
  const ext = path.extname(file).toLowerCase();
  const magic = Buffer.alloc(8);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, magic, 0, 8, 0);
  } finally {
    closeSync(fd);
  }
  if (magic.readUInt32BE(0) === 0xd0cf11e0) return { ...out, fail: ['a 97-2003 binary deck (OLE2): embedded media is converted to a still picture; save as .pptx or .key'] };
  if (ext === '.ppt') return { ...out, fail: ['the .ppt extension: save as .pptx (or Keynote .key) and confirm with the organisers'] };
  if (ext !== '.pptx' && ext !== '.key') return { ...out, fail: [`unexpected deck type ${ext || '(none)'}: deliver .pptx or a single-file .key`] };
  if (magic.readUInt32LE(0) !== 0x04034b50) return { ...out, fail: [`${path.basename(file)} is not a ZIP container as .pptx and .key files are`] };
  let entries;
  try {
    entries = zipEntries(file);
  } catch (err) {
    return { ...out, fail: [`cannot read the deck: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (ext === '.pptx' && !entries.some((e) => e.name === '[Content_Types].xml')) out.fail.push('no [Content_Types].xml: not a PowerPoint Open XML file');
  const videos = entries.filter((e) => /\.(?:mp4|m4v|mov)$/i.test(e.name) && (ext === '.pptx' ? e.name.startsWith('ppt/media/') : true));
  const other = entries.filter((e) => /\.(?:avi|wmv|webm|mkv|mpe?g)$/i.test(e.name));
  if (videos.length === 0) {
    out.fail.push(other.length ? `embedded video is ${path.extname(other[0].name)}, not MP4: export H.264 MP4 and embed it` : 'no embedded MP4 video: embed the recording (links are not accepted on stage)');
    return out;
  }
  for (const v of videos) {
    const codec = await scanZipEntry(file, v, ['avc1', 'avc3', 'hvc1', 'hev1']);
    if (codec === 'avc1' || codec === 'avc3') out.ok.push(`${v.name}: H.264 (${codec})`);
    else if (codec === 'hvc1' || codec === 'hev1') out.fail.push(`${v.name}: HEVC (${codec}); Windows needs a paid extension to play it, export H.264`);
    else out.warn.push(`${v.name}: codec not recognised in the sample table; check it with ffprobe`);
  }
  return out;
}

/**
 * g15: a project that talks to a Ledger device (a @ledgerhq device package in a package.json) must read the DMK's
 * `requiredUserInteraction` or show a device prompt string, so the page mirrors what the device asks (FD20-F22).
 * @param {string} root
 * @param {Profile} profile
 * @returns {{applicable: boolean, packages: string[], evidence: Evidence[]}}
 */
export function ledgerMirror(root, profile) {
  const packages = new Set();
  for (const rel of walk(root, { include: 'package.json' })) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(root, rel), 'utf8'));
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const name of Object.keys(pkg[field] ?? {})) {
          if (/^@ledgerhq\/(?:device-management-kit|device-signer-kit-|device-transport-kit-|hw-transport|hw-app-)/.test(name)) packages.add(name);
        }
      }
    } catch {
      continue;
    }
  }
  if (packages.size === 0) return { applicable: false, packages: [], evidence: [] };
  /** @type {Evidence[]} */
  const evidence = [];
  const PROMPT = /\b(?:confirm|approve|review|sign|verify)\b[^\n<>{}]{0,60}\b(?:on|with)\s+(?:your|the)\s+(?:ledger|device|signer)\b/i;
  for (const file of sourceFiles(root, profile)) {
    if (file.kind === 'json') continue;
    const at = file.code.indexOf('requiredUserInteraction');
    if (at >= 0) evidence.push({ file: file.path, line: lineOf(file.code, at), value: 'requiredUserInteraction', detail: 'the DMK device step is read' });
    const m = PROMPT.exec(file.code);
    if (m) evidence.push({ file: file.path, line: lineOf(file.code, m.index), value: m[0].slice(0, 80), detail: 'a device prompt string' });
  }
  return { applicable: true, packages: [...packages], evidence };
}

// ---------------------------------------------------------------------------------------------------------------
// Per-route measurement.
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {'fail' | 'warn'} Severity
 * @typedef {{severity: Severity, detail: string, evidence: Evidence[]}} Finding
 * @typedef {{route: string, dir: string, findings: Map<string, Finding[]>, notes: Map<string, string[]>,
 *   cambi: number | null, keyRuns: number}} RouteResult
 */

/**
 * @param {CheckContext} ctx
 * @param {Route} route
 * @param {{width: number, height: number}} size
 * @param {string} dir
 * @param {ReturnType<typeof ffmpegInfo>} ff
 * @param {Set<string>} want
 * @returns {Promise<RouteResult>}
 */
async function measureRoute(ctx, route, size, dir, ff, want) {
  const browser = /** @type {Browser} */ (ctx.browser);
  const base = new URL(/** @type {string} */ (ctx.baseUrl));
  const url = routeUrl(base.href, route, ctx.profile);
  const T = THRESHOLDS;
  /** @type {Map<string, Finding[]>} */
  const findings = new Map();
  /** @type {Map<string, string[]>} */
  const notes = new Map();
  /** @param {string} g @param {Severity} severity @param {string} detail @param {Evidence[]} [evidence] */
  const add = (g, severity, detail, evidence = []) => {
    const list = findings.get(g) ?? [];
    list.push({ severity, detail, evidence: evidence.map((e) => ({ route: route.path, ...e })) });
    findings.set(g, list);
  };
  /** @param {string} g @param {string} text */
  const note = (g, text) => notes.set(g, [...(notes.get(g) ?? []), text]);
  mkdirSync(dir, { recursive: true });
  const capture = path.join(dir, 'capture-1080.png');
  const viewport = { name: 'recording', width: size.width, height: size.height, dpr: 1, isMobile: false, hasTouch: false };
  ctx.log?.(`${TOOL}: ${route.path} at ${size.width}x${size.height}`);
  let cambi = null;
  let keyRuns = 0;
  const context = await newContext(browser, viewport, { network: ctx.args?.network === true });
  try {
    const page = await context.newPage();
    await blockExternal(page, base, ctx.args?.network === true);
    await goto(page, url);
    await waitReady(page, { readyFlag: ctx.profile?.ready_flag === true });
    const animations = await page.evaluate(collectAnimations, {});
    await page.evaluate(freezeAnimations);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))));
    const A = await evaluateWithSelector(page, recordingAnalysis, { minGradientAreaRatio: T.minGradientAreaRatio, minSurfaceAreaRatio: T.minSurfaceAreaRatio });
    await page.screenshot({ path: capture, animations: 'disabled', caret: 'hide' });

    const scored = A.runs.filter((r) => r.role !== 'decor');
    const x720 = (/** @type {TextRun} */ r) => deliveredXHeight(r.xHeight, 720, size.height);
    const x540 = (/** @type {TextRun} */ r) => deliveredXHeight(r.xHeight, 540, size.height);
    const ev = (/** @type {TextRun} */ r, /** @type {number} */ x) => ({ selector: r.sel, value: `${r.size}px ${r.family} "${r.text.slice(0, 40)}"`, detail: `x-height ${x.toFixed(2)} px delivered` });
    const smallest = scored.reduce((m, r) => (!m || r.xHeight < m.xHeight ? r : m), /** @type {TextRun | null} */ (null));
    if (smallest) note('recording.g01', `smallest text ${smallest.size}px ${smallest.family}: x-height ${smallest.xHeight} px at ${size.height}p, ${x720(smallest).toFixed(1)} px at 720p`);
    const fail720 = scored.filter((r) => x720(r) < T.minDeliveredXHeight720);
    if (fail720.length) add('recording.g01', 'fail', `${fail720.length} text run(s) under ${T.minDeliveredXHeight720} px x-height in the 720p copy`, fail720.slice(0, 15).map((r) => ev(r, x720(r))));
    const warn720 = scored.filter((r) => x720(r) >= T.minDeliveredXHeight720 && x720(r) < T.warnDeliveredXHeight720);
    if (warn720.length) add('recording.g02', 'warn', `${warn720.length} text run(s) between ${T.minDeliveredXHeight720} and ${T.warnDeliveredXHeight720} px x-height at 720p`, warn720.slice(0, 15).map((r) => ev(r, x720(r))));
    const keys = A.runs.filter((r) => r.role === 'key');
    keyRuns = keys.length;
    const keyFail = keys.filter((r) => x540(r) < T.minDeliveredXHeight540Key);
    if (keyFail.length) add('recording.g03', 'fail', `${keyFail.length} key run(s) under ${T.minDeliveredXHeight540Key} px x-height in the 540p copy`, keyFail.slice(0, 15).map((r) => ev(r, x540(r))));
    if (keys.length === 0) add('recording.g03', 'warn', 'no element on this route carries data-rec-role="key": the stricter tier for the claim and proof values was not applied here');
    const stepUp = scored.filter((r) => (r.weight <= T.thinWeight || redOnDark(r.color, r.bg)) && x720(r) < T.warnDeliveredXHeight720);
    if (stepUp.length) add('recording.g04', 'warn', `${stepUp.length} thin or red-on-dark run(s) below the 18 px level`, stepUp.slice(0, 15).map((r) => ({ ...ev(r, x720(r)), detail: `${r.weight <= T.thinWeight ? `weight ${r.weight}` : 'red on dark'}; x-height ${x720(r).toFixed(2)} px at 720p` })));

    const vis = A.runs.filter((r) => r.inFirstViewport && r.role !== 'decor').slice(0, 300);
    const sampled = await sampleContrast(browser, capture, vis.map((r) => r.rect));
    /** @type {Evidence[]} */
    const lowContrast = [];
    /** @type {Evidence[]} */
    const projector = [];
    vis.forEach((r, i) => {
      const s = sampled[i];
      if (!s) return;
      const large = r.size >= 24 || (r.size >= 18.66 && r.weight >= 700);
      const min = large ? T.minContrastLarge : T.minContrast;
      if (s.worst < min) lowContrast.push({ selector: r.sel, value: `"${r.text.slice(0, 40)}"`, detail: `${s.worst}:1 against the worst background (${s.contrast}:1 against the main one), needs ${min}:1` });
      const at15 = projected(s.fgL, s.bgL, T.projectorSystemContrast);
      if (s.contrast >= T.minContrast && at15 < T.minContrast) projector.push({ selector: r.sel, value: `"${r.text.slice(0, 40)}"`, detail: `${s.contrast}:1 on screen, ${at15}:1 at a 15:1 projector floor, ${projected(s.fgL, s.bgL, T.projectorPassiveContrast)}:1 at 7:1` });
    });
    if (lowContrast.length) add('recording.g05', 'fail', `${lowContrast.length} visible text run(s) below WCAG 1.4.3 on the rendered pixels`, lowContrast.slice(0, 20));
    if (projector.length) add('recording.g06', 'warn', `${projector.length} run(s) pass on screen but drop below ${T.minContrast}:1 on a projector`, projector.slice(0, 20));

    const darkGradients = A.gradients.map((g) => ({ g, stops: gradientStopLuminance(g.image, g.under) }))
      .filter(({ stops }) => stops.length > 0 && Math.max(...stops) < T.darkGradientMaxLuminance);
    if (darkGradients.length) add('recording.g07', 'warn', `${darkGradients.length} large dark gradient(s), all stops under luminance ${T.darkGradientMaxLuminance}: they banded after H.264 in every FD20 test`, darkGradients.map(({ g, stops }) => ({ selector: g.sel, value: `${Math.round(g.areaRatio * 100)}% of the frame`, detail: `brightest stop L=${Math.max(...stops).toFixed(3)}` })));
    if (A.grain.length) add('recording.g08', 'warn', `${A.grain.length} grain or noise layer(s): the encoder erases animated grain and static grain still bands`, A.grain.map((g) => ({ selector: g.sel, value: g.via, detail: g.animated ? 'animated' : 'static' })));
    const thin = A.hairlines.map((h) => ({ h, ratio: contrastRatio(h.color, h.bg) })).filter(({ ratio }) => ratio !== null && ratio < T.hairlineMinContrast);
    if (thin.length) add('recording.g09', 'warn', `${thin.length} element(s) draw 1 px borders under ${T.hairlineMinContrast}:1; use 2 px or fills where the line carries structure`, thin.slice(0, 20).map(({ h, ratio }) => ({ selector: h.sel, value: h.side, detail: `${(/** @type {number} */ (ratio)).toFixed(2)}:1` })));
    const flatSteps = A.surfaces.filter((s) => {
      const own = parseColor(s.own);
      const under = parseColor(s.under);
      if (!own || !under) return false;
      if (relativeLuminance(own) >= T.darkSurfaceMaxLuminance || relativeLuminance(under) >= T.darkSurfaceMaxLuminance) return false;
      const step = /** @type {number} */ (contrastRatio(own, under));
      if (step <= 1.0001 || step >= T.darkSurfaceMinStep) return false;
      const edge = s.border >= 1 ? contrastRatio(s.borderColor, s.under) : null;
      return !(edge !== null && edge >= T.darkSurfaceMinStep);
    });
    if (flatSteps.length) add('recording.g10', 'warn', `${flatSteps.length} dark surface step(s) under ${T.darkSurfaceMinStep}:1 without a border`, flatSteps.slice(0, 20).map((s) => ({ selector: s.sel, value: `${s.own} on ${s.under}`, detail: `${(/** @type {number} */ (contrastRatio(s.own, s.under))).toFixed(3)}:1` })));

    if (A.hoverRules.length) add('recording.g11', 'warn', `${A.hoverRules.length} :hover rule(s) change display, visibility, opacity or size: what they reveal is absent from a recording unless the cursor is scripted there`, A.hoverRules.slice(0, 20).map((h) => ({ value: h.selector, detail: h.props.join(', ') })));
    if (A.titles.length) add('recording.g11', 'warn', `${A.titles.length} visible element(s) rely on title tooltips, drawn outside the page and only while the cursor rests`, A.titles.slice(0, 20).map((t) => ({ selector: t.sel, value: t.title, detail: t.key ? 'on key text' : t.tag })));
    if (A.unreadableSheets.length) note('recording.g11', `${A.unreadableSheets.length} cross-origin stylesheet(s) could not be scanned`);
    if (want.has('recording.g11')) {
      const baseline = new Set(await page.evaluate(visibleTexts));
      const triggers = await evaluateWithSelector(page, hoverTriggers, { triggers: A.hoverRules.flatMap((h) => h.triggers), limit: 60 });
      /** @type {Evidence[]} */
      const revealed = [];
      for (const t of triggers) {
        try {
          await page.locator(t.sel).first().hover({ force: true, timeout: 1000 });
          await page.waitForTimeout(350);
          const now = await page.evaluate(visibleTexts);
          const fresh = now.filter((s) => !baseline.has(s) && s.length >= 3);
          if (fresh.length) revealed.push({ selector: t.sel, value: t.label, detail: `reveals: ${fresh.slice(0, 3).map((s) => `"${s.slice(0, 50)}"`).join(', ')}` });
          await page.mouse.move(size.width - 1, size.height - 1);
          await page.waitForTimeout(150);
        } catch {
          continue;
        }
      }
      if (revealed.length) add('recording.g11', 'fail', `${revealed.length} element(s) reveal text only on hover: show it at rest in record mode`, revealed);
    }

    const loops = animations.filter((a) => a.iterations === 'infinite');
    const blinks = animations.filter((a) => blinkRisk(a));
    if (blinks.length) add('recording.g12', 'fail', `${blinks.length} animation(s) toggle opacity or colour faster than ${T.minBlinkPeriodMs} ms per cycle (WCAG 2.3.2's three flashes a second)`, blinks.map((a) => ({ selector: a.sel ?? '', value: `${a.name} ${a.duration} ms`, detail: a.properties.join(', ') })));
    if (loops.length) add('recording.g12', 'warn', `${loops.length} infinite animation(s): freeze decorative loops in record mode`, loops.slice(0, 20).map((a) => ({ selector: a.sel ?? '', value: `${a.name} ${a.duration} ms`, detail: a.properties.join(', ') })));
    if (A.marquees) add('recording.g12', 'warn', `${A.marquees} <marquee> element(s)`);
    note('recording.g12', 'proof states holding 0.33 s per word (1.2 s minimum) are judged at the H3 sign-off of the recorded flow');

    const unlabelled = A.regions.filter((r) => !r.label || !r.stamp);
    if (unlabelled.length) add('recording.g13', 'warn', `${unlabelled.length} data region(s) without a visible live, testnet or simulated label and an as-of stamp`, unlabelled.slice(0, 20).map((r) => ({ selector: r.sel, value: r.source ?? '', detail: `${r.label ? '' : 'no visible label; '}${r.stamp ? '' : `no visible as-of stamp${r.asOfAttr ? ` (data-as-of="${r.asOfAttr}" is not shown)` : ''}`}`.replace(/; $/, '') })));
    if (A.regions.length === 0) {
      const hasNumbers = /\d[\d,]*\.\d+|\d{1,3}(?:,\d{3})+/.test(A.firstViewText);
      const label = /\b(?:simulated|simulation|mock(?:ed)?|fixture|demo data|sample data|testnet|preprod|pre-prod|devnet|sepolia|holesky|mainnet|live)\b/i.test(A.firstViewText);
      const stamp = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:UTC|GMT|SGT|CET|CEST)\b|\bblock\s#?[\d,]{3,}/i.test(A.firstViewText);
      if (hasNumbers && !label) add('recording.g13', 'warn', 'figures are visible in the first viewport but no data label (live, testnet, simulated) is');
      if (hasNumbers && !stamp) add('recording.g13', 'warn', 'no visible time stamp or block height next to the figures in the first viewport');
    }
  } finally {
    await context.close();
  }

  if (ff.bin && ff.x264) {
    cambi = simulate(ff, capture, path.join(dir, 'capture-720.png'), 1280, 720, dir);
    simulate({ ...ff, vmaf: false }, capture, path.join(dir, 'capture-540.png'), 960, 540, dir);
    if (cambi !== null && cambi > T.maxCambi) add('recording.g07', 'fail', `CAMBI ${cambi} on the 720p H.264 copy (threshold ${T.maxCambi})`, [{ value: cambi, file: toPosix(path.join(dir, 'capture-720.png')) }]);
    else if (cambi !== null) note('recording.g07', `CAMBI ${cambi} on the 720p copy`);
  } else {
    await browserDownscale(browser, capture, path.join(dir, 'capture-720.png'), 1280, 720);
    await browserDownscale(browser, capture, path.join(dir, 'capture-540.png'), 960, 540);
  }

  for (const zoom of [1.25, 1.5]) {
    const zviewport = { name: `zoom${Math.round(zoom * 100)}`, width: Math.round(size.width / zoom), height: Math.round(size.height / zoom), dpr: zoom, isMobile: false, hasTouch: false };
    const zcontext = await newContext(browser, zviewport, { network: ctx.args?.network === true });
    try {
      const zp = await zcontext.newPage();
      await blockExternal(zp, base, ctx.args?.network === true);
      await goto(zp, url);
      await waitReady(zp, { readyFlag: ctx.profile?.ready_flag === true });
      await zp.evaluate(freezeAnimations);
      await zp.screenshot({ path: path.join(dir, `capture-zoom${Math.round(zoom * 100)}.png`), animations: 'disabled', caret: 'hide' });
      const zr = await zp.evaluate(() => ({
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        keysBelowFold: Array.from(document.querySelectorAll('[data-rec-role="key"]')).filter((e) => e.getBoundingClientRect().top > window.innerHeight).map((e) => (e.textContent || '').trim().slice(0, 60)),
      }));
      if (zr.overflowX > 1) add('recording.g14', 'fail', `at ${Math.round(zoom * 100)}% zoom (${zviewport.width} CSS px) the page scrolls sideways by ${zr.overflowX} px`, [{ viewport: zviewport.name, value: zr.overflowX }]);
      if (zr.keysBelowFold.length) add('recording.g14', 'warn', `at ${Math.round(zoom * 100)}% zoom ${zr.keysBelowFold.length} key element(s) leave the first viewport`, zr.keysBelowFold.map((t) => ({ viewport: zviewport.name, value: t })));
    } finally {
      await zcontext.close();
    }
  }
  writeText(path.join(dir, 'blind-read-prompt.md'), blindReadPrompt(route));
  return { route: route.path, dir: toPosix(dir), findings, notes, cambi, keyRuns };
}

/**
 * @param {Page} page
 * @param {URL} base
 * @param {boolean} allowNetwork
 */
async function blockExternal(page, base, allowNetwork) {
  if (allowNetwork) return;
  await page.route('**/*', (r) => {
    let target;
    try {
      target = new URL(r.request().url());
    } catch {
      return r.continue();
    }
    if ((target.protocol === 'http:' || target.protocol === 'https:') && target.origin !== base.origin && !/^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(target.hostname)) {
      return r.abort('blockedbyclient');
    }
    return r.continue();
  });
}

/**
 * The one-way comprehension check for a fresh subagent (FD20-F07): it never proves legibility.
 * @param {Route} route
 * @returns {string}
 */
function blindReadPrompt(route) {
  return [
    `# Blind read: ${route.path} (run in a fresh subagent that has not seen the brief or the code)`,
    '',
    'Open only `capture-540.png` (a 960x540 frame: the first frame of the demo video playing at half size in a slide).',
    'Answer in at most five lines, without guessing beyond what is on screen:',
    '1. What is this product, in one sentence?',
    '2. What does it do for its user?',
    '3. What evidence on screen shows that it works (quote the values you can read)?',
    '4. Is the data live, testnet or simulated, and as of when? Quote the label.',
    '5. What could a newcomer to blockchain not understand here?',
    '',
    'Scoring: compare answers 1 to 4 with the brief. A model reads small degraded text better than a person at',
    'projector distance (FD20-F07), so a pass does not prove legibility; recording.g01 to g03 do that. A failure',
    'here means the frame does not carry the message.',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Gates.
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {string} id
 * @returns {import('./lib/report.mjs').GateBuilder}
 */
function builder(id) {
  const meta = GATES.find((g) => g.id === id);
  if (!meta) throw new TypeError(`unknown gate ${id}`);
  return gate(meta);
}

/**
 * Normalises a selection: ids, `recording`, or the research names `G1`..`G16` / `g01`..`g16`.
 * @param {readonly string[] | undefined | null} selected
 * @returns {string[]}
 */
export function selectGates(selected) {
  const all = /** @type {string[]} */ (GATES.map((g) => g.id));
  if (!selected || selected.length === 0) return all;
  const want = new Set();
  for (const raw of selected) {
    const id = String(raw).trim();
    if (!id) continue;
    if (id === 'recording') {
      all.forEach((g) => want.add(g));
      continue;
    }
    const short = /^(?:recording\.)?g0?(\d{1,2})$/i.exec(id);
    const full = short ? `recording.g${short[1].padStart(2, '0')}` : id;
    if (!all.includes(full)) throw new UsageError(`unknown gate "${id}" for ${TOOL}; known: recording, ${all.join(', ')}`);
    want.add(full);
  }
  return all.filter((g) => want.has(g));
}

/**
 * Gates whose FD20 rows are all WARN: they can never fail, so their ok is advisory (lib/report advise) and the report
 * counts them apart. Their warnings stay in the evidence.
 */
export const ADVISORY = new Set(['recording.g02', 'recording.g04', 'recording.g06', 'recording.g08', 'recording.g09', 'recording.g13']);

/** Gates that need a rendered page. */
const RENDERED = new Set(['recording.g01', 'recording.g02', 'recording.g03', 'recording.g04', 'recording.g05', 'recording.g06', 'recording.g07', 'recording.g08', 'recording.g09', 'recording.g10', 'recording.g11', 'recording.g12', 'recording.g13', 'recording.g14']);

/**
 * Runs the selected recording gates (CONTRACTS section 4). `ctx.args.master` (a recorded master) feeds g10's
 * colour-range check and `ctx.args.deck` (the presentation file) feeds g16; `ctx.args.out` holds the captures.
 * @param {CheckContext} ctx
 * @param {readonly string[]} [selected]
 * @returns {Promise<GateResult[]>}
 */
export async function run(ctx, selected) {
  const want = selectGates(selected);
  const wantSet = new Set(want);
  const video = ctx.profile?.format?.video ?? null;
  const size = { width: video?.width ?? 1920, height: video?.height ?? 1080 };
  const ff = want.includes('recording.g07') || want.includes('recording.g10') ? ffmpegInfo() : { bin: null, x264: false, vmaf: false, probe: null, why: '' };
  /** @type {RouteResult[]} */
  const routes = [];
  let failure = '';
  let outRoot = '';
  const needsPages = want.some((id) => RENDERED.has(id));
  if (needsPages && ctx.browser && ctx.baseUrl) {
    outRoot = captureRoot(ctx);
    try {
      for (const route of ctx.routes) routes.push(await measureRoute(ctx, route, size, path.join(outRoot, safeName(route)), ff, wantSet));
    } catch (err) {
      if (err instanceof UsageError || err instanceof EnvError) throw err;
      failure = err instanceof Error ? err.message : String(err);
    }
  }
  const noPages = !ctx.baseUrl ? 'no rendered pages: pass --serve <built dir> or --url <running app>' : 'no browser in the check context';
  /** @type {GateResult[]} */
  const results = [];
  for (const id of want) {
    const g = builder(id);
    if (RENDERED.has(id)) {
      if (failure) {
        results.push(g.fail(`a page could not be checked: ${failure}`));
        continue;
      }
      if (routes.length === 0) {
        results.push(g.skip(noPages));
        continue;
      }
    }
    if (id === 'recording.g07' && !(ff.bin && ff.x264 && ff.vmaf)) {
      const warns = routes.flatMap((r) => r.findings.get(id) ?? []).filter((f) => f.severity === 'warn');
      results.push(g.skip(`CAMBI needs ffmpeg with libx264 and libvmaf: ${ff.why}${warns.length ? `; meanwhile ${warns.map((w) => w.detail).join('; ')}` : ''}`));
      continue;
    }
    if (id === 'recording.g10') {
      results.push(await masterGate(g, ctx, routes, ff));
      continue;
    }
    if (id === 'recording.g15') {
      results.push(ledgerGate(g, ctx));
      continue;
    }
    if (id === 'recording.g16') {
      results.push(await deckGate(g, ctx, video));
      continue;
    }
    if (id === 'recording.g03' && routes.every((r) => r.keyRuns === 0)) {
      results.push(g.fail(
        `no element on any of the ${routes.length} route(s) carries data-rec-role="key", so the 540p tier measured nothing: ` +
          'mark the claim and proof values a judge must read (CONTRACTS section 6.6) and run the gate again',
        routes.map((r) => ({ route: r.route, value: 0, detail: 'no data-rec-role="key" element' })),
      ));
      continue;
    }
    results.push(verdict(g, id, routes, outRoot));
  }
  return results;
}

/**
 * Folds per-route findings into one gate result: any FAIL fails the gate; WARNs pass with the warnings as evidence.
 * @param {import('./lib/report.mjs').GateBuilder} g
 * @param {string} id
 * @param {RouteResult[]} routes
 * @param {string} outRoot
 * @returns {GateResult}
 */
function verdict(g, id, routes, outRoot) {
  const all = routes.flatMap((r) => (r.findings.get(id) ?? []).map((f) => ({ ...f, route: r.route })));
  const fails = all.filter((f) => f.severity === 'fail');
  const warns = all.filter((f) => f.severity === 'warn');
  const notes = routes.flatMap((r) => (r.notes.get(id) ?? []).map((n) => `${r.route}: ${n}`));
  /** @type {Evidence[]} */
  const evidence = [...fails, ...warns].flatMap((f) => (f.evidence.length ? f.evidence.map((e) => ({ ...e, severity: f.severity, finding: f.detail })) : [{ route: f.route, severity: f.severity, finding: f.detail }]));
  if (id === 'recording.g01' && outRoot) evidence.push({ file: toPosix(outRoot), detail: 'captures, judge copies and blind-read prompts' });
  for (const n of notes) evidence.push({ detail: n, severity: 'note' });
  const where = `${routes.length} route(s)`;
  if (fails.length) return g.fail(`${fails.map((f) => `${f.route}: ${f.detail}`).join('; ')}`, evidence);
  const pass = ADVISORY.has(id) ? g.advise : g.ok;
  const prefix = ADVISORY.has(id) ? 'advisory (warnings only): ' : '';
  if (warns.length) return pass(`${prefix}passes with ${warns.length} warning(s) on ${where}: ${warns.map((f) => `${f.route}: ${f.detail}`).join('; ')}`, evidence);
  return pass(`${prefix}no finding on ${where}${notes.length ? ` (${notes.join('; ')})` : ''}`, evidence);
}

/**
 * g10: dark surface steps on every route (WARN) and, with --master, the master's colour tags and fast start.
 * @param {import('./lib/report.mjs').GateBuilder} g
 * @param {CheckContext} ctx
 * @param {RouteResult[]} routes
 * @param {ReturnType<typeof ffmpegInfo>} ff
 * @returns {Promise<GateResult>}
 */
async function masterGate(g, ctx, routes, ff) {
  const surface = verdict(g, 'recording.g10', routes, '');
  const master = typeof ctx.args?.master === 'string' && ctx.args.master ? path.resolve(/** @type {string} */ (ctx.args.master)) : null;
  if (!master) return { ...surface, detail: `${surface.detail}; the master's colour range is checked at the recording step with --master <file>` };
  if (!existsSync(master)) throw new UsageError(`--master ${toPosix(master)} does not exist`);
  if (!ff.probe) return g.skip(`ffprobe not found, so the master's colour range could not be read (${surface.detail})`);
  const facts = probeMaster(ff.probe, master);
  if (facts.error || !facts.stream) return g.fail(`ffprobe cannot read ${toPosix(master)}: ${facts.error ?? 'no video stream'}`);
  /** @type {string[]} */
  const warns = [];
  const s = facts.stream;
  if (s.color_range !== 'tv') warns.push(`color_range=${String(s.color_range ?? 'unknown')}, not tv: a full-range or untagged master can crush near-blacks into one black (F12)`);
  if (s.codec_name !== 'h264') warns.push(`codec ${String(s.codec_name)}: export H.264 for the deck (never HEVC)`);
  if (s.pix_fmt !== 'yuv420p') warns.push(`pix_fmt ${String(s.pix_fmt)}: export 4:2:0 (yuv420p)`);
  if (facts.faststart === false) warns.push('mdat before moov: export with -movflags +faststart');
  const evidence = [...surface.evidence, { file: toPosix(master), value: `${String(s.codec_name)} ${String(s.pix_fmt)} range=${String(s.color_range)} ${String(s.width)}x${String(s.height)}`, detail: warns.length ? warns.join('; ') : 'tagged limited range, H.264 4:2:0' }];
  if (surface.state === 'fail') return { ...surface, evidence };
  const detail = `${surface.detail}; master ${warns.length ? `warnings: ${warns.join('; ')}` : 'H.264 4:2:0, limited range'}`;
  return g.ok(detail, evidence);
}

/**
 * @param {import('./lib/report.mjs').GateBuilder} g
 * @param {CheckContext} ctx
 * @returns {GateResult}
 */
function ledgerGate(g, ctx) {
  const result = ledgerMirror(ctx.root, ctx.profile);
  if (!result.applicable) {
    return g.ok(`no Ledger device flow: no @ledgerhq device package in a package.json${(ctx.profile?.sponsors ?? []).includes('ledger') ? ' (Ledger is a sponsor: if the demo signs on a device, add the DMK and mirror its requiredUserInteraction)' : ''}`);
  }
  if (result.evidence.length === 0) {
    return g.fail(`the project uses ${result.packages.join(', ')} but never reads the DMK's requiredUserInteraction or shows a device prompt: add a device-step panel ("Confirm on your Ledger: ...") so the recording shows what the device asks`, result.packages.map((p) => ({ value: p })));
  }
  return g.ok(`${result.packages.join(', ')}: the page mirrors the device step (its visibility during signing is confirmed at the H3 sign-off)`, result.evidence.slice(0, 10));
}

/**
 * @param {import('./lib/report.mjs').GateBuilder} g
 * @param {CheckContext} ctx
 * @param {import('./lib/profile.mjs').VideoFormat | null} video
 * @returns {Promise<GateResult>}
 */
async function deckGate(g, ctx, video) {
  const deck = typeof ctx.args?.deck === 'string' && ctx.args.deck ? path.resolve(/** @type {string} */ (ctx.args.deck)) : null;
  if (!deck) {
    if (!video) return g.ok('not applicable: the profile has no video format, so no deck embeds a recording');
    if (video.embed === 'mp4') return g.ok('not applicable: the video is delivered as an MP4, not embedded in a deck');
    return g.skip(`the profile embeds the video in a .${video.embed} deck, which does not exist before the recording: run recording-check --gates recording.g16 --deck <file> at the deck step`);
  }
  const result = await inspectDeck(deck);
  const evidence = [
    ...result.fail.map((d) => ({ file: toPosix(deck), detail: d, severity: 'fail' })),
    ...result.warn.map((d) => ({ file: toPosix(deck), detail: d, severity: 'warn' })),
    ...result.ok.map((d) => ({ file: toPosix(deck), detail: d, severity: 'ok' })),
  ];
  if (result.fail.length) return g.fail(result.fail.join('; '), evidence);
  return g.ok(`${path.basename(deck)}: ${[...result.ok, ...result.warn].join('; ')}; play it from the Google Drive copy on another machine before submitting`, evidence);
}

/**
 * @param {Route} route
 * @returns {string}
 */
function safeName(route) {
  const base = (route.name || route.path).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'home';
}

/**
 * Folder for the captures: `--out` when given, else frontend-check's `outDir` (`<state>/gates/<UTC>/`), else
 * `<state>/recording/<UTC>`, else the OS temp folder.
 * @param {CheckContext} ctx
 * @returns {string}
 */
export function captureRoot(ctx) {
  const stamp = utcStamp();
  if (typeof ctx.args?.out === 'string' && ctx.args.out) return path.resolve(/** @type {string} */ (ctx.args.out), 'recording-check');
  if (typeof ctx.args?.outDir === 'string' && ctx.args.outDir) return path.resolve(/** @type {string} */ (ctx.args.outDir), 'recording-check');
  if (ctx.state) return path.join(ctx.state, 'recording', stamp);
  return path.join(os.tmpdir(), `frontend-recording-${stamp}`);
}

// ---------------------------------------------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------------------------------------------

const HELP = `recording-check: will the demo video carry the page? (FD20 gates recording.g01 to recording.g16)

Usage:
  node recording-check.mjs [--root <repo>] [--profile <abs path>] [--state <dir>] (--serve <dir> | --url <url>)
                           [--gates recording|recording.g01,...|G7] [--master <video>] [--deck <file>]
                           [--json] [--out <dir>] [--allow-skip <id>] [--network]

Each route is captured at the profile's video size (default 1920x1080, DPR 1) after a deterministic freeze, then
encoded as the 720p and 540p copies a judge sees (ffmpeg with libx264; CAMBI needs libvmaf), and reloaded at 125%
and 150% zoom. Captures, copies and a blind-read prompt go to --out/recording-check/<route>/ (else the state folder).
WARN rows of the research pass with their warnings as evidence; FAIL rows fail the gate.

Flags:
  --root <repo>          product repository (default: the working directory)
  --profile <abs path>   /execution profile.json or a frontend block file
  --state <dir>          state folder override
  --serve <dir>          serve a static build and check it
  --url <url>            check a running app (use ?record=1 through profile.record_mode)
  --gates <list>         ids, recording, or G1..G16 (default: all)
  --master <video>       the recorded master: g10 reads its colour range, codec and fast start with ffprobe
  --deck <file>          the presentation: g16 checks .pptx/.key, never .ppt, and an embedded H.264 MP4
  --json                 print the gate report as JSON on stdout
  --out <dir>            also write <dir>/recording-check.json and the captures
  --allow-skip <id>      let a skipped gate pass the overall verdict (never in a task proof)
  --network              let pages reach hosts other than the app
Environment: FFMPEG_PATH, FFPROBE_PATH (default: ffmpeg and ffprobe on PATH), FRONTEND_CHROMIUM.

Exit codes: 0 every requested gate ok; 1 a gate failed or was skipped; 2 usage error; 3 environment error.
`;

const OPTIONS = /** @type {const} */ ({
  root: { type: 'string' },
  profile: { type: 'string' },
  state: { type: 'string' },
  serve: { type: 'string' },
  url: { type: 'string' },
  gates: { type: 'string' },
  master: { type: 'string' },
  deck: { type: 'string' },
  json: { type: 'boolean' },
  out: { type: 'string' },
  'allow-skip': { type: 'string', multiple: true },
  network: { type: 'boolean' },
});

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const { values } = parseCli(argv, { options: OPTIONS, help: HELP, allowPositionals: false });
  const root = path.resolve(values.root ?? process.cwd());
  if (!existsSync(root)) throw new UsageError(`--root ${toPosix(root)} does not exist; pass the repository root`);
  const profile = loadProfile(values.profile, { root });
  /** @type {(m: string) => void} */
  const log = (m) => {
    process.stderr.write(`${m}\n`);
  };
  let state = null;
  try {
    state = checkStateDir(root, profile, values.state ?? null, values.out);
  } catch (err) {
    if (!(err instanceof EnvError)) throw err;
  }
  const selected = selectGates(values.gates ? values.gates.split(',') : null);
  if (values.url && values.serve) throw new UsageError('pass either --url or --serve, not both');
  for (const flag of /** @type {const} */ (['master', 'deck'])) {
    const v = values[flag];
    if (v && !existsSync(path.resolve(v))) throw new UsageError(`--${flag} ${toPosix(path.resolve(v))} does not exist`);
  }
  /** @type {import('./lib/serve.mjs').StaticServer | null} */
  let server = null;
  /** @type {Browser | null} */
  let browser = null;
  try {
    let baseUrl = values.url ?? null;
    if (values.serve) {
      server = await serveStatic(path.resolve(values.serve));
      baseUrl = server.url;
    }
    if (baseUrl && selected.some((id) => RENDERED.has(id))) browser = await launch();
    /** @type {CheckContext} */
    const ctx = {
      root: toPosix(root),
      profile,
      state,
      design: designDir(root, profile),
      routes: loadRoutes(root, profile),
      baseUrl,
      browser,
      viewports: profile.viewports,
      args: { ...values },
      log,
    };
    const results = await run(ctx, selected);
    const report = aggregate(results, {
      allowSkip: values['allow-skip'] ?? [],
      requested: GATES.filter((g) => selected.includes(g.id)),
      tool: TOOL,
      target: { root: toPosix(root), url: baseUrl, routes: ctx.routes.length, viewports: ['recording', 'zoom125', 'zoom150'] },
    });
    if (values.out) log(`${TOOL}: report written to ${writeReport(report, values.out, TOOL)}`);
    process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : summary(report));
    return report.ok ? 0 : 1;
  } finally {
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  }
}

/**
 * @param {import('./lib/report.mjs').GateReport} report
 * @returns {string}
 */
function summary(report) {
  const lines = report.gates.map((g) => `${g.state.padEnd(7)} ${g.id}: ${g.detail}`);
  lines.push(`${report.ok ? 'ok' : 'not ok'}: ${report.counts.ok} ok, ${report.counts.fail} fail, ${report.counts.skipped} skipped`);
  return `${lines.join('\n')}\n`;
}

/**
 * @param {string} moduleUrl
 * @returns {boolean}
 */
function invokedDirectly(moduleUrl) {
  return isMainModule(moduleUrl);
}

if (invokedDirectly(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }, exitWith);
}
