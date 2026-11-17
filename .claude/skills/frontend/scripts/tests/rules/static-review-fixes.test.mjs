// @ts-check
/**
 * Regression tests for the detector review of 2026-10 (one test per finding the review raised): mounted-only motion
 * and markup rules, SL-T16's copy scope, SL-T17's specificity and glossary, SL-T12's prop-gated reveal.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { defaultProfile } from '../../lib/profile.mjs';
import { loadAllowlists, loadRegistry, runStatic, staticContext } from '../../rules/load.mjs';

/**
 * @typedef {import('../../rules/load.mjs').StaticFinding} StaticFinding
 * @typedef {import('../../rules/load.mjs').Rule} Rule
 */

const registry = loadRegistry();
const tmp = mkdtempSync(path.join(process.env.FRONTEND_TEST_TMP ?? os.tmpdir(), 'fe-review-fixes-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * @param {string} id
 * @returns {Rule}
 */
function rule(id) {
  const found = registry.rules.find((r) => r.id === id);
  assert.ok(found, id);
  return found;
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

/**
 * @param {string} root
 * @param {string[]} ids
 * @returns {Promise<StaticFinding[]>}
 */
async function run(root, ids) {
  const profile = defaultProfile();
  const findings = await runStatic(ids.map(rule), staticContext(root, profile, loadAllowlists(root, profile)));
  assert.deepEqual(findings.filter((f) => 'error' in f), []);
  return /** @type {StaticFinding[]} */ (findings);
}

/** Vendored effects and library primitives as agentfi and SUI shipped them (FD14-F12, F22). */
const EFFECTS = {
  'src/components/MagicBento.tsx': [
    'export function MagicBento() {',
    '  return (',
    '    <div className="grid grid-cols-4 gap-4">',
    '      <div className="col-span-2 row-span-2">A</div>',
    '      <div className="col-span-1">B</div>',
    '      <div className="col-span-1 row-span-2">C</div>',
    '      <div className="col-span-2">D</div>',
    '    </div>',
    '  );',
    '}',
    '',
  ].join('\n'),
  'src/components/ElectricBorder.tsx': "import './ElectricBorder.css';\nexport function ElectricBorder() {\n  return <div className=\"eb-glow\" />;\n}\n",
  'src/components/ElectricBorder.css': '.eb-glow { box-shadow: 0 0 24px #8b5cf6; }\n.eb-halo { box-shadow: 0 0 40px #06b6d4; }\n',
  'src/components/AnimatedContent.tsx': "import { gsap } from 'gsap';\nexport function AnimatedContent() {\n  gsap.from('.x', { y: 40, duration: 0.6 });\n  return <div className=\"eb-halo x\" />;\n}\n",
  'src/components/ui/alert-dialog.tsx': 'export const content = "data-[state=open]:animate-in data-[state=open]:zoom-in-95 transition-all hover:bg-accent";\nexport function AlertDialog() {\n  return <button className="transition-all hover:bg-accent">Open</button>;\n}\n',
};

test('SL-M09, SL-M11, SL-MO1 and SL-MO5 skip vendored effects and primitives that no entry mounts, and fire once mounted', async () => {
  const ids = ['SL-M09', 'SL-M11', 'SL-MO1', 'SL-MO5'];
  const idle = repo('effects-idle', {
    ...EFFECTS,
    'src/main.tsx': "import { App } from './App';\nexport const root = <App />;\n",
    'src/App.tsx': 'export function App() {\n  return <main>Ledger</main>;\n}\n',
  });
  assert.deepEqual((await run(idle, ids)).map((f) => `${f.rule} ${f.file}`), [], 'nothing renders them');
  const live = repo('effects-live', {
    ...EFFECTS,
    'src/main.tsx': "import { App } from './App';\nexport const root = <App />;\n",
    'src/App.tsx': [
      "import { MagicBento } from './components/MagicBento';",
      "import { ElectricBorder } from './components/ElectricBorder';",
      "import { AnimatedContent } from './components/AnimatedContent';",
      "import { AlertDialog } from './components/ui/alert-dialog';",
      'export function App() {',
      '  return <main><MagicBento /><ElectricBorder /><AnimatedContent /><AlertDialog /></main>;',
      '}',
      '',
    ].join('\n'),
  });
  const fired = new Set((await run(live, ids)).map((f) => f.rule));
  assert.deepEqual([...fired].sort(), ids, 'each rule fires on the same files once an entry mounts them');
});

test('SL-T16: "label — ·" is a placeholder, a regex literal is not copy, and the location is the dash itself', async () => {
  const words = Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i} explains how the escrow settles — and why the carrier signs first, in plain words for the reader.</p>`);
  const root = repo('t16-scope', {
    'src/App.tsx': ['export function App() {', '  return (', '    <main>', ...words.map((w) => `      ${w}`), '      <p className="op-sub">Lending facility · — · internal score — · outlook —</p>', '    </main>', '  );', '}', ''].join('\n'),
    'src/parse.ts': "export const split = (h: string) => h.match(/^(S\\d+)\\s*[—:-]\\s*(.+)$/) || [null, '', h];\n",
  });
  const findings = await run(root, ['SL-T16']);
  assert.ok(findings.length > 0, 'the dashed paragraphs fire');
  assert.ok(findings.every((f) => f.file === 'src/App.tsx'), 'the regex literal is never a location');
  assert.match(findings[0].detail, /40 in \d+\)/, 'only the 40 prose dashes count: the three in the placeholder line do not');
  assert.ok(findings.every((f) => /^.*—/.test(f.excerpt)), 'each location holds a dash');
});

test('SL-T16: a "WORD — fragment" label counts only in rendered text, never in a function argument or a numbered id', async () => {
  const root = repo('t16-labels', {
    'src/Card.tsx': [
      "import { rec } from './harness';",
      "rec('VaultDeposit — graded LP', true);",
      'export function Card() {',
      '  return (',
      '    <div>',
      '      <h3>L2 — no published version of the rule</h3>',
      '      <span>Speed — sub-second finality</span>',
      '    </div>',
      '  );',
      '}',
      '',
    ].join('\n'),
  });
  const findings = await run(root, ['SL-T16']);
  assert.deepEqual(findings.map((f) => `${f.file}:${f.line}`), ['src/Card.tsx:7']);
});

test('SL-T16: a rate within one dash of PR-01 is marked borderline', async () => {
  const filler = Array.from({ length: 30 }, (_, i) => `<p>Section ${i} describes the vault, the tranche and the payout in ordinary words for credit analysts.</p>`);
  const root = repo('t16-borderline', {
    'src/App.tsx': ['export function App() {', '  return (', '    <main>', ...filler.map((w) => `      ${w}`),
      '      <p>The junior tranche absorbs the first loss — the senior one is paid first.</p>', '    </main>', '  );', '}', ''].join('\n'),
  });
  const findings = await run(root, ['SL-T16']);
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /borderline: one dash fewer would pass/);
});

test('SL-T17: digits inside a name are not specificity, and the project glossary removes a protocol word', async () => {
  const copy = Array.from({ length: 30 }, (_, i) => `<p>Agents ${String.fromCharCode(65 + (i % 26))} handle requests for the marketplace and settle them for each buyer.</p>`);
  const files = {
    'src/page.tsx': ['export default function Page() {', '  return (', '    <main>',
      '      <h1>The Banking System For Autonomous AI Agents</h1>',
      '      <p>Own them as iNFTs on 0G Chain. Cutting-edge agents for the agentic economy.</p>',
      '      <p>Manage your autonomous AI agents.</p>',
      '      <p>Hire an agent from the marketplace to get started.</p>',
      '      <p>Autonomous agents settle on ERC-7857 tokens.</p>',
      ...copy.map((c) => `      ${c}`), '    </main>', '  );', '}', ''].join('\n'),
  };
  const plain = await run(repo('t17-plain', files), ['SL-T17']);
  assert.ok(plain.some((f) => /promotional phrase "Cutting-edge"/.test(f.detail)), '"0G" is a name, not a claim');
  assert.ok(plain.some((f) => /stock template phrase "autonomous"/.test(f.detail)), 'protocol words count without a glossary');
  const glossed = await run(repo('t17-glossary', { ...files, 'design/glossary.json': '{"terms": ["autonomous"]}\n' }), ['SL-T17']);
  assert.ok(!glossed.some((f) => /"autonomous"/i.test(f.detail)), 'the glossary removes the word');
});

test('SL-T12: a prop-gated reveal fires when one mount leaves the prop on', async () => {
  const component = [
    "import { motion } from 'motion/react';",
    'export const TextAnimate = ({ startOnView = true, children }: { startOnView?: boolean; children: string }) => (',
    "  <motion.div initial=\"hidden\" whileInView={startOnView ? 'show' : undefined}>{children}</motion.div>",
    ');',
    '',
  ].join('\n');
  const mounts = (/** @type {string} */ second) => repo(`t12-${second ? 'on' : 'off'}`, {
    'src/main.tsx': "import { Hero } from './Hero';\nexport const root = <Hero />;\n",
    'src/components/magicui/text-animate.tsx': component,
    'src/Hero.tsx': `import { TextAnimate } from './components/magicui/text-animate';\nexport function Hero() {\n  return <section><TextAnimate startOnView={false}>One</TextAnimate>${second}</section>;\n}\n`,
  });
  assert.deepEqual(await run(mounts(''), ['SL-T12']), [], 'every mount turns the in-view trigger off');
  const on = await run(mounts('<TextAnimate>Two</TextAnimate>'), ['SL-T12']);
  assert.deepEqual(on.map((f) => `${f.file} ${f.detail}`).sort(), [
    'src/Hero.tsx Magic UI TextAnimate animates in view by default',
    'src/components/magicui/text-animate.tsx Motion whileInView reveal',
  ]);
});
