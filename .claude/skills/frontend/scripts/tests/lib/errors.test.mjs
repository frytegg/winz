// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { CheckError, EnvError, FrontendError, UsageError, exitCodeOf, formatError } from '../../lib/errors.mjs';

const ERRORS_URL = new URL('../../lib/errors.mjs', import.meta.url).href;

/**
 * Runs `exitWith(<expression>)` in a child Node process.
 * @param {string} expression
 */
function runExitWith(expression) {
  const code = `import * as m from ${JSON.stringify(ERRORS_URL)}; m.exitWith(${expression});`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
}

test('each error class carries its exit code and name', () => {
  assert.equal(new UsageError('u').exitCode, 2);
  assert.equal(new EnvError('e').exitCode, 3);
  assert.equal(new CheckError('c').exitCode, 1);
  assert.equal(new FrontendError('f', { exitCode: 7 }).exitCode, 7);
  assert.equal(new FrontendError('f').exitCode, 3);
  const err = new UsageError('bad flag');
  assert.ok(err instanceof FrontendError);
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'UsageError');
  assert.equal(err.message, 'bad flag');
});

test('the cause is preserved', () => {
  const root = new Error('root cause');
  const err = new EnvError('wrapped', { cause: root });
  assert.equal(err.cause, root);
  assert.equal(new CheckError('no cause').cause, undefined);
});

test('exitCodeOf maps foreign errors and odd values to 3', () => {
  assert.equal(exitCodeOf(new CheckError('x')), 1);
  assert.equal(exitCodeOf(new UsageError('x')), 2);
  assert.equal(exitCodeOf(new TypeError('x')), 3);
  assert.equal(exitCodeOf('a string'), 3);
  assert.equal(exitCodeOf(new FrontendError('zero', { exitCode: 0 })), 3, 'an error never exits 0');
});

test('formatError prints the message and causes, and the stack only for foreign errors', () => {
  const ours = formatError(new UsageError('pass --root', { cause: new Error('ENOENT') }));
  assert.match(ours, /^error: pass --root\n {2}cause: Error: ENOENT\n$/);
  assert.doesNotMatch(ours, /at /);
  const foreign = formatError(new TypeError('oops'));
  assert.match(foreign, /^error: unexpected TypeError: oops\n/);
  assert.match(foreign, /\n\s+at /, 'the stack of an unexpected error is printed');
  assert.match(formatError(42), /non-error value thrown: 42/);
});

test('exitWith writes to stderr only and exits with the error code', () => {
  for (const [cls, code] of /** @type {const} */ ([['UsageError', 2], ['EnvError', 3], ['CheckError', 1]])) {
    const r = runExitWith(`new m.${cls}('boom: do this')`);
    assert.equal(r.status, code, `${cls} exit code`);
    assert.match(r.stderr, /error: boom: do this/);
    assert.equal(r.stdout, '');
  }
  const foreign = runExitWith(`new TypeError('oops')`);
  assert.equal(foreign.status, 3);
  assert.match(foreign.stderr, /unexpected TypeError: oops/);
});
