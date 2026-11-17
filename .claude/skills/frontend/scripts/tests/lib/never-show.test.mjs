// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { foldNeverShow, neverShowRegexProblem } from '../../lib/text.mjs';
import { SchemaRegistry } from '../assets/json-schema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.resolve(HERE, '..', '..', '..', 'assets', 'schemas', 'never-show.schema.json');
const ch = (/** @type {number} */ code) => String.fromCharCode(code);

/** Inside the common subset of JavaScript and Python `re` (Q-F9). */
const ACCEPTED = [
  'internal-codename',
  '\\bproject\\s+x\\b',
  '^(?:alpha|beta)-[0-9]{2,4}$',
  'audit (?=report)',
  'leak(?!age)',
  '[A-Z]{3}-\\d+',
  '[^a-z]+?',
  'a{2}?b*?c+?',
  '(group)\\.(two)',
  '\\x41\\u00e9\\t\\n',
  '[\\]\\-]',
  '\\\\1 is a literal backslash and a digit',
  'cost: \\$\\d+(\\.\\d{2})?',
];

/** Outside it: each must be refused with a reason. */
const REFUSED = [
  ['(?<=secret)code', /lookbehind/],
  ['(?<!not )secret', /lookbehind/],
  ['(?<name>x)', /named group/],
  ['(?P<name>x)', /named group/],
  ['(x)\\1', /backreference \(\\1\)/],
  ['(?<n>x)\\k<n>', /named group/],
  ['x\\k<n>', /named backreference/],
  ['(?i)secret', /inline flag/],
  ['(?-i:Secret)', /inline flag/],
  ['(?>atomic)', /atomic group/],
  ['a*+', /possessive/],
  ['a++', /possessive/],
  ['a?+', /possessive/],
  ['a{2}+', /possessive/],
  ['\\Aanchor', /only Python reads/],
  ['end\\Z', /only Python reads/],
  ['end\\z', /only Python reads/],
  ['\\p{L}+', /Unicode property/],
  ['[\\P{L}]', /Unicode property/],
  ['\\cJ', /control escape/],
  ['[^]', /starts with \]/],
  ['[]a]', /starts with \]/],
  ['\\e', /read differently/],
  ['\\x4', /two hex digits/],
  ['\\u{41}', /four hex digits/],
  ['(?#comment)x', /comment group/],
  ['(?(1)a|b)', /conditional group/],
  ['trailing\\', /lone backslash/],
];

test('neverShowRegexProblem accepts the common subset', () => {
  for (const p of ACCEPTED) assert.equal(neverShowRegexProblem(p), null, p);
});

test('neverShowRegexProblem refuses every construct the two engines read differently, with the reason', () => {
  for (const [p, why] of REFUSED) {
    const problem = neverShowRegexProblem(/** @type {string} */ (p));
    assert.ok(problem, `${p} must be refused`);
    assert.match(/** @type {string} */ (problem), /** @type {RegExp} */ (why), String(p));
  }
});

test('foldNeverShow folds NFKC then lower-case, never a full casefold', () => {
  assert.equal(foldNeverShow(`${ch(0xff33)}ECRET`), 'secret', 'fullwidth S folds under NFKC');
  assert.equal(foldNeverShow(`${ch(0xfb01)}LE`), 'file', 'the fi ligature decomposes');
  assert.equal(foldNeverShow(`STRA${ch(0xdf)}E`), `stra${ch(0xdf)}e`, 'sharp s stays: lower(), not casefold() (which gives ss)');
  assert.equal(foldNeverShow(`${ch(0x130)}`), `i${ch(0x307)}`, 'dotted capital I lowers as Python lower() does');
});

test('the never-show schema refuses the same constructs for regex entries only', () => {
  const registry = new SchemaRegistry();
  registry.add(JSON.parse(readFileSync(SCHEMA, 'utf8')));
  /** @param {string} pattern @param {boolean} regex */
  const errors = (pattern, regex) => registry.validate('urn:frontend:schema:never-show:1', {
    version: 1,
    entries: [{ id: 'e1', class: 'never-public', pattern, regex, case_sensitive: false, until_utc: null, scope: 'both', source: 'notes.md:1' }],
  });
  // The schema's textual pattern cannot tell an escaped backslash before a digit from a backreference; the gates use
  // the escape-aware neverShowRegexProblem, so this one stricter case is expected.
  for (const p of ACCEPTED.filter((x) => !x.startsWith('\\\\1'))) assert.deepEqual(errors(p, true), [], p);
  assert.ok(errors('\\\\1 literal', true).length > 0, 'the schema is stricter, never looser, than the gate check');
  for (const [p] of REFUSED.filter(([x]) => !['\\e', '\\x4', '\\u{41}', '[]a]', 'trailing\\', 'a*+', 'a++', 'a?+', 'a{2}+'].includes(/** @type {string} */ (x)))) {
    assert.ok(errors(/** @type {string} */ (p), true).length > 0, `schema refuses ${p}`);
  }
  assert.deepEqual(errors('(?<=as literal text)', false), [], 'a literal entry may hold any text');
});

test('Python re compiles every accepted pattern and matches as JavaScript does (skipped without Python)', (t) => {
  const probe = spawnSync('python', ['-c', 'import re,sys;print(sys.version_info[0])'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    t.skip('python is not on PATH');
    return;
  }
  const texts = ['Internal-Codename here', 'project   X', 'beta-2026', 'audit report', 'leakage', 'ABC-12', 'xyz', 'aab', 'group.two', 'Aé\t\n', ']-', '\\1 is a literal backslash and a digit', 'cost: $12.50'];
  const jsResults = ACCEPTED.map((p) => texts.map((s) => new RegExp(p, 'i').test(foldNeverShow(s))));
  const script = [
    'import json, re, sys, unicodedata',
    'data = json.loads(sys.stdin.read())',
    'fold = lambda s: unicodedata.normalize("NFKC", s).lower()',
    'print(json.dumps([[bool(re.compile(p, re.IGNORECASE).search(fold(s))) for s in data["texts"]] for p in data["patterns"]]))',
  ].join('\n');
  const res = spawnSync('python', ['-c', script], { input: JSON.stringify({ patterns: ACCEPTED, texts }), encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), jsResults);
});
