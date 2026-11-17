// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STYLE_WHITELIST, collectAnimations, collectElements, collectText, selectorFor } from '../../lib/dom.mjs';

/** @param {string} s */
const squash = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * The source of the `function selectorFor(...) {...}` declared inside a collector (its braces are balanced).
 * @param {Function} collector
 * @returns {string}
 */
function innerSelectorFor(collector) {
  const src = collector.toString();
  const start = src.indexOf('function selectorFor(');
  assert.ok(start >= 0, `${collector.name} declares its own selectorFor`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braces');
}

test('every collector carries an identical copy of selectorFor', () => {
  const canonical = squash(selectorFor.toString());
  assert.ok(canonical.startsWith('function selectorFor(el, counts)'));
  for (const collector of [collectElements, collectText, collectAnimations]) {
    assert.equal(squash(innerSelectorFor(collector)), canonical, `${collector.name} copy drifted from the exported selectorFor`);
  }
});

test('collectElements reads exactly the contract style whitelist', () => {
  const src = collectElements.toString();
  const block = /const keys = \[([^\]]*)\]/.exec(src);
  assert.ok(block, 'collectElements declares its keys list');
  const keys = [...block[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys, [...STYLE_WHITELIST]);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of ['webkitBackgroundClip', 'borderLeftColor', 'gridTemplateColumns', 'transitionTimingFunction']) {
    assert.ok(STYLE_WHITELIST.includes(k), k);
  }
});

test('collectors only reference browser globals: no import, require or module-scope names', () => {
  for (const collector of [collectElements, collectText, collectAnimations, selectorFor]) {
    const src = collector.toString();
    assert.doesNotMatch(src, /\bimport\b|\brequire\(/, `${collector.name} must stay self-contained`);
    assert.doesNotMatch(src, /\bSTYLE_WHITELIST\b/, `${collector.name} must not reach module scope`);
  }
});
