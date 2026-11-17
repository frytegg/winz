// @ts-check
/**
 * Regenerates the derived files of the end-to-end fixtures (run: node tests/e2e/build-fixtures.mjs). The hand-written
 * files (research/, dot-frontend/profile.json and never-show.json, design/tokens.json and routes.json, brand/mark.svg,
 * the HTML and CSS of site/) stay as committed; this script rebuilds what the skill's own commands derive from them,
 * through those commands, so the fixtures follow the pipeline a real build follows:
 *
 * - two fonts drawn with opentype.js (rectangle glyphs, no third-party outline) as WOFF, plus OFL.txt;
 * - tokens.mjs build: site/tokens.css and design/DESIGN.md;
 * - brand.mjs wordmark, icons and og: brand/wordmark.svg, the favicon set and the OG image in site/;
 * - brief.mjs compiles the brief into scratch space for the OG line only: the tests compile it again on their copy
 *   (FE-00), because brief.json records absolute paths;
 * - design/provenance.json listing every asset file;
 * - bad-site: the same research, profile, never-show list and routes (its site/ is hand-written), plus a face named
 *   Inter laid out the way @fontsource/inter ships it (rectangle glyphs again: only the family name is Inter's), so
 *   the "Inter everywhere" tell renders offline as it did on the owner's past builds.
 *
 * The bytes of the PNG files depend on the Chromium build, so a rebuild may change them; the gates read them, the
 * tests never compare them.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
// @ts-ignore -- opentype.js 2.0.0 ships no type declarations.
import opentype from 'opentype.js';
import { isMainModule } from '../../lib/args.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPTS = path.resolve(HERE, '..', '..');
export const E2E_FIXTURES = path.resolve(HERE, '..', 'fixtures', 'e2e');
export const GOOD = path.join(E2E_FIXTURES, 'good-site');
export const BAD = path.join(E2E_FIXTURES, 'bad-site');
/**
 * The mode-B state folder of each fixture, committed as dot-frontend/ because git excludes .frontend/ (stateDir adds
 * that line to a repository's info/exclude); the tests copy it to <copy>/.frontend/.
 */
export const STATE_FOLDER = 'dot-frontend';

const OFL_TEXT = `Copyright 2026 The Tally Project Authors (fixture fonts of the /frontend skill's end-to-end tests)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

(Fixture licence text: the checks read the header and the licence name. Tally Sans and Tally Mono are rectangle
glyphs drawn by tests/e2e/build-fixtures.mjs.)
`;

/** Printable ASCII, Latin-1 and Latin Extended-A, as a full upstream build maps them. */
const CODE_POINTS = [
  ...Array.from({ length: 0x7f - 0x21 }, (_, i) => 0x21 + i),
  ...Array.from({ length: 0x180 - 0xa1 }, (_, i) => 0xa1 + i),
];

/**
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
 * @returns {any}
 */
function box(x0, y0, x1, y1) {
  const p = new opentype.Path();
  p.moveTo(x0, y0);
  p.lineTo(x1, y0);
  p.lineTo(x1, y1);
  p.lineTo(x0, y1);
  p.close();
  return p;
}

/**
 * An OpenType (CFF) face of rectangles: digits share one advance (tabular figures), a monospace face gives every
 * glyph the same advance.
 * @param {{family: string, monospace: boolean}} spec
 * @returns {Buffer}
 */
export function makeFont({ family, monospace }) {
  const glyphs = [
    new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 500, path: new opentype.Path() }),
    new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: monospace ? 600 : 260, path: new opentype.Path() }),
  ];
  for (const cp of CODE_POINTS) {
    const ch = String.fromCodePoint(cp);
    const digit = cp >= 0x30 && cp <= 0x39;
    const narrow = /[.,:;!'"()[\]{}|`]/.test(ch);
    const lower = /\p{Ll}/u.test(ch);
    const width = monospace ? 600 : digit ? 560 : narrow ? 280 : 480 + (cp % 4) * 40;
    const top = narrow ? 300 : lower ? 520 : 700;
    glyphs.push(new opentype.Glyph({ name: `u${cp.toString(16).padStart(4, '0')}`, unicode: cp, advanceWidth: width, path: box(50, 0, width - 50, top) }));
  }
  const font = new opentype.Font({
    familyName: family,
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    createdTimestamp: 1767225600,
    copyright: 'Copyright 2026 The Tally Project Authors',
    license: 'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
    licenseURL: 'https://openfontlicense.org',
    glyphs,
  });
  return Buffer.from(font.toArrayBuffer());
}

/**
 * WOFF 1.0: every table zlib-compressed when that is smaller, with the checksums of the sfnt's own directory.
 * Chromium's OTS decodes it (it refused the null-transform WOFF2 of a CFF face these fixtures first used).
 * @param {Buffer} sfnt
 * @returns {Buffer}
 */
export function toWoff(sfnt) {
  const count = sfnt.readUInt16BE(4);
  const records = Array.from({ length: count }, (_, i) => {
    const at = 12 + 16 * i;
    const offset = sfnt.readUInt32BE(at + 8);
    const length = sfnt.readUInt32BE(at + 12);
    return { tag: sfnt.toString('latin1', at, at + 4), checksum: sfnt.readUInt32BE(at + 4), data: sfnt.subarray(offset, offset + length) };
  }).sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const directory = Buffer.alloc(20 * count);
  /** @type {Buffer[]} */
  const bodies = [];
  let offset = 44 + directory.length;
  let sfntSize = 12 + 16 * count;
  records.forEach((r, i) => {
    const packed = zlib.deflateSync(r.data);
    const data = packed.length < r.data.length ? packed : r.data;
    directory.write(r.tag, 20 * i, 4, 'latin1');
    directory.writeUInt32BE(offset, 20 * i + 4);
    directory.writeUInt32BE(data.length, 20 * i + 8);
    directory.writeUInt32BE(r.data.length, 20 * i + 12);
    directory.writeUInt32BE(r.checksum, 20 * i + 16);
    const padded = Buffer.alloc((data.length + 3) & ~3);
    data.copy(padded);
    bodies.push(padded);
    offset += padded.length;
    sfntSize += (r.data.length + 3) & ~3;
  });
  const header = Buffer.alloc(44);
  header.write('wOFF', 0, 4, 'latin1');
  header.writeUInt32BE(sfnt.readUInt32BE(0), 4);
  header.writeUInt32BE(offset, 8);
  header.writeUInt16BE(count, 12);
  header.writeUInt32BE(sfntSize, 16);
  header.writeUInt16BE(1, 20);
  return Buffer.concat([header, directory, ...bodies]);
}

/**
 * Runs one of the skill's CLIs and throws with its output when it fails.
 * @param {string} script
 * @param {string[]} args
 * @returns {string} stdout
 */
function runCli(script, args) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { encoding: 'utf8', cwd: SCRIPTS, timeout: 300000 });
  if (r.status !== 0) {
    throw new Error(`${script} ${args.join(' ')} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  }
  return r.stdout;
}

/**
 * @param {string} file
 * @param {string} text
 */
function writeLf(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text.replace(/\r\n/g, '\n'));
}

/** @param {string} p @returns {string} */
const posix = (p) => p.replace(/\\/g, '/');

/**
 * Removes generated files from site/ so a rebuild starts clean (the OG image name carries its hash).
 * @param {string} site
 */
function cleanGenerated(site) {
  for (const name of readdirSync(site)) {
    if (/^opengraph-image\.[0-9a-f]{8}\.png$/.test(name) || ['og.json', 'og-head.html', 'head.html', 'icons.json'].includes(name)) {
      rmSync(path.join(site, name), { force: true });
    }
  }
}

/**
 * Rebuilds every derived file of both fixtures.
 * @returns {{og: string}}
 */
export function buildFixtures() {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'fe-e2e-build-'));
  try {
    const site = path.join(GOOD, 'site');
    const fonts = path.join(site, 'fonts');
    mkdirSync(fonts, { recursive: true });
    cleanGenerated(site);

    const sans = makeFont({ family: 'Tally Sans', monospace: false });
    const mono = makeFont({ family: 'Tally Mono', monospace: true });
    writeFileSync(path.join(fonts, 'TallySans-Regular.woff'), toWoff(sans));
    writeFileSync(path.join(fonts, 'TallyMono-Regular.woff'), toWoff(mono));
    writeLf(path.join(fonts, 'OFL.txt'), OFL_TEXT);
    const otf = path.join(scratch, 'TallySans-Regular.otf');
    writeFileSync(otf, sans);
    writeLf(path.join(scratch, 'OFL.txt'), OFL_TEXT);

    runCli('tokens.mjs', ['build', '--root', GOOD, '--design', path.join(GOOD, 'design'), '--css', path.join(site, 'tokens.css'), '--tailwind', 'no', '--force']);

    const wordmark = path.join(scratch, 'wordmark.svg');
    runCli('brand.mjs', ['wordmark', '--text', 'Quayside', '--font', otf, '--out', wordmark]);
    copyFileSync(wordmark, path.join(GOOD, 'brand', 'wordmark.svg'));
    runCli('brand.mjs', ['icons', path.join(GOOD, 'brand', 'mark.svg'), '--out', site, '--name', 'Quayside', '--bg', '#fbfcfe', '--ink', '#1b2333', '--dark', '#eef1f7']);

    const state = path.join(scratch, 'state');
    runCli('brief.mjs', ['--root', GOOD, '--profile', path.join(GOOD, STATE_FOLDER, 'profile.json'), '--state', state]);

    const og = JSON.parse(runCli('brand.mjs', [
      'og', '--mark', path.join(GOOD, 'brand', 'mark.svg'), '--wordmark', wordmark, '--font', otf,
      '--brief', path.join(state, 'brief.json'), '--field', 'hero.sentence', '--name', 'Quayside', '--out', site,
      '--bg', '#fbfcfe', '--fg', '#1b2333', '--site-url', 'https://quayside.invalid', '--json',
    ]));
    const ogFile = /** @type {string} */ (readdirSync(site).find((n) => /^opengraph-image\.[0-9a-f]{8}\.png$/.test(n)));
    for (const name of ['og.json', 'og-head.html', 'head.html', 'icons.json']) rmSync(path.join(site, name), { force: true });
    for (const page of ['index.html', 'statement.html']) {
      const file = path.join(site, page);
      if (!existsSync(file)) continue;
      writeLf(file, readFileSync(file, 'utf8').replace(/opengraph-image\.[0-9a-f]{8}\.png/g, ogFile));
    }

    writeProvenance(ogFile);
    shareWithBadSite();
    const badAssets = path.join(BAD, 'site', 'assets');
    mkdirSync(badAssets, { recursive: true });
    writeFileSync(path.join(badAssets, 'inter-latin-400-normal.woff'), toWoff(makeFont({ family: 'Inter', monospace: false })));
    return { og: String(og?.image ?? ogFile) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * design/provenance.json: one entry per asset file of the good site.
 * @param {string} ogFile
 */
function writeProvenance(ogFile) {
  const drawn = { license: 'Same licence as the repository', ai: 'assisted', tool: 'Claude with the /frontend skill' };
  const assets = [
    { path: 'brand/mark.svg', kind: 'logo', source: 'Drawn for this project on a 32-unit grid', ...drawn },
    { path: 'brand/wordmark.svg', kind: 'logo', source: 'brand.mjs wordmark from Tally Sans', ...drawn },
    { path: 'site/fonts/TallySans-Regular.woff', kind: 'font', source: 'Generated by tests/e2e/build-fixtures.mjs', license: 'OFL-1.1', licenseFile: 'site/fonts/OFL.txt', ai: 'none' },
    { path: 'site/fonts/TallyMono-Regular.woff', kind: 'font', source: 'Generated by tests/e2e/build-fixtures.mjs', license: 'OFL-1.1', licenseFile: 'site/fonts/OFL.txt', ai: 'none' },
    ...['favicon.ico', 'icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-mask.png'].map((name) => ({
      path: `site/${name}`, kind: 'icon', source: 'brand.mjs icons from brand/mark.svg', ...drawn,
    })),
    { path: `site/${ogFile}`, kind: 'image', source: 'brand.mjs og from the mark, the wordmark and brief hero.sentence', ...drawn },
  ];
  writeLf(path.join(GOOD, 'design', 'provenance.json'), `${JSON.stringify({ assets }, null, 2)}\n`);
}

/** The bad site carries the same project content: research, profile, never-show list and routes. */
function shareWithBadSite() {
  rmSync(path.join(BAD, 'research'), { recursive: true, force: true });
  cpSync(path.join(GOOD, 'research'), path.join(BAD, 'research'), { recursive: true });
  mkdirSync(path.join(BAD, STATE_FOLDER), { recursive: true });
  for (const f of ['profile.json', 'never-show.json']) copyFileSync(path.join(GOOD, STATE_FOLDER, f), path.join(BAD, STATE_FOLDER, f));
  mkdirSync(path.join(BAD, 'design'), { recursive: true });
  copyFileSync(path.join(GOOD, 'design', 'routes.json'), path.join(BAD, 'design', 'routes.json'));
}

if (isMainModule(import.meta.url)) {
  const out = buildFixtures();
  process.stderr.write(`e2e fixtures rebuilt under ${posix(E2E_FIXTURES)} (og image ${out.og})\n`);
}
