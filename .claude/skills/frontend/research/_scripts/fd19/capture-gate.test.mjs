// Offline tests for capture-gate.mjs (FD19). Run: node --test capture-gate.test.mjs
// Fixtures: RFC 9309 section 5 examples, the TDMRep spec examples, and the robots.txt files and
// response headers saved on 2026-09-30 in ../../evidence/policy-capture-etiquette/survey-2026-09-30/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseRobots, robotsDecision, stricterOf, tdmrepDecision, contentUsageReserves, classifyResponse, checkStorage } from './capture-gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const survey = join(here, '..', '..', 'evidence', 'policy-capture-etiquette', 'survey-2026-09-30');
const robotsOf = (host) => parseRobots(readFileSync(join(survey, `${host}__robots_txt.txt`), 'utf8'));
const headersOf = (file) => {
  const lines = readFileSync(join(survey, file), 'utf8').split(/\r?\n/);
  const status = Number((lines.find((l) => /^HTTP\//.test(l)) ?? '').split(' ')[1]);
  const headers = {};
  for (const l of lines) { const m = l.match(/^([A-Za-z0-9-]+):\s*(.*)$/); if (m) headers[m[1].toLowerCase()] = m[2]; }
  return { status, headers };
};

const RFC_5_1 = `User-Agent: *
Disallow: *.gif$
Disallow: /example/
Allow: /publications/

User-Agent: foobot
Disallow:/
Allow:/example/page.html
Allow:/example/allowed.gif

User-Agent: barbot
User-Agent: bazbot
Disallow: /example/page.html

User-Agent: quxbot
`;

test('RFC 9309 section 5.1 example', () => {
  const g = parseRobots(RFC_5_1);
  assert.equal(robotsDecision(g, 'foobot', '/example/page.html').allowed, true);
  assert.equal(robotsDecision(g, 'foobot', '/example/allowed.gif').allowed, true);
  assert.equal(robotsDecision(g, 'foobot', '/other').allowed, false);
  assert.equal(robotsDecision(g, 'barbot', '/example/page.html').allowed, false);
  assert.equal(robotsDecision(g, 'bazbot', '/anything').allowed, true);
  assert.equal(robotsDecision(g, 'quxbot', '/example/').allowed, true);
  assert.equal(robotsDecision(g, 'unknownbot', '/a/b.gif').allowed, false); // '*' group, pattern starting with '*'
  assert.equal(robotsDecision(g, 'unknownbot', '/example/x').allowed, false);
  assert.equal(robotsDecision(g, 'unknownbot', '/publications/x').allowed, true);
  assert.equal(robotsDecision(g, 'unknownbot', '/robots.txt').allowed, true);
});

test('RFC 9309 section 5.2 longest match', () => {
  const g = parseRobots('User-Agent: foobot\nAllow: /example/page/\nDisallow: /example/page/disallowed.gif\n');
  assert.equal(robotsDecision(g, 'foobot', '/example/page/disallowed.gif').allowed, false);
  assert.equal(robotsDecision(g, 'foobot', '/example/page/ok.gif').allowed, true);
});

test('other records do not terminate a group; case-insensitive token match', () => {
  const g = parseRobots('User-agent: a\nCrawl-delay: 2\nUser-agent: B\nDisallow: /\n');
  assert.equal(robotsDecision(g, 'A', '/x').allowed, false);
  assert.equal(robotsDecision(g, 'b', '/x').allowed, false);
  assert.equal(robotsDecision(g, 'a', '/x').crawlDelay, 2);
});

test('stricter-of rule: a Claude-User group can block our capture', () => {
  const g = parseRobots('User-agent: *\nAllow: /\n\nUser-agent: Claude-User\nDisallow: /\n');
  assert.equal(stricterOf(g, '/').allowed, false);
  const g2 = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: Claude-User\nAllow: /\n');
  assert.equal(stricterOf(g2, '/').allowed, false);
});

test('surveyed robots.txt files (2026-09-30): home pages allowed, specific paths not', () => {
  for (const host of ['binance.com', 'cardano.org', 'chain.link', 'coinbase.com', 'kraken.com', 'ledger.com', 'revolut.com', 'stripe.com']) {
    assert.equal(stricterOf(robotsOf(host), '/').allowed, true, `${host} home page`);
  }
  assert.equal(stricterOf(robotsOf('revolut.com'), '/?utm=1').allowed, false);
  assert.equal(stricterOf(robotsOf('revolut.com'), '/.well-known/tdmrep.json').allowed, false);
  assert.equal(stricterOf(robotsOf('coinbase.com'), '/join/').allowed, false);
  assert.equal(stricterOf(robotsOf('stripe.com'), '/handoff').allowed, false);
  assert.equal(stricterOf(robotsOf('ledger.com'), '/blog/tag/x').allowed, false);
});

test('TDMRep examples from the W3C CG report', () => {
  const ex2 = [
    { location: '/directory-a/', 'tdm-reservation': 1 },
    { location: '/directory-b/html/', 'tdm-reservation': 1, 'tdm-policy': 'https://provider.com/policies/policy.json' },
    { location: '/directory-b/images/*.jpg', 'tdm-reservation': 0 },
  ];
  assert.equal(tdmrepDecision(ex2, '/directory-a/x.pdf').reservation, 1);
  assert.equal(tdmrepDecision(ex2, '/directory-b/images/a.jpg').reservation, 0);
  assert.equal(tdmrepDecision(ex2, '/other').reservation, null);
  assert.equal(tdmrepDecision([{ location: '/', 'tdm-reservation': 1 }], '/pricing').reservation, 1);
});

test('aipref Content-Usage: only ai-use=n stops a model-read capture', () => {
  assert.equal(contentUsageReserves(['train-ai=n']), false);
  assert.equal(contentUsageReserves(['ai-use=n']), true);
  assert.equal(contentUsageReserves(['train-ai=y, ai-use=n']), true);
});

test('bot wall classification on observed responses', () => {
  assert.equal(classifyResponse(headersOf('revolut.com__ai_txt.txt.hdr')).kind, 'challenge'); // 403 + cf-mitigated
  assert.equal(classifyResponse({ ...headersOf('binance.com__ai_txt.txt.hdr'), text: '' }).kind, 'challenge'); // 202 + x-amzn-waf-action
  assert.equal(classifyResponse(headersOf('ledger.com___well-known_tdmrep_json.txt.hdr')).kind, 'hard'); // plain 403
  assert.equal(classifyResponse({ status: 405, headers: { 'x-amzn-waf-action': 'captcha' } }).kind, 'captcha');
  assert.equal(classifyResponse({ status: 200, headers: {}, title: 'Un instant…', visibleElements: 22 }).kind, 'interstitial'); // FD05 coinbase.json
  assert.equal(classifyResponse({ status: 200, headers: {}, title: 'Just a quick security check', visibleElements: 19 }).kind, 'interstitial'); // FD05 revolut h1
  assert.equal(classifyResponse({ status: 200, headers: {}, title: 'Banking & Beyond | Revolut United Kingdom', visibleElements: 498 }).blocked, false);
});

test('storage guard refuses a capture dir inside the project', () => {
  const project = mkdtempSync(join(tmpdir(), 'fd19-project-'));
  assert.equal(checkStorage(join(project, 'captures'), project).ok, false);
  const outside = mkdtempSync(join(tmpdir(), 'fd19-captures-'));
  assert.equal(checkStorage(outside, project).ok, true);
});
