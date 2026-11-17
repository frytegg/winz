// @ts-check
import { parseColor } from '../../lib/color.mjs';
import { laidOut } from './SL-T01.mjs';

/*
 * SL-T14 runtime: calls to action whose hover changes nothing but opacity or alpha (FD10 T14, R14; FD10-F08: the
 * component kit's hover:bg-primary/90). Each CTA is hovered on a fresh page, its computed style compared before and
 * after the transition, and the CSS rules behind the hover read back to say whether they sit in @media (hover: hover).
 */

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {import('playwright-core').Page} Page
 * @typedef {{prop: string, kind: 'fade' | 'alpha' | 'same' | 'colour' | 'other', from: string, to: string}} StyleChange
 * @typedef {{box: {x: number, y: number, w: number, h: number}, styles: Record<string, string>, hovered: boolean,
 *   looping: string[]} | null} HoverState
 */

const RULE = 'SL-T14';

/** CTAs hovered per page (first viewport first, one per distinct style). */
export const MAX_CTAS = 16;
/** A CTA a reader sees as a button: a fill of 10% alpha or more, a background image, or a visible border. */
export const FILL_ALPHA_MIN = 0.1;
export const MIN_SIZE = Object.freeze({ w: 24, h: 16 });
/** Same colour: channels within 3/255; an alpha step of 0.02 or more is a change. */
export const RGB_TOLERANCE = 0.012;
export const ALPHA_STEP = 0.02;
/** Transitions get this long to finish after the pointer arrives. */
export const SETTLE_TIMEOUT_MS = 1200;
export const MAX_FINDINGS = 16;
/** Hovering stops after this long, so the detector stays inside the runner's 30 s budget on pages with slow transitions. */
export const BUDGET_MS = 20000;

const COLOR_PROPS = new Set(['background-color', 'color', 'border-top-color', 'border-right-color', 'border-bottom-color',
  'border-left-color', 'outline-color', 'text-decoration-color', '::before background-color', '::after background-color']);
const OPACITY_PROPS = new Set(['opacity', '::before opacity', '::after opacity']);
/** Computed properties compared before and after the hover. */
export const WATCHED = Object.freeze(['opacity', 'background-color', 'background-image', 'color', 'border-top-color',
  'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'outline-width', 'outline-style',
  'box-shadow', 'transform', 'scale', 'translate', 'rotate', 'filter', 'backdrop-filter', 'text-decoration-line',
  'text-decoration-color', 'letter-spacing', 'font-weight', 'width', 'height']);
export const WATCHED_PSEUDO = Object.freeze(['opacity', 'background-color', 'background-image', 'transform']);

/**
 * @param {ElementInfo} e
 * @returns {boolean}
 */
function buttonLike(e) {
  const fill = parseColor(e.styles.backgroundColor);
  if ((fill !== null && fill.a >= FILL_ALPHA_MIN) || (e.styles.backgroundImage ?? 'none') !== 'none') return true;
  const sides = /** @type {const} */ (['Top', 'Right', 'Bottom', 'Left']);
  return sides.every((s) => (Number.parseFloat(e.styles[`border${s}Width`]) || 0) >= 1 && (parseColor(e.styles[`border${s}Color`])?.a ?? 0) >= 0.3);
}

/**
 * The CTAs worth hovering: laid-out buttons and button-like links with a fill or border (ghost buttons are a
 * documented legitimate use), one per distinct style, first viewport first.
 * @param {ElementInfo[]} elements
 * @param {number} viewportHeight
 * @returns {ElementInfo[]}
 */
export function ctaCandidates(elements, viewportHeight) {
  const seen = new Set();
  /** @type {ElementInfo[]} */
  const out = [];
  for (const e of elements) {
    if (!laidOut(e) || e.box.w < MIN_SIZE.w || e.box.h < MIN_SIZE.h) continue;
    const kind = e.tag === 'button' || e.role === 'button' || (e.tag === 'input' && ['submit', 'button'].includes(e.meta.type ?? '')) ? 'button' : e.role === 'link' ? 'link' : null;
    if (!kind || !buttonLike(e)) continue;
    const signature = [e.tag, e.meta.class ?? '', e.styles.backgroundColor, e.styles.color, e.styles.borderRadius, e.styles.opacity].join('|');
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push(e);
  }
  return out.sort((a, b) => Number(a.box.y >= viewportHeight) - Number(b.box.y >= viewportHeight)).slice(0, MAX_CTAS);
}

/**
 * Classifies one property change: an opacity step ('fade'), an alpha step of an unchanged colour ('alpha'), a
 * difference no reader sees ('same': one colour written two ways, or two fully transparent colours), a colour
 * change, or any other change (shadow, transform, filter, decoration, size).
 * @param {string} prop
 * @param {string} from
 * @param {string} to
 * @returns {StyleChange['kind']}
 */
export function changeKind(prop, from, to) {
  if (OPACITY_PROPS.has(prop)) {
    const step = Math.abs(Number.parseFloat(from) - Number.parseFloat(to));
    return Number.isFinite(step) && step < ALPHA_STEP ? 'same' : 'fade';
  }
  if (!COLOR_PROPS.has(prop)) return 'other';
  const a = parseColor(from);
  const b = parseColor(to);
  if (!a || !b) return 'colour';
  if (a.a === 0 && b.a === 0) return 'same';
  const sameChannels = Math.abs(a.r - b.r) <= RGB_TOLERANCE && Math.abs(a.g - b.g) <= RGB_TOLERANCE && Math.abs(a.b - b.b) <= RGB_TOLERANCE;
  if (!sameChannels) return 'colour';
  return Math.abs(a.a - b.a) >= ALPHA_STEP ? 'alpha' : 'same';
}

/**
 * Whether a hover only fades: at least one opacity or alpha step, and nothing else a reader sees.
 * @param {StyleChange[]} changes
 * @returns {boolean}
 */
export function onlyFades(changes) {
  const seen = changes.filter((c) => c.kind !== 'same');
  return seen.length > 0 && seen.every((c) => c.kind === 'fade' || c.kind === 'alpha');
}

/**
 * The property changes between two style snapshots.
 * @param {Record<string, string>} before
 * @param {Record<string, string>} after
 * @returns {StyleChange[]}
 */
export function styleChanges(before, after) {
  /** @type {StyleChange[]} */
  const out = [];
  for (const prop of Object.keys(before)) {
    if (before[prop] === after[prop]) continue;
    out.push({ prop, kind: changeKind(prop, before[prop], after[prop] ?? ''), from: before[prop], to: after[prop] ?? '' });
  }
  return out;
}

/**
 * In-page: the CTA's watched styles (and its pseudo-elements'), once every finite transition or animation on it has
 * finished, whether it is hovered, its box in the viewport, and the properties an endless animation keeps changing
 * on it (a pulse or shimmer, which hover does not cause). `scroll` brings it to the centre first.
 * @param {{sel: string, watched: string[], pseudo: string[], scroll: boolean, timeout: number}} arg
 * @returns {Promise<HoverState>}
 */
async function readCta(arg) {
  const el = document.querySelector(arg.sel);
  if (!el) return null;
  if (arg.scroll) el.scrollIntoView({ block: 'center', inline: 'center' });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))));
  const animations = el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running');
  const finite = (/** @type {Animation} */ a) => Number.isFinite(Number(a.effect ? a.effect.getComputedTiming().endTime : Infinity));
  /** @type {string[]} */
  const looping = [];
  for (const a of animations) {
    const effect = a.effect;
    if (finite(a) || !(effect instanceof KeyframeEffect) || effect.target !== el) continue;
    const prefix = effect.pseudoElement ? `${effect.pseudoElement} ` : '';
    for (const frame of effect.getKeyframes()) {
      for (const key of Object.keys(frame)) {
        if (['offset', 'computedOffset', 'easing', 'composite'].includes(key)) continue;
        looping.push(prefix + key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));
      }
    }
  }
  const ending = animations.filter(finite);
  if (ending.length > 0) {
    // A cancelled transition rejects `finished`; for this wait it has ended all the same.
    const ended = Promise.all(ending.map((a) => a.finished.then(() => undefined, () => undefined)));
    await Promise.race([ended, new Promise((resolve) => setTimeout(resolve, arg.timeout))]);
  }
  const cs = getComputedStyle(el);
  /** @type {Record<string, string>} */
  const styles = {};
  for (const p of arg.watched) styles[p] = cs.getPropertyValue(p);
  for (const which of ['::before', '::after']) {
    const ps = getComputedStyle(el, which);
    if (!ps.content || ps.content === 'none' || ps.content === 'normal') continue;
    for (const p of arg.pseudo) styles[`${which} ${p}`] = ps.getPropertyValue(p);
  }
  const r = el.getBoundingClientRect();
  return { box: { x: r.left, y: r.top, w: r.width, h: r.height }, styles, hovered: el.matches(':hover'), looping };
}

/**
 * In-page: whether the CSS rules that give the CTA its hover style all sit inside @media (hover: hover) or
 * (any-hover: hover). 'unknown' when no readable rule matches (a script hover, or a cross-origin sheet).
 * @param {string} sel
 * @returns {boolean | 'unknown'}
 */
function hoverGating(sel) {
  const el = document.querySelector(sel);
  if (!el) return 'unknown';
  const gate = /\(\s*(?:any-)?hover\s*:\s*hover\s*\)/;
  /** @type {boolean[]} */
  const matched = [];
  /** @param {string} selector @returns {string[]} */
  const parts = (selector) => {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < selector.length; i += 1) {
      const c = selector[i];
      if (c === '(' || c === '[') depth += 1;
      else if (c === ')' || c === ']') depth -= 1;
      else if (c === ',' && depth === 0) {
        out.push(selector.slice(start, i).trim());
        start = i + 1;
      }
    }
    out.push(selector.slice(start).trim());
    return out;
  };
  /** @param {CSSRuleList} list @param {string[]} media @param {string | null} parent */
  const walk = (list, media, parent) => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSStyleRule) {
        const text = parent ? rule.selectorText.replace(/&/g, `:is(${parent})`) : rule.selectorText;
        for (const part of parts(text)) {
          if (!part.includes(':hover')) continue;
          let hit = false;
          try {
            hit = el.matches(part.replace(/:hover/g, ''));
          } catch {
            hit = false;
          }
          if (hit) matched.push(media.some((m) => gate.test(m)));
        }
        if (rule.cssRules && rule.cssRules.length > 0) walk(rule.cssRules, media, text);
      } else if (rule instanceof CSSMediaRule) {
        walk(rule.cssRules, [...media, rule.conditionText || rule.media.mediaText], parent);
      } else if (rule instanceof CSSGroupingRule) {
        walk(rule.cssRules, media, parent);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    /** @type {CSSRuleList | null} */
    let rules = null;
    try {
      rules = sheet.cssRules;
    } catch {
      rules = null;
    }
    if (rules) walk(rules, [], null);
  }
  if (matched.length === 0) return 'unknown';
  return matched.every(Boolean);
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
 * Hovers each CTA on a fresh page and reports those whose hover only fades: every change is an opacity step or an
 * alpha step of an unchanged colour (properties an endless animation moves are left out). Skipped where the device
 * has no hover-capable pointer; hovering stops after BUDGET_MS, and each finding says how many CTAs were hovered. A
 * hover pass cut short with nothing found throws (a detector error), never an empty, clean result.
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const canHover = await ctx.page.evaluate(() => matchMedia('(any-hover: hover)').matches);
  if (!canHover) return [];
  const ctas = ctaCandidates(await ctx.cache.elements(), ctx.viewport.height);
  if (ctas.length === 0) return [];
  const page = await ctx.freshPage();
  const away = { x: ctx.viewport.width - 2, y: ctx.viewport.height - 2 };
  const arg = { watched: [...WATCHED], pseudo: [...WATCHED_PSEUDO], timeout: SETTLE_TIMEOUT_MS };
  const started = Date.now();
  let checked = 0;
  /** @type {Array<{cta: ElementInfo, changes: StyleChange[], gated: boolean | 'unknown'}>} */
  const hits = [];
  let stopped = false;
  for (const cta of ctas) {
    if (Date.now() - started > BUDGET_MS) {
      stopped = true;
      break;
    }
    checked += 1;
    await page.mouse.move(away.x, away.y);
    const before = await page.evaluate(readCta, { ...arg, sel: cta.sel, scroll: true });
    if (!before || before.hovered || before.box.w < 1 || before.box.h < 1) continue;
    await page.mouse.move(before.box.x + before.box.w / 2, before.box.y + before.box.h / 2, { steps: 2 });
    const after = await page.evaluate(readCta, { ...arg, sel: cta.sel, scroll: false });
    if (!after || !after.hovered) continue;
    const looping = new Set([...before.looping, ...after.looping]);
    const changes = styleChanges(before.styles, after.styles).filter((c) => c.kind !== 'same' && !looping.has(c.prop));
    if (!onlyFades(changes)) continue;
    hits.push({ cta, changes, gated: await page.evaluate(hoverGating, cta.sel) });
    if (hits.length >= MAX_FINDINGS) break;
  }
  if (hits.length === 0 && stopped) {
    throw new Error(`hovering stopped at the ${BUDGET_MS} ms budget after ${checked} of ${ctas.length} CTAs with nothing found yet, so the page cannot be called clean; rerun on an idle machine or narrow the routes`);
  }
  return hits.map(({ cta, changes, gated }) => finding(ctx, cta.sel, {
    text: cta.text.slice(0, 60), changes: changes.map(({ prop, from, to }) => ({ prop, from, to })), gated,
    transition: cta.styles.transitionProperty, duration: cta.styles.transitionDuration, hovered: { checked, of: ctas.length },
  }, `hover on "${cta.text.slice(0, 40)}" only fades (${changes.map((c) => `${c.prop} ${c.from} -> ${c.to}`).join('; ')})${gated === false ? '; hover not gated by @media (hover: hover)' : ''}`));
}
