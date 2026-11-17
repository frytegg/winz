// The frontend-check CLI with the stub modules of this folder: node run-with-stubs.mjs <frontend-check flags>.
// Same exit handling as the real CLI, so the tests can spawn it and read exit codes and process cleanup.
import { fileURLToPath } from 'node:url';
import { main } from '../../../frontend-check.mjs';
import { exitWith } from '../../../lib/errors.mjs';

const stubs = fileURLToPath(new URL('./stubs/', import.meta.url));
main(process.argv.slice(2), { modulesDir: stubs }).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => exitWith(err),
);
