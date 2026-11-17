// @ts-check
/**
 * Builds the qa fixtures' web font with opentype.js: one OpenType file whose internal family name ("Qa Block")
 * differs from the @font-face alias the fixture pages use ("Fixture Sans"), so render.fonts has to resolve an alias
 * the way it does on a real build. Every glyph is a solid block, which also gives the contrast tests large, solid
 * glyph interiors. The bytes are deterministic (fixed timestamp), and a test compares the committed file with this
 * builder's output. Regenerate with: node tests/qa/fixture-font.mjs
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../../lib/args.mjs';

/** opentype.js ships no type declarations; loading it through require keeps the type check strict elsewhere. */
/** @type {any} */
const opentype = createRequire(import.meta.url)('opentype.js');

export const FIXTURE_FONT_PATH = fileURLToPath(new URL('../fixtures/qa/site/fonts/qa-block.otf', import.meta.url));
export const FIXTURE_FONT_FAMILY = 'Qa Block';
const CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:;!?-\'"()/&%+';
const CREATED = 1767225600;

/**
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
 * @returns {any}
 */
function block(x0, y0, x1, y1) {
  const p = new opentype.Path();
  p.moveTo(x0, y0);
  p.lineTo(x0, y1);
  p.lineTo(x1, y1);
  p.lineTo(x1, y0);
  p.close();
  return p;
}

/**
 * The font file's bytes.
 * @returns {Buffer}
 */
export function buildFixtureFont() {
  const glyphs = [
    new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 600, path: block(50, 0, 550, 700) }),
    new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: 280, path: new opentype.Path() }),
  ];
  for (const ch of CHARACTERS) {
    const lower = /[a-z]/.test(ch);
    const narrow = /[.,:;!'"()]/.test(ch);
    const width = narrow ? 300 : 600;
    glyphs.push(new opentype.Glyph({
      name: `u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
      unicode: ch.charCodeAt(0),
      advanceWidth: width,
      path: block(60, 0, width - 60, lower ? 500 : 700),
    }));
  }
  const font = new opentype.Font({
    familyName: FIXTURE_FONT_FAMILY,
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    createdTimestamp: CREATED,
    glyphs,
  });
  return normaliseHead(Buffer.from(font.toArrayBuffer()));
}

/**
 * OpenType checksum: the sum of big-endian 32-bit words, the last one zero-padded.
 * @param {Buffer} bytes
 * @returns {number}
 */
function checksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    sum = (sum + (((bytes[i] << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0)) >>> 0)) >>> 0;
  }
  return sum;
}

/**
 * opentype.js stamps the head table's `modified` date with the current time and has no option for it; this sets it
 * to the `created` date and recomputes the head checksum and the font's checkSumAdjustment, so every build is
 * byte-identical.
 * @param {Buffer} font
 * @returns {Buffer}
 */
function normaliseHead(font) {
  const tables = font.readUInt16BE(4);
  for (let i = 0; i < tables; i += 1) {
    const record = 12 + i * 16;
    if (font.toString('latin1', record, record + 4) !== 'head') continue;
    const offset = font.readUInt32BE(record + 8);
    const length = font.readUInt32BE(record + 12);
    font.copy(font, offset + 28, offset + 20, offset + 28);
    font.writeUInt32BE(0, offset + 8);
    font.writeUInt32BE(checksum(font.subarray(offset, offset + length)), record + 4);
    font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, offset + 8);
  }
  return font;
}

if (isMainModule(import.meta.url)) {
  writeFileSync(FIXTURE_FONT_PATH, buildFixtureFont());
  process.stderr.write(`wrote ${FIXTURE_FONT_PATH.replace(/\\/g, '/')}\n`);
}
