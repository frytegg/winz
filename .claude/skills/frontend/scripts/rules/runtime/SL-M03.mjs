// @ts-check
/*
 * SL-M03: zero-padded 01 / 02 / 03 markers beside headings when the content is not a sequence. Numbered markers are
 * appropriate only for a stepped process or a timeline [FD15-F06]; Krebs's numbered-steps pattern (ascending,
 * grouped) fired on 17.7% of Show HN pages [FD10-F11]. A group is three or more ascending two-digit markers, each
 * beside a heading, close together in the DOM. A group inside an ordered list, or whose section or items speak of
 * steps, a process, a timeline or a roadmap, is a real sequence and is left alone.
 */

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 */

export const RULE = 'SL-M03';
export const MAX_FINDINGS = 20;
export const MIN_GROUP = 3;
/** Two consecutive markers share an ancestor at most this many levels above each. */
const MAX_HOPS = 5;
/** A marker's item (the ancestor that also holds its heading) lies at most this many levels up. */
const ITEM_HOPS = 3;
const MARKER = /^(?:no\.?\s*)?[(#/]?\s*(\d{2})\s*[.):/—–-]?\s*(?:\/\s*\d{1,2})?\)?$/i;
const SEQUENCE = /\b(?:step|steps|how it works|process|timeline|roadmap|phases?|stages?|workflow|getting started|set ?up|install|instructions|walkthrough|lifecycle)\b/i;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  const groups = markerGroups(elements).filter((g) => !isRealSequence(elements, g));
  return groups.slice(0, MAX_FINDINGS).map((g) => {
    const container = commonAncestor(elements, g[0], g[g.length - 1]);
    const at = container >= 0 ? container : g[0];
    const markers = g.map((i) => elements[i].text.trim());
    const headings = g.map((i) => headingOf(elements, i)).map((h) => (h >= 0 ? elements[h].text.slice(0, 60) : ''));
    return {
      rule: RULE,
      layer: /** @type {const} */ ('runtime'),
      route: ctx.route?.path ?? '',
      viewport: ctx.viewport?.name ?? '',
      selector: elements[at].sel,
      box: elements[at].box,
      value: { markers, headings, total: groups.length },
      detail: `numbered markers ${markers.join(' / ')} beside headings that are not a sequence (${headings.filter(Boolean).join('; ')}); number only what has an order`,
    };
  });
}

/**
 * The numeric value of a zero-padded marker ("01", "02.", "(03)", "/04", "05 / 08"), or null.
 * @param {string} text
 * @returns {number | null}
 */
export function markerValue(text) {
  const m = MARKER.exec(String(text ?? '').trim());
  return m ? Number(m[1]) : null;
}

/**
 * Runs of MIN_GROUP or more markers in document order, each beside a heading, ascending by one, with at least one
 * leading zero, consecutive markers sharing a close ancestor.
 * @param {ElementInfo[]} elements
 * @returns {number[][]}
 */
export function markerGroups(elements) {
  const markers = elements.map((_, i) => i).filter((i) => {
    const el = elements[i];
    if (el.box.w < 1 || el.box.h < 1 || markerValue(el.text) === null) return false;
    if (elements.some((o) => o.parent === i && o.text.trim() === el.text.trim())) return false;
    return headingOf(elements, i) >= 0;
  });
  /** @type {number[][]} */
  const groups = [];
  /** @type {number[]} */
  let run = [];
  for (const i of markers) {
    const prev = run[run.length - 1];
    const ascending = prev !== undefined && markerValue(elements[i].text) === /** @type {number} */ (markerValue(elements[prev].text)) + 1;
    const close = prev !== undefined && hops(elements, prev, i) <= MAX_HOPS;
    if (ascending && close) run.push(i);
    else {
      if (run.length >= MIN_GROUP) groups.push(run);
      run = [i];
    }
  }
  if (run.length >= MIN_GROUP) groups.push(run);
  return groups.filter((g) => g.some((i) => /^\D*0\d/.test(elements[i].text.trim())));
}

/**
 * True when a group reads as a real sequence: inside an ordered list, or its container, its items' headings or the
 * nearest heading before it name steps, a process, a timeline or a roadmap.
 * @param {ElementInfo[]} elements
 * @param {number[]} group
 * @returns {boolean}
 */
export function isRealSequence(elements, group) {
  for (const i of group) for (let k = elements[i].parent; k >= 0; k = elements[k].parent) if (elements[k].tag === 'ol') return true;
  const headings = group.map((i) => headingOf(elements, i)).filter((h) => h >= 0).map((h) => elements[h].text);
  if (headings.some((t) => SEQUENCE.test(t))) return true;
  const container = commonAncestor(elements, group[0], group[group.length - 1]);
  if (container >= 0 && SEQUENCE.test(elements[container].meta.ariaLabel ?? '')) return true;
  for (let k = group[0] - 1; k >= 0; k -= 1) {
    const el = elements[k];
    if (!(/^h[1-6]$/.test(el.tag) || el.role === 'heading')) continue;
    if (container >= 0 && within(elements, k, container)) continue;
    return SEQUENCE.test(el.text);
  }
  return false;
}

/**
 * The heading beside a marker: the marker sits inside a heading, or an ancestor within ITEM_HOPS levels holds a
 * heading that is not above the marker's own level. Returns its index or -1.
 * @param {ElementInfo[]} elements
 * @param {number} i
 * @returns {number}
 */
export function headingOf(elements, i) {
  const isHeading = (/** @type {ElementInfo} */ el) => /^h[1-6]$/.test(el.tag) || el.role === 'heading';
  for (let k = elements[i].parent; k >= 0; k = elements[k].parent) if (isHeading(elements[k])) return k;
  let item = elements[i].parent;
  for (let hop = 0; hop < ITEM_HOPS && item >= 0; hop += 1, item = elements[item].parent) {
    for (let k = item + 1; k < elements.length; k += 1) {
      if (!within(elements, k, item)) break;
      if (k !== i && isHeading(elements[k])) return k;
    }
  }
  return -1;
}

/**
 * True when element k lies inside element ancestor (collected elements are in document order, so a subtree is a
 * contiguous index range).
 * @param {ElementInfo[]} elements
 * @param {number} k
 * @param {number} ancestor
 * @returns {boolean}
 */
function within(elements, k, ancestor) {
  for (let p = elements[k].parent; p >= 0; p = elements[p].parent) if (p === ancestor) return true;
  return false;
}

/**
 * Levels from `a` up to the nearest ancestor shared with `b` (Infinity when none).
 * @param {ElementInfo[]} elements
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function hops(elements, a, b) {
  const common = commonAncestor(elements, a, b);
  if (common < 0) return Infinity;
  let n = 0;
  for (let k = a; k >= 0 && k !== common; k = elements[k].parent) n += 1;
  return n;
}

/**
 * @param {ElementInfo[]} elements
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function commonAncestor(elements, a, b) {
  const chain = new Set();
  for (let k = a; k >= 0; k = elements[k].parent) chain.add(k);
  for (let k = b; k >= 0; k = elements[k].parent) if (chain.has(k)) return k;
  return -1;
}
