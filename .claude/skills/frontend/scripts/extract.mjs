// @ts-check
/**
 * Two jobs on the reference side of P1 (ARCHITECTURE section 4):
 *   1. `extract`: reads capture folders written by capture.mjs and computes, per reference, the measured design
 *      facts the pattern ledger is written from: font-size histogram and scale ratio, spacing histogram and base
 *      unit, radius family, palette roles (ground by painted area, ink by share of text, accent by primary call-to-
 *      action backgrounds), density, nav and above-the-fold call-to-action counts, figures row, number formatting,
 *      light or dark ground, plus breakpoints, rendered fonts and the reveal probe. Output: refs-extract.json, kept
 *      in the private captures root. Raw values are tier "measured" (facts); roles and summaries are tier "inferred"
 *      (re-check them before they constrain the build, research FD05-F08, F20).
 *   2. `validate-ledger`: the gates refs.ledger and refs.receipts on pattern-ledger.json (CONTRACTS 6.5).
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPTURE_FILES, CONSENT_PATTERN, DEFAULT_STYLE_VALUES, MAX_HOSTS, MAX_VIEWPORTS_PER_PAGE, POLICY_ID, PRODUCT_TOKEN,
  REFS_INDEX, listCaptureDirs, purgeCommand, readJson, readRefsIndex, resolveCapturesRoot, sameDocument, writeJson,
} from './capture-gate.mjs';
import { parseCli, isMainModule } from './lib/args.mjs';
import { composite, contrastRatio, parseColor, toHex, toOklch } from './lib/color.mjs';
import { CheckError, UsageError, exitWith } from './lib/errors.mjs';
import { sha256File, toPosix } from './lib/fsutil.mjs';
import { stateDir } from './lib/paths.mjs';
import { loadProfile } from './lib/profile.mjs';
import { aggregate, gate as gateBuilder, writeReport } from './lib/report.mjs';

/**
 * @typedef {import('./lib/color.mjs').Rgba} Rgba
 * @typedef {import('./lib/report.mjs').GateResult} GateResult
 * @typedef {import('./lib/report.mjs').Evidence} Evidence
 * @typedef {{x: number, y: number, w: number, h: number}} Box
 * @typedef {{sel: string, tag: string, role: string, box: Box, visible: boolean, text: string,
 *   styles: Record<string, string>, attrs: Record<string, string>, meta: Record<string, string>, parent: number,
 *   depth: number}} El
 * @typedef {{sel: string, text: string, fontSize: number, fontFamily: string, fontWeight: number, color: string,
 *   bg: string, bgImage: string | null, box: Box, inViewport: boolean, visible: boolean, tag: string}} TextRec
 * @typedef {{sel: string, tag: string, text: string, context: string, fontSize: number, fontWeight: number,
 *   fontFamily: string, fontVariantNumeric: string, fontFeatureSettings: string, color: string, box: Box,
 *   inViewport: boolean, interactive: boolean}} NumRec
 * @typedef {{width: number, height: number, dpr: number, scrollWidth: number, scrollHeight: number,
 *   colorScheme: string, rootBackground: string, bodyBackground: string, rootFontSize: number,
 *   jpegQ70Bytes?: number}} PageInfo
 * @typedef {{level: number, size: number, text: string}} HeadingInfo
 * @typedef {{sel: string, tag: string, role: string, box: Box, depth: number, position: string, label: string,
 *   heading: HeadingInfo | null, links: number, buttons: number, consent: boolean}} Landmark
 * @typedef {{sel: string, tag: string, box: Box, background: string, backgroundImage: string | null,
 *   heading: HeadingInfo | null, columns: number, images: number, canvases: number, links: number, buttons: number,
 *   consent: boolean}} Section
 * @typedef {{landmarks: Landmark[], sections: Section[], canvases: Array<{sel: string, box: Box, engine: string,
 *   aboveFold: boolean}>, consent: Array<{sel: string, box: Box}>}} LandmarksData
 * @typedef {{name: string, page: PageInfo, readiness: {ok: boolean, detail: string}, elements: El[],
 *   text: TextRec[], numbers: NumRec[], landmarks: LandmarksData, reveal: Record<string, any>,
 *   fonts: Record<string, any>, declared: Record<string, any>, states: Array<Record<string, any>>}} ViewportData
 * @typedef {{dir: string, manifest: Record<string, any>, receipt: Record<string, any>,
 *   mediaQueries: Record<string, any> | null, viewports: ViewportData[]}} Capture
 * @typedef {{vp: ViewportData, els: El[], consent: Uint8Array, nav: Uint8Array, opacity: Float64Array,
 *   bySel: Map<string, number>, canvas: Rgba, backdrops: Map<number, Rgba>}} Prepared
 */

export const EXTRACT_VERSION = '1';
const ICON_FONT = /(icon|icons|symbol|awesome|material|glyph|feather|ionicons|dashicons|lucide|remixicon)/i;
const PRIVATE_USE = new RegExp(`^[${String.fromCharCode(0xe000)}-${String.fromCharCode(0xf8ff)}\\s]+$`);
/** Browser default link colours: a role assigned from them would describe the browser, not the site (FD05-F20). */
const BROWSER_DEFAULTS = Object.freeze(['#0000ee', '#551a8b', '#0000ff']);
const NAMED_SCALES = Object.freeze(/** @type {Array<[string, number]>} */ ([
  ['minor second', 1.067], ['major second', 1.125], ['minor third', 1.2], ['major third', 1.25],
  ['perfect fourth', 1.333], ['augmented fourth', 1.414], ['perfect fifth', 1.5], ['golden ratio', 1.618],
]));
const BASE_UNITS = Object.freeze([16, 12, 10, 8, 6, 5, 4, 3, 2]);
const NBSP = String.fromCharCode(0xa0);
const NNBSP = String.fromCharCode(0x202f);
const NUMBER_TOKEN = new RegExp(`\\d(?:[\\d.,'${NBSP}${NNBSP}]*\\d)?`, 'g');
const CURRENCY = '$€£¥₿₹';
const SIDES = /** @type {const} */ (['Top', 'Right', 'Bottom', 'Left']);
const PAINT_STEP = 16;
const MAX_PAINT_HEIGHT = 24_000;

// ---------- small helpers ----------

/** @param {number} x @param {number} [digits] */
function round(x, digits = 3) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/** @param {number} x */
function roundHalf(x) {
  return Math.round(x * 2) / 2;
}

/**
 * @param {El} el
 * @param {string} key
 * @returns {string}
 */
export function styleOf(el, key) {
  const own = el.styles?.[key];
  if (own !== undefined) return own;
  return /** @type {Record<string, string>} */ (DEFAULT_STYLE_VALUES)[key] ?? '';
}

/** @param {string} value @returns {number} */
function px(value) {
  const m = /^(-?[\d.]+)px$/.exec(String(value).trim());
  return m ? Number(m[1]) : Number.NaN;
}

/** @param {string} stack */
export function firstFamily(stack) {
  return String(stack ?? '').split(',')[0].trim().replace(/^["']|["']$/g, '');
}

/** @param {Rgba} c */
function hexOf(c) {
  return toHex({ ...c, a: 1 });
}

/** @param {Rgba} c */
function oklab(c) {
  const { l, c: chroma, h } = toOklch(c);
  const rad = (h * Math.PI) / 180;
  return { L: l, a: chroma * Math.cos(rad), b: chroma * Math.sin(rad), C: chroma, h };
}

/** @param {Rgba} x @param {Rgba} y */
function deltaE(x, y) {
  const a = oklab(x);
  const b = oklab(y);
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

const WHITE = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });

/** @param {string} css @param {Rgba} under */
function solidOver(css, under) {
  const c = parseColor(css);
  if (!c) return null;
  return c.a >= 1 ? c : composite(c, under);
}

/**
 * @template T
 * @param {Map<T, number>} map
 * @param {T} key
 * @param {number} add
 */
function bump(map, key, add) {
  map.set(key, (map.get(key) ?? 0) + add);
}

/**
 * @param {Map<string, number>} map
 * @param {number} total
 * @param {number} [limit]
 */
function shares(map, total, limit = 8) {
  return [...map].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, n]) => ({ color: key, share: round(total ? n / total : 0) }));
}

// ---------- loading ----------

/**
 * Reads one capture folder. The stored files must still match the manifest's SHA-256; a purged folder cannot be
 * read (extract before purging).
 * @param {string} dir
 * @returns {Capture}
 */
export function loadCapture(dir) {
  const abs = path.resolve(dir);
  const F = CAPTURE_FILES;
  if (existsSync(path.join(abs, F.deletion))) {
    throw new UsageError(`${toPosix(abs)} was purged (${F.deletion} exists); its measurements are gone: extract before purging`);
  }
  const manifest = readJson(path.join(abs, F.manifest), 'capture manifest');
  const receipt = readJson(path.join(abs, F.receipt), 'gate receipt');
  if (receipt?.verdict !== 'captured') throw new UsageError(`${toPosix(abs)}: the gate receipt says ${String(receipt?.verdict)}, not captured`);
  for (const f of Array.isArray(manifest?.files) ? manifest.files : []) {
    const file = path.join(abs, ...String(f.name).split('/'));
    if (!existsSync(file)) throw new UsageError(`${toPosix(file)} is listed in the manifest but missing; the capture is incomplete`);
    if (sha256File(file) !== f.sha256) throw new UsageError(`${toPosix(file)} changed since the capture (SHA-256 differs from the manifest); recapture is not allowed (P17): delete the folder`);
  }
  const styles = readJson(path.join(abs, F.styles), 'styles.json');
  const fonts = readJson(path.join(abs, F.fonts), 'fonts.json');
  const landmarks = readJson(path.join(abs, F.landmarks), 'landmarks.json');
  const reveal = readJson(path.join(abs, F.reveal), 'reveal.json');
  const names = Object.keys(styles?.viewports ?? {});
  if (names.length === 0) throw new UsageError(`${toPosix(path.join(abs, F.styles))} holds no viewport`);
  const viewports = names.map((name) => {
    const s = styles.viewports[name];
    return {
      name,
      page: s.page,
      readiness: s.readiness ?? { ok: true, detail: '' },
      elements: Array.isArray(s.elements) ? s.elements : [],
      text: Array.isArray(s.text) ? s.text : [],
      numbers: Array.isArray(s.numbers) ? s.numbers : [],
      declared: s.declared ?? {},
      states: Array.isArray(s.states) ? s.states : [],
      landmarks: landmarks?.viewports?.[name] ?? { landmarks: [], sections: [], canvases: [], consent: [] },
      reveal: reveal?.viewports?.[name] ?? {},
      fonts: fonts?.viewports?.[name] ?? {},
    };
  });
  return { dir: abs, manifest, receipt, mediaQueries: styles.mediaQueries ?? null, viewports };
}

/**
 * The capture folders named on the command line: a capture folder itself, or every capture under a captures root
 * or a host folder.
 * @param {string[]} targets
 * @returns {string[]}
 */
export function findCaptures(targets) {
  /** @type {string[]} */
  const out = [];
  for (const t of targets) {
    const abs = path.resolve(t);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new UsageError(`${toPosix(abs)} is not a folder; pass capture folders or a captures root`);
    if (existsSync(path.join(abs, CAPTURE_FILES.manifest))) {
      out.push(abs);
      continue;
    }
    const nested = listCaptureDirs(abs);
    const direct = nested.length ? nested : listCaptureDirs(path.dirname(abs)).filter((d) => path.dirname(d) === abs);
    out.push(...direct);
  }
  return [...new Set(out)];
}

// ---------- per-viewport preparation ----------

/**
 * The CSS canvas colour: the root background, else the body's (propagated), else white (dark when the page only
 * declares a dark color-scheme).
 * @param {PageInfo} page
 * @returns {Rgba}
 */
export function canvasColour(page) {
  for (const css of [page?.rootBackground, page?.bodyBackground]) {
    const c = parseColor(css ?? '');
    if (c && c.a > 0) return c.a >= 1 ? c : composite(c, WHITE);
  }
  const scheme = String(page?.colorScheme ?? '');
  return /\bdark\b/.test(scheme) && !/\blight\b/.test(scheme) ? { r: 18 / 255, g: 18 / 255, b: 18 / 255, a: 1 } : { ...WHITE };
}

/**
 * Consent membership, nav membership and effective opacity of every element (parents come before children).
 * @param {ViewportData} vp
 * @returns {Prepared}
 */
export function prepare(vp) {
  const els = vp.elements;
  const n = els.length;
  const consent = new Uint8Array(n);
  const nav = new Uint8Array(n);
  const opacity = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const el = els[i];
    const p = el.parent >= 0 && el.parent < i ? el.parent : -1;
    const own = CONSENT_PATTERN.test(el.meta?.id ?? '') || CONSENT_PATTERN.test(el.meta?.class ?? '');
    consent[i] = own || (p >= 0 && consent[p]) ? 1 : 0;
    const isNav = el.tag === 'nav' || el.tag === 'header' || el.role === 'navigation' || el.role === 'banner';
    nav[i] = isNav || (p >= 0 && nav[p]) ? 1 : 0;
    const o = Number.parseFloat(styleOf(el, 'opacity'));
    opacity[i] = (Number.isFinite(o) ? o : 1) * (p >= 0 ? opacity[p] : 1);
  }
  return { vp, els, consent, nav, opacity, bySel: new Map(els.map((el, i) => [el.sel, i])), canvas: canvasColour(vp.page), backdrops: new Map() };
}

/**
 * The opaque colour behind an element: its ancestors' background colours composited over the canvas.
 * @param {Prepared} prep
 * @param {number} i
 * @returns {Rgba}
 */
function backdropOf(prep, i) {
  const cached = prep.backdrops.get(i);
  if (cached) return cached;
  const p = prep.els[i].parent;
  let under = prep.canvas;
  if (p >= 0 && p < i) {
    const below = backdropOf(prep, p);
    const bg = parseColor(styleOf(prep.els[p], 'backgroundColor'));
    under = bg && bg.a > 0 ? (bg.a >= 1 ? bg : composite({ ...bg, a: bg.a * prep.opacity[p] }, below)) : below;
  }
  prep.backdrops.set(i, under);
  return under;
}

/**
 * Text records that carry a design reading: visible, outside consent widgets, not an icon font.
 * @param {Prepared} prep
 * @returns {TextRec[]}
 */
function readableText(prep) {
  return prep.vp.text.filter((t) => {
    if (!t.visible || !(t.fontSize > 0)) return false;
    const i = prep.bySel.get(t.sel);
    if (i !== undefined && prep.consent[i]) return false;
    if (ICON_FONT.test(firstFamily(t.fontFamily)) || PRIVATE_USE.test(t.text)) return false;
    return t.text.replace(/\s+/g, '').length > 0;
  });
}

// ---------- type ----------

/**
 * Font sizes weighted by characters of text, in half-pixel bins.
 * @param {TextRec[]} texts
 * @returns {{total: number, bins: Array<{px: number, chars: number, share: number}>}}
 */
export function fontSizeHistogram(texts) {
  /** @type {Map<number, number>} */
  const hist = new Map();
  let total = 0;
  for (const t of texts) {
    const chars = t.text.replace(/\s+/g, '').length;
    if (!chars || !(t.fontSize > 0)) continue;
    bump(hist, roundHalf(t.fontSize), chars);
    total += chars;
  }
  return { total, bins: [...hist].sort((a, b) => a[0] - b[0]).map(([size, chars]) => ({ px: size, chars, share: round(total ? chars / total : 0) })) };
}

/**
 * The body size: the size holding the most characters between 12 and 24 px (the most used size overall otherwise).
 * @param {Array<{px: number, chars: number}>} bins
 * @returns {number | null}
 */
export function bodySize(bins) {
  const inRange = bins.filter((b) => b.px >= 12 && b.px <= 24);
  const pool = inRange.length ? inRange : bins;
  if (pool.length === 0) return null;
  return pool.reduce((best, b) => (b.chars > best.chars ? b : best)).px;
}

/**
 * The type-scale ratio: the largest r in [1.05, 1.7] such that every step above the body size sits within 0.12 of
 * an integer power of r (body x r^k) sets the powers; the ratio reported is then the least-squares fit of those
 * powers. Needs at least two steps above the body. Also reports the nearest named scale.
 * @param {number[]} sizes
 * @param {number} base
 * @returns {{ratio: number | null, named: string | null, fit: 'exact' | 'none' | 'insufficient', steps: number[],
 *   powers: number[], medianStep: number | null}}
 */
export function fitScaleRatio(sizes, base) {
  const steps = [...new Set(sizes.filter((s) => s > base * 1.02).map((s) => round(s, 2)))].sort((a, b) => a - b);
  const all = [base, ...steps];
  const consecutive = all.slice(1).map((s, i) => s / all[i]).sort((a, b) => a - b);
  const medianStep = consecutive.length ? round(consecutive[Math.floor(consecutive.length / 2)]) : null;
  if (steps.length < 2) return { ratio: null, named: null, fit: 'insufficient', steps: all, powers: [], medianStep };
  const logs = steps.map((s) => Math.log(s / base));
  for (let r = 1.7; r >= 1.05; r -= 0.0005) {
    const lr = Math.log(r);
    let worst = 0;
    for (const e of logs) {
      const k = e / lr;
      worst = Math.max(worst, Math.abs(k - Math.round(k)), Math.round(k) < 1 ? 1 : 0);
      if (worst > 0.12) break;
    }
    if (worst <= 0.12) {
      const powers = logs.map((e) => Math.round(e / lr));
      const fitted = Math.exp(logs.reduce((s, e, i) => s + e * powers[i], 0) / powers.reduce((s, k) => s + k * k, 0));
      // Sizes come in half-pixel bins, so a third decimal would claim more precision than the data has.
      const ratio = round(fitted, 2);
      const near = NAMED_SCALES.reduce((best, s) => (Math.abs(s[1] - ratio) < Math.abs(best[1] - ratio) ? s : best));
      return {
        ratio,
        named: Math.abs(near[1] - ratio) <= 0.02 ? near[0] : null,
        fit: 'exact',
        steps: all,
        powers,
        medianStep,
      };
    }
  }
  return { ratio: null, named: null, fit: 'none', steps: all, powers: [], medianStep };
}

/**
 * @param {El} el
 */
function headingStyle(el) {
  const size = px(styleOf(el, 'fontSize'));
  const lh = px(styleOf(el, 'lineHeight'));
  const ls = styleOf(el, 'letterSpacing');
  const lsPx = ls === 'normal' ? 0 : px(ls);
  return {
    px: round(size, 2),
    weight: Number(styleOf(el, 'fontWeight')) || 400,
    lineHeight: Number.isFinite(lh) && size ? round(lh / size, 2) : null,
    letterSpacingEm: Number.isFinite(lsPx) && size ? round(lsPx / size, 3) : null,
    family: firstFamily(styleOf(el, 'fontFamily')),
    textTransform: styleOf(el, 'textTransform'),
  };
}

/**
 * @param {Prepared} prep
 */
function typeOf(prep) {
  const texts = readableText(prep);
  const hist = fontSizeHistogram(texts);
  const body = bodySize(hist.bins);
  /** @type {Record<string, ReturnType<typeof headingStyle> & {count: number}>} */
  const headings = {};
  for (const level of ['h1', 'h2', 'h3']) {
    const list = prep.els.filter((el, i) => el.tag === level && !prep.consent[i]);
    if (list.length === 0) continue;
    if (level === 'h1') {
      headings.h1 = { ...headingStyle(list[0]), count: list.length };
      continue;
    }
    /** @type {Map<number, number>} */
    const bySize = new Map();
    for (const el of list) bump(bySize, roundHalf(px(styleOf(el, 'fontSize'))), 1);
    const mode = [...bySize].sort((a, b) => b[1] - a[1])[0][0];
    const pick = list.find((el) => roundHalf(px(styleOf(el, 'fontSize'))) === mode) ?? list[0];
    headings[level] = { ...headingStyle(pick), count: list.length };
  }
  const vh = prep.vp.page?.height ?? 0;
  const display = texts.filter((t) => t.box.y < vh && t.text.replace(/\s+/g, '').length >= 3).reduce((m, t) => Math.max(m, t.fontSize), 0);
  /** @type {Map<string, number>} */
  const families = new Map();
  for (const t of texts) bump(families, firstFamily(t.fontFamily), t.text.replace(/\s+/g, '').length);
  const candidates = hist.bins.filter((b) => b.share >= 0.01).map((b) => b.px);
  for (const h of Object.values(headings)) if (Number.isFinite(h.px)) candidates.push(roundHalf(h.px));
  const clustered = clusterSizes(candidates);
  const scale = body ? fitScaleRatio(clustered, body) : fitScaleRatio([], 16);
  const bodyText = texts.filter((t) => roundHalf(t.fontSize) === body);
  return {
    tier: 'measured',
    histogram: hist.bins,
    body: body === null ? null : { px: body, chars: hist.bins.find((b) => b.px === body)?.chars ?? 0, weight: modeOf(bodyText.map((t) => t.fontWeight)) },
    headings,
    display: display ? round(display, 2) : null,
    families: shares(families, hist.total).map((f) => ({ family: f.color, share: f.share })),
    scale: { ...scale, h1Ratio: body && headings.h1 ? round(headings.h1.px / body) : null, tier: 'inferred' },
  };
}

/** @param {number[]} values */
function modeOf(values) {
  /** @type {Map<number, number>} */
  const m = new Map();
  for (const v of values) bump(m, v, 1);
  const top = [...m].sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : null;
}

/**
 * Merges sizes within 3% of each other (keeps the smaller).
 * @param {number[]} sizes
 */
function clusterSizes(sizes) {
  const sorted = [...new Set(sizes.filter((s) => Number.isFinite(s) && s > 0))].sort((a, b) => a - b);
  /** @type {number[]} */
  const out = [];
  for (const s of sorted) if (!out.length || s / out[out.length - 1] > 1.03) out.push(s);
  return out;
}

// ---------- spacing ----------

/**
 * Margins, paddings and gaps of visible elements, in half-pixel bins, and the base unit: the largest of 16, 12, 10,
 * 8, 6, 5, 4, 3, 2 px that divides at least 80% of them (within 0.5 px).
 * @param {Prepared} prep
 */
export function spacingOf(prep) {
  /** @type {Map<number, number>} */
  const hist = new Map();
  let total = 0;
  prep.els.forEach((el, i) => {
    if (prep.consent[i]) return;
    const values = ['marginTop', 'marginBottom', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map((k) => px(styleOf(el, k)));
    for (const g of styleOf(el, 'gap').split(/\s+/)) values.push(px(g));
    for (const v of values) {
      if (!Number.isFinite(v) || v <= 0) continue;
      bump(hist, roundHalf(v), 1);
      total += 1;
    }
  });
  const bins = [...hist].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ px: value, count, share: round(total ? count / total : 0) }));
  /** @type {Record<string, number>} */
  const coverage = {};
  for (const u of BASE_UNITS) {
    let hit = 0;
    for (const b of bins) if (Math.abs(b.px / u - Math.round(b.px / u)) * u <= 0.5) hit += b.count;
    coverage[String(u)] = round(total ? hit / total : 0);
  }
  const base = BASE_UNITS.find((u) => coverage[String(u)] >= 0.8) ?? null;
  return {
    tier: 'inferred',
    histogram: bins,
    total,
    base,
    coverage,
    steps: bins.filter((b) => b.share >= 0.03).map((b) => b.px),
  };
}

// ---------- radius ----------

/**
 * @param {El} el
 * @returns {{px: number, pill: boolean} | null} null when the element has no radius value
 */
function radiusOf(el) {
  const first = styleOf(el, 'borderRadius').split(/[\s/]+/)[0] ?? '0px';
  let r = Number.NaN;
  if (first.endsWith('%')) r = (Number.parseFloat(first) / 100) * Math.min(el.box.w, el.box.h);
  else r = px(first);
  if (!Number.isFinite(r)) return null;
  const half = Math.min(el.box.w, el.box.h) / 2;
  return { px: round(r, 1), pill: r > 0 && half > 0 && r >= half - 1 };
}

/**
 * True when an element paints a surface whose corners show: a background, a visible border or a shadow.
 * @param {El} el
 */
function isSurface(el) {
  const bg = parseColor(styleOf(el, 'backgroundColor'));
  if ((bg && bg.a > 0.05) || styleOf(el, 'backgroundImage') !== 'none' || styleOf(el, 'boxShadow') !== 'none') return true;
  return SIDES.some((s) => px(styleOf(el, `border${s}Width`)) > 0 && (parseColor(styleOf(el, `border${s}Color`))?.a ?? 0) > 0);
}

/**
 * The lower median of sorted values (the smaller of the two middle values on a tie), or null when empty.
 * @param {number[]} sorted
 * @returns {number | null}
 */
function lowerMedian(sorted) {
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
}

/** @param {number} r */
function radiusClass(r) {
  if (r <= 0) return 'sharp';
  if (r <= 3) return 'subtle';
  if (r <= 8) return 'rounded';
  if (r <= 16) return 'soft';
  return 'large';
}

/**
 * @param {Prepared} prep
 * @param {Array<{i: number}>} ctas
 */
export function radiusOfPage(prep, ctas) {
  /** @type {Map<string, number>} */
  const hist = new Map();
  let surfaces = 0;
  let zero = 0;
  let pills = 0;
  /** @type {number[]} */
  const nonZero = [];
  prep.els.forEach((el, i) => {
    if (prep.consent[i] || !isSurface(el) || el.box.w < 4 || el.box.h < 4) return;
    const r = radiusOf(el);
    if (!r) return;
    surfaces += 1;
    if (r.pill) {
      pills += 1;
      bump(hist, 'pill', 1);
      return;
    }
    bump(hist, String(r.px), 1);
    if (r.px <= 0) zero += 1;
    else nonZero.push(r.px);
  });
  nonZero.sort((a, b) => a - b);
  const median = lowerMedian(nonZero) ?? 0;
  const family = surfaces === 0 ? null : zero / surfaces >= 0.7 ? 'sharp' : pills / surfaces >= 0.5 ? 'pill' : radiusClass(median);
  const buttonRadii = ctas.map(({ i }) => radiusOf(prep.els[i])).filter((r) => r !== null);
  const buttonPills = buttonRadii.filter((r) => r.pill).length;
  const buttonValues = buttonRadii.filter((r) => !r.pill).map((r) => r.px).sort((a, b) => a - b);
  const buttonMedian = lowerMedian(buttonValues);
  return {
    tier: 'inferred',
    histogram: [...hist].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value: value === 'pill' ? 'pill' : Number(value), count })),
    surfaces,
    family,
    median: nonZero.length ? median : 0,
    steps: [...new Set(nonZero)].filter((v) => nonZero.filter((x) => x === v).length / Math.max(1, surfaces) >= 0.05),
    buttons: buttonRadii.length === 0 ? null : {
      count: buttonRadii.length,
      shape: buttonPills / buttonRadii.length >= 0.5 ? 'pill' : radiusClass(buttonMedian ?? 0),
      px: buttonPills / buttonRadii.length >= 0.5 ? null : buttonMedian,
    },
  };
}

// ---------- painted backgrounds ----------

/**
 * Samples the page every PAINT_STEP px and paints each cell with the background colours of the elements covering
 * its centre, in document order (later and deeper paint over earlier; z-index is ignored), over the canvas. Cells
 * under a background image or gradient are counted apart: their colour is not known from styles.
 * @param {Prepared} prep
 */
export function paintGrid(prep) {
  const page = prep.vp.page;
  const width = Math.max(1, Math.round(page?.width ?? 1));
  const height = Math.max(1, Math.min(MAX_PAINT_HEIGHT, Math.round(page?.scrollHeight || page?.height || 1)));
  const cols = Math.ceil(width / PAINT_STEP);
  const rows = Math.ceil(height / PAINT_STEP);
  const cells = new Float64Array(cols * rows * 3);
  const image = new Uint8Array(cols * rows);
  for (let k = 0; k < cols * rows; k += 1) {
    cells[k * 3] = prep.canvas.r;
    cells[k * 3 + 1] = prep.canvas.g;
    cells[k * 3 + 2] = prep.canvas.b;
  }
  prep.els.forEach((el, i) => {
    if (prep.consent[i]) return;
    const bg = parseColor(styleOf(el, 'backgroundColor'));
    const alpha = bg ? bg.a * prep.opacity[i] : 0;
    const hasImage = styleOf(el, 'backgroundImage') !== 'none';
    if (alpha < 0.02 && !hasImage) return;
    const c0 = Math.max(0, Math.ceil((el.box.x - PAINT_STEP / 2) / PAINT_STEP));
    const c1 = Math.min(cols - 1, Math.floor((el.box.x + el.box.w - PAINT_STEP / 2) / PAINT_STEP));
    const r0 = Math.max(0, Math.ceil((el.box.y - PAINT_STEP / 2) / PAINT_STEP));
    const r1 = Math.min(rows - 1, Math.floor((el.box.y + el.box.h - PAINT_STEP / 2) / PAINT_STEP));
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const k = r * cols + c;
        if (bg && alpha >= 0.02) {
          cells[k * 3] = bg.r * alpha + cells[k * 3] * (1 - alpha);
          cells[k * 3 + 1] = bg.g * alpha + cells[k * 3 + 1] * (1 - alpha);
          cells[k * 3 + 2] = bg.b * alpha + cells[k * 3 + 2] * (1 - alpha);
          if (alpha >= 0.98) image[k] = 0;
        }
        if (hasImage) image[k] = 1;
      }
    }
  });
  const firstRows = Math.min(rows, Math.ceil((page?.height ?? height) / PAINT_STEP));
  /** @type {Map<string, number>} */
  const page1 = new Map();
  /** @type {Map<string, number>} */
  const fold = new Map();
  let imageCells = 0;
  let imageFold = 0;
  let dark = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const k = r * cols + c;
      const hex = hexOf({ r: cells[k * 3], g: cells[k * 3 + 1], b: cells[k * 3 + 2], a: 1 });
      bump(page1, hex, 1);
      if (r < firstRows) bump(fold, hex, 1);
      if (image[k]) {
        imageCells += 1;
        if (r < firstRows) imageFold += 1;
      }
      if (toOklch({ r: cells[k * 3], g: cells[k * 3 + 1], b: cells[k * 3 + 2] }).l < 0.4) dark += 1;
    }
  }
  const total = cols * rows;
  const foldTotal = cols * firstRows;
  return {
    page: shares(page1, total),
    firstViewport: shares(fold, foldTotal),
    imageShare: round(total ? imageCells / total : 0),
    imageShareFirstViewport: round(foldTotal ? imageFold / foldTotal : 0),
    darkShare: round(total ? dark / total : 0),
    sampledHeight: height,
  };
}

// ---------- calls to action, palette ----------

/**
 * Call-to-action candidates: visible links and buttons with a short label and a button-like box, outside consent
 * widgets. `filled` when the background stands out from what is behind it, `outline` when a border does.
 * @param {Prepared} prep
 */
export function callsToAction(prep) {
  const vh = prep.vp.page?.height ?? 0;
  /** @type {Array<{i: number, filled: boolean, outline: boolean, inNav: boolean, aboveFold: boolean, bg: string | null}>} */
  const out = [];
  prep.els.forEach((el, i) => {
    if (prep.consent[i]) return;
    const type = (el.meta?.type ?? '').toLowerCase();
    const clickable = el.tag === 'button' || el.role === 'button' || (el.tag === 'a' && Boolean(el.meta?.href)) || (el.tag === 'input' && ['submit', 'button'].includes(type));
    if (!clickable) return;
    const label = el.text.trim();
    if (el.tag !== 'input' && (label.length < 1 || label.length > 48)) return;
    if (el.box.h < 20 || el.box.h > 100 || el.box.w < 24 || el.box.w > 600) return;
    const behind = backdropOf(prep, i);
    const bg = parseColor(styleOf(el, 'backgroundColor'));
    const effective = bg && bg.a * prep.opacity[i] >= 0.5 ? (bg.a >= 1 ? bg : composite(bg, behind)) : null;
    const filled = Boolean(effective && deltaE(effective, behind) >= 0.06);
    let outline = false;
    if (!filled) {
      outline = SIDES.every((s) => px(styleOf(el, `border${s}Width`)) >= 1) && SIDES.some((s) => {
        const c = parseColor(styleOf(el, `border${s}Color`));
        return Boolean(c && c.a >= 0.3 && deltaE(c.a >= 1 ? c : composite(c, behind), behind) >= 0.06);
      });
    }
    if (!filled && !outline) return;
    out.push({ i, filled, outline, inNav: Boolean(prep.nav[i]), aboveFold: el.box.y < vh && el.box.y + el.box.h > 0, bg: filled && effective ? hexOf(effective) : null });
  });
  return out;
}

/**
 * Palette roles (tier inferred): ground by painted area, ink by share of text characters, accent by primary
 * call-to-action backgrounds (chromatic first); plus the accent count (hue families) and the neutral ramp depth.
 * Browser default link colours, icon fonts and consent widgets are left out.
 * @param {Prepared} prep
 * @param {ReturnType<typeof paintGrid>} paint
 * @param {ReturnType<typeof callsToAction>} ctas
 */
export function paletteOf(prep, paint, ctas) {
  const texts = readableText(prep);
  /** @type {Map<string, number>} */
  const ink = new Map();
  /** @type {Map<string, number>} */
  const linkInk = new Map();
  let chars = 0;
  const excluded = new Set();
  for (const t of texts) {
    const under = parseColor(t.bg) ?? prep.canvas;
    const c = solidOver(t.color, under);
    if (!c) continue;
    const hex = hexOf(c);
    const n = t.text.replace(/\s+/g, '').length;
    if (BROWSER_DEFAULTS.includes(hex)) {
      excluded.add(`${hex} (browser default link colour)`);
      continue;
    }
    bump(ink, hex, n);
    chars += n;
    if (t.tag === 'a') bump(linkInk, hex, n);
  }
  const inks = shares(ink, chars);
  const ground = paint.page[0] ?? null;
  const groundRgba = ground ? parseColor(ground.color) : null;
  const inkTop = inks[0] ?? null;
  /** @type {Map<string, number>} */
  const ctaBg = new Map();
  for (const cta of ctas) {
    if (!cta.filled || !cta.bg) continue;
    if (BROWSER_DEFAULTS.includes(cta.bg)) {
      excluded.add(`${cta.bg} (browser default link colour)`);
      continue;
    }
    bump(ctaBg, cta.bg, cta.aboveFold ? 2 : 1);
  }
  const ranked = [...ctaBg].sort((a, b) => b[1] - a[1]);
  const chromatic = ranked.filter(([hex]) => (toOklch(/** @type {Rgba} */ (parseColor(hex))).c ?? 0) >= 0.03);
  /** @type {Record<string, unknown> | null} */
  let accent = null;
  if (chromatic.length) accent = { color: chromatic[0][0], weight: chromatic[0][1], chromatic: true, basis: 'most used chromatic background of filled calls to action (above the fold counts double)' };
  else if (ranked.length) accent = { color: ranked[0][0], weight: ranked[0][1], chromatic: false, basis: 'most used background of filled calls to action; none is chromatic' };
  else {
    const link = [...linkInk].sort((a, b) => b[1] - a[1]).find(([hex]) => toOklch(/** @type {Rgba} */ (parseColor(hex))).c >= 0.03 && hex !== inkTop?.color);
    if (link) accent = { color: link[0], weight: link[1], chromatic: true, basis: 'link text colour; no filled call to action' };
  }
  if (accent) accent.hue = round(toOklch(/** @type {Rgba} */ (parseColor(String(accent.color)))).h, 1);
  /** @type {number[]} */
  const hues = [];
  const addHue = (/** @type {string} */ hex) => {
    const c = parseColor(hex);
    if (!c) return;
    const o = toOklch(c);
    if (o.c >= 0.03) hues.push(o.h);
  };
  for (const [hex] of chromatic) addHue(hex);
  for (const t of inks) if (t.share >= 0.01) addHue(t.color);
  for (const b of paint.page) if (b.share >= 0.01) addHue(b.color);
  /** @type {number[]} */
  const lightness = [];
  const addNeutral = (/** @type {string} */ hex) => {
    const c = parseColor(hex);
    if (!c) return;
    const o = toOklch(c);
    if (o.c < 0.03) lightness.push(o.l);
  };
  for (const b of paint.page) if (b.share >= 0.005) addNeutral(b.color);
  for (const t of inks) if (t.share >= 0.005) addNeutral(t.color);
  /** @type {Map<string, number>} */
  const borders = new Map();
  prep.els.forEach((el, i) => {
    if (prep.consent[i]) return;
    for (const s of SIDES) {
      if (!(px(styleOf(el, `border${s}Width`)) > 0)) continue;
      const c = solidOver(styleOf(el, `border${s}Color`), backdropOf(prep, i));
      if (c) bump(borders, hexOf(c), 1);
    }
  });
  for (const [hex, n] of borders) if (n >= 2) addNeutral(hex);
  const consentCount = prep.els.filter((_, i) => prep.consent[i]).length;
  if (consentCount) excluded.add(`${consentCount} elements of cookie or consent widgets`);
  return {
    tier: 'inferred',
    ground: ground ? { color: ground.color, share: ground.share, lightness: groundRgba ? round(toOklch(groundRgba).l) : null, basis: 'largest painted background area' } : null,
    backgrounds: paint.page,
    backgroundsFirstViewport: paint.firstViewport,
    ink: inkTop ? { color: inkTop.color, share: inkTop.share, contrast: groundRgba ? round(contrastRatio(inkTop.color, ground?.color ?? '#ffffff') ?? 0, 2) : null, basis: 'largest share of text characters' } : null,
    inks,
    accent,
    ctaBackgrounds: ranked.slice(0, 6).map(([color, weight]) => ({ color, weight })),
    accentCount: clusterHues(hues),
    neutralRampDepth: clusterLightness(lightness),
    imageGroundShare: paint.imageShare,
    excluded: [...excluded],
  };
}

/**
 * Number of hue families (30 degree windows, circular).
 * @param {number[]} hues
 */
export function clusterHues(hues) {
  if (hues.length === 0) return 0;
  const sorted = [...hues].sort((a, b) => a - b);
  let clusters = 1;
  for (let i = 1; i < sorted.length; i += 1) if (sorted[i] - sorted[i - 1] > 30) clusters += 1;
  if (clusters > 1 && sorted[0] + 360 - sorted[sorted.length - 1] <= 30) clusters -= 1;
  return clusters;
}

/**
 * Number of distinct neutral lightness steps (0.03 apart in OKLCH).
 * @param {number[]} values
 */
export function clusterLightness(values) {
  const sorted = [...values].sort((a, b) => a - b);
  let steps = 0;
  let last = Number.NEGATIVE_INFINITY;
  for (const v of sorted) {
    if (v - last >= 0.03) {
      steps += 1;
      last = v;
    }
  }
  return steps;
}

/**
 * @param {ReturnType<typeof paletteOf>} palette
 * @param {ReturnType<typeof paintGrid>} paint
 */
export function groundMode(palette, paint) {
  const l = palette.ground?.lightness;
  const mode = l === null || l === undefined ? null : l >= 0.6 ? 'light' : l <= 0.4 ? 'dark' : 'mid';
  return { tier: 'inferred', mode, lightness: l ?? null, darkAreaShare: paint.darkShare };
}

// ---------- layout conventions ----------

/**
 * @param {Prepared} prep
 * @param {ReturnType<typeof callsToAction>} ctas
 */
export function densityOf(prep, ctas) {
  const page = prep.vp.page;
  const vh = page?.height ?? 0;
  const vw = page?.width ?? 0;
  const inFold = prep.els.filter((el, i) => !prep.consent[i] && el.box.y < vh && el.box.y + el.box.h > 0).length;
  const texts = readableText(prep).filter((t) => t.inViewport);
  const words = texts.reduce((n, t) => n + t.text.split(/\s+/).filter(Boolean).length, 0);
  const area = vw * vh;
  return {
    tier: 'measured',
    firstViewport: {
      elements: inFold,
      elementsPer100kPx2: area ? round((inFold * 100_000) / area, 2) : null,
      textChars: texts.reduce((n, t) => n + t.text.replace(/\s+/g, '').length, 0),
      words,
      jpegQ70KiB: page?.jpegQ70Bytes ? round(page.jpegQ70Bytes / 1024, 1) : null,
      ctas: ctas.filter((c) => c.aboveFold).length,
    },
    page: {
      scrollHeight: page?.scrollHeight ?? null,
      screens: vh ? round((page?.scrollHeight ?? 0) / vh, 1) : null,
      sections: prep.vp.landmarks?.sections?.filter((s) => !s.consent).length ?? 0,
    },
  };
}

/**
 * The primary navigation: the first navigation landmark near the top, else a header with three links or more.
 * @param {Prepared} prep
 * @param {ViewportData | null} other a second viewport (mobile) to compare item counts
 */
export function navOf(prep, other) {
  const find = (/** @type {ViewportData} */ vp) => {
    const lms = (vp.landmarks?.landmarks ?? []).filter((l) => !l.consent);
    return lms.find((l) => (l.role === 'navigation' || l.tag === 'nav') && l.box.y < 200)
      ?? lms.find((l) => (l.role === 'banner' || l.tag === 'header') && l.box.y < 200 && l.links >= 3)
      ?? null;
  };
  const main = find(prep.vp);
  if (!main) return { tier: 'inferred', present: false, position: null, items: 0, sticky: false, mobileItems: other ? (find(other)?.links ?? 0) : null };
  const vw = prep.vp.page?.width ?? 0;
  const vh = prep.vp.page?.height ?? 0;
  const position = main.box.h > vh * 0.6 && main.box.w < vw * 0.35 ? 'side' : 'top';
  let sticky = ['fixed', 'sticky'].includes(main.position);
  const idx = prep.bySel.get(main.sel);
  for (let i = idx ?? -1; !sticky && i >= 0; i = prep.els[i].parent) {
    if (['fixed', 'sticky'].includes(styleOf(prep.els[i], 'position'))) sticky = true;
  }
  const mobile = other ? find(other) : null;
  return {
    tier: 'inferred',
    present: true,
    position,
    items: main.links + main.buttons,
    sticky,
    height: main.box.h,
    mobileItems: other ? (mobile ? mobile.links + mobile.buttons : 0) : null,
  };
}

/**
 * @param {ReturnType<typeof callsToAction>} ctas
 */
export function ctaCounts(ctas) {
  const fold = ctas.filter((c) => c.aboveFold);
  return {
    tier: 'inferred',
    aboveFold: {
      filled: fold.filter((c) => c.filled).length,
      outline: fold.filter((c) => c.outline).length,
      inNav: fold.filter((c) => c.inNav).length,
      outsideNav: fold.filter((c) => !c.inNav).length,
      total: fold.length,
    },
    page: { filled: ctas.filter((c) => c.filled).length, outline: ctas.filter((c) => c.outline).length },
  };
}

/**
 * A figure: short text, mostly digits, set larger than the body (at least 1.25 times and 20 px).
 * @param {NumRec} n
 * @param {number} body
 */
function isFigure(n, body) {
  const text = n.text.trim();
  if (!text || text.length > 24) return false;
  const visible = text.replace(/\s+/g, '');
  const digits = (visible.match(/\d/g) ?? []).length;
  return digits / Math.max(1, visible.length) >= 0.4 && n.fontSize >= Math.max(1.25 * body, 20);
}

/**
 * The figures row (two or more figures side by side within the first two screens) with the position of their
 * labels, and the count of figures in the first viewport.
 * @param {Prepared} prep
 * @param {number | null} body
 */
export function figuresOf(prep, body) {
  const vh = prep.vp.page?.height ?? 0;
  const figures = prep.vp.numbers.filter((n) => {
    const i = prep.bySel.get(n.sel);
    return (i === undefined || !prep.consent[i]) && isFigure(n, body ?? 16);
  });
  const near = figures.filter((f) => f.box.y < 2 * vh).sort((a, b) => a.box.y - b.box.y);
  /** @type {NumRec[][]} */
  const rows = [];
  for (const f of near) {
    const cy = f.box.y + f.box.h / 2;
    const row = rows.find((r) => Math.abs(r[0].box.y + r[0].box.h / 2 - cy) <= Math.max(r[0].box.h, f.box.h) / 2);
    if (row && !row.some((g) => g.box.x < f.box.x + f.box.w && f.box.x < g.box.x + g.box.w)) row.push(f);
    else if (!row) rows.push([f]);
  }
  const best = rows.filter((r) => r.length >= 2).sort((a, b) => b.length - a.length || a[0].box.y - b[0].box.y)[0] ?? null;
  /** @type {'above' | 'below' | 'none' | null} */
  let labels = null;
  if (best) {
    const texts = readableText(prep);
    let above = 0;
    let below = 0;
    for (const f of best) {
      const small = texts.filter((t) => t.fontSize <= f.fontSize * 0.75 && t.box.x < f.box.x + f.box.w && f.box.x < t.box.x + t.box.w);
      if (small.some((t) => t.box.y + t.box.h <= f.box.y + 2 && f.box.y - (t.box.y + t.box.h) <= 40)) above += 1;
      if (small.some((t) => t.box.y >= f.box.y + f.box.h - 2 && t.box.y - (f.box.y + f.box.h) <= 40)) below += 1;
    }
    labels = above === 0 && below === 0 ? 'none' : above >= below ? 'above' : 'below';
  }
  return {
    tier: 'inferred',
    row: best ? { present: true, count: best.length, y: Math.round(best[0].box.y), inFirstViewport: best[0].box.y < vh, sizePx: round(modeOf(best.map((f) => roundHalf(f.fontSize))) ?? 0, 1), labels } : { present: false, count: 0, y: null, inFirstViewport: false, sizePx: null, labels: null },
    firstViewportFigures: figures.filter((f) => f.box.y < vh).length,
    figures: figures.length,
  };
}

/**
 * How one number token is written: decimal places and the separators used.
 * @param {string} token
 * @returns {{decimals: number, thousands: string | null, decimal: string | null, ambiguous: boolean}}
 */
export function numberFormat(token) {
  const seps = [...token.replace(/\d/g, '')];
  if (seps.length === 0) return { decimals: 0, thousands: null, decimal: null, ambiguous: false };
  const kinds = new Set(seps);
  const lastIdx = Math.max(...[...kinds].map((k) => token.lastIndexOf(k)));
  const last = token[lastIdx];
  const after = token.length - lastIdx - 1;
  if (kinds.size >= 2) return { decimals: after, decimal: last, thousands: [...kinds].find((k) => k !== last) ?? null, ambiguous: false };
  if (seps.length >= 2) return { decimals: 0, thousands: last, decimal: null, ambiguous: false };
  if (last === "'" || last === NBSP || last === NNBSP) return { decimals: 0, thousands: last, decimal: null, ambiguous: false };
  if (after === 3) return { decimals: 0, thousands: last, decimal: null, ambiguous: true };
  return { decimals: after, decimal: last, thousands: null, ambiguous: false };
}

/**
 * The digits-only shape of a number with its currency sign, percent or magnitude suffix: never the words around it.
 * @param {string} text
 * @param {string} token
 */
function maskedShape(text, token) {
  const at = text.indexOf(token);
  if (at < 0) return token.replace(/\d/g, '9');
  let start = at;
  if (start > 0 && text[start - 1] === ' ' && start > 1 && CURRENCY.includes(text[start - 2])) start -= 2;
  else if (start > 0 && CURRENCY.includes(text[start - 1])) start -= 1;
  if (start > 0 && /[-−+]/.test(text[start - 1])) start -= 1;
  const tail = /^\s?(%|bn|mn|[KMBT](?![a-z]))/.exec(text.slice(at + token.length));
  return text.slice(start, at + token.length + (tail ? tail[0].length : 0)).replace(/\d/g, '9');
}

/**
 * Number formatting across every element showing digits: tabular figures, monospace, decimals, separators,
 * currency position, percent and magnitude suffixes, and the masked shapes in use.
 * @param {Prepared} prep
 */
export function numbersOf(prep) {
  const list = prep.vp.numbers.filter((n) => {
    const i = prep.bySel.get(n.sel);
    return i === undefined || !prep.consent[i];
  });
  let tabular = 0;
  let mono = 0;
  /** @type {Map<number, number>} */
  const decimals = new Map();
  /** @type {Map<string, number>} */
  const thousands = new Map();
  /** @type {Map<string, number>} */
  const decimalSep = new Map();
  /** @type {Map<string, number>} */
  const shapes = new Map();
  const currency = { prefix: 0, suffix: 0, codes: 0 };
  let percent = 0;
  let magnitude = 0;
  let ambiguous = 0;
  for (const n of list) {
    const tnum = /tabular-nums/.test(n.fontVariantNumeric ?? '') || (/"tnum"/.test(n.fontFeatureSettings ?? '') && !/"tnum"\s+(0|off)/.test(n.fontFeatureSettings ?? ''));
    if (tnum) tabular += 1;
    if (/mono|code|courier|consolas|menlo|monaco/i.test(firstFamily(n.fontFamily))) mono += 1;
    const text = n.text;
    const around = `${n.context ?? ''} ${text}`;
    if (new RegExp(`[${CURRENCY}]\\s?\\d`).test(around)) currency.prefix += 1;
    else if (new RegExp(`\\d\\s?[${CURRENCY}]`).test(around)) currency.suffix += 1;
    if (/\b(USD|EUR|GBP|BTC|ETH|USDC|USDT|SOL|ADA|BNB)\b/.test(around)) currency.codes += 1;
    if (/\d\s?%/.test(text)) percent += 1;
    if (/\d\s?(bn|mn|[KMBT])(?![a-z])/.test(text)) magnitude += 1;
    for (const token of text.match(NUMBER_TOKEN) ?? []) {
      const f = numberFormat(token);
      bump(decimals, f.decimals, 1);
      if (f.thousands) bump(thousands, f.thousands === NBSP || f.thousands === NNBSP ? 'space' : f.thousands, 1);
      if (f.decimal) bump(decimalSep, f.decimal, 1);
      if (f.ambiguous) ambiguous += 1;
      bump(shapes, maskedShape(text, token), 1);
    }
  }
  const total = list.length;
  return {
    tier: 'measured',
    elements: total,
    tabular: { count: tabular, share: round(total ? tabular / total : 0) },
    monospace: { count: mono, share: round(total ? mono / total : 0) },
    decimals: Object.fromEntries([...decimals].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), v])),
    separators: { thousands: Object.fromEntries(thousands), decimal: Object.fromEntries(decimalSep), ambiguous },
    currency,
    percent,
    magnitudeSuffix: magnitude,
    shapes: [...shapes].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([shape, count]) => ({ shape, count })),
  };
}

// ---------- one reference ----------

/**
 * @param {ViewportData} vp
 */
function fontsOf(vp) {
  /** @type {Record<string, Array<{family: string, custom: boolean}>>} */
  const byRole = {};
  for (const s of Array.isArray(vp.fonts?.samples) ? vp.fonts.samples : []) {
    const list = (byRole[s.role] ??= []);
    for (const f of Array.isArray(s.fonts) ? s.fonts : []) {
      if (!list.some((x) => x.family === f.familyName)) list.push({ family: f.familyName, custom: Boolean(f.isCustomFont) });
    }
  }
  const faces = Array.isArray(vp.fonts?.loadedFaces) ? vp.fonts.loadedFaces : [];
  return {
    tier: 'measured',
    rendered: byRole,
    loadedFaces: faces.filter((/** @type {{status: string}} */ f) => f.status === 'loaded').length,
    families: [...new Set(faces.map((/** @type {{family: string}} */ f) => f.family))].slice(0, 20),
  };
}

/**
 * Every measurement of one capture (the primary viewport is the widest; type and nav also read the second one).
 * @param {Capture} capture
 * @param {string} id
 */
export function extractReference(capture, id) {
  const ordered = [...capture.viewports].sort((a, b) => (b.page?.width ?? 0) - (a.page?.width ?? 0));
  const primary = ordered[0];
  const secondary = ordered[1] ?? null;
  const prep = prepare(primary);
  const type = typeOf(prep);
  const ctas = callsToAction(prep);
  const paint = paintGrid(prep);
  const palette = paletteOf(prep, paint, ctas);
  const url = new URL(String(capture.receipt.url));
  /** @type {string[]} */
  const warnings = [];
  for (const vp of capture.viewports) if (vp.readiness && vp.readiness.ok === false) warnings.push(`${vp.name}: page not fully ready when measured (${vp.readiness.detail})`);
  const density = densityOf(prep, ctas);
  if (density.firstViewport.elements < 15) warnings.push(`only ${density.firstViewport.elements} elements in the first viewport: check the slices for a wall or a loader`);
  const canvases = (primary.landmarks?.canvases ?? []);
  const vh = primary.page?.height ?? 0;
  const vw = primary.page?.width ?? 0;
  const canvasFold = canvases.filter((c) => c.aboveFold).reduce((a, c) => a + Math.max(0, Math.min(c.box.y + c.box.h, vh) - Math.max(c.box.y, 0)) * Math.min(c.box.w, vw), 0);
  const canvasShare = vw && vh ? round(canvasFold / (vw * vh)) : 0;
  if (canvasShare >= 0.3) warnings.push(`a canvas covers ${Math.round(canvasShare * 100)}% of the first viewport: that region is vision-only (FD05-F10)`);
  if (paint.imageShareFirstViewport >= 0.2) warnings.push(`${Math.round(paint.imageShareFirstViewport * 100)}% of the first viewport sits on a background image or gradient: the painted ground there is not known from styles`);
  const secondaryPrep = secondary ? prepare(secondary) : null;
  const widths = Array.isArray(capture.mediaQueries?.widths) ? capture.mediaQueries.widths : [];
  return {
    id,
    host: capture.receipt.host,
    slug: capture.receipt.slug,
    url: url.href,
    page: `${url.pathname}${url.search}`,
    dir: toPosix(capture.dir),
    receipt: toPosix(path.join(capture.dir, CAPTURE_FILES.receipt)),
    captured_at: capture.receipt.capturedAt,
    viewports: capture.viewports.map((v) => ({ name: v.name, width: v.page?.width ?? null, height: v.page?.height ?? null })),
    primary: primary.name,
    readiness: Object.fromEntries(capture.viewports.map((v) => [v.name, v.readiness?.ok !== false])),
    type: {
      ...type,
      byViewport: secondaryPrep ? { [secondary?.name ?? 'secondary']: (() => {
        const t = typeOf(secondaryPrep);
        return { body: t.body?.px ?? null, h1: t.headings.h1?.px ?? null, ratio: t.scale.ratio, h1Ratio: t.scale.h1Ratio };
      })() } : {},
    },
    fonts: fontsOf(primary),
    spacing: spacingOf(prep),
    radius: radiusOfPage(prep, ctas),
    palette,
    ground: groundMode(palette, paint),
    density,
    nav: navOf(prep, secondary),
    cta: ctaCounts(ctas),
    figures: figuresOf(prep, type.body?.px ?? null),
    numbers: numbersOf(prep),
    reveal: {
      tier: 'measured',
      hiddenAtRest: Number(primary.reveal?.revealedCount ?? 0),
      kinds: primary.reveal?.kinds ?? {},
      mountedOnScroll: Number(primary.reveal?.mounted ?? 0),
    },
    canvases: { tier: 'measured', count: canvases.length, aboveFold: canvases.filter((c) => c.aboveFold).length, firstViewportShare: canvasShare },
    breakpoints: [...new Set(widths.map((/** @type {{px: number}} */ w) => w.px))].sort((a, b) => a - b),
    states: primary.states.map((s) => ({ role: s.role, hover: Object.keys(s.hover ?? {}), focus: Object.keys(s.focus ?? {}), transitionMs: s.transitionMs ?? 0 })),
    customProperties: Array.isArray(primary.declared?.customProperties) ? primary.declared.customProperties.length : 0,
    warnings,
    ledger_reference: {
      id,
      customer: '',
      url: url.href,
      page: `${url.pathname}${url.search}`,
      captured_at: capture.receipt.capturedAt,
      viewports: capture.viewports.map((v) => v.name),
      receipt: toPosix(path.join(capture.dir, CAPTURE_FILES.receipt)),
      purged: false,
    },
  };
}

/**
 * The same measurement across references, side by side, to see which values two unrelated references share.
 * @param {Array<ReturnType<typeof extractReference>>} refs
 */
export function compareReferences(refs) {
  /** @param {(r: ReturnType<typeof extractReference>) => unknown} pick */
  const by = (pick) => Object.fromEntries(refs.map((r) => [r.id, pick(r)]));
  return {
    groundMode: by((r) => r.ground.mode),
    scaleRatio: by((r) => r.type.scale.ratio),
    h1Ratio: by((r) => r.type.scale.h1Ratio),
    bodyPx: by((r) => r.type.body?.px ?? null),
    spacingBase: by((r) => r.spacing.base),
    radiusFamily: by((r) => r.radius.family),
    buttonShape: by((r) => r.radius.buttons?.shape ?? null),
    accentCount: by((r) => r.palette.accentCount),
    neutralRampDepth: by((r) => r.palette.neutralRampDepth),
    navItems: by((r) => r.nav.items),
    ctaAboveFold: by((r) => r.cta.aboveFold.filled + r.cta.aboveFold.outline),
    figuresRow: by((r) => r.figures.row.present),
    tabularShare: by((r) => r.numbers.tabular.share),
    firstViewportElements: by((r) => r.density.firstViewport.elements),
    jpegQ70KiB: by((r) => r.density.firstViewport.jpegQ70KiB),
  };
}

/**
 * Extracts every capture folder and writes refs-extract.json.
 * @param {string[]} dirs
 * @param {{out?: string | null, now?: Date}} [options]
 */
export function extractAll(dirs, { out = null, now = new Date() } = {}) {
  if (dirs.length === 0) throw new UsageError('no capture folder to extract; pass capture folders or a captures root (capture.mjs writes <root>/<host>/<slug>/)');
  const captures = dirs.map((d) => loadCapture(d)).sort((a, b) => String(a.receipt.capturedAt).localeCompare(String(b.receipt.capturedAt)));
  const references = captures.map((c, i) => extractReference(c, `R${i + 1}`));
  /** @type {string[]} */
  const warnings = [];
  /** @type {Map<string, string[]>} */
  const hosts = new Map();
  for (const r of references) hosts.set(r.host, [...(hosts.get(r.host) ?? []), r.id]);
  for (const [host, ids] of hosts) if (ids.length > 1) warnings.push(`${ids.join(', ')} are pages of one host (${host}): never merge them into one pattern (RF-03)`);
  const result = {
    kind: 'refs-extract',
    tool: 'extract',
    version: EXTRACT_VERSION,
    policy: POLICY_ID,
    at: now.toISOString(),
    note: 'measured facts from third-party captures, for the private workspace only: the pattern ledger carries relationships and conventions from at least two unrelated references, never these exact values in a statement (RF-11, RF-15)',
    tiers: {
      measured: 'raw values read live from the page: facts',
      inferred: 'roles and summaries assigned by position and frequency: re-check them before they constrain the build',
    },
    references,
    comparison: compareReferences(references),
    warnings,
  };
  const file = out ? path.resolve(out) : path.join(path.dirname(path.dirname(captures[0].dir)), 'refs-extract.json');
  const written = writeJson(file, result);
  return { file: written, result };
}

// ---------- the pattern ledger gates ----------

export const GATES = Object.freeze([
  Object.freeze({
    id: 'refs.ledger',
    title: 'Pattern ledger: each pattern rests on two unrelated references and no statement carries an exact value',
    ifDropped: 'a ledger drawn from one site (parasitism even when each element is banal, FD09-F11), or one whose statements carry a brand\'s exact values, would steer the build toward imitating one company',
  }),
  Object.freeze({
    id: 'refs.receipts',
    title: 'Every reference has its capture-gate receipt and its captures are purged',
    ifDropped: 'a reference captured past robots.txt, a bot wall or an unread terms page, or third-party captures kept after the ledger was written, would go unnoticed (FD19 P3-P13)',
  }),
]);
/** @type {Set<string>} */
const GATE_IDS = new Set(GATES.map((g) => g.id));
export const LEDGER_FILE = 'pattern-ledger.json';
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,31}$/;
const KINDS = Object.freeze(['convention', 'relationship', 'domain', 'fact']);
const COLOUR_LITERAL = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const MANUAL_RECEIPT = /^manual-notes\b/i;
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'plc.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'org.nz', 'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'co.kr', 'or.kr', 'com.br', 'net.br', 'org.br', 'com.cn',
  'net.cn', 'org.cn', 'com.hk', 'com.sg', 'edu.sg', 'gov.sg', 'com.tw', 'com.tr', 'com.mx', 'co.in', 'net.in',
  'org.in', 'co.za', 'co.il', 'com.ar', 'com.co', 'com.pe', 'com.my', 'com.ph', 'co.id', 'co.th', 'com.vn', 'com.ua',
  'com.pl', 'co.at', 'or.at',
]);
/** Hosting suffixes where the next label names the owner. */
const SHARED_HOSTS = new Set([
  'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com',
  'herokuapp.com', 'azurewebsites.net', 'cloudfront.net', 'gitbook.io', 'notion.site', 'webflow.io', 'framer.website',
  'framer.app', 'wixsite.com', 'fly.dev', 'onrender.com', 'railway.app', 'surge.sh', 'replit.app', 'glitch.me',
  'blogspot.com', 'wordpress.com', 'substack.com', 'mirror.xyz', 'eth.limo', 'eth.link',
]);

/**
 * The registrable part of a host name (an approximation of the public suffix list: common two-label suffixes and
 * shared hosting suffixes keep one more label).
 * @param {string} hostname
 */
export function registrableDomain(hostname) {
  const h = String(hostname).toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':')) return h;
  const labels = h.split('.');
  const last2 = labels.slice(-2).join('.');
  if (labels.length >= 3 && (MULTI_PART_SUFFIXES.has(last2) || SHARED_HOSTS.has(last2))) return labels.slice(-3).join('.');
  return last2;
}

/**
 * A company name reduced for comparison: lower case, legal and generic suffixes dropped.
 * @param {string} name
 */
export function ownerKey(name) {
  const words = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const generic = new Set(['the', 'inc', 'ltd', 'llc', 'plc', 'sa', 'sas', 'gmbh', 'ag', 'bv', 'co', 'corp', 'corporation', 'company', 'labs', 'lab', 'foundation', 'protocol', 'network', 'finance', 'technologies', 'technology', 'group', 'holdings']);
  const kept = words.filter((w) => !generic.has(w));
  return (kept.length ? kept : words).join(' ');
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Groups of related references: same owner (customer) or same registrable domain (a bare IP address or localhost
 * keeps its port: each port is its own site, as loopback fixtures are).
 * @param {Array<Record<string, any>>} references
 * @returns {Map<string, string>} reference id to group id
 */
export function relatedGroups(references) {
  /** @type {Map<string, string>} */
  const parent = new Map(references.map((r) => [String(r.id), String(r.id)]));
  /** @param {string} x @returns {string} */
  const find = (x) => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const top = find(p);
    parent.set(x, top);
    return top;
  };
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const r of references) {
    const keys = [`owner:${ownerKey(String(r.customer ?? ''))}`];
    try {
      const u = new URL(String(r.url));
      const bare = u.hostname.replace(/^\[|\]$/g, '');
      const addressOnly = bare === 'localhost' || /^[\d.]+$/.test(bare) || bare.includes(':');
      keys.push(`domain:${addressOnly ? u.host : registrableDomain(u.hostname)}`);
    } catch {
      keys.push(`url:${String(r.url)}`); // an invalid URL is reported by the shape check; it relates to nothing else
    }
    for (const key of keys) {
      if (key === 'owner:') continue;
      const other = seen.get(key);
      if (other) parent.set(find(String(r.id)), find(other));
      else seen.set(key, String(r.id));
    }
  }
  return new Map(references.map((r) => [String(r.id), find(String(r.id))]));
}

/**
 * Reads the ledger; a missing or malformed file comes back as `error`.
 * @param {string} file
 * @returns {{ledger: Record<string, any> | null, error: string | null}}
 */
export function loadLedger(file) {
  if (!existsSync(file)) return { ledger: null, error: `${LEDGER_FILE} not found at ${toPosix(path.resolve(file))}; write it from refs-extract.json (FE-02, references/02-references.md RF-15)` };
  try {
    const ledger = readJson(file, 'pattern ledger');
    if (!isRecord(ledger)) return { ledger: null, error: `${toPosix(file)} is not an object {references, patterns, excluded}` };
    return { ledger, error: null };
  } catch (err) {
    return { ledger: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The refs.ledger checks (CONTRACTS 6.5, references/02-references.md RF-02, RF-03, RF-15): shape; at least two
 * unrelated references and at most MAX_HOSTS hosts, one page per host; every pattern's references exist and, unless
 * it is a fact, belong to two unrelated owners; no colour value in a statement; `not_borrowed` filled; `excluded`
 * present.
 * @param {Record<string, any>} ledger
 * @returns {{problems: string[], summary: string}}
 */
export function checkLedger(ledger) {
  /** @type {string[]} */
  const problems = [];
  const refs = Array.isArray(ledger.references) ? ledger.references : null;
  const patterns = Array.isArray(ledger.patterns) ? ledger.patterns : null;
  if (!refs) problems.push('references must be an array');
  if (!patterns) problems.push('patterns must be an array');
  if (!Array.isArray(ledger.excluded)) problems.push('excluded must be present, as an array of what was observed and not carried (strings or {what, why})');
  else {
    ledger.excluded.forEach((/** @type {unknown} */ e, /** @type {number} */ i) => {
      const ok = (typeof e === 'string' && e.trim() !== '') || (isRecord(e) && typeof e.what === 'string' && e.what.trim() && typeof e.why === 'string' && e.why.trim());
      if (!ok) problems.push(`excluded[${i}] must be a non-empty string or {what, why}`);
    });
  }
  const unknownKeys = Object.keys(ledger).filter((k) => !['references', 'patterns', 'excluded'].includes(k));
  if (unknownKeys.length) problems.push(`unknown top-level key(s) ${unknownKeys.join(', ')}; the ledger holds references, patterns and excluded only`);
  /** @type {Map<string, Record<string, any>>} */
  const byId = new Map();
  /** @type {Map<string, string>} */
  const hostPage = new Map();
  for (const [i, r] of (refs ?? []).entries()) {
    if (!isRecord(r)) {
      problems.push(`references[${i}] must be an object`);
      continue;
    }
    const id = String(r.id ?? '');
    const where = ID_PATTERN.test(id) ? id : `references[${i}]`;
    if (!ID_PATTERN.test(id)) problems.push(`${where}: id must match ${ID_PATTERN.source}`);
    else if (byId.has(id)) problems.push(`${id}: duplicate reference id`);
    else byId.set(id, r);
    if (typeof r.customer !== 'string' || !r.customer.trim()) problems.push(`${where}: customer is empty (the owner of the site)`);
    /** @type {URL | null} */
    let url = null;
    try {
      url = new URL(String(r.url));
      if (!/^https?:$/.test(url.protocol)) url = null;
    } catch {
      url = null;
    }
    if (!url) problems.push(`${where}: url must be an absolute http(s) URL`);
    if (typeof r.page !== 'string' || !r.page.trim()) problems.push(`${where}: page is empty (the one page captured on this site, RF-03)`);
    if (typeof r.captured_at !== 'string' || !Number.isFinite(Date.parse(r.captured_at))) problems.push(`${where}: captured_at must be an ISO 8601 date`);
    if (!Array.isArray(r.viewports) || r.viewports.length === 0 || r.viewports.some((/** @type {unknown} */ v) => typeof v !== 'string' || !v)) problems.push(`${where}: viewports must list the viewport names captured`);
    if (typeof r.receipt !== 'string' || !r.receipt.trim()) problems.push(`${where}: receipt is empty (the capture-gate receipt path, or "manual-notes")`);
    if (typeof r.purged !== 'boolean') problems.push(`${where}: purged must be true or false`);
    const extra = Object.keys(r).filter((k) => !['id', 'customer', 'url', 'page', 'captured_at', 'viewports', 'receipt', 'purged'].includes(k));
    if (extra.length) problems.push(`${where}: unknown field(s) ${extra.join(', ')}`);
    if (url) {
      const host = url.host.toLowerCase();
      const other = hostPage.get(host);
      if (other) problems.push(`${where} and ${other} are two pages of ${host}; capture one page per site, the closest to the surface built (RF-03)`);
      else hostPage.set(host, where);
    }
  }
  const groups = relatedGroups([...byId.values()]);
  const distinctGroups = new Set(groups.values()).size;
  if (refs && distinctGroups < 2) problems.push(`the ledger rests on ${distinctGroups} unrelated owner(s); the floor is 2 sites from different owners (RF-02): add a reference or the owner's notes (RF-12)`);
  const hosts = new Set([...hostPage.keys()]);
  if (hosts.size > MAX_HOSTS) problems.push(`${hosts.size} hosts referenced; the policy captures at most ${MAX_HOSTS} (P11)`);
  /** @type {Set<string>} */
  const patternIds = new Set();
  for (const [i, p] of (patterns ?? []).entries()) {
    if (!isRecord(p)) {
      problems.push(`patterns[${i}] must be an object`);
      continue;
    }
    const id = String(p.id ?? '');
    const where = ID_PATTERN.test(id) ? id : `patterns[${i}]`;
    if (!ID_PATTERN.test(id)) problems.push(`${where}: id must match ${ID_PATTERN.source}`);
    else if (patternIds.has(id)) problems.push(`${id}: duplicate pattern id`);
    else patternIds.add(id);
    const kind = String(p.kind ?? '');
    if (!KINDS.includes(kind)) problems.push(`${where}: kind must be one of ${KINDS.join('|')}`);
    if (typeof p.statement !== 'string' || !p.statement.trim()) problems.push(`${where}: statement is empty`);
    else {
      const colour = COLOUR_LITERAL.exec(p.statement);
      if (colour) problems.push(`${where}: the statement carries a colour value (${colour[0]}); exact values go in values with not_borrowed filled, never in a statement (RF-15)`);
    }
    if (p.values === undefined || p.values === null || (typeof p.values === 'string' && !p.values.trim())) problems.push(`${where}: values is empty (the measured values behind the statement)`);
    const nb = p.not_borrowed;
    const nbOk = (typeof nb === 'string' && nb.trim() !== '') || (Array.isArray(nb) && nb.length > 0 && nb.every((x) => typeof x === 'string' && x.trim()));
    if (!nbOk) problems.push(`${where}: not_borrowed is empty (what the pattern deliberately leaves behind)`);
    const from = Array.isArray(p.from) ? p.from.map(String) : null;
    if (!from || from.length === 0) {
      problems.push(`${where}: from must list the reference ids it rests on`);
      continue;
    }
    if (new Set(from).size !== from.length) problems.push(`${where}: from lists a reference twice`);
    const missing = from.filter((r) => !byId.has(r));
    if (missing.length) problems.push(`${where}: from names unknown reference(s) ${missing.join(', ')}`);
    if (kind !== 'fact' && KINDS.includes(kind)) {
      const owners = new Set(from.filter((r) => byId.has(r)).map((r) => groups.get(r)));
      if (owners.size < 2) {
        problems.push(`${where} (${kind}) rests on ${from.join(', ')}, ${from.length > 1 ? 'which share an owner or a domain' : 'a single reference'}; a ${kind} needs at least two unrelated references (RF-15), or record it as a fact`);
      }
    }
  }
  const summary = `${refs?.length ?? 0} reference(s) from ${distinctGroups} unrelated owner(s), ${patterns?.length ?? 0} pattern(s), ${Array.isArray(ledger.excluded) ? ledger.excluded.length : 0} exclusion(s)`;
  return { problems, summary };
}

/**
 * @param {string} a
 * @param {string} b
 */
function sameSecond(a, b) {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.floor(x / 1000) === Math.floor(y / 1000);
}

/**
 * @param {string} dir
 * @param {unknown} name
 */
function insideFile(dir, name) {
  const n = String(name ?? '');
  if (!n || path.isAbsolute(n) || n.split(/[\\/]+/).some((s) => s === '..')) return null;
  return path.join(dir, ...n.split(/[\\/]+/));
}

/**
 * The receipt checks of one reference: the gate receipt (verdict captured, same URL, honest identity, terms
 * attested, manifest unchanged) and its purge (deletion receipt, every captured file gone). "manual-notes" stands
 * for the owner's own notes (RF-12): nothing was captured, so nothing is checked or purged.
 * @param {Record<string, any>} ref
 * @param {string} ledgerDir
 * @returns {{problems: string[], kind: 'capture' | 'manual' | 'unknown', dir: string | null}}
 */
export function checkReference(ref, ledgerDir) {
  const id = String(ref.id ?? '?');
  /** @type {string[]} */
  const problems = [];
  const raw = typeof ref.receipt === 'string' ? ref.receipt.trim() : '';
  if (!raw) return { problems: [`${id}: no receipt`], kind: 'unknown', dir: null };
  if (MANUAL_RECEIPT.test(raw)) return { problems, kind: 'manual', dir: null };
  let file = path.resolve(ledgerDir, raw);
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, CAPTURE_FILES.receipt);
  if (!existsSync(file)) return { problems: [`${id}: receipt ${toPosix(file)} not found`], kind: 'unknown', dir: null };
  /** @type {any} */
  let receipt;
  try {
    receipt = readJson(file, 'gate receipt');
  } catch (err) {
    return { problems: [`${id}: ${err instanceof Error ? err.message : String(err)}`], kind: 'unknown', dir: null };
  }
  const dir = path.dirname(file);
  if (!isRecord(receipt) || receipt.kind !== 'capture' || receipt.policy !== POLICY_ID) {
    return { problems: [`${id}: ${toPosix(file)} is not a capture-gate receipt (kind capture, policy ${POLICY_ID})`], kind: 'unknown', dir };
  }
  if (receipt.verdict !== 'captured') problems.push(`${id}: the gate's verdict is ${String(receipt.verdict)}, not captured`);
  if (!sameDocument(receipt.url, ref.url) && !sameDocument(receipt.finalUrl, ref.url)) problems.push(`${id}: the ledger url ${String(ref.url)} differs from the receipt's ${String(receipt.url)}`);
  if (typeof receipt.termsReviewed !== 'string' || !/^https?:\/\//.test(receipt.termsReviewed)) problems.push(`${id}: the receipt has no terms attestation (--terms-reviewed, RF-06)`);
  if (!String(receipt.userAgent ?? '').includes(`${PRODUCT_TOKEN}/1.0`)) problems.push(`${id}: the receipt's user agent does not carry ${PRODUCT_TOKEN}/1.0 (one honest identity, RF-04)`);
  if (typeof ref.captured_at === 'string' && typeof receipt.capturedAt === 'string' && !sameSecond(ref.captured_at, receipt.capturedAt)) {
    problems.push(`${id}: captured_at ${ref.captured_at} differs from the receipt's ${receipt.capturedAt}`);
  }
  const manifestPath = insideFile(dir, receipt.manifest?.file ?? CAPTURE_FILES.manifest);
  /** @type {any} */
  let manifest = null;
  if (!manifestPath || !existsSync(manifestPath)) problems.push(`${id}: the capture manifest is missing next to its receipt`);
  else if (sha256File(manifestPath) !== receipt.manifest?.sha256) problems.push(`${id}: ${toPosix(manifestPath)} changed since the capture (SHA-256 differs from the receipt)`);
  else {
    manifest = readJson(manifestPath, 'capture manifest');
    if (!Array.isArray(manifest?.files) || manifest.files.length === 0 || manifest.files.some((/** @type {any} */ f) => typeof f?.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256))) {
      problems.push(`${id}: the manifest does not list its files with SHA-256`);
    }
    const names = Array.isArray(manifest?.viewports) ? manifest.viewports.map((/** @type {any} */ v) => v?.name) : [];
    if (names.length > MAX_VIEWPORTS_PER_PAGE) problems.push(`${id}: ${names.length} viewports captured; the policy keeps at most ${MAX_VIEWPORTS_PER_PAGE} (P11)`);
    const unknown = (Array.isArray(ref.viewports) ? ref.viewports : []).filter((/** @type {unknown} */ v) => !names.includes(v));
    if (unknown.length) problems.push(`${id}: viewport(s) ${unknown.join(', ')} were not captured (manifest has ${names.join(', ')})`);
  }
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const still = files.map((/** @type {any} */ f) => insideFile(dir, f?.name)).filter((/** @type {string | null} */ f) => f !== null && existsSync(f));
  const deletionPath = path.join(dir, CAPTURE_FILES.deletion);
  if (ref.purged === true) {
    if (!existsSync(deletionPath)) problems.push(`${id}: purged is true but ${toPosix(deletionPath)} does not exist; purge with ${purgeCommand(dir)}`);
    else {
      const deletion = readJson(deletionPath, 'deletion receipt');
      if (deletion?.ok !== true) problems.push(`${id}: the deletion receipt reports files that could not be deleted`);
      const listed = new Set(Array.isArray(deletion?.deleted) ? deletion.deleted.filter((/** @type {any} */ d) => d?.stillExists === false).map((/** @type {any} */ d) => d.name) : []);
      const unlisted = files.filter((/** @type {any} */ f) => !listed.has(f?.name)).length;
      if (unlisted) problems.push(`${id}: ${unlisted} captured file(s) are missing from the deletion receipt`);
    }
    if (still.length) problems.push(`${id}: ${still.length} captured file(s) are still on disk in ${toPosix(dir)}`);
  } else if (existsSync(deletionPath) && still.length === 0) {
    problems.push(`${id}: the captures were purged (${CAPTURE_FILES.deletion} exists) but the ledger says purged: false; set it to true`);
  } else {
    problems.push(`${id}: captures still stored in ${toPosix(dir)}; purge them now that the ledger is written (RF-10): ${purgeCommand(dir)}`);
  }
  return { problems, kind: 'capture', dir };
}

/**
 * The refs.receipts checks over every reference, plus any capture listed in <state>/refs-index.json that still
 * holds files.
 * @param {Record<string, any>} ledger
 * @param {string} ledgerDir
 * @param {string | null} state
 */
export function checkReceipts(ledger, ledgerDir, state) {
  /** @type {string[]} */
  const problems = [];
  const refs = Array.isArray(ledger.references) ? ledger.references.filter(isRecord) : [];
  if (refs.length === 0) problems.push('the ledger has no reference to check');
  let captured = 0;
  let manual = 0;
  /** @type {Set<string>} */
  const dirs = new Set();
  for (const ref of refs) {
    const r = checkReference(ref, ledgerDir);
    problems.push(...r.problems);
    if (r.kind === 'capture') captured += 1;
    if (r.kind === 'manual') manual += 1;
    if (r.dir) dirs.add(toPosix(r.dir));
  }
  if (state && existsSync(path.join(state, REFS_INDEX))) {
    try {
      const index = readRefsIndex(state);
      for (const c of index.captures) {
        if (typeof c.dir !== 'string' || dirs.has(toPosix(c.dir))) continue;
        const manifestPath = path.join(c.dir, CAPTURE_FILES.manifest);
        if (!existsSync(manifestPath)) continue;
        const manifest = readJson(manifestPath, 'capture manifest');
        const left = (Array.isArray(manifest?.files) ? manifest.files : []).map((/** @type {any} */ f) => insideFile(c.dir, f?.name)).filter((/** @type {string | null} */ f) => f !== null && existsSync(f)).length;
        if (left) problems.push(`capture ${toPosix(c.dir)} (in ${REFS_INDEX}, not in the ledger) still holds ${left} file(s); purge it: ${purgeCommand(c.dir)}`);
      }
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { problems, summary: `${captured} captured reference(s) and ${manual} from the owner's notes` };
}

/**
 * The refs gates on one ledger file. refs.ledger fails on a missing or unreadable ledger; refs.receipts is then
 * skipped (it has nothing to read), which never counts as passing.
 * @param {string} ledgerPath
 * @param {readonly string[]} ids
 * @param {{state?: string | null}} [options]
 * @returns {GateResult[]}
 */
export function ledgerGates(ledgerPath, ids, { state = null } = {}) {
  const { ledger, error } = loadLedger(ledgerPath);
  /** @type {GateResult[]} */
  const results = [];
  const file = toPosix(path.resolve(ledgerPath));
  /** @param {string[]} problems @returns {Evidence[]} */
  const evidence = (problems) => problems.slice(0, 50).map((p) => ({ file, value: p }));
  for (const meta of GATES) {
    if (!ids.includes(meta.id)) continue;
    const g = gateBuilder(meta);
    if (meta.id === 'refs.ledger') {
      if (!ledger) results.push(g.fail(error ?? 'no ledger', [{ file, value: error ?? '' }]));
      else {
        const { problems, summary } = checkLedger(ledger);
        results.push(problems.length ? g.fail(`${problems.length} problem(s): ${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more in evidence)` : ''}`, evidence(problems)) : g.ok(summary, [{ file, value: summary }]));
      }
    } else if (meta.id === 'refs.receipts') {
      if (!ledger) results.push(g.skip(`no readable ledger to read receipts from: ${error}`));
      else {
        const { problems, summary } = checkReceipts(ledger, path.dirname(path.resolve(ledgerPath)), state);
        results.push(problems.length ? g.fail(`${problems.length} problem(s): ${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more in evidence)` : ''}`, evidence(problems)) : g.ok(`${summary}; every receipt checks out and every capture is purged`, [{ file, value: summary }]));
      }
    }
  }
  return results;
}

/**
 * The check-module entry point (CONTRACTS section 4): the refs gates on `<state>/pattern-ledger.json`.
 * @param {{root: string, profile: import('./lib/profile.mjs').Profile, state?: string | null, log?: (line: string) => void}} ctx
 * @param {readonly string[]} selected gate ids
 * @returns {Promise<GateResult[]>}
 */
export async function run(ctx, selected) {
  const ids = selected.filter((id) => GATE_IDS.has(id));
  if (ids.length === 0) return [];
  const state = ctx.state ?? stateDir(ctx.root, ctx.profile);
  return ledgerGates(path.join(state, LEDGER_FILE), ids, { state });
}

// ---------- CLI ----------

const HELP = `Usage:
  node extract.mjs [extract] [<capture folder | captures root>...] [--profile <abs path>] [--out <file>] [--json]
  node extract.mjs validate-ledger [<ledger>] [--root <repo>] [--profile <abs path>] [--state <dir>]
                   [--gates refs.ledger,refs.receipts] [--allow-skip <id>[,<id>]] [--out <dir>] [--json]

extract          reads capture folders made by capture.mjs (default: every capture under the profile's
                 <workspace.private_dir>/frontend/captures, else <os tmp>/frontend-captures) and writes
                 refs-extract.json next to them: per reference the font-size histogram and scale ratio, spacing
                 histogram and base unit, radius family, palette roles (ground by painted area, ink by share of
                 text, accent by primary call-to-action backgrounds), density, nav and above-the-fold calls to
                 action, figures row, number formatting, light or dark ground, breakpoints, rendered fonts, the
                 reveal probe, a ledger_reference to copy into the ledger, and a side-by-side comparison. Raw values
                 are "measured"; roles are "inferred". Extract before purging: a purged capture cannot be read.
validate-ledger  runs the gates refs.ledger and refs.receipts on pattern-ledger.json (default <state>/${LEDGER_FILE}):
                 refs.ledger   shape (CONTRACTS 6.5), at least two unrelated references (different owner and
                               domain), at most ${MAX_HOSTS} hosts and one page per host, every convention, relationship
                               or domain pattern from two unrelated references (a fact may rest on one), no colour
                               value in a statement, not_borrowed filled, excluded present
                 refs.receipts each reference's capture-gate receipt (verdict captured, same URL, honest identity,
                               terms attested, manifest unchanged) and its purge (deletion receipt, files gone);
                               "manual-notes" marks the owner's own notes (RF-12); captures in refs-index.json
                               that are not in the ledger must be purged too

Options:
  --profile <path>   profile (workspace.private_dir, run mode)
  --root <repo>      the product repository (to find the state folder)
  --state <dir>      state folder (default: stateDir(root, profile))
  --gates <ids>      refs.ledger, refs.receipts or refs (default: both)
  --allow-skip <id>  a skipped gate that does not make the report fail
  --out <path>       extract: the refs-extract.json path; validate-ledger: folder for refs-gates.json
  --url, --serve     accepted for symmetry with frontend-check; the refs gates read files only
  --json             the result on stdout
  -h, --help         this text

Exit codes: 0 written, or every requested gate ok; 1 a gate failed or was skipped; 2 usage error (no capture to
read, a missing ledger named on the command line, bad flags); 3 environment error.`;

/**
 * @param {readonly string[]} argv
 * @param {{stdout?: (s: string) => void, stderr?: (s: string) => void, now?: () => Date}} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? ((s) => process.stdout.write(s));
  const stderr = deps.stderr ?? ((s) => process.stderr.write(s));
  const now = deps.now ?? (() => new Date());
  const { values, positionals } = parseCli(argv, {
    help: HELP,
    options: {
      profile: { type: 'string' },
      root: { type: 'string' },
      state: { type: 'string' },
      gates: { type: 'string' },
      'allow-skip': { type: 'string', multiple: true },
      out: { type: 'string' },
      url: { type: 'string' },
      serve: { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  const [first, ...rest] = positionals;
  if (first === 'validate-ledger') {
    if (rest.length > 1) throw new UsageError('validate-ledger takes at most one ledger path');
    const allGates = GATES.map((g) => g.id);
    const ids = values.gates === undefined ? allGates : values.gates.split(',').map((s) => s.trim()).filter(Boolean).flatMap((s) => (s === 'refs' ? allGates : [s]));
    const unknown = ids.filter((id) => !GATE_IDS.has(id));
    if (unknown.length || ids.length === 0) throw new UsageError(`--gates accepts ${allGates.join(', ')} or refs; got ${values.gates}`);
    const root = values.root ? path.resolve(values.root) : process.cwd();
    let state = values.state ? path.resolve(values.state) : null;
    let ledgerPath;
    if (rest[0]) {
      ledgerPath = path.resolve(rest[0]);
      if (!existsSync(ledgerPath)) throw new UsageError(`ledger not found: ${toPosix(ledgerPath)}; check the path`);
    } else {
      if (!state) state = stateDir(root, loadProfile(values.profile, { root }), null);
      ledgerPath = path.join(state, LEDGER_FILE);
    }
    const results = ledgerGates(ledgerPath, ids, { state });
    const allowSkip = (values['allow-skip'] ?? []).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
    const report = aggregate(results, { allowSkip, requested: GATES.filter((g) => ids.includes(g.id)), tool: 'extract', target: { root: toPosix(root), ledger: toPosix(ledgerPath), state: state ? toPosix(state) : null }, at: now() });
    for (const g of report.gates) stderr(`${g.state === 'ok' ? 'ok  ' : g.state === 'fail' ? 'FAIL' : 'SKIP'} ${g.id}: ${g.detail}\n`);
    if (values.out) stderr(`report: ${writeReport(report, values.out, 'refs-gates')}\n`);
    if (values.json) stdout(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) throw new CheckError(`refs gates did not pass (${report.counts.fail} failed, ${report.counts.skipped} skipped); fix the ledger or the receipts and run again`);
    return 0;
  }
  if (first !== undefined && first !== 'extract' && !existsSync(first)) {
    throw new UsageError(`unknown command or folder ${first}; use extract or validate-ledger (--help)`);
  }
  const targets = first === 'extract' ? rest : positionals;
  let dirs;
  if (targets.length) dirs = findCaptures(targets);
  else {
    const profile = loadProfile(values.profile, { root: values.root ? path.resolve(values.root) : undefined });
    const capturesRoot = profile.workspace.private_dir ? path.resolve(profile.workspace.private_dir, 'frontend', 'captures') : null;
    const root = capturesRoot && existsSync(capturesRoot) ? capturesRoot : resolveCapturesRoot(null, null);
    dirs = existsSync(root) ? listCaptureDirs(root) : [];
  }
  const readable = dirs.filter((d) => {
    if (existsSync(path.join(d, CAPTURE_FILES.deletion))) {
      stderr(`extract: skipping ${toPosix(d)}: purged\n`);
      return false;
    }
    return true;
  });
  const { file, result } = extractAll(readable, { out: values.out ?? null, now: now() });
  for (const r of result.references) stderr(`extract: ${r.id} ${r.url}: ground ${r.ground.mode ?? '?'}, body ${r.type.body?.px ?? '?'} px, scale ${r.type.scale.ratio ?? 'none'}, spacing base ${r.spacing.base ?? 'none'}, radius ${r.radius.family ?? '?'}, ${r.cta.aboveFold.total} CTA above the fold${r.warnings.length ? `, ${r.warnings.length} warning(s)` : ''}\n`);
  stderr(`extract: wrote ${file}\n`);
  if (values.json) stdout(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

/**
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
