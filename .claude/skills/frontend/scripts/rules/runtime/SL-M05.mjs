// @ts-check
/*
 * SL-M05: fake social proof: avatars from generator services (randomuser.me, i.pravatar.cc), a "Trusted by" row of
 * logos none of which links anywhere, and sets of testimonial cards (a quote plus a person's name) with no ledger,
 * source or proof marker [FD10 M05] [FD10-F28]. Invented testimonials are also a truthfulness problem before a jury
 * [FD10-F28]; real partners with permission are the false positive, so a quote card carrying data-ledger,
 * data-source or data-proof is left alone.
 */
import { selectorFor } from '../../lib/dom.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').Box} Box
 * @typedef {{kind: string, sel: string, text: string, box: Box}} Hit
 */

export const RULE = 'SL-M05';
export const MAX_FINDINGS = 20;
export const MIN_LOGOS = 3;
export const MIN_TESTIMONIALS = 2;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const hits = /** @type {Hit[]} */ (
    await ctx.page.evaluate(`(${socialProof.toString()})(${selectorFor.toString()}, ${MIN_LOGOS}, ${MIN_TESTIMONIALS})`)
  );
  return hits.slice(0, MAX_FINDINGS).map((h) => ({
    rule: RULE,
    layer: /** @type {const} */ ('runtime'),
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector: h.sel,
    box: h.box,
    value: { kind: h.kind, text: h.text, total: hits.length },
    detail: `unsourced social proof (${h.kind}): "${h.text}"; omit it, or cite real relations with proof`,
  }));
}

/**
 * In-page: avatar-generator images, unlinked "Trusted by" logo rows, and sets of testimonial cards without a source
 * marker. Receives the selectorFor of lib/dom.mjs.
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorOf
 * @param {number} minLogos
 * @param {number} minTestimonials
 * @returns {Hit[]}
 */
export const socialProof = function socialProof(selectorOf, minLogos, minTestimonials) {
  const counts = new Map();
  /** @type {Hit[]} */
  const out = [];
  /** @param {Element} el */
  const laidOut = (el) => el.getClientRects().length > 0;
  /** @param {string} kind @param {Element} el @param {string} text */
  const add = (kind, el, text) => {
    const r = el.getBoundingClientRect();
    out.push({ kind, sel: selectorOf(el, counts), text: text.replace(/\s+/g, ' ').trim().slice(0, 120), box: { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) } });
  };
  /** @param {Element} el @returns {string} */
  const ownText = (el) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue || '').join(' ').replace(/\s+/g, ' ').trim();
  const generator = /^https?:\/\/(?:[^/]*\.)?(?:randomuser\.me|pravatar\.cc)\//i;
  for (const img of Array.from(document.images)) {
    const src = img.currentSrc || img.src;
    if (generator.test(src) && laidOut(img)) add('avatar-generator', img, src);
  }
  for (const el of Array.from(document.querySelectorAll('[style*="randomuser.me"], [style*="pravatar.cc"]'))) {
    if (laidOut(el)) add('avatar-generator', el, getComputedStyle(el).backgroundImage);
  }

  const all = Array.from(document.body ? document.body.querySelectorAll('*') : []);
  for (const label of all) {
    const text = ownText(label);
    if (!/\btrusted by\b/i.test(text) || text.length > 80 || !laidOut(label)) continue;
    /** @type {Element | null} */
    let scope = label.parentElement;
    for (let hop = 0; hop < 3 && scope; hop += 1, scope = scope.parentElement) {
      const logos = Array.from(scope.querySelectorAll('img, svg')).filter((logo) => {
        if (logo.parentElement && logo.parentElement.closest('svg')) return false;
        if (!(label.compareDocumentPosition(logo) & Node.DOCUMENT_POSITION_FOLLOWING) || !laidOut(logo)) return false;
        const r = logo.getBoundingClientRect();
        return r.height >= 12 && r.height <= 120 && r.width >= 24;
      });
      if (logos.length < minLogos) continue;
      const unlinked = logos.filter((logo) => !logo.closest('a[href]'));
      const tops = unlinked.map((logo) => logo.getBoundingClientRect().top);
      const row = tops.filter((t) => tops.filter((u) => Math.abs(u - t) <= 24).length >= minLogos).length;
      if (unlinked.length >= minLogos && row >= minLogos) add('trusted-by-unlinked-logos', label, `${text} (${unlinked.length} unlinked logos)`);
      break;
    }
  }

  const name = /^[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’.-]+){1,2}(?:\s*[,—–-].*)?$/u;
  /** @type {Map<Element, Element[]>} */
  const cardsByParent = new Map();
  const quotes = all.filter((el) => {
    const quoted = el.matches('blockquote, q') || (/^["“«‘]/.test(ownText(el)) && !el.parentElement?.closest('blockquote, q'));
    if (!quoted || !laidOut(el) || el.closest('nav, header, footer')) return false;
    return (el instanceof HTMLElement ? el.innerText : el.textContent || '').trim().split(/\s+/).length >= 8;
  });
  for (const quote of quotes) {
    /** @type {Element | null} */
    let card = quote.parentElement;
    for (let hop = 0; hop < 4 && card; hop += 1, card = card.parentElement) {
      const scope = card;
      if (quotes.some((other) => other !== quote && scope.contains(other))) break;
      const attribution = Array.from(card.querySelectorAll('cite, figcaption, p, span, div, strong, b, h3, h4, h5, h6')).find((el) => {
        if (el === quote || quote.contains(el) || el.contains(quote)) return false;
        const caption = el.matches('cite, figcaption');
        const t = caption ? (el.textContent || '').trim() : ownText(el);
        return t.length > 0 && t.split(/\s+/).length <= (caption ? 16 : 8) && (caption || name.test(t));
      });
      if (!attribution) continue;
      if (!card.closest('[data-ledger], [data-source], [data-proof]')) {
        const parent = card.parentElement || card;
        cardsByParent.set(parent, [...(cardsByParent.get(parent) || []), card]);
      }
      break;
    }
  }
  for (const cards of cardsByParent.values()) {
    const unique = [...new Set(cards)];
    if (unique.length >= minTestimonials) add('testimonial-cards', unique[0], `${unique.length} quote cards with names, e.g. ${(unique[0].textContent || '').trim().slice(0, 80)}`);
  }
  return out;
};
