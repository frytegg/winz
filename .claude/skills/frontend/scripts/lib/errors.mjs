// @ts-check
import { writeSync } from 'node:fs';

/**
 * Base class of every error a /frontend script reports to its user. The exit code travels with the error, so the
 * CLI boundary (`exitWith`) never has to guess it.
 */
export class FrontendError extends Error {
  /**
   * @param {string} message what went wrong and what to do about it
   * @param {{exitCode?: number, cause?: unknown}} [options]
   */
  constructor(message, { exitCode = 3, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    /** @type {number} */
    this.exitCode = exitCode;
  }
}

/** Bad flags, a missing or malformed input file. Exit code 2. */
export class UsageError extends FrontendError {
  /** @param {string} message @param {{cause?: unknown}} [options] */
  constructor(message, { cause } = {}) {
    super(message, { exitCode: 2, cause });
  }
}

/** No browser, no Node module, port in use, unreachable target. Exit code 3. */
export class EnvError extends FrontendError {
  /** @param {string} message @param {{cause?: unknown}} [options] */
  constructor(message, { cause } = {}) {
    super(message, { exitCode: 3, cause });
  }
}

/** A gate failed or findings exceed the gate's threshold. Exit code 1. */
export class CheckError extends FrontendError {
  /** @param {string} message @param {{cause?: unknown}} [options] */
  constructor(message, { cause } = {}) {
    super(message, { exitCode: 1, cause });
  }
}

/**
 * The exit code an error maps to: its own for a FrontendError, 3 for anything else (an unexpected failure is never
 * reported as success or as a failed gate).
 * @param {unknown} err
 * @returns {number}
 */
export function exitCodeOf(err) {
  if (err instanceof FrontendError && Number.isInteger(err.exitCode) && err.exitCode > 0) return err.exitCode;
  return 3;
}

/**
 * The text `exitWith` prints: the message, the chain of causes, and the stack for errors that are not ours (those
 * are bugs, and the stack is the only lead).
 * @param {unknown} err
 * @returns {string}
 */
export function formatError(err) {
  const lines = [];
  if (err instanceof FrontendError) {
    lines.push(`error: ${err.message}`);
  } else if (err instanceof Error) {
    lines.push(`error: unexpected ${err.name}: ${err.message}`);
    if (err.stack) lines.push(err.stack.split('\n').slice(1).join('\n'));
  } else {
    lines.push(`error: unexpected non-error value thrown: ${String(err)}`);
  }
  let cause = err instanceof Error ? err.cause : undefined;
  for (let depth = 0; cause !== undefined && depth < 5; depth += 1) {
    lines.push(`  cause: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`);
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Prints the error to stderr and exits with its code (3 for errors that are not FrontendErrors). The write is
 * synchronous so the message survives `process.exit` on a piped stderr.
 * @param {unknown} err
 * @returns {never}
 */
export function exitWith(err) {
  const text = formatError(err);
  try {
    writeSync(2, text);
  } catch {
    process.stderr.write(text);
  }
  process.exit(exitCodeOf(err));
}
