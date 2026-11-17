// @ts-check
/*
 * SL-X01: unsourced metric. No invented testimonial, logo, user count or statistic, ever [FD01-F12]; every rendered
 * number traces to a claims-ledger id or a labelled data source (CONTRACTS 6.6: `data-metric` must also carry
 * `data-ledger` or `data-source`) [FD13]. Three runtime signals: stat-styled numeric text of 22 px or more, any
 * `data-metric` element, and quantitative numbers in hero copy (the first-viewport h1 or a `data-hero` element),
 * each without a ledger or source marker on itself or an ancestor. Prices, dates, versions, ordinals and step labels
 * are the documented false positives. Elements waiting at opacity 0 for a reveal still count: their figure renders
 * once scrolled into view.
 *
 * Hosts the number classification SL-M04 imports.
 */

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {{selector: string, box: import('../../lib/dom.mjs').Box | null, [key: string]: unknown}} Item
 * @typedef {'metric' | 'price' | 'date' | 'version' | 'ordinal' | 'time' | 'label'} NumberKind
 */

export const RULE = 'SL-X01';
export const MAX_FINDINGS = 20;
/** Stat styling: numeric text at this computed size or larger (Krebs's stat-banner floor, FD10 M04). */
export const STAT_MIN_PX = 22;
const STAT_MAX_CHARS = 28;
const STAT_MAX_WORDS = 3;

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
const VERSION = [/^v\d+(?:\.\d+)*\b/i, /\b\d+\.\d+\.\d+\b/];
const DATE = [
  /^(?:19|20)\d{2}$/,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/,
  new RegExp(`\\b(?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2}\\b`, 'i'),
  new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})[a-z]*\\b`, 'i'),
  /\bQ[1-4]\s*'?\d{2,4}\b/i,
];
const TIME = /\b\d{1,2}:\d{2}\b/;
const ORDINAL = [
  /^\d+(?:st|nd|rd|th)\b/i,
  /^#\d+$/,
  /^no\.\s*\d+$/i,
  /^\d{1,3}(?:\.\d{1,3})*[.)]$/,
  /^\d{1,3}(?:\.\d{1,3})*[.)]\s+\p{L}/u,
  /^\d{1,2}(?:\.\d{1,2})+\s+\p{Lu}\p{Ll}/u,
];
const SUBSCRIPTION = /\d\s*(?:\/\s*|per\s+)(?:mo|month|yr|year|annum|user|seat|week)\b/i;
const STEP_LABEL = /^0?\d$/;
const STARTS_NUMERIC = /^(?:[~≈<>≤≥+−-]\s?)*(?:[$€£¥₿]\s?)?\d/;
const CLAIM = /(?<![\w.\-/])(?:[$€£¥₿]\s?)?\d(?:[\d,.]*\d)?(?:\s?(?:%|×|x\b|k\b|m\b|bn\b|b\b))?\+?(?:\s?(?:ms|s|secs?|seconds?|mins?|minutes?|hrs?|hours?|days?|weeks?|months?|years?|users?|customers?|developers?|builders?|teams?|transactions?|txs?|tps|chains?|countries|validators?|nodes?|holders?|wallets?|projects?|protocols?|integrations?|times)\b)?/gi;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  const children = childLists(elements);
  const viewHeight = ctx.viewport?.height ?? 900;
  /** @type {Item[]} */
  const items = [];
  const reported = new Set();
  /** @param {number} i @param {string} why @param {string} text */
  const add = (i, why, text) => {
    const key = `${i}|${text}`;
    if (reported.has(key)) return;
    reported.add(key);
    const el = elements[i];
    items.push({ selector: el.sel, box: el.box, why, text, fontSize: el.styles.fontSize });
  };
  for (const i of statCarriers(elements, children)) if (!isSourced(elements, i)) add(i, 'stat', elements[i].text);
  elements.forEach((el, i) => {
    if (Object.hasOwn(el.attrs, 'data-metric') && present(el) && !isSourced(elements, i)) add(i, 'data-metric', el.text);
  });
  const heroTokens = new Set();
  elements.forEach((el, i) => {
    if (!present(el) || isSourced(elements, i)) return;
    const hero = Object.hasOwn(el.attrs, 'data-hero') || (el.tag === 'h1' && el.box.y < viewHeight);
    if (!hero || [...reported].some((key) => key.startsWith(`${i}|`))) return;
    const sourcedText = descendants(children, i).filter((d) => hasSource(elements[d])).map((d) => elements[d].text).join(' ');
    for (const token of numericClaims(el.text)) {
      if (sourcedText.includes(token) || heroTokens.has(token)) continue;
      heroTokens.add(token);
      add(i, 'hero-copy', token);
    }
  });
  return items.slice(0, MAX_FINDINGS).map((item) => finding(ctx, item,
    `figure "${String(item.text).slice(0, 40)}" (${String(item.why)}) has no data-ledger or data-source; render only numbers from the claims ledger or a labelled data source`,
    items.length));
}

/**
 * @param {RuntimeContext} ctx
 * @param {Item} item
 * @param {string} detail
 * @param {number} total instances on the page
 * @returns {RuntimeFinding}
 */
function finding(ctx, item, detail, total) {
  const { selector, box, ...value } = item;
  return { rule: RULE, layer: 'runtime', route: ctx.route?.path ?? '', viewport: ctx.viewport?.name ?? '', selector, box, value: { ...value, total }, detail };
}

/**
 * Kind of a short numeric text: a metric (a claim), or one of the documented false positives (section and list
 * numbering such as "1.", "2. Operable" or "1.1 Text alternatives" counts as an ordinal). Null without a digit.
 * @param {string} text
 * @returns {NumberKind | null}
 */
export function numberKind(text) {
  const t = String(text ?? '').normalize('NFKC').trim();
  if (!/\d/.test(t)) return null;
  if (VERSION.some((re) => re.test(t))) return 'version';
  if (DATE.some((re) => re.test(t))) return 'date';
  if (TIME.test(t)) return 'time';
  if (ORDINAL.some((re) => re.test(t))) return 'ordinal';
  if (SUBSCRIPTION.test(t)) return 'price';
  if (STEP_LABEL.test(t)) return 'label';
  return 'metric';
}

/**
 * Text styled as a statistic is short, led by a number ("10K+", "$4.2M", "99.9%", "<1s", "1,200+ users") and a metric.
 * @param {string} text
 * @returns {boolean}
 */
export function isStatText(text) {
  const t = String(text ?? '').normalize('NFKC').trim();
  if (t.length === 0 || t.length > STAT_MAX_CHARS) return false;
  if (t.split(/\s+/).length > STAT_MAX_WORDS) return false;
  return STARTS_NUMERIC.test(t) && numberKind(t) === 'metric';
}

/**
 * Quantitative numbers in running copy: those with a percent, multiplier, magnitude, plus or currency sign, a unit
 * word, or a value of 100 or more. Dates, versions, times, ordinals and bare small counts ("3 steps") are left out.
 * @param {string} text
 * @returns {string[]}
 */
export function numericClaims(text) {
  /** @type {string[]} */
  const out = [];
  for (const m of String(text ?? '').normalize('NFKC').matchAll(CLAIM)) {
    const token = m[0].trim();
    const kind = numberKind(token);
    if (kind !== 'metric' && kind !== 'label') continue;
    const value = Number.parseFloat(token.replace(/[^\d.]/g, ''));
    const marked = /[%×$€£¥₿+]|\d\s?(?:x|k|m|b|bn)\b/i.test(token) || /[a-z]{2,}$/i.test(token) || /\ds$/.test(token);
    if (marked || value >= 100) out.push(token);
  }
  return out;
}

/**
 * Indices of the elements that carry a stat: present, at STAT_MIN_PX or more, stat-like text, and the deepest
 * element holding that whole text.
 * @param {ElementInfo[]} elements
 * @param {number[][]} [children]
 * @returns {number[]}
 */
export function statCarriers(elements, children = childLists(elements)) {
  /** @type {number[]} */
  const out = [];
  elements.forEach((el, i) => {
    if (!present(el)) return;
    if (!(Number.parseFloat(el.styles.fontSize) >= STAT_MIN_PX)) return;
    if (!isStatText(el.text)) return;
    if (children[i].some((c) => elements[c].text === el.text)) return;
    out.push(i);
  });
  return out;
}

/**
 * True when the element or an ancestor carries a non-empty data-ledger or data-source.
 * @param {ElementInfo[]} elements
 * @param {number} i
 * @returns {boolean}
 */
export function isSourced(elements, i) {
  for (let k = i; k >= 0; k = elements[k].parent) if (hasSource(elements[k])) return true;
  return false;
}

/**
 * @param {ElementInfo} el
 * @returns {boolean}
 */
function hasSource(el) {
  return ['data-ledger', 'data-source'].some((name) => typeof el.attrs[name] === 'string' && el.attrs[name].trim() !== '');
}

/**
 * Laid out (a box, not display:none), even when transparent or hidden for a reveal.
 * @param {ElementInfo} el
 * @returns {boolean}
 */
export function present(el) {
  return el.box.w >= 1 && el.box.h >= 1 && el.styles.display !== 'none';
}

/**
 * Child indices of every collected element, from the `parent` links.
 * @param {ElementInfo[]} elements
 * @returns {number[][]}
 */
export function childLists(elements) {
  /** @type {number[][]} */
  const out = elements.map(() => []);
  elements.forEach((el, i) => {
    if (el.parent >= 0) out[el.parent].push(i);
  });
  return out;
}

/**
 * @param {number[][]} children
 * @param {number} i
 * @returns {number[]}
 */
function descendants(children, i) {
  /** @type {number[]} */
  const out = [];
  const stack = [...children[i]];
  while (stack.length > 0) {
    const k = /** @type {number} */ (stack.pop());
    out.push(k);
    stack.push(...children[k]);
  }
  return out;
}
