// @ts-check
/*
 * SL-G02: starter-template leftovers on the rendered page [FD16-F04] [FD10-F06] [FD12-F27]:
 * - the scaffold's document title ("Create Next App", "Vite + React");
 * - create-vite's demo accent #aa3bff painted on a visible element;
 * - create-next-app's default Geist wiring: the template's `--font-geist-sans` variable defined and Geist rendering
 *   (Geist chosen on purpose, without the template variable, is the font rules' question, not this one);
 * - a linked favicon whose bytes match a template file. SVGs are compared after stripping trailing whitespace,
 *   because create-vite's vanilla copy differs from the shared file by one trailing newline [FD12-F27]. Only icons on
 *   the app's own origin or in data: URLs are read; nothing else is fetched.
 * Calibration can add template hashes without a code change through the registry entry's optional `templateIcons`
 * array ([{sha256, template}]), since templates change [FD12-F27].
 */
import { createHash } from 'node:crypto';
import { selectorFor } from '../../lib/dom.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').Box} Box
 * @typedef {{sha256: string, template: string}} TemplateIcon
 * @typedef {{href: string, sel: string, type: string, status: number, base64: string, error: string}} IconBytes
 * @typedef {{title: string, accent: Array<{sel: string, property: string, box: Box}>, geistVariable: string,
 *   geistText: Array<{sel: string, family: string, box: Box}>, icons: IconBytes[]}} StarterSignals
 * @typedef {{selector: string, box: Box | null, kind: string, value: string}} Item
 */

export const RULE = 'SL-G02';
export const MAX_FINDINGS = 20;
/** Scaffold titles named by the research: create-next-app's metadata and create-vite's React template. */
export const STARTER_TITLES = Object.freeze([/\bCreate Next App\b/i, /\bVite \+ React\b/i]);
export const TEMPLATE_ACCENT = 'rgb(170, 59, 255)';
/** Template favicons hashed at verification of FD12-F27 (SHA-256 of the file; SVG after trailing-whitespace strip). */
export const TEMPLATE_ICONS = Object.freeze([
  Object.freeze({ sha256: '61bc9a161de58248288e6905425d7180f0624c2865007b97d763fdac12043a66', template: 'create-vite public/favicon.svg (15 of 16 templates; vanilla adds one trailing newline)' }),
  Object.freeze({ sha256: 'c28fdd2a4f31e2dc64f653962286da5c82a4cdfc518b242d32812c624e9a19a4', template: 'create-next-app app/favicon.ico (app-tw/ts)' }),
]);
const MAX_ICON_BYTES = 512 * 1024;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const signals = /** @type {StarterSignals} */ (
    await ctx.page.evaluate(`(${starterSignals.toString()})(${selectorFor.toString()}, ${JSON.stringify(TEMPLATE_ACCENT)}, ${MAX_ICON_BYTES})`)
  );
  const known = [...TEMPLATE_ICONS, ...extraIcons(ctx.rule?.templateIcons)];
  /** @type {Item[]} */
  const items = [];
  if (STARTER_TITLES.some((re) => re.test(signals.title))) items.push({ selector: 'title', box: null, kind: 'title', value: signals.title });
  for (const a of signals.accent) items.push({ selector: a.sel, box: a.box, kind: 'accent', value: `${a.property}: #aa3bff` });
  if (signals.geistVariable && signals.geistText.length > 0) {
    const g = signals.geistText[0];
    items.push({ selector: g.sel, box: g.box, kind: 'geist', value: `--font-geist-sans: ${signals.geistVariable}; ${signals.geistText.length} text element(s) in ${g.family}` });
  }
  for (const icon of signals.icons) {
    const match = iconMatch(icon, known);
    if (match) items.push({ selector: icon.sel, box: null, kind: 'favicon', value: `${icon.href} = ${match.template}` });
  }
  const iconErrors = signals.icons.filter((i) => i.error).map((i) => `${i.href}: ${i.error}`);
  return items.slice(0, MAX_FINDINGS).map(({ selector, box, kind, value }) => ({
    rule: RULE,
    layer: /** @type {const} */ ('runtime'),
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector,
    box,
    value: { kind, value, total: items.length, iconErrors },
    detail: `starter-template leftover (${kind}): ${value}; replace it with the project's own assets`,
  }));
}

/**
 * The template an icon's bytes match, comparing the raw SHA-256 and, for SVG or text, the SHA-256 after stripping
 * trailing whitespace.
 * @param {IconBytes} icon
 * @param {ReadonlyArray<TemplateIcon>} known
 * @returns {TemplateIcon | null}
 */
export function iconMatch(icon, known) {
  if (!icon.base64) return null;
  const hashes = iconHashes(Buffer.from(icon.base64, 'base64'), icon.type, icon.href);
  return known.find((k) => hashes.includes(k.sha256.toLowerCase())) ?? null;
}

/**
 * SHA-256 hex digests that identify an icon file: the raw bytes, plus for SVG and text the content with trailing
 * whitespace removed.
 * @param {Buffer} bytes
 * @param {string} type
 * @param {string} href
 * @returns {string[]}
 */
export function iconHashes(bytes, type, href) {
  const sha = (/** @type {Buffer | string} */ data) => createHash('sha256').update(data).digest('hex');
  const hashes = [sha(bytes)];
  if (/svg|text|xml/i.test(type) || /\.svg(?:[?#]|$)/i.test(href)) hashes.push(sha(bytes.toString('utf8').replace(/\s+$/, '')));
  return hashes;
}

/**
 * Valid extra template icons from the registry entry (`templateIcons`), ignoring malformed entries.
 * @param {unknown} value
 * @returns {TemplateIcon[]}
 */
function extraIcons(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => v && typeof v === 'object' && /^[0-9a-f]{64}$/i.test(String(v.sha256)) && typeof v.template === 'string')
    .map((v) => ({ sha256: String(v.sha256).toLowerCase(), template: String(v.template) }));
}

/**
 * In-page: document title, visible elements painted with the template accent, the Geist template variable and the
 * text rendered in Geist, and the bytes of the declared favicons (or /favicon.ico when none is declared) that live
 * on the page's origin or in data: URLs. Receives the selectorFor of lib/dom.mjs.
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorOf
 * @param {string} accent computed colour to look for
 * @param {number} maxBytes
 * @returns {Promise<StarterSignals>}
 */
export const starterSignals = async function starterSignals(selectorOf, accent, maxBytes) {
  const counts = new Map();
  /** @param {Element} el */
  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };
  /** @param {Element} el */
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return typeof el.checkVisibility !== 'function' || el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  };
  /** @type {StarterSignals['accent']} */
  const accentHits = [];
  /** @type {StarterSignals['geistText']} */
  const geistText = [];
  const body = document.body || document.documentElement;
  for (const el of [body, ...Array.from(body.querySelectorAll('*'))]) {
    if (accentHits.length >= 12 && geistText.length >= 12) break;
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && /\S/.test(n.nodeValue || ''));
    const painted = [
      ['color', ownText ? cs.color : ''],
      ['background-color', cs.backgroundColor],
      ['border-color', cs.borderTopWidth !== '0px' ? cs.borderTopColor : ''],
      ['fill', el instanceof SVGElement ? cs.fill : ''],
      ['stroke', el instanceof SVGElement ? cs.stroke : ''],
    ].find(([, value]) => value === accent);
    if (painted && accentHits.length < 12) accentHits.push({ sel: selectorOf(el, counts), property: painted[0], box: boxOf(el) });
    if (ownText && /geist/i.test(cs.fontFamily) && geistText.length < 12) {
      geistText.push({ sel: selectorOf(el, counts), family: cs.fontFamily.split(',')[0].trim(), box: boxOf(el) });
    }
  }
  const geistVariable = (getComputedStyle(body).getPropertyValue('--font-geist-sans') || getComputedStyle(document.documentElement).getPropertyValue('--font-geist-sans')).trim();
  /** @type {Array<{href: string, sel: string}>} */
  const declared = Array.from(document.querySelectorAll('link[rel]'))
    .filter((l) => l instanceof HTMLLinkElement && /(^|\s)icon(\s|$)/i.test(l.rel) && l.href)
    .map((l) => ({ href: /** @type {HTMLLinkElement} */ (l).href, sel: selectorOf(l, counts) }));
  if (declared.length === 0) declared.push({ href: new URL('/favicon.ico', location.href).href, sel: 'link[rel~="icon"] (none declared: /favicon.ico)' });
  /** @type {IconBytes[]} */
  const icons = [];
  for (const { href, sel } of declared.slice(0, 6)) {
    const icon = { href, sel, type: '', status: 0, base64: '', error: '' };
    try {
      const url = new URL(href);
      if (url.protocol !== 'data:' && url.origin !== location.origin) {
        icon.error = 'not on the page origin: not fetched';
      } else {
        const res = await fetch(href, { cache: 'no-store' });
        icon.status = res.status;
        icon.type = res.headers.get('content-type') || '';
        if (res.ok) {
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (bytes.length > maxBytes) icon.error = `larger than ${maxBytes} bytes: not hashed`;
          else {
            let binary = '';
            for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            icon.base64 = btoa(binary);
          }
        } else {
          icon.error = `HTTP ${res.status}`;
        }
      }
    } catch (err) {
      icon.error = String(err);
    }
    icons.push(icon);
  }
  return { title: document.title || '', accent: accentHits, geistVariable, geistText, icons };
};
