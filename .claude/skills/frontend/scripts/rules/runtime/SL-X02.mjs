// @ts-check
/*
 * SL-X02: placeholder names and copy left in the rendered page: Acme, John Doe, Jane Doe, lorem ipsum, TODO,
 * example.com, bracketed "[YOUR ...]" slots [FD10-F28] [FD13], and unrendered `{{template}}` slots such as the
 * hand-off placeholders found in a generated export [FD14-F22]. Only laid-out text counts (text waiting at opacity 0
 * still renders later); code samples are skipped, and a name or example address used as an input's placeholder is
 * the form-field convention, not invented content. The document title counts: it renders in the tab.
 */
import { selectorFor } from '../../lib/dom.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').Box} Box
 * @typedef {{sel: string, text: string, source: 'text' | 'placeholder' | 'value' | 'title', box: Box | null}} Rendered
 * @typedef {{id: string, re: RegExp, formConvention: boolean}} Placeholder
 */

export const RULE = 'SL-X02';
export const MAX_FINDINGS = 20;

/** @type {ReadonlyArray<Placeholder>} */
export const PLACEHOLDERS = Object.freeze([
  { id: 'acme', re: /\bAcme\b/i, formConvention: false },
  { id: 'john-doe', re: /\bJohn Doe\b/i, formConvention: true },
  { id: 'jane-doe', re: /\bJane Doe\b/i, formConvention: true },
  { id: 'lorem-ipsum', re: /\blorem ipsum\b|\bdolor sit amet\b|\blorem\b/i, formConvention: false },
  { id: 'todo', re: /\bTODO\b/, formConvention: false },
  { id: 'example-domain', re: /\bexample\.(?:com|org|net)\b/i, formConvention: true },
  { id: 'your-slot', re: /\[\s*YOUR\b[^\]]*\]/i, formConvention: false },
  { id: 'template-slot', re: /\{\{\s*[\w.-]+\s*\}\}/, formConvention: false },
]);

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const prefilter = PLACEHOLDERS.map((p) => p.re.source).join('|');
  const strings = /** @type {Rendered[]} */ (
    await ctx.page.evaluate(`(${renderedStrings.toString()})(${selectorFor.toString()}, ${JSON.stringify(prefilter)})`)
  );
  const items = placeholderItems(strings);
  return items.slice(0, MAX_FINDINGS).map((item) => {
    const { selector, box, ...value } = item;
    return {
      rule: RULE,
      layer: /** @type {const} */ ('runtime'),
      route: ctx.route?.path ?? '',
      viewport: ctx.viewport?.name ?? '',
      selector,
      box,
      value: { ...value, total: items.length },
      detail: `placeholder "${item.match}" (${item.pattern}, ${item.source}) rendered; use real content from the brief or the visible "not yet verified" state`,
    };
  });
}

/**
 * Placeholder matches in rendered strings, one item per string and pattern; form-field conventions in input
 * placeholders are left out.
 * @param {Rendered[]} strings
 * @returns {Array<{selector: string, box: Box | null, pattern: string, match: string, source: string, text: string}>}
 */
export function placeholderItems(strings) {
  /** @type {Array<{selector: string, box: Box | null, pattern: string, match: string, source: string, text: string}>} */
  const out = [];
  for (const s of strings) {
    for (const p of PLACEHOLDERS) {
      if (p.formConvention && s.source === 'placeholder') continue;
      const m = p.re.exec(s.text);
      if (m) out.push({ selector: s.sel, box: s.box, pattern: p.id, match: m[0], source: s.source, text: s.text.slice(0, 120) });
    }
  }
  return out;
}

/**
 * In-page: rendered strings that match the prefilter: text nodes of laid-out elements (code samples skipped), input
 * placeholders and button values, and the document title. Receives the selectorFor of lib/dom.mjs.
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorOf
 * @param {string} prefilter regular expression source, matched case-insensitively
 * @returns {Rendered[]}
 */
export const renderedStrings = function renderedStrings(selectorOf, prefilter) {
  const re = new RegExp(prefilter, 'i');
  const counts = new Map();
  /** @type {Rendered[]} */
  const out = [];
  const skip = 'script, style, noscript, template, code, pre, kbd, samp, textarea, title, head';
  /** @param {Element} el */
  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };
  if (document.title && re.test(document.title)) out.push({ sel: 'title', text: document.title.trim(), source: 'title', box: null });
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
    const owner = node.parentElement;
    if (!text || !owner || !re.test(text) || owner.closest(skip)) continue;
    if (owner.getClientRects().length === 0) continue;
    out.push({ sel: selectorOf(owner, counts), text: text.slice(0, 300), source: 'text', box: boxOf(owner) });
    if (out.length >= 200) break;
  }
  for (const field of Array.from(document.querySelectorAll('input, textarea'))) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) continue;
    if (field.getClientRects().length === 0) continue;
    const isButton = field instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(field.type);
    const text = isButton ? field.value : field.placeholder;
    if (text && re.test(text)) out.push({ sel: selectorOf(field, counts), text: text.slice(0, 300), source: isButton ? 'value' : 'placeholder', box: boxOf(field) });
  }
  return out;
};
