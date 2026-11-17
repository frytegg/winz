// @ts-check
/*
 * SL-M06: an FAQ accordion of three or more items, Krebs's faq-accordion pattern, on 15.5% of Show HN pages
 * [FD10-F11] [FD10 M06]. An accordion is three or more disclosure controls (details/summary, or buttons with
 * aria-expanded) grouped in one container; it counts when an FAQ heading precedes it or labels it, or when at least
 * three of its controls read as questions. Navigation menus (inside nav, or with aria-haspopup) are not accordions.
 * Genuine support content is the documented false positive (category allowlist).
 */
import { selectorFor } from '../../lib/dom.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').Box} Box
 * @typedef {{sel: string, box: Box, items: number, questions: number, heading: string}} Accordion
 */

export const RULE = 'SL-M06';
export const MAX_FINDINGS = 20;
export const MIN_ITEMS = 3;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const accordions = /** @type {Accordion[]} */ (
    await ctx.page.evaluate(`(${faqAccordions.toString()})(${selectorFor.toString()}, ${MIN_ITEMS})`)
  );
  return accordions.slice(0, MAX_FINDINGS).map((a) => ({
    rule: RULE,
    layer: /** @type {const} */ ('runtime'),
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector: a.sel,
    box: a.box,
    value: { items: a.items, questions: a.questions, heading: a.heading, total: accordions.length },
    detail: `FAQ accordion of ${a.items} items${a.heading ? ` under "${a.heading}"` : ''} (${a.questions} questions); answer inside the product narrative`,
  }));
}

/**
 * In-page: disclosure groups of `min` or more controls that read as an FAQ. Receives the selectorFor of lib/dom.mjs.
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorOf
 * @param {number} min
 * @returns {Accordion[]}
 */
export const faqAccordions = function faqAccordions(selectorOf, min) {
  const counts = new Map();
  const faq = /\b(?:faqs?|frequently asked|common questions|questions)\b/i;
  const triggers = Array.from(document.querySelectorAll('details > summary, button[aria-expanded], [role="button"][aria-expanded]')).filter((el) => {
    if (el.getClientRects().length === 0) return false;
    if (el.closest('nav, [role="navigation"], [role="menubar"], [role="menu"]')) return false;
    return !el.hasAttribute('aria-haspopup');
  });
  /** @param {Element} t @returns {Element} */
  const itemOf = (t) => (t.localName === 'summary' && t.parentElement ? t.parentElement : t);
  /** @type {Map<Element, Element[]>} */
  const groups = new Map();
  for (const t of triggers) {
    /** @type {Element | null} */
    let scope = itemOf(t).parentElement;
    for (let hop = 0; hop < 5 && scope; hop += 1, scope = scope.parentElement) {
      const inside = triggers.filter((u) => scope && scope.contains(u));
      if (inside.length >= min) {
        groups.set(scope, inside);
        break;
      }
    }
  }
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'));
  /** @type {Accordion[]} */
  const out = [];
  for (const [scope, inside] of groups) {
    if ([...groups.keys()].some((other) => other !== scope && scope.contains(other))) continue;
    const texts = inside.map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim());
    const questions = texts.filter((t) => /\?\s*$/.test(t)).length;
    const before = headings.filter((h) => h.compareDocumentPosition(inside[0]) & Node.DOCUMENT_POSITION_FOLLOWING && !inside.some((t) => t.contains(h)));
    const heading = before.length > 0 ? (before[before.length - 1].textContent || '').replace(/\s+/g, ' ').trim() : '';
    const labelled = faq.test(scope.getAttribute('aria-label') || '') || faq.test(heading);
    if (!labelled && questions < min) continue;
    const r = scope.getBoundingClientRect();
    out.push({
      sel: selectorOf(scope, counts),
      box: { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      items: inside.length,
      questions,
      heading: heading.slice(0, 80),
    });
  }
  return out;
};
