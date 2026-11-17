// Fixture server for the --start tests: node server.mjs <port> <pid file>. Serves one page on 127.0.0.1:<port>,
// starts a grandchild process (so killing the whole tree is observable), then writes both pids to <pid file>.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import http from 'node:http';

const [port, pidFile] = process.argv.slice(2);
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html lang="en"><head><title>Started fixture</title></head><body><h1>Started</h1></body></html>');
});
server.listen(Number(port), '127.0.0.1', () => {
  writeFileSync(pidFile, JSON.stringify({ server: process.pid, grandchild: child.pid }));
  process.stdout.write(`listening on ${port}\n`);
});
