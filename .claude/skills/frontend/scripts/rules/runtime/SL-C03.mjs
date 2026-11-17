// @ts-check
/*
 * SL-C03: everything centred, one of the looks the built-in artifact-design skill lists ("everything centered") and
 * web-artifacts-builder calls "excessive centered layouts"; measurable as the share of text blocks with
 * text-align: center [FD15-F15] [FD15 Anthropic-named tells]. Counts headings, paragraphs, list items and quotes of
 * readable length outside navigation, footer and controls (a hero inside <header> counts); fires when most of them
 * are centred across several sections. A short one-column landing page is the documented false positive (category
 * allowlist).
 */
import { rendered } from './SL-M01.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 */

export const RULE = 'SL-C03';
export const MIN_BLOCKS = 8;
export const MIN_SHARE = 0.75;
export const MIN_SECTIONS = 3;
const MIN_CHARS = 15;
const TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'figcaption', 'dt', 'dd']);
const CHROME = new Set(['nav', 'footer', 'button', 'a', 'form', 'label']);
const SECTION_TAGS = new Set(['section', 'article', 'aside']);

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  const blocks = elements.map((_, i) => i).filter((i) => isTextBlock(elements, i));
  const centred = blocks.filter((i) => ['center', '-webkit-center'].includes(elements[i].styles.textAlign));
  const sections = new Set(centred.map((i) => sectionOf(elements, i)));
  if (blocks.length < MIN_BLOCKS || centred.length / blocks.length < MIN_SHARE || sections.size < MIN_SECTIONS) return [];
  const share = Math.round((centred.length / blocks.length) * 100) / 100;
  return [{
    rule: RULE,
    layer: 'runtime',
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector: elements[centred[0]].sel,
    box: elements[centred[0]].box,
    value: {
      count: centred.length,
      blocks: blocks.length,
      share,
      sections: sections.size,
      items: centred.slice(0, 12).map((i) => ({ selector: elements[i].sel, box: elements[i].box, text: elements[i].text.slice(0, 60) })),
    },
    detail: `${centred.length} of ${blocks.length} text blocks (${Math.round(share * 100)}%) are centred across ${sections.size} sections; align from the category's conventions`,
  }];
}

/**
 * A rendered heading, paragraph, list item or quote of MIN_CHARS or more, outside page chrome and controls.
 * @param {ElementInfo[]} elements
 * @param {number} i
 * @returns {boolean}
 */
export function isTextBlock(elements, i) {
  const el = elements[i];
  if (!rendered(el) || el.text.length < MIN_CHARS) return false;
  if (!TEXT_TAGS.has(el.tag) && el.role !== 'heading') return false;
  for (let k = el.parent; k >= 0; k = elements[k].parent) {
    const a = elements[k];
    if (CHROME.has(a.tag) || ['navigation', 'contentinfo'].includes(a.role)) return false;
  }
  return true;
}

/**
 * The section a block belongs to: its nearest section, article or aside, else the top-level block under main or
 * body that holds it.
 * @param {ElementInfo[]} elements
 * @param {number} i
 * @returns {number}
 */
export function sectionOf(elements, i) {
  let top = i;
  for (let k = elements[i].parent; k >= 0; k = elements[k].parent) {
    if (SECTION_TAGS.has(elements[k].tag)) return k;
    if (elements[k].tag === 'main' || elements[k].tag === 'body') return top;
    top = k;
  }
  return top;
}
