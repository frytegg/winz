// @ts-check
/*
 * SL-M13: template chrome: a "→" appended to button and link text, meta strings joined with middle dots ("A · B · C")
 * and monospace micro-labels in capitals, three of the "template chrome" traits Anthropic lists [FD15-F05] [FD10-F04].
 * Each is normal alone (arrows on "read more", middle dots in bylines, monospace for hashes and addresses), so the
 * rule counts density: at least two of the three kinds and MIN_TOTAL instances on the page [FD15-F05]. Code samples,
 * hashes, addresses and footer lines are left out.
 */
import { rendered, textRendered } from './SL-M01.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {import('../../lib/dom.mjs').TextInfo} TextInfo
 */

export const RULE = 'SL-M13';
export const MIN_KINDS = 2;
export const MIN_TOTAL = 4;
export const MICRO_LABEL_MAX_PX = 12;
const ARROW = /→\s*$/;
const MIDDOT = / · /;
const MONO = /mono|code|consolas|courier|menlo|monaco|cascadia|ui-monospace|monospace/i;
const HASHLIKE = /[0-9a-f]{8,}|\b(?:addr|stake)(?:_test)?1[0-9a-z]{6,}|\b0x[0-9a-f]{3,}/i;
const CODE_TAGS = new Set(['code', 'pre', 'kbd', 'samp']);

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const [elements, texts] = await Promise.all([ctx.cache.elements(), ctx.cache.text()]);
  const bySelector = new Map(elements.map((el, i) => [el.sel, i]));
  const inFooter = (/** @type {string} */ sel) => {
    for (let k = bySelector.get(sel) ?? -1; k >= 0; k = elements[k].parent) {
      if (elements[k].tag === 'footer' || elements[k].role === 'contentinfo') return true;
    }
    return false;
  };
  const arrows = elements.filter((el) => rendered(el) && isAction(el) && ARROW.test(el.text.trim()));
  const middots = texts.filter((t) => textRendered(t) && MIDDOT.test(t.text) && t.text.split(/\s+/).length <= 14 && !inFooter(t.sel));
  const labels = texts.filter((t) => textRendered(t) && isMonoMicroLabel(t));
  const kinds = [arrows.length, middots.length, labels.length].filter((n) => n > 0).length;
  const total = arrows.length + middots.length + labels.length;
  if (kinds < MIN_KINDS || total < MIN_TOTAL) return [];
  const items = [
    ...arrows.map((el) => ({ selector: el.sel, box: el.box, kind: 'arrow-suffix', text: el.text })),
    ...middots.map((t) => ({ selector: t.sel, box: t.box, kind: 'middle-dot-meta', text: t.text })),
    ...labels.map((t) => ({ selector: t.sel, box: t.box, kind: 'mono-micro-label', text: t.text })),
  ];
  return [{
    rule: RULE,
    layer: 'runtime',
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector: items[0].selector,
    box: items[0].box,
    value: { count: total, arrows: arrows.length, middots: middots.length, monoLabels: labels.length, items: items.slice(0, 12) },
    detail: `template chrome: ${arrows.length} arrow-suffixed action(s), ${middots.length} middle-dot meta line(s), ${labels.length} monospace capital micro-label(s); use plain labels`,
  }];
}

/**
 * Small (MICRO_LABEL_MAX_PX or less) monospace text in capitals that is not code, a hash or an address.
 * @param {TextInfo} t
 * @returns {boolean}
 */
export function isMonoMicroLabel(t) {
  if (t.fontSize > MICRO_LABEL_MAX_PX || CODE_TAGS.has(t.tag)) return false;
  const first = t.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
  if (!MONO.test(first)) return false;
  if (HASHLIKE.test(t.text)) return false;
  const letters = t.text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return false;
  return t.textTransform === 'uppercase' || letters === letters.toUpperCase();
}

/**
 * @param {ElementInfo} el
 * @returns {boolean}
 */
function isAction(el) {
  return el.role === 'button' || el.role === 'link' || el.tag === 'button' || el.tag === 'a';
}
