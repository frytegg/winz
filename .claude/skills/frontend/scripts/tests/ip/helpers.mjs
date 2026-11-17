// @ts-check
/*
 * Test helpers for ip-check: fonts generated with opentype.js (rectangles as glyphs, so no third-party outline is
 * ever committed), WOFF and WOFF2 wrappers, and temporary copies of the fixture repositories with their state
 * folder, captures and a sponsor allowlist whose hashes are computed from the fixture files.
 */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, deflateSync } from 'node:zlib';
// @ts-expect-error opentype.js 2.0.0 ships no type declarations (its main is a UMD build: default import only)
import opentype from 'opentype.js';

const { Font, Glyph, Path } = opentype;

export const FIXTURES = fileURLToPath(new URL('../fixtures/ip/', import.meta.url));

/**
 * An OpenType (CFF) font whose glyphs are rectangles. `coverage` 'basic' maps U+0020-007E; 'full' also maps
 * Latin-1 and Latin Extended-A, as a full upstream build would.
 * @param {{family: string, copyright?: string, license?: string, licenseURL?: string, coverage?: 'basic' | 'full'}} options
 * @returns {Buffer}
 */
export function makeFont({ family, copyright = ' ', license = ' ', licenseURL = ' ', coverage = 'basic' }) {
  const glyphs = [new Glyph({ name: '.notdef', advanceWidth: 500, path: new Path() })];
  /** @type {number[]} */
  const points = [];
  for (let cp = 0x20; cp < 0x7f; cp += 1) points.push(cp);
  if (coverage === 'full') for (let cp = 0xa0; cp <= 0x17f; cp += 1) points.push(cp);
  for (const cp of points) {
    const p = new Path();
    p.moveTo(60, 0);
    p.lineTo(440, 0);
    p.lineTo(440, 520);
    p.lineTo(60, 520);
    p.close();
    glyphs.push(new Glyph({ name: `u${cp.toString(16)}`, unicode: cp, advanceWidth: 500, path: p }));
  }
  const font = new Font({ familyName: family, styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs, copyright, license, licenseURL });
  return Buffer.from(font.toArrayBuffer());
}

/**
 * @param {Buffer} sfnt
 * @returns {Array<{tag: string, data: Buffer}>}
 */
export function sfntTables(sfnt) {
  const n = sfnt.readUInt16BE(4);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const at = 12 + 16 * i;
    const offset = sfnt.readUInt32BE(at + 8);
    const length = sfnt.readUInt32BE(at + 12);
    out.push({ tag: sfnt.toString('latin1', at, at + 4), data: sfnt.subarray(offset, offset + length) });
  }
  return out;
}

/**
 * WOFF 1.0 wrapper (zlib-compressed tables).
 * @param {Buffer} sfnt
 * @returns {Buffer}
 */
export function toWoff(sfnt) {
  const tables = sfntTables(sfnt);
  const header = Buffer.alloc(44);
  header.write('wOFF', 0, 'latin1');
  header.writeUInt32BE(sfnt.readUInt32BE(0), 4);
  header.writeUInt16BE(tables.length, 12);
  header.writeUInt32BE(sfnt.length, 16);
  header.writeUInt16BE(1, 20);
  const directory = Buffer.alloc(20 * tables.length);
  /** @type {Buffer[]} */
  const bodies = [];
  let offset = 44 + directory.length;
  tables.forEach((t, i) => {
    const packed = deflateSync(t.data);
    const data = packed.length < t.data.length ? packed : t.data;
    const at = 20 * i;
    directory.write(t.tag, at, 'latin1');
    directory.writeUInt32BE(offset, at + 4);
    directory.writeUInt32BE(data.length, at + 8);
    directory.writeUInt32BE(t.data.length, at + 12);
    const padded = Buffer.alloc((data.length + 3) & ~3);
    data.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  });
  const out = Buffer.concat([header, directory, ...bodies]);
  out.writeUInt32BE(out.length, 8);
  return out;
}

const WOFF2_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF '];

/**
 * @param {number} n
 * @returns {number[]}
 */
function base128(n) {
  /** @type {number[]} */
  const bytes = [];
  let v = n;
  do {
    bytes.unshift(v & 0x7f);
    v >>>= 7;
  } while (v);
  return bytes.map((b, i) => (i < bytes.length - 1 ? b | 0x80 : b));
}

/**
 * WOFF2 wrapper with null transforms. With `truetypeStub`, the CFF table is dropped and transformed glyf and loca
 * entries (opaque bytes) are added under a TrueType flavour, the shape of a typical WOFF2 that the checker must
 * read without reconstructing outlines.
 * @param {Buffer} sfnt
 * @param {{truetypeStub?: boolean}} [options]
 * @returns {Buffer}
 */
export function toWoff2(sfnt, { truetypeStub = false } = {}) {
  /** @type {Array<{tag: string, data: Buffer, version: number, origLength?: number}>} */
  let tables = sfntTables(sfnt).map((t) => ({ ...t, version: 0 }));
  let flavor = sfnt.readUInt32BE(0);
  if (truetypeStub) {
    tables = tables.filter((t) => t.tag !== 'CFF ');
    tables.push({ tag: 'glyf', data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), version: 0, origLength: 4096 });
    tables.push({ tag: 'loca', data: Buffer.alloc(0), version: 0, origLength: 512 });
    flavor = 0x00010000;
  }
  /** @type {number[]} */
  const directory = [];
  /** @type {Buffer[]} */
  const chunks = [];
  for (const t of tables) {
    const index = WOFF2_TAGS.indexOf(t.tag);
    directory.push((index < 0 ? 63 : index) | (t.version << 6));
    if (index < 0) directory.push(...Buffer.from(t.tag, 'latin1'));
    directory.push(...base128(t.origLength ?? t.data.length));
    const transformed = t.tag === 'glyf' || t.tag === 'loca' ? t.version !== 3 : t.version !== 0;
    if (transformed) directory.push(...base128(t.data.length));
    chunks.push(t.data);
  }
  const compressed = brotliCompressSync(Buffer.concat(chunks));
  const header = Buffer.alloc(48);
  header.write('wOF2', 0, 'latin1');
  header.writeUInt32BE(flavor, 4);
  header.writeUInt16BE(tables.length, 12);
  header.writeUInt32BE(compressed.length, 20);
  header.writeUInt16BE(1, 24);
  const out = Buffer.concat([header, Buffer.from(directory), compressed]);
  out.writeUInt32BE(out.length, 8);
  return out;
}

/**
 * @param {string | Buffer} data
 * @returns {string}
 */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * @param {string} file
 * @param {string | Buffer} data
 */
function put(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
}

/**
 * A temporary workspace with both fixture repositories completed (fonts, copies of the shared SVGs and licences),
 * a state folder with brief.json, refs-index.json and two captures, and a sponsor allowlist with the fixture hashes.
 * @returns {{tmp: string, pass: string, fail: string, state: string, emptyState: string, sponsorFile: string}}
 */
export function makeWorkspace() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-ip-'));
  const pass = path.join(tmp, 'pass');
  const fail = path.join(tmp, 'fail');
  cpSync(path.join(FIXTURES, 'pass'), pass, { recursive: true });
  cpSync(path.join(FIXTURES, 'fail'), fail, { recursive: true });
  const shared = (/** @type {string} */ name) => readFileSync(path.join(FIXTURES, 'shared', name));
  const testchain = shared('testchain-horizontal.svg');
  const denied = shared('deniedchain-logo.svg');
  const mark = readFileSync(path.join(pass, 'brand', 'mark.svg'));

  const testSans = toWoff2(makeFont({ family: 'Test Sans', license: 'This Font Software is licensed under the SIL Open Font License, Version 1.1.', licenseURL: 'https://openfontlicense.org' }), { truetypeStub: true });
  put(path.join(pass, 'design', 'fonts', 'TestSans-Regular.woff2'), testSans);
  put(path.join(pass, 'design', 'fonts', 'OFL.txt'), shared('OFL.txt'));
  put(path.join(pass, 'dist', 'fonts', 'TestSans-Regular.woff2'), testSans);
  put(path.join(pass, 'dist', 'fonts', 'OFL.txt'), shared('OFL.txt'));
  put(path.join(pass, 'public', 'testchain-horizontal.svg'), testchain);
  put(path.join(pass, 'dist', 'img', 'testchain-horizontal.svg'), testchain);
  put(path.join(pass, 'dist', 'img', 'hero.svg'), readFileSync(path.join(pass, 'public', 'hero.svg')));
  put(path.join(pass, 'dist', 'img', 'mark.svg'), mark);

  put(path.join(fail, 'brand', 'mark.svg'), mark);
  put(path.join(fail, 'public', 'deniedchain-logo.svg'), denied);
  put(path.join(fail, 'dist', 'img', 'mark.svg'), mark);
  put(path.join(fail, 'dist', 'img', 'testchain-horizontal.svg'), testchain);
  put(path.join(fail, 'dist', 'img', 'deniedchain-logo.svg'), denied);
  put(path.join(fail, 'dist', 'img', 'partner-northwind.svg'), readFileSync(path.join(fail, 'public', 'partners', 'partner-northwind.svg')));
  put(path.join(fail, 'dist', 'img', 'partner-fjord.svg'), readFileSync(path.join(fail, 'public', 'partners', 'partner-fjord.svg')));
  put(path.join(fail, 'dist', 'fonts', 'OFL.txt'), shared('OFL-RFN.txt'));
  put(path.join(fail, 'dist', 'fonts', 'plexish-latin.woff2'), toWoff2(makeFont({ family: 'Plexish Sans', copyright: 'Copyright 2026 Plexish Fixture Corp. with Reserved Font Name "Plexish"', license: 'SIL Open Font License, Version 1.1' })));
  put(path.join(fail, 'dist', 'fonts', 'kitgrotesk.woff2'), toWoff(makeFont({ family: 'Kit Grotesk', license: 'SIL Open Font License, Version 1.1' })));
  put(path.join(fail, 'dist', 'fonts2', 'nolicence.woff2'), toWoff2(makeFont({ family: 'Nolicence Sans' })));

  const state = path.join(tmp, 'state');
  const captures = path.join(tmp, 'captures');
  put(path.join(captures, 'fjord', 'text.json'), JSON.stringify({ texts: [
    'Settle every cross border invoice in seconds with fully automated compliance checks.',
    'This site uses cookies to improve your experience and analyse traffic.',
  ] }));
  put(path.join(captures, 'northwind', 'notes.txt'), 'Northwind moves freight across the Baltic every single night of the year.\n\nThis site uses cookies to improve your experience and analyse traffic.\n');
  put(path.join(state, 'brief.json'), JSON.stringify({ project: { name: 'Orbitly', name_status: 'final', source: 'spec.md:1' }, customers: [{ name: 'Fjord Pay', category: 'payments', url: '', url_source: '', owner_confirmed: true }] }));
  put(path.join(state, 'refs-index.json'), JSON.stringify({ captures: [
    { id: 'R1', customer: 'Fjord Pay', dir: path.join(captures, 'fjord') },
    { id: 'R2', customer: 'Northwind', dir: path.join(captures, 'northwind') },
    { id: 'R3', customer: 'Gone Corp', dir: path.join(captures, 'purged-already') },
  ] }));
  const emptyState = path.join(tmp, 'state-empty');
  mkdirSync(emptyState, { recursive: true });

  const sponsorFile = path.join(tmp, 'sponsor-allowlist.json');
  put(sponsorFile, JSON.stringify({ sponsor_allowlist: [
    {
      sponsor: 'testchain',
      display_name: 'Testchain (protocol marks)',
      logo_default: 'official_file_unaltered_allowed',
      approval_evidence: null,
      logo_sources: [{ variant: 'horizontal-blue', format: 'svg', sha256: sha256(testchain) }],
      forbidden_phrases: [
        { regex: "\\bTestchain['\u2019]s\\b", flags: '', basis: 'no possessive' },
        { regex: '\\bOfficial\\s+Testchain\\b', flags: 'i', basis: 'implied endorsement' },
        { regex: '\\bTestchain Live\\b', flags: '', basis: 'renamed product (advisory)', severity: 'advisory' },
      ],
      naming_blocklist: ['TESTCHAIN'],
      clear_space: { rule: 'one mark height', min_size: { web_px: 64, tablet_px: 60, phone_px: 56, dimension: 'not stated' } },
      trademark_notice: { with_logo: 'Testchain\u2122 is a trademark of the Test Foundation.' },
      typography: [{ family: 'Kit Grotesk', licence: 'proprietary: non-transferable kit licence' }, { family: 'Open Kit Sans', licence: 'OFL-1.1' }],
    },
    {
      sponsor: 'deniedchain',
      display_name: 'Deniedchain',
      logo_default: 'text_only',
      approval_evidence: null,
      logo_sources: [{ variant: 'logo', format: 'svg', sha256: sha256(denied) }],
      forbidden_phrases: [{ regex: '\\bPowered by Deniedchain\\b', flags: 'i', basis: 'no badge' }],
    },
  ] }, null, 2));
  return { tmp, pass, fail, state, emptyState, sponsorFile };
}
