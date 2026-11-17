// @ts-check
import path from 'node:path';
import { UsageError } from './errors.mjs';
import { writeText } from './fsutil.mjs';

/**
 * @typedef {{route?: string, viewport?: string, selector?: string, file?: string, line?: number,
 *   value?: string | number | boolean | null, [key: string]: unknown}} Evidence
 * @typedef {'ok' | 'fail' | 'skipped'} GateState
 * @typedef {{id: string, title: string, ifDropped: string}} GateMeta
 * @typedef {GateMeta & {state: GateState, detail: string, evidence: Evidence[], advisory?: true}} GateResult
 *   `advisory: true` marks an ok that judged nothing binding: a gate that can only warn, or whose threshold is not
 *   calibrated yet. It never fails a run, and the report counts it apart so no reader takes it for a passed check.
 * @typedef {{ok: number, fail: number, skipped: number, advisory?: number}} GateCounts
 *   `advisory`, present only when some are, counts the ok gates that are advisory (they are also in `ok`, which
 *   counts gate states).
 * @typedef {{ok: boolean, tool?: string, version?: string, at?: string, target?: Record<string, unknown>,
 *   counts: GateCounts, gates: GateResult[]}} GateReport
 * @typedef {{ok: (detail: string, evidence?: Evidence | Evidence[]) => GateResult,
 *   fail: (detail: string, evidence?: Evidence | Evidence[]) => GateResult,
 *   advise: (detail: string, evidence?: Evidence | Evidence[]) => GateResult,
 *   skip: (reason: string) => GateResult, meta: GateMeta}} GateBuilder
 */

/** Gate ids are `group.name`: lowercase letters, digits and hyphens, at least one dot. */
export const GATE_ID = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/;

/** Report format version (section 4). */
export const REPORT_VERSION = '1';

/**
 * Builder of one gate's result. Accepts `gate(id, title, ifDropped)` or a GATES entry `gate({id, title, ifDropped})`.
 * `ifDropped` says what would pass unnoticed without the gate; it is required because it is the reason the gate
 * exists.
 * @param {string | GateMeta} idOrMeta
 * @param {string} [title]
 * @param {string} [ifDropped]
 * @returns {GateBuilder}
 */
export function gate(idOrMeta, title, ifDropped) {
  const meta = typeof idOrMeta === 'object' && idOrMeta !== null
    ? { id: idOrMeta.id, title: idOrMeta.title, ifDropped: idOrMeta.ifDropped }
    : { id: idOrMeta, title: title ?? '', ifDropped: ifDropped ?? '' };
  if (typeof meta.id !== 'string' || !GATE_ID.test(meta.id)) {
    throw new TypeError(`gate: id ${JSON.stringify(meta.id)} must look like group.name (lowercase, digits, hyphens)`);
  }
  if (typeof meta.title !== 'string' || meta.title.trim() === '') throw new TypeError(`gate ${meta.id}: title is required`);
  if (typeof meta.ifDropped !== 'string' || meta.ifDropped.trim() === '') {
    throw new TypeError(`gate ${meta.id}: ifDropped is required (what would pass unnoticed without this gate)`);
  }
  const frozen = Object.freeze({ ...meta });
  /** @type {(state: GateState, detail: string, evidence?: Evidence | Evidence[]) => GateResult} */
  const result = (state, detail, evidence) => ({
    ...frozen,
    state,
    detail: oneLine(detail),
    evidence: normaliseEvidence(evidence),
  });
  return {
    meta: frozen,
    ok: (detail, evidence) => result('ok', detail, evidence),
    fail: (detail, evidence) => result('fail', detail, evidence),
    advise: (detail, evidence) => ({ ...result('ok', detail, evidence), advisory: true }),
    skip: (reason) => result('skipped', reason),
  };
}

/**
 * @param {unknown} detail
 * @returns {string}
 */
function oneLine(detail) {
  return String(detail ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/**
 * @param {Evidence | Evidence[] | undefined} evidence
 * @returns {Evidence[]}
 */
function normaliseEvidence(evidence) {
  if (evidence === undefined || evidence === null) return [];
  const list = Array.isArray(evidence) ? evidence : [evidence];
  return list.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError(`gate evidence[${i}] must be an object such as {route, viewport, selector, file, line, value}`);
    }
    return { ...item };
  });
}

/**
 * Aggregates gate results into the report of section 4. `ok` is true only when at least one gate ran, no gate
 * failed and every skipped gate is allowed by `allowSkip` (exact ids, or a bare group name for the whole group):
 * a skipped gate never counts as passing. Gates listed in `requested` that returned no result are added as
 * skipped, so a gate a module forgot cannot pass silently. With `tool`, the report carries the header fields
 * (tool, version, at, target) in the documented order.
 * @param {GateResult[]} results
 * @param {{allowSkip?: readonly string[], requested?: ReadonlyArray<string | GateMeta>, tool?: string,
 *   target?: Record<string, unknown>, at?: Date | string}} [options]
 * @returns {GateReport}
 */
export function aggregate(results, { allowSkip = [], requested, tool, target, at } = {}) {
  if (!Array.isArray(results)) throw new TypeError('aggregate: results must be an array of GateResult');
  /** @type {GateResult[]} */
  const gates = [];
  const seen = new Set();
  for (const r of results) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !['ok', 'fail', 'skipped'].includes(r.state)) {
      throw new TypeError(`aggregate: ${JSON.stringify(r)} is not a GateResult (build it with gate())`);
    }
    if (seen.has(r.id)) throw new TypeError(`aggregate: gate ${r.id} reported twice; each gate yields one result`);
    seen.add(r.id);
    gates.push(r);
  }
  for (const want of requested ?? []) {
    const meta = typeof want === 'string' ? { id: want, title: want, ifDropped: 'unknown: the gate never reported' } : want;
    if (seen.has(meta.id)) continue;
    seen.add(meta.id);
    gates.push(gate(meta).skip('requested but not run: the gate returned no result'));
  }
  /** @type {GateCounts} */
  const counts = { ok: 0, fail: 0, skipped: 0 };
  for (const g of gates) counts[g.state] += 1;
  const advisory = gates.filter((g) => g.state === 'ok' && g.advisory === true).length;
  if (advisory > 0) counts.advisory = advisory;
  const allowed = (/** @type {string} */ id) =>
    allowSkip.some((a) => a === id || (!a.includes('.') && id.startsWith(`${a}.`)));
  const ok = gates.length > 0 && counts.fail === 0 && gates.every((g) => g.state !== 'skipped' || allowed(g.id));
  if (tool === undefined) return { ok, counts, gates };
  return { ok, tool, version: REPORT_VERSION, at: utcSeconds(at), target: target ?? {}, counts, gates };
}

/**
 * ISO 8601 UTC to the second, as in section 4 (`2026-10-01T10:00:00Z`).
 * @param {Date | string} [at]
 * @returns {string}
 */
export function utcSeconds(at) {
  const date = at === undefined ? new Date() : new Date(at);
  if (Number.isNaN(date.getTime())) throw new TypeError(`utcSeconds: invalid date ${JSON.stringify(at)}`);
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * A UTC timestamp safe in file names on every OS (no colons): `2026-10-01T10-00-00Z`, for `gates/<UTC>.json`.
 * @param {Date | string} [at]
 * @returns {string}
 */
export function utcStamp(at) {
  return utcSeconds(at).replace(/:/g, '-');
}

/**
 * Writes `<outDir>/<name>.json` (pretty JSON, LF, trailing newline), creating the folder. Returns the path with
 * forward slashes. `name` must be a plain file name: no folders, no characters Windows refuses.
 * @param {GateReport | Record<string, unknown>} report
 * @param {string} outDir
 * @param {string} name
 * @returns {string}
 */
export function writeReport(report, outDir, name) {
  if (typeof name !== 'string' || name === '' || /[<>:"/\\|?*]/.test(name) || hasControlCharacter(name) || name === '.' || name === '..') {
    throw new UsageError(`report name ${JSON.stringify(name)} is not a plain file name; use letters, digits, dots and hyphens`);
  }
  const base = name.endsWith('.json') ? name.slice(0, -5) : name;
  return writeText(path.join(outDir, `${base}.json`), `${JSON.stringify(report, null, 2)}\n`);
}

/**
 * @param {string} s
 * @returns {boolean}
 */
function hasControlCharacter(s) {
  for (let i = 0; i < s.length; i += 1) if (s.charCodeAt(i) < 32) return true;
  return false;
}
