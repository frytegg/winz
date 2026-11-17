// @ts-check
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { build, checkValid } from '../../tokens.mjs';
import { buildOptions, builtGood, copyFixture, editJson, makeFont, toWoff2 } from './helpers.mjs';

/**
 * Builds a copy of the good fixture, applies a change, rebuilds when asked, and runs tokens.valid.
 * @param {(dir: string) => void | Promise<void>} change @param {{rebuild?: boolean}} [opts]
 */
async function validAfter(change, { rebuild = true } = {}) {
  const repo = await builtGood();
  try {
    await change(repo.dir);
    if (rebuild) await build({ root: repo.dir, design: repo.design }, buildOptions(repo.dir));
    return await checkValid({ root: repo.dir });
  } finally {
    repo.cleanup();
  }
}

/** @param {string} dir @param {(data: any) => void} fn */
const tokens = (dir, fn) => editJson(path.join(dir, 'design', 'tokens.json'), fn);

test('passing fixture: the good fixture, once built, is valid', async () => {
  const result = await validAfter(() => {}, { rebuild: false });
  assert.equal(result.state, 'ok', result.detail);
  assert.match(result.detail, /8 colours, 5 type styles/);
  assert.match(result.detail, /DESIGN\.md and 1 CSS file/);
  assert.equal(result.id, 'tokens.valid');
  assert.ok(result.ifDropped.length > 0);
});

test('failing fixture: an empty usage fails tokens.valid', async () => {
  const result = await validAfter((dir) => tokens(dir, (d) => { d.color.tokens[3].usage = ''; }), { rebuild: false });
  assert.equal(result.state, 'fail');
  assert.match(result.detail, /color\.tokens\[3\]\.usage/);
  assert.ok(result.evidence.some((e) => e.path === 'color.tokens[3].usage'));
});

test('a missing tokens.json fails, it is not skipped', async () => {
  const copy = copyFixture('good');
  try {
    rmSync(path.join(copy.dir, 'design', 'tokens.json'));
    const result = await checkValid({ root: copy.dir });
    assert.equal(result.state, 'fail');
    assert.match(result.detail, /tokens\.json not found/);
  } finally {
    copy.cleanup();
  }
});

/** @type {[string, (dir: string) => void, RegExp, string][]} */
const VALUE_CASES = [
  ['a third family', (dir) => tokens(dir, (d) => d.type.fonts.push({ ...d.type.fonts[0], family: 'Third Face' })), /Third Face.*at most two families/, 'TK-12'],
  ['a named colour', (dir) => tokens(dir, (d) => { d.color.tokens[0].value.light = 'white'; }), /named colour/, 'TK-02'],
  ['an out-of-gamut oklch', (dir) => tokens(dir, (d) => { d.color.tokens[5].value.light = 'oklch(0.48 0.2 250)'; }), /outside the sRGB gamut/, 'TK-07'],
  ['a var() in a shadow', (dir) => tokens(dir, (d) => { d.shadow.tokens[0].value.light = '0 1px 2px var(--shadow-color)'; }), /var\(\)/, 'TK-02'],
  ['a spacing that is not a length', (dir) => tokens(dir, (d) => { d.spacing.tokens[0].value = 'roomy'; }), /not a length/, 'CONTRACTS 6.2'],
  ['an em dash in the rationale', (dir) => tokens(dir, (d) => { d.meta.rationale += ` ${String.fromCharCode(0x2014)} and more`; }), /em dash/, 'TK-21'],
  ['a mono family with no group', (dir) => tokens(dir, (d) => { d.type.groups.pop(); }), /has no role/, 'TK-12'],
  ['ease-in', (dir) => tokens(dir, (d) => { d.motion.tokens.push({ name: 'ease-in', value: 'ease-in', usage: 'exits' }); }), /ease-in/, 'TK-20'],
  ["Tailwind's default curve", (dir) => tokens(dir, (d) => { d.motion.tokens[0].value = 'cubic-bezier(0.4, 0, 0.2, 1)'; }), /Tailwind's default/, 'TK-20'],
  ['a bounce', (dir) => tokens(dir, (d) => { d.motion.tokens[1].value = 'cubic-bezier(0.34, 1.56, 0.64, 1)'; }), /bounce/, 'TK-20'],
  ['a dropdown over budget', (dir) => tokens(dir, (d) => { d.motion.tokens[5].value = '400ms'; }), /dropdown budget of 250 ms/, 'TK-20'],
  ['a UI duration over 300 ms', (dir) => tokens(dir, (d) => { d.motion.tokens.push({ name: 'duration-page', value: '450ms', usage: 'page change' }); }), /UI motion stays at 300 ms/, 'TK-20'],
  ['transition: all', (dir) => tokens(dir, (d) => { d.motion.tokens.push({ name: 'transition-base', value: 'all 200ms ease-out', usage: 'hover on links' }); }), /animates "all"/, 'TK-20'],
  ['no motion tokens', (dir) => tokens(dir, (d) => { d.motion.tokens = []; }), /defines no easing/, 'TK-20'],
  ['no ease-out curve', (dir) => tokens(dir, (d) => {
    d.motion.tokens = d.motion.tokens.filter((/** @type {any} */ t) => !['ease-out', 'ease-drawer'].includes(t.name));
    d.motion.tokens.push({ name: 'ease-linear', value: 'linear', usage: 'progress bars' });
  }), /has no ease-out curve/, 'TK-20'],
];

test('an ease-out curve may be written as the keyword or as any curve above the diagonal', async () => {
  for (const value of ['ease-out', 'cubic-bezier(0, 0, 0.2, 1)', 'opacity 200ms cubic-bezier(0.23, 1, 0.32, 1)']) {
    const result = await validAfter((dir) => tokens(dir, (d) => {
      d.motion.tokens = d.motion.tokens.filter((/** @type {any} */ t) => !['ease-out', 'ease-drawer'].includes(t.name));
      d.motion.tokens.push({ name: 'curve-enter', value, usage: 'entrances' });
    }));
    assert.ok(!result.evidence.some((e) => /has no ease-out curve/.test(String(e.value))), `${value}: ${result.detail}`);
  }
});

for (const [label, change, message, rule] of VALUE_CASES) {
  test(`failing fixture: ${label} fails tokens.valid (${rule})`, async () => {
    const result = await validAfter(change);
    assert.equal(result.state, 'fail', `${label}: ${result.detail}`);
    assert.ok(result.evidence.some((e) => e.rule === rule && message.test(String(e.value))), `${label}: ${JSON.stringify(result.evidence)}`);
  });
}

test('an explanatory animation may run longer when its usage says so', async () => {
  const result = await validAfter((dir) => tokens(dir, (d) => {
    d.motion.tokens.push({ name: 'duration-hero', value: '1200ms', usage: 'the hero explanation of the settlement flow' });
  }));
  assert.equal(result.state, 'ok', result.detail);
});

test('a missing licence file and a missing font file fail (TK-14)', async () => {
  const noLicence = await validAfter((dir) => rmSync(path.join(dir, 'design', 'fonts', 'OFL.txt')));
  assert.equal(noLicence.state, 'fail');
  assert.ok(noLicence.evidence.some((e) => e.rule === 'TK-14' && /OFL\.txt not found/.test(String(e.value))));
  const noFont = await validAfter((dir) => rmSync(path.join(dir, 'design', 'fonts', 'FixtureMono-Regular.woff2')));
  assert.ok(noFont.evidence.some((e) => e.rule === 'TK-14' && /FixtureMono-Regular\.woff2 not found/.test(String(e.value))));
});

test('a proportional face in the mono role fails twice: not monospaced, no tabular figures (TK-12, TK-17)', async () => {
  const result = await validAfter((dir) => {
    writeFileSync(path.join(dir, 'design', 'fonts', 'FixtureMono-Regular.woff2'), toWoff2(makeFont({ family: 'Fixture Mono' })));
  });
  assert.equal(result.state, 'fail');
  assert.ok(result.evidence.some((e) => e.rule === 'TK-12' && /not monospaced/.test(String(e.value))));
  assert.ok(result.evidence.some((e) => e.rule === 'TK-17' && /no tnum feature and proportional digits/.test(String(e.value))));
});

test('without a mono role or a data group the body face must be tabular (TK-17)', async () => {
  /** @param {string} dir */
  const noMono = (dir) => tokens(dir, (d) => {
    d.type.families.mono = null;
    d.type.fonts.pop();
    d.type.groups.pop();
  });
  const tnumBody = await validAfter(noMono);
  assert.equal(tnumBody.state, 'ok', tnumBody.detail);
  const proportional = await validAfter((dir) => {
    noMono(dir);
    writeFileSync(path.join(dir, 'design', 'fonts', 'FixtureSans-Regular.woff2'), toWoff2(makeFont({ family: 'Fixture Sans' })));
  });
  assert.equal(proportional.state, 'fail');
  assert.ok(proportional.evidence.some((e) => e.rule === 'TK-17' && /body face shows the numbers/.test(String(e.value))));
});

test('a DESIGN.md edited by hand fails, and so does a stale view', async () => {
  const edited = await validAfter((dir) => appendFileSync(path.join(dir, 'design', 'DESIGN.md'), '\nA hand-written note.\n'), { rebuild: false });
  assert.equal(edited.state, 'fail');
  assert.ok(edited.evidence.some((e) => /DESIGN\.md differs .* \(edited by hand\)/.test(String(e.value))));
  const stale = await validAfter((dir) => tokens(dir, (d) => { d.color.tokens[0].value.light = 'oklch(0.99 0.004 250)'; }), { rebuild: false });
  assert.equal(stale.state, 'fail');
  assert.ok(stale.evidence.some((e) => /DESIGN\.md was generated from an older tokens file/.test(String(e.value))));
  assert.ok(stale.evidence.some((e) => /tokens\.css was generated from an older tokens file/.test(String(e.value))));
  const cssEdited = await validAfter((dir) => {
    const css = path.join(dir, 'design', 'tokens.css');
    writeFileSync(css, readFileSync(css, 'utf8').replace('--radius-sm: 4px;', '--radius-sm: 6px;'));
  }, { rebuild: false });
  assert.ok(cssEdited.evidence.some((e) => /tokens\.css differs .* \(edited by hand\)/.test(String(e.value))));
});

test('a hand-written DESIGN.md and a missing CSS view fail', async () => {
  const handWritten = await validAfter((dir) => writeFileSync(path.join(dir, 'design', 'DESIGN.md'), '# Notes\n'), { rebuild: false });
  assert.ok(handWritten.evidence.some((e) => /was not generated by tokens\.mjs/.test(String(e.value))));
  const noCss = await validAfter((dir) => rmSync(path.join(dir, 'design', 'tokens.css')), { rebuild: false });
  assert.ok(noCss.evidence.some((e) => /no CSS generated from design\/tokens\.json/.test(String(e.value))));
});

test('Windows line endings in the views do not count as edits', async () => {
  const result = await validAfter((dir) => {
    for (const f of ['DESIGN.md', 'tokens.css']) {
      const file = path.join(dir, 'design', f);
      writeFileSync(file, readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
    }
  }, { rebuild: false });
  assert.equal(result.state, 'ok', result.detail);
});
