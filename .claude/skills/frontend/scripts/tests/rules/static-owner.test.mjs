// @ts-check
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { defaultProfile } from '../../lib/profile.mjs';
import { loadAllowlists, loadRegistry, runStatic, staticContext } from '../../rules/load.mjs';

/**
 * @typedef {import('../../rules/load.mjs').StaticFinding} StaticFinding
 * @typedef {import('../../rules/load.mjs').Rule} Rule
 */

const FIXTURES = fileURLToPath(new URL('../fixtures/rules/', import.meta.url));
const STATIC_DIR = fileURLToPath(new URL('../../rules/static/', import.meta.url));
const registry = loadRegistry();
const owner = registry.rules.filter((r) => r.family === 'owner-tell');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-static-owner-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * Findings of the given rules on a folder, through the loader's own context and runner. Fails on any detector error.
 * @param {string} root
 * @param {Rule[]} rules
 * @param {Record<string, unknown>} [profileOverrides]
 * @param {{sponsorFile?: string}} [allowlistOptions]
 * @returns {Promise<StaticFinding[]>}
 */
async function run(root, rules, profileOverrides = {}, allowlistOptions = {}) {
  const profile = defaultProfile(profileOverrides);
  const findings = await runStatic(rules, staticContext(root, profile, loadAllowlists(root, profile, allowlistOptions)));
  const errors = findings.filter((f) => 'error' in f);
  assert.deepEqual(errors, [], `detectors must not throw on ${root}`);
  return /** @type {StaticFinding[]} */ (findings);
}

/**
 * @param {string} id
 * @returns {Rule}
 */
function rule(id) {
  const found = registry.rules.find((r) => r.id === id);
  assert.ok(found, `${id} is in the registry`);
  return found;
}

/**
 * Writes a small repository under the temporary folder and returns its root.
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

/**
 * @param {StaticFinding[]} findings
 * @returns {string[]}
 */
const where = (findings) => findings.map((f) => `${f.file}:${f.line}`).sort();

/**
 * Sorted `file:line` of every finding on each fixture folder: positives pinned, negatives (with the realistic false
 * positives the dossiers name) silent. static-sponsor fires by colour here; the hash exemption is its own test.
 */
const EXPECTED = /** @type {Record<string, Record<string, string[]>>} */ ({
  'SL-T01': {
    'static-neg': [],
    'static-pos': ['src/Hero.tsx:3', 'src/Hero.tsx:4', 'src/Hero.tsx:5', 'src/theme.css:7'],
    'static-sponsor': ['brand/sponsor-kit.css:3'],
  },
  'SL-T02': { 'static-neg': [], 'static-pos': ['src/Hero.tsx:4', 'src/Hero.tsx:5', 'src/Hero.tsx:6', 'src/title.css:7'] },
  'SL-T03': {
    'static-neg': [],
    'static-pos': ['index.html:5', 'src/Features.tsx:10', 'src/Features.tsx:2', 'src/Features.tsx:9', 'src/Sidebar.tsx:4',
      'src/Sidebar.tsx:5', 'src/Sidebar.tsx:6'],
  },
  'SL-T04': { 'static-neg': [], 'static-paired': [], 'static-pos': ['app/globals.css:2', 'app/layout.tsx:4'] },
  'SL-T05': {
    'static-neg': [],
    'static-pos': ['src/Cards.tsx:10', 'src/Cards.tsx:4', 'src/Cards.tsx:7', 'src/Offers.tsx:7', 'src/Offers.tsx:8',
      'src/Offers.tsx:9', 'src/callouts.css:12', 'src/callouts.css:20', 'src/callouts.css:7', 'src/ring.css:7'],
  },
  'SL-T06': { 'static-neg': [], 'static-pos': ['src/Cards.tsx:10', 'src/Cards.tsx:4', 'src/Cards.tsx:7', 'src/glass.css:4'] },
  'SL-T07': {
    'static-neg': [], 'static-neg-light': [],
    'static-pos': ['src/Stats.tsx:4', 'src/Stats.tsx:5', 'src/Stats.tsx:6', 'src/theme.css:6'],
  },
  'SL-T08': { 'static-neg': [], 'static-pos': ['src/Benefits.tsx:11', 'src/Features.tsx:5'] },
  'SL-T09': { 'static-neg': [], 'static-pos': ['index.html:5', 'src/Hero.tsx:15', 'src/Hero.tsx:6'] },
  'SL-T10': { 'static-neg': [], 'static-pos': ['package.json:5', 'src/Features.tsx:1', 'src/Hero.tsx:1', 'src/Hero.tsx:1'] },
  'SL-T11': { 'static-neg': [], 'static-neg-rethemed': [], 'static-pos': ['src/components/ui/button.tsx:6', 'src/index.css:15', 'src/index.css:4'] },
  'SL-T12': {
    'static-neg': [],
    'static-pos': ['src/Reveal.tsx:6', 'src/Section.tsx:10', 'src/Section.tsx:11', 'src/Section.tsx:7', 'src/anim.css:3'],
  },
  'SL-T13': { 'static-neg': [], 'static-pos': ['src/Cards.tsx:7', 'src/Cards.tsx:8', 'src/Glow.tsx:4', 'src/cursor.js:2'] },
  'SL-T14': { 'static-neg': [], 'static-pos': ['src/App.tsx:7', 'src/components/ui/button.tsx:6', 'src/styles.css:7'] },
  'SL-T15': {
    'static-neg': [],
    'static-pos': ['src/Landing.tsx:5', 'src/Landing.tsx:7', 'src/Landing.tsx:8', 'src/Landing.tsx:9', 'src/Landing.tsx:9'],
  },
  'SL-T16': {
    'static-neg': [], 'static-neg-fr': [],
    'static-pos': ['src/About.tsx:13', 'src/About.tsx:25', 'src/About.tsx:33', 'src/About.tsx:6'],
  },
  'SL-T17': {
    'static-neg': [],
    'static-pos': ['src/Landing.tsx:30', 'src/Landing.tsx:31', 'src/Landing.tsx:4', 'src/Landing.tsx:4', 'src/Landing.tsx:5',
      'src/Landing.tsx:5', 'src/Landing.tsx:5', 'src/Landing.tsx:6', 'src/Landing.tsx:7', 'src/Landing.tsx:8'],
  },
  'SL-T18': { 'static-neg': [], 'static-pos': ['src/Hero.tsx:13', 'src/Hero.tsx:5', 'src/Hero.tsx:7', 'src/hero.css:3', 'src/hero.css:8'] },
  'SL-T19': { 'static-neg': [], 'static-pos': ['app/globals.css:4', 'app/layout.tsx:4', 'app/layout.tsx:5', 'src/Hero.tsx:5'] },
  'SL-T20': { 'static-neg': [], 'static-neg-pages': [], 'static-pos': ['src/Grain.tsx:2', 'src/Hero.tsx:6', 'src/grain.css:6'] },
});

test('every owner-tell rule SL-T01 to SL-T20 has a static detector with positive and negative fixtures', () => {
  const flagged = owner.filter((r) => r.static).map((r) => r.id);
  assert.equal(flagged.length, 20, 'T01-T20 are all static');
  assert.deepEqual(Object.keys(EXPECTED).sort(), [...flagged].sort(), 'every flagged rule has pinned expectations');
  for (const id of flagged) {
    assert.ok(existsSync(path.join(STATIC_DIR, `${id}.mjs`)), `rules/static/${id}.mjs exists`);
    const dirs = readdirSync(path.join(FIXTURES, id)).filter((d) => d.startsWith('static-'));
    assert.ok(dirs.includes('static-pos'), `${id} has a positive fixture`);
    assert.ok(dirs.some((d) => d.startsWith('static-neg')), `${id} has a negative fixture`);
    assert.deepEqual(dirs.sort(), Object.keys(EXPECTED[id]).sort(), `${id}: every static fixture folder is pinned`);
  }
});

test('detectors that adapt pbakaus/impeccable carry the attribution line', () => {
  for (const id of ['SL-T01', 'SL-T02', 'SL-T05', 'SL-T17']) {
    const source = readFileSync(path.join(STATIC_DIR, `${id}.mjs`), 'utf8');
    assert.match(source, /adapted from pbakaus\/impeccable, Apache-2\.0/, id);
    assert.equal(source.split('\n')[0], '// @ts-check', `${id} line 1`);
  }
});

for (const [id, dirs] of Object.entries(EXPECTED)) {
  test(`${id} fires on its positive fixture and stays silent on its negative ones`, async () => {
    for (const [dir, expected] of Object.entries(dirs)) {
      const findings = await run(path.join(FIXTURES, id, dir), [rule(id)]);
      assert.deepEqual(where(findings), [...expected].sort(), `${id} ${dir}`);
      for (const f of findings) {
        assert.equal(f.rule, id);
        assert.equal(f.layer, 'static');
        assert.ok(Number.isInteger(f.line) && f.line > 0, `${id} ${f.file} line`);
        assert.ok(f.excerpt.length > 0 && f.excerpt.length <= 120, `${id} ${f.file}:${f.line} excerpt`);
        assert.ok(f.detail.length > 20, `${id} ${f.file}:${f.line} names the matched pattern`);
        assert.ok(f.value !== '' && f.value !== undefined && f.value !== null, `${id} ${f.file}:${f.line} carries a value`);
      }
    }
  });
}

test('findings name the pattern and carry the values a fixer needs', async () => {
  const t01 = await run(path.join(FIXTURES, 'SL-T01', 'static-pos'), [rule('SL-T01')]);
  assert.equal(t01.find((f) => f.line === 5)?.value, 'from-primary to-accent', 'theme tokens resolve through custom properties');
  const t06 = await run(path.join(FIXTURES, 'SL-T06', 'static-pos'), [rule('SL-T06')]);
  assert.deepEqual(t06.map((f) => f.value), [
    'backdrop-blur-md bg-white/10',
    'backdrop-blur-[20px] rgba(15, 23, 42, 0.45)',
    'backdrop-filter: blur(8px); rgba(124, 58, 237, 0.2)',
    'backdrop-filter: blur(12px); rgba(255, 255, 255, 0.08)',
  ], 'a utility list, a utility with an inline fill, a style object and a stylesheet rule');
  const t07 = await run(path.join(FIXTURES, 'SL-T07', 'static-pos'), [rule('SL-T07')]);
  assert.equal(t07.find((f) => f.file === 'src/theme.css')?.value, '2.13:1');
  assert.match(String(t07.find((f) => f.line === 5)?.value), /^text-white\/30 2\.\d\d:1$/);
  const [t08] = await run(path.join(FIXTURES, 'SL-T08', 'static-pos'), [rule('SL-T08')]);
  assert.equal(t08.value, '3 columns, 3 icon tiles', 'the mapped array counts its icon: entries');
  const t10 = await run(path.join(FIXTURES, 'SL-T10', 'static-pos'), [rule('SL-T10')]);
  assert.deepEqual(t10.map((f) => f.value).sort(), ['3 of 4 files', 'Rocket', 'ShieldIcon', 'Sparkles']);
  const t11 = await run(path.join(FIXTURES, 'SL-T11', 'static-pos'), [rule('SL-T11')]);
  assert.match(t11.find((f) => f.line === 15)?.detail ?? '', /never applied/, 'a .dark block nothing switches on is called dead');
  const t15 = await run(path.join(FIXTURES, 'SL-T15', 'static-pos'), [rule('SL-T15')]);
  assert.deepEqual(t15.map((f) => f.value).sort(), ['gap-[1.1rem]', 'p-[13px]', 'pb-10 pt-14', 'py-16', 'py-20']);
  const t16 = await run(path.join(FIXTURES, 'SL-T16', 'static-pos'), [rule('SL-T16')]);
  assert.ok(t16.every((f) => /4 in 33\d\)/.test(f.detail)), 'each em dash and each word of copy counts once');
  const t17 = await run(path.join(FIXTURES, 'SL-T17', 'static-pos'), [rule('SL-T17')]);
  assert.ok(t17.some((f) => /promotional phrase "cutting-edge"/.test(f.detail)));
  assert.ok(t17.some((f) => /stock template phrase "how it works": [\d.]+ stock phrases per 1,000 words/.test(f.detail)));
  const t19 = await run(path.join(FIXTURES, 'SL-T19', 'static-pos'), [rule('SL-T19')]);
  assert.equal(t19.filter((f) => /Space Grotesk \+ Instrument Serif pair/.test(f.detail)).length, 2, 'the owner-named pair is called out');
  const t20 = await run(path.join(FIXTURES, 'SL-T20', 'static-pos'), [rule('SL-T20')]);
  assert.match(t20.find((f) => f.file === 'src/grain.css')?.detail ?? '', /full-screen grain layer .*src\/Hero\.tsx/);
});

test('SL-T01 exempts a sponsor file by its SHA-256 only, never by colour', async () => {
  const root = path.join(FIXTURES, 'SL-T01', 'static-sponsor');
  const sha256 = createHash('sha256').update(readFileSync(path.join(root, 'brand', 'sponsor-kit.css'))).digest('hex');
  const sponsorFile = path.join(tmp, 'sponsor-allowlist.json');
  writeFileSync(sponsorFile, `${JSON.stringify({ sponsor_allowlist: [{ sponsor: 'acme-chain', logo_sources: [{ sha256 }] }] })}\n`);
  assert.deepEqual(await run(root, [rule('SL-T01')], { sponsors: ['acme-chain'] }, { sponsorFile }), []);
  const copy = repo('sponsor-copy', {
    'brand/sponsor-kit.css': `${readFileSync(path.join(root, 'brand', 'sponsor-kit.css'), 'utf8')}\n.extra { color: red; }\n`,
    'index.html': readFileSync(path.join(root, 'index.html'), 'utf8'),
  });
  assert.deepEqual(where(await run(copy, [rule('SL-T01')], { sponsors: ['acme-chain'] }, { sponsorFile })), ['brand/sponsor-kit.css:3'],
    'an edited copy of the same colours no longer matches the hash');
});

test('tells written only in comments never fire', async () => {
  const root = repo('comments-only', {
    'src/Commented.tsx': [
      '// <h1>🚀 Launch</h1> <Badge>New</Badge> whileInView= new IntersectionObserver( onMouseMove={(e) => e.clientX}',
      '/* className="bg-gradient-to-r from-violet-600 to-blue-500 bg-clip-text text-transparent border-l-4 border-violet-500',
      '   rounded-2xl bg-white/10 backdrop-blur-md text-gray-600 hover:opacity-80 p-[13px] font-[Syne]" */',
      "// import { Sparkles, Rocket, Zap } from 'lucide-react';",
      'export function Commented() {',
      '  return <div>{/* Supercharge your workflow — cutting-edge — Speed — sub-second finality <feTurbulence /> */}</div>;',
      '}',
      '',
    ].join('\n'),
    'src/commented.css': [
      '/* body { font-family: Inter; background: #0a0a0a } .x { background: linear-gradient(90deg, #8b5cf6, #3b82f6); }',
      '   .card { border-left: 4px solid #2563eb; backdrop-filter: blur(12px); background: rgba(255,255,255,.1) }',
      '   h1 em { font-family: "Instrument Serif"; font-style: italic } :root { --radius: 0.625rem; --primary: oklch(0.205 0 0);',
      '   --background: oklch(1 0 0); } .btn:hover { opacity: .8 } .card { animation-timeline: view(); } */',
      '.ok { color: #1b1b1b; }',
      '',
    ].join('\n'),
    'index.html': '<!doctype html>\n<html lang="en">\n<!-- <h1>🚀 Launch — now</h1> <span class="rounded-full px-3 py-1">New</span> -->\n<title>Orma</title>\n</html>\n',
  });
  const findings = await run(root, owner.filter((r) => r.static));
  assert.deepEqual(findings.map((f) => `${f.rule} ${f.file}:${f.line}`), []);
});

test('test, spec and story files never fire', async () => {
  const tells = [
    "import { Sparkles, Rocket } from 'lucide-react';",
    'export const S = () => (',
    '  <section className="bg-gradient-to-r from-violet-600 to-blue-500">',
    '    <span className="rounded-full border px-3 py-1">New</span>',
    '    <h1 className="bg-gradient-to-r from-violet-500 to-pink-500 bg-clip-text text-transparent">🚀 Launch <em>now</em></h1>',
    '    <div className="rounded-2xl bg-white/10 backdrop-blur-md border-l-4 border-violet-500"><h3>Card</h3></div>',
    '    <motion.div whileInView={{ opacity: 1 }} />',
    '    <button className="bg-violet-600 hover:opacity-80">Go</button>',
    '    <p>Supercharge your workflow with cutting-edge tooling.</p>',
    '  </section>',
    ');',
    '',
  ].join('\n');
  const root = repo('not-shipped', {
    'src/Hero.test.tsx': tells,
    'src/Hero.spec.tsx': tells,
    'src/Hero.stories.tsx': tells,
    'src/__tests__/Hero.tsx': tells,
    'e2e/hero.tsx': tells,
    'tests/hero.tsx': tells,
  });
  const findings = await run(root, owner.filter((r) => r.static));
  assert.deepEqual(findings.map((f) => `${f.rule} ${f.file}:${f.line}`), []);
});

test('SL-T17: naming a sponsor or a number makes a promotional sentence specific', async () => {
  const root = repo('sponsor-copy-t17', {
    'src/Hero.tsx': 'export const Hero = () => <h1>Cutting-edge escrow on Cardano</h1>;\nexport const Sub = () => <p>Ultimately, we ship.</p>;\n',
  });
  assert.deepEqual(where(await run(root, [rule('SL-T17')])), ['src/Hero.tsx:1'], 'no sponsor in the profile: the phrase fires');
  assert.deepEqual(await run(root, [rule('SL-T17')], { sponsors: ['cardano'] }), [], 'the profile sponsor makes it specific');
  const numbered = repo('number-copy-t17', { 'src/Hero.tsx': 'export const Hero = () => <h1>Cutting-edge escrow in 2 seconds</h1>;\n' });
  assert.deepEqual(await run(numbered, [rule('SL-T17')]), []);
});

test('SL-T16: under 300 words of copy only the WORD — fragment label is reported', async () => {
  const root = repo('short-copy-t16', {
    'src/Card.tsx': [
      'export function Card() {',
      '  return (',
      '    <div>',
      '      <p>Escrow releases the funds — once the carrier signs the delivery.</p>',
      '      <span>Speed — sub-second finality</span>',
      '    </div>',
      '  );',
      '}',
      '',
    ].join('\n'),
  });
  const findings = await run(root, [rule('SL-T16')]);
  assert.deepEqual(where(findings), ['src/Card.tsx:5']);
  assert.match(findings[0].detail, /^'WORD — fragment' label/);
});

test('SL-T18 and SL-T20 skip stylesheet rules on classes no shipped file uses', async () => {
  const css = readFileSync(path.join(FIXTURES, 'SL-T18', 'static-pos', 'src', 'hero.css'), 'utf8');
  assert.deepEqual(await run(repo('dead-t18', { 'src/hero.css': css }), [rule('SL-T18')]), [], '.hero-title and .display-heading are never used');
  const grain = readFileSync(path.join(FIXTURES, 'SL-T20', 'static-pos', 'src', 'grain.css'), 'utf8');
  const root = repo('dead-t20', {
    'src/grain.css': `${grain}\n.unused-hero {\n  background: linear-gradient(135deg, #7c3aed, #db2777);\n}\n`,
  });
  assert.deepEqual(await run(root, [rule('SL-T20')]), [], 'neither the grain layer nor the gradient renders');
});

test('SL-T08, SL-T12, SL-T13 and SL-T14 judge only what an entry point mounts', async () => {
  const root = repo('unmounted', {
    'src/main.tsx': "import { App } from './App';\nexport const root = <App />;\n",
    'src/App.tsx': 'export function App() {\n  return <main>Plain</main>;\n}\n',
    'src/Effects.tsx': [
      "import { Zap, Lock, Shield } from 'lucide-react';",
      'export function Effects() {',
      '  return (',
      '    <section className="grid grid-cols-3" onMouseMove={(e) => e.currentTarget.style.setProperty(\'--mouse-x\', `${e.clientX}px`)}>',
      '      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-500/10"><Zap /></div>',
      '      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-500/10"><Lock /></div>',
      '      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-500/10"><Shield /></div>',
      '      <motion.p whileInView={{ opacity: 1 }}>Hi</motion.p>',
      '      <button className="bg-violet-600 hover:opacity-80">Go</button>',
      '    </section>',
      '  );',
      '}',
      '',
    ].join('\n'),
  });
  const rules = ['SL-T08', 'SL-T12', 'SL-T13', 'SL-T14'].map(rule);
  assert.deepEqual(await run(root, rules), []);
  writeFileSync(path.join(root, 'src', 'App.tsx'), "import { Effects } from './Effects';\nexport function App() {\n  return <Effects />;\n}\n");
  const mounted = await run(root, rules);
  assert.deepEqual(mounted.map((f) => `${f.rule} ${f.file}:${f.line}`).sort(),
    ['SL-T08 src/Effects.tsx:4', 'SL-T12 src/Effects.tsx:8', 'SL-T13 src/Effects.tsx:4', 'SL-T14 src/Effects.tsx:9']);
});
