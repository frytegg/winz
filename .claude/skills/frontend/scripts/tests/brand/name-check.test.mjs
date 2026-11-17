// @ts-check
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ALLOWLIST, checkNames, editDistance, loadNaming, nameTokens, phoneticKey } from '../../brand.mjs';

const ALLOWLIST = fileURLToPath(new URL('../fixtures/brand/sponsor-allowlist.json', import.meta.url));
const { sponsors } = loadNaming(ALLOWLIST, null);

/** @param {string} name @returns {string[]} sponsor:entry of every hit */
function hitsOf(name) {
  return checkNames([name], sponsors).map((h) => `${h.sponsor}:${h.entry}`);
}

describe('brand name-check (FD21 naming blocklist; reports, never decides)', () => {
  test('splits names, domains and handles into tokens', () => {
    assert.deepEqual(nameTokens('AdaPay'), ['ada', 'pay']);
    assert.deepEqual(nameTokens('cardano-pay.dev'), ['cardano', 'pay']);
    assert.deepEqual(nameTokens('@solana_tools'), ['solana', 'tools']);
    assert.deepEqual(nameTokens('HTTPServer2Go'), ['http', 'server', '2', 'go']);
    assert.deepEqual(nameTokens('Café Crème'), ['cafe', 'creme']);
  });

  test('matches a mark as a token, as adjacent tokens and as the leading or trailing part of a compound', () => {
    assert.ok(hitsOf('AdaPay').includes('cardano:ADA'));
    assert.ok(hitsOf('AdaPay').includes('cardano:ADAPAY'));
    assert.deepEqual(hitsOf('cardano-pay.dev'), ['cardano:CARDANO']);
    assert.deepEqual(hitsOf('@solana_tools'), ['solana:SOLANA']);
    assert.deepEqual(hitsOf('Ledgerly'), ['ledger:LEDGER']);
    assert.deepEqual(hitsOf('Breakpoint Labs'), ['solana:BREAKPOINT']);
    assert.ok(hitsOf('Cardano Foundation Tools').includes('cardano:CARDANO FOUNDATION'));
  });

  test('matches near variants and sound-alikes of long marks ("Cardanex", "Kardano")', () => {
    assert.deepEqual(hitsOf('Cardanex'), ['cardano:CARDANO']);
    const kardano = checkNames(['Kardano'], sponsors);
    assert.deepEqual(kardano.map((h) => [h.entry, h.match, h.distance]), [['CARDANO', 'near', 1]]);
    assert.deepEqual(hitsOf('Solanna'), ['solana:SOLANA']);
  });

  test('does not match "Canada" (ADA is short: whole tokens only) nor an unrelated name', () => {
    assert.deepEqual(hitsOf('Canada'), []);
    assert.deepEqual(hitsOf('Holdover'), []);
    assert.deepEqual(hitsOf('Solflare'), []);
  });

  test('every hit carries the entry, the kind of match and a note for the owner', () => {
    const [hit] = checkNames(['Ledgerly'], sponsors);
    assert.deepEqual(Object.keys(hit).sort(), ['distance', 'entry', 'input', 'match', 'note', 'part', 'sponsor']);
    assert.equal(hit.match, 'compound');
    assert.match(hit.note, /leading part/);
  });

  test('restricts the check to the profile\'s sponsors and lists sponsors without a blocklist', () => {
    const only = loadNaming(ALLOWLIST, ['cardano', 'chainlink', 'nope']);
    assert.deepEqual(only.sponsors.map((s) => s.sponsor), ['cardano']);
    assert.deepEqual(only.withoutList, ['chainlink']);
    assert.deepEqual(only.unknown, ['nope']);
    assert.deepEqual(checkNames(['Ledgerly'], only.sponsors), []);
  });

  test('edit distance counts adjacent transpositions as one edit; phonetic keys merge c/k and drop vowels', () => {
    assert.equal(editDistance('cardano', 'cradano'), 1);
    assert.equal(editDistance('ada', 'aid'), 2);
    assert.equal(phoneticKey('Cardano'), phoneticKey('Kardanno'));
    assert.notEqual(phoneticKey('Canada'), phoneticKey('Cardano'));
  });

  test('the skill\'s own allowlist carries the FD21 blocklists', { skip: !existsSync(DEFAULT_ALLOWLIST) && 'assets/sponsor-allowlist.json not present' }, () => {
    const real = loadNaming(DEFAULT_ALLOWLIST, null);
    const byId = Object.fromEntries(real.sponsors.map((s) => [s.sponsor, s.naming_blocklist]));
    assert.ok(byId.cardano?.includes('CARDANO') && byId.cardano.includes('ADA'));
    assert.ok(byId.solana?.includes('SOL'));
    assert.ok(byId.ledger?.includes('LEDGER'));
    assert.ok(real.withoutList.includes('chainlink'));
  });
});
