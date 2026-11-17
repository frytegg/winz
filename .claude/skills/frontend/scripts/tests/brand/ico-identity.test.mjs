// @ts-check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';
import { canonicalSvg, decodeIcoEntry, encodePng, fileIdentity, imageInfo, parseIco, pixelHash, sha256 } from '../../brand.mjs';
import { TEMPLATE_FAVICONS, matchTemplate } from '../../brand-check.mjs';

const TEMPLATES = fileURLToPath(new URL('../fixtures/brand/templates/', import.meta.url));
const MARKS = fileURLToPath(new URL('../fixtures/brand/marks/', import.meta.url));

/** @param {number} w @param {number} h @returns {Buffer} */
function pattern(w, h) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    data[i * 4] = (i * 7) & 255;
    data[i * 4 + 1] = (i * 13) & 255;
    data[i * 4 + 2] = (i * 29) & 255;
    data[i * 4 + 3] = i % 3 === 0 ? 0 : 255;
  }
  return data;
}

/**
 * A one-entry ICO holding a bottom-up BMP: 24-bit, or 8-bit with a palette, with an AND mask for transparency.
 * @param {number} bpp @returns {{ico: Buffer, transparent: Set<number>}}
 */
function bmpIco(bpp) {
  const w = 4;
  const h = 4;
  const palette = bpp === 8 ? Buffer.alloc(256 * 4) : Buffer.alloc(0);
  if (bpp === 8) for (let i = 0; i < 256; i += 1) palette.writeUInt32LE((i << 16) | (i << 8) | (255 - i), i * 4);
  const xorStride = Math.floor((bpp * w + 31) / 32) * 4;
  const andStride = 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(w, 4);
  header.writeInt32LE(h * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(bpp, 14);
  const xor = Buffer.alloc(xorStride * h);
  const and = Buffer.alloc(andStride * h);
  const transparent = new Set([0, 5, 15]);
  for (let y = 0; y < h; y += 1) {
    const fileRow = h - 1 - y;
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (bpp === 24) {
        xor[fileRow * xorStride + x * 3] = 10 * i;
        xor[fileRow * xorStride + x * 3 + 1] = 20;
        xor[fileRow * xorStride + x * 3 + 2] = 200;
      } else xor[fileRow * xorStride + x] = 16 * i;
      if (transparent.has(i)) and[fileRow * andStride] |= 1 << (7 - x);
    }
  }
  const image = Buffer.concat([header, palette, xor, and]);
  const dir = Buffer.alloc(22);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(1, 4);
  dir[6] = w;
  dir[7] = h;
  dir.writeUInt16LE(bpp, 12);
  dir.writeUInt32LE(image.length, 14);
  dir.writeUInt32LE(22, 18);
  return { ico: Buffer.concat([dir, image]), transparent };
}

describe('brand ICO reading', () => {
  test('png-to-ico given an array of one 32 px PNG writes exactly one 32x32 entry (the favicon BR-12 asks for)', async () => {
    const data = pattern(32, 32);
    const ico = await pngToIco([encodePng({ width: 32, height: 32, data })]);
    const info = parseIco(ico);
    assert.equal(info.count, 1);
    assert.deepEqual([info.entries[0].width, info.entries[0].height, info.entries[0].bpp, info.entries[0].format], [32, 32, 32, 'bmp']);
    const img = decodeIcoEntry(ico, info.entries[0]);
    assert.ok(img.data.equals(data), 'pixels survive the ICO round trip');
    assert.deepEqual(imageInfo(ico), { format: 'ico', width: 32, height: 32 });
  });

  test('png-to-ico given a bare buffer resizes into four entries, which is why brand.mjs passes an array', async () => {
    const ico = await pngToIco(encodePng({ width: 32, height: 32, data: pattern(32, 32) }));
    assert.deepEqual(parseIco(ico).entries.map((e) => e.width), [48, 32, 16, 256]);
  });

  test('decodes 24-bit and 8-bit BMP entries with their AND mask', () => {
    for (const bpp of [24, 8]) {
      const { ico, transparent } = bmpIco(bpp);
      const info = parseIco(ico);
      const img = decodeIcoEntry(ico, info.entries[0]);
      for (let i = 0; i < 16; i += 1) assert.equal(img.data[i * 4 + 3], transparent.has(i) ? 0 : 255, `${bpp} bpp pixel ${i} alpha`);
      if (bpp === 24) assert.deepEqual([...img.data.subarray(4, 8)], [200, 20, 10, 255]);
      else assert.deepEqual([...img.data.subarray(4, 8)], [16, 16, 239, 255]);
    }
  });

  test('decodes the create-next-app template: three BMP entries and a 256 px PNG', () => {
    const buf = readFileSync(`${TEMPLATES}next-favicon.ico`);
    const info = parseIco(buf);
    assert.deepEqual(info.entries.map((e) => `${e.width}:${e.format}:${e.bpp}`), ['16:bmp:32', '32:bmp:32', '48:bmp:32', '256:png:32']);
    const hashes = info.entries.map((e) => pixelHash(decodeIcoEntry(buf, e)));
    const next = TEMPLATE_FAVICONS.find((t) => t.id === 'create-next-app-favicon');
    assert.deepEqual(hashes, next?.pixels);
  });

  test('rejects files that are not icons, and entries that point outside the file', () => {
    assert.throws(() => parseIco(Buffer.from('not an icon at all')), (err) => err instanceof Error && err.name === 'UsageError');
    const { ico } = bmpIco(24);
    ico.writeUInt32LE(ico.length * 4, 14);
    assert.throws(() => parseIco(ico), /points outside the file/);
  });
});

describe('brand normalised identities (FD12-F27)', () => {
  test('the vanilla create-vite favicon, one newline longer, has the same canonical identity as the others', () => {
    const a = fileIdentity(readFileSync(`${TEMPLATES}vite-favicon.svg`));
    const b = fileIdentity(readFileSync(`${TEMPLATES}vite-favicon-vanilla.svg`));
    assert.notEqual(a.sha256, b.sha256);
    assert.equal(a.canonicalSha256, b.canonicalSha256);
    assert.deepEqual(matchTemplate(a), { id: 'create-vite-favicon', source: TEMPLATE_FAVICONS[0].source, how: 'sha256' });
  });

  test('a re-saved copy (reformatted, attributes reordered) still matches by canonical text', () => {
    const text = readFileSync(`${TEMPLATES}vite-favicon.svg`, 'utf8');
    const resaved = `<?xml version="1.0" encoding="UTF-8"?>\n${text.replace('fill="none" viewBox="0 0 48 46"', 'viewBox="0 0 48 46"  fill="none"').replace(/></g, '>\n<')}\n\n`;
    const id = fileIdentity(Buffer.from(resaved));
    assert.notEqual(id.sha256, sha256(text));
    assert.equal(matchTemplate(id)?.how, 'canonical');
    assert.equal(canonicalSvg(resaved), canonicalSvg(text));
  });

  test('the Next template converted to a 32 px PNG still matches by decoded pixels', () => {
    const buf = readFileSync(`${TEMPLATES}next-favicon.ico`);
    const info = parseIco(buf);
    const png = encodePng(decodeIcoEntry(buf, info.entries[1]), { filter: 2 });
    const hit = matchTemplate(fileIdentity(png));
    assert.deepEqual(hit && [hit.id, hit.how], ['create-next-app-favicon', 'pixels']);
  });

  test('a project mark matches no template', () => {
    for (const name of ['good.svg', 'disc.svg', 'cube.svg']) {
      assert.equal(matchTemplate(fileIdentity(readFileSync(`${MARKS}${name}`))), null, name);
    }
  });
});
