// capture-gate.mjs — reference gate for /frontend reference-site capture (dossier FD19).
//
// Not legal advice. This script encodes the FD19 capture policy so that a machine, not
// good intentions, decides whether a third-party page may be captured:
//   1. robots.txt (RFC 9309) is evaluated for our own product token AND for "Claude-User";
//      the capture proceeds only if every token is allowed (stricter-of rule).
//   2. Machine-readable TDM reservations (TDMRep file/header/meta, Spawning ai.txt,
//      IETF aipref Content-Usage ai-use=n) stop automated capture.
//   3. A bot wall (Cloudflare cf-mitigated, AWS WAF x-amzn-waf-action, blocking HTTP
//      status, interstitial page) stops the run. There is deliberately NO option to change
//      the user agent, headless mode, proxy or fingerprint, and no retry after a block.
//   4. Nothing is stored until a human (or the model reading the page) attests with
//      --terms-reviewed <url> that the site terms neither forbid automated access nor reserve
//      text and data mining; an advisory scan flags suspicious clauses (exit code 4).
//   5. Captures are written outside any git work tree, listed with SHA-256 in a manifest,
//      and destroyed with --purge, which writes a deletion receipt (CPI R122-27).
//
// Usage:
//   node capture-gate.mjs --url https://www.example.com/ --project-root <repo> [--dry-run]
//                         [--terms-reviewed <terms-url>] [--out <dir>] [--viewports 1440x900,390x844]
//   node capture-gate.mjs --purge <capture-dir>
//   node --test capture-gate.test.mjs        (offline tests)
// Environment (optional):
//   PLAYWRIGHT_CORE_PATH  directory of an installed playwright-core package
//   CHROMIUM_PATH         Chromium executable to use instead of the bundled revision
//
// Exit codes: 0 allowed/captured, 2 robots.txt disallows, 3 bot wall, 4 needs human review
// (terms of use), 5 TDM reservation, 6 storage refused, 1 error.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PRODUCT_TOKEN = 'frontend-capture';
export const ALSO_OBEY_TOKENS = ['Claude-User'];
export const UA_SUFFIX = ` (compatible; ${PRODUCT_TOKEN}/1.0; one-off design-reference capture, human-directed)`;
export const MIN_DELAY_MS = 10_000; // design choice, not a standard: floor between navigations on one host
export const MAX_PAGES_PER_HOST = 3; // design choice
export const NAV_TIMEOUT_MS = 30_000;
export const SILENT_CHALLENGE_GRACE_MS = 8_000; // wait once, identity unchanged, never interact

const BLOCK_STATUSES = new Set([401, 403, 405, 407, 429, 451, 503]);
// Titles observed on challenge pages in FD05's first-round run (coinbase.json, revolut.json,
// coinbase h2, revolut h1) plus the vendor-neutral words they share.
const INTERSTITIAL_TEXT = /(un instant|just a moment|security check|v[ée]rification de s[ée]curit[ée]|verify (that )?you are (a )?human|access denied)/i;
const CHALLENGE_SELECTORS = [
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="hcaptcha.com"]',
  'iframe[src*="/recaptcha/"]',
  'iframe[src*="captcha-delivery.com"]',
  '#px-captcha',
];
const TOS_LINK = /(terms|conditions|legal|cgu|mentions[- ]l[ée]gales|user agreement)/i;
const TOS_CLAUSE = /(scrap(e|ing)|crawl(er|ing)?|spider|\brobots?\b|\bbots?\b|automated (means|program|programs|systems?|access|tools?|scripts?)|data[- ]mining|text and data mining|\btdm\b|harvest(ing)?|extraction automatis|fouille de textes|aspiration)/i;

// ---------- RFC 9309 robots.txt ----------

export function parseRobots(text) {
  const groups = [];
  let current = null;
  let inAgentRun = false;
  for (const raw of String(text).split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !inAgentRun) {
        current = { agents: [], rules: [], crawlDelay: null, contentUsage: [] };
        groups.push(current);
      }
      // RFC 9309 erratum 8895 (reported, optional): comma-separated tokens on one line.
      for (const token of value.split(',')) if (token.trim()) current.agents.push(token.trim().toLowerCase());
      inAgentRun = true;
    } else if (key === 'allow' || key === 'disallow') {
      inAgentRun = false;
      if (current) current.rules.push({ allow: key === 'allow', pattern: value });
    } else if (current) {
      // Other records must not terminate a group (RFC 9309 section 2.2.4).
      if (key === 'crawl-delay' && Number.isFinite(Number(value))) current.crawlDelay = Number(value);
      if (key === 'content-usage') current.contentUsage.push(value);
    }
  }
  return groups;
}

function normalizePct(s) {
  let out = '';
  for (const ch of String(s)) {
    out += ch.codePointAt(0) > 0x7e ? encodeURIComponent(ch) : ch;
  }
  return out.replace(/%([0-9a-fA-F]{2})/g, (all, hex) => {
    const c = String.fromCharCode(parseInt(hex, 16));
    return /[A-Za-z0-9\-._~]/.test(c) ? c : `%${hex.toUpperCase()}`;
  });
}

function matches(pattern, path) {
  let p = normalizePct(pattern);
  const anchored = p.endsWith('$');
  if (anchored) p = p.slice(0, -1);
  const body = p.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(normalizePct(path));
}

function groupsFor(groups, token) {
  const t = token.toLowerCase();
  const own = groups.filter((g) => g.agents.includes(t));
  return own.length ? own : groups.filter((g) => g.agents.includes('*'));
}

export function robotsDecision(groups, token, pathAndQuery) {
  if (pathAndQuery === '/robots.txt') return { allowed: true, rule: 'implicit' };
  const applicable = groupsFor(groups, token);
  let best = null;
  for (const g of applicable) {
    for (const r of g.rules) {
      if (!r.pattern) continue; // empty pattern matches nothing
      if (!matches(r.pattern, pathAndQuery)) continue;
      const len = normalizePct(r.pattern).length;
      if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { ...r, len };
    }
  }
  const crawlDelay = Math.max(0, ...applicable.map((g) => g.crawlDelay ?? 0));
  const contentUsage = applicable.flatMap((g) => g.contentUsage);
  return { allowed: best ? best.allow : true, rule: best ? `${best.allow ? 'allow' : 'disallow'}: ${best.pattern}` : 'none', crawlDelay, contentUsage, groupsUsed: applicable.map((g) => g.agents.join(',')) };
}

export function stricterOf(groups, pathAndQuery, tokens = [PRODUCT_TOKEN, ...ALSO_OBEY_TOKENS]) {
  const perToken = Object.fromEntries(tokens.map((t) => [t, robotsDecision(groups, t, pathAndQuery)]));
  const allowed = Object.values(perToken).every((d) => d.allowed);
  const crawlDelay = Math.max(0, ...Object.values(perToken).map((d) => d.crawlDelay));
  const contentUsage = Object.values(perToken).flatMap((d) => d.contentUsage);
  return { allowed, crawlDelay, contentUsage, perToken };
}

// ---------- TDMRep, ai.txt, aipref Content-Usage ----------

export function tdmrepDecision(json, path) {
  if (!Array.isArray(json)) return { reservation: null };
  for (const rule of json) {
    if (rule && typeof rule.location === 'string' && matches(rule.location, path)) {
      const v = rule['tdm-reservation'];
      return { reservation: v === 1 ? 1 : v === 0 ? 0 : null, policy: rule['tdm-policy'] ?? null, location: rule.location };
    }
  }
  return { reservation: null };
}

export function aiTxtReserves(text, path) {
  const groups = parseRobots(text);
  const d = robotsDecision(groups, '*', path);
  const imageDisallowed = ['/x.png', '/x.jpg', '/x.webp'].some((p) => !robotsDecision(groups, '*', p).allowed);
  return !d.allowed || imageDisallowed;
}

export function contentUsageReserves(values) {
  return values.some((v) => /(^|[\s,;])ai-use\s*=\s*"?n"?/i.test(v));
}

// ---------- bot wall classification ----------

export function classifyResponse({ status, headers = {}, title = '', text = '', visibleElements = null, challengeSelector = null }) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  // kind: 'captcha' and 'hard' stop at once; 'challenge' and 'interstitial' get one passive wait.
  if (h['x-amzn-waf-action'] === 'captcha') return { blocked: true, kind: 'captcha', signal: 'header x-amzn-waf-action: captcha (AWS WAF)' };
  if (challengeSelector && !/cloudflare/.test(challengeSelector)) return { blocked: true, kind: 'captcha', signal: `CAPTCHA element ${challengeSelector}` };
  if (h['cf-mitigated'] === 'challenge') return { blocked: true, kind: 'challenge', signal: 'header cf-mitigated: challenge (Cloudflare)' };
  if (h['x-amzn-waf-action'] === 'challenge') return { blocked: true, kind: 'challenge', signal: 'header x-amzn-waf-action: challenge (AWS WAF)' };
  if (BLOCK_STATUSES.has(status)) return { blocked: true, kind: 'hard', signal: `HTTP ${status}` };
  if (status === 202 && !text.trim()) return { blocked: true, kind: 'challenge', signal: 'HTTP 202 with empty body' };
  if (challengeSelector) return { blocked: true, kind: 'challenge', signal: `challenge element ${challengeSelector}` };
  if (INTERSTITIAL_TEXT.test(title)) return { blocked: true, kind: 'interstitial', signal: `interstitial title "${title}"` };
  if (visibleElements !== null && visibleElements < 60 && INTERSTITIAL_TEXT.test(text.slice(0, 2000))) return { blocked: true, kind: 'interstitial', signal: 'interstitial text on a near-empty page' };
  return { blocked: false, kind: null, signal: null };
}

// ---------- network helpers (honest identity, no retries) ----------

async function fetchText(url, userAgent) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': userAgent, accept: 'text/plain,text/html,application/json;q=0.9,*/*;q=0.1' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), text: text.slice(0, 5_000_000), url: res.url };
  } catch (error) {
    return { status: 0, headers: {}, text: '', error: String(error?.message ?? error) };
  }
}

// ---------- storage guard and purge ----------

function insideGitWorkTree(dir) {
  try {
    execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

export function checkStorage(outDir, projectRoot) {
  const out = resolve(outDir);
  const root = resolve(projectRoot);
  const rel = relative(root, out);
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) return { ok: false, reason: `capture dir ${out} is inside the project root ${root}` };
  mkdirSync(out, { recursive: true });
  if (insideGitWorkTree(out)) return { ok: false, reason: `capture dir ${out} is inside a git work tree` };
  return { ok: true, dir: out };
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function purge(captureDir) {
  const manifestPath = join(captureDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const deleted = [];
  for (const f of manifest.files) {
    const p = join(captureDir, f.name);
    if (existsSync(p)) rmSync(p, { force: true });
    deleted.push({ name: f.name, sha256: f.sha256, stillExists: existsSync(p) });
  }
  const receipt = { purpose: 'deletion receipt for text-and-data-mining copies (CPI R122-27)', url: manifest.url, capturedAt: manifest.capturedAt, deletedAt: new Date().toISOString(), deleted };
  writeFileSync(join(captureDir, 'deletion-receipt.json'), JSON.stringify(receipt, null, 2));
  return receipt;
}

// ---------- main gate ----------

async function loadChromium() {
  const base = process.env.PLAYWRIGHT_CORE_PATH;
  const mod = base ? await import(pathToFileURL(join(base, 'index.mjs')).href) : await import('playwright-core');
  return mod.chromium ?? mod.default.chromium;
}

export async function gate({ url, projectRoot, outDir, dryRun, viewports, termsReviewed }) {
  const target = new URL(url);
  const origin = target.origin;
  const pathAndQuery = target.pathname + target.search;
  const report = { url, origin, checkedAt: new Date().toISOString(), steps: [] };
  const step = (name, data) => report.steps.push({ name, ...data });

  // A provisional UA for plain fetches; the browser UA is its own default plus the same suffix.
  const plainUA = `Mozilla/5.0${UA_SUFFIX}`;

  // 1. robots.txt
  const robots = await fetchText(`${origin}/robots.txt`, plainUA);
  const robotsWall = classifyResponse({ status: robots.status, headers: robots.headers, text: robots.text });
  if (robots.status >= 200 && robots.status < 300) {
    const groups = parseRobots(robots.text);
    const d = stricterOf(groups, pathAndQuery);
    step('robots.txt', { status: robots.status, allowed: d.allowed, perToken: d.perToken, crawlDelay: d.crawlDelay });
    if (!d.allowed) return { ...report, verdict: 'skip-site', exitCode: 2, reason: 'robots.txt disallows the capture path for at least one of our tokens' };
    if (contentUsageReserves(d.contentUsage)) return { ...report, verdict: 'skip-site', exitCode: 5, reason: 'robots.txt Content-Usage says ai-use=n' };
    report.crawlDelay = d.crawlDelay;
    report.robotsGroups = groups;
  } else if (robotsWall.blocked && robotsWall.kind !== 'hard') {
    step('robots.txt', { status: robots.status, botWall: robotsWall.signal });
    return { ...report, verdict: 'stop', exitCode: 3, reason: `bot wall on robots.txt: ${robotsWall.signal}` };
  } else if ([401, 403, 407, 429].includes(robots.status)) {
    // RFC 9309 2.3.1.3 lets a crawler proceed on 4xx ("MAY"); this policy reads a refusal to serve
    // robots.txt to our identity as a refusal of our client and stops.
    step('robots.txt', { status: robots.status, note: 'refused to our client: policy stops (stricter than RFC 9309 MAY)' });
    return { ...report, verdict: 'stop', exitCode: 3, reason: `robots.txt answered HTTP ${robots.status} to our identity` };
  } else if (robots.status >= 400 && robots.status < 500) {
    step('robots.txt', { status: robots.status, note: 'unavailable: RFC 9309 2.3.1.3 allows access' });
  } else {
    step('robots.txt', { status: robots.status, error: robots.error ?? null, note: 'unreachable: RFC 9309 2.3.1.4 requires complete disallow' });
    return { ...report, verdict: 'skip-site', exitCode: 2, reason: 'robots.txt unreachable (5xx or network error): assume complete disallow' };
  }

  // 2. TDMRep file and Spawning ai.txt, each fetched only if robots.txt allows the path.
  const groups = report.robotsGroups ?? [];
  for (const [name, path] of [['tdmrep.json', '/.well-known/tdmrep.json'], ['ai.txt', '/ai.txt']]) {
    if (!stricterOf(groups, path).allowed) { step(name, { skipped: 'disallowed by robots.txt' }); continue; }
    const r = await fetchText(`${origin}${path}`, plainUA);
    const wall = classifyResponse({ status: r.status, headers: r.headers, text: r.text });
    if (wall.blocked && wall.kind !== 'hard') {
      step(name, { status: r.status, botWall: wall.signal });
      return { ...report, verdict: 'stop', exitCode: 3, reason: `bot wall on ${path}: ${wall.signal}. Do not retry with another identity; use the manual fallback.` };
    }
    if (r.status === 200 && name === 'tdmrep.json') {
      let json = null;
      try { json = JSON.parse(r.text); } catch { /* not JSON: protocol not implemented */ }
      const d = tdmrepDecision(json, pathAndQuery);
      step(name, { status: r.status, reservation: d.reservation, location: d.location ?? null });
      if (d.reservation === 1) return { ...report, verdict: 'skip-site', exitCode: 5, reason: `TDMRep reservation for ${d.location}` };
    } else if (r.status === 200 && name === 'ai.txt' && /^\s*(user-agent|disallow|allow)\s*:/im.test(r.text)) {
      const reserves = aiTxtReserves(r.text, pathAndQuery);
      step(name, { status: r.status, reserves });
      if (reserves) return { ...report, verdict: 'skip-site', exitCode: 5, reason: 'ai.txt disallows this path or image files' };
    } else {
      step(name, { status: r.status });
    }
  }

  // 3. One navigation with the browser's own identity.
  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const probe = await browser.newContext();
    const defaultUA = await (await probe.newPage()).evaluate(() => navigator.userAgent);
    await probe.close();
    const context = await browser.newContext({ userAgent: defaultUA + UA_SUFFIX });
    const page = await context.newPage();
    let response = null;
    let navError = null;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    } catch (error) {
      navError = String(error?.message ?? error).split('\n')[0];
    }
    const inspect = async () => ({
      status: response ? response.status() : 0,
      headers: response ? await response.allHeaders() : {},
      title: await page.title().catch(() => ''),
      text: await page.evaluate(() => document.body ? document.body.innerText.slice(0, 4000) : '').catch(() => ''),
      visibleElements: await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length).catch(() => 0),
      challengeSelector: await page.evaluate((sels) => sels.find((s) => document.querySelector(s)) ?? null, CHALLENGE_SELECTORS).catch(() => null),
      tdmMeta: await page.evaluate(() => document.querySelector('meta[name="tdm-reservation"]')?.content ?? null).catch(() => null),
    });
    let seen = await inspect();
    let verdict = classifyResponse(seen);
    if (verdict.blocked && (verdict.kind === 'challenge' || verdict.kind === 'interstitial')) {
      // A silent challenge may complete on its own. Wait once; never click, solve, or change identity.
      await page.waitForTimeout(SILENT_CHALLENGE_GRACE_MS);
      const again = await inspect();
      const verdict2 = classifyResponse({ ...again, status: 200, headers: {} });
      if (!verdict2.blocked && again.visibleElements >= 60) {
        seen = again;
        verdict = { blocked: false, kind: null, signal: `admitted after a passive wait (${verdict.signal})` };
      }
    }
    step('navigation', { status: seen.status, navError, title: seen.title, visibleElements: seen.visibleElements, userAgent: defaultUA + UA_SUFFIX, botWall: verdict.blocked ? verdict.signal : null, note: verdict.signal });
    if (verdict.blocked || (navError && !seen.visibleElements)) return { ...report, verdict: 'stop', exitCode: 3, reason: `bot wall or blocked navigation: ${verdict.signal ?? navError}. Do not retry with another identity; use the manual fallback.` };

    const headerTdm = seen.headers['tdm-reservation'];
    if (headerTdm === '1' || seen.tdmMeta === '1') return { ...report, verdict: 'skip-site', exitCode: 5, reason: `TDM reservation (${headerTdm === '1' ? 'HTTP header' : 'HTML meta'})` };
    if (contentUsageReserves([seen.headers['content-usage'] ?? ''])) return { ...report, verdict: 'skip-site', exitCode: 5, reason: 'Content-Usage header says ai-use=n' };

    // 4. Terms of use. Automatic discovery is unreliable (FD19 dry run: 0 of 2 admitted sites led the
    //    heuristic to the actual terms text), so the scan is advisory and a capture that stores anything
    //    requires --terms-reviewed <url>: a human (or the model, reading the page) attests that the terms
    //    at <url> neither forbid automated access nor reserve text and data mining.
    const candidates = await page.evaluate((reSource) => {
      const re = new RegExp(reSource, 'i');
      return [...new Set([...document.querySelectorAll('a[href]')].filter((el) => re.test(el.textContent || '') || re.test(el.getAttribute('href') || '')).map((el) => el.href.split('#')[0]))].slice(0, 8);
    }, TOS_LINK.source);
    const scanned = [];
    for (const href of candidates.slice(0, 2)) {
      const u = new URL(href);
      if (u.origin === origin && !stricterOf(groups, u.pathname + u.search).allowed) { scanned.push({ url: href, skipped: 'disallowed by robots.txt' }); continue; }
      const tos = await fetchText(href, plainUA);
      const plain = tos.text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const hit = plain.match(TOS_CLAUSE);
      scanned.push({ url: href, status: tos.status, textChars: plain.length, flagged: Boolean(hit), excerpt: hit ? plain.slice(Math.max(0, hit.index - 160), hit.index + 200) : null });
    }
    step('terms', { candidates, scanned, reviewedByHuman: termsReviewed ?? null });
    if (scanned.some((x) => x.flagged)) return { ...report, verdict: 'needs-human-review', exitCode: 4, reason: 'a terms page mentions automated access or data mining; read the clause. If it forbids automated access or reserves TDM, skip the site (manual fallback only).' };

    if (dryRun) return { ...report, verdict: 'allowed so far (dry run, nothing stored); terms still need a human read', exitCode: 0 };
    if (!termsReviewed) return { ...report, verdict: 'needs-human-review', exitCode: 4, reason: 'pass --terms-reviewed <url> after reading the site terms; nothing was stored' };

    // 5. Capture: measured facts plus viewport screenshots, outside the repository.
    const storage = checkStorage(outDir ?? join(tmpdir(), 'frontend-captures', `${target.hostname}-${Date.now()}`), projectRoot);
    if (!storage.ok) return { ...report, verdict: 'refused', exitCode: 6, reason: storage.reason };
    const files = [];
    for (const [i, vp] of viewports.entries()) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(1_000);
      const name = `viewport-${vp.width}x${vp.height}.png`;
      await page.screenshot({ path: join(storage.dir, name), fullPage: false });
      files.push({ name, sha256: sha256(join(storage.dir, name)) });
      if (i === 0) {
        const facts = await page.evaluate(() => {
          const pick = (el) => { const s = getComputedStyle(el); return { tag: el.tagName.toLowerCase(), fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color, background: s.backgroundColor, radius: s.borderRadius }; };
          return { body: pick(document.body), h1: document.querySelector('h1') ? pick(document.querySelector('h1')) : null, buttons: [...document.querySelectorAll('button, a[role="button"]')].slice(0, 5).map(pick) };
        });
        writeFileSync(join(storage.dir, 'facts.json'), JSON.stringify(facts, null, 2));
        files.push({ name: 'facts.json', sha256: sha256(join(storage.dir, 'facts.json')) });
      }
    }
    const manifest = { url, capturedAt: new Date().toISOString(), policy: 'FD19', userAgent: defaultUA + UA_SUFFIX, termsReviewed, files, deleteBy: 'end of extraction, and at the latest the end of the event' };
    writeFileSync(join(storage.dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return { ...report, verdict: 'captured', exitCode: 0, captureDir: storage.dir, purgeCommand: `node capture-gate.mjs --purge "${storage.dir}"` };
  } finally {
    await browser.close();
  }
}

// ---------- CLI ----------

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    if (process.argv.includes('--purge')) {
      console.log(JSON.stringify(purge(resolve(arg('--purge'))), null, 2));
      process.exit(0);
    }
    const url = arg('--url');
    const projectRoot = arg('--project-root');
    if (!url || !projectRoot) throw new Error('usage: --url <https://...> --project-root <repo> [--dry-run] [--terms-reviewed <url>] [--out <dir>]');
    if (!statSync(projectRoot).isDirectory()) throw new Error(`project root not found: ${projectRoot}`);
    const viewports = (arg('--viewports') ?? '1440x900,390x844').split(',').map((v) => { const [w, h] = v.split('x').map(Number); return { width: w, height: h }; });
    const result = await gate({ url, projectRoot, outDir: arg('--out'), dryRun: process.argv.includes('--dry-run'), viewports, termsReviewed: arg('--terms-reviewed') });
    delete result.robotsGroups;
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
  } catch (error) {
    console.error(`capture-gate error: ${error?.message ?? error}`);
    process.exit(1);
  }
}
