// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { defaultProfile } from '../../lib/profile.mjs';
import { NOT_SHIPPED, loadAllowlists, loadRegistry, runStatic, shippedSources, sourceFiles, staticContext } from '../../rules/load.mjs';

/**
 * @typedef {import('../../rules/load.mjs').StaticFinding} StaticFinding
 * @typedef {import('../../rules/load.mjs').Rule} Rule
 */

const FIXTURES = fileURLToPath(new URL('../fixtures/rules/', import.meta.url));
const registry = loadRegistry();
const staticRules = registry.rules.filter((r) => r.static);
const tmp = mkdtempSync(path.join(process.env.FRONTEND_TEST_TMP ?? os.tmpdir(), 'fe-static-shipped-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * @param {string} root
 * @param {Rule[]} rules
 * @returns {Promise<StaticFinding[]>}
 */
async function run(root, rules) {
  const profile = defaultProfile();
  const findings = await runStatic(rules, staticContext(root, profile, loadAllowlists(root, profile)));
  assert.deepEqual(findings.filter((f) => 'error' in f), [], `detectors must not throw on ${root}`);
  return /** @type {StaticFinding[]} */ (findings);
}

/**
 * @param {string} name
 * @param {Record<string, string>} files
 * @returns {string}
 */
function repo(name, files) {
  const root = path.join(tmp, name);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  return root;
}

const PLACES = /** @type {const} */ ([
  ['src/__tests__', 'a test folder'],
  ['src/stories', 'a stories folder'],
  ['.storybook', 'the Storybook config'],
  ['scripts', 'the root scripts folder'],
  ['web/tools', 'a package-level tools folder'],
  ['cypress', 'a Cypress folder'],
]);

test('every static rule fires on its positive fixture where it ships, and stays silent once it is moved into a test, story, tooling or Cypress folder', async () => {
  const missing = staticRules.filter((r) => !existsSync(path.join(FIXTURES, r.id, 'static-pos'))).map((r) => r.id);
  assert.deepEqual(missing, [], 'every static rule has a static-pos fixture');
  /** @type {string[]} */
  const silentWhereShipped = [];
  /** @type {string[]} */
  const leaks = [];
  for (const r of staticRules) {
    const source = path.join(FIXTURES, r.id, 'static-pos');
    const shipped = path.join(tmp, r.id, 'shipped');
    cpSync(source, shipped, { recursive: true });
    if ((await run(shipped, [r])).length === 0) silentWhereShipped.push(r.id);
    for (const [where] of PLACES) {
      const root = path.join(tmp, r.id, where.replace(/\W+/g, '-'));
      cpSync(source, path.join(root, where), { recursive: true });
      if (where.startsWith('web/')) writeFileSync(path.join(root, 'web', 'package.json'), '{"name": "web", "dependencies": {"react": "19.0.0"}}\n');
      for (const hit of await run(root, [r])) leaks.push(`${r.id} ${hit.file}:${hit.line}`);
    }
  }
  assert.deepEqual(silentWhereShipped, [], 'a copied positive still fires, so the silence below is the filter');
  assert.deepEqual(leaks, [], `nothing fires from ${PLACES.map(([, label]) => label).join(', ')}`);
});

test('NOT_SHIPPED: declarations, Cypress and e2e specs, Storybook and vendored environments at any depth', () => {
  for (const p of ['src/types.d.ts', 'app/a.cy.tsx', 'web/login.e2e.ts', 'web/.storybook/preview.tsx', 'x/__stories__/A.tsx',
    '.yarn/releases/yarn-3.2.3.cjs', 'quant/.venv/Lib/site-packages/x/index.html', 'apps/web/src/App.test.tsx']) {
    assert.ok(NOT_SHIPPED.test(p), `${p} is not shipped`);
  }
  for (const p of ['src/App.tsx', 'app/tools/page.tsx', 'src/mocks/agents.ts', 'src/scripts/loader.ts']) assert.ok(!NOT_SHIPPED.test(p), `${p} ships`);
});

test('the UI surface: UI packages only, and scripts/ or tools/ only at a package root (a Next.js app/tools route ships)', () => {
  const root = repo('monorepo', {
    'package.json': '{"name": "root", "private": true}\n',
    'apps/web/package.json': '{"name": "web", "dependencies": {"next": "15.0.0", "react": "19.0.0"}}\n',
    'apps/web/app/page.tsx': 'export default function Page() { return <h1>Escrow</h1>; }\n',
    'apps/web/app/tools/page.tsx': 'export default function Tools() { return <h1>Tools</h1>; }\n',
    'apps/web/tools/audit.js': "console.log('audit');\n",
    'apps/api/package.json': '{"name": "api", "dependencies": {"fastify": "5.0.0"}}\n',
    'apps/api/src/server.ts': "export const label = 'SPYB/USDT · Uniswap v4 · no hook';\n",
    'brand/preview.html': '<!doctype html><title>Preview</title><p>Brand — preview</p>\n',
    'deck/build.mjs': "export const x = 1;\n",
    'scripts/seed.ts': 'export const y = 2;\n',
  });
  const { files, surface } = shippedSources(root, sourceFiles(root, defaultProfile()));
  assert.deepEqual(files.map((f) => f.path), ['apps/web/app/page.tsx', 'apps/web/app/tools/page.tsx', 'apps/web/package.json']);
  assert.deepEqual(surface.uiPackages, ['apps/web']);
  assert.equal(surface.notShipped, 2, 'apps/web/tools and the root scripts/');
  assert.equal(surface.outsideUi, 5, 'both manifests outside apps/web, the api source, the brand preview and the deck');
});

test('a package that renders HTML without a framework counts by its folder name; with no UI package every file counts', () => {
  const named = repo('named-web', {
    'package.json': '{"name": "root"}\n',
    'apps/web/package.json': '{"name": "@x/web", "dependencies": {"zod": "3.0.0"}}\n',
    'apps/web/src/page.ts': "export const html = '<h1>Holdover</h1>';\n",
    'packages/guard/package.json': '{"name": "@x/guard"}\n',
    'packages/guard/src/venues.ts': "export const v = [{ label: '0.01 %' }];\n",
  });
  assert.deepEqual(shippedSources(named, sourceFiles(named, defaultProfile())).files.map((f) => f.path),
    ['apps/web/package.json', 'apps/web/src/page.ts']);
  const plain = repo('plain-site', { 'site/index.html': '<h1>Hi</h1>\n', 'site/app.js': 'export const a = 1;\n' });
  assert.deepEqual(shippedSources(plain, sourceFiles(plain, defaultProfile())).files.map((f) => f.path), ['site/app.js', 'site/index.html']);
});

test('files git ignores are never judged; a root outside any repository keeps every file', (t) => {
  const root = repo('ignored', {
    '.gitignore': 'reference/\n',
    'index.html': '<!doctype html><h1>Orma</h1>\n',
    'reference/saved/page.html': '<!doctype html><h1>Saved third-party page</h1>\n',
  });
  const init = spawnSync('git', ['init', '-q', root], { encoding: 'utf8', windowsHide: true });
  if (init.status !== 0) {
    t.skip('git is not available');
    return;
  }
  const { files, surface } = shippedSources(root, sourceFiles(root, defaultProfile()));
  assert.deepEqual(files.map((f) => f.path), ['index.html']);
  assert.deepEqual(surface.keep(['reference/saved/page.html', 'index.html']), ['index.html'], 'walked paths get the same cut');
  rmSync(path.join(root, '.git'), { recursive: true, force: true });
  assert.deepEqual(shippedSources(root, sourceFiles(root, defaultProfile())).files.map((f) => f.path).sort(),
    ['index.html', 'reference/saved/page.html']);
  assert.ok(readdirSync(root).includes('.gitignore'));
});
