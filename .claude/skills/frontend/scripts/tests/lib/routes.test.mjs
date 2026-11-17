// @ts-check
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../../lib/errors.mjs';
import { DEFAULT_ROUTES, loadRoutes, routeUrl } from '../../lib/routes.mjs';

const REPO = fileURLToPath(new URL('../fixtures/lib/repo/', import.meta.url));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-routes-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * @param {string} name
 * @param {unknown} routes
 * @returns {string} a root whose design/routes.json holds `routes`
 */
function rootWith(name, routes) {
  const root = path.join(tmp, name);
  mkdirSync(path.join(root, 'design'), { recursive: true });
  writeFileSync(path.join(root, 'design', 'routes.json'), typeof routes === 'string' ? routes : JSON.stringify(routes));
  return root;
}

test('without routes.json: the single home route', () => {
  const routes = loadRoutes(path.join(tmp, 'empty'), {});
  /** @type {import('../../lib/routes.mjs').Route[]} */
  const expected = [{ path: '/', name: 'home', first: true, features: [], states: [] }];
  assert.deepEqual(routes, expected);
  routes[0].features.push('FR-1');
  assert.deepEqual(DEFAULT_ROUTES[0].features, [], 'the default is never mutated');
});

test('reads and normalises <design>/routes.json, keeping the marked first route', () => {
  assert.deepEqual(loadRoutes(REPO, {}), [
    { path: '/', name: 'home', first: false, features: ['FR-001'], states: [] },
    { path: '/queue', name: 'queue', first: true, features: ['FR-002', 'FR-003'], states: ['empty', 'error'] },
  ]);
});

test('profile.paths.design moves the routes file', () => {
  const root = path.join(tmp, 'custom');
  mkdirSync(path.join(root, 'ui', 'design'), { recursive: true });
  writeFileSync(path.join(root, 'ui', 'design', 'routes.json'), JSON.stringify([{ path: '/x', name: 'x' }]));
  const routes = loadRoutes(root, { paths: { design: 'ui/design' } });
  assert.deepEqual(routes, [{ path: '/x', name: 'x', first: true, features: [], states: [] }], 'the first entry is first when none is marked');
});

test('invalid routes files are UsageErrors that list every problem', () => {
  assert.throws(() => loadRoutes(rootWith('bad-json', '[{'), {}), (e) => e instanceof UsageError && /not valid JSON/.test(e.message));
  assert.throws(() => loadRoutes(rootWith('empty-list', []), {}), (e) => e instanceof UsageError && /non-empty array/.test(e.message));
  assert.throws(() => loadRoutes(rootWith('object', { routes: [] }), {}), UsageError);
  const many = rootWith('many', [
    { path: 'queue', name: 'a' },
    { path: '/b', name: '', first: 'yes' },
    { path: '/c', name: 'c', first: true, features: ['FR-1', ''] },
    { path: '/c', name: 'c', first: true, states: 'empty' },
  ]);
  assert.throws(() => loadRoutes(many, {}), (e) => {
    assert.ok(e instanceof UsageError);
    for (const p of [/routes\[0\]\.path must be a string starting with "\/"/, /routes\[1\]\.name must be a non-empty string/,
      /routes\[1\]\.first must be true or false/, /routes\[2\]\.features must be an array of non-empty strings/,
      /routes\[3\]\.path "\/c" is listed twice/, /routes\[3\]\.name "c" is used twice/, /routes\[3\]\.states/,
      /only one route may be first/]) {
      assert.match(e.message, p);
    }
    return true;
  });
});

test('routeUrl joins base and route, keeping a base path prefix', () => {
  const route = { path: '/queue' };
  assert.equal(routeUrl('http://127.0.0.1:4173', { path: '/' }, {}), 'http://127.0.0.1:4173/');
  assert.equal(routeUrl('http://127.0.0.1:4173/', route, {}), 'http://127.0.0.1:4173/queue');
  assert.equal(routeUrl('https://user.github.io/repo/', route, {}), 'https://user.github.io/repo/queue');
  assert.equal(routeUrl('https://user.github.io/repo', { path: '/' }, {}), 'https://user.github.io/repo/');
});

test('routeUrl appends record=1 in record mode, with ? or &, before any hash', () => {
  assert.equal(routeUrl('http://h:1', { path: '/queue' }, { record_mode: true }), 'http://h:1/queue?record=1');
  assert.equal(routeUrl('http://h:1', { path: '/queue?tab=2' }, { record_mode: true }), 'http://h:1/queue?tab=2&record=1');
  assert.equal(routeUrl('http://h:1/?token=a', { path: '/x' }, { record_mode: true }), 'http://h:1/x?token=a&record=1');
  assert.equal(routeUrl('http://h:1', { path: '/#/about' }, { record_mode: true }), 'http://h:1/?record=1#/about');
  assert.equal(routeUrl('http://h:1', { path: '/x?record=1' }, { record_mode: true }), 'http://h:1/x?record=1', 'never twice');
  assert.equal(routeUrl('http://h:1', { path: '/queue?tab=2' }, { record_mode: false }), 'http://h:1/queue?tab=2');
});

test('routeUrl refuses a base that is not an absolute URL', () => {
  assert.throws(() => routeUrl('localhost:4173', { path: '/' }, {}), (e) => e instanceof UsageError && /must start with http/.test(e.message));
  assert.throws(() => routeUrl('file:///C:/site/index.html', { path: '/' }, {}), UsageError);
  assert.throws(() => routeUrl('/relative', { path: '/' }, {}), UsageError);
});
