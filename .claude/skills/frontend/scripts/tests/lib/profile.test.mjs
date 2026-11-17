// @ts-check
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../../lib/errors.mjs';
import { DEFAULT_VIEWPORTS, REQUIRED_FIELDS, defaultProfile, loadProfile, resolveProfile } from '../../lib/profile.mjs';

const FIXTURES = fileURLToPath(new URL('../fixtures/lib/profiles/', import.meta.url));
const fixture = (/** @type {string} */ name) => path.join(FIXTURES, name);
const posix = (/** @type {string} */ p) => p.replace(/\\/g, '/');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-profile-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const MINIMAL = { judged_surface: 'site', stack: 'static-html', hosting: 'local' };

/**
 * @param {() => unknown} fn
 * @param {RegExp[]} patterns every pattern must appear in the message
 */
function assertUsage(fn, patterns) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof UsageError, `expected a UsageError, got ${String(err)}`);
    for (const p of patterns) assert.match(err.message, p);
    return true;
  });
}

test('DEFAULT_VIEWPORTS is the frozen section 6.1 matrix', () => {
  assert.deepEqual(DEFAULT_VIEWPORTS.map((v) => ({ ...v })), [
    { name: 'desktop', width: 1440, height: 900, dpr: 1, isMobile: false, hasTouch: false },
    { name: 'mobile', width: 390, height: 844, dpr: 2, isMobile: true, hasTouch: true },
    { name: 'reflow', width: 320, height: 640, dpr: 1, isMobile: false, hasTouch: false },
  ]);
  assert.ok(Object.isFrozen(DEFAULT_VIEWPORTS) && Object.isFrozen(DEFAULT_VIEWPORTS[0]));
  assert.deepEqual([...REQUIRED_FIELDS], ['judged_surface', 'stack', 'hosting']);
});

test('a minimal bare block gets every section 6.1 default', () => {
  const p = resolveProfile({ ...MINIMAL });
  assert.equal(p.mode, 'full');
  assert.equal(p.run_mode, 'B');
  assert.deepEqual(p.viewports, DEFAULT_VIEWPORTS.map((v) => ({ ...v })));
  assert.equal(p.review_surface, 'claude-design');
  assert.deepEqual(p.critique, { rounds_max: 3, critics: 3, probes: 5 });
  assert.equal(p.external_requests, false);
  assert.equal(p.record_mode, false);
  assert.equal(p.ready_flag, false);
  assert.deepEqual(p.format, { stage: false, projector_zoom: 1.25, video: null, async_readme: false });
  assert.deepEqual(p.prework_designs, { allowed: true, until_utc: null });
  assert.deepEqual(p.paths, { design: 'design', claims_ledger: null, never_show: null, feature_catalogue: null, spec: null, research: null, ui: null });
  assert.deepEqual(p.workspace, { private_dir: null });
  assert.deepEqual(p.sponsors, []);
  assert.deepEqual(p.references, []);
  assert.deepEqual(p.tells, { score_max: null });
  assert.deepEqual(p.budget, { ui_hours: null, tokens: null });
  assert.equal(p.prework, null);
  assert.equal(p.source.kind, 'block');
});

test('the returned viewports are copies: mutating them never touches the defaults', () => {
  const p = resolveProfile({ ...MINIMAL });
  p.viewports[0].width = 1;
  assert.equal(DEFAULT_VIEWPORTS[0].width, 1440);
});

test('small mode defaults to one critique round', () => {
  assert.equal(resolveProfile({ ...MINIMAL, mode: 'small' }).critique.rounds_max, 1);
  assert.equal(resolveProfile({ ...MINIMAL, mode: 'small', critique: { rounds_max: 2 } }).critique.rounds_max, 2);
});

test('an /execution profile merges its top-level facts into the frontend block', () => {
  const file = fixture('execution/profile.json');
  const p = loadProfile(file);
  const base = posix(path.dirname(file));
  const privateDir = posix(path.resolve(path.dirname(file), '../private'));
  assert.equal(p.source.kind, 'execution');
  assert.equal(p.source.path, posix(file));
  assert.equal(p.run_mode, 'A', 'an /execution profile defaults to mode A');
  assert.equal(p.mode, 'small');
  assert.equal(p.judged_surface, 'site+app');
  assert.equal(p.stack, 'vite-react');
  assert.equal(p.hosting, 'gh-pages');
  assert.deepEqual(p.prework, { code: false, designs: false, until_utc: '2026-10-06T01:00:00Z' });
  assert.deepEqual(p.prework_designs, { allowed: false, until_utc: '2026-10-06T01:00:00Z' }, 'top-level prework is authoritative');
  assert.equal(p.paths.claims_ledger, `${privateDir}/claims.md`, 'phase_b.claims_ledger is the claims ledger');
  assert.equal(p.paths.never_show, `${privateDir}/never-show.json`);
  assert.equal(p.paths.feature_catalogue, `${base}/feature-catalogue.json`);
  assert.equal(p.paths.design, 'ui/design');
  assert.equal(p.workspace.private_dir, privateDir);
  assert.deepEqual(p.project, { name: 'Queue Clock', name_owner_confirmed: true });
  assert.deepEqual(p.sponsors, ['cardano'], 'sponsor ids are lower-cased');
  assert.deepEqual(p.format.video, { max_s: 120, width: 1920, height: 1080, embed: 'pptx' });
  assert.equal(p.format.stage, true);
  assert.equal(p.tells.score_max, 6);
  assert.equal(p.ready_flag, true);
  assert.equal(p.critique.rounds_max, 1);
  assert.deepEqual(p.source.unknown, []);
});

test('frontend.prework_designs overrides the top-level prework', () => {
  const p = resolveProfile({
    prework: { code: false, designs: false, until_utc: '2026-10-06T01:00:00Z' },
    frontend: { ...MINIMAL, prework_designs: { allowed: true } },
  });
  assert.deepEqual(p.prework_designs, { allowed: true, until_utc: '2026-10-06T01:00:00Z' });
  const words = resolveProfile({ prework: { designs: 'forbidden' }, frontend: { ...MINIMAL } });
  assert.equal(words.prework_designs.allowed, false);
});

test('one truth per fact: two different values for the same path are refused', () => {
  const abs = (/** @type {string} */ rel) => path.resolve(tmp, rel);
  assertUsage(
    () => resolveProfile({ phase_b: { claims_ledger: abs('a/claims.md') }, frontend: { ...MINIMAL, paths: { claims_ledger: abs('b/claims.md') } } }, { path: path.join(tmp, 'profile.json') }),
    [/two different claims ledger paths/, /keep one/],
  );
  assertUsage(
    () => resolveProfile({ workspace: { private_dir: abs('a') }, frontend: { ...MINIMAL, workspace: { private_dir: abs('b') } } }),
    [/two different private workspace paths/],
  );
  const same = resolveProfile({ paths: { never_show: abs('x/ns.json') }, frontend: { ...MINIMAL, paths: { never_show: posix(abs('x/ns.json')) } } });
  assert.equal(same.paths.never_show, posix(abs('x/ns.json')));
});

test('a bare block file: relative paths resolve against its folder, unknown keys are reported', () => {
  const file = fixture('block.json');
  const p = loadProfile(file);
  assert.equal(p.source.kind, 'block');
  assert.equal(p.run_mode, 'B');
  assert.equal(p.paths.claims_ledger, posix(path.join(FIXTURES, 'claims.md')));
  assert.equal(p.record_mode, true);
  assert.deepEqual(p.viewports[1], { name: 'phone', width: 390, height: 844, dpr: 3, isMobile: true, hasTouch: true, colorScheme: 'dark', reducedMotion: 'reduce' });
  assert.deepEqual(p.viewports[0], { name: 'desktop', width: 1536, height: 864, dpr: 1, isMobile: false, hasTouch: false });
  assert.deepEqual(p.source.unknown, ['extra_field']);
});

test('missing required fields are all listed in one UsageError', () => {
  assertUsage(() => resolveProfile({ mode: 'full' }), [
    /3 problems/, /missing required field judged_surface \(one of site\|app\|site\+app\|video\|readme\)/,
    /missing required field stack/, /missing required field hosting/,
  ]);
  assertUsage(() => resolveProfile({ frontend: { stack: 'next', hosting: 'vercel' } }), [/missing required field frontend\.judged_surface/]);
});

test('values outside their enumeration, and malformed fields, are refused with their path', () => {
  assertUsage(() => resolveProfile({ ...MINIMAL, mode: 'tiny', stack: 'angular' }), [/mode must be one of full\|small \(got "tiny"\)/, /stack must be one of/]);
  assertUsage(() => resolveProfile({ ...MINIMAL, viewports: [{ name: 'a', width: 0, height: 10.5 }, { name: 'a', width: 10, height: 10 }, { width: 5 }] }), [
    /viewports\[0\]\.width must be an integer >= 1/, /viewports\[0\]\.height must be an integer/,
    /viewports\[1\]\.name duplicates the viewport name "a"/, /missing required field viewports\[2\]\.name/,
    /missing required field viewports\[2\]\.height/,
  ]);
  assertUsage(() => resolveProfile({ ...MINIMAL, viewports: [] }), [/viewports must be a non-empty array/]);
  assertUsage(() => resolveProfile({ ...MINIMAL, record_mode: 'yes' }), [/record_mode must be true or false/]);
  assertUsage(() => resolveProfile({ ...MINIMAL, format: { video: { embed: 'ppt' } } }), [/format\.video\.embed must be one of pptx\|key\|mp4/]);
  assertUsage(() => resolveProfile({ ...MINIMAL, prework_designs: { until_utc: 'soon' } }), [/prework_designs\.until_utc must be an ISO 8601 UTC date/]);
  assertUsage(() => resolveProfile({ ...MINIMAL, paths: { never_show: 42 } }), [/paths\.never_show must be a path string or null/]);
  assertUsage(() => resolveProfile({ ...MINIMAL, sponsors: 'cardano' }), [/sponsors must be an array of sponsor ids/]);
  assertUsage(() => resolveProfile([]), [/must be a JSON object/]);
});

test('sponsor ids may come from /execution\'s sponsor_allowlist, as ids or FD21 entries', () => {
  assert.deepEqual(resolveProfile({ ...MINIMAL, sponsor_allowlist: ['Solana', 'cardano'] }).sponsors, ['solana', 'cardano']);
  assert.deepEqual(resolveProfile({ ...MINIMAL, sponsor_allowlist: [{ sponsor: 'cardano', logo_default: 'x' }] }).sponsors, ['cardano']);
  assert.deepEqual(resolveProfile({ ...MINIMAL, sponsors: ['bnb'], sponsor_allowlist: ['cardano'] }).sponsors, ['bnb'], 'sponsors wins');
});

test('an /execution profile without a frontend block is refused with what to add', () => {
  assertUsage(() => loadProfile(fixture('execution-no-block.json')), [/no "frontend" block/, /judged_surface, stack, hosting/]);
});

test('file problems are UsageErrors: missing file, invalid JSON', () => {
  assertUsage(() => loadProfile(path.join(tmp, 'nope.json')), [/profile not found/, /--profile/]);
  assertUsage(() => loadProfile(fixture('broken.json')), [/is not valid JSON/]);
});

test('without a path: discovery under the root, .execution before .frontend, else defaults', () => {
  const root = path.join(tmp, 'repo');
  mkdirSync(path.join(root, '.frontend'), { recursive: true });
  const none = loadProfile(undefined, { root });
  assert.equal(none.source.kind, 'defaults');
  assert.equal(none.judged_surface, 'site');
  assert.equal(none.stack, 'existing');
  assert.equal(none.hosting, 'local');
  writeFileSync(path.join(root, '.frontend', 'profile.json'), JSON.stringify({ ...MINIMAL, judged_surface: 'app' }));
  assert.equal(loadProfile(undefined, { root }).judged_surface, 'app');
  mkdirSync(path.join(root, '.execution'), { recursive: true });
  writeFileSync(path.join(root, '.execution', 'profile.json'), JSON.stringify({ frontend: { ...MINIMAL, judged_surface: 'video' } }));
  const found = loadProfile(undefined, { root });
  assert.equal(found.judged_surface, 'video');
  assert.equal(found.run_mode, 'A');
});

test('defaultProfile validates overrides but never requires the project fields', () => {
  assert.equal(defaultProfile().source.kind, 'defaults');
  assert.equal(defaultProfile({ record_mode: true }).record_mode, true);
  assert.throws(() => defaultProfile({ mode: 'huge' }), UsageError);
});

test('firstview.complexity (v1.1): a known key, validated, null when absent', () => {
  assert.deepEqual(resolveProfile(MINIMAL).firstview, { complexity: null });
  const band = { min_kib: 40, max_kib: 120, width: 1440, height: 900, dpr: 1, quality: 70, calibrated: true, source: 'calibration 2026-10' };
  const p = resolveProfile({ ...MINIMAL, firstview: { complexity: band } });
  assert.deepEqual(p.firstview, { complexity: band });
  assert.ok(!p.source.unknown.includes('firstview'), 'firstview is no longer reported as an unknown key');
  assertUsage(() => resolveProfile({ ...MINIMAL, firstview: { complexity: { min_kib: 130, max_kib: 120 } } }), [/min_kib 130 is above max_kib 120/]);
  assertUsage(() => resolveProfile({ ...MINIMAL, firstview: { complexity: { max_kib: 120 } } }), [/firstview\.complexity\.min_kib must be a number/]);
  assertUsage(() => resolveProfile({ ...MINIMAL, firstview: 'busy' }), [/firstview must be an object/]);
});

test('paths.ui: repository-relative UI paths, normalised; null reads the whole repository', () => {
  assert.equal(resolveProfile({ ...MINIMAL }).paths.ui, null);
  assert.deepEqual(resolveProfile({ ...MINIMAL, paths: { ui: ['packages/web', './app/'] } }).paths.ui, ['packages/web', 'app']);
  assert.deepEqual(resolveProfile({ ...MINIMAL, paths: { ui: 'web' } }).paths.ui, ['web']);
  for (const bad of [[], ['../outside'], ['/abs'], ['C:/x'], [''], [3]]) {
    assert.throws(() => resolveProfile({ ...MINIMAL, paths: { ui: bad } }), (err) => err instanceof UsageError && /paths\.ui/.test(err.message), JSON.stringify(bad));
  }
});
