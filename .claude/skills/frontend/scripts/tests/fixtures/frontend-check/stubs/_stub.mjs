// Shared behaviour of the stub check modules: what each gate returns comes from <state>/stub-plan.json, written by
// the test before the run; every call is recorded in globalThis.__feStubCalls and in <state>/stub-calls.jsonl (in
// <out>/stub-calls.jsonl when --out is given).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EnvError, UsageError } from '../../../../lib/errors.mjs';
import { gate } from '../../../../lib/report.mjs';

function plan(ctx) {
  const file = path.join(ctx.state, 'stub-plan.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

function record(name, ctx, selected, extra) {
  const call = {
    module: name,
    selected,
    root: ctx.root,
    state: ctx.state,
    design: ctx.design,
    baseUrl: ctx.baseUrl,
    browser: ctx.browser ? ctx.browser.version() : null,
    routes: ctx.routes.map((r) => r.path),
    viewports: ctx.viewports.map((v) => v.name),
    args: ctx.args,
    profileMode: ctx.profile.run_mode,
    ...extra,
  };
  globalThis.__feStubCalls = globalThis.__feStubCalls ?? [];
  globalThis.__feStubCalls.push({ ...call, browserObject: ctx.browser });
  // With --out the state folder is read-only (Q-F14), so the record goes to the run's output folder instead.
  const dir = ctx.args.out ? ctx.args.outDir : ctx.state;
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, 'stub-calls.jsonl'), `${JSON.stringify(call)}\n`);
  ctx.log(`stub ${name}: ${selected.join(',')}`);
}

export async function runStub(name, gates, ctx, selected, extra = {}) {
  const p = plan(ctx);
  record(name, ctx, selected, extra);
  const how = p.modules?.[name];
  if (how === 'throw-usage') throw new UsageError(`stub ${name}: input file malformed; fix it`);
  if (how === 'throw-env') throw new EnvError(`stub ${name}: no browser`);
  if (how === 'throw-bug') throw new TypeError(`stub ${name}: cannot read properties of undefined`);
  if (how === 'not-array') return { nope: true };
  const out = [];
  for (const id of selected) {
    const meta = gates.find((g) => g.id === id);
    const b = gate(meta);
    const want = p.gates?.[id] ?? 'ok';
    if (want === 'omit') continue;
    if (want === 'ok') out.push(b.ok(`stub ${name} ok${extra.title ? ` (${extra.title})` : ''}`, [{ route: '/', value: extra.title ?? name, deep: { nested: 1 } }]));
    else if (want === 'fail') out.push(b.fail(`stub ${name} found a problem`, [{ route: '/', viewport: 'desktop', selector: 'h1', value: { kind: 'object value' }, line: -3 }]));
    else if (want === 'skip') out.push(b.skip(`stub ${name}: input missing`));
    else if (want === 'duplicate') out.push(b.ok('first'), b.ok('second'));
    else if (want === 'bad-state') out.push({ ...b.ok('x'), state: 'maybe' });
  }
  if (p.extra?.[name]) out.push(gate('render.unrequested', 'Unrequested', 'never').ok('should be dropped'), 'not a result');
  return out;
}
