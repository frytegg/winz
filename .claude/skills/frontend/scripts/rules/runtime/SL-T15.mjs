// @ts-check
import { laidOut } from './SL-T01.mjs';

/*
 * SL-T15 runtime: inconsistent spacing, measured as FD17-F21 and FD10 R15 propose, on rendered geometry: distinct
 * section paddings, near-miss alignment between siblings, uneven gaps between repeated siblings, and inverted
 * heading rhythm. The share of values off the 4 px grid is reported as context only: FD17-F21 found generated
 * Tailwind pages more grid-regular than human ones, so it must never fire on its own. Every limit is FD17's
 * provisional value, to be calibrated.
 */

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {'section-paddings' | 'near-miss' | 'gap-variance' | 'heading-rhythm'} Check
 */

const RULE = 'SL-T15';

/** FD17 B4 provisional limits: at most 3 distinct section paddings, 0 near-misses, gap CV at most 0.15. */
export const SECTION_PADDINGS_MAX = 3;
export const NEAR_MISS_MAX = 0;
export const GAP_CV_MAX = 0.15;
/** Edges within 2 px are aligned; 3 to 6 px apart is a near-miss (FD17-F21). */
export const ALIGNED_PX = 2;
export const NEAR_MISS_PX = Object.freeze([3, 6]);
/** Values within 2 px count as one padding. */
export const SAME_PADDING_PX = 2;
/** Heading rhythm (impeccable): more space below a heading than above it, on half or more of 3+ headings. */
export const RHYTHM_SHARE = 0.5;
export const RHYTHM_MIN_HEADINGS = 3;
/** Sections need this many to compare; a section is at least this tall. */
export const SECTIONS_MIN = 3;
export const SECTION_MIN_HEIGHT = 80;
/** Off-grid context: the 4 px unit, with half a pixel of rounding. */
export const GRID_UNIT = 4;
/** Siblings compared pairwise per parent (long lists are cut, the comparison is quadratic). */
export const SIBLINGS_MAX = 200;
/** A heading's own label (eyebrow, step number): this many words or fewer, set smaller than the heading. */
export const KICKER_WORDS_MAX = 6;

const BLOCK_DISPLAYS = /^(?:block|flex|grid|flow-root|table|list-item)$/;

/**
 * @param {string} css
 * @returns {number}
 */
function px(css) {
  const n = Number.parseFloat(css);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Groups numbers that sit within `tolerance` of each other's cluster start; returns the cluster count.
 * @param {number[]} values
 * @param {number} tolerance
 * @returns {number[]} cluster representatives
 */
export function clusters(values, tolerance) {
  /** @type {number[]} */
  const reps = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    if (reps.length === 0 || v - reps[reps.length - 1] > tolerance) reps.push(v);
  }
  return reps;
}

/**
 * Coefficient of variation (population standard deviation over mean).
 * @param {number[]} values
 * @returns {number}
 */
export function cv(values) {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean <= 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Share of the non-zero computed margins, paddings and gaps that are off the 4 px grid.
 * @param {ElementInfo[]} elements
 * @returns {{share: number, values: number}}
 */
export function offGrid(elements) {
  let off = 0;
  let all = 0;
  for (const e of elements) {
    if (!laidOut(e)) continue;
    for (const key of ['marginTop', 'marginBottom', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'gap']) {
      const v = px(e.styles[key]);
      if (v <= 0) continue;
      all += 1;
      const r = v % GRID_UNIT;
      if (Math.min(r, GRID_UNIT - r) > 0.5) off += 1;
    }
  }
  return { share: all > 0 ? Math.round((off / all) * 100) / 100 : 0, values: all };
}

/**
 * The laid-out, in-flow block children of every element, by parent index. For geometry, transformed elements are
 * left out (`keepTransformed` false): their box is the bounding box of the transform (a spinning loader, a reveal
 * still offset), not where layout placed them. Paddings do not depend on transforms, so sections keep them.
 * @param {ElementInfo[]} elements
 * @param {{keepTransformed?: boolean}} [options]
 * @returns {Map<number, number[]>}
 */
function blockChildren(elements, { keepTransformed = false } = {}) {
  /** @type {Map<number, number[]>} */
  const map = new Map();
  elements.forEach((e, i) => {
    if (!laidOut(e) || e.parent < 0 || e.box.w < 1 || e.box.h < 1) return;
    if (!BLOCK_DISPLAYS.test(e.styles.display ?? '') || e.styles.position === 'absolute' || e.styles.position === 'fixed') return;
    if (!keepTransformed && (e.styles.transform ?? 'none') !== 'none') return;
    const list = map.get(e.parent) ?? [];
    list.push(i);
    map.set(e.parent, list);
  });
  return map;
}

/**
 * Top-level sections: `section` elements, or the block children of `main` (of the body when there is no main).
 * @param {ElementInfo[]} elements
 * @param {Map<number, number[]>} children
 * @returns {number[]}
 */
function sectionsOf(elements, children) {
  const tagged = elements.map((e, i) => (laidOut(e) && e.tag === 'section' && e.box.h >= SECTION_MIN_HEIGHT ? i : -1)).filter((i) => i >= 0);
  if (tagged.length >= SECTIONS_MIN) return tagged;
  const main = elements.findIndex((e) => e.tag === 'main' && laidOut(e));
  return (children.get(main >= 0 ? main : 0) ?? []).filter((i) => elements[i].box.h >= SECTION_MIN_HEIGHT);
}

/**
 * Near-miss pairs among siblings: stacked siblings whose left, right and centre lines all miss each other, with the
 * left edges 3 to 6 px apart; side-by-side siblings of one height whose top edges are 3 to 6 px apart (siblings of
 * different heights may sit on a shared baseline, which is alignment too).
 * @param {ElementInfo[]} elements
 * @param {Map<number, number[]>} children
 * @returns {Array<{parent: number, a: number, b: number, axis: 'x' | 'y', offset: number}>}
 */
export function nearMisses(elements, children) {
  const out = [];
  const [lo, hi] = NEAR_MISS_PX;
  for (const [parent, all] of children) {
    const kids = all.slice(0, SIBLINGS_MAX);
    for (let i = 0; i < kids.length; i += 1) {
      for (let j = i + 1; j < kids.length; j += 1) {
        const a = elements[kids[i]].box;
        const b = elements[kids[j]].box;
        if (a.w < 16 || b.w < 16 || a.h < 8 || b.h < 8) continue;
        const stacked = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0 && (a.y + a.h <= b.y + 1 || b.y + b.h <= a.y + 1);
        const sideBySide = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0 && (a.x + a.w <= b.x + 1 || b.x + b.w <= a.x + 1);
        if (stacked) {
          const left = Math.abs(a.x - b.x);
          const right = Math.abs(a.x + a.w - (b.x + b.w));
          const centre = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
          if (left <= ALIGNED_PX || right <= ALIGNED_PX || centre <= ALIGNED_PX) continue;
          if (left >= lo && left <= hi) out.push({ parent, a: kids[i], b: kids[j], axis: /** @type {const} */ ('x'), offset: Math.round(left * 10) / 10 });
        } else if (sideBySide && Math.abs(a.h - b.h) <= ALIGNED_PX) {
          const top = Math.abs(a.y - b.y);
          const bottom = Math.abs(a.y + a.h - (b.y + b.h));
          const middle = Math.abs(a.y + a.h / 2 - (b.y + b.h / 2));
          if (top <= ALIGNED_PX || bottom <= ALIGNED_PX || middle <= ALIGNED_PX) continue;
          if (top >= lo && top <= hi) out.push({ parent, a: kids[i], b: kids[j], axis: /** @type {const} */ ('y'), offset: Math.round(top * 10) / 10 });
        }
      }
    }
  }
  return out;
}

/**
 * Gaps inside runs of repeated siblings: three or more consecutive siblings of one tag and class (another sibling in
 * between ends the run), laid out in one column or one row.
 * @param {ElementInfo[]} elements
 * @param {Map<number, number[]>} children
 * @returns {Array<{parent: number, gaps: number[], cv: number}>}
 */
export function repeatedGaps(elements, children) {
  const out = [];
  for (const [parent, kids] of children) {
    /** @type {number[][]} */
    const runs = [];
    let lastKey = '';
    for (const k of kids) {
      const key = `${elements[k].tag}.${elements[k].meta.class ?? ''}`;
      if (key === lastKey) runs[runs.length - 1].push(k);
      else runs.push([k]);
      lastKey = key;
    }
    for (const group of runs) {
      if (group.length < 3) continue;
      const boxes = group.map((k) => elements[k].box);
      const column = boxes.every((b, i) => i === 0 || Math.abs(b.x - boxes[0].x) <= ALIGNED_PX);
      const row = boxes.every((b, i) => i === 0 || Math.abs(b.y - boxes[0].y) <= ALIGNED_PX);
      if (!column && !row) continue;
      const sorted = [...boxes].sort((a, b) => (column ? a.y - b.y : a.x - b.x));
      const gaps = sorted.slice(1).map((b, i) => (column ? b.y - (sorted[i].y + sorted[i].h) : b.x - (sorted[i].x + sorted[i].w)));
      if (gaps.some((g) => g <= 0)) continue;
      out.push({ parent, gaps: gaps.map((g) => Math.round(g * 10) / 10), cv: Math.round(cv(gaps) * 1000) / 1000 });
    }
  }
  return out;
}

/**
 * Whether a sibling just above a heading is its label (an eyebrow, a "01" marker): a few words set smaller than the
 * heading. The space between them belongs to the heading group, not to the rhythm between sections.
 * @param {ElementInfo} label
 * @param {ElementInfo} heading
 * @returns {boolean}
 */
function labelsHeading(label, heading) {
  const words = label.text.split(/\s+/).filter(Boolean).length;
  return words > 0 && words <= KICKER_WORDS_MAX && px(label.styles.fontSize) < px(heading.styles.fontSize);
}

/**
 * Headings with a content block before and after them (a label right above a heading does not count as the content
 * before it), and the space above and below each.
 * @param {ElementInfo[]} elements
 * @param {Map<number, number[]>} children
 * @returns {Array<{index: number, above: number, below: number}>}
 */
export function headingRhythm(elements, children) {
  const out = [];
  for (const kids of children.values()) {
    for (let i = 1; i < kids.length - 1; i += 1) {
      const h = elements[kids[i]];
      if (!/^h[2-4]$/.test(h.tag) || labelsHeading(elements[kids[i - 1]], h)) continue;
      const prev = elements[kids[i - 1]].box;
      const next = elements[kids[i + 1]].box;
      const above = h.box.y - (prev.y + prev.h);
      const below = next.y - (h.box.y + h.box.h);
      if (above < 0 || below < 0) continue;
      out.push({ index: kids[i], above: Math.round(above), below: Math.round(below) });
    }
  }
  return out;
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
 * At most one finding per spacing check that exceeds its provisional limit; `value.check` names it.
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  const children = blockChildren(elements);
  const grid = offGrid(elements);
  /** @type {RuntimeFinding[]} */
  const out = [];
  const sections = sectionsOf(elements, blockChildren(elements, { keepTransformed: true }));
  if (sections.length >= SECTIONS_MIN) {
    const paddings = sections.flatMap((i) => [px(elements[i].styles.paddingTop), px(elements[i].styles.paddingBottom)]).filter((v) => v > 0);
    const distinct = clusters(paddings, SAME_PADDING_PX);
    if (distinct.length > SECTION_PADDINGS_MAX) {
      const parent = elements[sections[0]].parent;
      out.push(finding(ctx, parent >= 0 ? elements[parent].sel : elements[sections[0]].sel, {
        check: 'section-paddings', distinct: distinct.map(Math.round), sections: sections.length, limit: SECTION_PADDINGS_MAX, offGrid: grid,
      }, `${distinct.length} distinct vertical paddings across ${sections.length} sections (${distinct.map(Math.round).join(', ')} px)`));
    }
  }
  const misses = nearMisses(elements, children);
  if (misses.length > NEAR_MISS_MAX) {
    const first = misses[0];
    out.push(finding(ctx, elements[first.parent].sel, {
      check: 'near-miss', count: misses.length, limit: NEAR_MISS_MAX, offGrid: grid,
      pairs: misses.slice(0, 8).map((m) => ({ a: elements[m.a].sel, b: elements[m.b].sel, axis: m.axis, offset: m.offset })),
    }, `${misses.length} sibling pair(s) whose edges miss by 3-6 px (first: ${first.offset}px on ${first.axis})`));
  }
  const uneven = repeatedGaps(elements, children).filter((g) => g.cv > GAP_CV_MAX).sort((a, b) => b.cv - a.cv);
  if (uneven.length > 0) {
    out.push(finding(ctx, elements[uneven[0].parent].sel, {
      check: 'gap-variance', groups: uneven.length, worst: { gaps: uneven[0].gaps, cv: uneven[0].cv }, limit: GAP_CV_MAX, offGrid: grid,
    }, `${uneven.length} run(s) of repeated siblings with uneven gaps (worst ${uneven[0].gaps.join('/')} px, CV ${uneven[0].cv})`));
  }
  const rhythm = headingRhythm(elements, children);
  const inverted = rhythm.filter((r) => r.above < r.below);
  if (rhythm.length >= RHYTHM_MIN_HEADINGS && inverted.length / rhythm.length >= RHYTHM_SHARE) {
    out.push(finding(ctx, elements[inverted[0].index].sel, {
      check: 'heading-rhythm', inverted: inverted.length, headings: rhythm.length, offGrid: grid,
      sample: inverted.slice(0, 5).map((r) => ({ heading: elements[r.index].sel, above: r.above, below: r.below })),
    }, `${inverted.length} of ${rhythm.length} headings sit closer to the content above than to their own section`));
  }
  return out;
}
