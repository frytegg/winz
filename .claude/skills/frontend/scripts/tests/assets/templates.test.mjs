// @ts-check
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveProfile } from '../../lib/profile.mjs';
import { loadRoutes } from '../../lib/routes.mjs';
import { loadAllowlists } from '../../rules/load.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..', '..', '..');
const TEMPLATES = path.join(SKILL, 'assets', 'templates');
const RESEARCH = path.join(SKILL, 'research');

/**
 * @param {string} name
 * @returns {string}
 */
function read(name) {
  return readFileSync(path.join(TEMPLATES, name), 'utf8');
}

/**
 * @param {string} s
 * @returns {string}
 */
function normalise(s) {
  return s.replace(/^> ?/gm, '').replace(/\s+/g, ' ').trim();
}

/**
 * The verified JSON deliverable of the sponsor dossier, exactly as written there.
 * @returns {string}
 */
function dossierAllowlist() {
  const text = readFileSync(path.join(RESEARCH, 'sponsor-brand-kits.md'), 'utf8');
  const heading = text.indexOf('### 1. `sponsor_allowlist`');
  const open = text.indexOf('```json\n', heading);
  const close = text.indexOf('\n```\n', open + 8);
  assert.ok(heading > 0 && open > heading && close > open, 'deliverable block found in the dossier');
  return text.slice(open + '```json\n'.length, close + 1);
}

describe('assets/templates', () => {
  test('every template file is LF-only UTF-8 without BOM', () => {
    const files = readdirSync(TEMPLATES);
    for (const name of ['brief.md', 'pattern-ledger.md', 'direction.md', 'DESIGN.md', 'disclaimer.en.md', 'disclaimer.fr.md', 'critique-checklist.md', 'waivers.json', 'provenance.json', 'routes.json', 'never-show.json', 'profile-frontend.example.json']) {
      assert.ok(files.includes(name), `assets/templates/${name} exists`);
    }
    for (const name of files) {
      const bytes = readFileSync(path.join(TEMPLATES, name));
      assert.ok(!bytes.includes(13), `${name} contains CR`);
      assert.notEqual(bytes[0], 0xef, `${name} starts with a BOM`);
      assert.equal(Buffer.from(bytes.toString('utf8'), 'utf8').length, bytes.length, `${name} is valid UTF-8`);
    }
  });

  test('Markdown placeholders are well formed and every block is closed', () => {
    for (const name of readdirSync(TEMPLATES).filter((n) => n.endsWith('.md'))) {
      const text = read(name);
      const opens = (text.match(/\{\{#each [a-z_.]+\}\}/g) || []).length;
      const closes = (text.match(/\{\{\/each\}\}/g) || []).length;
      assert.equal(opens, closes, `${name}: {{#each}} blocks`);
      for (const m of text.matchAll(/\{\{([^}]*)\}\}/g)) {
        assert.match(m[1], /^(#each [a-z_.]+|\/each|[A-Za-z_][A-Za-z0-9_.]*)$/, `${name}: placeholder {{${m[1]}}}`);
      }
    }
  });

  test('brief.md shows every brief.json field and never repeats a never-show pattern', () => {
    const text = read('brief.md');
    for (const key of ['project.name', 'sentences.broken', 'sentences.did', 'hero.h1', 'hero.sentence', 'gap.text', 'gap.who_loses', 'gap.how_much', '#each sponsors', '#each customers', 'use_case.text', '#each features', 'claims.path', 'claims.ids', '#each never_show', 'judge_path.source', '#each missing']) {
      assert.ok(text.includes(`{{${key}}}`), `brief.md uses {{${key}}}`);
    }
    const block = text.slice(text.indexOf('{{#each never_show}}'), text.indexOf('{{/each}}', text.indexOf('{{#each never_show}}')));
    assert.ok(!block.includes('pattern'), 'the never-show block prints no pattern');
  });

  test('pattern-ledger.md shows every reference and pattern field and the never-carried list', () => {
    const text = read('pattern-ledger.md');
    for (const f of ['id', 'customer', 'url', 'page', 'captured_at', 'viewports', 'receipt', 'purged', 'kind', 'statement', 'values', 'from', 'not_borrowed']) {
      assert.ok(text.includes(`{{this.${f}}}`), `pattern-ledger.md shows ${f}`);
    }
    assert.match(text, /never carries pixels, logos, names beyond plain text, copy, imagery, licensed font files,\s+exact brand hexes or one site's full section sequence/);
  });

  test('DESIGN.md follows the design.md alpha layout plus a Motion section', () => {
    const text = read('DESIGN.md');
    assert.ok(text.startsWith('---\nname: '), 'YAML front matter first');
    const front = text.slice(0, text.indexOf('\n---\n')).replace(/\{\{\/each\}\}/g, '');
    for (const key of ['colors:', 'typography:', 'rounded:', 'spacing:', 'components:']) assert.ok(front.includes(`\n${key}`), `front matter has ${key}`);
    const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(headings, ['Overview', 'Colors', 'Typography', 'Layout', 'Elevation & Depth', 'Shapes', 'Components', 'Motion', "Do's and Don'ts"]);
    assert.match(text, /Never edited by hand|never edited by hand/);
    assert.match(text, /ONE family per fontFamily/);
  });

  test('direction.md carries the token plan, the similar-prompt test and what is not borrowed', () => {
    const text = read('direction.md');
    for (const part of ['## Token plan', '## Hero comp', '## Rationale and trade-off', '## Similar-prompt test', '## Not borrowed', 'Signature element']) assert.ok(text.includes(part), part);
    assert.match(text, /4-6 named colours with roles/);
  });

  test('critique-checklist.md has the binary items, each with its source', () => {
    const text = read('critique-checklist.md');
    for (const idItem of ['FV1', 'FV2', 'FV3', 'FV4', 'FV5', 'FV6', 'F-{{this.id}}.a', 'F-{{this.id}}.d', 'H1', 'H2', 'E1', 'L1', 'L2', 'L3', 'T1', 'T2', 'T3', 'C1', 'C2', 'W1', 'W2', 'S1', 'S2', 'M1']) {
      assert.ok(text.includes(`| ${idItem} |`), `item ${idItem}`);
    }
    for (const row of text.split('\n').filter((l) => /^\| (FV|F-|H|E|L|T|C|W|S|M)/.test(l))) assert.match(row, /FD\d{2}/, `row cites research: ${row}`);
  });

  test('the disclaimers are the FD09 texts with the placeholders filled in', () => {
    const dossier = readFileSync(path.join(RESEARCH, 'policy-copying-and-ip.md'), 'utf8');
    const shortEn = /^Short label \(EN\): `(.+)`$/m.exec(dossier)?.[1];
    const shortFr = /^Short label \(FR\): `(.+)`$/m.exec(dossier)?.[1];
    const longEn = /^Long form \(EN\):\n\n> (.+)$/m.exec(dossier)?.[1];
    const longFr = /^Long form \(FR\):\n\n> (.+)$/m.exec(dossier)?.[1];
    assert.ok(shortEn && shortFr && longEn && longFr, 'texts found in the dossier');
    const en = read('disclaimer.en.md');
    const fr = read('disclaimer.fr.md');
    const fill = (/** @type {string} */ s) => s.replace(/\[Company\]|\[Société\]/g, '{{company}}').replace(/\[Protocol\]|\[Protocole\]/g, '{{protocol}}');
    assert.ok(en.includes(`\n${fill(shortEn)}\n`), 'English short label');
    assert.ok(fr.includes(`\n${fill(shortFr)}\n`), 'French short label');
    assert.ok(normalise(en).includes(normalise(fill(longEn))), 'English long form');
    assert.ok(normalise(fr).includes(normalise(fill(longFr))), 'French long form');
    for (const text of [en, fr]) assert.match(text, /data-concept-label/);
  });

  test('sponsor-allowlist.json is the dossier deliverable, byte for byte, with its access dates', () => {
    const bytes = readFileSync(path.join(SKILL, 'assets', 'sponsor-allowlist.json'), 'utf8');
    assert.equal(bytes, dossierAllowlist());
    const data = JSON.parse(bytes);
    assert.equal(data.accessed, '2026-10-01');
    assert.deepEqual(data.sponsor_allowlist.map((/** @type {any} */ e) => e.sponsor), ['cardano', 'cardano-foundation', 'input-output', 'chainlink', 'ledger', 'bnb-chain', 'solana', 'token2049', 'dvb', 'masumi']);
    for (const entry of data.sponsor_allowlist) {
      assert.equal(entry.accessed, '2026-10-01', `${entry.sponsor}: accessed`);
      for (const f of entry.forbidden_phrases) assert.doesNotThrow(() => new RegExp(f.regex, f.flags), `${entry.sponsor}: ${f.regex}`);
    }
    const tm = String.fromCharCode(92) + 'u2122';
    assert.ok(bytes.includes(tm), 'the escaped trademark sign is kept as written');
  });

  test('the example files load with the real loaders: profile, routes, waivers and the sponsor allowlist', () => {
    const profile = resolveProfile(JSON.parse(read('profile-frontend.example.json')), { path: path.join(SKILL, 'profile.json') });
    assert.equal(profile.mode, 'full');
    assert.deepEqual(profile.sponsors, ['cardano']);
    assert.equal(profile.critique.rounds_max, 3);
    const root = mkdtempSync(path.join(os.tmpdir(), 'frontend-templates-'));
    try {
      mkdirSync(path.join(root, 'design'));
      writeFileSync(path.join(root, 'design', 'routes.json'), read('routes.json'));
      writeFileSync(path.join(root, 'design', 'waivers.json'), read('waivers.json'));
      const routes = loadRoutes(root, profile);
      assert.deepEqual(routes.map((r) => [r.path, r.first]), [['/', true], ['/queue', false], ['/proofs', false]]);
      const allow = loadAllowlists(root, profile);
      assert.equal(allow.sponsors.length, 1);
      assert.ok(allow.sponsorHashes.has('94fb110ebb3475a0f3de620fbeaad91ae59a182a0d971eae865c556e1b6aa6e7'), 'Cardano horizontal-blue logo hash');
      assert.equal(allow.waivers[0].rule, 'SL-T09');
      assert.equal(allow.category[0].rule, 'SL-T08');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
