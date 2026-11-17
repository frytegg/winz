// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GATES, OPEN_LICENCES, assetFiles, buildCopyIndex, capturedCopy, classifyLicence, customersOf, fontFaceRules,
  keepsReservedName, logoReasons, minSizeRule, namingHits, overlapRuns, readFontInfo, readSponsorEntries,
  reservedFontNames, run, selectGates, shingles, sponsorKitFaces, sponsorLogoAllowed, subsetSignals, words,
  woff2ToSfnt,
} from '../../ip-check.mjs';
import { EnvError, UsageError } from '../../lib/errors.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { aggregate } from '../../lib/report.mjs';
import { makeFont, makeWorkspace, toWoff, toWoff2 } from './helpers.mjs';

/** @typedef {import('../../ip-check.mjs').ProbeImage} ProbeImage */
/** @typedef {import('../../ip-check.mjs').SponsorEntry} SponsorEntry */

const CLI = fileURLToPath(new URL('../../ip-check.mjs', import.meta.url));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-ip-unit-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const OFL_FONT = { family: 'Unit Sans', license: 'This Font Software is licensed under the SIL Open Font License, Version 1.1.', licenseURL: 'https://openfontlicense.org' };

/**
 * @param {Partial<ProbeImage>} over
 * @returns {ProbeImage}
 */
function image(over) {
  const box = { x: 0, y: 0, w: 40, h: 40 };
  return {
    sel: 'img', kind: 'img', urls: [], alt: '', label: '', title: '', svgTitle: '', paths: [], box, client: box,
    visible: true, opacity: 1, filter: '', blend: '', transform: [], transitionMs: 0, animated: false, rowSize: 1,
    rowMaxHeight: 40, link: null, sectionHeading: '', inChrome: false, ...over,
  };
}

describe('ip-check gate metadata and selection', () => {
  test('GATES lists exactly the contract ids, each with a title and ifDropped', () => {
    assert.deepEqual(GATES.map((g) => g.id), ['ip.fonts', 'ip.hotlinks', 'ip.logos', 'ip.provenance', 'ip.concept-label', 'ip.copy-overlap', 'ip.sponsor-marks']);
    for (const g of GATES) {
      assert.ok(g.title.length > 10 && g.ifDropped.length > 10, g.id);
    }
  });

  test('selectGates accepts the group name and ids, in GATES order; unknown ids are usage errors', () => {
    assert.equal(selectGates(null).length, 7);
    assert.deepEqual(selectGates(['ip']), GATES.map((g) => g.id));
    assert.deepEqual(selectGates(['ip.logos', ' ip.fonts ']), ['ip.fonts', 'ip.logos']);
    assert.throws(() => selectGates(['ip.nope']), UsageError);
  });
});

describe('ip-check fonts', () => {
  test('readFontInfo reads names and coverage from OTF, WOFF and WOFF2 (including a TrueType WOFF2 with transformed glyf)', () => {
    const otf = makeFont({ ...OFL_FONT, copyright: 'Copyright 2026 Unit Corp.', coverage: 'full' });
    for (const bytes of [otf, toWoff(otf), toWoff2(otf), toWoff2(otf, { truetypeStub: true })]) {
      const info = readFontInfo(bytes);
      assert.equal(info.error, null, `${info.format}: ${info.error}`);
      assert.equal(info.family, 'Unit Sans');
      assert.match(String(info.license), /Open Font License/);
      assert.equal(info.copyright, 'Copyright 2026 Unit Corp.');
    }
    assert.deepEqual(['otf', 'woff', 'woff2'].map((f, i) => readFontInfo([otf, toWoff(otf), toWoff2(otf)][i]).format), ['otf', 'woff', 'woff2']);
    const full = readFontInfo(otf);
    assert.equal(full.latinExtA, 1, 'full coverage maps all of Latin Extended-A');
    const basic = readFontInfo(makeFont(OFL_FONT));
    assert.equal(basic.codePoints, 95);
    assert.equal(basic.latinExtA, 0);
  });

  test('readFontInfo never throws: unknown bytes and EOT come back with an error', () => {
    assert.match(String(readFontInfo(Buffer.from('not a font at all, just text')).error), /unknown/);
    assert.throws(() => woff2ToSfnt(Buffer.from('nope')), /not a WOFF2/);
  });

  test('classifyLicence recognises the open licences and the Fontshare FFL', () => {
    assert.equal(classifyLicence('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007'), 'OFL');
    assert.equal(classifyLicence('Licensed under the Apache License, Version 2.0'), 'Apache-2.0');
    assert.equal(classifyLicence('UBUNTU FONT LICENCE Version 1.0'), 'UFL');
    assert.equal(classifyLicence('MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy'), 'MIT');
    assert.equal(classifyLicence('ITF Free Font License (FFL)'), 'FFL');
    assert.equal(classifyLicence('All rights reserved. Desktop licence only.'), 'unknown');
    assert.deepEqual([...OPEN_LICENCES], ['OFL', 'Apache-2.0', 'UFL', 'MIT']);
  });

  test('reservedFontNames reads quoted, unquoted and plural forms', () => {
    assert.deepEqual(reservedFontNames('Copyright 2017 IBM Corp. with Reserved Font Name "Plex"'), ['Plex']);
    assert.deepEqual(reservedFontNames('with Reserved Font Names "Source" and "Source Sans".'), ['Source', 'Source Sans']);
    assert.deepEqual(reservedFontNames('with Reserved Font Name Fira.'), ['Fira']);
    assert.deepEqual(reservedFontNames('Copyright 2020 The Inter Project Authors'), []);
  });

  test('keepsReservedName matches whole words only', () => {
    assert.equal(keepsReservedName('IBM Plex Sans', 'Plex'), true);
    assert.equal(keepsReservedName('Complexity Sans', 'Plex'), false);
    assert.equal(keepsReservedName(null, 'Plex'), false);
  });

  test('subsetSignals: unicode-range, a subset file name and a provider source are explicit; low coverage is structural', () => {
    const info = readFontInfo(toWoff2(makeFont(OFL_FONT)));
    const explicit = subsetSignals({ file: 'fonts/plex-latin.woff2', info, unicodeRanges: ['U+0000-00FF'], provenanceText: 'fontsource' });
    assert.equal(explicit.explicit.length, 3);
    const structural = subsetSignals({ file: 'fonts/UnitSans.woff2', info, unicodeRanges: [], provenanceText: '' });
    assert.deepEqual(structural.explicit, []);
    assert.equal(structural.structural.length, 1);
    const full = subsetSignals({ file: 'fonts/UnitSans.woff2', info: readFontInfo(toWoff2(makeFont({ ...OFL_FONT, coverage: 'full' }))), unicodeRanges: [], provenanceText: '' });
    assert.deepEqual(full, { explicit: [], structural: [] });
  });

  test('fontFaceRules extracts family, URLs and unicode-range', () => {
    const rules = fontFaceRules('@font-face { font-family: "Unit Sans"; src: url(/fonts/a.woff2) format("woff2"), url(\'/fonts/a.woff\'); unicode-range: U+0000-00FF; }\n@font-face{font-family:Other;src:url(b.ttf)}');
    assert.equal(rules.length, 2);
    assert.deepEqual(rules[0].urls, ['/fonts/a.woff2', '/fonts/a.woff']);
    assert.equal(rules[0].family, 'Unit Sans');
    assert.equal(rules[0].unicodeRange, 'U+0000-00FF');
    assert.equal(rules[1].family, 'Other');
    assert.equal(rules[1].unicodeRange, null);
  });
});

describe('ip-check sponsor allowlist helpers', () => {
  /** @type {SponsorEntry} */
  const bnb = {
    sponsor: 'bnb', logo_default: 'text_only', approval_evidence: null,
    clear_space: { min_size: { horizontal_lockup_width_px: 120, logomark_width_px: 24 } },
    typography: [{ family: 'ABC Diatype / Brut Grotesque', licence: 'commercial' }, { family: 'Open Thing', licence: 'OFL-1.1' }],
    naming_blocklist: ['BNB', 'BINANCE'],
  };

  test('readSponsorEntries: a missing skill file is an environment error, a missing caller file a usage error', () => {
    assert.throws(() => readSponsorEntries(path.join(tmp, 'none.json')), EnvError);
    assert.throws(() => readSponsorEntries(path.join(tmp, 'none.json'), true), UsageError);
    const file = path.join(tmp, 'allow.json');
    writeFileSync(file, JSON.stringify({ sponsors: [{ id: 'Cardano' }, { nothing: true }] }));
    assert.deepEqual(readSponsorEntries(file).map((e) => e.sponsor), ['cardano']);
    writeFileSync(file, '{"broken"');
    assert.throws(() => readSponsorEntries(file, true), UsageError);
  });

  test('the skill ships a sponsor allowlist that parses', () => {
    const entries = readSponsorEntries(fileURLToPath(new URL('../../../assets/sponsor-allowlist.json', import.meta.url)));
    assert.ok(entries.length >= 5, 'FD21 covers nine parties');
  });

  test('sponsorLogoAllowed needs the official-file default or recorded approval', () => {
    assert.equal(sponsorLogoAllowed({ sponsor: 'a', logo_default: 'official_file_unaltered_allowed' }), true);
    assert.equal(sponsorLogoAllowed({ sponsor: 'b', logo_default: 'text_only', approval_evidence: [] }), false);
    assert.equal(sponsorLogoAllowed({ sponsor: 'c', logo_default: 'text_only', approval_evidence: 'email of 2026-10-02' }), true);
  });

  test('sponsorKitFaces lists commercial kit faces, split on slashes, and skips open ones', () => {
    assert.deepEqual(sponsorKitFaces([bnb]).map((f) => f.family), ['ABC Diatype', 'Brut Grotesque']);
  });

  test('minSizeRule picks the variant key or the viewport key', () => {
    assert.deepEqual(minSizeRule(bnb, 'horizontal-lockup', { width: 1440 }), { px: 120, measure: 'width', key: 'horizontal_lockup_width_px' });
    assert.deepEqual(minSizeRule(bnb, 'logomark', { width: 1440 }), { px: 24, measure: 'width', key: 'logomark_width_px' });
    const web = { sponsor: 'w', clear_space: { min_size: { web_px: 64, tablet_px: 60, phone_px: 56, dimension: 'height' } } };
    assert.deepEqual(minSizeRule(web, 'x', { width: 390, isMobile: true }), { px: 56, measure: 'height', key: 'phone_px' });
    assert.deepEqual(minSizeRule(web, 'x', { width: 900 }), { px: 60, measure: 'height', key: 'tablet_px' });
    assert.equal(minSizeRule({ sponsor: 'none' }, 'x', { width: 1440 }), null);
  });

  test('namingHits finds same tokens, compounds and near variants (never a failure)', () => {
    const hits = namingHits('BNBridge Binanse pay', [bnb]);
    assert.ok(hits.some((h) => h.token === 'BNBRIDGE' && h.how === 'part of a compound'));
    assert.ok(hits.some((h) => h.token === 'BINANSE' && h.how === 'near variant'));
    assert.deepEqual(namingHits('Orbitly', [bnb]), []);
  });
});

describe('ip-check copy overlap', () => {
  test('words and shingles fold case, quotes and punctuation', () => {
    assert.deepEqual(words('It’s FAST, really.'), ["it's", 'fast', 'really']);
    assert.equal(shingles('one two three four five six seven eight nine').length, 2);
    assert.deepEqual(shingles('too short'), []);
  });

  test('the index drops boilerplate shared by two customers and finds runs of 8 or more words', () => {
    const cookie = 'This site uses cookies to improve your experience and analyse traffic.';
    const index = buildCopyIndex([
      { ref: 'R1', customer: 'Fjord Pay', texts: ['Settle every cross border invoice in seconds with fully automated compliance checks.', cookie] },
      { ref: 'R2', customer: 'Northwind', texts: [cookie] },
    ], { salt: 'fixed' });
    assert.equal(index.version, 1);
    assert.equal(index.n, 8);
    assert.ok(!JSON.stringify(index).includes('invoice'), 'the index stores hashes, never the copy');
    const hits = overlapRuns('We settle every cross border invoice in seconds with fully automated tooling.', index);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].words, 10);
    assert.deepEqual(hits[0].refs, ['R1']);
    assert.deepEqual(overlapRuns(cookie, index), [], 'shared boilerplate is not a hit');
    assert.deepEqual(overlapRuns('settle every cross border invoice in seconds', index), [], 'seven words are not a hit');
  });

  test('capturedCopy reads captures listed in refs-index.json and counts purged folders', () => {
    const ws = makeWorkspace();
    try {
      const found = capturedCopy(ws.state);
      assert.equal(found.listed, 3);
      assert.equal(found.purged, 1);
      assert.deepEqual(found.captured.map((c) => c.customer), ['Fjord Pay', 'Northwind']);
      assert.equal(found.captured[1].texts.length, 2, 'a .txt capture splits on blank lines');
      assert.equal(capturedCopy(ws.emptyState).listed, 0);
      assert.equal(capturedCopy(null).listed, 0);
    } finally {
      rmSync(ws.tmp, { recursive: true, force: true });
    }
  });
});

describe('ip-check logos and provenance helpers', () => {
  test('logoReasons: names, file names, party names, textless outbound links, logo rows and trusted-by sections', () => {
    assert.deepEqual(logoReasons(image({ alt: 'Hero illustration', urls: ['http://x/hero.svg'] }), ['Fjord Pay']), []);
    assert.ok(logoReasons(image({ alt: 'Acme logo' }), []).length > 0);
    assert.ok(logoReasons(image({ urls: ['http://x/img/partner-a.svg'] }), []).some((r) => /named like a logo/.test(r)));
    assert.ok(logoReasons(image({ alt: 'Fjord Pay' }), ['Fjord Pay']).some((r) => /mentions Fjord Pay/.test(r)));
    assert.ok(logoReasons(image({ link: { href: 'https://other.example/', external: true, textless: true } }), []).some((r) => /only content of a link/.test(r)));
    assert.ok(logoReasons(image({ rowSize: 4, rowMaxHeight: 32 }), []).some((r) => /in a row/.test(r)));
    assert.ok(logoReasons(image({ rowSize: 2, sectionHeading: 'Trusted by teams' }), []).some((r) => /section headed/.test(r)));
  });

  test('customersOf merges brief customers and profile references', () => {
    const profile = defaultProfile({ references: [{ customer: 'Northwind', url: '', source: '', owner_confirmed: false }] });
    assert.deepEqual(customersOf({ customers: [{ name: 'Fjord Pay' }, { name: '' }] }, profile), ['Fjord Pay', 'Northwind']);
    assert.deepEqual(customersOf(null, defaultProfile()), []);
  });

  test('assetFiles keeps images, fonts, media and data under asset folders, not configuration', () => {
    const files = ['public/a.png', 'src/config/b.json', 'public/data/c.json', 'public/manifest.json', 'public/site.webmanifest', 'design/fonts/x.woff2', 'public/clip.mp4', 'src/app.ts', 'package.json'];
    assert.deepEqual(assetFiles([...files, 'src/data/demo.json']), ['public/a.png', 'public/data/c.json', 'design/fonts/x.woff2', 'public/clip.mp4', 'src/data/demo.json']);
  });
});

describe('ip-check run without pages and CLI', () => {
  test('a missing provenance record fails ip.provenance when assets ship; a project with none passes', async () => {
    const repo = path.join(tmp, 'prov');
    mkdirSync(path.join(repo, 'public'), { recursive: true });
    writeFileSync(path.join(repo, 'public', 'a.png'), 'x');
    const allow = path.join(tmp, 'allow-empty.json');
    writeFileSync(allow, JSON.stringify({ sponsor_allowlist: [] }));
    const ctx = { root: repo, profile: defaultProfile(), state: null, design: path.join(repo, 'design'), routes: [], baseUrl: null, browser: null, viewports: [], args: { 'sponsor-allowlist': allow }, log: () => undefined };
    const [missing] = await run(ctx, ['ip.provenance']);
    assert.equal(missing.state, 'fail');
    assert.match(missing.detail, /provenance\.json is missing/);
    rmSync(path.join(repo, 'public'), { recursive: true });
    const [none] = await run(ctx, ['ip.provenance']);
    assert.equal(none.state, 'ok');
    assert.equal(aggregate([none]).ok, true);
  });

  test('a profile sponsor without an allowlist entry exempts nothing and is never an error (Q-FX-5)', async () => {
    const allow = path.join(tmp, 'allow-empty2.json');
    writeFileSync(allow, JSON.stringify({ sponsor_allowlist: [] }));
    const ctx = { root: tmp, profile: defaultProfile({ sponsors: ['nobody'] }), state: null, design: path.join(tmp, 'design'), routes: [], baseUrl: null, browser: null, viewports: [], args: { 'sponsor-allowlist': allow }, log: () => undefined };
    const plain = { ...ctx, profile: defaultProfile() };
    const [withUnknown] = await run(ctx, ['ip.logos']);
    const [without] = await run(plain, ['ip.logos']);
    assert.equal(withUnknown.state, without.state, 'an unknown sponsor changes nothing');
    assert.equal(withUnknown.detail, without.detail);
  });

  test('--help exits 0; an unknown gate exits 2; a missing root exits 2', () => {
    const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Exit codes/);
    const bad = spawnSync(process.execPath, [CLI, '--root', tmp, '--gates', 'ip.nope'], { encoding: 'utf8' });
    assert.equal(bad.status, 2, bad.stderr);
    const noRoot = spawnSync(process.execPath, [CLI, '--root', path.join(tmp, 'absent')], { encoding: 'utf8' });
    assert.equal(noRoot.status, 2, noRoot.stderr);
  });

  test('--index-copy writes a salted shingle index into the state folder', () => {
    const ws = makeWorkspace();
    try {
      const r = spawnSync(process.execPath, [CLI, '--root', ws.pass, '--state', ws.state, '--index-copy'], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const file = path.join(ws.state, 'copy-shingles.json');
      assert.ok(existsSync(file));
      const index = JSON.parse(readFileSync(file, 'utf8'));
      assert.equal(index.version, 1);
      assert.ok(Object.keys(index.shingles).length > 0);
      const empty = spawnSync(process.execPath, [CLI, '--root', ws.pass, '--state', ws.emptyState, '--index-copy'], { encoding: 'utf8' });
      assert.equal(empty.status, 2, 'nothing to index is a usage error');
    } finally {
      rmSync(ws.tmp, { recursive: true, force: true });
    }
  });

  test('a file-only selection runs from the CLI without a browser: ip.provenance on the passing fixture exits 0', () => {
    const ws = makeWorkspace();
    try {
      const r = spawnSync(process.execPath, [CLI, '--root', ws.pass, '--state', ws.state, '--gates', 'ip.provenance', '--json', '--sponsor-allowlist', ws.sponsorFile], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const report = JSON.parse(r.stdout);
      assert.equal(report.tool, 'ip-check');
      assert.equal(report.gates[0].state, 'ok');
      const f = spawnSync(process.execPath, [CLI, '--root', ws.fail, '--state', ws.state, '--gates', 'ip.provenance', '--sponsor-allowlist', ws.sponsorFile], { encoding: 'utf8' });
      assert.equal(f.status, 1, f.stdout);
    } finally {
      rmSync(ws.tmp, { recursive: true, force: true });
    }
  });
});
