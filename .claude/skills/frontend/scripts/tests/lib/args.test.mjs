// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isMainModule, parseCli } from '../../lib/args.mjs';
import { UsageError } from '../../lib/errors.mjs';

const CLI = fileURLToPath(new URL('../fixtures/lib/args-cli.mjs', import.meta.url));
const SCRIPTS = fileURLToPath(new URL('../../', import.meta.url));

const SPEC = {
  options: {
    root: { type: 'string' },
    json: { type: 'boolean' },
    out: { type: 'string', default: 'out' },
    gates: { type: 'string', multiple: true },
    height: { type: 'string', short: 'h' },
  },
  help: 'usage: test',
};

/** @param {string[]} args */
function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

test('parses flags, defaults, repeated options and positionals', () => {
  const { values, positionals } = parseCli(['--root', 'C:/repo', '--json', '--gates', 'render', '--gates', 'tells', 'extra'], SPEC);
  assert.equal(values.root, 'C:/repo');
  assert.equal(values.json, true);
  assert.equal(values.out, 'out');
  assert.deepEqual(values.gates, ['render', 'tells']);
  assert.deepEqual(positionals, ['extra']);
  assert.equal('help' in values, false, 'the injected --help flag is not reported');
});

test('inline option tables give precise value types (checked by the typecheck)', () => {
  const { values } = parseCli(['--root', 'r', '--gates', 'a'], {
    options: { root: { type: 'string' }, json: { type: 'boolean' }, gates: { type: 'string', multiple: true } },
    help: 'h',
  });
  /** @type {string | undefined} */
  const root = values.root;
  /** @type {boolean | undefined} */
  const json = values.json;
  /** @type {string[] | undefined} */
  const gates = values.gates;
  assert.deepEqual([root, json, gates], ['r', undefined, ['a']]);
});

test('options declared apart from the call are accepted', () => {
  const options = { root: { type: 'string' } };
  const { values } = parseCli(['--root=x'], { options, help: 'h' });
  assert.equal(values.root, 'x');
});

test('process.argv itself is recognised and its first two entries dropped', () => {
  const argv = [process.argv[0], process.argv[1], '--root', 'r'];
  assert.equal(parseCli(argv, SPEC).values.root, 'r');
});

test('an unknown flag is a UsageError that points at --help', () => {
  assert.throws(() => parseCli(['--bogus'], SPEC), (err) => {
    assert.ok(err instanceof UsageError);
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /Unknown option '--bogus'; run with --help for usage$/);
    return true;
  });
});

test('a string flag without its value is a UsageError', () => {
  assert.throws(() => parseCli(['--root'], SPEC), UsageError);
});

test('positionals can be refused', () => {
  assert.throws(() => parseCli(['stray'], { ...SPEC, allowPositionals: false }), UsageError);
});

test('a malformed spec is a programming error', () => {
  assert.throws(() => parseCli([], /** @type {import('../../lib/args.mjs').CliSpec<{}>} */ (/** @type {unknown} */ ({ options: {} }))), TypeError);
});

test('--help prints the usage to stdout and exits 0, even next to bad flags', () => {
  for (const args of [['--help'], ['-h'], ['--bogus', '--help']]) {
    const r = runCli(args);
    assert.equal(r.status, 0, `exit code for ${args.join(' ')}`);
    assert.match(r.stdout, /^usage: args-cli/);
    assert.equal(r.stderr, '');
  }
});

test('--help after the -- terminator is a positional, not a request for help', () => {
  const r = runCli(['--', '--help']);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout).positionals, ['--help']);
});

test('a CLI exits 2 on a usage error and prints the message to stderr', () => {
  const r = runCli(['--nope']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /error: Unknown option '--nope'; run with --help for usage/);
  assert.equal(r.stdout, '');
});

test('a CLI that uses -h for itself keeps it', () => {
  const { values } = parseCli(['-h', '900'], SPEC);
  assert.equal(values.height, '900');
});

test('isMainModule: the started script, compared as real paths', () => {
  const self = fileURLToPath(import.meta.url);
  assert.equal(isMainModule(import.meta.url, self), true);
  assert.equal(isMainModule(import.meta.url, CLI), false);
  assert.equal(isMainModule(import.meta.url, ''), false);
  if (process.platform === 'win32') assert.equal(isMainModule(import.meta.url, self.toUpperCase()), true);
});

test('a CLI started through a symlink or junction still runs: a bad flag exits 2, never a silent 0', () => {
  const parent = mkdtempSync(path.join(process.env.FRONTEND_TEST_TMP || os.tmpdir(), 'frontend-args-link-'));
  const link = path.join(parent, 'scripts-link');
  symlinkSync(SCRIPTS, link, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const check = spawnSync(process.execPath, [path.join(link, 'frontend-check.mjs'), '--gates', 'nonsense-group'], { encoding: 'utf8', timeout: 60000 });
    assert.equal(check.status, 2, `frontend-check through a link: ${check.stderr}`);
    assert.match(check.stderr, /unknown gate or group/);
    const brief = spawnSync(process.execPath, [path.join(link, 'brief.mjs'), '--nonsense-flag'], { encoding: 'utf8', timeout: 60000 });
    assert.equal(brief.status, 2, `brief through a link: ${brief.stderr}`);
  } finally {
    // rmdir removes the link itself and never the folder it points at.
    if (process.platform === 'win32') rmdirSync(link);
    else unlinkSync(link);
    rmdirSync(parent);
  }
});
