// @ts-check
/*
 * SL-MO1: `transition: all` on interactive elements. Name the properties instead [FD03-F08]. The rendered check is the
 * complete one: a bare `transition: 0.2s` shorthand also computes to `all`, while every element computes
 * `transition-property: all` with a 0s duration by default, so only an `all` entry with a duration above zero counts
 * [FD04-F24].
 */
import { rendered } from './SL-M01.mjs';
import { finding, splitTopLevel, toMs } from './SL-MO2.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {import('./SL-MO2.mjs').Item} Item
 */

export const RULE = 'SL-MO1';
export const MAX_FINDINGS = 20;

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option',
  'combobox', 'listbox', 'slider', 'spinbutton', 'textbox', 'searchbox', 'treeitem',
]);
const INTERACTIVE_TAGS = new Set(['button', 'input', 'select', 'textarea', 'summary']);

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  /** @type {Item[]} */
  const items = [];
  elements.forEach((el, i) => {
    if (!rendered(el) || !isInteractive(elements, i)) return;
    const ms = transitionAllMs(el.styles.transitionProperty, el.styles.transitionDuration);
    if (ms > 0) items.push({ selector: el.sel, box: el.box, tag: el.tag, role: el.role, text: el.text.slice(0, 60), durationMs: ms });
  });
  return items.slice(0, MAX_FINDINGS).map((item) => finding(RULE, ctx, item,
    `transition-property: all (${String(item.durationMs)} ms) on ${String(item.tag)} "${String(item.text).slice(0, 40)}"; list the transitioned properties`,
    items.length));
}

/**
 * Duration in ms of the `all` entry of a computed transition, 0 when there is none or it has no duration.
 * @param {string | undefined} properties
 * @param {string | undefined} durations
 * @returns {number}
 */
export function transitionAllMs(properties, durations) {
  const props = splitTopLevel(properties ?? '');
  const durs = splitTopLevel(durations ?? '');
  let best = 0;
  props.forEach((p, i) => {
    if (p.trim() !== 'all' || durs.length === 0) return;
    best = Math.max(best, toMs(durs[i % durs.length]));
  });
  return best;
}

/**
 * A control a person operates: an interactive role or tag, a link with an href, or the outermost element of a
 * pointer-cursor region (a clickable card), not its descendants that merely inherit the cursor.
 * @param {ElementInfo[]} elements
 * @param {number} i
 * @returns {boolean}
 */
export function isInteractive(elements, i) {
  const el = elements[i];
  if (INTERACTIVE_ROLES.has(el.role) || INTERACTIVE_TAGS.has(el.tag)) return true;
  if (el.tag === 'a' && el.meta.href) return true;
  if (el.styles.cursor !== 'pointer') return false;
  const parent = el.parent >= 0 ? elements[el.parent] : null;
  return !parent || parent.styles.cursor !== 'pointer';
}
