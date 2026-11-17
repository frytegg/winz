// Fixture CLI for tests/lib/args.test.mjs: prints the parsed flags as JSON, or fails like a real CLI.
import { parseCli } from '../../../lib/args.mjs';
import { exitWith } from '../../../lib/errors.mjs';

const HELP = `usage: args-cli [--root <dir>] [--json] [--gates <list>]...

exit codes: 0 ok, 2 usage error`;

try {
  const { values, positionals } = parseCli(process.argv.slice(2), {
    options: { root: { type: 'string' }, json: { type: 'boolean' }, gates: { type: 'string', multiple: true } },
    help: HELP,
  });
  process.stdout.write(`${JSON.stringify({ values, positionals })}\n`);
} catch (err) {
  exitWith(err);
}
