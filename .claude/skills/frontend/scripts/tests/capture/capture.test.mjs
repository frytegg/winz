// @ts-check
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_SLICES, compactElements, parseDeleteBy, parseSlices, resolveCaptureViewports, summarizeMedia } from '../../capture.mjs';
import { MAX_SLICES_PER_VIEWPORT, MAX_VIEWPORTS_PER_PAGE } from '../../capture-gate.mjs';
import { UsageError } from '../../lib/errors.mjs';
import { DEFAULT_VIEWPORTS } from '../../lib/profile.mjs';

/**
 * @param {Partial<import('../../lib/dom.mjs').ElementInfo>} over
 * @returns {import('../../lib/dom.mjs').ElementInfo}
 */
function el(over) {
  return {
    sel: 'x', tag: 'div', role: '', box: { x: 0, y: 0, w: 10, h: 10 }, visible: true, text: '', styles: {}, attrs: {}, meta: {},
    parent: -1, depth: 0, ...over,
  };
}

describe('capture viewports, slices and deadlines', () => {
  test('defaults to the profile\'s first two viewports; names and WIDTHxHEIGHT resolve; more than two is refused', () => {
    const profile = DEFAULT_VIEWPORTS.map((v) => ({ ...v }));
    assert.deepEqual(resolveCaptureViewports(undefined, profile).map((v) => v.name), ['desktop', 'mobile']);
    assert.equal(MAX_VIEWPORTS_PER_PAGE, 2);
    const bySize = resolveCaptureViewports('1440x900,390x844', profile);
    assert.deepEqual(bySize.map((v) => v.name), ['desktop', 'mobile']);
    assert.equal(bySize[1].isMobile, true);
    const custom = resolveCaptureViewports('1280x800,375x667', profile);
    assert.deepEqual(custom.map((v) => [v.name, v.dpr, v.isMobile]), [['1280x800', 1, false], ['375x667', 2, true]]);
    assert.throws(() => resolveCaptureViewports('desktop,mobile,reflow', profile), (err) => err instanceof UsageError && /at most 2/.test(err.message));
    assert.throws(() => resolveCaptureViewports('desktop,desktop', profile), UsageError);
    assert.throws(() => resolveCaptureViewports('tablet', profile), UsageError);
    assert.throws(() => resolveCaptureViewports(' , ', profile), UsageError);
  });

  test('slices default to 3 and stay within the policy cap', () => {
    assert.equal(parseSlices(undefined), DEFAULT_SLICES);
    assert.equal(parseSlices('1'), 1);
    assert.equal(parseSlices(String(MAX_SLICES_PER_VIEWPORT)), MAX_SLICES_PER_VIEWPORT);
    for (const bad of ['0', String(MAX_SLICES_PER_VIEWPORT + 1), 'many', '2.5']) assert.throws(() => parseSlices(bad), UsageError, bad);
  });

  test('the deletion deadline must be a future date within 30 days', () => {
    const now = new Date('2026-10-01T10:00:00Z');
    assert.equal(parseDeleteBy(undefined, now), null);
    assert.equal(parseDeleteBy('2026-10-08T00:00:00Z', now)?.toISOString(), '2026-10-08T00:00:00.000Z');
    for (const bad of ['tomorrow', '2026-09-30T00:00:00Z', '2027-01-01T00:00:00Z']) assert.throws(() => parseDeleteBy(bad, now), UsageError, bad);
  });
});

describe('compactElements', () => {
  test('keeps visible elements, re-points parents past dropped ones, and leaves out initial style values', () => {
    const elements = [
      el({ sel: 'body', tag: 'body', styles: { backgroundColor: 'rgb(255, 255, 255)', opacity: '1', marginTop: '0px' } }),
      el({ sel: 'div.hidden', visible: false, parent: 0, depth: 1 }),
      el({ sel: 'p', tag: 'p', parent: 1, depth: 2, styles: { borderTopWidth: '0px', borderTopColor: 'rgb(0, 0, 0)', borderLeftWidth: '2px', borderLeftColor: 'rgb(255, 0, 0)', color: 'rgb(26, 26, 26)' } }),
    ];
    const out = compactElements(elements);
    assert.deepEqual(out.map((e) => e.sel), ['body', 'p']);
    assert.equal(out[1].parent, 0);
    assert.equal(out[1].depth, 1);
    assert.deepEqual(out[0].styles, { backgroundColor: 'rgb(255, 255, 255)' });
    assert.deepEqual(out[1].styles, { borderLeftWidth: '2px', borderLeftColor: 'rgb(255, 0, 0)', color: 'rgb(26, 26, 26)' });
  });
});

describe('summarizeMedia', () => {
  test('reads width breakpoints from expressions, from the query text, and from range syntax', () => {
    const summary = summarizeMedia([
      { text: 'screen and (max-width: 640px)', mediaList: [{ expressions: [{ feature: 'max-width', value: 640, unit: 'px', computedLength: 640 }] }] },
      { text: '(min-width: 64em)', mediaList: [] },
      { text: '(width >= 1280px)' },
      { text: '(prefers-reduced-motion: reduce)' },
      { text: 'screen and (max-width: 640px)', mediaList: [{ expressions: [{ feature: 'max-width', value: 640, unit: 'px' }] }] },
    ]);
    assert.equal(summary.count, 5);
    assert.deepEqual(summary.widths, [
      { feature: 'max-width', px: 640, count: 2 },
      { feature: 'min-width', px: 1024, count: 1 },
      { feature: 'min-width', px: 1280, count: 1 },
    ]);
  });
});
