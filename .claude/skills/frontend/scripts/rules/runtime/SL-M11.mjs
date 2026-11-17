// @ts-check
/*
 * SL-M11: the bento grid: a CSS grid of more than four tile-styled cells whose spans differ, some spanning two or more
 * tracks beside single cells [FD10 M11]; Magic UI ships it as a component [FD10-F09]. Contested as a tell (0.1% of
 * comments, FD10-F10) and common on human sites, so it stays a weak signal; content with that real hierarchy is the
 * documented false positive (category allowlist). Spans are measured from the resolved track sizes, so explicit
 * `span`, line-number placement and unequal tracks all read alike.
 */
import { selectorFor } from '../../lib/dom.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').Box} Box
 * @typedef {{sel: string, box: Box, cells: number, columns: number, shapes: string[]}} Bento
 */

export const RULE = 'SL-M11';
export const MAX_FINDINGS = 20;
/** "More than 4 cells". */
export const MIN_CELLS = 5;
export const MIN_TILES = 4;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const grids = /** @type {Bento[]} */ (
    await ctx.page.evaluate(`(${bentoGrids.toString()})(${selectorFor.toString()}, ${MIN_CELLS}, ${MIN_TILES})`)
  );
  return grids.slice(0, MAX_FINDINGS).map((g) => ({
    rule: RULE,
    layer: /** @type {const} */ ('runtime'),
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector: g.sel,
    box: g.box,
    value: { cells: g.cells, columns: g.columns, shapes: g.shapes, total: grids.length },
    detail: `bento grid of ${g.cells} tiles on ${g.columns} columns with spans ${[...new Set(g.shapes)].join(', ')}; use it only when the content has that shape`,
  }));
}

/**
 * In-page: grids with at least `minCells` laid-out cells, at least `minTiles` styled as tiles, at least one cell
 * spanning two or more tracks (short of the full width) and at least two single cells. Receives the selectorFor of
 * lib/dom.mjs.
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorOf
 * @param {number} minCells
 * @param {number} minTiles
 * @returns {Bento[]}
 */
export const bentoGrids = function bentoGrids(selectorOf, minCells, minTiles) {
  const counts = new Map();
  /** @type {Bento[]} */
  const out = [];
  /** @param {string} value @param {number} gap @returns {Array<[number, number]>} track intervals from the content edge */
  const tracks = (value, gap) => {
    const sizes = value.split(/\s+/).map((t) => Number.parseFloat(t)).filter((n) => Number.isFinite(n) && n > 0);
    /** @type {Array<[number, number]>} */
    const spans = [];
    let at = 0;
    for (const size of sizes) {
      spans.push([at, at + size]);
      at += size + gap;
    }
    return spans;
  };
  /** @param {Array<[number, number]>} list @param {number} start @param {number} end @returns {number} */
  const covered = (list, start, end) => list.filter(([s, e]) => Math.min(end, e) - Math.max(start, s) >= 0.5 * (e - s)).length;
  /** @param {string} css @returns {number} */
  const alpha = (css) => {
    if (!css || css === 'transparent') return 0;
    const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(css);
    if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
    const comma = /^rgba\([^)]*,\s*([\d.]+)\s*\)$/.exec(css);
    return comma ? Number(comma[1]) : 1;
  };
  for (const grid of Array.from(document.querySelectorAll('body *'))) {
    const cs = getComputedStyle(grid);
    if (cs.display !== 'grid' && cs.display !== 'inline-grid') continue;
    const cells = Array.from(grid.children).filter((c) => {
      const s = getComputedStyle(c);
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && s.position !== 'absolute' && s.position !== 'fixed';
    });
    if (cells.length < minCells) continue;
    const cols = tracks(cs.gridTemplateColumns, Number.parseFloat(cs.columnGap) || 0);
    const rows = tracks(cs.gridTemplateRows, Number.parseFloat(cs.rowGap) || 0);
    if (cols.length < 2) continue;
    const g = grid.getBoundingClientRect();
    const left = g.left + (Number.parseFloat(cs.borderLeftWidth) || 0) + (Number.parseFloat(cs.paddingLeft) || 0);
    const top = g.top + (Number.parseFloat(cs.borderTopWidth) || 0) + (Number.parseFloat(cs.paddingTop) || 0);
    const shapes = cells.map((c) => {
      const r = c.getBoundingClientRect();
      const cw = Math.max(1, covered(cols, r.left - left, r.right - left));
      const rh = rows.length > 0 ? Math.max(1, covered(rows, r.top - top, r.bottom - top)) : 1;
      return [cw, rh];
    });
    const spanning = shapes.filter(([w, h]) => (w >= 2 && w < cols.length) || h >= 2).length;
    const singles = shapes.filter(([w, h]) => w === 1 && h === 1).length;
    const tiles = cells.filter((c) => {
      const s = getComputedStyle(c);
      return alpha(s.backgroundColor) >= 0.3 || (Number.parseFloat(s.borderTopWidth) || 0) >= 1 || (Number.parseFloat(s.borderTopLeftRadius) || 0) >= 6 || s.boxShadow !== 'none';
    }).length;
    if (spanning < 1 || singles < 2 || tiles < minTiles) continue;
    if (new Set(shapes.map((s) => s.join('x'))).size < 2) continue;
    out.push({
      sel: selectorOf(grid, counts),
      box: { x: Math.round(g.left + window.scrollX), y: Math.round(g.top + window.scrollY), w: Math.round(g.width), h: Math.round(g.height) },
      cells: cells.length,
      columns: cols.length,
      shapes: shapes.map((s) => s.join('x')),
    });
  }
  return out;
};
