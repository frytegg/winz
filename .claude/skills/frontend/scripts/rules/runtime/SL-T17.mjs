// @ts-check
import { laidOutText } from './SL-T01.mjs';

/*
 * SL-T17 runtime: promotional, LLM-register phrases in the rendered copy (FD10 T17, R17), FD10's S17 phrase list
 * (impeccable's list plus Wikipedia's promotional register) applied to rendered text. The specificity check FD10
 * pairs with it keeps a phrase whose block also names a number or a sponsor of the profile; quoted text (a
 * sponsor's tagline) is left out.
 */

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 */

const RULE = 'SL-T17';

/** FD10 S17, verbatim. */
export const BUZZWORDS = /streamline your|empower your|supercharge your|unleash (?:your|the power)|leverage the power|built for the modern|trusted by (?:leading|the world)|best-in-class|industry-leading|world-class|enterprise-grade|next-generation|cutting-edge|transform your business|revolutioniz|game[- ]chang|mission-critical|best of breed|future[- ]proof|seamless(?:ly integrate| experience)|drive (?:engagement|growth|results)|harness the power/gi;
export const MAX_FINDINGS = 20;
/** The block a phrase is judged in: the nearest of these around its text. */
const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, td, th, dd, dt, figcaption, button, a, label, summary, caption';

/**
 * Names a sponsor can appear under in copy: the profile's sponsor ids and the allowlist's display names (the part
 * before any parenthesis), lower-cased, with hyphens as spaces.
 * @param {RuntimeContext} ctx
 * @returns {string[]}
 */
export function sponsorNames(ctx) {
  const names = new Set();
  for (const id of ctx.profile?.sponsors ?? []) names.add(String(id).toLowerCase().replace(/-/g, ' '));
  for (const entry of ctx.allowlist?.sponsors ?? []) {
    for (const raw of [entry.sponsor, entry.id, entry.display_name]) {
      if (typeof raw !== 'string') continue;
      const name = raw.split('(')[0].trim().toLowerCase().replace(/-/g, ' ');
      if (name.length >= 3) names.add(name);
    }
  }
  return [...names];
}

/**
 * Whether a block of copy is specific: it carries a figure, or names a sponsor.
 * @param {string} block
 * @param {string[]} sponsors
 * @returns {boolean}
 */
export function specific(block, sponsors) {
  const text = String(block ?? '').toLowerCase();
  if (/\d/.test(text)) return true;
  return sponsors.some((s) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(s)}(?:$|[^\\p{L}\\p{N}])`, 'u').test(text));
}

/**
 * @param {string} s
 * @returns {string} `s` with every regular-expression metacharacter escaped
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^$()|[\]{}\\]/g, (c) => `\\${c}`);
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
 * One finding per rendered text owner that uses a listed phrase in a block naming no figure and no sponsor.
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const texts = (await ctx.cache.text()).filter((t) => laidOutText(t) && t.source !== 'placeholder');
  const hits = texts
    .map((t) => ({ t, phrases: [...t.text.matchAll(BUZZWORDS)].map((m) => m[0]) }))
    .filter((h) => h.phrases.length > 0);
  if (hits.length === 0) return [];
  const blocks = await ctx.page.evaluate(({ sels, blockSelector }) => sels.map((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const block = el.closest(blockSelector) ?? el;
    return {
      quoted: el.closest('blockquote, q, cite') !== null,
      text: (block instanceof HTMLElement ? block.innerText : block.textContent || '').replace(/\s+/g, ' ').trim(),
    };
  }), { sels: hits.map((h) => h.t.sel), blockSelector: BLOCKS });
  const sponsors = sponsorNames(ctx);
  /** @type {RuntimeFinding[]} */
  const out = [];
  hits.forEach((h, i) => {
    const block = blocks[i];
    if (!block || block.quoted || specific(block.text, sponsors)) return;
    out.push(finding(ctx, h.t.sel, { phrases: h.phrases, block: block.text.slice(0, 160) },
      `"${h.phrases.join('", "')}" in copy that names no figure and no sponsor: "${block.text.slice(0, 80)}"`));
  });
  return out.slice(0, MAX_FINDINGS);
}
