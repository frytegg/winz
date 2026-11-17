// @ts-check
import { chainOf, laidOut } from './SL-T01.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 */

const RULE = 'SL-T03';

/** Krebs's sidebar_emoji pattern (FD10 R03): a nav with 3 or more emoji, or more than 40% emoji-prefixed links. */
export const NAV_EMOJI_MIN = 3;
export const NAV_PREFIXED_SHARE = 0.4;
/** A share of emoji-prefixed links means little over one or two links. */
export const NAV_LINKS_MIN = 3;
export const MAX_FINDINGS = 20;

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
/** Extended_Pictographic code points that are typography, not emoji: (c), (r), TM and the arrows (FD14-F16). */
const NOT_EMOJI = new Set([0xa9, 0xae, 0x2122, 0x27a1, 0x2934, 0x2935, 0x2b05, 0x2b06, 0x2b07]);
const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * @param {number} cp
 * @returns {boolean}
 */
function typographic(cp) {
  return NOT_EMOJI.has(cp) || (cp >= 0x2190 && cp <= 0x21ff);
}

/**
 * The emoji in a rendered string, one entry per grapheme (a ZWJ sequence or a flag counts once).
 * @param {string} text
 * @returns {string[]}
 */
export function emojiIn(text) {
  /** @type {string[]} */
  const out = [];
  for (const { segment } of GRAPHEMES.segment(String(text ?? ''))) {
    const cp = segment.codePointAt(0) ?? 0;
    if (PICTOGRAPHIC.test(segment) && !typographic(cp)) out.push(segment);
  }
  return out;
}

/**
 * Whether the text starts with an emoji (after leading spaces).
 * @param {string} text
 * @returns {boolean}
 */
export function startsWithEmoji(text) {
  const first = GRAPHEMES.segment(String(text ?? '').trimStart())[Symbol.iterator]().next();
  return !first.done && emojiIn(first.value.segment).length > 0;
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
 * @param {ElementInfo} e
 * @returns {boolean}
 */
function isHeading(e) {
  return /^h[1-6]$/.test(e.tag) || e.role === 'heading';
}

/**
 * Emoji in rendered headings (h1-h6, role=heading; quoted content excluded) and emoji-led navigation.
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  /** @type {RuntimeFinding[]} */
  const out = [];
  const quoted = (/** @type {number} */ i) => [...chainOf(elements, i)].some((k) => ['blockquote', 'q'].includes(elements[k].tag));
  elements.forEach((e, i) => {
    if (!laidOut(e) || !isHeading(e) || quoted(i)) return;
    const found = emojiIn(e.text);
    if (found.length === 0) return;
    out.push(finding(ctx, e.sel, { kind: 'heading', tag: e.tag, emoji: found, text: e.text.slice(0, 120) },
      `emoji ${found.join(' ')} in <${e.tag}> "${e.text.slice(0, 60)}"`));
  });
  /** @type {Map<number, {links: number, prefixed: number, emoji: string[]}>} */
  const navs = new Map();
  elements.forEach((e, i) => {
    if (!laidOut(e) || e.role !== 'link') return;
    const nav = [...chainOf(elements, i)].find((k) => k !== i && ['navigation', 'complementary'].includes(elements[k].role));
    if (nav === undefined) return;
    const entry = navs.get(nav) ?? { links: 0, prefixed: 0, emoji: [] };
    entry.links += 1;
    if (startsWithEmoji(e.text)) entry.prefixed += 1;
    entry.emoji.push(...emojiIn(e.text));
    navs.set(nav, entry);
  });
  for (const [index, n] of navs) {
    const share = n.links > 0 ? n.prefixed / n.links : 0;
    const shareHit = n.links >= NAV_LINKS_MIN && share > NAV_PREFIXED_SHARE;
    if (n.emoji.length < NAV_EMOJI_MIN && !shareHit) continue;
    const nav = elements[index];
    out.push(finding(ctx, nav.sel, { kind: 'navigation', links: n.links, prefixed: n.prefixed, share: Math.round(share * 100) / 100, emoji: n.emoji },
      `${n.emoji.length} emoji across ${n.links} links in <${nav.tag}> (${n.prefixed} emoji-led)`));
  }
  return out.slice(0, MAX_FINDINGS);
}
