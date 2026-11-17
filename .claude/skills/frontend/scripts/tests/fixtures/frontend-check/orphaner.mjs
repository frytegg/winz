// Fixture for the kill-tree tests: node orphaner.mjs <pid file>. Starts a grandchild that never exits, writes both
// pids, then exits itself, the way a shell that ran a server can exit before the server does. The grandchild is
// detached so that Node's own Windows job object (kill on close) does not take it down with this process.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true, windowsHide: true });
writeFileSync(process.argv[2], JSON.stringify({ parent: process.pid, grandchild: child.pid }));
child.unref();
process.exit(0);
