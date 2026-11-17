// @ts-check
import { realpathSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { UsageError } from './errors.mjs';

/**
 * True when the module at `moduleUrl` (pass `import.meta.url`) is the script node was started with. Both sides are
 * compared as real paths, case-insensitively on Windows: Node gives `import.meta.url` as the real path but leaves
 * `process.argv[1]` as typed, so a CLI started through a symlink, a junction or a subst drive would otherwise not
 * run at all and exit 0 having checked nothing.
 * @param {string} moduleUrl
 * @param {string | undefined} [entry] the started script (default `process.argv[1]`)
 * @returns {boolean}
 */
export function isMainModule(moduleUrl, entry = process.argv[1]) {
  if (!entry) return false;
  const self = realPath(fileURLToPath(moduleUrl));
  const started = realPath(path.resolve(entry));
  return process.platform === 'win32' ? self.toLowerCase() === started.toLowerCase() : self === started;
}

/**
 * @param {string} p
 * @returns {string}
 */
function realPath(p) {
  try {
    return realpathSync.native(p);
  } catch {
    try {
      return realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  }
}

/**
 * One option, as `node:util` parseArgs takes it. The literal members keep 'string' and 'boolean' literal when the
 * options are written inline in the call (precise value types); `string & {}` still accepts a table declared apart
 * from the call, whose `type` has widened to string (its values are then typed `string | boolean`).
 * @typedef {{type: 'string' | 'boolean' | (string & {}), multiple?: boolean, short?: string,
 *   default?: string | boolean | string[] | boolean[]}} OptionSpec
 */

/**
 * @template {OptionSpec} S
 * @typedef {S['type'] extends 'string' ? string : S['type'] extends 'boolean' ? boolean : string | boolean} ScalarOf
 */

/**
 * @template {OptionSpec} S
 * @typedef {S['multiple'] extends true ? Array<ScalarOf<S>> : ScalarOf<S>} ValueOf
 */

/**
 * Parsed values: every option may be absent unless it has a default.
 * @template {Record<string, OptionSpec>} O
 * @typedef {{-readonly [K in keyof O]?: ValueOf<O[K]>}} CliValues
 */

/**
 * @template {Record<string, OptionSpec>} O
 * @typedef {{options: O, help: string, allowPositionals?: boolean}} CliSpec
 */

/**
 * Parses command-line flags with `node:util` parseArgs (strict). `--help` (and `-h` unless the CLI uses that short
 * flag itself) prints `spec.help` to stdout and exits 0, even when other flags are wrong. Any parse problem throws a
 * UsageError (exit 2) that says how to get the usage text.
 *
 * `argv` is the argument list without the node executable and the script path (`process.argv.slice(2)`); passing
 * `process.argv` itself is detected and handled too.
 * @template {Record<string, OptionSpec>} O
 * @param {readonly string[] | undefined} argv
 * @param {CliSpec<O>} spec
 * @returns {{values: CliValues<O>, positionals: string[]}}
 */
export function parseCli(argv, spec) {
  if (!spec || typeof spec.help !== 'string' || typeof spec.options !== 'object' || spec.options === null) {
    throw new TypeError('parseCli(argv, spec): spec must be {options, help}');
  }
  const args = stripNodeAndScript(argv ?? process.argv.slice(2));
  const options = withHelpOption(spec.options);
  if (wantsHelp(args, options)) printHelpAndExit(spec.help);
  try {
    const parsed = parseArgs({
      args: [...args],
      options: /** @type {import('node:util').ParseArgsOptionsConfig} */ (options),
      allowPositionals: spec.allowPositionals ?? true,
      strict: true,
    });
    const values = /** @type {Record<string, unknown>} */ ({ ...parsed.values });
    delete values.help;
    return { values: /** @type {CliValues<O>} */ (values), positionals: [...parsed.positionals] };
  } catch (err) {
    throw new UsageError(`${describeParseError(err)}; run with --help for usage`, { cause: err });
  }
}

/**
 * @param {readonly string[]} argv
 * @returns {readonly string[]}
 */
function stripNodeAndScript(argv) {
  if (argv.length >= 2 && argv[0] === process.argv[0] && argv[1] === process.argv[1]) return argv.slice(2);
  return argv;
}

/**
 * @param {Record<string, OptionSpec>} options
 * @returns {Record<string, OptionSpec>}
 */
function withHelpOption(options) {
  if (Object.hasOwn(options, 'help')) return options;
  const shortTaken = Object.values(options).some((o) => o.short === 'h');
  return { ...options, help: shortTaken ? { type: 'boolean' } : { type: 'boolean', short: 'h' } };
}

/**
 * @param {readonly string[]} args
 * @param {Record<string, OptionSpec>} options
 * @returns {boolean}
 */
function wantsHelp(args, options) {
  const helpShort = options.help?.short;
  for (const arg of args) {
    if (arg === '--') return false;
    if (arg === '--help' || (helpShort && arg === `-${helpShort}`)) return true;
  }
  return false;
}

/**
 * @param {string} help
 * @returns {never}
 */
function printHelpAndExit(help) {
  const text = help.endsWith('\n') ? help : `${help}\n`;
  try {
    writeSync(1, text);
  } catch {
    process.stdout.write(text);
  }
  process.exit(0);
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function describeParseError(err) {
  const message = err instanceof Error ? err.message : String(err);
  return message.split(/\.\s|\n/)[0].trim();
}
