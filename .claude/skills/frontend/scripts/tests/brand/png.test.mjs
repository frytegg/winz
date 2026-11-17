// @ts-check
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { decodePng, encodePng, imageInfo } from '../../brand.mjs';

/** @param {Buffer} buf @returns {number} */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {string} type @param {Buffer} body @returns {Buffer} */
function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/**
 * A test-side PNG writer for the formats brand.mjs never writes: any colour type and bit depth, palette, tRNS and
 * Adam7. `sample(x, y)` returns the raw channel values at the file's depth.
 * @param {{width: number, height: number, colorType: number, depth: number, sample: (x: number, y: number) => number[],
 *   palette?: number[][], trns?: Buffer, interlace?: boolean}} spec
 * @returns {Buffer}
 */
function writePng({ width, height, colorType, depth, sample, palette, trns, interlace = false }) {
  const channels = /** @type {Record<number, number>} */ ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
  /** @param {number[]} xs @param {number} y @returns {Buffer} */
  const row = (xs, y) => {
    const bits = xs.length * channels * depth;
    const out = Buffer.alloc(1 + Math.ceil(bits / 8));
    let bit = 0;
    for (const x of xs) {
      for (const v of sample(x, y)) {
        if (depth === 16) {
          out.writeUInt16BE(v, 1 + bit / 8);
        } else if (depth === 8) {
          out[1 + bit / 8] = v;
        } else {
          out[1 + (bit >> 3)] |= v << (8 - depth - (bit & 7));
        }
        bit += depth;
      }
    }
    return out;
  };
  /** @type {Buffer[]} */
  const rows = [];
  if (!interlace) {
    const xs = Array.from({ length: width }, (_, x) => x);
    for (let y = 0; y < height; y += 1) rows.push(row(xs, y));
  } else {
    for (const [x0, y0, dx, dy] of [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]) {
      const xs = [];
      for (let x = x0; x < width; x += dx) xs.push(x);
      if (xs.length === 0) continue;
      for (let y = y0; y < height; y += dy) rows.push(row(xs, y));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = colorType;
  ihdr[12] = interlace ? 1 : 0;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (palette) parts.push(chunk('PLTE', Buffer.from(palette.flat())));
  if (trns) parts.push(chunk('tRNS', trns));
  parts.push(chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** @param {number} w @param {number} h @returns {Buffer} */
function gradient(w, h) {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      data[o] = (x * 37 + y * 11) & 255;
      data[o + 1] = (x * 5 + y * 71) & 255;
      data[o + 2] = (x * y * 3) & 255;
      data[o + 3] = (x + y) % 5 === 0 ? 0 : 255 - ((x * 13) & 127);
    }
  }
  return data;
}

describe('brand PNG codec', () => {
  for (const filter of /** @type {const} */ ([0, 1, 2, 3, 4])) {
    test(`encodes and decodes RGBA losslessly with filter ${filter}`, () => {
      const data = gradient(23, 17);
      const png = encodePng({ width: 23, height: 17, data }, { filter });
      const back = decodePng(png);
      assert.equal(back.width, 23);
      assert.equal(back.height, 17);
      assert.ok(back.data.equals(data));
      assert.deepEqual(imageInfo(png), { format: 'png', width: 23, height: 17 });
    });
  }

  test('decodes grey at depths 1, 2, 4, 8 and 16, scaling to 0-255', () => {
    for (const depth of [1, 2, 4, 8, 16]) {
      const max = (1 << depth) - 1;
      const png = writePng({ width: 9, height: 3, colorType: 0, depth, sample: (x) => [x % (max + 1)] });
      const img = decodePng(png);
      for (let x = 0; x < 9; x += 1) {
        const v = x % (max + 1);
        const expected = depth === 16 ? v >> 8 : Math.round((v * 255) / max);
        assert.equal(img.data[x * 4], expected, `depth ${depth} x ${x}`);
        assert.equal(img.data[x * 4 + 3], 255);
      }
    }
  });

  test('decodes a 2-bit palette with tRNS alpha', () => {
    const palette = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [9, 9, 9]];
    const png = writePng({ width: 5, height: 2, colorType: 3, depth: 2, palette, trns: Buffer.from([255, 128, 0]), sample: (x) => [x % 4] });
    const img = decodePng(png);
    assert.deepEqual([...img.data.subarray(0, 16)], [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 9, 9, 9, 255]);
  });

  test('decodes grey with alpha, RGB with a tRNS key and 16-bit RGBA', () => {
    const ga = decodePng(writePng({ width: 2, height: 1, colorType: 4, depth: 8, sample: (x) => [100 + x, 50 * x] }));
    assert.deepEqual([...ga.data], [100, 100, 100, 0, 101, 101, 101, 50]);
    const key = Buffer.from([0, 10, 0, 20, 0, 30]);
    const rgb = decodePng(writePng({ width: 2, height: 1, colorType: 2, depth: 8, trns: key, sample: (x) => (x === 0 ? [10, 20, 30] : [10, 20, 31]) }));
    assert.deepEqual([...rgb.data], [10, 20, 30, 0, 10, 20, 31, 255]);
    const wide = decodePng(writePng({ width: 1, height: 1, colorType: 6, depth: 16, sample: () => [0xff00, 0x8000, 0x0100, 0xffff] }));
    assert.deepEqual([...wide.data], [255, 128, 1, 255]);
  });

  test('decodes Adam7-interlaced images to the same pixels as progressive ones', () => {
    /** @param {number} x @param {number} y */
    const sample = (x, y) => [(x * 29 + y * 7) & 255, (x * 3) & 255, (y * 17) & 255, 255 - ((x + y) & 63)];
    for (const [w, h] of [[1, 1], [3, 2], [9, 11], [16, 16]]) {
      const plain = decodePng(writePng({ width: w, height: h, colorType: 6, depth: 8, sample }));
      const laced = decodePng(writePng({ width: w, height: h, colorType: 6, depth: 8, sample, interlace: true }));
      assert.ok(laced.data.equals(plain.data), `${w}x${h}`);
    }
  });

  test('rejects files that are not PNG or are truncated, with a UsageError', () => {
    assert.throws(() => decodePng(Buffer.from('GIF89a')), (err) => err instanceof Error && err.name === 'UsageError' && /not a PNG/.test(err.message));
    const png = encodePng({ width: 4, height: 4, data: gradient(4, 4) });
    assert.throws(() => decodePng(png.subarray(0, 40)), (err) => err instanceof Error && err.name === 'UsageError');
  });

  test('reads the size of PNG, GIF, JPEG and WebP headers without decoding', () => {
    const gif = Buffer.alloc(16);
    gif.write('GIF89a', 0, 'latin1');
    gif.writeUInt16LE(1200, 6);
    gif.writeUInt16LE(630, 8);
    assert.deepEqual(imageInfo(gif), { format: 'gif', width: 1200, height: 630 });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x76, 0x04, 0xb0, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(imageInfo(jpeg), { format: 'jpeg', width: 1200, height: 630 });
    const webp = Buffer.alloc(32);
    webp.write('RIFF', 0, 'latin1');
    webp.write('WEBP', 8, 'latin1');
    webp.write('VP8X', 12, 'latin1');
    webp.writeUIntLE(1199, 24, 3);
    webp.writeUIntLE(629, 27, 3);
    assert.deepEqual(imageInfo(webp), { format: 'webp', width: 1200, height: 630 });
    assert.equal(imageInfo(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>')).format, 'svg');
    assert.equal(imageInfo(Buffer.from('hello')).format, 'unknown');
  });
});
