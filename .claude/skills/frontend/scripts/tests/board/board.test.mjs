// @ts-check
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import {
  anchorKey, checkPresent, colorRoles, compSource, contrastTable, cssPx, judgeTells, ledgerFields, loadTokens, maskNamesFor, maskText, mergeFindings,
  nearDuplicates, pickStyles, readBrief, readNotes, readPast, recordPast, roleOf, similarPrompt, templateComp, writeCanvas,
} from '../../board.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { FIXTURES, GENERIC, runCli, tempDir, writePng } from './helpers.mjs';

/** @type {string[]} */
const cleanup = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const A = path.join(FIXTURES, 'state', 'directions', 'A');
const C = path.join(FIXTURES, 'bad', 'C');

/**
 * A state folder whose directions have the files directions.present looks for, with PNGs of the given sizes.
 * @param {string[]} ids
 * @param {{desktop?: [number, number], mobile?: [number, number]}} [sizes]
 * @returns {string}
 */
function presentState(ids, sizes = {}) {
  const state = tempDir('fe-board-present-');
  cleanup.push(state);
  const anchors = { A: 'customer-a', B: 'utilitarian', C: 'domain' };
  for (const id of ids) {
    const dir = path.join(state, 'directions', id);
    cpSync(path.join(A, 'tokens.json'), path.join(dir, 'tokens.json'));
    writeFileSync(path.join(dir, 'notes.md'), `# Direction ${id}: Name ${id}\n\n- Anchor: ${Reflect.get(anchors, id)}\n\n- Why this direction fits the brief: reason ${id}.\n- What it costs: cost ${id}.\n`);
    writePng(path.join(dir, 'hero-desktop.png'), ...(sizes.desktop ?? [1440, 900]));
    writePng(path.join(dir, 'hero-mobile.png'), ...(sizes.mobile ?? [780, 1688]));
  }
  return state;
}

describe('tokens', () => {
  test('roleOf reads the role from the name first, then the usage', () => {
    /** @param {string} name @param {string} [usage] */
    const role = (name, usage = '') => roleOf({ name, value: { light: '#000000' }, usage });
    assert.equal(role('ground'), 'ground');
    assert.equal(role('bg'), 'ground');
    assert.equal(role('surface'), 'surface');
    assert.equal(role('text'), 'text');
    assert.equal(role('ink'), 'text');
    assert.equal(role('text-muted'), 'muted');
    assert.equal(role('ink-muted'), 'muted');
    assert.equal(role('muted', 'chips and wells'), 'surface', 'shadcn muted is a ground');
    assert.equal(role('muted-foreground'), 'muted');
    assert.equal(role('on-accent'), 'on-accent');
    assert.equal(role('primary-foreground'), 'on-accent');
    assert.equal(role('accent'), 'accent');
    assert.equal(role('rule'), 'border');
    assert.equal(role('border-input'), 'border');
    assert.equal(role('status-live'), 'status');
    assert.equal(role('text-inverse'), 'inverse');
    assert.equal(role('paper-2', 'page background'), 'ground');
    assert.equal(role('x1', 'whatever'), 'other');
  });

  test('the contrast table passes a sound plan and fails low-contrast muted text and accent', () => {
    const a = contrastTable(loadTokens(path.join(A, 'tokens.json')));
    assert.ok(a.length >= 10);
    assert.deepEqual(a.filter((p) => p.blocking && !p.ok), []);
    const rule = a.find((p) => p.fg === 'rule');
    assert.ok(rule && !rule.blocking, 'a decorative rule is reported, not blocking');
    assert.ok(a.some((p) => p.kind === 'text on the accent' && p.fg === 'on-accent' && p.ok));
    const c = contrastTable(loadTokens(path.join(C, 'tokens.json')));
    const failing = c.filter((p) => p.blocking && !p.ok).map((p) => `${p.fg}/${p.bg}`);
    assert.deepEqual(failing.sort(), ['accent/ground', 'accent/surface', 'text-muted/ground', 'text-muted/surface']);
  });

  test('a plan without an on-accent token is checked against its best text or ground token', () => {
    const tokens = loadTokens(path.join(A, 'tokens.json'));
    tokens.colors = tokens.colors.filter((t) => t.name !== 'on-accent');
    const pair = contrastTable(tokens).find((p) => p.kind.startsWith('text on the accent (no on-accent'));
    assert.ok(pair && pair.ok && pair.fg === 'ground');
  });

  test('cssPx compares lengths in px, clamp() by its largest term', () => {
    assert.equal(cssPx('48px'), 48);
    assert.equal(cssPx('1.5rem'), 24);
    assert.equal(cssPx('clamp(2rem, 4vw, 3.5rem)'), 56);
    assert.equal(cssPx('min(10px, 2rem)'), 10);
    assert.ok(Number.isNaN(cssPx('auto')));
  });

  test('pickStyles takes the largest display style, the body, a lead and the smallest style', () => {
    const s = pickStyles(loadTokens(path.join(A, 'tokens.json')));
    assert.deepEqual([s.display?.name, s.body?.name, s.lead?.name, s.small?.name], ['display-xl', 'body-m', 'body-lead', 'body-s']);
  });

  test('colorRoles groups a plan by role', () => {
    const roles = colorRoles(loadTokens(path.join(A, 'tokens.json')));
    assert.deepEqual(roles.get('status')?.map((t) => t.name), ['status-testnet', 'status-simulated']);
  });
});

describe('notes, brief and masking', () => {
  test('readNotes finds the name, anchor, rationale, trade-off, signature, layout and the similar-prompt rows', () => {
    const n = readNotes(path.join(A, 'notes.md'));
    assert.ok(n);
    assert.equal(n.name, 'Settlement statement');
    assert.equal(n.anchor, 'customer-a (the conventions of the first customer in the pattern ledger)');
    assert.match(n.rationale, /^treasury teams already read statements/);
    assert.match(n.tradeOff, /^a statement looks quiet/);
    assert.match(n.signature, /promised date/);
    assert.match(n.layout, /^Two columns/);
    assert.deepEqual(n.similarRows[0], ['accent', '#0b5fa5', '#6d28d9', 'no', 'none needed']);
    assert.deepEqual(n.placeholders, []);
    assert.deepEqual(readNotes(path.join(C, 'notes.md'))?.placeholders, ['reference', 'trade_off']);
    assert.equal(readNotes(path.join(C, 'missing.md')), null);
  });

  test('anchorKey reduces an anchor to the source it names', () => {
    assert.equal(anchorKey('customer-a (the conventions of the first customer in the pattern ledger)'), 'customer-a');
    assert.equal(anchorKey('Customer-A'), 'customer-a');
    assert.equal(anchorKey('domain: settlement statements'), 'domain');
    assert.equal(anchorKey('A custody bank\'s order ticket'), 'a custody bank s order ticket');
  });

  test('the template anchor sentence is cut from the anchor', () => {
    const dir = tempDir('fe-board-notes-');
    cleanup.push(dir);
    writeFileSync(path.join(dir, 'notes.md'), '# Direction B: X\n\n- Anchor: domain (one of: a first customer\'s conventions, a second unrelated customer\'s, the protocol\'s own\n  domain, a utilitarian register).\n');
    assert.equal(readNotes(path.join(dir, 'notes.md'))?.anchor, 'domain');
  });

  test('maskNamesFor masks customers and sponsors, with the allowlist names of profile sponsors, longest first', () => {
    const brief = readBrief(path.join(FIXTURES, 'state'));
    const names = maskNamesFor(brief, defaultProfile({ references: [{ customer: 'Acmebank', url: 'https://example.invalid', source: 's', owner_confirmed: true }] }));
    const byName = Object.fromEntries(names.map((n) => [n.name.toLowerCase(), n.label]));
    assert.equal(byName['northwind treasury'], '[Customer]');
    assert.equal(byName.acmebank, '[Customer]');
    assert.equal(byName.cardano, '[Sponsor]');
    assert.equal(byName['cardano foundation'], '[Sponsor]', 'the allowlist adds the sponsor\'s other names');
    for (let i = 1; i < names.length; i += 1) assert.ok(names[i - 1].name.length >= names[i].name.length);
    assert.equal(maskText('Northwind Treasury runs on Cardano; Cardanos stay.', names), '[Customer] runs on [Sponsor]; Cardanos stay.');
  });
});

describe('similar-prompt test and past directions', () => {
  test('identical colours and families block; a row that keeps them with a reason does not', () => {
    const c = loadTokens(path.join(C, 'tokens.json'));
    const generic = loadTokens(path.join(GENERIC, 'tokens.json'));
    const sp = similarPrompt(c, generic, readNotes(path.join(C, 'notes.md')), null);
    assert.equal(sp.identical.length, 4);
    assert.ok(sp.identical.some((i) => /colour accent #6d28d9/.test(i)));
    assert.ok(sp.identical.some((i) => /font display generic sans/.test(i)));
    assert.equal(sp.closest[0].distance, 0);
    const dir = tempDir('fe-board-keep-');
    cleanup.push(dir);
    writeFileSync(path.join(dir, 'notes.md'), '# Direction C: X\n\n## Similar-prompt test\n\n| token | this direction | generic plan | identical | change made |\n|---|---|---|---|---|\n| accent | #6d28d9 | #6d28d9 | yes | keep: the sponsor brand sets this purple |\n| font display | Generic Sans | Generic Sans | yes | keep |\n');
    const kept = similarPrompt(c, generic, readNotes(path.join(dir, 'notes.md')), null);
    assert.equal(kept.kept.length, 1, 'a keep row needs a reason');
    assert.match(kept.kept[0], /colour accent #6d28d9 .* kept: keep: the sponsor brand sets this purple/);
    assert.equal(kept.identical.length, 3);
    const a = loadTokens(path.join(A, 'tokens.json'));
    assert.deepEqual(similarPrompt(a, generic, null, null).identical, []);
  });

  test('a direction repeating a past one on most fields is a near-duplicate; two fields are not; its own record is skipped', () => {
    const past = readPast(path.join(FIXTURES, 'past-directions.json'));
    const c = loadTokens(path.join(C, 'tokens.json'));
    const dupes = nearDuplicates(ledgerFields(c, readNotes(path.join(C, 'notes.md'))), c.sha256, past);
    assert.deepEqual(dupes.map((d) => [d.entry.project, d.matched]), [['Old Hack', ['ground', 'accent', 'display', 'body', 'signature']]]);
    const a = loadTokens(path.join(A, 'tokens.json'));
    assert.deepEqual(nearDuplicates(ledgerFields(a, readNotes(path.join(A, 'notes.md'))), a.sha256, past), [], 'ground and accent alone do not make a repeat');
    assert.deepEqual(nearDuplicates(ledgerFields(c, null), c.sha256, [{ ...past[0], tokens_sha256: c.sha256 }]), []);
    assert.deepEqual(readPast(path.join(FIXTURES, 'missing.json')), []);
  });

  test('recordPast appends every direction once, with the H1 pick', () => {
    const state = presentState(['A', 'B']);
    const ledger = path.join(state, 'past.json');
    assert.throws(() => recordPast({ state, profile: defaultProfile(), root: state, past: ledger }), /no H1 pick/);
    writeFileSync(path.join(state, 'choices.json'), JSON.stringify({ version: 1, H1: { pick: 'B', change: '', answered_at: '2026-10-01T10:00:00Z', by: 'owner', channel: 'terminal', source: 't' } }));
    const first = recordPast({ state, profile: defaultProfile(), root: state, past: ledger, project: 'Queue Clock' });
    assert.equal(first.pick, 'B');
    assert.equal(first.added.length, 1, 'A and B share the fixture tokens, so the second is the same record');
    assert.deepEqual(recordPast({ state, profile: defaultProfile(), root: state, past: ledger }).added, []);
    const entries = readPast(ledger);
    assert.equal(entries[0].project, 'Queue Clock');
    assert.equal(entries[0].ground, '#ffffff');
    assert.equal(entries[0].display, 'fixture grotesk');
  });
});

describe('tells judgement', () => {
  /** @type {import('../../rules/load.mjs').Rule[]} */
  const rules = /** @type {any} */ ([
    { id: 'SL-T01', title: 'one', tier: 'tier1', weight: 2, anchor: false },
    { id: 'SL-T02', title: 'two', tier: 'tier2', weight: 1, anchor: false },
    { id: 'SL-T03', title: 'three', tier: 'candidate', weight: 2, anchor: true },
    { id: 'SL-T04', title: 'four', tier: 'advisory', weight: 1, anchor: false },
  ]);
  /** @param {string} rule @returns {import('../../rules/load.mjs').Finding} */
  const hit = (rule) => ({ rule, layer: 'runtime', route: '/hero.html', viewport: 'desktop', selector: 'h1', value: 'v', detail: 'd' });
  const none = { sponsorHashes: new Set(), sponsors: [], waivers: [], category: [] };

  test('tier 1 and an unwaived tier 2 block; candidates and advisories score, anchors double; errors block', () => {
    const j = judgeTells([hit('SL-T01'), hit('SL-T02'), hit('SL-T03'), hit('SL-T04'), { rule: 'SL-T05', layer: 'runtime', error: 'Error: boom', viewport: 'mobile' }], rules, none, null);
    assert.deepEqual(j.findings.filter((f) => f.blocking).map((f) => f.check).sort(), ['tells.error', 'tells.tier1', 'tells.tier2']);
    assert.equal(j.score, 5);
    assert.equal(j.errors, 1);
    assert.equal(judgeTells([hit('SL-T03')], rules, none, 3).findings.some((f) => f.check === 'tells.score' && f.blocking), true);
  });

  test('a category entry exempts tier 1; a waiver needs a reason and evidence', () => {
    const allow = { ...none, category: [{ rule: 'SL-T01', category: 'defi', reason: 'the category paints gradients', source: 'FD11' }], waivers: [{ rule: 'SL-T02', scope: '', reason: 'sponsor brand', evidence: ['kit.pdf'], approved_by: 'owner', date: null }] };
    const j = judgeTells([hit('SL-T01'), hit('SL-T02')], rules, allow, null);
    assert.deepEqual(j.findings.filter((f) => f.blocking), []);
    const thin = { ...none, waivers: [{ rule: 'SL-T02', scope: '', reason: 'because', evidence: '', approved_by: 'owner', date: null }] };
    assert.equal(judgeTells([hit('SL-T02')], rules, thin, null).findings[0].blocking, true);
  });

  test('mergeFindings keeps one finding per check and detail and joins the viewports', () => {
    const merged = mergeFindings([
      { check: 'a', detail: 'x', blocking: true, viewport: 'desktop' },
      { check: 'a', detail: 'x', blocking: true, viewport: 'mobile' },
      { check: 'a', detail: 'y', blocking: true, viewport: 'mobile' },
    ]);
    assert.deepEqual(merged.map((f) => [f.detail, f.viewport]), [['x', 'desktop, mobile'], ['y', 'mobile']]);
  });
});

describe('directions.present', () => {
  test('passes two complete directions from different anchors, at any device pixel ratio', () => {
    const r = checkPresent(presentState(['A', 'B']), { mode: 'full' });
    assert.equal(r.state, 'ok', r.detail);
    assert.equal(checkPresent(presentState(['A', 'B'], { desktop: [2880, 1800], mobile: [390, 844] }), { mode: 'full' }).state, 'ok');
  });

  test('fails without hero-mobile.png (the FE-03 negative control)', () => {
    const state = presentState(['A', 'B']);
    rmSync(path.join(state, 'directions', 'B', 'hero-mobile.png'));
    const r = checkPresent(state, { mode: 'full' });
    assert.equal(r.state, 'fail');
    assert.match(r.detail, /B: hero-mobile\.png is missing/);
  });

  test('fails on the count for the mode, a wrong comp size, a shared anchor and leftover placeholders', () => {
    assert.match(checkPresent(presentState(['A']), { mode: 'full' }).detail, /1 direction\(s\).*needs 2 to 3/);
    assert.equal(checkPresent(presentState(['A']), { mode: 'small' }).state, 'ok');
    assert.match(checkPresent(presentState(['A', 'B', 'C']), { mode: 'small' }).detail, /needs 1 to 2/);
    assert.match(checkPresent(presentState(['A', 'B'], { desktop: [1280, 800] }), { mode: 'full' }).detail, /hero-desktop\.png is 1280x800, not 1440x900/);
    const state = presentState(['A', 'B']);
    cpSync(path.join(C, 'notes.md'), path.join(state, 'directions', 'B', 'notes.md'));
    const r = checkPresent(state, { mode: 'full' });
    assert.match(r.detail, /B: notes\.md still has template placeholders/);
    assert.match(r.detail, /B: anchored in the same source as A/);
  });

  test('fails with no directions folder at all', () => {
    const state = tempDir('fe-board-empty-');
    cleanup.push(state);
    assert.equal(checkPresent(state, { mode: 'full' }).state, 'fail');
  });
});

describe('template comp and canvas', () => {
  test('the template uses only the plan\'s colours and the brief\'s words, marks the hero and the product, requests nothing', () => {
    const tokens = loadTokens(path.join(A, 'tokens.json'));
    const brief = /** @type {NonNullable<ReturnType<typeof readBrief>>} */ (readBrief(path.join(FIXTURES, 'state')));
    const { html, missing } = templateComp({ id: 'A', tokens, brief, fonts: [{ family: 'Fixture Grotesk', weight: '400', style: 'normal' }] });
    assert.deepEqual(missing, []);
    assert.match(html, /<h1 data-hero="h1">Settle withdrawals on time<\/h1>/);
    assert.match(html, /data-hero="sentence">Treasury teams see when each Cardano withdrawal will settle/);
    assert.match(html, /data-surface="product"/);
    assert.match(html, /data-status="testnet"/);
    assert.match(html, /content="frontend board\.mjs template v1"/);
    assert.match(html, /not yet verified/);
    assert.doesNotMatch(html, /https?:\/\//);
    const tokenHexes = new Set(tokens.colors.flatMap((t) => Object.values(t.value)).map((v) => v.toLowerCase()));
    const used = [...html.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase());
    assert.ok(used.length > 5);
    for (const hex of used) assert.ok(tokenHexes.has(hex), `${hex} is a token value`);
    const bare = { ...tokens, styles: [], spacing: [] };
    assert.deepEqual(templateComp({ id: 'A', tokens: bare, brief, fonts: [] }).missing, ['type styles (type.groups)', 'spacing tokens']);
  });

  test('compSource renders a designer\'s hero.html, else the template, which needs the brief\'s hero copy', () => {
    const state = presentState(['A']);
    const dir = path.join(state, 'directions', 'A');
    const tokens = loadTokens(path.join(dir, 'tokens.json'));
    assert.throws(() => compSource({ dir, id: 'A', tokens, brief: null, root: state, mode: 'auto' }), (err) => err instanceof Error && /needs brief\.json with hero\.h1/.test(err.message) && Reflect.get(err, 'exitCode') === 2);
    assert.throws(() => compSource({ dir, id: 'A', tokens, brief: null, root: state, mode: 'hero' }), /hero\.html is missing/);
    const brief = readBrief(path.join(FIXTURES, 'state'));
    const template = compSource({ dir, id: 'A', tokens, brief, root: state, mode: 'auto' });
    assert.equal(template.kind, 'template');
    assert.match(template.file, /\/hero\.html$/);
    writeFileSync(path.join(dir, 'hero.html'), '<!doctype html><title>designer</title>');
    assert.equal(compSource({ dir, id: 'A', tokens, brief, root: state, mode: 'auto' }).kind, 'hero');
    const forced = compSource({ dir, id: 'A', tokens, brief, root: state, mode: 'template' });
    assert.match(forced.file, /\/hero\.template\.html$/, 'a forced template never overwrites the designer\'s comp');
  });

  test('writeCanvas writes the index and image-only artboards with asset placeholders, Main first, rows 120 px apart', () => {
    const root = tempDir('fe-board-canvas-');
    cleanup.push(root);
    const cell = (/** @type {string} */ key, /** @type {number} */ w, /** @type {number} */ h) => ({ key, title: `${key} title`, alt: `${key} alt`, asset: `directions/${key}.png`, width: w, height: h });
    const out = writeCanvas(root, 'Project directions H1', [[cell('A-desktop', 1440, 900), cell('A-mobile', 390, 844)], [cell('B-desktop', 1440, 900), cell('B-mobile', 390, 844)]]);
    const canvas = JSON.parse(readFileSync(path.join(root, 'project', 'canvas.json'), 'utf8'));
    assert.deepEqual(canvas.order, ['Main.dc.html', 'A-mobile.dc.html', 'B-desktop.dc.html', 'B-mobile.dc.html']);
    assert.deepEqual(canvas.boards['A-mobile.dc.html'], { x: 1520, y: 0, w: 390, h: 844, title: 'A-mobile title' });
    assert.deepEqual(canvas.boards['B-desktop.dc.html'], { x: 0, y: 1020, w: 1440, h: 900, title: 'B-desktop title' });
    assert.equal(canvas.v, 3);
    assert.deepEqual([canvas.launch, canvas.pages, canvas.notes, canvas.designSystems], [{ view: 'canvas' }, [], {}, []]);
    const main = readFileSync(path.join(root, 'project', 'Main.dc.html'), 'utf8');
    assert.match(main, /<img src="\{\{ASSET:directions\/A-desktop\.png\}\}" alt="A-desktop alt" style="display: block; width: 1440px; height: 900px">/);
    assert.match(main, /data-props='\{"\$preview":\{"width":1440,"height":900\}\}'/);
    assert.match(main, /<script src="\.\/support\.js"><\/script>/);
    assert.doesNotMatch(main, /\r/);
    assert.equal(Object.keys(out.files).length, 5);
    assert.ok(existsSync(out.index));
  });
});

describe('CLI usage', () => {
  test('bad flags and unknown commands exit 2; --help exits 0', () => {
    const state = presentState(['A', 'B']);
    const empty = tempDir('fe-board-nodir-');
    cleanup.push(empty);
    assert.equal(runCli(['render', '--direction', 'D', '--state', state, '--root', state]).status, 2);
    const none = runCli(['render', '--state', empty, '--root', empty]);
    assert.equal(none.status, 2);
    assert.match(none.stderr, /no direction with tokens\.json/);
    assert.equal(runCli(['nonsense', '--state', state, '--root', state]).status, 2);
    assert.equal(runCli(['render', '--direction', 'A', '--comp', 'mine', '--state', state, '--root', state]).status, 2);
    assert.equal(runCli(['--gates', 'directions.bogus', '--state', state, '--root', state]).status, 2);
    assert.equal(runCli(['record', '--state', state, '--root', state, '--past', path.join(state, 'p.json')]).status, 2);
    const help = runCli(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /directions\.present and directions\.screened/);
  });
});
