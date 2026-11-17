// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reducedGate } from '../../motion-check.mjs';

/**
 * @typedef {import('../../motion-check.mjs').Pass} Pass
 */

/**
 * @param {string} key
 * @param {string | null} hidden
 */
function text(key, hidden) {
  return { key, sel: `#${key}`, text: key, hidden, opacity: hidden ? 0 : 1, firstViewport: false, hero: null, metric: false, live: false };
}

/**
 * A no-preference pass where the text shows and a reduce pass where it does not.
 * @param {string[]} [normalUnsettled]
 * @param {string[]} [reduceUnsettled]
 * @returns {Pass[]}
 */
function pair(normalUnsettled = [], reduceUnsettled = []) {
  return [
    { route: '/', viewport: 'desktop', mode: 'no-preference', before: [], after: [text('pricing', null)], records: [], unsettled: normalUnsettled },
    { route: '/', viewport: 'desktop', mode: 'reduce', before: [], after: [text('pricing', 'opacity 0')], records: [], unsettled: reduceUnsettled },
  ];
}

test('motion.reduced fails on text missing under reduce when both passes settled (failing fixture)', () => {
  const g = reducedGate(pair());
  assert.equal(g.state, 'fail');
  assert.match(g.detail, /1 text block\(s\) go missing under reduced motion/);
});

test('motion.reduced is skipped, not judged, when the page was read while an animation still ran', () => {
  for (const [normal, reduce] of [[['scroll'], []], [[], ['scroll']]]) {
    const g = reducedGate(pair(normal, reduce));
    assert.equal(g.state, 'skipped', g.detail);
    assert.match(g.detail, /still running 4000 ms after the scroll-through \(\/ desktop\), so the page was read mid-animation/);
  }
});

test('motion.reduced passes with nothing missing even when a settle timed out (passing fixture)', () => {
  const passes = pair(['load'], ['scroll']);
  passes[1].after = [text('pricing', null)];
  assert.equal(reducedGate(passes).state, 'ok');
});
