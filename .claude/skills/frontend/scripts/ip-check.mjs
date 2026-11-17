// @ts-check
/*
 * ip-check: what the judged surface borrows. Fonts (licence from the name table plus a shipped licence file, OFL
 * Reserved Font Names on subsets, sponsor-kit faces), Google Fonts hotlinks, third-party logos, asset provenance,
 * concept labels beside customer names, word overlap with captured customer copy, and sponsor-mark treatment.
 * Sources: research/policy-copying-and-ip.md (FD09), research/sponsor-brand-kits.md (FD21),
 * research/stack-components-typography.md (FD16-F11, F12, F30). Not legal advice: ambiguous rules take the
 * conservative reading, as the dossiers do.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
// @ts-expect-error opentype.js 2.0.0 ships no type declarations (its main is a UMD build: default import only)
import opentype from 'opentype.js';
import { parseCli, isMainModule } from './lib/args.mjs';
import { launch, newContext, goto } from './lib/browser.mjs';
import { selectorFor } from './lib/dom.mjs';
import { CheckError, EnvError, FrontendError, UsageError, exitWith } from './lib/errors.mjs';
import { readText, sha256File, toPosix, walk, writeText } from './lib/fsutil.mjs';
import { checkStateDir, designDir } from './lib/paths.mjs';
import { loadProfile } from './lib/profile.mjs';
import { waitReady } from './lib/ready.mjs';
import { aggregate, gate, writeReport } from './lib/report.mjs';
import { loadRoutes, routeUrl } from './lib/routes.mjs';
import { serveStatic } from './lib/serve.mjs';
import { stripComments, lineOf } from './lib/text.mjs';
import { sourceFiles } from './rules/load.mjs';

/**
 * @typedef {import('./lib/report.mjs').GateResult} GateResult
 * @typedef {import('./lib/report.mjs').Evidence} Evidence
 * @typedef {import('./lib/profile.mjs').Profile} Profile
 * @typedef {import('./lib/profile.mjs').Viewport} Viewport
 * @typedef {import('./lib/routes.mjs').Route} Route
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('playwright-core').Page} Page
 * @typedef {{root: string, profile: Profile, state: string | null, design: string, routes: Route[],
 *   baseUrl: string | null, browser: Browser | null, viewports: Viewport[], args: Record<string, unknown>,
 *   log: (message: string) => void}} CheckContext
 */

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SPONSOR_FILE = toPosix(path.join(SCRIPTS_DIR, '..', 'assets', 'sponsor-allowlist.json'));
const TOOL = 'ip-check';

export const GATES = Object.freeze([
  Object.freeze({
    id: 'ip.fonts',
    title: 'Every shipped font is OFL, Apache, UFL or MIT with its licence file; no Reserved Font Name kept on a subset; no sponsor-kit face',
    ifDropped: 'a font with no licence, a subset that keeps an OFL Reserved Font Name, an FFL face or a sponsor kit\'s commercial face would ship',
  }),
  Object.freeze({
    id: 'ip.hotlinks',
    title: 'No request to or source reference of fonts.googleapis.com or fonts.gstatic.com',
    ifDropped: 'every visitor\'s IP address would go to Google\'s font CDN (sanctioned by LG München I) and a venue without wifi would lose the fonts',
  }),
  Object.freeze({
    id: 'ip.logos',
    title: 'No third-party logo outside the project\'s brand files and the hash-matched sponsor files whose rules allow them',
    ifDropped: 'a customer or sponsor logo whose owner requires permission, or a "trusted by" logo row, would ship without it',
  }),
  Object.freeze({
    id: 'ip.provenance',
    title: 'Every asset file has a complete design/provenance.json entry',
    ifDropped: 'an image, icon, font or video of unknown source, licence or AI status would ship',
  }),
  Object.freeze({
    id: 'ip.concept-label',
    title: 'A section that names a customer from the brief carries a visible data-concept-label',
    ifDropped: 'a frame naming a real company could read as its endorsement or a commercial relationship',
  }),
  Object.freeze({
    id: 'ip.copy-overlap',
    title: 'No run of 8 or more words shared with captured customer copy',
    ifDropped: 'a customer\'s headline, tagline or microcopy could be reused verbatim',
  }),
  Object.freeze({
    id: 'ip.sponsor-marks',
    title: 'Sponsor logos unaltered, large enough, never the focal point or locked up with our mark, with their notice; sponsor names written as their rules allow',
    ifDropped: 'a sponsor mark could be altered, animated, shown below its minimum size, made the focal point, locked up with the project mark, shown without its trademark notice, or written in a forbidden way',
  }),
]);

/** Gates that need rendered pages (a browser and a base URL). */
const RUNTIME_GATES = new Set(['ip.hotlinks', 'ip.logos', 'ip.concept-label', 'ip.copy-overlap', 'ip.sponsor-marks', 'ip.fonts']);
/** Gates whose verdict cannot stand on files alone: without pages they are skipped unless the files already fail them. */
const RENDER_REQUIRED = new Set(['ip.concept-label', 'ip.copy-overlap', 'ip.sponsor-marks']);

const SHINGLE_WORDS = 8;
const FONT_FILE = /\.(?:woff2?|ttf|otf|eot)$/i;
const IMAGE_FILE = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|bmp|tiff?)$/i;
const MEDIA_FILE = /\.(?:mp4|webm|mov|m4v|ogv|mp3|wav|ogg|oga|m4a|aac|flac|glb|gltf|pdf)$/i;
const DATA_FILE = /\.(?:json|csv|tsv|geojson|topojson|parquet|arrow)$/i;
const CONFIG_NAMES = new Set([
  'manifest.json', 'site.webmanifest', 'browserconfig.xml', 'robots.txt', 'sitemap.xml', 'humans.txt', 'security.txt',
  '_redirects', '_headers', 'cname', '.nojekyll', 'vercel.json', 'netlify.toml', 'package.json', 'tsconfig.json',
]);
const ASSET_DIRS = /(?:^|\/)(?:brand|public|static|assets|images|img|media|fonts|data)\//i;
const TEST_DIRS = ['test', 'tests', '__tests__', 'fixtures', '__fixtures__', 'e2e', 'cypress', 'playwright-report', 'test-results', '.storybook'];
const LOGO_NAME = /(?:^|[\/_.\-\s])(?:logo|logos|logotype|logomark|wordmark|lockup|brandmark|badge|badges|partner|partners|sponsor|sponsors|client|clients|customer|customers|trusted-?by|powered-?by|as-?seen-?on)(?=[\/_.\-\s\d]|$)/i;
const LOGO_WORD = /\blogo(?:s|type|mark)?\b/i;
const TRUSTED_CONTEXT = /\b(?:trusted by|partners?|backed by|used by|our (?:customers|clients)|as seen (?:on|in)|powered by|in partnership with|supported by|featured (?:on|in)|investors|sponsors?)\b/i;
const GOOGLE_FONTS = /fonts\.(?:googleapis|gstatic)\.com/i;
const DISCLAIMER = /\b(?:not affiliated|concept(?:ual)? (?:mock-?up|illustration|frame)|sans lien|maquette conceptuelle|illustration conceptuelle)\b/i;

// ---------------------------------------------------------------------------------------------------------------
// Fonts: name table (opentype.js; WOFF2 through Node's Brotli), licence files, Reserved Font Names, subsets.
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{format: 'ttf' | 'otf' | 'woff' | 'woff2' | 'eot' | 'unknown', family: string | null,
 *   typoFamily: string | null, fullName: string | null, postScriptName: string | null, copyright: string | null,
 *   license: string | null, licenseUrl: string | null, manufacturer: string | null, numGlyphs: number | null,
 *   codePoints: number | null, latinExtA: number | null, error: string | null}} FontInfo
 */

/**
 * opentype.js's `parse`, typed for what this module reads.
 * @param {ArrayBuffer} buffer
 * @returns {{names: Record<string, Record<string, Record<string, string>> | undefined>, numGlyphs: number,
 *   tables: {cmap?: {glyphIndexMap?: Record<string, number>}}}}
 */
function parseFontBuffer(buffer) {
  return opentype.parse(buffer);
}

/** WOFF2 known-table index (W3C WOFF2, 5.1). */
const WOFF2_TAGS = Object.freeze([
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG',
  'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
  'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc',
  'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
]);

/**
 * @param {Buffer} buf
 * @param {{p: number}} pos
 * @returns {number}
 */
function readUIntBase128(buf, pos) {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    if (pos.p >= buf.length) throw new Error('WOFF2 table directory ends inside a UIntBase128');
    const byte = buf[pos.p];
    pos.p += 1;
    if (i === 0 && byte === 0x80) throw new Error('WOFF2 UIntBase128 has a leading zero');
    if (value & 0xfe000000) throw new Error('WOFF2 UIntBase128 overflows 32 bits');
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return value >>> 0;
  }
  throw new Error('WOFF2 UIntBase128 is longer than 5 bytes');
}

/**
 * Rebuilds an sfnt from a WOFF2 file for name, coverage and licence inspection only. Tables stored untransformed
 * are copied as they are; transformed `glyf`/`loca` and `hmtx` are replaced by empty stand-ins of the right size,
 * so opentype.js accepts the file while every table this module reads (name, maxp, cmap, head) is the original.
 * @param {Buffer} buf
 * @returns {Buffer}
 */
export function woff2ToSfnt(buf) {
  if (buf.length < 48 || buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 file');
  const flavor = buf.readUInt32BE(4);
  if (flavor === 0x74746366) throw new Error('WOFF2 font collections are not supported');
  const numTables = buf.readUInt16BE(12);
  const compressedLength = buf.readUInt32BE(20);
  const pos = { p: 48 };
  /** @type {Array<{tag: string, transformed: boolean, length: number}>} */
  const directory = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = buf[pos.p];
    pos.p += 1;
    const index = flags & 0x3f;
    const version = flags >> 6;
    let tag;
    if (index === 63) {
      tag = buf.toString('latin1', pos.p, pos.p + 4);
      pos.p += 4;
    } else {
      tag = WOFF2_TAGS[index];
    }
    const origLength = readUIntBase128(buf, pos);
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    const length = transformed ? readUIntBase128(buf, pos) : origLength;
    directory.push({ tag, transformed, length });
  }
  const stream = brotliDecompressSync(buf.subarray(pos.p, pos.p + compressedLength));
  /** @type {Map<string, {transformed: boolean, data: Buffer}>} */
  const tables = new Map();
  let offset = 0;
  for (const entry of directory) {
    tables.set(entry.tag, { transformed: entry.transformed, data: stream.subarray(offset, offset + entry.length) });
    offset += entry.length;
  }
  const maxp = tables.get('maxp');
  const head = tables.get('head');
  if (!maxp || !head || !tables.get('name')) throw new Error('WOFF2 file lacks a head, maxp or name table');
  const numGlyphs = maxp.data.readUInt16BE(4);
  /** @type {Array<{tag: string, data: Buffer}>} */
  const keep = [];
  for (const [tag, table] of tables) if (!table.transformed) keep.push({ tag, data: table.data });
  if (tables.get('glyf')?.transformed || tables.get('loca')?.transformed) {
    const longLoca = head.data.readInt16BE(50) === 1;
    removeTag(keep, 'glyf');
    removeTag(keep, 'loca');
    keep.push({ tag: 'glyf', data: Buffer.alloc(4) });
    keep.push({ tag: 'loca', data: Buffer.alloc((numGlyphs + 1) * (longLoca ? 4 : 2)) });
  }
  if (tables.get('hmtx')?.transformed) {
    const hhea = tables.get('hhea');
    const longMetrics = hhea ? hhea.data.readUInt16BE(34) : numGlyphs;
    removeTag(keep, 'hmtx');
    keep.push({ tag: 'hmtx', data: Buffer.alloc(4 * longMetrics + 2 * Math.max(0, numGlyphs - longMetrics)) });
  }
  return assembleSfnt(keep, tables.has('CFF ') ? 0x4f54544f : 0x00010000);
}

/**
 * @param {Array<{tag: string, data: Buffer}>} list
 * @param {string} tag
 */
function removeTag(list, tag) {
  const i = list.findIndex((t) => t.tag === tag);
  if (i >= 0) list.splice(i, 1);
}

/**
 * @param {Array<{tag: string, data: Buffer}>} tables
 * @param {number} version
 * @returns {Buffer}
 */
function assembleSfnt(tables, version) {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const header = Buffer.alloc(12 + 16 * sorted.length);
  header.writeUInt32BE(version, 0);
  header.writeUInt16BE(sorted.length, 4);
  let offset = header.length;
  /** @type {Buffer[]} */
  const bodies = [];
  sorted.forEach((table, i) => {
    const at = 12 + 16 * i;
    header.write(table.tag, at, 'latin1');
    header.writeUInt32BE(offset, at + 8);
    header.writeUInt32BE(table.data.length, at + 12);
    const padded = Buffer.alloc((table.data.length + 3) & ~3);
    table.data.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  });
  return Buffer.concat([header, ...bodies]);
}

/**
 * Reads what the licence check needs from a font file: format, names (family, typographic family, full name,
 * PostScript name, copyright, licence description and URL, manufacturer), glyph count and cmap coverage. Never
 * throws: an unreadable file comes back with `error` set and null fields.
 * @param {Buffer | Uint8Array} bytes
 * @returns {FontInfo}
 */
export function readFontInfo(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const signature = buf.length >= 4 ? buf.toString('latin1', 0, 4) : '';
  /** @type {FontInfo['format']} */
  let format = 'unknown';
  if (signature === 'wOF2') format = 'woff2';
  else if (signature === 'wOFF') format = 'woff';
  else if (signature === 'OTTO') format = 'otf';
  else if (signature === '\u0000\u0001\u0000\u0000' || signature === 'true') format = 'ttf';
  else if (buf.length > 36 && buf.readUInt16LE(34) === 0x504c) format = 'eot';
  /** @type {FontInfo} */
  const info = {
    format, family: null, typoFamily: null, fullName: null, postScriptName: null, copyright: null, license: null,
    licenseUrl: null, manufacturer: null, numGlyphs: null, codePoints: null, latinExtA: null, error: null,
  };
  if (format === 'eot' || format === 'unknown') return { ...info, error: `cannot read the names of a ${format} font file` };
  try {
    const sfnt = format === 'woff2' ? woff2ToSfnt(buf) : buf;
    const font = parseFontBuffer(Uint8Array.from(sfnt).buffer);
    const name = (/** @type {string} */ key) => pickName(font.names, key);
    const map = font.tables.cmap?.glyphIndexMap ?? {};
    const points = Object.keys(map).map(Number).filter((cp) => Number.isFinite(cp));
    const extA = points.filter((cp) => cp >= 0x100 && cp <= 0x17f).length;
    return {
      ...info,
      family: name('fontFamily'),
      typoFamily: name('preferredFamily') ?? name('typographicFamily'),
      fullName: name('fullName'),
      postScriptName: name('postScriptName'),
      copyright: name('copyright'),
      license: name('license'),
      licenseUrl: name('licenseURL'),
      manufacturer: name('manufacturer'),
      numGlyphs: Number.isInteger(font.numGlyphs) ? font.numGlyphs : null,
      codePoints: points.length,
      latinExtA: extA / 128,
    };
  } catch (err) {
    return { ...info, error: `font could not be parsed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * @param {Record<string, Record<string, Record<string, string>> | undefined>} names
 * @param {string} key
 * @returns {string | null}
 */
function pickName(names, key) {
  for (const platform of ['windows', 'macintosh', 'unicode']) {
    const translations = names?.[platform]?.[key];
    if (!translations) continue;
    const value = translations.en ?? Object.values(translations)[0];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/**
 * Licence kind of a licence text or a font's own licence fields.
 * @param {string | null | undefined} text
 * @returns {'OFL' | 'Apache-2.0' | 'UFL' | 'MIT' | 'FFL' | 'unknown'}
 */
export function classifyLicence(text) {
  const s = String(text ?? '');
  if (/ITF Free Font Licen[cs]e|fontshare/i.test(s)) return 'FFL';
  if (/SIL Open Font Licen[cs]e|Open Font Licen[cs]e|scripts\.sil\.org\/OFL|openfontlicense\.org|\bOFL[- ]?1\.1\b/i.test(s)) return 'OFL';
  if (/Apache License,?\s+(?:Version\s+)?2\.0|apache\.org\/licenses\/LICENSE-2\.0|Licensed under the Apache License/i.test(s)) return 'Apache-2.0';
  if (/Ubuntu Font Licen[cs]e|font\.ubuntu\.com\/(?:ufl|licence)/i.test(s)) return 'UFL';
  if (/Permission is hereby granted, free of charge, to any person obtaining a copy/i.test(s) || /^\s*MIT License/im.test(s)) return 'MIT';
  return 'unknown';
}

/** Licences ip.fonts accepts (ARCHITECTURE P4, FD16-F11). */
export const OPEN_LICENCES = Object.freeze(['OFL', 'Apache-2.0', 'UFL', 'MIT']);

/**
 * Reserved Font Names declared in an OFL text or a font copyright line (`with Reserved Font Name "Plex"`,
 * `Reserved Font Names "Source" and "Source Sans"`, unquoted `Reserved Font Name Fira`).
 * @param {string | null | undefined} text
 * @returns {string[]}
 */
export function reservedFontNames(text) {
  const out = new Set();
  const re = /Reserved\s+Font\s+Names?\s*:?\s*([^\n.;]*)/gi;
  for (const m of String(text ?? '').matchAll(re)) {
    const tail = m[1];
    const quoted = [...tail.matchAll(/["“”'‘’]([^"“”'‘’]{1,64})["“”'‘’]/g)].map((q) => q[1].trim());
    if (quoted.length > 0) {
      for (const q of quoted) if (q) out.add(q);
      continue;
    }
    for (const part of tail.split(/,|\band\b/)) {
      const word = part.trim().replace(/^(?:the\s+)/i, '');
      if (/^[A-Za-z0-9][\w -]{0,40}$/.test(word) && !/^(?:is|are|unless|with|for)\b/i.test(word)) out.add(word);
    }
  }
  return [...out];
}

/**
 * True when `family` keeps `rfn` as a word (case-insensitive): "IBM Plex Sans" keeps "Plex".
 * @param {string | null | undefined} family
 * @param {string} rfn
 * @returns {boolean}
 */
export function keepsReservedName(family, rfn) {
  if (!family || !rfn) return false;
  const escaped = rfn.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(family);
}

/** File-name tokens of provider subsets (Google Fonts and Fontsource name files by subset). */
const SUBSET_NAME = /(?:^|[-_.\s])(?:subset|latin|latin-ext|cyrillic|cyrillic-ext|greek|greek-ext|vietnamese|devanagari|arabic|hebrew|thai|khmer|math|symbols|ext)(?=[-_.\s]|$)/i;
const SUBSET_SOURCE = /fonts\.gstatic\.com|fontsource|google-webfonts-helper|gwfh|\bsubset/i;

/**
 * Evidence that a font file is a subset (a Modified Version under the OFL, FD16-F30): explicit signals (an
 * `@font-face unicode-range` serving it, a subset token in its file name, a provenance source naming a subsetting
 * provider) and a structural one (a webfont covering fewer than 400 code points and under half of Latin Extended-A,
 * as the provider subsets in FD16-F30 did: 263 to 280 glyphs against 1,025 in the full build).
 * @param {{file: string, info: FontInfo, unicodeRanges: string[], provenanceText: string}} input
 * @returns {{explicit: string[], structural: string[]}}
 */
export function subsetSignals({ file, info, unicodeRanges, provenanceText }) {
  /** @type {string[]} */
  const explicit = [];
  /** @type {string[]} */
  const structural = [];
  const base = path.posix.basename(file).replace(/\.[^.]+$/, '');
  if (unicodeRanges.length > 0) explicit.push(`served by @font-face with unicode-range ${unicodeRanges[0]}`);
  if (SUBSET_NAME.test(base)) explicit.push(`file name "${path.posix.basename(file)}" names a subset`);
  if (SUBSET_SOURCE.test(provenanceText)) explicit.push('its recorded source is a subsetting provider');
  const webfont = info.format === 'woff' || info.format === 'woff2';
  if (webfont && info.codePoints !== null && info.codePoints < 400 && info.latinExtA !== null && info.latinExtA < 0.5) {
    structural.push(`covers ${info.codePoints} code points and ${Math.round(info.latinExtA * 100)}% of Latin Extended-A`);
  }
  return { explicit, structural };
}

/**
 * The @font-face rules of a stylesheet (comments already stripped): family, src URLs and unicode-range.
 * @param {string} css
 * @returns {Array<{family: string, urls: string[], unicodeRange: string | null, index: number}>}
 */
export function fontFaceRules(css) {
  const out = [];
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const body = m[1];
    const family = /font-family\s*:\s*(["']?)([^;"'}]+)\1/i.exec(body)?.[2]?.trim() ?? '';
    const urls = [...body.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)].map((u) => u[2].trim());
    const unicodeRange = /unicode-range\s*:\s*([^;}]+)/i.exec(body)?.[1]?.trim() ?? null;
    out.push({ family, urls, unicodeRange, index: m.index ?? 0 });
  }
  return out;
}

const LICENCE_FILE = /^(?:OFL|LICEN[CS]E|COPYING|UFL|NOTICE|FONTLOG)(?:[-_. ][^/]*)?(?:\.(?:txt|md))?$|\.licen[cs]e$/i;

/**
 * The nearest licence file for a font: the declared one (tokens.json or provenance.json), else a licence-named file
 * in the font's folder or an ancestor up to `top`, preferring one whose text names the family.
 * @param {string} fileAbs
 * @param {string} top
 * @param {string | null} declared absolute path or null
 * @param {string[]} familyNames
 * @returns {{path: string, text: string} | null}
 */
function findLicenceFile(fileAbs, top, declared, familyNames) {
  if (declared && existsSync(declared)) return { path: declared, text: safeRead(declared) };
  let dir = path.dirname(fileAbs);
  const stop = path.resolve(top);
  for (;;) {
    /** @type {string[]} */
    let names = [];
    try {
      names = readdirSync(dir).filter((n) => LICENCE_FILE.test(n) && isFile(path.join(dir, n)));
    } catch {
      names = [];
    }
    if (names.length > 0) {
      const candidates = names.map((n) => ({ path: path.join(dir, n), text: safeRead(path.join(dir, n)) }));
      const named = candidates.find((c) => familyNames.some((f) => f && c.text.toLowerCase().includes(f.toLowerCase())));
      return named ?? candidates.find((c) => /^OFL/i.test(path.basename(c.path))) ?? candidates[0];
    }
    if (path.resolve(dir) === stop || path.dirname(dir) === dir) return null;
    const rel = path.relative(stop, dir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    dir = path.dirname(dir);
  }
}

/**
 * @param {string} file
 * @returns {string}
 */
function safeRead(file) {
  try {
    return readText(file).slice(0, 200000);
  } catch {
    return '';
  }
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Sponsor allowlist (all parties: kit fonts, official file hashes, forbidden phrases, notices).
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{sponsor: string, display_name?: string, logo_default?: string, approval_evidence?: unknown,
 *   logo_sources?: Array<{variant?: string, sha256?: string | null, format?: string}>,
 *   forbidden_phrases?: Array<{regex: string, flags?: string, basis?: string, severity?: string}>,
 *   naming_blocklist?: string[], typography?: Array<{family?: string, licence?: string}>,
 *   clear_space?: {min_size?: Record<string, unknown> | null} | null,
 *   trademark_notice?: {with_logo?: string, word_only?: string}, approval_required?: Record<string, unknown>,
 *   [key: string]: unknown}} SponsorEntry
 */

/**
 * Every entry of a sponsor allowlist file (`{sponsor_allowlist: [...]}`, `{sponsors: [...]}` or an array). A
 * missing or malformed skill file is an EnvError (a broken install); a file named by the caller is a UsageError.
 * @param {string} file
 * @param {boolean} callerGiven
 * @returns {SponsorEntry[]}
 */
export function readSponsorEntries(file, callerGiven = false) {
  const where = toPosix(path.resolve(file));
  /** @type {(message: string, cause?: unknown) => Error} */
  const fail = (message, cause) => (callerGiven ? new UsageError(message, { cause }) : new EnvError(message, { cause }));
  if (!existsSync(file)) throw fail(`sponsor allowlist not found at ${where}; restore the skill's assets or pass --sponsor-allowlist`);
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readText(file));
  } catch (err) {
    throw fail(`sponsor allowlist ${where} is not valid JSON (${err instanceof Error ? err.message : String(err)})`, err);
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? [/** @type {Record<string, unknown>} */ (raw).sponsor_allowlist, /** @type {Record<string, unknown>} */ (raw).sponsors].find(Array.isArray)
      : undefined;
  if (!Array.isArray(list)) throw fail(`sponsor allowlist ${where} holds no array of entries`);
  return list
    .filter((e) => e && typeof e === 'object' && typeof (e.sponsor ?? e.id) === 'string')
    .map((e) => /** @type {SponsorEntry} */ ({ ...e, sponsor: String(e.sponsor ?? e.id).toLowerCase() }));
}

/**
 * Index of official files by SHA-256: entry and variant.
 * @param {SponsorEntry[]} entries
 * @returns {Map<string, {entry: SponsorEntry, variant: string}>}
 */
function sponsorHashIndex(entries) {
  const map = new Map();
  for (const entry of entries) {
    for (const source of entry.logo_sources ?? []) {
      if (typeof source.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(source.sha256)) {
        map.set(source.sha256.toLowerCase(), { entry, variant: String(source.variant ?? '') });
      }
    }
  }
  return map;
}

/**
 * Whether the sponsor's published rules let a hackathon page show its official file unaltered (FD21 Deliverable 2).
 * @param {SponsorEntry} entry
 * @returns {boolean}
 */
export function sponsorLogoAllowed(entry) {
  const evidence = entry.approval_evidence;
  const hasEvidence = evidence !== null && evidence !== undefined && evidence !== '' && !(Array.isArray(evidence) && evidence.length === 0);
  return entry.logo_default === 'official_file_unaltered_allowed' || hasEvidence;
}

/**
 * Faces named in sponsor kits under licences that are not OFL, Apache, UFL or MIT (FD21-F15): "ABC Diatype",
 * "Brut Grotesque", and the like. A face listed without a licence counts as commercial.
 * @param {SponsorEntry[]} entries
 * @returns {Array<{family: string, sponsor: string, licence: string}>}
 */
export function sponsorKitFaces(entries) {
  const out = [];
  for (const entry of entries) {
    for (const t of entry.typography ?? []) {
      const licence = String(t.licence ?? '');
      if (/\bOFL\b|Open Font|Apache|\bUFL\b|\bMIT\b/i.test(licence)) continue;
      for (const family of String(t.family ?? '').split('/').map((f) => f.trim()).filter(Boolean)) {
        out.push({ family, sponsor: entry.sponsor, licence: licence || 'no licence recorded' });
      }
    }
  }
  return out;
}

/**
 * The minimum size rule for a sponsor file in a viewport (FD21-F02, F06, F20, F26): pixels and the measured
 * dimension. Keyed by file variant where the kit distinguishes them (BNB Chain lockups and logomark). When the kit
 * states no dimension, width is measured, the convention of the kits that state one.
 * @param {SponsorEntry} entry
 * @param {string} variant
 * @param {{width: number, isMobile?: boolean}} viewport
 * @returns {{px: number, measure: 'width' | 'height', key: string} | null}
 */
export function minSizeRule(entry, variant, viewport) {
  const ms = entry.clear_space?.min_size;
  if (!ms || typeof ms !== 'object') return null;
  /** @type {(key: string) => number | null} */
  const num = (key) => (typeof ms[key] === 'number' && Number.isFinite(ms[key]) ? /** @type {number} */ (ms[key]) : null);
  const stated = String(ms.dimension ?? '');
  const measure = /height/i.test(stated) ? 'height' : 'width';
  const phone = viewport.isMobile === true || viewport.width < 768;
  const tablet = !phone && viewport.width < 1024;
  const v = variant.toLowerCase();
  if (num('web_px') !== null) {
    const key = phone && num('phone_px') !== null ? 'phone_px' : tablet && num('tablet_px') !== null ? 'tablet_px' : 'web_px';
    return { px: /** @type {number} */ (num(key)), measure, key };
  }
  if (num('horizontal_lockup_width_px') !== null || num('logomark_width_px') !== null) {
    const key = /symbol|logomark|\bmark\b/.test(v) ? 'logomark_width_px' : /stacked|vertical/.test(v) ? 'vertical_lockup_width_px' : 'horizontal_lockup_width_px';
    const px = num(key);
    return px === null ? null : { px, measure: 'width', key };
  }
  if (num('lockup_with_kanji_height_px') !== null && /lockup|kanji/.test(v)) return { px: /** @type {number} */ (num('lockup_with_kanji_height_px')), measure: 'height', key: 'lockup_with_kanji_height_px' };
  for (const key of ['logotype_px', 'wordmark_px']) {
    const px = num(key);
    if (px !== null) return { px, measure: key === 'wordmark_px' ? 'height' : measure, key };
  }
  return null;
}

/**
 * Naming hits for the owner (FD21 Deliverable 2, "naming"): a blocklist entry as a token or as the leading or
 * trailing part of a compound ("Cardanex", "AdaPay"), or a near variant of a whole token (edit distance 2 or less
 * for entries of 5 letters or more). Never a failure: short entries produce false positives.
 * @param {string} name
 * @param {SponsorEntry[]} entries
 * @returns {Array<{sponsor: string, entry: string, token: string, how: string}>}
 */
export function namingHits(name, entries) {
  const tokens = String(name ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((t) => t.toUpperCase());
  const out = [];
  for (const entry of entries) {
    for (const blocked of entry.naming_blocklist ?? []) {
      const b = String(blocked).toUpperCase().replace(/\s+/g, '');
      if (!b) continue;
      for (const token of tokens) {
        let how = '';
        if (token === b) how = 'same token';
        else if (b.length >= 3 && (token.startsWith(b) || token.endsWith(b)) && token.length > b.length) how = 'part of a compound';
        else if (b.length >= 5 && Math.abs(token.length - b.length) <= 2 && editDistance(token, b) <= 2) how = 'near variant';
        if (how) out.push({ sponsor: entry.sponsor, entry: String(blocked), token, how });
      }
    }
  }
  return out;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

// ---------------------------------------------------------------------------------------------------------------
// Copy overlap: 8-word shingles, boilerplate shared by two or more unrelated references, an optional hash index.
// ---------------------------------------------------------------------------------------------------------------

const WORDS = new Intl.Segmenter('en', { granularity: 'word' });

/**
 * Lower-case word list of a text (NFKC, typographic quotes folded), Unicode word boundaries.
 * @param {string} text
 * @returns {string[]}
 */
export function words(text) {
  const folded = String(text ?? '').normalize('NFKC').replace(/[‘’ʼ]/g, "'").toLowerCase();
  const out = [];
  for (const s of WORDS.segment(folded)) if (s.isWordLike) out.push(s.segment);
  return out;
}

/**
 * The 8-word shingles of a text block, as strings.
 * @param {string} text
 * @param {number} [n]
 * @returns {string[]}
 */
export function shingles(text, n = SHINGLE_WORDS) {
  const w = words(text);
  const out = [];
  for (let i = 0; i + n <= w.length; i += 1) out.push(w.slice(i, i + n).join(' '));
  return out;
}

/**
 * @typedef {{ref: string, customer: string, texts: string[]}} CapturedCopy
 * @typedef {{version: 1, n: number, salt: string, refs: Record<string, {customer: string}>,
 *   shingles: Record<string, string[]>}} CopyIndex
 */

/**
 * A salted hash index of captured customer copy, so the comparison can outlive the captures (whether keeping it is
 * allowed after the purge is the owner's call; 02-references.md Gaps). Shingles found in two or more unrelated
 * references are dropped as market boilerplate (FD09-F06).
 * @param {CapturedCopy[]} captured
 * @param {{salt?: string, n?: number}} [options]
 * @returns {CopyIndex}
 */
export function buildCopyIndex(captured, { salt = randomBytes(16).toString('hex'), n = SHINGLE_WORDS } = {}) {
  /** @type {Map<string, Set<string>>} */
  const owners = new Map();
  /** @type {Record<string, {customer: string}>} */
  const refs = {};
  for (const c of captured) {
    refs[c.ref] = { customer: c.customer };
    for (const text of c.texts) {
      for (const sh of shingles(text, n)) {
        const h = shingleHash(sh, salt);
        const set = owners.get(h) ?? new Set();
        set.add(ownerKey(c));
        owners.set(h, set);
      }
    }
  }
  /** @type {Record<string, string[]>} */
  const index = {};
  const refOfOwner = new Map(captured.map((c) => [ownerKey(c), c.ref]));
  for (const [h, set] of owners) {
    if (set.size >= 2) continue;
    index[h] = [...set].map((o) => /** @type {string} */ (refOfOwner.get(o)));
  }
  return { version: 1, n, salt, refs, shingles: index };
}

/**
 * @param {CapturedCopy} c
 * @returns {string}
 */
function ownerKey(c) {
  return (c.customer || c.ref).trim().toLowerCase();
}

/**
 * @param {string} shingle
 * @param {string} salt
 * @returns {string}
 */
function shingleHash(shingle, salt) {
  return createHash('sha256').update(`${salt}\u0000${shingle}`, 'utf8').digest('hex').slice(0, 32);
}

/**
 * Runs of 8 or more consecutive words a rendered block shares with the index: each hit names the reference and the
 * shared words (ours, so printing them reveals nothing new).
 * @param {string} text
 * @param {CopyIndex} index
 * @returns {Array<{words: number, text: string, refs: string[]}>}
 */
export function overlapRuns(text, index) {
  const w = words(text);
  const n = index.n;
  /** @type {Array<{start: number, end: number, refs: Set<string>}>} */
  const runs = [];
  for (let i = 0; i + n <= w.length; i += 1) {
    const refs = index.shingles[shingleHash(w.slice(i, i + n).join(' '), index.salt)];
    if (!refs) continue;
    const last = runs.at(-1);
    if (last && i <= last.end - n + 1) {
      last.end = i + n;
      for (const r of refs) last.refs.add(r);
    } else {
      runs.push({ start: i, end: i + n, refs: new Set(refs) });
    }
  }
  return runs.map((r) => ({ words: r.end - r.start, text: w.slice(r.start, r.end).join(' '), refs: [...r.refs] }));
}

/**
 * Captured customer copy still on disk: the capture folders `refs-index.json` lists (any of `dir`, `captureDir`,
 * `path`, `folder`), reading `text.json` / `texts.json` / `copy.json` (an array of strings, or `{texts|blocks|copy}`)
 * and `*.txt` files. Purged folders are skipped and counted.
 * @param {string | null} state
 * @returns {{captured: CapturedCopy[], listed: number, purged: number, indexFile: string | null}}
 */
export function capturedCopy(state) {
  const result = { captured: /** @type {CapturedCopy[]} */ ([]), listed: 0, purged: 0, indexFile: /** @type {string | null} */ (null) };
  if (!state) return result;
  const indexFile = path.join(state, 'copy-shingles.json');
  if (existsSync(indexFile)) result.indexFile = toPosix(indexFile);
  const refsFile = path.join(state, 'refs-index.json');
  if (!existsSync(refsFile)) return result;
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readText(refsFile));
  } catch (err) {
    throw new CheckError(`${toPosix(refsFile)} is not valid JSON (${err instanceof Error ? err.message : String(err)}); fix the file`, { cause: err });
  }
  const items = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? [/** @type {Record<string, unknown>} */ (raw).captures, /** @type {Record<string, unknown>} */ (raw).references, /** @type {Record<string, unknown>} */ (raw).refs].find(Array.isArray) ?? []
      : [];
  items.forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    const dir = [item.dir, item.captureDir, item.capture_dir, item.path, item.folder].find((v) => typeof v === 'string' && v);
    if (!dir) return;
    result.listed += 1;
    const abs = path.resolve(path.dirname(refsFile), dir);
    if (!isDirectory(abs)) {
      result.purged += 1;
      return;
    }
    const texts = readCapturedTexts(abs);
    if (texts.length === 0) return;
    result.captured.push({
      ref: String(item.id ?? item.ref ?? `ref-${i + 1}`),
      customer: String(item.customer ?? item.name ?? item.host ?? item.url ?? `ref-${i + 1}`),
      texts,
    });
  });
  return result;
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function readCapturedTexts(dir) {
  /** @type {string[]} */
  const texts = [];
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (!isFile(file)) continue;
    if (/^(?:text|texts|copy)\.json$/i.test(name)) {
      try {
        const data = JSON.parse(readText(file));
        const list = Array.isArray(data) ? data : [data.texts, data.blocks, data.copy].find(Array.isArray) ?? [];
        for (const t of list) {
          if (typeof t === 'string') texts.push(t);
          else if (t && typeof t.text === 'string') texts.push(t.text);
        }
      } catch {
        continue;
      }
    } else if (/\.txt$/i.test(name) && !/^robots\.txt$/i.test(name)) {
      texts.push(...readText(file).split(/\n{2,}|\r\n\r\n/));
    }
  }
  return texts.map((t) => t.trim()).filter((t) => t !== '');
}

// ---------------------------------------------------------------------------------------------------------------
// In-page probe (self-contained; run through evaluateWithSelector so it can use lib/dom.mjs's selectorFor).
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{x: number, y: number, w: number, h: number}} Box
 * @typedef {{sel: string, text: string, section: string, inLabel: boolean, code: boolean, fontSize: number}} ProbeText
 * @typedef {{sel: string, section: string, visible: boolean, text: string, fontSize: number, opacity: number}} ProbeLabel
 * @typedef {{sel: string, kind: 'img' | 'svg' | 'bg' | 'object' | 'input', urls: string[], alt: string, label: string,
 *   title: string, svgTitle: string, paths: string[], box: Box, client: Box, visible: boolean, opacity: number,
 *   filter: string, blend: string, transform: string[], transitionMs: number, animated: boolean, rowSize: number,
 *   rowMaxHeight: number, link: {href: string, external: boolean, textless: boolean} | null, sectionHeading: string,
 *   inChrome: boolean}} ProbeImage
 * @typedef {{sel: string, kind: string, area: number, viewportArea: number}} ProbeVisual
 * @typedef {{vw: number, vh: number, texts: ProbeText[], labels: ProbeLabel[], images: ProbeImage[],
 *   visuals: ProbeVisual[], googleLinks: Array<{sel: string, href: string, rel: string}>}} ProbeResult
 */

/**
 * Collects, in the page: rendered text blocks with their section, concept labels, every image-like element with the
 * facts the logo and sponsor gates need (URLs, accessible names, box, effective opacity, filters, blend modes, the
 * transform chain, declared transitions, running animations, logo-row membership, the link around it, the section
 * heading), the visual elements a logo is compared with, and `<link>` tags pointing at Google Fonts.
 * @param {(el: Element, counts?: Map<string, number>) => string} sel
 * @returns {ProbeResult}
 */
export function ipProbe(sel) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const counts = new Map();
  const SECTION = 'section, article, aside, header, footer, nav, main, dialog, [data-feature], [role="region"], [role="dialog"], [data-concept]';
  /** @param {Element} el */
  const sectionOf = (el) => {
    const s = el.closest(SECTION);
    return s ? sel(s, counts) : 'body';
  };
  /** @param {Element} el */
  const opacityOf = (el) => {
    let o = 1;
    for (let e = /** @type {Element | null} */ (el); e; e = e.parentElement) {
      const v = Number.parseFloat(getComputedStyle(e).opacity);
      o *= Number.isFinite(v) ? v : 1;
    }
    return Math.round(o * 1000) / 1000;
  };
  /** @param {Element} el */
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
    }
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  };
  /** @param {DOMRect} r @returns {{x: number, y: number, w: number, h: number}} */
  const docBox = (r) => ({ x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) });
  /** @param {DOMRect} r */
  const clientBox = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  /** @param {DOMRect} r */
  const inViewportArea = (r) => Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));

  /** @type {ProbeText[]} */
  const texts = [];
  /** @type {Map<Element, string[]>} */
  const owners = new Map();
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const value = n.nodeValue || '';
    if (!/\S/.test(value)) continue;
    const parent = n.parentElement;
    if (!parent || parent.closest('script, style, noscript, template, title, head')) continue;
    const list = owners.get(parent);
    if (list) list.push(value);
    else owners.set(parent, [value]);
  }
  for (const [el, parts] of owners) {
    if (!shown(el) || opacityOf(el) < 0.1) continue;
    const cs = getComputedStyle(el);
    texts.push({
      sel: sel(el, counts),
      text: parts.join(' ').replace(/\s+/g, ' ').trim(),
      section: sectionOf(el),
      inLabel: Boolean(el.closest('[data-concept-label]')),
      code: Boolean(el.closest('code, pre, kbd, samp, var')) || /\bmono/i.test(cs.fontFamily),
      fontSize: Number.parseFloat(cs.fontSize) || 0,
    });
  }

  /** @type {ProbeLabel[]} */
  const labels = [];
  for (const el of Array.from(document.querySelectorAll('[data-concept-label]'))) {
    const text = (el instanceof HTMLElement ? el.innerText : el.textContent || '').replace(/\s+/g, ' ').trim();
    labels.push({
      sel: sel(el, counts),
      section: sectionOf(el),
      visible: shown(el),
      text,
      fontSize: Number.parseFloat(getComputedStyle(el).fontSize) || 0,
      opacity: opacityOf(el),
    });
  }

  const animations = document.getAnimations();
  /** @param {Element} el */
  const animated = (el) => animations.some((a) => {
    const effect = a.effect;
    const target = effect instanceof KeyframeEffect ? effect.target : null;
    return Boolean(target && (target === el || target.contains(el)));
  });
  /** @param {Element} el */
  const transformChain = (el) => {
    /** @type {string[]} */
    const notes = [];
    let m = new DOMMatrix();
    for (let e = /** @type {Element | null} */ (el); e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.transform && cs.transform !== 'none') {
        try {
          m = new DOMMatrix(cs.transform).multiply(m);
        } catch {
          notes.push(`unparsed transform ${cs.transform}`);
        }
      }
      if (cs.rotate && cs.rotate !== 'none') notes.push(`rotate ${cs.rotate}`);
      if (cs.scale && cs.scale !== 'none') {
        const s = cs.scale.split(/\s+/).map(Number);
        if (s.some((v) => v < 0)) notes.push(`mirrored by scale ${cs.scale}`);
        if (s.length > 1 && Math.abs(s[0] - s[1]) > 1e-3) notes.push(`non-uniform scale ${cs.scale}`);
      }
    }
    if (Math.abs(m.b) > 1e-3 || Math.abs(m.c) > 1e-3) notes.push(`rotated or skewed (matrix ${m.a.toFixed(3)}, ${m.b.toFixed(3)}, ${m.c.toFixed(3)}, ${m.d.toFixed(3)})`);
    else if (Math.abs(Math.abs(m.a) - Math.abs(m.d)) > 1e-3 * Math.max(Math.abs(m.a), Math.abs(m.d), 1)) notes.push(`stretched (scale ${m.a.toFixed(3)} x ${m.d.toFixed(3)})`);
    if (m.a < 0 || m.d < 0) notes.push('mirrored');
    if ([m.m13, m.m14, m.m23, m.m24, m.m31, m.m32, m.m34].some((v) => Math.abs(v) > 1e-6)) notes.push('3D transform');
    return notes;
  };
  /** @param {Element} el */
  const ancestorStyle = (el) => {
    let filter = '';
    let blend = '';
    for (let e = /** @type {Element | null} */ (el); e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (!filter && cs.filter && cs.filter !== 'none') filter = cs.filter;
      if (!blend && cs.mixBlendMode && cs.mixBlendMode !== 'normal') blend = cs.mixBlendMode;
    }
    return { filter, blend };
  };
  /** @param {string} list */
  const maxSeconds = (list) => Math.max(0, ...list.split(',').map((t) => {
    const v = t.trim();
    const n = Number.parseFloat(v);
    if (!Number.isFinite(n)) return 0;
    return v.endsWith('ms') ? n / 1000 : n;
  }));
  /** @param {Element} el */
  const rowOf = (el) => {
    let item = /** @type {Element} */ (el);
    while (item.parentElement && item.parentElement.children.length === 1 && item.parentElement !== document.body) item = item.parentElement;
    const container = item.parentElement;
    const h = el.getBoundingClientRect().height;
    if (!container || h < 8) return { size: 1, maxHeight: h };
    let size = 0;
    let maxHeight = 0;
    for (const child of Array.from(container.children)) {
      const visual = child.matches('img, svg') ? child : child.querySelector('img, svg');
      if (!visual) continue;
      const vh2 = visual.getBoundingClientRect().height;
      if (vh2 >= 8 && Math.abs(vh2 - h) <= 0.3 * Math.max(vh2, h)) {
        size += 1;
        maxHeight = Math.max(maxHeight, vh2);
      }
    }
    return { size: Math.max(size, 1), maxHeight };
  };
  /** @param {Element} el */
  const headingOf = (el) => {
    const s = el.closest(SECTION);
    const h = s ? s.querySelector('h1, h2, h3, h4, [role="heading"]') : null;
    return h ? (h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  };
  /** @param {Element} el */
  const linkOf = (el) => {
    const a = el.closest('a[href]');
    if (!a) return null;
    let href = '';
    let external = false;
    try {
      const u = new URL(a.getAttribute('href') || '', location.href);
      href = u.href;
      external = (u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== location.origin;
    } catch {
      href = a.getAttribute('href') || '';
    }
    const textless = ((a instanceof HTMLElement ? a.innerText : a.textContent) || '').replace(/\s+/g, '') === '';
    return { href, external, textless };
  };
  /** @param {string | null} raw */
  const absolute = (raw) => {
    if (!raw) return '';
    try {
      return new URL(raw, location.href).href;
    } catch {
      return raw;
    }
  };
  /** @param {Element} el */
  const labelText = (el) => {
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    const by = ids.map((id) => document.getElementById(id)?.textContent || '').join(' ');
    return `${el.getAttribute('aria-label') || ''} ${by}`.replace(/\s+/g, ' ').trim();
  };

  /** @type {ProbeImage[]} */
  const images = [];
  /** @type {ProbeVisual[]} */
  const visuals = [];
  /**
   * @param {Element} el
   * @param {ProbeImage['kind']} kind
   * @param {string[]} urls
   */
  const addImage = (el, kind, urls) => {
    const r = el.getBoundingClientRect();
    const st = ancestorStyle(el);
    const row = rowOf(el);
    const svgTitle = kind === 'svg' ? (el.querySelector('title')?.textContent || '').trim() : '';
    images.push({
      sel: sel(el, counts),
      kind,
      urls,
      alt: (el.getAttribute('alt') || '').trim(),
      label: labelText(el),
      title: (el.getAttribute('title') || '').trim(),
      svgTitle,
      paths: kind === 'svg' ? Array.from(el.querySelectorAll('path[d]')).slice(0, 80).map((p) => (p.getAttribute('d') || '').replace(/\s+/g, ' ').trim().slice(0, 400)) : [],
      box: docBox(r),
      client: clientBox(r),
      visible: shown(el),
      opacity: opacityOf(el),
      filter: st.filter,
      blend: st.blend,
      transform: transformChain(el),
      transitionMs: Math.round(maxSeconds(getComputedStyle(el).transitionDuration || '0s') * 1000),
      animated: animated(el),
      rowSize: row.size,
      rowMaxHeight: Math.round(row.maxHeight),
      link: linkOf(el),
      sectionHeading: headingOf(el),
      inChrome: Boolean(el.closest('header, footer, nav, [role="banner"], [role="contentinfo"]')),
    });
    if (shown(el)) visuals.push({ sel: sel(el, counts), kind, area: Math.round(r.width * r.height), viewportArea: Math.round(inViewportArea(r)) });
  };
  for (const el of Array.from(document.querySelectorAll('img'))) {
    const img = /** @type {HTMLImageElement} */ (el);
    addImage(img, 'img', [absolute(img.currentSrc || img.getAttribute('src'))].filter(Boolean));
  }
  for (const el of Array.from(document.querySelectorAll('svg'))) {
    if (el.parentElement && el.parentElement.closest('svg')) continue;
    addImage(el, 'svg', []);
  }
  for (const el of Array.from(document.querySelectorAll('input[type="image"]'))) addImage(el, 'input', [absolute(el.getAttribute('src'))].filter(Boolean));
  for (const el of Array.from(document.querySelectorAll('object[data], embed[src]'))) addImage(el, 'object', [absolute(el.getAttribute('data') || el.getAttribute('src'))].filter(Boolean));
  for (const el of Array.from((document.body || document.documentElement).querySelectorAll('*'))) {
    if (el.matches('img, svg, svg *, input, object, embed, script, style')) continue;
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none' || !bg.includes('url(')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    const urls = [...bg.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)].map((m) => absolute(m[2])).filter((u) => !u.startsWith('data:image/svg+xml;utf8,') || u.length < 4096);
    if (urls.length > 0) addImage(el, 'bg', urls);
  }
  for (const el of Array.from(document.querySelectorAll('video, canvas, iframe'))) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    visuals.push({ sel: sel(el, counts), kind: el.localName, area: Math.round(r.width * r.height), viewportArea: Math.round(inViewportArea(r)) });
  }
  for (const el of Array.from(document.querySelectorAll('h1, h2'))) {
    if (!shown(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    visuals.push({ sel: sel(el, counts), kind: el.localName, area: Math.round(r.width * r.height), viewportArea: Math.round(inViewportArea(r)) });
  }
  const googleLinks = Array.from(document.querySelectorAll('link[href]'))
    .filter((l) => /fonts\.(?:googleapis|gstatic)\.com/i.test(l.getAttribute('href') || ''))
    .map((l) => ({ sel: sel(l, counts), href: l.getAttribute('href') || '', rel: l.getAttribute('rel') || '' }));
  return { vw, vh, texts, labels, images, visuals, googleLinks };
}

/**
 * Re-checks, after hovering it, whether an element or an ancestor animates (FD21-F09: no animation on a mark).
 * @param {string} selector
 * @returns {boolean}
 */
function animatedAfterHover(selector) {
  const el = document.querySelector(selector);
  if (!el) return false;
  return document.getAnimations().some((a) => {
    const effect = a.effect;
    const target = effect instanceof KeyframeEffect ? effect.target : null;
    return Boolean(target && (target === el || target.contains(el)));
  });
}

/**
 * Runs a probe that takes lib/dom.mjs's selectorFor as its first argument.
 * @template T
 * @param {Page} page
 * @param {(sel: (el: Element, counts?: Map<string, number>) => string, arg: any) => T} fn
 * @param {unknown} [arg]
 * @returns {Promise<T>}
 */
async function evaluateWithSelector(page, fn, arg) {
  return /** @type {Promise<T>} */ (page.evaluate(`(${fn.toString()})(${selectorFor.toString()}, ${JSON.stringify(arg ?? null)})`));
}

// ---------------------------------------------------------------------------------------------------------------
// Shared inputs (read once per run).
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{path: string, kind: string, source: string, license: string, licenseFile?: string, ai: string,
 *   tool?: string, notes?: string}} ProvenanceEntry
 */

/**
 * @param {CheckContext} ctx
 */
function createInputs(ctx) {
  const root = path.resolve(ctx.root);
  const design = path.resolve(ctx.design ?? designDir(root, ctx.profile));
  const sponsorFile = typeof ctx.args?.['sponsor-allowlist'] === 'string' ? /** @type {string} */ (ctx.args['sponsor-allowlist']) : DEFAULT_SPONSOR_FILE;
  /** @type {Map<string, unknown>} */
  const memo = new Map();
  /**
   * @template T
   * @param {string} key
   * @param {() => T} fn
   * @returns {T}
   */
  const once = (key, fn) => {
    if (!memo.has(key)) memo.set(key, fn());
    return /** @type {T} */ (memo.get(key));
  };
  const servedDir = typeof ctx.args?.serve === 'string' && ctx.args.serve ? path.resolve(/** @type {string} */ (ctx.args.serve)) : null;
  return {
    root,
    design,
    servedDir,
    sponsors: () => once('sponsors', () => {
      const all = readSponsorEntries(sponsorFile, sponsorFile !== DEFAULT_SPONSOR_FILE);
      const wanted = (ctx.profile?.sponsors ?? []).map((s) => s.toLowerCase());
      // Q-FX-5 (CONTRACTS section 5): a sponsor id the allowlist does not know has no marks to exempt; never an error.
      const unknown = wanted.filter((id) => !all.some((e) => e.sponsor === id));
      return { all, active: all.filter((e) => wanted.includes(e.sponsor)), byHash: sponsorHashIndex(all), unknown };
    }),
    brief: () => once('brief', () => readJsonOrNull(ctx.state ? path.join(ctx.state, 'brief.json') : null)),
    provenance: () => once('provenance', () => readProvenance(path.join(design, 'provenance.json'))),
    tokens: () => once('tokens', () => readJsonOrNull(path.join(design, 'tokens.json'))),
    brandFiles: () => once('brandFiles', () => brandInventory(root)),
    repoFiles: () => once('repoFiles', () => walk(root, { exclude: TEST_DIRS })),
    servedFiles: () => once('servedFiles', () => (servedDir && isDirectory(servedDir) ? walk(servedDir, { defaultExcludes: false, exclude: ['node_modules', '.git'] }) : [])),
    sources: () => once('sources', () => sourceFiles(root, ctx.profile)),
    fontFaces: () => once('fontFaces', () => collectFontFaces(root, servedDir)),
    projectName: () => once('projectName', () => {
      const brief = /** @type {Record<string, any> | null} */ (readJsonOrNull(ctx.state ? path.join(ctx.state, 'brief.json') : null));
      const name = ctx.profile?.project?.name ?? brief?.project?.name ?? null;
      return typeof name === 'string' && name.trim() ? name.trim() : null;
    }),
  };
}

/** @typedef {ReturnType<typeof createInputs>} Inputs */

/**
 * @param {string | null} file
 * @returns {unknown}
 */
function readJsonOrNull(file) {
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(readText(file));
  } catch (err) {
    throw new CheckError(`${toPosix(file)} is not valid JSON (${err instanceof Error ? err.message : String(err)}); fix the file`, { cause: err });
  }
}

/**
 * @param {string} file
 * @returns {{exists: boolean, entries: ProvenanceEntry[], problems: string[]}}
 */
function readProvenance(file) {
  if (!existsSync(file)) return { exists: false, entries: [], problems: [] };
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readText(file));
  } catch (err) {
    return { exists: true, entries: [], problems: [`${toPosix(file)} is not valid JSON (${err instanceof Error ? err.message : String(err)})`] };
  }
  const assets = raw && typeof raw === 'object' && Array.isArray(/** @type {Record<string, unknown>} */ (raw).assets) ? /** @type {unknown[]} */ (/** @type {Record<string, unknown>} */ (raw).assets) : null;
  if (!assets) return { exists: true, entries: [], problems: [`${toPosix(file)} must be {"assets": [...]}`] };
  /** @type {string[]} */
  const problems = [];
  /** @type {ProvenanceEntry[]} */
  const entries = [];
  assets.forEach((a, i) => {
    const at = `assets[${i}]`;
    if (!a || typeof a !== 'object') {
      problems.push(`${at} is not an object`);
      return;
    }
    const e = /** @type {Record<string, unknown>} */ (a);
    const bad = [];
    if (typeof e.path !== 'string' || e.path.trim() === '' || /^[/\\]|^[A-Za-z]:|\\|(?:^|\/)\.\.(?:\/|$)/.test(e.path)) bad.push('path must be a repository-relative POSIX path');
    if (!['font', 'image', 'icon', 'logo', 'data', 'video'].includes(String(e.kind))) bad.push('kind must be font|image|icon|logo|data|video');
    for (const key of ['source', 'license']) if (typeof e[key] !== 'string' || /** @type {string} */ (e[key]).trim() === '') bad.push(`${key} must be a non-empty string`);
    if (!['generated', 'assisted', 'none'].includes(String(e.ai))) bad.push('ai must be generated|assisted|none');
    if (e.kind === 'font' && (typeof e.licenseFile !== 'string' || e.licenseFile.trim() === '')) bad.push('a font entry needs licenseFile');
    if ((e.ai === 'generated' || e.ai === 'assisted') && (typeof e.tool !== 'string' || e.tool.trim() === '')) bad.push('an AI-generated or assisted entry names its tool');
    if (bad.length > 0) problems.push(`${at} (${typeof e.path === 'string' ? e.path : '?'}): ${bad.join('; ')}`);
    if (typeof e.path === 'string') entries.push(/** @type {ProvenanceEntry} */ ({ ...e, path: e.path.replace(/^\.\//, '') }));
  });
  return { exists: true, entries, problems };
}

/**
 * The project's own brand files: everything under the top-level `brand/`, their SHA-256 values and the `d`
 * strings of their SVG paths (to recognise the mark inlined into a page).
 * @param {string} root
 * @returns {{files: string[], hashes: Set<string>, paths: Set<string>}}
 */
function brandInventory(root) {
  const dir = path.join(root, 'brand');
  const files = isDirectory(dir) ? walk(dir).map((f) => `brand/${f}`) : [];
  const hashes = new Set();
  const paths = new Set();
  for (const rel of files) {
    const abs = path.join(root, rel);
    hashes.add(sha256File(abs));
    if (/\.svg$/i.test(rel)) {
      for (const m of safeRead(abs).matchAll(/\sd\s*=\s*(["'])([\s\S]*?)\1/g)) paths.add(m[2].replace(/\s+/g, ' ').trim().slice(0, 400));
    }
  }
  return { files, hashes, paths };
}

/**
 * Every @font-face in the repository's stylesheets, HTML and the served folder, keyed by font file base name.
 * @param {string} root
 * @param {string | null} servedDir
 * @returns {Map<string, Array<{family: string, unicodeRange: string | null, file: string}>>}
 */
function collectFontFaces(root, servedDir) {
  /** @type {Map<string, Array<{family: string, unicodeRange: string | null, file: string}>>} */
  const map = new Map();
  /** @param {string} base @param {string} rel */
  const scan = (base, rel) => {
    const abs = path.join(base, rel);
    const kind = /\.s?css$/i.test(rel) ? (/\.scss$/i.test(rel) ? 'scss' : 'css') : /\.html?$/i.test(rel) ? 'html' : /\.(?:[cm]?js|jsx|tsx?)$/i.test(rel) ? 'js' : null;
    if (!kind) return;
    let text;
    try {
      text = stripComments(readText(abs), kind);
    } catch {
      return;
    }
    if (!/@font-face/i.test(text)) return;
    for (const rule of fontFaceRules(text)) {
      for (const url of rule.urls) {
        const name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() ?? '').toLowerCase();
        if (!name) continue;
        const list = map.get(name) ?? [];
        list.push({ family: rule.family, unicodeRange: rule.unicodeRange, file: toPosix(path.relative(root, abs)) });
        map.set(name, list);
      }
    }
  };
  for (const rel of walk(root, { include: ['*.{css,scss,html,htm,js,mjs,cjs,jsx,ts,tsx}'], exclude: TEST_DIRS })) scan(root, rel);
  if (servedDir && isDirectory(servedDir)) for (const rel of walk(servedDir, { include: ['*.{css,html,htm,js,mjs}'], defaultExcludes: false })) scan(servedDir, rel);
  return map;
}

// ---------------------------------------------------------------------------------------------------------------
// Rendered pages: one pass per route and viewport, external requests blocked unless --network.
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{route: string, viewport: Viewport, url: string, probe: ProbeResult, hotlinks: string[],
 *   blocked: string[], imageHashes: Map<string, string>, fonts: Array<{url: string, sha256: string}>,
 *   hoverAnimated: Map<string, boolean>}} PageRecord
 * @typedef {{pages: PageRecord[], fontBytes: Map<string, Buffer>, error: string | null}} RenderSet
 */

/**
 * @param {CheckContext} ctx
 * @param {Inputs} inputs
 * @param {string[]} want
 * @returns {Promise<RenderSet>}
 */
async function renderPages(ctx, inputs, want) {
  const browser = /** @type {Browser} */ (ctx.browser);
  const base = new URL(/** @type {string} */ (ctx.baseUrl));
  const allowNetwork = ctx.args?.network === true;
  /** @type {PageRecord[]} */
  const pages = [];
  /** @type {Map<string, Buffer>} */
  const fontBytes = new Map();
  const sponsors = want.includes('ip.sponsor-marks') || want.includes('ip.logos') ? inputs.sponsors() : null;
  for (const route of ctx.routes) {
    for (const viewport of ctx.viewports) {
      const url = routeUrl(base.href, route, ctx.profile);
      ctx.log?.(`${TOOL}: ${route.path} at ${viewport.name}`);
      const context = await newContext(browser, viewport, { network: allowNetwork });
      try {
        const page = await context.newPage();
        /** @type {string[]} */
        const hotlinks = [];
        /** @type {string[]} */
        const blocked = [];
        /** @type {Map<string, string>} */
        const imageHashes = new Map();
        /** @type {Array<{url: string, sha256: string}>} */
        const fonts = [];
        /** @type {Promise<unknown>[]} */
        const pending = [];
        await page.route('**/*', async (r) => {
          const req = r.request();
          let target;
          try {
            target = new URL(req.url());
          } catch {
            return r.continue();
          }
          if (target.protocol !== 'http:' && target.protocol !== 'https:') return r.continue();
          if (GOOGLE_FONTS.test(target.hostname)) {
            hotlinks.push(req.url());
            return r.abort('blockedbyclient');
          }
          if (!allowNetwork && target.origin !== base.origin && !isLoopback(target.hostname)) {
            blocked.push(req.url());
            return r.abort('blockedbyclient');
          }
          return r.continue();
        });
        page.on('response', (response) => {
          const type = response.request().resourceType();
          if (type !== 'image' && type !== 'font' && type !== 'media' && type !== 'other') return;
          if (response.status() >= 300) return;
          pending.push(response.body().then((body) => {
            const hash = createHash('sha256').update(body).digest('hex');
            imageHashes.set(response.url(), hash);
            const isFont = type === 'font' || FONT_FILE.test(new URL(response.url()).pathname);
            if (isFont) {
              fonts.push({ url: response.url(), sha256: hash });
              if (!fontBytes.has(hash)) fontBytes.set(hash, body);
            }
          }, () => undefined));
        });
        await goto(page, url);
        await waitReady(page, { readyFlag: ctx.profile?.ready_flag === true });
        await Promise.all(pending);
        const probe = await evaluateWithSelector(page, ipProbe);
        /** @type {Map<string, boolean>} */
        const hoverAnimated = new Map();
        if (sponsors && want.includes('ip.sponsor-marks') && !viewport.hasTouch) {
          for (const img of probe.images) {
            if (!img.visible || !img.urls.some((u) => sponsors.byHash.has(imageHashes.get(u) ?? ''))) continue;
            try {
              await page.hover(img.sel, { timeout: 2000, force: true });
              await page.waitForTimeout(80);
              hoverAnimated.set(img.sel, await page.evaluate(animatedAfterHover, img.sel));
              await page.mouse.move(0, 0);
            } catch {
              hoverAnimated.set(img.sel, false);
            }
          }
        }
        await Promise.all(pending);
        pages.push({ route: route.path, viewport, url, probe, hotlinks, blocked, imageHashes, fonts, hoverAnimated });
      } catch (err) {
        if (err instanceof EnvError) throw err;
        return { pages, fontBytes, error: `${route.path} at ${viewport.name}: ${err instanceof Error ? err.message : String(err)}` };
      } finally {
        await context.close();
      }
    }
  }
  return { pages, fontBytes, error: null };
}

/**
 * @param {string} host
 * @returns {boolean}
 */
function isLoopback(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.localhost');
}

// ---------------------------------------------------------------------------------------------------------------
// Gates.
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {string} id
 * @returns {import('./lib/report.mjs').GateBuilder}
 */
function builder(id) {
  const meta = GATES.find((g) => g.id === id);
  if (!meta) throw new TypeError(`unknown gate ${id}`);
  return gate(meta);
}

/**
 * Normalises a gate selection (ids or the group name `ip`), in GATES order. Unknown ids are a UsageError.
 * @param {readonly string[] | undefined | null} selected
 * @returns {string[]}
 */
export function selectGates(selected) {
  const all = /** @type {string[]} */ (GATES.map((g) => g.id));
  if (!selected || selected.length === 0) return all;
  const want = new Set();
  for (const raw of selected) {
    const id = String(raw).trim();
    if (!id) continue;
    if (id === 'ip') all.forEach((g) => want.add(g));
    else if (all.includes(id)) want.add(id);
    else throw new UsageError(`unknown gate "${id}" for ${TOOL}; known: ip, ${all.join(', ')}`);
  }
  return all.filter((g) => want.has(g));
}

/**
 * Runs the selected ip gates (CONTRACTS section 4).
 * @param {CheckContext} ctx
 * @param {readonly string[]} [selected]
 * @returns {Promise<GateResult[]>}
 */
export async function run(ctx, selected) {
  const want = selectGates(selected);
  const inputs = createInputs(ctx);
  const needsPages = want.some((id) => RUNTIME_GATES.has(id));
  /** @type {RenderSet | null} */
  let rendered = null;
  if (needsPages && ctx.browser && ctx.baseUrl) rendered = await renderPages(ctx, inputs, want);
  const noPages = !ctx.baseUrl ? 'no rendered pages: pass --serve <built dir> or --url <running app>' : 'no browser in the check context';
  /** @type {GateResult[]} */
  const results = [];
  for (const id of want) {
    try {
      results.push(evaluate(id, ctx, inputs, rendered, noPages));
    } catch (err) {
      if (err instanceof UsageError || err instanceof EnvError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      results.push(builder(id).fail(`could not be evaluated: ${message}`));
    }
  }
  return results;
}

/**
 * @param {string} id
 * @param {CheckContext} ctx
 * @param {Inputs} inputs
 * @param {RenderSet | null} rendered
 * @param {string} noPages
 * @returns {GateResult}
 */
function evaluate(id, ctx, inputs, rendered, noPages) {
  if (rendered?.error && RENDER_REQUIRED.has(id)) return builder(id).fail(`a page could not be checked: ${rendered.error}`);
  switch (id) {
    case 'ip.fonts':
      return fontsGate(ctx, inputs, rendered, noPages);
    case 'ip.hotlinks':
      return hotlinksGate(inputs, rendered, noPages);
    case 'ip.logos':
      return logosGate(ctx, inputs, rendered, noPages);
    case 'ip.provenance':
      return provenanceGate(inputs);
    case 'ip.concept-label':
      return conceptLabelGate(ctx, inputs, rendered, noPages);
    case 'ip.copy-overlap':
      return copyOverlapGate(ctx, rendered, noPages);
    case 'ip.sponsor-marks':
      return sponsorMarksGate(ctx, inputs, rendered, noPages);
    default:
      throw new TypeError(`unknown gate ${id}`);
  }
}

// --- ip.fonts ---------------------------------------------------------------------------------------------------

/**
 * @typedef {{where: string, abs: string | null, top: string | null, sha256: string, bytes: Buffer, origin: 'repo' | 'served' | 'runtime'}} FontFile
 */

/**
 * @param {CheckContext} ctx
 * @param {Inputs} inputs
 * @param {RenderSet | null} rendered
 * @param {string} noPages
 * @returns {GateResult}
 */
function fontsGate(ctx, inputs, rendered, noPages) {
  const g = builder('ip.fonts');
  /** @type {Map<string, FontFile>} */
  const bySha = new Map();
  for (const rel of inputs.repoFiles().filter((f) => FONT_FILE.test(f))) {
    const abs = path.join(inputs.root, rel);
    const bytes = readFileSync(abs);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (!bySha.has(sha)) bySha.set(sha, { where: rel, abs, top: inputs.root, sha256: sha, bytes, origin: 'repo' });
  }
  if (inputs.servedDir) {
    for (const rel of inputs.servedFiles().filter((f) => FONT_FILE.test(f))) {
      const abs = path.join(inputs.servedDir, rel);
      const bytes = readFileSync(abs);
      const sha = createHash('sha256').update(bytes).digest('hex');
      if (!bySha.has(sha)) bySha.set(sha, { where: `${toPosix(path.relative(inputs.root, abs))}`, abs, top: inputs.servedDir, sha256: sha, bytes, origin: 'served' });
    }
  }
  const runtimeUrls = new Map();
  for (const page of rendered?.pages ?? []) for (const f of page.fonts) if (!runtimeUrls.has(f.sha256)) runtimeUrls.set(f.sha256, f.url);
  for (const [sha, url] of runtimeUrls) {
    if (bySha.has(sha)) continue;
    const bytes = rendered?.fontBytes.get(sha);
    if (bytes) bySha.set(sha, { where: url, abs: null, top: null, sha256: sha, bytes, origin: 'runtime' });
  }
  const tokens = /** @type {Record<string, any> | null} */ (inputs.tokens());
  const tokenFonts = Array.isArray(tokens?.type?.fonts) ? /** @type {Array<Record<string, unknown>>} */ (tokens.type.fonts) : [];
  const provenance = inputs.provenance();
  const kitFaces = sponsorKitFaces(inputs.sponsors().all);
  const faces = inputs.fontFaces();
  /** @type {Evidence[]} */
  const failures = [];
  /** @type {Evidence[]} */
  const notes = [];
  for (const font of bySha.values()) {
    const info = readFontInfo(font.bytes);
    const base = font.where.split(/[?#]/)[0].split('/').pop()?.toLowerCase() ?? '';
    const faceRules = faces.get(base) ?? [];
    const relPath = font.origin === 'runtime' ? null : toPosix(path.relative(inputs.root, /** @type {string} */ (font.abs)));
    const declared = relPath ? declaredLicence(relPath, tokenFonts, provenance.entries, inputs.root) : null;
    const families = [info.family, info.typoFamily, info.fullName, ...faceRules.map((r) => r.family)].filter((f) => typeof f === 'string' && f.trim() !== '').map((f) => /** @type {string} */ (f));
    let licence = font.abs && font.top ? findLicenceFile(font.abs, font.top, declared, families) : null;
    if (!licence && font.origin !== 'repo') licence = licenceForFamily(inputs, families);
    const fromFile = licence ? classifyLicence(licence.text) : 'unknown';
    const fromFont = classifyLicence(`${info.license ?? ''} ${info.licenseUrl ?? ''} ${info.copyright ?? ''}`);
    const label = { file: font.where, value: [info.typoFamily ?? info.family ?? '(unreadable)', info.format].join(' / ') };
    const kit = kitFaces.find((k) => families.some((f) => f.toLowerCase() === k.family.toLowerCase() || f.toLowerCase().startsWith(`${k.family.toLowerCase()} `)));
    if (kit) {
      failures.push({ ...label, detail: `"${kit.family}" comes from the ${kit.sponsor} brand kit under ${kit.licence}: a downloaded kit font grants no licence (FD21-F15); use an open face` });
      continue;
    }
    if (fromFile === 'FFL' || fromFont === 'FFL') {
      failures.push({ ...label, detail: 'Fontshare ITF Free Font License: forbids redistribution through a repository, subsetting and conversion (FD16-F12); use an OFL face' });
      continue;
    }
    if (!licence) {
      failures.push({ ...label, detail: `no licence file ships with it (looked for ${declared ? toPosix(path.relative(inputs.root, declared)) : 'OFL.txt or LICENSE in its folder and above'}); ship the face's own licence beside it` });
      continue;
    }
    const licencePath = toPosix(path.relative(inputs.root, licence.path));
    if (!OPEN_LICENCES.includes(fromFile)) {
      failures.push({ ...label, detail: `licence file ${licencePath} is not OFL, Apache, UFL or MIT; use an open-licensed face or ship its real licence` });
      continue;
    }
    if (fromFont !== 'unknown' && fromFont !== fromFile) {
      failures.push({ ...label, detail: `the font says ${fromFont} but ${licencePath} is ${fromFile}; ship the face's own licence` });
      continue;
    }
    if (info.error) notes.push({ ...label, detail: `${info.error}; Reserved Font Name and subset checks not possible` });
    const rfns = [...new Set([...reservedFontNames(licence.text), ...reservedFontNames(info.copyright)])];
    if (rfns.length > 0 && !info.error) {
      const presented = [info.typoFamily, info.family, ...faceRules.map((r) => r.family)].filter((f) => typeof f === 'string' && f !== '').map((f) => /** @type {string} */ (f));
      const kept = rfns.filter((rfn) => presented.some((f) => keepsReservedName(f, rfn)));
      if (kept.length > 0) {
        const entry = relPath ? provenance.entries.find((e) => e.path === relPath) : undefined;
        const provenanceText = entry ? `${entry.source} ${entry.notes ?? ''}` : '';
        const signals = subsetSignals({ file: font.where, info, unicodeRanges: faceRules.map((r) => r.unicodeRange).filter((u) => typeof u === 'string').map((u) => /** @type {string} */ (u)), provenanceText });
        const claimsUnmodified = /\bunmodified\b/i.test(entry?.notes ?? '');
        if (signals.explicit.length > 0 || (signals.structural.length > 0 && !claimsUnmodified)) {
          failures.push({
            ...label,
            detail: `a subset (${[...signals.explicit, ...signals.structural].join('; ')}) keeps the Reserved Font Name ${kept.map((k) => `"${k}"`).join(', ')} of ${licencePath}: ship the unmodified files, rename the subset in its name table and @font-face, or pick a face without an RFN (FD16-F30)${signals.explicit.length === 0 ? '; if the file is the unmodified upstream build, say so in its provenance notes ("unmodified")' : ''}`,
          });
          continue;
        }
        if (signals.structural.length > 0) notes.push({ ...label, detail: `keeps the Reserved Font Name ${kept.join(', ')} with low coverage; provenance declares it unmodified` });
      }
    }
    notes.push({ ...label, detail: `${fromFile} via ${licencePath}${rfns.length ? `; RFN ${rfns.join(', ')}` : ''}` });
  }
  const runtimeNote = rendered ? '' : ` (rendered font requests not inspected: ${noPages})`;
  if (bySha.size === 0) return g.ok(`no font files shipped${runtimeNote}`);
  if (failures.length > 0) return g.fail(`${failures.length} of ${bySha.size} font file(s) fail the licence rules${runtimeNote}`, [...failures, ...notes]);
  return g.ok(`${bySha.size} font file(s): open licence files found, no Reserved Font Name kept on a subset, no sponsor-kit face${runtimeNote}`, notes);
}

/**
 * The licence file declared for a font path in tokens.json (`type.fonts[].licenseFile`) or provenance.json.
 * @param {string} relPath
 * @param {Array<Record<string, unknown>>} tokenFonts
 * @param {ProvenanceEntry[]} entries
 * @param {string} root
 * @returns {string | null}
 */
function declaredLicence(relPath, tokenFonts, entries, root) {
  const fromTokens = tokenFonts.find((f) => typeof f.file === 'string' && f.file.replace(/^\.\//, '') === relPath)?.licenseFile;
  const fromProvenance = entries.find((e) => e.path === relPath)?.licenseFile;
  const declared = typeof fromTokens === 'string' && fromTokens ? fromTokens : typeof fromProvenance === 'string' && fromProvenance ? fromProvenance : null;
  return declared ? path.resolve(root, declared) : null;
}

/**
 * For a font seen only at run time: a licence file in the repository that names one of its families.
 * @param {Inputs} inputs
 * @param {string[]} families
 * @returns {{path: string, text: string} | null}
 */
function licenceForFamily(inputs, families) {
  if (families.length === 0) return null;
  for (const rel of inputs.repoFiles()) {
    if (!LICENCE_FILE.test(path.posix.basename(rel))) continue;
    const text = safeRead(path.join(inputs.root, rel));
    if (families.some((f) => text.toLowerCase().includes(f.toLowerCase()))) return { path: path.join(inputs.root, rel), text };
  }
  return null;
}

// --- ip.hotlinks ------------------------------------------------------------------------------------------------

/**
 * @param {Inputs} inputs
 * @param {RenderSet | null} rendered
 * @param {string} noPages
 * @returns {GateResult}
 */
function hotlinksGate(inputs, rendered, noPages) {
  const g = builder('ip.hotlinks');
  /** @type {Evidence[]} */
  const found = [];
  for (const file of inputs.sources()) {
    if (inTestDir(file.path)) continue;
    for (const m of file.code.matchAll(/fonts\.(?:googleapis|gstatic)\.com/gi)) {
      const line = lineOf(file.code, m.index ?? 0);
      found.push({ file: file.path, line, value: file.text.split('\n')[line - 1]?.trim().slice(0, 120) ?? m[0], detail: 'source reference' });
    }
  }
  if (inputs.servedDir) {
    for (const rel of inputs.servedFiles().filter((f) => /\.(?:html?|css|m?js|svg)$/i.test(f))) {
      const abs = path.join(inputs.servedDir, rel);
      const kind = /\.css$/i.test(rel) ? 'css' : /\.html?$/i.test(rel) ? 'html' : /\.svg$/i.test(rel) ? 'html' : 'js';
      const code = stripComments(safeRead(abs), kind);
      for (const m of code.matchAll(/fonts\.(?:googleapis|gstatic)\.com/gi)) {
        found.push({ file: toPosix(path.relative(inputs.root, abs)), line: lineOf(code, m.index ?? 0), value: m[0], detail: 'built file reference' });
        break;
      }
    }
  }
  for (const page of rendered?.pages ?? []) {
    for (const url of new Set(page.hotlinks)) found.push({ route: page.route, viewport: page.viewport.name, value: url, detail: 'runtime request (blocked)' });
    for (const link of page.probe.googleLinks) found.push({ route: page.route, viewport: page.viewport.name, selector: link.sel, value: link.href, detail: `<link rel="${link.rel}">` });
  }
  const unique = dedupeEvidence(found);
  if (unique.length > 0) return g.fail(`${unique.length} Google Fonts hotlink(s): self-host the files with their licence`, unique);
  if (!rendered) return g.skip(`sources are clean, but runtime requests were not checked: ${noPages}`);
  return g.ok(`no request to or reference of Google Fonts on ${rendered.pages.length} rendered page(s) and in the sources`);
}

/**
 * True for a path inside a test or fixture folder: those files never ship.
 * @param {string} rel
 * @returns {boolean}
 */
function inTestDir(rel) {
  return rel.split('/').slice(0, -1).some((segment) => TEST_DIRS.includes(segment));
}

/**
 * @param {Evidence[]} list
 * @returns {Evidence[]}
 */
function dedupeEvidence(list) {
  const seen = new Set();
  return list.filter((e) => {
    const key = JSON.stringify([e.file, e.line, e.route, e.selector, e.value, e.detail]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- ip.logos ---------------------------------------------------------------------------------------------------

/**
 * Names of parties a logo could belong to: sponsor display names (their first words) and brief customers.
 * @param {SponsorEntry[]} entries
 * @param {unknown} brief
 * @param {Profile} profile
 * @returns {string[]}
 */
function partyNames(entries, brief, profile) {
  const names = new Set();
  for (const e of entries) {
    const display = String(e.display_name ?? '').replace(/\(.*?\)/g, '').trim();
    if (display.length >= 3) names.add(display);
    if (e.sponsor.length >= 4) names.add(e.sponsor.replace(/-/g, ' '));
  }
  for (const c of customersOf(brief, profile)) names.add(c);
  return [...names];
}

/**
 * Customer names from brief.json `customers[].name` and the profile's `references[].customer`.
 * @param {unknown} brief
 * @param {Profile} profile
 * @returns {string[]}
 */
export function customersOf(brief, profile) {
  const names = new Set();
  const list = brief && typeof brief === 'object' && Array.isArray(/** @type {Record<string, unknown>} */ (brief).customers) ? /** @type {unknown[]} */ (/** @type {Record<string, unknown>} */ (brief).customers) : [];
  for (const c of list) {
    const name = c && typeof c === 'object' ? /** @type {Record<string, unknown>} */ (c).name : null;
    if (typeof name === 'string' && name.trim().length >= 2) names.add(name.trim());
  }
  for (const r of profile?.references ?? []) if (typeof r.customer === 'string' && r.customer.trim().length >= 2) names.add(r.customer.trim());
  return [...names];
}

/**
 * @param {string} text
 * @param {string} name
 * @param {boolean} [caseSensitive]
 * @returns {boolean}
 */
function mentions(text, name, caseSensitive = false) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, caseSensitive ? 'u' : 'iu').test(text);
}

/**
 * Why an image looks like a logo, or [] when it does not (FD09 policy rows 8 and 10).
 * @param {ProbeImage} img
 * @param {string[]} parties
 * @returns {string[]}
 */
export function logoReasons(img, parties) {
  const reasons = [];
  const names = `${img.alt} ${img.label} ${img.title} ${img.svgTitle}`;
  if (LOGO_WORD.test(names)) reasons.push(`named "${names.trim().slice(0, 60)}"`);
  const file = img.urls.map((u) => decodeURIComponent(u.split(/[?#]/)[0].split('/').pop() ?? '')).find((f) => LOGO_NAME.test(f));
  if (file) reasons.push(`file "${file}" is named like a logo`);
  const party = parties.find((p) => mentions(names, p));
  if (party) reasons.push(`its accessible name mentions ${party}`);
  if (img.link?.external && img.link.textless) reasons.push(`it is the only content of a link to ${safeHost(img.link.href)}`);
  if (img.rowSize >= 3 && img.rowMaxHeight <= 96) reasons.push(`one of ${img.rowSize} similar small images in a row`);
  if (TRUSTED_CONTEXT.test(img.sectionHeading) && (img.rowSize >= 2 || img.link?.external)) reasons.push(`in a section headed "${img.sectionHeading.slice(0, 60)}"`);
  return reasons;
}

/**
 * @param {string} href
 * @returns {string}
 */
function safeHost(href) {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}

/**
 * @param {ProbeImage} img
 * @param {Map<string, string>} hashes
 * @param {{hashes: Set<string>, paths: Set<string>}} brand
 * @param {string | null} projectName
 * @returns {boolean}
 */
function firstParty(img, hashes, brand, projectName) {
  if (img.urls.some((u) => brand.hashes.has(hashes.get(u) ?? ''))) return true;
  const names = `${img.alt} ${img.label} ${img.title} ${img.svgTitle}`.trim();
  if (projectName && names && names.toLowerCase().startsWith(projectName.toLowerCase())) return true;
  if (img.kind === 'svg' && img.paths.length > 0 && brand.paths.size > 0) {
    const matched = img.paths.filter((d) => brand.paths.has(d)).length;
    if (matched / img.paths.length >= 0.5) return true;
  }
  return false;
}

/**
 * @param {CheckContext} ctx
 * @param {Inputs} inputs
 * @param {RenderSet | null} rendered
 * @param {string} noPages
 * @returns {GateResult}
 */
function logosGate(ctx, inputs, rendered, noPages) {
  const g = builder('ip.logos');
  const { all, byHash } = inputs.sponsors();
  const brand = inputs.brandFiles();
  const parties = partyNames(all, inputs.brief(), ctx.profile);
  /** @type {Evidence[]} */
  const failures = [];
  /** @type {Evidence[]} */
  const allowed = [];
  for (const rel of inputs.repoFiles().filter((f) => IMAGE_FILE.test(f))) {
    if (rel.startsWith('brand/')) continue;
    const named = LOGO_NAME.test(rel);
    const svgText = /\.svg$/i.test(rel) ? safeRead(path.join(inputs.root, rel)).slice(0, 20000) : '';
    const svgName = (/<title[^>]*>([^<]*)<\/title>/i.exec(svgText)?.[1] ?? '') + ' ' + (/aria-label\s*=\s*"([^"]*)"/i.exec(svgText)?.[1] ?? '');
    const svgLogo = LOGO_WORD.test(svgName) || parties.some((p) => mentions(svgName, p));
    if (!named && !svgLogo) continue;
    const sha = sha256File(path.join(inputs.root, rel));
    if (brand.hashes.has(sha)) continue;
    const official = byHash.get(sha);
    if (official && sponsorLogoAllowed(official.entry)) {
      allowed.push({ file: rel, value: `${official.entry.sponsor} ${official.variant}`, detail: 'official file, unaltered use allowed' });
      continue;
    }
    failures.push({
      file: rel,
      value: official ? `${official.entry.sponsor} ${official.variant}` : svgName.trim() || path.posix.basename(rel),
      detail: official
        ? `official ${official.entry.sponsor} file, but its rules need ${String(official.entry.logo_default ?? 'approval')} and no approval_evidence is recorded`
        : 'an image file named or titled like a logo that is not a brand/ file nor an allowed official sponsor file',
    });
  }
  for (const page of rendered?.pages ?? []) {
    for (const img of page.probe.images) {
      if (!img.visible) continue;
      const reasons = logoReasons(img, parties);
      if (reasons.length === 0) continue;
      if (firstParty(img, page.imageHashes, brand, inputs.projectName())) continue;
      const official = img.urls.map((u) => byHash.get(page.imageHashes.get(u) ?? '')).find(Boolean);
      const where = { route: page.route, viewport: page.viewport.name, selector: img.sel };
      if (official && sponsorLogoAllowed(official.entry)) {
        allowed.push({ ...where, value: `${official.entry.sponsor} ${official.variant}`, detail: 'official file, unaltered use allowed' });
        continue;
      }
      failures.push({
        ...where,
        value: img.urls[0] ?? (img.svgTitle || img.label || img.alt || img.kind),
        detail: official
          ? `official ${official.entry.sponsor} file whose rules need ${String(official.entry.logo_default ?? 'approval')}; no approval_evidence recorded`
          : `looks like a third-party logo (${reasons.join('; ')}); name the party in plain text instead`,
      });
    }
  }
  const unique = dedupeEvidence(failures);
  if (unique.length > 0) return g.fail(`${unique.length} third-party logo(s) without permission`, [...unique, ...dedupeEvidence(allowed)]);
  if (!rendered) return g.skip(`repository files are clean, but rendered images were not checked: ${noPages}`);
  return g.ok(`no third-party logo outside brand/ and allowed official sponsor files (${dedupeEvidence(allowed).length} allowed sponsor use(s))`, dedupeEvidence(allowed));
}

// --- ip.provenance ----------------------------------------------------------------------------------------------

/**
 * Asset files the provenance record must cover: images, fonts, media and 3D models anywhere in the repository
 * (tests and fixtures excepted), and data files under asset folders (public, static, assets, data...), minus
 * well-known configuration files.
 * @param {string[]} files
 * @returns {string[]}
 */
export function assetFiles(files) {
  return files.filter((rel) => {
    const base = path.posix.basename(rel).toLowerCase();
    if (CONFIG_NAMES.has(base) || base.endsWith('.webmanifest')) return false;
    if (IMAGE_FILE.test(rel) || FONT_FILE.test(rel) || MEDIA_FILE.test(rel)) return true;
    return DATA_FILE.test(rel) && ASSET_DIRS.test(rel);
  });
}

/**
 * @param {Inputs} inputs
 * @returns {GateResult}
 */
function provenanceGate(inputs) {
  const g = builder('ip.provenance');
  const assets = assetFiles(inputs.repoFiles());
  const record = inputs.provenance();
  const where = toPosix(path.relative(inputs.root, path.join(inputs.design, 'provenance.json')));
  if (assets.length === 0 && !record.exists) return g.ok('no asset files in the repository and no provenance record needed');
  if (!record.exists) return g.fail(`${where} is missing while ${assets.length} asset file(s) ship; add an entry per file (source, licence, ai)`, assets.slice(0, 50).map((file) => ({ file })));
  /** @type {Evidence[]} */
  const problems = record.problems.map((p) => ({ file: where, detail: p }));
  const byPath = new Map(record.entries.map((e) => [e.path, e]));
  const missing = assets.filter((a) => !byPath.has(a));
  for (const file of missing) problems.push({ file, detail: 'no provenance entry' });
  for (const entry of record.entries) {
    if (entry.licenseFile && !existsSync(path.join(inputs.root, entry.licenseFile))) problems.push({ file: entry.path, detail: `licenseFile ${entry.licenseFile} does not exist` });
  }
  const stale = record.entries.filter((e) => !existsSync(path.join(inputs.root, e.path))).map((e) => ({ file: e.path, detail: 'entry for a file that no longer exists (not a failure)' }));
  if (problems.length > 0) return g.fail(`${missing.length} asset(s) without an entry, ${problems.length - missing.length} invalid entr(y/ies) in ${where}`, [...problems, ...stale]);
  return g.ok(`${assets.length} asset file(s), each with a complete entry in ${where}`, stale);
}

// --- ip.concept-label -------------------------------------------------------------------------------------------

/**
 * @param {CheckContext} ctx
 * @param {Inputs} inputs
 * @param {RenderSet | null} rendered
 * @param {string} noPages
 * @returns {GateResult}
 */
function conceptLabelGate(ctx, inputs, rendered, noPages) {
  const g = builder('ip.concept-label');
  const brief = inputs.brief();
  const customers = customersOf(brief, ctx.profile);
  if (customers.length === 0) {
    if (!brief && (ctx.profile?.references ?? []).length === 0) {
      return g.skip(`no customer list: ${ctx.state ? `${toPosix(path.join(ctx.state, 'brief.json'))} is missing` : 'no state folder'} and the profile has no references; run brief.mjs first`);
    }
    return g.ok('the brief names no customer, so no section needs a concept label');
  }
  if (!rendered) return g.skip(`customer names not checked on rendered pages: ${noPages}`);
  /** @type {Evidence[]} */
  const missing = [];
  let labelled = 0;
  for (const page of rendered.pages) {
    for (const text of page.probe.texts) {
      if (text.inLabel) continue;
      const named = customers.filter((c) => mentions(text.text, c, true));
      if (named.length === 0) continue;
      const labels = page.probe.labels.filter((l) => l.section === text.section && l.visible && l.opacity >= 0.5 && l.fontSize >= 10 && DISCLAIMER.test(l.text));
      if (labels.length > 0) {
        labelled += 1;
        continue;
      }
      const invisible = page.probe.labels.some((l) => l.section === text.section);
      missing.push({
        route: page.route,
        viewport: page.viewport.name,
        selector: text.sel,
        value: named.join(', '),
        detail: invisible
          ? 'the section has a data-concept-label that is not visible, too small, or not a disclaimer'
          : `no visible data-concept-label in its section (${text.section}): "Concept mockup. Not affiliated with, endorsed by or sponsored by ${named[0]}."`,
      });
    }
  }
  const unique = dedupeEvidence(missing);
  if (unique.length > 0) return g.fail(`${unique.length} mention(s) of a customer without a visible concept label in the same section`, unique);
  return g.ok(`${customers.length} customer name(s) checked on ${rendered.pages.length} page(s): ${labelled} labelled mention(s), none unlabelled`);
}

// --- ip.copy-overlap --------------------------------------------------------------------------------------------

/**
 * @param {CheckContext} ctx
 * @param {RenderSet | null} rendered
 * @param {string} noPages
 * @returns {GateResult}
 */
function copyOverlapGate(ctx, rendered, noPages) {
  const g = builder('ip.copy-overlap');
  const found = capturedCopy(ctx.state);
  /** @type {CopyIndex | null} */
  let index = null;
  let source = '';
  if (found.captured.length > 0) {
    index = buildCopyIndex(found.captured);
    source = `${found.captured.length} capture folder(s)`;
  } else if (found.indexFile) {
    const raw = /** @type {CopyIndex | null} */ (readJsonOrNull(found.indexFile));
    if (!raw || raw.version !== 1 || typeof raw.salt !== 'string' || !raw.shingles || typeof raw.n !== 'number') {
      return g.fail(`${found.indexFile} is not a version 1 shingle index {version, n, salt, refs, shingles}`);
    }
    index = raw;
    source = toPosix(path.basename(found.indexFile));
  }
  if (!index) {
    if (found.listed > 0) {
      return g.skip(`the ${found.listed} capture(s) listed in refs-index.json were purged and no shingle index (copy-shingles.json) was kept; the overlap cannot be measured. Run ip-check --index-copy before the purge, or let the owner decide to drop the gate`);
    }
    return g.ok('no customer copy was captured (no refs-index.json captures, no shingle index), so nothing can overlap');
  }
  if (!rendered) return g.skip(`captured customer copy exists (${source}) but rendered text was not checked: ${noPages}`);
  /** @type {Evidence[]} */
  const hits = [];
  const seen = new Set();
  for (const page of rendered.pages) {
    for (const text of page.probe.texts) {
      if (seen.has(text.text)) continue;
      seen.add(text.text);
      for (const run of overlapRuns(text.text, index)) {
        hits.push({
          route: page.route,
          viewport: page.viewport.name,
          selector: text.sel,
          value: run.text.slice(0, 160),
          detail: `${run.words} consecutive words shared with ${run.refs.map((r) => index?.refs[r]?.customer ?? r).join(', ')}; rewrite from the brief`,
        });
      }
    }
  }
  if (hits.length > 0) return g.fail(`${hits.length} run(s) of ${index.n} or more words shared with captured customer copy`, hits);
  return g.ok(`no run of ${index.n} words shared with captured customer copy (${source}, boilerplate shared by two references excluded)`);
}

// --- ip.sponsor-marks -------------------------------------------------------------------------------------------

/**
 * @param {SponsorEntry} entry
 * @returns {Array<{re: RegExp, basis: string, advisory: boolean}>}
 */
function forbiddenPatterns(entry) {
  const out = [];
  for (const f of entry.forbidden_phrases ?? []) {
    try {
      const flags = String(f.flags ?? '').replace(/[^imsu]/g, '');
      out.push({ re: new RegExp(f.regex, `${flags}g`), basis: String(f.basis ?? ''), advisory: f.severity === 'advisory' });
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * @param {Box} a
 * @param {Box} b
 * @returns {number}
 */
function gapBetween(a, b) {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  const overlapY = Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
  const overlapX = Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x);
  if (overlapY) return dx;
  if (overlapX) return dy;
  return Math.hypot(dx, dy);
}

/**
 * @param {CheckContext} ctx
 * @param {Inputs} inputs
 * @param {RenderSet | null} rendered
 * @param {string} noPages
 * @returns {GateResult}
 */
function sponsorMarksGate(ctx, inputs, rendered, noPages) {
  const g = builder('ip.sponsor-marks');
  const { all, byHash } = inputs.sponsors();
  const project = inputs.projectName();
  /** @type {Evidence[]} */
  const notes = project
    ? namingHits(project, all).map((h) => ({ value: h.token, detail: `naming: "${project}" ${h.how} with ${h.sponsor}'s "${h.entry}"; the owner decides (not a failure)` }))
    : [];
  if (!rendered) return g.skip(`sponsor marks and phrases not checked on rendered pages: ${noPages}`);
  const brand = inputs.brandFiles();
  /** @type {Evidence[]} */
  const failures = [];
  const patterns = all.map((entry) => ({ entry, list: forbiddenPatterns(entry) }));
  const phraseSeen = new Set();
  let logos = 0;
  for (const page of rendered.pages) {
    const where = { route: page.route, viewport: page.viewport.name };
    const pageText = page.probe.texts.map((t) => t.text).join(' ').normalize('NFKC').replace(/\s+/g, ' ');
    const marks = page.probe.images.filter((img) => img.visible && firstParty(img, page.imageHashes, brand, project));
    for (const img of page.probe.images) {
      if (!img.visible) continue;
      const match = img.urls.map((u) => byHash.get(page.imageHashes.get(u) ?? '')).find(Boolean);
      if (!match) continue;
      logos += 1;
      const at = { ...where, selector: img.sel, value: `${match.entry.sponsor} ${match.variant}` };
      const altered = [...img.transform];
      if (img.filter) altered.push(`filter ${img.filter}`);
      if (img.blend) altered.push(`mix-blend-mode ${img.blend}`);
      if (img.opacity < 0.99) altered.push(`opacity ${img.opacity}`);
      if (altered.length > 0) failures.push({ ...at, detail: `altered: ${altered.join('; ')} (no transform other than a ratio-preserving scale, no filter or effect)` });
      const moving = [];
      if (img.animated) moving.push('animated at rest');
      if (page.hoverAnimated.get(img.sel)) moving.push('animates on hover');
      if (img.transitionMs > 0) moving.push(`declares a ${img.transitionMs} ms transition`);
      if (moving.length > 0) failures.push({ ...at, detail: `${moving.join('; ')}: sponsor marks never animate (FD21-F09)` });
      const rule = minSizeRule(match.entry, match.variant, page.viewport);
      if (rule) {
        const size = rule.measure === 'height' ? img.client.h : img.client.w;
        if (size + 0.5 < rule.px) failures.push({ ...at, detail: `${rule.measure} ${size} px is below the ${rule.px} px minimum (${rule.key})` });
      }
      const others = page.probe.visuals.filter((v) => v.sel !== img.sel);
      const area = img.client.w * img.client.h;
      const largestInView = Math.max(0, ...others.map((v) => v.viewportArea));
      const viewArea = Math.max(0, Math.min(img.client.x + img.client.w, page.probe.vw) - Math.max(img.client.x, 0)) * Math.max(0, Math.min(img.client.y + img.client.h, page.probe.vh) - Math.max(img.client.y, 0));
      const largestOnPage = Math.max(0, ...others.map((v) => v.area));
      if ((viewArea > 0 && viewArea >= largestInView) || area >= largestOnPage) {
        failures.push({ ...at, detail: `the largest visual element ${viewArea > 0 && viewArea >= largestInView ? 'in the first viewport' : 'on the page'} (${img.client.w}x${img.client.h}): a sponsor mark is never the focal point` });
      }
      if (!sponsorLogoAllowedLockup(match.entry)) {
        const unit = Math.max(8, Math.min(img.box.w, img.box.h));
        const near = marks.find((m) => m.sel !== img.sel && gapBetween(m.box, img.box) <= unit);
        if (near) failures.push({ ...at, detail: `within one clear-space unit (${unit} px, approximated by the logo's short side) of the project mark ${near.sel}: a lockup needs the sponsor's approval` });
      }
      const notice = match.entry.trademark_notice?.with_logo;
      if (notice && !pageText.includes(notice.normalize('NFKC').replace(/\s+/g, ' '))) {
        failures.push({ ...at, detail: `the page lacks the trademark notice "${notice}"` });
      }
    }
    for (const text of page.probe.texts) {
      if (text.code) continue;
      for (const { entry, list } of patterns) {
        for (const p of list) {
          p.re.lastIndex = 0;
          for (const m of text.text.matchAll(p.re)) {
            const key = `${entry.sponsor}|${m[0]}|${text.sel}`;
            if (phraseSeen.has(key)) continue;
            phraseSeen.add(key);
            const ev = { ...where, selector: text.sel, value: m[0], detail: `${entry.sponsor}: ${p.basis || 'forbidden phrase'}${p.advisory ? ' (advisory)' : ''}` };
            if (p.advisory) notes.push(ev);
            else failures.push(ev);
          }
        }
      }
    }
  }
  const unique = dedupeEvidence(failures);
  if (unique.length > 0) return g.fail(`${unique.length} sponsor mark or naming problem(s) on ${rendered.pages.length} page(s)`, [...unique, ...notes]);
  return g.ok(`${logos} sponsor logo rendering(s) unaltered, sized, secondary and apart; no forbidden phrase${notes.length ? `; ${notes.length} note(s) for the owner` : ''}`, notes);
}

/**
 * A lockup with the project mark is allowed only with recorded approval (FD21-F04, F13).
 * @param {SponsorEntry} entry
 * @returns {boolean}
 */
function sponsorLogoAllowedLockup(entry) {
  const evidence = entry.approval_evidence;
  return evidence !== null && evidence !== undefined && evidence !== '';
}

// ---------------------------------------------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------------------------------------------

const HELP = `ip-check: licences, hotlinks, logos, provenance, concept labels, copy overlap and sponsor marks.

Usage:
  node ip-check.mjs [--root <repo>] [--profile <abs path>] [--state <dir>] (--serve <dir> | --url <url>)
                    [--gates ip|ip.fonts,...] [--json] [--out <dir>] [--allow-skip <id>] [--network]
                    [--sponsor-allowlist <file>]
  node ip-check.mjs --index-copy [--root <repo>] [--profile <abs path>] [--state <dir>]

Gates: ${GATES.map((g) => g.id).join(', ')}.

Flags:
  --root <repo>              product repository (default: the working directory)
  --profile <abs path>       /execution profile.json or a frontend block file (default: discovered under --root)
  --state <dir>              state folder (default: .execution/frontend in mode A, .frontend in mode B)
  --serve <dir>              serve a static build and check it
  --url <url>                check a running app
  --gates <list>             comma-separated gate ids or the group name ip (default: all)
  --json                     print the gate report as JSON on stdout
  --out <dir>                also write <dir>/ip-check.json
  --allow-skip <id>          let a skipped gate pass the overall verdict (never in a task proof)
  --network                  let pages reach hosts other than the app (Google Fonts stay blocked)
  --sponsor-allowlist <file> another sponsor allowlist (default: the skill's assets/sponsor-allowlist.json)
  --index-copy               write <state>/copy-shingles.json, a salted 8-word shingle index of the captured customer
                             copy listed in refs-index.json, so ip.copy-overlap can run after the purge (the owner
                             decides whether the index may be kept)

Exit codes: 0 every requested gate ok; 1 a gate failed or was skipped; 2 usage error; 3 environment error.
`;

const OPTIONS = /** @type {const} */ ({
  root: { type: 'string' },
  profile: { type: 'string' },
  state: { type: 'string' },
  serve: { type: 'string' },
  url: { type: 'string' },
  gates: { type: 'string' },
  json: { type: 'boolean' },
  out: { type: 'string' },
  'allow-skip': { type: 'string', multiple: true },
  network: { type: 'boolean' },
  'sponsor-allowlist': { type: 'string' },
  'index-copy': { type: 'boolean' },
});

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const { values } = parseCli(argv, { options: OPTIONS, help: HELP, allowPositionals: false });
  const root = path.resolve(values.root ?? process.cwd());
  if (!isDirectory(root)) throw new UsageError(`--root ${toPosix(root)} is not a folder; pass the repository root`);
  const profile = loadProfile(values.profile, { root });
  /** @type {(m: string) => void} */
  const log = (m) => {
    process.stderr.write(`${m}\n`);
  };
  let state = null;
  try {
    state = checkStateDir(root, profile, values.state ?? null, values['index-copy'] ? null : values.out);
  } catch (err) {
    if (!(err instanceof EnvError)) throw err;
    log(`${TOOL}: no state folder (${err.message}); gates that read it will say so`);
  }
  if (values['index-copy']) {
    if (!state) throw new UsageError('--index-copy needs a state folder; pass --state <dir>');
    const found = capturedCopy(state);
    if (found.captured.length === 0) throw new UsageError(`no captured customer copy under the capture folders listed in ${toPosix(path.join(state, 'refs-index.json'))} (listed ${found.listed}, purged ${found.purged})`);
    const file = writeText(path.join(state, 'copy-shingles.json'), `${JSON.stringify(buildCopyIndex(found.captured), null, 2)}\n`);
    process.stdout.write(`${file}\n`);
    return 0;
  }
  const selected = selectGates(values.gates ? values.gates.split(',') : null);
  if (values.url && values.serve) throw new UsageError('pass either --url or --serve, not both');
  /** @type {import('./lib/serve.mjs').StaticServer | null} */
  let server = null;
  /** @type {Browser | null} */
  let browser = null;
  try {
    let baseUrl = values.url ?? null;
    if (values.serve) {
      server = await serveStatic(path.resolve(values.serve));
      baseUrl = server.url;
    }
    if (baseUrl && selected.some((id) => RUNTIME_GATES.has(id))) browser = await launch();
    /** @type {CheckContext} */
    const ctx = {
      root: toPosix(root),
      profile,
      state,
      design: designDir(root, profile),
      routes: loadRoutes(root, profile),
      baseUrl,
      browser,
      viewports: profile.viewports,
      args: { ...values },
      log,
    };
    const results = await run(ctx, selected);
    const report = aggregate(results, {
      allowSkip: values['allow-skip'] ?? [],
      requested: GATES.filter((g) => selected.includes(g.id)),
      tool: TOOL,
      target: { root: toPosix(root), url: baseUrl, routes: ctx.routes.length, viewports: ctx.viewports.map((v) => v.name) },
    });
    if (values.out) log(`${TOOL}: report written to ${writeReport(report, values.out, TOOL)}`);
    process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : summary(report));
    return report.ok ? 0 : 1;
  } finally {
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  }
}

/**
 * @param {import('./lib/report.mjs').GateReport} report
 * @returns {string}
 */
function summary(report) {
  const lines = report.gates.map((g) => `${g.state.padEnd(7)} ${g.id}: ${g.detail}`);
  lines.push(`${report.ok ? 'ok' : 'not ok'}: ${report.counts.ok} ok, ${report.counts.fail} fail, ${report.counts.skipped} skipped`);
  return `${lines.join('\n')}\n`;
}

/**
 * @param {string} moduleUrl
 * @returns {boolean}
 */
function invokedDirectly(moduleUrl) {
  return isMainModule(moduleUrl);
}

if (invokedDirectly(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => exitWith(err instanceof FrontendError ? err : err),
  );
}
