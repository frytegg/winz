// @ts-check
/*
 * SL-MO2: entrances eased in. "Never use ease-in for UI animations", entering and exiting take ease-out [FD03-F06];
 * an exit along the same path is the documented false positive, so only entrance-shaped motion counts.
 *
 * This module also hosts the load-time motion log that SL-MO3, SL-MO4 and SL-MO5 import. getAnimations() on an
 * already loaded page misses every entrance that has finished, so the log comes from a fresh context whose recorder
 * runs before any page script (addInitScript) [FD10-F25]: animationstart, transitionrun and Element.animate are
 * recorded, the page is scrolled through so scroll-triggered entrances start [FD06-F10], and one log is kept per
 * page state and reduced-motion setting. rAF-driven motion stays invisible to it [FD03-F25].
 */
import { goto, newContext } from '../../lib/browser.mjs';
import { selectorFor } from '../../lib/dom.mjs';
import { EnvError } from '../../lib/errors.mjs';
import { waitReady } from '../../lib/ready.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').Box} Box
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {'reduce' | 'no-preference'} ReducedMotion
 * @typedef {{offset: number, easing: string, values: Record<string, string>}} Frame
 * @typedef {{selector: string, tag: string, kind: 'css-animation' | 'css-transition' | 'web-animation', name: string,
 *   pseudo: string, t: number, duration: number, delay: number, iterations: number | 'infinite', easing: string,
 *   direction: string, fill: string, properties: string[], frames: Frame[], box: Box | null,
 *   layout: {w: number, h: number}, position: string}} MotionRecord
 * @typedef {{url: string, reducedMotion: ReducedMotion, viewport: {w: number, h: number}, docHeight: number,
 *   scrollSteps: number, records: MotionRecord[], reducedMotionRules: number, unreadableSheets: number,
 *   errors: string[]}} MotionLog
 * @typedef {{selector: string, box: Box | null, [key: string]: unknown}} Item
 */

export const RULE = 'SL-MO2';
/** Progress at half time at or below this marks a curve that starts slow (CSS ease-in gives 0.32). */
export const EASE_IN_MIDPOINT = 0.4;
export const MAX_FINDINGS = 20;

const SCROLL_STEP = 0.8;
const SCROLL_PAUSE_MS = 90;
const MAX_SCROLL_STEPS = 30;
const SETTLE_QUIET_MS = 400;
const SETTLE_MAX_MS = 2500;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const [log, elements] = await Promise.all([motionLog(ctx, 'no-preference'), ctx.cache.elements()]);
  /** @type {Item[]} */
  const items = [];
  for (const r of log.records) {
    if (!isEntrance(r)) continue;
    const easing = effectiveEasing(r);
    if (!isEaseIn(easing)) continue;
    items.push({ selector: r.selector, box: r.box, source: 'motion-log', kind: r.kind, name: r.name, easing, durationMs: r.duration });
  }
  for (const el of elements) {
    const waiting = waitingEntranceEasing(el);
    if (waiting) items.push({ selector: el.sel, box: el.box, source: 'at-rest', kind: 'css-transition', name: waiting.property, easing: waiting.easing, durationMs: waiting.durationMs });
  }
  const unique = dedupe(items);
  return unique.slice(0, MAX_FINDINGS).map((item) => finding(RULE, ctx, item, `entrance ${describe(item)} eased in with ${String(item.easing)}; use the ease-out token`, unique.length));
}

/**
 * Easing that shapes a record's progress: a CSS animation's timing function sits on its keyframes, a transition's or
 * a Web Animation's on the effect (a non-linear effect easing wins).
 * @param {MotionRecord} r
 * @returns {string}
 */
export function effectiveEasing(r) {
  if (r.easing && r.easing !== 'linear') return r.easing;
  return r.frames[0]?.easing ?? r.easing ?? 'linear';
}

/**
 * Element at rest hidden (opacity <= 0.1 or visibility hidden) with an eased-in transition on what reveals it: an
 * entrance waiting to run.
 * @param {ElementInfo} el
 * @returns {{property: string, easing: string, durationMs: number} | null}
 */
export function waitingEntranceEasing(el) {
  const s = el.styles;
  if (!s || s.display === 'none') return null;
  const hidden = Number.parseFloat(s.opacity) <= 0.1 || s.visibility === 'hidden';
  if (!hidden) return null;
  for (const pair of transitionPairs(s.transitionProperty, s.transitionDuration, s.transitionTimingFunction)) {
    if (pair.durationMs <= 0) continue;
    if (!['all', 'opacity', 'transform', 'translate', 'scale', 'visibility'].includes(pair.property)) continue;
    if (isEaseIn(pair.easing)) return { property: pair.property, easing: pair.easing, durationMs: pair.durationMs };
  }
  return null;
}

/**
 * The computed transition lists paired the way CSS pairs them: each property takes the duration and timing function
 * at its index, the shorter lists repeating.
 * @param {string | undefined} properties
 * @param {string | undefined} durations
 * @param {string | undefined} [easings]
 * @returns {Array<{property: string, durationMs: number, easing: string}>}
 */
export function transitionPairs(properties, durations, easings) {
  const props = splitTopLevel(properties ?? '');
  const durs = splitTopLevel(durations ?? '');
  const eases = splitTopLevel(easings ?? '');
  return props.map((property, i) => ({
    property: property.trim(),
    durationMs: toMs(durs.length ? durs[i % durs.length] : '0s'),
    easing: eases.length ? eases[i % eases.length].trim() : 'ease',
  }));
}

/**
 * Splits a CSS list on commas outside parentheses ("cubic-bezier(0.4, 0, 1, 1), ease" gives two items).
 * @param {string} value
 * @returns {string[]}
 */
export function splitTopLevel(value) {
  /** @type {string[]} */
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last || out.length > 0) out.push(last);
  return out.filter((v) => v !== '');
}

/**
 * CSS time to milliseconds ("0.2s", "150ms"); anything else is 0.
 * @param {string | undefined} value
 * @returns {number}
 */
export function toMs(value) {
  const m = /^\s*(-?[\d.]+)(ms|s)\s*$/i.exec(value ?? '');
  if (!m) return 0;
  const n = Number.parseFloat(m[1]);
  return m[2].toLowerCase() === 's' ? n * 1000 : n;
}

/** Control points of the CSS keyword curves. */
const KEYWORD_CURVES = Object.freeze({
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  linear: [0, 0, 1, 1],
});

/**
 * Control points of a cubic-bezier timing function or keyword, or null for steps(), linear() and anything else.
 * @param {string | undefined} easing
 * @returns {[number, number, number, number] | null}
 */
export function bezierOf(easing) {
  const e = (easing ?? '').trim().toLowerCase();
  if (Object.hasOwn(KEYWORD_CURVES, e)) return /** @type {[number, number, number, number]} */ ([...KEYWORD_CURVES[/** @type {keyof typeof KEYWORD_CURVES} */ (e)]]);
  const m = /^cubic-bezier\(\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*\)$/.exec(e);
  if (!m) return null;
  const p = /** @type {[number, number, number, number]} */ (m.slice(1, 5).map(Number));
  return p.every(Number.isFinite) ? p : null;
}

/**
 * Progress of a timing function at time fraction x (0..1), or null when it is not a cubic Bezier curve.
 * @param {string | undefined} easing
 * @param {number} x
 * @returns {number | null}
 */
export function easingProgress(easing, x) {
  const p = bezierOf(easing);
  if (!p) return null;
  const [x1, y1, x2, y2] = p;
  const bez = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ s) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (bez(x1, x2, mid) < x) lo = mid;
    else hi = mid;
  }
  return bez(y1, y2, (lo + hi) / 2);
}

/**
 * True for a curve that starts slow: progress at half time at or below EASE_IN_MIDPOINT (ease-in, Tailwind's
 * cubic-bezier(0.4, 0, 1, 1), the easeIn family); false for ease, ease-out, ease-in-out, linear and steps.
 * @param {string | undefined} easing
 * @returns {boolean}
 */
export function isEaseIn(easing) {
  const half = easingProgress(easing, 0.5);
  return half !== null && half <= EASE_IN_MIDPOINT;
}

/**
 * A finite record whose motion brings something in: opacity rising from 0.5 or less, or a transform, translate or
 * scale that ends at rest. Loops and exits are not entrances.
 * @param {MotionRecord} r
 * @returns {boolean}
 */
export function isEntrance(r) {
  if (r.iterations === 'infinite' || r.frames.length < 2) return false;
  const [from, to] = endpoints(r);
  const op0 = numberOf(from.values.opacity);
  const op1 = numberOf(to.values.opacity);
  if (op0 !== null && op1 !== null && op0 <= 0.5 && op1 >= op0 + 0.3) return true;
  for (const key of ['transform', 'translate', 'scale', 'rotate']) {
    const a = from.values[key];
    const b = to.values[key];
    if (a === undefined || b === undefined) continue;
    if (!transformAtRest(key, a) && transformAtRest(key, b)) return true;
  }
  return false;
}

/**
 * The first and last frames in playback order (a reversed direction plays them backwards).
 * @param {MotionRecord} r
 * @returns {[Frame, Frame]}
 */
export function endpoints(r) {
  const first = r.frames[0];
  const last = r.frames[r.frames.length - 1];
  return /reverse/.test(r.direction ?? '') ? [last, first] : [first, last];
}

/**
 * @param {string | undefined} value
 * @returns {number | null}
 */
function numberOf(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

/**
 * Splits a transform list into functions, respecting nested parentheses ("translateY(calc(100% - 4px)) scale(0.9)").
 * @param {string} value
 * @returns {Array<{name: string, args: string[]}>}
 */
export function transformFunctions(value) {
  /** @type {Array<{name: string, args: string[]}>} */
  const out = [];
  const s = String(value ?? '');
  let i = 0;
  while (i < s.length) {
    const m = /^\s*([a-zA-Z][a-zA-Z0-9]*)\(/.exec(s.slice(i));
    if (!m) break;
    let depth = 1;
    let j = i + m[0].length;
    const argStart = j;
    while (j < s.length && depth > 0) {
      if (s[j] === '(') depth += 1;
      else if (s[j] === ')') depth -= 1;
      j += 1;
    }
    out.push({ name: m[1].toLowerCase(), args: splitTopLevel(s.slice(argStart, j - 1)) });
    i = j;
  }
  return out;
}

/**
 * Horizontal and vertical scale factors of a transform value or of the individual `scale` property, or null when
 * it has no readable scale (calc(), var()).
 * @param {string} value
 * @returns {{sx: number, sy: number} | null}
 */
export function scaleOf(value) {
  const v = String(value ?? '').trim();
  if (v === '' || v === 'none') return { sx: 1, sy: 1 };
  if (/^-?[\d.]+%?(\s+-?[\d.]+%?){0,2}$/.test(v)) {
    const parts = v.split(/\s+/).map(factor);
    return { sx: parts[0], sy: parts[1] ?? parts[0] };
  }
  let sx = 1;
  let sy = 1;
  for (const f of transformFunctions(v)) {
    const n = f.args.map(factor);
    if (n.some((x) => !Number.isFinite(x)) && /^(scale|matrix)/.test(f.name)) return null;
    if (f.name === 'scale') {
      sx *= n[0];
      sy *= n[1] ?? n[0];
    } else if (f.name === 'scale3d') {
      sx *= n[0];
      sy *= n[1];
    } else if (f.name === 'scalex') sx *= n[0];
    else if (f.name === 'scaley') sy *= n[0];
    else if (f.name === 'matrix' && n.length === 6) {
      sx *= Math.hypot(n[0], n[1]);
      sy *= Math.hypot(n[2], n[3]);
    } else if (f.name === 'matrix3d' && n.length === 16) {
      sx *= Math.hypot(n[0], n[1], n[2]);
      sy *= Math.hypot(n[4], n[5], n[6]);
    }
  }
  return { sx, sy };
}

/**
 * @param {string} token
 * @returns {number}
 */
function factor(token) {
  const t = String(token).trim();
  if (t.endsWith('%')) return Number.parseFloat(t) / 100;
  return Number.parseFloat(t);
}

/**
 * True when a value of `transform` or of the individual `translate`, `scale` or `rotate` property leaves the element
 * where it rests: none, identity matrices, zero translations, unit scales, zero rotations. Unreadable values (calc,
 * var, unknown functions) count as moved.
 * @param {string} property transform | translate | scale | rotate
 * @param {string} value
 * @returns {boolean}
 */
export function transformAtRest(property, value) {
  const v = String(value ?? '').trim();
  if (v === '' || v === 'none') return true;
  const tokens = v.split(/\s+/);
  if (property === 'translate') return tokens.every((t) => /^-?[\d.]+[a-z%]*$/.test(t) && Number.parseFloat(t) === 0);
  if (property === 'scale') return tokens.every((t) => /^-?[\d.]+%?$/.test(t) && Math.abs(factor(t) - 1) < 1e-6);
  if (property === 'rotate') {
    const angle = tokens[tokens.length - 1];
    return /^-?[\d.]+(deg|rad|turn|grad)?$/.test(angle) && Number.parseFloat(angle) === 0;
  }
  const functions = transformFunctions(v);
  if (functions.length === 0) return false;
  for (const f of functions) {
    const n = f.args.map((a) => Number.parseFloat(a));
    const zero = (/** @type {number} */ x) => x === 0;
    if (f.args.some((a) => /calc|var/.test(a))) return false;
    if (/^translate/.test(f.name) || /^rotate/.test(f.name) || /^skew/.test(f.name)) {
      if (!(f.name === 'rotate3d' ? zero(n[3]) : n.every(zero))) return false;
    } else if (/^scale/.test(f.name)) {
      if (!f.args.map(factor).every((x) => Math.abs(x - 1) < 1e-6)) return false;
    } else if (f.name === 'matrix') {
      if (![1, 0, 0, 1, 0, 0].every((x, k) => Math.abs(n[k] - x) < 1e-6)) return false;
    } else if (f.name === 'matrix3d') {
      const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      if (!id.every((x, k) => Math.abs(n[k] - x) < 1e-6)) return false;
    } else if (f.name === 'perspective') {
      continue;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * One item per element, keeping the first (an element whose opacity and transform both transition is one thing to
 * fix); items of removed elements, which have no selector, stay apart by name and kind.
 * @param {Item[]} items
 * @returns {Item[]}
 */
export function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.selector || `(removed)|${String(item.name ?? '')}|${String(item.kind ?? '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * "selector (kind name, N ms)" for a motion item.
 * @param {Item} item
 * @returns {string}
 */
export function describe(item) {
  return `${item.selector || '(removed element)'} (${String(item.kind)} ${String(item.name) || 'unnamed'}, ${Math.round(Number(item.durationMs) || 0)} ms)`;
}

/**
 * One runtime finding for one instance: the item's selector and box, its measured values, and `total`, the number
 * of instances on the page (findings stop at the rule's cap).
 * @param {string} rule
 * @param {RuntimeContext} ctx
 * @param {Item} item
 * @param {string} detail
 * @param {number} total
 * @returns {RuntimeFinding}
 */
export function finding(rule, ctx, item, detail, total) {
  const { selector, box, ...value } = item;
  return {
    rule,
    layer: 'runtime',
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector,
    box,
    value: { ...value, total },
    detail,
  };
}

/* ------------------------------------------------------------------ the shared load-time motion log */

/** @type {WeakMap<object, Map<ReducedMotion, Promise<MotionLog>>>} */
const LOGS = new WeakMap();

/**
 * The motion log of the context's page state for one reduced-motion setting, recorded once and shared by every
 * detector that receives the same collector cache (one runtimeContext). A failed recording rejects for every caller,
 * so each detector that needed it reports the error.
 * @param {RuntimeContext} ctx
 * @param {ReducedMotion} reducedMotion
 * @returns {Promise<MotionLog>}
 */
export function motionLog(ctx, reducedMotion) {
  let byMode = LOGS.get(ctx.cache);
  if (!byMode) {
    byMode = new Map();
    LOGS.set(ctx.cache, byMode);
  }
  let log = byMode.get(reducedMotion);
  if (!log) {
    log = recordMotion(ctx, reducedMotion);
    byMode.set(reducedMotion, log);
  }
  return log;
}

/**
 * Opens a fresh context at the shared page's URL and viewport with the given reduced-motion setting, records every
 * animation and transition from document creation through load and a scroll-through, then closes the context.
 * @param {RuntimeContext} ctx
 * @param {ReducedMotion} reducedMotion
 * @returns {Promise<MotionLog>}
 */
async function recordMotion(ctx, reducedMotion) {
  const url = ctx.page.url();
  const context = await newContext(ctx.browser, { ...ctx.viewport, reducedMotion });
  /** @type {unknown} */
  let failure;
  try {
    await context.addInitScript(motionRecorder);
    const page = await context.newPage();
    await goto(page, url);
    await waitReady(page, { readyFlag: ctx.profile?.ready_flag === true });
    const scrollSteps = await scrollThrough(page);
    await settle(page);
    const raw = await page.evaluate(`(${readMotion.toString()})(${selectorFor.toString()})`);
    return toLog(raw, url, reducedMotion, scrollSteps);
  } catch (err) {
    failure = err;
    throw err;
  } finally {
    try {
      await context.close();
    } catch (closeErr) {
      if (failure === undefined) throw closeErr;
    }
  }
}

/**
 * Scrolls the page by 0.8 viewport heights at a time (at most MAX_SCROLL_STEPS), pausing so observers fire, then
 * returns to the top. Returns the number of steps taken.
 * @param {import('playwright-core').Page} page
 * @returns {Promise<number>}
 */
async function scrollThrough(page) {
  let steps = 0;
  for (; steps < MAX_SCROLL_STEPS; steps += 1) {
    const done = await page.evaluate((fraction) => {
      const before = window.scrollY;
      window.scrollTo({ top: before + Math.max(200, Math.round(window.innerHeight * fraction)), behavior: 'instant' });
      return window.scrollY === before;
    }, SCROLL_STEP);
    if (done) break;
    await page.waitForTimeout(SCROLL_PAUSE_MS);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  return steps;
}

/**
 * Waits until no new animation has been recorded for SETTLE_QUIET_MS (at most SETTLE_MAX_MS).
 * @param {import('playwright-core').Page} page
 */
async function settle(page) {
  const started = Date.now();
  let last = -1;
  let stableSince = Date.now();
  while (Date.now() - started < SETTLE_MAX_MS) {
    const count = await page.evaluate(() => {
      const state = /** @type {{records?: unknown[]} | undefined} */ (Reflect.get(window, '__feMotion'));
      return state?.records?.length ?? 0;
    });
    if (count !== last) {
      last = count;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= SETTLE_QUIET_MS) {
      return;
    }
    await page.waitForTimeout(100);
  }
}

/**
 * Validates the in-page result and shapes it as a MotionLog.
 * @param {unknown} raw
 * @param {string} url
 * @param {ReducedMotion} reducedMotion
 * @param {number} scrollSteps
 * @returns {MotionLog}
 */
function toLog(raw, url, reducedMotion, scrollSteps) {
  if (!raw || typeof raw !== 'object') {
    throw new EnvError(
      `the motion recorder did not run at ${url} (window.__feMotion is missing), so the motion rules cannot judge this page; check whether a page script replaces window properties or the page reloads itself`,
    );
  }
  const r = /** @type {Record<string, unknown>} */ (raw);
  return {
    url,
    reducedMotion,
    viewport: /** @type {{w: number, h: number}} */ (r.viewport),
    docHeight: Number(r.docHeight) || 0,
    scrollSteps,
    records: /** @type {MotionRecord[]} */ (Array.isArray(r.records) ? r.records : []),
    reducedMotionRules: Number(r.reducedMotionRules) || 0,
    unreadableSheets: Number(r.unreadableSheets) || 0,
    errors: Array.isArray(r.errors) ? r.errors.map(String) : [],
  };
}

/**
 * Init script: records every CSS animation (animationstart), CSS transition (transitionrun) and Web Animation
 * (Element.prototype.animate) from document creation on. Self-contained: it runs inside the page.
 */
export const motionRecorder = function motionRecorder() {
  if (Reflect.get(window, '__feMotion')) return;
  const t0 = performance.now();
  const seen = new WeakSet();
  /** @type {Element[]} */
  const targets = [];
  /** @type {Array<Record<string, unknown>>} */
  const records = [];
  /** @type {string[]} */
  const errors = [];
  /** @param {Animation | null | undefined} animation */
  const capture = (animation) => {
    if (!animation || seen.has(animation)) return;
    seen.add(animation);
    try {
      const effect = animation.effect;
      const keyframes = effect instanceof KeyframeEffect ? effect : null;
      const target = keyframes ? keyframes.target : null;
      /** @type {EffectTiming} */
      const timing = effect ? effect.getTiming() : {};
      /** @type {ComputedEffectTiming} */
      const computed = effect ? effect.getComputedTiming() : {};
      const frames = keyframes ? keyframes.getKeyframes() : [];
      let kind = 'web-animation';
      let name = animation.id || '';
      if (typeof CSSAnimation !== 'undefined' && animation instanceof CSSAnimation) {
        kind = 'css-animation';
        name = animation.animationName;
      } else if (typeof CSSTransition !== 'undefined' && animation instanceof CSSTransition) {
        kind = 'css-transition';
        name = animation.transitionProperty;
      }
      let index = -1;
      if (target) {
        index = targets.indexOf(target);
        if (index < 0) {
          targets.push(target);
          index = targets.length - 1;
        }
      }
      const rect = target ? target.getBoundingClientRect() : null;
      const layout = target instanceof HTMLElement
        ? { w: target.offsetWidth, h: target.offsetHeight }
        : rect ? { w: rect.width, h: rect.height } : { w: 0, h: 0 };
      const reserved = new Set(['offset', 'computedOffset', 'easing', 'composite']);
      const properties = new Set();
      const plain = frames.slice(0, 8).map((frame) => {
        /** @type {Record<string, string>} */
        const values = {};
        for (const [key, value] of Object.entries(frame)) {
          if (reserved.has(key)) continue;
          properties.add(key);
          values[key] = String(value).slice(0, 300);
        }
        const offset = typeof frame.computedOffset === 'number' ? frame.computedOffset : typeof frame.offset === 'number' ? frame.offset : 0;
        return { offset, easing: typeof frame.easing === 'string' ? frame.easing : 'linear', values };
      });
      for (const frame of frames.slice(8)) for (const key of Object.keys(frame)) if (!reserved.has(key)) properties.add(key);
      if (kind === 'css-transition' && properties.size === 0 && name) properties.add(name);
      const iterations = timing.iterations === Infinity ? 'infinite' : typeof timing.iterations === 'number' ? timing.iterations : 1;
      records.push({
        target: index,
        tag: target ? target.localName : '',
        kind,
        name,
        pseudo: keyframes && keyframes.pseudoElement ? keyframes.pseudoElement : '',
        t: Math.round(performance.now() - t0),
        duration: typeof computed.duration === 'number' ? computed.duration : 0,
        delay: typeof timing.delay === 'number' ? timing.delay : 0,
        iterations,
        easing: typeof timing.easing === 'string' ? timing.easing : 'linear',
        direction: typeof timing.direction === 'string' ? timing.direction : 'normal',
        fill: typeof timing.fill === 'string' ? timing.fill : 'auto',
        properties: [...properties],
        frames: plain,
        box: rect
          ? { x: Math.round((rect.left + window.scrollX) * 100) / 100, y: Math.round((rect.top + window.scrollY) * 100) / 100, w: Math.round(rect.width * 100) / 100, h: Math.round(rect.height * 100) / 100 }
          : null,
        layout,
        position: target ? getComputedStyle(target).position : '',
      });
    } catch (err) {
      if (errors.length < 20) errors.push(String(err));
    }
  };
  /**
   * @param {EventTarget | null} target @param {string} pseudo @param {(a: Animation) => boolean} test
   * @returns {Animation | null}
   */
  const find = (target, pseudo, test) => {
    for (const animation of document.getAnimations()) {
      const effect = animation.effect;
      if (effect instanceof KeyframeEffect && effect.target === target && (effect.pseudoElement || '') === pseudo && test(animation)) return animation;
    }
    return null;
  };
  document.addEventListener('animationstart', (event) => {
    capture(find(event.target, event.pseudoElement || '', (a) => typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation && a.animationName === event.animationName));
  }, true);
  document.addEventListener('transitionrun', (event) => {
    capture(find(event.target, event.pseudoElement || '', (a) => typeof CSSTransition !== 'undefined' && a instanceof CSSTransition && a.transitionProperty === event.propertyName));
  }, true);
  const animate = Element.prototype.animate;
  if (typeof animate === 'function') {
    /**
     * @this {Element}
     * @param {Keyframe[] | PropertyIndexedKeyframes | null} keyframes
     * @param {number | KeyframeAnimationOptions} [options]
     * @returns {Animation}
     */
    const patchedAnimate = function patchedAnimate(keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      capture(animation);
      return animation;
    };
    Element.prototype.animate = patchedAnimate;
  }
  Reflect.set(window, '__feMotion', { targets, records, errors, capture });
};

/**
 * In-page reader: records anything still running that no event announced, attaches selectors, and counts the
 * prefers-reduced-motion media rules in the readable style sheets. Receives the selectorFor of lib/dom.mjs.
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorOf
 * @returns {Record<string, unknown> | null}
 */
export const readMotion = function readMotion(selectorOf) {
  const state = /** @type {{targets: Element[], records: Array<Record<string, unknown>>, errors: string[],
    capture: (a: Animation) => void} | undefined} */ (Reflect.get(window, '__feMotion'));
  if (!state) return null;
  for (const animation of document.getAnimations()) state.capture(animation);
  const counts = new Map();
  const selectors = state.targets.map((t) => (t.isConnected ? selectorOf(t, counts) : ''));
  let reducedMotionRules = 0;
  let unreadableSheets = 0;
  /** @param {CSSRuleList} rules */
  const visit = (rules) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSMediaRule && /prefers-reduced-motion/i.test(rule.conditionText || rule.media.mediaText)) reducedMotionRules += 1;
      if (rule instanceof CSSImportRule) {
        try {
          if (rule.styleSheet) visit(rule.styleSheet.cssRules);
        } catch {
          unreadableSheets += 1;
        }
      } else if ('cssRules' in rule && rule.cssRules) {
        visit(/** @type {CSSRuleList} */ (rule.cssRules));
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visit(sheet.cssRules);
    } catch {
      unreadableSheets += 1;
    }
  }
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    docHeight: document.documentElement.scrollHeight,
    records: state.records.map((r) => {
      const { target, ...rest } = r;
      return { ...rest, selector: typeof target === 'number' && target >= 0 ? selectors[target] : '' };
    }),
    reducedMotionRules,
    unreadableSheets,
    errors: state.errors.slice(0, 10),
  };
};
