// @ts-check
/**
 * The /frontend brand pipeline (P3; research FD12 technique-logo-favicon-brand and FD21 sponsor-brand-kits).
 *
 * Commands: wordmark (outline a name from a font file), lint (mark lint: hard fails and look-twice flags), render
 * (16, 32, 180 and 512 px, one-colour silhouettes on light and dark, solid share), icons (the minimal favicon set),
 * og (the 1200x630 card), sheet (the candidates sheet for the owner's pick), name-check (sponsor naming blocklist,
 * reports only) and hashes (normalised file identities for the template list of brand-check.mjs).
 *
 * Every raster comes from the skill's Chromium: SVGs are drawn as images into a canvas, the way a browser draws a
 * favicon (secure static mode, prefers-color-scheme following the emulated scheme). Nothing touches the network:
 * renders use data: URIs, pages are served from 127.0.0.1, and every other request is aborted.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
// @ts-expect-error opentype.js 2.0.0 ships no type declarations
import opentype from 'opentype.js';
import pngToIco from 'png-to-ico';
import { optimize, querySelectorAll } from 'svgo';
import { parseCli, isMainModule } from './lib/args.mjs';
import { contrastRatio, parseColor, toHex } from './lib/color.mjs';
import { CheckError, EnvError, FrontendError, UsageError, exitWith } from './lib/errors.mjs';
import { readText, toPosix, writeText } from './lib/fsutil.mjs';
import { loadProfile } from './lib/profile.mjs';
import { utcSeconds } from './lib/report.mjs';
import { serveStatic } from './lib/serve.mjs';

/**
 * @typedef {import('svgo').XastRoot} XastRoot
 * @typedef {import('svgo').XastElement} XastElement
 * @typedef {import('svgo').XastParent} XastParent
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('playwright-core').BrowserContext} BrowserContext
 * @typedef {import('playwright-core').Page} Page
 * @typedef {{width: number, height: number, data: Buffer}} RgbaImage
 * @typedef {[number, number]} Point
 * @typedef {[number, number, number, number, number, number]} Matrix
 * @typedef {{x: number, y: number, w: number, h: number}} Box
 */

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Favicon render sizes [FD12-F16, BR-08]. */
export const RENDER_SIZES = Object.freeze([16, 32, 180, 512]);
/** Sizes whose solid share is measured: the favicon sizes a tab strip shows [FD12-F16]. */
export const SOLID_SIZES = Object.freeze([16, 32]);
export const LIGHT_GROUND = '#ffffff';
/** A dark tab-strip grey for the dark silhouettes and tab previews. */
export const DARK_GROUND = '#202124';
/** W3C manifest safe zone: a centred circle of radius 2/5 of the icon size [FD12-F23]. */
export const MASKABLE_SAFE_RATIO = 0.4;
export const APPLE_SIZE = 180;
export const APPLE_MARK = 140;
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
/** Meta's limit is "8 MB"; the decimal reading is the stricter one [FD12-F28]. */
export const OG_MAX_BYTES = 8_000_000;
/** Faces the owner bans for the wordmark: tells 4 and 19 [FD12-F14, BR-04]. */
export const BANNED_WORDMARK_FACES = Object.freeze(['Inter', 'Space Grotesk', 'Instrument Serif']);
export const DEFAULT_ALLOWLIST = toPosix(path.resolve(SCRIPTS_DIR, '..', 'assets', 'sponsor-allowlist.json'));

/**
 * SVGO settings for shipped icons: preset-default without inlineStyles, which otherwise inlines the light colour,
 * drops the class and deletes the dark-mode rule [FD12-F24].
 * @returns {import('svgo').Config}
 */
export function iconSvgoConfig() {
  return { multipass: true, plugins: [{ name: 'preset-default', params: { overrides: { inlineStyles: false } } }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

/** @param {Buffer | Uint8Array | string} data @returns {string} */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** @param {unknown} err @returns {string} */
function firstLine(err) {
  const message = err instanceof Error ? err.message : String(err);
  return message.split('\n').find((l) => l.trim() !== '')?.trim() ?? message;
}

/** @param {number} x @param {number} [digits] @returns {number} */
function round(x, digits = 3) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/** @param {number} x @param {number} lo @param {number} hi @returns {number} */
function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/** @param {string} file @param {Buffer | Uint8Array} data @returns {string} */
function writeBinary(file, data) {
  const abs = path.resolve(file);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  return toPosix(abs);
}

/** @param {string} file @param {string} what @returns {Buffer} */
function readBinary(file, what) {
  try {
    return readFileSync(file);
  } catch (err) {
    throw new UsageError(`${what} not found: ${toPosix(path.resolve(file))}; check the path`, { cause: err });
  }
}

/** @param {string} file @param {string} what @returns {unknown} */
function readJson(file, what) {
  const text = readText(file);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UsageError(`${what} ${toPosix(path.resolve(file))} is not valid JSON (${firstLine(err)}); fix the file`, { cause: err });
  }
}

/** @param {string} s @returns {string} */
export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/**
 * An opaque CSS colour from a flag, as `#rrggbb`.
 * @param {string} css @param {string} flag @returns {string}
 */
function opaqueColour(css, flag) {
  const c = parseColor(css);
  if (!c || c.a !== 1) throw new UsageError(`${flag} ${JSON.stringify(css)} is not an opaque CSS colour; pass a hex such as #0b1f33`);
  return toHex(c);
}

/** @param {string} css @returns {[number, number, number] | null} */
function rgb255(css) {
  const c = parseColor(css);
  if (!c) return null;
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

/** @param {readonly number[]} a @param {readonly number[]} b @returns {number} */
function channelDistance(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/** @param {number[]} rgb @returns {string} */
function hexOf(rgb) {
  return `#${rgb.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** @param {string} dir @returns {string} */
function ensureDir(dir) {
  const abs = path.resolve(dir);
  mkdirSync(abs, { recursive: true });
  return abs;
}

/** @param {string} line */
function progress(line) {
  process.stderr.write(`${line}\n`);
}

/**
 * Launches the skill's Chromium. playwright-core is loaded on first use (several seconds cold), so the commands
 * that never render (static lint, name-check, hashes, wordmark) start quickly.
 * @returns {Promise<Browser>}
 */
async function launchBrowser() {
  const { launch } = await import('./lib/browser.mjs');
  return launch();
}

// ---------------------------------------------------------------------------------------------------------------
// PNG codec (no image dependency: zlib plus the PNG filters)

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** @param {Buffer} buf @returns {number} */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {number} a @param {number} b @param {number} c @returns {number} */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Reverses the PNG scanline filters in place.
 * @param {Buffer} raw filtered bytes (filter byte + stride per row)
 * @param {number} offset start of the first row in raw
 * @param {number} rows @param {number} stride @param {number} bpp bytes per pixel for filtering (at least 1)
 * @returns {Buffer} unfiltered rows, stride bytes each
 */
function unfilter(raw, offset, rows, stride, bpp) {
  const out = Buffer.alloc(rows * stride);
  for (let y = 0; y < rows; y += 1) {
    const type = raw[offset + y * (stride + 1)];
    const src = offset + y * (stride + 1) + 1;
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const v = raw[src + x];
      const a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= bpp && y > 0 ? out[prev + x - bpp] : 0;
      let r;
      if (type === 0) r = v;
      else if (type === 1) r = v + a;
      else if (type === 2) r = v + b;
      else if (type === 3) r = v + ((a + b) >> 1);
      else if (type === 4) r = v + paeth(a, b, c);
      else throw new UsageError(`PNG row ${y} uses unknown filter type ${type}; the file is corrupt`);
      out[row + x] = r & 0xff;
    }
  }
  return out;
}

/**
 * Decodes a PNG (every colour type, bit depths 1-16, palette and tRNS, Adam7) to 8-bit straight RGBA.
 * @param {Buffer | Uint8Array} input
 * @returns {RgbaImage}
 */
export function decodePng(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new UsageError('not a PNG file (bad signature)');
  /** @type {{width: number, height: number, depth: number, colorType: number, interlace: number} | null} */
  let ihdr = null;
  /** @type {Buffer | null} */
  let palette = null;
  /** @type {Buffer | null} */
  let trns = null;
  /** @type {Buffer[]} */
  const idat = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const start = pos + 8;
    const end = start + len;
    if (end + 4 > buf.length) throw new UsageError(`PNG chunk ${type} runs past the end of the file; the file is truncated`);
    const data = buf.subarray(start, end);
    if (type === 'IHDR') {
      ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colorType: data[9], interlace: data[12] };
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos = end + 4;
  }
  if (!ihdr) throw new UsageError('PNG has no IHDR chunk; the file is corrupt');
  const { width, height, depth, colorType, interlace } = ihdr;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) throw new UsageError(`PNG colour type ${colorType} with depth ${depth} is not valid`);
  if (width === 0 || height === 0) throw new UsageError('PNG has a zero dimension');
  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch (err) {
    throw new UsageError(`PNG image data does not inflate (${firstLine(err)}); the file is corrupt`, { cause: err });
  }
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const out = Buffer.alloc(width * height * 4);
  const maxValue = (1 << depth) - 1;
  /** @param {Buffer} rows @param {number} stride @param {number} pw @param {number} ph @param {(px: number, py: number) => number} target */
  const expand = (rows, stride, pw, ph, target) => {
    for (let py = 0; py < ph; py += 1) {
      const rowStart = py * stride;
      for (let px = 0; px < pw; px += 1) {
        /** @param {number} ch @returns {number} sample scaled to 0..255 (palette index unscaled) */
        const sample = (ch) => {
          if (depth === 8) return rows[rowStart + px * channels + ch];
          if (depth === 16) return rows[rowStart + (px * channels + ch) * 2];
          const bit = (px * channels + ch) * depth;
          const value = (rows[rowStart + (bit >> 3)] >> (8 - depth - (bit & 7))) & maxValue;
          return colorType === 3 ? value : Math.round((value * 255) / maxValue);
        };
        /** @param {number} ch @returns {number} the raw sample at full depth, for tRNS keys */
        const rawSample = (ch) => {
          if (depth === 16) return rows.readUInt16BE(rowStart + (px * channels + ch) * 2);
          if (depth === 8) return rows[rowStart + px * channels + ch];
          const bit = (px * channels + ch) * depth;
          return (rows[rowStart + (bit >> 3)] >> (8 - depth - (bit & 7))) & maxValue;
        };
        const o = target(px, py) * 4;
        if (colorType === 3) {
          const idx = sample(0);
          if (!palette || idx * 3 + 2 >= palette.length) throw new UsageError('PNG palette index out of range; the file is corrupt');
          out[o] = palette[idx * 3];
          out[o + 1] = palette[idx * 3 + 1];
          out[o + 2] = palette[idx * 3 + 2];
          out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
        } else if (colorType === 0 || colorType === 4) {
          const v = sample(0);
          out[o] = v;
          out[o + 1] = v;
          out[o + 2] = v;
          if (colorType === 4) out[o + 3] = sample(1);
          else out[o + 3] = trns && trns.length >= 2 && rawSample(0) === trns.readUInt16BE(0) ? 0 : 255;
        } else {
          out[o] = sample(0);
          out[o + 1] = sample(1);
          out[o + 2] = sample(2);
          if (colorType === 6) out[o + 3] = sample(3);
          else {
            const keyed = trns && trns.length >= 6 && rawSample(0) === trns.readUInt16BE(0) && rawSample(1) === trns.readUInt16BE(2) && rawSample(2) === trns.readUInt16BE(4);
            out[o + 3] = keyed ? 0 : 255;
          }
        }
      }
    }
  };
  if (interlace === 1) {
    const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
    let offset = 0;
    for (const [x0, y0, dx, dy] of passes) {
      const pw = Math.ceil((width - x0) / dx);
      const ph = Math.ceil((height - y0) / dy);
      if (pw <= 0 || ph <= 0) continue;
      const stride = Math.ceil((pw * bitsPerPixel) / 8);
      const rows = unfilter(raw, offset, ph, stride, bpp);
      expand(rows, stride, pw, ph, (px, py) => (y0 + py * dy) * width + (x0 + px * dx));
      offset += ph * (stride + 1);
    }
  } else {
    const stride = Math.ceil((width * bitsPerPixel) / 8);
    if (raw.length < height * (stride + 1)) throw new UsageError('PNG image data is shorter than its dimensions; the file is truncated');
    const rows = unfilter(raw, 0, height, stride, bpp);
    expand(rows, stride, width, height, (px, py) => py * width + px);
  }
  return { width, height, data: out };
}

/**
 * Encodes straight RGBA as a PNG (colour type 6, depth 8). `filter` picks the scanline filter (0-4) for every row;
 * the default 0 keeps encoding trivial and is used for tests of the decoder too.
 * @param {RgbaImage} image
 * @param {{filter?: 0 | 1 | 2 | 3 | 4}} [options]
 * @returns {Buffer}
 */
export function encodePng({ width, height, data }, { filter = 0 } = {}) {
  if (data.length !== width * height * 4) throw new TypeError(`encodePng: expected ${width * height * 4} RGBA bytes, got ${data.length}`);
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const o = y * (stride + 1);
    raw[o] = filter;
    for (let x = 0; x < stride; x += 1) {
      const v = data[y * stride + x];
      const a = x >= 4 ? data[y * stride + x - 4] : 0;
      const b = y > 0 ? data[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4] : 0;
      const predicted = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0;
      raw[o + 1 + x] = (v - predicted) & 0xff;
    }
  }
  /** @param {string} type @param {Buffer} body */
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------------------------------------------
// ICO and image headers

/**
 * @typedef {{index: number, width: number, height: number, colorCount: number, planes: number, bpp: number,
 *   bytes: number, offset: number, format: 'png' | 'bmp'}} IcoEntry
 * @typedef {{type: number, count: number, entries: IcoEntry[]}} IcoInfo
 */

/**
 * Reads an ICO directory. Width and height 0 mean 256. Throws UsageError for anything that is not an icon file.
 * @param {Buffer} buf
 * @returns {IcoInfo}
 */
export function parseIco(buf) {
  if (buf.length < 6) throw new UsageError('not an ICO file (shorter than its header)');
  const reserved = buf.readUInt16LE(0);
  const type = buf.readUInt16LE(2);
  const count = buf.readUInt16LE(4);
  if (reserved !== 0 || (type !== 1 && type !== 2)) throw new UsageError('not an ICO file (bad header)');
  if (count === 0) throw new UsageError('ICO file holds no image');
  if (buf.length < 6 + 16 * count) throw new UsageError('ICO directory runs past the end of the file');
  /** @type {IcoEntry[]} */
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const o = 6 + 16 * i;
    const bytes = buf.readUInt32LE(o + 8);
    const offset = buf.readUInt32LE(o + 12);
    if (offset + bytes > buf.length || bytes < 8) throw new UsageError(`ICO entry ${i} points outside the file`);
    entries.push({
      index: i,
      width: buf[o] || 256,
      height: buf[o + 1] || 256,
      colorCount: buf[o + 2],
      planes: buf.readUInt16LE(o + 4),
      bpp: buf.readUInt16LE(o + 6),
      bytes,
      offset,
      format: buf.subarray(offset, offset + 8).equals(PNG_SIGNATURE) ? 'png' : 'bmp',
    });
  }
  return { type, count, entries };
}

/**
 * Decodes one ICO entry: an embedded PNG, or a DIB (1, 4, 8, 24 or 32 bits) with its AND mask.
 * @param {Buffer} buf
 * @param {IcoEntry} entry
 * @returns {RgbaImage}
 */
export function decodeIcoEntry(buf, entry) {
  const data = buf.subarray(entry.offset, entry.offset + entry.bytes);
  if (entry.format === 'png') return decodePng(data);
  const headerSize = data.readUInt32LE(0);
  if (headerSize < 40) throw new UsageError(`ICO entry ${entry.index} has an unknown bitmap header (${headerSize} bytes)`);
  const width = data.readInt32LE(4);
  const height = Math.abs(data.readInt32LE(8)) / 2;
  const bpp = data.readUInt16LE(14);
  const compression = data.readUInt32LE(16);
  if (compression !== 0 && compression !== 3) throw new UsageError(`ICO entry ${entry.index} uses compressed bitmap type ${compression}`);
  if (![1, 4, 8, 24, 32].includes(bpp) || width <= 0 || height <= 0) throw new UsageError(`ICO entry ${entry.index} has unsupported bitmap format (${bpp} bpp)`);
  let pos = headerSize;
  /** @type {number[][]} */
  const paletteColours = [];
  if (bpp <= 8) {
    const used = data.readUInt32LE(32) || 1 << bpp;
    for (let i = 0; i < used; i += 1) paletteColours.push([data[pos + i * 4 + 2], data[pos + i * 4 + 1], data[pos + i * 4]]);
    pos += used * 4;
  } else if (compression === 3) pos += 12;
  const xorStride = Math.floor((bpp * width + 31) / 32) * 4;
  const andStride = Math.floor((width + 31) / 32) * 4;
  const andStart = pos + xorStride * height;
  const hasAnd = andStart + andStride * height <= data.length;
  const out = Buffer.alloc(width * height * 4);
  let alphaSeen = false;
  for (let y = 0; y < height; y += 1) {
    const row = pos + (height - 1 - y) * xorStride;
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (bpp === 32) {
        out[o] = data[row + x * 4 + 2];
        out[o + 1] = data[row + x * 4 + 1];
        out[o + 2] = data[row + x * 4];
        out[o + 3] = data[row + x * 4 + 3];
        if (out[o + 3] !== 0) alphaSeen = true;
      } else if (bpp === 24) {
        out[o] = data[row + x * 3 + 2];
        out[o + 1] = data[row + x * 3 + 1];
        out[o + 2] = data[row + x * 3];
        out[o + 3] = 255;
      } else {
        const bit = x * bpp;
        const idx = (data[row + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        const c = paletteColours[idx] ?? [0, 0, 0];
        out[o] = c[0];
        out[o + 1] = c[1];
        out[o + 2] = c[2];
        out[o + 3] = 255;
      }
    }
  }
  if (hasAnd && (bpp !== 32 || !alphaSeen)) {
    for (let y = 0; y < height; y += 1) {
      const row = andStart + (height - 1 - y) * andStride;
      for (let x = 0; x < width; x += 1) {
        const transparent = (data[row + (x >> 3)] >> (7 - (x & 7))) & 1;
        out[(y * width + x) * 4 + 3] = transparent ? 0 : 255;
      }
    }
  }
  return { width, height, data: out };
}

/**
 * @typedef {{format: 'png' | 'jpeg' | 'gif' | 'webp' | 'ico' | 'svg' | 'unknown', width: number | null,
 *   height: number | null}} ImageInfo
 */

/**
 * Format and pixel size from a file's header (PNG, JPEG, GIF, WebP, ICO; SVG has no pixel size).
 * @param {Buffer} buf
 * @returns {ImageInfo}
 */
export function imageInfo(buf) {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 10 && (buf.toString('latin1', 0, 6) === 'GIF87a' || buf.toString('latin1', 0, 6) === 'GIF89a')) {
    return { format: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const kind = buf.toString('latin1', 12, 16);
    if (kind === 'VP8X') return { format: 'webp', width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    if (kind === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8 ') return { format: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    return { format: 'webp', width: null, height: null };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let pos = 2;
    while (pos + 9 < buf.length) {
      if (buf[pos] !== 0xff) {
        pos += 1;
        continue;
      }
      const marker = buf[pos + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        pos += 2;
        continue;
      }
      const len = buf.readUInt16BE(pos + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: 'jpeg', width: buf.readUInt16BE(pos + 7), height: buf.readUInt16BE(pos + 5) };
      }
      pos += 2 + len;
    }
    return { format: 'jpeg', width: null, height: null };
  }
  if (buf.length >= 6 && buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1) {
    try {
      const ico = parseIco(buf);
      const largest = ico.entries.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
      return { format: 'ico', width: largest.width, height: largest.height };
    } catch {
      return { format: 'unknown', width: null, height: null };
    }
  }
  const head = buf.subarray(0, 512).toString('utf8').trimStart();
  if (head.startsWith('<') && /<svg[\s>]/i.test(buf.subarray(0, 4096).toString('utf8'))) return { format: 'svg', width: null, height: null };
  return { format: 'unknown', width: null, height: null };
}

// ---------------------------------------------------------------------------------------------------------------
// SVG trees (SVGO's own parser, captured by a plugin) and their CSS

/**
 * Parses SVG markup with SVGO's parser. Throws UsageError on malformed XML.
 * @param {string} text
 * @returns {XastRoot}
 */
export function parseSvgTree(text) {
  const box = { root: /** @type {XastRoot | null} */ (null) };
  try {
    optimize(text, { plugins: [{ name: 'fe-capture', fn: (root) => { box.root = root; return null; } }] });
  } catch (err) {
    throw new UsageError(`not a well-formed SVG (${firstLine(err)})`, { cause: err });
  }
  if (!box.root) throw new UsageError('SVGO returned no tree for the SVG');
  return box.root;
}

/**
 * Rewrites SVG markup through a tree mutation, serialised by SVGO without its default plugins.
 * @param {string} text
 * @param {(root: XastRoot) => void} mutate
 * @returns {string}
 */
export function rewriteSvg(text, mutate) {
  try {
    return optimize(text, { plugins: [{ name: 'fe-mutate', fn: (root) => { mutate(root); return null; } }] }).data;
  } catch (err) {
    throw new UsageError(`not a well-formed SVG (${firstLine(err)})`, { cause: err });
  }
}

/** @param {XastParent} node @returns {Generator<XastElement>} */
function* elementsOf(node) {
  for (const child of node.children) {
    if (child.type === 'element') {
      yield child;
      yield* elementsOf(child);
    }
  }
}

/** @param {XastRoot} root @returns {XastElement | null} */
export function rootSvgElement(root) {
  for (const child of root.children) if (child.type === 'element' && child.name === 'svg') return child;
  return null;
}

/** @param {XastElement} el @returns {string} */
function textOf(el) {
  let s = '';
  for (const child of el.children) {
    if (child.type === 'text' || child.type === 'cdata') s += child.value;
    else if (child.type === 'element') s += textOf(child);
  }
  return s;
}

/** @param {XastElement} el @returns {string} */
function labelOf(el) {
  const id = el.attributes.id ? `#${el.attributes.id}` : '';
  const cls = el.attributes.class ? `.${el.attributes.class.trim().split(/\s+/).join('.')}` : '';
  return `${el.name}${id}${cls}`;
}

/**
 * @typedef {{prop: string, value: string, important: boolean}} CssDecl
 * @typedef {{type: 'rule', selector: string, decls: CssDecl[]}} CssRuleNode
 * @typedef {{type: 'at', name: string, prelude: string, children: CssNode[] | null, body: string}} CssAtNode
 * @typedef {CssRuleNode | CssAtNode} CssNode
 */

/**
 * A small CSS reader for icon stylesheets: rules, declarations and nested at-rules (@media, @supports, @layer).
 * @param {string} text
 * @returns {CssNode[]}
 */
export function parseCss(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return parseCssBlock(src);
}

/** @param {string} s @param {number} open index of '{' @returns {number} index of the matching '}' (or s.length) */
function blockEnd(s, open) {
  let depth = 0;
  let quote = '';
  for (let i = open; i < s.length; i += 1) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return s.length;
}

/** @param {string} s @returns {CssNode[]} */
function parseCssBlock(s) {
  /** @type {CssNode[]} */
  const nodes = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && (s[i] === ';' || s[i] === '}' || /\s/.test(s[i]))) i += 1;
    if (i >= s.length) break;
    const isAt = s[i] === '@';
    let j = i;
    let quote = '';
    for (; j < s.length; j += 1) {
      const c = s[j];
      if (quote) {
        if (c === '\\') j += 1;
        else if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === '{' || (isAt && c === ';')) break;
    }
    const head = s.slice(i, j).trim();
    if (j >= s.length) break;
    if (s[j] === ';') {
      nodes.push({ type: 'at', name: atName(head), prelude: atPrelude(head), children: null, body: '' });
      i = j + 1;
      continue;
    }
    const end = blockEnd(s, j);
    const body = s.slice(j + 1, end);
    if (isAt) {
      const name = atName(head);
      const nested = ['media', 'supports', 'layer', 'container', 'document'].includes(name);
      nodes.push({ type: 'at', name, prelude: atPrelude(head), children: nested ? parseCssBlock(body) : null, body });
    } else {
      nodes.push({ type: 'rule', selector: head, decls: parseDecls(body) });
    }
    i = end + 1;
  }
  return nodes;
}

/** @param {string} head @returns {string} */
function atName(head) {
  return (/^@([\w-]+)/.exec(head)?.[1] ?? '').toLowerCase();
}

/** @param {string} head @returns {string} */
function atPrelude(head) {
  return head.replace(/^@[\w-]+/, '').trim();
}

/**
 * @param {string} body
 * @returns {CssDecl[]}
 */
export function parseDecls(body) {
  /** @type {CssDecl[]} */
  const decls = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  /** @param {string} part */
  const push = (part) => {
    const colon = part.indexOf(':');
    if (colon <= 0) return;
    const prop = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim();
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    if (prop && value) decls.push({ prop, value, important });
  };
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) {
      push(body.slice(start, i));
      start = i + 1;
    }
  }
  push(body.slice(start));
  return decls;
}

/** @param {string} prelude @returns {boolean} */
function isDarkMedia(prelude) {
  return /prefers-color-scheme\s*:\s*dark/i.test(prelude);
}

/** @param {string} prelude @param {'light' | 'dark'} scheme @returns {boolean} */
function mediaApplies(prelude, scheme) {
  const p = prelude.trim().toLowerCase();
  if (p === '' || p === 'all' || p === 'screen') return true;
  if (/prefers-color-scheme\s*:\s*dark/.test(p)) return scheme === 'dark' && !/\(\s*(min|max)-|print/.test(p);
  if (/prefers-color-scheme\s*:\s*light/.test(p)) return scheme === 'light' && !/\(\s*(min|max)-|print/.test(p);
  return false;
}

/**
 * @typedef {{selector: string, decls: CssDecl[], order: number}} AppliedRule
 * @typedef {{node: XastElement, text: string, media: string}} StyleSheet
 */

/** @param {XastRoot} root @returns {StyleSheet[]} */
export function styleSheetsOf(root) {
  /** @type {StyleSheet[]} */
  const sheets = [];
  for (const el of elementsOf(root)) {
    if (el.name !== 'style') continue;
    sheets.push({ node: el, text: textOf(el), media: el.attributes.media ?? '' });
  }
  return sheets;
}

/**
 * The style rules that apply in a colour scheme, in source order.
 * @param {XastRoot} root
 * @param {'light' | 'dark'} scheme
 * @returns {AppliedRule[]}
 */
function rulesFor(root, scheme) {
  /** @type {AppliedRule[]} */
  const rules = [];
  /** @param {CssNode[]} nodes */
  const visit = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'rule') rules.push({ selector: node.selector, decls: node.decls, order: rules.length });
      else if (node.children && (node.name !== 'media' || mediaApplies(node.prelude, scheme))) visit(node.children);
    }
  };
  for (const sheet of styleSheetsOf(root)) {
    if (sheet.media && !mediaApplies(sheet.media, scheme)) continue;
    visit(parseCss(sheet.text));
  }
  return rules;
}

/**
 * @typedef {{selector: string, decls: CssDecl[], matches: number}} DarkRule
 * @typedef {{present: boolean, rules: DarkRule[], matched: boolean, colours: string[]}} DarkModeReport
 */

/**
 * The dark-mode rules of an SVG: rules under `@media (prefers-color-scheme: dark)` (or a `<style>` whose media is
 * that query), how many elements each selector matches, and the colours they set. After SVGO's default preset the
 * rule can survive while its class is gone, so a rule that matches nothing counts as lost [FD12-F24].
 * @param {string | XastRoot} svg
 * @returns {DarkModeReport}
 */
export function darkModeReport(svg) {
  const root = typeof svg === 'string' ? parseSvgTree(svg) : svg;
  /** @type {DarkRule[]} */
  const rules = [];
  /** @param {CssNode[]} nodes @param {boolean} dark */
  const visit = (nodes, dark) => {
    for (const node of nodes) {
      if (node.type === 'rule') {
        if (dark) rules.push({ selector: node.selector, decls: node.decls, matches: countMatches(root, node.selector) });
      } else if (node.children) visit(node.children, dark || (node.name === 'media' && isDarkMedia(node.prelude)));
    }
  };
  for (const sheet of styleSheetsOf(root)) visit(parseCss(sheet.text), isDarkMedia(sheet.media));
  /** @type {string[]} */
  const colours = [];
  for (const rule of rules) {
    for (const d of rule.decls) {
      if (!['fill', 'stroke', 'color', 'stop-color'].includes(d.prop)) continue;
      const c = parseColor(d.value);
      if (c && c.a > 0 && !colours.includes(toHex(c))) colours.push(toHex(c));
    }
  }
  return { present: rules.length > 0, rules, matched: rules.some((r) => r.matches > 0), colours };
}

/** @param {XastRoot} root @param {string} selectorList @returns {number} */
function countMatches(root, selectorList) {
  let n = 0;
  for (const selector of splitSelectors(selectorList)) {
    try {
      n += querySelectorAll(root, selector).filter((node) => node.type === 'element').length;
    } catch {
      // a selector css-select cannot evaluate (:hover and friends) matches nothing in a static icon
    }
  }
  return n;
}

/** @param {string} list @returns {string[]} */
function splitSelectors(list) {
  /** @type {string[]} */
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out.filter(Boolean);
}

/** @param {string} selector @returns {number} */
function specificity(selector) {
  const s = selector.replace(/"[^"]*"|'[^']*'/g, '');
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+(?:\([^)]*\))?/g) ?? []).length;
  const types = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?/g, ' ').match(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
  return ids * 10000 + classes * 100 + types;
}

/** Properties the lint and the renders care about; the first group inherits. */
const INHERITED = Object.freeze(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'visibility', 'color']);
const NOT_INHERITED = Object.freeze(['display', 'opacity', 'filter', 'mask', 'clip-path', 'transform', 'animation',
  'animation-name', 'transition', 'mix-blend-mode']);
const STYLE_PROPS = new Set([...INHERITED, ...NOT_INHERITED]);

/**
 * Specified values per element: presentation attributes, then style rules by specificity and order, then the style
 * attribute; `!important` wins within its origin.
 * @param {XastRoot} root
 * @param {'light' | 'dark'} scheme
 * @returns {Map<XastElement, Record<string, string>>}
 */
export function specifiedStyles(root, scheme = 'light') {
  /** @type {Map<XastElement, Map<string, {value: string, rank: number[]}>>} */
  const table = new Map();
  /** @param {XastElement} el @param {string} prop @param {string} value @param {number[]} rank */
  const offer = (el, prop, value, rank) => {
    if (!STYLE_PROPS.has(prop)) return;
    let props = table.get(el);
    if (!props) {
      props = new Map();
      table.set(el, props);
    }
    const current = props.get(prop);
    if (!current || compareRank(rank, current.rank) >= 0) props.set(prop, { value, rank });
  };
  for (const el of elementsOf(root)) {
    for (const [name, value] of Object.entries(el.attributes)) offer(el, name.toLowerCase(), value, [0, 0, 0, 0]);
  }
  for (const rule of rulesFor(root, scheme)) {
    for (const selector of splitSelectors(rule.selector)) {
      let matched;
      try {
        matched = querySelectorAll(root, selector);
      } catch {
        continue;
      }
      const spec = specificity(selector);
      for (const node of matched) {
        if (node.type !== 'element') continue;
        for (const d of rule.decls) offer(node, d.prop, d.value, [d.important ? 1 : 0, 1, spec, rule.order]);
      }
    }
  }
  for (const el of elementsOf(root)) {
    if (!el.attributes.style) continue;
    for (const d of parseDecls(el.attributes.style)) offer(el, d.prop, d.value, [d.important ? 1 : 0, 2, 0, 0]);
  }
  /** @type {Map<XastElement, Record<string, string>>} */
  const out = new Map();
  for (const [el, props] of table) out.set(el, Object.fromEntries([...props].map(([k, v]) => [k, v.value.trim()])));
  return out;
}

/** @param {number[]} a @param {number[]} b @returns {number} */
function compareRank(a, b) {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry: transforms, path data, shapes, flattening

/** @type {Matrix} */
const IDENTITY = [1, 0, 0, 1, 0, 0];

/** @param {Matrix} m @param {Matrix} n @returns {Matrix} m then applied after n (m x n) */
export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** @param {Matrix} m @param {number} x @param {number} y @returns {Point} */
function applyMatrix(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** @param {Matrix} m @returns {number} the length scale of a matrix */
function matrixScale(m) {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/**
 * Parses an SVG transform list (or a CSS transform with deg, rad, turn and px units).
 * @param {string} text
 * @returns {{matrix: Matrix, error: string | null}}
 */
export function parseTransform(text) {
  /** @type {Matrix} */
  let m = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi;
  let rest = text;
  let match;
  while ((match = re.exec(text))) {
    rest = rest.replace(match[0], '');
    const name = match[1].toLowerCase();
    const args = (match[2].match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:deg|rad|turn|grad|px)?/gi) ?? []).map((a) => {
      const v = Number.parseFloat(a);
      if (/rad$/i.test(a)) return (v * 180) / Math.PI;
      if (/turn$/i.test(a)) return v * 360;
      if (/grad$/i.test(a)) return v * 0.9;
      return v;
    });
    /** @type {Matrix} */
    let t = IDENTITY;
    if (name === 'matrix' && args.length === 6) t = /** @type {Matrix} */ (args);
    else if (name === 'translate' && args.length >= 1) t = [1, 0, 0, 1, args[0], args[1] ?? 0];
    else if (name === 'scale' && args.length >= 1) t = [args[0], 0, 0, args[1] ?? args[0], 0, 0];
    else if (name === 'rotate' && args.length >= 1) {
      const a = (args[0] * Math.PI) / 180;
      const r = /** @type {Matrix} */ ([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
      t = args.length >= 3 ? multiply(multiply([1, 0, 0, 1, args[1], args[2]], r), [1, 0, 0, 1, -args[1], -args[2]]) : r;
    } else if (name === 'skewx' && args.length >= 1) t = [1, 0, Math.tan((args[0] * Math.PI) / 180), 1, 0, 0];
    else if (name === 'skewy' && args.length >= 1) t = [1, Math.tan((args[0] * Math.PI) / 180), 0, 1, 0, 0];
    else return { matrix: m, error: `bad ${match[1]}(${match[2]})` };
    m = multiply(m, t);
  }
  const leftover = rest.replace(/[\s,]/g, '');
  return { matrix: m, error: leftover && leftover !== 'none' ? `cannot read "${leftover.slice(0, 40)}"` : null };
}

/**
 * @typedef {{cmd: string, args: number[]}} PathCommand
 * @typedef {{commands: PathCommand[], error: string | null}} ParsedPath
 */

const ARG_COUNT = /** @type {Record<string, number>} */ ({ M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 });
const NUMBER_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

/**
 * Parses SVG path data into commands with their arguments (arc flags read as single digits, so `a1 1 0 00 1 1`
 * parses). Stops at the first error and keeps what came before, as renderers do.
 * @param {string} d
 * @returns {ParsedPath}
 */
export function parsePathData(d) {
  const s = String(d ?? '');
  /** @type {PathCommand[]} */
  const commands = [];
  let i = 0;
  const skip = () => {
    while (i < s.length && ' \t\n\r\f,'.includes(s[i])) i += 1;
  };
  /** @returns {number | null} */
  const number = () => {
    skip();
    NUMBER_RE.lastIndex = i;
    const m = NUMBER_RE.exec(s);
    if (!m) return null;
    i = NUMBER_RE.lastIndex;
    return Number(m[0]);
  };
  /** @returns {number | null} */
  const flag = () => {
    skip();
    if (s[i] === '0' || s[i] === '1') {
      i += 1;
      return s[i - 1] === '1' ? 1 : 0;
    }
    return null;
  };
  let cmd = '';
  for (;;) {
    skip();
    if (i >= s.length) break;
    const c = s[i];
    if (/[MmZzLlHhVvCcSsQqTtAa]/.test(c)) {
      cmd = c;
      i += 1;
      if (c === 'Z' || c === 'z') {
        commands.push({ cmd: c, args: [] });
        continue;
      }
    } else if (!cmd || cmd === 'Z' || cmd === 'z') {
      return { commands, error: `unexpected "${s.slice(i, i + 12)}" at ${i}` };
    }
    const upper = cmd.toUpperCase();
    const count = ARG_COUNT[upper];
    /** @type {number[]} */
    const args = [];
    for (let k = 0; k < count; k += 1) {
      const v = upper === 'A' && (k === 3 || k === 4) ? flag() : number();
      if (v === null || !Number.isFinite(v)) return { commands, error: `bad ${cmd} argument at ${i}` };
      args.push(v);
    }
    commands.push({ cmd, args });
    if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
  }
  if (commands.length > 0 && commands[0].cmd.toUpperCase() !== 'M') return { commands: [], error: 'path data must start with M' };
  return { commands, error: null };
}

/**
 * @typedef {{points: Point[], curve: boolean[], closed: boolean}} Subpath
 *   `curve[i]` says whether the edge from points[i] to points[i + 1] came from a curve.
 */

/**
 * Flattens path commands into polylines in local coordinates. `step` is the target segment length.
 * @param {PathCommand[]} commands
 * @param {number} step
 * @returns {Subpath[]}
 */
export function flattenPath(commands, step) {
  /** @type {Subpath[]} */
  const subpaths = [];
  let current = /** @type {Subpath | null} */ (null);
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  /** @type {Point | null} */
  let lastCubic = null;
  /** @type {Point | null} */
  let lastQuad = null;
  /** @returns {Subpath} */
  const begin = () => {
    /** @type {Subpath} */
    const sp = { points: [[x, y]], curve: [], closed: false };
    subpaths.push(sp);
    return sp;
  };
  /** @param {Point[]} pts @param {boolean} curve */
  const add = (pts, curve) => {
    if (!current) current = begin();
    for (const p of pts) {
      current.points.push(p);
      current.curve.push(curve);
    }
  };
  for (const { cmd, args } of commands) {
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z';
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    if (C === 'M') {
      x = ox + args[0];
      y = oy + args[1];
      sx = x;
      sy = y;
      current = begin();
      lastCubic = lastQuad = null;
    } else if (C === 'Z') {
      if (current) current.closed = true;
      x = sx;
      y = sy;
      current = null;
      lastCubic = lastQuad = null;
    } else if (C === 'L' || C === 'H' || C === 'V') {
      const nx = C === 'V' ? x : ox + args[0];
      const ny = C === 'H' ? y : C === 'V' ? oy + args[0] : oy + args[1];
      add([[nx, ny]], false);
      x = nx;
      y = ny;
      lastCubic = lastQuad = null;
    } else if (C === 'C' || C === 'S') {
      /** @type {Point} */
      let c1;
      /** @type {Point} */
      let c2;
      /** @type {Point} */
      let end;
      if (C === 'C') {
        c1 = [ox + args[0], oy + args[1]];
        c2 = [ox + args[2], oy + args[3]];
        end = [ox + args[4], oy + args[5]];
      } else {
        c1 = lastCubic ? [2 * x - lastCubic[0], 2 * y - lastCubic[1]] : [x, y];
        c2 = [ox + args[0], oy + args[1]];
        end = [ox + args[2], oy + args[3]];
      }
      add(cubicPoints([x, y], c1, c2, end, step), true);
      lastCubic = c2;
      lastQuad = null;
      [x, y] = end;
    } else if (C === 'Q' || C === 'T') {
      /** @type {Point} */
      let c1;
      /** @type {Point} */
      let end;
      if (C === 'Q') {
        c1 = [ox + args[0], oy + args[1]];
        end = [ox + args[2], oy + args[3]];
      } else {
        c1 = lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : [x, y];
        end = [ox + args[0], oy + args[1]];
      }
      add(quadPoints([x, y], c1, end, step), true);
      lastQuad = c1;
      lastCubic = null;
      [x, y] = end;
    } else if (C === 'A') {
      /** @type {Point} */
      const end = [ox + args[5], oy + args[6]];
      const pts = arcPoints([x, y], args[0], args[1], args[2], args[3] === 1, args[4] === 1, end, step);
      add(pts, pts.length > 1);
      [x, y] = end;
      lastCubic = lastQuad = null;
    }
  }
  return subpaths;
}

/** @param {Point} p0 @param {Point} p1 @param {Point} p2 @param {Point} p3 @param {number} step @returns {Point[]} */
function cubicPoints(p0, p1, p2, p3, step) {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  const n = clamp(Math.ceil(len / step), 2, 64);
  /** @type {Point[]} */
  const out = [];
  for (let k = 1; k <= n; k += 1) {
    const t = k / n;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

/** @param {Point} p0 @param {Point} p1 @param {Point} p2 @param {number} step @returns {Point[]} */
function quadPoints(p0, p1, p2, step) {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const n = clamp(Math.ceil(len / step), 2, 64);
  /** @type {Point[]} */
  const out = [];
  for (let k = 1; k <= n; k += 1) {
    const t = k / n;
    const u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return out;
}

/**
 * Samples an elliptical arc (SVG endpoint parameterisation, implementation notes F.6.5 and F.6.6).
 * @param {Point} p1 @param {number} rxIn @param {number} ryIn @param {number} angle degrees
 * @param {boolean} large @param {boolean} sweep @param {Point} p2 @param {number} step
 * @returns {Point[]}
 */
function arcPoints(p1, rxIn, ryIn, angle, large, sweep, p2, step) {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if ((p1[0] === p2[0] && p1[1] === p2[1])) return [];
  if (rx === 0 || ry === 0) return [p2];
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p1[0] - p2[0]) / 2;
  const dy = (p1[1] - p2[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (coef * rx * y1) / ry;
  const cy1 = (-coef * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p1[0] + p2[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p1[1] + p2[1]) / 2;
  /** @param {number} ux @param {number} uy @param {number} vx @param {number} vy */
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  const n = clamp(Math.ceil((Math.abs(delta) * Math.max(rx, ry)) / step), 2, 256);
  /** @type {Point[]} */
  const out = [];
  for (let k = 1; k <= n; k += 1) {
    const t = theta1 + (delta * k) / n;
    out.push([cx + rx * cos * Math.cos(t) - ry * sin * Math.sin(t), cy + rx * sin * Math.cos(t) + ry * cos * Math.sin(t)]);
  }
  out[out.length - 1] = p2;
  return out;
}

/**
 * A length attribute in user units: plain numbers, px and absolute units; % against `ref`.
 * @param {string | undefined} value @param {number} ref @param {number} fallback
 * @returns {number}
 */
function lengthOf(value, ref, fallback = 0) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|%|pt|pc|mm|cm|in|em|ex)?\s*$/i.exec(String(value));
  if (!m) return Number.NaN;
  const v = Number(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  const factor = { '': 1, px: 1, '%': ref / 100, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, ex: 8 }[unit];
  return v * (factor ?? 1);
}

/** @param {string | undefined} text @returns {number[]} */
function numberList(text) {
  return (String(text ?? '').match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) ?? []).map(Number);
}

/**
 * The viewBox of the root element, or one derived from width and height.
 * @param {XastElement} svg
 * @returns {Box | null}
 */
export function viewBoxOf(svg) {
  const nums = numberList(svg.attributes.viewBox);
  if (nums.length === 4 && nums[2] > 0 && nums[3] > 0) return { x: nums[0], y: nums[1], w: nums[2], h: nums[3] };
  const w = lengthOf(svg.attributes.width, 0, Number.NaN);
  const h = lengthOf(svg.attributes.height, 0, Number.NaN);
  if (w > 0 && h > 0) return { x: 0, y: 0, w, h };
  return null;
}

/**
 * Path commands for a basic shape element (rect with rounded corners, circle, ellipse, line, polyline, polygon).
 * @param {XastElement} el @param {Box} vb
 * @returns {{commands: PathCommand[], error: string | null, zero: boolean}}
 */
function shapeCommands(el, vb) {
  const a = el.attributes;
  const diag = Math.sqrt((vb.w * vb.w + vb.h * vb.h) / 2);
  /** @param {string} cmd @param {number[]} args @returns {PathCommand} */
  const c = (cmd, args) => ({ cmd, args });
  switch (el.name) {
    case 'path': {
      const parsed = parsePathData(a.d ?? '');
      return { commands: parsed.commands, error: parsed.error, zero: parsed.commands.length === 0 };
    }
    case 'rect': {
      const x = lengthOf(a.x, vb.w);
      const y = lengthOf(a.y, vb.h);
      const w = lengthOf(a.width, vb.w);
      const h = lengthOf(a.height, vb.h);
      if (!(w > 0) || !(h > 0)) return { commands: [], error: null, zero: true };
      let rx = lengthOf(a.rx, vb.w, Number.NaN);
      let ry = lengthOf(a.ry, vb.h, Number.NaN);
      if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
      if (Number.isNaN(ry)) ry = rx;
      rx = clamp(rx, 0, w / 2);
      ry = clamp(ry, 0, h / 2);
      if (rx === 0 || ry === 0) return { commands: [c('M', [x, y]), c('H', [x + w]), c('V', [y + h]), c('H', [x]), c('Z', [])], error: null, zero: false };
      return {
        commands: [
          c('M', [x + rx, y]), c('H', [x + w - rx]), c('A', [rx, ry, 0, 0, 1, x + w, y + ry]), c('V', [y + h - ry]),
          c('A', [rx, ry, 0, 0, 1, x + w - rx, y + h]), c('H', [x + rx]), c('A', [rx, ry, 0, 0, 1, x, y + h - ry]),
          c('V', [y + ry]), c('A', [rx, ry, 0, 0, 1, x + rx, y]), c('Z', []),
        ],
        error: null,
        zero: false,
      };
    }
    case 'circle':
    case 'ellipse': {
      const cx = lengthOf(a.cx, vb.w);
      const cy = lengthOf(a.cy, vb.h);
      let rx = el.name === 'circle' ? lengthOf(a.r, diag) : lengthOf(a.rx, vb.w, Number.NaN);
      let ry = el.name === 'circle' ? rx : lengthOf(a.ry, vb.h, Number.NaN);
      if (Number.isNaN(rx)) rx = ry;
      if (Number.isNaN(ry)) ry = rx;
      if (!(rx > 0) || !(ry > 0)) return { commands: [], error: null, zero: true };
      return {
        commands: [c('M', [cx + rx, cy]), c('A', [rx, ry, 0, 0, 1, cx - rx, cy]), c('A', [rx, ry, 0, 0, 1, cx + rx, cy]), c('Z', [])],
        error: null,
        zero: false,
      };
    }
    case 'line':
      return {
        commands: [c('M', [lengthOf(a.x1, vb.w), lengthOf(a.y1, vb.h)]), c('L', [lengthOf(a.x2, vb.w), lengthOf(a.y2, vb.h)])],
        error: null,
        zero: false,
      };
    case 'polyline':
    case 'polygon': {
      const nums = numberList(a.points);
      if (nums.length < 4) return { commands: [], error: null, zero: true };
      /** @type {PathCommand[]} */
      const commands = [c('M', [nums[0], nums[1]])];
      for (let k = 2; k + 1 < nums.length; k += 2) commands.push(c('L', [nums[k], nums[k + 1]]));
      if (el.name === 'polygon') commands.push(c('Z', []));
      return { commands, error: nums.length % 2 ? 'odd number of coordinates' : null, zero: false };
    }
    default:
      return { commands: [], error: null, zero: true };
  }
}

const GEOMETRY_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const CONTAINER_TAGS = new Set(['svg', 'g', 'a', 'switch']);

/**
 * @typedef {{
 *   index: number, order: number, tag: string, label: string, node: XastElement,
 *   fill: string, stroke: string, fillOpacity: number, strokeOpacity: number, opacity: number,
 *   strokeWidth: number, fillRule: string, linecap: string, linejoin: string,
 *   hasFill: boolean, hasStroke: boolean, hidden: string | null, paintRefs: string[],
 *   subpaths: Subpath[], bbox: Box | null, strokeBox: Box | null, area: number,
 *   pathError: string | null, transformError: string | null, viaUse: boolean, masked: boolean, clipped: boolean
 * }} GeoElement
 * @typedef {{svg: XastElement, viewBox: Box | null, elements: GeoElement[], ids: Map<string, XastElement>,
 *   order: Map<XastElement, number>}} Geometry
 */

/**
 * Builds the painted geometry of an SVG in root user units: every shape flattened, transformed and paired with its
 * computed paint, in paint order. `<use>` references are followed; defs, clip paths, masks, markers and text are
 * not drawn (the structural lint reports text and the like separately).
 * @param {XastRoot} root
 * @param {{scheme?: 'light' | 'dark'}} [options]
 * @returns {Geometry}
 */
export function buildGeometry(root, { scheme = 'light' } = {}) {
  const svg = rootSvgElement(root);
  if (!svg) throw new UsageError('the file has no <svg> root element');
  const viewBox = viewBoxOf(svg);
  const vb = viewBox ?? { x: 0, y: 0, w: 300, h: 150 };
  const styles = specifiedStyles(root, scheme);
  /** @type {Map<string, XastElement>} */
  const ids = new Map();
  /** @type {Map<XastElement, number>} */
  const order = new Map();
  for (const el of elementsOf(root)) {
    order.set(el, order.size);
    if (el.attributes.id) ids.set(el.attributes.id, el);
  }
  const step = Math.hypot(vb.w, vb.h) / 400;
  /** @type {GeoElement[]} */
  const elements = [];
  /** @type {Record<string, string>} */
  const initial = {
    fill: '#000000', 'fill-opacity': '1', 'fill-rule': 'nonzero', stroke: 'none', 'stroke-opacity': '1', 'stroke-width': '1',
    'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', visibility: 'visible', color: '#000000',
  };
  /**
   * @param {XastElement} el @param {Matrix} ctm @param {Record<string, string>} inherited
   * @param {{opacity: number, hidden: string | null, viaUse: boolean, masked: boolean, clipped: boolean, depth: number, stack: Set<XastElement>}} ctx
   */
  const visit = (el, ctm, inherited, ctx) => {
    const spec = styles.get(el) ?? {};
    /** @type {Record<string, string>} */
    const computed = {};
    for (const prop of INHERITED) {
      const v = spec[prop];
      computed[prop] = v === undefined || v === 'inherit' ? inherited[prop] : v;
    }
    const display = (spec.display ?? 'inline').toLowerCase();
    const opacityHere = clamp(Number.parseFloat(spec.opacity ?? '1'), 0, 1);
    const opacity = ctx.opacity * (Number.isNaN(opacityHere) ? 1 : opacityHere);
    let hidden = ctx.hidden;
    if (!hidden && display === 'none') hidden = el === svg ? 'display:none on the root' : `display:none on ${labelOf(el)}`;
    const transformText = el.attributes.transform ?? (spec.transform && spec.transform !== 'none' ? spec.transform : '');
    const local = transformText ? parseTransform(transformText) : { matrix: IDENTITY, error: null };
    let m = multiply(ctm, local.matrix);
    if (el.name === 'svg' && el !== svg) m = multiply(m, [1, 0, 0, 1, lengthOf(el.attributes.x, vb.w), lengthOf(el.attributes.y, vb.h)]);
    const masked = ctx.masked || Boolean(el.attributes.mask || (spec.mask && spec.mask !== 'none'));
    const clipped = ctx.clipped || Boolean(el.attributes['clip-path'] || (spec['clip-path'] && spec['clip-path'] !== 'none'));
    const next = { ...ctx, opacity, hidden, masked, clipped, depth: ctx.depth + 1 };
    if (el.name === 'use') {
      const href = el.attributes.href ?? el.attributes['xlink:href'] ?? '';
      const target = href.startsWith('#') ? ids.get(href.slice(1)) : undefined;
      if (!target || ctx.stack.has(target) || ctx.depth > 16) return;
      const shifted = multiply(m, [1, 0, 0, 1, lengthOf(el.attributes.x, vb.w), lengthOf(el.attributes.y, vb.h)]);
      const stack = new Set(ctx.stack).add(target);
      if (target.name === 'symbol') {
        for (const child of target.children) if (child.type === 'element') visit(child, shifted, computed, { ...next, viaUse: true, stack });
      } else visit(target, shifted, computed, { ...next, viaUse: true, stack });
      return;
    }
    if (CONTAINER_TAGS.has(el.name)) {
      for (const child of el.children) if (child.type === 'element') visit(child, m, computed, next);
      return;
    }
    if (!GEOMETRY_TAGS.has(el.name)) return;
    const shape = shapeCommands(el, vb);
    const scale = matrixScale(m) || 1;
    const subpaths = flattenPath(shape.commands, step / scale).map((sp) => ({
      points: sp.points.map(([px, py]) => applyMatrix(m, px, py)),
      curve: sp.curve,
      closed: sp.closed,
    }));
    const fill = (computed.fill ?? 'none').trim();
    const stroke = (computed.stroke ?? 'none').trim();
    const fillOpacity = clamp(Number.parseFloat(computed['fill-opacity']), 0, 1);
    const strokeOpacity = clamp(Number.parseFloat(computed['stroke-opacity']), 0, 1);
    const strokeWidth = Math.max(0, lengthOf(computed['stroke-width'], Math.sqrt((vb.w * vb.w + vb.h * vb.h) / 2), 1)) * scale;
    /** @type {string[]} */
    const paintRefs = [];
    for (const paint of [fill, stroke]) {
      const ref = /url\(\s*["']?#([^"')]+)["']?\s*\)/.exec(paint);
      if (ref) paintRefs.push(ref[1]);
    }
    const resolvePaint = (/** @type {string} */ p) => (p.toLowerCase() === 'currentcolor' ? computed.color : p);
    const fillPaint = resolvePaint(fill);
    const strokePaint = resolvePaint(stroke);
    const isLine = el.name === 'line' || el.name === 'polyline';
    const hasFill = !isLine && fillPaint.toLowerCase() !== 'none' && fillOpacity * opacity > 0 && fillPaint !== '' && !(parseColor(fillPaint)?.a === 0);
    const hasStroke = strokePaint.toLowerCase() !== 'none' && strokeWidth > 0 && strokeOpacity * opacity > 0 && !(parseColor(strokePaint)?.a === 0);
    if (!hidden) {
      const vis = (computed.visibility ?? 'visible').toLowerCase();
      if (vis === 'hidden' || vis === 'collapse') hidden = `visibility:${vis}`;
      else if (opacity === 0) hidden = 'opacity 0';
      else if (!hasFill && !hasStroke) hidden = 'no visible fill and no visible stroke';
    }
    const all = subpaths.flatMap((sp) => sp.points);
    const bbox = all.length ? boxOf(all) : null;
    const pad = hasStroke ? strokeWidth / 2 : 0;
    const strokeBox = bbox ? { x: bbox.x - pad, y: bbox.y - pad, w: bbox.w + 2 * pad, h: bbox.h + 2 * pad } : null;
    elements.push({
      index: elements.length,
      order: order.get(el) ?? -1,
      tag: el.name,
      label: labelOf(el),
      node: el,
      fill: fillPaint,
      stroke: strokePaint,
      fillOpacity,
      strokeOpacity,
      opacity,
      strokeWidth,
      fillRule: (computed['fill-rule'] ?? 'nonzero').toLowerCase(),
      linecap: (computed['stroke-linecap'] ?? 'butt').toLowerCase(),
      linejoin: (computed['stroke-linejoin'] ?? 'miter').toLowerCase(),
      hasFill,
      hasStroke,
      hidden,
      paintRefs,
      subpaths,
      bbox,
      strokeBox,
      area: subpaths.reduce((sum, sp) => sum + Math.abs(polygonArea(sp.points)), 0),
      pathError: shape.error,
      transformError: local.error,
      viaUse: ctx.viaUse,
      masked,
      clipped,
    });
  };
  visit(svg, viewBox ? [1, 0, 0, 1, 0, 0] : IDENTITY, initial, { opacity: 1, hidden: null, viaUse: false, masked: false, clipped: false, depth: 0, stack: new Set() });
  return { svg, viewBox, elements, ids, order };
}

/** @param {Point[]} pts @returns {Box} */
function boxOf(pts) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** @param {Box[]} boxes @returns {Box | null} */
function unionBox(boxes) {
  if (boxes.length === 0) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** @param {Point[]} pts @returns {number} signed area (shoelace) */
export function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** @param {Point} p @param {Point[]} poly @returns {boolean} even-odd point in polygon */
function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** @param {Point} p @param {Point} a @param {Point} b @returns {number} */
function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0, 1);
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** @param {Point[]} pts @param {number} eps @returns {Point[]} */
function rdpOpen(pts, eps) {
  if (pts.length <= 2) return pts.slice();
  let index = -1;
  let dmax = 0;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const d = distanceToSegment(pts[i], pts[0], pts[pts.length - 1]);
    if (d > dmax) {
      dmax = d;
      index = i;
    }
  }
  if (dmax <= eps) return [pts[0], pts[pts.length - 1]];
  const left = rdpOpen(pts.slice(0, index + 1), eps);
  const right = rdpOpen(pts.slice(index), eps);
  return [...left.slice(0, -1), ...right];
}

/**
 * Simplifies a closed polygon to its corners (Ramer-Douglas-Peucker from the two farthest points, then removal of
 * vertices that sit on the line between their neighbours).
 * @param {Point[]} input @param {number} eps
 * @returns {Point[]}
 */
export function simplifyClosed(input, eps) {
  /** @type {Point[]} */
  const pts = [];
  for (const p of input) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) pts.push(p);
  }
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 1e-9) pts.pop();
  if (pts.length <= 3) return pts;
  let far = 0;
  let best = -1;
  for (let i = 1; i < pts.length; i += 1) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = rdpOpen(pts.slice(0, far + 1), eps);
  const b = rdpOpen([...pts.slice(far), pts[0]], eps);
  let out = [...a.slice(0, -1), ...b.slice(0, -1)];
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i += 1) {
      const prev = out[(i - 1 + out.length) % out.length];
      const next = out[(i + 1) % out.length];
      if (distanceToSegment(out[i], prev, next) <= eps) {
        out = out.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/**
 * @typedef {{n: number, area: number, convex: boolean, sides: number[], angles: number[], box: Box,
 *   centroid: Point}} PolygonInfo
 */

/** @param {Point[]} poly @returns {PolygonInfo} */
export function polygonInfo(poly) {
  const n = poly.length;
  const area = polygonArea(poly);
  const orientation = Math.sign(area) || 1;
  /** @type {number[]} */
  const sides = [];
  /** @type {number[]} */
  const angles = [];
  let convex = true;
  for (let i = 0; i < n; i += 1) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    sides.push(Math.hypot(next[0] - cur[0], next[1] - cur[1]));
    const ux = prev[0] - cur[0];
    const uy = prev[1] - cur[1];
    const vx = next[0] - cur[0];
    const vy = next[1] - cur[1];
    const cross = (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
    let a = (Math.acos(clamp((ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1), -1, 1)) * 180) / Math.PI;
    if (Math.sign(cross) === -orientation && Math.abs(cross) > 1e-9) {
      a = 360 - a;
      convex = false;
    }
    angles.push(a);
  }
  let cx = 0;
  let cy = 0;
  for (const [x, y] of poly) {
    cx += x / n;
    cy += y / n;
  }
  return { n, area: Math.abs(area), convex, sides, angles, box: boxOf(poly), centroid: [cx, cy] };
}

// ---------------------------------------------------------------------------------------------------------------
// Mark lint

/**
 * @typedef {'fail' | 'flag' | 'note'} Severity
 * @typedef {{id: string, severity: Severity, element?: string, detail: string, value?: number | string,
 *   where?: Box}} Finding
 */

/**
 * The lint rules: `fail` blocks a candidate, `flag` passes only with a written reason in the candidate file
 * (`flag_reasons[id]`), `note` informs. Sources: FD12-F02, F05, F11, F15, F16, F22, F24 and references BR-05 to BR-07.
 */
export const LINT_RULES = Object.freeze({
  'svg.invalid': { severity: 'fail', fix: 'write well-formed SVG markup' },
  'no-viewbox': { severity: 'fail', fix: 'give the root a viewBox (0 0 32 32 for a favicon mark)' },
  nan: { severity: 'fail', fix: 'regenerate the outlines; opentype.js 2.0.0 needs flipY: false (FD12-F15)' },
  'path-error': { severity: 'fail', fix: 'fix the path data; renderers stop drawing at the first error' },
  gradient: { severity: 'fail', fix: 'use one flat colour per shape; gradients wash out at 16 px (FD12-F16)' },
  pattern: { severity: 'fail', fix: 'use flat fills; patterns are texture' },
  filter: { severity: 'fail', fix: 'remove filters, shadows and blurs from the mark' },
  shading: { severity: 'fail', fix: 'use full opacity; partial opacity is shading and is lost in one colour' },
  text: { severity: 'fail', fix: 'outline the letters into paths (brand.mjs wordmark)' },
  image: { severity: 'fail', fix: 'draw the mark with vector shapes; no embedded images' },
  'foreign-object': { severity: 'fail', fix: 'remove foreignObject' },
  script: { severity: 'fail', fix: 'remove scripts and event handlers' },
  animation: { severity: 'fail', fix: 'keep the mark static (no SMIL, no CSS animation or transition)' },
  'external-ref': { severity: 'fail', fix: 'inline everything: favicons load in secure static mode (FD12-F22)' },
  'font-face': { severity: 'fail', fix: 'outline the letters; no @font-face in a mark' },
  'thin-stroke': { severity: 'fail', fix: 'make every stroke at least viewBox/16 (2 units on a 32 grid)' },
  'thin-part': { severity: 'fail', fix: 'widen the part to at least viewBox/16; it blurs at 16 px' },
  'narrow-gap': { severity: 'fail', fix: 'open the gap or counter to at least viewBox/16; it closes at 16 px' },
  'open-path': { severity: 'fail', fix: 'close the filled and stroked subpath with Z, or the stroke leaves the closing edge undrawn' },
  'outside-viewbox': { severity: 'fail', fix: 'keep every shape inside the viewBox' },
  'zero-area': { severity: 'fail', fix: 'remove the empty shape' },
  duplicate: { severity: 'fail', fix: 'remove the duplicated shape' },
  hidden: { severity: 'fail', fix: 'remove the invisible element' },
  occluded: { severity: 'fail', fix: 'remove the element: later shapes cover it completely' },
  empty: { severity: 'fail', fix: 'the mark draws nothing; check fills and the viewBox' },
  'svgo-unclean': { severity: 'fail', fix: 'ship the SVGO output (preset-default, inlineStyles: false)' },
  'struck-initial': { severity: 'flag', fix: 'a letter struck through with bars is the currency-symbol cliché (13% of the top 500, FD12-F05)' },
  hexagon: { severity: 'flag', fix: 'hexagons are the generic crypto shape (FD12-F05)' },
  cube: { severity: 'flag', fix: 'isometric cubes are a generic crypto shape (FD12-F05)' },
  triangle: { severity: 'flag', fix: 'pyramids and triangles echo Ethereum (FD12-F05)' },
  'split-letters': { severity: 'flag', fix: 'letters split by horizontal gaps rehash ESPN 1985 (FD12-F05)' },
  'library-icon': { severity: 'flag', fix: 'a stock icon is not a mark (24 grid, 2-unit round strokes)' },
  mask: { severity: 'flag', fix: 'masks hide shapes; check the one-colour silhouette' },
  complex: { severity: 'flag', fix: 'keep a mark to a few primitives (FD12-F08)' },
  'off-grid': { severity: 'flag', fix: 'put straight edges on even units of a 32 grid so they land on pixels at 16 and 32 px (FD12-F16)' },
  'non-square': { severity: 'flag', fix: 'a favicon mark needs a square viewBox' },
  'banned-face': { severity: 'fail', fix: 'pick a face other than Inter, Space Grotesk or Instrument Serif (BR-04)' },
  clip: { severity: 'note', fix: 'clip paths are drawn; the static geometry ignores them' },
  'dark-rule': { severity: 'note', fix: '' },
});

const STRUCTURE_FAIL = /** @type {Record<string, string>} */ ({
  text: 'text', tspan: 'text', textPath: 'text', image: 'image', feImage: 'image', foreignObject: 'foreign-object',
  script: 'script', animate: 'animation', animateTransform: 'animation', animateMotion: 'animation', set: 'animation',
  animateColor: 'animation', linearGradient: 'gradient', radialGradient: 'gradient', meshgradient: 'gradient',
  meshGradient: 'gradient', mesh: 'gradient', pattern: 'pattern', filter: 'filter', iframe: 'script', video: 'image',
  audio: 'script', canvas: 'image',
});

/**
 * @param {string} id @param {string} detail @param {Partial<Finding>} [extra]
 * @returns {Finding}
 */
function finding(id, detail, extra = {}) {
  const rule = /** @type {Record<string, {severity: Severity}>} */ (LINT_RULES)[id];
  return { id, severity: rule ? rule.severity : 'note', detail, ...extra };
}

/**
 * @typedef {{kind?: 'mark' | 'wordmark', mode?: 'source' | 'shipped'}} LintOptions
 * @typedef {{findings: Finding[], geometry: Geometry | null, viewBox: Box | null, tree: XastRoot | null,
 *   inkBox: Box | null}} StaticLint
 */

/**
 * The static layer of the mark lint: structure, paint, geometry and shape heuristics, no browser.
 * @param {string} text
 * @param {LintOptions} [options]
 * @returns {StaticLint}
 */
export function lintSvgStatic(text, { kind = 'mark', mode = 'source' } = {}) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {XastRoot} */
  let tree;
  try {
    tree = parseSvgTree(text);
  } catch (err) {
    return { findings: [finding('svg.invalid', firstLine(err))], geometry: null, viewBox: null, tree: null, inkBox: null };
  }
  const svg = rootSvgElement(tree);
  if (!svg) return { findings: [finding('svg.invalid', 'no <svg> root element')], geometry: null, viewBox: null, tree, inkBox: null };
  structuralLint(tree, findings);
  let geometry;
  try {
    geometry = buildGeometry(tree);
  } catch (err) {
    findings.push(finding('svg.invalid', firstLine(err)));
    return { findings, geometry: null, viewBox: null, tree, inkBox: null };
  }
  const vb = geometry.viewBox;
  if (!vb) findings.push(finding('no-viewbox', 'the root <svg> has no usable viewBox, width or height'));
  const visible = geometry.elements.filter((e) => !e.hidden);
  const inkBox = unionBox(visible.map((e) => (e.hasStroke ? e.strokeBox : e.bbox)).filter((b) => b !== null).map((b) => /** @type {Box} */ (b)));
  geometryLint(geometry, findings, kind);
  if (kind === 'mark' && vb && inkBox) shapeHeuristics(geometry, inkBox, findings);
  if (kind === 'mark' && vb) gridLint(geometry, findings);
  if (mode === 'shipped') {
    const optimised = optimize(text, iconSvgoConfig()).data;
    if (optimised.trim() !== text.trim()) {
      findings.push(finding('svgo-unclean', `SVGO would still change this file (${Buffer.byteLength(text)} to ${Buffer.byteLength(optimised)} bytes)`));
    }
  }
  const dark = darkModeReport(tree);
  if (dark.present) {
    findings.push(finding('dark-rule', `dark-mode rule present (${dark.rules.length} rule(s), colours ${dark.colours.join(', ') || 'none parsed'})${dark.matched ? '' : ', but no selector matches an element'}`));
  }
  return { findings, geometry, viewBox: vb, tree, inkBox };
}

/** @param {XastRoot} tree @param {Finding[]} findings */
function structuralLint(tree, findings) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  /** @param {string} id @param {string} detail */
  const once = (id, detail) => {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    if (n === 1) findings.push(finding(id, detail));
  };
  for (const el of elementsOf(tree)) {
    const fail = STRUCTURE_FAIL[el.name];
    if (fail) once(fail, `<${el.name}> element (${labelOf(el)})`);
    if (el.name === 'mask') once('mask', `<mask> element (${labelOf(el)})`);
    for (const [name, value] of Object.entries(el.attributes)) {
      if (/NaN|Infinity/.test(value) && name !== 'id' && name !== 'class') once('nan', `${labelOf(el)} ${name} contains ${/NaN/.test(value) ? 'NaN' : 'Infinity'}`);
      if (/^on/i.test(name)) once('script', `event handler ${name} on ${labelOf(el)}`);
      if ((name === 'href' || name === 'xlink:href') && value.trim() && !value.trim().startsWith('#')) once('external-ref', `${labelOf(el)} ${name}="${value.slice(0, 60)}"`);
      if (name === 'filter' && value.trim() !== 'none') once('filter', `filter attribute on ${labelOf(el)}`);
      if (name === 'mask' && value.trim() !== 'none') once('mask', `mask attribute on ${labelOf(el)}`);
      if (name === 'clip-path' && value.trim() !== 'none') once('clip', `clip-path on ${labelOf(el)}`);
      if (name === 'style') styleTextLint(value, `${labelOf(el)} style`, once);
      if (/^(fill|stroke)$/.test(name) && /url\(/i.test(value)) paintRefLint(tree, value, labelOf(el), once);
    }
    if (el.name === 'style') {
      const css = textOf(el);
      styleTextLint(css, '<style>', once);
      for (const node of parseCss(css)) cssNodeLint(node, once);
    }
  }
}

/**
 * @param {XastRoot} tree @param {string} paint @param {string} where
 * @param {(id: string, detail: string) => void} once
 */
function paintRefLint(tree, paint, where, once) {
  const ref = /url\(\s*["']?#([^"')]+)["']?\s*\)/.exec(paint);
  if (!ref) {
    once('external-ref', `${where} paints with ${paint}`);
    return;
  }
  for (const el of elementsOf(tree)) {
    if (el.attributes.id !== ref[1]) continue;
    const id = STRUCTURE_FAIL[el.name];
    if (id === 'gradient' || id === 'pattern') once(id, `${where} paints with <${el.name}> #${ref[1]}`);
  }
}

/** @param {string} css @param {string} where @param {(id: string, detail: string) => void} once */
function styleTextLint(css, where, once) {
  if (/(?:linear|radial|conic|repeating-linear|repeating-radial)-gradient\s*\(/i.test(css)) once('gradient', `CSS gradient in ${where}`);
  if (/@import/i.test(css)) once('external-ref', `@import in ${where}`);
  for (const m of css.matchAll(/url\(\s*["']?([^"')]*)["']?\s*\)/gi)) {
    if (!m[1].startsWith('#')) once('external-ref', `url(${m[1].slice(0, 60)}) in ${where}`);
  }
  for (const d of parseDecls(css.includes('{') ? '' : css)) {
    if (d.prop === 'filter' && d.value !== 'none') once('filter', `filter in ${where}`);
    if ((d.prop === 'animation' || d.prop === 'animation-name' || d.prop === 'transition') && d.value !== 'none') once('animation', `${d.prop} in ${where}`);
    if (d.prop === 'mask' && d.value !== 'none') once('mask', `mask in ${where}`);
  }
}

/** @param {CssNode} node @param {(id: string, detail: string) => void} once */
function cssNodeLint(node, once) {
  if (node.type === 'at') {
    if (node.name === 'font-face') once('font-face', '@font-face in <style>');
    if (node.name === 'keyframes' || node.name === '-webkit-keyframes') once('animation', '@keyframes in <style>');
    for (const child of node.children ?? []) cssNodeLint(child, once);
    return;
  }
  for (const d of node.decls) {
    if (d.prop === 'filter' && d.value !== 'none') once('filter', `filter in rule ${node.selector}`);
    if ((d.prop === 'animation' || d.prop === 'animation-name' || d.prop === 'transition') && d.value !== 'none') once('animation', `${d.prop} in rule ${node.selector}`);
    if (d.prop === 'mask' && d.value !== 'none') once('mask', `mask in rule ${node.selector}`);
    if (/opacity$/.test(d.prop)) {
      const v = Number.parseFloat(d.value);
      if (v > 0 && v < 1) once('shading', `${d.prop}: ${d.value} in rule ${node.selector}`);
    }
  }
}

/** @param {Geometry} geometry @param {Finding[]} findings @param {'mark' | 'wordmark'} kind */
function geometryLint(geometry, findings, kind) {
  const vb = geometry.viewBox;
  const minSide = vb ? Math.min(vb.w, vb.h) : 0;
  const tolerance = vb ? minSide * 1e-4 : 0;
  /** @type {Map<string, GeoElement>} */
  const signatures = new Map();
  let painted = 0;
  for (const e of geometry.elements) {
    const where = `${e.label} (shape ${e.index + 1})`;
    if (e.pathError) findings.push(finding(e.pathError.startsWith('odd') ? 'path-error' : 'path-error', `${where}: ${e.pathError}`, { element: e.label }));
    if (e.transformError) findings.push(finding('path-error', `${where}: transform ${e.transformError}`, { element: e.label }));
    if (e.hidden) {
      findings.push(finding('hidden', `${where} is not drawn: ${e.hidden}`, { element: e.label }));
      continue;
    }
    painted += 1;
    for (const [what, value] of /** @type {[string, number][]} */ ([['opacity', e.opacity], ['fill-opacity', e.hasFill ? e.fillOpacity : 1], ['stroke-opacity', e.hasStroke ? e.strokeOpacity : 1]])) {
      if (value > 0 && value < 1) findings.push(finding('shading', `${where} has ${what} ${round(value, 3)}`, { element: e.label, value: round(value, 3) }));
    }
    if (e.masked) findings.push(finding('mask', `${where} is masked`, { element: e.label }));
    const zero = e.subpaths.length === 0 || (e.hasFill && !e.hasStroke && e.area <= (vb ? vb.w * vb.h * 1e-6 : 0)) || (e.bbox !== null && e.bbox.w === 0 && e.bbox.h === 0);
    if (zero) {
      findings.push(finding('zero-area', `${where} encloses no area`, { element: e.label }));
      continue;
    }
    if (kind === 'mark' && e.hasStroke && vb && e.strokeWidth < minSide / 16 - 1e-9) {
      findings.push(finding('thin-stroke', `${where} has a ${round(e.strokeWidth, 3)}-unit stroke, under viewBox/16 = ${round(minSide / 16, 3)}`, { element: e.label, value: round(e.strokeWidth, 3) }));
    }
    // A fill closes open subpaths itself (SVG 2 painting) and SVGO drops a Z only a fill would see, while an open
    // stroke-only path is a line; the defect is a filled shape whose outline skips the closing edge.
    if (e.hasFill && e.hasStroke) {
      for (const sp of e.subpaths) {
        const first = sp.points[0];
        const last = sp.points[sp.points.length - 1];
        if (!sp.closed && sp.points.length > 2 && Math.hypot(first[0] - last[0], first[1] - last[1]) > tolerance + 1e-9) {
          findings.push(finding('open-path', `${where} is filled and stroked, but a subpath is not closed: the fill closes it and the stroke skips the closing edge`, { element: e.label }));
          break;
        }
      }
    }
    const box = e.hasStroke ? e.strokeBox : e.bbox;
    if (vb && box && !e.masked && !e.clipped) {
      const out = Math.max(vb.x - box.x, vb.y - box.y, box.x + box.w - (vb.x + vb.w), box.y + box.h - (vb.y + vb.h));
      if (out > tolerance + 1e-6) {
        findings.push(finding('outside-viewbox', `${where} reaches ${round(out, 3)} units outside the viewBox`, { element: e.label, value: round(out, 3), where: box }));
      }
    }
    const signature = e.subpaths.map((sp) => sp.points.map(([x, y]) => `${round(x, 2)},${round(y, 2)}`).join(' ')).join('|');
    const twin = signatures.get(signature);
    if (twin) findings.push(finding('duplicate', `${where} repeats the geometry of ${twin.label} (shape ${twin.index + 1})`, { element: e.label }));
    else signatures.set(signature, e);
  }
  const drawsOtherwise = findings.some((f) => f.id === 'text' || f.id === 'image' || f.id === 'foreign-object');
  if (painted === 0 && !drawsOtherwise) findings.push(finding('empty', 'no visible shape: the mark draws nothing'));
  if (kind === 'mark' && painted > 8) findings.push(finding('complex', `${painted} painted shapes; a mark keeps to a few primitives`, { value: painted }));
  if (kind === 'mark' && vb) {
    const library = vb.w === 24 && vb.h === 24
      && geometry.elements.some((e) => e.hasStroke && Math.abs(e.strokeWidth - 2) < 0.01 && (e.linecap === 'round' || e.linejoin === 'round'));
    if (library) findings.push(finding('library-icon', 'a 24-unit viewBox with 2-unit round strokes reads as a stock icon set (Lucide, Feather, Tabler)'));
    if (Math.abs(vb.w - vb.h) > 1e-9) findings.push(finding('non-square', `the viewBox is ${round(vb.w)} x ${round(vb.h)}`));
  }
}

/**
 * Edges on the 32-unit grid: a horizontal or vertical straight edge must fall on an even unit of a 32 grid scaled
 * to the viewBox, so it lands on a pixel boundary at 16 and 32 px.
 * @param {Geometry} geometry @param {Finding[]} findings
 */
function gridLint(geometry, findings) {
  const vb = /** @type {Box} */ (geometry.viewBox);
  if (Math.abs(vb.w - 32) > 1e-9 || Math.abs(vb.h - 32) > 1e-9) {
    findings.push(finding('off-grid', `the viewBox is ${round(vb.w)} x ${round(vb.h)}, not 32 x 32: draw the favicon mark on a 32-unit grid`));
    return;
  }
  /** @type {string[]} */
  const off = [];
  /** @param {number} v */
  const onGrid = (v) => {
    const u = v - (Math.abs(v - vb.x) < Math.abs(v - vb.y) ? vb.x : vb.y);
    return Math.abs(u / 2 - Math.round(u / 2)) < 0.01;
  };
  for (const e of geometry.elements) {
    if (e.hidden) continue;
    for (const sp of e.subpaths) {
      const n = sp.points.length;
      for (let i = 0; i < n - (sp.closed || e.hasFill ? 0 : 1); i += 1) {
        if (i < sp.curve.length && sp.curve[i]) continue;
        const a = sp.points[i];
        const b = sp.points[(i + 1) % n];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1) continue;
        const offsets = e.hasStroke && !e.hasFill ? [-e.strokeWidth / 2, e.strokeWidth / 2] : [0];
        if (Math.abs(a[0] - b[0]) < 1e-6) {
          for (const d of offsets) if (!onGrid(a[0] + d)) off.push(`x=${round(a[0] + d, 2)}`);
        } else if (Math.abs(a[1] - b[1]) < 1e-6) {
          for (const d of offsets) if (!onGrid(a[1] + d)) off.push(`y=${round(a[1] + d, 2)}`);
        }
      }
    }
  }
  if (off.length > 0) {
    const unique = [...new Set(off)];
    findings.push(finding('off-grid', `${unique.length} straight edge position(s) off the even units of the 32 grid: ${unique.slice(0, 6).join(', ')}${unique.length > 6 ? ', ...' : ''}`, { value: unique.length }));
  }
}

/**
 * @typedef {{outer: Point[], holes: Point[][], element: GeoElement, poly: Point[], info: PolygonInfo, area: number,
 *   stroked: boolean, width: number}} Shape
 */

/**
 * Look-twice shapes [FD12-F05]: regular hexagons, isometric cubes, triangles and initials struck through by bars.
 * @param {Geometry} geometry @param {Box} inkBox @param {Finding[]} findings
 */
function shapeHeuristics(geometry, inkBox, findings) {
  const markSize = Math.max(inkBox.w, inkBox.h);
  const inkArea = Math.max(inkBox.w * inkBox.h, 1e-9);
  /** @type {Shape[]} */
  const shapes = [];
  /** @type {{a: Point, b: Point, width: number, element: GeoElement}[]} */
  const lines = [];
  for (const e of geometry.elements) {
    if (e.hidden) continue;
    if (e.hasFill) {
      const rings = e.subpaths.filter((sp) => sp.points.length >= 3).map((sp) => sp.points);
      const sorted = rings.map((r) => ({ r, a: Math.abs(polygonArea(r)) })).sort((x, y) => y.a - x.a);
      /** @type {{outer: Point[], holes: Point[][]}[]} */
      const groups = [];
      for (const { r } of sorted) {
        const host = groups.find((g) => r.every((p) => pointInPolygon(p, g.outer)));
        if (host) host.holes.push(r);
        else groups.push({ outer: r, holes: [] });
      }
      for (const g of groups) {
        const box = boxOf(g.outer);
        const eps = Math.max(0.02 * Math.hypot(box.w, box.h), markSize * 0.005);
        const poly = simplifyClosed(g.outer, eps);
        if (poly.length < 3) continue;
        const area = Math.abs(polygonArea(g.outer)) - g.holes.reduce((s, h) => s + Math.abs(polygonArea(h)), 0);
        shapes.push({ outer: g.outer, holes: g.holes, element: e, poly, info: polygonInfo(poly), area, stroked: false, width: 0 });
      }
    } else if (e.hasStroke) {
      for (const sp of e.subpaths) {
        if (sp.points.length < 2) continue;
        const box = boxOf(sp.points);
        const eps = Math.max(0.02 * Math.hypot(box.w, box.h), markSize * 0.005);
        if (sp.closed) {
          const poly = simplifyClosed(sp.points, eps);
          if (poly.length >= 3) shapes.push({ outer: sp.points, holes: [], element: e, poly, info: polygonInfo(poly), area: Math.abs(polygonArea(sp.points)), stroked: true, width: e.strokeWidth });
        } else {
          const simple = rdpOpen(sp.points, eps);
          if (simple.length === 2) lines.push({ a: simple[0], b: simple[1], width: e.strokeWidth, element: e });
        }
      }
    }
  }
  const hexagons = shapes.filter((s) => isRegularHexagon(s.info) && Math.max(s.info.box.w, s.info.box.h) >= 0.25 * markSize);
  if (hexagons.length > 0) {
    findings.push(finding('hexagon', `${hexagons.length} regular hexagon(s): ${hexagons.map((s) => s.element.label).join(', ')}`, { where: hexagons[0].info.box }));
  }
  const rhombi = shapes.filter((s) => isIsometricRhombus(s.info));
  const allVertices = [...shapes.flatMap((s) => s.poly), ...lines.flatMap((l) => [l.a, l.b])];
  const centred = hexagons.filter((h) => {
    const size = Math.max(h.info.box.w, h.info.box.h);
    return allVertices.some((p) => !h.poly.includes(p) && Math.hypot(p[0] - h.info.centroid[0], p[1] - h.info.centroid[1]) <= 0.12 * size);
  });
  if (rhombi.length >= 2 || centred.length > 0) {
    findings.push(finding('cube', rhombi.length >= 2 ? `${rhombi.length} isometric rhombi (60/120 degree faces)` : 'a hexagon outline with a vertex at its centre (cube edges)'));
  }
  const triangles = shapes.filter((s) => s.info.n === 3 && s.info.area >= 0.03 * inkArea);
  if (triangles.length > 0) findings.push(finding('triangle', `${triangles.length} triangle(s): ${[...new Set(triangles.map((s) => s.element.label))].join(', ')}`, { where: triangles[0].info.box }));
  const struck = struckInitial(shapes, lines, markSize, inkArea);
  if (struck) findings.push(finding('struck-initial', struck));
}

/** @param {PolygonInfo} info @returns {boolean} */
function isRegularHexagon(info) {
  if (info.n !== 6 || !info.convex) return false;
  const mean = info.sides.reduce((a, b) => a + b, 0) / 6;
  return info.sides.every((s) => Math.abs(s - mean) <= 0.2 * mean) && info.angles.every((a) => Math.abs(a - 120) <= 15);
}

/** @param {PolygonInfo} info @returns {boolean} */
function isIsometricRhombus(info) {
  if (info.n !== 4 || !info.convex) return false;
  const mean = info.sides.reduce((a, b) => a + b, 0) / 4;
  if (!info.sides.every((s) => Math.abs(s - mean) <= 0.15 * mean)) return false;
  const sorted = [...info.angles].sort((a, b) => a - b);
  return Math.abs(sorted[0] - 60) <= 12 && Math.abs(sorted[1] - 60) <= 12 && Math.abs(sorted[2] - 120) <= 12 && Math.abs(sorted[3] - 120) <= 12;
}

/**
 * A bar (a long thin quadrilateral or a straight stroked line) that crosses a letter-like body and protrudes past it
 * or spans it: the currency-symbol pattern of struck initials.
 * @param {Shape[]} shapes
 * @param {{a: Point, b: Point, width: number, element: GeoElement}[]} lines
 * @param {number} markSize @param {number} inkArea
 * @returns {string | null}
 */
function struckInitial(shapes, lines, markSize, inkArea) {
  /** @type {{a: Point, b: Point, label: string, shape: Shape | null}[]} */
  const bars = [];
  for (const s of shapes) {
    if (s.info.n !== 4 || !s.info.convex || s.holes.length > 0) continue;
    const longest = Math.max(...s.info.sides);
    const thickness = s.info.area / longest;
    if (longest / Math.max(thickness, 1e-9) < 3 || thickness > 0.25 * markSize) continue;
    const i = s.info.sides.indexOf(longest);
    const p = s.poly;
    const n = p.length;
    const shortA = [p[(i + 1) % n], p[(i + 2) % n]];
    const shortB = [p[(i + 3) % n], p[i]];
    bars.push({
      a: [(shortA[0][0] + shortA[1][0]) / 2, (shortA[0][1] + shortA[1][1]) / 2],
      b: [(shortB[0][0] + shortB[1][0]) / 2, (shortB[0][1] + shortB[1][1]) / 2],
      label: s.element.label,
      shape: s,
    });
  }
  for (const l of lines) {
    const len = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
    if (len >= 0.25 * markSize && len / Math.max(l.width, 1e-9) >= 3) bars.push({ a: l.a, b: l.b, label: l.element.label, shape: null });
  }
  const bodies = shapes.filter((s) => !bars.some((b) => b.shape === s) && (s.holes.length > 0 || s.area >= 0.06 * inkArea));
  for (const bar of bars) {
    for (const body of bodies) {
      if (bar.shape && body.element === bar.shape.element && body === bar.shape) continue;
      const box = body.info.box;
      const inset = { x: box.x + box.w * 0.05, y: box.y + box.h * 0.05, w: box.w * 0.9, h: box.h * 0.9 };
      let inside = false;
      for (let k = 0; k <= 40; k += 1) {
        const t = k / 40;
        const px = bar.a[0] + (bar.b[0] - bar.a[0]) * t;
        const py = bar.a[1] + (bar.b[1] - bar.a[1]) * t;
        if (px > inset.x && px < inset.x + inset.w && py > inset.y && py < inset.y + inset.h) {
          inside = true;
          break;
        }
      }
      if (!inside) continue;
      const margin = 0.06 * markSize;
      /** @param {Point} p */
      const outside = (p) => p[0] < box.x - margin || p[0] > box.x + box.w + margin || p[1] < box.y - margin || p[1] > box.y + box.h + margin;
      if (outside(bar.a) || outside(bar.b)) return `${bar.label} crosses ${body.element.label} and runs past it, like a currency symbol`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Raster analysis (binary masks from Chromium renders)

const EDT_INF = 1e20;

/**
 * One-dimensional squared distance transform of sampled function f (Felzenszwalb and Huttenlocher, 2012).
 * @param {Float64Array} f @param {number} n @param {Float64Array} d @param {Int32Array} v @param {Float64Array} z
 */
function distance1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -EDT_INF;
  z[1] = EDT_INF;
  for (let q = 1; q < n; q += 1) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = EDT_INF;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * Squared Euclidean distance from every pixel to the nearest seed pixel (exact, linear time).
 * @param {Uint8Array} seeds @param {number} w @param {number} h
 * @returns {Float64Array}
 */
export function squaredDistance(seeds, w, h) {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < grid.length; i += 1) grid[i] = seeds[i] ? 0 : EDT_INF;
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) f[y] = grid[y * w + x];
    distance1d(f, h, d, v, z);
    for (let y = 0; y < h; y += 1) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) f[x] = grid[y * w + x];
    distance1d(f, w, d, v, z);
    for (let x = 0; x < w; x += 1) grid[y * w + x] = d[x];
  }
  return grid;
}

/**
 * Erosion or dilation of a binary mask by a Euclidean disk of `radius` pixels; outside the mask counts as empty.
 * @param {Uint8Array} mask @param {number} w @param {number} h @param {number} radius
 * @param {'erode' | 'dilate'} op
 * @returns {Uint8Array}
 */
export function morph(mask, w, h, radius, op) {
  const r2 = radius * radius;
  const out = new Uint8Array(w * h);
  if (op === 'dilate') {
    const dist = squaredDistance(mask, w, h);
    for (let i = 0; i < out.length; i += 1) out[i] = dist[i] <= r2 ? 1 : 0;
    return out;
  }
  const pad = Math.ceil(radius) + 1;
  const pw = w + 2 * pad;
  const ph = h + 2 * pad;
  const background = new Uint8Array(pw * ph).fill(1);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) background[(y + pad) * pw + x + pad] = mask[y * w + x] ? 0 : 1;
  const dist = squaredDistance(background, pw, ph);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) out[y * w + x] = mask[y * w + x] && dist[(y + pad) * pw + x + pad] > r2 ? 1 : 0;
  return out;
}

/**
 * Connected components (8-neighbour) of a binary mask.
 * @param {Uint8Array} mask @param {number} w @param {number} h
 * @returns {{area: number, box: Box}[]}
 */
export function components(mask, w, h) {
  const seen = new Uint8Array(w * h);
  /** @type {{area: number, box: Box}[]} */
  const out = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let area = 0;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    while (top > 0) {
      const i = stack[--top];
      area += 1;
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (mask[j] && !seen[j]) {
            seen[j] = 1;
            stack[top++] = j;
          }
        }
      }
    }
    out.push({ area, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } });
  }
  return out;
}

/**
 * Thin parts and narrow gaps of a binary mask: what a morphological opening removes (parts thinner than the
 * structuring disk) and what a closing adds (gaps and counters narrower than it). Sizes are in mask pixels.
 * @param {Uint8Array} mask @param {number} w @param {number} h
 * @param {{radius: number, minArea: number, minExtent: number, withGaps?: boolean}} limits
 * @returns {{thin: {area: number, box: Box}[], gaps: {area: number, box: Box}[]}}
 */
export function thinAndGaps(mask, w, h, { radius, minArea, minExtent, withGaps = true }) {
  const opened = morph(morph(mask, w, h, radius, 'erode'), w, h, radius, 'dilate');
  const removed = new Uint8Array(w * h);
  for (let i = 0; i < removed.length; i += 1) removed[i] = mask[i] && !opened[i] ? 1 : 0;
  /** @param {{area: number, box: Box}} c */
  const significant = (c) => c.area >= minArea && Math.max(c.box.w, c.box.h) >= minExtent;
  if (!withGaps) return { thin: components(removed, w, h).filter(significant), gaps: [] };
  const pad = Math.ceil(radius) + 2;
  const pw = w + 2 * pad;
  const ph = h + 2 * pad;
  const padded = new Uint8Array(pw * ph);
  for (let y = 0; y < h; y += 1) padded.set(mask.subarray(y * w, y * w + w), (y + pad) * pw + pad);
  const dilated = morph(padded, pw, ph, radius, 'dilate');
  const closed = morph(dilated, pw, ph, radius, 'erode');
  const added = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) added[y * w + x] = closed[(y + pad) * pw + x + pad] && !mask[y * w + x] ? 1 : 0;
  }
  return { thin: components(removed, w, h).filter(significant), gaps: components(added, w, h).filter(significant) };
}

/**
 * Splits a render into its main colours (each at least 1% of the opaque pixels, at most six), giving every pixel
 * that is at least half opaque to the nearest main colour. A mark on a solid tile has all its features inside the
 * tile's alpha, so thin features show only per colour. Returns nothing for a one-colour render.
 * @param {Buffer} rgba @param {number} w @param {number} h
 * @returns {{rgb: number[], share: number, mask: Uint8Array}[]}
 */
export function colourLayers(rgba, w, h) {
  /** @type {Map<number, number>} */
  const counts = new Map();
  let opaque = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 250) continue;
    opaque += 1;
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const main = [...counts].filter(([, n]) => n >= 0.01 * opaque).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([key, n]) => ({ rgb: [(key >> 16) & 255, (key >> 8) & 255, key & 255], share: round(n / opaque, 3) }));
  if (main.length < 2) return [];
  const masks = main.map(() => new Uint8Array(w * h));
  for (let p = 0; p < w * h; p += 1) {
    const i = p * 4;
    if (rgba[i + 3] < 128) continue;
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < main.length; k += 1) {
      const d = channelDistance(main[k].rgb, [rgba[i], rgba[i + 1], rgba[i + 2]]);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    masks[best][p] = 1;
  }
  return main.map((m, k) => ({ ...m, mask: masks[k] }));
}

/** @param {Box} a @param {Box} b @returns {number} */
function overlapShare(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (x * y) / Math.max(1e-9, Math.min(a.w * a.h, b.w * b.h));
}

/**
 * Horizontal slits: empty bands bounded by ink above and below, between `minGap` and `maxGap` pixels tall, spanning
 * at least `minWidth` columns. Returns the bands found.
 * @param {Uint8Array} mask @param {number} w @param {number} h
 * @param {{minGap: number, maxGap: number, minWidth: number, tolerance: number}} limits
 * @returns {{y0: number, y1: number, columns: number}[]}
 */
export function horizontalSlits(mask, w, h, { minGap, maxGap, minWidth, tolerance }) {
  /** @type {{x: number, y0: number, y1: number}[]} */
  const runs = [];
  for (let x = 0; x < w; x += 1) {
    let lastInk = -1;
    for (let y = 0; y < h; y += 1) {
      if (!mask[y * w + x]) continue;
      const gap = y - lastInk - 1;
      if (lastInk >= 0 && gap >= minGap && gap <= maxGap) runs.push({ x, y0: lastInk + 1, y1: y - 1 });
      lastInk = y;
    }
  }
  /** @type {{y0: number, y1: number, xs: Set<number>}[]} */
  const bands = [];
  for (const r of runs) {
    const band = bands.find((b) => Math.abs(b.y0 - r.y0) <= tolerance && Math.abs(b.y1 - r.y1) <= tolerance);
    if (band) band.xs.add(r.x);
    else bands.push({ y0: r.y0, y1: r.y1, xs: new Set([r.x]) });
  }
  return bands.filter((b) => b.xs.size >= minWidth).map((b) => ({ y0: b.y0, y1: b.y1, columns: b.xs.size }));
}

/**
 * @typedef {{inkPx: number, solidPx: number, solidShare: number, inkArea: number, box: Box | null}} InkStats
 */

/**
 * Inked pixels (alpha > 0), solid pixels (alpha 255) and the solid share: the share of inked pixels that are fully
 * opaque [FD12-F16]. Round and diagonal marks score lower without being illegible, so it is a review value.
 * @param {Uint8Array | Buffer} rgba @param {number} w @param {number} h
 * @returns {InkStats}
 */
export function inkStats(rgba, w, h) {
  let ink = 0;
  let solid = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const a = rgba[(y * w + x) * 4 + 3];
      if (a === 0) continue;
      ink += 1;
      if (a === 255) solid += 1;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return {
    inkPx: ink,
    solidPx: solid,
    solidShare: ink ? round(solid / ink, 3) : 0,
    inkArea: round(ink / (w * h), 4),
    box: ink ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null,
  };
}

/**
 * The largest distance of an inked pixel from the image centre, as the W3C safe-zone check measures it [FD12-F23].
 * @param {Uint8Array | Buffer} rgba @param {number} w @param {number} h
 * @param {(i: number) => boolean} [isInk] index of the pixel's first byte -> inked
 * @returns {number}
 */
export function maxInkRadius(rgba, w, h, isInk = (i) => rgba[i + 3] > 0) {
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  let r = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (isInk((y * w + x) * 4)) r = Math.max(r, Math.hypot(x - cx, y - cy));
    }
  }
  return round(r, 1);
}

/**
 * The most frequent fully opaque colour among the pixels `select` keeps.
 * @param {Uint8Array | Buffer} rgba @param {(i: number) => boolean} [select]
 * @returns {{rgb: number[], count: number} | null}
 */
export function dominantColour(rgba, select = (i) => rgba[i + 3] === 255) {
  /** @type {Map<number, number>} */
  const counts = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    if (!select(i)) continue;
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = -1;
  let count = 0;
  for (const [key, n] of counts) {
    if (n > count) {
      best = key;
      count = n;
    }
  }
  return best < 0 ? null : { rgb: [(best >> 16) & 255, (best >> 8) & 255, best & 255], count };
}

// ---------------------------------------------------------------------------------------------------------------
// Rendering with the skill's Chromium

/**
 * Gives the root element explicit pixel dimensions so Chromium rasterises the vector at the target size.
 * @param {string} text @param {number} width @param {number} height
 * @returns {string}
 */
export function sizedSvg(text, width, height) {
  return rewriteSvg(text, (root) => {
    const svg = rootSvgElement(root);
    if (!svg) throw new UsageError('the file has no <svg> root element');
    const vb = viewBoxOf(svg);
    if (vb && !svg.attributes.viewBox) svg.attributes.viewBox = `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
    svg.attributes.width = String(width);
    svg.attributes.height = String(height);
  });
}

/** @param {string} svg @returns {string} */
export function svgDataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/**
 * @typedef {{uri: string, x: number, y: number, w: number, h: number, rw?: number, rh?: number, tint?: string,
 *   smooth?: boolean, name?: string}} Layer
 * @typedef {{width: number, height: number, ground?: string | null, layers: Layer[], want?: 'png' | 'rgba' | 'both'}} ComposeSpec
 * @typedef {{width: number, height: number, png: Buffer | null, rgba: Buffer | null}} ComposeResult
 */

/**
 * Runs inside the page: draws the layers into a canvas and returns PNG and/or RGBA as base64.
 * @param {ComposeSpec} spec
 * @returns {Promise<{png: string | null, rgba: string | null, error: string | null}>}
 */
const composeInPage = async (spec) => {
  /** @param {Uint8ClampedArray} bytes */
  const toBase64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    return btoa(s);
  };
  const canvas = document.createElement('canvas');
  canvas.width = spec.width;
  canvas.height = spec.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return { png: null, rgba: null, error: 'no 2d canvas context' };
  if (spec.ground) {
    g.fillStyle = spec.ground;
    g.fillRect(0, 0, spec.width, spec.height);
  }
  for (const layer of spec.layers) {
    const img = new Image();
    img.src = layer.uri;
    try {
      await img.decode();
    } catch {
      return { png: null, rgba: null, error: `layer ${layer.name ?? ''} does not render as an image` };
    }
    /** @type {CanvasImageSource} */
    let source = img;
    const rw = layer.rw ?? layer.w;
    const rh = layer.rh ?? layer.h;
    if (layer.tint || rw !== layer.w || rh !== layer.h) {
      const t = document.createElement('canvas');
      t.width = rw;
      t.height = rh;
      const tg = t.getContext('2d');
      if (!tg) return { png: null, rgba: null, error: 'no 2d canvas context' };
      tg.drawImage(img, 0, 0, rw, rh);
      if (layer.tint) {
        tg.globalCompositeOperation = 'source-in';
        tg.fillStyle = layer.tint;
        tg.fillRect(0, 0, rw, rh);
      }
      source = t;
    }
    g.imageSmoothingEnabled = layer.smooth !== false;
    g.drawImage(source, layer.x, layer.y, layer.w, layer.h);
  }
  return {
    png: spec.want === 'rgba' ? null : canvas.toDataURL('image/png').slice('data:image/png;base64,'.length),
    rgba: spec.want === 'png' ? null : toBase64(g.getImageData(0, 0, spec.width, spec.height).data),
    error: null,
  };
};

/**
 * One Chromium page for drawing SVGs into canvases. Requests other than data: URIs are aborted.
 */
export class Renderer {
  /**
   * @param {Browser} browser @param {BrowserContext} context @param {Page} page @param {boolean} ownsBrowser
   */
  constructor(browser, context, page, ownsBrowser) {
    this.browser = browser;
    this.context = context;
    this.page = page;
    this.ownsBrowser = ownsBrowser;
    /** @type {'light' | 'dark'} */
    this.scheme = 'light';
  }

  /**
   * @param {{browser?: Browser | null}} [options]
   * @returns {Promise<Renderer>}
   */
  static async open({ browser = null } = {}) {
    const own = !browser;
    const b = browser ?? (await launchBrowser());
    try {
      const context = await b.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1, colorScheme: 'light', locale: 'en-US', timezoneId: 'UTC' });
      await context.route('**/*', (route) => route.abort());
      const page = await context.newPage();
      await page.setContent('<!doctype html><html><head><meta charset="utf-8"><title>render</title></head><body></body></html>');
      return new Renderer(b, context, page, own);
    } catch (err) {
      if (own) await b.close();
      throw err;
    }
  }

  /** @param {'light' | 'dark'} scheme */
  async setScheme(scheme) {
    if (scheme === this.scheme) return;
    await this.page.emulateMedia({ colorScheme: scheme });
    this.scheme = scheme;
  }

  /**
   * @param {ComposeSpec} spec
   * @param {{scheme?: 'light' | 'dark'}} [options]
   * @returns {Promise<ComposeResult>}
   */
  async compose(spec, { scheme = 'light' } = {}) {
    await this.setScheme(scheme);
    const result = await this.page.evaluate(composeInPage, { ...spec, want: spec.want ?? 'both' });
    if (result.error) throw new CheckError(`render failed: ${result.error}; check that the SVG is well formed and self-contained`);
    return {
      width: spec.width,
      height: spec.height,
      png: result.png ? Buffer.from(result.png, 'base64') : null,
      rgba: result.rgba ? Buffer.from(result.rgba, 'base64') : null,
    };
  }

  /**
   * Draws an SVG at `size` x `size` (fitted and centred when its viewBox is not square), transparent unless a
   * ground is given, optionally tinted to one colour (a silhouette) or enlarged with nearest-neighbour sampling.
   * @param {string} svg
   * @param {number} size
   * @param {{scheme?: 'light' | 'dark', ground?: string | null, tint?: string, zoom?: number, want?: 'png' | 'rgba' | 'both', inner?: number}} [options]
   * @returns {Promise<ComposeResult>}
   */
  async renderSquare(svg, size, { scheme = 'light', ground = null, tint, zoom = 1, want = 'both', inner } = {}) {
    const box = inner ?? size;
    const { w, h } = fitSize(svg, box, box);
    const uri = svgDataUri(sizedSvg(svg, w, h));
    const offset = (size - box) / 2;
    /** @type {Layer} */
    const layer = {
      uri,
      rw: w,
      rh: h,
      x: (offset + (box - w) / 2) * zoom,
      y: (offset + (box - h) / 2) * zoom,
      w: w * zoom,
      h: h * zoom,
      tint,
      smooth: zoom === 1,
    };
    return this.compose({ width: size * zoom, height: size * zoom, ground, layers: [layer], want }, { scheme });
  }

  async close() {
    try {
      await this.context.close();
    } finally {
      if (this.ownsBrowser) await this.browser.close();
    }
  }
}

/**
 * The integer size an SVG takes when fitted into a box with its aspect ratio kept.
 * @param {string} svg @param {number} boxW @param {number} boxH
 * @returns {{w: number, h: number}}
 */
function fitSize(svg, boxW, boxH) {
  const root = rootSvgElement(parseSvgTree(svg));
  const vb = root ? viewBoxOf(root) : null;
  if (!vb) return { w: boxW, h: boxH };
  const scale = Math.min(boxW / vb.w, boxH / vb.h);
  return { w: Math.max(1, Math.round(vb.w * scale)), h: Math.max(1, Math.round(vb.h * scale)) };
}

/** @param {Buffer} rgba @param {number} threshold @returns {Uint8Array} */
function alphaMask(rgba, threshold = 128) {
  const mask = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < mask.length; i += 1) mask[i] = rgba[i * 4 + 3] >= threshold ? 1 : 0;
  return mask;
}

/**
 * The raster layer of the mark lint, drawn by Chromium at 8 px per unit of a 32 grid (256 px for the long side):
 * parts thinner and gaps narrower than viewBox/16, letters split by thin horizontal slits, and elements that
 * contribute no pixel (covered by later shapes or invisible) [FD12-F11, F16].
 * @param {Renderer} renderer
 * @param {string} text
 * @param {StaticLint} lint
 * @param {{kind?: 'mark' | 'wordmark'}} [options]
 * @returns {Promise<Finding[]>}
 */
export async function lintSvgRaster(renderer, text, lint, { kind = 'mark' } = {}) {
  /** @type {Finding[]} */
  const findings = [];
  const vb = lint.viewBox;
  if (!vb || !lint.geometry || !lint.tree) return findings;
  const long = 256;
  const k = long / Math.max(vb.w, vb.h);
  const w = Math.max(1, Math.round(vb.w * k));
  const h = Math.max(1, Math.round(vb.h * k));
  const full = await renderer.compose({ width: w, height: h, layers: [{ uri: svgDataUri(sizedSvg(text, w, h)), x: 0, y: 0, w, h }], want: 'rgba' });
  const rgba = /** @type {Buffer} */ (full.rgba);
  const mask = alphaMask(rgba);
  if (!mask.some((v) => v === 1)) {
    if (!lint.findings.some((f) => f.id === 'empty')) findings.push(finding('empty', 'the render is empty: no pixel is at least half opaque'));
    return findings;
  }
  if (kind === 'mark') {
    const unit = Math.min(vb.w, vb.h) / 32;
    const px = unit * k;
    const { thin, gaps } = thinAndGaps(mask, w, h, { radius: 0.9 * px, minArea: 2 * px * px, minExtent: 1.5 * px });
    /** @param {{area: number, box: Box}} c @returns {Box} */
    const toUnits = (c) => ({ x: round(vb.x + c.box.x / k, 2), y: round(vb.y + c.box.y / k, 2), w: round(c.box.w / k, 2), h: round(c.box.h / k, 2) });
    for (const c of thin) {
      const where = toUnits(c);
      findings.push(finding('thin-part', `a part thinner than viewBox/16 near x=${where.x} y=${where.y} (${where.w} x ${where.h} units)`, { where, value: round(c.area / (px * px), 2) }));
    }
    for (const c of gaps) {
      const where = toUnits(c);
      findings.push(finding('narrow-gap', `a gap or counter narrower than viewBox/16 near x=${where.x} y=${where.y} (${where.w} x ${where.h} units)`, { where, value: round(c.area / (px * px), 2) }));
    }
    for (const layer of colourLayers(rgba, w, h)) {
      const { thin: thinInColour } = thinAndGaps(layer.mask, w, h, { radius: 0.9 * px, minArea: 2 * px * px, minExtent: 1.5 * px, withGaps: false });
      for (const c of thinInColour) {
        const where = toUnits(c);
        if (findings.some((f) => f.id === 'thin-part' && f.where && overlapShare(f.where, where) > 0.5)) continue;
        findings.push(finding('thin-part', `a ${hexOf(layer.rgb)} part thinner than viewBox/16 near x=${where.x} y=${where.y} (${where.w} x ${where.h} units); at 16 px it blurs into its neighbours`, { where, value: round(c.area / (px * px), 2) }));
      }
    }
    const ink = inkStats(rgba, w, h).box;
    if (ink) {
      const slits = horizontalSlits(mask, w, h, { minGap: Math.round(2 * px), maxGap: Math.round(3.5 * px), minWidth: Math.round(0.4 * ink.w), tolerance: Math.round(0.5 * px) });
      if (slits.length >= 2) findings.push(finding('split-letters', `${slits.length} thin horizontal slits cut across the mark`, { value: slits.length }));
    }
  }
  const candidates = lint.geometry.elements.filter((e) => !e.hidden && !e.viaUse && e.order >= 0);
  for (const e of candidates) {
    const variant = rewriteSvg(text, (root) => {
      let n = 0;
      for (const el of elementsOf(root)) {
        if (n === e.order) {
          el.attributes.display = 'none';
          el.attributes.style = `${el.attributes.style ? `${el.attributes.style};` : ''}display:none`;
          break;
        }
        n += 1;
      }
    });
    const other = await renderer.compose({ width: w, height: h, layers: [{ uri: svgDataUri(sizedSvg(variant, w, h)), x: 0, y: 0, w, h }], want: 'rgba' });
    const b = /** @type {Buffer} */ (other.rgba);
    let changed = 0;
    for (let i = 0; i < b.length; i += 1) if (Math.abs(b[i] - rgba[i]) > 2) changed += 1;
    if (changed === 0) findings.push(finding('occluded', `${e.label} (shape ${e.index + 1}) adds no visible pixel: later shapes cover it or it falls outside the canvas`, { element: e.label }));
  }
  return findings;
}

/**
 * @typedef {{file: string | null, kind: 'mark' | 'wordmark', mode: 'source' | 'shipped', ok: boolean, findings: Finding[],
 *   fails: string[], flags: string[], unexplained: string[], reasons: Record<string, string>, raster: boolean,
 *   viewBox: Box | null}} LintReport
 */

/**
 * The full mark lint: static layer, then the raster layer when a renderer is given. `reasons` maps a flag id to the
 * written reason that lets it pass (`flag_reasons` of candidate.json).
 * @param {string} text
 * @param {{renderer?: Renderer | null, kind?: 'mark' | 'wordmark', mode?: 'source' | 'shipped', reasons?: Record<string, string>, file?: string | null, font?: string | null}} [options]
 * @returns {Promise<LintReport>}
 */
export async function lintMark(text, { renderer = null, kind = 'mark', mode = 'source', reasons = {}, file = null, font = null } = {}) {
  const lint = lintSvgStatic(text, { kind, mode });
  const findings = [...lint.findings];
  if (renderer && lint.geometry) findings.push(...(await lintSvgRaster(renderer, text, lint, { kind })));
  if (font && isBannedFace(font)) findings.push(finding('banned-face', `the wordmark face "${font}" is on the owner's banned list`));
  const fails = [...new Set(findings.filter((f) => f.severity === 'fail').map((f) => f.id))];
  const flags = [...new Set(findings.filter((f) => f.severity === 'flag').map((f) => f.id))];
  const unexplained = flags.filter((id) => typeof reasons[id] !== 'string' || reasons[id].trim() === '');
  return { file, kind, mode, ok: fails.length === 0 && unexplained.length === 0, findings, fails, flags, unexplained, reasons, raster: Boolean(renderer && lint.geometry), viewBox: lint.viewBox };
}

/** @param {string} family @returns {boolean} */
export function isBannedFace(family) {
  const name = path.basename(String(family)).replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[-_]+/g, ' ').trim();
  return BANNED_WORDMARK_FACES.some((banned) => new RegExp(`^${banned.replace(/ /g, '\\s*')}(?![a-z])`, 'i').test(name));
}

// ---------------------------------------------------------------------------------------------------------------
// Wordmark

/**
 * @typedef {{family: string, subfamily: string, fullName: string, weightClass: number | null, version: string,
 *   designer: string, manufacturer: string, license: string, licenseURL: string, variable: string[]}} FontNames
 */

/** @param {any} font @returns {FontNames} */
function fontNames(font) {
  /** @param {string} key @returns {string} */
  const pick = (key) => {
    for (const table of [font.names?.windows, font.names?.macintosh, font.names?.unicode, font.names]) {
      const entry = table?.[key];
      if (entry && typeof entry === 'object') {
        const value = entry.en ?? Object.values(entry)[0];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    }
    return '';
  };
  return {
    family: pick('preferredFamily') || pick('fontFamily'),
    subfamily: pick('preferredSubfamily') || pick('fontSubfamily'),
    fullName: pick('fullName'),
    weightClass: typeof font.tables?.os2?.usWeightClass === 'number' ? font.tables.os2.usWeightClass : null,
    version: pick('version'),
    designer: pick('designer'),
    manufacturer: pick('manufacturer'),
    license: pick('license'),
    licenseURL: pick('licenseURL'),
    variable: Array.isArray(font.tables?.fvar?.axes) ? font.tables.fvar.axes.map((/** @type {any} */ a) => `${a.tag} ${a.minValue}-${a.maxValue}`) : [],
  };
}

/**
 * Finds the licence file next to a font and reads its kind and Reserved Font Names [FD12-F14, FD16-F30].
 * @param {string} fontFile
 * @returns {{file: string | null, kind: string, reservedFontNames: string[]}}
 */
export function fontLicence(fontFile) {
  const dir = path.dirname(path.resolve(fontFile));
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return { file: null, kind: 'unknown', reservedFontNames: [] };
  }
  const candidate = names.find((n) => /^(ofl|license|licence|copying)(\.(txt|md))?$/i.test(n)) ?? names.find((n) => /^(ofl|license|licence)[-_.]/i.test(n));
  if (!candidate) return { file: null, kind: 'unknown', reservedFontNames: [] };
  const file = path.join(dir, candidate);
  const text = readFileSync(file, 'utf8');
  const kind = /SIL OPEN FONT LICENSE/i.test(text) ? 'OFL-1.1'
    : /Apache License/i.test(text) ? 'Apache-2.0'
      : /UBUNTU FONT LICEN[CS]E/i.test(text) ? 'UFL-1.0'
        : /\bMIT License\b|Permission is hereby granted, free of charge/i.test(text) ? 'MIT' : 'unknown';
  const reserved = [...text.matchAll(/Reserved Font Names?\s+"([^"]+)"/gi)].map((m) => m[1]);
  return { file: toPosix(file), kind, reservedFontNames: [...new Set(reserved)] };
}

/**
 * @typedef {{text: string, fontFile: string, size?: number, kerning?: boolean, tracking?: number, fill?: string,
 *   title?: string, variation?: Record<string, number>, decimalPlaces?: number}} WordmarkOptions
 * @typedef {{svg: string, meta: Record<string, unknown>}} WordmarkResult
 */

/**
 * Outlines a name from a font file with opentype.js 2.0.0: `getPath(...).toPathData({flipY: false})` (the default
 * flipY mirrors the glyphs or writes NaN [FD12-F15]), checked against the glyph commands, with no `<text>` left.
 * When the font's shaping tables trip opentype.js, glyphs are laid out one by one (cmap, advances, kerning).
 * @param {WordmarkOptions} options
 * @returns {WordmarkResult}
 */
export function outlineWordmark({ text, fontFile, size = 100, kerning = true, tracking = 0, fill = 'currentColor', title, variation, decimalPlaces = 2 }) {
  if (typeof text !== 'string' || text.trim() === '') throw new UsageError('--text needs the name to outline');
  const bytes = readBinary(fontFile, 'font file');
  if (/\.woff2$/i.test(fontFile) || bytes.subarray(0, 4).toString('latin1') === 'wOF2') {
    throw new UsageError('WOFF2 is not readable by opentype.js 2.0.0; pass the TTF or OTF of the face');
  }
  /** @type {any} */
  let font;
  try {
    font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } catch (err) {
    throw new UsageError(`${toPosix(fontFile)} is not a font opentype.js can read (${firstLine(err)})`, { cause: err });
  }
  const chars = Array.from(text);
  const missing = chars.filter((ch) => ch.trim() !== '' && font.charToGlyphIndex(ch) === 0);
  if (missing.length > 0) throw new UsageError(`the font has no glyph for ${[...new Set(missing)].map((c) => JSON.stringify(c)).join(', ')}; pick a face that covers the name`);
  const names = fontNames(font);
  /** @type {string[]} */
  const warnings = [];
  if (names.variable.length > 0) {
    warnings.push(`variable font (${names.variable.join(', ')}): opentype.js varies the outlines but keeps default advance widths; prefer a static instance (BR-05)`);
  }
  if (isBannedFace(names.family)) warnings.push(`"${names.family}" is on the owner's banned list for the wordmark (BR-04)`);
  const options = { kerning, letterSpacing: tracking / 1000, drawLayers: false, drawSVG: false, ...(variation ? { variation } : {}) };
  let layout = 'opentype getPath';
  /** @type {any} */
  let glyphPath;
  try {
    glyphPath = font.getPath(text, 0, 0, size, options);
  } catch (err) {
    layout = `per-glyph (opentype.js shaping failed: ${firstLine(err)})`;
    warnings.push(`shaping skipped: ${firstLine(err)}; ligatures and contextual forms are not applied`);
    glyphPath = perGlyphPath(font, chars, size, options);
  }
  const d = glyphPath.toPathData({ decimalPlaces, flipY: false });
  if (/NaN|Infinity/.test(d)) throw new CheckError('the outlined path contains NaN or Infinity; the font or opentype.js produced broken outlines');
  if (!d.trim()) throw new CheckError('the outlined path is empty; the name has no drawable glyph in this font');
  verifyOutline(glyphPath, d, decimalPlaces);
  const bb = glyphPath.getBoundingBox();
  const pad = Math.max(1, size * 0.04);
  const viewBox = [Math.floor(bb.x1 - pad), Math.floor(bb.y1 - pad), Math.ceil(bb.x2 - bb.x1 + 2 * pad), Math.ceil(bb.y2 - bb.y1 + 2 * pad)];
  const titleText = escapeHtml(title ?? text);
  const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(' ')}"><title>${titleText}</title><path fill="${escapeHtml(fill)}" d="${d}"/></svg>`;
  const svg = optimize(raw, iconSvgoConfig()).data;
  if (/<text[\s>]/.test(svg)) throw new CheckError('the wordmark SVG still contains <text>');
  const licence = fontLicence(fontFile);
  const nameTableKind = /SIL Open Font License|\bOFL\b/i.test(names.license) ? 'OFL-1.1'
    : /Apache License/i.test(names.license) ? 'Apache-2.0' : /Ubuntu Font Licen[cs]e/i.test(names.license) ? 'UFL-1.0' : 'unknown';
  if (licence.kind === 'unknown' && nameTableKind === 'unknown') {
    warnings.push(`no open licence found: no OFL.txt or LICENSE next to the font, and its name table says "${names.license.slice(0, 120) || 'nothing'}"; use an OFL, Apache, UFL or MIT face and keep its licence file (BR-04)`);
  } else if (licence.kind === 'unknown') {
    warnings.push(`the name table says ${nameTableKind}, but no licence file sits next to the font; copy it into brand/ (BR-04)`);
  }
  if (licence.reservedFontNames.length > 0) {
    warnings.push(`Reserved Font Name(s) ${licence.reservedFontNames.join(', ')}: outlining for a logo is fine (OFL-FAQ 1.1), but a modified or subset font file must be renamed (FD16-F30)`);
  }
  return {
    svg,
    meta: {
      tool: 'brand.mjs wordmark',
      version: 1,
      at: utcSeconds(),
      text,
      font: { file: toPosix(path.resolve(fontFile)), sha256: sha256(bytes), ...names, licence: { ...licence, nameTable: nameTableKind } },
      size,
      kerning,
      tracking,
      variation: variation ?? null,
      fill,
      decimalPlaces,
      flipY: false,
      layout,
      opentype: '2.0.0',
      bbox: { x1: round(bb.x1, 2), y1: round(bb.y1, 2), x2: round(bb.x2, 2), y2: round(bb.y2, 2) },
      viewBox,
      bytes: Buffer.byteLength(svg),
      warnings,
    },
  };
}

/**
 * Lays glyphs out one by one, without GSUB: cmap lookup, advance widths, kerning and letter spacing.
 * @param {any} font @param {string[]} chars @param {number} size @param {Record<string, unknown>} options
 * @returns {any} an opentype.js Path
 */
function perGlyphPath(font, chars, size, options) {
  const scale = size / font.unitsPerEm;
  const glyphs = chars.map((ch) => font.charToGlyph(ch));
  const full = new opentype.Path();
  /** @type {any} */
  let lookups = null;
  if (options.kerning && font.position?.getKerningTables) {
    try {
      lookups = font.position.getKerningTables(font.position.getDefaultScriptName());
    } catch {
      lookups = null;
    }
  }
  let x = 0;
  glyphs.forEach((glyph, i) => {
    full.extend(glyph.getPath(x, 0, size, options, font));
    if (glyph.advanceWidth) x += glyph.advanceWidth * scale;
    if (options.kerning && i < glyphs.length - 1) {
      const next = glyphs[i + 1];
      const k = lookups ? font.position.getKerningValue(lookups, glyph.index, next.index) : font.getKerningValue(glyph, next);
      x += (k || 0) * scale;
    }
    if (typeof options.letterSpacing === 'number') x += options.letterSpacing * size;
  });
  return full;
}

/**
 * Re-parses the emitted path data and checks that the glyph outline's on-curve points are in it: a flipped or
 * garbled emission (the 2.0.0 default) moves nearly all of them and fails here instead of shipping upside-down
 * letters. opentype.js drops duplicate points when it emits, so the check is set membership, not order.
 * @param {any} glyphPath @param {string} d @param {number} decimalPlaces
 */
export function verifyOutline(glyphPath, d, decimalPlaces) {
  const parsed = parsePathData(d);
  if (parsed.error) throw new CheckError(`the outlined path data does not parse (${parsed.error})`);
  /** @type {Point[]} */
  const expected = [];
  for (const c of glyphPath.commands) if (typeof c.x === 'number') expected.push([c.x, c.y]);
  /** @type {Point[]} */
  const got = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  for (const { cmd, args } of parsed.commands) {
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      x = sx;
      y = sy;
      continue;
    }
    if (C === 'H') x = (rel ? x : 0) + args[0];
    else if (C === 'V') y = (rel ? y : 0) + args[0];
    else {
      x = (rel ? x : 0) + args[args.length - 2];
      y = (rel ? y : 0) + args[args.length - 1];
    }
    if (C === 'M') {
      sx = x;
      sy = y;
    }
    got.push([x, y]);
  }
  const tolerance = 1.5 * 10 ** -decimalPlaces + 1e-9;
  /** @type {Map<string, Point[]>} */
  const cells = new Map();
  for (const p of got) {
    const key = `${Math.floor(p[0])},${Math.floor(p[1])}`;
    const list = cells.get(key);
    if (list) list.push(p);
    else cells.set(key, [p]);
  }
  let found = 0;
  for (const [x, y] of expected) {
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx += 1) {
      for (let dy = -1; dy <= 1 && !hit; dy += 1) {
        for (const p of cells.get(`${Math.floor(x) + dx},${Math.floor(y) + dy}`) ?? []) {
          if (Math.abs(p[0] - x) <= tolerance && Math.abs(p[1] - y) <= tolerance) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) found += 1;
  }
  if (expected.length > 0 && found / expected.length < 0.95) {
    throw new CheckError(`only ${found} of ${expected.length} glyph points are in the emitted path (flipped or garbled); keep toPathData({flipY: false})`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Dark-mode handling for icon.svg

/**
 * Adds a dark-mode rule to a mark that has none, in the pattern that survives SVGO: the light colour as a fill
 * attribute and only the dark override inside `@media (prefers-color-scheme: dark)` [FD12-F24]. `map` takes light
 * colours (any CSS colour) to dark ones; `ink` replaces currentColor, which a favicon would otherwise draw black.
 * @param {string} text
 * @param {{map: Map<string, string> | null, dark: string | null, ink: string}} options
 * @returns {string}
 */
export function withDarkRule(text, { map, dark, ink }) {
  return rewriteSvg(text, (root) => {
    const svg = rootSvgElement(root);
    if (!svg) throw new UsageError('the file has no <svg> root element');
    const styles = specifiedStyles(root, 'light');
    /** @type {Map<string, string>} */
    const classes = new Map();
    /** @type {string[]} */
    const css = [];
    /** @param {string} prop @param {string} light @returns {string | null} */
    const classFor = (prop, light) => {
      const target = map ? map.get(light) : dark;
      if (!target) return null;
      const key = `${prop}:${light}`;
      let name = classes.get(key);
      if (!name) {
        name = `fe-ink-${classes.size}`;
        classes.set(key, name);
        css.push(`.${name}{${prop}:${target}}`);
      }
      return name;
    };
    const geometryEls = [...elementsOf(root)].filter((el) => GEOMETRY_TAGS.has(el.name));
    /** @type {Map<XastElement, XastElement>} */
    const parents = new Map();
    for (const el of elementsOf(root)) for (const child of el.children) if (child.type === 'element') parents.set(child, el);
    /** @param {XastElement} el @param {string} prop @returns {string} */
    const resolved = (el, prop) => {
      /** @type {XastElement | undefined} */
      let cur = el;
      while (cur) {
        const v = styles.get(cur)?.[prop];
        if (v !== undefined && v !== 'inherit') return v;
        cur = parents.get(cur);
      }
      return prop === 'fill' ? '#000000' : prop === 'color' ? ink : 'none';
    };
    for (const el of geometryEls) {
      for (const prop of ['fill', 'stroke']) {
        let value = resolved(el, prop);
        if (value.toLowerCase() === 'currentcolor') value = resolved(el, 'color') === '#000000' ? ink : resolved(el, 'color');
        if (value.toLowerCase() === 'currentcolor') value = ink;
        const c = parseColor(value);
        if (!c || c.a === 0) continue;
        const light = toHex(c);
        el.attributes[prop] = light;
        const name = classFor(prop, light);
        if (name) el.attributes.class = `${el.attributes.class ? `${el.attributes.class} ` : ''}${name}`;
      }
    }
    if (css.length === 0) throw new UsageError('no colour in the mark matches --dark-map; list the light colours exactly as they render');
    /** @type {XastElement} */
    const style = { type: 'element', name: 'style', attributes: {}, children: [{ type: 'text', value: `@media (prefers-color-scheme:dark){${css.join('')}}` }] };
    const titleIndex = svg.children.findIndex((c) => c.type === 'element' && c.name === 'title');
    svg.children.splice(titleIndex + 1, 0, style);
  });
}

/**
 * The light and dark ink colours of an icon rendered by Chromium, and whether the dark rule takes effect.
 * @param {Renderer} renderer @param {string} svg @param {DarkModeReport} report
 * @returns {Promise<{light: string | null, dark: string | null, changedShare: number, matchesDeclared: boolean | null}>}
 */
export async function renderedDarkCheck(renderer, svg, report) {
  const light = await renderer.renderSquare(svg, 64, { scheme: 'light', want: 'rgba' });
  const dark = await renderer.renderSquare(svg, 64, { scheme: 'dark', want: 'rgba' });
  return compareSchemes(/** @type {Buffer} */ (light.rgba), /** @type {Buffer} */ (dark.rgba), report.colours);
}

/**
 * Compares light and dark renders at the pixels that are fully opaque in both: the share that changed colour, the
 * dominant colours, and whether a declared dark colour dominates the changed pixels.
 * @param {Buffer} light @param {Buffer} dark @param {string[]} declared
 * @returns {{light: string | null, dark: string | null, changedShare: number, matchesDeclared: boolean | null}}
 */
export function compareSchemes(light, dark, declared) {
  let opaque = 0;
  let changed = 0;
  for (let i = 0; i < light.length; i += 4) {
    if (light[i + 3] < 250 || dark[i + 3] < 250) continue;
    opaque += 1;
    if (channelDistance([light[i], light[i + 1], light[i + 2]], [dark[i], dark[i + 1], dark[i + 2]]) > 30) changed += 1;
  }
  const lightDom = dominantColour(light, (i) => light[i + 3] === 255);
  const changedSelect = (/** @type {number} */ i) => light[i + 3] >= 250 && dark[i + 3] === 255 && channelDistance([light[i], light[i + 1], light[i + 2]], [dark[i], dark[i + 1], dark[i + 2]]) > 30;
  const darkDom = dominantColour(dark, changed > 0 ? changedSelect : (i) => dark[i + 3] === 255);
  const want = declared.map((c) => rgb255(c)).filter((c) => c !== null);
  const matchesDeclared = want.length === 0 || !darkDom ? null : want.some((c) => channelDistance(/** @type {number[]} */ (c), darkDom.rgb) <= 16);
  return {
    light: lightDom ? hexOf(lightDom.rgb) : null,
    dark: darkDom ? hexOf(darkDom.rgb) : null,
    changedShare: opaque ? round(changed / opaque, 3) : 0,
    matchesDeclared,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Normalised identities (template detection)

/**
 * Canonical SVG text for identity: SVGO preset-default plus sorted attributes, without title, desc or dimensions,
 * so a re-saved copy (whitespace, attribute order, a trailing newline) hashes the same [FD12-F27].
 * @param {string} text
 * @returns {string}
 */
export function canonicalSvg(text) {
  return optimize(text, {
    multipass: true,
    floatPrecision: 3,
    plugins: ['preset-default', 'sortAttrs', 'removeDimensions', 'removeTitle', { name: 'removeDesc', params: { removeAny: true } }],
  }).data.trim();
}

/** @param {RgbaImage} image @returns {string} */
export function pixelHash({ width, height, data }) {
  const copy = Buffer.from(data);
  for (let i = 0; i < copy.length; i += 4) if (copy[i + 3] === 0) copy[i] = copy[i + 1] = copy[i + 2] = 0;
  return sha256(Buffer.concat([Buffer.from(`${width}x${height}\n`), copy]));
}

/**
 * @typedef {{bytes: number, sha256: string, kind: 'svg' | 'ico' | 'png' | 'other', canonicalSha256?: string,
 *   images?: {width: number, height: number, pixelSha256: string}[], error?: string}} FileIdentity
 */

/**
 * Raw and normalised identity of an icon file: SVG by canonical text, ICO and PNG by decoded pixels per image.
 * @param {Buffer} buf
 * @returns {FileIdentity}
 */
export function fileIdentity(buf) {
  const base = { bytes: buf.length, sha256: sha256(buf) };
  const info = imageInfo(buf);
  try {
    if (info.format === 'svg') return { ...base, kind: 'svg', canonicalSha256: sha256(canonicalSvg(buf.toString('utf8'))) };
    if (info.format === 'ico') {
      const ico = parseIco(buf);
      return { ...base, kind: 'ico', images: ico.entries.map((e) => { const img = decodeIcoEntry(buf, e); return { width: img.width, height: img.height, pixelSha256: pixelHash(img) }; }) };
    }
    if (info.format === 'png') {
      const img = decodePng(buf);
      return { ...base, kind: 'png', images: [{ width: img.width, height: img.height, pixelSha256: pixelHash(img) }] };
    }
  } catch (err) {
    return { ...base, kind: info.format === 'svg' ? 'svg' : info.format === 'ico' ? 'ico' : info.format === 'png' ? 'png' : 'other', error: firstLine(err) };
  }
  return { ...base, kind: 'other' };
}

// ---------------------------------------------------------------------------------------------------------------
// Sponsor naming blocklist (reports only; the owner decides) [FD21-F04, FD21 Deliverable naming row]

/**
 * @typedef {{input: string, sponsor: string, entry: string, match: 'token' | 'compound' | 'near' | 'compound-near' | 'phonetic',
 *   part: string, distance: number | null, note: string}} NameHit
 * @typedef {{sponsor: string, display_name: string, naming_blocklist: string[], naming_rule: string | null}} SponsorNaming
 */

/** @param {string} s @returns {string} */
function foldAscii(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

/**
 * Splits a name, domain or handle into lowercase tokens: separators, digit boundaries and camelCase. A domain loses
 * its top-level label and a handle its leading at sign.
 * @param {string} input
 * @returns {string[]}
 */
export function nameTokens(input) {
  let s = foldAscii(input.trim()).replace(/^@+/, '').replace(/^https?:\/\//i, '');
  if (/^[\w-]+(\.[\w-]+)+$/.test(s) && !/\s/.test(s)) s = s.split('.').slice(0, -1).join('.');
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/(?<=[a-zA-Z])(?=\d)|(?<=\d)(?=[a-zA-Z])/g, ' ')
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

/**
 * Optimal string alignment distance (Damerau-Levenshtein with adjacent transpositions).
 * @param {string} a @param {string} b
 * @returns {number}
 */
export function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * A compact phonetic key in the spirit of Metaphone: c and q as k (s before e, i, y), ph as f, x as ks, z as s,
 * d as t, vowels dropped after the first letter, doubled letters merged.
 * @param {string} word
 * @returns {string}
 */
export function phoneticKey(word) {
  let s = foldAscii(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return '';
  s = s.replace(/^(kn|gn|pn|wr)/, (m) => m[1]).replace(/^x/, 's').replace(/^wh/, 'w');
  s = s.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/sch/g, 'sk').replace(/tch/g, 'x').replace(/ch/g, 'x').replace(/sh/g, 'x')
    .replace(/th/g, '0').replace(/dg/g, 'j').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/g(?=[eiy])/g, 'j')
    .replace(/q/g, 'k').replace(/x/g, 'ks').replace(/z/g, 's').replace(/v/g, 'f').replace(/d/g, 't').replace(/gh(?![aeiou])/g, '')
    .replace(/w(?![aeiou])/g, '').replace(/y(?![aeiou])/g, '');
  const head = s[0];
  const tail = s.slice(1).replace(/[aeiouy]/g, '');
  return (head + tail).replace(/(.)\1+/g, '$1');
}

/**
 * Checks names (product name, domain, handle) against the sponsors' naming blocklists: an entry as a token, as the
 * leading or trailing part of a compound (entries of 4+ letters, so "Canada" does not match ADA), a near variant
 * (edit distance 1 for 4-5 letters, 2 for 6+; 1 with the same initial for short entries) or a phonetic match
 * (4+ letters). Every hit is a question for the owner, never a verdict [FD21-F04].
 * @param {string[]} inputs
 * @param {SponsorNaming[]} sponsors
 * @returns {NameHit[]}
 */
export function checkNames(inputs, sponsors) {
  /** @type {NameHit[]} */
  const hits = [];
  for (const input of inputs) {
    const tokens = nameTokens(input);
    const joined = tokens.join('');
    for (const sponsor of sponsors) {
      for (const entryRaw of sponsor.naming_blocklist) {
        const entryTokens = nameTokens(entryRaw);
        const entry = entryTokens.join('');
        if (!entry) continue;
        /** @param {NameHit['match']} match @param {string} part @param {number | null} distance @param {string} note */
        const hit = (match, part, distance, note) => {
          if (!hits.some((h) => h.input === input && h.sponsor === sponsor.sponsor && h.entry === entryRaw)) {
            hits.push({ input, sponsor: sponsor.sponsor, entry: entryRaw, match, part, distance, note });
          }
        };
        if (entryTokens.length > 1) {
          const seq = entryTokens.join(' ');
          if (` ${tokens.join(' ')} `.includes(` ${seq} `) || joined.includes(entry)) hit('token', entryRaw.toLowerCase(), 0, 'the multi-word mark appears whole');
          continue;
        }
        const short = entry.length <= 3;
        const maxDistance = entry.length >= 6 ? 2 : 1;
        const joinedRun = adjacentRuns(tokens).find((run) => run === entry);
        if (joinedRun) {
          hit('token', joinedRun, 0, 'adjacent tokens spell the mark');
          continue;
        }
        for (const token of tokens) {
          if (token === entry) {
            hit('token', token, 0, short ? 'a whole token; short marks also match ordinary words' : 'a whole token');
            break;
          }
          if (!short && token.length > entry.length && (token.startsWith(entry) || token.endsWith(entry))) {
            hit('compound', token, 0, `${token.startsWith(entry) ? 'leading' : 'trailing'} part of a compound`);
            break;
          }
          if (!short) {
            const d = editDistance(token, entry);
            if (d <= maxDistance) {
              hit('near', token, d, `edit distance ${d}`);
              break;
            }
            let best = null;
            for (let len = entry.length - 1; len <= entry.length + 1; len += 1) {
              if (len < 3 || len >= token.length) continue;
              for (const part of [token.slice(0, len), token.slice(token.length - len)]) {
                const pd = editDistance(part, entry);
                if (pd <= Math.min(1, maxDistance) && (!best || pd < best.d)) best = { part, d: pd };
              }
            }
            if (best) {
              hit('compound-near', best.part, best.d, `a near variant (distance ${best.d}) leads or ends the compound "${token}"`);
              break;
            }
            const key = phoneticKey(entry);
            if (key.length >= 3 && phoneticKey(token) === key) {
              hit('phonetic', token, null, `sounds like ${entryRaw} (key ${key})`);
              break;
            }
          } else if (token.length >= entry.length - 1 && token.length <= entry.length + 1 && token[0] === entry[0] && editDistance(token, entry) === 1) {
            hit('near', token, 1, 'edit distance 1 from a short mark; often an ordinary word');
            break;
          }
        }
      }
    }
  }
  return hits;
}

/**
 * Concatenations of two to four adjacent tokens ("ada" + "pay" gives "adapay").
 * @param {string[]} tokens
 * @returns {string[]}
 */
function adjacentRuns(tokens) {
  /** @type {string[]} */
  const runs = [];
  for (let i = 0; i < tokens.length; i += 1) {
    for (let n = 2; n <= 4 && i + n <= tokens.length; n += 1) runs.push(tokens.slice(i, i + n).join(''));
  }
  return runs;
}

/**
 * Reads the naming blocklists of the sponsor allowlist (FD21 Deliverable), optionally restricted to some sponsors.
 * @param {string} file
 * @param {string[] | null} only
 * @returns {{sponsors: SponsorNaming[], withoutList: string[], unknown: string[]}}
 */
export function loadNaming(file, only) {
  const raw = readJson(file, 'sponsor allowlist');
  const list = raw && typeof raw === 'object' && Array.isArray(/** @type {any} */ (raw).sponsor_allowlist) ? /** @type {any[]} */ (/** @type {any} */ (raw).sponsor_allowlist) : null;
  if (!list) throw new UsageError(`${toPosix(file)} has no sponsor_allowlist array; pass the skill's assets/sponsor-allowlist.json`);
  const wanted = only ? only.map((s) => s.toLowerCase()) : null;
  const unknown = wanted ? wanted.filter((id) => !list.some((e) => String(e.sponsor).toLowerCase() === id)) : [];
  /** @type {SponsorNaming[]} */
  const sponsors = [];
  /** @type {string[]} */
  const withoutList = [];
  for (const e of list) {
    const id = String(e.sponsor ?? '').toLowerCase();
    if (wanted && !wanted.includes(id)) continue;
    const blocklist = Array.isArray(e.naming_blocklist) ? e.naming_blocklist.filter((/** @type {unknown} */ x) => typeof x === 'string' && x.trim()) : [];
    if (blocklist.length === 0) withoutList.push(id);
    else sponsors.push({ sponsor: id, display_name: String(e.display_name ?? id), naming_blocklist: blocklist, naming_rule: typeof e.naming_rule === 'string' ? e.naming_rule : null });
  }
  return { sponsors, withoutList, unknown };
}

// ---------------------------------------------------------------------------------------------------------------
// Commands

const GLOBAL_HELP = `Usage: node brand.mjs <command> [options]

The /frontend brand pipeline (FD12, FD21). Every raster is drawn by the skill's Chromium; nothing uses the network.

Commands:
  wordmark     outline a name from a font file (opentype.js, flipY: false) into an SVG and a regenerable JSON record
  lint         lint a mark (or every candidate of a folder): hard fails and look-twice flags
  render       render a mark (or every candidate) at 16, 32, 180 and 512 px, silhouettes on light and dark, solid share
  icons        emit the favicon set: favicon.ico (one 32 px entry), icon.svg with a dark rule, apple-touch-icon,
               192, 512 and maskable 512 icons, manifest.webmanifest and the head tags
  og           render the 1200x630 OG image from the mark, the wordmark and the brief's one-line problem statement
  sheet        lay out the candidates sheet PNG for the owner's pick (H2)
  name-check   report sponsor naming blocklist hits for names, domains and handles (never decides)
  hashes       print the normalised identities of icon files (for brand-check.mjs's template list)

Run node brand.mjs <command> --help for its options.

Exit codes: 0 ok; 1 a check failed (lint fails or unexplained flags, a dark rule lost, a font not loaded);
2 usage error (bad flags, missing or malformed input); 3 environment error (no Chromium).`;

/**
 * @template {Record<string, import('./lib/args.mjs').OptionSpec>} O
 * @param {string[]} argv @param {O} options @param {string} help
 */
function cli(argv, options, help) {
  return parseCli(argv, { options, help });
}

/** @param {string | undefined} value @param {string} flag @param {number} min @param {number} max @returns {number | undefined} */
function intFlag(value, flag, min, max) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`${flag} must be an integer from ${min} to ${max} (got ${JSON.stringify(value)})`);
  return n;
}

/** @param {string | undefined} value @param {string} flag @returns {number | undefined} */
function numFlag(value, flag) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new UsageError(`${flag} must be a number (got ${JSON.stringify(value)})`);
  return n;
}

/** @param {unknown} value @param {string} flag @returns {string} */
function requireString(value, flag) {
  if (typeof value !== 'string' || value.trim() === '') throw new UsageError(`${flag} is required; run with --help for usage`);
  return value;
}

/**
 * Candidate folders: subfolders of `dir` holding a mark.svg, sorted by name.
 * @param {string} dir
 * @returns {string[]}
 */
export function candidateFolders(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    throw new UsageError(`candidates folder not found: ${toPosix(path.resolve(dir))}`, { cause: err });
  }
  return entries
    .filter((e) => e.isDirectory() && existsSync(path.join(dir, e.name, 'mark.svg')))
    .map((e) => path.join(dir, e.name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

/** @param {string} p @returns {boolean} */
function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Reads candidate.json next to a mark, if any.
 * @param {string} folder
 * @returns {Record<string, unknown> | null}
 */
export function readCandidate(folder) {
  const file = path.join(folder, 'candidate.json');
  if (!existsSync(file)) return null;
  const raw = readJson(file, 'candidate file');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError(`${toPosix(file)} must be a JSON object`);
  return /** @type {Record<string, unknown>} */ (raw);
}

/** @param {Record<string, unknown> | null} candidate @returns {Record<string, string>} */
function reasonsOf(candidate) {
  const r = candidate?.flag_reasons;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return {};
  return Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, String(v)]));
}

/** @param {Record<string, unknown> | null} candidate @returns {string | null} */
function fontOf(candidate) {
  const f = candidate?.font;
  if (typeof f === 'string') return f;
  if (f && typeof f === 'object' && typeof (/** @type {any} */ (f)).family === 'string') return /** @type {any} */ (f).family;
  return null;
}

/** @param {LintReport} report @returns {string[]} */
function describeLint(report) {
  const lines = [`${report.file ?? 'mark'}: ${report.ok ? 'ok' : 'FAIL'} (${report.fails.length} fail, ${report.flags.length} flag${report.raster ? '' : ', static only'})`];
  for (const f of report.findings) {
    if (f.severity === 'note' && f.id !== 'dark-rule') continue;
    const tag = f.severity === 'flag' ? (report.unexplained.includes(f.id) ? 'flag (no reason)' : 'flag (reason given)') : f.severity;
    lines.push(`  ${tag.padEnd(18)} ${f.id}: ${f.detail}`);
  }
  return lines;
}

/** @param {string[]} argv @returns {Promise<number>} */
async function cmdWordmark(argv) {
  const { values } = cli(argv, {
    text: { type: 'string' }, font: { type: 'string' }, out: { type: 'string' }, size: { type: 'string' },
    tracking: { type: 'string' }, 'no-kerning': { type: 'boolean' }, fill: { type: 'string' }, title: { type: 'string' },
    axis: { type: 'string', multiple: true }, png: { type: 'boolean' }, json: { type: 'boolean' },
  }, `Usage: node brand.mjs wordmark --text <name> --font <file.ttf|otf|woff> --out <wordmark.svg> [options]

Outlines the name with opentype.js 2.0.0 (toPathData with flipY: false; NaN and flipped output fail), writes the SVG
(no <text>, SVGO preset-default with inlineStyles: false) and <out>.json with the text, font file, family, weight,
size and licence, so the wordmark can be regenerated (BR-05).

Options:
  --text <name>        the name, exactly as it should read
  --font <file>        an open-licensed TTF, OTF or WOFF (not WOFF2); its OFL.txt or LICENSE next to it is recorded
  --out <file.svg>     output SVG; the record goes to the same path with .json
  --size <n>           font size in user units (default 100)
  --tracking <n>       letter spacing in thousandths of an em (default 0)
  --no-kerning         turn kerning off
  --fill <css>         fill (default currentColor)
  --title <text>       <title> (default: the name)
  --axis <tag=value>   a variable-font axis, repeatable (for example --axis wght=600); a static instance is better
  --png                also render <out>.png (512 px wide) with Chromium, to look at once
  --json               print the record on stdout`);
  const text = requireString(values.text, '--text');
  const fontFile = requireString(values.font, '--font');
  const out = requireString(values.out, '--out');
  /** @type {Record<string, number> | undefined} */
  let variation;
  for (const a of values.axis ?? []) {
    const m = /^([a-zA-Z]{4})=(-?\d+(?:\.\d+)?)$/.exec(a);
    if (!m) throw new UsageError(`--axis ${a} must look like wght=600`);
    variation = { ...(variation ?? {}), [m[1]]: Number(m[2]) };
  }
  const result = outlineWordmark({
    text,
    fontFile,
    size: numFlag(values.size, '--size') ?? 100,
    tracking: numFlag(values.tracking, '--tracking') ?? 0,
    kerning: !values['no-kerning'],
    fill: values.fill ?? 'currentColor',
    title: values.title,
    variation,
  });
  const svgPath = writeText(out, `${result.svg}\n`);
  const metaPath = writeText(out.replace(/\.svg$/i, '') + '.json', `${JSON.stringify(result.meta, null, 2)}\n`);
  progress(`wordmark: ${svgPath} (${result.meta.bytes} bytes), record ${metaPath}`);
  for (const w of /** @type {string[]} */ (result.meta.warnings)) progress(`  warning: ${w}`);
  if (values.png) {
    const renderer = await Renderer.open();
    try {
      const { w, h } = fitSize(result.svg, 512, 512);
      const r = await renderer.compose({ width: w, height: h, ground: LIGHT_GROUND, layers: [{ uri: svgDataUri(sizedSvg(result.svg, w, h)), x: 0, y: 0, w, h }], want: 'png' });
      progress(`  preview: ${writeBinary(out.replace(/\.svg$/i, '') + '.png', /** @type {Buffer} */ (r.png))} (look at it once: BR-05)`);
    } finally {
      await renderer.close();
    }
  }
  if (values.json) process.stdout.write(`${JSON.stringify(result.meta, null, 2)}\n`);
  return 0;
}

/** @param {string[]} argv @returns {Promise<number>} */
async function cmdLint(argv) {
  const { values, positionals } = cli(argv, {
    kind: { type: 'string' }, shipped: { type: 'boolean' }, 'static-only': { type: 'boolean' }, reasons: { type: 'string' },
    json: { type: 'boolean' }, out: { type: 'string' },
  }, `Usage: node brand.mjs lint <mark.svg | candidates folder> [options]

Hard fails (exit 1): gradients, patterns, filters, partial opacity, <text>, images, scripts, animation, external
references, strokes or parts thinner than viewBox/16, gaps narrower than viewBox/16, open filled paths, shapes
outside the viewBox, zero-area, duplicated, hidden or fully covered shapes, NaN, malformed path data.
Look-twice flags (exit 1 unless candidate.json gives flag_reasons[<id>]): struck-through initial, hexagon, cube,
triangle, split letters, library icon, mask, complex, off-grid, non-square.

Options:
  --kind mark|wordmark  what the file is (default mark; a wordmark skips grid, stroke and shape checks)
  --shipped             the file ships as is: SVGO must have nothing left to change
  --static-only         skip the Chromium raster layer (thin parts, gaps, slits, covered shapes)
  --reasons <file>      a candidate.json whose flag_reasons explain flags (default: candidate.json next to the mark)
  --out <file.json>     write the report there
  --json                print the report on stdout`);
  if (positionals.length !== 1) throw new UsageError('lint needs one SVG file or one candidates folder; run with --help');
  const kind = values.kind === undefined ? 'mark' : values.kind;
  if (kind !== 'mark' && kind !== 'wordmark') throw new UsageError('--kind must be mark or wordmark');
  const target = positionals[0];
  const files = isDirectory(target) ? candidateFolders(target).map((f) => path.join(f, 'mark.svg')) : [target];
  if (files.length === 0) throw new UsageError(`no candidate folder with a mark.svg under ${toPosix(path.resolve(target))}`);
  const renderer = values['static-only'] ? null : await Renderer.open();
  /** @type {LintReport[]} */
  const reports = [];
  try {
    for (const file of files) {
      const text = readText(file);
      const candidate = values.reasons ? /** @type {Record<string, unknown>} */ (readJson(values.reasons, 'reasons file')) : readCandidate(path.dirname(file));
      const report = await lintMark(text, { renderer, kind, mode: values.shipped ? 'shipped' : 'source', reasons: reasonsOf(candidate), file: toPosix(path.resolve(file)), font: fontOf(candidate) });
      reports.push(report);
      for (const line of describeLint(report)) progress(line);
    }
  } finally {
    await renderer?.close();
  }
  const summary = { tool: 'brand.mjs lint', version: 1, at: utcSeconds(), ok: reports.every((r) => r.ok), reports };
  if (values.out) progress(`report: ${writeText(values.out, `${JSON.stringify(summary, null, 2)}\n`)}`);
  if (values.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary.ok ? 0 : 1;
}

/**
 * @typedef {{tool: string, version: number, at: string, mark: string, markSha256: string, sizes: number[],
 *   grounds: {light: string, dark: string}, metrics: Record<string, InkStats>,
 *   maskable: {inner: number, radius: number, limit: number, inside: boolean},
 *   dark: {present: boolean, matched: boolean, declared: string[], light: string | null, dark: string | null, changedShare: number},
 *   contrast: {light: number | null, dark: number | null}, files: string[]}} RenderRecord
 */

/**
 * Renders one mark into `outDir`: mark-<s>.png (transparent), silhouette-light-<s>.png (black on white),
 * silhouette-dark-<s>.png (white on the dark tab grey), tab-light/tab-dark and 16x zooms at 16 and 32 px, and
 * render.json with the solid share at 16 and 32 px, the ink radius at 409 on 512 and the tab contrasts.
 * @param {Renderer} renderer @param {string} svg @param {string} outDir @param {string} markFile
 * @param {{sizes?: readonly number[], light?: string, dark?: string}} [options]
 * @returns {Promise<RenderRecord>}
 */
export async function renderCandidate(renderer, svg, outDir, markFile, { sizes = RENDER_SIZES, light = LIGHT_GROUND, dark = DARK_GROUND } = {}) {
  ensureDir(outDir);
  /** @type {string[]} */
  const files = [];
  /** @param {string} name @param {Buffer | null} png */
  const save = (name, png) => {
    if (!png) throw new CheckError(`render of ${name} returned no PNG`);
    files.push(name);
    writeBinary(path.join(outDir, name), png);
  };
  /** @type {Record<string, InkStats>} */
  const metrics = {};
  for (const s of sizes) {
    const plain = await renderer.renderSquare(svg, s, { want: 'both' });
    save(`mark-${s}.png`, plain.png);
    metrics[String(s)] = inkStats(/** @type {Buffer} */ (plain.rgba), s, s);
    save(`silhouette-light-${s}.png`, (await renderer.renderSquare(svg, s, { ground: light, tint: '#000000', want: 'png' })).png);
    save(`silhouette-dark-${s}.png`, (await renderer.renderSquare(svg, s, { ground: dark, tint: '#ffffff', want: 'png' })).png);
  }
  for (const s of SOLID_SIZES) {
    save(`tab-light-${s}.png`, (await renderer.renderSquare(svg, s, { ground: light, want: 'png' })).png);
    save(`tab-dark-${s}.png`, (await renderer.renderSquare(svg, s, { ground: dark, scheme: 'dark', want: 'png' })).png);
    save(`zoom-${s}.png`, (await renderer.renderSquare(svg, s, { ground: light, zoom: 16, want: 'png' })).png);
    save(`zoom-dark-${s}.png`, (await renderer.renderSquare(svg, s, { ground: dark, scheme: 'dark', zoom: 16, want: 'png' })).png);
  }
  const probe = await renderer.renderSquare(svg, 512, { inner: 409, want: 'rgba' });
  const radius = maxInkRadius(/** @type {Buffer} */ (probe.rgba), 512, 512);
  const report = darkModeReport(svg);
  const schemes = await renderedDarkCheck(renderer, svg, report);
  const lightTab = await renderer.renderSquare(svg, 32, { want: 'rgba' });
  const darkTab = await renderer.renderSquare(svg, 32, { scheme: 'dark', want: 'rgba' });
  const inkLight = dominantColour(/** @type {Buffer} */ (lightTab.rgba));
  const inkDark = dominantColour(/** @type {Buffer} */ (darkTab.rgba));
  /** @type {RenderRecord} */
  const record = {
    tool: 'brand.mjs render',
    version: 1,
    at: utcSeconds(),
    mark: toPosix(path.resolve(markFile)),
    markSha256: sha256(svg),
    sizes: [...sizes],
    grounds: { light, dark },
    metrics,
    maskable: { inner: 409, radius, limit: 512 * MASKABLE_SAFE_RATIO, inside: radius <= 512 * MASKABLE_SAFE_RATIO },
    dark: { present: report.present, matched: report.matched, declared: report.colours, light: schemes.light, dark: schemes.dark, changedShare: schemes.changedShare },
    contrast: {
      light: inkLight ? round(/** @type {number} */ (contrastRatio(hexOf(inkLight.rgb), light)), 2) : null,
      dark: inkDark ? round(/** @type {number} */ (contrastRatio(hexOf(inkDark.rgb), dark)), 2) : null,
    },
    files,
  };
  writeText(path.join(outDir, 'render.json'), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** @param {string[]} argv @returns {Promise<number>} */
async function cmdRender(argv) {
  const { values, positionals } = cli(argv, {
    out: { type: 'string' }, sizes: { type: 'string' }, light: { type: 'string' }, dark: { type: 'string' }, json: { type: 'boolean' },
  }, `Usage: node brand.mjs render <mark.svg | candidates folder> [--out <dir>] [options]

Renders with Chromium at 16, 32, 180 and 512 px (transparent), one-colour silhouettes on light and dark grounds at
each size, tab previews and 16x nearest-neighbour zooms at 16 and 32 px, and writes render.json: the solid share
(fully opaque over inked pixels) at each size, the ink radius of the mark at 409 on 512, the dark-mode colours
and the ink contrast on light and dark tabs. A low solid share is a review flag, not a failure (FD12-F16).

Options:
  --out <dir>        output folder (default: render/ next to the mark; a candidates folder renders into each
                     candidate's render/)
  --sizes <list>     comma-separated sizes (default 16,32,180,512)
  --light <css>      light ground (default #ffffff)
  --dark <css>       dark ground (default #202124, a dark tab strip)
  --json             print the records on stdout`);
  if (positionals.length !== 1) throw new UsageError('render needs one SVG file or one candidates folder; run with --help');
  const sizes = values.sizes ? values.sizes.split(',').map((s) => /** @type {number} */ (intFlag(s.trim(), '--sizes', 8, 1024))) : [...RENDER_SIZES];
  const light = values.light ? opaqueColour(values.light, '--light') : LIGHT_GROUND;
  const dark = values.dark ? opaqueColour(values.dark, '--dark') : DARK_GROUND;
  const target = positionals[0];
  const jobs = isDirectory(target)
    ? candidateFolders(target).map((f) => ({ mark: path.join(f, 'mark.svg'), out: path.join(f, 'render') }))
    : [{ mark: target, out: values.out ?? path.join(path.dirname(target), 'render') }];
  if (jobs.length === 0) throw new UsageError(`no candidate folder with a mark.svg under ${toPosix(path.resolve(target))}`);
  const renderer = await Renderer.open();
  /** @type {RenderRecord[]} */
  const records = [];
  try {
    for (const job of jobs) {
      const svg = readText(job.mark);
      parseSvgTree(svg);
      const record = await renderCandidate(renderer, svg, job.out, job.mark, { sizes, light, dark });
      records.push(record);
      const m = (/** @type {number} */ s) => record.metrics[String(s)];
      progress(`render: ${toPosix(path.resolve(job.out))} solid share 16 px ${m(16)?.solidShare ?? '-'}, 32 px ${m(32)?.solidShare ?? '-'}; ink radius ${record.maskable.radius} of ${record.maskable.limit}; dark rule ${record.dark.present ? (record.dark.changedShare > 0 ? 'works' : 'has no effect') : 'absent'}`);
    }
  } finally {
    await renderer.close();
  }
  if (values.json) process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
  return 0;
}

/** @param {string} spec @returns {Map<string, string>} */
function parseDarkMap(spec) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const pair of spec.split(',')) {
    const [from, to] = pair.split('=').map((s) => s?.trim());
    if (!from || !to) throw new UsageError(`--dark-map ${pair} must look like #14161a=#f4f1ea`);
    map.set(opaqueColour(from, '--dark-map'), opaqueColour(to, '--dark-map'));
  }
  return map;
}

/**
 * @typedef {{icoEntries: {width: number, height: number, bpp: number}[], maskableInner: number, maskableRadius: number,
 *   dark: DarkModeReport & {rendered: Awaited<ReturnType<typeof renderedDarkCheck>>}, files: Record<string, {sha256: string, bytes: number}>}} IconsRecord
 */

/**
 * Builds the favicon set from a mark [FD12-F21 to F25, F29; Appendix A].
 * @param {Renderer} renderer
 * @param {string} markText
 * @param {{outDir: string, publicDir: string, layout: 'static' | 'next', name: string, bg: string, map: Map<string, string> | null,
 *   dark: string | null, ink: string, base: string}} options
 * @returns {Promise<Record<string, unknown>>}
 */
export async function buildIcons(renderer, markText, { outDir, publicDir, layout, name, bg, map, dark, ink, base }) {
  const lint = lintSvgStatic(markText, { kind: 'mark' });
  const hard = lint.findings.filter((f) => f.severity === 'fail');
  if (hard.length > 0) throw new CheckError(`the mark has hard lint failures (${hard.map((f) => f.id).join(', ')}); fix them before emitting icons (brand.mjs lint)`);
  let source = markText;
  const existing = darkModeReport(markText);
  if (!existing.present) {
    if (!map && !dark) throw new UsageError('icon.svg needs a dark-mode rule (BR-12): pass --dark <colour> (or --dark-map), or add the rule to the mark');
    source = withDarkRule(markText, { map, dark, ink });
  } else if (/currentcolor/i.test(markText)) {
    source = rewriteSvg(markText, (root) => {
      for (const el of elementsOf(root)) {
        for (const prop of ['fill', 'stroke', 'color']) if (el.attributes[prop]?.toLowerCase() === 'currentcolor') el.attributes[prop] = ink;
      }
    });
  }
  const icon = optimize(source, iconSvgoConfig()).data;
  const report = darkModeReport(icon);
  if (!report.present || !report.matched) {
    throw new CheckError('the dark-mode rule did not survive SVGO (FD12-F24): write the light colour as a fill attribute and only the dark override in the @media block');
  }
  const rendered = await renderedDarkCheck(renderer, icon, report);
  if (rendered.changedShare === 0 || rendered.matchesDeclared === false) {
    throw new CheckError(`icon.svg does not change colour under emulated dark mode in Chromium (light ${rendered.light}, dark ${rendered.dark}); check the rule's selector`);
  }
  const names = layout === 'next'
    ? { ico: path.join(outDir, 'favicon.ico'), svg: path.join(outDir, 'icon.svg'), apple: path.join(outDir, 'apple-icon.png'), manifest: path.join(outDir, 'manifest.webmanifest') }
    : { ico: path.join(outDir, 'favicon.ico'), svg: path.join(outDir, 'icon.svg'), apple: path.join(outDir, 'apple-touch-icon.png'), manifest: path.join(outDir, 'manifest.webmanifest') };
  const icon32 = await renderer.renderSquare(icon, 32, { want: 'png' });
  const ico = await pngToIco([/** @type {Buffer} */ (icon32.png)]);
  const icoInfo = parseIco(ico);
  if (icoInfo.count !== 1 || icoInfo.entries[0].width !== 32 || icoInfo.entries[0].height !== 32) {
    throw new CheckError('favicon.ico must hold exactly one 32x32 entry (FD12-F25)');
  }
  /** @type {Record<string, {sha256: string, bytes: number}>} */
  const files = {};
  /** @param {string} file @param {Buffer | string} data */
  const emit = (file, data) => {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const where = writeBinary(file, buf);
    files[where] = { sha256: sha256(buf), bytes: buf.length };
  };
  emit(names.ico, ico);
  emit(names.svg, `${icon}\n`);
  const apple = await renderer.compose({ width: APPLE_SIZE, height: APPLE_SIZE, ground: bg, layers: [squareLayer(icon, APPLE_MARK, (APPLE_SIZE - APPLE_MARK) / 2)], want: 'png' });
  emit(names.apple, /** @type {Buffer} */ (apple.png));
  emit(path.join(publicDir, 'icon-192.png'), /** @type {Buffer} */ ((await renderer.renderSquare(icon, 192, { want: 'png' })).png));
  emit(path.join(publicDir, 'icon-512.png'), /** @type {Buffer} */ ((await renderer.renderSquare(icon, 512, { want: 'png' })).png));
  let inner = 409;
  let radius = Infinity;
  for (; inner >= 64; inner -= 8) {
    const layer = await renderer.renderSquare(icon, 512, { inner, want: 'rgba' });
    radius = maxInkRadius(/** @type {Buffer} */ (layer.rgba), 512, 512);
    if (radius <= 512 * MASKABLE_SAFE_RATIO) break;
  }
  if (radius > 512 * MASKABLE_SAFE_RATIO) throw new CheckError('the mark does not fit the maskable safe zone even at 64 px');
  const mask = await renderer.renderSquare(icon, 512, { inner, ground: bg, want: 'png' });
  emit(path.join(publicDir, 'icon-mask.png'), /** @type {Buffer} */ (mask.png));
  const prefix = base.endsWith('/') ? base : `${base}/`;
  const manifest = {
    name,
    icons: [
      { src: `${prefix}icon-192.png`, type: 'image/png', sizes: '192x192' },
      { src: `${prefix}icon-mask.png`, type: 'image/png', sizes: '512x512', purpose: 'maskable' },
      { src: `${prefix}icon-512.png`, type: 'image/png', sizes: '512x512' },
    ],
  };
  emit(names.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  const head = layout === 'next'
    ? '<!-- Next.js App Router emits the icon tags from app/favicon.ico, app/icon.svg, app/apple-icon.png and app/manifest.webmanifest; check the built <head>. -->\n'
    : [
      `<link rel="icon" href="${prefix}favicon.ico" sizes="32x32">`,
      `<link rel="icon" href="${prefix}icon.svg" type="image/svg+xml">`,
      `<link rel="apple-touch-icon" href="${prefix}apple-touch-icon.png">`,
      `<link rel="manifest" href="${prefix}manifest.webmanifest">`,
      '',
    ].join('\n');
  const record = {
    tool: 'brand.mjs icons',
    version: 1,
    at: utcSeconds(),
    layout,
    markSha256: sha256(markText),
    svgo: iconSvgoConfig(),
    ico: icoInfo.entries.map((e) => ({ width: e.width, height: e.height, bpp: e.bpp, format: e.format })),
    apple: { size: APPLE_SIZE, mark: APPLE_MARK, ground: bg },
    maskable: { inner, radius, limit: 512 * MASKABLE_SAFE_RATIO, ground: bg },
    dark: { rules: report.rules.length, matched: report.matched, declared: report.colours, rendered },
    files,
    head,
  };
  writeText(path.join(outDir, 'icons.json'), `${JSON.stringify(record, null, 2)}\n`);
  if (layout !== 'next') writeText(path.join(outDir, 'head.html'), head);
  return record;
}

/** @param {string} svg @param {number} size @param {number} offset @returns {Layer} */
function squareLayer(svg, size, offset) {
  const { w, h } = fitSize(svg, size, size);
  return { uri: svgDataUri(sizedSvg(svg, w, h)), x: offset + (size - w) / 2, y: offset + (size - h) / 2, w, h };
}

/** @param {string[]} argv @returns {Promise<number>} */
async function cmdIcons(argv) {
  const { values, positionals } = cli(argv, {
    out: { type: 'string' }, public: { type: 'string' }, layout: { type: 'string' }, name: { type: 'string' }, bg: { type: 'string' },
    dark: { type: 'string' }, 'dark-map': { type: 'string' }, ink: { type: 'string' }, base: { type: 'string' }, json: { type: 'boolean' },
  }, `Usage: node brand.mjs icons <mark.svg> --out <dir> --name <app name> [options]

Emits the minimal favicon set (FD12-F21): favicon.ico with one 32x32 entry (png-to-ico), icon.svg optimised with
SVGO preset-default and inlineStyles: false with its dark-mode rule asserted after SVGO and in Chromium,
apple-touch-icon.png 180x180 (the mark at 140 on --bg), icon-192.png, icon-512.png, icon-mask.png (the mark shrunk
from 409 px by 8 until every inked pixel lies within 0.4 x 512 of the centre, on --bg), manifest.webmanifest,
head.html and icons.json.

Options:
  --out <dir>          output folder (static layout: the site's public folder; next layout: app/)
  --layout static|next static (default) or Next.js App Router (favicon.ico, icon.svg, apple-icon.png and
                       manifest.webmanifest in --out, the PNG icons in --public)
  --public <dir>       folder for icon-192/512/mask.png (default --out; required for --layout next)
  --name <name>        the app name in the manifest
  --bg <css>           ground of the apple-touch and maskable icons (default #ffffff); use the brand ground
  --dark <css>         dark-mode colour for every ink colour, when the mark has no dark rule
  --dark-map <a=b,...> dark-mode colour per light colour, for a mark with several inks
  --ink <css>          colour replacing currentColor in icon.svg (default #000000)
  --base <path>        URL prefix of the files (default /)
  --json               print icons.json on stdout`);
  if (positionals.length !== 1) throw new UsageError('icons needs one mark SVG; run with --help');
  const outDir = requireString(values.out, '--out');
  const layout = values.layout ?? 'static';
  if (layout !== 'static' && layout !== 'next') throw new UsageError('--layout must be static or next');
  if (layout === 'next' && !values.public) throw new UsageError('--layout next needs --public <dir> for the PNG icons the manifest points to');
  const name = requireString(values.name, '--name');
  const markText = readText(positionals[0]);
  const renderer = await Renderer.open();
  try {
    const record = await buildIcons(renderer, markText, {
      outDir,
      publicDir: values.public ?? outDir,
      layout,
      name,
      bg: values.bg ? opaqueColour(values.bg, '--bg') : LIGHT_GROUND,
      map: values['dark-map'] ? parseDarkMap(values['dark-map']) : null,
      dark: values.dark ? opaqueColour(values.dark, '--dark') : null,
      ink: values.ink ? opaqueColour(values.ink, '--ink') : '#000000',
      base: values.base ?? '/',
    });
    if (!values.bg) progress('icons: --bg not given; the apple-touch and maskable icons sit on #ffffff (pass the brand ground)');
    progress(`icons: ${Object.keys(/** @type {Record<string, unknown>} */ (record.files)).length} files in ${toPosix(path.resolve(outDir))}; maskable mark ${(/** @type {any} */ (record.maskable)).inner} px, ink radius ${(/** @type {any} */ (record.maskable)).radius} of 204.8`);
    if (values.json) process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  } finally {
    await renderer.close();
  }
  return 0;
}

/**
 * Reads a dotted field of brief.json (for example sentences.broken), verbatim.
 * @param {string} briefFile @param {string} field
 * @returns {{line: string, name: string | null, source: string | null}}
 */
export function briefLine(briefFile, field) {
  const brief = /** @type {any} */ (readJson(briefFile, 'brief'));
  let value = brief;
  for (const key of field.split('.')) value = value && typeof value === 'object' ? value[key] : undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new UsageError(`brief ${toPosix(briefFile)} has no text at ${field}; fill the brief (brief.mjs) or pass --field`);
  }
  const parent = field.split('.')[0];
  const source = brief?.[parent]?.source;
  return { line: value, name: typeof brief?.project?.name === 'string' && brief.project.name.trim() ? brief.project.name : null, source: typeof source === 'string' ? source : null };
}

/**
 * The OG card page: the mark and the wordmark inline (ids and classes prefixed, scripts removed), the line in the
 * self-hosted face.
 * @param {{mark: string, wordmark: string, line: string, bg: string, fg: string, fontUrl: string, fontFormat: string}} parts
 * @returns {string}
 */
export function ogHtml({ mark, wordmark, line, bg, fg, fontUrl, fontFormat }) {
  /** @param {string} svg @param {string} prefix */
  const inline = (svg, prefix) => optimize(svg, {
    plugins: [{ name: 'removeScripts' }, { name: 'removeXMLProcInst' }, { name: 'prefixIds', params: { prefix } }, { name: 'removeDimensions' }],
  }).data;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>og</title>
<style>
@font-face{font-family:"FeOgLine";src:url("${fontUrl}") format("${fontFormat}");font-display:block}
*{box-sizing:border-box}
html,body{margin:0;width:${OG_WIDTH}px;height:${OG_HEIGHT}px;overflow:hidden;background:${bg};color:${fg}}
main{width:${OG_WIDTH}px;height:${OG_HEIGHT}px;padding:72px 80px;display:flex;flex-direction:column;justify-content:space-between}
.brand{display:flex;align-items:center;gap:40px;height:120px}
.brand svg{display:block;height:100%;width:auto}
.mark{height:120px}
.word{height:76px}
#line{margin:0;font-family:"FeOgLine";font-size:56px;line-height:1.18;max-width:1040px;overflow-wrap:break-word}
</style></head>
<body><main><div class="brand"><div class="mark">${inline(mark, 'fe-og-mark')}</div><div class="word">${inline(wordmark, 'fe-og-word')}</div></div><p id="line">${escapeHtml(line)}</p></main></body></html>
`;
}

/**
 * Renders the OG image with Chromium from a temporary folder served on 127.0.0.1 (nothing else may load).
 * @param {{mark: string, wordmark: string, line: string, fontFile: string, bg: string, fg: string, browser?: Browser | null}} input
 * @returns {Promise<{png: Buffer, fontSize: number}>}
 */
export async function renderOg({ mark, wordmark, line, fontFile, bg, fg, browser = null }) {
  const ext = path.extname(fontFile).toLowerCase();
  const format = { '.ttf': 'truetype', '.otf': 'opentype', '.woff': 'woff', '.woff2': 'woff2' }[ext];
  if (!format) throw new UsageError(`--font ${toPosix(fontFile)} must be a .ttf, .otf, .woff or .woff2 file`);
  readBinary(fontFile, 'font file');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fe-og-'));
  const own = !browser;
  const b = browser ?? (await launchBrowser());
  /** @type {import('./lib/serve.mjs').StaticServer | null} */
  let server = null;
  try {
    copyFileSync(fontFile, path.join(dir, `line${ext}`));
    writeFileSync(path.join(dir, 'index.html'), ogHtml({ mark, wordmark, line, bg, fg, fontUrl: `/line${ext}`, fontFormat: format }));
    server = await serveStatic(dir, { spaFallback: false });
    const origin = server.url;
    const context = await b.newContext({ viewport: { width: OG_WIDTH, height: OG_HEIGHT }, deviceScaleFactor: 1, colorScheme: 'light', locale: 'en-US', timezoneId: 'UTC' });
    try {
      await context.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
      const page = await context.newPage();
      await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
      const fit = await page.evaluate(async () => {
        await document.fonts.ready;
        const p = /** @type {HTMLElement} */ (document.getElementById('line'));
        const main = /** @type {HTMLElement} */ (document.querySelector('main'));
        const brand = /** @type {HTMLElement} */ (document.querySelector('.brand'));
        const loaded = [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'FeOgLine' && f.status === 'loaded');
        let size = 56;
        const room = () => main.clientHeight - 144 - brand.offsetHeight - 40;
        while (size > 30 && (p.scrollHeight > room() || p.scrollWidth > p.clientWidth)) {
          size -= 2;
          p.style.fontSize = `${size}px`;
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))));
        return { loaded, size, fits: p.scrollHeight <= room() && p.scrollWidth <= p.clientWidth };
      });
      if (!fit.loaded) throw new CheckError(`the line's font ${toPosix(fontFile)} did not load in Chromium; pass a valid TTF, OTF or WOFF`);
      if (!fit.fits) throw new CheckError('the line does not fit the card even at 30 px; shorten the problem statement in the brief');
      const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: OG_WIDTH, height: OG_HEIGHT } });
      return { png, fontSize: fit.size };
    } finally {
      await context.close();
    }
  } finally {
    await server?.close();
    if (own) await b.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** @param {string[]} argv @returns {Promise<number>} */
async function cmdOg(argv) {
  const { values } = cli(argv, {
    mark: { type: 'string' }, wordmark: { type: 'string' }, font: { type: 'string' }, brief: { type: 'string' }, field: { type: 'string' },
    line: { type: 'string' }, name: { type: 'string' }, out: { type: 'string' }, bg: { type: 'string' }, fg: { type: 'string' },
    'site-url': { type: 'string' }, base: { type: 'string' }, json: { type: 'boolean' },
  }, `Usage: node brand.mjs og --mark <mark.svg> --wordmark <wordmark.svg> --font <file> --brief <brief.json> --out <dir> [options]

Renders opengraph-image.<sha256:8>.png at 1200x630 (DPR 1) with Chromium from an HTML card: the mark, the outlined
wordmark and the one-line problem statement copied verbatim from the brief, set in the self-hosted wordmark face
(FD12-F28, BR-18). Writes og.json and og-head.html with og:image, og:image:width, og:image:height, og:image:alt and
twitter:card=summary_large_image.

Options:
  --mark <svg>          the picked mark
  --wordmark <svg>      the outlined wordmark (brand.mjs wordmark)
  --font <file>         TTF, OTF or WOFF of the wordmark face, for the line (self-hosted, no CDN)
  --brief <file>        brief.json; the line is read verbatim from --field
  --field <path>        brief field for the line (default sentences.broken; hero.sentence is the other choice)
  --line <text>         the line itself, when no brief exists (BR-18 prefers the brief's words)
  --name <name>         the name in og:image:alt (default: brief project.name)
  --out <dir>           output folder (the site's public folder)
  --bg <css>, --fg <css> card colours (default #ffffff and #111111)
  --site-url <https://host>  absolute site origin for og:image (crawlers need an absolute URL)
  --base <path>         URL path of the image under the site (default /)
  --json                print og.json on stdout`);
  const markFile = requireString(values.mark, '--mark');
  const wordmarkFile = requireString(values.wordmark, '--wordmark');
  const fontFile = requireString(values.font, '--font');
  const outDir = requireString(values.out, '--out');
  if (values.brief && values.line) throw new UsageError('pass --brief or --line, not both');
  let line;
  let name = values.name ?? null;
  let lineSource = 'flag --line';
  if (values.brief) {
    const field = values.field ?? 'sentences.broken';
    const read = briefLine(values.brief, field);
    line = read.line;
    name = name ?? read.name;
    lineSource = `${toPosix(path.resolve(values.brief))}#${field}${read.source ? ` (source ${read.source})` : ''}`;
  } else line = requireString(values.line, '--brief or --line');
  if (!name) throw new UsageError('--name is required when the brief has no project.name');
  const siteUrl = values['site-url'] ?? null;
  if (siteUrl && !/^https:\/\/[^/]+/i.test(siteUrl)) throw new UsageError('--site-url must be an absolute https origin such as https://example.org');
  const { png, fontSize } = await renderOg({
    mark: readText(markFile),
    wordmark: readText(wordmarkFile),
    line,
    fontFile,
    bg: values.bg ? opaqueColour(values.bg, '--bg') : '#ffffff',
    fg: values.fg ? opaqueColour(values.fg, '--fg') : '#111111',
  });
  if (png.length > OG_MAX_BYTES) throw new CheckError(`the OG image is ${png.length} bytes, over Meta's 8 MB`);
  const hash = sha256(png);
  const fileName = `opengraph-image.${hash.slice(0, 8)}.png`;
  const where = writeBinary(path.join(outDir, fileName), png);
  const prefix = (values.base ?? '/').replace(/\/?$/, '/');
  const url = siteUrl ? `${siteUrl.replace(/\/$/, '')}${prefix}${fileName}` : `${prefix}${fileName}`;
  const alt = `${name}: ${line}`;
  const head = [
    `<meta property="og:image" content="${escapeHtml(url)}">`,
    `<meta property="og:image:width" content="${OG_WIDTH}">`,
    `<meta property="og:image:height" content="${OG_HEIGHT}">`,
    `<meta property="og:image:alt" content="${escapeHtml(alt)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    '',
  ].join('\n');
  const record = { tool: 'brand.mjs og', version: 1, at: utcSeconds(), file: where, sha256: hash, bytes: png.length, width: OG_WIDTH, height: OG_HEIGHT, url, alt, line, lineSource, fontSize, absolute: Boolean(siteUrl), head };
  writeText(path.join(outDir, 'og.json'), `${JSON.stringify(record, null, 2)}\n`);
  writeText(path.join(outDir, 'og-head.html'), head);
  progress(`og: ${where} (${png.length} bytes, line at ${fontSize} px)`);
  if (!siteUrl) progress('og: no --site-url, so og:image is relative; crawlers need an absolute https URL (BR-18)');
  if (values.json) process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  return 0;
}

/**
 * Renders the candidates sheet: one row per candidate with tab previews, 16 px zooms, the 180 px render, the
 * silhouettes and the measured values, for the owner's pick and the defect review [FD12-F09, F10].
 * @param {Renderer} renderer @param {string} dir @param {{title?: string, browser?: Browser | null}} [options]
 * @returns {Promise<{png: Buffer, rows: Record<string, unknown>[]}>}
 */
export async function renderSheet(renderer, dir, { title = 'Brand candidates' } = {}) {
  const folders = candidateFolders(dir);
  if (folders.length === 0) throw new UsageError(`no candidate folder with a mark.svg under ${toPosix(path.resolve(dir))}`);
  /** @type {Record<string, unknown>[]} */
  const rows = [];
  /** @type {string[]} */
  const html = [];
  /** @param {Buffer | null} png @param {number} size @param {boolean} pixelated */
  const img = (png, size, pixelated) => `<img src="data:image/png;base64,${png ? png.toString('base64') : ''}" width="${size}" height="${size}" style="${pixelated ? 'image-rendering:pixelated;' : ''}">`;
  for (const folder of folders) {
    const svg = readText(path.join(folder, 'mark.svg'));
    const candidate = readCandidate(folder);
    const lint = await lintMark(svg, { renderer, reasons: reasonsOf(candidate), file: toPosix(path.join(folder, 'mark.svg')), font: fontOf(candidate) });
    const r16 = await renderer.renderSquare(svg, 16, { want: 'both' });
    const r32 = await renderer.renderSquare(svg, 32, { want: 'both' });
    const probe = await renderer.renderSquare(svg, 512, { inner: 409, want: 'rgba' });
    const stats16 = inkStats(/** @type {Buffer} */ (r16.rgba), 16, 16);
    const stats32 = inkStats(/** @type {Buffer} */ (r32.rgba), 32, 32);
    const radius = maxInkRadius(/** @type {Buffer} */ (probe.rgba), 512, 512);
    const cells = [
      ['16 light', img((await renderer.renderSquare(svg, 16, { ground: LIGHT_GROUND, want: 'png' })).png, 16, false)],
      ['16 dark', img((await renderer.renderSquare(svg, 16, { ground: DARK_GROUND, scheme: 'dark', want: 'png' })).png, 16, false)],
      ['32 light', img((await renderer.renderSquare(svg, 32, { ground: LIGHT_GROUND, want: 'png' })).png, 32, false)],
      ['32 dark', img((await renderer.renderSquare(svg, 32, { ground: DARK_GROUND, scheme: 'dark', want: 'png' })).png, 32, false)],
      ['16 px x8', img((await renderer.renderSquare(svg, 16, { ground: LIGHT_GROUND, zoom: 8, want: 'png' })).png, 128, true)],
      ['16 px x8 dark', img((await renderer.renderSquare(svg, 16, { ground: DARK_GROUND, scheme: 'dark', zoom: 8, want: 'png' })).png, 128, true)],
      ['180', img((await renderer.renderSquare(svg, 180, { ground: LIGHT_GROUND, want: 'png' })).png, 128, false)],
      ['one colour', img((await renderer.renderSquare(svg, 128, { ground: LIGHT_GROUND, tint: '#000000', want: 'png' })).png, 128, false)],
      ['one colour dark', img((await renderer.renderSquare(svg, 128, { ground: DARK_GROUND, tint: '#ffffff', want: 'png' })).png, 128, false)],
    ];
    let wordCell = '';
    const wordFile = path.join(folder, 'wordmark.svg');
    if (existsSync(wordFile)) {
      const word = readText(wordFile);
      const { w, h } = fitSize(word, 360, 72);
      const r = await renderer.compose({ width: w, height: h, layers: [{ uri: svgDataUri(sizedSvg(word, w, h)), x: 0, y: 0, w, h }], want: 'png' });
      wordCell = `<div class="word"><img src="data:image/png;base64,${/** @type {Buffer} */ (r.png).toString('base64')}" width="${w}" height="${h}"></div>`;
    }
    const name = path.basename(folder);
    const oneFeature = typeof candidate?.one_feature === 'string' ? candidate.one_feature : '(no one_feature)';
    const intervention = typeof candidate?.intervention === 'string' ? candidate.intervention : '(no intervention)';
    const flagText = lint.flags.map((f) => `${f}${lint.unexplained.includes(f) ? ' (no reason)' : ''}`).join(', ') || 'none';
    rows.push({ name, solidShare16: stats16.solidShare, solidShare32: stats32.solidShare, inkRadius409: radius, fails: lint.fails, flags: lint.flags, unexplained: lint.unexplained });
    html.push(`<section><h2>${escapeHtml(name)}</h2><p class="meta">one feature: ${escapeHtml(oneFeature)}<br>intervention: ${escapeHtml(intervention)}<br>solid share 16 px ${stats16.solidShare}, 32 px ${stats32.solidShare}; ink radius at 409 on 512: ${radius} (limit 204.8)<br>fails: ${escapeHtml(lint.fails.join(', ') || 'none')}; flags: ${escapeHtml(flagText)}</p><div class="cells">${cells.map(([label, cell]) => `<figure>${cell}<figcaption>${escapeHtml(label)}</figcaption></figure>`).join('')}</div>${wordCell}</section>`);
  }
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>sheet</title><style>
*{box-sizing:border-box}body{margin:0;padding:32px;background:#f2f2f2;color:#111;font:14px/1.4 system-ui,sans-serif;width:1500px}
h1{font-size:22px;margin:0 0 24px}section{background:#fff;border:1px solid #d0d0d0;padding:16px 20px;margin-bottom:16px}
h2{font-size:16px;margin:0 0 6px}.meta{margin:0 0 12px;color:#333}.cells{display:flex;gap:18px;align-items:flex-end;flex-wrap:wrap}
figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:6px}figcaption{font-size:12px;color:#555}
img{display:block;border:1px solid #e0e0e0}.word{margin-top:12px}
</style></head><body><h1>${escapeHtml(title)}</h1>${html.join('')}</body></html>`;
  await renderer.setScheme('light');
  const context = renderer.context;
  const sheetPage = await context.newPage();
  try {
    await sheetPage.setViewportSize({ width: 1564, height: 900 });
    await sheetPage.setContent(page, { waitUntil: 'load' });
    await sheetPage.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => undefined))));
    const png = await sheetPage.screenshot({ type: 'png', fullPage: true });
    return { png, rows };
  } finally {
    await sheetPage.close();
  }
}

/** @param {string[]} argv @returns {Promise<number>} */
async function cmdSheet(argv) {
  const { values, positionals } = cli(argv, { out: { type: 'string' }, title: { type: 'string' }, json: { type: 'boolean' } },
    `Usage: node brand.mjs sheet <candidates folder> --out <sheet.png> [--title <text>]

Lays out every candidate (each subfolder with a mark.svg, candidate.json and an optional wordmark.svg): 16 and 32 px
on light and dark tabs, 8x zooms of the 16 px render, the 180 px render, the one-colour silhouettes, the solid
share, the ink radius, the one feature, the intervention and the lint result. For the owner's pick (H2): the model
reviews defects only, never ranks (FD12-F09). Writes the PNG and <out>.json.

Options:
  --out <file.png>   output image
  --title <text>     heading (default "Brand candidates")
  --json             print the rows on stdout`);
  if (positionals.length !== 1) throw new UsageError('sheet needs one candidates folder; run with --help');
  const out = requireString(values.out, '--out');
  const renderer = await Renderer.open();
  try {
    const { png, rows } = await renderSheet(renderer, positionals[0], { title: values.title });
    const where = writeBinary(out, png);
    writeText(out.replace(/\.png$/i, '') + '.json', `${JSON.stringify({ tool: 'brand.mjs sheet', version: 1, at: utcSeconds(), file: where, rows }, null, 2)}\n`);
    progress(`sheet: ${where} (${rows.length} candidates)`);
    if (values.json) process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  } finally {
    await renderer.close();
  }
  return 0;
}

/** @param {string[]} argv @returns {Promise<number>} */
async function cmdNameCheck(argv) {
  const { values, positionals } = cli(argv, {
    sponsors: { type: 'string' }, profile: { type: 'string' }, allowlist: { type: 'string' }, out: { type: 'string' }, json: { type: 'boolean' },
  }, `Usage: node brand.mjs name-check <name> [<domain> <@handle> ...] [options]

Checks each name against the naming_blocklist of the sponsors in assets/sponsor-allowlist.json (FD21 Deliverable):
an entry as a whole token, as the leading or trailing part of a compound (4+ letters: "Cardanex", "AdaPay"; not
"Canada"), a near variant (edit distance) or a phonetic match. It reports only: every hit is a question for the
owner (Cardano's policy bars its marks from product names, while its forum accepts creative names, FD21-F04).
Exit 0 with or without hits. No network: domain, handle and trademark probes are separate (BR-19).

Options:
  --sponsors <ids>     comma-separated sponsor ids (default: the profile's sponsors, else every sponsor)
  --profile <file>     an /execution profile.json or a frontend block, for its sponsors
  --allowlist <file>   another allowlist file (default the skill's)
  --out <file.json>    write the report (for example <state>/brand/name-checks.json)
  --json               print the report on stdout`);
  if (positionals.length === 0) throw new UsageError('name-check needs at least one name; run with --help');
  let only = values.sponsors ? values.sponsors.split(',').map((s) => s.trim()).filter(Boolean) : null;
  if (!only && values.profile) {
    const profile = loadProfile(values.profile);
    only = profile.sponsors.length > 0 ? profile.sponsors : null;
  }
  const allowlist = values.allowlist ?? DEFAULT_ALLOWLIST;
  const naming = loadNaming(allowlist, only);
  const hits = checkNames(positionals, naming.sponsors);
  const report = {
    tool: 'brand.mjs name-check',
    version: 1,
    at: utcSeconds(),
    names: positionals.map((n) => ({ input: n, tokens: nameTokens(n) })),
    allowlist: toPosix(path.resolve(allowlist)),
    checked: naming.sponsors.map((s) => ({ sponsor: s.sponsor, entries: s.naming_blocklist, naming_rule: s.naming_rule })),
    withoutBlocklist: naming.withoutList,
    unknownSponsors: naming.unknown,
    hits,
    verdict: 'report only: each hit is the owner\'s decision; no hit is not clearance (FD21-F04, BR-21)',
  };
  for (const id of naming.unknown) progress(`name-check: sponsor "${id}" is not in the allowlist`);
  if (hits.length === 0) progress(`name-check: no blocklist hit for ${positionals.join(', ')} against ${naming.sponsors.map((s) => s.sponsor).join(', ') || 'no sponsor'} (not a clearance)`);
  for (const h of hits) progress(`name-check: "${h.input}" ~ ${h.sponsor} ${h.entry} (${h.match}: ${h.note}); for the owner to decide`);
  if (naming.withoutList.length > 0) progress(`name-check: no naming blocklist published for ${naming.withoutList.join(', ')}`);
  if (values.out) progress(`name-check: ${writeText(values.out, `${JSON.stringify(report, null, 2)}\n`)}`);
  if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}

/** @param {string[]} argv @returns {Promise<number>} */
async function cmdHashes(argv) {
  const { values, positionals } = cli(argv, { json: { type: 'boolean' } }, `Usage: node brand.mjs hashes <file> [<file> ...] [--json]

Prints each file's raw SHA-256 and its normalised identity: SVG by the SHA-256 of its canonical SVGO text, ICO and
PNG by the SHA-256 of each image's decoded pixels. Use it to add a framework's template favicon to the list in
brand-check.mjs from a fresh copy of the template (FD12-F27).`);
  if (positionals.length === 0) throw new UsageError('hashes needs at least one file; run with --help');
  const out = positionals.map((file) => ({ file: toPosix(path.resolve(file)), ...fileIdentity(readBinary(file, 'file')) }));
  for (const o of out) progress(`${o.file}: ${o.kind} ${o.bytes} bytes sha256 ${o.sha256}${o.canonicalSha256 ? ` canonical ${o.canonicalSha256}` : ''}${o.images ? ` images ${o.images.map((i) => `${i.width}x${i.height}:${i.pixelSha256.slice(0, 16)}`).join(' ')}` : ''}`);
  if (values.json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  return 0;
}

const COMMANDS = /** @type {Record<string, (argv: string[]) => Promise<number>>} */ ({
  wordmark: cmdWordmark,
  lint: cmdLint,
  render: cmdRender,
  icons: cmdIcons,
  og: cmdOg,
  sheet: cmdSheet,
  'name-check': cmdNameCheck,
  hashes: cmdHashes,
});

/**
 * @param {string[]} argv arguments after the script path
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const [command, ...rest] = argv;
  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(`${GLOBAL_HELP}\n`);
    return 0;
  }
  if (!command) throw new UsageError(`a command is required (${Object.keys(COMMANDS).join(', ')}); run node brand.mjs --help`);
  const run = COMMANDS[command];
  if (!run) throw new UsageError(`unknown command "${command}"; commands: ${Object.keys(COMMANDS).join(', ')}`);
  return run(rest);
}

/** @returns {boolean} */
function isMain() {
  return isMainModule(import.meta.url);
}

if (isMain()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => exitWith(err instanceof FrontendError ? err : err instanceof Error && /Executable doesn't exist/.test(err.message) ? new EnvError(err.message, { cause: err }) : err),
  );
}
