// @ts-check
import assert from 'node:assert/strict';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadProfile } from '../../lib/profile.mjs';
import { aggregate } from '../../lib/report.mjs';
import { GATES, run } from '../../tokens.mjs';
import { FIXTURES, builtGood, cli, copyFixture, tempDir } from './helpers.mjs';

test('GATES declares the three tokens gates with titles and if-dropped reasons', () => {
  assert.deepEqual(GATES.map((g) => g.id), ['tokens.valid', 'tokens.contrast', 'tokens.leak']);
  for (const g of GATES) assert.ok(g.title.length > 10 && g.ifDropped.length > 10, g.id);
});

test('run() returns the selected gates only, in the order asked', async () => {
  const repo = await builtGood();
  try {
    const results = await run({ root: repo.dir }, ['tokens.contrast', 'tokens.valid']);
    assert.deepEqual(results.map((r) => [r.id, r.state]), [['tokens.contrast', 'ok'], ['tokens.valid', 'ok']]);
    assert.deepEqual(await run({ root: repo.dir }, []), []);
  } finally {
    repo.cleanup();
  }
});

test('run() reads the design folder from the profile, and the build folder from args.serve', async () => {
  const copy = copyFixture('good');
  const elsewhere = tempDir('profile');
  try {
    const profileFile = path.join(elsewhere.dir, 'profile.json');
    renameSync(path.join(copy.dir, 'design'), path.join(copy.dir, 'ui-design'));
    writeFileSync(profileFile, JSON.stringify({ judged_surface: 'site', stack: 'vite-react', hosting: 'local', paths: { design: 'ui-design' } }));
    const profile = loadProfile(profileFile);
    const [contrast] = await run({ root: copy.dir, profile }, ['tokens.contrast']);
    assert.equal(contrast.state, 'ok', contrast.detail);
    const [leak] = await run({ root: copy.dir, profile, args: { serve: path.join(copy.dir, 'dist') } }, ['tokens.leak']);
    assert.match(leak.detail, /and 3 built files/);
  } finally {
    copy.cleanup();
    elsewhere.cleanup();
  }
});

test('a requested gate that did not run is skipped, and a skipped gate makes the report not ok', () => {
  const report = aggregate([], { requested: GATES, tool: 'tokens' });
  assert.equal(report.ok, false);
  assert.deepEqual(report.gates.map((g) => g.state), ['skipped', 'skipped', 'skipped']);
});

test('CLI: --help exits 0; no command, an unknown command or a bad flag exits 2', () => {
  const help = cli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage: node tokens\.mjs <command>/);
  assert.match(cli(['build', '--help']).stdout, /--tailwind <mode>/);
  assert.match(cli(['leak', '--help']).stdout, /--serve <dir>/);
  assert.equal(cli([]).code, 2);
  assert.equal(cli(['paint']).code, 2);
  assert.equal(cli(['validate', '--frobnicate']).code, 2);
  assert.equal(cli(['validate', '--gates', 'tokens.valid']).code, 2, '--gates belongs to check');
  assert.equal(cli(['check', '--gates', 'tokens.colour']).code, 2);
  assert.equal(cli(['validate', '--root', path.join(FIXTURES, 'does-not-exist')]).code, 2);
});

test('CLI: validate exits 0 on a built fixture and 1 on an invalid one, with the section 4 report on stdout', async () => {
  const repo = await builtGood();
  try {
    const ok = cli(['validate', '--root', repo.dir, '--json']);
    assert.equal(ok.code, 0, ok.stderr);
    const report = JSON.parse(ok.stdout);
    assert.deepEqual(Object.keys(report), ['ok', 'tool', 'version', 'at', 'target', 'counts', 'gates']);
    assert.equal(report.ok, true);
    assert.equal(report.tool, 'tokens');
    assert.match(report.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.deepEqual(report.counts, { ok: 1, fail: 0, skipped: 0 });
    assert.deepEqual(Object.keys(report.gates[0]), ['id', 'title', 'ifDropped', 'state', 'detail', 'evidence']);
  } finally {
    repo.cleanup();
  }
  const bad = cli(['validate', '--root', path.join(FIXTURES, 'invalid'), '--json']);
  assert.equal(bad.code, 1);
  assert.equal(JSON.parse(bad.stdout).ok, false);
  assert.match(bad.stderr, /FAIL tokens\.valid/);
});

test('CLI: check runs the gates named by --gates and writes the report with --out', async () => {
  const repo = await builtGood();
  const out = tempDir('out');
  try {
    const r = cli(['check', '--root', repo.dir, '--gates', 'tokens.valid,tokens.contrast', '--out', out.dir]);
    assert.equal(r.code, 0, r.stderr);
    const report = JSON.parse(readFileSync(path.join(out.dir, 'tokens-gates.json'), 'utf8'));
    assert.deepEqual(report.gates.map((/** @type {any} */ g) => g.id), ['tokens.valid', 'tokens.contrast']);
    const all = cli(['check', '--root', repo.dir, '--serve', path.join(repo.dir, 'dist')]);
    assert.equal(all.code, 0, all.stderr);
    assert.match(all.stderr, /ok {3}tokens\.leak/);
    const flagsOnly = cli(['--gates', 'tokens', '--root', repo.dir, '--json']);
    assert.equal(flagsOnly.code, 0, flagsOnly.stderr);
    assert.deepEqual(JSON.parse(flagsOnly.stdout).gates.map((/** @type {any} */ g) => g.id), ['tokens.valid', 'tokens.contrast', 'tokens.leak']);
  } finally {
    repo.cleanup();
    out.cleanup();
  }
});

test('CLI: contrast exits 1 on the failing fixture and leak exits 1 on the leaky tree', () => {
  const contrast = cli(['contrast', '--root', path.join(FIXTURES, 'contrast-fail')]);
  assert.equal(contrast.code, 1);
  assert.match(contrast.stderr, /muted-foreground on muted \(light\)/);
  const leak = cli(['leak', '--root', path.join(FIXTURES, 'leak-dirty')]);
  assert.equal(leak.code, 1);
  assert.match(leak.stderr, /FAIL tokens\.leak: 21 leaks/);
});

test('CLI: build writes the views, refuses an invalid file with exit 2, and reports with --json', () => {
  const copy = copyFixture('good');
  try {
    const r = cli(['build', '--root', copy.dir, '--json', '--tailwind', 'yes']);
    assert.equal(r.code, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.tailwind, true);
    assert.equal(report.written.length, 2);
    assert.equal(cli(['build', '--root', copy.dir, '--tailwind', 'maybe']).code, 2);
    assert.equal(cli(['validate', '--root', copy.dir]).code, 0);
  } finally {
    copy.cleanup();
  }
  const invalid = copyFixture('invalid');
  try {
    const r = cli(['build', '--root', invalid.dir]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /cannot be built from/);
  } finally {
    invalid.cleanup();
  }
});
