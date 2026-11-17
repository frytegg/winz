// @ts-check
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  checkLeak, classLeaks, cssDeclarations, cssLiteralLeaks, defaultThemeLeaks, fontImportLeaks, inlineStyleLeaks, scanLeaks,
} from '../../tokens.mjs';
import { FIXTURES, builtGood, copyFixture } from './helpers.mjs';

/** @param {{vars?: string[], colors?: string[], families?: string[]}} [f] */
const facts = ({ vars = [], colors = [], families = [] } = {}) => ({ vars: new Set(vars), colorNames: new Set(colors), families: new Set(families) });
/** @param {{kind: string}[]} leaks */
const kinds = (leaks) => [...new Set(leaks.map((l) => l.kind))].sort();

test('passing fixture: the built good fixture leaks nothing, in source or in dist', async () => {
  const repo = await builtGood();
  try {
    const result = await checkLeak({ root: repo.dir, args: { serve: path.join(repo.dir, 'dist') } });
    assert.equal(result.state, 'ok', result.detail);
    assert.match(result.detail, /3 source files and 3 built files, Tailwind/);
  } finally {
    repo.cleanup();
  }
});

test('failing fixture: a leaky source tree fails with every kind of leak', async () => {
  const result = await checkLeak({ root: path.join(FIXTURES, 'leak-dirty') });
  assert.equal(result.state, 'fail');
  assert.deepEqual(kinds(/** @type {{kind: string}[]} */ (result.evidence.filter((e) => e.kind !== 'note'))), [
    'arbitrary-blur', 'arbitrary-color', 'css-blur', 'css-gradient', 'css-literal', 'custom-property', 'default-font',
    'default-palette', 'inline-style', 'namespace-reset',
  ]);
  const at = (/** @type {string} */ file, /** @type {number} */ line) => result.evidence.filter((e) => e.file === file && e.line === line).map((e) => e.kind);
  assert.deepEqual(at('src/index.css', 4), [], 'comments never count');
  assert.deepEqual(at('src/App.tsx', 6), [], 'comments never count');
  assert.deepEqual(at('src/index.css', 21), [], 'a url() fragment is not a colour');
  assert.deepEqual(at('src/index.css', 25), [], 'an #id selector is not a colour');
  assert.ok(!result.evidence.some((e) => /w-\[37px\]/.test(String(e.detail))), 'a plain arbitrary length is not a colour leak');
  assert.match(result.detail, /^21 leaks in 4 source files, Tailwind, no readable tokens/);
});

test('failing fixture: a leaky build fails on escaped selectors, default theme variables and font files', async () => {
  const root = path.join(FIXTURES, 'leak-dist-dirty');
  const result = await checkLeak({ root, args: { serve: path.join(root, 'dist') } });
  assert.equal(result.state, 'fail');
  const details = result.evidence.map((e) => String(e.detail));
  for (const expected of [
    /bg-\[#1a1a2e\] is a colour/, /backdrop-blur-\[12px\] is a blur/, /bg-\(--brand-glow\) reads --brand-glow/,
    /bg-indigo-500 is a Tailwind default colour/, /--color-indigo-500 is a Tailwind default/, /--shadow-md is a Tailwind default/,
    /default 150ms transition/, /default cubic-bezier\(0\.4, 0, 0\.2, 1\)/, /__Inter_aaf875/, /family=Geist loads Geist/,
    /ships inter-latin-400-normal\.woff2/,
  ]) assert.ok(details.some((d) => expected.test(d)), `finds ${expected}`);
  assert.ok(result.evidence.some((e) => e.kind === 'inline-style' && e.file === 'dist/index.html'));
});

test('a project without Tailwind is not checked for Tailwind class names', () => {
  const root = path.join(FIXTURES, 'no-tailwind');
  const scan = scanLeaks({ root, design: path.join(root, 'design'), builtDir: null, facts: facts() });
  assert.equal(scan.tailwind, false);
  assert.deepEqual(scan.leaks, []);
});

test('custom-property forms pass when they read a token variable', () => {
  const text = 'class="duration-(--duration-press) bg-(--color-bg) bg-(color:--brand) border-[var(--border)]"';
  const leaks = classLeaks(text, 'a.html', facts({ vars: ['--duration-press', '--color-bg'] }), true);
  assert.deepEqual(leaks.map((l) => l.detail), [
    'border-[var(--border)] reads --border, which the tokens do not define',
    'bg-(--brand) reads --brand, which the tokens do not define',
  ]);
});

test('arbitrary values and properties are caught with their variants', () => {
  const text = 'hover:bg-[#fff] md:[background:linear-gradient(red,blue)] [color:oklch(0.5_0.1_250)] dark:shadow-[0_0_2px_#000] p-[13px] grid-cols-[1fr_2fr] blur-[2px]';
  assert.deepEqual(classLeaks(text, 'x.tsx', facts(), false).map((l) => l.kind), ['arbitrary-color', 'arbitrary-color', 'arbitrary-blur', 'arbitrary-gradient', 'arbitrary-color']);
});

test('a token that shares a default palette name is not a leak', () => {
  const text = 'className="text-white bg-blue-500 ring-offset-white/50 from-purple-500/[0.4]"';
  const leaks = classLeaks(text, 'x.tsx', facts({ colors: ['white'] }), true);
  assert.deepEqual(leaks.map((l) => l.detail.split(' ')[0]), ['bg-blue-500', 'from-purple-500/[0.4]']);
});

test('Geist and Inter imports pass when the tokens declare the family', () => {
  const text = "import { Inter, Geist_Mono as Mono } from 'next/font/google';\nimport '@fontsource-variable/inter';";
  assert.equal(fontImportLeaks(text, 'a.ts', facts()).length, 3);
  assert.deepEqual(fontImportLeaks(text, 'a.ts', facts({ families: ['inter'] })).map((l) => l.detail), ['Geist_Mono from next/font/google is a starter default (FD16-F04)']);
});

test('plain CSS declarations are found at any depth, and only colours, gradients and blurs leak', () => {
  const css = '@media (min-width: 40rem) { .a { color: red; & .b { border-color: #000; } } }\n.c { font-family: "a;b"; content: "#fff"; filter: blur(4px); }\n@font-face { src: url(x.woff2#a); }';
  assert.deepEqual(cssDeclarations(css).map((d) => d.prop), ['color', 'border-color', 'font-family', 'content', 'filter', 'src']);
  assert.deepEqual(cssLiteralLeaks(css, 'a.css').map((l) => [l.kind, l.line]), [['css-literal', 1], ['css-literal', 1], ['css-blur', 2]]);
});

test('inline styles leak colours in HTML attributes and JSX objects', () => {
  assert.equal(inlineStyleLeaks('<p style="color: white; margin: 0">x</p>', 'a.html').length, 1);
  assert.equal(inlineStyleLeaks('<p style={{ background: "linear-gradient(red, blue)" }} />', 'a.tsx').length, 1);
  assert.equal(inlineStyleLeaks('<p style={{ color: "var(--color-text)" }} />', 'a.tsx').length, 0);
  assert.equal(inlineStyleLeaks('<p style="font-weight: bold">x</p>', 'a.html').length, 0);
});

test('default theme variables count only when the tokens do not generate them', () => {
  const css = ':root{--radius-md:.375rem;--radius-lg:.5rem;--color-white:#fff;--default-transition-duration:150ms}';
  assert.deepEqual(defaultThemeLeaks(css, 'a.css', facts({ vars: ['--radius-md', '--color-white'] })).map((l) => l.detail.split(' ')[0]), ['--radius-lg', "Tailwind's"]);
});

test('missing namespace resets are reported once, at the file that imports Tailwind', () => {
  const copy = copyFixture('no-tailwind');
  try {
    writeFileSync(path.join(copy.dir, 'src', 'main.css'), '@import "tailwindcss";\n@theme {\n  --color-*: initial;\n  --font-*: initial;\n}\n');
    const scan = scanLeaks({ root: copy.dir, design: path.join(copy.dir, 'design'), builtDir: null, facts: facts() });
    const reset = scan.leaks.filter((l) => l.kind === 'namespace-reset');
    assert.equal(reset.length, 1);
    assert.equal(reset[0].file, 'src/main.css');
    assert.ok(!reset[0].value.includes('--color-*') && reset[0].value.includes('--shadow-*'));
    writeFileSync(path.join(copy.dir, 'src', 'main.css'), '@import "tailwindcss";\n@theme { --*: initial; }\n');
    assert.equal(scanLeaks({ root: copy.dir, design: path.join(copy.dir, 'design'), builtDir: null, facts: facts() }).leaks.filter((l) => l.kind === 'namespace-reset').length, 0);
  } finally {
    copy.cleanup();
  }
});

test('test files and the design folder are not scanned', () => {
  const copy = copyFixture('no-tailwind');
  try {
    writeFileSync(path.join(copy.dir, 'src', 'app.test.tsx'), "expect(el.style.color).toBe('#ff0000');\n<p style={{ color: '#fff' }} />");
    mkdirSync(path.join(copy.dir, 'design'), { recursive: true });
    writeFileSync(path.join(copy.dir, 'design', 'notes.css'), '.x { color: #fff; }');
    assert.deepEqual(scanLeaks({ root: copy.dir, design: path.join(copy.dir, 'design'), builtDir: null, facts: facts() }).leaks, []);
  } finally {
    copy.cleanup();
  }
});
