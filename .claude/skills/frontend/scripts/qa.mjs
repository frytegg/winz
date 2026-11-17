// @ts-check
/**
 * qa.mjs: the render and a11y gates of frontend-check (CONTRACTS section 4), measured in the skill's pinned
 * Chromium on every route and viewport of the profile.
 *
 * render.console   pageerror and console errors (network errors are left to render.requests)
 * render.requests  requestfailed and responses with status 400 or above (requestfailed ignores HTTP errors)
 * render.fonts     FontFace errors, and CDP CSS.getPlatformFontsForNode on headings, body text and buttons: each text
 *                  must render in the family its stack asks for, declared by the tokens or the page
 * render.images    rendered <img> that are complete with naturalWidth 0 and whose request failed, answered 400 or
 *                  above, or cannot be decoded; images whose request never finishes
 * render.overflow  documentElement.scrollWidth <= clientWidth at the reflow and mobile viewports, 320 and 375 CSS px
 * render.clipping  text cut by an overflow-clipping box (line-clamp and ellipsis excluded); text over other text
 * render.cls       largest layout-shift session window over load plus a scripted scroll, at most 0.1
 * a11y.axe         @axe-core/playwright, tags wcag2a wcag2aa wcag21a wcag21aa wcag22aa (withTags after options)
 * a11y.contrast    axe color-contrast violations, every axe "incomplete" resolved from pixels (text made
 *                  transparent), WCAG 2 ratios 4.5 and 3 (APCA advisory only); text-input boundaries at 3:1
 * a11y.targets     axe target-size (24 CSS px with the spacing exception)
 *
 * Sources: FD17 Deliverables A (layer 0) and B, FD17-F23 to F26 and F29, FD06-F10 and F12, FD04-F07 to F09 and F24,
 * /harden lens-frontend FE-18 and FE-21.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { AxeBuilder } from '@axe-core/playwright';
import { parseCli, isMainModule } from './lib/args.mjs';
import { launch, withPage } from './lib/browser.mjs';
import { composite, contrastRatio, parseColor, toHex } from './lib/color.mjs';
import { selectorFor } from './lib/dom.mjs';
import { CheckError, EnvError, UsageError, exitWith } from './lib/errors.mjs';
import { readText, toPosix } from './lib/fsutil.mjs';
import { designDir, stateDir, statePath } from './lib/paths.mjs';
import { loadProfile } from './lib/profile.mjs';
import { aggregate, gate, utcStamp, writeReport } from './lib/report.mjs';
import { loadRoutes, routeUrl } from './lib/routes.mjs';
import { serveStatic } from './lib/serve.mjs';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('playwright-core').Page} Page
 * @typedef {import('playwright-core').Locator} Locator
 * @typedef {import('playwright-core').CDPSession} CDPSession
 * @typedef {import('./lib/profile.mjs').Profile} Profile
 * @typedef {import('./lib/profile.mjs').Viewport} Viewport
 * @typedef {import('./lib/routes.mjs').Route} Route
 * @typedef {import('./lib/report.mjs').GateMeta} GateMeta
 * @typedef {import('./lib/report.mjs').GateResult} GateResult
 * @typedef {import('./lib/report.mjs').Evidence} Evidence
 * @typedef {import('./lib/color.mjs').Rgba} Rgba
 *
 * @typedef {{root: string, profile: Profile, state: string | null, design: string, routes: Route[],
 *   baseUrl: string | null, browser: Browser | null, viewports: Viewport[], args: Record<string, unknown>,
 *   log: (line: string) => void}} CheckContext
 */

/** @type {ReadonlyArray<Readonly<GateMeta>>} */
export const GATES = Object.freeze([
  Object.freeze({ id: 'render.console', title: 'No console errors on any route', ifDropped: 'a page that throws in front of the jury would pass' }),
  Object.freeze({ id: 'render.requests', title: 'No failed requests and no HTTP 4xx or 5xx responses', ifDropped: 'a 404 asset or API call would pass, since requestfailed ignores HTTP errors' }),
  Object.freeze({ id: 'render.fonts', title: 'Text renders in the declared fonts, never a silent fallback', ifDropped: 'a fallback font could render in place of the chosen face, unseen' }),
  Object.freeze({ id: 'render.images', title: 'No broken images', ifDropped: 'a broken image would pass' }),
  Object.freeze({ id: 'render.overflow', title: 'No horizontal scroll at the reflow and mobile widths', ifDropped: 'the page could scroll sideways on a phone' }),
  Object.freeze({ id: 'render.clipping', title: 'No text cut by overflow or drawn over other text', ifDropped: 'a clipped heading or a tagline cut at the fold would pass' }),
  Object.freeze({ id: 'render.cls', title: 'Layout shift at most 0.1 over load and a scripted scroll', ifDropped: 'late fonts or lazy images could move the page under the judge' }),
  Object.freeze({ id: 'a11y.axe', title: 'axe-core finds no WCAG 2.2 AA violation', ifDropped: 'an unlabelled control or a missing lang would ship, and /harden may never look' }),
  Object.freeze({ id: 'a11y.contrast', title: 'Text contrast meets WCAG 2 AA, axe incomplete items resolved from pixels', ifDropped: 'text over a gradient, glass or grain would pass unmeasured' }),
  Object.freeze({ id: 'a11y.targets', title: 'Pointer targets at least 24 by 24 CSS px', ifDropped: 'controls under 24 px would pass' }),
]);

/** Gate ids of this module, in report order. */
export const GATE_IDS = Object.freeze(GATES.map((g) => g.id));

/** The axe tag set of /harden FE-18; target-size runs only because wcag22aa is requested (FE-21). */
export const AXE_TAGS = Object.freeze(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);

/** Thresholds with an external source: WCAG 2.2 (FD17-F23), web.dev CLS (FD17-F26). */
export const LIMITS = Object.freeze({
  cls: 0.1,
  contrastNormal: 4.5,
  contrastLarge: 3,
  nonText: 3,
  reflowWidth: 320,
  phoneWidth: 375,
});

/**
 * Measurement constants. These are tolerances of the instruments, not design thresholds: pixel rounding, the
 * difference between a glyph's content area and its line box, anti-aliasing, page-size caps.
 */
export const TUNING = Object.freeze({
  clipTolerancePx: 1,
  cutVisibleFraction: 0.75,
  overlapMinPx: 2,
  overlapMinFraction: 0.3,
  overlapMinOpacity: 0.5,
  pixelDiffMin: 6,
  coreDiffFraction: 0.7,
  coverageMin: 0.5,
  worstPercentile: 0.01,
  percentileMinSamples: 100,
  maxPixelSamples: 20000,
  fontSamples: { heading: 40, button: 30, body: 80, perSignature: 3 },
  fontProbeRounds: 8,
  contrastItemsMax: 400,
  boundaryControlsMax: 40,
  evidenceMax: 40,
  scroll: { topSettleMs: 500, maxSteps: 40, stepDelayMs: 60, settleMs: 300, maxMs: 12000 },
  imageWaitMs: 5000,
  stepDeadlineMs: 90000,
});

const ALL_GROUPS = Object.freeze(['render', 'a11y']);

// ---------------------------------------------------------------------------------------------------------------
// Selection, parties, small pure helpers

/**
 * The gate ids of this module named by `selected` (ids, or the group names `render`, `a11y`, `all`), in report
 * order. Ids of other modules are ignored, so frontend-check can pass its whole selection. `undefined` selects all.
 * @param {ReadonlyArray<string> | string | undefined | null} selected
 * @returns {string[]}
 */
export function selectGates(selected) {
  if (selected === undefined || selected === null) return [...GATE_IDS];
  const list = typeof selected === 'string' ? selected.split(',') : [...selected];
  const wanted = new Set();
  for (const raw of list) {
    const s = String(raw).trim();
    if (s === 'all') GATE_IDS.forEach((id) => wanted.add(id));
    else if (ALL_GROUPS.includes(s)) GATE_IDS.filter((id) => id.startsWith(`${s}.`)).forEach((id) => wanted.add(id));
    else if (GATE_IDS.includes(s)) wanted.add(s);
  }
  return GATE_IDS.filter((id) => wanted.has(id));
}

/**
 * Names in `selected` that are neither a gate id of this module nor one of its groups (for the CLI's own check).
 * @param {ReadonlyArray<string>} selected
 * @returns {string[]}
 */
export function unknownGates(selected) {
  return selected.map((s) => s.trim()).filter((s) => s !== '' && s !== 'all' && !ALL_GROUPS.includes(s) && !GATE_IDS.includes(s));
}

/**
 * @param {string} hostname as URL parses it
 * @returns {boolean}
 */
function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/**
 * 'first' for the target's own origin (and for any loopback host when the target is loopback: a local API on
 * another port belongs to the same app), data:, blob: and about: URLs; 'third' for every other origin.
 * @param {string} url
 * @param {string} baseUrl
 * @returns {'first' | 'third'}
 */
export function partyOf(url, baseUrl) {
  let u;
  let b;
  try {
    u = new URL(url);
    b = new URL(baseUrl);
  } catch {
    return 'first';
  }
  if (['data:', 'blob:', 'about:'].includes(u.protocol)) return 'first';
  if (u.origin === b.origin) return 'first';
  if (isLoopback(u.hostname) && isLoopback(b.hostname)) return 'first';
  return 'third';
}

/**
 * Whether an issue from `party` counts: first-party issues always do; third-party ones count when the profile
 * forbids external requests, since such a page cannot render offline anyway.
 * @param {'first' | 'third'} party
 * @param {Profile} profile
 * @returns {boolean}
 */
export function counts(party, profile) {
  return party === 'first' || !profile.external_requests;
}

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function clip(text, max) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * @param {number} x
 * @param {number} [digits]
 * @returns {number}
 */
function round(x, digits = 2) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/**
 * Index of quantile `q` (0 <= q <= 1) in an ascending list of `n` values, by the nearest-rank method: rank
 * ceil(q * n), counted from 1.
 * @param {number} n
 * @param {number} q
 * @returns {number}
 */
export function rankIndex(n, q) {
  return Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1));
}

/**
 * Value at quantile `q` of an ascending list (nearest rank), NaN for an empty list.
 * @param {number[]} sorted ascending
 * @param {number} q
 * @returns {number}
 */
export function percentile(sorted, q) {
  return sorted.length === 0 ? Number.NaN : sorted[rankIndex(sorted.length, q)];
}

// ---------------------------------------------------------------------------------------------------------------
// Fonts: family lists, declarations, the intended family of a text

/** CSS generic families (CSS Fonts 4). They resolve per platform, so an unavailable one is skipped, not a failure. */
export const GENERIC_FAMILIES = Object.freeze(new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace',
  'ui-rounded', 'math', 'emoji', 'fangsong',
]));

/**
 * Platform system and web-safe faces that system stacks name in turn (one per OS), so the one missing on this
 * machine is the stack working as written, not a fallback nobody chose. A design face (Inter, Satoshi, a brand
 * face) is not here: named and not shipped, it is a silent fallback wherever it is not installed.
 */
export const SYSTEM_FAMILIES = Object.freeze(new Set([
  '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'segoe ui variable', 'segoe ui variable text', 'segoe',
  'roboto', 'helvetica neue', 'helvetica', 'arial', 'ubuntu', 'cantarell', 'noto sans', 'oxygen', 'oxygen-sans',
  'fira sans', 'droid sans', 'sf pro', 'sf pro text', 'sf pro display', 'san francisco', 'lucida grande',
  'lucida sans unicode', 'tahoma', 'verdana', 'trebuchet ms', 'liberation sans', 'dejavu sans', 'avenir',
  'avenir next', 'arial nova', 'calibri', 'candara', 'corbel', 'optima', 'seravek', 'gill sans', 'gill sans mt',
  'century gothic', 'franklin gothic medium', 'futura', 'georgia', 'times new roman', 'times', 'cambria', 'constantia',
  'palatino', 'palatino linotype', 'book antiqua', 'garamond', 'baskerville', 'charter', 'bitstream charter',
  'iowan old style', 'apple garamond', 'hoefler text', 'didot', 'rockwell', 'lucida bright', 'liberation serif',
  'dejavu serif', 'noto serif', 'sitka text', 'sfmono-regular', 'sf mono', 'menlo', 'monaco', 'consolas',
  'liberation mono', 'courier new', 'courier', 'cascadia code', 'cascadia mono', 'dejavu sans mono', 'ubuntu mono',
  'lucida console', 'andale mono', 'noto sans mono', 'apple color emoji', 'segoe ui emoji', 'segoe ui symbol',
  'noto color emoji', 'android emoji', 'emojione color', 'twemoji mozilla',
]));

/**
 * Splits a CSS font-family list into names, honouring quotes and escapes; quotes are removed, case is kept.
 * @param {string} value
 * @returns {string[]}
 */
export function parseFontFamilyList(value) {
  /** @type {string[]} */
  const out = [];
  let current = '';
  /** @type {string | null} */
  let quote = null;
  let quoted = false;
  const push = () => {
    const name = quoted ? current : current.trim().replace(/\s+/g, ' ');
    if (name !== '') out.push(name);
    current = '';
    quoted = false;
  };
  const s = String(value ?? '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\' && i + 1 < s.length) {
        current += s[i + 1];
        i += 1;
      } else if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      quoted = true;
      current = '';
    } else if (ch === ',') {
      push();
    } else if (!quoted) {
      current += ch;
    }
  }
  push();
  return out.filter((name) => !/^var\(|^env\(|^inherit$|^initial$|^unset$|^revert/i.test(name));
}

/**
 * Comparison key of a family name: lower case, quotes and runs of spaces normalised.
 * @param {string} name
 * @returns {string}
 */
export function familyKey(name) {
  return String(name ?? '').trim().replace(/^["']|["']$/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * A family name as CSS: generics bare, other names quoted.
 * @param {string} name
 * @returns {string}
 */
export function familyCss(name) {
  const key = familyKey(name);
  if (GENERIC_FAMILIES.has(key)) return key;
  return `"${String(name).replace(/["\\]/g, (c) => `\\${c}`)}"`;
}

/**
 * @typedef {{familyName: string, postScriptName: string, isCustomFont: boolean, glyphCount: number}} PlatformFont
 * @typedef {{familyName: string, postScriptName: string, isCustomFont: boolean}} ResolvedFont
 * @typedef {{webfonts: Set<string>, shipped: Set<string>, names: Set<string>, checkDeclared: boolean}} FontDeclarations
 * @typedef {'generic' | 'webfont' | 'shipped' | 'system' | 'named'} EntryKind
 * @typedef {{entry: string | null, kind: EntryKind | 'default', font: ResolvedFont | null, why: string}} IntendedFont
 */

/**
 * How a stack entry behaves when it is not available: generics and system faces are skipped (the stack goes on as
 * written); a page web font, a tokens font with a file, or any other named face must render.
 * @param {string} key familyKey of the entry
 * @param {FontDeclarations} decl
 * @returns {EntryKind}
 */
export function entryKind(key, decl) {
  if (GENERIC_FAMILIES.has(key)) return 'generic';
  if (decl.webfonts.has(key)) return 'webfont';
  if (decl.shipped.has(key)) return 'shipped';
  if (SYSTEM_FAMILIES.has(key)) return 'system';
  return 'named';
}

/**
 * Whether an unresolved entry of this kind stops the stack (it had to render) instead of passing to the next one.
 * @param {EntryKind} kind
 * @returns {boolean}
 */
export function mustRender(kind) {
  return kind === 'webfont' || kind === 'shipped' || kind === 'named';
}

/**
 * The family a stack asks for on this machine: the first entry that renders, unless an entry that had to render
 * did not (a silent fallback). `resolutions` maps familyKey to the platform font the entry renders with, or null
 * when the entry is not available.
 * @param {string[]} stack
 * @param {Map<string, ResolvedFont | null>} resolutions
 * @param {FontDeclarations} decl
 * @returns {IntendedFont}
 */
export function intendedFont(stack, resolutions, decl) {
  for (const entry of stack) {
    const key = familyKey(entry);
    const kind = entryKind(key, decl);
    const font = resolutions.get(key) ?? null;
    if (kind === 'shipped') {
      const where = font ? `; here it renders from a copy installed on this machine (${font.familyName})` : '';
      return { entry, kind, font: null, why: `tokens.json ships "${entry}" as a file, but the page declares no @font-face for it${where}` };
    }
    if (font && kind === 'named' && !font.isCustomFont) {
      return {
        entry,
        kind,
        font: null,
        why: `"${entry}" renders from a copy installed on this machine (${font.familyName}), but the page does not ship it with @font-face, so a judge's machine without it falls back`,
      };
    }
    if (font) return { entry, kind, font, why: '' };
    if (!resolutions.has(key)) return { entry, kind, font: null, why: `"${entry}" could not be resolved` };
    if (kind === 'webfont') return { entry, kind, font: null, why: `the web font "${entry}" did not render (its file failed, or it lacks these glyphs)` };
    if (kind === 'named') return { entry, kind, font: null, why: `"${entry}" is named first but neither shipped with @font-face nor installed` };
  }
  return { entry: null, kind: 'default', font: null, why: 'no family of the stack is available, so the browser default renders' };
}

/**
 * The font that rendered most glyphs of a text (per-glyph fallbacks for symbols or emoji leave it unchanged).
 * @param {PlatformFont[] | null | undefined} fonts
 * @returns {PlatformFont | null}
 */
export function dominantFont(fonts) {
  if (!Array.isArray(fonts) || fonts.length === 0) return null;
  return fonts.reduce((best, f) => (f.glyphCount > best.glyphCount ? f : best), fonts[0]);
}

/**
 * @param {{familyName: string, isCustomFont: boolean}} a
 * @param {{familyName: string, isCustomFont: boolean}} b
 * @returns {boolean}
 */
export function sameFont(a, b) {
  return familyKey(a.familyName) === familyKey(b.familyName) && Boolean(a.isCustomFont) === Boolean(b.isCustomFont);
}

/**
 * Judges one text: it passes when its dominant rendered font is the intended family of its stack and that family
 * is declared by the tokens or the page (an undeclared one comes from the browser's default style, such as a
 * button that does not inherit the page font).
 * @param {{stack: string[], tag: string, category: string}} sample
 * @param {PlatformFont[] | null} fonts
 * @param {Map<string, ResolvedFont | null>} resolutions
 * @param {FontDeclarations} decl
 * @returns {{ok: boolean, measured: boolean, reason: string, intended: IntendedFont, rendered: PlatformFont | null}}
 */
export function judgeTextFont(sample, fonts, resolutions, decl) {
  const rendered = dominantFont(fonts);
  const intended = intendedFont(sample.stack, resolutions, decl);
  if (!rendered) return { ok: true, measured: false, reason: 'no glyph rendered', intended, rendered };
  const shown = `${rendered.familyName}${rendered.isCustomFont ? '' : ' (system)'}`;
  if (!intended.font) {
    const tail = intended.why.includes(`(${rendered.familyName})`) ? '' : `; it renders in ${shown}`;
    return { ok: false, measured: true, reason: `${intended.why}${tail}`, intended, rendered };
  }
  if (!sameFont(rendered, intended.font)) {
    return {
      ok: false,
      measured: true,
      reason: `"${intended.entry}" (${intended.font.familyName}) should render, but most glyphs render in ${shown}: the face lacks them`,
      intended,
      rendered,
    };
  }
  const key = familyKey(intended.entry ?? '');
  if (decl.checkDeclared && !decl.names.has(key)) {
    const hint = /^(button|input|select|textarea|summary)$/.test(sample.tag) || sample.category === 'button'
      ? '; the control does not inherit the page font (set font: inherit)'
      : '';
    return {
      ok: false,
      measured: true,
      reason: `"${intended.entry}" comes from the browser's default style, not from tokens.json or the page CSS${hint}`,
      intended,
      rendered,
    };
  }
  return { ok: true, measured: true, reason: '', intended, rendered };
}

/**
 * Families tokens.json declares (`type.fonts[].family`, `type.families`) and those it ships as files. A missing or
 * unreadable file yields empty lists and an error note: tokens.valid owns the file's validity.
 * @param {string} design
 * @returns {{families: string[], shipped: string[], note: string | null}}
 */
export function tokenFonts(design) {
  const file = path.join(design, 'tokens.json');
  let raw;
  try {
    raw = JSON.parse(readText(file));
  } catch (err) {
    if (err instanceof UsageError && /file not found/.test(err.message)) return { families: [], shipped: [], note: null };
    return { families: [], shipped: [], note: `tokens.json unreadable (${err instanceof Error ? err.message : String(err)}); fonts judged from the page alone` };
  }
  /** @type {string[]} */
  const families = [];
  /** @type {string[]} */
  const shipped = [];
  const type = raw && typeof raw === 'object' ? raw.type : null;
  if (type && Array.isArray(type.fonts)) {
    for (const f of type.fonts) {
      if (!f || typeof f.family !== 'string' || f.family.trim() === '') continue;
      families.push(f.family);
      if (typeof f.file === 'string' && f.file.trim() !== '') shipped.push(f.family);
    }
  }
  if (type && type.families && typeof type.families === 'object') {
    for (const value of Object.values(type.families)) {
      if (typeof value === 'string') families.push(...parseFontFamilyList(value));
    }
  }
  return { families, shipped, note: null };
}

/**
 * @param {{names: string[], faces: Array<{family: string}>, opaque: number}} inventory
 * @param {{families: string[], shipped: string[]}} tokens
 * @returns {FontDeclarations}
 */
export function buildDeclarations(inventory, tokens) {
  const webfonts = new Set(inventory.faces.map((f) => familyKey(f.family)));
  const names = new Set([...inventory.names.map(familyKey), ...tokens.families.map(familyKey), ...webfonts]);
  const shipped = new Set(tokens.shipped.map(familyKey));
  return { webfonts, shipped, names, checkDeclared: inventory.opaque === 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// Layout shift, contrast arithmetic, PNG decoding

/**
 * @typedef {{value: number, startTime: number, hadRecentInput: boolean, sources?: string[]}} ShiftEntry
 * @typedef {{cls: number, sum: number, windows: number, flagged: number, worst: {value: number, start: number,
 *   end: number, entries: ShiftEntry[]}}} ShiftScore
 */

/**
 * CLS as web.dev defines it: the largest session window of layout shifts (each shift less than 1 s after the
 * previous one, the window at most 5 s long), shifts with recent input excluded (FD17-F26). `sum` is the plain total.
 * `keepFlagged` counts the shifts flagged hadRecentInput too: the gate sends no input, and under mobile emulation
 * Chromium flags the first 500 ms after load because applying the emulated viewport counts as a resize, which would
 * hide exactly the late-banner shifts a phone user sees. `flagged` reports how many carried the flag.
 * @param {ShiftEntry[]} shifts
 * @param {{keepFlagged?: boolean}} [options]
 * @returns {ShiftScore}
 */
export function layoutShiftScore(shifts, { keepFlagged = false } = {}) {
  const valid = (shifts ?? []).filter((s) => s && Number.isFinite(s.value) && s.value > 0);
  const flagged = valid.filter((s) => s.hadRecentInput).length;
  const list = valid
    .filter((s) => keepFlagged || !s.hadRecentInput)
    .sort((a, b) => a.startTime - b.startTime);
  let sum = 0;
  let windows = 0;
  /** @type {{value: number, start: number, last: number, entries: ShiftEntry[]} | null} */
  let current = null;
  let worst = { value: 0, start: 0, end: 0, entries: /** @type {ShiftEntry[]} */ ([]) };
  for (const s of list) {
    sum += s.value;
    if (current && s.startTime - current.last < 1000 && s.startTime - current.start < 5000) {
      current.value += s.value;
      current.last = s.startTime;
      current.entries.push(s);
    } else {
      current = { value: s.value, start: s.startTime, last: s.startTime, entries: [s] };
      windows += 1;
    }
    if (current.value > worst.value) worst = { value: current.value, start: current.start, end: current.last, entries: [...current.entries] };
  }
  return { cls: worst.value, sum, windows, flagged, worst };
}

/**
 * axe-core's large-text rule, mirrored so pixel verdicts and axe verdicts agree: bold is weight 700 or more; large
 * is 18 pt, or 14 pt bold, with axe's point rounding.
 * @param {number} fontSizePx
 * @param {string | number} fontWeight
 * @returns {boolean}
 */
export function isLargeText(fontSizePx, fontWeight) {
  const bold = Number.parseFloat(String(fontWeight)) >= 700 || fontWeight === 'bold';
  const pt = Math.ceil(fontSizePx * 72) / 96;
  return bold ? pt >= 14 : pt >= 18;
}

/**
 * The WCAG 2 minimum for a text: 3 for large text and for glyphs axe classifies as non-text (icon fonts, emoji),
 * 4.5 otherwise.
 * @param {{fontSizePx: number, fontWeight: string | number, graphic?: boolean}} text
 * @returns {number}
 */
export function requiredRatio({ fontSizePx, fontWeight, graphic = false }) {
  return graphic || isLargeText(fontSizePx, fontWeight) ? LIMITS.contrastLarge : LIMITS.contrastNormal;
}

/**
 * @typedef {{width: number, height: number, data: Uint8Array}} RgbaImage 8-bit RGBA, row-major
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Decodes a non-interlaced PNG (every colour type, bit depths 1 to 16) into 8-bit RGBA. Chromium screenshots are
 * 8-bit RGB or RGBA; the rest is there so a decoding error always means a broken file.
 * @param {Uint8Array} input
 * @returns {RgbaImage}
 */
export function decodePng(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG file');
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = -1;
  let interlace = 0;
  /** @type {Buffer | null} */
  let palette = null;
  /** @type {Buffer | null} */
  let transparency = null;
  /** @type {Buffer[]} */
  const idat = [];
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    if (data.length !== length) throw new Error(`PNG chunk ${type} is truncated`);
    pos += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0) throw new Error('unsupported PNG compression or filter method');
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  const channels = /** @type {Record<number, number>} */ ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
  if (!channels || width === 0 || height === 0) throw new Error('PNG header missing or invalid');
  if (interlace !== 0) throw new Error('interlaced PNG is not supported');
  if (![1, 2, 4, 8, 16].includes(depth)) throw new Error(`unsupported PNG bit depth ${depth}`);
  if (colorType === 3 && !palette) throw new Error('palette PNG without PLTE');
  const raw = inflateSync(Buffer.concat(idat));
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  if (raw.length < height * (stride + 1)) throw new Error('PNG image data is truncated');
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  const max = (1 << Math.min(depth, 8)) - 1;
  for (let y = 0; y < height; y += 1) {
    const offset = y * (stride + 1);
    const filter = raw[offset];
    const line = new Uint8Array(raw.subarray(offset + 1, offset + 1 + stride));
    unfilter(line, prev, bpp, filter);
    for (let x = 0; x < width; x += 1) {
      /** @type {(c: number) => number} */
      const sample = (c) => {
        if (depth === 16) return line[(x * channels + c) * 2];
        if (depth === 8) return line[x * channels + c];
        const bit = (x * channels + c) * depth;
        return (line[bit >> 3] >> (8 - depth - (bit & 7))) & max;
      };
      const o = (y * width + x) * 4;
      if (colorType === 3) {
        const index = sample(0);
        const p = /** @type {Buffer} */ (palette);
        out[o] = p[index * 3] ?? 0;
        out[o + 1] = p[index * 3 + 1] ?? 0;
        out[o + 2] = p[index * 3 + 2] ?? 0;
        out[o + 3] = transparency && index < transparency.length ? transparency[index] : 255;
        continue;
      }
      const scale = depth < 8 ? (/** @type {number} */ v) => Math.round((v * 255) / max) : (/** @type {number} */ v) => v;
      if (colorType === 0 || colorType === 4) {
        const g = scale(sample(0));
        out[o] = g;
        out[o + 1] = g;
        out[o + 2] = g;
        out[o + 3] = colorType === 4 ? sample(1) : 255;
      } else {
        out[o] = sample(0);
        out[o + 1] = sample(1);
        out[o + 2] = sample(2);
        out[o + 3] = colorType === 6 ? sample(3) : 255;
      }
    }
    prev = line;
  }
  return { width, height, data: out };
}

/**
 * Reverses one PNG scanline filter in place.
 * @param {Uint8Array} line
 * @param {Uint8Array} prev
 * @param {number} bpp
 * @param {number} filter
 */
function unfilter(line, prev, bpp, filter) {
  for (let i = 0; i < line.length; i += 1) {
    const left = i >= bpp ? line[i - bpp] : 0;
    const up = prev[i];
    const upLeft = i >= bpp ? prev[i - bpp] : 0;
    let value;
    switch (filter) {
      case 0: value = line[i]; break;
      case 1: value = line[i] + left; break;
      case 2: value = line[i] + up; break;
      case 3: value = line[i] + ((left + up) >> 1); break;
      case 4: {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value = line[i] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
        break;
      }
      default: throw new Error(`invalid PNG filter type ${filter}`);
    }
    line[i] = value & 0xff;
  }
}

/**
 * @param {Uint8Array} data
 * @param {number} i pixel index
 * @returns {Rgba}
 */
function pixelAt(data, i) {
  return { r: data[i * 4] / 255, g: data[i * 4 + 1] / 255, b: data[i * 4 + 2] / 255, a: 1 };
}

/**
 * @typedef {{samples: number, min: number, worst: number, median: number, fg: Rgba, bg: Rgba}} PixelContrast
 * @typedef {{ratio: number, fg: Rgba, bg: Rgba}} PixelRatio
 */

/**
 * The worst case of per-pixel ratios: the 1st percentile (the minimum under 100 samples), so one noisy pixel of
 * grain does not decide alone; also the minimum and the median, for the report.
 * @param {PixelRatio[]} ratios
 * @returns {PixelContrast | null}
 */
export function summariseRatios(ratios) {
  if (ratios.length === 0) return null;
  const sorted = [...ratios].sort((a, b) => a.ratio - b.ratio);
  const index = sorted.length >= TUNING.percentileMinSamples ? rankIndex(sorted.length, TUNING.worstPercentile) : 0;
  const worst = sorted[index];
  return {
    samples: sorted.length,
    min: sorted[0].ratio,
    worst: worst.ratio,
    median: sorted[rankIndex(sorted.length, 0.5)].ratio,
    fg: { ...worst.fg, a: 1 },
    bg: worst.bg,
  };
}

/**
 * Contrast of a text from two screenshots of the same box: `shown` as rendered, `hidden` with the text made
 * transparent. Pixels that differ are the glyphs' footprint, and `hidden` gives the background behind each of them.
 * Mode 'css': the text colour is `fg` (its alpha and the opacity chain composited over each background pixel).
 * Mode 'core' (blend modes and filters, where no CSS colour describes the result): the colour is read from glyph
 * pixels that differ from the background by at least 70% of the largest difference. Returns null when no pixel
 * differs: the text painted nothing in its box.
 * @param {RgbaImage} shown
 * @param {RgbaImage} hidden
 * @param {{mode: 'css' | 'core', fg?: Rgba | null}} options
 * @returns {PixelContrast | null}
 */
export function pixelContrast(shown, hidden, { mode, fg = null }) {
  assertSameSize(shown, hidden);
  const n = shown.width * shown.height;
  /** @type {number[]} */
  const footprint = [];
  /** @type {number[]} */
  const diffs = [];
  let maxDiff = 0;
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    const d = Math.max(
      Math.abs(shown.data[o] - hidden.data[o]),
      Math.abs(shown.data[o + 1] - hidden.data[o + 1]),
      Math.abs(shown.data[o + 2] - hidden.data[o + 2]),
    );
    if (d >= TUNING.pixelDiffMin) {
      footprint.push(i);
      diffs.push(d);
      if (d > maxDiff) maxDiff = d;
    }
  }
  if (footprint.length < 4) return null;
  const chosen = mode === 'core' || !fg ? footprint.filter((_, k) => diffs[k] >= TUNING.coreDiffFraction * maxDiff) : footprint;
  const step = Math.max(1, Math.ceil(chosen.length / TUNING.maxPixelSamples));
  /** @type {Map<number, number>} */
  const cache = new Map();
  /** @type {PixelRatio[]} */
  const ratios = [];
  for (let k = 0; k < chosen.length; k += step) {
    const bg = pixelAt(hidden.data, chosen[k]);
    const text = mode === 'css' && fg ? composite(fg, bg) : pixelAt(shown.data, chosen[k]);
    ratios.push({ ratio: cachedRatio(text, bg, cache), fg: text, bg });
  }
  return summariseRatios(ratios);
}

/**
 * Contrast of a text whose fill is not one colour (gradient text through background-clip: text). Two more
 * screenshots paint the same glyphs solid black and solid white, so each pixel's coverage is exact:
 * alpha = white - black. The fill under each pixel follows from shown = alpha * fill + (1 - alpha) * background,
 * without the bias anti-aliased edges would add; pixels under 50% coverage are too thin to solve and are left out.
 * @param {RgbaImage} shown
 * @param {RgbaImage} hidden text transparent
 * @param {RgbaImage} black glyphs painted #000
 * @param {RgbaImage} white glyphs painted #fff
 * @returns {PixelContrast | null}
 */
export function coverageContrast(shown, hidden, black, white) {
  assertSameSize(shown, hidden);
  assertSameSize(shown, black);
  assertSameSize(shown, white);
  const n = shown.width * shown.height;
  /** @type {number[]} */
  const covered = [];
  /** @type {number[]} */
  const alphas = [];
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    const alpha = (white.data[o] - black.data[o] + white.data[o + 1] - black.data[o + 1] + white.data[o + 2] - black.data[o + 2]) / (3 * 255);
    if (alpha >= TUNING.coverageMin) {
      covered.push(i);
      alphas.push(Math.min(1, alpha));
    }
  }
  if (covered.length < 4) return null;
  const step = Math.max(1, Math.ceil(covered.length / TUNING.maxPixelSamples));
  /** @type {Map<number, number>} */
  const cache = new Map();
  /** @type {PixelRatio[]} */
  const ratios = [];
  for (let k = 0; k < covered.length; k += step) {
    const i = covered[k];
    const alpha = alphas[k];
    const o = i * 4;
    const solve = (/** @type {number} */ c) => Math.min(1, Math.max(0, (shown.data[o + c] - (1 - alpha) * hidden.data[o + c]) / (alpha * 255)));
    const fill = { r: solve(0), g: solve(1), b: solve(2), a: 1 };
    const bg = pixelAt(hidden.data, i);
    ratios.push({ ratio: cachedRatio(fill, bg, cache), fg: fill, bg });
  }
  return summariseRatios(ratios);
}

/**
 * @param {RgbaImage} a
 * @param {RgbaImage} b
 */
function assertSameSize(a, b) {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`screenshots differ in size (${a.width}x${a.height} and ${b.width}x${b.height})`);
}

/**
 * @param {Rgba} fg opaque
 * @param {Rgba} bg opaque
 * @param {Map<number, number>} cache
 * @returns {number}
 */
function cachedRatio(fg, bg, cache) {
  const byte = (/** @type {number} */ v) => Math.round(v * 255);
  const key = ((byte(fg.r) << 16) | (byte(fg.g) << 8) | byte(fg.b)) * 16777216 + ((byte(bg.r) << 16) | (byte(bg.g) << 8) | byte(bg.b));
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = /** @type {number} */ (contrastRatio(fg, bg));
  cache.set(key, value);
  return value;
}

/**
 * @typedef {{color: string, x: number, y: number, blur: number, spread: number, inset: boolean}} BoxShadow
 */

/**
 * Parses a computed box-shadow list (`rgba(0, 0, 0, 0.5) 0px 0px 0px 1px, ... inset`).
 * @param {string} value
 * @returns {BoxShadow[]}
 */
export function parseBoxShadows(value) {
  if (!value || value === 'none') return [];
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.flatMap((part) => {
    const fn = /^([a-z-]+\([^)]*\))\s*(.*)$/i.exec(part);
    let color = '';
    let rest = part;
    if (fn) {
      color = fn[1];
      rest = fn[2];
    } else {
      const words = part.split(/\s+/);
      const named = words.find((w) => parseColor(w) !== null);
      if (named) {
        color = named;
        rest = words.filter((w) => w !== named).join(' ');
      }
    }
    const inset = /\binset\b/.test(rest);
    const lengths = rest.replace(/\binset\b/, '').trim().split(/\s+/).filter(Boolean).map((w) => Number.parseFloat(w));
    if (!color || lengths.length < 2 || lengths.some((n) => !Number.isFinite(n))) return [];
    return [{ color, x: lengths[0], y: lengths[1], blur: lengths[2] ?? 0, spread: lengths[3] ?? 0, inset }];
  });
}

/**
 * @typedef {{width: number, style: string, color: string}} BorderSide
 * @typedef {{fill: string, borders: BorderSide[], shadows: string, outline: BorderSide | null}} BoxPaint
 */

/**
 * Non-text contrast of a control's boundary (WCAG 1.4.11): the best of its fill, its visible borders, a solid
 * outline and hard-edged shadow rings, each against the background the control sits on. Returns the best indicator.
 * @param {BoxPaint} paint
 * @param {Rgba | null} outside the opaque background around the box
 * @returns {{best: number, by: string, parts: Array<{what: string, ratio: number}>}}
 */
export function boundaryContrast(paint, outside) {
  /** @type {Array<{what: string, ratio: number}>} */
  const parts = [];
  if (!outside) return { best: 0, by: 'none', parts };
  const bg = outside;
  /** @type {(what: string, color: Rgba | null, over: (under: Rgba) => Rgba) => void} */
  const add = (what, color, over) => {
    if (!color || color.a === 0) return;
    parts.push({ what, ratio: /** @type {number} */ (contrastRatio(composite(color, over(bg)), bg)) });
  };
  const fill = parseColor(paint.fill);
  const same = (/** @type {Rgba} */ under) => under;
  add(`fill ${paint.fill}`, fill, same);
  const inner = (/** @type {Rgba} */ under) => (fill && fill.a > 0 ? composite(fill, under) : under);
  for (const side of paint.borders) {
    if (side.width >= 1 && side.style !== 'none' && side.style !== 'hidden') add(`border ${side.color}`, parseColor(side.color), inner);
  }
  if (paint.outline && paint.outline.width >= 1 && paint.outline.style !== 'none') {
    add(`outline ${paint.outline.color}`, parseColor(paint.outline.color), same);
  }
  for (const s of parseBoxShadows(paint.shadows)) {
    const ring = s.blur === 0 && (s.spread >= 1 || Math.abs(s.x) >= 1 || Math.abs(s.y) >= 1);
    if (ring) add(`${s.inset ? 'inset ' : ''}shadow ${s.color}`, parseColor(s.color), s.inset ? inner : same);
  }
  const best = parts.reduce((m, p) => (p.ratio > m.ratio ? p : m), { what: 'none', ratio: 0 });
  return { best: best.ratio, by: best.what, parts };
}

/**
 * The background a box sits on: the most frequent colour of the pixels between 1 and 3 CSS px outside `box`
 * (device pixels scaled by `dpr`), so a neighbour touching one edge (a button under an input) does not count as the
 * ground. Null when the ring is empty (the box fills the screenshot).
 * @param {RgbaImage} image screenshot of `clipRect`
 * @param {{x: number, y: number, width: number, height: number}} clipRect CSS px, viewport coordinates
 * @param {{x: number, y: number, width: number, height: number}} box CSS px, viewport coordinates
 * @param {number} dpr
 * @returns {Rgba | null}
 */
export function surroundingColor(image, clipRect, box, dpr) {
  /** @type {Map<number, number>} */
  const tally = new Map();
  for (let py = 0; py < image.height; py += 1) {
    for (let px = 0; px < image.width; px += 1) {
      const x = clipRect.x + (px + 0.5) / dpr;
      const y = clipRect.y + (py + 0.5) / dpr;
      const dx = Math.max(box.x - x, 0, x - (box.x + box.width));
      const dy = Math.max(box.y - y, 0, y - (box.y + box.height));
      const d = Math.max(dx, dy);
      if (d < 1 || d > 3) continue;
      const o = (py * image.width + px) * 4;
      const key = (image.data[o] << 16) | (image.data[o + 1] << 8) | image.data[o + 2];
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
  }
  let best = -1;
  let count = 0;
  for (const [key, n] of tally) {
    if (n > count) {
      best = key;
      count = n;
    }
  }
  if (best < 0) return null;
  return { r: ((best >> 16) & 255) / 255, g: ((best >> 8) & 255) / 255, b: (best & 255) / 255, a: 1 };
}

/**
 * APCA lightness contrast (Lc), advisory only (FD17-F23: WCAG 3 has no contrast method yet). Positive for dark text
 * on a light ground, negative for light text on a dark ground.
 * @param {Rgba} fg
 * @param {Rgba} bg
 * @returns {Promise<number | null>}
 */
export async function apcaLc(fg, bg) {
  try {
    const { contrast } = await import('@adobe/leonardo-contrast-colors');
    /** @type {(c: Rgba) => [number, number, number]} */
    const rgb = (c) => [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
    return round(contrast(rgb(fg), rgb(bg), 1, 'wcag3'), 1);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Viewports

/**
 * @param {Viewport} v
 * @returns {boolean}
 */
export function isNarrowViewport(v) {
  return Boolean(v.isMobile) || /^(mobile|reflow|phone)/i.test(v.name) || v.width <= 480;
}

/**
 * Viewports render.overflow checks: the matrix's reflow and mobile viewports, plus 320 CSS px (WCAG 1.4.10) and
 * 375 CSS px (the owner's phone width, FD17-F23) when the matrix lacks them.
 * @param {Viewport[]} viewports
 * @returns {{matrix: Viewport[], extra: Viewport[]}}
 */
export function overflowViewports(viewports) {
  const matrix = viewports.filter(isNarrowViewport);
  /** @type {Viewport[]} */
  const extra = [];
  const mobile = viewports.find((v) => v.isMobile);
  if (!viewports.some((v) => v.width === LIMITS.reflowWidth)) {
    extra.push({ name: `reflow-${LIMITS.reflowWidth}`, width: LIMITS.reflowWidth, height: 640, dpr: 1, isMobile: false, hasTouch: false });
  }
  if (!viewports.some((v) => v.width === LIMITS.phoneWidth)) {
    extra.push({ name: `mobile-${LIMITS.phoneWidth}`, width: LIMITS.phoneWidth, height: 812, dpr: mobile?.dpr ?? 2, isMobile: true, hasTouch: true });
  }
  return { matrix, extra };
}

// ---------------------------------------------------------------------------------------------------------------
// In-page functions. Each runs inside the page through page.evaluate, so it must be self-contained; the ones that
// need selectors receive lib/dom.mjs's selectorFor as their first argument (see inPage()).

/**
 * The expression that calls an in-page function with selectorFor and a JSON argument.
 * @param {Function} fn
 * @param {unknown} [arg]
 * @returns {string}
 */
function inPage(fn, arg) {
  return `(${fn.toString()})(${selectorFor.toString()}, ${JSON.stringify(arg ?? null)})`;
}

/** Init script: a buffered layout-shift observer installed before any page script (FD17-F26). */
export const SHIFT_OBSERVER = `(() => {
  const store = [];
  Object.defineProperty(window, '__feQaShifts', { value: store, configurable: true });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        store.push({ value: entry.value, startTime: entry.startTime, hadRecentInput: entry.hadRecentInput,
          nodes: (entry.sources || []).map((s) => s.node).filter(Boolean) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (err) {
    store.error = String(err);
  }
})();`;

/**
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorFor
 * @returns {{shifts: ShiftEntry[], error: string | null}}
 */
export const readShifts = function readShifts(selectorFor) {
  const counts = new Map();
  const store = /** @type {Array<{value: number, startTime: number, hadRecentInput: boolean, nodes: Node[]}> & {error?: string}} */ (
    Reflect.get(window, '__feQaShifts')
  );
  if (!store) return { shifts: [], error: 'the layout-shift observer was not installed' };
  return {
    shifts: store.map((s) => ({
      value: s.value,
      startTime: s.startTime,
      hadRecentInput: s.hadRecentInput,
      sources: s.nodes.map((n) => (n.nodeType === 1 ? selectorFor(/** @type {Element} */ (n), counts) : n.parentElement ? selectorFor(n.parentElement, counts) : '')).filter(Boolean),
    })),
    error: store.error ?? null,
  };
};

/**
 * Dwells at the top first, where the judge is when late content lands (once the page is scrolled, Chromium's scroll
 * anchoring hides shifts above the viewport), then scrolls through the page one viewport at a time and back to the
 * top (instant scrolling, so smooth-scroll CSS does not slow it), letting lazy images, reveal-on-scroll sections and
 * late fonts arrive (FD06-F10, FD17-F26).
 * @param {unknown} _selectorFor unused
 * @param {{topSettleMs: number, maxSteps: number, stepDelayMs: number, settleMs: number, maxMs: number}} opts
 * @returns {Promise<{steps: number, height: number, complete: boolean}>}
 */
export const scrollPass = async function scrollPass(_selectorFor, opts) {
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))));
  const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const root = document.scrollingElement || document.documentElement;
  await sleep(opts.topSettleMs);
  await frame();
  const started = performance.now();
  const viewport = window.innerHeight;
  let steps = 0;
  let y = 0;
  let complete = false;
  while (steps < opts.maxSteps && performance.now() - started < opts.maxMs) {
    const max = Math.max(0, root.scrollHeight - viewport);
    if (y >= max) {
      complete = true;
      break;
    }
    y = Math.min(max, y + viewport);
    window.scrollTo({ top: y, left: 0, behavior: 'instant' });
    steps += 1;
    await frame();
    await sleep(opts.stepDelayMs);
  }
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  await frame();
  await sleep(opts.settleMs);
  await frame();
  return { steps, height: root.scrollHeight, complete };
};

/**
 * Horizontal overflow of the document: scrollWidth against clientWidth, the layout viewport against the screen
 * width (a mobile page without a viewport meta lays out at 980 px), and the elements sticking out furthest.
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorFor
 * @param {{screenWidth: number}} opts
 * @returns {{scrollWidth: number, clientWidth: number, screenWidth: number, rootOverflowX: string,
 *   offenders: Array<{sel: string, right: number, width: number}>}}
 */
export const measureOverflow = function measureOverflow(selectorFor, opts) {
  const counts = new Map();
  const de = document.documentElement;
  const body = document.body;
  const clientWidth = de.clientWidth;
  const scrollX = window.scrollX;
  /** @type {Array<{el: Element, right: number, width: number}>} */
  const found = [];
  const clipsX = (/** @type {Element} */ el) => {
    const v = getComputedStyle(el).overflowX;
    return v !== 'visible';
  };
  if (body) {
    for (const el of Array.from(body.querySelectorAll('*'))) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      const right = rect.right + scrollX;
      const left = rect.left + scrollX;
      if (right <= clientWidth + 1 && left >= -1) continue;
      let contained = false;
      for (let p = el.parentElement; p && p !== body && p !== de; p = p.parentElement) {
        if (clipsX(p) || getComputedStyle(p).position === 'fixed') {
          contained = true;
          break;
        }
      }
      if (contained || getComputedStyle(el).position === 'fixed') continue;
      found.push({ el, right, width: rect.width });
    }
  }
  const outermost = found.filter((f) => !found.some((g) => g !== f && g.el.contains(f.el) && g.right >= f.right - 1));
  outermost.sort((a, b) => b.right - a.right);
  return {
    scrollWidth: de.scrollWidth,
    clientWidth,
    screenWidth: opts.screenWidth,
    rootOverflowX: body ? getComputedStyle(body).overflowX : 'visible',
    offenders: outermost.slice(0, 8).map((f) => ({ sel: selectorFor(f.el, counts), right: Math.round(f.right), width: Math.round(f.width) })),
  };
};

/**
 * Text cut by a box that clips overflow, and visible text drawn over text of another block (FD17 G5).
 * Cut: a line of text partly inside and partly outside the padding box of an ancestor with overflow hidden or
 * clip, beyond 1 px horizontally, or with less than 75% of its height visible (glyph content areas exceed tight
 * line boxes, so a smaller overhang is not a cut); or a block of text with some lines inside the box and others
 * entirely outside (a paragraph truncated by a fixed height). A block entirely outside (a closed accordion, another
 * carousel slide) is hidden, not cut. line-clamp (vertical) and text-overflow: ellipsis (horizontal) are deliberate.
 * Overlap: line boxes of two different blocks intersecting by at least 2 px and 30% of the smaller line's height,
 * both at least half opaque, outside aria-hidden decoration and clipped-away text, with no opaque layer between them
 * at the intersection (a dialog panel or banner covering text is not text over text).
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorFor
 * @param {{tolerance: number, visibleFraction: number, overlapMinPx: number, overlapMinFraction: number,
 *   minOpacity: number, max: number}} opts
 * @returns {Promise<{cuts: Array<{sel: string, axis: 'x' | 'y', text: string, cutPx: number}>,
 *   overlaps: Array<{a: string, b: string, textA: string, textB: string, px: number}>, clippers: number,
 *   ellipsis: number, clamped: number}>}
 */
export const measureClipping = async function measureClipping(selectorFor, opts) {
  const counts = new Map();
  const body = document.body;
  const de = document.documentElement;
  /** @type {Array<{sel: string, axis: 'x' | 'y', text: string, cutPx: number}>} */
  const cuts = [];
  /** @type {Array<{a: string, b: string, textA: string, textB: string, px: number}>} */
  const overlaps = [];
  if (!body) return { cuts, overlaps, clippers: 0, ellipsis: 0, clamped: 0 };
  /** @typedef {{l: number, t: number, r: number, b: number}} R */
  /** @type {Map<Element, CSSStyleDeclaration>} */
  const styles = new Map();
  const style = (/** @type {Element} */ el) => {
    let s = styles.get(el);
    if (!s) {
      s = getComputedStyle(el);
      styles.set(el, s);
    }
    return s;
  };
  const clipsValue = (/** @type {string} */ v) => v === 'hidden' || v === 'clip';
  /** @type {(a: R, b: R) => R} */
  const meet = (a, b) => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
  const area = (/** @type {R} */ a) => Math.max(0, a.r - a.l) * Math.max(0, a.b - a.t);
  const EVERYWHERE = { l: -Infinity, t: -Infinity, r: Infinity, b: Infinity };
  /** @type {Map<Element, R | null>} */
  const ownCache = new Map();
  /** @param {Element} el @returns {R | null} */
  const ownClip = (el) => {
    if (ownCache.has(el)) return /** @type {R | null} */ (ownCache.get(el));
    let result = null;
    if (el !== body && el !== de) {
      const cs = style(el);
      const box = el.getBoundingClientRect();
      const x = clipsValue(cs.overflowX) && cs.display !== 'inline';
      const y = clipsValue(cs.overflowY) && cs.display !== 'inline';
      /** @type {R} */
      let rect = EVERYWHERE;
      if (x || y) {
        const l = box.left + el.clientLeft;
        const t = box.top + el.clientTop;
        rect = { l: x ? l : -Infinity, t: y ? t : -Infinity, r: x ? l + el.clientWidth : Infinity, b: y ? t + el.clientHeight : Infinity };
      }
      if ((cs.position === 'absolute' || cs.position === 'fixed') && /^rect\(/.test(cs.clip)) {
        const v = cs.clip.slice(5, -1).split(/[\s,]+/).map((p) => (p === 'auto' ? null : Number.parseFloat(p)));
        const [top, right, bottom, left] = v;
        rect = meet(rect, {
          l: box.left + (left ?? 0),
          t: box.top + (top ?? 0),
          r: right === null || right === undefined ? Infinity : box.left + right,
          b: bottom === null || bottom === undefined ? Infinity : box.top + bottom,
        });
      }
      if (/^inset\(\s*50%/.test(cs.clipPath)) rect = { l: 0, t: 0, r: 0, b: 0 };
      if (rect !== EVERYWHERE) result = rect;
    }
    ownCache.set(el, result);
    return result;
  };
  /** @type {Map<Element, R>} */
  const chainCache = new Map();
  /** @param {Element | null} el @returns {R} visible region left by el and all its ancestors */
  const chainClip = (el) => {
    if (!el || el === de) return EVERYWHERE;
    const hit = chainCache.get(el);
    if (hit) return hit;
    const own = ownClip(el);
    const parent = chainClip(el.parentElement);
    const value = own ? meet(parent, own) : parent;
    chainCache.set(el, value);
    return value;
  };
  /** @param {Element} from @param {Element} stop @returns {R} clips of from..stop (stop excluded) */
  const innerClip = (from, stop) => {
    /** @type {R} */
    let value = EVERYWHERE;
    for (let el = /** @type {Element | null} */ (from); el && el !== stop; el = el.parentElement) {
      const own = ownClip(el);
      if (own) value = meet(value, own);
    }
    return value;
  };
  const visible = (/** @type {Element} */ el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
  /** @type {Map<Element, number>} */
  const opacityCache = new Map();
  /** @param {Element | null} el @returns {number} */
  const opacityOf = (el) => {
    if (!el) return 1;
    const hit = opacityCache.get(el);
    if (hit !== undefined) return hit;
    const own = Number.parseFloat(style(el).opacity);
    const value = (Number.isFinite(own) ? own : 1) * opacityOf(el.parentElement);
    opacityCache.set(el, value);
    return value;
  };
  const skipText = 'script, style, noscript, template, title, head, select, option, textarea';
  /** @param {Element} root @returns {Text[]} */
  const textNodes = (root) => {
    /** @type {Text[]} */
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (!parent || !/\S/.test(n.nodeValue || '') || parent.closest(skipText)) continue;
      out.push(/** @type {Text} */ (n));
    }
    return out;
  };
  const range = document.createRange();
  /** @param {Text} node @returns {R[]} */
  const lineRects = (node) => {
    range.selectNodeContents(node);
    return Array.from(range.getClientRects()).filter((r) => r.width >= 1 && r.height >= 1).map((r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom }));
  };
  const snippet = (/** @type {Node} */ n) => (n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  let clippers = 0;
  let ellipsis = 0;
  let clamped = 0;
  for (const el of Array.from(body.querySelectorAll('*'))) {
    if (cuts.length >= opts.max) break;
    const cs = style(el);
    const clipX = clipsValue(cs.overflowX);
    const clipY = clipsValue(cs.overflowY);
    if ((!clipX && !clipY) || cs.display === 'inline' || cs.display === 'contents') continue;
    if (el.clientWidth < 2 || el.clientHeight < 2 || !visible(el)) continue;
    const overX = clipX && el.scrollWidth > el.clientWidth + opts.tolerance;
    const overY = clipY && el.scrollHeight > el.clientHeight + opts.tolerance;
    if (!overX && !overY) continue;
    const clampValue = cs.getPropertyValue('-webkit-line-clamp') || cs.getPropertyValue('line-clamp');
    const isClamped = clampValue !== '' && clampValue !== 'none';
    const isEllipsis = cs.textOverflow === 'ellipsis';
    const box = /** @type {R} */ (ownClip(el));
    const border = el.getBoundingClientRect();
    if (area(meet(chainClip(el.parentElement), { l: border.left, t: border.top, r: border.right, b: border.bottom })) < 1) continue;
    clippers += 1;
    if (isClamped) clamped += 1;
    if (isEllipsis) ellipsis += 1;
    const checkX = overX && !isEllipsis;
    const checkY = overY && !isClamped;
    if (!checkX && !checkY) continue;
    /**
     * Each line against the box on the clipped axes: 'in' (whole, or with less than 25% of a tight line's glyph
     * area overhanging), 'cut' (partly visible) or 'out' (entirely outside).
     * @param {R} r @returns {{state: 'in' | 'cut' | 'out', axis: 'x' | 'y', beyond: number}}
     */
    const place = (r) => {
      if (checkX) {
        const shown = Math.min(r.r, box.r) - Math.max(r.l, box.l);
        const beyond = Math.max(r.r - box.r, box.l - r.l);
        if (shown <= 0) return { state: 'out', axis: 'x', beyond };
        if (beyond > opts.tolerance) return { state: 'cut', axis: 'x', beyond };
      }
      if (checkY) {
        const shown = Math.min(r.b, box.b) - Math.max(r.t, box.t);
        const beyond = Math.max(r.b - box.b, box.t - r.t);
        if (shown <= 0) return { state: 'out', axis: 'y', beyond };
        if (beyond > opts.tolerance && shown / (r.b - r.t) < opts.visibleFraction) return { state: 'cut', axis: 'y', beyond };
      }
      return { state: 'in', axis: 'x', beyond: 0 };
    };
    /** @type {Map<Element, {seen: boolean, hidden: {axis: 'x' | 'y', beyond: number, node: Text} | null}>} */
    const blocks = new Map();
    /** @type {{sel: string, axis: 'x' | 'y', text: string, cutPx: number} | null} */
    let first = null;
    for (const node of textNodes(el)) {
      const parent = /** @type {Element} */ (node.parentElement);
      if (!visible(parent)) continue;
      let owner = parent;
      while (owner !== el && owner.parentElement && (style(owner).display === 'inline' || style(owner).display === 'contents')) owner = owner.parentElement;
      const block = blocks.get(owner) ?? { seen: false, hidden: null };
      blocks.set(owner, block);
      const inner = innerClip(parent, el);
      for (const raw of lineRects(node)) {
        const r = meet(raw, inner);
        if (r.r - r.l < 1 || r.b - r.t < 1) continue;
        const where = place(r);
        if (where.state === 'cut') {
          first = { sel: selectorFor(el, counts), axis: where.axis, text: snippet(node), cutPx: Math.round(where.beyond) };
          break;
        }
        if (where.state === 'in') block.seen = true;
        else if (!block.hidden) block.hidden = { axis: where.axis, beyond: where.beyond, node };
        if (block.seen && block.hidden) {
          first = { sel: selectorFor(el, counts), axis: block.hidden.axis, text: snippet(block.hidden.node), cutPx: Math.round(block.hidden.beyond) };
          break;
        }
      }
      if (first) break;
    }
    if (first) cuts.push(first);
  }

  /** @type {Array<{node: Text, owner: Element, rect: R}>} */
  const lines = [];
  for (const node of textNodes(body)) {
    const parent = /** @type {Element} */ (node.parentElement);
    if (!visible(parent) || parent.closest('[aria-hidden="true"]') || opacityOf(parent) < opts.minOpacity) continue;
    let owner = parent;
    while (owner.parentElement && owner !== body && (style(owner).display === 'inline' || style(owner).display === 'contents')) owner = owner.parentElement;
    const region = chainClip(parent);
    for (const raw of lineRects(node)) {
      const r = meet(raw, region);
      if (area(r) < 0.5 * area(raw) || r.r - r.l < 1 || r.b - r.t < 1) continue;
      lines.push({ node, owner, rect: { l: r.l + window.scrollX, t: r.t + window.scrollY, r: r.r + window.scrollX, b: r.b + window.scrollY } });
    }
  }
  lines.sort((a, b) => a.rect.t - b.rect.t);
  /** @type {Array<{a: typeof lines[number], b: typeof lines[number], cx: number, cy: number, px: number}>} */
  const candidates = [];
  /** @type {Map<Element, number>} */
  const ownerIds = new Map();
  const idOf = (/** @type {Element} */ el) => {
    let id = ownerIds.get(el);
    if (id === undefined) {
      id = ownerIds.size;
      ownerIds.set(el, id);
    }
    return id;
  };
  const pairs = new Set();
  for (let i = 0; i < lines.length && candidates.length < opts.max * 2; i += 1) {
    const a = lines[i];
    for (let j = i + 1; j < lines.length && lines[j].rect.t < a.rect.b; j += 1) {
      const b = lines[j];
      if (a.owner === b.owner) continue;
      const w = Math.min(a.rect.r, b.rect.r) - Math.max(a.rect.l, b.rect.l);
      const h = Math.min(a.rect.b, b.rect.b) - Math.max(a.rect.t, b.rect.t);
      const minHeight = Math.min(a.rect.b - a.rect.t, b.rect.b - b.rect.t);
      if (w < opts.overlapMinPx || h < Math.max(opts.overlapMinPx, opts.overlapMinFraction * minHeight)) continue;
      const pair = [idOf(a.owner), idOf(b.owner)].sort((x, y) => x - y).join('|');
      if (pairs.has(pair)) continue;
      pairs.add(pair);
      candidates.push({ a, b, cx: Math.max(a.rect.l, b.rect.l) + w / 2, cy: Math.max(a.rect.t, b.rect.t) + h / 2, px: Math.round(Math.min(w, h)) });
    }
  }
  const startX = window.scrollX;
  const startY = window.scrollY;
  /** Alpha of a computed colour: rgb()/named colours are opaque, 'transparent' is not, else the value after '/' or the 4th comma value. */
  const alphaOf = (/** @type {string} */ color) => {
    if (!color || color === 'transparent') return 0;
    const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(color);
    if (slash) return slash[2] === '%' ? Number(slash[1]) / 100 : Number(slash[1]);
    const legacy = /^rgba\(\s*[^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/.exec(color);
    return legacy ? Number(legacy[1]) : 1;
  };
  const opaque = (/** @type {Element} */ el) => {
    const cs = style(el);
    return (Boolean(cs.backgroundImage) && cs.backgroundImage !== 'none') || alphaOf(cs.backgroundColor) >= 0.9;
  };
  for (const c of candidates) {
    if (overlaps.length >= opts.max) break;
    window.scrollTo({ top: Math.max(0, c.cy - window.innerHeight / 2), left: Math.max(0, c.cx - window.innerWidth / 2), behavior: 'instant' });
    const stack = document.elementsFromPoint(c.cx - window.scrollX, c.cy - window.scrollY);
    const ia = stack.findIndex((el) => el.contains(c.a.node));
    const ib = stack.findIndex((el) => el.contains(c.b.node));
    let covered = false;
    if (ia !== -1 && ib !== -1) {
      const upper = Math.min(ia, ib);
      const lowerIndex = Math.max(ia, ib);
      const lower = ia > ib ? c.a.node : c.b.node;
      for (let k = upper; k < lowerIndex && !covered; k += 1) {
        if (!stack[k].contains(lower) && opaque(stack[k])) covered = true;
      }
    }
    if (!covered) {
      overlaps.push({
        a: selectorFor(c.a.owner, counts),
        b: selectorFor(c.b.owner, counts),
        textA: snippet(c.a.node),
        textB: snippet(c.b.node),
        px: c.px,
      });
    }
  }
  window.scrollTo({ top: startY, left: startX, behavior: 'instant' });
  return { cuts, overlaps, clippers, ellipsis, clamped };
};

/**
 * Font faces and the family names the page's own CSS declares: font-family values of readable style rules (nested
 * ones, and those inside media, supports, layer and import rules), font-ish custom properties, inline styles and
 * the families of font-face rules.
 * `opaque` counts stylesheets whose rules cannot be read (cross-origin).
 * @returns {{faces: Array<{family: string, status: string, weight: string, style: string}>, names: string[],
 *   opaque: number}}
 */
export const fontInventory = function fontInventory() {
  /** @type {Set<string>} */
  const names = new Set();
  let opaque = 0;
  const add = (/** @type {string} */ value) => {
    if (!value) return;
    let current = '';
    /** @type {string | null} */
    let quote = null;
    for (const ch of value + ',') {
      if (quote) {
        if (ch === quote) quote = null;
        else current += ch;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ',') {
        const name = current.trim().replace(/\s+/g, ' ');
        if (name && !/^var\(/i.test(name)) names.add(name);
        current = '';
      } else {
        current += ch;
      }
    }
  };
  /** @type {Set<CSSStyleSheet>} */
  const visited = new Set();
  /** @param {CSSRuleList} rules */
  const visitRules = (rules) => {
    for (const rule of Array.from(rules)) {
      const anyRule = /** @type {CSSRule & {style?: CSSStyleDeclaration, cssRules?: CSSRuleList, styleSheet?: CSSStyleSheet | null}} */ (rule);
      if (anyRule.style) {
        add(anyRule.style.getPropertyValue('font-family'));
        for (let i = 0; i < anyRule.style.length; i += 1) {
          const prop = anyRule.style[i];
          if (prop.startsWith('--') && /font|family|typeface/i.test(prop)) add(anyRule.style.getPropertyValue(prop));
        }
      }
      if (anyRule.cssRules) visitRules(anyRule.cssRules);
      if (anyRule.styleSheet) visitSheet(anyRule.styleSheet);
    }
  };
  /** @param {CSSStyleSheet} sheet */
  const visitSheet = (sheet) => {
    if (visited.has(sheet)) return;
    visited.add(sheet);
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      opaque += 1;
      return;
    }
    visitRules(rules);
  };
  for (const sheet of Array.from(document.styleSheets)) visitSheet(sheet);
  for (const sheet of Array.from(document.adoptedStyleSheets || [])) visitSheet(sheet);
  for (const el of Array.from(document.querySelectorAll('[style]'))) {
    const s = /** @type {HTMLElement} */ (el).style;
    if (s) add(s.getPropertyValue('font-family'));
  }
  const faces = Array.from(document.fonts).map((f) => ({ family: f.family.replace(/^["']|["']$/g, ''), status: f.status, weight: f.weight, style: f.style }));
  for (const face of faces) names.add(face.family);
  return { faces, names: [...names], opaque };
};

/**
 * Picks the texts render.fonts checks (headings, buttons, body text; visible, with letters or digits), at most a few
 * per distinct (category, font stack, weight, style), visible ones and longer ones first, and parks their text nodes
 * in window.__feQaFontTargets for the CDP queries.
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorFor
 * @param {{heading: number, button: number, body: number, perSignature: number}} opts
 * @returns {Array<{category: string, sel: string, tag: string, text: string, family: string, weight: string,
 *   style: string}>}
 */
export const pickFontSamples = function pickFontSamples(selectorFor, opts) {
  const counts = new Map();
  const letters = /[\p{L}\p{N}]/u;
  const vh = window.innerHeight;
  /** @type {Array<{node: Text, parent: Element, category: 'heading' | 'button' | 'body', family: string, weight: string, style: string, inView: boolean, length: number}>} */
  const all = [];
  const root = document.body;
  if (root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const value = n.nodeValue || '';
      if (!letters.test(value)) continue;
      const parent = n.parentElement;
      if (!parent || parent.closest('script, style, noscript, template, title, head, select, option, textarea')) continue;
      if (!parent.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) continue;
      range.selectNodeContents(n);
      const rect = range.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      const category = parent.closest('h1, h2, h3, h4, h5, h6, [role="heading"]')
        ? 'heading'
        : parent.closest('button, [role="button"], summary')
          ? 'button'
          : 'body';
      const cs = getComputedStyle(parent);
      all.push({ node: /** @type {Text} */ (n), parent, category, family: cs.fontFamily, weight: cs.fontWeight, style: cs.fontStyle, inView: rect.top < vh && rect.bottom > 0, length: value.trim().length });
    }
  }
  all.sort((a, b) => Number(b.inView) - Number(a.inView) || b.length - a.length);
  /** @type {Map<string, number>} */
  const perSignature = new Map();
  /** @type {Record<string, number>} */
  const perCategory = { heading: 0, button: 0, body: 0 };
  /** @type {typeof all} */
  const chosen = [];
  for (const item of all) {
    const limit = item.category === 'heading' ? opts.heading : item.category === 'button' ? opts.button : opts.body;
    if (perCategory[item.category] >= limit) continue;
    const signature = `${item.category}|${item.family}|${item.weight}|${item.style}`;
    const seen = perSignature.get(signature) ?? 0;
    if (seen >= opts.perSignature) continue;
    perSignature.set(signature, seen + 1);
    perCategory[item.category] += 1;
    chosen.push(item);
  }
  Reflect.set(window, '__feQaFontTargets', chosen.map((c) => c.node));
  return chosen.map((c) => ({
    category: c.category,
    sel: selectorFor(c.parent, counts),
    tag: c.parent.localName,
    text: (c.node.nodeValue || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    family: c.family,
    weight: c.weight,
    style: c.style,
  }));
};

/**
 * Mounts one invisible probe span per font-family value, outside <body>, and parks the spans' text nodes in
 * window.__feQaFontProbes. Returns, per value, whether the browser accepted it.
 * @param {unknown} _selectorFor unused
 * @param {string[]} families
 * @returns {boolean[]}
 */
export const mountFontProbes = function mountFontProbes(_selectorFor, families) {
  document.getElementById('__fe_qa_font_probes')?.remove();
  const box = document.createElement('div');
  box.id = '__fe_qa_font_probes';
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;white-space:nowrap;font-size:16px;font-weight:400;font-style:normal;';
  /** @type {Text[]} */
  const nodes = [];
  /** @type {boolean[]} */
  const accepted = [];
  for (const family of families) {
    const span = document.createElement('span');
    span.style.fontFamily = family;
    accepted.push(span.style.fontFamily !== '');
    const text = document.createTextNode('Hamburgefonstiv 0123456789');
    span.append(text);
    box.append(span);
    nodes.push(text);
  }
  document.documentElement.append(box);
  Reflect.set(window, '__feQaFontProbes', nodes);
  return accepted;
};

/** Removes the probes and the parked node lists. */
export const unmountFontProbes = function unmountFontProbes() {
  document.getElementById('__fe_qa_font_probes')?.remove();
  Reflect.deleteProperty(window, '__feQaFontProbes');
};

/** Drops the parked text nodes of pickFontSamples. */
export const releaseFontTargets = function releaseFontTargets() {
  Reflect.deleteProperty(window, '__feQaFontTargets');
};

/**
 * Every rendered <img> (not under display:none, visibility:hidden or a skipped content-visibility subtree): its
 * selector, URL, completeness and natural width, and for the complete-but-empty ones whether decode() succeeds (a
 * broken or undecodable file rejects; an SVG without intrinsic size decodes).
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorFor
 * @returns {Promise<Array<{sel: string, src: string, hasSource: boolean, complete: boolean, naturalWidth: number,
 *   lazy: boolean, decode: string | null}>>}
 */
export const inspectImages = async function inspectImages(selectorFor) {
  const counts = new Map();
  const out = [];
  for (const img of Array.from(document.images)) {
    if (!img.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) continue;
    const picture = img.parentElement && img.parentElement.localName === 'picture' ? img.parentElement : null;
    const hasSource = (img.hasAttribute('src') && img.getAttribute('src') !== '') || img.hasAttribute('srcset') || Boolean(picture && picture.querySelector('source[srcset]'));
    /** @type {string | null} */
    let decode = null;
    if (img.complete && img.naturalWidth === 0) {
      decode = await Promise.race([
        img.decode().then(() => 'ok', (err) => (err && err.name ? String(err.name) : 'error')),
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 2000)),
      ]).then((v) => String(v));
    }
    out.push({
      sel: selectorFor(img, counts),
      src: img.currentSrc || img.src || '',
      hasSource,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      lazy: img.loading === 'lazy',
      decode,
    });
  }
  return out;
};

/**
 * Marks a text element for the contrast screenshots (and the ancestors that paint its glyphs with
 * background-clip: text) and describes how its glyphs are painted.
 * @param {Element} el
 * @param {string} nonce
 * @returns {{fill: string, opacity: number, gradient: boolean, blended: boolean, fontSize: number,
 *   fontWeight: string}}
 */
export const markContrastSubject = function markContrastSubject(el, nonce) {
  el.setAttribute('data-fe-qa-contrast', nonce);
  let gradient = false;
  let blended = false;
  let opacity = 1;
  for (let node = /** @type {Element | null} */ (el); node && node !== document.documentElement; node = node.parentElement) {
    const cs = getComputedStyle(node);
    const clipText = cs.backgroundClip === 'text' || cs.getPropertyValue('-webkit-background-clip') === 'text';
    if (clipText && cs.backgroundImage !== 'none') {
      node.setAttribute('data-fe-qa-contrast-clip', nonce);
      gradient = true;
    }
    if (cs.mixBlendMode !== 'normal' || cs.filter !== 'none') blended = true;
    const own = Number.parseFloat(cs.opacity);
    if (Number.isFinite(own)) opacity *= own;
  }
  const cs = getComputedStyle(el);
  return {
    fill: cs.getPropertyValue('-webkit-text-fill-color') || cs.color,
    opacity,
    gradient,
    blended,
    fontSize: Number.parseFloat(cs.fontSize) || 16,
    fontWeight: cs.fontWeight,
  };
};

/**
 * Removes the marks markContrastSubject set in the element's document.
 * @param {Element} el
 * @param {string} nonce
 */
export const clearContrastMarks = function clearContrastMarks(el, nonce) {
  for (const node of Array.from(el.ownerDocument.querySelectorAll(`[data-fe-qa-contrast="${nonce}"], [data-fe-qa-contrast-clip="${nonce}"]`))) {
    node.removeAttribute('data-fe-qa-contrast');
    node.removeAttribute('data-fe-qa-contrast-clip');
  }
};

/**
 * Visible, enabled text-entry controls (WCAG 1.4.11 applies to their boundary) with their paint, and up to three
 * tight wrappers that may draw the boundary instead (an input inside a bordered field group).
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorFor
 * @param {{max: number}} opts
 * @returns {Array<{sel: string, paint: BoxPaint, wrappers: Array<{sel: string, paint: BoxPaint}>}>}
 */
export const listTextControls = function listTextControls(selectorFor, opts) {
  const counts = new Map();
  const textTypes = ['text', 'email', 'search', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'week', 'time'];
  /** @param {Element} el @returns {BoxPaint} */
  const paintOf = (el) => {
    const cs = getComputedStyle(el);
    const side = (/** @type {string} */ s) => ({
      width: Number.parseFloat(cs.getPropertyValue(`border-${s}-width`)) || 0,
      style: cs.getPropertyValue(`border-${s}-style`),
      color: cs.getPropertyValue(`border-${s}-color`),
    });
    const outlineWidth = Number.parseFloat(cs.outlineWidth) || 0;
    return {
      fill: cs.backgroundColor,
      borders: ['top', 'right', 'bottom', 'left'].map(side),
      shadows: cs.boxShadow,
      outline: outlineWidth >= 1 && cs.outlineStyle !== 'none' ? { width: outlineWidth, style: cs.outlineStyle, color: cs.outlineColor } : null,
    };
  };
  const out = [];
  for (const el of Array.from(document.querySelectorAll('input, textarea, select'))) {
    if (out.length >= opts.max) break;
    const input = /** @type {HTMLInputElement} */ (el);
    if (el.localName === 'input' && !textTypes.includes((input.type || 'text').toLowerCase())) continue;
    if (/** @type {HTMLInputElement} */ (el).disabled) continue;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    const wrappers = [];
    for (let p = el.parentElement, depth = 0; p && depth < 3 && p !== document.body && p !== document.documentElement; p = p.parentElement, depth += 1) {
      const r = p.getBoundingClientRect();
      const tight = rect.left - r.left <= 40 && r.right - rect.right <= 40 && rect.top - r.top <= 40 && r.bottom - rect.bottom <= 40;
      if (!tight) break;
      wrappers.push({ sel: selectorFor(p, counts), paint: paintOf(p) });
    }
    out.push({ sel: selectorFor(el, counts), paint: paintOf(el), wrappers });
  }
  return out;
};

// ---------------------------------------------------------------------------------------------------------------
// Page measurement

/**
 * @typedef {{type: string, text: string, url: string, line: number, party: 'first' | 'third'}} ConsoleIssue
 * @typedef {{message: string, url: string, party: 'first' | 'third'}} PageErrorIssue
 * @typedef {{url: string, method: string, resourceType: string, errorText?: string, status?: number,
 *   party: 'first' | 'third'}} RequestIssue
 * @typedef {{phase: 'load' | 'scrolled', scrollWidth: number, clientWidth: number, screenWidth: number,
 *   rootOverflowX: string, offenders: Array<{sel: string, right: number, width: number}>}} OverflowMeasure
 * @typedef {Awaited<ReturnType<typeof measureClipping>>} ClippingMeasure
 * @typedef {{sel: string, category: string, tag: string, text: string, family: string, ok: boolean,
 *   measured: boolean, reason: string, rendered: string, intended: string | null, custom: boolean}} FontNode
 * @typedef {{faces: Array<{family: string, status: string, weight: string, style: string}>, nodes: FontNode[],
 *   note: string | null}} FontMeasure
 * @typedef {{sel: string, src: string, problem: string}} ImageProblem
 * @typedef {{checked: number, broken: ImageProblem[], deferred: number}} ImageMeasure
 * @typedef {ShiftScore & {error: string | null}} ClsMeasure
 * @typedef {{rule: string, impact: string, help: string, selector: string, target: unknown[], html: string,
 *   summary: string, message: string, data: Record<string, unknown> | null, party: 'first' | 'third'}} AxeItem
 * @typedef {{violations: AxeItem[], incomplete: AxeItem[]}} AxeMeasure
 * @typedef {{selector: string, ratio: number, required: number, mode: string, why: string, min: number,
 *   median: number, samples: number, apca: number | null, fg: string, bg: string, reason: string,
 *   party: 'first' | 'third'}} ContrastResolved
 * @typedef {{selector: string, why: string, party: 'first' | 'third'}} ContrastUnresolved
 * @typedef {{selector: string, ratio: number, by: string, via: string | null}} BoundaryResult
 * @typedef {{resolved: ContrastResolved[], unresolved: ContrastUnresolved[], boundaries: BoundaryResult[]}} ContrastMeasure
 * @typedef {{route: string, viewport: string, url: string, kind: 'full' | 'overflow', screenWidth: number,
 *   narrow: boolean, loadError: string | null, errors: Record<string, string>, consoleErrors: ConsoleIssue[], networkConsole: number,
 *   pageErrors: PageErrorIssue[], failedRequests: RequestIssue[], badResponses: RequestIssue[], aborted: number,
 *   imageRequests: Map<string, 'pending' | 'done' | 'failed'>, overflow: OverflowMeasure[] | null,
 *   clipping: ClippingMeasure | null, fonts: FontMeasure | null, images: ImageMeasure | null,
 *   cls: ClsMeasure | null, axe: AxeMeasure | null, contrast: ContrastMeasure | null}} PageRecord
 * @typedef {{route: Route, view: Viewport, kind: 'full' | 'overflow'}} PagePlan
 * @typedef {{console: boolean, requests: boolean, fonts: boolean, images: boolean, overflow: boolean,
 *   clipping: boolean, cls: boolean, axe: boolean, contrast: boolean, targets: boolean}} Needs
 */

/**
 * @param {string[]} ids
 * @returns {Needs}
 */
function needsOf(ids) {
  const has = (/** @type {string} */ id) => ids.includes(id);
  return {
    console: has('render.console'),
    requests: has('render.requests'),
    fonts: has('render.fonts'),
    images: has('render.images'),
    overflow: has('render.overflow'),
    clipping: has('render.clipping'),
    cls: has('render.cls'),
    axe: has('a11y.axe') || has('a11y.contrast') || has('a11y.targets'),
    contrast: has('a11y.contrast'),
    targets: has('a11y.targets'),
  };
}

/**
 * The page loads a run needs: every route at every matrix viewport for the full measurement, plus overflow-only
 * loads at the extra overflow widths (or at the narrow viewports alone when render.overflow is the only gate).
 * @param {Route[]} routes
 * @param {Viewport[]} viewports
 * @param {string[]} ids
 * @returns {PagePlan[]}
 */
export function planPages(routes, viewports, ids) {
  const full = ids.some((id) => id !== 'render.overflow');
  const wantsOverflow = ids.includes('render.overflow');
  const { matrix, extra } = overflowViewports(viewports);
  /** @type {PagePlan[]} */
  const plan = [];
  for (const route of routes) {
    if (full) for (const view of viewports) plan.push({ route, view, kind: 'full' });
    if (wantsOverflow) {
      if (!full) for (const view of matrix) plan.push({ route, view, kind: 'overflow' });
      for (const view of extra) plan.push({ route, view, kind: 'overflow' });
    }
  }
  return plan;
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} what
 * @returns {Promise<T>}
 */
function deadline(promise, ms, what) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const expire = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms);
  });
  return /** @type {Promise<T>} */ (Promise.race([promise, expire])).finally(() => clearTimeout(timer));
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {PagePlan} plan
 * @param {string} url
 * @param {boolean} narrow whether render.overflow is measured on this load
 * @returns {PageRecord}
 */
function newRecord(plan, url, narrow) {
  return {
    route: plan.route.path,
    viewport: plan.view.name,
    url,
    kind: plan.kind,
    screenWidth: plan.view.width,
    narrow,
    loadError: null,
    errors: {},
    consoleErrors: [],
    networkConsole: 0,
    pageErrors: [],
    failedRequests: [],
    badResponses: [],
    aborted: 0,
    imageRequests: new Map(),
    overflow: null,
    clipping: null,
    fonts: null,
    images: null,
    cls: null,
    axe: null,
    contrast: null,
  };
}

/**
 * Listeners that must see the load itself: console, uncaught errors, failed requests, HTTP errors, image requests.
 * @param {Page} page
 * @param {PageRecord} rec
 * @param {string} baseUrl
 */
function listen(page, rec, baseUrl) {
  page.on('console', (msg) => {
    const type = msg.type();
    if (type !== 'error' && type !== 'assert') return;
    const text = msg.text();
    if (/^Failed to load resource\b/.test(text)) {
      rec.networkConsole += 1;
      return;
    }
    const location = msg.location();
    const url = location.url || rec.url;
    rec.consoleErrors.push({ type, text: clip(text, 300), url, line: (location.lineNumber ?? 0) + 1, party: partyOf(url, baseUrl) });
  });
  page.on('pageerror', (err) => {
    const stackUrl = /\b(https?:\/\/[^\s)]+?)(?::\d+){0,2}\)?$/m.exec(err.stack ?? '')?.[1] ?? rec.url;
    rec.pageErrors.push({ message: clip(`${err.name}: ${err.message}`, 300), url: stackUrl, party: partyOf(stackUrl, baseUrl) });
  });
  page.on('request', (request) => {
    if (request.resourceType() === 'image') rec.imageRequests.set(request.url(), 'pending');
  });
  page.on('requestfinished', (request) => {
    if (request.resourceType() === 'image') rec.imageRequests.set(request.url(), 'done');
  });
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText ?? 'failed';
    if (request.resourceType() === 'image') rec.imageRequests.set(request.url(), 'failed');
    if (/ERR_ABORTED/.test(errorText)) {
      rec.aborted += 1;
      return;
    }
    rec.failedRequests.push({ url: request.url(), method: request.method(), resourceType: request.resourceType(), errorText, party: partyOf(request.url(), baseUrl) });
  });
  page.on('response', (response) => {
    const status = response.status();
    if (status < 400) return;
    const request = response.request();
    rec.badResponses.push({ url: response.url(), method: request.method(), resourceType: request.resourceType(), status, party: partyOf(response.url(), baseUrl) });
  });
}

/**
 * Loads one route at one viewport and measures what the selected gates need. Environment errors (the target is
 * unreachable) propagate; a page that never becomes ready is recorded as `loadError`; a measurement that fails is
 * recorded per gate in `errors` and never passes.
 * @param {CheckContext} ctx
 * @param {PagePlan} plan
 * @param {Needs} needs
 * @param {{families: string[], shipped: string[], note: string | null}} tokens
 * @returns {Promise<PageRecord>}
 */
async function measurePage(ctx, plan, needs, tokens) {
  const baseUrl = /** @type {string} */ (ctx.baseUrl);
  const browser = /** @type {Browser} */ (ctx.browser);
  const url = routeUrl(baseUrl, plan.route, ctx.profile);
  const overflowOnly = plan.kind === 'overflow';
  const narrow = overflowOnly || (needs.overflow && isNarrowViewport(plan.view));
  const rec = newRecord(plan, url, narrow);
  const timeoutMs = typeof ctx.args?.timeoutMs === 'number' ? ctx.args.timeoutMs : 15000;
  /** @type {(ids: string[], what: string, fn: () => Promise<void>) => Promise<void>} */
  const step = async (ids, what, fn) => {
    try {
      await deadline(fn(), TUNING.stepDeadlineMs, what);
    } catch (err) {
      if (err instanceof EnvError) throw err;
      const message = `${what} failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`;
      for (const id of ids) rec.errors[id] = rec.errors[id] ?? message;
    }
  };
  const started = Date.now();
  try {
    await withPage(browser, plan.view, url, async (page) => {
      if (narrow) {
        rec.overflow = [];
        await step(['render.overflow'], 'overflow at load', async () => {
          const m = /** @type {Omit<OverflowMeasure, 'phase'>} */ (await page.evaluate(inPage(measureOverflow, { screenWidth: plan.view.width })));
          /** @type {OverflowMeasure[]} */ (rec.overflow).push({ phase: 'load', ...m });
        });
      }
      const scrolled = ['render.images', 'render.cls', ...(narrow ? ['render.overflow'] : [])];
      await step(scrolled, 'scripted scroll', async () => {
        await page.evaluate(inPage(scrollPass, TUNING.scroll));
        await settleImages(page, rec);
      });
      if (needs.cls && !overflowOnly) {
        await step(['render.cls'], 'layout shift read', async () => {
          const read = /** @type {{shifts: ShiftEntry[], error: string | null}} */ (await page.evaluate(inPage(readShifts)));
          rec.cls = { ...layoutShiftScore(read.shifts, { keepFlagged: true }), error: read.error };
          if (read.error) throw new Error(read.error);
        });
      }
      if (narrow) {
        await step(['render.overflow'], 'overflow after scrolling', async () => {
          const m = /** @type {Omit<OverflowMeasure, 'phase'>} */ (await page.evaluate(inPage(measureOverflow, { screenWidth: plan.view.width })));
          /** @type {OverflowMeasure[]} */ (rec.overflow).push({ phase: 'scrolled', ...m });
        });
      }
      if (overflowOnly) return;
      if (needs.clipping) {
        await step(['render.clipping'], 'clipping scan', async () => {
          rec.clipping = /** @type {ClippingMeasure} */ (await page.evaluate(inPage(measureClipping, {
            tolerance: TUNING.clipTolerancePx,
            visibleFraction: TUNING.cutVisibleFraction,
            overlapMinPx: TUNING.overlapMinPx,
            overlapMinFraction: TUNING.overlapMinFraction,
            minOpacity: TUNING.overlapMinOpacity,
            max: TUNING.evidenceMax,
          })));
        });
      }
      if (needs.fonts) await step(['render.fonts'], 'font check', async () => { rec.fonts = await measureFonts(page, tokens); });
      if (needs.images) await step(['render.images'], 'image check', async () => { rec.images = await measureImages(page, rec); });
      if (needs.axe) {
        const a11yIds = ['a11y.axe', 'a11y.contrast', 'a11y.targets'];
        await step(a11yIds, 'axe-core run', async () => { rec.axe = await runAxe(page, baseUrl); });
        if (needs.contrast && rec.axe) {
          await step(['a11y.contrast'], 'contrast resolution', async () => {
            rec.contrast = await resolveContrast(page, /** @type {AxeMeasure} */ (rec.axe), plan.view);
          });
        }
      }
    }, {
      readyFlag: ctx.profile.ready_flag,
      timeoutMs,
      beforeGoto: async (page) => {
        if (!overflowOnly) listen(page, rec, baseUrl);
        if (needs.cls && !overflowOnly) await page.addInitScript(SHIFT_OBSERVER);
      },
    });
  } catch (err) {
    if (err instanceof CheckError) rec.loadError = err.message;
    else throw err;
  }
  ctx.log(`qa: ${plan.route.path} at ${plan.view.name} (${plan.view.width}x${plan.view.height}${overflowOnly ? ', overflow only' : ''}): ${((Date.now() - started) / 1000).toFixed(1)} s${rec.loadError ? ', not ready' : ''}`);
  return rec;
}

/**
 * Waits until no image request is in flight (lazy images the scroll pass triggered), then for fonts.
 * @param {Page} page
 * @param {PageRecord} rec
 */
async function settleImages(page, rec) {
  const until = Date.now() + TUNING.imageWaitMs;
  while (Date.now() < until && [...rec.imageRequests.values()].includes('pending')) await sleep(50);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/**
 * @param {Page} page
 * @param {PageRecord} rec
 * @returns {Promise<ImageMeasure>}
 */
async function measureImages(page, rec) {
  const images = /** @type {Awaited<ReturnType<typeof inspectImages>>} */ (await page.evaluate(inPage(inspectImages)));
  /** @type {ImageProblem[]} */
  const broken = [];
  let deferred = 0;
  for (const img of images) {
    if (img.complete && img.naturalWidth === 0) {
      const failed = rec.failedRequests.find((r) => r.url === img.src);
      const bad = rec.badResponses.find((r) => r.url === img.src);
      let problem = '';
      if (!img.hasSource) problem = 'no src or srcset';
      else if (failed) problem = `request failed (${failed.errorText})`;
      else if (rec.imageRequests.get(img.src) === 'failed') problem = 'request failed';
      else if (bad) problem = `HTTP ${bad.status}`;
      else if (img.decode && img.decode !== 'ok') problem = `cannot be decoded (${img.decode})`;
      if (problem) broken.push({ sel: img.sel, src: img.src, problem });
    } else if (!img.complete) {
      const state = rec.imageRequests.get(img.src);
      if (state === 'pending') broken.push({ sel: img.sel, src: img.src, problem: `still loading ${TUNING.imageWaitMs / 1000} s after the scroll pass` });
      else if (state === undefined) deferred += 1;
    }
  }
  return { checked: images.length, broken, deferred };
}

/**
 * @param {CDPSession} cdp
 * @param {string} globalName
 * @param {number} count
 * @returns {Promise<Array<PlatformFont[] | null>>}
 */
async function queryTextFonts(cdp, globalName, count) {
  /** @type {Array<PlatformFont[] | null>} */
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const { result } = await cdp.send('Runtime.evaluate', { expression: `window.${globalName}[${i}]` });
    if (!result.objectId) {
      out.push(null);
      continue;
    }
    try {
      const { nodeId } = await cdp.send('DOM.requestNode', { objectId: result.objectId });
      if (!nodeId) {
        out.push(null);
        continue;
      }
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      out.push(fonts.map((f) => ({ familyName: f.familyName, postScriptName: f.postScriptName ?? '', isCustomFont: f.isCustomFont, glyphCount: f.glyphCount })));
    } finally {
      await cdp.send('Runtime.releaseObject', { objectId: result.objectId }).catch(() => undefined);
    }
  }
  return out;
}

/**
 * Renders probe spans for a list of font-family values and returns each one's platform fonts.
 * @param {Page} page
 * @param {CDPSession} cdp
 * @param {string[]} families
 * @returns {Promise<Array<PlatformFont[] | null>>}
 */
async function probeFamilies(page, cdp, families) {
  const accepted = /** @type {boolean[]} */ (await page.evaluate(inPage(mountFontProbes, families)));
  try {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))));
    });
    const fonts = await queryTextFonts(cdp, '__feQaFontProbes', families.length);
    return fonts.map((f, i) => (accepted[i] ? f : null));
  } finally {
    await page.evaluate(inPage(unmountFontProbes));
  }
}

/**
 * Resolves, stack position by stack position, the platform font each needed family renders with: a probe span with
 * `<family>, <sentinel A>` and one with `<family>, <sentinel B>` (two generics that render differently here) render
 * the same font only when the family itself is available. Later entries are probed only when the earlier ones are
 * unavailable and allowed to be skipped, so a face the page never reaches is never loaded by the check.
 * @param {Page} page
 * @param {CDPSession} cdp
 * @param {string[][]} stacks
 * @param {FontDeclarations} decl
 * @returns {Promise<Map<string, ResolvedFont | null>>}
 */
async function resolveFamilies(page, cdp, stacks, decl) {
  const generics = ['monospace', 'serif', 'sans-serif', 'cursive', 'fantasy'];
  const alone = await probeFamilies(page, cdp, generics);
  /** @type {[string, string] | null} */
  let sentinels = null;
  for (let i = 0; i < generics.length && !sentinels; i += 1) {
    for (let j = i + 1; j < generics.length && !sentinels; j += 1) {
      const a = dominantFont(alone[i]);
      const b = dominantFont(alone[j]);
      if (a && b && !sameFont(a, b)) sentinels = [generics[i], generics[j]];
    }
  }
  if (!sentinels) throw new Error('every generic family renders the same font here, so family availability cannot be told apart');
  /** @type {Map<string, ResolvedFont | null>} */
  const resolutions = new Map();
  for (let round = 0; round < TUNING.fontProbeRounds; round += 1) {
    /** @type {Map<string, string>} */
    const need = new Map();
    for (const stack of stacks) {
      for (const entry of stack) {
        const key = familyKey(entry);
        if (resolutions.has(key)) {
          if (resolutions.get(key) || mustRender(entryKind(key, decl))) break;
          continue;
        }
        if (!need.has(key)) need.set(key, familyCss(entry));
        break;
      }
    }
    if (need.size === 0) break;
    const values = [...need.values()].flatMap((css) => [`${css}, ${sentinels[0]}`, `${css}, ${sentinels[1]}`]);
    const fonts = await probeFamilies(page, cdp, values);
    let k = 0;
    for (const key of need.keys()) {
      const a = dominantFont(fonts[k]);
      const b = dominantFont(fonts[k + 1]);
      k += 2;
      resolutions.set(key, a && b && sameFont(a, b) ? { familyName: a.familyName, postScriptName: a.postScriptName, isCustomFont: a.isCustomFont } : null);
    }
  }
  return resolutions;
}

/**
 * render.fonts on one page: FontFace statuses (read before any probe can trigger a load), then the rendered fonts
 * of sampled texts through CDP CSS.getPlatformFontsForNode, judged against their stacks.
 * @param {Page} page
 * @param {{families: string[], shipped: string[], note: string | null}} tokens
 * @returns {Promise<FontMeasure>}
 */
async function measureFonts(page, tokens) {
  const inventory = /** @type {ReturnType<typeof fontInventory>} */ (await page.evaluate(fontInventory));
  const decl = buildDeclarations(inventory, tokens);
  const samples = /** @type {ReturnType<typeof pickFontSamples>} */ (await page.evaluate(inPage(pickFontSamples, TUNING.fontSamples)));
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    await cdp.send('DOM.getDocument', { depth: 0 });
    const rendered = await queryTextFonts(cdp, '__feQaFontTargets', samples.length);
    const stacks = samples.map((s) => parseFontFamilyList(s.family));
    const resolutions = await resolveFamilies(page, cdp, stacks, decl);
    const nodes = samples.map((s, i) => {
      const verdict = judgeTextFont({ stack: stacks[i], tag: s.tag, category: s.category }, rendered[i], resolutions, decl);
      return {
        sel: s.sel,
        category: s.category,
        tag: s.tag,
        text: s.text,
        family: s.family,
        ok: verdict.ok,
        measured: verdict.measured,
        reason: verdict.reason,
        rendered: verdict.rendered?.familyName ?? '',
        custom: verdict.rendered?.isCustomFont ?? false,
        intended: verdict.intended.entry,
      };
    });
    return { faces: inventory.faces, nodes, note: tokens.note };
  } finally {
    await page.evaluate(releaseFontTargets).catch(() => undefined);
    await cdp.detach().catch(() => undefined);
  }
}

/**
 * Runs axe-core with the FE-18 tag set. `options()` replaces the whole options object, so it comes before
 * `withTags()`, which would otherwise be dropped (/harden FE-18).
 * @param {Page} page
 * @param {string} baseUrl
 * @returns {Promise<AxeMeasure>}
 */
async function runAxe(page, baseUrl) {
  const results = await new AxeBuilder({ page })
    .options({ resultTypes: ['violations', 'incomplete'] })
    .withTags([...AXE_TAGS])
    .analyze();
  /** @type {Map<string, 'first' | 'third'>} */
  const frameParty = new Map();
  /** @param {import('axe-core').Result} rule @returns {Promise<AxeItem[]>} */
  const flatten = async (rule) => {
    /** @type {AxeItem[]} */
    const items = [];
    for (const node of rule.nodes) {
      const target = /** @type {unknown[]} */ (node.target);
      let party = /** @type {'first' | 'third'} */ ('first');
      if (target.length > 1) {
        const frameSel = String(Array.isArray(target[0]) ? target[0].join(' ') : target[0]);
        if (!frameParty.has(frameSel)) {
          const src = await page.locator(frameSel).first().getAttribute('src', { timeout: 1000 }).catch(() => null);
          frameParty.set(frameSel, src ? partyOf(new URL(src, page.url()).href, baseUrl) : 'first');
        }
        party = /** @type {'first' | 'third'} */ (frameParty.get(frameSel));
      }
      const check = node.any[0] ?? node.all[0] ?? node.none[0];
      items.push({
        rule: rule.id,
        impact: String(node.impact ?? rule.impact ?? ''),
        help: rule.help,
        selector: target.map((t) => (Array.isArray(t) ? t.join(' >>> ') : String(t))).join(' | '),
        target,
        html: clip(node.html, 160),
        summary: clip(node.failureSummary ?? '', 240),
        message: clip(check?.message ?? '', 240),
        data: check && check.data && typeof check.data === 'object' ? /** @type {Record<string, unknown>} */ (check.data) : null,
        party,
      });
    }
    return items;
  };
  /** @type {AxeItem[]} */
  const violations = [];
  /** @type {AxeItem[]} */
  const incomplete = [];
  for (const rule of results.violations) violations.push(...await flatten(rule));
  for (const rule of results.incomplete) incomplete.push(...await flatten(rule));
  return { violations, incomplete };
}

/**
 * A locator for an axe target: frame selectors first, shadow chains joined (Playwright's CSS pierces open shadow
 * roots).
 * @param {Page} page
 * @param {unknown[]} target
 * @returns {Locator | null}
 */
function locatorFor(page, target) {
  if (!Array.isArray(target) || target.length === 0) return null;
  const css = (/** @type {unknown} */ part) => (Array.isArray(part) ? part.map(String).join(' ') : String(part));
  /** @type {import('playwright-core').FrameLocator | null} */
  let frame = null;
  for (const part of target.slice(0, -1)) frame = frame ? frame.frameLocator(css(part)) : page.frameLocator(css(part));
  const last = css(target[target.length - 1]);
  return (frame ? frame.locator(last) : page.locator(last)).first();
}

/**
 * The CSS that repaints a marked text for one of the contrast screenshots, applied through the screenshot's `style`
 * option so nothing stays behind: `transparent` hides the glyphs (the background behind them shows), a solid colour
 * paints them flat (the coverage probes). Ancestors that paint the glyphs with background-clip: text lose that
 * background either way.
 * @param {string} nonce
 * @param {string} paint 'transparent', '#000' or '#fff'
 * @returns {string}
 */
function textPaintStyle(nonce, paint) {
  return [
    `[data-fe-qa-contrast="${nonce}"] { color: ${paint} !important; -webkit-text-fill-color: ${paint} !important;`,
    ' text-shadow: none !important; text-decoration-color: transparent !important; -webkit-text-stroke-color: transparent !important;',
    ' caret-color: transparent !important; transition: none !important; }',
    `[data-fe-qa-contrast-clip="${nonce}"] { background-image: none !important; background-color: transparent !important; transition: none !important; }`,
  ].join('');
}

/**
 * The part of `box` inside the viewport, rounded outward to whole CSS pixels, or null.
 * @param {{x: number, y: number, width: number, height: number} | null} box
 * @param {{width: number, height: number}} view
 * @param {number} [pad]
 * @returns {{x: number, y: number, width: number, height: number} | null}
 */
function viewportClip(box, view, pad = 0) {
  if (!box) return null;
  const x0 = Math.max(0, Math.floor(box.x - pad));
  const y0 = Math.max(0, Math.floor(box.y - pad));
  const x1 = Math.min(view.width, Math.ceil(box.x + box.width + pad));
  const y1 = Math.min(view.height, Math.ceil(box.y + box.height + pad));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * a11y.contrast on one page: every axe color-contrast "incomplete" measured from two screenshots (FD17-F24), and
 * the boundary of every visible text input (WCAG 1.4.11).
 * @param {Page} page
 * @param {AxeMeasure} axe
 * @param {Viewport} view
 * @returns {Promise<ContrastMeasure>}
 */
async function resolveContrast(page, axe, view) {
  /** @type {ContrastResolved[]} */
  const resolved = [];
  /** @type {ContrastUnresolved[]} */
  const unresolved = [];
  const items = axe.incomplete.filter((i) => i.rule === 'color-contrast');
  for (const [k, item] of items.entries()) {
    if (k >= TUNING.contrastItemsMax) {
      unresolved.push({ selector: item.selector, why: `not measured: more than ${TUNING.contrastItemsMax} incomplete items on one page`, party: item.party });
      continue;
    }
    const outcome = await measureTextContrast(page, item, view, `c${k}`);
    if ('ratio' in outcome) resolved.push({ ...outcome, party: item.party });
    else unresolved.push({ ...outcome, party: item.party });
  }
  const boundaries = await measureBoundaries(page, view);
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  return { resolved, unresolved, boundaries };
}

/**
 * @param {Page} page
 * @param {AxeItem} item
 * @param {Viewport} view
 * @param {string} nonce
 * @returns {Promise<Omit<ContrastResolved, 'party'> | Omit<ContrastUnresolved, 'party'>>}
 */
async function measureTextContrast(page, item, view, nonce) {
  const locator = locatorFor(page, item.target);
  if (!locator) return { selector: item.selector, why: 'axe gave no usable target' };
  /** @type {Awaited<ReturnType<typeof markContrastSubject>>} */
  let subject;
  try {
    subject = await locator.evaluate(markContrastSubject, nonce, { timeout: 2000 });
  } catch (err) {
    return { selector: item.selector, why: `element not found (${err instanceof Error ? err.message.split('\n')[0] : String(err)})` };
  }
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
    const clipRect = viewportClip(await locator.boundingBox({ timeout: 2000 }).catch(() => null), view);
    if (!clipRect) return { selector: item.selector, why: 'the element is not on screen' };
    const options = /** @type {const} */ ({ clip: clipRect, animations: 'disabled', caret: 'hide', type: 'png' });
    const shot = async (/** @type {string | undefined} */ paint) => decodePng(await page.screenshot(paint ? { ...options, style: textPaintStyle(nonce, paint) } : options));
    const shown = await shot(undefined);
    const hidden = await shot('transparent');
    const fill = parseColor(subject.fill);
    /** @type {'css' | 'coverage' | 'core'} */
    let mode = 'css';
    if (subject.blended) mode = 'core';
    else if (subject.gradient || !fill || fill.a * subject.opacity === 0) mode = 'coverage';
    let stats;
    if (mode === 'coverage') stats = coverageContrast(shown, hidden, await shot('#000'), await shot('#fff'));
    else if (mode === 'core') stats = pixelContrast(shown, hidden, { mode: 'core' });
    else stats = pixelContrast(shown, hidden, { mode: 'css', fg: fill ? { ...fill, a: fill.a * subject.opacity } : null });
    if (!stats) return { selector: item.selector, why: 'the text painted no pixel that differs from its background (covered, invisible, or the same colour)' };
    const graphic = item.data?.messageKey === 'nonBmp';
    const required = requiredRatio({ fontSizePx: subject.fontSize, fontWeight: subject.fontWeight, graphic });
    return {
      selector: item.selector,
      ratio: round(stats.worst),
      required,
      mode,
      why: String(item.data?.messageKey ?? ''),
      min: round(stats.min),
      median: round(stats.median),
      samples: stats.samples,
      apca: await apcaLc(stats.fg, stats.bg),
      fg: toHex(stats.fg),
      bg: toHex(stats.bg),
      reason: stats.worst >= required ? '' : `${round(stats.worst)}:1 at worst behind the glyphs, needs ${required}:1`,
    };
  } finally {
    await locator.evaluate(clearContrastMarks, nonce, { timeout: 2000 }).catch(() => undefined);
  }
}

/**
 * @param {Page} page
 * @param {Viewport} view
 * @returns {Promise<BoundaryResult[]>}
 */
async function measureBoundaries(page, view) {
  const controls = /** @type {ReturnType<typeof listTextControls>} */ (await page.evaluate(inPage(listTextControls, { max: TUNING.boundaryControlsMax })));
  /** @type {BoundaryResult[]} */
  const out = [];
  const dpr = view.dpr ?? 1;
  /** @param {string} sel @param {BoxPaint} paint */
  const judge = async (sel, paint) => {
    const locator = page.locator(sel).first();
    await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
    const box = await locator.boundingBox({ timeout: 2000 }).catch(() => null);
    const clipRect = viewportClip(box, view, 4);
    if (!box || !clipRect) return null;
    const image = decodePng(await page.screenshot({ clip: clipRect, animations: 'disabled', caret: 'hide', type: 'png' }));
    return boundaryContrast(paint, surroundingColor(image, clipRect, box, dpr));
  };
  for (const control of controls) {
    const own = await judge(control.sel, control.paint);
    if (!own) continue;
    if (own.best >= LIMITS.nonText) {
      out.push({ selector: control.sel, ratio: round(own.best), by: own.by, via: null });
      continue;
    }
    /** @type {BoundaryResult} */
    let result = { selector: control.sel, ratio: round(own.best), by: own.by, via: null };
    for (const wrapper of control.wrappers) {
      const viaWrapper = await judge(wrapper.sel, wrapper.paint);
      if (viaWrapper && viaWrapper.best >= LIMITS.nonText) {
        result = { selector: control.sel, ratio: round(viaWrapper.best), by: viaWrapper.by, via: wrapper.sel };
        break;
      }
    }
    out.push(result);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Gate verdicts (pure: page records in, GateResult out)

/**
 * @param {Evidence[]} list
 * @returns {Evidence[]}
 */
function capEvidence(list) {
  if (list.length <= TUNING.evidenceMax) return list;
  return [...list.slice(0, TUNING.evidenceMax), { detail: `${list.length - TUNING.evidenceMax} more not listed` }];
}

/**
 * @param {PageRecord} p
 * @returns {Evidence}
 */
function at(p) {
  return { route: p.route, viewport: p.viewport };
}

/**
 * @param {number} n
 * @param {string} one
 * @param {string} [many]
 * @returns {string}
 */
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many ?? `${one}s`}`;
}

/**
 * Builds a verdict from per-page findings. A page that never became ready fails the gate, since nothing could be
 * judged on it (`listened` gates, fed by listeners attached before the load, still report what they saw). A
 * measurement error with no failure elsewhere makes the gate skipped, never ok.
 * @param {GateMeta} meta
 * @param {PageRecord[]} pages
 * @param {(p: PageRecord) => {issues: Evidence[], measured: number}} judge
 * @param {{ok: (measured: number) => string, fail: (issues: Evidence[], failedPages: number, pages: number) => string,
 *   listened?: boolean, info?: () => Evidence[]}} words
 * @returns {GateResult}
 */
function verdict(meta, pages, judge, words) {
  const b = gate(meta);
  if (pages.length === 0) return b.skip('no route and viewport to measure (check routes.json and the profile viewports)');
  /** @type {Evidence[]} */
  const issues = [];
  /** @type {Evidence[]} */
  const errors = [];
  let measured = 0;
  const failedPages = new Set();
  for (const p of pages) {
    if (p.loadError) {
      issues.push({ ...at(p), value: 'not-ready', detail: clip(p.loadError, 300) });
      failedPages.add(p);
      if (!words.listened) continue;
    }
    const error = p.errors[meta.id];
    if (error) {
      errors.push({ ...at(p), value: 'not-measured', detail: clip(error, 300) });
      continue;
    }
    const r = judge(p);
    measured += r.measured;
    if (r.issues.length > 0) failedPages.add(p);
    issues.push(...r.issues);
  }
  if (issues.length > 0) {
    const tail = errors.length > 0 ? `; ${plural(errors.length, 'page load')} could not be measured` : '';
    return b.fail(`${words.fail(issues, failedPages.size, pages.length)}${tail}`, capEvidence([...issues, ...errors]));
  }
  if (errors.length > 0) {
    return b.skip(`could not measure ${errors.length} of ${plural(pages.length, 'page load')}: ${errors[0].detail}${where(errors[0])}`);
  }
  return b.ok(words.ok(measured), capEvidence(words.info ? words.info() : []));
}

/**
 * @param {Evidence} first
 * @returns {string}
 */
function where(first) {
  return first.route ? ` (${first.route} at ${first.viewport})` : '';
}

/**
 * @param {PageRecord[]} pages
 * @param {Profile} profile
 * @returns {GateResult}
 */
export function judgeConsole(pages, profile) {
  const meta = /** @type {GateMeta} */ (GATES[0]);
  let network = 0;
  let thirdParty = 0;
  return verdict(meta, pages.filter((p) => p.kind === 'full'), (p) => {
    network += p.networkConsole;
    /** @type {Evidence[]} */
    const issues = [];
    for (const e of p.pageErrors) {
      if (!counts(e.party, profile)) {
        thirdParty += 1;
        continue;
      }
      issues.push({ ...at(p), value: 'pageerror', detail: e.message, file: e.url });
    }
    for (const c of p.consoleErrors) {
      if (!counts(c.party, profile)) {
        thirdParty += 1;
        continue;
      }
      issues.push({ ...at(p), value: `console.${c.type}`, detail: c.text, file: c.url, line: c.line });
    }
    return { issues, measured: 1 };
  }, {
    listened: true,
    ok: (measured) => `0 uncaught exceptions and 0 console errors on ${plural(measured, 'page load')}` +
      `${network ? `; ${plural(network, 'network error')} left to render.requests` : ''}${thirdParty ? `; ${thirdParty} third-party (external requests allowed)` : ''}`,
    fail: (issues, failed, total) => `${plural(issues.length, 'console error or uncaught exception', 'console errors or uncaught exceptions')} on ${failed} of ${plural(total, 'page load')}; first: ${issues[0].detail}${where(issues[0])}`,
  });
}

/**
 * @param {PageRecord[]} pages
 * @param {Profile} profile
 * @returns {GateResult}
 */
export function judgeRequests(pages, profile) {
  const meta = /** @type {GateMeta} */ (GATES[1]);
  let aborted = 0;
  return verdict(meta, pages.filter((p) => p.kind === 'full'), (p) => {
    aborted += p.aborted;
    /** @type {Evidence[]} */
    const issues = [];
    const seen = new Set();
    for (const r of [...p.failedRequests, ...p.badResponses]) {
      if (!counts(r.party, profile)) continue;
      const value = r.status ? `HTTP ${r.status}` : String(r.errorText);
      const key = `${r.url} ${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({ ...at(p), value, detail: `${r.method} ${r.url} (${r.resourceType}${r.party === 'third' ? ', third party' : ''})`, url: r.url });
    }
    return { issues, measured: 1 };
  }, {
    listened: true,
    ok: (measured) => `0 failed requests and 0 responses with status 400 or above on ${plural(measured, 'page load')}${aborted ? `; ${plural(aborted, 'cancelled request')} (net::ERR_ABORTED) ignored` : ''}`,
    fail: (issues, failed, total) => `${plural(issues.length, 'failed or 4xx/5xx request')} on ${failed} of ${plural(total, 'page load')}; first: ${issues[0].value} ${issues[0].detail}${where(issues[0])}`,
  });
}

/**
 * @param {PageRecord[]} pages
 * @returns {GateResult}
 */
export function judgeFonts(pages) {
  const meta = /** @type {GateMeta} */ (GATES[2]);
  /** @type {Map<string, number>} */
  const families = new Map();
  /** @type {string[]} */
  const notes = [];
  return verdict(meta, pages.filter((p) => p.kind === 'full'), (p) => {
    const m = /** @type {FontMeasure} */ (p.fonts);
    if (!m) return { issues: [], measured: 0 };
    if (m.note && !notes.includes(m.note)) notes.push(m.note);
    /** @type {Evidence[]} */
    const issues = [];
    for (const face of m.faces) {
      if (face.status === 'error') issues.push({ ...at(p), value: 'font-face-error', detail: `@font-face "${face.family}" (weight ${face.weight}, ${face.style}) failed to load`, family: face.family });
    }
    const seen = new Set();
    let measured = 0;
    for (const n of m.nodes) {
      if (!n.measured) continue;
      measured += 1;
      if (n.ok) {
        families.set(n.rendered, (families.get(n.rendered) ?? 0) + 1);
        continue;
      }
      const key = `${n.family}|${n.reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({ ...at(p), selector: n.sel, value: n.rendered, detail: `${n.category} "${n.text}": ${n.reason}`, stack: n.family });
    }
    return { issues, measured };
  }, {
    ok: (measured) => {
      const used = [...families.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} ${n}`).join(', ');
      return `${plural(measured, 'text')} (headings, body, buttons) render in their declared families${used ? `: ${used}` : ''}${notes.length ? `; ${notes[0]}` : ''}`;
    },
    fail: (issues, failed, total) => `${plural(issues.length, 'font problem')} on ${failed} of ${plural(total, 'page load')}; first: ${issues[0].detail}${where(issues[0])}`,
  });
}

/**
 * @param {PageRecord[]} pages
 * @returns {GateResult}
 */
export function judgeImages(pages) {
  const meta = /** @type {GateMeta} */ (GATES[3]);
  let checked = 0;
  let deferred = 0;
  return verdict(meta, pages.filter((p) => p.kind === 'full'), (p) => {
    const m = /** @type {ImageMeasure} */ (p.images);
    if (!m) return { issues: [], measured: 0 };
    checked += m.checked;
    deferred += m.deferred;
    return { issues: m.broken.map((b) => ({ ...at(p), selector: b.sel, value: b.problem, url: b.src })), measured: 1 };
  }, {
    ok: (measured) => `${plural(checked, 'rendered image')} loaded and decoded on ${plural(measured, 'page load')}${deferred ? `; ${deferred} lazy image(s) never requested` : ''}`,
    fail: (issues, failed, total) => `${plural(issues.length, 'broken image')} on ${failed} of ${plural(total, 'page load')}; first: ${issues[0].selector} ${issues[0].value}${where(issues[0])}`,
  });
}

/**
 * @param {PageRecord[]} pages
 * @returns {GateResult}
 */
export function judgeOverflow(pages) {
  const meta = /** @type {GateMeta} */ (GATES[4]);
  const widths = new Set();
  return verdict(meta, pages.filter((p) => p.narrow), (p) => {
    const list = p.overflow ?? [];
    widths.add(p.screenWidth);
    /** @type {Evidence[]} */
    const issues = [];
    for (const m of list) {
      if (m.clientWidth > m.screenWidth + 1) {
        issues.push({ ...at(p), value: `${m.clientWidth}px layout`, detail: `the page lays out ${m.clientWidth} px wide on a ${m.screenWidth} px screen (${m.phase}): add <meta name="viewport" content="width=device-width, initial-scale=1">` });
        break;
      }
      if (m.scrollWidth > m.clientWidth) {
        const who = m.offenders.length ? `; widest: ${m.offenders.slice(0, 3).map((o) => `${o.sel} to ${o.right}px`).join(', ')}` : '';
        const hidden = m.rootOverflowX !== 'visible' ? ` (body overflow-x: ${m.rootOverflowX} hides the scrollbar, the content is still cut)` : '';
        issues.push({ ...at(p), value: `${m.scrollWidth}px > ${m.clientWidth}px`, detail: `scrollWidth ${m.scrollWidth} px exceeds ${m.clientWidth} px (${m.phase})${hidden}${who}`, selector: m.offenders[0]?.sel ?? '' });
        break;
      }
    }
    return { issues, measured: list.length > 0 ? 1 : 0 };
  }, {
    ok: () => `no horizontal scroll at ${[...widths].sort((a, b) => a - b).join(', ')} CSS px, at load and after scrolling`,
    fail: (issues, failed, total) => `horizontal overflow on ${failed} of ${plural(total, 'page load')}; first: ${issues[0].detail}${where(issues[0])}`,
  });
}

/**
 * @param {PageRecord[]} pages
 * @returns {GateResult}
 */
export function judgeClipping(pages) {
  const meta = /** @type {GateMeta} */ (GATES[5]);
  let clippers = 0;
  let deliberate = 0;
  return verdict(meta, pages.filter((p) => p.kind === 'full'), (p) => {
    const m = p.clipping;
    if (!m) return { issues: [], measured: 0 };
    clippers += m.clippers;
    deliberate += m.ellipsis + m.clamped;
    /** @type {Evidence[]} */
    const issues = [
      ...m.cuts.map((c) => ({ ...at(p), selector: c.sel, value: `cut ${c.axis} ${c.cutPx}px`, detail: `"${c.text}" is cut by ${c.sel} (${c.axis === 'x' ? 'horizontally' : 'vertically'}, ${c.cutPx} px beyond its box)` })),
      ...m.overlaps.map((o) => ({ ...at(p), selector: o.a, value: `overlap ${o.px}px`, detail: `"${o.textA}" (${o.a}) and "${o.textB}" (${o.b}) are drawn over each other` })),
    ];
    return { issues, measured: 1 };
  }, {
    ok: (measured) => `no text cut by overflow and no text over other text on ${plural(measured, 'page load')} (${plural(clippers, 'overflowing clip box', 'overflowing clip boxes')} checked${deliberate ? `, ${deliberate} deliberate ellipsis or line-clamp` : ''})`,
    fail: (issues, failed, total) => `${plural(issues.length, 'clipped or overlapping text', 'clipped or overlapping texts')} on ${failed} of ${plural(total, 'page load')}; first: ${issues[0].detail}${where(issues[0])}`,
  });
}

/**
 * @param {PageRecord[]} pages
 * @returns {GateResult}
 */
export function judgeCls(pages) {
  const meta = /** @type {GateMeta} */ (GATES[6]);
  let worst = 0;
  /** @type {Evidence[]} */
  const info = [];
  return verdict(meta, pages.filter((p) => p.kind === 'full'), (p) => {
    const m = p.cls;
    if (!m) return { issues: [], measured: 0 };
    worst = Math.max(worst, m.cls);
    const sources = [...new Set(m.worst.entries.flatMap((e) => e.sources ?? []))].slice(0, 5);
    const evidence = { ...at(p), value: round(m.cls, 3), detail: `largest session window ${round(m.cls, 3)} (${m.worst.entries.length} shifts from ${Math.round(m.worst.start)} ms), total of all shifts ${round(m.sum, 3)}${m.flagged ? ` (${m.flagged} flagged hadRecentInput by the viewport emulation, counted: the run sends no input)` : ''}${sources.length ? `; moved: ${sources.join(', ')}` : ''}`, selector: sources[0] ?? '' };
    if (m.cls > LIMITS.cls + 1e-9) return { issues: [evidence], measured: 1 };
    if (m.cls > 0) info.push(evidence);
    return { issues: [], measured: 1 };
  }, {
    ok: (measured) => `worst layout shift ${round(worst, 3)} (limit ${LIMITS.cls}) over load and a scripted scroll on ${plural(measured, 'page load')}`,
    fail: (issues, failed, total) => `layout shift above ${LIMITS.cls} on ${failed} of ${plural(total, 'page load')}; first: ${issues[0].detail}${where(issues[0])}`,
    info: () => info,
  });
}

const OWN_RULES = new Set(['color-contrast', 'target-size']);

/**
 * @param {PageRecord[]} pages
 * @param {Profile} profile
 * @returns {GateResult}
 */
export function judgeAxe(pages, profile) {
  const meta = /** @type {GateMeta} */ (GATES[7]);
  /** @type {Evidence[]} */
  const review = [];
  return verdict(meta, pages.filter((p) => p.kind === 'full'), (p) => {
    const m = p.axe;
    if (!m) return { issues: [], measured: 0 };
    const issues = m.violations
      .filter((v) => !OWN_RULES.has(v.rule) && counts(v.party, profile))
      .map((v) => ({ ...at(p), selector: v.selector, value: v.rule, detail: `${v.rule} (${v.impact}): ${v.help}; ${v.summary || v.message}`, html: v.html }));
    for (const v of m.incomplete) {
      if (OWN_RULES.has(v.rule) || !counts(v.party, profile)) continue;
      review.push({ ...at(p), selector: v.selector, value: `incomplete ${v.rule}`, detail: `needs review: ${v.help}; ${v.message}` });
    }
    return { issues, measured: 1 };
  }, {
    ok: (measured) => `0 violations of the ${AXE_TAGS.join(', ')} rules on ${plural(measured, 'page load')} (color-contrast and target-size are judged by a11y.contrast and a11y.targets); ${plural(review.length, 'incomplete item')} listed for review; no automatically detectable issue is not a claim of conformance`,
    fail: (issues, failed, total) => `${plural(issues.length, 'axe violation')} on ${failed} of ${plural(total, 'page load')}; first: ${issues[0].detail}${where(issues[0])}`,
    info: () => review,
  });
}

/**
 * @param {PageRecord[]} pages
 * @param {Profile} profile
 * @returns {GateResult}
 */
export function judgeContrast(pages, profile) {
  const meta = /** @type {GateMeta} */ (GATES[8]);
  let resolvedCount = 0;
  let boundaryCount = 0;
  /** @type {Evidence[]} */
  const info = [];
  return verdict(meta, pages.filter((p) => p.kind === 'full'), (p) => {
    const m = p.contrast;
    const axe = p.axe;
    if (!m || !axe) return { issues: [], measured: 0 };
    /** @type {Evidence[]} */
    const issues = [];
    for (const v of axe.violations) {
      if (v.rule !== 'color-contrast' || !counts(v.party, profile)) continue;
      const d = v.data ?? {};
      issues.push({ ...at(p), selector: v.selector, value: `${d.contrastRatio ?? '?'}:1`, detail: `text ${d.fgColor ?? '?'} on ${d.bgColor ?? '?'} is ${d.contrastRatio ?? '?'}:1, needs ${d.expectedContrastRatio ?? '4.5:1'} (axe)` });
    }
    for (const r of m.resolved) {
      if (!counts(r.party ?? 'first', profile)) continue;
      resolvedCount += 1;
      const evidence = { ...at(p), selector: r.selector, value: `${r.ratio}:1`, detail: `${r.reason || `resolved ${r.ratio}:1 >= ${r.required}:1`} (axe: ${r.why || 'incomplete'}; ${r.mode} mode, min ${r.min}, median ${r.median}, ${r.samples} glyph pixels; text ${r.fg} on ${r.bg}; APCA Lc ${r.apca ?? 'n/a'}, advisory)`, required: r.required };
      if (r.ratio < r.required) issues.push(evidence);
      else info.push(evidence);
    }
    for (const u of m.unresolved) {
      if (counts(u.party ?? 'first', profile)) issues.push({ ...at(p), selector: u.selector, value: 'unverified', detail: `axe could not decide this text and its pixels could not be measured: ${u.why}` });
    }
    for (const b of m.boundaries) {
      boundaryCount += 1;
      if (b.ratio < LIMITS.nonText) issues.push({ ...at(p), selector: b.selector, value: `${b.ratio}:1`, detail: `text input boundary is ${b.ratio}:1 against its surroundings (best: ${b.by}), needs ${LIMITS.nonText}:1 (WCAG 1.4.11)` });
    }
    return { issues, measured: 1 };
  }, {
    ok: (measured) => `0 axe contrast violations, ${plural(resolvedCount, 'incomplete text')} resolved from pixels at 4.5:1 (3:1 large) or better, ${plural(boundaryCount, 'text input')} with a 3:1 boundary, on ${plural(measured, 'page load')}`,
    fail: (issues, failed, total) => `${plural(issues.length, 'contrast failure')} on ${failed} of ${plural(total, 'page load')}; first: ${issues[0].detail}${where(issues[0])}`,
    info: () => info,
  });
}

/**
 * @param {PageRecord[]} pages
 * @param {Profile} profile
 * @returns {GateResult}
 */
export function judgeTargets(pages, profile) {
  const meta = /** @type {GateMeta} */ (GATES[9]);
  /** @type {Evidence[]} */
  const review = [];
  return verdict(meta, pages.filter((p) => p.kind === 'full'), (p) => {
    const m = p.axe;
    if (!m) return { issues: [], measured: 0 };
    const issues = m.violations
      .filter((v) => v.rule === 'target-size' && counts(v.party, profile))
      .map((v) => ({ ...at(p), selector: v.selector, value: 'target-size', detail: v.message || v.summary }));
    for (const v of m.incomplete) {
      if (v.rule === 'target-size' && counts(v.party, profile)) review.push({ ...at(p), selector: v.selector, value: 'incomplete target-size', detail: `needs review: ${v.message}` });
    }
    return { issues, measured: 1 };
  }, {
    ok: (measured) => `0 axe target-size violations (24 CSS px or spaced, WCAG 2.5.8) on ${plural(measured, 'page load')}; ${plural(review.length, 'incomplete item')} listed for review`,
    fail: (issues, failed, total) => `${plural(issues.length, 'target')} under 24 CSS px without spacing on ${failed} of ${plural(total, 'page load')}; first: ${issues[0].selector} ${issues[0].detail}${where(issues[0])}`,
    info: () => review,
  });
}

/**
 * The verdict of one gate from the page records.
 * @param {string} id
 * @param {PageRecord[]} pages
 * @param {Profile} profile
 * @returns {GateResult}
 */
export function judgeGate(id, pages, profile) {
  switch (id) {
    case 'render.console': return judgeConsole(pages, profile);
    case 'render.requests': return judgeRequests(pages, profile);
    case 'render.fonts': return judgeFonts(pages);
    case 'render.images': return judgeImages(pages);
    case 'render.overflow': return judgeOverflow(pages);
    case 'render.clipping': return judgeClipping(pages);
    case 'render.cls': return judgeCls(pages);
    case 'a11y.axe': return judgeAxe(pages, profile);
    case 'a11y.contrast': return judgeContrast(pages, profile);
    case 'a11y.targets': return judgeTargets(pages, profile);
    default: throw new TypeError(`judgeGate: ${id} is not a gate of qa.mjs`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Module entry point (CONTRACTS section 4)

/**
 * Runs the selected render and a11y gates on every route at every viewport of `ctx` and returns their results in
 * report order. Without a target URL or a browser the gates are skipped (never ok). An unreachable target throws
 * EnvError.
 * @param {CheckContext} ctx
 * @param {ReadonlyArray<string> | string} [selected]
 * @returns {Promise<GateResult[]>}
 */
export async function run(ctx, selected) {
  const ids = selectGates(selected);
  if (ids.length === 0) return [];
  const metaOf = (/** @type {string} */ id) => /** @type {GateMeta} */ (GATES.find((g) => g.id === id));
  if (!ctx.baseUrl) return ids.map((id) => gate(metaOf(id)).skip('no target: pass --url <url> or --serve <dir>'));
  if (!ctx.browser) return ids.map((id) => gate(metaOf(id)).skip('no browser in the check context'));
  if (!ctx.routes || ctx.routes.length === 0 || !ctx.viewports || ctx.viewports.length === 0) {
    return ids.map((id) => gate(metaOf(id)).skip('no route or no viewport to measure'));
  }
  const needs = needsOf(ids);
  const tokens = needs.fonts ? tokenFonts(ctx.design) : { families: [], shipped: [], note: null };
  if (tokens.note) ctx.log(`qa: ${tokens.note}`);
  /** @type {PageRecord[]} */
  const pages = [];
  for (const plan of planPages(ctx.routes, ctx.viewports, ids)) pages.push(await measurePage(ctx, plan, needs, tokens));
  return ids.map((id) => judgeGate(id, pages, ctx.profile));
}

// ---------------------------------------------------------------------------------------------------------------
// CLI

const HELP = `Usage: node qa.mjs (--url <url> | --serve <dir>) [--root <repo>] [--profile <abs path>] [--state <dir>]
                  [--gates <ids>] [--routes <paths>] [--viewports <names>] [--allow-skip <id>]... [--timeout <ms>]
                  [--out <dir>] [--json]

Runs the render and a11y gates of frontend-check in the skill's pinned Chromium, on every route of
<design>/routes.json at every viewport of the profile, offline.

  render.console   0 uncaught exceptions and 0 console errors (first-party, or any when external requests are off)
  render.requests  0 failed requests and 0 responses with status 400 or above
  render.fonts     no FontFace error; headings, body text and buttons render in the family their stack asks for,
                   declared by tokens.json or the page (CDP CSS.getPlatformFontsForNode), never a silent fallback
  render.images    0 rendered images that failed, answered 400 or above, cannot be decoded, or never finish
  render.overflow  no horizontal scroll at the reflow and mobile viewports, 320 and 375 CSS px
  render.clipping  no text cut by an overflow-clipping box, no text drawn over other text
  render.cls       largest layout-shift session window over load plus a scripted scroll at most 0.1
  a11y.axe         axe-core (tags ${AXE_TAGS.join(', ')}): 0 violations other than contrast and target size
  a11y.contrast    0 axe contrast violations; axe "incomplete" texts resolved from pixels to 4.5:1 (3:1 large);
                   text-input boundaries 3:1 (APCA reported as advisory only)
  a11y.targets     0 axe target-size violations (24 CSS px, or spaced)

Options:
  --url <url>          a running app (http or https)
  --serve <dir>        a static build folder, served on 127.0.0.1 for the run
  --root <repo>        repository root (default: the working directory); routes come from <design>/routes.json
  --profile <path>     /execution profile.json or a frontend block file (default: discovered under --root)
  --state <dir>        state folder; the report is also written to <state>/gates/<UTC>-qa.json
  --gates <ids>        comma-separated gate ids or groups (render, a11y); default: all ten
  --routes <paths>     comma-separated route paths to check instead of routes.json (for example /,/app)
  --viewports <names>  comma-separated profile viewport names to use (default: all)
  --allow-skip <id>    a gate (or group) whose skipped state does not fail the run; repeatable
  --timeout <ms>       readiness timeout per page load (default 15000)
  --out <dir>          write the report to <dir>/qa.json
  --json               print the report on stdout
  -h, --help           this text

Progress goes to stderr, the JSON report to stdout (--json).
Exit codes: 0 every requested gate ok; 1 a gate failed or was skipped; 2 usage error; 3 environment error
(no browser, target unreachable, port in use).`;

/**
 * @param {string | undefined} list
 * @returns {string[]}
 */
function splitList(list) {
  return (list ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Builds the check context the CLI runs with, from the same flags as frontend-check. The browser and, for --serve,
 * the static server are started by `main`.
 * @param {Record<string, unknown>} values
 * @param {(line: string) => void} log
 * @returns {{ctx: CheckContext, ids: string[], allowSkip: string[], out: string | null, serve: string | null}}
 */
export function cliContext(values, log) {
  const url = typeof values.url === 'string' ? values.url : null;
  const serve = typeof values.serve === 'string' ? values.serve : null;
  if (url && serve) throw new UsageError('pass either --url or --serve, not both');
  if (!url && !serve) throw new UsageError('pass the target: --url <running app> or --serve <static build folder>');
  if (url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new UsageError(`--url ${JSON.stringify(url)} is not a valid URL; pass http://host:port`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new UsageError(`--url must start with http:// or https:// (got ${url})`);
  }
  const requested = splitList(typeof values.gates === 'string' ? values.gates : 'render,a11y');
  const unknown = unknownGates(requested);
  if (unknown.length > 0) throw new UsageError(`unknown gate ${unknown.join(', ')}; qa.mjs runs ${GATE_IDS.join(', ')} (groups: render, a11y)`);
  const ids = selectGates(requested);
  if (ids.length === 0) throw new UsageError('--gates selects no gate; name gate ids or the groups render and a11y');
  const root = path.resolve(typeof values.root === 'string' ? values.root : process.cwd());
  const profile = loadProfile(typeof values.profile === 'string' ? values.profile : undefined, { root });
  const design = designDir(root, profile);
  let routes = loadRoutes(root, profile);
  const routeFilter = splitList(typeof values.routes === 'string' ? values.routes : undefined);
  if (routeFilter.length > 0) {
    const bad = routeFilter.filter((r) => !r.startsWith('/'));
    if (bad.length > 0) throw new UsageError(`--routes paths must start with "/" (got ${bad.join(', ')})`);
    routes = routeFilter.map((p, i) => routes.find((r) => r.path === p) ?? { path: p, name: p, first: i === 0, features: [], states: [] });
  }
  let viewports = profile.viewports;
  const viewportFilter = splitList(typeof values.viewports === 'string' ? values.viewports : undefined);
  if (viewportFilter.length > 0) {
    const names = profile.viewports.map((v) => v.name);
    const bad = viewportFilter.filter((n) => !names.includes(n));
    if (bad.length > 0) throw new UsageError(`unknown viewport ${bad.join(', ')}; the profile has ${names.join(', ')}`);
    viewports = profile.viewports.filter((v) => viewportFilter.includes(v.name));
  }
  /** @type {Record<string, unknown>} */
  const args = { ...values };
  if (typeof values.timeout === 'string') {
    const ms = Number(values.timeout);
    if (!Number.isInteger(ms) || ms < 100) throw new UsageError(`--timeout must be a whole number of milliseconds, at least 100 (got ${values.timeout})`);
    args.timeoutMs = ms;
  }
  // Q-F14: with --out the state folder is only read, never created or written.
  const state = typeof values.state !== 'string' ? null : typeof values.out === 'string' ? statePath(root, profile, values.state) : stateDir(root, profile, values.state);
  const allowSkip = Array.isArray(values['allow-skip']) ? values['allow-skip'].map(String) : [];
  /** @type {CheckContext} */
  const ctx = { root: toPosix(root), profile, state, design, routes, baseUrl: url, browser: null, viewports, args, log };
  return { ctx, ids, allowSkip, out: typeof values.out === 'string' ? path.resolve(values.out) : null, serve };
}

/**
 * Writes `<dir>/<stamp>.json`, or `<stamp>-2.json` and so on when a report of the same second exists, so two runs in
 * one second never overwrite each other.
 * @param {import('./lib/report.mjs').GateReport} report
 * @param {string} dir
 * @param {string} stamp
 * @returns {string}
 */
export function writeUniqueReport(report, dir, stamp) {
  let name = stamp;
  for (let n = 2; existsSync(path.join(dir, `${name}.json`)); n += 1) name = `${stamp}-${n}`;
  return writeReport(report, dir, name);
}

/**
 * The CLI: parses flags, serves the build if asked, launches the pinned Chromium, runs the gates, prints and writes
 * the report. Returns the exit code (0 only when every requested gate is ok).
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const { values } = parseCli(argv, {
    options: {
      url: { type: 'string' },
      serve: { type: 'string' },
      root: { type: 'string' },
      profile: { type: 'string' },
      state: { type: 'string' },
      gates: { type: 'string' },
      routes: { type: 'string' },
      viewports: { type: 'string' },
      'allow-skip': { type: 'string', multiple: true },
      timeout: { type: 'string' },
      out: { type: 'string' },
      json: { type: 'boolean' },
    },
    help: HELP,
    allowPositionals: false,
  });
  const log = (/** @type {string} */ line) => process.stderr.write(`${line}\n`);
  const { ctx, ids, allowSkip, out, serve } = cliContext(values, log);
  /** @type {Array<() => Promise<void>>} */
  const closers = [];
  try {
    if (serve) {
      const server = await serveStatic(serve);
      closers.push(() => server.close());
      ctx.baseUrl = server.url;
      log(`qa: serving ${toPosix(path.resolve(serve))} at ${server.url}`);
    }
    const browser = await launch();
    closers.push(() => browser.close());
    ctx.browser = browser;
    log(`qa: ${plural(ids.length, 'gate')} on ${plural(ctx.routes.length, 'route')} at ${ctx.viewports.map((v) => v.name).join(', ')}`);
    const results = await run(ctx, ids);
    const report = aggregate(results, {
      allowSkip,
      requested: ids.map((id) => /** @type {GateMeta} */ (GATES.find((g) => g.id === id))),
      tool: 'qa',
      target: { root: ctx.root, url: ctx.baseUrl, routes: ctx.routes.length, viewports: ctx.viewports.map((v) => v.name) },
    });
    for (const g of report.gates) log(`${g.state.padEnd(7)} ${g.id}: ${g.detail}`);
    if (out) log(`qa: report written to ${writeReport(report, out, 'qa')}`);
    else if (ctx.state) log(`qa: report written to ${writeUniqueReport(report, path.join(ctx.state, 'gates'), `${utcStamp(report.at)}-qa`)}`);
    if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  } finally {
    for (const close of closers.reverse()) await close().catch((err) => log(`qa: cleanup failed: ${err instanceof Error ? err.message : String(err)}`));
  }
}

/**
 * @returns {boolean}
 */
function isMain() {
  return isMainModule(import.meta.url);
}

if (isMain()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => exitWith(err),
  );
}
