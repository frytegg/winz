// @ts-check
/*
 * SL-G03: prebuilt wallet-connect defaults on screen. Mesh's dialog carries the `mesh-dark` class and a "Powered by
 * Mesh SDK" footer; the Cardano Foundation button names the dApp "Awesome DApp" at "awesome-dapp-url.tld" and reports
 * connection errors with alert() [FD18-F05]. "Powered by" and alert() alone also occur in unrelated code, so this
 * detector looks only for the kit strings and for an alert raised by a connect control [FD18 Checker hooks].
 * Mesh renders its dialog only when opened, so a fresh page clicks up to three visible connect controls, with every
 * request that leaves the app's origin blocked, popups closed and dialogs dismissed.
 */
import { selectorFor } from '../../lib/dom.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').Box} Box
 * @typedef {import('playwright-core').Page} Page
 * @typedef {{kind: string, sel: string, text: string, box: Box | null}} KitHit
 */

export const RULE = 'SL-G03';
export const MAX_FINDINGS = 20;
export const MAX_CLICKS = 3;
const CLICK_TIMEOUT_MS = 3000;
const CLICK_SETTLE_MS = 500;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const hits = await scan(ctx.page);
  const triggers = /** @type {string[]} */ (await ctx.page.evaluate(`(${connectTriggers.toString()})(${selectorFor.toString()}, ${MAX_CLICKS})`));
  /** @type {{clicked: string[], errors: string[]}} */
  const flow = { clicked: [], errors: [] };
  if (triggers.length > 0) hits.push(...(await openConnectFlows(ctx, triggers, flow)));
  const items = unique(hits);
  return items.slice(0, MAX_FINDINGS).map((h) => ({
    rule: RULE,
    layer: /** @type {const} */ ('runtime'),
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector: h.sel,
    box: h.box,
    value: { kind: h.kind, text: h.text, total: items.length, clicked: flow.clicked, errors: flow.errors },
    detail: `wallet-kit default rendered (${h.kind}): "${h.text}"; build the connect dialog on the chain's hooks and theme it from the tokens`,
  }));
}

/**
 * On a fresh page: blocks requests outside the app's origin, closes popups, records and dismisses dialogs, clicks
 * each connect control, and scans after each click. Every failure is kept in `flow.errors`.
 * @param {RuntimeContext} ctx
 * @param {string[]} triggers
 * @param {{clicked: string[], errors: string[]}} flow
 * @returns {Promise<KitHit[]>}
 */
async function openConnectFlows(ctx, triggers, flow) {
  const page = await ctx.freshPage();
  const origin = new URL(page.url()).origin;
  const context = page.context();
  await context.route('**/*', async (route) => {
    try {
      if (new URL(route.request().url()).origin === origin) await route.continue();
      else await route.abort('blockedbyclient');
    } catch (err) {
      flow.errors.push(`route: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  context.on('page', (popup) => {
    popup.close().catch((err) => flow.errors.push(`popup: ${err instanceof Error ? err.message : String(err)}`));
  });
  /** @type {KitHit[]} */
  const hits = [];
  /** @type {string} */
  let current = '';
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'alert') hits.push({ kind: 'alert', sel: current, text: dialog.message().slice(0, 160), box: null });
    dialog.dismiss().catch((err) => flow.errors.push(`dialog: ${err instanceof Error ? err.message : String(err)}`));
  });
  for (const selector of triggers) {
    current = selector;
    try {
      await page.locator(selector).first().click({ timeout: CLICK_TIMEOUT_MS });
      flow.clicked.push(selector);
    } catch (err) {
      flow.errors.push(`click ${selector}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
      continue;
    }
    await page.waitForTimeout(CLICK_SETTLE_MS);
    try {
      hits.push(...(await scan(page)));
      await page.keyboard.press('Escape');
    } catch (err) {
      flow.errors.push(`after ${selector}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    }
  }
  return hits;
}

/**
 * @param {Page} page
 * @returns {Promise<KitHit[]>}
 */
async function scan(page) {
  return /** @type {KitHit[]} */ (await page.evaluate(`(${walletKitDefaults.toString()})(${selectorFor.toString()})`));
}

/**
 * @param {KitHit[]} hits
 * @returns {KitHit[]}
 */
function unique(hits) {
  const seen = new Set();
  return hits.filter((h) => {
    const key = `${h.kind}|${h.sel}|${h.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * In-page: rendered wallet-kit defaults: "Awesome DApp" (exact case, the kit's default name) and
 * "awesome-dapp-url.tld" in text or links, the deepest element reading "Powered by Mesh SDK", and laid-out
 * `.mesh-dark` elements. Receives the selectorFor of lib/dom.mjs.
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorOf
 * @returns {Array<{kind: string, sel: string, text: string, box: {x: number, y: number, w: number, h: number}}>}
 */
export const walletKitDefaults = function walletKitDefaults(selectorOf) {
  const counts = new Map();
  /** @type {Array<{kind: string, sel: string, text: string, box: {x: number, y: number, w: number, h: number}}>} */
  const out = [];
  /** @param {Element} el */
  const laidOut = (el) => el.getClientRects().length > 0;
  /** @param {string} kind @param {Element} el @param {string} text */
  const add = (kind, el, text) => {
    const r = el.getBoundingClientRect();
    out.push({ kind, sel: selectorOf(el, counts), text: text.replace(/\s+/g, ' ').trim().slice(0, 120), box: { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) } });
  };
  const root = document.body || document.documentElement;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue || '';
    const owner = node.parentElement;
    if (!owner || owner.closest('script, style, noscript, template') || !laidOut(owner)) continue;
    if (/\bAwesome DApp\b/.test(text)) add('awesome-dapp', owner, text);
    if (/awesome-dapp-url\.tld/i.test(text)) add('awesome-dapp-url', owner, text);
  }
  for (const el of Array.from(root.querySelectorAll('[href*="awesome-dapp-url.tld" i], [src*="awesome-dapp-url.tld" i]'))) {
    if (laidOut(el)) add('awesome-dapp-url', el, el.getAttribute('href') || el.getAttribute('src') || '');
  }
  const mesh = /powered\s+by\s*mesh\s*sdk/i;
  const mentionsMesh = /mesh\s*sdk/i.test(root.textContent || '');
  for (const el of mentionsMesh ? Array.from(root.querySelectorAll('*')) : []) {
    if (!(el instanceof HTMLElement) || !/mesh\s*sdk/i.test(el.textContent || '') || !laidOut(el)) continue;
    if (!mesh.test(el.innerText)) continue;
    const deeper = Array.from(el.children).some((c) => c instanceof HTMLElement && mesh.test(c.innerText));
    if (!deeper) add('powered-by-mesh', el, el.innerText);
  }
  for (const el of Array.from(root.querySelectorAll('.mesh-dark'))) {
    if (laidOut(el)) add('mesh-dark', el, 'class="mesh-dark"');
  }
  return out;
};

/**
 * In-page: visible controls that read "Connect", "Connect wallet" or "Connect your wallet", at most `max`.
 * Receives the selectorFor of lib/dom.mjs.
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorOf
 * @param {number} max
 * @returns {string[]}
 */
export const connectTriggers = function connectTriggers(selectorOf, max) {
  const counts = new Map();
  /** @type {string[]} */
  const out = [];
  const label = /^(?:connect(?:\s+(?:a|your))?(?:\s+wallet)?|connect\s+wallet\b.*)$/i;
  for (const el of Array.from(document.querySelectorAll('button, a, [role="button"]'))) {
    if (!(el instanceof HTMLElement)) continue;
    const text = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (!label.test(text)) continue;
    const r = el.getBoundingClientRect();
    const visible = r.width > 0 && r.height > 0 && (typeof el.checkVisibility !== 'function' || el.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
    if (!visible) continue;
    out.push(selectorOf(el, counts));
    if (out.length >= max) break;
  }
  return out;
};
