'use strict';
// /harden offline guard (pilot-auto-calibration A01-F57). Preloaded with `node --require <this
// file>` into an end-to-end check that self-setup proposed. It refuses what an offline command
// never needs: network access through net, tls, http, http2, dgram and DNS (Resolver objects
// included); child processes, execve and signals to other processes; workers; native addons;
// the inspector; WASI; reads of secret-named files; dotenv loading; every write through the fs
// module; and the native writers SQLite, heap snapshots, diagnostic reports, trace files and
// the compile cache. A refusal prints one line to stderr that starts with
// "harden-offline-guard: refused " and throws an error whose code is HARDEN_OFFLINE; the
// process then exits with code 97, even when the program caught the error or called
// process.exit(0). Reads and writes to already open descriptors (stdout, stderr) stay allowed.
// Node's own native modules run, and only those listed are refused. This is a seat belt for
// trusted code, not a sandbox: code built to evade it can (Node.js Permissions docs).
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const MARK = 'harden-offline-guard: refused ';
const EXIT_CODE = 97;
const SECRET_FILE = /^(\.env(\..*)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*keystore.*|.*\.secret|secrets?\.(json|ya?ml|toml)|credentials(\.json)?|\.npmrc|\.pypirc|\.netrc|\.envrc|\.dev\.vars|\.git-credentials|.*\.tfvars(\.json)?|.*\.tfstate(\.backup)?|.*\.jks|.*\.gpg|.*\.kdbx|.*service[-_]?account.*\.json)$/i;
const WRITE_FLAG = /[wa+]/;
const BLOCKED_BINDINGS = new Set(['tcp_wrap', 'udp_wrap', 'pipe_wrap', 'tls_wrap', 'stream_wrap',
  'js_stream', 'cares_wrap', 'spawn_sync', 'process_wrap', 'fs', 'fs_dir', 'fs_event_wrap',
  'signal_wrap', 'os', 'inspector']);
const writeSync = fs.writeSync;
let refused = 0;

function describe(target) {
  let text;
  try {
    text = typeof target === 'string' ? target : JSON.stringify(target);
  } catch (err) {
    text = String(target);
  }
  return String(text === undefined ? '' : text).replace(/[\r\n]+/g, ' ').slice(0, 160);
}

function refuse(op, target) {
  refused += 1;
  const shown = describe(target);
  try {
    writeSync(2, MARK + op + (shown ? ' ' + shown : '') + '\n');
  } catch (err) {
    // stderr is closed: the exit code still reports the refusal
  }
  const error = new Error('harden offline guard: ' + op + ' refused');
  error.code = 'HARDEN_OFFLINE';
  throw error;
}

function wrap(owner, name, op, decide) {
  if (!owner || typeof owner[name] !== 'function') return;
  const original = owner[name];
  owner[name] = function guarded(...args) {
    const verdict = decide ? decide(args) : { deny: true, target: args[0] };
    if (verdict.deny) return refuse(op, verdict.target);
    return original.apply(this, args);
  };
}

function optional(name, patch) {
  let m;
  try {
    m = require(name);
  } catch (err) {
    return;
  }
  patch(m);
}

function baseName(target) {
  if (typeof target === 'number') return null;
  try {
    const text = target instanceof URL ? fileURLToPath(target) : String(target);
    return path.basename(text);
  } catch (err) {
    return null;
  }
}

function isWriteFlag(flags) {
  if (typeof flags === 'string') return WRITE_FLAG.test(flags);
  if (typeof flags === 'number') {
    const c = fs.constants;
    return (flags & (c.O_WRONLY | c.O_RDWR | c.O_CREAT | c.O_APPEND | c.O_TRUNC)) !== 0;
  }
  return false;
}

const secretRead = (args) => {
  const name = baseName(args[0]);
  return { deny: name !== null && SECRET_FILE.test(name), target: args[0] };
};
const openDecision = (args) => {
  if (isWriteFlag(args[1])) return { deny: true, target: args[0] };
  return secretRead(args);
};

// Network and DNS
const net = require('net');
wrap(net.Socket.prototype, 'connect', 'net.connect', (a) => ({ deny: true, target: a[0] }));
wrap(net.Server.prototype, 'listen', 'net.listen', (a) => ({ deny: true, target: a[0] }));
const dns = require('dns');
for (const name of ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny',
  'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr',
  'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']) {
  wrap(dns, name, 'dns.' + name);
  wrap(dns.promises, name, 'dns.' + name);
}
for (const proto of [dns.Resolver && dns.Resolver.prototype, dns.promises.Resolver && dns.promises.Resolver.prototype]) {
  for (const name of ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']) wrap(proto, name, 'dns.Resolver.' + name);
}
const dgram = require('dgram');
wrap(dgram, 'createSocket', 'dgram.createSocket');
for (const name of ['bind', 'connect', 'send']) wrap(dgram.Socket.prototype, name, 'dgram.Socket.' + name);
for (const name of ['fetch', 'WebSocket', 'EventSource']) {
  if (typeof globalThis[name] === 'function') {
    globalThis[name] = function guardedGlobal(target) {
      return refuse(name, target && target.url ? target.url : target);
    };
  }
}
// Processes, workers, native code, inspector, WASI, low-level bindings
const childProcess = require('child_process');
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  wrap(childProcess, name, 'child_process.' + name);
}
wrap(childProcess.ChildProcess.prototype, 'spawn', 'child_process.ChildProcess.spawn');
wrap(process, 'execve', 'process.execve');
wrap(process, '_debugProcess', 'process._debugProcess');
wrap(process, 'kill', 'process.kill', (a) => ({ deny: Number(a[0]) !== process.pid, target: a[0] }));
wrap(require('os'), 'setPriority', 'os.setPriority');
const workerThreads = require('worker_threads');
workerThreads.Worker = function GuardedWorker(file) { return refuse('worker_threads.Worker', file); };
process.dlopen = function guardedDlopen(module, file) { return refuse('process.dlopen', file); };
for (const name of ['binding', '_linkedBinding']) {
  const original = process[name];
  if (typeof original === 'function') {
    process[name] = function guardedBinding(id) {
      if (BLOCKED_BINDINGS.has(String(id))) return refuse('process.' + name, id);
      return original.apply(this, arguments);
    };
  }
}
optional('inspector', (m) => wrap(m, 'open', 'inspector.open'));
optional('wasi', (m) => { m.WASI = function GuardedWASI() { return refuse('wasi.WASI'); }; });
if (typeof process.loadEnvFile === 'function') {
  process.loadEnvFile = function guardedLoadEnvFile(file) {
    return refuse('process.loadEnvFile', file === undefined ? '.env' : file);
  };
}
// Native writers outside fs
wrap(require('v8'), 'writeHeapSnapshot', 'v8.writeHeapSnapshot');
if (process.report) wrap(process.report, 'writeReport', 'process.report.writeReport');
wrap(require('module'), 'enableCompileCache', 'module.enableCompileCache');
optional('trace_events', (m) => wrap(m, 'createTracing', 'trace_events.createTracing'));
optional('node:sqlite', (m) => { m.DatabaseSync = function GuardedDatabaseSync(file) { return refuse('sqlite.DatabaseSync', file); }; wrap(m, 'backup', 'sqlite.backup'); });
// Files: secret-named reads and every write through a path
for (const name of ['readFile', 'readFileSync', 'createReadStream']) {
  wrap(fs, name, 'fs.' + name + '(secret)', secretRead);
}
wrap(fs.promises, 'readFile', 'fs.promises.readFile(secret)', secretRead);
wrap(fs, 'openAsBlob', 'fs.openAsBlob(secret)', secretRead);
wrap(fs, 'open', 'fs.open', openDecision);
wrap(fs, 'openSync', 'fs.openSync', openDecision);
wrap(fs.promises, 'open', 'fs.promises.open', openDecision);
wrap(fs, 'createWriteStream', 'fs.createWriteStream');
for (const name of ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rm', 'rmdir', 'unlink',
  'rename', 'copyFile', 'cp', 'symlink', 'link', 'truncate', 'utimes', 'lutimes', 'chmod',
  'lchmod', 'chown', 'lchown', 'fchmod', 'fchown', 'futimes', 'mkdtempDisposable']) {
  wrap(fs, name, 'fs.' + name);
  wrap(fs, name + 'Sync', 'fs.' + name + 'Sync');
  wrap(fs.promises, name, 'fs.promises.' + name);
}
// ES module imports of built-in modules read these patched properties from now on.
require('module').syncBuiltinESMExports();

process.on('exit', () => {
  if (refused > 0) process.exitCode = EXIT_CODE;
});
