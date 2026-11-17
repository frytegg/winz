// @ts-check
import { selectorFor } from '../../lib/dom.mjs';
import { waitReady } from '../../lib/ready.mjs';

/*
 * SL-T12 runtime: text hidden at rest that appears once scrolled to (FD10 T12, R12; FD06-F10's reveal probe). On a
 * fresh page: an init script wraps IntersectionObserver before any page script runs, the text below the first
 * viewport is recorded at rest, the page is scrolled through, and what became visible is compared. The first
 * viewport is left out: one orchestrated load moment is a documented legitimate use.
 */

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('playwright-core').Page} Page
 * @typedef {{owners: number, belowFold: number, hiddenBelowFold: number, viewport: number, scrollHeight: number}} RestState
 * @typedef {{group: string, sel: string, text: string, observed: boolean}} Revealed
 * @typedef {{revealed: Revealed[], stillHidden: number, io: {observers: number, targets: number}}} AfterState
 * @typedef {{observers: number, targets: Element[], owners: Array<{el: Element, top: number, hidden: boolean}>}} ProbeState
 */

const RULE = 'SL-T12';

/** FD06-F10's probe: hidden means opacity below 0.1 (or visibility hidden); shown means 0.9 or more. */
export const HIDDEN_OPACITY = 0.1;
export const SHOWN_OPACITY = 0.9;
/** Text owners need this many visible characters (the probe sketch used more than 3). */
export const MIN_CHARS = 3;
/** Scroll by this share of the viewport per step, waiting for observers and transitions to start. */
export const STEP_SHARE = 0.8;
export const STEP_WAIT_MS = 150;
export const MAX_STEPS = 60;
/** After the last step, transitions get this long to finish. */
export const SETTLE_MS = 900;
/** Text a timer shows without any scroll is not a scroll reveal: the rest state is read after this wait. */
export const REST_WAIT_MS = 600;
/** Past this long, the reduced-motion reload is skipped so the detector stays inside the runner's 30 s budget. */
export const BUDGET_MS = 18000;
export const MAX_FINDINGS = 12;
const PROBE = '__feRevealProbe__';

/**
 * Init script: counts IntersectionObserver instances and keeps the elements they observe (runs before page scripts).
 * @param {string} key
 */
function installRevealProbe(key) {
  const Native = window.IntersectionObserver;
  /** @type {ProbeState} */
  const state = { observers: 0, targets: [], owners: [] };
  Object.defineProperty(window, key, { value: state, configurable: true, enumerable: false });
  history.scrollRestoration = 'manual';
  if (typeof Native !== 'function') return;
  class ProbedObserver extends Native {
    /** @param {IntersectionObserverCallback} callback @param {IntersectionObserverInit} [options] */
    constructor(callback, options) {
      super(callback, options);
      state.observers += 1;
    }

    /** @param {Element} target */
    observe(target) {
      state.targets.push(target);
      super.observe(target);
    }
  }
  window.IntersectionObserver = ProbedObserver;
}

/**
 * In-page, at rest: records every element that directly owns visible-sized text, its document top and whether it
 * is hidden (effective opacity below the floor, or visibility hidden).
 * @param {{key: string, minChars: number, hidden: number}} arg
 * @returns {RestState}
 */
function captureAtRest(arg) {
  /** @type {ProbeState} */
  const state = Reflect.get(window, arg.key);
  /** @type {Map<Element, number>} */
  const memo = new Map();
  /** @param {Element | null} el @returns {number} */
  const opacityOf = (el) => {
    if (!el) return 1;
    const known = memo.get(el);
    if (known !== undefined) return known;
    const own = Number.parseFloat(getComputedStyle(el).opacity);
    const value = (Number.isFinite(own) ? own : 1) * opacityOf(el.parentElement);
    memo.set(el, value);
    return value;
  };
  const vh = window.innerHeight;
  /** @type {Set<Element>} */
  const owners = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || parent.closest('script, style, noscript, template')) continue;
    if ((n.nodeValue || '').replace(/\s+/g, '').length >= arg.minChars) owners.add(parent);
  }
  state.owners = [];
  let below = 0;
  let hiddenBelow = 0;
  for (const el of owners) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const top = r.top + window.scrollY;
    const hidden = opacityOf(el) < arg.hidden || getComputedStyle(el).visibility === 'hidden';
    state.owners.push({ el, top, hidden });
    if (top >= vh) {
      below += 1;
      if (hidden) hiddenBelow += 1;
    }
  }
  return {
    owners: state.owners.length, belowFold: below, hiddenBelowFold: hiddenBelow, viewport: vh,
    scrollHeight: document.documentElement.scrollHeight,
  };
}

/**
 * In-page, after the scroll-through: the owners hidden at rest below the first viewport that are now shown, grouped
 * by section, and whether an IntersectionObserver watched them or an ancestor.
 * @param {(el: Element) => string} selectorOf
 * @param {{key: string, hidden: number, shown: number, viewport: number}} arg
 * @returns {AfterState}
 */
function compareAfterScroll(selectorOf, arg) {
  /** @type {ProbeState} */
  const state = Reflect.get(window, arg.key);
  /** @type {Map<Element, number>} */
  const memo = new Map();
  /** @param {Element | null} el @returns {number} */
  const opacityOf = (el) => {
    if (!el) return 1;
    const known = memo.get(el);
    if (known !== undefined) return known;
    const own = Number.parseFloat(getComputedStyle(el).opacity);
    const value = (Number.isFinite(own) ? own : 1) * opacityOf(el.parentElement);
    memo.set(el, value);
    return value;
  };
  /** @type {Set<Element>} */
  const targets = new Set(state.targets);
  /** @param {Element} el @returns {boolean} */
  const observed = (el) => {
    for (let n = /** @type {Element | null} */ (el); n; n = n.parentElement) if (targets.has(n)) return true;
    return false;
  };
  /** @param {Element} el @returns {Element} */
  const groupOf = (el) => {
    const marked = el.closest('section, article, [data-feature]');
    if (marked) return marked;
    let node = el;
    while (node.parentElement && node.parentElement !== document.body && node.parentElement.localName !== 'main') node = node.parentElement;
    return node;
  };
  /** @type {Revealed[]} */
  const revealed = [];
  let stillHidden = 0;
  for (const owner of state.owners) {
    if (!owner.hidden || owner.top < arg.viewport || !owner.el.isConnected) continue;
    const shown = opacityOf(owner.el) >= arg.shown && getComputedStyle(owner.el).visibility !== 'hidden';
    if (!shown) {
      stillHidden += 1;
      continue;
    }
    const text = (owner.el.textContent || '').replace(/\s+/g, ' ').trim();
    revealed.push({ group: selectorOf(groupOf(owner.el)), sel: selectorOf(owner.el), text: text.slice(0, 80), observed: observed(owner.el) });
  }
  return { revealed, stillHidden, io: { observers: state.observers, targets: state.targets.length } };
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
 * Scrolls the page top to bottom in steps of STEP_SHARE viewports, following the page as it grows.
 * @param {Page} page
 * @param {number} viewport
 * @returns {Promise<number>} steps taken
 */
async function scrollThrough(page, viewport) {
  const step = Math.max(100, Math.round(viewport * STEP_SHARE));
  let steps = 0;
  for (let y = step; steps < MAX_STEPS; y += step) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.evaluate((top) => window.scrollTo(0, top), Math.min(y, height));
    await page.waitForTimeout(STEP_WAIT_MS);
    steps += 1;
    if (y >= height - viewport) break;
  }
  await page.waitForTimeout(SETTLE_MS);
  return steps;
}

/**
 * Under reduced motion, how many of the revealed owners are still hidden at rest (content a reduced-motion reader
 * only gets by scrolling, or never).
 * @param {Page} page
 * @param {string[]} selectors
 * @param {boolean} readyFlag
 * @returns {Promise<{checked: number, hiddenAtRest: number}>}
 */
async function reducedMotionCheck(page, selectors, readyFlag) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'load' });
  await waitReady(page, { readyFlag });
  return page.evaluate(({ sels, hidden }) => {
    let checked = 0;
    let hiddenAtRest = 0;
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) continue;
      checked += 1;
      let opacity = 1;
      for (let n = /** @type {Element | null} */ (el); n; n = n.parentElement) {
        const own = Number.parseFloat(getComputedStyle(n).opacity);
        opacity *= Number.isFinite(own) ? own : 1;
      }
      if (opacity < hidden || getComputedStyle(el).visibility === 'hidden') hiddenAtRest += 1;
    }
    return { checked, hiddenAtRest };
  }, { sels: selectors, hidden: HIDDEN_OPACITY });
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
 * One finding per section whose text was hidden at rest below the first viewport and appeared during the
 * scroll-through. The value carries the IntersectionObserver evidence and the reduced-motion result (null when the
 * reload would overrun BUDGET_MS).
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const readyFlag = ctx.profile?.ready_flag === true;
  const started = Date.now();
  const page = await ctx.freshPage();
  await page.addInitScript(installRevealProbe, PROBE);
  await page.reload({ waitUntil: 'load' });
  await waitReady(page, { readyFlag });
  await page.waitForTimeout(REST_WAIT_MS);
  const rest = await page.evaluate(captureAtRest, { key: PROBE, minChars: MIN_CHARS, hidden: HIDDEN_OPACITY });
  if (rest.hiddenBelowFold === 0) return [];
  await scrollThrough(page, rest.viewport);
  const after = await inPage(page, compareAfterScroll, { key: PROBE, hidden: HIDDEN_OPACITY, shown: SHOWN_OPACITY, viewport: rest.viewport });
  if (after.revealed.length === 0) return [];
  /** @type {Map<string, Revealed[]>} */
  const groups = new Map();
  for (const r of after.revealed) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  const reduced = Date.now() - started > BUDGET_MS ? null : await reducedMotionCheck(page, after.revealed.map((r) => r.sel).slice(0, 200), readyFlag);
  /** @type {RuntimeFinding[]} */
  const out = [];
  for (const [group, items] of groups) {
    const observed = items.some((r) => r.observed);
    out.push(finding(ctx, group, {
      revealed: items.length, sample: items[0].text, observedByIntersectionObserver: observed, io: after.io,
      stillHiddenAfterScroll: after.stillHidden, reducedMotion: reduced, sections: groups.size,
    }, `${items.length} text block(s) hidden at rest appear on scroll${observed ? ' (IntersectionObserver reveal)' : ''}; ${groups.size} section(s) fade in; ${reduced ? `under reduced motion ${reduced.hiddenAtRest} of ${reduced.checked} stay hidden at rest` : 'reduced-motion check skipped (time budget)'}`));
    if (out.length >= MAX_FINDINGS) break;
  }
  return out;
}
