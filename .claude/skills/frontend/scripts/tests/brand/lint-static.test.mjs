// @ts-check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LINT_RULES, isBannedFace, lintMark, lintSvgStatic } from '../../brand.mjs';

const MARKS = fileURLToPath(new URL('../fixtures/brand/marks/', import.meta.url));

/** @param {string} name @returns {string} */
const read = (name) => readFileSync(`${MARKS}${name}`, 'utf8');

/** @param {string} text @returns {Set<string>} ids of fail and flag findings of the static layer */
function idsOf(text) {
  return new Set(lintSvgStatic(text).findings.filter((f) => f.severity !== 'note').map((f) => f.id));
}

/** @param {string} name @returns {Set<string>} */
const staticIds = (name) => idsOf(read(name));

/** Positive fixtures: each must raise at least these ids in the static layer. */
const POSITIVES = /** @type {Record<string, string[]>} */ ({
  'animated.svg': ['animation'],
  'complex.svg': ['complex'],
  'cube.svg': ['cube'],
  'duplicate.svg': ['duplicate'],
  'external.svg': ['image', 'external-ref'],
  'filter.svg': ['filter'],
  'gradient-hexagon.svg': ['gradient', 'thin-stroke', 'hexagon'],
  'hexagon.svg': ['hexagon'],
  'hidden.svg': ['hidden'],
  'library-icon.svg': ['library-icon'],
  'mask.svg': ['mask'],
  'nan.svg': ['nan', 'path-error'],
  'non-square.svg': ['non-square'],
  'off-grid.svg': ['off-grid'],
  'open-path.svg': ['open-path'],
  'outside.svg': ['outside-viewbox'],
  'script.svg': ['script'],
  'shading.svg': ['shading'],
  'struck-b.svg': ['struck-initial'],
  'text.svg': ['text'],
  'thin-stroke.svg': ['thin-stroke'],
  'triangle.svg': ['triangle'],
});

/** Clean marks: the research mark (class and attribute patterns) and a solid disc. */
const NEGATIVES = ['good.svg', 'good-attr.svg', 'disc.svg'];

describe('brand mark lint, static layer', () => {
  for (const [file, ids] of Object.entries(POSITIVES)) {
    test(`${file} raises ${ids.join(', ')}`, () => {
      const found = staticIds(file);
      for (const id of ids) assert.ok(found.has(id), `${file}: expected ${id}, got ${[...found].join(', ') || 'nothing'}`);
    });
  }

  for (const file of NEGATIVES) {
    test(`${file} raises no fail and no flag`, () => {
      assert.deepEqual([...staticIds(file)], []);
    });
  }

  test('every rule id a positive fixture expects is documented in LINT_RULES with a fix', () => {
    for (const ids of Object.values(POSITIVES)) {
      for (const id of ids) assert.ok(Object.hasOwn(LINT_RULES, id), `${id} missing from LINT_RULES`);
    }
  });

  test('the shape heuristics stay silent on shapes that are not clichés', () => {
    for (const file of ['good.svg', 'disc.svg', 'outside.svg', 'occluded.svg', 'narrow-gap.svg']) {
      const ids = staticIds(file);
      for (const id of ['hexagon', 'cube', 'triangle', 'struck-initial']) assert.ok(!ids.has(id), `${file} raised ${id}`);
    }
  });

  test('the dark-mode rule is reported as a note, and a rule whose selector matches nothing says so', () => {
    const note = lintSvgStatic(read('good.svg')).findings.find((f) => f.id === 'dark-rule');
    assert.match(String(note?.detail), /colours #f4f1ea/);
    const orphan = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>@media (prefers-color-scheme:dark){.gone{fill:#fff}}</style><path fill="#000" d="M4 4h24v24H4z"/></svg>';
    assert.match(String(lintSvgStatic(orphan).findings.find((f) => f.id === 'dark-rule')?.detail), /no selector matches/);
  });

  test('shipped mode fails a file SVGO would still change; the SVGO output itself passes', async () => {
    const source = read('good.svg');
    assert.ok(lintSvgStatic(source, { mode: 'shipped' }).findings.some((f) => f.id === 'svgo-unclean'));
    const { optimize } = await import('svgo');
    const { iconSvgoConfig } = await import('../../brand.mjs');
    const shipped = optimize(source, iconSvgoConfig()).data;
    assert.ok(!lintSvgStatic(shipped, { mode: 'shipped' }).findings.some((f) => f.id === 'svgo-unclean'));
  });

  test('a wordmark skips grid, stroke and shape checks but still fails text and NaN', () => {
    const wordmark = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -80 480 90"><path d="M3 0L10 -70L20 0Z" fill="#000"/></svg>';
    const ids = new Set(lintSvgStatic(wordmark, { kind: 'wordmark' }).findings.map((f) => f.id));
    for (const id of ['off-grid', 'non-square', 'triangle', 'thin-stroke']) assert.ok(!ids.has(id), id);
    assert.ok(lintSvgStatic(read('text.svg'), { kind: 'wordmark' }).findings.some((f) => f.id === 'text'));
  });

  test('open-path fires only on a filled and stroked open subpath: a fill closes it, an open stroke is a line', () => {
    assert.ok(staticIds('open-path.svg').has('open-path'));
    for (const file of ['open-fill.svg', 'open-line.svg']) assert.ok(!staticIds(file).has('open-path'), `${file} raised open-path`);
  });

  test('the closing edge a fill draws for an open subpath is still checked against the 32 grid', () => {
    const offGrid = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M5 4H28V28H5" fill="#14161a"/></svg>';
    assert.ok(idsOf(offGrid).has('off-grid'));
    const onGrid = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M4 4H28V28H4" fill="#14161a"/></svg>';
    assert.ok(!idsOf(onGrid).has('off-grid'));
  });

  test('SVGO output of a fill-only shape never fails open-path, though SVGO drops the Z a fill does not need', async () => {
    const { optimize } = await import('svgo');
    const { iconSvgoConfig } = await import('../../brand.mjs');
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M10 26V8Q10 6 12 6H22L22 10H14V26H10Z" fill="#14161a"/></svg>';
    const shipped = optimize(source, iconSvgoConfig()).data;
    const fails = lintSvgStatic(shipped, { mode: 'shipped' }).findings.filter((f) => f.severity === 'fail');
    assert.deepEqual(fails, []);
  });

  test('a malformed file is one svg.invalid finding, not an exception', () => {
    const { findings } = lintSvgStatic('<svg><path d="M0 0"');
    assert.deepEqual(findings.map((f) => f.id), ['svg.invalid']);
  });
});

describe('brand mark lint, verdict', () => {
  test('a flag passes only with a written reason; a hard fail never does', async () => {
    const triangle = read('triangle.svg');
    const bare = await lintMark(triangle);
    assert.deepEqual([bare.ok, bare.flags, bare.unexplained], [false, ['triangle'], ['triangle']]);
    const explained = await lintMark(triangle, { reasons: { triangle: 'the protocol routes three ways; the triangle is the route graph' } });
    assert.deepEqual([explained.ok, explained.unexplained], [true, []]);
    const blank = await lintMark(triangle, { reasons: { triangle: '   ' } });
    assert.equal(blank.ok, false);
    const hard = await lintMark(read('text.svg'), { reasons: { text: 'it is a wordmark' } });
    assert.deepEqual([hard.ok, hard.fails], [false, ['text']]);
  });

  test('a candidate set in a banned face fails (BR-04)', async () => {
    const report = await lintMark(read('good.svg'), { font: 'Space Grotesk' });
    assert.deepEqual(report.fails, ['banned-face']);
    assert.equal(isBannedFace('Inter Tight'), true);
    assert.equal(isBannedFace('InstrumentSerif-Regular.ttf'), true);
    assert.equal(isBannedFace('Interstate'), false);
    assert.equal(isBannedFace('IBM Plex Mono'), false);
  });
});
