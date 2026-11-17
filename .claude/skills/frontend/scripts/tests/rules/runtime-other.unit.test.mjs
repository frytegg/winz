// @ts-check
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';
import { isPill } from '../../rules/runtime/SL-C01.mjs';
import { iconHashes, iconMatch, TEMPLATE_ICONS } from '../../rules/runtime/SL-G02.mjs';
import { isCream, oklabDistance, stackIsSerif } from '../../rules/runtime/SL-M01.mjs';
import { trackingPx } from '../../rules/runtime/SL-M02.mjs';
import { markerValue } from '../../rules/runtime/SL-M03.mjs';
import { radiusPx, softShadow } from '../../rules/runtime/SL-M07.mjs';
import { isNearBlackNeutral } from '../../rules/runtime/SL-M08.mjs';
import { blurPx, hslSaturation, shadowLayers } from '../../rules/runtime/SL-M09.mjs';
import { isHorizontalLoop, translation } from '../../rules/runtime/SL-M10.mjs';
import { isMonoMicroLabel } from '../../rules/runtime/SL-M13.mjs';
import { transitionAllMs } from '../../rules/runtime/SL-MO1.mjs';
import {
  bezierOf, dedupe, easingProgress, effectiveEasing, isEaseIn, isEntrance, scaleOf, splitTopLevel, toMs, transformAtRest,
  transformFunctions, transitionPairs,
} from '../../rules/runtime/SL-MO2.mjs';
import { tooLong } from '../../rules/runtime/SL-MO3.mjs';
import { entersFromZero, isZeroScale } from '../../rules/runtime/SL-MO4.mjs';
import { movingProperties, sameMotion } from '../../rules/runtime/SL-MO5.mjs';
import { isStatText, numberKind, numericClaims } from '../../rules/runtime/SL-X01.mjs';
import { placeholderItems } from '../../rules/runtime/SL-X02.mjs';

/**
 * @typedef {import('../../rules/runtime/SL-MO2.mjs').MotionRecord} MotionRecord
 */

/**
 * A motion record with defaults, for the pure motion predicates.
 * @param {Partial<MotionRecord>} over
 * @returns {MotionRecord}
 */
function record(over) {
  return {
    selector: '.x', tag: 'div', kind: 'css-animation', name: 'a', pseudo: '', t: 0, duration: 300, delay: 0, iterations: 1,
    easing: 'linear', direction: 'normal', fill: 'both', properties: [], frames: [], box: null, layout: { w: 100, h: 40 },
    position: 'static', ...over,
  };
}

describe('motion helpers (SL-MO2 host)', () => {
  test('lists split outside parentheses; times parse to ms', () => {
    assert.deepEqual(splitTopLevel('cubic-bezier(0.4, 0, 1, 1), ease'), ['cubic-bezier(0.4, 0, 1, 1)', 'ease']);
    assert.deepEqual(splitTopLevel(''), []);
    assert.deepEqual([toMs('0.2s'), toMs('150ms'), toMs('auto'), toMs(undefined)], [200, 150, 0, 0]);
    assert.deepEqual(transitionPairs('transform, opacity', '0.7s, 0.15s', 'ease-in, ease'), [
      { property: 'transform', durationMs: 700, easing: 'ease-in' },
      { property: 'opacity', durationMs: 150, easing: 'ease' },
    ]);
    assert.deepEqual(transitionPairs('a, b, c', '1s', ''), [
      { property: 'a', durationMs: 1000, easing: 'ease' }, { property: 'b', durationMs: 1000, easing: 'ease' },
      { property: 'c', durationMs: 1000, easing: 'ease' },
    ], 'shorter lists repeat');
  });

  test('ease-in is a curve that starts slow; ease, ease-out, ease-in-out, linear and steps are not', () => {
    assert.deepEqual(bezierOf('ease-in'), [0.42, 0, 1, 1]);
    assert.equal(bezierOf('steps(2, start)'), null);
    const half = /** @type {number} */ (easingProgress('ease-in', 0.5));
    assert.ok(half > 0.3 && half < 0.33, `CSS ease-in at half time is about 0.32 (got ${half})`);
    assert.ok(Math.abs(/** @type {number} */ (easingProgress('linear', 0.5)) - 0.5) < 1e-6);
    for (const e of ['ease-in', 'cubic-bezier(0.4, 0, 1, 1)', 'cubic-bezier(0.55, 0.055, 0.675, 0.19)']) assert.equal(isEaseIn(e), true, e);
    for (const e of ['ease', 'ease-out', 'ease-in-out', 'linear', 'cubic-bezier(0.23, 1, 0.32, 1)', 'cubic-bezier(0.77, 0, 0.175, 1)', 'steps(1)', '']) {
      assert.equal(isEaseIn(e), false, e);
    }
  });

  test('a CSS animation is eased by its keyframes, a transition or Web Animation by its effect', () => {
    assert.equal(effectiveEasing(record({ easing: 'linear', frames: [{ offset: 0, easing: 'ease-in', values: {} }] })), 'ease-in');
    assert.equal(effectiveEasing(record({ kind: 'web-animation', easing: 'ease-in', frames: [{ offset: 0, easing: 'linear', values: {} }] })), 'ease-in');
  });

  test('transform values at rest depend on the property', () => {
    assert.deepEqual(transformFunctions('translateY(calc(100% - 4px)) scale(0.9)').map((f) => f.name), ['translatey', 'scale']);
    for (const [p, v] of [['transform', 'none'], ['transform', 'matrix(1, 0, 0, 1, 0, 0)'], ['transform', 'translateX(0px)'], ['translate', '0px 0px'], ['scale', '1'], ['rotate', '0deg']]) {
      assert.equal(transformAtRest(p, v), true, `${p}: ${v}`);
    }
    for (const [p, v] of [['transform', 'translateY(20px)'], ['transform', 'scale(0.95)'], ['transform', 'matrix(0, 0, 0, 0, 0, 0)'], ['scale', '0'], ['translate', '0px 8px'], ['rotate', '45deg'], ['transform', 'translateY(var(--y))'], ['transform', 'nonsense']]) {
      assert.equal(transformAtRest(p, v), false, `${p}: ${v}`);
    }
    assert.deepEqual(scaleOf('matrix(0, 0, 0, 0, 10, 20)'), { sx: 0, sy: 0 });
    assert.deepEqual(scaleOf('scale(0.5) translateX(4px)'), { sx: 0.5, sy: 0.5 });
    assert.deepEqual(scaleOf('0 0'), { sx: 0, sy: 0 });
  });

  test('entrances rise in opacity or settle a transform; exits and loops are not entrances', () => {
    const frames = (/** @type {Record<string, string>} */ a, /** @type {Record<string, string>} */ b) => [{ offset: 0, easing: 'linear', values: a }, { offset: 1, easing: 'linear', values: b }];
    assert.equal(isEntrance(record({ frames: frames({ opacity: '0' }, { opacity: '1' }) })), true);
    assert.equal(isEntrance(record({ frames: frames({ transform: 'translateY(20px)' }, { transform: 'none' }) })), true);
    assert.equal(isEntrance(record({ frames: frames({ opacity: '1' }, { opacity: '0' }) })), false, 'an exit');
    assert.equal(isEntrance(record({ frames: frames({ opacity: '1' }, { opacity: '0' }), direction: 'reverse' })), true, 'an exit played in reverse enters');
    assert.equal(isEntrance(record({ iterations: 'infinite', frames: frames({ opacity: '0' }, { opacity: '1' }) })), false, 'a loop');
  });

  test('motion items are one per element; items of removed elements stay apart by name', () => {
    const items = [
      { selector: '.a', box: null, name: 'opacity', kind: 'css-transition' },
      { selector: '.a', box: null, name: 'transform', kind: 'css-transition' },
      { selector: '', box: null, name: 'rise', kind: 'css-animation' },
      { selector: '', box: null, name: 'fade', kind: 'css-animation' },
      { selector: '', box: null, name: 'fade', kind: 'css-animation' },
    ];
    assert.deepEqual(dedupe(items).map((i) => `${i.selector}|${String(i.name)}`), ['.a|opacity', '|rise', '|fade']);
  });

  test('transition: all counts only with a duration (SL-MO1)', () => {
    assert.equal(transitionAllMs('all', '0s'), 0, 'every element computes all 0s by default');
    assert.equal(transitionAllMs('all', '0.2s'), 200);
    assert.equal(transitionAllMs('background-color, all', '0.1s, 0.3s'), 300);
    assert.equal(transitionAllMs('transform, opacity', '0.2s'), 0);
  });

  test('UI durations: page-level layers skipped, full-height sheets allowed 500 ms (SL-MO3)', () => {
    const view = { w: 1440, h: 900 };
    assert.equal(tooLong(499, 'div', { w: 300, h: 100 }, view), false);
    assert.equal(tooLong(500, 'div', { w: 300, h: 100 }, view), true);
    assert.equal(tooLong(500, 'aside', { w: 360, h: 900 }, view), false, 'a full-height sheet at 500 ms');
    assert.equal(tooLong(600, 'aside', { w: 360, h: 900 }, view), true);
    assert.equal(tooLong(800, 'div', { w: 1440, h: 900 }, view), false, 'a page-level layer');
    assert.equal(tooLong(800, 'main', { w: 900, h: 400 }, view), false);
  });

  test('zero-scale starts (SL-MO4)', () => {
    assert.equal(isZeroScale('scale(0)'), true);
    assert.equal(isZeroScale('matrix(0.05, 0, 0, 0.05, 0, 0)'), true);
    assert.equal(isZeroScale('scale(0.95)'), false);
    assert.equal(isZeroScale('scaleY(0)'), false, 'a one-axis wipe is not scale(0)');
    const grow = record({ frames: [{ offset: 0, easing: 'linear', values: { transform: 'scale(0)' } }, { offset: 1, easing: 'linear', values: { transform: 'none' } }] });
    assert.equal(entersFromZero(grow), 'scale(0)');
    assert.equal(entersFromZero({ ...grow, iterations: 'infinite' }), null, 'a loader loop');
  });

  test('reduced-motion comparison keys on movement and identity (SL-MO5)', () => {
    const rise = record({ name: 'rise', frames: [{ offset: 0, easing: 'linear', values: { opacity: '0', transform: 'translateY(24px)' } }, { offset: 1, easing: 'linear', values: { opacity: '1', transform: 'none' } }] });
    assert.deepEqual(movingProperties(rise), ['transform']);
    const pulse = record({ name: 'pulse', frames: [{ offset: 0, easing: 'linear', values: { opacity: '1' } }, { offset: 1, easing: 'linear', values: { opacity: '0.5' } }] });
    assert.deepEqual(movingProperties(pulse), [], 'opacity-only motion never counts');
    const blur = record({ frames: [{ offset: 0, easing: 'linear', values: { filter: 'blur(8px)' } }, { offset: 1, easing: 'linear', values: { filter: 'blur(0px)' } }] });
    assert.deepEqual(movingProperties(blur), ['filter'], 'blurring counts as motion since the WCAG erratum');
    assert.equal(sameMotion(rise, { ...rise }), true);
    assert.equal(sameMotion(rise, { ...rise, duration: 150 }), false, 'a different duration was handled');
    assert.equal(sameMotion(rise, { ...rise, name: 'fade' }), false);
    assert.equal(sameMotion({ ...rise, selector: '' }, { ...rise, selector: '' }), false, 'removed elements cannot be matched');
  });
});

describe('number classification (SL-X01 host)', () => {
  test('metrics against the documented false positives', () => {
    for (const t of ['10K+', '99.9%', '$4.2M', '4.9★', '12,450', '24/7', '<1s', '22.7 s']) assert.equal(numberKind(t), 'metric', t);
    assert.deepEqual(['v2.1.0', '1.2.3', '2026', '2026-10-01', 'Oct 1', '12:30', '1st', '#3', '$29/mo', '3', '01'].map(numberKind),
      ['version', 'version', 'date', 'date', 'date', 'time', 'ordinal', 'ordinal', 'price', 'label', 'label']);
    assert.deepEqual(['1.', '2. Operable', '3) Deposit', '1.1 Text Alternatives', '2.4.'].map(numberKind),
      ['ordinal', 'ordinal', 'ordinal', 'ordinal', 'ordinal'], 'section and list numbering');
    assert.deepEqual(['2.4 s', '1.2M', '99.9'].map(numberKind), ['metric', 'metric', 'metric'], 'decimals stay metrics');
    assert.equal(numberKind('Vaults'), null);
  });

  test('stat text is short, led by a number, and a metric', () => {
    for (const t of ['10K+', '$4.2M', '1,200+ users', '<1s']) assert.equal(isStatText(t), true, t);
    for (const t of ['Settle 10x faster with 99.9% uptime', 'v2.1.0', '2026', '3', 'Vault 12']) assert.equal(isStatText(t), false, t);
  });

  test('numeric claims in copy keep quantities, drop bare counts, dates and identifiers', () => {
    assert.deepEqual(numericClaims('Settle 10x faster with 99.9% uptime'), ['10x', '99.9%']);
    assert.deepEqual(numericClaims('Join 10,000 developers, settled in 2 seconds'), ['10,000 developers', '2 seconds']);
    assert.deepEqual(numericClaims('Three steps: in 3 steps, since 2019, on Web3, per ERC-20, version 1.2.3'), []);
    assert.deepEqual(numericClaims('$1.2M locked'), ['$1.2M']);
  });
});

describe('placeholders (SL-X02)', () => {
  test('patterns match rendered strings; form conventions in placeholders are left out', () => {
    const box = { x: 0, y: 0, w: 10, h: 10 };
    const items = placeholderItems([
      { sel: 'p', text: 'Acme Corp and John Doe', source: 'text', box },
      { sel: 'input', text: 'Jane Doe', source: 'placeholder', box },
      { sel: 'input:nth-of-type(2)', text: 'you@example.com', source: 'placeholder', box },
      { sel: 'input:nth-of-type(3)', text: 'TODO', source: 'placeholder', box },
      { sel: 'h2', text: 'My todo list', source: 'text', box },
      { sel: 'title', text: '[YOUR PRODUCT] home', source: 'title', box: null },
    ]);
    assert.deepEqual(items.map((i) => `${i.selector}:${i.pattern}`), ['p:acme', 'p:john-doe', 'input:nth-of-type(3):todo', 'title:your-slot']);
  });
});

describe('starter leftovers (SL-G02)', () => {
  test('SVG icons match after trailing whitespace is stripped; rasters only byte for byte', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>\n\n');
    const stripped = createHash('sha256').update('<svg xmlns="http://www.w3.org/2000/svg"/>').digest('hex');
    assert.ok(iconHashes(svg, 'image/svg+xml', '/favicon.svg').includes(stripped));
    assert.equal(iconHashes(svg, 'image/x-icon', '/favicon.ico').length, 1, 'a raster is hashed as is');
    const icon = { href: '/favicon.svg', sel: 'link', type: 'image/svg+xml', status: 200, base64: svg.toString('base64'), error: '' };
    assert.deepEqual(iconMatch(icon, [{ sha256: stripped, template: 't' }]), { sha256: stripped, template: 't' });
    assert.equal(iconMatch(icon, TEMPLATE_ICONS), null);
    assert.equal(iconMatch({ ...icon, base64: '' }, [{ sha256: stripped, template: 't' }]), null);
    assert.ok(TEMPLATE_ICONS.every((t) => /^[0-9a-f]{64}$/.test(t.sha256)), 'full SHA-256 values');
  });
});

describe('colour, type and shape helpers', () => {
  test('cream grounds, clay distance and serif stacks (SL-M01)', () => {
    for (const c of ['#F4F1EA', '#FAF9F5', '#f5efe2', '#fffbeb']) assert.equal(isCream(c), true, c);
    for (const c of ['#ffffff', '#fafafa', '#f8fafc', '#fafaf9', '#0a0a0a', 'rgba(244, 241, 234, 0.5)']) assert.equal(isCream(c), false, c);
    assert.ok(oklabDistance('#c96442', '#D97757') <= 0.06, 'a terracotta near the clay accent');
    assert.ok(oklabDistance('#ea580c', '#D97757') > 0.06, 'Tailwind orange-600 is not clay');
    assert.equal(stackIsSerif('Georgia, serif'), true);
    assert.equal(stackIsSerif('"__Fraunces_abc123", "__Fraunces_Fallback_abc123"'), true);
    assert.equal(stackIsSerif('Inter, sans-serif'), false);
    assert.equal(stackIsSerif('"Brand Display", serif'), true, 'an unknown face with a serif fallback');
    assert.equal(stackIsSerif('"Brand Display", system-ui, sans-serif'), false);
  });

  test('near-black neutral grounds (SL-M08)', () => {
    for (const c of ['#0a0a0a', '#09090b', '#111', '#000000', 'oklch(0.145 0 0)']) assert.equal(isNearBlackNeutral(c), true, c);
    for (const c of ['#0f172a', '#020617', '#262626', '#ffffff']) assert.equal(isNearBlackNeutral(c), false, c);
  });

  test('tracking, markers, radius and pills', () => {
    assert.deepEqual([trackingPx('1.68px'), trackingPx('normal'), trackingPx(undefined)], [1.68, 0, 0]);
    assert.deepEqual(['01', '02.', '(03)', '/04', '05 / 08', 'No. 06'].map(markerValue), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(['1', '2026', 'Step 1', '1st'].map(markerValue), [null, null, null, null]);
    assert.equal(radiusPx('50%', { w: 300, h: 40 }), 20);
    assert.equal(radiusPx('16px 16px 0px 0px', { w: 300, h: 40 }), 16);
    const button = /** @type {import('../../lib/dom.mjs').ElementInfo} */ (/** @type {unknown} */ ({ box: { x: 0, y: 0, w: 120, h: 40 }, styles: { borderRadius: '9999px' } }));
    assert.equal(isPill(button), true);
    assert.equal(isPill({ ...button, styles: { ...button.styles, borderRadius: '6px' } }), false);
    assert.equal(isPill({ ...button, styles: { ...button.styles, borderRadius: '50%' } }), true);
  });

  test('soft kit shadows, glows and blur (SL-M07, SL-M09)', () => {
    assert.equal(softShadow('rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.1) 0px 2px 4px -2px'), true);
    assert.equal(softShadow('rgba(0, 0, 0, 0.4) 0px 20px 40px 0px'), false, 'a heavy shadow is a choice');
    assert.equal(softShadow('rgba(139, 92, 246, 0.1) 0px 4px 6px 0px'), false, 'a coloured shadow is not the grey kit');
    assert.equal(softShadow('rgba(0, 0, 0, 0.1) 0px 0px 0px 1px inset'), false);
    assert.equal(softShadow('none'), false);
    assert.deepEqual(shadowLayers('rgba(139, 92, 246, 0.5) 0px 0px 40px 0px, rgb(0, 0, 0) 0px 1px 2px 0px inset'), [
      { color: 'rgba(139, 92, 246, 0.5)', blur: 40, inset: false },
      { color: 'rgb(0, 0, 0)', blur: 2, inset: true },
    ]);
    assert.deepEqual([blurPx('blur(40px)'), blurPx('saturate(1.2) blur(8px)'), blurPx('none')], [40, 8, 0]);
    assert.ok(hslSaturation({ r: 139 / 255, g: 92 / 255, b: 246 / 255 }) > 0.3);
    assert.equal(hslSaturation({ r: 0.5, g: 0.5, b: 0.5 }), 0);
  });

  test('marquee translations (SL-M10)', () => {
    assert.deepEqual(translation('transform', 'translateX(-50%)'), { x: '-50%', y: 0 });
    assert.deepEqual(translation('transform', 'matrix(1, 0, 0, 1, -200, 0)'), { x: '-200px', y: 0 });
    assert.deepEqual(translation('translate', '-120px'), { x: '-120px', y: 0 });
    assert.equal(translation('transform', 'rotate(360deg)'), null);
    const loop = (/** @type {string} */ a, /** @type {string} */ b) => /** @type {import('../../lib/dom.mjs').AnimationInfo} */ (/** @type {unknown} */ ({ iterations: 'infinite', keyframes: [{ transform: a }, { transform: b }] }));
    assert.equal(isHorizontalLoop(loop('translateX(0px)', 'translateX(-50%)')), true);
    assert.equal(isHorizontalLoop(loop('translateY(0px)', 'translateY(-50%)')), false);
    assert.equal(isHorizontalLoop({ ...loop('translateX(0px)', 'translateX(-50%)'), iterations: 1 }), false);
  });

  test('monospace micro-labels exclude hashes and code (SL-M13)', () => {
    const label = /** @type {import('../../lib/dom.mjs').TextInfo} */ (/** @type {unknown} */ ({ text: 'Live data', fontSize: 11, fontFamily: '"Courier New", monospace', tag: 'span', textTransform: 'uppercase' }));
    assert.equal(isMonoMicroLabel(label), true);
    assert.equal(isMonoMicroLabel({ ...label, text: '0x3f2a91c4b7' }), false);
    assert.equal(isMonoMicroLabel({ ...label, tag: 'code' }), false);
    assert.equal(isMonoMicroLabel({ ...label, fontSize: 14 }), false);
    assert.equal(isMonoMicroLabel({ ...label, fontFamily: 'Arial, sans-serif' }), false);
  });
});
