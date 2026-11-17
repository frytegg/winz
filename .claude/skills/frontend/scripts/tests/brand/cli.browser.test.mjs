// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { imageInfo, parseIco } from '../../brand.mjs';

const SCRIPTS = fileURLToPath(new URL('../../', import.meta.url));
const MARKS = fileURLToPath(new URL('../fixtures/brand/marks/', import.meta.url));
const CONSOLAS = 'C:/Windows/Fonts/consolab.ttf';
const scratch = mkdtempSync(path.join(os.tmpdir(), 'fe-brand-cli-browser-'));

after(() => rmSync(scratch, { recursive: true, force: true }));

/** @param {string[]} args */
function brand(args) {
  return spawnSync(process.execPath, ['brand.mjs', ...args], { cwd: SCRIPTS, encoding: 'utf8', timeout: 180000 });
}

describe('brand.mjs CLI with Chromium', () => {
  test('render, lint and sheet work on a candidates folder', () => {
    const dir = path.join(scratch, 'candidates');
    for (const [n, file] of [['1', 'good.svg'], ['2', 'disc.svg'], ['3', 'cube.svg']]) {
      mkdirSync(path.join(dir, n), { recursive: true });
      cpSync(`${MARKS}${file}`, path.join(dir, n, 'mark.svg'));
      writeFileSync(path.join(dir, n, 'candidate.json'), JSON.stringify({ intervention: 'x', one_feature: 'y', flag_reasons: n === '3' ? { cube: 'a ledger of three faces', 'off-grid': 'isometric edges cannot sit on the grid' } : {} }));
    }
    const render = brand(['render', dir]);
    assert.equal(render.status, 0, render.stderr);
    assert.match(render.stderr, /solid share 16 px 1, 32 px 1/);
    for (const n of ['1', '2', '3']) assert.ok(existsSync(path.join(dir, n, 'render', 'render.json')));
    const lint = brand(['lint', dir, '--json']);
    assert.equal(lint.status, 0, lint.stderr);
    assert.deepEqual(JSON.parse(lint.stdout).reports.map((/** @type {any} */ r) => r.ok), [true, true, true]);
    const sheet = path.join(scratch, 'sheet.png');
    const res = brand(['sheet', dir, '--out', sheet]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(imageInfo(readFileSync(sheet)).format, 'png');
    assert.equal(JSON.parse(readFileSync(path.join(scratch, 'sheet.json'), 'utf8')).rows.length, 3);
  });

  test('icons writes the set and refuses a mark without a dark rule unless --dark is given', () => {
    const out = path.join(scratch, 'public');
    const res = brand(['icons', `${MARKS}good.svg`, '--out', out, '--name', 'Holdover', '--bg', '#0b0e14']);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(readdirSync(out).sort(), ['apple-touch-icon.png', 'favicon.ico', 'head.html', 'icon-192.png', 'icon-512.png', 'icon-mask.png', 'icon.svg', 'icons.json', 'manifest.webmanifest']);
    assert.equal(parseIco(readFileSync(path.join(out, 'favicon.ico'))).count, 1);
    const plain = path.join(scratch, 'plain.svg');
    writeFileSync(plain, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#14161a" d="M4 6h24v8H4z"/></svg>');
    assert.equal(brand(['icons', plain, '--out', path.join(scratch, 'p2'), '--name', 'X']).status, 2);
    assert.equal(brand(['icons', plain, '--out', path.join(scratch, 'p3'), '--name', 'X', '--dark', '#f4f1ea']).status, 0);
  });

  test('wordmark and og produce the outlined name and the 1200x630 card', { skip: !existsSync(CONSOLAS) && 'no Consolas on this machine' }, () => {
    const word = path.join(scratch, 'brand', 'wordmark.svg');
    const wm = brand(['wordmark', '--text', 'holdover', '--font', CONSOLAS, '--out', word, '--png']);
    assert.equal(wm.status, 0, wm.stderr);
    assert.ok(existsSync(path.join(scratch, 'brand', 'wordmark.json')));
    assert.equal(imageInfo(readFileSync(path.join(scratch, 'brand', 'wordmark.png'))).format, 'png');
    const brief = path.join(scratch, 'brief.json');
    writeFileSync(brief, JSON.stringify({ project: { name: 'Holdover', name_status: 'final' }, sentences: { broken: 'Every downstream consumer of a share ratio, and how many hours it is behind.', did: '', source: 'spec.md:3' } }));
    const site = path.join(scratch, 'site');
    const og = brand(['og', '--mark', `${MARKS}good.svg`, '--wordmark', word, '--font', CONSOLAS, '--brief', brief, '--out', site, '--site-url', 'https://holdover.example', '--json']);
    assert.equal(og.status, 0, og.stderr);
    const record = JSON.parse(og.stdout);
    assert.match(record.url, /^https:\/\/holdover\.example\/opengraph-image\.[0-9a-f]{8}\.png$/);
    assert.equal(record.line, 'Every downstream consumer of a share ratio, and how many hours it is behind.');
    assert.match(record.lineSource, /brief\.json#sentences\.broken \(source spec\.md:3\)/);
    assert.deepEqual(imageInfo(readFileSync(record.file)), { format: 'png', width: 1200, height: 630 });
    assert.match(readFileSync(path.join(site, 'og-head.html'), 'utf8'), /twitter:card" content="summary_large_image/);
    assert.equal(brand(['og', '--mark', `${MARKS}good.svg`, '--wordmark', word, '--font', CONSOLAS, '--brief', brief, '--field', 'hero.sentence', '--out', site]).status, 2);
  });
});
