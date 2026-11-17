// @ts-check
/**
 * Coverage gates on the rendered DOM (CONTRACTS section 4 and 6.6, references/10-gates.md GT-17): every route at
 * every profile viewport, loaded in record mode when the profile sets it, waiting for explicit readiness.
 *
 * - coverage.features: every requested FR id has a visible `data-feature` surface on its route, with a heading, a
 *   valid visible `data-status` label and, unless planned, a visible proof marker.
 * - coverage.metrics: every `data-metric` carries a `data-ledger` id that the claims ledger marks verified (or
 *   backed), or `data-source` plus `data-as-of`; and no stat-like figure renders without any of those markers.
 * - coverage.hero: the visible `data-hero="h1"` and `data-hero="sentence"` equal brief.hero after normaliseText.
 * - coverage.nevershow: no active never-show entry (scope rendered or both, until_utc unset or in the future) in the
 *   page's text (visible or hidden), its title, meta tags, text attributes or JSON data scripts. The report names
 *   the entry id and where it matched, never the matched text.
 * - coverage.placeholders: no TODO, FIXME, TBD, lorem, xxx, [YOUR ...], unrendered template, example domain,
 *   placeholder name, "coming soon" stub or broken value (NaN, [object Object], Invalid Date) in rendered text.
 *
 * Also the in-page tools and the CLI runner shared with firstview.mjs.
 */
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli, isMainModule } from './lib/args.mjs';
import { launch, withPage } from './lib/browser.mjs';
import { CheckError, EnvError, UsageError, exitWith } from './lib/errors.mjs';
import { readText, toPosix } from './lib/fsutil.mjs';
import { selectorFor } from './lib/dom.mjs';
import { checkStateDir, designDir } from './lib/paths.mjs';
import { loadProfile } from './lib/profile.mjs';
import { aggregate, gate, utcStamp, writeReport } from './lib/report.mjs';
import { loadRoutes, routeUrl } from './lib/routes.mjs';
import { serveStatic } from './lib/serve.mjs';
import { foldNeverShow, normaliseText, wordCount } from './lib/text.mjs';
import {
  FEATURE_STATUSES, isActive, loadCatalogue, loadClaimsLedger, loadNeverShow, readBrief, selectedIds,
} from './brief.mjs';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('playwright-core').Page} Page
 * @typedef {import('./lib/profile.mjs').Profile} Profile
 * @typedef {import('./lib/profile.mjs').Viewport} Viewport
 * @typedef {import('./lib/routes.mjs').Route} Route
 * @typedef {import('./lib/report.mjs').GateResult} GateResult
 * @typedef {import('./lib/report.mjs').GateMeta} GateMeta
 * @typedef {import('./lib/report.mjs').Evidence} Evidence
 * @typedef {import('./brief.mjs').NeverShowEntry} NeverShowEntry
 * @typedef {import('./brief.mjs').NeverShowList} NeverShowList
 * @typedef {{root: string, profile: Profile, state?: string | null, design?: string, routes: Route[],
 *   baseUrl?: string | null, browser?: Browser | null, viewports?: Viewport[], args?: Record<string, unknown>,
 *   log?: (line: string) => void, now?: Date | string}} CheckContext
 *   frontend-check's context (CONTRACTS section 4); `now` (or `args.now`) fixes the clock never-show dates are read
 *   against.
 * @typedef {{x: number, y: number, w: number, h: number}} Box
 * @typedef {{ledger: string | null, source: string | null, asOf: string | null}} MetricMarkers
 * @typedef {{
 *   sel: (el: Element) => string,
 *   shown: (el: Element) => boolean,
 *   text: (el: Element) => string,
 *   rect: (el: Element) => Box,
 *   metric: (el: Element) => MetricMarkers,
 * }} PageTools
 * @typedef {{sel: string, text: string, visible: boolean}} Labelled
 * @typedef {{ids: string[], sel: string, visible: boolean, headings: Labelled[],
 *   statuses: Array<Labelled & {value: string}>, proofs: Array<{sel: string, kind: string, visible: boolean}>}} FeatureProbe
 * @typedef {MetricMarkers & {sel: string, text: string, visible: boolean}} MetricProbe
 * @typedef {{sel: string, text: string, visible: boolean, tag: string, code: boolean, time: boolean,
 *   marked: boolean, fontSize: number, fontWeight: number}} TextProbe
 * @typedef {{
 *   url: string, title: string, bodyFontSize: number,
 *   metas: Array<{key: string, content: string}>,
 *   features: FeatureProbe[],
 *   metrics: MetricProbe[],
 *   hero: Array<{role: string, sel: string, tag: string, visible: boolean, inner: string, content: string}>,
 *   texts: TextProbe[],
 *   visibleText: string,
 *   allText: string,
 *   attributes: Array<{sel: string, name: string, value: string}>,
 *   dataScripts: Array<{sel: string, text: string}>,
 *   truncated: boolean
 * }} CoverageProbe
 * @typedef {{route: Route, viewport: Viewport, url: string, status: number | null, probe: CoverageProbe | null,
 *   error: string | null}} PageResult
 */

export const GATES = Object.freeze([
  Object.freeze({
    id: 'coverage.features',
    title: 'Every requested feature is visible as data-feature in record mode, with a heading, a status label and its proof',
    ifDropped: 'a feature the spec promises could be missing while every test is green',
  }),
  Object.freeze({
    id: 'coverage.metrics',
    title: 'Every figure carries a verified claims-ledger id or a data source with an as-of time',
    ifDropped: 'an invented or unverified number could reach the jury',
  }),
  Object.freeze({
    id: 'coverage.hero',
    title: 'The first-view headline and sentence equal brief.hero',
    ifDropped: 'the hero could drift from the two sentences the README, the form and the video repeat',
  }),
  Object.freeze({
    id: 'coverage.nevershow',
    title: 'No active never-show entry in the rendered text, title, meta tags or page data',
    ifDropped: 'an embargoed or undisclosed item could render on the public page',
  }),
  Object.freeze({
    id: 'coverage.placeholders',
    title: 'No TODO, FIXME, lorem, TBD, [YOUR ...], xxx or broken value in rendered text',
    ifDropped: 'a TODO or placeholder could sit on a page a judge reads',
  }),
]);

/** Values of `data-source` (CONTRACTS 6.6). */
export const DATA_SOURCES = Object.freeze(['live', 'testnet', 'simulated']);

const MAX_EVIDENCE = 50;
const INVISIBLE = new RegExp(`[\\xad${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200d)}${String.fromCharCode(0x2060)}${String.fromCharCode(0xfeff)}]`, 'g');

// ---------------------------------------------------------------------------------------------------------------
// In-page code (each function below runs inside the page and must stay self-contained)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Builds the helpers every probe uses: a selector (lib/dom selectorFor), visibility (rendered, at least 2x2 px, not
 * hidden by display, visibility, content-visibility: hidden or an effective opacity of 0.1 or less, on the page
 * canvas, and not clipped away by an `overflow: hidden|clip` ancestor; a scroll container brings its content back
 * into reach, fixed positioning escapes the clipping, and a content-visibility: auto section off screen counts as
 * visible because scrolling renders it),
 * the collapsed rendered text, the viewport rectangle and the figure markers of an element (its own `data-ledger`;
 * `data-source` and `data-as-of` on itself or the nearest data region around it).
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorFn
 * @returns {PageTools}
 */
export const pageTools = function pageTools(selectorFn) {
  const counts = new Map();
  /** @type {Map<Element, CSSStyleDeclaration>} */
  const styles = new Map();
  /** @param {Element} el */
  const style = (el) => {
    let s = styles.get(el);
    if (!s) {
      s = getComputedStyle(el);
      styles.set(el, s);
    }
    return s;
  };
  /** @type {Map<Element, number>} */
  const opacities = new Map();
  /** @param {Element | null} el @returns {number} */
  const opacity = (el) => {
    if (!el) return 1;
    const cached = opacities.get(el);
    if (cached !== undefined) return cached;
    const own = Number.parseFloat(style(el).opacity);
    const value = (Number.isFinite(own) ? own : 1) * opacity(el.parentElement);
    opacities.set(el, value);
    return value;
  };
  const docWidth = Math.max(document.documentElement.scrollWidth, window.innerWidth);
  /** @param {Element} el @param {DOMRect} r @returns {boolean} */
  const clippedAway = (el, r) => {
    if (style(el).position === 'fixed') return false;
    let x1 = r.left;
    let x2 = r.right;
    let y1 = r.top;
    let y2 = r.bottom;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = style(a);
      if (s.position === 'fixed') return false;
      const clipX = s.overflowX === 'hidden' || s.overflowX === 'clip';
      const clipY = s.overflowY === 'hidden' || s.overflowY === 'clip';
      const scrollX = s.overflowX === 'auto' || s.overflowX === 'scroll';
      const scrollY = s.overflowY === 'auto' || s.overflowY === 'scroll';
      if (!clipX && !clipY && !scrollX && !scrollY) continue;
      const ar = a.getBoundingClientRect();
      if (clipX && Math.min(x2, ar.right) - Math.max(x1, ar.left) <= 0) return true;
      if (clipY && Math.min(y2, ar.bottom) - Math.max(y1, ar.top) <= 0) return true;
      if (scrollX) {
        if (ar.width < 1) return true;
        x1 = ar.left;
        x2 = ar.right;
      }
      if (scrollY) {
        if (ar.height < 1) return true;
        y1 = ar.top;
        y2 = ar.bottom;
      }
    }
    return false;
  };
  /** @type {Map<Element, boolean>} */
  const shownCache = new Map();
  /** @param {Element} el @returns {boolean} */
  const shown = (el) => {
    const cached = shownCache.get(el);
    if (cached !== undefined) return cached;
    let result = true;
    const s = style(el);
    if (s.display === 'contents') {
      result = Array.from(el.children).some(shown);
    } else {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) result = false;
      else if (typeof el.checkVisibility === 'function') {
        result = el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: false });
      } else {
        result = s.display !== 'none' && s.visibility !== 'hidden';
      }
      if (result && opacity(el) <= 0.1) result = false;
      if (result) {
        const left = r.left + window.scrollX;
        const top = r.top + window.scrollY;
        if (left + r.width <= 0 || top + r.height <= 0 || left >= docWidth) result = false;
      }
      if (result && clippedAway(el, r)) result = false;
    }
    shownCache.set(el, result);
    return result;
  };
  /** @param {Element} el @returns {string} */
  const text = (el) => {
    const raw = el instanceof HTMLElement ? el.innerText : el.textContent || '';
    return String(raw || '').replace(/\s+/g, ' ').trim();
  };
  /** @param {Element} el @returns {Box} */
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left * 100) / 100, y: Math.round(r.top * 100) / 100, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 };
  };
  /** @param {Element} el @returns {MetricMarkers} */
  const metric = (el) => {
    const region = el.closest('[data-source]');
    const timed = el.closest('[data-as-of]');
    return {
      ledger: el.getAttribute('data-ledger'),
      source: region ? region.getAttribute('data-source') : null,
      asOf: timed ? timed.getAttribute('data-as-of') : null,
    };
  };
  return { sel: (el) => selectorFn(el, counts), shown, text, rect, metric };
};

/**
 * Everything the coverage gates read from one rendered page.
 * @param {{maxTexts?: number}} opts
 * @param {PageTools} tools
 * @returns {CoverageProbe}
 */
export const coverageProbe = function coverageProbe(opts, tools) {
  const maxTexts = typeof opts.maxTexts === 'number' ? opts.maxTexts : 20000;
  const body = document.body || document.documentElement;
  /** @param {Element} root @param {string} selector @returns {Element[]} */
  const own = (root, selector) => {
    const found = root.matches(selector) ? [root] : [];
    for (const el of Array.from(root.querySelectorAll(selector))) found.push(el);
    return found.filter((el) => el.closest('[data-feature]') === root);
  };
  const features = Array.from(document.querySelectorAll('[data-feature]')).map((root) => ({
    ids: String(root.getAttribute('data-feature') || '').split(/[\s,]+/).filter(Boolean),
    sel: tools.sel(root),
    visible: tools.shown(root),
    headings: own(root, 'h1, h2, h3, h4, h5, h6, [role="heading"]').map((h) => ({ sel: tools.sel(h), text: tools.text(h), visible: tools.shown(h) })),
    statuses: own(root, '[data-status]').map((s) => ({
      sel: tools.sel(s), value: String(s.getAttribute('data-status') || '').trim(), text: tools.text(s), visible: tools.shown(s),
    })),
    proofs: own(root, '[data-proof], [data-ledger], [data-source]').map((p) => ({
      sel: tools.sel(p),
      kind: p.hasAttribute('data-proof') ? 'data-proof' : p.hasAttribute('data-ledger') ? 'data-ledger' : 'data-source',
      visible: tools.shown(p),
    })),
  }));
  const metrics = Array.from(document.querySelectorAll('[data-metric]')).map((el) => ({
    sel: tools.sel(el), text: tools.text(el), visible: tools.shown(el), ...tools.metric(el),
  }));
  const hero = Array.from(document.querySelectorAll('[data-hero]')).map((el) => ({
    role: String(el.getAttribute('data-hero') || '').trim(),
    sel: tools.sel(el),
    tag: el.localName,
    visible: tools.shown(el),
    inner: tools.text(el),
    content: String(el.textContent || '').replace(/\s+/g, ' ').trim(),
  }));
  /** @type {Map<Element, string[]>} */
  const owners = new Map();
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const value = n.nodeValue || '';
    if (!/\S/.test(value)) continue;
    const parent = n.parentElement;
    if (!parent || parent.closest('script, style')) continue;
    const list = owners.get(parent);
    if (list) list.push(value);
    else owners.set(parent, [value]);
  }
  /** @type {TextProbe[]} */
  const texts = [];
  let truncated = false;
  for (const [el, parts] of owners) {
    if (texts.length >= maxTexts) {
      truncated = true;
      break;
    }
    const s = getComputedStyle(el);
    texts.push({
      sel: tools.sel(el),
      text: parts.join(' ').replace(/\s+/g, ' ').trim(),
      visible: tools.shown(el),
      tag: el.localName,
      code: Boolean(el.closest('code, pre, kbd, samp, var')),
      time: Boolean(el.closest('time, [role="timer"]')),
      marked: Boolean(el.closest('[data-metric], [data-ledger], [data-source], [data-proof]')),
      fontSize: Number.parseFloat(s.fontSize) || 0,
      fontWeight: Number(s.fontWeight) || 400,
    });
  }
  const names = ['alt', 'title', 'aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'placeholder', 'value'];
  const attributes = [];
  for (const el of Array.from(document.querySelectorAll(names.map((n) => `[${n}]`).join(', ')))) {
    if (el.localName === 'meta' || el.localName === 'script' || el.localName === 'style') continue;
    for (const name of names) {
      const value = el.getAttribute(name);
      if (value && value.trim()) attributes.push({ sel: tools.sel(el), name, value: value.slice(0, 2000) });
    }
  }
  const metas = Array.from(document.querySelectorAll('meta[content]')).map((m) => ({
    key: m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('itemprop') || m.getAttribute('http-equiv') || '',
    content: m.getAttribute('content') || '',
  }));
  const dataScripts = Array.from(document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]')).map((s) => ({
    sel: tools.sel(s), text: String(s.textContent || '').slice(0, 2 * 1024 * 1024),
  }));
  return {
    url: location.href,
    title: document.title || '',
    bodyFontSize: Number.parseFloat(getComputedStyle(body).fontSize) || 16,
    metas,
    features,
    metrics,
    hero,
    texts,
    visibleText: body.innerText || '',
    allText: texts.map((t) => t.text).join('\n'),
    attributes,
    dataScripts,
    truncated,
  };
};

/**
 * Runs a probe in the page with the shared tools (both are serialised: the page sees only their source).
 * @template T
 * @param {Page} page
 * @param {(opts: any, tools: PageTools) => T} probe
 * @param {Record<string, unknown>} [opts]
 * @returns {Promise<T>}
 */
export function evaluateProbe(page, probe, opts = {}) {
  const expression = `(${probe.toString()})(${JSON.stringify(opts)}, (${pageTools.toString()})(${selectorFor.toString()}))`;
  return /** @type {Promise<T>} */ (page.evaluate(expression));
}

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (exported for the tests)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Text as the gates compare it: NFKC, soft hyphens and zero-width characters removed, whitespace collapsed.
 * @param {string} s
 * @returns {string}
 */
export function comparable(s) {
  return normaliseText(String(s ?? '').replace(INVISIBLE, ''));
}

/**
 * Feature ids from a `--features` value: "FR-003,FR-007", an array, or nothing.
 * @param {unknown} value
 * @returns {string[]}
 */
export function parseFeatureList(value) {
  if (value === undefined || value === null || value === false || value === '') return [];
  const parts = (Array.isArray(value) ? value : [value]).flatMap((v) => String(v).split(/[\s,]+/)).map((s) => s.trim()).filter(Boolean);
  const bad = parts.filter((p) => !/^FR-\d{3,}$/.test(p));
  if (bad.length > 0) throw new UsageError(`--features takes requirement ids like FR-003 (got ${bad.join(', ')}); separate them with commas`);
  return [...new Set(parts)];
}

/**
 * The feature ids coverage.features checks: `--features`, else the catalogue (paths.feature_catalogue), else the
 * brief's features, else the ids routes.json maps. `problem` explains a configured input that could not be read.
 * @param {CheckContext} ctx
 * @returns {{ids: string[], from: string, expected: Map<string, string>, problem: string | null, notes: string[]}}
 */
export function requestedFeatures(ctx) {
  /** @type {Map<string, string>} */
  const expected = new Map();
  const fromArgs = parseFeatureList(ctx.args?.features);
  const catalogueFile = ctx.profile.paths?.feature_catalogue ?? null;
  const catalogue = catalogueFile ? loadCatalogue(catalogueFile) : null;
  for (const f of catalogue?.features ?? []) if (f.status_expected) expected.set(f.id, f.status_expected);
  const notes = catalogue?.exists ? catalogue.problems.map((p) => `feature catalogue ${catalogue.file}: ${p}`) : [];
  if (fromArgs.length > 0) return { ids: fromArgs, from: '--features', expected, problem: null, notes };
  if (catalogue) {
    if (!catalogue.exists) return { ids: [], from: 'catalogue', expected, problem: `the profile's feature catalogue ${catalogue.file} does not exist`, notes };
    if (catalogue.features.length === 0) {
      return { ids: [], from: 'catalogue', expected, problem: `the feature catalogue ${catalogue.file} has no valid row (${catalogue.problems.slice(0, 2).join('; ')})`, notes };
    }
    return { ids: catalogue.features.map((f) => f.id), from: `catalogue ${catalogue.file}`, expected, problem: null, notes };
  }
  const brief = readBrief(ctx.state).brief;
  if (brief && brief.features.length > 0) {
    for (const f of brief.features) expected.set(f.id, f.status);
    return { ids: brief.features.map((f) => f.id), from: 'brief.json features', expected, problem: null, notes };
  }
  const mapped = [...new Set(ctx.routes.flatMap((r) => r.features))];
  if (mapped.length > 0) return { ids: mapped, from: 'routes.json', expected, problem: null, notes };
  return { ids: [], from: 'none', expected, problem: null, notes };
}

/**
 * Owner waivers that keep a catalogue row off the page (BD-06 "Not when"): entries of `<design>/waivers.json` with
 * rule "coverage.features", the feature id as scope, approved_by "owner" and a non-empty reason and evidence.
 * @param {string | null | undefined} design
 * @returns {{ids: Map<string, string>, problem: string | null}}
 */
export function featureWaivers(design) {
  /** @type {Map<string, string>} */
  const ids = new Map();
  if (!design) return { ids, problem: null };
  const file = path.join(design, 'waivers.json');
  if (!isFileSync(file)) return { ids, problem: null };
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(readText(file));
  } catch (err) {
    return { ids, problem: `${toPosix(file)} is not valid JSON (${err instanceof Error ? err.message : String(err)})` };
  }
  const list = data !== null && typeof data === 'object' && Array.isArray(/** @type {{waivers?: unknown}} */ (data).waivers)
    ? /** @type {{waivers: unknown[]}} */ (data).waivers
    : [];
  for (const w of list) {
    if (w === null || typeof w !== 'object') continue;
    const entry = /** @type {Record<string, unknown>} */ (w);
    if (entry.rule !== 'coverage.features' || entry.approved_by !== 'owner') continue;
    if (typeof entry.reason !== 'string' || !entry.reason.trim() || typeof entry.evidence !== 'string' || !entry.evidence.trim()) continue;
    for (const id of String(entry.scope ?? '').split(/[\s,]+/).filter((s) => /^FR-\d{3,}$/.test(s))) ids.set(id, entry.reason.trim());
  }
  return { ids, problem: null };
}

/**
 * What keeps one feature instance from counting.
 * @param {FeatureProbe} inst
 * @returns {string[]}
 */
export function featureProblems(inst) {
  /** @type {string[]} */
  const problems = [];
  if (!inst.visible) problems.push('the data-feature element is not visible');
  const valid = inst.statuses.filter((s) => FEATURE_STATUSES.includes(/** @type {never} */ (s.value)));
  const status = valid.find((s) => s.visible && s.text !== '');
  if (!status) {
    if (inst.statuses.length === 0) problems.push('no data-status label');
    else if (valid.length === 0) problems.push(`data-status "${inst.statuses[0].value}" is not one of ${FEATURE_STATUSES.join('|')}`);
    else problems.push('its data-status label is hidden or empty');
  }
  if (!inst.headings.some((h) => h.visible && h.text !== '')) problems.push('no visible heading');
  if (status?.value !== 'planned' && !inst.proofs.some((p) => p.visible)) problems.push('no visible proof (data-proof, data-ledger or data-source)');
  return problems;
}

/**
 * @param {PageResult[]} pages
 * @returns {string[]}
 */
function viewportNames(pages) {
  return [...new Set(pages.map((p) => p.viewport.name))];
}

/**
 * Gate coverage.features over loaded pages.
 * @param {{ids: string[], from: string, expected?: Map<string, string>, pages: PageResult[], routes: Route[],
 *   routesFile: boolean, waivers?: Map<string, string>}} input
 * @returns {{ok: boolean, detail: string, evidence: Evidence[]}}
 */
export function evaluateFeatures({ ids, from, expected = new Map(), pages, routes, routesFile, waivers = new Map() }) {
  /** @type {Evidence[]} */
  const failures = [];
  /** @type {Evidence[]} */
  const notes = [];
  const viewports = viewportNames(pages);
  if (viewports.length === 0) return { ok: false, detail: `no page was loaded, so none of ${ids.length} features could be seen`, evidence: [] };
  let shownCount = 0;
  for (const id of ids) {
    if (waivers.has(id)) {
      notes.push({ value: `${id} kept off the page by owner waiver: ${waivers.get(id)}` });
      continue;
    }
    const mappedTo = routes.filter((r) => r.features.includes(id)).map((r) => r.path);
    const searchIn = mappedTo.length > 0 ? mappedTo : routes.map((r) => r.path);
    /** @type {Array<{route: string, viewport: string, selector: string}>} */
    const foundAt = [];
    let idOk = true;
    for (const viewport of viewports) {
      /** @type {{route: string, selector: string} | null} */
      let okAt = null;
      /** @type {{route: string, selector: string, why: string, defect: boolean} | null} */
      let reason = null;
      for (const page of pages.filter((p) => p.viewport.name === viewport && searchIn.includes(p.route.path))) {
        const route = page.route.path;
        if (!page.probe) {
          reason ??= { route, selector: '', why: `page did not load (${page.error ?? 'unknown error'})`, defect: false };
          continue;
        }
        const instances = page.probe.features.filter((f) => f.ids.includes(id));
        if (instances.length === 0) {
          reason ??= { route, selector: '', why: `not found: no [data-feature="${id}"] on ${route}`, defect: false };
          continue;
        }
        for (const inst of instances) {
          const problems = featureProblems(inst);
          if (problems.length === 0) {
            okAt = { route, selector: inst.sel };
            break;
          }
          if (!reason || !reason.defect) reason = { route, selector: inst.sel, why: problems.join('; '), defect: true };
        }
        if (okAt) break;
      }
      if (okAt) {
        foundAt.push({ ...okAt, viewport });
        continue;
      }
      idOk = false;
      const where = reason ?? { route: searchIn.join(', ') || '(no route)', selector: '', why: 'not found: no page was loaded for its route' };
      failures.push({ feature: id, route: where.route, viewport, selector: where.selector, value: where.why });
    }
    if (routesFile && mappedTo.length === 0) {
      idOk = false;
      const seen = foundAt.length > 0 ? `; rendered on ${[...new Set(foundAt.map((f) => f.route))].join(', ')}` : '';
      failures.push({ feature: id, value: `not mapped to any route in routes.json${seen}; add it to the features of its route (CT-13)` });
    }
    if (idOk) {
      shownCount += 1;
      const exp = expected.get(id);
      const page = pages.find((p) => foundAt[0] && p.route.path === foundAt[0].route && p.viewport.name === foundAt[0].viewport);
      const inst = page?.probe?.features.find((f) => f.ids.includes(id) && f.sel === foundAt[0]?.selector);
      const shownStatus = inst?.statuses.find((s) => s.visible && FEATURE_STATUSES.includes(/** @type {never} */ (s.value)))?.value;
      notes.push({
        feature: id,
        route: foundAt[0]?.route ?? '',
        selector: foundAt[0]?.selector ?? '',
        value: `visible at ${viewports.join(', ')} with status ${shownStatus ?? '?'}${exp && shownStatus && exp !== shownStatus ? ` (the plan expected ${exp})` : ''}`,
      });
    }
  }
  const waived = ids.filter((id) => waivers.has(id)).length;
  if (failures.length > 0) {
    const bad = [...new Set(failures.map((f) => String(f.feature)))];
    const first = failures[0];
    return {
      ok: false,
      detail: `${bad.length} of ${ids.length} feature${ids.length === 1 ? '' : 's'} not covered (${bad.slice(0, 6).join(', ')}${bad.length > 6 ? ', ...' : ''}); first: ${first.feature} ${first.viewport ? `at ${first.viewport} on ${first.route}: ` : ''}${first.value} [ids from ${from}]`,
      evidence: cap([...failures, ...notes]),
    };
  }
  return {
    ok: true,
    detail: `${shownCount} feature${shownCount === 1 ? '' : 's'} visible with heading, status label and proof at ${viewports.join(', ')}${waived ? `; ${waived} kept off the page by owner waiver` : ''} [ids from ${from}]`,
    evidence: cap(notes),
  };
}

const CLAIM_UNIT = /%|‰|[$€£¥₿]|\d\s?[x×](?![\p{L}])|\d\s?(?:k|K|M|B|bn|T|bps|bp)(?![\p{L}])|\d[\d,.]*\s+[A-Z]{2,6}(?![\p{L}])/u;
const MONTH = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?/i;
const NOT_A_CLAIM = [
  /^(?:19|20|21)\d{2}$/,
  /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?$/,
  /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/,
  /^\d{1,2}:\d{2}(?::\d{2})?(?:\s?(?:AM|PM|UTC|GMT|CET|CEST|SGT))?$/i,
  /^v\d+(?:\.\d+)*$/i,
  /^\d+(?:\.\d+){2,}$/,
  /^0\d$/,
  /^#\s?\d[\d,]*$/,
  /^\d+(?:st|nd|rd|th)$/i,
  /^(?:step|no\.?|n°|part|phase|section|chapter)\s*\d+$/i,
  /^\d+\s*\/\s*\d+$/,
  /\b0x[0-9a-f]{6,}/i,
];

/**
 * True for text that reads as a figure meant as a claim: it holds a digit, is dominated by the figure (at most three
 * words, or at least 40 % digits and figure symbols), is not a date, time, version, ordinal, step marker, page count
 * or hash, and is either styled as a stat (at least 18 px and 1.25 times the body size) or carries a claim unit
 * (%, a currency, x, k, M, B, bn, T, bp or a ticker after the number).
 * @param {{text: string, fontSize: number}} entry
 * @param {number} bodyFontSize
 * @returns {boolean}
 */
export function isStatLike(entry, bodyFontSize) {
  const text = comparable(entry.text);
  if (!/\d/.test(text) || text.length > 80) return false;
  if (NOT_A_CLAIM.some((re) => re.test(text))) return false;
  if (MONTH.test(text) && /\b\d{1,2}\b|\b(?:19|20)\d{2}\b/.test(text) && !CLAIM_UNIT.test(text.replace(MONTH, ''))) return false;
  const compact = text.replace(/\s+/g, '');
  const figureChars = (compact.match(/[\d.,%$€£¥₿+\-−]/g) ?? []).length;
  const dominant = wordCount(text) <= 3 || figureChars / Math.max(1, compact.length) >= 0.4;
  if (!dominant) return false;
  const big = entry.fontSize >= Math.max(18, 1.25 * (bodyFontSize || 16));
  return big || CLAIM_UNIT.test(text);
}

/**
 * The verified ids and every row's status, from the claims ledger the profile or the brief names.
 * @param {CheckContext} ctx
 * @returns {{available: boolean, file: string | null, statusById: Map<string, string>, problem: string | null}}
 */
export function ledgerFor(ctx) {
  const brief = readBrief(ctx.state).brief;
  const file = ctx.profile.paths?.claims_ledger ?? (brief?.claims.path || null);
  /** @type {Map<string, string>} */
  const statusById = new Map();
  if (!file) return { available: false, file: null, statusById, problem: 'no claims ledger (phase_b.claims_ledger, or claims.path in brief.json)' };
  const ledger = loadClaimsLedger(file);
  if (!ledger.exists) return { available: false, file: ledger.file, statusById, problem: `the claims ledger ${ledger.file} does not exist` };
  for (const row of ledger.rows) if (!statusById.has(row.id.toLowerCase())) statusById.set(row.id.toLowerCase(), row.status);
  return { available: true, file: ledger.file, statusById, problem: ledger.rows.length === 0 ? ledger.problems.join('; ') : null };
}

/**
 * Gate coverage.metrics over loaded pages.
 * @param {{pages: PageResult[], ledger: {available: boolean, file: string | null, statusById: Map<string, string>,
 *   problem: string | null}}} input
 * @returns {{ok: boolean, detail: string, evidence: Evidence[]}}
 */
export function evaluateMetrics({ pages, ledger }) {
  if (pages.length === 0) return { ok: false, detail: 'no page was loaded, so no figure was checked', evidence: [] };
  /** @type {Map<string, Evidence & {viewports: string[]}>} */
  const findings = new Map();
  let metricsSeen = 0;
  /** @param {string} key @param {Evidence} ev @param {string} viewport */
  const add = (key, ev, viewport) => {
    const known = findings.get(key);
    if (known) {
      if (!known.viewports.includes(viewport)) known.viewports.push(viewport);
      return;
    }
    findings.set(key, { ...ev, viewports: [viewport] });
  };
  for (const page of pages) {
    if (!page.probe) continue;
    const route = page.route.path;
    const viewport = page.viewport.name;
    for (const m of page.probe.metrics) {
      metricsSeen += 1;
      const why = metricProblem(m, ledger);
      if (why) add(`m|${route}|${m.sel}|${why}`, { route, selector: m.sel, value: `${why} (text "${m.text.slice(0, 60)}")` }, viewport);
    }
    for (const t of page.probe.texts) {
      if (!t.visible || t.marked || t.code || t.time) continue;
      if (!isStatLike(t, page.probe.bodyFontSize)) continue;
      add(`s|${route}|${t.sel}|${comparable(t.text)}`, {
        route,
        selector: t.sel,
        value: `stat-like figure "${comparable(t.text).slice(0, 60)}" has no data-metric with data-ledger, nor data-source with data-as-of`,
      }, viewport);
    }
  }
  const failed = pages.filter((p) => !p.probe);
  const list = [...findings.values()].map(({ viewports, ...ev }) => ({ ...ev, viewport: viewports.join(', ') }));
  if (failed.length > 0) {
    for (const p of failed) list.push({ route: p.route.path, viewport: p.viewport.name, value: `page did not load: ${p.error}` });
  }
  if (list.length > 0) {
    return {
      ok: false,
      detail: `${list.length} figure problem${list.length === 1 ? '' : 's'}: ${list[0].value} on ${list[0].route}${ledger.problem && !ledger.available ? ` (${ledger.problem})` : ''}`,
      evidence: cap(list),
    };
  }
  return {
    ok: true,
    detail: `${metricsSeen} data-metric element${metricsSeen === 1 ? '' : 's'} sourced across ${pages.length} page load${pages.length === 1 ? '' : 's'}; no unmarked stat-like figure${ledger.file ? ` (ledger ${ledger.file})` : ''}`,
    evidence: [],
  };
}

/**
 * @param {MetricProbe} m
 * @param {{available: boolean, statusById: Map<string, string>, problem: string | null}} ledger
 * @returns {string | null}
 */
function metricProblem(m, ledger) {
  const id = (m.ledger ?? '').trim();
  if (id) {
    if (!ledger.available) return `data-ledger="${id}" cannot be checked: ${ledger.problem ?? 'no claims ledger'}`;
    const status = ledger.statusById.get(id.toLowerCase());
    if (!status) return `data-ledger="${id}" is not a row of the claims ledger`;
    if (status !== 'verified') return `data-ledger="${id}" is ${status} in the claims ledger; only verified (or backed) rows render as figures`;
    return null;
  }
  const source = (m.source ?? '').trim();
  if (source) {
    if (!DATA_SOURCES.includes(source)) return `data-source="${source}" is not one of ${DATA_SOURCES.join('|')}`;
    if (!(m.asOf ?? '').trim()) return `data-source="${source}" has no data-as-of time`;
    return null;
  }
  return 'data-metric without data-ledger or data-source';
}

/**
 * Gate coverage.hero on the first route's pages.
 * @param {{pages: PageResult[], hero: {h1: string, sentence: string, source: string}}} input
 * @returns {{ok: boolean, detail: string, evidence: Evidence[]}}
 */
export function evaluateHero({ pages, hero }) {
  /** @type {Evidence[]} */
  const problems = [];
  if (pages.length === 0) problems.push({ value: 'no page of the first route was loaded' });
  for (const page of pages) {
    const route = page.route.path;
    const viewport = page.viewport.name;
    if (!page.probe) {
      problems.push({ route, viewport, value: `page did not load: ${page.error}` });
      continue;
    }
    for (const [role, want] of /** @type {const} */ ([['h1', hero.h1], ['sentence', hero.sentence]])) {
      const visible = page.probe.hero.filter((h) => h.role === role && h.visible);
      if (visible.length === 0) {
        problems.push({ route, viewport, value: `no visible [data-hero="${role}"]` });
        continue;
      }
      if (visible.length > 1) {
        problems.push({ route, viewport, selector: visible.map((h) => h.sel).join(', '), value: `${visible.length} visible [data-hero="${role}"] elements; keep one` });
        continue;
      }
      const el = visible[0];
      const expected = comparable(want);
      if (comparable(el.inner) !== expected && comparable(el.content) !== expected) {
        problems.push({ route, viewport, selector: el.sel, value: `[data-hero="${role}"] reads "${comparable(el.inner).slice(0, 120)}" but brief.hero.${role} is "${expected.slice(0, 120)}"` });
      }
    }
  }
  if (problems.length > 0) {
    return {
      ok: false,
      detail: `hero differs from brief.hero (source ${hero.source || 'unknown'}): ${problems[0].value} at ${problems[0].viewport}; re-render it from the source, never edit it by hand`,
      evidence: cap(problems),
    };
  }
  return {
    ok: true,
    detail: `[data-hero="h1"] and [data-hero="sentence"] equal brief.hero at ${viewportNames(pages).join(', ')} (source ${hero.source})`,
    evidence: [],
  };
}

/**
 * A matcher for one never-show entry over prepared text (NFKC, invisible characters removed, whitespace
 * collapsed): a literal substring, or the entry's regular expression. Unless case_sensitive, both sides are folded
 * as agreed with /execution (Q-F9, CONTRACTS 6.1b: NFKC then toLowerCase, lib/text.mjs foldNeverShow), and a regex
 * entry also gets the `i` flag, so the two skills match the same text the same way.
 * @param {Pick<NeverShowEntry, 'pattern' | 'regex' | 'case_sensitive'>} entry
 * @returns {(text: string) => boolean}
 */
export function neverShowMatcher(entry) {
  if (entry.regex) {
    if (entry.case_sensitive) {
      const re = new RegExp(entry.pattern);
      return (text) => re.test(comparable(text));
    }
    const re = new RegExp(entry.pattern, 'i');
    return (text) => re.test(foldNeverShow(comparable(text)));
  }
  const needle = comparable(entry.pattern);
  if (entry.case_sensitive) return (text) => comparable(text).includes(needle);
  const folded = foldNeverShow(needle);
  return (text) => foldNeverShow(comparable(text)).includes(folded);
}

/**
 * Gate coverage.nevershow over loaded pages. Evidence names the entry and the place, never the matched text.
 * @param {{pages: PageResult[], list: NeverShowList, now: Date}} input
 * @returns {{ok: boolean, detail: string, evidence: Evidence[]}}
 */
export function evaluateNeverShow({ pages, list, now }) {
  if (pages.length === 0) return { ok: false, detail: 'no page was loaded, so nothing was scanned', evidence: [] };
  const relevant = list.entries.filter((e) => e.scope === 'rendered' || e.scope === 'both');
  const active = relevant.filter((e) => isActive(e, now));
  const expired = relevant.length - active.length;
  /** @type {Evidence[]} */
  const problems = list.problems.map((p) => ({ file: list.file, value: `entry cannot be checked: ${p}` }));
  /** @type {Map<string, Evidence & {viewports: string[]}>} */
  const found = new Map();
  /** @param {string} key @param {Evidence} ev @param {string} viewport */
  const add = (key, ev, viewport) => {
    const known = found.get(key);
    if (known) {
      if (!known.viewports.includes(viewport)) known.viewports.push(viewport);
    } else {
      found.set(key, { ...ev, viewports: [viewport] });
    }
  };
  for (const entry of active) {
    const matches = neverShowMatcher(entry);
    for (const page of pages) {
      const route = page.route.path;
      const viewport = page.viewport.name;
      if (!page.probe) {
        add(`load|${route}`, { route, value: `page did not load, so it was not scanned: ${page.error}` }, viewport);
        continue;
      }
      const probe = page.probe;
      /** @param {string} where @param {string} [selector] */
      const hit = (where, selector = '') => add(`${entry.id}|${route}|${where}|${selector}`, {
        route, selector, entry: entry.id, class: entry.class,
        value: `${entry.id} (${entry.class}${entry.until_utc ? ` until ${entry.until_utc}` : ''}) found in ${where}`,
      }, viewport);
      const owners = probe.texts.filter((t) => matches(t.text));
      for (const t of owners.filter((o) => o.visible).slice(0, 5)) hit('visible text', t.sel);
      for (const t of owners.filter((o) => !o.visible).slice(0, 5)) hit('hidden page text', t.sel);
      if (owners.length === 0) {
        if (matches(probe.visibleText)) hit('visible text (across elements)');
        else if (matches(probe.allText)) hit('page text (across elements)');
      }
      if (matches(probe.title)) hit('the document title');
      for (const m of probe.metas) if (matches(m.content)) hit(`meta ${m.key || '(unnamed)'}`);
      for (const a of probe.attributes) if (matches(a.value)) hit(`attribute ${a.name}`, a.sel);
      for (const s of probe.dataScripts) if (matches(s.text)) hit('a JSON data script', s.sel);
    }
  }
  const scanned = `${active.length} active entr${active.length === 1 ? 'y' : 'ies'} of ${list.file}${expired ? ` (${expired} past their until_utc)` : ''}`;
  const findings = [...problems, ...[...found.values()].map(({ viewports, ...ev }) => ({ ...ev, viewport: viewports.join(', ') }))];
  if (findings.length > 0) {
    const first = findings[0];
    return {
      ok: false,
      detail: `${findings.length} never-show finding${findings.length === 1 ? '' : 's'}: ${first.value}${first.route ? ` on ${first.route} at ${first.viewport}` : ''}; ${scanned}`,
      evidence: cap(findings),
    };
  }
  return { ok: true, detail: `rendered text, title, meta, text attributes and data scripts clean of ${scanned} across ${pages.length} page loads`, evidence: [] };
}

/**
 * Placeholder patterns: kind, the expression, and whether it applies to the whole text of an element only.
 * @type {ReadonlyArray<{kind: string, re: RegExp, whole?: boolean}>}
 */
export const PLACEHOLDERS = Object.freeze([
  { kind: 'TODO', re: /\bTODO\b/ },
  { kind: 'FIXME', re: /\bFIXME\b/i },
  { kind: 'TBD', re: /\bTBD\b/ },
  { kind: 'lorem ipsum', re: /\blorem\b|\bipsum dolor\b|\bdolor sit amet\b/i },
  { kind: 'xxx', re: /(?<![\p{L}\p{N}])x{3,}(?![\p{L}\p{N}])/iu },
  { kind: '[YOUR ...]', re: /[[<{]\s*your(?:\b|_)[^\]>}]{0,60}[\]>}]/i },
  { kind: 'unrendered template', re: /\{\{[^{}]{0,80}\}\}|\$\{[^{}]{1,80}\}/ },
  { kind: 'example domain', re: /\bexample\.(?:com|org|net)\b/i },
  { kind: 'placeholder name', re: /\b(?:John|Jane) Doe\b|\bAcme\b|\bACME\b/ },
  { kind: 'coming soon stub', re: /\bcoming soon\b/i },
  { kind: 'broken value', re: /(?<![\p{L}\p{N}])NaN(?![\p{L}\p{N}])|\[object Object\]|\bInvalid Date\b/u },
  { kind: 'broken value', re: /^(?:undefined|null)$/, whole: true },
]);

/**
 * Placeholder hits in one text: [{kind, snippet}].
 * @param {string} text
 * @returns {Array<{kind: string, snippet: string}>}
 */
export function findPlaceholders(text) {
  const t = comparable(text);
  /** @type {Array<{kind: string, snippet: string}>} */
  const out = [];
  for (const { kind, re, whole } of PLACEHOLDERS) {
    const m = re.exec(t);
    if (!m || (whole && m[0] !== t)) continue;
    const start = Math.max(0, m.index - 30);
    const end = Math.min(t.length, m.index + m[0].length + 30);
    out.push({ kind, snippet: `${start > 0 ? '...' : ''}${t.slice(start, end)}${end < t.length ? '...' : ''}` });
  }
  return out;
}

/** Meta tags whose content is shown in a tab, a search result or a link preview. */
const SHOWN_META = /^(?:description|og:title|og:description|og:site_name|twitter:title|twitter:description|application-name)$/i;

/**
 * Gate coverage.placeholders over loaded pages: visible text outside code elements, the document title and the
 * meta tags a link preview shows.
 * @param {{pages: PageResult[]}} input
 * @returns {{ok: boolean, detail: string, evidence: Evidence[]}}
 */
export function evaluatePlaceholders({ pages }) {
  if (pages.length === 0) return { ok: false, detail: 'no page was loaded, so nothing was scanned', evidence: [] };
  /** @type {Map<string, Evidence & {viewports: string[]}>} */
  const findings = new Map();
  /** @param {string} key @param {Evidence} ev @param {string} viewport */
  const add = (key, ev, viewport) => {
    const known = findings.get(key);
    if (known) {
      if (!known.viewports.includes(viewport)) known.viewports.push(viewport);
    } else {
      findings.set(key, { ...ev, viewports: [viewport] });
    }
  };
  for (const page of pages) {
    const route = page.route.path;
    const viewport = page.viewport.name;
    if (!page.probe) {
      add(`${route}|load|${viewport}`, { route, value: `page did not load, so it was not scanned: ${page.error}` }, viewport);
      continue;
    }
    for (const t of page.probe.texts) {
      if (!t.visible || t.code) continue;
      for (const hit of findPlaceholders(t.text)) {
        add(`${route}|${t.sel}|${hit.kind}|${hit.snippet}`, { route, selector: t.sel, kind: hit.kind, value: `${hit.kind}: "${hit.snippet}"` }, viewport);
      }
    }
    for (const hit of findPlaceholders(page.probe.title)) {
      add(`${route}|title|${hit.kind}`, { route, selector: 'title', kind: hit.kind, value: `${hit.kind} in the document title: "${hit.snippet}"` }, viewport);
    }
    for (const m of page.probe.metas) {
      if (!SHOWN_META.test(m.key)) continue;
      for (const hit of findPlaceholders(m.content)) {
        add(`${route}|meta|${m.key}|${hit.kind}`, { route, selector: `meta[${m.key}]`, kind: hit.kind, value: `${hit.kind} in meta ${m.key}: "${hit.snippet}"` }, viewport);
      }
    }
  }
  const list = [...findings.values()].map(({ viewports, ...ev }) => ({ ...ev, viewport: viewports.join(', ') }));
  if (list.length > 0) {
    return {
      ok: false,
      detail: `${list.length} placeholder${list.length === 1 ? '' : 's'} in rendered text: ${list[0].value} on ${list[0].route}`,
      evidence: cap(list),
    };
  }
  return { ok: true, detail: `no placeholder in the rendered text, title or preview meta of ${pages.length} page load${pages.length === 1 ? '' : 's'}`, evidence: [] };
}

/**
 * @param {Evidence[]} evidence
 * @returns {Evidence[]}
 */
function cap(evidence) {
  if (evidence.length <= MAX_EVIDENCE) return evidence;
  return [...evidence.slice(0, MAX_EVIDENCE), { value: `and ${evidence.length - MAX_EVIDENCE} more` }];
}

// ---------------------------------------------------------------------------------------------------------------
// Page loading
// ---------------------------------------------------------------------------------------------------------------

/**
 * Loads one route at one viewport (record mode when the profile sets it), waits for readiness, and runs `fn`. A page
 * that never becomes ready is returned with its error; an unreachable target is an EnvError and propagates.
 * @template T
 * @param {CheckContext} ctx
 * @param {Route} route
 * @param {Viewport} viewport
 * @param {(page: Page) => Promise<T>} fn
 * @returns {Promise<{url: string, status: number | null, value: T | null, error: string | null}>}
 */
export async function loadPage(ctx, route, viewport, fn) {
  if (!ctx.browser || !ctx.baseUrl) throw new EnvError('no browser or base URL in the check context; run through frontend-check or the module CLI');
  const url = routeUrl(ctx.baseUrl, route, ctx.profile);
  const started = Date.now();
  try {
    return await withPage(ctx.browser, viewport, url, async (page, response) => {
      const value = await fn(page);
      ctx.log?.(`${route.path} at ${viewport.name} (${viewport.width}x${viewport.height}) read in ${Date.now() - started} ms`);
      return { url, status: response ? response.status() : null, value, error: null };
    }, { readyFlag: ctx.profile.ready_flag });
  } catch (err) {
    if (err instanceof CheckError) {
      ctx.log?.(`${route.path} at ${viewport.name}: ${err.message}`);
      return { url, status: null, value: null, error: err.message };
    }
    throw err;
  }
}

/**
 * @param {CheckContext} ctx
 * @returns {Viewport[]}
 */
export function contextViewports(ctx) {
  const list = ctx.viewports && ctx.viewports.length > 0 ? ctx.viewports : ctx.profile.viewports;
  return list.map((v) => ({ ...v }));
}

/**
 * @param {CheckContext} ctx
 * @returns {Date}
 */
function clockOf(ctx) {
  const raw = ctx.now ?? ctx.args?.now;
  if (raw === undefined || raw === null || raw === '') return new Date();
  const date = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(date.getTime())) throw new UsageError(`--now ${JSON.stringify(String(raw))} is not a date; pass an ISO 8601 UTC time`);
  return date;
}

/**
 * Check-module entry point (CONTRACTS section 4): loads each needed route at each viewport once and evaluates every
 * selected coverage gate on the same pages.
 * @param {CheckContext} ctx
 * @param {Iterable<string>} [selected]
 * @returns {Promise<GateResult[]>}
 */
export async function run(ctx, selected) {
  const want = selectedIds(selected, GATES);
  if (want.length === 0) return [];
  const builders = Object.fromEntries(GATES.map((g) => [g.id, gate(g)]));
  /** @type {Map<string, GateResult>} */
  const results = new Map();
  if (!ctx.browser || !ctx.baseUrl) {
    for (const id of want) results.set(id, builders[id].skip('no browser or target URL: pass --serve <built dir> or --url <running app>'));
    return want.map((id) => /** @type {GateResult} */ (results.get(id)));
  }
  const now = clockOf(ctx);
  const routes = ctx.routes.length > 0 ? ctx.routes : [{ path: '/', name: 'home', first: true, features: [], states: [] }];
  const firstRoute = routes.find((r) => r.first) ?? routes[0];
  const design = ctx.design ?? designDir(ctx.root, ctx.profile);
  const routesFile = isFileSync(path.join(design, 'routes.json'));

  /** @type {Set<string>} */
  const routePaths = new Set();
  /** @type {ReturnType<typeof requestedFeatures> | null} */
  let features = null;
  if (want.includes('coverage.features')) {
    features = requestedFeatures(ctx);
    if (features.problem) results.set('coverage.features', builders['coverage.features'].skip(`cannot list the features to check: ${features.problem}`));
    else if (features.ids.length === 0) {
      results.set('coverage.features', builders['coverage.features'].skip('no feature ids: set paths.feature_catalogue, pass --features FR-001,..., or compile brief.json with its features'));
    } else {
      const unmapped = features.ids.some((id) => !routes.some((r) => r.features.includes(id)));
      for (const r of routes) if (unmapped || features.ids.some((id) => r.features.includes(id))) routePaths.add(r.path);
    }
  }
  /** @type {{h1: string, sentence: string, source: string} | null} */
  let hero = null;
  if (want.includes('coverage.hero')) {
    const read = readBrief(ctx.state);
    if (!read.brief) results.set('coverage.hero', builders['coverage.hero'].skip(`cannot read brief.hero: ${read.error}; run brief.mjs first`));
    else if (!read.brief.hero.h1.trim() || !read.brief.hero.sentence.trim()) {
      results.set('coverage.hero', builders['coverage.hero'].skip('brief.hero is not filled yet (h1 and sentence come from the two-sentences source file, BF-05); nothing to compare'));
    } else {
      hero = read.brief.hero;
      routePaths.add(firstRoute.path);
    }
  }
  /** @type {NeverShowList | null} */
  let neverShow = null;
  if (want.includes('coverage.nevershow')) {
    const file = ctx.profile.paths?.never_show ?? null;
    if (!file) {
      results.set('coverage.nevershow', builders['coverage.nevershow'].skip('no never-show list: set paths.never_show (CT-12); nothing may be published before it exists and this scan passes'));
    } else {
      neverShow = loadNeverShow(file);
      if (!neverShow.exists) {
        results.set('coverage.nevershow', builders['coverage.nevershow'].skip(`the never-show list ${neverShow.file} does not exist; create it in the shared format (CT-12)`));
        neverShow = null;
      } else if (neverShow.entries.length === 0 && neverShow.problems.length > 0) {
        results.set('coverage.nevershow', builders['coverage.nevershow'].fail(`the never-show list ${neverShow.file} cannot be read: ${neverShow.problems[0]}`, { file: neverShow.file }));
        neverShow = null;
      } else {
        for (const r of routes) routePaths.add(r.path);
      }
    }
  }
  if (want.includes('coverage.metrics') || want.includes('coverage.placeholders')) for (const r of routes) routePaths.add(r.path);

  /** @type {PageResult[]} */
  const pages = [];
  const viewports = contextViewports(ctx);
  for (const route of routes.filter((r) => routePaths.has(r.path))) {
    for (const viewport of viewports) {
      const loaded = await loadPage(ctx, route, viewport, (page) => evaluateProbe(page, coverageProbe, {}));
      pages.push({ route, viewport, url: loaded.url, status: loaded.status, probe: loaded.value, error: loaded.error });
      if (loaded.status !== null && loaded.status >= 400) {
        const last = pages[pages.length - 1];
        last.error = `HTTP ${loaded.status} for ${loaded.url}`;
        last.probe = null;
      }
    }
  }
  /** @param {string} id @param {{ok: boolean, detail: string, evidence: Evidence[]}} r */
  const finish = (id, r) => results.set(id, r.ok ? builders[id].ok(r.detail, r.evidence) : builders[id].fail(r.detail, r.evidence));

  if (want.includes('coverage.features') && !results.has('coverage.features') && features) {
    const waivers = featureWaivers(design);
    const evaluated = evaluateFeatures({
      ids: features.ids, from: features.from, expected: features.expected, pages, routes, routesFile, waivers: waivers.ids,
    });
    if (waivers.problem) evaluated.evidence.push({ value: `waivers ignored: ${waivers.problem}` });
    for (const note of features.notes) evaluated.evidence.push({ value: note });
    finish('coverage.features', evaluated);
  }
  if (want.includes('coverage.metrics')) finish('coverage.metrics', evaluateMetrics({ pages, ledger: ledgerFor(ctx) }));
  if (want.includes('coverage.hero') && hero) {
    finish('coverage.hero', evaluateHero({ pages: pages.filter((p) => p.route.path === firstRoute.path), hero }));
  }
  if (want.includes('coverage.nevershow') && neverShow) finish('coverage.nevershow', evaluateNeverShow({ pages, list: neverShow, now }));
  if (want.includes('coverage.placeholders')) finish('coverage.placeholders', evaluatePlaceholders({ pages }));
  return want.map((id) => /** @type {GateResult} */ (results.get(id)));
}

/** @param {string} p @returns {boolean} */
function isFileSync(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The module CLI runner (shared with firstview.mjs)
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{tool: string, help: string, gates: ReadonlyArray<GateMeta>,
 *   run: (ctx: CheckContext, selected: string[]) => Promise<GateResult[]>,
 *   options?: Record<string, {type: 'string' | 'boolean'}>}} ModuleCli
 */

/** Flags every check module's CLI shares with frontend-check (CONTRACTS section 4). */
export const SHARED_HELP = `Target and output:
  --root <repo>        product repository (default: the working directory)
  --profile <path>     /execution profile.json (its frontend block) or a bare frontend block file
  --state <dir>        state directory (default: <root>/.execution/frontend in mode A, <root>/.frontend in mode B)
  --serve <dir>        serve this static build on 127.0.0.1 and check it
  --url <url>          check an app that is already running
  --gates <list>       gate ids or the group name, comma-separated (default: every gate of this module)
  --out <dir>          also write the report to <dir>/<tool>-<UTC>.json
  --json               print the report (JSON) on stdout
  -h, --help           this text`;

/**
 * @param {unknown} value
 * @param {ReadonlyArray<GateMeta>} gates
 * @returns {string[]}
 */
export function parseGateList(value, gates) {
  if (value === undefined || value === null || value === '') return gates.map((g) => g.id);
  const ids = gates.map((g) => g.id);
  const groups = new Set(ids.map((id) => id.split('.')[0]));
  const parts = String(value).split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = parts.filter((p) => !ids.includes(p) && !groups.has(p));
  if (unknown.length > 0) throw new UsageError(`unknown gate ${unknown.join(', ')}; this module runs ${ids.join(', ')}`);
  return ids.filter((id) => parts.includes(id) || parts.includes(id.split('.')[0]));
}

/**
 * Runs one check module from the command line: builds the same context frontend-check builds, serves `--serve` or
 * uses `--url`, launches one browser, prints one line per gate on stderr and the report with --json. Returns the
 * exit code: 0 when every selected gate is ok, 1 otherwise (a skipped gate is not ok).
 * @param {readonly string[]} argv
 * @param {ModuleCli} module
 * @returns {Promise<number>}
 */
export async function runModuleCli(argv, module) {
  const parsed = parseCli(argv, {
    help: module.help,
    allowPositionals: false,
    options: {
      root: { type: 'string' },
      profile: { type: 'string' },
      state: { type: 'string' },
      serve: { type: 'string' },
      url: { type: 'string' },
      gates: { type: 'string' },
      out: { type: 'string' },
      json: { type: 'boolean' },
      ...(module.options ?? {}),
    },
  });
  const values = /** @type {Record<string, string | boolean | undefined>} */ (parsed.values);
  if (parsed.positionals.length > 0) throw new UsageError(`unexpected argument ${parsed.positionals[0]}; run with --help for usage`);
  const serveDir = typeof values.serve === 'string' ? values.serve : null;
  const url = typeof values.url === 'string' ? values.url : null;
  if (serveDir && url) throw new UsageError('--serve and --url do not combine; pass one target');
  if (!serveDir && !url) throw new UsageError('no target: pass --serve <built dir> or --url <running app>');
  const root = path.resolve(typeof values.root === 'string' ? values.root : process.cwd());
  const profile = loadProfile(typeof values.profile === 'string' ? values.profile : undefined, { root });
  const out = typeof values.out === 'string' ? path.resolve(values.out) : null;
  const state = checkStateDir(root, profile, typeof values.state === 'string' ? values.state : null, out);
  const design = designDir(root, profile);
  const routes = loadRoutes(root, profile);
  const selected = parseGateList(values.gates, module.gates);
  const log = (/** @type {string} */ line) => process.stderr.write(`${module.tool}: ${line}\n`);
  const server = serveDir ? await serveStatic(serveDir) : null;
  /** @type {Browser | null} */
  let browser = null;
  /** @type {GateResult[]} */
  let results;
  try {
    const baseUrl = server ? server.url : /** @type {string} */ (url);
    if (!server) routeUrl(baseUrl, { path: '/' }, profile);
    browser = await launch();
    /** @type {CheckContext} */
    const ctx = { root: toPosix(root), profile, state, design, routes, baseUrl, browser, viewports: profile.viewports, args: out ? { ...values, outDir: toPosix(out) } : values, log };
    results = await module.run(ctx, selected);
  } finally {
    await browser?.close();
    await server?.close();
  }
  const report = aggregate(results, {
    requested: module.gates.filter((g) => selected.includes(g.id)),
    tool: module.tool,
    target: { root: toPosix(root), url: server ? `serve ${toPosix(path.resolve(/** @type {string} */ (serveDir)))}` : url, routes: routes.length, viewports: profile.viewports.map((v) => v.name) },
  });
  for (const g of report.gates) log(`${g.id}: ${g.state} - ${g.detail}`);
  log(`${report.counts.ok} ok, ${report.counts.fail} failed, ${report.counts.skipped} skipped`);
  if (typeof values.out === 'string') log(`report written to ${writeReport(report, values.out, `${module.tool}-${utcStamp()}`)}`);
  if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.ok ? 0 : 1;
}

const HELP = `Usage: node coverage.mjs (--serve <dir> | --url <url>) [--root <repo>] [--profile <path>] [--state <dir>]
                        [--gates <list>] [--features FR-003,FR-007] [--now <ISO UTC>] [--out <dir>] [--json]

Coverage gates on the rendered pages of every route in design/routes.json at every profile viewport, in record mode
(?record=1) when the profile sets record_mode:
  coverage.features      every requested FR id visible as data-feature, with a heading, a data-status label
                         (live|testnet|simulated|planned) and, unless planned, a visible proof marker; ids from
                         --features, else paths.feature_catalogue, else brief.json, else routes.json
  coverage.metrics       every data-metric carries data-ledger (a verified or backed row of the claims ledger) or
                         data-source (live|testnet|simulated) with data-as-of; no stat-like figure without a marker
  coverage.hero          [data-hero="h1"] and [data-hero="sentence"] equal brief.hero (normaliseText)
  coverage.nevershow     no active never-show entry (scope rendered or both, until_utc unset or in the future) in
                         visible or hidden text, the title, meta tags, text attributes or JSON data scripts
  coverage.placeholders  no TODO, FIXME, TBD, lorem, xxx, [YOUR ...], {{template}}, example.com, John Doe, Acme,
                         "coming soon", NaN, [object Object] or Invalid Date in rendered text, title or preview meta

${SHARED_HELP}
  --features <ids>     restrict coverage.features to these requirement ids
  --now <ISO UTC>      evaluate never-show dates at this time instead of now

Exit codes: 0 every selected gate ok; 1 a gate failed or was skipped; 2 usage error; 3 environment error (no
browser, unreachable URL, port in use).`;

/**
 * @param {readonly string[]} argv
 * @returns {Promise<number>}
 */
export function main(argv) {
  return runModuleCli(argv, {
    tool: 'coverage',
    help: HELP,
    gates: GATES,
    run,
    options: { features: { type: 'string' }, now: { type: 'string' } },
  });
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
