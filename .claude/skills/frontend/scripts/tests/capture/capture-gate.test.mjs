// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import * as g from '../../capture-gate.mjs';
import { CheckError, EnvError, UsageError } from '../../lib/errors.mjs';
import { closedPort, readFixture, removeDir, startServer, tempDir, writeJsonFile } from './helpers.mjs';

const GATE_CLI = fileURLToPath(new URL('../../capture-gate.mjs', import.meta.url));

/** @type {string[]} */
const cleanup = [];
after(() => {
  for (const dir of cleanup) removeDir(dir);
});

/**
 * @param {string} prefix
 * @returns {string}
 */
function scratch(prefix) {
  const dir = tempDir(prefix);
  cleanup.push(dir);
  return dir;
}

describe('robots.txt (RFC 9309)', () => {
  test('section 5.1 example: own groups, merged agents, the * group, patterns starting with *', () => {
    const groups = g.parseRobots(readFixture('robots', 'rfc9309-5-1.txt'));
    assert.equal(g.robotsDecision(groups, 'foobot', '/example/page.html').allowed, true);
    assert.equal(g.robotsDecision(groups, 'foobot', '/example/allowed.gif').allowed, true);
    assert.equal(g.robotsDecision(groups, 'foobot', '/other').allowed, false);
    assert.equal(g.robotsDecision(groups, 'barbot', '/example/page.html').allowed, false);
    assert.equal(g.robotsDecision(groups, 'bazbot', '/anything').allowed, true);
    assert.equal(g.robotsDecision(groups, 'quxbot', '/example/').allowed, true);
    assert.equal(g.robotsDecision(groups, 'unknownbot', '/a/b.gif').allowed, false);
    assert.equal(g.robotsDecision(groups, 'unknownbot', '/example/x').allowed, false);
    assert.equal(g.robotsDecision(groups, 'unknownbot', '/publications/x').allowed, true);
    assert.equal(g.robotsDecision(groups, 'unknownbot', '/robots.txt').allowed, true);
  });

  test('section 5.2: the longest match wins, allow wins a tie', () => {
    const groups = g.parseRobots('User-Agent: foobot\nAllow: /example/page/\nDisallow: /example/page/disallowed.gif\n');
    assert.equal(g.robotsDecision(groups, 'foobot', '/example/page/disallowed.gif').allowed, false);
    assert.equal(g.robotsDecision(groups, 'foobot', '/example/page/ok.gif').allowed, true);
    const tie = g.parseRobots('User-agent: *\nDisallow: /a\nAllow: /a\n');
    assert.equal(g.robotsDecision(tie, 'x', '/a').allowed, true);
  });

  test('other records do not end a group; tokens match case-insensitively; comma-separated agents', () => {
    const groups = g.parseRobots('User-agent: a\nCrawl-delay: 2\nUser-agent: B\nDisallow: /\n');
    assert.equal(g.robotsDecision(groups, 'A', '/x').allowed, false);
    assert.equal(g.robotsDecision(groups, 'b', '/x').allowed, false);
    assert.equal(g.robotsDecision(groups, 'a', '/x').crawlDelay, 2);
    const listed = g.parseRobots('User-agent: other, frontend-capture\nDisallow: /x\n');
    assert.equal(g.robotsDecision(listed, 'frontend-capture', '/x/y').allowed, false);
  });

  test('empty Disallow matches nothing, /robots.txt is always allowed, a BOM is ignored, %-escapes normalise', () => {
    assert.equal(g.robotsDecision(g.parseRobots('User-agent: *\nDisallow:\n'), 'x', '/any').allowed, true);
    assert.equal(g.robotsDecision(g.parseRobots('User-agent: *\nDisallow: /\n'), 'x', '/robots.txt').allowed, true);
    const bom = `${String.fromCharCode(0xfeff)}User-agent: *\nDisallow: /private\n`;
    assert.equal(g.robotsDecision(g.parseRobots(bom), 'x', '/private/a').allowed, false);
    const accented = g.parseRobots('User-agent: *\nDisallow: /caf%C3%A9\n');
    assert.equal(g.robotsDecision(accented, 'x', `/caf${String.fromCharCode(0xe9)}`).allowed, false);
    assert.equal(g.robotsDecision(g.parseRobots('User-agent: *\nDisallow: /a%2fb\n'), 'x', '/a%2Fb').allowed, false);
  });

  test('stricter-of: a Claude-User group, or a * group that frontend-capture falls back to, blocks the capture', () => {
    assert.equal(g.stricterOf(g.parseRobots(readFixture('robots', 'claude-user-disallowed.txt')), '/').allowed, false);
    assert.equal(g.stricterOf(g.parseRobots(readFixture('robots', 'star-disallowed.txt')), '/').allowed, false);
    const own = g.stricterOf(g.parseRobots(readFixture('robots', 'frontend-capture-disallowed.txt')), '/');
    assert.equal(own.allowed, false);
    assert.equal(own.perToken['frontend-capture'].allowed, false);
    assert.equal(own.perToken['Claude-User'].allowed, true);
  });

  test('query strings, JSON files and deep paths: the shapes seen in the FD19 survey', () => {
    const groups = g.parseRobots(readFixture('robots', 'query-and-json.txt'));
    assert.equal(g.stricterOf(groups, '/').allowed, true);
    assert.equal(g.stricterOf(groups, '/?utm=1').allowed, false);
    assert.equal(g.stricterOf(groups, '/send?amount=5').allowed, true);
    assert.equal(g.stricterOf(groups, '/.well-known/tdmrep.json').allowed, false);
    assert.equal(g.stricterOf(groups, '/join/').allowed, false);
  });
});

describe('machine-readable reservations', () => {
  test('TDMRep: the first matching location applies; 1 reserves', () => {
    const rules = [
      { location: '/directory-a/', 'tdm-reservation': 1 },
      { location: '/directory-b/html/', 'tdm-reservation': 1, 'tdm-policy': 'https://provider.example/policy.json' },
      { location: '/directory-b/images/*.jpg', 'tdm-reservation': 0 },
    ];
    assert.equal(g.tdmrepDecision(rules, '/directory-a/x.pdf').reservation, 1);
    assert.equal(g.tdmrepDecision(rules, '/directory-b/images/a.jpg').reservation, 0);
    assert.equal(g.tdmrepDecision(rules, '/other').reservation, null);
    assert.equal(g.tdmrepDecision(JSON.parse(readFixture('robots', 'tdmrep-reserved.json')), '/pricing').reservation, 1);
    assert.equal(g.tdmrepDecision({ not: 'an array' }, '/').reservation, null);
  });

  test('ai.txt reserves when it disallows the page or image files; Content-Usage stops only on ai-use=n', () => {
    assert.equal(g.aiTxtReserves(readFixture('robots', 'ai-txt-images.txt'), '/'), true);
    assert.equal(g.aiTxtReserves('User-agent: *\nAllow: /\n', '/'), false);
    assert.equal(g.aiTxtReserves('User-agent: *\nDisallow: /docs/\n', '/docs/a'), true);
    assert.equal(g.contentUsageReserves(['train-ai=n']), false);
    assert.equal(g.contentUsageReserves(['ai-use=n']), true);
    assert.equal(g.contentUsageReserves(['train-ai=y, ai-use=n']), true);
    assert.equal(g.contentUsageReserves([undefined, null, '']), false);
  });
});

describe('bot walls', () => {
  test('vendor headers, blocking statuses, CAPTCHA elements and interstitials are blocks; a normal page is not', () => {
    const kind = (/** @type {import('../../capture-gate.mjs').ResponseSeen} */ seen) => g.classifyResponse(seen).kind;
    assert.equal(kind({ status: 403, headers: { 'Cf-Mitigated': 'challenge' } }), 'challenge');
    assert.equal(kind({ status: 202, headers: { 'x-amzn-waf-action': 'challenge' }, text: '' }), 'challenge');
    assert.equal(kind({ status: 202, headers: {}, text: '' }), 'challenge');
    assert.equal(kind({ status: 405, headers: { 'x-amzn-waf-action': 'captcha' } }), 'captcha');
    for (const status of [401, 403, 405, 407, 429, 451, 503]) assert.equal(kind({ status }), 'hard', `HTTP ${status}`);
    assert.equal(kind({ status: 200, challengeSelector: 'iframe[src*="challenges.cloudflare.com"]' }), 'challenge');
    assert.equal(kind({ status: 200, challengeSelector: 'iframe[src*="/recaptcha/"]' }), 'captcha');
    assert.equal(kind({ status: 200, title: 'Un instant…', visibleElements: 22 }), 'interstitial');
    assert.equal(kind({ status: 200, title: 'Just a quick security check', visibleElements: 19 }), 'interstitial');
    assert.equal(kind({ status: 200, title: 'Home', text: 'Verify you are human to continue', visibleElements: 5 }), 'interstitial');
    assert.equal(g.classifyResponse({ status: 200, title: 'Banking and beyond', visibleElements: 498 }).blocked, false);
    assert.equal(g.classifyResponse({ status: 200, title: 'Home', text: 'Access denied pages are explained here', visibleElements: 400 }).blocked, false);
    assert.equal(g.classifyResponse({ status: 404 }).blocked, false);
  });
});

describe('terms scan (advisory)', () => {
  test('flags clauses on automated access or data mining, in English and French; leaves ordinary terms alone', () => {
    const flagged = g.scanTermsText(g.htmlToText(readFixture('site-flagged', 'terms.html')));
    assert.equal(flagged.flagged, true);
    assert.match(String(flagged.excerpt), /robot, spider, scraper/);
    assert.equal(g.scanTermsText('Toute extraction automatisée et fouille de textes est interdite.').flagged, true);
    assert.equal(g.scanTermsText('No data-mining of the content is permitted.').flagged, true);
    assert.equal(g.scanTermsText(g.htmlToText(readFixture('site-light', 'terms.html'))).flagged, false);
  });

  test('htmlToText drops scripts, styles and tags and decodes common entities', () => {
    const text = g.htmlToText('<style>p{}</style><script>var robots = 1;</script><p>Fish &amp; chips&nbsp;&lt;3 &#39;ok&#39;</p>');
    assert.equal(text, "Fish & chips <3 'ok'");
  });
});

describe('target URL, host and page names', () => {
  test('https only (http on loopback for fixtures), no credentials, fragment dropped', () => {
    assert.equal(g.validateTargetUrl('https://example.com/a#top').href, 'https://example.com/a');
    assert.equal(g.validateTargetUrl('http://127.0.0.1:8080/').host, '127.0.0.1:8080');
    assert.equal(g.validateTargetUrl('http://localhost/').hostname, 'localhost');
    for (const bad of ['http://example.com/', 'ftp://example.com/', 'https://user:pass@example.com/', 'not a url', '', undefined]) {
      assert.throws(() => g.validateTargetUrl(bad), UsageError, String(bad));
    }
  });

  test('host keys and page slugs are folder-safe and distinct per page', () => {
    assert.equal(g.hostKey(new URL('https://Example.com:8443/x')), 'example.com_8443');
    assert.equal(g.hostKey(new URL('https://www.example.com/')), 'www.example.com');
    assert.equal(g.pageSlug(new URL('https://a.example/')), 'index');
    assert.equal(g.pageSlug(new URL('https://a.example/en-fr/pricing/')), 'en-fr-pricing');
    assert.equal(g.pageSlug(new URL('https://a.example/terms.html')), 'terms');
    const withQuery = g.pageSlug(new URL('https://a.example/a?b=1'));
    assert.match(withQuery, /^a-[0-9a-f]{8}$/);
    assert.notEqual(withQuery, g.pageSlug(new URL('https://a.example/a?b=2')));
    assert.match(g.pageSlug(new URL('https://a.example/About')), /^about-[0-9a-f]{8}$/);
    const long = g.pageSlug(new URL(`https://a.example/${'segment/'.repeat(12)}`));
    assert.ok(long.length <= 57, long);
    assert.match(long, /-[0-9a-f]{8}$/);
  });

  test('sameDocument ignores the fragment and a trailing slash', () => {
    assert.equal(g.sameDocument('https://a.example/terms/', 'https://a.example/terms#x'), true);
    assert.equal(g.sameDocument('https://a.example/terms', 'https://a.example/privacy'), false);
    assert.equal(g.sameDocument(null, 'https://a.example/'), false);
  });
});

describe('storage guard (P12)', () => {
  test('refuses a folder inside the project, creating nothing', () => {
    const project = scratch('project');
    const target = path.join(project, 'captures', 'host');
    const result = g.checkStorage(target, project);
    assert.equal(result.ok, false);
    assert.match(result.reason, /inside the project root/);
    assert.equal(existsSync(path.join(project, 'captures')), false);
  });

  test('refuses a folder inside a git work tree (a .git marker, or git itself says so); a stray .git folder is not one', () => {
    const fake = scratch('fakegit');
    mkdirSync(path.join(fake, '.git', 'info'), { recursive: true });
    assert.equal(g.insideGitWorkTree(path.join(fake, 'a', 'b')), false, 'a .git folder without HEAD is not a repository');
    writeFileSync(path.join(fake, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    assert.equal(g.insideGitWorkTree(path.join(fake, 'a', 'b')), true);
    assert.equal(g.checkStorage(path.join(fake, 'a'), null).ok, false);
    const linked = scratch('gitfile');
    writeFileSync(path.join(linked, '.git'), 'gitdir: ../elsewhere/.git/worktrees/x\n');
    assert.equal(g.insideGitWorkTree(path.join(linked, 'captures')), true);
    const real = scratch('realgit');
    const init = spawnSync('git', ['init', '-q', real], { encoding: 'utf8', windowsHide: true });
    if (init.status === 0) {
      const result = g.checkStorage(path.join(real, 'deep', 'captures'), null);
      assert.equal(result.ok, false);
      assert.match(result.reason, /git work tree/);
    }
  });

  test('refuses synced folders and accepts a plain temp folder without creating it', () => {
    const base = scratch('synced');
    for (const name of ['OneDrive', 'OneDrive - Contoso', 'Dropbox', 'Google Drive', 'iCloud Drive']) {
      const result = g.checkStorage(path.join(base, name, 'captures'), null);
      assert.equal(result.ok, false, name);
      assert.match(result.reason, /synced folder/);
    }
    const free = path.join(scratch('free'), 'captures');
    assert.equal(g.checkStorage(free, scratch('elsewhere')).ok, true);
    assert.equal(existsSync(free), false);
  });

  test('compares the real paths, so a short (8.3) spelling of a folder inside the project is still refused', { skip: os.tmpdir() === realpathSync.native(os.tmpdir()) ? 'no short-name spelling of the temp folder on this machine' : false }, () => {
    const long = realpathSync.native(scratch('shortname'));
    const shortForm = path.join(os.tmpdir(), path.basename(long), 'captures');
    assert.equal(g.checkStorage(shortForm, long).ok, false);
  });

  test('the captures root is --out, else <private_dir>/frontend/captures, else <tmp>/frontend-captures', () => {
    assert.equal(g.resolveCapturesRoot('/x/out', '/p'), path.resolve('/x/out'));
    assert.equal(g.resolveCapturesRoot(null, '/p'), path.resolve('/p', 'frontend', 'captures'));
    assert.equal(g.resolveCapturesRoot(undefined, null), path.join(os.tmpdir(), 'frontend-captures'));
  });
});

describe('host log: pacing, block memory, one capture per host at a time', () => {
  test('waits at least MIN_DELAY_MS after the last navigation, or the Crawl-delay when longer', () => {
    const root = scratch('pacing');
    const log = g.HostLog.open(root, 'a.example');
    try {
      const t0 = new Date('2026-10-01T10:00:00Z');
      assert.equal(log.waitMs(t0, 0), 0);
      log.recordNavigation({ at: t0.toISOString(), url: 'https://a.example/', viewport: 'desktop', purpose: 'capture' });
      assert.equal(log.waitMs(t0, 0), g.MIN_DELAY_MS);
      assert.equal(log.waitMs(new Date(t0.getTime() + 4000), 0), 6000);
      assert.equal(log.waitMs(t0, 20), 20_000);
      assert.equal(log.waitMs(new Date(t0.getTime() + 30_000), 20), 0);
    } finally {
      log.release();
    }
  });

  test('a block is remembered across runs (no retry after a block)', () => {
    const root = scratch('block');
    const first = g.HostLog.open(root, 'b.example');
    first.recordBlock({ at: '2026-10-01T10:00:00.000Z', url: 'https://b.example/', signal: 'HTTP 403' });
    first.release();
    const second = g.HostLog.open(root, 'b.example');
    try {
      assert.equal(second.blocked?.signal, 'HTTP 403');
    } finally {
      second.release();
    }
  });

  test('the host lock refuses a second capture while its holder lives, and takes over a dead holder\'s lock', () => {
    const root = scratch('lock');
    mkdirSync(path.join(root, 'c.example'), { recursive: true });
    const lock = path.join(root, 'c.example', '.capture.lock');
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, at: '2026-10-01T10:00:00Z' }));
    assert.throws(() => g.HostLog.open(root, 'c.example'), (err) => err instanceof EnvError && /one host at a time/.test(err.message));
    writeFileSync(lock, JSON.stringify({ pid: 4_194_000, at: '2026-10-01T10:00:00Z' }));
    const log = g.HostLog.open(root, 'c.example');
    log.release();
    assert.equal(existsSync(lock), false);
  });

  test('a corrupted host log is a usage error and releases the lock', () => {
    const root = scratch('corrupt');
    mkdirSync(path.join(root, 'd.example'), { recursive: true });
    writeFileSync(path.join(root, 'd.example', g.HOST_LOG), '{not json');
    assert.throws(() => g.HostLog.open(root, 'd.example'), UsageError);
    assert.equal(existsSync(path.join(root, 'd.example', '.capture.lock')), false);
  });
});

describe('policy limits (P11, P17)', () => {
  /**
   * @param {string} root
   * @param {string} host
   * @param {string} slug
   */
  const fakeCapture = (root, host, slug) => writeJsonFile(path.join(root, host, slug, g.CAPTURE_FILES.manifest), { files: [] });

  test('never the same page twice, at most 3 pages per host and 4 hosts', () => {
    const root = scratch('limits');
    assert.equal(g.captureLimits(root, 'a.example', 'index'), null);
    fakeCapture(root, 'a.example', 'index');
    assert.equal(g.captureLimits(root, 'a.example', 'index')?.code, 'already-captured');
    fakeCapture(root, 'a.example', 'pricing');
    fakeCapture(root, 'a.example', 'about');
    assert.equal(g.captureLimits(root, 'a.example', 'blog')?.code, 'page-limit');
    for (const host of ['b.example', 'c.example', 'd.example']) fakeCapture(root, host, 'index');
    assert.equal(g.captureLimits(root, 'e.example', 'index')?.code, 'host-limit');
    assert.equal(g.captureLimits(root, 'b.example', 'pricing'), null);
    assert.deepEqual(g.listCaptureDirs(root).length, 6);
  });
});

describe('capture records and purge (CPI R122-27)', () => {
  /**
   * @param {string} root
   * @param {string} host
   * @returns {string}
   */
  const makeCapture = (root, host) => {
    const dir = path.join(root, host, 'index');
    mkdirSync(path.join(dir, 'slices'), { recursive: true });
    writeFileSync(path.join(dir, 'slices', 'desktop-00.png'), 'png bytes');
    writeFileSync(path.join(dir, 'styles.json'), '{}\n');
    const files = g.fileEntries(dir, ['slices/desktop-00.png', 'styles.json']);
    g.writeCaptureRecords(dir, {
      manifest: { url: `https://${host}/`, host, slug: 'index', capturedAt: '2026-10-01T10:00:00.000Z', deleteBy: '2099-01-01T00:00:00.000Z', viewports: [{ name: 'desktop' }], files },
      receipt: { tool: 'capture-gate', url: `https://${host}/`, verdict: 'captured', userAgent: `UA${g.UA_SUFFIX}`, termsReviewed: `https://${host}/terms` },
    });
    return dir;
  };

  test('the receipt carries the manifest hash; purge deletes the listed files, keeps the records and writes a receipt', () => {
    const root = scratch('purge');
    const dir = makeCapture(root, 'a.example');
    const receipt = JSON.parse(readFileSync(path.join(dir, g.CAPTURE_FILES.receipt), 'utf8'));
    assert.equal(receipt.kind, 'capture');
    assert.equal(receipt.manifest.sha256.length, 64);
    const state = scratch('state');
    g.upsertRefsIndex(state, root, { dir: dir.replace(/\\/g, '/'), purged: false });
    const [result] = g.purge(dir, { state, now: new Date('2026-10-02T10:00:00Z') });
    assert.equal(result.receipt.ok, true);
    assert.equal(result.receipt.onTime, true);
    assert.deepEqual(result.receipt.deleted.map((/** @type {{name: string}} */ d) => d.name), ['slices/desktop-00.png', 'styles.json']);
    assert.ok(result.receipt.deleted.every((/** @type {{existedBefore: boolean, stillExists: boolean}} */ d) => d.existedBefore && !d.stillExists));
    assert.equal(existsSync(path.join(dir, 'slices')), false);
    for (const kept of g.KEPT_FILES) assert.equal(existsSync(path.join(dir, kept)), true, kept);
    assert.equal(g.readRefsIndex(state).captures[0].purged, true);
    const again = g.purgeCapture(dir);
    assert.equal(again.alreadyPurged, true);
    assert.equal(again.deletedAt, result.receipt.deletedAt);
  });

  test('a manifest that names a file outside its folder is refused and nothing outside is touched', () => {
    const root = scratch('traversal');
    const outside = path.join(root, 'outside.txt');
    writeFileSync(outside, 'keep me');
    const dir = path.join(root, 'h.example', 'index');
    writeJsonFile(path.join(dir, g.CAPTURE_FILES.manifest), { files: [{ name: '../../outside.txt', sha256: 'x' }] });
    assert.throws(() => g.purgeCapture(dir), UsageError);
    assert.equal(existsSync(outside), true);
  });

  test('purging a captures root purges every capture under it; a folder without captures is a usage error', () => {
    const root = scratch('purgeall');
    makeCapture(root, 'a.example');
    makeCapture(root, 'b.example');
    const results = g.purge(root);
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.receipt.ok === true));
    assert.throws(() => g.purge(scratch('empty')), UsageError);
  });
});

describe('identity in the browser (no option exists to change it)', () => {
  test('browserIdentity keeps the default user agent and appends the product token', async () => {
    const fakeBrowser = /** @type {any} */ ({
      newContext: async () => ({ newPage: async () => ({ evaluate: async () => 'Mozilla/5.0 HeadlessChrome/147.0.0.0' }), close: async () => {} }),
    });
    assert.equal(await g.browserIdentity(fakeBrowser), `Mozilla/5.0 HeadlessChrome/147.0.0.0${g.UA_SUFFIX}`);
  });

  test('captureContext refuses any other user agent and passes no proxy', async () => {
    /** @type {Record<string, unknown>[]} */
    const seen = [];
    const fakeBrowser = /** @type {any} */ ({ newContext: async (/** @type {Record<string, unknown>} */ o) => { seen.push(o); return {}; } });
    const view = { name: 'desktop', width: 1440, height: 900, dpr: 1, isMobile: false, hasTouch: false };
    await assert.rejects(g.captureContext(fakeBrowser, view, 'Mozilla/5.0 Chrome/147.0.0.0'), TypeError);
    await g.captureContext(fakeBrowser, view, `Mozilla/5.0 HeadlessChrome/147${g.UA_SUFFIX}`);
    assert.equal(seen.length, 1);
    assert.ok(String(seen[0].userAgent).endsWith(g.UA_SUFFIX));
    assert.equal('proxy' in seen[0], false);
    assert.equal(seen[0].serviceWorkers, 'block');
  });

  test('the policy constants are frozen', () => {
    assert.equal(Object.isFrozen(g.POLICY.limits), true);
    assert.throws(() => {
      /** @type {any} */ (g.POLICY.limits).minDelayMsPerHost = 0;
    }, TypeError);
    assert.equal(g.POLICY.limits.retriesAfterBlock, 0);
  });
});

describe('pre-flight against local servers', () => {
  /** @type {import('./helpers.mjs').TestServer[]} */
  const servers = [];
  /**
   * @param {Record<string, import('./helpers.mjs').Route>} routes
   */
  const serve = async (routes) => {
    const s = await startServer(routes);
    servers.push(s);
    return s;
  };
  after(async () => {
    await Promise.all(servers.map((s) => s.close()));
  });
  /** @param {string} body */
  const robots = (body) => ({ body });

  test('allowed: robots.txt, then TDMRep and ai.txt, every request with the declared identity', async () => {
    const s = await serve({ '/robots.txt': robots(readFixture('site-light', 'robots.txt')) });
    const pre = await g.preflight(new URL(`${s.url}/`));
    assert.equal(pre.verdict, null);
    assert.deepEqual(s.requests.map((r) => r.url), ['/robots.txt', '/.well-known/tdmrep.json', '/ai.txt']);
    assert.ok(s.requests.every((r) => r.userAgent === g.PLAIN_USER_AGENT));
    assert.match(g.PLAIN_USER_AGENT, /frontend-capture\/1\.0/);
  });

  for (const [name, file] of [['frontend-capture', 'frontend-capture-disallowed.txt'], ['Claude-User', 'claude-user-disallowed.txt'], ['the * group', 'star-disallowed.txt']]) {
    test(`skip-site when robots.txt disallows the page for ${name}`, async () => {
      const s = await serve({ '/robots.txt': robots(readFixture('robots', file)) });
      const pre = await g.preflight(new URL(`${s.url}/`));
      assert.equal(pre.verdict, 'skip-site');
      assert.equal(pre.code, 'robots');
      assert.deepEqual(s.requests.map((r) => r.url), ['/robots.txt']);
    });
  }

  test('stop when robots.txt answers 401, 403, 407 or 429; allowed on another 4xx; skip-site on 5xx', async () => {
    for (const status of [401, 403, 407, 429]) {
      const s = await serve({ '/robots.txt': { status, body: 'no' } });
      const pre = await g.preflight(new URL(`${s.url}/`));
      assert.equal(pre.verdict, 'stop', `HTTP ${status}`);
      assert.equal(pre.code, 'robots-refused');
    }
    for (const status of [404, 410]) {
      const s = await serve({ '/robots.txt': { status, body: 'gone' } });
      assert.equal((await g.preflight(new URL(`${s.url}/`))).verdict, null, `HTTP ${status}`);
    }
    for (const status of [500, 503]) {
      const s = await serve({ '/robots.txt': { status, body: 'down' } });
      const pre = await g.preflight(new URL(`${s.url}/`));
      assert.equal(pre.verdict, 'skip-site', `HTTP ${status}`);
      assert.equal(pre.code, 'robots-unreachable');
    }
  });

  test('the plain client sees every status (407 included), decompresses, and keeps redirects on the origin when asked', async () => {
    const robotsText = 'User-agent: *\nDisallow: /x\n';
    const other = await serve({ '/terms': { body: 'other origin' } });
    const s = await serve({
      '/407': { status: 407, body: 'proxy auth' },
      '/gz': { body: gzipSync(robotsText), headers: { 'content-encoding': 'gzip' } },
      '/br': { body: brotliCompressSync(robotsText), headers: { 'content-encoding': 'br' } },
      '/hop': { status: 302, headers: { location: '/landed' } },
      '/landed': { body: 'landed' },
      '/away': { status: 302, headers: { location: `${other.url}/terms` } },
    });
    assert.equal((await g.fetchText(`${s.url}/407`)).status, 407);
    assert.equal((await g.fetchText(`${s.url}/gz`)).text, robotsText);
    assert.equal((await g.fetchText(`${s.url}/br`)).text, robotsText);
    const hop = await g.fetchText(`${s.url}/hop`, { sameOrigin: true });
    assert.equal(hop.status, 200);
    assert.equal(hop.text, 'landed');
    assert.equal(hop.finalUrl, `${s.url}/landed`);
    const away = await g.fetchText(`${s.url}/away`, { sameOrigin: true });
    assert.equal(away.status, 302);
    assert.match(String(away.error), /another origin/);
    assert.equal(other.requests.length, 0);
    const followed = await g.fetchText(`${s.url}/away`);
    assert.equal(followed.text, 'other origin');
  });

  test('skip-site when robots.txt cannot be reached at all', async () => {
    const port = await closedPort();
    const pre = await g.preflight(new URL(`http://127.0.0.1:${port}/`));
    assert.equal(pre.verdict, 'skip-site');
    assert.equal(pre.code, 'robots-unreachable');
  });

  test('stop on a challenge served for robots.txt (Cloudflare, AWS WAF)', async () => {
    const cf = await serve({ '/robots.txt': { status: 403, headers: { 'cf-mitigated': 'challenge' }, body: 'Just a moment...' } });
    assert.equal((await g.preflight(new URL(`${cf.url}/`))).code, 'bot-wall');
    const aws = await serve({ '/robots.txt': { status: 202, headers: { 'x-amzn-waf-action': 'challenge' }, body: '' } });
    const pre = await g.preflight(new URL(`${aws.url}/`));
    assert.equal(pre.verdict, 'stop');
    assert.equal(pre.code, 'bot-wall');
  });

  test('skip-site on a TDMRep reservation; tdmrep.json is never fetched when robots.txt disallows it', async () => {
    const reserved = await serve({ '/robots.txt': robots('User-agent: *\nAllow: /\n'), '/.well-known/tdmrep.json': { body: readFixture('robots', 'tdmrep-reserved.json'), headers: { 'content-type': 'application/json' } } });
    const pre = await g.preflight(new URL(`${reserved.url}/pricing`));
    assert.equal(pre.verdict, 'skip-site');
    assert.equal(pre.code, 'tdm');
    const json = await serve({ '/robots.txt': robots(readFixture('robots', 'query-and-json.txt')) });
    const allowed = await g.preflight(new URL(`${json.url}/`));
    assert.equal(allowed.verdict, null);
    assert.equal(json.requests.some((r) => r.url.includes('tdmrep')), false);
    assert.deepEqual(allowed.steps.find((s) => s.name === 'tdmrep.json'), { name: 'tdmrep.json', skipped: 'disallowed by robots.txt' });
  });

  test('a plain 403 on tdmrep.json reads as absent; a challenge on ai.txt stops; ai.txt opting images out skips', async () => {
    const plain = await serve({ '/robots.txt': robots('User-agent: *\nAllow: /\n'), '/.well-known/tdmrep.json': { status: 403, body: 'AccessDenied' } });
    assert.equal((await g.preflight(new URL(`${plain.url}/`))).verdict, null);
    const walled = await serve({ '/robots.txt': robots('User-agent: *\nAllow: /\n'), '/ai.txt': { status: 403, headers: { 'cf-mitigated': 'challenge' } } });
    assert.equal((await g.preflight(new URL(`${walled.url}/`))).code, 'bot-wall');
    const images = await serve({ '/robots.txt': robots('User-agent: *\nAllow: /\n'), '/ai.txt': robots(readFixture('robots', 'ai-txt-images.txt')) });
    const pre = await g.preflight(new URL(`${images.url}/`));
    assert.equal(pre.verdict, 'skip-site');
    assert.equal(pre.code, 'tdm');
  });

  test('Content-Usage ai-use=n in robots.txt skips; train-ai=n alone does not', async () => {
    const reserved = await serve({ '/robots.txt': robots(readFixture('robots', 'content-usage.txt')) });
    assert.equal((await g.preflight(new URL(`${reserved.url}/`))).code, 'tdm');
    const trainOnly = await serve({ '/robots.txt': robots(readFixture('robots', 'content-usage-train-only.txt')) });
    assert.equal((await g.preflight(new URL(`${trainOnly.url}/`))).verdict, null);
  });

  test('Crawl-delay is reported and honoured; one longer than a capture can wait skips the site', async () => {
    const slow = await serve({ '/robots.txt': robots(readFixture('robots', 'crawl-delay-20.txt')) });
    const pre = await g.preflight(new URL(`${slow.url}/`));
    assert.equal(pre.verdict, null);
    assert.equal(pre.crawlDelay, 20);
    const tooSlow = await serve({ '/robots.txt': robots(readFixture('robots', 'crawl-delay-400.txt')) });
    assert.equal((await g.preflight(new URL(`${tooSlow.url}/`))).code, 'crawl-delay');
  });
});

describe('CLI', () => {
  /** @type {import('./helpers.mjs').TestServer} */
  let open;
  /** @type {import('./helpers.mjs').TestServer} */
  let refusing;
  before(async () => {
    open = await startServer({ '/robots.txt': { body: 'User-agent: *\nAllow: /\n' } });
    refusing = await startServer({ '/robots.txt': { status: 403, body: 'Forbidden' } });
  });
  after(async () => {
    await open.close();
    await refusing.close();
  });

  /** @param {string[]} args */
  const capture = async (args) => {
    let out = '';
    let err = '';
    const code = await g.main(args, { stdout: (s) => { out += s; }, stderr: (s) => { err += s; } });
    return { code, out, err };
  };

  test('--help exits 0 and offers no identity, headed, proxy or retry option', () => {
    const r = spawnSync(process.execPath, [GATE_CLI, '--help'], { encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^Usage:/);
    for (const forbidden of ['--user-agent', '--ua', '--headed', '--headless', '--proxy', '--stealth', '--retry']) {
      assert.equal(r.stdout.includes(forbidden), false, forbidden);
    }
  });

  test('an identity flag is a usage error (exit 2)', () => {
    const r = spawnSync(process.execPath, [GATE_CLI, 'check', '--url', `${open.url}/`, '--user-agent', 'Mozilla/5.0 Chrome'], { encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /user-agent/);
  });

  test('check: allowed exits 0 with the JSON report; a block exits 1 and is never retried', async () => {
    const out = scratch('cli-out');
    const ok = await capture(['check', '--url', `${open.url}/`, '--out', out, '--json']);
    assert.equal(ok.code, 0);
    assert.equal(JSON.parse(ok.out).verdict, 'allowed');
    await assert.rejects(capture(['check', '--url', `${refusing.url}/`, '--out', out]), (err) => err instanceof CheckError && /stop/.test(err.message));
    const before = refusing.requests.length;
    await assert.rejects(capture(['check', '--url', `${refusing.url}/`, '--out', out, '--json']), (err) => err instanceof CheckError && /blocked-before|no retry/.test(err.message));
    assert.equal(refusing.requests.length, before);
  });

  test('check refuses a captures root inside the project without any request', async () => {
    const project = scratch('cli-project');
    const before = open.requests.length;
    await assert.rejects(capture(['check', '--url', `${open.url}/`, '--out', path.join(project, 'caps'), '--root', project]), (err) => err instanceof CheckError && /refused/.test(err.message));
    assert.equal(open.requests.length, before);
  });

  test('policy prints the constants; an unknown command is a usage error', async () => {
    const p = await capture(['policy']);
    assert.equal(JSON.parse(p.out).productToken, 'frontend-capture');
    await assert.rejects(capture(['nonsense']), UsageError);
    await assert.rejects(capture(['purge']), UsageError);
  });
});
