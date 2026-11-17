// @ts-check
/**
 * First-view gates (CONTRACTS section 4, references/10-gates.md GT-18, references/06-build.md BD-01 to BD-03), on
 * the first route of design/routes.json.
 *
 * - firstview.contract: in the first viewport at the desktop and mobile viewports, at load (scroll 0, after
 *   readiness): exactly one visible h1 of 2 to 8 words wholly above the fold; one visible [data-hero="sentence"] of
 *   5 to 40 words wholly above the fold; one sponsor name in visible text; one visible data-metric holding a digit,
 *   wholly above the fold, with data-ledger or data-source plus data-as-of; and a visible [data-surface="product"]
 *   showing at least a quarter of the viewport height (or all of itself) above the fold. Exemplar headlines run 2 to
 *   6 words with an explanatory sentence, live figures and the product in view [FD11-F17, FD11-F18, FD11-F20].
 * - firstview.complexity: the size of the first viewport saved as JPEG at quality 70, a visual-complexity proxy
 *   [FD11-F05], compared with the band the profile or the calibration file gives. Until a band is calibrated the
 *   gate reports and passes (advisory).
 *
 * The provisional band is the research's ten exemplar first viewports (1440x900), which span 47-133 KiB as PIL
 * JPEG q70 [FD11-F05]. This gate encodes with Chromium, whose JPEG q70 is 3-19 % smaller on the same pixels: the ten
 * captures in research/assets/evidence-first-impressions-jury/ re-encoded by Chromium 147 on 2026-10-01 span
 * 38.1-119.7 KiB, so that is the band on this gate's scale.
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/args.mjs';
import { EnvError, UsageError, exitWith } from './lib/errors.mjs';
import { readText, toPosix } from './lib/fsutil.mjs';
import { gate } from './lib/report.mjs';
import { wordCount } from './lib/text.mjs';
import { readBrief, selectedIds, sponsorNames } from './brief.mjs';
import { DATA_SOURCES, SHARED_HELP, comparable, contextViewports, evaluateProbe, loadPage, runModuleCli } from './coverage.mjs';

/**
 * @typedef {import('./coverage.mjs').CheckContext} CheckContext
 * @typedef {import('./coverage.mjs').PageTools} PageTools
 * @typedef {import('./coverage.mjs').Box} Box
 * @typedef {import('./coverage.mjs').MetricMarkers} MetricMarkers
 * @typedef {import('./lib/profile.mjs').Profile} Profile
 * @typedef {import('./lib/profile.mjs').Viewport} Viewport
 * @typedef {import('./lib/routes.mjs').Route} Route
 * @typedef {import('./lib/report.mjs').GateResult} GateResult
 * @typedef {import('./lib/report.mjs').Evidence} Evidence
 * @typedef {{sel: string, text: string, visible: boolean, box: Box}} Item
 * @typedef {{viewport: {w: number, h: number}, scroll: {x: number, y: number}, h1s: Item[], sentences: Item[],
 *   metrics: Array<Item & MetricMarkers>, surfaces: Item[], texts: Array<{sel: string, text: string}>}} FirstviewProbe
 * @typedef {{route: Route, viewport: Viewport, url: string, status: number | null, probe: FirstviewProbe | null,
 *   error: string | null}} FirstviewPage
 * @typedef {{width: number, height: number, dpr: number, quality: number, min_kib: number, max_kib: number,
 *   calibrated: boolean, source: string}} Band
 */

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Written by calibration once the band is measured on the category exemplars and the owner's labels. */
export const CALIBRATION_FILE = toPosix(path.join(SKILL_DIR, 'calibration', 'firstview-complexity.json'));

export const GATES = Object.freeze([
  Object.freeze({
    id: 'firstview.contract',
    title: 'The first viewport at desktop and mobile holds one short H1, one sentence, the sponsor name, one sourced figure and the product',
    ifDropped: 'a judge could leave the first screen without knowing what it is, does and fixes',
  }),
  Object.freeze({
    id: 'firstview.complexity',
    title: 'First-viewport complexity (JPEG quality-70 size) within the category band',
    ifDropped: 'a cluttered first screen would pass',
  }),
]);

/** Word bounds of the first-view headline: exemplars run 2 to 6 words [FD11-F17], with slack to 8. */
export const H1_WORDS = Object.freeze({ min: 2, max: 8 });
/** Word bounds of the explanatory sentence: one sentence naming user, action and object, never a paragraph. */
export const SENTENCE_WORDS = Object.freeze({ min: 5, max: 40 });
/** Share of the viewport height of the product surface that must sit above the fold (or all of it when shorter). */
export const PRODUCT_SHARE = 0.25;

/** @type {Readonly<Band>} */
export const PROVISIONAL_BAND = Object.freeze({
  width: 1440,
  height: 900,
  dpr: 1,
  quality: 70,
  min_kib: 38.1,
  max_kib: 119.7,
  calibrated: false,
  source: 'FD11-F05 exemplars (PIL q70 47-133 KiB) re-encoded by Chromium 147 q70 on 2026-10-01: 38.1-119.7 KiB',
});

// ---------------------------------------------------------------------------------------------------------------
// In-page probe (self-contained; runs inside the page with the shared tools of coverage.mjs)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The first viewport at scroll 0: h1 candidates, hero sentences, figures, product surfaces and the visible text that
 * intersects the viewport.
 * @param {Record<string, unknown>} opts
 * @param {PageTools} tools
 * @returns {FirstviewProbe}
 */
export const firstviewProbe = function firstviewProbe(opts, tools) {
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  /** @param {Element} el @returns {Item} */
  const item = (el) => ({ sel: tools.sel(el), text: tools.text(el), visible: tools.shown(el), box: tools.rect(el) });
  /** @type {Array<{sel: string, text: string}>} */
  const texts = [];
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  /** @type {Set<Element>} */
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || seen.has(parent) || !/\S/.test(n.nodeValue || '') || parent.closest('script, style')) continue;
    seen.add(parent);
    if (!tools.shown(parent)) continue;
    const r = parent.getBoundingClientRect();
    if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) continue;
    const own = Array.from(parent.childNodes).filter((c) => c.nodeType === 3).map((c) => c.nodeValue || '').join(' ');
    texts.push({ sel: tools.sel(parent), text: own.replace(/\s+/g, ' ').trim() });
  }
  return {
    viewport: { w: vw, h: vh },
    scroll: { x: window.scrollX, y: window.scrollY },
    h1s: Array.from(document.querySelectorAll('h1, [role="heading"][aria-level="1"]')).map(item),
    sentences: Array.from(document.querySelectorAll('[data-hero="sentence"]')).map(item),
    metrics: Array.from(document.querySelectorAll('[data-metric]')).map((el) => ({ ...item(el), ...tools.metric(el) })),
    surfaces: Array.from(document.querySelectorAll('[data-surface="product"]')).map(item),
    texts,
  };
};

// ---------------------------------------------------------------------------------------------------------------
// Pure evaluation (exported for the tests)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The viewports the first-view contract runs at: those named desktop and mobile; else every viewport but one named
 * reflow (a 320 px overflow check, not a first view); else all.
 * @param {Viewport[]} viewports
 * @returns {Viewport[]}
 */
export function firstViewports(viewports) {
  const named = viewports.filter((v) => v.name === 'desktop' || v.name === 'mobile');
  if (named.length > 0) return named;
  const notReflow = viewports.filter((v) => v.name !== 'reflow');
  return notReflow.length > 0 ? notReflow : viewports;
}

/**
 * @param {Box} b
 * @param {{w: number, h: number}} vp
 * @returns {boolean}
 */
function intersects(b, vp) {
  return b.w > 0 && b.h > 0 && b.x < vp.w && b.y < vp.h && b.x + b.w > 0 && b.y + b.h > 0;
}

/**
 * @param {Box} b
 * @param {{w: number, h: number}} vp
 * @returns {boolean}
 */
function wholly(b, vp) {
  return b.x >= -1 && b.y >= -1 && b.x + b.w <= vp.w + 1 && b.y + b.h <= vp.h + 1;
}

/**
 * True when `name` appears in `text` as a whole word (case-insensitive; any whitespace between its words).
 * @param {string} name
 * @param {string} text
 * @returns {boolean}
 */
export function namesSponsor(name, text) {
  const words = comparable(name).split(' ').filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length === 0) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join('\\s+')}(?![\\p{L}\\p{N}])`, 'iu').test(comparable(text));
}

/**
 * Checks the first-view contract on one page.
 * @param {FirstviewProbe} probe
 * @param {Array<{id: string, name: string}>} sponsors
 * @returns {{problems: Array<{selector: string, value: string}>, found: string[]}}
 */
export function contractProblems(probe, sponsors) {
  const vp = probe.viewport;
  /** @type {Array<{selector: string, value: string}>} */
  const problems = [];
  /** @type {string[]} */
  const found = [];

  const h1s = probe.h1s.filter((h) => h.visible && intersects(h.box, vp));
  let h1Sel = '';
  if (h1s.length === 0) {
    const below = probe.h1s.filter((h) => h.visible);
    problems.push({ selector: below[0]?.sel ?? '', value: below.length > 0 ? `the h1 sits below the fold (top at ${Math.round(below[0].box.y)} px of ${vp.h})` : 'no visible h1 in the first viewport' });
  } else if (h1s.length > 1) {
    problems.push({ selector: h1s.map((h) => h.sel).join(', '), value: `${h1s.length} h1 elements in the first viewport; keep one` });
  } else {
    const h1 = h1s[0];
    h1Sel = h1.sel;
    const words = wordCount(comparable(h1.text));
    if (!wholly(h1.box, vp)) problems.push({ selector: h1.sel, value: 'the h1 is cut by the edge of the first viewport' });
    if (words < H1_WORDS.min || words > H1_WORDS.max) {
      problems.push({ selector: h1.sel, value: `the h1 has ${words} word${words === 1 ? '' : 's'} ("${comparable(h1.text).slice(0, 80)}"); keep it to ${H1_WORDS.min} to ${H1_WORDS.max}` });
    } else {
      found.push(`h1 "${comparable(h1.text).slice(0, 60)}" (${words} words)`);
    }
  }

  const sentences = probe.sentences.filter((s) => s.visible && intersects(s.box, vp) && s.sel !== h1Sel);
  if (sentences.length === 0) {
    const anywhere = probe.sentences.filter((s) => s.visible);
    problems.push({
      selector: anywhere[0]?.sel ?? '',
      value: anywhere.length > 0 ? 'the [data-hero="sentence"] sits below the fold' : 'no visible [data-hero="sentence"] in the first viewport',
    });
  } else if (sentences.length > 1) {
    problems.push({ selector: sentences.map((s) => s.sel).join(', '), value: `${sentences.length} [data-hero="sentence"] elements in the first viewport; keep one` });
  } else {
    const s = sentences[0];
    const words = wordCount(comparable(s.text));
    if (!wholly(s.box, vp)) problems.push({ selector: s.sel, value: 'the sentence is cut by the edge of the first viewport' });
    if (words < SENTENCE_WORDS.min || words > SENTENCE_WORDS.max) {
      problems.push({ selector: s.sel, value: `the sentence has ${words} words; one sentence naming user, action and object runs ${SENTENCE_WORDS.min} to ${SENTENCE_WORDS.max}` });
    } else {
      found.push(`sentence (${words} words)`);
    }
  }

  if (sponsors.length === 0) {
    found.push('no sponsor in brief.json or the profile, so no sponsor name is required');
  } else {
    const text = probe.texts.map((t) => t.text).join(' ');
    const named = sponsors.filter((s) => namesSponsor(s.name, text));
    if (named.length === 0) {
      problems.push({ selector: '', value: `no sponsor name in the first viewport's text (looked for ${sponsors.map((s) => s.name).join(', ')})` });
    } else {
      const owner = probe.texts.find((t) => namesSponsor(named[0].name, t.text));
      found.push(`sponsor ${named.map((s) => s.name).join(', ')}${owner ? ` (${owner.sel})` : ''}`);
    }
  }

  const inView = probe.metrics.filter((m) => m.visible && intersects(m.box, vp) && /\d/.test(m.text));
  const sourced = inView.filter((m) => wholly(m.box, vp) && ((m.ledger ?? '').trim() !== ''
    || (DATA_SOURCES.includes((m.source ?? '').trim()) && (m.asOf ?? '').trim() !== '')));
  if (sourced.length === 0) {
    if (inView.length === 0) problems.push({ selector: '', value: 'no visible data-metric figure in the first viewport' });
    else if (!inView.some((m) => wholly(m.box, vp))) problems.push({ selector: inView[0].sel, value: 'the figure is cut by the edge of the first viewport' });
    else problems.push({ selector: inView[0].sel, value: `the figure "${comparable(inView[0].text).slice(0, 40)}" has no data-ledger, nor data-source with data-as-of` });
  } else {
    const m = sourced[0];
    found.push(`figure "${comparable(m.text).slice(0, 40)}" (${m.ledger ? `ledger ${m.ledger}` : `${m.source}, as of ${m.asOf}`})`);
  }

  const surfaces = probe.surfaces.filter((s) => s.visible && intersects(s.box, vp));
  if (surfaces.length === 0) {
    const anywhere = probe.surfaces.filter((s) => s.visible);
    problems.push({
      selector: anywhere[0]?.sel ?? '',
      value: anywhere.length > 0 ? `the [data-surface="product"] starts below the fold (top at ${Math.round(anywhere[0].box.y)} px of ${vp.h})` : 'no visible [data-surface="product"]',
    });
  } else {
    const shownHeights = surfaces.map((s) => ({ s, shown: Math.min(s.box.y + s.box.h, vp.h) - Math.max(s.box.y, 0) }));
    const best = shownHeights.sort((a, b) => b.shown - a.shown)[0];
    const needed = Math.min(best.s.box.h, PRODUCT_SHARE * vp.h) - 1;
    if (best.shown < needed) {
      problems.push({ selector: best.s.sel, value: `only ${Math.round(best.shown)} px of the product surface show above the fold; at least ${Math.round(needed + 1)} px are needed` });
    } else {
      found.push(`product ${Math.round(best.shown)} px above the fold`);
    }
  }
  return { problems, found };
}

/**
 * Gate firstview.contract over the first route's pages, one per first-view viewport.
 * @param {{pages: FirstviewPage[], sponsors: Array<{id: string, name: string}>}} input
 * @returns {{ok: boolean, detail: string, evidence: Evidence[]}}
 */
export function evaluateContract({ pages, sponsors }) {
  /** @type {Evidence[]} */
  const failures = [];
  /** @type {Evidence[]} */
  const notes = [];
  if (pages.length === 0) failures.push({ value: 'no first-view page was loaded' });
  for (const page of pages) {
    const route = page.route.path;
    const viewport = page.viewport.name;
    if (!page.probe) {
      failures.push({ route, viewport, value: `page did not load: ${page.error}` });
      continue;
    }
    const { problems, found } = contractProblems(page.probe, sponsors);
    for (const p of problems) failures.push({ route, viewport, selector: p.selector, value: p.value });
    notes.push({ route, viewport, value: found.join('; ') || 'nothing of the contract found' });
  }
  if (failures.length > 0) {
    const views = [...new Set(failures.map((f) => String(f.viewport)))];
    return {
      ok: false,
      detail: `first viewport incomplete at ${views.join(', ')}: ${failures[0].value} (${failures[0].viewport}${failures.length > 1 ? `; ${failures.length - 1} more` : ''})`,
      evidence: [...failures, ...notes],
    };
  }
  return {
    ok: true,
    detail: `first viewport complete at ${pages.map((p) => `${p.viewport.name} ${p.viewport.width}x${p.viewport.height}`).join(' and ')}: h1, sentence, sponsor, sourced figure, product`,
    evidence: notes,
  };
}

/**
 * @param {unknown} raw
 * @param {string} where
 * @returns {Band}
 */
export function parseBand(raw, where) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError(`${where} must be an object {min_kib, max_kib, ...}`);
  const b = /** @type {Record<string, unknown>} */ (raw);
  /** @type {string[]} */
  const problems = [];
  /** @param {string} key @param {number} fallback @param {(n: number) => boolean} ok @returns {number} */
  const num = (key, fallback, ok) => {
    if (b[key] === undefined || b[key] === null) return fallback;
    const n = b[key];
    if (typeof n === 'number' && Number.isFinite(n) && ok(n)) return n;
    problems.push(`${key} ${JSON.stringify(n)} is not valid`);
    return fallback;
  };
  const band = {
    width: num('width', PROVISIONAL_BAND.width, (n) => Number.isInteger(n) && n > 0),
    height: num('height', PROVISIONAL_BAND.height, (n) => Number.isInteger(n) && n > 0),
    dpr: num('dpr', PROVISIONAL_BAND.dpr, (n) => n > 0),
    quality: num('quality', PROVISIONAL_BAND.quality, (n) => Number.isInteger(n) && n >= 1 && n <= 100),
    min_kib: num('min_kib', Number.NaN, (n) => n >= 0),
    max_kib: num('max_kib', Number.NaN, (n) => n > 0),
    calibrated: b.calibrated === true,
    source: typeof b.source === 'string' && b.source.trim() ? b.source.trim() : where,
  };
  if (Number.isNaN(band.min_kib) || Number.isNaN(band.max_kib)) problems.push('min_kib and max_kib are required');
  else if (band.min_kib >= band.max_kib) problems.push('min_kib must be below max_kib');
  if (b.calibrated !== undefined && typeof b.calibrated !== 'boolean') problems.push('calibrated must be true or false');
  if (problems.length > 0) throw new UsageError(`${where}: ${problems.join('; ')}`);
  return band;
}

/**
 * The complexity band: the profile's frontend block `firstview.complexity`, else the calibration file, else the
 * provisional band. A malformed profile band is a UsageError (exit 2); a malformed calibration file an EnvError.
 * @param {Pick<Profile, 'source'>} profile
 * @param {{calibrationFile?: string}} [options]
 * @returns {{band: Band, from: string}}
 */
export function resolveBand(profile, { calibrationFile = CALIBRATION_FILE } = {}) {
  const file = profile.source?.path;
  if (file && isFile(file)) {
    /** @type {unknown} */
    let raw = null;
    try {
      raw = JSON.parse(readText(file));
    } catch (err) {
      throw new UsageError(`profile ${file} is not valid JSON (${err instanceof Error ? err.message : String(err)})`, { cause: err });
    }
    const block = isObject(raw) && isObject(raw.frontend) ? raw.frontend : raw;
    const firstview = isObject(block) ? block.firstview : undefined;
    if (isObject(firstview) && firstview.complexity !== undefined) {
      return { band: parseBand(firstview.complexity, `${file} firstview.complexity`), from: `profile ${file}` };
    }
  }
  if (isFile(calibrationFile)) {
    try {
      return { band: parseBand(JSON.parse(readText(calibrationFile)), calibrationFile), from: `calibration ${calibrationFile}` };
    } catch (err) {
      throw new EnvError(`${calibrationFile} is not a valid band (${err instanceof Error ? err.message : String(err)}); re-run calibration`, { cause: err });
    }
  }
  return { band: { ...PROVISIONAL_BAND }, from: 'provisional band' };
}

/**
 * Gate firstview.complexity from one measurement.
 * @param {{kib: number, band: Band, from: string}} input
 * @returns {{ok: boolean, detail: string, advisory: boolean}}
 */
export function evaluateComplexity({ kib, band, from }) {
  const where = kib < band.min_kib ? 'below' : kib > band.max_kib ? 'above' : 'within';
  const measured = `${kib.toFixed(1)} KiB as JPEG q${band.quality} at ${band.width}x${band.height}${band.dpr !== 1 ? `@${band.dpr}x` : ''}`;
  const text = `${measured}, ${where} the ${band.calibrated ? 'calibrated' : 'provisional'} band ${band.min_kib}-${band.max_kib} KiB (${from})`;
  if (!band.calibrated) return { ok: true, advisory: true, detail: `advisory until calibrated: ${text}` };
  if (where === 'within') return { ok: true, advisory: false, detail: text };
  return {
    ok: false,
    advisory: false,
    detail: where === 'above'
      ? `${text}; remove texture, photographs and competing elements from the first viewport (BD-03)`
      : `${text}; the first viewport is emptier than every calibrated exemplar: check that the product and the figure render`,
  };
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** @param {string} p @returns {boolean} */
function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------------------------------------------

/**
 * Check-module entry point (CONTRACTS section 4).
 * @param {CheckContext} ctx
 * @param {Iterable<string>} [selected]
 * @returns {Promise<GateResult[]>}
 */
export async function run(ctx, selected) {
  const want = selectedIds(selected, GATES);
  if (want.length === 0) return [];
  const builders = Object.fromEntries(GATES.map((g) => [g.id, gate(g)]));
  if (!ctx.browser || !ctx.baseUrl) {
    return want.map((id) => builders[id].skip('no browser or target URL: pass --serve <built dir> or --url <running app>'));
  }
  const routes = ctx.routes.length > 0 ? ctx.routes : [{ path: '/', name: 'home', first: true, features: [], states: [] }];
  const route = routes.find((r) => r.first) ?? routes[0];
  /** @type {Map<string, GateResult>} */
  const results = new Map();

  if (want.includes('firstview.contract')) {
    /** @type {FirstviewPage[]} */
    const pages = [];
    for (const viewport of firstViewports(contextViewports(ctx))) {
      const loaded = await loadPage(ctx, route, viewport, (page) => evaluateProbe(page, firstviewProbe, {}));
      const httpError = loaded.status !== null && loaded.status >= 400 ? `HTTP ${loaded.status} for ${loaded.url}` : null;
      pages.push({ route, viewport, url: loaded.url, status: loaded.status, probe: httpError ? null : loaded.value, error: httpError ?? loaded.error });
    }
    const sponsors = sponsorNames({ brief: readBrief(ctx.state).brief, profile: ctx.profile });
    const r = evaluateContract({ pages, sponsors });
    const b = builders['firstview.contract'];
    results.set('firstview.contract', r.ok ? b.ok(r.detail, r.evidence) : b.fail(r.detail, r.evidence));
  }

  if (want.includes('firstview.complexity')) {
    const { band, from } = resolveBand(ctx.profile);
    /** @type {Viewport} */
    const viewport = { name: `${band.width}x${band.height}`, width: band.width, height: band.height, dpr: band.dpr, isMobile: false, hasTouch: false };
    const loaded = await loadPage(ctx, route, viewport, async (page) => {
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
      return page.screenshot({ type: 'jpeg', quality: band.quality, animations: 'disabled', caret: 'hide', scale: 'device' });
    });
    const b = builders['firstview.complexity'];
    const httpError = loaded.status !== null && loaded.status >= 400 ? `HTTP ${loaded.status} for ${loaded.url}` : null;
    if (!loaded.value || httpError) {
      results.set('firstview.complexity', b.fail(`the first viewport could not be measured: ${httpError ?? loaded.error}`, { route: route.path, viewport: viewport.name }));
    } else {
      const kib = loaded.value.length / 1024;
      const r = evaluateComplexity({ kib, band, from });
      /** @type {Evidence} */
      const evidence = { route: route.path, viewport: viewport.name, value: Math.round(kib * 10) / 10, band: [band.min_kib, band.max_kib], calibrated: band.calibrated, source: band.source };
      const outDir = typeof ctx.args?.outDir === 'string' && ctx.args.outDir ? ctx.args.outDir : ctx.state ? path.join(ctx.state, 'firstview') : null;
      if (outDir) {
        const file = path.join(outDir, `complexity-${route.name.replace(/[^\w.-]+/g, '-')}-${band.width}x${band.height}.jpg`);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, loaded.value);
        evidence.file = toPosix(file);
      }
      results.set('firstview.complexity', r.ok ? (r.advisory ? b.advise(r.detail, evidence) : b.ok(r.detail, evidence)) : b.fail(r.detail, evidence));
    }
  }
  return want.map((id) => /** @type {GateResult} */ (results.get(id)));
}

// ---------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------

const HELP = `Usage: node firstview.mjs (--serve <dir> | --url <url>) [--root <repo>] [--profile <path>] [--state <dir>]
                         [--gates <list>] [--out <dir>] [--json]

First-view gates on the first route of design/routes.json (record mode when the profile sets record_mode):
  firstview.contract     at the desktop and mobile viewports, in the first viewport at load: one h1 of ${H1_WORDS.min} to ${H1_WORDS.max}
                         words, one [data-hero="sentence"] of ${SENTENCE_WORDS.min} to ${SENTENCE_WORDS.max} words, a sponsor's name (brief.json
                         sponsors, else the profile's sponsor ids named from assets/sponsor-allowlist.json), one
                         data-metric figure with data-ledger or data-source plus data-as-of, and the
                         [data-surface="product"] element with at least a quarter of the viewport height in view
  firstview.complexity   JPEG quality-70 size of the first viewport at the band's size (default 1440x900), compared
                         with the band from the profile's frontend firstview.complexity {min_kib, max_kib, width,
                         height, dpr, quality, calibrated, source}, else calibration/firstview-complexity.json, else
                         the provisional ${PROVISIONAL_BAND.min_kib}-${PROVISIONAL_BAND.max_kib} KiB (FD11-F05 exemplars on Chromium's
                         encoder); advisory (reports, passes) until the band is calibrated. The measured JPEG is
                         saved to <state>/firstview/.

${SHARED_HELP}

Exit codes: 0 every selected gate ok; 1 a gate failed or was skipped; 2 usage error (bad flag, invalid profile
band); 3 environment error (no browser, unreachable URL, port in use, invalid calibration file).`;

/**
 * @param {readonly string[]} argv
 * @returns {Promise<number>}
 */
export function main(argv) {
  return runModuleCli(argv, { tool: 'firstview', help: HELP, gates: GATES, run });
}

/**
 * True when this file is the script node was started with.
 * @returns {boolean}
 */
function isMain() {
  return isMainModule(import.meta.url);
}

if (isMain()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }, exitWith);
}
