// @ts-check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { optimize } from 'svgo';
import {
  buildGeometry, darkModeReport, flattenPath, iconSvgoConfig, multiply, parseCss, parsePathData, parseSvgTree,
  parseTransform, polygonInfo, simplifyClosed, sizedSvg, specifiedStyles, withDarkRule,
} from '../../brand.mjs';

const MARKS = fileURLToPath(new URL('../fixtures/brand/marks/', import.meta.url));
const GOOD = readFileSync(`${MARKS}good.svg`, 'utf8');

/** @param {number} a @param {number} b @param {number} [eps] */
function near(a, b, eps = 1e-6) {
  assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);
}

describe('brand path data', () => {
  test('parses absolute, relative and implicit commands, exponents and packed numbers', () => {
    const { commands, error } = parsePathData('M1.5.5l2e1-3 4,5 h-1V10zm1 1 2 2');
    assert.equal(error, null);
    assert.deepEqual(commands, [
      { cmd: 'M', args: [1.5, 0.5] }, { cmd: 'l', args: [20, -3] }, { cmd: 'l', args: [4, 5] }, { cmd: 'h', args: [-1] },
      { cmd: 'V', args: [10] }, { cmd: 'z', args: [] }, { cmd: 'm', args: [1, 1] }, { cmd: 'l', args: [2, 2] },
    ]);
  });

  test('reads arc flags written without separators', () => {
    const { commands, error } = parsePathData('M0 0a1 1 0 00 1 1A2 2 0 1110 10');
    assert.equal(error, null);
    assert.deepEqual(commands[1], { cmd: 'a', args: [1, 1, 0, 0, 0, 1, 1] });
    assert.deepEqual(commands[2], { cmd: 'A', args: [2, 2, 0, 1, 1, 10, 10] });
  });

  test('stops at the first error and keeps what came before, as renderers do', () => {
    const parsed = parsePathData('M4 4L28 NaN L16 28Z');
    assert.equal(parsed.commands.length, 1);
    assert.match(String(parsed.error), /bad L argument/);
    assert.match(String(parsePathData('L1 1').error), /must start with M/);
  });

  test('flattens lines, curves and arcs; Z closes and the next subpath restarts at the start point', () => {
    const subs = flattenPath(parsePathData('M0 0H10V10H0ZL5 5M20 0C20 10 30 10 30 0A5 5 0 0 1 40 0').commands, 0.5);
    assert.equal(subs.length, 3);
    assert.equal(subs[0].closed, true);
    assert.deepEqual(subs[0].points, [[0, 0], [10, 0], [10, 10], [0, 10]]);
    assert.deepEqual(subs[1].points, [[0, 0], [5, 5]]);
    const last = subs[2].points[subs[2].points.length - 1];
    assert.deepEqual(last, [40, 0]);
    assert.ok(subs[2].curve.every(Boolean));
    const arcTop = Math.min(...subs[2].points.filter((p) => p[0] > 30).map((p) => p[1]));
    near(arcTop, -5, 0.05);
  });
});

describe('brand transforms and geometry', () => {
  test('parses transform lists, including rotate about a point and CSS units', () => {
    const r = parseTransform('translate(10 5) rotate(90 1 1) scale(2)');
    assert.equal(r.error, null);
    const [a, b, c, d, e, f] = r.matrix;
    const x = a * 1 + c * 0 + e;
    const y = b * 1 + d * 0 + f;
    near(x, 12);
    near(y, 7);
    const css = parseTransform('rotate(0.25turn) translate(2px, 0)');
    near(css.matrix[4], 0, 1e-9);
    near(css.matrix[5], 2, 1e-9);
    assert.match(String(parseTransform('wobble(3)').error), /cannot read/);
    assert.deepEqual(multiply([1, 0, 0, 1, 0, 0], [2, 0, 0, 2, 3, 4]), [2, 0, 0, 2, 3, 4]);
  });

  test('builds painted geometry through use, groups, transforms and inherited paint', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 32 32">
      <defs><rect id="r" width="4" height="4"/></defs>
      <g fill="#123456" transform="translate(10 10)"><use xlink:href="#r" x="2" y="2"/><circle cx="0" cy="0" r="2" stroke="#000" stroke-width="2" transform="scale(2)"/></g>
    </svg>`;
    const geo = buildGeometry(parseSvgTree(svg));
    assert.deepEqual(geo.viewBox, { x: 0, y: 0, w: 32, h: 32 });
    assert.equal(geo.elements.length, 2);
    const [rect, circle] = geo.elements;
    assert.equal(rect.viaUse, true);
    assert.equal(rect.fill, '#123456');
    assert.deepEqual(rect.bbox, { x: 12, y: 12, w: 4, h: 4 });
    near(circle.strokeWidth, 4);
    near(/** @type {{w: number}} */ (circle.bbox).w, 8, 0.01);
  });

  test('simplifies a sampled hexagon to its six corners and measures it', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 2l12.12 7v14L16 30 3.88 23V9z"/></svg>`;
    const [hex] = buildGeometry(parseSvgTree(svg)).elements;
    const poly = simplifyClosed(hex.subpaths[0].points, 0.5);
    const info = polygonInfo(poly);
    assert.equal(info.n, 6);
    assert.equal(info.convex, true);
    for (const a of info.angles) near(a, 120, 1);
  });
});

describe('brand CSS and dark-mode rules (FD12-F24)', () => {
  test('reads rules, nested media blocks, !important and strings', () => {
    const nodes = parseCss('/* c */ .a{fill:red !important; content:"x;y"} @media (prefers-color-scheme: dark){.a{fill:#fff}} @import url(x.css);');
    assert.equal(nodes.length, 3);
    assert.deepEqual(nodes[0], { type: 'rule', selector: '.a', decls: [{ prop: 'fill', value: 'red', important: true }, { prop: 'content', value: '"x;y"', important: false }] });
    const media = nodes[1];
    assert.equal(media.type === 'at' && media.name, 'media');
    assert.equal(media.type === 'at' && media.children?.length, 1);
    assert.equal(nodes[2].type === 'at' && nodes[2].name, 'import');
  });

  test('the research mark has a dark rule whose selector matches its path', () => {
    const report = darkModeReport(GOOD);
    assert.deepEqual([report.present, report.matched, report.colours], [true, true, ['#f4f1ea']]);
  });

  test('SVGO preset-default drops the class-based dark rule; inlineStyles: false keeps it (the gotcha)', () => {
    const lost = darkModeReport(optimize(GOOD, { multipass: true }).data);
    assert.equal(lost.present && lost.matched, false);
    const kept = darkModeReport(optimize(GOOD, iconSvgoConfig()).data);
    assert.deepEqual([kept.present, kept.matched], [true, true]);
  });

  test('withDarkRule writes the light colour as an attribute and only the dark override in @media, which survives the default preset', () => {
    const plain = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><title>m</title><path fill="currentColor" d="M4 4h24v24H4z"/></svg>';
    const withRule = withDarkRule(plain, { map: null, dark: '#f4f1ea', ink: '#14161a' });
    assert.match(withRule, /fill="#14161a"/);
    assert.match(withRule, /prefers-color-scheme:dark/);
    for (const config of [{ multipass: true }, iconSvgoConfig()]) {
      const report = darkModeReport(optimize(withRule, config).data);
      assert.deepEqual([report.present, report.matched, report.colours], [true, true, ['#f4f1ea']]);
    }
    assert.throws(() => withDarkRule(plain, { map: new Map([['#abcdef', '#000000']]), dark: null, ink: '#14161a' }), /no colour in the mark matches/);
  });

  test('cascade: presentation attribute < style rule by specificity < style attribute; dark rules apply only in the dark scheme', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><style>path{fill:blue} #p{fill:green} @media (prefers-color-scheme: dark){#p{fill:white}}</style>
      <path id="p" fill="red" d="M0 0h8v8z"/><path id="q" fill="red" style="fill:black" d="M0 0h8v8z"/></svg>`;
    const tree = parseSvgTree(svg);
    const light = specifiedStyles(tree, 'light');
    const dark = specifiedStyles(tree, 'dark');
    const byId = (/** @type {Map<import('svgo').XastElement, Record<string, string>>} */ m, /** @type {string} */ id) => [...m].find(([el]) => el.attributes.id === id)?.[1];
    assert.equal(byId(light, 'p')?.fill, 'green');
    assert.equal(byId(dark, 'p')?.fill, 'white');
    assert.equal(byId(light, 'q')?.fill, 'black');
  });

  test('sizedSvg sets pixel dimensions and keeps the viewBox', () => {
    const sized = sizedSvg(GOOD, 16, 16);
    assert.match(sized, /width="16"/);
    assert.match(sized, /viewBox="0 0 32 32"/);
    const fromDims = sizedSvg('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><rect width="48" height="24"/></svg>', 32, 16);
    assert.match(fromDims, /viewBox="0 0 48 24"/);
  });
});
