// @ts-check
/**
 * The brand gates of frontend-check (CONTRACTS section 4, group `brand`; research FD12, references/04-brand.md):
 * brand.candidates, brand.favicons, brand.templates, brand.icon-dark, brand.og and brand.drift. The module exports
 * GATES and run(ctx, selected) for frontend-check; its CLI builds the same context from the same flags.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MASKABLE_SAFE_RATIO, OG_HEIGHT, OG_MAX_BYTES, OG_WIDTH, RENDER_SIZES, Renderer, compareSchemes, darkModeReport,
  decodePng, fileIdentity, imageInfo, inkStats, lintMark, maxInkRadius, parseIco, parseSvgTree, sha256,
} from './brand.mjs';
import { parseCli, isMainModule } from './lib/args.mjs';
import { launch, newContext, withPage } from './lib/browser.mjs';
import { CheckError, EnvError, UsageError, exitWith } from './lib/errors.mjs';
import { readText, toPosix, walk } from './lib/fsutil.mjs';
import { DEFAULT_VIEWPORTS, loadProfile } from './lib/profile.mjs';
import { checkStateDir, designDir } from './lib/paths.mjs';
import { aggregate, gate, utcStamp, writeReport } from './lib/report.mjs';
import { loadRoutes, routeUrl } from './lib/routes.mjs';
import { serveStatic } from './lib/serve.mjs';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('./lib/report.mjs').GateResult} GateResult
 * @typedef {import('./lib/report.mjs').Evidence} Evidence
 * @typedef {import('./lib/profile.mjs').Profile} Profile
 * @typedef {import('./lib/profile.mjs').Viewport} Viewport
 * @typedef {import('./lib/routes.mjs').Route} Route
 * @typedef {{root: string, profile: Profile, state: string, design: string, routes: Route[], baseUrl: string | null,
 *   browser: Browser | null, viewports: Viewport[], args?: Record<string, unknown>, log?: (line: string) => void}} CheckContext
 * @typedef {{rel: string, href: string, rawHref: string, type: string, sizes: string}} HeadLink
 * @typedef {{property: string, name: string, content: string}} HeadMeta
 * @typedef {{url: string, links: HeadLink[], metas: HeadMeta[]}} RenderedHead
 */

export const GATES = Object.freeze([
  Object.freeze({
    id: 'brand.candidates',
    title: '3 to 5 brand candidates for a final name, linted and rendered at 16, 32, 180 and 512 px',
    ifDropped: 'the owner could pick a mark that blurs at 16 px, repeats a crypto cliché or spells a name that is not final',
  }),
  Object.freeze({
    id: 'brand.favicons',
    title: 'The favicon set is complete in the built head',
    ifDropped: 'the tab, the home screen or the search result would show a missing, clipped or wrong icon',
  }),
  Object.freeze({
    id: 'brand.templates',
    title: 'No framework template favicon ships',
    ifDropped: "a framework's default favicon would ship, the cheapest sign that the brand step was skipped",
  }),
  Object.freeze({
    id: 'brand.icon-dark',
    title: 'icon.svg keeps its dark-mode rule and changes colour in dark mode',
    ifDropped: 'the favicon could vanish on a dark tab strip',
  }),
  Object.freeze({
    id: 'brand.og',
    title: 'OG image 1200x630 with og and twitter meta in the built HTML',
    ifDropped: 'a shared link would show a cropped, empty or stale card',
  }),
  Object.freeze({
    id: 'brand.drift',
    title: 'Every inlined copy of the mark equals its file in brand/',
    ifDropped: 'an inlined copy of the mark could drift from brand/ unnoticed',
  }),
]);

const GATE_IDS = /** @type {string[]} */ (GATES.map((g) => g.id));

/**
 * Framework template favicons [FD12-F27], identified by raw SHA-256, by the SHA-256 of canonical SVG text
 * (brand.mjs canonicalSvg) and by the SHA-256 of each decoded image (brand.mjs pixelHash). Hashed on 2026-10-01
 * from the pnpm store copies of create-vite 9.0.3 and create-next-app 16.2.3; the canary Next ICO is known by its
 * raw hash only (FD12-F27). Extend with `node brand.mjs hashes <file>` on a fresh template copy.
 * @type {ReadonlyArray<Readonly<{id: string, source: string, sha256: string[], canonical: string[], pixels: string[]}>>}
 */
export const TEMPLATE_FAVICONS = Object.freeze([
  Object.freeze({
    id: 'create-vite-favicon',
    source: 'create-vite 9.0.3 public/favicon.svg (15 templates; template-vanilla has one more trailing newline), fill #863bff',
    sha256: ['61bc9a161de58248288e6905425d7180f0624c2865007b97d763fdac12043a66', 'ceeac38434be7a3b4d0f68b8cd8aa2b9ae78c260d6343087c6e095f8031ce4ff'],
    canonical: ['0303b2d9784aff9e4f7083789ce20d4653093a3232aa0e1eacc4b49900af98b8'],
    pixels: [],
  }),
  Object.freeze({
    id: 'create-vite-logo',
    source: 'create-vite 9.0.3 src/assets/vite.svg (the Vite logo)',
    sha256: ['5be21acd42eb7b896e517f4e0f0f11eb5c5d9e54fbbcebe9453f033008fcca6f'],
    canonical: ['7aa0aa895b6e334b38447ef80f06266530181e52fee06006a523f14502f896ba'],
    pixels: [],
  }),
  Object.freeze({
    id: 'create-next-app-favicon',
    source: 'create-next-app 16.2.3 app/favicon.ico of the app and app-tw templates (16, 32 and 48 px BMP, 256 px PNG)',
    sha256: ['2b8ad2d33455a8f736fc3a8ebf8f0bdea8848ad4c0db48a2833bd0f9cd775932'],
    canonical: [],
    pixels: [
      'd1fa11482c35c74c8ba36362c908b2b0ee045509255252b01e0224e6ba71670b',
      'bca3ec4b4b6fd448846a2128b4ac3ebca67fd0a95f05c99d6d3112fcc6f4d9a9',
      '0b424c147e59295747ad4d3af130c1f6e9c86e43b7742c5e505284792d59149c',
      'cae6ba472bafa892fb95aacb4448794e599d31f9813498e1bdfd7ad50cab2206',
    ],
  }),
  Object.freeze({
    id: 'create-next-app-favicon-canary',
    source: 'create-next-app canary app-tw/ts app/favicon.ico, 15,086 bytes, entries 48, 32 and 16 (FD12-F27; raw hash only)',
    sha256: ['c28fdd2a4f31e2dc64f653962286da5c82a4cdfc518b242d32812c624e9a19a4'],
    canonical: [],
    pixels: [],
  }),
]);

/**
 * The template a file identity matches, and how.
 * @param {import('./brand.mjs').FileIdentity} identity
 * @returns {{id: string, source: string, how: 'sha256' | 'canonical' | 'pixels'} | null}
 */
export function matchTemplate(identity) {
  for (const t of TEMPLATE_FAVICONS) {
    if (t.sha256.includes(identity.sha256)) return { id: t.id, source: t.source, how: 'sha256' };
    if (identity.canonicalSha256 && t.canonical.includes(identity.canonicalSha256)) return { id: t.id, source: t.source, how: 'canonical' };
    if (identity.images?.some((img) => t.pixels.includes(img.pixelSha256))) return { id: t.id, source: t.source, how: 'pixels' };
  }
  return null;
}

/** @param {unknown} err @returns {string} */
function firstLine(err) {
  const message = err instanceof Error ? err.message : String(err);
  return message.split('\n').find((l) => l.trim() !== '')?.trim() ?? message;
}

/** @param {CheckContext} ctx @returns {Viewport} */
function desktopOf(ctx) {
  const list = ctx.viewports?.length ? ctx.viewports : DEFAULT_VIEWPORTS;
  return /** @type {Viewport} */ (list.find((v) => v.name === 'desktop') ?? list[0]);
}

/** @param {CheckContext} ctx @returns {Route} */
function firstRoute(ctx) {
  return ctx.routes?.find((r) => r.first) ?? ctx.routes?.[0] ?? { path: '/', name: 'home', first: true, features: [], states: [] };
}

/** @param {string} p @returns {boolean} */
function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @typedef {{url: string, status: number, contentType: string, body: Buffer, error: string | null}} Fetched
 */

/**
 * Fetches a resource of the target under test (the served build or the --url app). Never throws: a network error
 * comes back as status 0 with its message. Redirects are followed only while they stay on the origin of `url`
 * (at most five): a redirect to another host is never fetched (CONTRACTS section 1, no network without --network)
 * and comes back as its own 3xx status, with the refused Location in `error`.
 * @param {string} url
 * @returns {Promise<Fetched>}
 */
export async function fetchResource(url) {
  const origin = new URL(url).origin;
  let current = url;
  try {
    for (let hop = 0; ; hop += 1) {
      const res = await fetch(current, { signal: AbortSignal.timeout(15000), redirect: 'manual' });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location !== null) {
        await res.body?.cancel();
        const next = new URL(location, current);
        if (next.origin !== origin) {
          return { url, status: res.status, contentType: '', body: Buffer.alloc(0), error: `redirects to ${next.href}, outside the target; not followed (serve the file from the site itself)` };
        }
        if (hop >= 5) return { url, status: res.status, contentType: '', body: Buffer.alloc(0), error: `more than 5 redirects from ${url}` };
        current = next.href;
        continue;
      }
      return { url, status: res.status, contentType: res.headers.get('content-type') ?? '', body: Buffer.from(await res.arrayBuffer()), error: null };
    }
  } catch (err) {
    return { url, status: 0, contentType: '', body: Buffer.alloc(0), error: firstLine(err) };
  }
}

/**
 * The URL to fetch for a resource the page names: itself when it lives on the target's origin; otherwise its path
 * on the target, so the check stays offline and still reads the built file (`mapped` says so).
 * @param {string} url @param {string} baseUrl
 * @returns {{url: string, mapped: boolean}}
 */
export function onTarget(url, baseUrl) {
  const u = new URL(url, baseUrl);
  const base = new URL(baseUrl);
  if (u.origin === base.origin) return { url: u.toString(), mapped: false };
  const basePath = base.pathname.replace(/\/+$/, '');
  return { url: `${base.origin}${basePath}${u.pathname}${u.search}`, mapped: true };
}

/** @type {WeakMap<object, Promise<RenderedHead>>} */
const HEADS = new WeakMap();

/**
 * A route that answers an error status is the wrong target, not a page without icons: say so instead of judging the
 * error page.
 * @param {import('playwright-core').Response | null} response @param {string} url
 */
export function assertServed(response, url) {
  if (!response) return;
  const status = response.status();
  if (status >= 400) {
    throw new CheckError(`${url} answers ${status}: --serve needs the built site folder with its index.html; a server-rendered app needs --url (or frontend-check --start)`);
  }
}

/**
 * Runs inside the page: the head's link and meta tags as the browser resolved them.
 * @returns {{links: HeadLink[], metas: HeadMeta[]}}
 */
const collectHead = () => ({
  links: [...document.querySelectorAll('link[rel]')].map((l) => {
    const link = /** @type {HTMLLinkElement} */ (l);
    return { rel: (link.getAttribute('rel') ?? '').toLowerCase().trim(), href: link.href, rawHref: link.getAttribute('href') ?? '', type: (link.getAttribute('type') ?? '').toLowerCase(), sizes: link.getAttribute('sizes') ?? '' };
  }),
  metas: [...document.querySelectorAll('meta')].map((m) => ({ property: m.getAttribute('property') ?? '', name: m.getAttribute('name') ?? '', content: m.getAttribute('content') ?? '' })),
});

/**
 * Restricts a page to the target's origin, data: and blob: URLs; every other request is aborted, so a check never
 * reaches the network beyond the app under test.
 * @param {string} baseUrl
 * @returns {(page: import('playwright-core').Page, context: import('playwright-core').BrowserContext) => Promise<void>}
 */
function targetOnly(baseUrl) {
  const origin = new URL(baseUrl).origin;
  return async (_page, context) => {
    await context.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
    });
  };
}

/**
 * The rendered head of the first route (memoised per context).
 * @param {CheckContext} ctx
 * @returns {Promise<RenderedHead>}
 */
export function renderedHead(ctx) {
  let pending = HEADS.get(ctx);
  if (!pending) {
    const url = routeUrl(/** @type {string} */ (ctx.baseUrl), firstRoute(ctx), ctx.profile);
    pending = withPage(/** @type {Browser} */ (ctx.browser), desktopOf(ctx), url, async (page, response) => {
      assertServed(response, url);
      return { url: page.url(), ...(await page.evaluate(collectHead)) };
    }, {
      beforeGoto: targetOnly(/** @type {string} */ (ctx.baseUrl)),
      readyFlag: ctx.profile?.ready_flag ?? false,
    });
    HEADS.set(ctx, pending);
  }
  return pending;
}

/** @param {string} rel @returns {Set<string>} */
function relTokens(rel) {
  return new Set(rel.split(/\s+/).filter(Boolean));
}

/** @param {HeadLink} l @returns {boolean} */
function isIconLink(l) {
  return relTokens(l.rel).has('icon');
}

/** @param {string} href @returns {string} */
function pathOf(href) {
  try {
    return new URL(href).pathname.toLowerCase();
  } catch {
    return href.toLowerCase().split(/[?#]/)[0];
  }
}

/** @param {HeadLink} l @returns {boolean} */
function isIcoLink(l) {
  return isIconLink(l) && (pathOf(l.href).endsWith('.ico') || l.type === 'image/x-icon' || l.type === 'image/vnd.microsoft.icon');
}

/** @param {HeadLink} l @returns {boolean} */
function isSvgLink(l) {
  return isIconLink(l) && (l.type === 'image/svg+xml' || pathOf(l.href).endsWith('.svg'));
}

/** @param {HeadLink} l @returns {boolean} */
function isAppleLink(l) {
  const t = relTokens(l.rel);
  return t.has('apple-touch-icon') || t.has('apple-touch-icon-precomposed');
}

/** @param {HeadMeta[]} metas @param {string} key @returns {string | null} */
function metaValue(metas, key) {
  const m = metas.find((x) => x.property.toLowerCase() === key || x.name.toLowerCase() === key);
  return m ? m.content.trim() : null;
}

// ---------------------------------------------------------------------------------------------------------------
// brand.candidates

/**
 * @param {CheckContext} ctx
 * @returns {Promise<GateResult>}
 */
async function gateCandidates(ctx) {
  const g = gate(GATES[0]);
  if (!ctx.browser) return g.skip('needs the browser for the raster lint; frontend-check launches one');
  /** @type {Evidence[]} */
  const problems = [];
  const briefFile = path.join(ctx.state, 'brief.json');
  if (!existsSync(briefFile)) {
    problems.push({ file: toPosix(briefFile), value: 'missing', detail: 'no brief.json: run brief.mjs first (the name must be final before candidates, BR-02)' });
  } else {
    let brief;
    try {
      brief = JSON.parse(readText(briefFile));
    } catch (err) {
      problems.push({ file: toPosix(briefFile), value: 'invalid JSON', detail: firstLine(err) });
    }
    const status = brief?.project?.name_status;
    if (brief && status !== 'final') {
      problems.push({ file: toPosix(briefFile), value: String(status ?? 'missing'), detail: `project.name_status is ${JSON.stringify(status ?? null)}, not "final": candidates wait for the final name (BR-02)` });
    }
  }
  const dir = path.join(ctx.state, 'brand', 'candidates');
  /** @type {string[]} */
  let folders = [];
  if (!isDir(dir)) {
    problems.push({ file: toPosix(dir), value: 'missing', detail: 'no candidates folder: write 3 to 5 candidates under <state>/brand/candidates/<n>/' });
  } else {
    folders = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => path.join(dir, e.name))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    if (folders.length < 3 || folders.length > 5) {
      problems.push({ file: toPosix(dir), value: folders.length, detail: `${folders.length} candidate folder(s); the owner picks among 3 to 5 (BR-09)` });
    }
  }
  const renderer = folders.length ? await Renderer.open({ browser: ctx.browser }) : null;
  try {
    for (const folder of folders) problems.push(...(await checkCandidate(folder, /** @type {Renderer} */ (renderer))));
  } finally {
    await renderer?.close();
  }
  if (problems.length > 0) return g.fail(`${problems.length} problem(s) across ${folders.length} candidate(s): ${String(problems[0].detail)}`, problems);
  return g.ok(`${folders.length} candidates, name final, every mark linted (no hard fail, every flag explained) and rendered at ${RENDER_SIZES.join(', ')} px with silhouettes`, folders.map((f) => ({ file: toPosix(f) })));
}

/**
 * @param {string} folder
 * @param {Renderer} renderer
 * @returns {Promise<Evidence[]>}
 */
async function checkCandidate(folder, renderer) {
  /** @type {Evidence[]} */
  const problems = [];
  const where = toPosix(folder);
  const markFile = path.join(folder, 'mark.svg');
  const candidateFile = path.join(folder, 'candidate.json');
  /** @type {Record<string, unknown> | null} */
  let candidate = null;
  if (!existsSync(candidateFile)) {
    problems.push({ file: toPosix(candidateFile), value: 'missing', detail: `${path.basename(folder)}: no candidate.json (text, font, license, intervention, one_feature, flag_reasons, ai, tool)` });
  } else {
    try {
      const parsed = JSON.parse(readText(candidateFile));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) candidate = parsed;
      else problems.push({ file: toPosix(candidateFile), value: 'not an object', detail: `${path.basename(folder)}: candidate.json must be a JSON object` });
    } catch (err) {
      problems.push({ file: toPosix(candidateFile), value: 'invalid JSON', detail: `${path.basename(folder)}: ${firstLine(err)}` });
    }
  }
  if (candidate) {
    for (const field of ['intervention', 'one_feature']) {
      const v = candidate[field];
      if (typeof v !== 'string' || v.trim() === '') {
        problems.push({ file: toPosix(candidateFile), value: field, detail: `${path.basename(folder)}: ${field} is empty (${field === 'intervention' ? 'the one change to the set face, BR-03' : '"the one feature is ...", BR-01'})` });
      }
    }
    if (candidate.ai !== undefined && !['generated', 'assisted', 'none'].includes(String(candidate.ai))) {
      problems.push({ file: toPosix(candidateFile), value: String(candidate.ai), detail: `${path.basename(folder)}: ai must be generated, assisted or none` });
    }
    const reasons = candidate.flag_reasons;
    if (reasons !== undefined && (reasons === null || typeof reasons !== 'object' || Array.isArray(reasons))) {
      problems.push({ file: toPosix(candidateFile), value: 'flag_reasons', detail: `${path.basename(folder)}: flag_reasons must map a flag id to its written reason` });
    }
  }
  if (!existsSync(markFile)) {
    problems.push({ file: toPosix(markFile), value: 'missing', detail: `${path.basename(folder)}: no mark.svg` });
    return problems;
  }
  const text = readText(markFile);
  const font = fontName(candidate);
  const reasons = candidate && candidate.flag_reasons && typeof candidate.flag_reasons === 'object' && !Array.isArray(candidate.flag_reasons)
    ? Object.fromEntries(Object.entries(/** @type {Record<string, unknown>} */ (candidate.flag_reasons)).map(([k, v]) => [k, typeof v === 'string' ? v : '']))
    : {};
  const lint = await lintMark(text, { renderer, reasons, file: toPosix(markFile), font });
  for (const f of lint.findings) {
    if (f.severity === 'fail') problems.push({ file: toPosix(markFile), value: f.id, detail: `${path.basename(folder)}: ${f.id}: ${f.detail}` });
  }
  for (const id of lint.unexplained) {
    problems.push({ file: toPosix(markFile), value: id, detail: `${path.basename(folder)}: look-twice flag ${id} has no written reason in candidate.json flag_reasons (FD12-F05)` });
  }
  const wordFile = path.join(folder, 'wordmark.svg');
  if (existsSync(wordFile)) {
    const word = await lintMark(readText(wordFile), { kind: 'wordmark', file: toPosix(wordFile) });
    for (const f of word.findings) {
      if (f.severity === 'fail') problems.push({ file: toPosix(wordFile), value: f.id, detail: `${path.basename(folder)} wordmark: ${f.id}: ${f.detail}` });
    }
  }
  problems.push(...checkRenders(folder, text));
  if (problems.length === 0) return [];
  return problems.map((p) => ({ ...p, candidate: where }));
}

/** @param {Record<string, unknown> | null} candidate @returns {string | null} */
function fontName(candidate) {
  const f = candidate?.font;
  if (typeof f === 'string') return f;
  if (f && typeof f === 'object' && typeof (/** @type {Record<string, unknown>} */ (f)).family === 'string') return String((/** @type {Record<string, unknown>} */ (f)).family);
  return null;
}

/**
 * The renders of brand.mjs render must exist for the current mark: mark, light and dark silhouettes at every size.
 * @param {string} folder @param {string} markText
 * @returns {Evidence[]}
 */
function checkRenders(folder, markText) {
  const dir = path.join(folder, 'render');
  const recordFile = path.join(dir, 'render.json');
  const name = path.basename(folder);
  if (!existsSync(recordFile)) {
    return [{ file: toPosix(recordFile), value: 'missing', detail: `${name}: not rendered; run node brand.mjs render <candidates folder>` }];
  }
  /** @type {Evidence[]} */
  const problems = [];
  let record;
  try {
    record = JSON.parse(readText(recordFile));
  } catch (err) {
    return [{ file: toPosix(recordFile), value: 'invalid JSON', detail: `${name}: ${firstLine(err)}` }];
  }
  if (record?.markSha256 !== sha256(markText)) {
    problems.push({ file: toPosix(recordFile), value: 'stale', detail: `${name}: the renders are of an older mark.svg; re-run brand.mjs render` });
  }
  for (const size of RENDER_SIZES) {
    for (const file of [`mark-${size}.png`, `silhouette-light-${size}.png`, `silhouette-dark-${size}.png`]) {
      const p = path.join(dir, file);
      if (!existsSync(p)) {
        problems.push({ file: toPosix(p), value: 'missing', detail: `${name}: ${file} missing` });
        continue;
      }
      const info = imageInfo(readFileSync(p));
      if (info.format !== 'png' || info.width !== size || info.height !== size) {
        problems.push({ file: toPosix(p), value: `${info.format} ${info.width}x${info.height}`, detail: `${name}: ${file} is not a ${size}x${size} PNG` });
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// brand.favicons

/**
 * Parses robots.txt into groups and answers whether a path is disallowed for a user agent (longest match wins,
 * Allow wins a tie, `*` and `$` wildcards).
 * @param {string} text
 * @returns {(agent: string, pathname: string) => boolean}
 */
export function robotsDisallows(text) {
  /** @type {{agents: string[], rules: {allow: boolean, pattern: string}[]}[]} */
  const groups = [];
  /** @type {{agents: string[], rules: {allow: boolean, pattern: string}[]} | null} */
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && current) {
      if (value !== '') current.rules.push({ allow: key === 'allow', pattern: value });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  /** @param {string} pattern @param {string} p */
  const matches = (pattern, p) => {
    const anchored = pattern.endsWith('$');
    const body = (anchored ? pattern.slice(0, -1) : pattern).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${body}${anchored ? '$' : ''}`).test(p);
  };
  return (agent, pathname) => {
    const a = agent.toLowerCase();
    const specific = groups.filter((gr) => gr.agents.some((x) => x !== '*' && a.startsWith(x)));
    const chosen = specific.length ? specific : groups.filter((gr) => gr.agents.includes('*'));
    let best = null;
    for (const gr of chosen) {
      for (const r of gr.rules) {
        if (!matches(r.pattern, pathname)) continue;
        if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
      }
    }
    return Boolean(best && !best.allow);
  };
}

/**
 * Maximum ink radius of an icon: on a transparent icon every pixel with alpha counts; on a full-bleed icon (opaque
 * corners of one colour) the pixels that differ from that ground count.
 * @param {import('./brand.mjs').RgbaImage} img
 * @returns {number}
 */
export function iconInkRadius(img) {
  const { width: w, height: h, data } = img;
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4];
  const opaque = corners.every((i) => data[i + 3] === 255);
  const sameColour = corners.every((i) => Math.max(Math.abs(data[i] - data[0]), Math.abs(data[i + 1] - data[1]), Math.abs(data[i + 2] - data[2])) <= 8);
  if (opaque && sameColour) {
    const bg = [data[0], data[1], data[2]];
    return maxInkRadius(data, w, h, (i) => data[i + 3] < 250 || Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2])) > 24);
  }
  return maxInkRadius(data, w, h);
}

/**
 * @param {CheckContext} ctx
 * @returns {Promise<GateResult>}
 */
async function gateFavicons(ctx) {
  const g = gate(GATES[1]);
  if (!ctx.baseUrl) return g.skip('needs the built site: pass --serve <dir> or --url <url>');
  if (!ctx.browser) return g.skip('needs the browser to read the rendered head; frontend-check launches one');
  const head = await renderedHead(ctx);
  const base = /** @type {string} */ (ctx.baseUrl);
  /** @type {Evidence[]} */
  const problems = [];
  /** @type {string[]} */
  const iconPaths = [];
  let largeRaster = false;
  /** @param {string} what @param {HeadLink} link @returns {Promise<Fetched | null>} */
  const get = async (what, link) => {
    const target = onTarget(link.href, base);
    if (target.mapped) {
      problems.push({ route: head.url, selector: `link[rel="${link.rel}"]`, value: link.href, detail: `${what} is served from another origin (${new URL(link.href).origin}); serve it from the site itself` });
      return null;
    }
    const res = await fetchResource(target.url);
    iconPaths.push(new URL(target.url).pathname);
    if (res.status !== 200) {
      problems.push({ route: head.url, selector: `link[rel="${link.rel}"]`, value: res.status || res.error, detail: `${what} ${link.rawHref} answers ${res.status || res.error}` });
      return null;
    }
    return res;
  };
  const icoLinks = head.links.filter(isIcoLink);
  if (icoLinks.length === 0) {
    problems.push({ route: head.url, selector: 'link[rel~="icon"]', value: 'missing', detail: 'no <link rel="icon" href="/favicon.ico" sizes="32x32"> in the head' });
  } else {
    const ico = icoLinks[0];
    if (ico.sizes.trim() !== '32x32') {
      problems.push({ route: head.url, selector: 'link[rel~="icon"][href$=".ico"]', value: ico.sizes || '(none)', detail: `the ICO link declares sizes="${ico.sizes}"; declare sizes="32x32" (Chrome bug, FD12-F21)` });
    }
    const res = await get('favicon.ico', ico);
    if (res) {
      try {
        const info = parseIco(res.body);
        if (info.count !== 1 || info.entries[0].width !== 32 || info.entries[0].height !== 32) {
          problems.push({ route: head.url, value: info.entries.map((e) => `${e.width}x${e.height}`).join(','), detail: `favicon.ico holds ${info.entries.map((e) => `${e.width}x${e.height}`).join(', ')}; ship exactly one 32x32 entry (FD12-F25)` });
        }
      } catch (err) {
        problems.push({ route: head.url, value: 'not an ICO', detail: `favicon.ico is not an icon file: ${firstLine(err)}` });
      }
    }
  }
  const svgLinks = head.links.filter(isSvgLink);
  if (svgLinks.length === 0) {
    problems.push({ route: head.url, selector: 'link[rel~="icon"]', value: 'missing', detail: 'no <link rel="icon" href="/icon.svg" type="image/svg+xml"> in the head' });
  } else {
    const res = await get('icon.svg', svgLinks[0]);
    if (res) {
      const type = res.contentType.split(';')[0].trim().toLowerCase();
      if (type !== 'image/svg+xml') problems.push({ route: head.url, value: type || '(none)', detail: `icon.svg is served as ${type || 'no type'}; Chromium and Firefox need image/svg+xml (FD12-F22)` });
      try {
        parseSvgTree(res.body.toString('utf8'));
      } catch (err) {
        problems.push({ route: head.url, value: 'invalid SVG', detail: `icon.svg does not parse: ${firstLine(err)}` });
      }
    }
  }
  const appleLinks = head.links.filter(isAppleLink);
  if (appleLinks.length === 0) {
    problems.push({ route: head.url, selector: 'link[rel="apple-touch-icon"]', value: 'missing', detail: 'no <link rel="apple-touch-icon"> (180x180) in the head' });
  } else {
    const res = await get('apple-touch-icon', appleLinks[0]);
    if (res) {
      const info = imageInfo(res.body);
      if (info.format !== 'png' || info.width !== 180 || info.height !== 180) {
        problems.push({ route: head.url, value: `${info.format} ${info.width}x${info.height}`, detail: 'the apple-touch-icon must be a 180x180 PNG' });
      } else {
        largeRaster = true;
        const img = decodePng(res.body);
        let transparent = 0;
        for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 255) transparent += 1;
        if (transparent > 0) problems.push({ route: head.url, value: transparent, detail: `the apple-touch-icon has ${transparent} transparent pixel(s); put the mark at 140 px on a solid ground (BR-12)` });
      }
    }
  }
  for (const link of head.links.filter((l) => isIconLink(l) && !isIcoLink(l) && !isSvgLink(l))) {
    const res = await get('icon', link);
    if (!res) continue;
    const info = imageInfo(res.body);
    if (info.width && info.height && Math.max(info.width, info.height) > 48) largeRaster = true;
  }
  const manifestLink = head.links.find((l) => relTokens(l.rel).has('manifest'));
  if (!manifestLink) {
    problems.push({ route: head.url, selector: 'link[rel="manifest"]', value: 'missing', detail: 'no <link rel="manifest"> in the head' });
  } else {
    const res = await get('manifest', manifestLink);
    if (res) problems.push(...(await checkManifest(res, base, head.url)));
  }
  if (!largeRaster) problems.push({ route: head.url, value: 'none', detail: 'no raster icon larger than 48 px is declared; Google Search lists no SVG (FD12-F29)' });
  const robots = await fetchResource(new URL('/robots.txt', base).toString());
  if (robots.status === 200) {
    const disallows = robotsDisallows(robots.body.toString('utf8'));
    for (const p of [...new Set(iconPaths)]) {
      for (const agent of ['Googlebot', 'Googlebot-Image']) {
        if (disallows(agent, p)) problems.push({ file: 'robots.txt', value: p, detail: `robots.txt blocks ${p} for ${agent}; favicons must stay crawlable (FD12-F29)` });
      }
    }
  }
  if (problems.length > 0) return g.fail(`${problems.length} problem(s): ${String(problems[0].detail)}`, problems);
  return g.ok('favicon.ico (one 32x32 entry, sizes="32x32"), icon.svg as image/svg+xml, apple-touch-icon 180x180 on a solid ground, manifest 192, 512 and maskable 512 inside the safe zone', { route: head.url });
}

/**
 * @param {Fetched} res @param {string} base @param {string} route
 * @returns {Promise<Evidence[]>}
 */
async function checkManifest(res, base, route) {
  /** @type {Evidence[]} */
  const problems = [];
  /** @type {any} */
  let manifest;
  try {
    manifest = JSON.parse(res.body.toString('utf8'));
  } catch (err) {
    return [{ route, value: 'invalid JSON', detail: `the manifest is not valid JSON: ${firstLine(err)}` }];
  }
  const icons = Array.isArray(manifest?.icons) ? manifest.icons : [];
  /** @param {any} icon @returns {string[]} */
  const purposes = (icon) => String(icon?.purpose ?? 'any').toLowerCase().split(/\s+/).filter(Boolean);
  /** @param {string} size @param {boolean} maskable */
  const find = (size, maskable) => icons.find((/** @type {any} */ i) => String(i?.sizes ?? '').split(/\s+/).includes(size) && (maskable ? purposes(i).includes('maskable') : purposes(i).includes('any')));
  const wanted = /** @type {[string, boolean, number][]} */ ([['192x192', false, 192], ['512x512', false, 512], ['512x512', true, 512]]);
  for (const [size, maskable, px] of wanted) {
    const icon = find(size, maskable);
    const label = `${maskable ? 'maskable ' : ''}${size}`;
    if (!icon || typeof icon.src !== 'string') {
      problems.push({ route, value: 'missing', detail: `the manifest lists no ${label} icon` });
      continue;
    }
    const target = onTarget(new URL(icon.src, res.url).toString(), base);
    if (target.mapped) {
      problems.push({ route, value: icon.src, detail: `the ${label} icon is served from another origin` });
      continue;
    }
    const file = await fetchResource(target.url);
    if (file.status !== 200) {
      problems.push({ route, value: file.status || file.error, detail: `the ${label} icon ${icon.src} answers ${file.status || file.error}` });
      continue;
    }
    const info = imageInfo(file.body);
    if (info.width !== px || info.height !== px) {
      problems.push({ route, value: `${info.format} ${info.width}x${info.height}`, detail: `the ${label} icon ${icon.src} is ${info.width}x${info.height}, not ${size}` });
      continue;
    }
    if (maskable) {
      if (info.format !== 'png') {
        problems.push({ route, value: info.format, detail: 'the maskable icon must be a PNG to be measured' });
        continue;
      }
      const radius = iconInkRadius(decodePng(file.body));
      const limit = MASKABLE_SAFE_RATIO * px;
      if (radius > limit + 0.5) problems.push({ route, value: radius, detail: `the maskable icon's ink reaches ${radius} px from the centre, beyond the safe zone of ${limit} px (FD12-F23)` });
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// brand.templates

const ICON_GLOBS = Object.freeze(['favicon*.{ico,svg,png}', 'icon.{svg,png,ico}', 'icon-*.{png,svg}', 'apple-icon*.png', 'apple-touch-icon*.png', '*.ico', 'vite.svg']);

/**
 * @param {CheckContext} ctx
 * @returns {Promise<GateResult>}
 */
async function gateTemplates(ctx) {
  const g = gate(GATES[2]);
  /** @type {Evidence[]} */
  const matches = [];
  let checked = 0;
  const files = walk(ctx.root, { include: [...ICON_GLOBS], nocase: true });
  for (const rel of files) {
    const abs = path.join(ctx.root, rel);
    checked += 1;
    const hit = matchTemplate(fileIdentity(readFileSync(abs)));
    if (hit) matches.push({ file: rel, value: hit.id, detail: `${rel} is the ${hit.source} (matched by ${hit.how})` });
  }
  let fromHead = 0;
  if (ctx.baseUrl && ctx.browser) {
    const head = await renderedHead(ctx);
    const urls = [...new Set(head.links.filter((l) => isIconLink(l) || isAppleLink(l)).map((l) => l.href))];
    for (const url of urls) {
      const target = onTarget(url, ctx.baseUrl);
      if (target.mapped || url.startsWith('data:')) continue;
      const res = await fetchResource(target.url);
      if (res.status !== 200) continue;
      fromHead += 1;
      const hit = matchTemplate(fileIdentity(res.body));
      if (hit) matches.push({ route: head.url, value: hit.id, detail: `${new URL(target.url).pathname} in the built head is the ${hit.source} (matched by ${hit.how})` });
    }
  }
  if (matches.length > 0) return g.fail(`${matches.length} template favicon(s): ${String(matches[0].detail)}; replace it with the chosen mark's set (BR-16)`, matches);
  return g.ok(`no template favicon among ${checked} icon file(s) in the repository and ${fromHead} icon(s) of the built head (normalised identities of ${TEMPLATE_FAVICONS.length} templates)`);
}

// ---------------------------------------------------------------------------------------------------------------
// brand.icon-dark

const ICON_SVG_PLACES = Object.freeze(['public/icon.svg', 'app/icon.svg', 'src/app/icon.svg', 'static/icon.svg', 'brand/icon.svg']);

/**
 * Renders an SVG as a top-level document in light and in dark mode (the way FD12-F24 verified it) and compares
 * the pixels.
 * @param {Browser} browser @param {string} url
 * @returns {Promise<{light: Buffer, dark: Buffer}>}
 */
async function screenshotSchemes(browser, url) {
  /** @type {Record<string, Buffer>} */
  const shots = {};
  for (const scheme of /** @type {const} */ (['light', 'dark'])) {
    const context = await newContext(browser, { width: 64, height: 64, dpr: 1, isMobile: false, hasTouch: false, colorScheme: scheme }, { origins: [url] });
    try {
      const origin = new URL(url).origin;
      await context.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
      const page = await context.newPage();
      const res = await page.goto(url, { waitUntil: 'load' });
      if (!res || res.status() !== 200) throw new CheckError(`icon.svg at ${url} answers ${res ? res.status() : 'nothing'}`);
      shots[scheme] = await page.screenshot({ type: 'png', omitBackground: true });
    } finally {
      await context.close();
    }
  }
  return { light: shots.light, dark: shots.dark };
}

/**
 * @param {CheckContext} ctx
 * @returns {Promise<GateResult>}
 */
async function gateIconDark(ctx) {
  const g = gate(GATES[3]);
  if (!ctx.browser) return g.skip('needs the browser to render icon.svg in dark mode; frontend-check launches one');
  /** @type {string | null} */
  let url = null;
  /** @type {string | null} */
  let text = null;
  /** @type {string} */
  let where = '';
  /** @type {import('./lib/serve.mjs').StaticServer | null} */
  let server = null;
  try {
    if (ctx.baseUrl) {
      const head = await renderedHead(ctx);
      const link = head.links.find(isSvgLink);
      if (link) {
        const target = onTarget(link.href, ctx.baseUrl);
        const res = await fetchResource(target.url);
        if (res.status === 200) {
          url = target.url;
          text = res.body.toString('utf8');
          where = new URL(target.url).pathname;
        }
      }
    }
    if (!text) {
      const rel = ICON_SVG_PLACES.find((p) => existsSync(path.join(ctx.root, p)));
      if (!rel) return g.fail(`no icon.svg: neither the built head links one nor the repository has ${ICON_SVG_PLACES.join(', ')}`);
      const abs = path.join(ctx.root, rel);
      text = readFileSync(abs, 'utf8');
      server = await serveStatic(path.dirname(abs), { spaFallback: false });
      url = `${server.url}/${path.basename(abs)}`;
      where = rel;
    }
    let report;
    try {
      report = darkModeReport(text);
    } catch (err) {
      return g.fail(`${where} does not parse: ${firstLine(err)}`, { file: where });
    }
    if (!report.present) return g.fail(`${where} has no prefers-color-scheme: dark rule; add one and optimise with inlineStyles: false (BR-13)`, { file: where });
    if (!report.matched) {
      return g.fail(`${where} keeps a dark rule whose selector matches no element (SVGO inlined the class); re-optimise with inlineStyles: false (FD12-F24)`, { file: where, value: report.rules.map((r) => r.selector).join(', ') });
    }
    const { light, dark } = await screenshotSchemes(ctx.browser, /** @type {string} */ (url));
    const l = decodePng(light);
    const d = decodePng(dark);
    if (inkStats(l.data, l.width, l.height).inkPx === 0) return g.fail(`${where} renders nothing in Chromium`, { file: where });
    const cmp = compareSchemes(l.data, d.data, report.colours);
    const evidence = { file: where, value: `light ${cmp.light}, dark ${cmp.dark}, changed ${cmp.changedShare}`, declared: report.colours.join(', ') };
    if (cmp.changedShare === 0) return g.fail(`${where} draws the same colours under emulated dark mode (light ${cmp.light}, dark ${cmp.dark}); the rule does not take effect`, evidence);
    if (cmp.matchesDeclared === false) return g.fail(`${where} changes colour in dark mode but not to the declared ${report.colours.join(' or ')} (sampled ${cmp.dark})`, evidence);
    return g.ok(`${where} switches from ${cmp.light} to ${cmp.dark} under emulated dark mode (${Math.round(cmp.changedShare * 100)}% of the ink changes)`, evidence);
  } finally {
    await server?.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// brand.og

/**
 * @param {CheckContext} ctx
 * @returns {Promise<GateResult>}
 */
async function gateOg(ctx) {
  const g = gate(GATES[4]);
  if (!ctx.baseUrl) return g.skip('needs the built site: pass --serve <dir> or --url <url>');
  if (!ctx.browser) return g.skip('needs the browser to read the rendered head; frontend-check launches one');
  const head = await renderedHead(ctx);
  /** @type {Evidence[]} */
  const problems = [];
  const image = metaValue(head.metas, 'og:image');
  const width = metaValue(head.metas, 'og:image:width');
  const height = metaValue(head.metas, 'og:image:height');
  const alt = metaValue(head.metas, 'og:image:alt');
  const card = metaValue(head.metas, 'twitter:card');
  for (const [key, value] of /** @type {[string, string | null][]} */ ([['og:image', image], ['og:image:width', width], ['og:image:height', height], ['og:image:alt', alt], ['twitter:card', card]])) {
    if (!value) problems.push({ route: head.url, selector: `meta[property="${key}"]`, value: 'missing', detail: `${key} is missing or empty` });
  }
  if (card && card !== 'summary_large_image') problems.push({ route: head.url, value: card, detail: `twitter:card is "${card}"; use summary_large_image` });
  if (width && width !== String(OG_WIDTH)) problems.push({ route: head.url, value: width, detail: `og:image:width is ${width}, not ${OG_WIDTH}` });
  if (height && height !== String(OG_HEIGHT)) problems.push({ route: head.url, value: height, detail: `og:image:height is ${height}, not ${OG_HEIGHT}` });
  /** @type {Evidence} */
  const evidence = { route: head.url, value: image ?? '' };
  if (image) {
    if (!/^https:\/\//i.test(image)) {
      problems.push({ route: head.url, value: image, detail: `og:image is "${image}"; crawlers need an absolute https URL (BR-18)` });
    }
    const target = onTarget(image, /** @type {string} */ (ctx.baseUrl));
    const res = await fetchResource(target.url);
    evidence.fetched = target.url;
    evidence.mapped = target.mapped;
    if (res.status !== 200) {
      problems.push({ route: head.url, value: res.status || res.error, detail: `the OG image ${target.mapped ? `(its path ${new URL(target.url).pathname} on the build)` : target.url} answers ${res.status || res.error}` });
    } else {
      const info = imageInfo(res.body);
      if (!['png', 'jpeg', 'webp', 'gif'].includes(info.format)) problems.push({ route: head.url, value: info.format, detail: `the OG image is ${info.format}, not a PNG, JPEG, WebP or GIF` });
      else if (info.width !== OG_WIDTH || info.height !== OG_HEIGHT) problems.push({ route: head.url, value: `${info.width}x${info.height}`, detail: `the OG image is ${info.width}x${info.height}, not ${OG_WIDTH}x${OG_HEIGHT}` });
      if (res.body.length > OG_MAX_BYTES) problems.push({ route: head.url, value: res.body.length, detail: `the OG image is ${res.body.length} bytes, over 8 MB` });
      if (res.body.length === 0) problems.push({ route: head.url, value: 0, detail: 'the OG image is empty' });
      const hash = sha256(res.body);
      const u = new URL(image, /** @type {string} */ (ctx.baseUrl));
      const token = /(?:^|[^0-9a-f])([0-9a-f]{8,})(?=[^0-9a-f]|$)/i.exec(`${u.pathname}${u.search}`)?.[1] ?? null;
      evidence.bytes = res.body.length;
      evidence.sha256 = hash;
      if (!token) problems.push({ route: head.url, value: u.pathname, detail: 'the OG image URL carries no content hash; put one in the file name so the URL changes with the image (FD12-F28)' });
      else evidence.hashMatches = hash.startsWith(token.toLowerCase());
    }
  }
  const twitterImage = metaValue(head.metas, 'twitter:image');
  if (twitterImage && twitterImage !== image) {
    const res = await fetchResource(onTarget(twitterImage, /** @type {string} */ (ctx.baseUrl)).url);
    if (res.status !== 200) problems.push({ route: head.url, value: res.status || res.error, detail: `twitter:image ${twitterImage} answers ${res.status || res.error}` });
  }
  if (problems.length > 0) return g.fail(`${problems.length} problem(s): ${String(problems[0].detail)}`, [evidence, ...problems]);
  return g.ok(`og:image ${image} is a ${OG_WIDTH}x${OG_HEIGHT} image of ${evidence.bytes} bytes with width, height, alt and twitter:card summary_large_image`, evidence);
}

// ---------------------------------------------------------------------------------------------------------------
// brand.drift

/** Silhouettes are compared on a 128-pixel grid after cropping to the ink, so framing and padding do not count. */
const SIGNATURE_SIZE = 128;
const EQUAL_IOU = 0.97;
const SIMILAR_IOU = 0.6;

/**
 * A framing-independent silhouette: the render cropped to its ink and fitted into a square grid.
 * @param {Renderer} renderer @param {string} svg
 * @returns {Promise<{mask: Uint8Array, aspect: number} | null>}
 */
export async function silhouette(renderer, svg) {
  const big = 256;
  const r = await renderer.renderSquare(svg, big, { want: 'rgba' });
  const rgba = /** @type {Buffer} */ (r.rgba);
  const stats = inkStats(rgba, big, big);
  if (!stats.box) return null;
  const b = stats.box;
  const n = SIGNATURE_SIZE;
  const scale = Math.max(b.w, b.h) / n;
  const ox = (n - b.w / scale) / 2;
  const oy = (n - b.h / scale) / 2;
  const mask = new Uint8Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const sx = Math.floor(b.x + (x - ox + 0.5) * scale);
      const sy = Math.floor(b.y + (y - oy + 0.5) * scale);
      if (sx < b.x || sy < b.y || sx >= b.x + b.w || sy >= b.y + b.h) continue;
      mask[y * n + x] = rgba[(sy * big + sx) * 4 + 3] >= 128 ? 1 : 0;
    }
  }
  return { mask, aspect: b.w / b.h };
}

/** @param {Uint8Array} a @param {Uint8Array} b @returns {number} */
export function iou(a, b) {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] && b[i]) inter += 1;
    if (a[i] || b[i]) union += 1;
  }
  return union === 0 ? 1 : inter / union;
}

/**
 * Runs inside the page: candidate inline copies of a drawing (data-URI icons and images, inline SVGs, elements
 * marked data-brand).
 * @returns {{kind: string, brand: string | null, svg: string | null, src: string | null, viewBox: string | null, where: string}[]}
 */
const collectCopies = () => {
  /** @type {{kind: string, brand: string | null, svg: string | null, src: string | null, viewBox: string | null, where: string}[]} */
  const out = [];
  /** @param {string} uri @returns {string | null} */
  const decode = (uri) => {
    const m = /^data:image\/svg\+xml(;[^,]*)?,(.*)$/is.exec(uri);
    if (!m) return null;
    try {
      return /;base64/i.test(m[1] ?? '') ? new TextDecoder().decode(Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0))) : decodeURIComponent(m[2]);
    } catch {
      return null;
    }
  };
  for (const l of document.querySelectorAll('link[rel~="icon"]')) {
    const href = l.getAttribute('href') ?? '';
    if (href.startsWith('data:')) out.push({ kind: 'favicon-data-uri', brand: null, svg: decode(href), src: null, viewBox: null, where: 'link[rel~="icon"]' });
  }
  for (const img of document.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? '';
    const brand = img.closest('[data-brand]')?.getAttribute('data-brand') ?? null;
    if (src.startsWith('data:image/svg+xml')) out.push({ kind: 'img-data-uri', brand, svg: decode(src), src: null, viewBox: null, where: `img:nth-of-type(${out.length + 1})` });
    else if (brand) out.push({ kind: 'img-brand', brand, svg: null, src: /** @type {HTMLImageElement} */ (img).src, viewBox: null, where: `img[data-brand="${brand}"]` });
  }
  let n = 0;
  for (const svg of document.querySelectorAll('svg')) {
    if (svg.parentElement?.closest('svg')) continue;
    n += 1;
    if (n > 300) break;
    const brand = svg.closest('[data-brand]')?.getAttribute('data-brand') ?? null;
    const clone = /** @type {SVGSVGElement} */ (svg.cloneNode(true));
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const color = getComputedStyle(svg).color;
    clone.setAttribute('color', color);
    out.push({ kind: 'inline-svg', brand, svg: clone.outerHTML, src: null, viewBox: svg.getAttribute('viewBox'), where: `svg:nth-of-type(${n})` });
  }
  return out;
};

/**
 * @param {CheckContext} ctx
 * @returns {Promise<GateResult>}
 */
async function gateDrift(ctx) {
  const g = gate(GATES[5]);
  const brandDir = path.join(ctx.root, 'brand');
  const markFile = path.join(brandDir, 'mark.svg');
  if (!existsSync(markFile)) return g.fail('brand/mark.svg is missing: emit the brand folder (04-brand.md step 9) before checking copies', { file: 'brand/mark.svg' });
  if (!ctx.browser) return g.skip('needs the browser to compare drawings; frontend-check launches one');
  const brandFiles = readdirSync(brandDir).filter((f) => f.toLowerCase().endsWith('.svg')).map((f) => ({ name: f.replace(/\.svg$/i, ''), file: path.join(brandDir, f) }));
  /** @type {{kind: string, brand: string | null, svg: string, viewBox: string | null, where: string, route?: string, file?: string}[]} */
  const copies = [];
  if (ctx.baseUrl) {
    for (const route of ctx.routes?.length ? ctx.routes : [firstRoute(ctx)]) {
      const url = routeUrl(ctx.baseUrl, route, ctx.profile);
      const found = await withPage(ctx.browser, desktopOf(ctx), url, (page, response) => {
        assertServed(response, url);
        return page.evaluate(collectCopies);
      }, { beforeGoto: targetOnly(ctx.baseUrl), readyFlag: ctx.profile?.ready_flag ?? false });
      for (const c of found) {
        let svg = c.svg;
        if (!svg && c.src) {
          const target = onTarget(c.src, ctx.baseUrl);
          if (!target.mapped) {
            const res = await fetchResource(target.url);
            if (res.status === 200) svg = res.body.toString('utf8');
          }
        }
        if (svg) copies.push({ kind: c.kind, brand: c.brand, svg, viewBox: c.viewBox, where: c.where, route: route.path });
      }
    }
    const head = await renderedHead(ctx);
    const iconLink = head.links.find(isSvgLink);
    if (iconLink) {
      const target = onTarget(iconLink.href, ctx.baseUrl);
      const res = target.mapped ? null : await fetchResource(target.url);
      if (res && res.status === 200) copies.push({ kind: 'icon.svg', brand: null, svg: res.body.toString('utf8'), viewBox: null, where: new URL(target.url).pathname, route: firstRoute(ctx).path });
    }
  }
  copies.push(...staticDataUris(ctx.root));
  const renderer = await Renderer.open({ browser: ctx.browser });
  /** @type {Evidence[]} */
  const drift = [];
  let equal = 0;
  let unrelated = 0;
  try {
    /** @type {Map<string, {mask: Uint8Array, aspect: number} | null>} */
    const brandSigs = new Map();
    /** @type {Map<string, string | null>} */
    const brandViewBoxes = new Map();
    for (const b of brandFiles) {
      const text = readText(b.file);
      brandSigs.set(b.name, await silhouetteOrNull(renderer, text));
      brandViewBoxes.set(b.name, viewBoxText(text));
    }
    const seen = new Set();
    for (const copy of copies) {
      const key = sha256(copy.svg);
      if (seen.has(key)) continue;
      seen.add(key);
      const sig = await silhouetteOrNull(renderer, copy.svg);
      const where = { route: copy.route, file: copy.file, selector: copy.where };
      if (!sig) {
        if (copy.brand || copy.kind === 'favicon-data-uri' || copy.kind === 'icon.svg') drift.push({ ...where, value: copy.kind, detail: `${copy.kind}${copy.brand ? ` (data-brand="${copy.brand}")` : ''} renders nothing` });
        continue;
      }
      /** @type {{name: string, score: number}} */
      let best = { name: '', score: 0 };
      for (const [name, bs] of brandSigs) {
        if (!bs) continue;
        const score = iou(sig.mask, bs.mask);
        if (score > best.score) best = { name, score };
      }
      const named = copy.brand ? copy.brand.replace(/[^a-z0-9._-]/gi, '') : null;
      if (named) {
        const target = brandSigs.get(named.replace(/\.svg$/i, ''));
        if (target === undefined) {
          drift.push({ ...where, value: named, detail: `data-brand="${named}" names brand/${named}.svg, which does not exist` });
          continue;
        }
        const score = target ? iou(sig.mask, target.mask) : 0;
        if (score < EQUAL_IOU) drift.push({ ...where, value: Math.round(score * 1000) / 1000, detail: `the copy marked data-brand="${named}" differs from brand/${named}.svg (silhouette overlap ${Math.round(score * 100)}%)` });
        else equal += 1;
        continue;
      }
      if (copy.kind === 'favicon-data-uri' || copy.kind === 'icon.svg') {
        if (best.score < EQUAL_IOU) drift.push({ ...where, value: Math.round(best.score * 1000) / 1000, detail: `the ${copy.kind === 'icon.svg' ? 'served icon.svg' : 'data-URI favicon'} differs from every file in brand/ (best: ${best.name || 'none'}, overlap ${Math.round(best.score * 100)}%)` });
        else equal += 1;
        continue;
      }
      if (best.score >= EQUAL_IOU) equal += 1;
      else if (best.score >= SIMILAR_IOU && copy.viewBox && copy.viewBox === brandViewBoxes.get(best.name)) {
        drift.push({ ...where, value: Math.round(best.score * 1000) / 1000, detail: `an inline copy of brand/${best.name}.svg has drifted (same viewBox, silhouette overlap ${Math.round(best.score * 100)}%)` });
      } else if (best.score >= SIMILAR_IOU && copy.kind !== 'inline-svg') {
        drift.push({ ...where, value: Math.round(best.score * 1000) / 1000, detail: `a data-URI copy resembles brand/${best.name}.svg but differs (overlap ${Math.round(best.score * 100)}%)` });
      } else unrelated += 1;
    }
  } finally {
    await renderer.close();
  }
  if (drift.length > 0) return g.fail(`${drift.length} drifted copy(ies): ${String(drift[0].detail)}; regenerate the copy from brand/ (BR-17)`, drift);
  if (!ctx.baseUrl && equal === 0) return g.skip('no rendered target (pass --serve or --url) and no inline copy found in the source; nothing to compare');
  return g.ok(`${equal} copy(ies) equal to brand/ (${unrelated} unrelated inline SVG(s) ignored)${ctx.baseUrl ? '' : '; source scan only'}`);
}

/** @param {Renderer} renderer @param {string} svg @returns {Promise<{mask: Uint8Array, aspect: number} | null>} */
async function silhouetteOrNull(renderer, svg) {
  try {
    return await silhouette(renderer, svg);
  } catch (err) {
    if (err instanceof EnvError) throw err;
    return null;
  }
}

/** @param {string} text @returns {string | null} */
function viewBoxText(text) {
  return /viewBox\s*=\s*["']([^"']+)["']/.exec(text)?.[1]?.trim().replace(/[\s,]+/g, ' ') ?? null;
}

/**
 * SVG data URIs written in source files (template strings, CSS, HTML): copies of a drawing that may never render
 * on the checked routes.
 * @param {string} root
 * @returns {{kind: string, brand: null, svg: string, viewBox: string | null, where: string, file: string}[]}
 */
export function staticDataUris(root) {
  /** @type {{kind: string, brand: null, svg: string, viewBox: string | null, where: string, file: string}[]} */
  const out = [];
  const files = walk(root, { include: ['*.{html,htm,js,jsx,ts,tsx,mjs,cjs,vue,svelte,css,scss}'], exclude: ['tests', 'test', '__tests__', 'fixtures'] });
  for (const rel of files) {
    let text;
    try {
      text = readFileSync(path.join(root, rel), 'utf8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(/data:image\/svg\+xml(;base64)?,([^"'`)\s]+)/gi)) {
      let svg = null;
      try {
        svg = m[1] ? Buffer.from(m[2], 'base64').toString('utf8') : decodeURIComponent(m[2]);
      } catch {
        svg = null;
      }
      if (!svg || !/<svg[\s>]/i.test(svg)) continue;
      const line = text.slice(0, m.index ?? 0).split('\n').length;
      out.push({ kind: 'source-data-uri', brand: null, svg, viewBox: viewBoxText(svg), where: `${rel}:${line}`, file: rel });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Module entry points

const RUNNERS = /** @type {Record<string, (ctx: CheckContext) => Promise<GateResult>>} */ ({
  'brand.candidates': gateCandidates,
  'brand.favicons': gateFavicons,
  'brand.templates': gateTemplates,
  'brand.icon-dark': gateIconDark,
  'brand.og': gateOg,
  'brand.drift': gateDrift,
});

/**
 * Runs the selected brand gates (all when `selected` is empty; ids of other groups are ignored, so frontend-check
 * may pass its whole selection). A gate whose check throws a CheckError (the target
 * misbehaves) or a UsageError (a project file the gate reads is malformed) fails with the message; environment
 * errors and bugs propagate, since a broken check must not read as a verdict.
 * @param {CheckContext} ctx
 * @param {readonly string[]} [selected]
 * @returns {Promise<GateResult[]>}
 */
export async function run(ctx, selected = GATE_IDS) {
  const ours = selected.filter((id) => id.trim() === 'brand' || id.trim().startsWith('brand.'));
  const wanted = expandSelection(selected.length ? ours : GATE_IDS);
  /** @type {GateResult[]} */
  const results = [];
  for (const id of GATE_IDS) {
    if (!wanted.includes(id)) continue;
    ctx.log?.(`brand-check: ${id}`);
    try {
      results.push(await RUNNERS[id](ctx));
    } catch (err) {
      if (err instanceof CheckError || err instanceof UsageError) {
        const meta = /** @type {import('./lib/report.mjs').GateMeta} */ (GATES.find((x) => x.id === id));
        results.push(gate(meta).fail(firstLine(err)));
      } else throw err;
    }
  }
  return results;
}

/**
 * Gate ids from a selection of ids and the group name `brand`.
 * @param {readonly string[]} selection
 * @returns {string[]}
 */
export function expandSelection(selection) {
  /** @type {string[]} */
  const out = [];
  for (const item of selection) {
    const s = item.trim();
    if (!s) continue;
    if (s === 'brand') out.push(...GATE_IDS);
    else if (GATE_IDS.includes(s)) out.push(s);
    else throw new UsageError(`unknown brand gate "${s}"; gates: brand, ${GATE_IDS.join(', ')}`);
  }
  return [...new Set(out)];
}

const HELP = `Usage: node brand-check.mjs [--root <repo>] [--profile <abs path>] [--state <dir>]
                            [--serve <dir> | --url <url>] [--gates <ids>] [--allow-skip <id>]... [--json] [--out <dir>]

Runs the brand gates of frontend-check (CONTRACTS section 4):
  brand.candidates  3 to 5 candidates under <state>/brand/candidates/<n>/ for a final name: candidate.json with the
                    intervention and the one feature, mark.svg without hard lint failures and with every look-twice
                    flag explained, renders current at 16, 32, 180 and 512 px with silhouettes (brand.mjs render)
  brand.favicons    the built head links favicon.ico (one 32x32 entry, sizes="32x32"), icon.svg (image/svg+xml),
                    apple-touch-icon 180x180 on a solid ground and a manifest with 192, 512 and maskable 512 icons
                    inside the safe zone; a raster above 48 px; nothing blocked by robots.txt
  brand.templates   no favicon whose normalised identity matches a framework template (create-vite, create-next-app)
  brand.icon-dark   icon.svg keeps a matching prefers-color-scheme rule and changes colour in emulated dark mode
  brand.og          og:image (absolute https, content hash in the URL) is 1200x630 and at most 8 MB, with
                    og:image:width, og:image:height, og:image:alt and twitter:card=summary_large_image
  brand.drift       every inlined copy of the mark (data-URI favicon, data-brand element, inline SVG with the same
                    viewBox, served icon.svg, data URIs in source) draws the same silhouette as its file in brand/

Options:
  --root <repo>        product repository (default: the working directory)
  --profile <path>     /execution profile.json or a frontend block (default: discovered under --root)
  --state <dir>        state folder (default: stateDir() of the profile's run mode)
  --serve <dir>        serve a static build on 127.0.0.1
  --url <url>          a running app
  --gates <ids>        comma-separated gate ids or the group "brand" (default: all six)
  --allow-skip <id>    let a skipped gate pass the report (repeatable; never in a task proof)
  --out <dir>          write the gate report there as brand-<UTC>.json
  --json               print the gate report on stdout

Exit codes: 0 every requested gate ok; 1 a gate failed or was skipped; 2 usage error; 3 environment error.`;

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const { values, positionals } = parseCli(argv, {
    options: {
      root: { type: 'string' }, profile: { type: 'string' }, state: { type: 'string' }, serve: { type: 'string' }, url: { type: 'string' },
      gates: { type: 'string' }, 'allow-skip': { type: 'string', multiple: true }, out: { type: 'string' }, json: { type: 'boolean' },
    },
    help: HELP,
  });
  if (positionals.length > 0) throw new UsageError(`unexpected argument ${positionals[0]}; run with --help`);
  if (values.serve && values.url) throw new UsageError('pass --serve or --url, not both');
  const selected = expandSelection(values.gates ? values.gates.split(',') : GATE_IDS);
  const root = path.resolve(values.root ?? process.cwd());
  if (!isDir(root)) throw new UsageError(`--root ${toPosix(root)} is not a folder`);
  const profile = loadProfile(values.profile, { root });
  const state = checkStateDir(root, profile, values.state ?? null, values.out);
  /** @type {import('./lib/serve.mjs').StaticServer | null} */
  let server = null;
  /** @type {Browser | null} */
  let browser = null;
  try {
    let baseUrl = values.url ?? null;
    if (baseUrl) {
      try {
        new URL(baseUrl);
      } catch (err) {
        throw new UsageError(`--url ${baseUrl} is not a valid URL`, { cause: err });
      }
    }
    if (values.serve) {
      server = await serveStatic(values.serve);
      baseUrl = server.url;
    }
    browser = await launch();
    /** @type {CheckContext} */
    const ctx = {
      root,
      profile,
      state,
      design: designDir(root, profile),
      routes: loadRoutes(root, profile),
      baseUrl,
      browser,
      viewports: profile.viewports,
      args: values,
      log: (line) => process.stderr.write(`${line}\n`),
    };
    const results = await run(ctx, selected);
    const report = aggregate(results, {
      allowSkip: values['allow-skip'] ?? [],
      requested: GATES.filter((x) => selected.includes(x.id)),
      tool: 'brand-check',
      target: { root: toPosix(root), url: baseUrl, routes: ctx.routes.length, viewports: [desktopOf(ctx).name] },
    });
    for (const r of report.gates) process.stderr.write(`${r.state.padEnd(7)} ${r.id}: ${r.detail}\n`);
    if (values.out) process.stderr.write(`report: ${writeReport(report, values.out, `brand-${utcStamp()}`)}\n`);
    if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  } finally {
    await browser?.close();
    await server?.close();
  }
}

/** @returns {boolean} */
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
