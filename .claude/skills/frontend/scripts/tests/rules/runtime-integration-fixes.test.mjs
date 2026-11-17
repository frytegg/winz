// @ts-check
/**
 * Detector fixes found by the end-to-end fixtures (tests/e2e.browser.test.mjs): the bad site's gradient-filled pill
 * links were not counted as buttons by SL-C01. SL-M05's fix (a 9-word figcaption made the second testimonial card
 * climb to the grid) is covered by the second card of tests/fixtures/rules/SL-M05/runtime-pos.html.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isButtonLike, isPill } from '../../rules/runtime/SL-C01.mjs';

/**
 * A minimal ElementInfo for SL-C01's predicates.
 * @param {Record<string, string>} styles
 * @param {{w?: number, h?: number, role?: string}} [shape]
 * @returns {import('../../lib/dom.mjs').ElementInfo}
 */
function element(styles, { w = 150, h = 54, role = 'link' } = {}) {
  return /** @type {any} */ ({
    sel: 'a.btn', tag: 'a', role, box: { x: 0, y: 0, w, h }, visible: true, text: 'Get started', attrs: {}, meta: {},
    styles: { display: 'inline-block', visibility: 'visible', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
      borderTopWidth: '0px', paddingLeft: '32px', borderRadius: '9999px', ...styles },
  });
}

describe('SL-C01 isButtonLike', () => {
  test('a link painted with a gradient and padded is a button', () => {
    const link = element({ backgroundImage: 'linear-gradient(90deg, rgb(124, 58, 237), rgb(37, 99, 235))' });
    assert.equal(isButtonLike(link), true);
    assert.equal(isPill(link), true);
  });

  test('a bare padded link with neither fill, gradient nor border is not', () => {
    assert.equal(isButtonLike(element({})), false);
  });

  test('a gradient link without horizontal padding is not', () => {
    assert.equal(isButtonLike(element({ backgroundImage: 'linear-gradient(red, blue)', paddingLeft: '0px' })), false);
  });
});
