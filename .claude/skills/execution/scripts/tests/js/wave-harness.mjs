// Runs a generated workflow script (wave or planner) under Node with a scripted fake agent() (contract/TESTS.md 6,
// WAVES.md 10). Node built-ins only.
//
// Usage: node wave-harness.mjs <script.js> <scenario.json>
// The scenario: {
//   args: {...}                         the Workflow args (now_utc, skip)
//   responses: {label: value | [values in call order]}   a value is the agent's return, null for a dead agent,
//                                       or {"__throw": "message"} for an agent() call that throws
//   delays: {label: n}                  macrotask ticks the call waits (default 2), to force interleavings
//   lanes: {task: lane}, browser: [tasks], unary: {task: [resources]}   for the peak and overlap counters
// }
// Prints one JSON object on stdout: {returned, calls, logs, peaks, intervals, phases}.
//   calls: [{seq, label, task, role, phase, agentType, model, effort, isolation, has_schema, prompt, start, end}]
//   peaks: {writers, verifiers, integrators, browser, lanes: {lane: n}}: concurrent agent calls per group, and for
//          browser the concurrent browser TASKS (whole-task intervals: the slot is held from implement to verify)
//   intervals: {task: [first start, last end]} on the harness's logical clock
// The script is wrapped as WAVES.md 2.3 does (AsyncFunction over its text, `export const meta` made a const), with
// `Date` and `Math` shadowed: argless `new Date()`, `Date.now()` and `Math.random()` throw.

import { readFileSync } from 'node:fs';

const [scriptPath, scenarioPath] = process.argv.slice(2);
if (!scriptPath || !scenarioPath) {
  process.stderr.write('usage: node wave-harness.mjs <script.js> <scenario.json>\n');
  process.exit(2);
}
const source = readFileSync(scriptPath, 'utf8').replace('export const meta', 'const meta');
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
const responses = scenario.responses || {};
const delays = scenario.delays || {};
const lanes = scenario.lanes || {};
const browserTasks = new Set(scenario.browser || []);

const RealDate = Date;
function FakeDate(...a) {
  if (a.length === 0) throw new Error('argless new Date() read the clock');
  return new RealDate(...a);
}
FakeDate.now = () => { throw new Error('Date.now() read the clock'); };
FakeDate.parse = RealDate.parse;
FakeDate.UTC = RealDate.UTC;
const FakeMath = Object.create(Math);
FakeMath.random = () => { throw new Error('Math.random() used'); };

let clock = 0;
const calls = [];
const logs = [];
const phases = [];
const used = {};
const peaks = { writers: 0, verifiers: 0, integrators: 0, browser: 0, lanes: {} };
const active = { writers: 0, verifiers: 0, integrators: 0, lanes: {} };
const intervals = {};

function roleOf(prompt, label) {
  const m = /Role: ([a-z-]+)/.exec(prompt || '');
  if (m) return m[1];
  if (/keep receipt/.test(label)) return 'receipt-writer';
  if (/prepare/.test(label)) return 'runner';
  return 'fragment-agent';
}
function taskOf(label) {
  const m = /^(T[0-9]{3,})/.exec(label || '');
  return m ? m[1] : null;
}
function groupOf(role) {
  if (role === 'implementer' || role === 'test-designer') return 'writers';
  if (role === 'verifier' || role === 'reviewer') return 'verifiers';
  if (role === 'integrator') return 'integrators';
  return null;
}
function defaultFor(role, label, opts) {
  const task = taskOf(label);
  if (role === 'implementer') {
    return { status: 'built', merge: { receipt_path: null, outcome: 'landed', landed_sha: 'a'.repeat(40), exit_code: 0 } };
  }
  if (role === 'integrator') return { receipt_path: null, outcome: 'landed', landed_sha: 'b'.repeat(40), exit_code: 0 };
  if (role === 'verifier') return { verdict: 'pass', receipt_sha256: 'c'.repeat(64), task };
  if (role === 'test-designer') return { proofs: [], commit: null };
  if (role === 'reviewer') return { verdict: 'pass', findings: [], gaps: [] };
  if (role === 'planner') return { schema: 'execution.result.planner/1' };
  if (role === 'runner') return { exit_code: 0, json: {}, stderr_tail: '' };
  if (role === 'receipt-writer') return { written: true, path: 'x' };
  if (opts && opts.schema && opts.schema.required && opts.schema.required.indexOf('instantiate') !== -1) {
    return { instantiate: { exit_code: 0, json: {}, stderr_tail: '' }, validate: { exit_code: 0, json: {}, stderr_tail: '' } };
  }
  return { ok: true };
}
function nextResponse(label) {
  if (!(label in responses)) return undefined;
  const r = responses[label];
  if (Array.isArray(r)) {
    used[label] = (used[label] || 0) + 1;
    return r.length >= used[label] ? r[used[label] - 1] : r[r.length - 1];
  }
  return r;
}
function tick(n) {
  return new Promise((resolve) => setTimeout(resolve, 0)).then(() => (n > 1 ? tick(n - 1) : undefined));
}

async function agent(prompt, opts) {
  if (!opts || typeof opts !== 'object') throw new Error('agent() called without options');
  if (!opts.model || !opts.effort) throw new Error('agent() called without an explicit model and effort: ' + opts.label);
  const label = opts.label || '';
  const role = roleOf(prompt, label);
  const task = taskOf(label);
  const group = groupOf(role);
  const call = {
    seq: calls.length, label, task, role, phase: opts.phase || null, agentType: opts.agentType || null,
    model: opts.model, effort: opts.effort, isolation: opts.isolation || null, has_schema: Boolean(opts.schema),
    prompt, start: ++clock, end: null
  };
  calls.push(call);
  if (group) {
    active[group] += 1;
    peaks[group] = Math.max(peaks[group], active[group]);
  }
  const lane = task ? lanes[task] : null;
  const writing = group === 'writers';
  if (lane && writing) {
    active.lanes[lane] = (active.lanes[lane] || 0) + 1;
    peaks.lanes[lane] = Math.max(peaks.lanes[lane] || 0, active.lanes[lane]);
  }
  if (task) {
    if (!intervals[task]) intervals[task] = [call.start, call.start];
  }
  try {
    await tick(delays[label] || 2);
    let out = nextResponse(label);
    if (out === undefined) out = defaultFor(role, label, opts);
    if (out && typeof out === 'object' && !Array.isArray(out) && typeof out.__throw === 'string') {
      throw new Error(out.__throw);
    }
    return out === null ? null : JSON.parse(JSON.stringify(out));
  } finally {
    call.end = ++clock;
    if (group) active[group] -= 1;
    if (lane && writing) active.lanes[lane] -= 1;
    if (task) intervals[task][1] = call.end;
  }
}

async function parallel(thunks) {
  return Promise.all(thunks.map(async (t) => {
    try {
      return await t();
    } catch (err) {
      logs.push('parallel thunk threw: ' + (err && err.message ? err.message : String(err)));
      return null;
    }
  }));
}

async function pipeline(items, ...stages) {
  return Promise.all(items.map(async (item) => {
    let value = item;
    for (const stage of stages) value = await stage(value, item);
    return value;
  }));
}

function log(message) {
  logs.push(String(message));
}

function phase(title) {
  phases.push(String(title));
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let returned = null;
let error = null;
try {
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'Date', 'Math', source);
  returned = await fn(agent, parallel, pipeline, log, phase, scenario.args || {}, FakeDate, FakeMath);
} catch (err) {
  error = err && err.stack ? err.stack : String(err);
}
// A browser slot is held for the whole task (WAVES.md 3.4), not per agent call: the browser peak is the largest
// number of browser tasks whose [first call start, last call end] intervals overlap at one instant of the logical
// clock (a task holding the slot between two calls counts, as it does for the script).
function peakOverlap(ids) {
  const points = [];
  for (const id of ids) {
    if (!intervals[id]) continue;
    points.push([intervals[id][0], 1]);
    points.push([intervals[id][1], -1]);
  }
  points.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));      // an end before a start at the same instant
  let cur = 0;
  let peak = 0;
  for (const [, delta] of points) {
    cur += delta;
    peak = Math.max(peak, cur);
  }
  return peak;
}
peaks.browser = peakOverlap(Array.from(browserTasks));
process.stdout.write(JSON.stringify({ returned, error, calls, logs, peaks, intervals, phases }) + '\n');
process.exit(error ? 1 : 0);
