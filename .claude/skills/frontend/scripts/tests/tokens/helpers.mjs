// @ts-check
/**
 * Test helpers for tokens.mjs: tiny generated fonts (opentype.js), WOFF and WOFF2 encoders, and temporary copies of
 * the fixture repositories.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
// @ts-ignore -- opentype.js 2.0.0 ships no type declarations.
import opentype from 'opentype.js';
import { WOFF2_TAGS, build, fontTables } from '../../tokens.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPTS = path.resolve(HERE, '..', '..');
export const FIXTURES = path.resolve(HERE, '..', 'fixtures', 'tokens');
export const TOKENS_CLI = path.join(SCRIPTS, 'tokens.mjs');

/**
 * @typedef {{family?: string, style?: string, digitWidths?: number[], tnum?: boolean, monospace?: boolean,
 *   panose?: number[]}} FontSpec
 */

/** @param {number} w @returns {any} */
function box(w) {
  const p = new opentype.Path();
  p.moveTo(40, 0);
  p.lineTo(Math.max(60, w - 40), 0);
  p.lineTo(Math.max(60, w - 40), 700);
  p.lineTo(40, 700);
  p.close();
  return p;
}

/**
 * A CFF OpenType font with digits, A-Z and, for monospace, all printable ASCII at one width.
 * @param {FontSpec} [spec] @returns {Buffer}
 */
export function makeFont({ family = 'Fixture Sans', style = 'Regular', digitWidths, tnum = false, monospace = false, panose } = {}) {
  const widths = digitWidths ?? (monospace ? Array(10).fill(600) : [520, 440, 520, 520, 540, 520, 530, 500, 530, 530]);
  const glyphs = [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 500, path: new opentype.Path() })];
  for (let d = 0; d < 10; d += 1) glyphs.push(new opentype.Glyph({ name: `digit${d}`, unicode: 48 + d, advanceWidth: widths[d], path: box(widths[d]) }));
  const tnumStart = glyphs.length;
  if (tnum) for (let d = 0; d < 10; d += 1) glyphs.push(new opentype.Glyph({ name: `digit${d}.tnum`, advanceWidth: 560, path: box(560) }));
  const codes = monospace
    ? [...Array(94).keys()].map((i) => 33 + i).filter((c) => c < 48 || c > 57)
    : [...Array(26).keys()].map((i) => 65 + i);
  for (const code of codes) {
    const w = monospace ? 600 : 560 + (code % 5) * 30;
    glyphs.push(new opentype.Glyph({ name: `u${code.toString(16).padStart(4, '0')}`, unicode: code, advanceWidth: w, path: box(w) }));
  }
  /** @type {Record<string, unknown>} */
  const options = { familyName: family, styleName: style, unitsPerEm: 1000, ascender: 800, descender: -200, glyphs };
  if (panose) options.panose = panose;
  const font = new opentype.Font(options);
  if (tnum) for (let d = 0; d < 10; d += 1) font.substitution.addSingle('tnum', { sub: 1 + d, by: tnumStart + d });
  return Buffer.from(font.toArrayBuffer());
}

/**
 * WOFF 1.0 with every table zlib-compressed.
 * @param {Buffer} sfnt @returns {Buffer}
 */
export function toWoff(sfnt) {
  const { flavor, tables } = fontTables(sfnt);
  const tags = [...tables.keys()].sort();
  const parts = tags.map((tag) => {
    const orig = /** @type {Buffer} */ (tables.get(tag));
    const comp = zlib.deflateSync(orig);
    return { tag, orig, data: comp.length < orig.length ? comp : orig };
  });
  let offset = 44 + 20 * tags.length;
  const dir = Buffer.alloc(20 * tags.length);
  /** @type {Buffer[]} */
  const chunks = [];
  parts.forEach((p, i) => {
    dir.write(p.tag, i * 20, 4, 'latin1');
    dir.writeUInt32BE(offset, i * 20 + 4);
    dir.writeUInt32BE(p.data.length, i * 20 + 8);
    dir.writeUInt32BE(p.orig.length, i * 20 + 12);
    dir.writeUInt32BE(0, i * 20 + 16);
    const padded = Buffer.alloc((p.data.length + 3) & ~3);
    p.data.copy(padded);
    chunks.push(padded);
    offset += padded.length;
  });
  const header = Buffer.alloc(44);
  header.write('wOFF', 0, 4, 'latin1');
  header.writeUInt32BE(flavor >>> 0, 4);
  header.writeUInt32BE(offset, 8);
  header.writeUInt16BE(tags.length, 12);
  return Buffer.concat([header, dir, ...chunks]);
}

/** @param {number} n @returns {number[]} */
function base128(n) {
  const bytes = [];
  let v = n;
  do {
    bytes.unshift(v & 0x7f);
    v = Math.floor(v / 128);
  } while (v > 0);
  for (let i = 0; i < bytes.length - 1; i += 1) bytes[i] |= 0x80;
  return bytes;
}

/**
 * @typedef {{tag: string, data: Buffer, version: number, origLength?: number}} Woff2Entry
 */

/**
 * WOFF2 from explicit entries (transform versions as given; transformed tables carry their transformed bytes).
 * @param {number} flavor @param {Woff2Entry[]} entries @returns {Buffer}
 */
export function encodeWoff2(flavor, entries) {
  /** @type {number[]} */
  const dir = [];
  for (const e of entries) {
    const index = WOFF2_TAGS.indexOf(e.tag);
    dir.push((index >= 0 ? index : 63) | (e.version << 6));
    if (index < 0) dir.push(...Buffer.from(e.tag, 'latin1'));
    dir.push(...base128(e.origLength ?? e.data.length));
    const transformed = e.tag === 'glyf' || e.tag === 'loca' ? e.version !== 3 : e.version !== 0;
    if (transformed) dir.push(...base128(e.data.length));
  }
  const compressed = zlib.brotliCompressSync(Buffer.concat(entries.map((e) => e.data)));
  const header = Buffer.alloc(48);
  header.write('wOF2', 0, 4, 'latin1');
  header.writeUInt32BE(flavor >>> 0, 4);
  header.writeUInt32BE(48 + dir.length + compressed.length, 8);
  header.writeUInt16BE(entries.length, 12);
  header.writeUInt32BE(entries.reduce((n, e) => n + (((e.origLength ?? e.data.length) + 3) & ~3), 12 + 16 * entries.length), 16);
  header.writeUInt32BE(compressed.length, 20);
  header.writeUInt16BE(1, 24);
  return Buffer.concat([header, Buffer.from(dir), compressed]);
}

/**
 * WOFF2 of a font with null transforms on every table.
 * @param {Buffer} sfnt @returns {Buffer}
 */
export function toWoff2(sfnt) {
  const { flavor, tables } = fontTables(sfnt);
  return encodeWoff2(flavor, [...tables].map(([tag, data]) => ({ tag, data, version: 0 })));
}

/**
 * A TrueType-flavoured WOFF2 whose glyf and loca are "transformed" (opaque bytes the reader must skip) and whose
 * hmtx uses transform version 1 with both side-bearing arrays omitted: the shape real WOFF2 files have.
 * @param {Buffer} sfnt a font from makeFont() @returns {Buffer}
 */
export function toTransformedWoff2(sfnt) {
  const { tables } = fontTables(sfnt);
  const hhea = /** @type {Buffer} */ (tables.get('hhea'));
  const maxp = /** @type {Buffer} */ (tables.get('maxp'));
  const hmtx = /** @type {Buffer} */ (tables.get('hmtx'));
  const numberOfHMetrics = hhea.readUInt16BE(34);
  const numGlyphs = maxp.readUInt16BE(4);
  const advances = Buffer.alloc(1 + numberOfHMetrics * 2);
  advances[0] = 3;
  for (let i = 0; i < numberOfHMetrics; i += 1) advances.writeUInt16BE(hmtx.readUInt16BE(i * 4), 1 + i * 2);
  /** @type {Woff2Entry[]} */
  const entries = [];
  for (const [tag, data] of tables) {
    if (tag === 'CFF ' || tag === 'hmtx') continue;
    entries.push({ tag, data, version: 0 });
  }
  entries.push({ tag: 'glyf', data: Buffer.from('opaque transformed glyf stream, never decoded'), version: 0, origLength: 4096 });
  entries.push({ tag: 'loca', data: Buffer.alloc(0), version: 0, origLength: (numGlyphs + 1) * 2 });
  entries.push({ tag: 'hmtx', data: advances, version: 1, origLength: numberOfHMetrics * 4 + (numGlyphs - numberOfHMetrics) * 2 });
  return encodeWoff2(0x00010000, entries);
}

/**
 * A temporary copy of a fixture repository; `cleanup()` removes it.
 * @param {string} name a folder under tests/fixtures/tokens @returns {{dir: string, cleanup: () => void}}
 */
export function copyFixture(name) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `fe-tokens-${name}-`));
  cpSync(path.join(FIXTURES, name), dir, { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * An empty temporary folder; `cleanup()` removes it.
 * @param {string} label @returns {{dir: string, cleanup: () => void}}
 */
export function tempDir(label) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `fe-tokens-${label}-`));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Runs the tokens CLI. @param {string[]} args @param {{cwd?: string}} [opts]
 * @returns {{code: number | null, stdout: string, stderr: string}}
 */
export function cli(args, { cwd = SCRIPTS } = {}) {
  const r = spawnSync(process.execPath, [TOKENS_CLI, ...args], { encoding: 'utf8', cwd, timeout: 120000 });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/**
 * Default build options for a repository (CSS at <design>/tokens.css).
 * @param {string} dir @param {Partial<import('../../tokens.mjs').BuildOptions>} [over]
 * @returns {import('../../tokens.mjs').BuildOptions}
 */
export function buildOptions(dir, over = {}) {
  return { css: path.join(dir, 'design', 'tokens.css'), tailwind: 'auto', fontFace: true, darkMedia: true, mirror: null, force: false, ...over };
}

/**
 * A built copy of the good fixture: tokens.css and DESIGN.md generated.
 * @returns {Promise<{dir: string, design: string, cleanup: () => void}>}
 */
export async function builtGood() {
  const copy = copyFixture('good');
  const design = path.join(copy.dir, 'design');
  await build({ root: copy.dir, design }, buildOptions(copy.dir));
  return { dir: copy.dir, design, cleanup: copy.cleanup };
}

/**
 * Reads, changes and writes a JSON file.
 * @param {string} file @param {(data: any) => void} change
 */
export function editJson(file, change) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  change(data);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
