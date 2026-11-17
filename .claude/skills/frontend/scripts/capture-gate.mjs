// @ts-check
/**
 * The capture gate (research FD19, `research/policy-capture-etiquette.md`; not legal advice). It decides whether a
 * third-party reference page may be loaded and what may be kept, and it keeps the receipts:
 *   1. robots.txt (RFC 9309) is evaluated for `frontend-capture` and for `Claude-User`; the stricter wins.
 *   2. Machine-readable reservations stop automated capture: TDMRep (file, header, meta), Spawning ai.txt, IETF aipref
 *      `Content-Usage: ai-use=n` (robots rule or header).
 *   3. A bot wall stops the run: Cloudflare `cf-mitigated`, AWS WAF `x-amzn-waf-action`, a blocking status, a CAPTCHA,
 *      an interstitial. A silent challenge gets one passive wait with the same identity, nothing else.
 *   4. Nothing is stored before someone attests with `--terms-reviewed <url>` that the site terms neither forbid
 *      automated access nor reserve text and data mining; an advisory scan flags suspicious clauses.
 *   5. Captures live outside the project and outside every git work tree, with a SHA-256 manifest, and are destroyed
 *      with a deletion receipt (CPI R122-27).
 * One honest identity (the browser's own user agent plus UA_SUFFIX), headless only, no proxy, no stealth and zero
 * retries after a block, across runs: the per-host log remembers a block. None of this has an option.
 *
 * capture.mjs drives the browser through the functions here; this file's own CLI runs the network pre-flight
 * (`check`), the purge (`purge`) and prints the policy (`policy`).
 */
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { parseCli, isMainModule } from './lib/args.mjs';
import { CheckError, EnvError, UsageError, exitWith } from './lib/errors.mjs';
import { sha256File, sha256Text, toPosix, writeText } from './lib/fsutil.mjs';
import { loadProfile } from './lib/profile.mjs';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('playwright-core').BrowserContext} BrowserContext
 * @typedef {import('playwright-core').Page} Page
 * @typedef {import('playwright-core').Response} Response
 * @typedef {import('./lib/profile.mjs').Viewport} Viewport
 *
 * @typedef {'captured' | 'allowed' | 'skip-site' | 'stop' | 'needs-human-review' | 'refused'} Verdict
 * @typedef {{allow: boolean, pattern: string}} RobotsRule
 * @typedef {{agents: string[], rules: RobotsRule[], crawlDelay: number | null, contentUsage: string[]}} RobotsGroup
 * @typedef {{allowed: boolean, rule: string, crawlDelay: number, contentUsage: string[], groupsUsed: string[]}} RobotsDecision
 * @typedef {{allowed: boolean, crawlDelay: number, contentUsage: string[], perToken: Record<string, RobotsDecision>}} StricterDecision
 * @typedef {{userAgent?: string, timeoutMs?: number, maxBytes?: number, accept?: string, sameOrigin?: boolean}} FetchOptions
 * @typedef {{url: string, finalUrl: string, status: number, headers: Record<string, string>, text: string,
 *   error: string | null}} FetchResult
 * @typedef {(url: string, options?: FetchOptions) => Promise<FetchResult>} FetchImpl
 * @typedef {'captcha' | 'hard' | 'challenge' | 'interstitial'} BlockKind
 * @typedef {{blocked: boolean, kind: BlockKind | null, signal: string | null}} WallVerdict
 * @typedef {{status: number, headers?: Record<string, string>, title?: string, text?: string,
 *   visibleElements?: number | null, challengeSelector?: string | null}} ResponseSeen
 * @typedef {{status: number, headers: Record<string, string>, title: string, text: string, visibleElements: number,
 *   challengeSelector: string | null, tdmMeta: string | null}} PageSeen
 * @typedef {{name: string} & Record<string, unknown>} Step
 * @typedef {{verdict: Verdict | null, code: string | null, reason: string, steps: Step[], groups: RobotsGroup[],
 *   crawlDelay: number, robots: {status: number, perToken: Record<string, {allowed: boolean, rule: string}> | null}}} Preflight
 * @typedef {{ok: boolean, dir: string, reason: string}} StorageCheck
 * @typedef {{at: string, url: string, viewport: string, purpose: string}} Navigation
 * @typedef {{at: string, url: string, signal: string}} BlockRecord
 * @typedef {{version: 1, host: string, navigations: Navigation[], blocked: BlockRecord | null,
 *   captures: Array<{slug: string, url: string, at: string}>,
 *   runs: Array<{at: string, slug: string, url: string, verdict: string, reason: string}>}} HostLogData
 * @typedef {{name: string, sha256: string, bytes: number}} FileEntry
 * @typedef {{name: string, sha256: string | null, existedBefore: boolean, stillExists: boolean, error?: string}} DeletedEntry
 */

export const POLICY_ID = 'FD19';
export const GATE_VERSION = '1';
export const PRODUCT_TOKEN = 'frontend-capture';
export const ALSO_OBEY_TOKENS = Object.freeze(['Claude-User']);
export const UA_SUFFIX = ` (compatible; ${PRODUCT_TOKEN}/1.0; one-off design-reference capture, human-directed)`;
/** Identity of the plain fetches (robots.txt, TDMRep, ai.txt, terms): the product token, nothing borrowed. */
export const PLAIN_USER_AGENT = `Mozilla/5.0${UA_SUFFIX}`;
/** Design choices of the policy (FD19 P11, P17), not sourced standards. */
export const MIN_DELAY_MS = 10_000;
export const MAX_PAGES_PER_HOST = 3;
export const MAX_HOSTS = 4;
export const MAX_VIEWPORTS_PER_PAGE = 2;
export const MAX_SLICES_PER_VIEWPORT = 6;
export const RETRIES_AFTER_BLOCK = 0;
export const DEFAULT_RETENTION_DAYS = 7;
export const MAX_RETENTION_DAYS = 30;
/** A Crawl-delay longer than this is honoured by not capturing: the page is read by hand (P16). */
export const MAX_HONOURED_CRAWL_DELAY_S = 300;
export const NAV_TIMEOUT_MS = 30_000;
export const FETCH_TIMEOUT_MS = 20_000;
export const SILENT_CHALLENGE_GRACE_MS = 8_000;
/** Visible elements under which a page whose text reads like a challenge counts as an interstitial (tuned on 6 pages). */
export const NEAR_EMPTY_VISIBLE_ELEMENTS = 60;
export const MAX_BODY_BYTES = 5_000_000;
/** Navigation statuses that stop at once (P7). */
export const BLOCK_STATUSES = Object.freeze([401, 403, 405, 407, 429, 451, 503]);
/** robots.txt statuses read as a refusal of this client, stricter than RFC 9309's "unavailable" (P4). */
export const ROBOTS_REFUSAL_STATUSES = Object.freeze([401, 403, 407, 429]);
export const CAPTCHA_SELECTORS = Object.freeze([
  'iframe[src*="hcaptcha.com"]',
  'iframe[src*="/recaptcha/"]',
  'iframe[src*="captcha-delivery.com"]',
  '#px-captcha',
]);
export const CHALLENGE_SELECTORS = Object.freeze(['iframe[src*="challenges.cloudflare.com"]']);
/** Titles seen on challenge pages in FD05's first run, plus the vendor-neutral words they share. */
export const INTERSTITIAL_TEXT = /(un instant|just a moment|security check|v[ée]rification de s[ée]curit[ée]|verify (that )?you are (a )?human|access denied)/i;
export const TOS_LINK = /(terms|conditions|legal|cgu|mentions[- ]l[ée]gales|user agreement)/i;
export const TOS_CLAUSE = /(scrap(e|ing)|crawl(er|ing)?|spider|\brobots?\b|\bbots?\b|automated (means|program|programs|systems?|access|tools?|scripts?)|data[- ]mining|text and data mining|\btdm\b|harvest(ing)?|extraction automatis|fouille de textes|aspiration)/i;
/** Cookie and consent containers: their elements are third-party widgets, never part of a design reading. */
export const CONSENT_PATTERN = /(cookie|consent|onetrust|gdpr|cookiebot|didomi|truste|osano|usercentrics|termly|iubenda|\bcmp\b|cmp-|privacy-banner)/i;

/** File names of one capture folder `<captures root>/<host>/<slug>/`. */
export const CAPTURE_FILES = Object.freeze({
  manifest: 'manifest.json',
  receipt: 'gate-receipt.json',
  deletion: 'deletion-receipt.json',
  styles: 'styles.json',
  fonts: 'fonts.json',
  landmarks: 'landmarks.json',
  reveal: 'reveal.json',
  slices: 'slices',
});
/** Records kept after a purge: they prove what was stored and that it was destroyed. */
export const KEPT_FILES = Object.freeze([CAPTURE_FILES.manifest, CAPTURE_FILES.receipt, CAPTURE_FILES.deletion]);
export const HOST_LOG = 'host-log.json';
const HOST_LOCK = '.capture.lock';
export const REFS_INDEX = 'refs-index.json';

/**
 * Initial computed values that styles.json leaves out of each element's `styles` (capture.mjs compacts
 * collectElements output with it, extract.mjs reads a missing key as this value).
 */
export const DEFAULT_STYLE_VALUES = Object.freeze({
  position: 'static', visibility: 'visible', opacity: '1', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
  backgroundClip: 'border-box', webkitBackgroundClip: 'border-box', backdropFilter: 'none', filter: 'none',
  mixBlendMode: 'normal', borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px',
  borderLeftWidth: '0px', borderRadius: '0px', boxShadow: 'none', fontStyle: 'normal', letterSpacing: 'normal',
  textTransform: 'none', marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingRight: '0px',
  paddingBottom: '0px', paddingLeft: '0px', gap: 'normal', transition: 'all', transitionProperty: 'all',
  transitionDuration: '0s', transitionTimingFunction: 'ease', animationName: 'none', transform: 'none',
  pointerEvents: 'auto', zIndex: 'auto', cursor: 'auto', gridTemplateColumns: 'none',
});

const SKILL_SCRIPTS = toPosix(path.dirname(fileURLToPath(import.meta.url)));

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/** The policy constants of FD19's deliverable, as this gate enforces them. */
export const POLICY = deepFreeze({
  policy: 'FD19 capture policy (not legal advice)',
  productToken: PRODUCT_TOKEN,
  alsoObeyRobotsTokens: [...ALSO_OBEY_TOKENS],
  userAgent: `<browser default UA>${UA_SUFFIX}`,
  plainUserAgent: PLAIN_USER_AGENT,
  limits: {
    hosts: MAX_HOSTS,
    pagesPerHost: MAX_PAGES_PER_HOST,
    viewportsPerPage: MAX_VIEWPORTS_PER_PAGE,
    slicesPerViewport: MAX_SLICES_PER_VIEWPORT,
    minDelayMsPerHost: MIN_DELAY_MS,
    maxHonouredCrawlDelayS: MAX_HONOURED_CRAWL_DELAY_S,
    robotsCacheMaxHours: 24,
    retriesAfterBlock: RETRIES_AFTER_BLOCK,
    silentChallengeGraceMs: SILENT_CHALLENGE_GRACE_MS,
    retentionDaysDefault: DEFAULT_RETENTION_DAYS,
    retentionDaysMax: MAX_RETENTION_DAYS,
  },
  robots: {
    '5xxOrNetworkError': 'skip-site',
    '401_403_407_429': 'stop',
    other4xx: 'allowed',
    challengeHeaderOnRobots: 'stop',
    patternsMayStartWithStar: true,
    commaSeparatedAgents: true,
    fetchedFresh: 'every run',
    crossOriginLinks: 'their own robots.txt is read first',
    redirects: 'a navigation redirected to another origin, or to a disallowed path, is aborted',
  },
  stopSignals: {
    headers: { 'cf-mitigated': ['challenge'], 'x-amzn-waf-action': ['challenge', 'captcha'] },
    status: [...BLOCK_STATUSES],
    status202EmptyBody: true,
    interstitialTitleRegex: INTERSTITIAL_TEXT.source,
    captchaSelectors: [...CAPTCHA_SELECTORS],
    challengeSelectors: [...CHALLENGE_SELECTORS],
    nearEmptyPageVisibleElements: NEAR_EMPTY_VISIBLE_ELEMENTS,
  },
  tdmReservation: {
    tdmrepFile: '/.well-known/tdmrep.json',
    tdmHeader: 'tdm-reservation: 1',
    tdmMeta: 'meta[name=tdm-reservation][content=1]',
    aiTxt: '/ai.txt disallowing the page or image files for *',
    contentUsage: 'ai-use=n (robots.txt rule or HTTP header)',
  },
  terms: {
    attestationRequiredToStore: '--terms-reviewed <url>',
    flaggedClause: 'a storing run must name a flagged page in --terms-reviewed',
    stopIfTermsForbid: ['automated access', 'scraping', 'crawling', 'robots or bots', 'data mining', 'text and data mining'],
  },
  storage: {
    outsideProjectRoot: true,
    outsideGitWorkTree: true,
    outsideSyncedFolders: true,
    manifest: 'sha256 per file',
    deleteWhen: 'brief extracted and checked; at the latest the end of the event',
    receipt: CAPTURE_FILES.deletion,
  },
  forbidden: [
    'user-agent change', 'headless-to-headed switch after a block', 'stealth plugin',
    'navigator.webdriver or fingerprint spoofing', 'CAPTCHA solver or farm', 'proxy, VPN or IP rotation',
    'CDP attach to a personal browser profile to pass a wall', 'archive mirror as a workaround',
    'captures in repo, site, deck, video or chat',
  ],
});

// ---------- target URL, host and page names ----------

/**
 * True for this machine's loopback names, where fixtures run over plain http.
 * @param {string} hostname
 * @returns {boolean}
 */
export function isLoopbackHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || /^127(?:\.\d{1,3}){3}$/.test(h);
}

/**
 * The page to capture: an absolute https URL without credentials (http only on loopback, for test fixtures).
 * The fragment is dropped.
 * @param {unknown} raw
 * @returns {URL}
 */
export function validateTargetUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new UsageError('--url is required: the https URL of the one reference page to capture');
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch (err) {
    throw new UsageError(`--url ${JSON.stringify(raw)} is not a URL; pass an absolute https URL`, { cause: err });
  }
  if (url.username || url.password) {
    throw new UsageError('--url carries credentials; capture public pages only, never behind a login (P10)');
  }
  const loopback = isLoopbackHost(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new UsageError(`--url must use https (plain http is accepted only on this machine's loopback); got ${url.protocol}//${url.host}`);
  }
  url.hash = '';
  return url;
}

/**
 * Folder name of a host: `host[:port]` with anything outside [a-z0-9.-] replaced by `_`.
 * @param {URL} url
 * @returns {string}
 */
export function hostKey(url) {
  return url.host.toLowerCase().replace(/[^a-z0-9.-]/g, '_');
}

/**
 * Folder name of a page: its path in lowercase words joined by hyphens (`index` for `/`), plus a short hash of
 * path and query when a query exists, the path has capitals or the name was cut, so two pages never share a folder.
 * @param {URL} url
 * @returns {string}
 */
export function pageSlug(url) {
  const raw = `${url.pathname}${url.search}`;
  let base = url.pathname.toLowerCase().replace(/\.html?$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (base === '') base = 'index';
  const cut = base.length > 48;
  base = base.slice(0, 48).replace(/-+$/, '');
  const needsHash = url.search !== '' || cut || url.pathname !== url.pathname.toLowerCase();
  return needsHash ? `${base}-${sha256Text(raw).slice(0, 8)}` : base;
}

/**
 * Two URLs name the same document when they are equal without fragment and trailing slash.
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean}
 */
export function sameDocument(a, b) {
  if (!a || !b) return false;
  const norm = (/** @type {string} */ s) => {
    try {
      const u = new URL(s);
      u.hash = '';
      return u.href.replace(/\/$/, '');
    } catch {
      return null;
    }
  };
  const na = norm(a);
  return na !== null && na === norm(b);
}

// ---------- RFC 9309 robots.txt ----------

/**
 * Parses robots.txt into groups. Consecutive user-agent lines share a group; other records (crawl-delay, sitemap,
 * content-usage) do not end it (RFC 9309 2.2.4). Tolerates comma-separated agents (erratum 8895) and patterns that
 * start with `*` (erratum 7995).
 * @param {string} text
 * @returns {RobotsGroup[]}
 */
export function parseRobots(text) {
  /** @type {RobotsGroup[]} */
  const groups = [];
  /** @type {RobotsGroup | null} */
  let current = null;
  let inAgentRun = false;
  let body = String(text ?? '');
  if (body.charCodeAt(0) === 0xfeff) body = body.slice(1);
  for (const raw of body.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !inAgentRun) {
        current = { agents: [], rules: [], crawlDelay: null, contentUsage: [] };
        groups.push(current);
      }
      for (const token of value.split(',')) if (token.trim()) current.agents.push(token.trim().toLowerCase());
      inAgentRun = true;
    } else if (key === 'allow' || key === 'disallow') {
      inAgentRun = false;
      if (current) current.rules.push({ allow: key === 'allow', pattern: value });
    } else if (current) {
      if (key === 'crawl-delay' && value !== '' && Number.isFinite(Number(value))) current.crawlDelay = Number(value);
      if (key === 'content-usage') current.contentUsage.push(value);
    }
  }
  return groups;
}

/**
 * Percent-encoding normalisation for matching: non-ASCII characters encoded, unreserved escapes decoded, the rest
 * upper-cased.
 * @param {string} s
 * @returns {string}
 */
function normalizePct(s) {
  let out = '';
  for (const ch of String(s)) out += (ch.codePointAt(0) ?? 0) > 0x7e ? encodeURIComponent(ch) : ch;
  return out.replace(/%([0-9a-fA-F]{2})/g, (_all, hex) => {
    const c = String.fromCharCode(parseInt(hex, 16));
    return /[A-Za-z0-9\-._~]/.test(c) ? c : `%${String(hex).toUpperCase()}`;
  });
}

/**
 * RFC 9309 path matching: `*` matches any sequence, a trailing `$` anchors the end.
 * @param {string} pattern
 * @param {string} pathAndQuery
 * @returns {boolean}
 */
export function robotsMatch(pattern, pathAndQuery) {
  let p = normalizePct(pattern);
  const anchored = p.endsWith('$');
  if (anchored) p = p.slice(0, -1);
  const body = p.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(normalizePct(pathAndQuery));
}

/**
 * @param {RobotsGroup[]} groups
 * @param {string} token
 * @returns {RobotsGroup[]}
 */
function groupsFor(groups, token) {
  const t = token.toLowerCase();
  const own = groups.filter((g) => g.agents.includes(t));
  return own.length ? own : groups.filter((g) => g.agents.includes('*'));
}

/**
 * The decision for one product token: its own groups (merged), else the `*` group; the longest match wins and
 * allow wins a tie; an empty pattern matches nothing; /robots.txt itself is always allowed.
 * @param {RobotsGroup[]} groups
 * @param {string} token
 * @param {string} pathAndQuery
 * @returns {RobotsDecision}
 */
export function robotsDecision(groups, token, pathAndQuery) {
  const applicable = groupsFor(groups, token);
  const crawlDelay = Math.max(0, ...applicable.map((g) => g.crawlDelay ?? 0));
  const contentUsage = applicable.flatMap((g) => g.contentUsage);
  const groupsUsed = applicable.map((g) => g.agents.join(','));
  if (pathAndQuery === '/robots.txt') return { allowed: true, rule: 'implicit', crawlDelay, contentUsage, groupsUsed };
  /** @type {(RobotsRule & {len: number}) | null} */
  let best = null;
  for (const g of applicable) {
    for (const r of g.rules) {
      if (!r.pattern) continue;
      if (!robotsMatch(r.pattern, pathAndQuery)) continue;
      const len = normalizePct(r.pattern).length;
      if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { ...r, len };
    }
  }
  return {
    allowed: best ? best.allow : true,
    rule: best ? `${best.allow ? 'allow' : 'disallow'}: ${best.pattern}` : 'none',
    crawlDelay,
    contentUsage,
    groupsUsed,
  };
}

/**
 * Evaluates every token and allows only when all allow (the stricter-of rule).
 * @param {RobotsGroup[]} groups
 * @param {string} pathAndQuery
 * @param {readonly string[]} [tokens]
 * @returns {StricterDecision}
 */
export function stricterOf(groups, pathAndQuery, tokens = [PRODUCT_TOKEN, ...ALSO_OBEY_TOKENS]) {
  /** @type {Record<string, RobotsDecision>} */
  const perToken = {};
  for (const t of tokens) perToken[t] = robotsDecision(groups, t, pathAndQuery);
  const decisions = Object.values(perToken);
  return {
    allowed: decisions.every((d) => d.allowed),
    crawlDelay: Math.max(0, ...decisions.map((d) => d.crawlDelay)),
    contentUsage: decisions.flatMap((d) => d.contentUsage),
    perToken,
  };
}

// ---------- TDMRep, ai.txt, aipref Content-Usage ----------

/**
 * TDMRep: the first rule whose `location` matches the path applies; `tdm-reservation: 1` is the Article 4 opt-out.
 * @param {unknown} json
 * @param {string} pathAndQuery
 * @returns {{reservation: 0 | 1 | null, policy: string | null, location: string | null}}
 */
export function tdmrepDecision(json, pathAndQuery) {
  if (!Array.isArray(json)) return { reservation: null, policy: null, location: null };
  for (const rule of json) {
    if (rule && typeof rule === 'object' && typeof rule.location === 'string' && robotsMatch(rule.location, pathAndQuery)) {
      const v = rule['tdm-reservation'];
      const reservation = v === 1 || v === '1' ? 1 : v === 0 || v === '0' ? 0 : null;
      return { reservation, policy: typeof rule['tdm-policy'] === 'string' ? rule['tdm-policy'] : null, location: rule.location };
    }
  }
  return { reservation: null, policy: null, location: null };
}

/**
 * Spawning ai.txt (robots.txt syntax): a reservation when it disallows the page or image files for `*`.
 * @param {string} text
 * @param {string} pathAndQuery
 * @returns {boolean}
 */
export function aiTxtReserves(text, pathAndQuery) {
  const groups = parseRobots(text);
  const page = robotsDecision(groups, '*', pathAndQuery);
  const images = ['/x.png', '/x.jpg', '/x.webp'].some((p) => !robotsDecision(groups, '*', p).allowed);
  return !page.allowed || images;
}

/**
 * IETF aipref: only `ai-use=n` stops a capture that hands the page to a model; `train-ai=n` does not apply.
 * @param {ReadonlyArray<string | null | undefined>} values
 * @returns {boolean}
 */
export function contentUsageReserves(values) {
  return values.some((v) => typeof v === 'string' && /(^|[\s,;])ai-use\s*=\s*"?n"?/i.test(v));
}

// ---------- bot walls ----------

/**
 * Classifies a response or a loaded page. `captcha` and `hard` stop at once; `challenge` and `interstitial` get one
 * passive wait (capture.mjs), never an interaction.
 * @param {ResponseSeen} seen
 * @returns {WallVerdict}
 */
export function classifyResponse({ status, headers = {}, title = '', text = '', visibleElements = null, challengeSelector = null }) {
  /** @type {Record<string, string>} */
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v).toLowerCase();
  if (h['x-amzn-waf-action'] === 'captcha') return { blocked: true, kind: 'captcha', signal: 'header x-amzn-waf-action: captcha (AWS WAF)' };
  if (challengeSelector && !/cloudflare/.test(challengeSelector)) return { blocked: true, kind: 'captcha', signal: `CAPTCHA element ${challengeSelector}` };
  if (h['cf-mitigated'] === 'challenge') return { blocked: true, kind: 'challenge', signal: 'header cf-mitigated: challenge (Cloudflare)' };
  if (h['x-amzn-waf-action'] === 'challenge') return { blocked: true, kind: 'challenge', signal: 'header x-amzn-waf-action: challenge (AWS WAF)' };
  if (BLOCK_STATUSES.includes(status)) return { blocked: true, kind: 'hard', signal: `HTTP ${status}` };
  if (status === 202 && !String(text).trim()) return { blocked: true, kind: 'challenge', signal: 'HTTP 202 with empty body' };
  if (challengeSelector) return { blocked: true, kind: 'challenge', signal: `challenge element ${challengeSelector}` };
  if (INTERSTITIAL_TEXT.test(title)) return { blocked: true, kind: 'interstitial', signal: `interstitial title "${title.slice(0, 80)}"` };
  if (visibleElements !== null && visibleElements < NEAR_EMPTY_VISIBLE_ELEMENTS && INTERSTITIAL_TEXT.test(String(text).slice(0, 2000))) {
    return { blocked: true, kind: 'interstitial', signal: 'interstitial text on a near-empty page' };
  }
  return { blocked: false, kind: null, signal: null };
}

// ---------- terms ----------

/**
 * Plain text of an HTML document (scripts, styles and tags removed, a few entities decoded, whitespace collapsed).
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Advisory scan of a terms page: the first clause mentioning automated access or data mining, with context.
 * @param {string} text plain text
 * @returns {{flagged: boolean, excerpt: string | null}}
 */
export function scanTermsText(text) {
  const hit = TOS_CLAUSE.exec(text);
  if (!hit) return { flagged: false, excerpt: null };
  return { flagged: true, excerpt: text.slice(Math.max(0, hit.index - 160), hit.index + 200) };
}

/**
 * @param {string} html
 * @returns {string}
 */
function titleOf(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? htmlToText(m[1]) : '';
}

// ---------- network: honest identity, no retries ----------

/**
 * @param {unknown} err
 * @returns {string}
 */
function messageOf(err) {
  const raw = err instanceof Error ? (err.cause instanceof Error ? `${err.message} (${err.cause.message})` : err.message) : String(err);
  return raw.split('\n')[0].trim();
}

/**
 * One GET over node:http(s), no redirect followed. node:http is used rather than fetch because fetch turns an
 * HTTP 407 into a network error, and the policy must see that status to stop (P4, P7).
 * @param {string} url
 * @param {{userAgent: string, timeoutMs: number, maxBytes: number, accept: string}} options
 * @returns {Promise<FetchResult & {location: string | null}>}
 */
function requestOnce(url, { userAgent, timeoutMs, maxBytes, accept }) {
  return new Promise((resolve) => {
    let settled = false;
    /** @param {FetchResult & {location: string | null}} result */
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const failed = (/** @type {unknown} */ err) => settle({ url, finalUrl: url, status: 0, headers: {}, text: '', error: messageOf(err), location: null });
    let u;
    try {
      u = new URL(url);
    } catch (err) {
      failed(err);
      return;
    }
    const client = u.protocol === 'https:' ? https : http;
    const req = client.request(u, { method: 'GET', headers: { 'user-agent': userAgent, accept, 'accept-encoding': 'gzip, deflate, br' } }, (res) => {
      /** @type {Record<string, string>} */
      const headers = {};
      for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
      const encoding = (headers['content-encoding'] ?? '').toLowerCase();
      /** @type {NodeJS.ReadableStream} */
      let body = res;
      if (encoding === 'gzip' || encoding === 'x-gzip') body = res.pipe(zlib.createGunzip());
      else if (encoding === 'deflate') body = res.pipe(zlib.createInflate());
      else if (encoding === 'br') body = res.pipe(zlib.createBrotliDecompress());
      /** @type {Buffer[]} */
      const chunks = [];
      let total = 0;
      const done = (/** @type {string | null} */ error) => settle({
        url,
        finalUrl: url,
        status: res.statusCode ?? 0,
        headers,
        text: Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8'),
        error,
        location: headers.location ?? null,
      });
      body.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        total += chunk.length;
        if (total >= maxBytes) {
          done(null);
          res.destroy();
        }
      });
      body.on('end', () => done(null));
      body.on('error', (err) => done(messageOf(err)));
    });
    const timer = setTimeout(() => req.destroy(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
    req.on('error', failed);
    req.end();
  });
}

/**
 * One GET with the plain identity: no cookies, no retry, at most 5 redirects (RFC 9309 2.3.1.2), and with
 * `sameOrigin` none that leaves the origin (the new origin's robots.txt was not read). A network failure is
 * status 0 with its message; the caller decides what it means.
 * @param {string} url
 * @param {FetchOptions} [options]
 * @returns {Promise<FetchResult>}
 */
export async function fetchText(url, { userAgent = PLAIN_USER_AGENT, timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_BODY_BYTES, accept = 'text/plain,text/html,application/json;q=0.9,*/*;q=0.1', sameOrigin = false } = {}) {
  let current = url;
  for (let hop = 0; ; hop += 1) {
    const res = await requestOnce(current, { userAgent, timeoutMs, maxBytes, accept });
    if (![301, 302, 303, 307, 308].includes(res.status) || !res.location) return { ...res, url, finalUrl: current };
    let next;
    try {
      next = new URL(res.location, current);
    } catch {
      return { ...res, url, finalUrl: current, error: `redirect to an invalid location ${res.location}` };
    }
    if (!/^https?:$/.test(next.protocol)) return { ...res, url, finalUrl: current, error: `redirect to ${next.protocol} refused` };
    if (sameOrigin && next.origin !== new URL(url).origin) return { ...res, url, finalUrl: current, error: `redirects to another origin (${next.origin}), whose robots.txt was not read` };
    if (hop >= 5) return { ...res, url, finalUrl: current, error: 'more than 5 redirects' };
    current = next.href;
  }
}

/**
 * @param {Record<string, RobotsDecision>} perToken
 * @returns {Record<string, {allowed: boolean, rule: string}>}
 */
function summarizeTokens(perToken) {
  return Object.fromEntries(Object.entries(perToken).map(([k, d]) => [k, { allowed: d.allowed, rule: d.rule }]));
}

/**
 * Reads one origin's robots.txt and turns its answer into the policy's verdict (P4): a challenge stops (even one
 * served with a 2xx status, such as AWS WAF's 202); 2xx is parsed; 401/403/407/429 stop; another 4xx means no
 * rules; 5xx or a network failure skips the site.
 * @param {string} origin
 * @param {FetchImpl} fetchImpl
 * @returns {Promise<{status: number, groups: RobotsGroup[], verdict: Verdict | null, code: string | null, reason: string, step: Step}>}
 */
export async function readRobots(origin, fetchImpl = fetchText) {
  const res = await fetchImpl(`${origin}/robots.txt`);
  const wall = classifyResponse({ status: res.status, headers: res.headers, text: res.text });
  if (wall.blocked && wall.kind !== 'hard') {
    return { status: res.status, groups: [], verdict: 'stop', code: 'bot-wall', reason: `bot wall on ${origin}/robots.txt: ${wall.signal}; no retry with another identity: use the owner's own notes (RF-12)`, step: { name: 'robots.txt', origin, status: res.status, botWall: wall.signal } };
  }
  if (res.status >= 200 && res.status < 300) {
    return { status: res.status, groups: parseRobots(res.text), verdict: null, code: null, reason: '', step: { name: 'robots.txt', origin, status: res.status } };
  }
  if (ROBOTS_REFUSAL_STATUSES.includes(res.status)) {
    return { status: res.status, groups: [], verdict: 'stop', code: 'robots-refused', reason: `${origin}/robots.txt answered HTTP ${res.status} to this client; the policy reads that as a refusal and stops (stricter than RFC 9309)`, step: { name: 'robots.txt', origin, status: res.status, note: 'refused to this client: stop' } };
  }
  if (res.status >= 400 && res.status < 500) {
    return { status: res.status, groups: [], verdict: null, code: null, reason: '', step: { name: 'robots.txt', origin, status: res.status, note: 'unavailable: RFC 9309 2.3.1.3 allows access' } };
  }
  return {
    status: res.status,
    groups: [],
    verdict: 'skip-site',
    code: 'robots-unreachable',
    reason: `${origin}/robots.txt is unreachable (${res.status ? `HTTP ${res.status}` : res.error}); RFC 9309 2.3.1.4 means complete disallow`,
    step: { name: 'robots.txt', origin, status: res.status, error: res.error, note: 'unreachable: complete disallow' },
  };
}

/**
 * Steps 1 and 2 of the gate: robots.txt for both tokens, then `/.well-known/tdmrep.json` and `/ai.txt`, each
 * fetched only when robots.txt allows its path. Returns `verdict: null` when the capture may go on.
 * @param {URL} target
 * @param {{fetchImpl?: FetchImpl, log?: (line: string) => void}} [options]
 * @returns {Promise<Preflight>}
 */
export async function preflight(target, { fetchImpl = fetchText, log = () => {} } = {}) {
  const origin = target.origin;
  const pathAndQuery = target.pathname + target.search;
  /** @type {Step[]} */
  const steps = [];
  /** @type {Preflight} */
  const result = { verdict: null, code: null, reason: '', steps, groups: [], crawlDelay: 0, robots: { status: 0, perToken: null } };
  const stopWith = (/** @type {Verdict} */ verdict, /** @type {string} */ code, /** @type {string} */ reason) => ({ ...result, verdict, code, reason });

  const robots = await readRobots(origin, fetchImpl);
  result.robots.status = robots.status;
  if (robots.verdict) {
    steps.push(robots.step);
    log(`gate: ${robots.reason}`);
    return stopWith(robots.verdict, robots.code ?? 'robots', robots.reason);
  }
  result.groups = robots.groups;
  const d = stricterOf(robots.groups, pathAndQuery);
  result.robots.perToken = summarizeTokens(d.perToken);
  result.crawlDelay = d.crawlDelay;
  steps.push({ ...robots.step, allowed: d.allowed, perToken: result.robots.perToken, crawlDelay: d.crawlDelay });
  if (!d.allowed) {
    const reason = `robots.txt disallows ${pathAndQuery} for ${Object.entries(d.perToken).filter(([, x]) => !x.allowed).map(([t, x]) => `${t} (${x.rule})`).join(' and ')}`;
    log(`gate: ${reason}`);
    return stopWith('skip-site', 'robots', reason);
  }
  log(`gate: robots.txt ${robots.status || 'absent'}: ${pathAndQuery} allowed for ${PRODUCT_TOKEN} and ${ALSO_OBEY_TOKENS.join(', ')}`);
  if (contentUsageReserves(d.contentUsage)) return stopWith('skip-site', 'tdm', 'robots.txt Content-Usage says ai-use=n (IETF aipref): no automated capture');

  for (const [name, wellKnown] of /** @type {const} */ ([['tdmrep.json', '/.well-known/tdmrep.json'], ['ai.txt', '/ai.txt']])) {
    if (!stricterOf(robots.groups, wellKnown).allowed) {
      steps.push({ name, skipped: 'disallowed by robots.txt' });
      continue;
    }
    const r = await fetchImpl(`${origin}${wellKnown}`, { sameOrigin: true });
    const wall = classifyResponse({ status: r.status, headers: r.headers, text: r.text });
    if (wall.blocked && wall.kind !== 'hard') {
      steps.push({ name, status: r.status, botWall: wall.signal });
      return stopWith('stop', 'bot-wall', `bot wall on ${wellKnown}: ${wall.signal}; no retry with another identity: use the owner's own notes (RF-12)`);
    }
    if (r.status === 200 && name === 'tdmrep.json') {
      /** @type {unknown} */
      let json = null;
      try {
        json = JSON.parse(r.text);
      } catch {
        json = null; // not JSON: the protocol is not implemented there
      }
      const t = tdmrepDecision(json, pathAndQuery);
      steps.push({ name, status: r.status, reservation: t.reservation, location: t.location });
      if (t.reservation === 1) return stopWith('skip-site', 'tdm', `TDMRep reserves text and data mining for ${t.location} (tdm-reservation: 1)`);
    } else if (r.status === 200 && name === 'ai.txt' && /^\s*(user-agent|disallow|allow)\s*:/im.test(r.text)) {
      const reserves = aiTxtReserves(r.text, pathAndQuery);
      steps.push({ name, status: r.status, reserves });
      if (reserves) return stopWith('skip-site', 'tdm', 'ai.txt disallows this page or image files for *');
    } else {
      steps.push({ name, status: r.status, error: r.error });
    }
  }
  if (result.crawlDelay > MAX_HONOURED_CRAWL_DELAY_S) {
    return stopWith('skip-site', 'crawl-delay', `robots.txt asks for a Crawl-delay of ${result.crawlDelay} s, longer than a capture can honour (${MAX_HONOURED_CRAWL_DELAY_S} s); read the site by hand (RF-12)`);
  }
  return result;
}

// ---------- browser: identity, navigation guard, classification ----------

/**
 * The capture identity: this browser's own default user agent, unchanged, plus UA_SUFFIX.
 * @param {Browser} browser
 * @returns {Promise<string>}
 */
export async function browserIdentity(browser) {
  const probe = await browser.newContext();
  try {
    const page = await probe.newPage();
    const ua = await page.evaluate(() => navigator.userAgent);
    return `${ua}${UA_SUFFIX}`;
  } finally {
    await probe.close();
  }
}

/**
 * A context for one viewport with the honest identity: the same emulation as lib/browser newContext (light scheme,
 * no reduced motion, en-US, UTC) and service workers blocked so every request goes through the navigation guard.
 * @param {Browser} browser
 * @param {Viewport} view
 * @param {string} userAgent the value of browserIdentity()
 * @returns {Promise<BrowserContext>}
 */
export async function captureContext(browser, view, userAgent) {
  if (!userAgent.endsWith(UA_SUFFIX)) throw new TypeError('captureContext: the user agent must be browserIdentity() (default UA plus UA_SUFFIX)');
  return browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.dpr ?? 1,
    isMobile: view.isMobile ?? false,
    hasTouch: view.hasTouch ?? false,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    locale: 'en-US',
    timezoneId: 'UTC',
    userAgent,
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
}

/**
 * @typedef {{blocked: boolean, url: string | null, reason: string, redirectTo: string | null, hops: string[]}} NavigationGuard
 */

/**
 * Guards every main-frame navigation of the page. A navigation that leaves the checked origin, or reaches a path
 * robots.txt disallows, is aborted before any request is sent. The main document is fetched by the guard itself
 * without following redirects (Playwright's route handler never sees a redirect's next hop): a redirect is
 * reported in `redirectTo` and aborted, and navigate() checks the next hop before loading it. Returns the live
 * guard record.
 * @param {Page} page
 * @param {URL} target
 * @param {RobotsGroup[]} groups
 * @returns {Promise<NavigationGuard>}
 */
export async function guardNavigation(page, target, groups) {
  /** @type {NavigationGuard} */
  const state = { blocked: false, url: null, reason: '', redirectTo: null, hops: [] };
  await page.route('**/*', async (route) => {
    const request = route.request();
    let mainFrame = false;
    try {
      mainFrame = request.isNavigationRequest() && request.frame() === page.mainFrame();
    } catch {
      mainFrame = false; // service-worker requests have no frame; they are not navigations
    }
    if (!mainFrame) {
      await route.fallback();
      return;
    }
    const u = new URL(request.url());
    const refusal = navigationRefusal(u, target, groups);
    if (refusal) {
      Object.assign(state, { blocked: true, url: u.href, reason: refusal });
      await route.abort('blockedbyclient');
      return;
    }
    /** @type {import('playwright-core').APIResponse} */
    let response;
    try {
      response = await route.fetch({ maxRedirects: 0, timeout: NAV_TIMEOUT_MS });
    } catch (err) {
      state.reason = `the page could not be fetched: ${messageOf(err)}`;
      await route.abort('failed');
      return;
    }
    const location = response.headers().location;
    if (response.status() >= 300 && response.status() < 400 && location) {
      state.redirectTo = new URL(location, u).href;
      await route.abort('aborted');
      return;
    }
    await route.fulfill({ response });
  });
  return state;
}

/**
 * Why a main-frame navigation to `u` may not be loaded, or null when it may.
 * @param {URL} u
 * @param {URL} target
 * @param {RobotsGroup[]} groups
 * @returns {string | null}
 */
function navigationRefusal(u, target, groups) {
  if (u.origin !== target.origin) return `leads to another origin (${u.origin}), whose robots.txt was not read`;
  if (!stricterOf(groups, u.pathname + u.search).allowed) return `leads to ${u.pathname}${u.search}, which robots.txt disallows`;
  return null;
}

/**
 * The one navigation of a viewport, no retry: loads the target and follows at most 5 redirects, each checked by
 * the guard's rules before it is requested. Returns the response of the page finally loaded, or the error.
 * @param {Page} page
 * @param {URL} target
 * @param {RobotsGroup[]} groups
 * @param {NavigationGuard} guard
 * @returns {Promise<{response: Response | null, error: string | null}>}
 */
export async function navigate(page, target, groups, guard) {
  let url = target.href;
  for (let hop = 0; hop <= 5; hop += 1) {
    guard.redirectTo = null;
    /** @type {{response: Response | null, error: string | null}} */
    let result;
    try {
      result = { response: await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }), error: null };
    } catch (err) {
      result = { response: null, error: messageOf(err) };
    }
    if (guard.blocked || !guard.redirectTo) return result;
    const next = new URL(guard.redirectTo);
    guard.hops.push(next.href);
    const refusal = navigationRefusal(next, target, groups);
    if (refusal) {
      Object.assign(guard, { blocked: true, url: next.href, reason: `redirects to ${next.href}, which ${refusal}` });
      return result;
    }
    url = next.href;
  }
  Object.assign(guard, { blocked: true, url, reason: 'redirects more than 5 times' });
  return { response: null, error: 'too many redirects' };
}

/**
 * What the loaded page shows the gate: status and headers of the main response, title, the start of the text,
 * visible element count, a CAPTCHA or challenge element, and a TDM meta tag.
 * @param {Page} page
 * @param {Response | null} response
 * @returns {Promise<PageSeen>}
 */
export async function inspectPage(page, response) {
  const inPage = await page.evaluate((selectors) => {
    const body = document.body;
    let visible = 0;
    if (body) {
      for (const el of Array.from(body.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) visible += 1;
      }
    }
    const tdm = document.querySelector('meta[name="tdm-reservation" i]');
    return {
      title: document.title || '',
      text: body ? body.innerText.slice(0, 4000) : '',
      visibleElements: visible,
      challengeSelector: selectors.find((s) => document.querySelector(s) !== null) ?? null,
      tdmMeta: tdm ? (tdm.getAttribute('content') || '').trim() : null,
    };
  }, [...CHALLENGE_SELECTORS, ...CAPTCHA_SELECTORS]).catch((err) => ({ title: '', text: '', visibleElements: 0, challengeSelector: null, tdmMeta: null, error: messageOf(err) }));
  /** @type {Record<string, string>} */
  let headers = {};
  if (response) {
    try {
      headers = await response.allHeaders();
    } catch (err) {
      headers = { 'x-frontend-capture-error': messageOf(err) };
    }
  }
  return { status: response ? response.status() : 0, headers, ...inPage };
}

/**
 * Classifies the navigation. A silent challenge or interstitial gets one passive wait (SILENT_CHALLENGE_GRACE_MS),
 * same identity, no interaction; still challenged, it is a block.
 * @param {Page} page
 * @param {Response | null} response
 * @param {{sleep?: (ms: number) => Promise<void>, navError?: string | null}} [options]
 * @returns {Promise<{seen: PageSeen, wall: WallVerdict, waited: boolean, blocked: boolean, signal: string | null}>}
 */
export async function classifyNavigation(page, response, { sleep = defaultSleep, navError = null } = {}) {
  let seen = await inspectPage(page, response);
  let wall = classifyResponse(seen);
  let waited = false;
  if (wall.blocked && (wall.kind === 'challenge' || wall.kind === 'interstitial')) {
    await sleep(SILENT_CHALLENGE_GRACE_MS);
    waited = true;
    const again = await inspectPage(page, null);
    const second = classifyResponse({ ...again, status: 200, headers: {} });
    if (!second.blocked && again.visibleElements >= NEAR_EMPTY_VISIBLE_ELEMENTS) {
      seen = { ...again, status: seen.status, headers: seen.headers };
      wall = { blocked: false, kind: null, signal: `admitted after a passive wait (${wall.signal})` };
    }
  }
  const blocked = wall.blocked || (Boolean(navError) && !seen.visibleElements);
  return { seen, wall, waited, blocked, signal: wall.blocked ? wall.signal : navError ?? wall.signal };
}

/**
 * A reservation carried by the page itself: `tdm-reservation: 1` header or meta, or `Content-Usage: ai-use=n`.
 * @param {PageSeen} seen
 * @returns {string | null} the signal, or null
 */
export function pageReservation(seen) {
  const header = String(seen.headers['tdm-reservation'] ?? '').trim();
  if (header === '1') return 'TDM reservation (HTTP header tdm-reservation: 1)';
  if (seen.tdmMeta === '1') return 'TDM reservation (HTML meta tdm-reservation = 1)';
  if (contentUsageReserves([seen.headers['content-usage']])) return 'Content-Usage header says ai-use=n';
  return null;
}

/**
 * Advisory terms scan (step 5): the first two links that look like terms. A same-origin link obeys the target's
 * robots.txt; a cross-origin link obeys its own origin's robots.txt, read first. Every response is classified, and a
 * wall on any of them is reported (the run stops).
 * @param {Page} page
 * @param {{target: URL, groups: RobotsGroup[], fetchImpl?: FetchImpl}} options
 * @returns {Promise<{candidates: string[], scanned: Array<Record<string, unknown>>, flagged: Array<{url: string, excerpt: string | null}>,
 *   wall: {url: string, signal: string, host: string} | null}>}
 */
export async function scanTerms(page, { target, groups, fetchImpl = fetchText }) {
  const candidates = await page.evaluate((source) => {
    const re = new RegExp(source, 'i');
    const found = Array.from(document.querySelectorAll('a[href]'))
      .filter((a) => re.test(a.textContent || '') || re.test(a.getAttribute('href') || ''))
      .map((a) => /** @type {HTMLAnchorElement} */ (a).href.split('#')[0]);
    return [...new Set(found)].slice(0, 8);
  }, TOS_LINK.source);
  /** @type {Array<Record<string, unknown>>} */
  const scanned = [];
  /** @type {Map<string, RobotsGroup[] | string>} */
  const robotsByOrigin = new Map([[target.origin, groups]]);
  for (const href of candidates.filter((h) => /^https?:/i.test(h)).slice(0, 2)) {
    const u = new URL(href);
    let linkGroups = robotsByOrigin.get(u.origin);
    if (linkGroups === undefined) {
      const r = await readRobots(u.origin, fetchImpl);
      if (r.verdict === 'stop') return { candidates, scanned, flagged: [], wall: { url: `${u.origin}/robots.txt`, signal: r.reason, host: hostKey(u) } };
      linkGroups = r.verdict ? r.reason : r.groups;
      robotsByOrigin.set(u.origin, linkGroups);
    }
    if (typeof linkGroups === 'string') {
      scanned.push({ url: href, skipped: linkGroups });
      continue;
    }
    if (!stricterOf(linkGroups, u.pathname + u.search).allowed) {
      scanned.push({ url: href, skipped: 'disallowed by robots.txt' });
      continue;
    }
    const res = await fetchImpl(href, { sameOrigin: true });
    const wall = classifyResponse({ status: res.status, headers: res.headers, text: res.text, title: titleOf(res.text) });
    if (wall.blocked) return { candidates, scanned, flagged: [], wall: { url: href, signal: wall.signal ?? 'blocked', host: hostKey(u) } };
    const plain = htmlToText(res.text);
    const hit = scanTermsText(plain);
    scanned.push({ url: href, status: res.status, error: res.error, textChars: plain.length, flagged: hit.flagged, excerpt: hit.excerpt });
  }
  const flagged = scanned.filter((s) => s.flagged === true).map((s) => ({ url: String(s.url), excerpt: /** @type {string | null} */ (s.excerpt ?? null) }));
  return { candidates, scanned, flagged, wall: null };
}

// ---------- storage guard ----------

/**
 * @param {string} p
 * @returns {string | null}
 */
function nearestExisting(p) {
  let d = path.resolve(p);
  for (;;) {
    if (existsSync(d)) return d;
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

/**
 * Absolute path with the existing part resolved by the OS (links and Windows 8.3 short names expanded), so two
 * spellings of one folder compare equal.
 * @param {string} p
 * @returns {string}
 */
export function canonicalPath(p) {
  const abs = path.resolve(p);
  const existing = nearestExisting(abs);
  if (!existing) return abs;
  let real = existing;
  try {
    real = realpathSync.native(existing);
  } catch {
    real = existing; // an existing path the OS cannot resolve (permissions): compare it as written
  }
  return path.join(real, path.relative(existing, abs));
}

/**
 * @param {string} child
 * @param {string} parent
 * @returns {boolean}
 */
export function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * A `.git` that marks a work tree: a folder holding HEAD, or a file pointing to a git dir (worktrees, submodules).
 * A stray `.git` folder without HEAD is not a repository, and git itself ignores it.
 * @param {string} p
 * @returns {boolean}
 */
function isGitMarker(p) {
  try {
    const st = statSync(p);
    if (st.isDirectory()) return existsSync(path.join(p, 'HEAD'));
    return st.isFile() && /^gitdir:\s*\S/m.test(readFileSync(p, 'utf8'));
  } catch {
    return false; // absent or unreadable: not a marker
  }
}

/**
 * True when `dir`, or the nearest existing folder above it, is inside a git work tree: a `.git` marker in it or an
 * ancestor, or `git rev-parse` says so (GIT_DIR and GIT_WORK_TREE ignored). Creates nothing.
 * @param {string} dir
 * @returns {boolean}
 */
export function insideGitWorkTree(dir) {
  const existing = nearestExisting(canonicalPath(dir));
  if (!existing) return false;
  for (let d = existing; ;) {
    if (isGitMarker(path.join(d, '.git'))) return true;
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  const r = spawnSync('git', ['-C', existing, 'rev-parse', '--is-inside-work-tree'], { env, encoding: 'utf8', timeout: 10_000, windowsHide: true });
  return r.status === 0 && String(r.stdout).trim() === 'true';
}

const SYNCED_SEGMENTS = [
  /^onedrive(?:\s*-.*)?$/i, /^dropbox(?:\s*\(.*\))?$/i, /^google ?drive$/i, /^my drive$/i, /^icloud ?drive$/i,
  /^iclouddrive$/i, /^box(?: sync)?$/i, /^nextcloud$/i, /^owncloud$/i, /^pcloud ?drive$/i, /^cloudstorage$/i,
  /^mobile documents$/i,
];

/**
 * The sync client a folder sits in (OneDrive from its environment variables, else a known sync folder name), or
 * null.
 * @param {string} dir
 * @returns {string | null}
 */
export function syncedFolder(dir) {
  const abs = canonicalPath(dir);
  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const root = process.env[key];
    if (root && root.trim() && isInside(abs, canonicalPath(root))) return `${key} (${toPosix(root)})`;
  }
  const segment = abs.split(/[\\/]+/).find((s) => SYNCED_SEGMENTS.some((re) => re.test(s)));
  return segment ?? null;
}

/**
 * Where captures may be stored (P12): outside the project root, outside every synced folder and outside every git
 * work tree. Checks without creating anything, so a refused run leaves no folder behind.
 * @param {string} dir
 * @param {string | null | undefined} projectRoot
 * @returns {StorageCheck}
 */
export function checkStorage(dir, projectRoot) {
  const out = canonicalPath(dir);
  const shown = toPosix(out);
  if (projectRoot) {
    const root = canonicalPath(projectRoot);
    if (isInside(out, root)) {
      return { ok: false, dir: shown, reason: `capture folder ${shown} is inside the project root ${toPosix(root)}; captures never enter the product repository (P12): pass --out <folder outside it>` };
    }
  }
  const synced = syncedFolder(out);
  if (synced) {
    return { ok: false, dir: shown, reason: `capture folder ${shown} is inside a synced folder (${synced}); captures are never synced or shared (P12): pass --out <local folder>` };
  }
  if (insideGitWorkTree(out)) {
    return { ok: false, dir: shown, reason: `capture folder ${shown} is inside a git work tree; captures live outside every git work tree (P12): pass --out <folder>, for example under ${toPosix(os.tmpdir())}` };
  }
  return { ok: true, dir: shown, reason: '' };
}

/**
 * The captures root: --out, else `<workspace.private_dir>/frontend/captures`, else `<os tmp>/frontend-captures`.
 * @param {string | null | undefined} out
 * @param {string | null | undefined} privateDir
 * @returns {string}
 */
export function resolveCapturesRoot(out, privateDir) {
  if (out) return path.resolve(out);
  if (privateDir) return path.resolve(privateDir, 'frontend', 'captures');
  return path.join(os.tmpdir(), 'frontend-captures');
}

// ---------- per-host log: pacing, block memory, one capture at a time ----------

/**
 * @param {number} pid
 * @returns {boolean}
 */
function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && typeof err === 'object' && 'code' in err && err.code === 'EPERM');
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The record of one host under the captures root (`<root>/<host>/host-log.json`): navigations for pacing, the
 * block that ends all further attempts, the pages captured and every run's verdict. Opening it takes the host's
 * lock, so two captures of one host never run at once; release() gives it back.
 */
export class HostLog {
  /**
   * @param {string} file
   * @param {string} lockFile
   * @param {HostLogData} data
   */
  constructor(file, lockFile, data) {
    this.file = file;
    this.lockFile = lockFile;
    this.data = data;
  }

  /**
   * @param {string} capturesRoot
   * @param {string} host hostKey()
   * @param {{now?: Date}} [options]
   * @returns {HostLog}
   */
  static open(capturesRoot, host, { now = new Date() } = {}) {
    const dir = path.join(capturesRoot, host);
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      throw new EnvError(`cannot create ${toPosix(dir)} (${messageOf(err)}); pass --out <writable folder>`, { cause: err });
    }
    const lockFile = path.join(dir, HOST_LOCK);
    takeLock(lockFile, host, now);
    const file = path.join(dir, HOST_LOG);
    /** @type {HostLogData} */
    let data = { version: 1, host, navigations: [], blocked: null, captures: [], runs: [] };
    if (existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8'));
        if (isRecord(raw)) {
          data = {
            version: 1,
            host,
            navigations: Array.isArray(raw.navigations) ? raw.navigations : [],
            blocked: isRecord(raw.blocked) ? /** @type {BlockRecord} */ (raw.blocked) : null,
            captures: Array.isArray(raw.captures) ? raw.captures : [],
            runs: Array.isArray(raw.runs) ? raw.runs : [],
          };
        }
      } catch (err) {
        rmSync(lockFile, { force: true });
        throw new UsageError(`host log ${toPosix(file)} is not valid JSON (${messageOf(err)}); it records blocks and pacing, so fix it rather than delete it`, { cause: err });
      }
    }
    return new HostLog(file, lockFile, data);
  }

  /** @returns {BlockRecord | null} */
  get blocked() {
    return this.data.blocked;
  }

  /**
   * Milliseconds to wait before the next navigation on this host: at least MIN_DELAY_MS, or the Crawl-delay when
   * larger, after the last navigation.
   * @param {Date} now
   * @param {number} crawlDelaySeconds
   * @returns {number}
   */
  waitMs(now, crawlDelaySeconds = 0) {
    const last = this.data.navigations.at(-1);
    if (!last) return 0;
    const gap = Math.max(MIN_DELAY_MS, Math.round((crawlDelaySeconds || 0) * 1000));
    const at = Date.parse(last.at);
    if (!Number.isFinite(at)) return gap;
    return Math.max(0, at + gap - now.getTime());
  }

  /** @param {Navigation} entry */
  recordNavigation(entry) {
    this.data.navigations.push(entry);
    if (this.data.navigations.length > 200) this.data.navigations = this.data.navigations.slice(-200);
    this.save();
  }

  /** @param {BlockRecord} entry */
  recordBlock(entry) {
    if (!this.data.blocked) this.data.blocked = entry;
    this.save();
  }

  /** @param {{slug: string, url: string, at: string}} entry */
  recordCapture(entry) {
    this.data.captures = this.data.captures.filter((c) => c.slug !== entry.slug).concat(entry);
    this.save();
  }

  /** @param {{at: string, slug: string, url: string, verdict: string, reason: string}} entry */
  recordRun(entry) {
    this.data.runs.push(entry);
    if (this.data.runs.length > 200) this.data.runs = this.data.runs.slice(-200);
    this.save();
  }

  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeText(tmp, `${JSON.stringify(this.data, null, 2)}\n`);
    renameSync(tmp, this.file);
  }

  release() {
    rmSync(this.lockFile, { force: true });
  }
}

/**
 * @param {string} lockFile
 * @param {string} host
 * @param {Date} now
 */
function takeLock(lockFile, host, now) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockFile, 'wx');
      writeFileSync(fd, `${JSON.stringify({ pid: process.pid, at: now.toISOString() })}\n`);
      closeSync(fd);
      return;
    } catch (err) {
      if (!(err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST')) {
        throw new EnvError(`cannot take the capture lock ${toPosix(lockFile)} (${messageOf(err)}); check the folder's permissions`, { cause: err });
      }
      /** @type {{pid?: number, at?: string}} */
      let holder = {};
      try {
        holder = JSON.parse(readFileSync(lockFile, 'utf8'));
      } catch {
        holder = {}; // a lock file cut short by a crash: its process is gone
      }
      if (holder.pid && holder.pid !== process.pid && processAlive(holder.pid)) {
        throw new EnvError(`another capture of ${host} is running (pid ${holder.pid}, since ${holder.at}); captures run one host at a time (RF-13): wait for it to finish`);
      }
      rmSync(lockFile, { force: true });
    }
  }
  throw new EnvError(`cannot take the capture lock ${toPosix(lockFile)}; delete it if no capture of ${host} is running`);
}

/**
 * Capture folders (`<root>/<host>/<slug>/` holding a manifest.json) under a captures root.
 * @param {string} capturesRoot
 * @returns {string[]}
 */
export function listCaptureDirs(capturesRoot) {
  if (!existsSync(capturesRoot)) return [];
  /** @type {string[]} */
  const out = [];
  for (const host of readdirSync(capturesRoot, { withFileTypes: true })) {
    if (!host.isDirectory()) continue;
    const hostDir = path.join(capturesRoot, host.name);
    for (const page of readdirSync(hostDir, { withFileTypes: true })) {
      if (page.isDirectory() && existsSync(path.join(hostDir, page.name, CAPTURE_FILES.manifest))) out.push(path.join(hostDir, page.name));
    }
  }
  return out.sort();
}

/**
 * The policy limits a storing run must respect before any request (P11, P17): never the same page twice, at most
 * MAX_PAGES_PER_HOST pages per host and MAX_HOSTS hosts per captures root.
 * @param {string} capturesRoot
 * @param {string} host
 * @param {string} slug
 * @returns {{code: string, reason: string} | null}
 */
export function captureLimits(capturesRoot, host, slug) {
  /** @type {Map<string, string[]>} */
  const byHost = new Map();
  for (const dir of listCaptureDirs(capturesRoot)) {
    const h = path.basename(path.dirname(dir));
    byHost.set(h, [...(byHost.get(h) ?? []), path.basename(dir)]);
  }
  const pages = byHost.get(host) ?? [];
  if (pages.includes(slug)) {
    return { code: 'already-captured', reason: `${host}/${slug} was already captured; a page is never refetched to refresh a capture (P17)` };
  }
  if (pages.length >= MAX_PAGES_PER_HOST) {
    return { code: 'page-limit', reason: `${host} already has ${pages.length} captured pages; the policy keeps at most ${MAX_PAGES_PER_HOST} per host (P11)` };
  }
  if (!byHost.has(host) && byHost.size >= MAX_HOSTS) {
    return { code: 'host-limit', reason: `${byHost.size} hosts are already captured under ${toPosix(capturesRoot)}; the policy keeps at most ${MAX_HOSTS} (P11)` };
  }
  return null;
}

// ---------- capture records: manifest, gate receipt, purge ----------

/**
 * @param {string} file
 * @param {unknown} value
 * @returns {string}
 */
export function writeJson(file, value) {
  return writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Reads a JSON file; a missing or malformed file is a UsageError naming it.
 * @param {string} file
 * @param {string} what
 * @returns {any}
 */
export function readJson(file, what) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    throw new UsageError(`${what} not found: ${toPosix(path.resolve(file))}; check the path`, { cause: err });
  }
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (err) {
    throw new UsageError(`${what} ${toPosix(path.resolve(file))} is not valid JSON (${messageOf(err)}); fix or regenerate it`, { cause: err });
  }
}

/**
 * SHA-256 and size of each stored file of a capture folder.
 * @param {string} dir
 * @param {string[]} names forward-slash names relative to `dir`
 * @returns {FileEntry[]}
 */
export function fileEntries(dir, names) {
  return [...names].sort().map((name) => {
    const file = path.join(dir, ...name.split('/'));
    return { name, sha256: sha256File(file), bytes: statSync(file).size };
  });
}

/**
 * Writes manifest.json, then gate-receipt.json carrying the manifest's own SHA-256 so either one proves the other.
 * @param {string} dir
 * @param {{manifest: Record<string, unknown>, receipt: Record<string, unknown>}} records
 * @returns {{manifestPath: string, receiptPath: string, manifestSha256: string, receipt: Record<string, unknown>}}
 */
export function writeCaptureRecords(dir, { manifest, receipt }) {
  const manifestPath = writeJson(path.join(dir, CAPTURE_FILES.manifest), { kind: 'capture-manifest', policy: POLICY_ID, ...manifest });
  const manifestSha256 = sha256File(manifestPath);
  const full = { kind: 'capture', policy: POLICY_ID, ...receipt, manifest: { file: CAPTURE_FILES.manifest, sha256: manifestSha256 } };
  const receiptPath = writeJson(path.join(dir, CAPTURE_FILES.receipt), full);
  return { manifestPath, receiptPath, manifestSha256, receipt: full };
}

/**
 * A manifest file name must stay inside its capture folder and never name a kept record.
 * @param {unknown} name
 * @param {string} manifestPath
 * @returns {string}
 */
function safeName(name, manifestPath) {
  const bad = typeof name !== 'string' || name === '' || path.isAbsolute(name) || /^[a-zA-Z]:/.test(name)
    || name.split(/[\\/]+/).some((s) => s === '..' || s === '.' || s === '')
    || /** @type {readonly string[]} */ (KEPT_FILES).includes(/** @type {string} */ (name));
  if (bad) {
    throw new UsageError(`${toPosix(manifestPath)} lists ${JSON.stringify(name)}, which is not a file inside the capture folder; the manifest was edited by hand: restore it, or delete the folder yourself`);
  }
  return /** @type {string} */ (name).replace(/\\/g, '/');
}

/**
 * Removes the empty sub-folders of a capture folder (bottom-up), never the folder itself.
 * @param {string} dir
 */
function removeEmptySubfolders(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(dir, entry.name);
    removeEmptySubfolders(sub);
    if (readdirSync(sub).length === 0) rmdirSync(sub);
  }
}

/**
 * Deletes every file the manifest lists and writes deletion-receipt.json (names, SHA-256, existed before, still
 * exists, deletion time, on time against deleteBy). manifest.json and gate-receipt.json are kept as proof. A second
 * purge of a purged folder returns the first receipt unchanged.
 * @param {string} dir
 * @param {{now?: Date}} [options]
 * @returns {Record<string, any>}
 */
export function purgeCapture(dir, { now = new Date() } = {}) {
  const abs = path.resolve(dir);
  const manifestPath = path.join(abs, CAPTURE_FILES.manifest);
  if (!existsSync(manifestPath)) throw new UsageError(`no ${CAPTURE_FILES.manifest} in ${toPosix(abs)}; pass a capture folder made by capture.mjs`);
  const manifest = readJson(manifestPath, 'capture manifest');
  if (!isRecord(manifest) || !Array.isArray(manifest.files)) {
    throw new UsageError(`${toPosix(manifestPath)} has no files list; it is not a capture manifest`);
  }
  const receiptPath = path.join(abs, CAPTURE_FILES.deletion);
  const previous = existsSync(receiptPath) ? readJson(receiptPath, 'deletion receipt') : null;
  /** @type {DeletedEntry[]} */
  const deleted = [];
  for (const f of manifest.files) {
    const name = safeName(isRecord(f) ? f.name : f, manifestPath);
    const file = path.join(abs, ...name.split('/'));
    const existedBefore = existsSync(file);
    /** @type {DeletedEntry} */
    const entry = { name, sha256: isRecord(f) && typeof f.sha256 === 'string' ? f.sha256 : null, existedBefore, stillExists: false };
    if (existedBefore) {
      try {
        rmSync(file, { force: true });
      } catch (err) {
        entry.error = messageOf(err);
      }
    }
    entry.stillExists = existsSync(file);
    deleted.push(entry);
  }
  removeEmptySubfolders(abs);
  if (isRecord(previous) && previous.ok === true && deleted.every((d) => !d.existedBefore && !d.stillExists)) {
    return { ...previous, alreadyPurged: true };
  }
  const deleteBy = typeof manifest.deleteBy === 'string' ? manifest.deleteBy : null;
  const receipt = {
    kind: 'deletion-receipt',
    policy: POLICY_ID,
    purpose: 'deletion receipt for text-and-data-mining copies (CPI R122-27)',
    url: manifest.url ?? null,
    host: manifest.host ?? null,
    slug: manifest.slug ?? null,
    capturedAt: manifest.capturedAt ?? null,
    deleteBy,
    deletedAt: now.toISOString(),
    onTime: deleteBy ? now.getTime() <= Date.parse(deleteBy) : null,
    ok: deleted.every((d) => !d.stillExists),
    deleted,
    kept: [...KEPT_FILES],
    ...(isRecord(previous) ? { previousDeletedAt: previous.deletedAt ?? null } : {}),
  };
  writeJson(receiptPath, receipt);
  return receipt;
}

/**
 * Purges one capture folder, or every capture under a captures root (or a host folder). With `state`, marks them
 * purged in `<state>/refs-index.json`.
 * @param {string} target
 * @param {{state?: string | null, now?: Date}} [options]
 * @returns {Array<{dir: string, receipt: Record<string, any>}>}
 */
export function purge(target, { state = null, now = new Date() } = {}) {
  const abs = path.resolve(target);
  if (!existsSync(abs)) throw new UsageError(`${toPosix(abs)} does not exist; pass a capture folder or the captures root`);
  let dirs;
  if (existsSync(path.join(abs, CAPTURE_FILES.manifest))) dirs = [abs];
  else {
    dirs = listCaptureDirs(abs);
    if (dirs.length === 0) {
      dirs = readdirSync(abs, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(path.join(abs, e.name, CAPTURE_FILES.manifest)))
        .map((e) => path.join(abs, e.name));
    }
  }
  if (dirs.length === 0) throw new UsageError(`no capture (${CAPTURE_FILES.manifest}) under ${toPosix(abs)}; pass a capture folder or the captures root`);
  const results = dirs.map((d) => ({ dir: toPosix(d), receipt: purgeCapture(d, { now }) }));
  if (state) markPurgedInIndex(state, results);
  return results;
}

// ---------- refs-index.json in the state folder ----------

/**
 * @param {string} stateDir
 * @returns {{version: 1, captures_root: string | null, captures: Array<Record<string, any>>}}
 */
export function readRefsIndex(stateDir) {
  const file = path.join(stateDir, REFS_INDEX);
  if (!existsSync(file)) return { version: 1, captures_root: null, captures: [] };
  const raw = readJson(file, 'refs index');
  if (!isRecord(raw) || !Array.isArray(raw.captures)) {
    throw new UsageError(`${toPosix(file)} is not a refs index ({version, captures_root, captures: [...]}); fix it`);
  }
  return { version: 1, captures_root: typeof raw.captures_root === 'string' ? raw.captures_root : null, captures: raw.captures.filter(isRecord) };
}

/**
 * Adds or replaces (by folder) one capture in `<state>/refs-index.json`.
 * @param {string} stateDir
 * @param {string} capturesRoot
 * @param {Record<string, any>} entry
 * @returns {string} the index path
 */
export function upsertRefsIndex(stateDir, capturesRoot, entry) {
  const index = readRefsIndex(stateDir);
  index.captures_root = toPosix(path.resolve(capturesRoot));
  index.captures = index.captures.filter((c) => c.dir !== entry.dir).concat(entry);
  return writeJson(path.join(stateDir, REFS_INDEX), index);
}

/**
 * @param {string} stateDir
 * @param {Array<{dir: string, receipt: Record<string, any>}>} results
 */
function markPurgedInIndex(stateDir, results) {
  const index = readRefsIndex(stateDir);
  for (const { dir, receipt } of results) {
    const entry = index.captures.find((c) => c.dir === dir);
    if (entry) {
      entry.purged = receipt.ok === true;
      entry.deletion_receipt = toPosix(path.join(dir, CAPTURE_FILES.deletion));
    }
  }
  writeJson(path.join(stateDir, REFS_INDEX), index);
}

// ---------- small shared helpers ----------

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The command that purges a capture folder.
 * @param {string} dir
 * @returns {string}
 */
export function purgeCommand(dir) {
  return `node "${SKILL_SCRIPTS}/capture-gate.mjs" purge "${toPosix(dir)}"`;
}

// ---------- CLI ----------

const HELP = `Usage:
  node capture-gate.mjs check --url <https url> [--out <captures root> | --profile <abs path>] [--root <repo>] [--json]
  node capture-gate.mjs purge <capture folder | host folder | captures root> [--state <dir>] [--json]
  node capture-gate.mjs policy [--json]

The FD19 capture gate (not legal advice). capture.mjs runs every step of it around a real capture; this CLI gives
the parts that need no browser.

  check    robots.txt (for ${PRODUCT_TOKEN} and Claude-User, the stricter wins), then /.well-known/tdmrep.json and
           /ai.txt when robots.txt allows them. No navigation, nothing stored. A host that blocked an earlier run is
           refused without any request (no retry after a block).
  purge    deletes the files a capture's manifest.json lists and writes deletion-receipt.json (names, SHA-256,
           deletion time); manifest.json and gate-receipt.json stay as proof. With --state, marks the captures
           purged in <state>/refs-index.json.
  policy   prints the policy constants this gate enforces.

Options:
  --url <url>        the page (https; plain http only on loopback, for fixtures)
  --out <dir>        captures root (default <workspace.private_dir>/frontend/captures, else <tmp>/frontend-captures)
  --profile <path>   profile with workspace.private_dir
  --root <repo>      the product repository; the captures root must lie outside it
  --state <dir>      state folder holding refs-index.json (purge)
  --json             machine report on stdout
  -h, --help         this text

There is no option to change the user agent, run headed, use a proxy or retry after a block: the policy has none.

Exit codes: 0 allowed (check) or every file deleted (purge); 1 a policy refusal (verdict skip-site, stop,
needs-human-review or refused: read "verdict" and "reason" in the JSON, never the exit code alone) or a file that
could not be deleted; 2 usage error; 3 environment error.`;

/**
 * @param {readonly string[]} argv
 * @param {{fetchImpl?: FetchImpl, now?: () => Date, stdout?: (s: string) => void, stderr?: (s: string) => void}} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? ((s) => process.stdout.write(s));
  const stderr = deps.stderr ?? ((s) => process.stderr.write(s));
  const now = deps.now ?? (() => new Date());
  const { values, positionals } = parseCli(argv, {
    help: HELP,
    options: {
      url: { type: 'string' },
      out: { type: 'string' },
      profile: { type: 'string' },
      root: { type: 'string' },
      state: { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  const [command, ...rest] = positionals;
  if (command === 'policy') {
    if (rest.length) throw new UsageError(`unexpected argument ${rest[0]}; run with --help for usage`);
    stdout(`${JSON.stringify(POLICY, null, 2)}\n`);
    return 0;
  }
  if (command === 'purge') {
    if (rest.length !== 1) throw new UsageError('purge needs exactly one folder: a capture folder, a host folder or the captures root');
    const results = purge(rest[0], { state: values.state ? path.resolve(values.state) : null, now: now() });
    for (const { dir, receipt } of results) {
      stderr(`purge: ${dir}: ${receipt.alreadyPurged ? 'already purged' : `${receipt.deleted.filter((/** @type {DeletedEntry} */ d) => d.existedBefore).length} file(s) deleted`}${receipt.ok ? '' : ', SOME FILES REMAIN'}\n`);
    }
    if (values.json) stdout(`${JSON.stringify(results, null, 2)}\n`);
    const failed = results.filter((r) => r.receipt.ok !== true);
    if (failed.length) throw new CheckError(`${failed.length} capture(s) still hold files (${failed.map((f) => f.dir).join(', ')}); close what holds them and run purge again`);
    return 0;
  }
  if (command === 'check') {
    if (rest.length) throw new UsageError(`unexpected argument ${rest[0]}; run with --help for usage`);
    const target = validateTargetUrl(values.url);
    const profile = values.profile ? loadProfile(values.profile) : null;
    const root = resolveCapturesRoot(values.out, profile?.workspace.private_dir);
    const guard = checkStorage(root, values.root);
    /** @type {{verdict: string, code: string | null, reason: string, steps: Step[], crawlDelay?: number}} */
    let report;
    if (!guard.ok) report = { verdict: 'refused', code: 'storage', reason: guard.reason, steps: [] };
    else {
      const log = HostLog.open(root, hostKey(target), { now: now() });
      try {
        if (log.blocked) {
          report = { verdict: 'stop', code: 'blocked-before', reason: `${hostKey(target)} blocked this client at ${log.blocked.at} (${log.blocked.signal}); no retry after a block (P17)`, steps: [] };
        } else {
          const pre = await preflight(target, { fetchImpl: deps.fetchImpl, log: (l) => stderr(`${l}\n`) });
          if (pre.verdict === 'stop') log.recordBlock({ at: now().toISOString(), url: target.href, signal: pre.reason });
          report = { verdict: pre.verdict ?? 'allowed', code: pre.code, reason: pre.verdict ? pre.reason : 'robots.txt, TDMRep and ai.txt allow this page so far; the navigation checks and the terms review are still ahead (capture.mjs --dry-run)', steps: pre.steps, crawlDelay: pre.crawlDelay };
        }
        log.recordRun({ at: now().toISOString(), slug: pageSlug(target), url: target.href, verdict: `check:${String(report.verdict)}`, reason: String(report.reason) });
      } finally {
        log.release();
      }
    }
    const full = { tool: 'capture-gate', policy: POLICY_ID, version: GATE_VERSION, url: target.href, checkedAt: now().toISOString(), ...report };
    stderr(`check: ${target.href}: ${String(full.verdict)}${full.reason ? `: ${String(full.reason)}` : ''}\n`);
    if (values.json) stdout(`${JSON.stringify(full, null, 2)}\n`);
    if (full.verdict !== 'allowed') throw new CheckError(`capture refused for ${target.href} (${String(full.verdict)}): ${String(full.reason)}`);
    return 0;
  }
  throw new UsageError(command ? `unknown command ${command}; use check, purge or policy (--help)` : 'a command is required: check, purge or policy (--help)');
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
