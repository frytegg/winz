// @ts-check
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { TAILWIND_RESETS, build, checkValid, parseCssHeader } from '../../tokens.mjs';
import { UsageError } from '../../lib/errors.mjs';
import { buildOptions, builtGood, copyFixture, editJson } from './helpers.mjs';

/** @param {string} file */
const read = (file) => readFileSync(file, 'utf8');

test('the CSS holds light on :root first, then dark under prefers-color-scheme, data-theme and .dark', async () => {
  const repo = await builtGood();
  try {
    const css = read(path.join(repo.design, 'tokens.css'));
    const root = css.indexOf(':root {');
    const media = css.indexOf('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme]) {');
    const dark = css.indexOf(':root[data-theme="dark"], .dark {');
    assert.ok(root > 0 && media > root && dark > media, 'light, then the media block, then the explicit theme');
    assert.match(css.slice(root, media), /color-scheme: light;\n {2}\/\* colour \*\/\n {2}--color-bg: oklch\(0\.985 0\.004 250\);/);
    assert.match(css.slice(dark), /--color-bg: oklch\(0\.18 0\.012 250\);/);
    assert.match(css, /--font-mono: "Fixture Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;/);
    assert.match(css, /--text-display-l: clamp\(2rem, 1\.6rem \+ 2vw, 3rem\);\n {2}--text-display-l--line-height: 1\.1;/);
    assert.match(css, /src: url\("\.\/fonts\/FixtureSans-Regular\.woff2"\) format\("woff2"\);/);
    assert.match(css, /\.type-figure-m \{[^}]*font-variant-numeric: tabular-nums;/);
    assert.doesNotMatch(css.match(/\.type-body-m \{[^}]*\}/)?.[0] ?? '', /tabular-nums/);
    assert.ok(!css.includes(String.fromCharCode(0x2014)));
  } finally {
    repo.cleanup();
  }
});

test('the Tailwind @theme block starts with every namespace reset, then maps the tokens and the default transition', async () => {
  const repo = await builtGood();
  try {
    const css = read(path.join(repo.design, 'tokens.css'));
    const block = css.slice(css.indexOf('@theme {'));
    const lines = block.split('\n').slice(1, 1 + TAILWIND_RESETS.length).map((l) => l.trim());
    assert.deepEqual(lines, TAILWIND_RESETS.map((r) => `${r}: initial;`));
    for (const expected of ['--color-on-primary: oklch(0.99 0.004 250);', '--spacing-8: clamp(24px, 4vw, 48px);', '--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);',
      '--default-transition-duration: 160ms;', '--default-transition-timing-function: cubic-bezier(0.23, 1, 0.32, 1);', '--default-font-family: "Fixture Sans", ui-sans-serif, system-ui, sans-serif;']) {
      assert.ok(block.includes(expected), expected);
    }
    assert.ok(!block.includes('--duration-press'), 'durations have no Tailwind namespace');
    assert.deepEqual(parseCssHeader(css)?.options, { tailwind: true, fontFace: true, darkMedia: true });
  } finally {
    repo.cleanup();
  }
});

test('build is idempotent and its options are recorded and honoured', async () => {
  const repo = await builtGood();
  try {
    const cssFile = path.join(repo.design, 'tokens.css');
    const first = read(cssFile);
    const md = read(path.join(repo.design, 'DESIGN.md'));
    await build({ root: repo.dir, design: repo.design }, buildOptions(repo.dir));
    assert.equal(read(cssFile), first);
    assert.equal(read(path.join(repo.design, 'DESIGN.md')), md);
    await build({ root: repo.dir, design: repo.design }, buildOptions(repo.dir, { tailwind: 'no', fontFace: false, darkMedia: false }));
    const plain = read(cssFile);
    assert.ok(!plain.includes('@theme') && !plain.includes('@font-face') && !plain.includes('prefers-color-scheme'));
    assert.deepEqual(parseCssHeader(plain)?.options, { tailwind: false, fontFace: false, darkMedia: false });
    assert.equal((await checkValid({ root: repo.dir })).state, 'ok', 'validate regenerates with the recorded options');
  } finally {
    repo.cleanup();
  }
});

test('auto mode leaves Tailwind out of a project that does not use it', async () => {
  const copy = copyFixture('good');
  try {
    writeFileSync(path.join(copy.dir, 'package.json'), '{"name": "plain", "private": true}\n');
    writeFileSync(path.join(copy.dir, 'src', 'main.css'), '@import "../design/tokens.css";\n');
    const result = await build({ root: copy.dir, design: path.join(copy.dir, 'design') }, buildOptions(copy.dir));
    assert.equal(result.tailwind, false);
    assert.ok(!read(path.join(copy.dir, 'design', 'tokens.css')).includes('@theme'));
  } finally {
    copy.cleanup();
  }
});

test('a CSS file elsewhere gets font URLs relative to itself and is found by validate', async () => {
  const copy = copyFixture('good');
  try {
    const css = path.join(copy.dir, 'src', 'styles', 'tokens.css');
    await build({ root: copy.dir, design: path.join(copy.dir, 'design') }, buildOptions(copy.dir, { css }));
    assert.match(read(css), /url\("\.\.\/\.\.\/design\/fonts\/FixtureMono-Regular\.woff2"\)/);
    const valid = await checkValid({ root: copy.dir });
    assert.equal(valid.state, 'ok', valid.detail);
  } finally {
    copy.cleanup();
  }
});

test('DESIGN.md is the design.md alpha layout plus Motion, with one family per fontFamily', async () => {
  const repo = await builtGood();
  try {
    const md = read(path.join(repo.design, 'DESIGN.md'));
    assert.ok(md.startsWith('---\nversion: alpha\nname: "Ledgerline"\n'));
    const front = md.slice(0, md.indexOf('\n---\n'));
    for (const key of ['colors:', 'typography:', 'rounded:', 'spacing:']) assert.ok(front.includes(`\n${key}`), key);
    assert.match(front, /\n {2}display-l:\n {4}fontFamily: "Fixture Sans"\n {4}fontSize: "3rem"\n/, 'one family, the clamp() upper bound');
    assert.match(front, /\n {2}primary: "#[0-9A-F]{6}"\n/);
    assert.match(front, /\n {2}space-8: "48px"$/);
    assert.ok(!/fontFamily: "[^"]*,/.test(front), 'no stack in fontFamily');
    for (const line of front.split('\n').slice(1)) {
      assert.match(line, /^(?: {2}| {4})?(?:[a-zA-Z][a-zA-Z0-9-]*|"[^"]+"):(?: "(?:[^"\\]|\\.)*"| -?\d+(?:\.\d+)?| alpha)?$/, `well-formed YAML line: ${line}`);
    }
    const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(headings, ['Overview', 'Colors', 'Typography', 'Layout', 'Elevation & Depth', 'Shapes', 'Components', 'Motion', "Do's and Don'ts"]);
    assert.match(md, /<!-- Generated by tokens\.mjs from design\/tokens\.json \(sha256 [0-9a-f]{16}\)\. Do not edit/);
    assert.match(md, /\| text-muted \| surface \| Light \| 5\.98:1 \| 4\.5:1 \| pass \|/);
    assert.match(md, /\| Fixture Sans \| display, body \| 400 \|/);
    assert.match(md, /\| Fixture Mono \| mono \| .* \| yes \(monospace\) \|/);
    assert.ok(!md.includes(String.fromCharCode(0x2014)), 'no em dash');
    assert.ok(md.split('\n').length < 300, 'far below the collection median of 544 lines');
    assert.ok(!md.includes('system face'), 'display and body share a self-hosted face');
  } finally {
    repo.cleanup();
  }
});

test('a reflex face and a Reserved Font Name are noted in DESIGN.md', async () => {
  const copy = copyFixture('good');
  try {
    editJson(path.join(copy.dir, 'design', 'tokens.json'), (d) => {
      d.type.families.display = 'Inter Display';
      d.type.groups[0].family = 'display';
    });
    writeFileSync(path.join(copy.dir, 'design', 'fonts', 'OFL.txt'), 'Copyright 2026 Fixture Authors, with Reserved Font Name "Fixture".\n\nSIL Open Font License, Version 1.1.\n');
    await build({ root: copy.dir, design: path.join(copy.dir, 'design') }, buildOptions(copy.dir));
    const md = read(path.join(copy.dir, 'design', 'DESIGN.md'));
    assert.match(md, /Inter Display is on the dated reflex list \(FD16-F14\): give the reason in meta\.rationale/);
    assert.match(md, /Inter Display \(display\) is a system face with no file/);
    assert.match(md, /Fixture Sans: the licence reserves the name "Fixture"/);
  } finally {
    copy.cleanup();
  }
});

test('build refuses to overwrite a file it did not generate, unless forced', async () => {
  const copy = copyFixture('good');
  try {
    const design = path.join(copy.dir, 'design');
    writeFileSync(path.join(design, 'DESIGN.md'), '# A design log written by a person\n');
    await assert.rejects(build({ root: copy.dir, design }, buildOptions(copy.dir)), (err) => err instanceof UsageError && /DESIGN\.md exists and was not generated/.test(err.message));
    assert.equal(read(path.join(design, 'DESIGN.md')), '# A design log written by a person\n');
    await build({ root: copy.dir, design }, buildOptions(copy.dir, { force: true }));
    assert.match(read(path.join(design, 'DESIGN.md')), /Generated by tokens\.mjs/);
  } finally {
    copy.cleanup();
  }
});

test('a foreign mirror README stops the build before anything is written', async () => {
  const copy = copyFixture('good');
  try {
    const mirror = path.join(copy.dir, 'mirror');
    mkdirSync(path.join(mirror, 'project'), { recursive: true });
    writeFileSync(path.join(mirror, 'project', 'README.md'), '# Someone else\'s design system\n');
    await assert.rejects(build({ root: copy.dir, design: path.join(copy.dir, 'design') }, buildOptions(copy.dir, { mirror })), UsageError);
    assert.ok(!existsSync(path.join(copy.dir, 'design', 'DESIGN.md')), 'nothing written');
    assert.ok(!existsSync(path.join(copy.dir, 'design', 'tokens.css')), 'nothing written');
  } finally {
    copy.cleanup();
  }
});

test('build refuses a structurally invalid tokens file', async () => {
  const copy = copyFixture('invalid');
  try {
    await assert.rejects(build({ root: copy.dir, design: path.join(copy.dir, 'design') }, buildOptions(copy.dir)), (err) => err instanceof UsageError && /cannot be built from/.test(err.message));
    assert.ok(!existsSync(path.join(copy.dir, 'design', 'DESIGN.md')));
  } finally {
    copy.cleanup();
  }
});

test('the Claude Design mirror is list-shaped, base theme first, names unique, no motion, open fonts copied', async () => {
  const copy = copyFixture('good');
  try {
    editJson(path.join(copy.dir, 'design', 'tokens.json'), (d) => {
      d.color.themes.reverse();
      d.type.fonts.push({ ...d.type.fonts[1], family: 'Fixture Mono', license: 'ITF FFL 2.0 (Fontshare)' });
    });
    const mirrorDir = path.join(copy.dir, 'mirror');
    const result = await build({ root: copy.dir, design: path.join(copy.dir, 'design') }, buildOptions(copy.dir, { mirror: mirrorDir }));
    const tokens = JSON.parse(read(path.join(mirrorDir, 'project', 'tokens.json')));
    assert.deepEqual(Object.keys(tokens), ['name', 'version', 'color', 'type', 'spacing', 'radius', 'shadow']);
    assert.deepEqual(tokens.color.themes.map((/** @type {any} */ t) => t.id), ['light', 'dark']);
    assert.deepEqual(Object.keys(tokens.color.tokens[0]), ['name', 'value', 'usage']);
    assert.deepEqual(Object.keys(tokens.color.tokens[0].value), ['light', 'dark']);
    assert.equal(tokens.type.families.mono, '"Fixture Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');
    assert.deepEqual(tokens.type.groups.map((/** @type {any} */ g) => g.family), ['display', 'body', 'mono']);
    assert.equal(tokens.type.groups[0].styles[0].fontSize, '3rem');
    assert.deepEqual(tokens.spacing.tokens.map((/** @type {any} */ t) => [t.name, t.value]), [['spacing-1', '4px'], ['spacing-2', '8px'], ['spacing-4', '16px'], ['spacing-8', '48px']]);
    assert.deepEqual(tokens.radius.tokens.map((/** @type {any} */ t) => t.name), ['radius-sm', 'radius-md', 'radius-full']);
    assert.equal(tokens.shadow.tokens[0].name, 'shadow-raised');
    const names = [...tokens.color.tokens, ...tokens.spacing.tokens, ...tokens.radius.tokens, ...tokens.shadow.tokens].map((t) => t.name);
    assert.equal(new Set(names).size, names.length);
    assert.deepEqual(readdirSync(path.join(mirrorDir, 'project', 'fonts')).sort(), ['FixtureMono-Regular.woff2', 'FixtureSans-Regular.woff2']);
    assert.deepEqual(tokens.type.fonts.map((/** @type {any} */ f) => f.file), ['fonts/FixtureSans-Regular.woff2', 'fonts/FixtureMono-Regular.woff2']);
    assert.ok(result.dropped.some((d) => /forbids design tools/.test(d)));
    const readme = read(path.join(mirrorDir, 'project', 'README.md'));
    assert.match(readme, /A one-way mirror/);
    assert.match(readme, /## Motion/);
    assert.match(readme, /## Not in this mirror/);
  } finally {
    copy.cleanup();
  }
});
