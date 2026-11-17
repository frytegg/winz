// @ts-check
/*
 * SL-M17: "Built for X" and "Trusted by" headline formulas: impeccable's phrases "built for the modern" and "trusted
 * by leading" [FD10-F19] [FD10 M17], and "Built for the …" among the stock section templates that separate the
 * generated corpora [FD14-F15]. A phrase match on rendered headings (laid out, even if waiting for a reveal). A real
 * audience statement is the documented false positive.
 */

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 */

export const RULE = 'SL-M17';
export const MAX_FINDINGS = 20;
export const FORMULAS = Object.freeze([
  { id: 'built-for', re: /\bbuilt for\b/i },
  { id: 'trusted-by', re: /\btrusted by\b/i },
]);

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  /** @type {Array<{selector: string, box: import('../../lib/dom.mjs').Box, formula: string, text: string}>} */
  const items = [];
  elements.forEach((el, i) => {
    if (!isHeading(el) || el.box.w < 1 || el.box.h < 1) return;
    if (insideHeading(elements, i)) return;
    const formula = FORMULAS.find((f) => f.re.test(el.text));
    if (formula) items.push({ selector: el.sel, box: el.box, formula: formula.id, text: el.text.slice(0, 120) });
  });
  return items.slice(0, MAX_FINDINGS).map(({ selector, box, ...value }) => ({
    rule: RULE,
    layer: /** @type {const} */ ('runtime'),
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector,
    box,
    value: { ...value, total: items.length },
    detail: `headline formula (${value.formula}): "${value.text}"; say what the protocol does and for whom`,
  }));
}

/**
 * @param {ElementInfo} el
 * @returns {boolean}
 */
function isHeading(el) {
  return /^h[1-6]$/.test(el.tag) || el.role === 'heading';
}

/**
 * @param {ElementInfo[]} elements
 * @param {number} i
 * @returns {boolean}
 */
function insideHeading(elements, i) {
  for (let k = elements[i].parent; k >= 0; k = elements[k].parent) if (isHeading(elements[k])) return true;
  return false;
}
