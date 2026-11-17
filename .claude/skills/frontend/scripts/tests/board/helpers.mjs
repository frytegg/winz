// @ts-check
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

export const SCRIPTS = fileURLToPath(new URL('../../', import.meta.url));
export const BOARD = path.join(SCRIPTS, 'board.mjs');
export const FIXTURES = path.join(SCRIPTS, 'tests', 'fixtures', 'board');
export const RULES = path.join(FIXTURES, 'rules');
export const REGISTRY = path.join(RULES, 'registry.json');
export const GENERIC = path.join(FIXTURES, 'similar-prompt');

/**
 * A fresh temporary folder under FRONTEND_TEST_TMP (when set) or the OS temp folder.
 * @param {string} prefix
 * @returns {string}
 */
export function tempDir(prefix) {
  const base = process.env.FRONTEND_TEST_TMP || os.tmpdir();
  mkdirSync(base, { recursive: true });
  return mkdtempSync(path.join(base, prefix));
}

/**
 * Writes a small OpenType font named `family` whose printable ASCII glyphs are boxes (opentype.js, a pinned
 * dependency), so a comp can load a real custom font without a binary fixture.
 * @param {string} file
 * @param {string} family
 * @returns {Promise<void>}
 */
export async function writeFixtureFont(file, family) {
  const require = createRequire(path.join(SCRIPTS, 'package.json'));
  const opentype = (await import(pathToFileURL(require.resolve('opentype.js')).href)).default;
  const glyphs = [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 600, path: new opentype.Path() })];
  for (let c = 32; c < 127; c += 1) {
    const p = new opentype.Path();
    if (c !== 32) {
      p.moveTo(60, 0);
      p.lineTo(540, 0);
      p.lineTo(540, 680);
      p.lineTo(60, 680);
      p.close();
    }
    glyphs.push(new opentype.Glyph({ name: `g${c}`, unicode: c, advanceWidth: 600, path: p }));
  }
  const font = new opentype.Font({ familyName: family, styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(font.toArrayBuffer()));
}

/**
 * Writes a valid, blank RGBA PNG of the given size.
 * @param {string} file
 * @param {number} width
 * @param {number} height
 */
export function writePng(file, width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (/** @type {Buffer} */ b) => {
    let c = 0xffffffff;
    for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (/** @type {string} */ type, /** @type {Buffer} */ data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

/**
 * A copy of the fixture state (brief, directions A and B) with the font direction A plans, plus `extra` directions
 * copied from fixtures/board/bad.
 * @param {string[]} [extra]
 * @returns {Promise<string>}
 */
export async function fixtureState(extra = []) {
  const state = tempDir('fe-board-state-');
  cpSync(path.join(FIXTURES, 'state'), state, { recursive: true });
  await writeFixtureFont(path.join(state, 'directions', 'A', 'fonts', 'fixture-grotesk.otf'), 'Fixture Grotesk');
  for (const id of extra) cpSync(path.join(FIXTURES, 'bad', id), path.join(state, 'directions', id), { recursive: true });
  return state;
}

/**
 * Runs board.mjs in a child process.
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 * @returns {{status: number | null, stdout: string, stderr: string, json: any}}
 */
export function runCli(args, env = {}) {
  const res = spawnSync(process.execPath, [BOARD, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 240000 });
  /** @type {any} */
  let json = null;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    json = null;
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}
