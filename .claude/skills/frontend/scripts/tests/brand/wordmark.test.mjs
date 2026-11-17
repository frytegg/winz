// @ts-check
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
// @ts-expect-error opentype.js 2.0.0 ships no type declarations
import opentype from 'opentype.js';
import { fontLicence, lintSvgStatic, outlineWordmark, parsePathData, verifyOutline } from '../../brand.mjs';

// System fonts drive the mechanics only; no font ships with the skill or its tests.
const CONSOLAS = 'C:/Windows/Fonts/consolab.ttf';
const BAHNSCHRIFT = 'C:/Windows/Fonts/bahnschrift.ttf';
const scratch = mkdtempSync(path.join(os.tmpdir(), 'fe-brand-wordmark-'));

after(() => rmSync(scratch, { recursive: true, force: true }));

describe('brand wordmark (opentype.js 2.0.0, FD12-F15)', () => {
  test('outlines a name into one path with no <text>, no NaN and a regenerable record', { skip: !existsSync(CONSOLAS) && 'no Consolas on this machine' }, () => {
    const { svg, meta } = outlineWordmark({ text: 'holdover', fontFile: CONSOLAS });
    assert.doesNotMatch(svg, /<text[\s>]/);
    assert.doesNotMatch(svg, /NaN|Infinity/);
    assert.match(svg, /<title>holdover<\/title>/);
    assert.match(svg, /fill="currentColor"/);
    assert.equal(meta.layout, 'opentype getPath');
    assert.equal(meta.flipY, false);
    const font = /** @type {Record<string, unknown>} */ (meta.font);
    assert.equal(font.family, 'Consolas');
    assert.equal(font.weightClass, 700);
    assert.match(String(font.sha256), /^[0-9a-f]{64}$/);
    const viewBox = /** @type {number[]} */ (meta.viewBox);
    assert.equal(viewBox.length, 4);
    assert.ok(viewBox[2] > viewBox[3] * 4, 'a wordmark is wide');
    const findings = lintSvgStatic(svg, { kind: 'wordmark' }).findings.filter((f) => f.severity === 'fail');
    assert.deepEqual(findings, []);
  });

  test('the outlined wordmark passes the wordmark lint in every system face found, although SVGO drops Z a fill does not need', () => {
    const faces = ['consola.ttf', 'consolab.ttf', 'arial.ttf', 'segoeui.ttf', 'georgia.ttf', 'bahnschrift.ttf']
      .map((f) => `C:/Windows/Fonts/${f}`).filter((f) => existsSync(f));
    if (faces.length === 0) return;
    for (const fontFile of faces) {
      for (const text of ['holdover', 'Brume', 'Orma']) {
        const { svg } = outlineWordmark({ text, fontFile });
        const fails = lintSvgStatic(svg, { kind: 'wordmark' }).findings.filter((f) => f.severity === 'fail');
        assert.deepEqual(fails, [], `${path.basename(fontFile)} "${text}"`);
      }
    }
  });

  test('warns when no open licence is found: Consolas is a Microsoft font (BR-04)', { skip: !existsSync(CONSOLAS) && 'no Consolas on this machine' }, () => {
    const { meta } = outlineWordmark({ text: 'hold', fontFile: CONSOLAS });
    assert.ok(/** @type {string[]} */ (meta.warnings).some((w) => /no open licence found/.test(w) && /Microsoft supplied font/.test(w)));
  });

  test('the default flipY emission is rejected by the outline check; flipY: false passes it', { skip: !existsSync(CONSOLAS) && 'no Consolas on this machine' }, () => {
    const bytes = readFileSync(CONSOLAS);
    const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const glyphs = font.getPath('holdover', 0, 0, 100, { kerning: true });
    const flipped = glyphs.toPathData({ decimalPlaces: 2 });
    const upright = glyphs.toPathData({ decimalPlaces: 2, flipY: false });
    assert.notEqual(flipped, upright);
    assert.equal(parsePathData(flipped).error, null);
    assert.throws(() => verifyOutline(glyphs, flipped, 2), /flipped or garbled/);
    assert.doesNotThrow(() => verifyOutline(glyphs, upright, 2));
  });

  test('falls back to per-glyph layout when opentype.js cannot apply the font\'s shaping tables', { skip: !existsSync(BAHNSCHRIFT) && 'no Bahnschrift on this machine' }, () => {
    const { svg, meta } = outlineWordmark({ text: 'Hold', fontFile: BAHNSCHRIFT, variation: { wght: 600 } });
    assert.match(String(meta.layout), /^per-glyph/);
    const warnings = /** @type {string[]} */ (meta.warnings);
    assert.ok(warnings.some((w) => /variable font/.test(w)));
    assert.ok(warnings.some((w) => /shaping skipped/.test(w)));
    assert.doesNotMatch(svg, /NaN/);
  });

  test('refuses a name the font cannot draw, WOFF2, and a missing --text', { skip: !existsSync(CONSOLAS) && 'no Consolas on this machine' }, () => {
    assert.throws(() => outlineWordmark({ text: 'hold\u4e2d', fontFile: CONSOLAS }), (err) => err instanceof Error && err.name === 'UsageError' && /no glyph/.test(err.message));
    const woff2 = path.join(scratch, 'face.woff2');
    writeFileSync(woff2, 'wOF2 not really');
    assert.throws(() => outlineWordmark({ text: 'x', fontFile: woff2 }), /WOFF2/);
    assert.throws(() => outlineWordmark({ text: ' ', fontFile: CONSOLAS }), /--text/);
  });

  test('reads the licence file next to a font, with its Reserved Font Names', () => {
    const dir = mkdtempSync(path.join(scratch, 'face-'));
    writeFileSync(path.join(dir, 'OFL.txt'), 'Copyright 2017 IBM Corp. with Reserved Font Name "Plex".\n\nThis Font Software is licensed under the SIL Open Font License, Version 1.1.\n');
    assert.deepEqual(fontLicence(path.join(dir, 'Face-Bold.ttf')), { file: path.join(dir, 'OFL.txt').replace(/\\/g, '/'), kind: 'OFL-1.1', reservedFontNames: ['Plex'] });
    const empty = mkdtempSync(path.join(scratch, 'bare-'));
    assert.deepEqual(fontLicence(path.join(empty, 'x.ttf')), { file: null, kind: 'unknown', reservedFontNames: [] });
  });
});
