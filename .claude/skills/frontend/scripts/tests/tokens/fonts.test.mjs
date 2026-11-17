// @ts-check
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { buildSfnt, fontTables, readFontInfo, reservedFontNames, woff2Tables } from '../../tokens.mjs';
import { makeFont, tempDir, toTransformedWoff2, toWoff, toWoff2 } from './helpers.mjs';

const tmp = tempDir('fonts');
after(tmp.cleanup);

/** @param {string} name @param {Buffer} bytes @returns {string} */
function put(name, bytes) {
  const file = path.join(tmp.dir, name);
  writeFileSync(file, bytes);
  return file;
}

/** @param {Buffer} otf @returns {Record<string, Buffer>} */
const containers = (otf) => ({ otf, woff: toWoff(otf), woff2: toWoff2(otf), 'transformed.woff2': toTransformedWoff2(otf) });

test('a face with tnum is tabular in every container, including a WOFF2 with transformed glyf and hmtx', async () => {
  for (const [ext, bytes] of Object.entries(containers(makeFont({ tnum: true })))) {
    const info = await readFontInfo(put(`tnum.${ext}`, bytes));
    assert.ok(info.ok, `${ext}: ${!info.ok ? info.error : ''}`);
    assert.equal(info.family, 'Fixture Sans', ext);
    assert.equal(info.tnum, true, ext);
    assert.equal(info.digitsTabular, false, ext);
    assert.equal(info.tabular, true, ext);
    assert.equal(info.monospace, false, ext);
    assert.deepEqual(info.digitAdvances, [520, 440, 520, 520, 540, 520, 530, 500, 530, 530], ext);
  }
});

test('proportional digits without tnum are not tabular (the DM Sans case of FD16-F16)', async () => {
  for (const [ext, bytes] of Object.entries(containers(makeFont({})))) {
    const info = await readFontInfo(put(`prop.${ext}`, bytes));
    assert.ok(info.ok && !info.tnum && info.digitsTabular === false && !info.tabular, ext);
  }
});

test('equal default digits are tabular without tnum, and a monospace face is detected', async () => {
  const equal = await readFontInfo(put('equal.woff2', toWoff2(makeFont({ digitWidths: Array(10).fill(560) }))));
  assert.ok(equal.ok && equal.digitsTabular === true && equal.tabular && !equal.monospace);
  const mono = await readFontInfo(put('mono.woff2', toTransformedWoff2(makeFont({ family: 'Fixture Mono', monospace: true }))));
  assert.ok(mono.ok && mono.monospace && mono.tabular);
  assert.equal(mono.ok && mono.family, 'Fixture Mono');
});

test('the serif class comes from PANOSE', async () => {
  const serif = await readFontInfo(put('serif.otf', makeFont({ family: 'Fixture Serif', panose: [2, 2, 5, 3, 0, 0, 0, 0, 0, 0] })));
  const sans = await readFontInfo(put('sans.otf', makeFont({ family: 'Fixture Grotesk', panose: [2, 11, 5, 3, 0, 0, 0, 0, 0, 0] })));
  assert.equal(serif.ok && serif.serif, true);
  assert.equal(sans.ok && sans.serif, false);
});

test('broken or unsupported files give a reason, never a throw', async () => {
  const garbage = await readFontInfo(put('garbage.woff2', Buffer.from('wOF2 but nothing else')));
  assert.equal(garbage.ok, false);
  assert.match(!garbage.ok ? garbage.error : '', /WOFF2/);
  const text = await readFontInfo(put('notes.ttf', Buffer.from('hello, this is text')));
  assert.equal(text.ok, false);
  assert.match(!text.ok ? text.error : '', /not a font file/);
  const ttc = Buffer.alloc(16);
  ttc.write('ttcf', 0, 4, 'latin1');
  const collection = await readFontInfo(put('family.ttc', ttc));
  assert.match(!collection.ok ? collection.error : '', /collections/);
  const good = toWoff2(makeFont({}));
  const truncated = await readFontInfo(put('truncated.woff2', good.subarray(0, good.length - 20)));
  assert.equal(truncated.ok, false);
});

test('fontTables reads every container, and buildSfnt reassembles what it read', () => {
  const otf = makeFont({ tnum: true });
  const plain = fontTables(otf);
  assert.equal(plain.format, 'otf');
  for (const [format, bytes] of [['woff', toWoff(otf)], ['woff2', toWoff2(otf)]]) {
    const t = fontTables(/** @type {Buffer} */ (bytes));
    assert.equal(t.format, format);
    assert.deepEqual([...t.tables.keys()].sort(), [...plain.tables.keys()].sort());
    for (const [tag, data] of plain.tables) assert.ok(data.equals(/** @type {Buffer} */ (t.tables.get(tag))), `${format} ${tag}`);
  }
  const again = fontTables(buildSfnt(plain.flavor, plain.tables));
  for (const [tag, data] of plain.tables) assert.ok(data.equals(/** @type {Buffer} */ (again.tables.get(tag))), tag);
});

test('a transformed WOFF2 drops glyf and loca and rebuilds hmtx advances', () => {
  const otf = makeFont({ tnum: true });
  const { tables } = woff2Tables(toTransformedWoff2(otf));
  assert.ok(!tables.has('glyf') && !tables.has('loca'));
  const hmtx = /** @type {Buffer} */ (tables.get('hmtx'));
  const original = /** @type {Buffer} */ (fontTables(otf).tables.get('hmtx'));
  assert.equal(hmtx.length, original.length);
  for (let i = 0; i < original.length; i += 4) assert.equal(hmtx.readUInt16BE(i), original.readUInt16BE(i), `advance ${i / 4}`);
});

test('Reserved Font Names are read from an OFL licence', () => {
  assert.deepEqual(reservedFontNames('Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"'), ['Plex']);
  assert.deepEqual(reservedFontNames('Copyright 2010 with Reserved Font Names “Source” and “Sans”.'), ['Source', 'Sans']);
  assert.deepEqual(reservedFontNames("Copyright 2010 Adobe, with Reserved Font Name 'Source'.\nThis Font Software is licensed under the SIL Open Font License, Version 1.1."), ['Source']);
  assert.deepEqual(reservedFontNames('Copyright 2020 The Inter Project Authors'), []);
});
