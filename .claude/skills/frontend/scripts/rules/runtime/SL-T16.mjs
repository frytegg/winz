// @ts-check
import { wordCount } from '../../lib/text.mjs';
import { laidOutText } from './SL-T01.mjs';

/*
 * SL-T16 runtime: em dashes in the rendered copy (FD10 T16, R16; critic C11 and C13: rendered text only, U+2014
 * only, a minimum word count). Code comments never reach the page, so they never count (FD10-F18). Data
 * placeholders are left out as FD14-F06 proposes: a cell that is only a dash, a dash beside a middle dot or a bar,
 * a string-final dash, a dash before a slash ("ROUND —/2").
 */

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').TextInfo} TextInfo
 */

const RULE = 'SL-T16';

/** /prose PR-01: more than 2.0 em dashes per 1,000 words. */
export const RATE_PER_1000 = 2;
/** Below this many words a page carries too little copy for a rate (provisional, to calibrate on UI copy). */
export const MIN_WORDS = 100;
/** PR-01's own principle, "a dash is not a defect, a dash habit is": one dash never makes a rate finding. */
export const MIN_COUNT = 2;
/** impeccable's floor, kept as a second trigger at any length: 8 dashes and at least one per 500 characters. */
export const FLOOR_COUNT = 8;
export const FLOOR_CHARS_PER_DASH = 500;
/** "WORD — fragment" labels: short strings whose capitalised head of 1-3 words meets a spaced dash. */
export const LABEL_MAX_WORDS = 12;
export const LABEL_HEAD_WORDS = 3;
export const MAX_LABELS = 10;

const EM_DASH = String.fromCharCode(0x2014);
const MIDDLE_DOT = String.fromCharCode(0xb7);
const CODE_TAGS = new Set(['code', 'pre', 'kbd', 'samp']);

/**
 * Counts the prose em dashes of one rendered string, leaving out data placeholders.
 * @param {string} text
 * @returns {{prose: number, placeholders: number}}
 */
export function countDashes(text) {
  const s = String(text ?? '').trim();
  let prose = 0;
  let placeholders = 0;
  if (s !== '' && s.split('').every((c) => c === EM_DASH || /\s/.test(c))) {
    return { prose: 0, placeholders: s.split(EM_DASH).length - 1 };
  }
  for (let i = s.indexOf(EM_DASH); i >= 0; i = s.indexOf(EM_DASH, i + 1)) {
    const before = s.slice(0, i).trimEnd().slice(-1);
    const afterText = s.slice(i + 1);
    const after = afterText.trimStart().slice(0, 1);
    const placeholder = before === MIDDLE_DOT || before === '|' || after === MIDDLE_DOT || after === '|' || after === '' || after === '/' ||
      afterText.startsWith('/');
    if (placeholder) placeholders += 1;
    else prose += 1;
  }
  return { prose, placeholders };
}

/**
 * Whether a rendered string is a "WORD — fragment" label: at most 12 words, a spaced em dash, a head of 1-3 words
 * set in capitals (written so, or by text-transform), and a fragment after it.
 * @param {string} text
 * @param {string} textTransform
 * @returns {boolean}
 */
export function isDashLabel(text, textTransform) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  const at = s.indexOf(` ${EM_DASH} `);
  if (at <= 0 || wordCount(s) > LABEL_MAX_WORDS) return false;
  const head = s.slice(0, at);
  const tail = s.slice(at + 3);
  const headWords = wordCount(head);
  if (headWords < 1 || headWords > LABEL_HEAD_WORDS || wordCount(tail) < 1) return false;
  const letters = head.replace(/[^\p{L}]/gu, '');
  if (letters === '') return false;
  return textTransform === 'uppercase' || (letters === letters.toUpperCase() && letters !== letters.toLowerCase());
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
 * The em-dash rate of the rendered copy, scroll-revealed text included (PR-01, with a word minimum and impeccable's
 * floor), plus one finding per "WORD — fragment" label. Pages whose root language is not English are left alone
 * (FD14-F06).
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const lang = await ctx.page.evaluate(() => document.documentElement.lang || '');
  if (lang !== '' && !/^en\b/i.test(lang)) return [];
  const texts = (await ctx.cache.text()).filter((t) => laidOutText(t) && t.source === 'text' && !CODE_TAGS.has(t.tag));
  let words = 0;
  let chars = 0;
  let prose = 0;
  let placeholders = 0;
  /** @type {Array<{t: TextInfo, prose: number}>} */
  const owners = [];
  for (const t of texts) {
    words += wordCount(t.text);
    chars += t.text.length;
    const counted = countDashes(t.text);
    prose += counted.prose;
    placeholders += counted.placeholders;
    if (counted.prose > 0) owners.push({ t, prose: counted.prose });
  }
  /** @type {RuntimeFinding[]} */
  const out = [];
  const per1000 = words > 0 ? (prose * 1000) / words : 0;
  const rateHit = words >= MIN_WORDS && prose >= MIN_COUNT && per1000 > RATE_PER_1000;
  const floorHit = prose >= FLOOR_COUNT && chars <= FLOOR_CHARS_PER_DASH * prose;
  if (rateHit || floorHit) {
    owners.sort((a, b) => b.prose - a.prose);
    out.push(finding(ctx, owners[0].t.sel, {
      kind: 'rate', count: prose, words, per1000: Math.round(per1000 * 100) / 100, placeholders, trigger: rateHit ? 'pr-01' : 'floor',
      top: owners.slice(0, 5).map((o) => ({ selector: o.t.sel, count: o.prose, text: o.t.text.slice(0, 80) })),
    }, `${prose} em dashes in ${words} rendered words (${(Math.round(per1000 * 100) / 100).toFixed(2)} per 1,000; PR-01 fires above ${RATE_PER_1000})${placeholders ? `; ${placeholders} data placeholders left out` : ''}`));
  }
  let labels = 0;
  for (const t of texts) {
    if (labels >= MAX_LABELS) break;
    if (!isDashLabel(t.text, t.textTransform)) continue;
    labels += 1;
    out.push(finding(ctx, t.sel, { kind: 'label', text: t.text.slice(0, 80) }, `"WORD ${EM_DASH} fragment" label: "${t.text.slice(0, 60)}"`));
  }
  return out;
}
