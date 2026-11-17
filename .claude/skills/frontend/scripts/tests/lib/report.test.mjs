// @ts-check
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { UsageError } from '../../lib/errors.mjs';
import { aggregate, gate, utcSeconds, utcStamp, writeReport } from '../../lib/report.mjs';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-report-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const CONSOLE = gate('render.console', 'No console errors on any route', 'a page that throws in front of the jury would pass');
const CLS = gate({ id: 'render.cls', title: 'Layout shift at most 0.1', ifDropped: 'a jumping first view would pass' });

test('the builder produces ok, fail and skipped results with one-line details', () => {
  const ok = CONSOLE.ok('no console errors on 3 routes');
  assert.deepEqual(ok, {
    id: 'render.console',
    title: 'No console errors on any route',
    ifDropped: 'a page that throws in front of the jury would pass',
    state: 'ok',
    detail: 'no console errors on 3 routes',
    evidence: [],
  });
  const fail = CONSOLE.fail('2 errors\non /\n  and /queue', { route: '/', viewport: 'desktop', value: 'TypeError' });
  assert.equal(fail.state, 'fail');
  assert.equal(fail.detail, '2 errors on / and /queue');
  assert.deepEqual(fail.evidence, [{ route: '/', viewport: 'desktop', value: 'TypeError' }]);
  const skipped = CLS.skip('no --url given');
  assert.equal(skipped.state, 'skipped');
  assert.equal(skipped.detail, 'no --url given');
  assert.equal(CLS.meta.id, 'render.cls');
});

test('evidence items are copied, so later mutation does not change the result', () => {
  const item = { selector: 'h1', value: 1 };
  const result = CONSOLE.fail('x', [item]);
  item.value = 2;
  assert.equal(result.evidence[0].value, 1);
  assert.throws(() => CONSOLE.fail('x', /** @type {import('../../lib/report.mjs').Evidence[]} */ (/** @type {unknown} */ (['not an object']))), TypeError);
});

test('gate metadata is validated', () => {
  assert.throws(() => gate('Render.Console', 't', 'i'), TypeError);
  assert.throws(() => gate('render', 't', 'i'), TypeError, 'an id needs a group and a name');
  assert.throws(() => gate('render.console', '', 'i'), TypeError);
  assert.throws(() => gate('render.console', 't', ''), TypeError, 'ifDropped is required');
  assert.doesNotThrow(() => gate('recording.g01', 't', 'i'));
  assert.doesNotThrow(() => gate('ip.copy-overlap', 't', 'i'));
});

test('aggregate: ok only when every gate passed', () => {
  const all = aggregate([CONSOLE.ok('fine'), CLS.ok('0.01')]);
  assert.equal(all.ok, true);
  assert.deepEqual(all.counts, { ok: 2, fail: 0, skipped: 0 });
  const failed = aggregate([CONSOLE.fail('boom'), CLS.ok('0.01')]);
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.counts, { ok: 1, fail: 1, skipped: 0 });
});

test('aggregate: a skipped gate makes ok false unless explicitly allowed', () => {
  const report = aggregate([CONSOLE.ok('fine'), CLS.skip('no browser')]);
  assert.equal(report.ok, false, 'a skipped gate never counts as passing');
  assert.equal(aggregate([CONSOLE.ok('fine'), CLS.skip('no browser')], { allowSkip: ['render.cls'] }).ok, true);
  assert.equal(aggregate([CONSOLE.ok('fine'), CLS.skip('no browser')], { allowSkip: ['render'] }).ok, true, 'a group name allows the group');
  assert.equal(aggregate([CONSOLE.ok('fine'), CLS.skip('no browser')], { allowSkip: ['render.console'] }).ok, false);
  assert.equal(aggregate([CONSOLE.fail('x'), CLS.skip('y')], { allowSkip: ['render'] }).ok, false, 'allowing skips never hides a failure');
});

test('advise: an ok that judged nothing binding is marked and counted apart, and never fails a run', () => {
  const advised = CLS.advise('only warnings', { value: 1 });
  assert.equal(advised.state, 'ok');
  assert.equal(advised.advisory, true);
  assert.equal(CONSOLE.ok('fine').advisory, undefined);
  const report = aggregate([CONSOLE.ok('fine'), advised]);
  assert.equal(report.ok, true);
  assert.deepEqual(report.counts, { ok: 2, fail: 0, skipped: 0, advisory: 1 });
  assert.deepEqual(aggregate([CONSOLE.ok('fine')]).counts, { ok: 1, fail: 0, skipped: 0 }, 'no advisory key when none is advisory');
});

test('aggregate: an empty report proves nothing', () => {
  const report = aggregate([]);
  assert.equal(report.ok, false);
  assert.deepEqual(report.counts, { ok: 0, fail: 0, skipped: 0 });
});

test('aggregate: requested gates that returned nothing are added as skipped', () => {
  const report = aggregate([CONSOLE.ok('fine')], {
    requested: ['render.console', { id: 'render.fonts', title: 'Fonts rendered', ifDropped: 'fallback fonts would pass' }, 'render.images'],
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.gates.map((g) => [g.id, g.state]), [
    ['render.console', 'ok'], ['render.fonts', 'skipped'], ['render.images', 'skipped'],
  ]);
  assert.match(report.gates[1].detail, /requested but not run/);
});

test('aggregate: a gate reported twice, or a non-result, is a programming error', () => {
  assert.throws(() => aggregate([CONSOLE.ok('a'), CONSOLE.fail('b')]), TypeError);
  assert.throws(() => aggregate(/** @type {import('../../lib/report.mjs').GateResult[]} */ (/** @type {unknown} */ ([{ id: 'x.y' }]))), TypeError);
  assert.throws(() => aggregate(/** @type {import('../../lib/report.mjs').GateResult[]} */ (/** @type {unknown} */ ('nope'))), TypeError);
});

test('aggregate with a tool name returns the full section 4 header in order', () => {
  const report = aggregate([CONSOLE.ok('fine')], {
    tool: 'frontend-check',
    target: { root: 'C:/repo', url: 'http://127.0.0.1:4173', routes: 3, viewports: ['desktop', 'mobile'] },
    at: '2026-10-01T10:00:00.123Z',
  });
  assert.deepEqual(Object.keys(report), ['ok', 'tool', 'version', 'at', 'target', 'counts', 'gates']);
  assert.equal(report.version, '1');
  assert.equal(report.at, '2026-10-01T10:00:00Z');
  assert.equal(report.target?.routes, 3);
});

test('UTC helpers: seconds precision, and a file-name-safe stamp', () => {
  assert.equal(utcSeconds('2026-10-01T10:00:00.999Z'), '2026-10-01T10:00:00Z');
  assert.equal(utcStamp('2026-10-01T10:00:00Z'), '2026-10-01T10-00-00Z');
  assert.match(utcSeconds(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.throws(() => utcSeconds('not a date'), TypeError);
});

test('writeReport writes pretty JSON with LF and returns a forward-slash path', () => {
  const report = aggregate([CONSOLE.ok('fine'), CLS.fail('0.3')], { tool: 'qa', at: '2026-10-01T10:00:00Z' });
  const file = writeReport(report, path.join(tmp, 'gates'), utcStamp('2026-10-01T10:00:00Z'));
  assert.ok(file.endsWith('/gates/2026-10-01T10-00-00Z.json'));
  assert.ok(!file.includes('\\'));
  const text = readFileSync(file, 'utf8');
  assert.ok(text.endsWith('}\n') && !text.includes('\r'));
  assert.deepEqual(JSON.parse(text), report);
  assert.ok(writeReport(report, tmp, 'same.json').endsWith('/same.json'), 'a .json suffix is not doubled');
});

test('writeReport refuses names that are not plain file names', () => {
  for (const name of ['../escape', 'a/b', 'a\\b', '2026-10-01T10:00:00Z', '', '..']) {
    assert.throws(() => writeReport({ ok: true }, tmp, name), UsageError, JSON.stringify(name));
  }
});
