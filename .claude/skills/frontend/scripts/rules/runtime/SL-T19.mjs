// @ts-check
import { familyTable, glyphsByFamily, renderedFontUsage, sponsorsUsing, sumGlyphs } from './SL-T04.mjs';

/*
 * SL-T19 runtime: the dated reflex faces (FD10 T19, R19) as Chromium rendered them (CDP, shared with SL-T04): a
 * listed family that is the heading font, or that renders 25% or more of the text (Krebs's minTotalPct 25). The
 * owner's literal tell, Space Grotesk with Instrument Serif, is flagged in the value when both render.
 */

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('./SL-T04.mjs').FontNode} FontNode
 */

const RULE = 'SL-T19';

/** FD10 S19 / R19 and the registry scope: the reflex list. */
export const REFLEX_FAMILIES = Object.freeze(['Space Grotesk', 'Instrument Serif', 'Fraunces', 'Bricolage Grotesque', 'Syne', 'Sora', 'Young Serif']);
export const SHARE_MIN = 0.25;
/** Words a platform family name may carry after the family itself (weights, optical sizes, variable cuts). */
const SUFFIXES = new Set(['variable', 'var', 'vf', 'regular', 'italic', 'thin', 'extralight', 'light', 'book', 'medium', 'semibold',
  'bold', 'extrabold', 'black', 'heavy', 'display', 'text', 'soft', 'wonk', 'condensed', 'semicondensed', 'expanded']);

/**
 * @param {string} name
 * @returns {string} lower-case letters and digits only
 */
function compact(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const KEYS = new Map(REFLEX_FAMILIES.map((f) => [compact(f), f]));

/**
 * The listed family a rendered family name belongs to ("Space Grotesk Medium", "Fraunces 72pt Soft"), or null
 * ("Soraya" is not Sora).
 * @param {string} familyName
 * @returns {string | null}
 */
export function reflexFamily(familyName) {
  const words = String(familyName ?? '').toLowerCase().split(/[\s_-]+/).filter(Boolean);
  while (words.length > 1 && (SUFFIXES.has(words[words.length - 1]) || /^\d+(?:pt)?$/.test(words[words.length - 1]))) words.pop();
  return KEYS.get(compact(words.join(''))) ?? null;
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
 * One finding per listed family that is the heading font (most glyphs across h1-h3) or renders at least 25% of the
 * non-code glyphs.
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const usage = await renderedFontUsage(ctx);
  const prose = usage.nodes.filter((n) => !n.mono);
  const totals = glyphsByFamily(prose);
  const total = sumGlyphs(totals);
  if (total === 0) return [];
  const headingTable = familyTable(glyphsByFamily(prose.filter((n) => n.heading !== null && /^h[1-3]$/.test(n.heading))));
  const headingFont = headingTable.length > 0 ? headingTable[0].family : null;
  /** @type {Map<string, {glyphs: number, names: Set<string>, heading: boolean, first: FontNode | undefined}>} */
  const found = new Map();
  for (const [family, glyphs] of totals) {
    const listed = reflexFamily(family);
    if (!listed) continue;
    const entry = found.get(listed) ?? { glyphs: 0, names: new Set(), heading: false, first: undefined };
    entry.glyphs += glyphs;
    entry.names.add(family);
    if (family === headingFont) entry.heading = true;
    entry.first ??= prose.find((n) => n.fonts.some((f) => f.familyName === family));
    found.set(listed, entry);
  }
  const pair = found.has('Space Grotesk') && found.has('Instrument Serif');
  /** @type {RuntimeFinding[]} */
  const out = [];
  for (const [listed, entry] of found) {
    const share = entry.glyphs / total;
    if (!entry.heading && share < SHARE_MIN) continue;
    const sponsors = sponsorsUsing(ctx, new RegExp(`^${listed}$`, 'i'));
    out.push(finding(ctx, entry.first?.sel ?? 'body', {
      family: listed, rendered: [...entry.names], share: Math.round(share * 1000) / 1000, headingFont: entry.heading, pair,
      families: familyTable(totals).slice(0, 5), sponsorFont: sponsors,
    }, `${listed} ${entry.heading ? 'is the heading font' : 'renders'} (${Math.round(share * 100)}% of the text)${pair ? '; Space Grotesk and Instrument Serif render together' : ''}`));
  }
  return out;
}
