// @ts-check
/*
 * motion-check: what moves, and whether anything waits for motion to be seen. Each route and viewport is loaded
 * twice (prefers-reduced-motion no-preference, then reduce) with a recorder that catches every CSS animation, CSS
 * transition and Web Animation as it starts, during load, a scroll-through, a hover pass and a press pass.
 * Sources: research/tool-emil-kowalski.md (FD03-F06, F07, F15, F25), research/tool-playwright-cli.md (FD06-F10).
 * requestAnimationFrame-driven motion is invisible to getAnimations() (FD03-F25); the tells rules cover it.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli, isMainModule } from './lib/args.mjs';
import { goto, launch, newContext } from './lib/browser.mjs';
import { parseColor } from './lib/color.mjs';
import { selectorFor } from './lib/dom.mjs';
import { EnvError, UsageError, exitWith } from './lib/errors.mjs';
import { readText, toPosix } from './lib/fsutil.mjs';
import { checkStateDir, designDir } from './lib/paths.mjs';
import { loadProfile } from './lib/profile.mjs';
import { waitReady } from './lib/ready.mjs';
import { aggregate, gate, writeReport } from './lib/report.mjs';
import { loadRoutes, routeUrl } from './lib/routes.mjs';
import { serveStatic } from './lib/serve.mjs';

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

const TOOL = 'motion-check';

export const GATES = Object.freeze([
  Object.freeze({
    id: 'motion.reduced',
    title: 'Under prefers-reduced-motion only opacity and colour animate, and no text goes missing',
    ifDropped: 'the page could slide, scale or parallax for a viewer who asked for reduced motion, or lose content under that setting; axe has no rule for it',
  }),
  Object.freeze({
    id: 'motion.hidden-at-rest',
    title: 'No text waits for a scroll to appear, and the H1, the sentence and the first figures are visible at load',
    ifDropped: 'a headline, a proof or a whole section could stay invisible in a screenshot, a recording or a judge\'s first look until something scrolls it in',
  }),
  Object.freeze({
    id: 'motion.inventory',
    title: 'Every animation within the budget of its role, and infinite animations only on data-live elements',
    ifDropped: 'slow UI transitions, long decorative entrances and endless loops that pull the eye would pass',
  }),
]);

/**
 * Maximum duration per role, in ms (FD03-F07 as adopted in references/05-tokens.md TK-20 and 08-motion.md MO-05):
 * press 100-160, tooltip 125-200, dropdown 150-250, modal 200-300, a full-height drawer up to 500 on the drawer
 * curve, toasts near 400 (FD03-F23), hover feedback held to the tooltip budget, other UI under 300.
 */
export const ROLE_BUDGETS = Object.freeze({ press: 160, tooltip: 200, dropdown: 250, modal: 300, drawer: 500, toast: 400, hover: 200, ui: 300 });

/** @typedef {keyof typeof ROLE_BUDGETS} Role */

const ROLE_WORDS = /** @type {Array<[Role, RegExp]>} */ ([
  ['press', /press|active|tap/],
  ['tooltip', /tooltip/],
  ['dropdown', /dropdown|menu|popover|select|listbox/],
  ['modal', /modal|dialog/],
  ['drawer', /drawer|sheet/],
  ['toast', /toast|snackbar|notification/],
  ['hover', /hover/],
]);

/** Animations shorter than this are instant: the usual reduced-motion reset sets 0.01 ms. */
const INSTANT_MS = 10;
const HIDDEN_OPACITY = 0.1;
const SETTLE_MS = 4000;
const HOVER_LIMIT = 40;
const PRESS_LIMIT = 20;
/**
 * How long one hover may take before its target is skipped. The targets are already visible, so only a busy machine
 * gets near it; at 1 s a loaded test run skipped the whole press pass and the gate saw no press animation.
 */
const POINTER_TIMEOUT_MS = 5000;
const SCROLL_STEPS_MAX = 80;

// ---------------------------------------------------------------------------------------------------------------
// In-page code (self-contained; lib/dom.mjs's selectorFor is passed in as the first argument).
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{id: number, phase: string, type: string, name: string, sel: string | null, pseudo: string | null,
 *   properties: string[], frames: Array<Record<string, string>>, duration: number, delay: number,
 *   iterations: number | 'infinite', easing: string, role: Role, live: boolean, hero: boolean, fromHidden: boolean,
 *   manifest: number[], transitionAll: boolean}} AnimationRecord
 */

/**
 * Installed before any page script: records each animation once, when it starts (animationstart, transitionrun)
 * or on the next frame (Web Animations), tagged with the current phase and the role of its target.
 * @param {(el: Element, counts?: Map<string, number>) => string} sel
 * @param {{manifest: string[]}} opts
 */
export function installRecorder(sel, opts) {
  const manifest = Array.isArray(opts && opts.manifest) ? opts.manifest : [];
  const reserved = new Set(['offset', 'computedOffset', 'easing', 'composite']);
  /** @type {{phase: string, records: AnimationRecord[], seen: WeakSet<Animation>, counter: number, poll: () => void}} */
  const state = { phase: 'load', records: [], seen: new WeakSet(), counter: 0, poll: () => undefined };
  Object.defineProperty(window, '__feMotion', { value: state, configurable: true });
  /** @param {string} key */
  const kebab = (key) => (key.startsWith('--') ? key : key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));
  /** @param {Element} el @returns {Role} */
  const roleOf = (el) => {
    if (state.phase.startsWith('press')) return 'press';
    if (el.closest('[role="tooltip"]')) return 'tooltip';
    const dialog = el.closest('dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]');
    if (dialog) {
      const r = dialog.getBoundingClientRect();
      const edge = r.left <= 1 || r.right >= window.innerWidth - 1;
      return r.height >= window.innerHeight * 0.9 && edge && r.width < window.innerWidth * 0.95 ? 'drawer' : 'modal';
    }
    if (el.closest('[role="menu"], [role="listbox"], [role="menubar"], [popover], [data-radix-popper-content-wrapper]')) return 'dropdown';
    if (el.closest('[role="status"], [role="alert"], [aria-live], [data-sonner-toast], .toast')) return 'toast';
    if (state.phase.startsWith('hover')) return 'hover';
    return 'ui';
  };
  /** @param {Record<string, unknown>} frame */
  const hiddenFrame = (frame) => {
    const opacity = Number.parseFloat(String(frame.opacity ?? '1'));
    const transform = String(frame.transform ?? '');
    const clip = String(frame.clipPath ?? frame['clip-path'] ?? '');
    return (Number.isFinite(opacity) && opacity < 0.1) || /scale\(\s*0(?:\.0+)?\s*(?:,\s*0(?:\.0+)?\s*)?\)|matrix\(\s*0(?:\.0+)?\s*,\s*0\s*,\s*0\s*,\s*0(?:\.0+)?\s*,/.test(transform) || /inset\(\s*(?:100%|0(?:px)?\s+0(?:px)?\s+100%)/.test(clip);
  };
  /** @param {Animation} a @returns {AnimationRecord} */
  const describe = (a) => {
    const effect = a.effect;
    const timing = effect ? effect.getComputedTiming() : {};
    const kfe = effect instanceof KeyframeEffect ? effect : null;
    const target = kfe ? kfe.target : null;
    let type = 'web-animation';
    let name = a.id || '';
    if (typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation) {
      type = 'css-animation';
      name = a.animationName;
    } else if (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) {
      type = 'css-transition';
      name = a.transitionProperty;
    }
    const raw = kfe ? kfe.getKeyframes() : [];
    /** @type {Array<Record<string, string>>} */
    const frames = raw.slice(0, 8).map((f) => {
      /** @type {Record<string, string>} */
      const plain = {};
      for (const [k, v] of Object.entries(f)) if (!reserved.has(k)) plain[kebab(k)] = String(v).slice(0, 200);
      return plain;
    });
    const properties = new Set();
    for (const f of frames) for (const k of Object.keys(f)) properties.add(k);
    if (type === 'css-transition' && properties.size === 0 && name) properties.add(name);
    const declared = effect ? effect.getTiming() : {};
    let easing = typeof declared.easing === 'string' ? declared.easing : 'linear';
    if (type === 'css-animation' && easing === 'linear' && raw.length > 0 && typeof raw[0].easing === 'string') easing = raw[0].easing;
    const iterations = timing.iterations === Infinity ? 'infinite' : typeof timing.iterations === 'number' ? timing.iterations : 1;
    const cs = target ? getComputedStyle(target) : null;
    state.counter += 1;
    return {
      id: state.counter,
      phase: state.phase,
      type,
      name,
      sel: target ? sel(target) : null,
      pseudo: kfe ? kfe.pseudoElement : null,
      properties: [...properties],
      frames,
      duration: typeof timing.duration === 'number' ? timing.duration : Number(timing.duration) || 0,
      delay: typeof timing.delay === 'number' ? timing.delay : 0,
      iterations,
      easing,
      role: target ? roleOf(target) : 'ui',
      live: Boolean(target && target.closest('[data-live]')),
      hero: Boolean(target && (target.matches('[data-hero], [data-metric]') || target.querySelector('[data-hero], [data-metric]'))),
      fromHidden: raw.length > 0 && hiddenFrame(/** @type {Record<string, unknown>} */ (raw[0])),
      manifest: target ? manifest.map((selector, i) => {
        try {
          return target.matches(selector) || Boolean(target.closest(selector)) ? i : -1;
        } catch {
          return -1;
        }
      }).filter((i) => i >= 0) : [],
      transitionAll: Boolean(cs && /(?:^|,)\s*all\s*(?:,|$)/.test(cs.transitionProperty) && type === 'css-transition'),
    };
  };
  const poll = () => {
    /** @type {Animation[]} */
    let list = [];
    try {
      list = document.getAnimations();
    } catch {
      return;
    }
    for (const a of list) {
      if (state.seen.has(a)) continue;
      state.seen.add(a);
      try {
        state.records.push(describe(a));
      } catch {
        continue;
      }
    }
  };
  state.poll = poll;
  for (const type of ['animationstart', 'transitionrun', 'transitionstart']) document.addEventListener(type, poll, true);
  const loop = () => {
    poll();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/**
 * @typedef {{key: string, sel: string, text: string, hidden: string | null, opacity: number, firstViewport: boolean,
 *   hero: string | null, metric: boolean, live: boolean}} TextState
 */

/**
 * Visibility of every rendered text block now: hidden by display or visibility, zero size, effective opacity under
 * 0.1, a box outside the document, or a clip that removes it.
 * @param {(el: Element, counts?: Map<string, number>) => string} sel
 * @returns {TextState[]}
 */
export function textSnapshot(sel) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const docW = Math.max(document.documentElement.scrollWidth, vw);
  const docH = Math.max(document.documentElement.scrollHeight, vh);
  const counts = new Map();
  /** @param {Element} el */
  const clipped = (el) => {
    for (let e = /** @type {Element | null} */ (el); e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const clip = cs.clipPath || '';
      const m = /inset\(\s*([\d.]+)(%|px)?\s*([\d.]+)?(%|px)?\s*([\d.]+)?(%|px)?\s*([\d.]+)?(%|px)?/.exec(clip);
      if (m) {
        const r = e.getBoundingClientRect();
        /** @param {string | undefined} v @param {string | undefined} u @param {number} size */
        const px = (v, u, size) => (v === undefined ? NaN : u === '%' ? (Number(v) / 100) * size : Number(v));
        const top = px(m[1], m[2], r.height);
        const right = Number.isNaN(px(m[3], m[4], r.width)) ? top : px(m[3], m[4], r.width);
        const bottom = Number.isNaN(px(m[5], m[6], r.height)) ? top : px(m[5], m[6], r.height);
        const left = Number.isNaN(px(m[7], m[8], r.width)) ? right : px(m[7], m[8], r.width);
        if (top + bottom >= r.height - 0.5 || left + right >= r.width - 0.5) return true;
      }
      if (/rect\(\s*0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?\s*\)/.test(cs.clip || '')) return true;
    }
    return false;
  };
  /** @type {Map<Element, string[]>} */
  const owners = new Map();
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const value = n.nodeValue || '';
    if (!/\S/.test(value)) continue;
    const parent = n.parentElement;
    if (!parent || parent.closest('script, style, noscript, template, title, head')) continue;
    const list = owners.get(parent);
    if (list) list.push(value);
    else owners.set(parent, [value]);
  }
  /** @type {TextState[]} */
  const out = [];
  for (const [el, parts] of owners) {
    const text = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const r = el.getBoundingClientRect();
    let opacity = 1;
    for (let e = /** @type {Element | null} */ (el); e; e = e.parentElement) {
      const v = Number.parseFloat(getComputedStyle(e).opacity);
      opacity *= Number.isFinite(v) ? v : 1;
    }
    const cs = getComputedStyle(el);
    const displayed = typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })
      : cs.display !== 'none' && cs.visibility !== 'hidden';
    /** @type {string | null} */
    let hidden = null;
    if (!displayed) hidden = 'not displayed';
    else if (r.width < 1 || r.height < 1) hidden = 'zero size';
    else if (opacity < 0.1) hidden = `opacity ${Math.round(opacity * 1000) / 1000}`;
    else {
      const x = r.left + window.scrollX;
      const y = r.top + window.scrollY;
      if (x + r.width <= 0 || y + r.height <= 0 || x >= docW || y >= docH) hidden = 'off-screen';
      else if (clipped(el)) hidden = 'clipped';
    }
    const top = r.top + window.scrollY;
    out.push({
      key: text.slice(0, 120),
      sel: sel(el, counts),
      text: text.slice(0, 120),
      hidden,
      opacity: Math.round(opacity * 1000) / 1000,
      firstViewport: top < vh && top + r.height > 0 && r.left < vw && r.right > 0,
      hero: el.closest('[data-hero]')?.getAttribute('data-hero') ?? null,
      metric: Boolean(el.closest('[data-metric]')),
      live: Boolean(el.closest('[data-live], [aria-live]')),
    });
  }
  return out;
}

/**
 * Elements a pointer can hover or press, with stable selectors (at most `limit` of each).
 * @param {(el: Element, counts?: Map<string, number>) => string} sel
 * @param {{limit: number}} opts
 * @returns {{hover: string[], press: string[]}}
 */
export function interactiveTargets(sel, opts) {
  const counts = new Map();
  const limit = opts && opts.limit > 0 ? opts.limit : 40;
  /** @param {Element} el */
  const usable = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    return typeof el.checkVisibility === 'function' ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;
  };
  const hover = Array.from(document.querySelectorAll('a[href], button, [role="button"], [tabindex]:not([tabindex="-1"]), summary, input[type="button"], input[type="submit"], [data-tooltip], [aria-describedby], [title]'))
    .filter(usable).slice(0, limit).map((el) => sel(el, counts));
  const press = Array.from(document.querySelectorAll('button:not([disabled]), [role="button"]:not([aria-disabled="true"]), input[type="button"], input[type="submit"]'))
    .filter(usable).slice(0, Math.ceil(limit / 2)).map((el) => sel(el, counts));
  return { hover, press };
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
 * True when animating `property` between `values` moves something: anything but opacity, visibility and colours,
 * and shadows whose geometry stays put (WCAG 2.3.3's definition excludes colour and opacity, FD03-F15). A property
 * whose value never changes is not motion.
 * @param {string} property kebab-case
 * @param {string[]} values
 * @returns {boolean}
 */
export function isMotion(property, values) {
  const p = property.toLowerCase();
  if (values.length > 1 && values.every((v) => v === values[0])) return false;
  if (p === 'opacity' || p === 'visibility') return false;
  if (/(?:^|-)colou?r$/.test(p) || p === 'fill' || p === 'stroke' || p === 'fill-opacity' || p === 'stroke-opacity') return false;
  if (p === 'box-shadow' || p === 'text-shadow') {
    const geometry = values.map((v) => v
      .replace(/(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^)]*\)|#[0-9a-f]{3,8}\b|\bcurrentcolor\b/gi, '')
      .split(/\s+/)
      .filter((token) => token !== '' && !(/^[a-z]+,?$/i.test(token) && parseColor(token.replace(/,$/, '')) !== null))
      .join(' '));
    return !geometry.every((g) => g === geometry[0]);
  }
  if (p.startsWith('--')) return !(values.length > 0 && values.every((v) => parseColor(v.trim()) !== null));
  return true;
}

/**
 * Role budgets with explicit overrides from the motion tokens of `<design>/tokens.json`: a token whose name (or
 * `role` key) names a role and that carries `max_ms` or `budget: [min, max]` lowers that role's maximum; a larger
 * value is ignored, so no token widens a budget. Token durations themselves never change a budget; tokens.mjs checks
 * them.
 * @param {unknown} tokens
 * @returns {{budgets: Record<Role, number>, durations: number[], overrides: string[]}}
 */
export function resolveBudgets(tokens) {
  /** @type {Record<Role, number>} */
  const budgets = { ...ROLE_BUDGETS };
  /** @type {number[]} */
  const durations = [];
  /** @type {string[]} */
  const overrides = [];
  const list = tokens && typeof tokens === 'object' && /** @type {Record<string, any>} */ (tokens).motion && Array.isArray(/** @type {Record<string, any>} */ (tokens).motion.tokens)
    ? /** @type {Array<Record<string, unknown>>} */ (/** @type {Record<string, any>} */ (tokens).motion.tokens)
    : [];
  for (const token of list) {
    const name = String(token.name ?? '').toLowerCase();
    const value = typeof token.value === 'string' || typeof token.value === 'number' ? parseDuration(token.value) : null;
    if (value !== null) durations.push(value);
    const roleKey = typeof token.role === 'string' ? token.role.toLowerCase() : name;
    const role = /** @type {Role | undefined} */ (Object.hasOwn(ROLE_BUDGETS, roleKey) ? roleKey : ROLE_WORDS.find(([, re]) => re.test(roleKey))?.[0]);
    if (!role) continue;
    const budget = Array.isArray(token.budget) && typeof token.budget[1] === 'number' ? token.budget[1] : typeof token.max_ms === 'number' ? token.max_ms : null;
    // A token may tighten a role budget, never widen it past references/08-motion.md MO-05 (CONTRACTS 6.2 v1.1).
    if (budget !== null && Number.isFinite(budget) && budget > 0 && budget < budgets[role]) {
      budgets[role] = budget;
      overrides.push(`${role} <= ${budget} ms (token ${String(token.name)})`);
    }
  }
  return { budgets, durations, overrides };
}

/**
 * A CSS duration (`160ms`, `0.16s`, a bare number of ms) in ms, or null.
 * @param {string | number} value
 * @returns {number | null}
 */
export function parseDuration(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const m = /^\s*(-?[\d.]+)\s*(ms|s)?\s*$/i.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] && m[2].toLowerCase() === 's' ? n * 1000 : n;
}

/**
 * Notes that never fail the gate but point at the tells rules (SL-MO1, SL-MO2, SL-MO4): `transition: all`, an
 * ease-in curve on an entrance, an entrance from scale(0).
 * @param {AnimationRecord} r
 * @returns {string[]}
 */
export function motionNotes(r) {
  const notes = [];
  if (r.transitionAll) notes.push('transition: all (name the properties; SL-MO1)');
  const entrance = r.phase === 'load' || r.phase === 'scroll';
  const bezier = /cubic-bezier\(\s*([\d.]+)\s*,\s*([\d.-]+)\s*,\s*([\d.]+)\s*,\s*([\d.-]+)\s*\)/.exec(r.easing);
  const easeIn = r.easing === 'ease-in' || (bezier !== null && Number(bezier[1]) >= 0.3 && Number(bezier[2]) <= 0.1 && Number(bezier[3]) >= 0.9 && Number(bezier[4]) >= 0.95);
  if (entrance && easeIn) notes.push(`ease-in on an entrance (${r.easing}; SL-MO2)`);
  const first = r.frames[0]?.transform ?? '';
  if (/scale\(\s*0(?:\.0+)?\s*(?:,\s*0(?:\.0+)?\s*)?\)|matrix\(\s*0(?:\.0+)?\s*,\s*0\s*,\s*0\s*,\s*0(?:\.0+)?\s*,/.test(first)) notes.push('enters from scale(0) (start at 0.9 or more; SL-MO4)');
  return notes;
}

/**
 * Text blocks that became visible only after the scroll-through: present but hidden before it, or absent before it
 * (mounted on scroll), counted per text so selector shifts cannot fake a change. Live regions and number-only
 * strings (tickers) are left out.
 * @param {TextState[]} before
 * @param {TextState[]} after
 * @returns {Array<{after: TextState, before: TextState | null}>}
 */
export function revealedByScroll(before, after) {
  /** @type {Map<string, {visible: number, hidden: TextState[]}>} */
  const prior = new Map();
  for (const t of before) {
    const e = prior.get(t.key) ?? { visible: 0, hidden: [] };
    if (t.hidden) e.hidden.push(t);
    else e.visible += 1;
    prior.set(t.key, e);
  }
  /** @type {Map<string, number>} */
  const used = new Map();
  /** @type {Array<{after: TextState, before: TextState | null}>} */
  const out = [];
  for (const t of after) {
    if (t.hidden || t.live || /^[\d\s.,:%+\-–—$€£¥₿#/()]+$/u.test(t.text)) continue;
    const e = prior.get(t.key);
    const n = (used.get(t.key) ?? 0) + 1;
    used.set(t.key, n);
    if (!e) {
      out.push({ after: t, before: null });
      continue;
    }
    if (n > e.visible) out.push({ after: t, before: e.hidden[n - e.visible - 1] ?? null });
  }
  return out;
}

/**
 * Text visible at the end of the no-preference pass but not at the end of the reduce pass.
 * @param {TextState[]} normal
 * @param {TextState[]} reduced
 * @returns {TextState[]}
 */
export function missingUnderReduce(normal, reduced) {
  /** @type {Map<string, number>} */
  const visibleReduced = new Map();
  for (const t of reduced) if (!t.hidden) visibleReduced.set(t.key, (visibleReduced.get(t.key) ?? 0) + 1);
  /** @type {Map<string, number>} */
  const seen = new Map();
  const out = [];
  for (const t of normal) {
    if (t.hidden || t.live) continue;
    const n = (seen.get(t.key) ?? 0) + 1;
    seen.set(t.key, n);
    if (n > (visibleReduced.get(t.key) ?? 0)) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Page passes.
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{route: string, viewport: string, mode: 'no-preference' | 'reduce', before: TextState[],
 *   after: TextState[], records: AnimationRecord[], unsettled?: string[]}} Pass
 *   `unsettled`: the phases ('load', 'scroll') whose settle timed out, so their text states may be mid-animation.
 */

/**
 * Waits until no finite animation runs, at most SETTLE_MS. Returns false when the wait timed out: the page was then
 * read while something still moved, and the caller records it instead of judging that state as final.
 * @param {Page} page
 * @returns {Promise<boolean>}
 */
async function settle(page) {
  const settled = await page.waitForFunction(
    () => !document.getAnimations().some((a) => a.playState === 'running' && a.effect !== null && a.effect.getComputedTiming().iterations !== Infinity),
    undefined,
    { timeout: SETTLE_MS, polling: 50 },
  ).then(() => true, (err) => {
    if (err instanceof Error && err.name === 'TimeoutError') return false;
    throw err;
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))));
  return settled;
}

/**
 * @param {Page} page
 * @param {string} phase
 */
async function setPhase(page, phase) {
  await page.evaluate((p) => {
    const s = /** @type {{phase: string, poll: () => void} | undefined} */ (Reflect.get(window, '__feMotion'));
    if (s) {
      s.poll();
      s.phase = p;
    }
  }, phase);
}

/**
 * Scrolls to the bottom in steps of 80% of the viewport (observers fire on the way), settles, returns to the top.
 * @param {Page} page
 * @param {number} viewportHeight
 * @returns {Promise<boolean>} false when an animation was still running at either settle
 */
async function scrollThrough(page, viewportHeight) {
  const step = Math.max(100, Math.floor(viewportHeight * 0.8));
  for (let i = 0, y = 0; i < SCROLL_STEPS_MAX; i += 1, y += step) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (y > height) break;
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(150);
  const bottom = await settle(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(100);
  const top = await settle(page);
  return bottom && top;
}

/**
 * @param {CheckContext} ctx
 * @param {Route} route
 * @param {Viewport} viewport
 * @param {'no-preference' | 'reduce'} mode
 * @param {string[]} manifestSelectors
 * @returns {Promise<Pass>}
 */
async function runPass(ctx, route, viewport, mode, manifestSelectors) {
  const browser = /** @type {Browser} */ (ctx.browser);
  const base = new URL(/** @type {string} */ (ctx.baseUrl));
  const url = routeUrl(base.href, route, ctx.profile);
  ctx.log?.(`${TOOL}: ${route.path} at ${viewport.name}, ${mode}`);
  const context = await newContext(browser, { ...viewport, reducedMotion: mode }, { network: ctx.args?.network === true });
  try {
    const page = await context.newPage();
    if (ctx.args?.network !== true) {
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
    await page.addInitScript({ content: `(${installRecorder.toString()})(${selectorFor.toString()}, ${JSON.stringify({ manifest: manifestSelectors })});` });
    await goto(page, url);
    await waitReady(page, { readyFlag: ctx.profile?.ready_flag === true });
    /** @type {string[]} */
    const unsettled = [];
    if (!await settle(page)) unsettled.push('load');
    const before = await evaluateWithSelector(page, textSnapshot);
    await setPhase(page, 'scroll');
    if (!await scrollThrough(page, viewport.height)) unsettled.push('scroll');
    const after = await evaluateWithSelector(page, textSnapshot);
    if (!viewport.hasTouch) {
      const targets = await evaluateWithSelector(page, interactiveTargets, { limit: HOVER_LIMIT });
      await setPhase(page, 'hover');
      for (const target of targets.hover) {
        try {
          await page.locator(target).first().hover({ force: true, timeout: POINTER_TIMEOUT_MS });
          await page.waitForTimeout(60);
        } catch {
          continue;
        }
      }
      await page.mouse.move(0, 0);
      await settle(page);
      await setPhase(page, 'press');
      for (const target of targets.press.slice(0, PRESS_LIMIT)) {
        try {
          await page.locator(target).first().hover({ force: true, timeout: POINTER_TIMEOUT_MS });
          await page.mouse.down();
          await page.waitForTimeout(60);
          await page.mouse.move(0, 0);
          await page.mouse.up();
          await page.waitForTimeout(30);
        } catch {
          await page.mouse.up().catch(() => undefined);
          continue;
        }
      }
    }
    await setPhase(page, 'done');
    const records = await page.evaluate(() => {
      const s = /** @type {{records: unknown[], poll: () => void} | undefined} */ (Reflect.get(window, '__feMotion'));
      if (!s) return [];
      s.poll();
      return s.records;
    });
    return { route: route.path, viewport: viewport.name, mode, before, after, records: /** @type {AnimationRecord[]} */ (records), unsettled };
  } finally {
    await context.close();
  }
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
    if (id === 'motion') all.forEach((g) => want.add(g));
    else if (all.includes(id)) want.add(id);
    else throw new UsageError(`unknown gate "${id}" for ${TOOL}; known: motion, ${all.join(', ')}`);
  }
  return all.filter((g) => want.has(g));
}

/**
 * @typedef {{selector: string, trigger: string | null, purpose: string | null, role: Role | null}} ManifestEntry
 */

/**
 * The optional motion manifest `<design>/motion.json` (references/08-motion.md MO-03): an array, or
 * `{animations: [...]}`, of `{selector, trigger, purpose, ...}`. A purpose of `explanation` exempts the animation
 * from the duration budget (FD03-F07); `trigger` press, hover or focus sets the role.
 * @param {string} design
 * @returns {{entries: ManifestEntry[], file: string | null, problem: string | null}}
 */
export function readManifest(design) {
  const file = path.join(design, 'motion.json');
  if (!existsSync(file)) return { entries: [], file: null, problem: null };
  const where = toPosix(file);
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readText(file));
  } catch (err) {
    return { entries: [], file: where, problem: `${where} is not valid JSON (${err instanceof Error ? err.message : String(err)})` };
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray(/** @type {Record<string, unknown>} */ (raw).animations) ? /** @type {unknown[]} */ (/** @type {Record<string, unknown>} */ (raw).animations) : null;
  if (!list) return { entries: [], file: where, problem: `${where} must be an array or {"animations": [...]}` };
  /** @type {ManifestEntry[]} */
  const entries = [];
  for (const [i, item] of list.entries()) {
    if (!item || typeof item !== 'object' || typeof item.selector !== 'string' || item.selector.trim() === '') {
      return { entries: [], file: where, problem: `${where} entry ${i} needs a selector` };
    }
    const trigger = typeof item.trigger === 'string' ? item.trigger.toLowerCase() : null;
    /** @type {Role | null} */
    let role = typeof item.role === 'string' && Object.hasOwn(ROLE_BUDGETS, item.role) ? /** @type {Role} */ (item.role) : null;
    if (!role && trigger === 'press') role = 'press';
    if (!role && (trigger === 'hover' || trigger === 'focus')) role = 'hover';
    entries.push({ selector: item.selector, trigger, purpose: typeof item.purpose === 'string' ? item.purpose.toLowerCase() : null, role });
  }
  return { entries, file: where, problem: null };
}

/**
 * Runs the selected motion gates (CONTRACTS section 4).
 * @param {CheckContext} ctx
 * @param {readonly string[]} [selected]
 * @returns {Promise<GateResult[]>}
 */
export async function run(ctx, selected) {
  const want = selectGates(selected);
  if (!ctx.browser || !ctx.baseUrl) {
    const why = !ctx.baseUrl ? 'no rendered pages: pass --serve <built dir> or --url <running app>' : 'no browser in the check context';
    return want.map((id) => builder(id).skip(why));
  }
  const design = path.resolve(ctx.design ?? designDir(ctx.root, ctx.profile));
  const manifest = readManifest(design);
  const tokensFile = path.join(design, 'tokens.json');
  /** @type {unknown} */
  let tokens = null;
  if (existsSync(tokensFile)) {
    try {
      tokens = JSON.parse(readText(tokensFile));
    } catch (err) {
      tokens = null;
      ctx.log?.(`${TOOL}: ${toPosix(tokensFile)} is not valid JSON; research budgets used (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  /** @type {Pass[]} */
  const passes = [];
  let failure = '';
  const modes = /** @type {Array<'no-preference' | 'reduce'>} */ (want.some((id) => id !== 'motion.inventory') ? ['no-preference', 'reduce'] : ['no-preference']);
  try {
    for (const route of ctx.routes) {
      for (const viewport of ctx.viewports) {
        for (const mode of modes) passes.push(await runPass(ctx, route, viewport, mode, manifest.entries.map((e) => e.selector)));
      }
    }
  } catch (err) {
    if (err instanceof EnvError || err instanceof UsageError) throw err;
    failure = err instanceof Error ? err.message : String(err);
  }
  return want.map((id) => {
    if (failure) return builder(id).fail(`a page could not be checked: ${failure}`);
    if (id === 'motion.reduced') return reducedGate(passes);
    if (id === 'motion.hidden-at-rest') return hiddenGate(passes);
    return inventoryGate(passes, manifest, resolveBudgets(tokens));
  });
}

/**
 * @param {Pass[]} passes
 * @returns {GateResult}
 */
export function reducedGate(passes) {
  const g = builder('motion.reduced');
  /** @type {Evidence[]} */
  const moving = [];
  /** @type {Evidence[]} */
  const missing = [];
  /** @type {Evidence[]} */
  const doubtful = [];
  let checked = 0;
  const seen = new Set();
  for (const pass of passes.filter((p) => p.mode === 'reduce')) {
    for (const r of pass.records) {
      if (r.duration * (r.iterations === 'infinite' ? 1 : Math.max(1, r.iterations)) < INSTANT_MS) continue;
      checked += 1;
      const motion = r.properties.filter((p) => isMotion(p, r.frames.map((f) => f[p] ?? '')));
      if (motion.length === 0) continue;
      const key = `${pass.route}|${pass.viewport}|${r.sel}|${motion.join(',')}|${r.phase}`;
      if (seen.has(key)) continue;
      seen.add(key);
      moving.push({ route: pass.route, viewport: pass.viewport, selector: r.sel ?? '', value: `${motion.join(', ')} ${Math.round(r.duration)} ms`, detail: `${r.type} "${r.name}" during ${r.phase} still animates ${motion.join(', ')} under reduce; keep only opacity and colour` });
    }
    const normal = passes.find((p) => p.mode === 'no-preference' && p.route === pass.route && p.viewport === pass.viewport);
    if (normal) {
      const moved = [...(normal.unsettled ?? []), ...(pass.unsettled ?? [])].includes('scroll');
      for (const t of missingUnderReduce(normal.after, pass.after)) {
        const entry = { route: pass.route, viewport: pass.viewport, selector: t.sel, value: t.text, detail: 'visible without the preference, missing under reduce' };
        if (moved) doubtful.push(entry);
        else missing.push(entry);
      }
    }
  }
  if (moving.length + missing.length === 0 && doubtful.length > 0) {
    const where = [...new Set(doubtful.map((e) => `${e.route} ${e.viewport}`))].join(', ');
    return g.skip(`${doubtful.length} text block(s) look missing under reduce, but an animation was still running ${SETTLE_MS} ms after the scroll-through (${where}), so the page was read mid-animation; rerun on an idle machine, or shorten the animation`);
  }
  if (moving.length + missing.length > 0) {
    return g.fail(`${moving.length} animation(s) still move and ${missing.length} text block(s) go missing under reduced motion`, [...moving, ...missing]);
  }
  return g.ok(`${checked} animation(s) under reduce, all opacity or colour; no text lost across ${passes.filter((p) => p.mode === 'reduce').length} reduced-motion pass(es)`);
}

/**
 * @param {Pass[]} passes
 * @returns {GateResult}
 */
function hiddenGate(passes) {
  const g = builder('motion.hidden-at-rest');
  /** @type {Evidence[]} */
  const found = [];
  for (const pass of passes) {
    const where = { route: pass.route, viewport: `${pass.viewport} (${pass.mode})` };
    for (const { after, before } of revealedByScroll(pass.before, pass.after)) {
      found.push({ ...where, selector: after.sel, value: after.text, detail: before ? `hidden at rest (${before.hidden}) until scrolled into view` : 'appears only after scrolling (mounted on scroll)' });
    }
    for (const t of pass.before) {
      if (!t.hidden) continue;
      const hero = t.hero === 'h1' || t.hero === 'sentence';
      if (hero || (t.metric && t.firstViewport)) {
        found.push({ ...where, selector: t.sel, value: t.text, detail: `${hero ? `the hero ${t.hero}` : 'a first-viewport figure'} is not visible at load (${t.hidden})` });
      }
    }
    for (const r of pass.records) {
      if (r.phase !== 'load' || !r.hero || !r.fromHidden || r.duration < INSTANT_MS) continue;
      found.push({ ...where, selector: r.sel ?? '', value: `${r.name} ${Math.round(r.duration)} ms`, detail: 'the hero or a figure enters from invisible at load; start from a visible resting state' });
    }
  }
  const unique = found.filter((e, i) => found.findIndex((o) => o.selector === e.selector && o.route === e.route && o.viewport === e.viewport && o.detail === e.detail) === i);
  if (unique.length > 0) return g.fail(`${unique.length} text block(s) hidden until scrolled, or a hero element not visible at load`, unique);
  return g.ok(`reveal probe before and after a scroll-through: nothing hidden at rest on ${passes.length} pass(es); hero and first figures visible at load`);
}

/**
 * @param {Pass[]} passes
 * @param {{entries: ManifestEntry[], file: string | null, problem: string | null}} manifest
 * @param {{budgets: Record<Role, number>, durations: number[], overrides: string[]}} budgets
 * @returns {GateResult}
 */
function inventoryGate(passes, manifest, budgets) {
  const g = builder('motion.inventory');
  if (manifest.problem) return g.fail(`${manifest.problem}; fix the motion manifest`);
  /** @type {Evidence[]} */
  const failures = [];
  /** @type {Evidence[]} */
  const notes = [];
  /** @type {Record<string, number>} */
  const byPhase = {};
  const seen = new Set();
  for (const pass of passes.filter((p) => p.mode === 'no-preference')) {
    for (const r of pass.records) {
      if (r.iterations !== 'infinite' && r.duration < INSTANT_MS) continue;
      const key = `${pass.route}|${r.sel}|${r.name}|${r.phase}|${Math.round(r.duration)}|${r.iterations}`;
      if (seen.has(key)) continue;
      seen.add(key);
      byPhase[r.phase] = (byPhase[r.phase] ?? 0) + 1;
      const where = { route: pass.route, viewport: pass.viewport, selector: r.sel ?? '' };
      const entries = r.manifest.map((i) => manifest.entries[i]).filter(Boolean);
      const explanation = entries.some((e) => e.purpose === 'explanation');
      const role = entries.find((e) => e.role)?.role ?? r.role;
      if (r.iterations === 'infinite') {
        if (r.live) notes.push({ ...where, value: `${r.name || r.type} ${Math.round(r.duration)} ms, infinite`, detail: 'live-state loop on a data-live element (its cycle is not a UI duration)' });
        else failures.push({ ...where, value: `${r.name || r.type} ${Math.round(r.duration)} ms, infinite`, detail: 'an endless animation on an element not marked data-live: loop only what shows live state' });
        continue;
      }
      const budget = budgets.budgets[role];
      if (!explanation && r.duration > budget + 0.5) {
        failures.push({ ...where, value: `${Math.round(r.duration)} ms`, detail: `${r.type} "${r.name}" (${role}, during ${r.phase}) exceeds the ${role} budget of ${budget} ms` });
      }
      for (const note of motionNotes(r)) notes.push({ ...where, value: r.name, detail: note });
      if (budgets.durations.length > 0 && !budgets.durations.some((d) => Math.abs(d - r.duration) <= Math.max(5, d * 0.05))) {
        notes.push({ ...where, value: `${Math.round(r.duration)} ms`, detail: 'duration is not one of the motion tokens' });
      }
    }
  }
  const counts = Object.entries(byPhase).map(([phase, n]) => `${n} ${phase}`).join(', ') || 'none';
  const scope = `${budgets.overrides.length ? `token budgets: ${budgets.overrides.join('; ')}; ` : ''}${manifest.file ? `manifest ${manifest.file}; ` : ''}`;
  if (failures.length > 0) return g.fail(`${failures.length} animation(s) over budget or looping without data-live (${scope}animations: ${counts})`, [...failures, ...notes]);
  return g.ok(`every animation within its role budget, no loop outside data-live (${scope}animations: ${counts})`, notes);
}

// ---------------------------------------------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------------------------------------------

const HELP = `motion-check: reduced motion, content hidden at rest, and the animation inventory.

Usage:
  node motion-check.mjs [--root <repo>] [--profile <abs path>] [--state <dir>] (--serve <dir> | --url <url>)
                        [--gates motion|motion.reduced,...] [--json] [--out <dir>] [--allow-skip <id>] [--network]

Gates: ${GATES.map((g) => g.id).join(', ')}.
Each route and viewport loads twice (reduced motion off, then on); a recorder lists every CSS animation, CSS
transition and Web Animation during load, a scroll-through, a hover pass and a press pass. Role budgets (ms):
${Object.entries(ROLE_BUDGETS).map(([k, v]) => `${k} ${v}`).join(', ')}; motion tokens may lower a role budget with max_ms (never raise it);
design/motion.json entries with purpose "explanation" are exempt from the budget. Infinite animations need data-live.

Flags:
  --root <repo>          product repository (default: the working directory)
  --profile <abs path>   /execution profile.json or a frontend block file
  --state <dir>          state folder override
  --serve <dir>          serve a static build and check it
  --url <url>            check a running app
  --gates <list>         comma-separated gate ids or the group name motion (default: all)
  --json                 print the gate report as JSON on stdout
  --out <dir>            also write <dir>/motion-check.json
  --allow-skip <id>      let a skipped gate pass the overall verdict (never in a task proof)
  --network              let pages reach hosts other than the app

Exit codes: 0 every requested gate ok; 1 a gate failed or was skipped; 2 usage error; 3 environment error.
`;

const OPTIONS = /** @type {const} */ ({
  root: { type: 'string' },
  profile: { type: 'string' },
  state: { type: 'string' },
  serve: { type: 'string' },
  url: { type: 'string' },
  gates: { type: 'string' },
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
    if (baseUrl) browser = await launch();
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
      target: { root: toPosix(root), url: baseUrl, routes: ctx.routes.length, viewports: ctx.viewports.map((v) => v.name) },
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
