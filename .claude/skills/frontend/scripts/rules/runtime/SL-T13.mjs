// @ts-check
import { selectorFor } from '../../lib/dom.mjs';

/*
 * SL-T13 runtime: effects coupled to the pointer's coordinates (FD10 T13, R13; FD10-F25). Listener presence alone
 * proves nothing (React 17+ attaches every event to the root), so the listeners only decide whether to look; the
 * evidence is behavioural: on a fresh page the mouse visits a grid of points, and at each one moves by a few pixels
 * without leaving the element under it. A computed background, mask, transform, position or inline custom property
 * that changes with that nudge follows the pointer; a :hover style cannot, since the hovered element did not change.
 */

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('playwright-core').Page} Page
 * @typedef {{window: number, document: number}} MoveListeners
 * @typedef {{id: number, props: string[], before: string[], after: string[]}} Change
 * @typedef {{ids: WeakMap<Element, number>, byId: Map<number, Element>, next: number, list: Element[], ref: string[][],
 *   moving: Set<number>, selfAnimated: Set<number>}} ProbeState
 */

const RULE = 'SL-T13';

export const MOVE_EVENTS = Object.freeze(['mousemove', 'pointermove', 'pointerrawupdate']);
/** Grid of probe points, as shares of the viewport. */
export const GRID_X = Object.freeze([0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88]);
export const GRID_Y = Object.freeze([0.25, 0.5, 0.75]);
/** The nudge: small enough to stay on the same element, large enough to move anything that follows the pointer. */
export const NUDGE = Object.freeze({ x: 14, y: 9 });
/** A spring-smoothed follower gets this long to move after the nudge. */
export const FOLLOW_WAIT_MS = 120;
/** Before each nudge the page must hold still (checked every QUIET_STEP_MS, at most QUIET_TRIES times). */
export const QUIET_STEP_MS = 100;
export const QUIET_TRIES = 6;
/** The rest control at the first point: elements changing in nearly every one of these samples animate on their own. */
export const CONTROL_SAMPLES = 4;
export const CONTROL_STEP_MS = 250;
/** An element must follow the pointer at two probe points or more. */
export const MIN_PAIRS = 2;
export const MAX_TRACKED = 4000;
export const MAX_FINDINGS = 10;
/** Probing stops after this long, so the detector stays inside the runner's 30 s budget on a restless page. */
export const PROBE_BUDGET_MS = 15000;
const PROBE = '__feCursorProbe__';

/**
 * Pointer-move listeners of the page (window, document and every node, shadow roots and frames included), minus the
 * ones Playwright's injected script registers itself: its listeners share a script with its marker listener.
 * @param {Page} page
 * @returns {Promise<MoveListeners>}
 */
export async function moveListeners(page) {
  const cdp = await page.context().newCDPSession(page);
  /** @type {unknown} */
  let failure;
  try {
    const group = 'fe-sl-t13';
    const win = await cdp.send('Runtime.evaluate', { expression: 'window', objectGroup: group });
    const doc = await cdp.send('Runtime.evaluate', { expression: 'document', objectGroup: group });
    const onWindow = win.result.objectId ? (await cdp.send('DOMDebugger.getEventListeners', { objectId: win.result.objectId })).listeners : [];
    const inDocument = doc.result.objectId
      ? (await cdp.send('DOMDebugger.getEventListeners', { objectId: doc.result.objectId, depth: -1, pierce: true })).listeners
      : [];
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: group });
    const tooling = new Set([...onWindow, ...inDocument].filter((l) => l.type.startsWith('__playwright')).map((l) => l.scriptId));
    const counts = (/** @type {typeof onWindow} */ list) => list.filter((l) => MOVE_EVENTS.includes(l.type) && !tooling.has(l.scriptId)).length;
    return { window: counts(onWindow), document: counts(inDocument) };
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
 * In-page: waits until the tracked styles of the elements in the viewport hold still, then records them as the
 * reference, with the element under the pointer. With `control`, it first watches the page with the pointer at rest
 * and marks the elements that keep changing on their own (spinners, loops) as self-animated: those never hold the
 * wait up and are never compared. Elements still changing when the wait ends are left out of the comparison.
 * @param {{key: string, max: number, x: number, y: number, step: number, tries: number, control: boolean,
 *   controlSamples: number, controlStep: number}} arg
 * @returns {Promise<{top: number, moving: number, selfAnimated: number}>}
 */
async function holdStill(arg) {
  /** @type {ProbeState | undefined} */
  let state = Reflect.get(window, arg.key);
  if (!state) {
    state = { ids: new WeakMap(), byId: new Map(), next: 0, list: [], ref: [], moving: new Set(), selfAnimated: new Set() };
    Object.defineProperty(window, arg.key, { value: state, configurable: true, enumerable: false });
  }
  const s = state;
  /** @param {Element} el @returns {number} */
  const idOf = (el) => {
    let id = s.ids.get(el);
    if (id === undefined) {
      id = s.next;
      s.next += 1;
      s.ids.set(el, id);
      s.byId.set(id, el);
    }
    return id;
  };
  /** @param {Element} el @returns {string[]} */
  const read = (el) => {
    const cs = getComputedStyle(el);
    let custom = '';
    const inline = el instanceof HTMLElement || el instanceof SVGElement ? el.style : null;
    if (inline) {
      for (let i = 0; i < inline.length; i += 1) {
        const name = inline[i];
        if (name.startsWith('--')) custom += `${name}:${inline.getPropertyValue(name)};`;
      }
    }
    return [cs.backgroundImage, cs.backgroundPosition, cs.getPropertyValue('mask-image'), cs.getPropertyValue('-webkit-mask-image'),
      cs.transform, cs.translate, cs.left, cs.top, custom];
  };
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** @param {string[]} a @param {string[]} b */
  const differs = (a, b) => a.some((v, k) => v !== b[k]);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  s.list = [document.documentElement, document.body];
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (s.list.length >= arg.max) break;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) continue;
    s.list.push(el);
  }
  const ids = s.list.map(idOf);
  await frame();
  let ref = s.list.map(read);
  if (arg.control) {
    /** @type {number[]} */
    const changes = new Array(s.list.length).fill(0);
    for (let t = 0; t < arg.controlSamples; t += 1) {
      await sleep(arg.controlStep);
      await frame();
      const now = s.list.map(read);
      now.forEach((values, i) => {
        if (differs(values, ref[i])) changes[i] += 1;
      });
      ref = now;
    }
    changes.forEach((n, i) => {
      if (n >= arg.controlSamples - 1) s.selfAnimated.add(ids[i]);
    });
  }
  /** @type {Set<number>} */
  let moving = new Set();
  for (let t = 0; t < arg.tries; t += 1) {
    await sleep(arg.step);
    await frame();
    const now = s.list.map(read);
    moving = new Set();
    let settling = 0;
    now.forEach((values, i) => {
      if (!differs(values, ref[i])) return;
      moving.add(i);
      if (!s.selfAnimated.has(ids[i])) settling += 1;
    });
    ref = now;
    if (settling === 0) break;
  }
  ids.forEach((id, i) => {
    if (s.selfAnimated.has(id)) moving.add(i);
  });
  s.ref = ref;
  s.moving = moving;
  const hit = document.elementFromPoint(arg.x, arg.y);
  return { top: hit ? idOf(hit) : -1, moving: moving.size, selfAnimated: s.selfAnimated.size };
}

/**
 * In-page: after the nudge, which tracked elements changed against the reference (moving ones excluded), and which
 * element is now under the pointer.
 * @param {{key: string, x: number, y: number}} arg
 * @returns {{top: number, changes: Change[]}}
 */
function compareAfterNudge(arg) {
  /** @type {ProbeState} */
  const s = Reflect.get(window, arg.key);
  const names = ['background-image', 'background-position', 'mask-image', '-webkit-mask-image', 'transform', 'translate', 'left', 'top', 'custom-properties'];
  /** @type {Change[]} */
  const changes = [];
  s.list.forEach((el, i) => {
    const id = s.ids.get(el);
    if (id === undefined || s.moving.has(i) || !el.isConnected) return;
    const cs = getComputedStyle(el);
    let custom = '';
    const inline = el instanceof HTMLElement || el instanceof SVGElement ? el.style : null;
    if (inline) {
      for (let k = 0; k < inline.length; k += 1) {
        const name = inline[k];
        if (name.startsWith('--')) custom += `${name}:${inline.getPropertyValue(name)};`;
      }
    }
    const now = [cs.backgroundImage, cs.backgroundPosition, cs.getPropertyValue('mask-image'), cs.getPropertyValue('-webkit-mask-image'),
      cs.transform, cs.translate, cs.left, cs.top, custom];
    const props = [];
    const before = [];
    const after = [];
    for (let k = 0; k < now.length; k += 1) {
      if (now[k] === s.ref[i][k]) continue;
      props.push(names[k]);
      before.push(String(s.ref[i][k]).slice(0, 120));
      after.push(String(now[k]).slice(0, 120));
    }
    if (props.length > 0) changes.push({ id, props, before, after });
  });
  const hit = document.elementFromPoint(arg.x, arg.y);
  const top = hit ? s.ids.get(hit) : undefined;
  return { top: top === undefined ? -2 : top, changes };
}

/**
 * In-page: selectors of the elements behind stable ids.
 * @param {(el: Element) => string} selectorOf
 * @param {{key: string, ids: number[]}} arg
 * @returns {Array<{id: number, sel: string, tag: string}>}
 */
function describe(selectorOf, arg) {
  /** @type {ProbeState} */
  const s = Reflect.get(window, arg.key);
  return arg.ids.map((id) => {
    const el = s.byId.get(id);
    return el ? { id, sel: selectorOf(el), tag: el.localName } : { id, sel: '', tag: '' };
  });
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
 * Probe points in a serpentine over the grid, inside a viewport of the given size.
 * @param {{width: number, height: number}} view
 * @returns {Array<{x: number, y: number}>}
 */
export function probePoints(view) {
  /** @type {Array<{x: number, y: number}>} */
  const points = [];
  GRID_Y.forEach((fy, row) => {
    const xs = row % 2 === 0 ? [...GRID_X] : [...GRID_X].reverse();
    for (const fx of xs) points.push({ x: Math.round(fx * view.width), y: Math.round(fy * view.height) });
  });
  return points.filter((p) => p.x + NUDGE.x < view.width && p.y + NUDGE.y < view.height);
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
 * Elements whose background, mask, transform, position or inline custom properties follow the pointer at two probe
 * points or more. Skipped where the device has no hover-capable pointer, and when the page registers no move
 * listener at all. Probing stops after PROBE_BUDGET_MS; the value says how many points were probed. A probe cut short
 * with nothing found throws (a detector error that fails the gates judging the rule), never an empty, clean result.
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const canHover = await ctx.page.evaluate(() => matchMedia('(any-hover: hover)').matches);
  if (!canHover) return [];
  const listeners = await moveListeners(ctx.page);
  if (listeners.window + listeners.document === 0) return [];
  const page = await ctx.freshPage();
  const view = { width: ctx.viewport.width, height: ctx.viewport.height };
  /** @type {Map<number, {pairs: number, props: Set<string>, sample: Change}>} */
  const coupled = new Map();
  let probed = 0;
  let control = true;
  const points = probePoints(view);
  const started = Date.now();
  let stoppedAt = -1;
  for (const [i, p] of points.entries()) {
    if (Date.now() - started > PROBE_BUDGET_MS) {
      stoppedAt = i;
      break;
    }
    await page.mouse.move(p.x, p.y, { steps: 4 });
    const rest = await page.evaluate(holdStill, {
      key: PROBE, max: MAX_TRACKED, x: p.x, y: p.y, step: QUIET_STEP_MS, tries: QUIET_TRIES, control,
      controlSamples: CONTROL_SAMPLES, controlStep: CONTROL_STEP_MS,
    });
    control = false;
    const q = { x: p.x + NUDGE.x, y: p.y + NUDGE.y };
    await page.mouse.move(q.x, q.y, { steps: 2 });
    await page.waitForTimeout(FOLLOW_WAIT_MS);
    const after = await page.evaluate(compareAfterNudge, { key: PROBE, x: q.x, y: q.y });
    if (rest.top < 0 || after.top !== rest.top) continue;
    probed += 1;
    for (const change of after.changes) {
      const entry = coupled.get(change.id) ?? { pairs: 0, props: new Set(), sample: change };
      entry.pairs += 1;
      for (const prop of change.props) entry.props.add(prop);
      coupled.set(change.id, entry);
    }
  }
  const hits = [...coupled.entries()].filter(([, c]) => c.pairs >= MIN_PAIRS).sort((a, b) => b[1].pairs - a[1].pairs).slice(0, MAX_FINDINGS);
  if (hits.length === 0 && stoppedAt >= 0) {
    throw new Error(`probing stopped at the ${PROBE_BUDGET_MS} ms budget after ${stoppedAt} of ${points.length} points with nothing found yet, so the page cannot be called clean; rerun on an idle machine or narrow the routes`);
  }
  if (hits.length === 0) return [];
  const described = await inPage(page, describe, { key: PROBE, ids: hits.map(([id]) => id) });
  return hits.map(([id, c], i) => {
    const d = described[i] ?? { id, sel: '', tag: '' };
    return finding(ctx, d.sel, {
      pairs: c.pairs, probed, points: points.length, props: [...c.props], before: c.sample.before, after: c.sample.after, listeners,
    }, `<${d.tag}> ${[...c.props].join(', ')} follow the pointer at ${c.pairs} of ${probed} probe points`);
  });
}
