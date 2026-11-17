// Fixture for the --start timeout test: node sleeper.mjs <pid file>. Writes its pid, never listens, never exits.
import { writeFileSync } from 'node:fs';

writeFileSync(process.argv[2], String(process.pid));
setInterval(() => {}, 1000);
