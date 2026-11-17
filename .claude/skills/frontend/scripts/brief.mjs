// @ts-check
/**
 * P0, task FE-00: the frontend brief (CONTRACTS 6.4, references/01-brief.md).
 *
 * Discovers the project's inputs by glob from the workspace root, using the table of research/internal-contracts.md
 * FD13-F05: each input tries its globs case-sensitively, then case-insensitively, then with research/ re-rooted at
 * docs/ (BF-02). It fills only the fields a file or the profile sources, verbatim and with `path:line`, and lists
 * every other field under `missing` with the action that fills it: a manual task in mode A, a question in mode B.
 * Prose fields are read from explicitly labelled lines only ("H1: ...", "**Broken:** ...", a two-cell table row), so
 * nothing is paraphrased or guessed. Writes brief.json, brief.md and receipts/brief-discovery.json into the state
 * directory and runs gate brief.complete.
 *
 * Also the shared readers of the coverage and first-view checks: the claims ledger (both status vocabularies,
 * FD13-F10), the never-show list (CONTRACTS 6.1b), the feature catalogue and the sponsor names.
 */
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli, isMainModule } from './lib/args.mjs';
import { EnvError, UsageError, exitWith } from './lib/errors.mjs';
import { compileGlob, readText, toPosix, walk, writeText } from './lib/fsutil.mjs';
import { stateDir } from './lib/paths.mjs';
import { loadProfile } from './lib/profile.mjs';
import { aggregate, gate, utcSeconds } from './lib/report.mjs';
import { loadRoutes } from './lib/routes.mjs';
import { lineOf, neverShowRegexProblem, normaliseText } from './lib/text.mjs';

/**
 * @typedef {import('./lib/profile.mjs').Profile} Profile
 * @typedef {import('./lib/report.mjs').GateResult} GateResult
 * @typedef {import('./lib/report.mjs').GateReport} GateReport
 * @typedef {import('./lib/report.mjs').Evidence} Evidence
 * @typedef {'live' | 'testnet' | 'simulated' | 'planned'} FeatureStatus
 * @typedef {'do-not-carry' | 'undisclosed-security' | 'never-public' | 'embargo'} NeverShowClass
 * @typedef {'manual-task' | 'question'} MissingAction
 * @typedef {{field: string, action: MissingAction, why: string}} MissingEntry
 * @typedef {{id: string, name: string, strategy: string, source: string}} BriefSponsor
 * @typedef {{name: string, category: string, url: string, url_source: string, owner_confirmed: boolean}} BriefCustomer
 * @typedef {{id: string, group: string, title: string, status: FeatureStatus, route: string | null,
 *   proof: string | null, source: string}} BriefFeature
 * @typedef {{class: NeverShowClass, pattern: string, regex: boolean, until_utc: string | null, source: string}} BriefNeverShow
 * @typedef {{
 *   project: {name: string, name_status: 'final' | 'working' | 'pending', source: string},
 *   sentences: {broken: string, did: string, source: string},
 *   hero: {h1: string, sentence: string, source: string},
 *   gap: {text: string, who_loses: string, how_much: string, source: string},
 *   sponsors: BriefSponsor[],
 *   customers: BriefCustomer[],
 *   use_case: {text: string, source: string},
 *   features: BriefFeature[],
 *   claims: {path: string, ids: string[]},
 *   never_show: BriefNeverShow[],
 *   judge_path: {beats: string[], source: string},
 *   missing: MissingEntry[]
 * }} Brief
 * @typedef {{id: string, class: NeverShowClass, pattern: string, regex: boolean, case_sensitive: boolean,
 *   until_utc: string | null, scope: 'rendered' | 'repo' | 'both', note: string, source: string, line: number}} NeverShowEntry
 * @typedef {{file: string, exists: boolean, entries: NeverShowEntry[], problems: string[]}} NeverShowList
 * @typedef {{id: string, group: string, title: string, priority: string, status_expected: FeatureStatus | null,
 *   line: number}} CatalogueFeature
 * @typedef {{file: string, exists: boolean, features: CatalogueFeature[], problems: string[]}} Catalogue
 * @typedef {'verified' | 'unverified' | 'cut' | 'unknown'} ClaimStatus
 * @typedef {{id: string, status: ClaimStatus, raw: string, line: number}} ClaimRow
 * @typedef {{file: string, exists: boolean, rows: ClaimRow[], verifiedIds: string[], problems: string[]}} ClaimsLedger
 * @typedef {{key: string, label: string, globs: readonly string[]}} DiscoveryInput
 * @typedef {{logical: string, abs: string, shown: string}} FoundFile
 * @typedef {{key: string, label: string, globs: readonly string[], matcher: string | null, files: FoundFile[]}} InputMatch
 * @typedef {{version: 1, tool: 'brief', at: string, workspace: string, workspace_how: string, research_dir: string,
 *   profile: string | null, run_mode: 'A' | 'B', matcher: string, files_scanned: number,
 *   inputs: Array<{key: string, label: string, globs: readonly string[], matcher: string | null, count: number,
 *   matches: string[]}>, notes: string[]}} DiscoveryReceipt
 */

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPTS_DIR, '..');

/** The human-view template (assets/templates/brief.md). */
export const BRIEF_TEMPLATE = toPosix(path.join(SKILL_DIR, 'assets', 'templates', 'brief.md'));
/** The FD21 sponsor allowlist; sponsor names come from its display_name. */
export const SPONSOR_ALLOWLIST = toPosix(path.join(SKILL_DIR, 'assets', 'sponsor-allowlist.json'));
/** The discovery receipt, relative to the state directory. */
export const RECEIPT_PATH = 'receipts/brief-discovery.json';

export const FEATURE_STATUSES = Object.freeze(/** @type {const} */ (['live', 'testnet', 'simulated', 'planned']));
export const NEVER_SHOW_CLASSES = Object.freeze(/** @type {const} */ (['do-not-carry', 'undisclosed-security', 'never-public', 'embargo']));
export const NEVER_SHOW_SCOPES = Object.freeze(/** @type {const} */ (['rendered', 'repo', 'both']));

export const GATES = Object.freeze([
  Object.freeze({
    id: 'brief.complete',
    title: 'brief.json is complete: every field sourced, every gap listed as missing with an action',
    ifDropped: 'a field could carry text nobody can trace, and a gap would be guessed instead of asked',
  }),
]);

/**
 * The discovery table of FD13-F05 (as corrected at verification), one row per input. Globs are relative to the
 * workspace root; `research/` is the profile's paths.research when it is set.
 * @type {ReadonlyArray<DiscoveryInput>}
 */
export const DISCOVERY = Object.freeze([
  { key: 'rubric', label: 'rubric, format, deliverables', globs: ['research/findings/**/*{rubric,rules}*.md', 'docs/*RULEBOOK*.md'] },
  { key: 'sponsors', label: 'sponsor map, customers, use cases', globs: ['research/findings/**/*{customer,sponsor,strategy}*.md'] },
  {
    key: 'spec',
    label: 'gap, two sentences, spec',
    globs: ['research/**/{_recommendation,SPEC,PHASE-A-DECISION}.md', 'research/findings/**/_summary.md', 'docs/*{DECISIONS,PITCH}*.md'],
  },
  { key: 'catalogue', label: 'feature catalogue', globs: ['research/FEATURE-CATALOGUE.md', 'docs/*SPEC*FRONTEND*.md'] },
  { key: 'claims', label: 'claims ledger', globs: ['research/**/claims*.md'] },
  { key: 'never_show', label: 'never-show lists', globs: ['research/findings/**/_summary.md', '**/redact-check.*'] },
  { key: 'judges', label: "judges, judge's path", globs: ['research/**/*{judge,judges}*.md'] },
  {
    key: 'storyboard',
    label: 'storyboard, video script',
    globs: ['research/**/*{VIDEO,SCRIPT,runsheet,RUNSHEET}*.md', 'docs/*{RUNSHEET,runsheet,SCRIPT}*.md'],
  },
  { key: 'naming', label: 'name and naming study', globs: ['research/design/naming/_verdict.md'] },
  { key: 'data_contract', label: 'data contract, fixtures', globs: ['docs/*API-CONTRACT*.md', '**/fixtures/**', '**/data/**'] },
]);

const MATCHER_NOTE =
  'lib/fsutil compileGlob over one walk of the workspace (node_modules, .git and build folders excluded); each input ' +
  'tries its globs case-sensitively, then case-insensitively, then with research/ re-rooted at docs/ (both cases)';

/**
 * Labels a source file may use to state a field on one line ("H1: Settle in one block", "**Broken:** ...", or a
 * table row "| H1 | Settle in one block |"). Longer labels first, so "hero h1" wins over "h1".
 */
export const LABELS = Object.freeze({
  'sentences.broken': ['the thing that is broken', 'what is broken', "what's broken", 'broken'],
  'sentences.did': ['what we did about it', 'what we did', 'did'],
  'hero.h1': ['hero headline', 'hero h1', 'headline', 'h1'],
  'hero.sentence': ['hero sentence', 'hero subhead', 'subhead'],
  'gap.text': ['the gap', 'gap'],
  'gap.who_loses': ['who loses money', 'who loses'],
  'gap.how_much': ['how much is lost', 'amount at stake', 'how much'],
  'use_case.text': ['business use case', 'use case'],
  'project.name': ['project name', 'chosen name', 'verdict', 'name'],
});

/** Fields every brief must fill or list under missing (CONTRACTS 6.4). */
export const REQUIRED_FIELDS = Object.freeze([
  'project.name', 'sentences.broken', 'sentences.did', 'hero.h1', 'hero.sentence', 'gap.text', 'gap.who_loses',
  'gap.how_much', 'sponsors', 'customers', 'use_case.text', 'features', 'claims.path', 'never_show', 'judge_path.beats',
]);

const ID_HEADER = /^(?:#|id|claim id|claim-id|ref|no\.?|n°)$/i;
const STATUS_HEADER = /^status$/i;
const FR_ID = /\bFR-\d{3,}\b/g;
const GROUP_ID = /\bG\d+\b/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^([ \t]*)(?:\d+[.)]|[-*+])\s+(.*\S)\s*$/;
const FENCE = /^\s{0,3}(?:```|~~~)/;
const JUDGE_PATH_HEADING = /\bjudge(?:['’]s|s['’]|s)?\s+path\b|\bdemo\s+(?:path|beats)\b|\bpath\s+of\s+the\s+judge\b/i;
const NEVER_SHOW_HEADING = /\bdo[- ]not[- ]carry\b|\bprivate\b|\bnever[- ]public\b|\bembargo|\bundisclosed\b|\bhold until\b/i;
const NEVER_SHOW_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_READ_BYTES = 4 * 1024 * 1024;
const MAX_RECEIPT_MATCHES = 50;

// ---------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {string} p @returns {boolean} */
function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** @param {string} p @returns {boolean} */
function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** @param {string} s @returns {string} */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Joins source references, dropping duplicates and empties: "a.md:3; b.md:7".
 * @param {ReadonlyArray<string | null | undefined>} sources
 * @returns {string}
 */
export function joinSources(sources) {
  /** @type {string[]} */
  const parts = [];
  for (const s of sources) {
    for (const part of String(s ?? '').split(';')) {
      const p = part.trim();
      if (p && !parts.includes(p)) parts.push(p);
    }
  }
  return parts.join('; ');
}

/**
 * Splits a source string into file references: `path`, `path:12`, `path:12-14`, `path#anchor`, several joined by
 * semicolons. A Windows drive letter is never read as a line number.
 * @param {string} source
 * @returns {Array<{raw: string, path: string, line: number | null, lineEnd: number | null}>}
 */
export function parseSources(source) {
  return String(source ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => {
      let p = raw;
      const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
      const hash = p.indexOf('#', slash + 1);
      if (hash >= 0) p = p.slice(0, hash);
      const m = /^(.*?):(\d+)(?:-(\d+))?$/.exec(p);
      if (m && m[1] !== '' && !/^[A-Za-z]$/.test(m[1])) {
        return { raw, path: m[1], line: Number(m[2]), lineEnd: m[3] ? Number(m[3]) : null };
      }
      return { raw, path: p, line: null, lineEnd: null };
    });
}

/**
 * Removes inline Markdown from one line of text: links keep their text, emphasis and code marks go, whitespace
 * collapses.
 * @param {string} text
 * @returns {string}
 */
export function cleanInline(text) {
  return String(text ?? '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Unwraps a labelled value: bold, code or quotes around the whole value go; the inside stays verbatim.
 * @param {string} value
 * @returns {string}
 */
export function cleanValue(value) {
  let s = String(value ?? '').trim();
  for (;;) {
    const before = s;
    s = s
      .replace(/^\*\*([\s\S]+)\*\*$/, '$1')
      .replace(/^__([\s\S]+)__$/, '$1')
      .replace(/^`([\s\S]+)`$/, '$1')
      .replace(/^"([\s\S]+)"$/, '$1')
      .replace(/^“([\s\S]+)”$/, '$1')
      .trim();
    if (s === before) return s;
  }
}

/**
 * @param {string} line
 * @returns {string[]} the cells of a Markdown table row, trimmed, without the outer empty cells
 */
function tableCells(line) {
  const cells = line.trim().split(/(?<!\\)\|/).map((c) => c.trim());
  if (cells.length > 0 && cells[0] === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/** @param {string} line @returns {boolean} */
function isTableSeparator(line) {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/**
 * The lines of a Markdown text with a flag for fenced code, so labels and headings inside code are ignored.
 * @param {string} text
 * @returns {Array<{text: string, line: number, code: boolean}>}
 */
function markdownLines(text) {
  const out = [];
  let inFence = false;
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const isFence = FENCE.test(lines[i]);
    out.push({ text: lines[i], line: i + 1, code: inFence || isFence });
    if (isFence) inFence = !inFence;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Extraction from Markdown (pure)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Values stated on labelled lines: `Label: value`, `**Label:** value`, `**Label**: value`, `- Label: value`, or a
 * table row whose first cell is the label. Labels match case-insensitively; lines in fenced code are skipped.
 * @param {string} text
 * @param {readonly string[]} labels
 * @returns {Array<{label: string, value: string, line: number}>}
 */
export function extractLabelled(text, labels) {
  const alternatives = [...labels].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
  const lineRe = new RegExp(
    `^\\s{0,3}(?:>\\s*)?(?:[-*+]\\s+|\\d+[.)]\\s+)?(?:\\*\\*|__)?\\s*(${alternatives})\\s*` +
      '(?:(?:\\*\\*|__)\\s*:|:\\s*(?:\\*\\*|__)?)\\s*(.*\\S)?\\s*$',
    'i',
  );
  const wanted = new Set(labels.map((l) => l.toLowerCase()));
  /** @type {Array<{label: string, value: string, line: number}>} */
  const out = [];
  const lines = markdownLines(text);
  for (let i = 0; i < lines.length; i += 1) {
    const { text: raw, line, code } = lines[i];
    if (code) continue;
    if (raw.trim().startsWith('|')) {
      const cells = tableCells(raw);
      const isHeader = i + 1 < lines.length && isTableSeparator(lines[i + 1].text);
      if (cells.length === 2 && !isHeader && !isTableSeparator(raw)) {
        const key = cleanInline(cells[0]).replace(/:$/, '').trim().toLowerCase();
        const value = cleanValue(cells[1]);
        if (wanted.has(key) && value) out.push({ label: key, value, line });
      }
      continue;
    }
    const m = lineRe.exec(raw);
    if (!m || m[2] === undefined) continue;
    const value = cleanValue(m[2]);
    if (value) out.push({ label: m[1].toLowerCase(), value, line });
  }
  return out;
}

/**
 * Requirement ids defined in a Markdown spec or catalogue: the first line where an `FR-nnn` id is followed by a
 * title (a table row's next cell, or the text after the id), with the group (`G1`) of the nearest heading above.
 * @param {string} text
 * @returns {Array<{id: string, title: string, group: string, line: number}>}
 */
export function extractFeatureIds(text) {
  /** @type {Map<string, {id: string, title: string, group: string, line: number}>} */
  const found = new Map();
  /** @type {Map<string, number>} */
  const firstSeen = new Map();
  /** @type {Array<string | null>} group id of the open heading at each level 1..6 */
  const groups = [null, null, null, null, null, null, null];
  let group = '';
  for (const { text: raw, line, code } of markdownLines(text)) {
    if (code) continue;
    const heading = HEADING.exec(raw);
    if (heading) {
      const level = heading[1].length;
      const g = GROUP_ID.exec(heading[2]);
      groups[level] = g ? g[0] : null;
      for (let deeper = level + 1; deeper <= 6; deeper += 1) groups[deeper] = null;
      group = groups.slice(1, level + 1).filter(Boolean).pop() ?? '';
    }
    const ids = [...raw.matchAll(FR_ID)];
    for (const match of ids) {
      const id = match[0];
      if (!firstSeen.has(id)) firstSeen.set(id, line);
      if (found.has(id)) continue;
      const title = featureTitle(raw, id, match.index ?? 0);
      if (title) found.set(id, { id, title, group, line });
    }
  }
  for (const [id, line] of firstSeen) {
    if (!found.has(id)) found.set(id, { id, title: '', group: '', line });
  }
  return [...found.values()].sort((a, b) => a.line - b.line || a.id.localeCompare(b.id));
}

/**
 * @param {string} raw
 * @param {string} id
 * @param {number} index
 * @returns {string}
 */
function featureTitle(raw, id, index) {
  if (raw.trim().startsWith('|')) {
    const cells = tableCells(raw);
    const at = cells.findIndex((c) => cleanInline(c).startsWith(id));
    if (at < 0) return '';
    const rest = cleanInline(cells[at]).slice(id.length).replace(/^[\s:.)\]—–-]+/, '').trim();
    if (isTitle(rest)) return rest;
    for (const cell of cells.slice(at + 1)) {
      const t = cleanInline(cell);
      if (isTitle(t)) return t;
    }
    return '';
  }
  if (/[\p{L}\p{N}]/u.test(raw.slice(0, index).replace(/^\s*(?:>\s*)?(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?/, '').replace(/[*_`[\]()\s]/g, ''))) return '';
  const after = cleanInline(raw.slice(index + id.length))
    .replace(/^[\s*:.)\]—–-]+/, '')
    .replace(/^\([^)]{0,16}\)\s*[:.—–-]?\s*/, '')
    .trim();
  return isTitle(after) ? after.slice(0, 160).trim() : '';
}

/** @param {string} s @returns {boolean} a title has letters and does not start with another requirement id */
function isTitle(s) {
  return /\p{L}.*\p{L}/u.test(s) && !/^,|^FR-\d/.test(s) && !/^(?:P[123]|live|testnet|simulated|planned)$/i.test(s);
}

/**
 * List items directly under each heading that matches `headingRe`, up to the next heading of any level. Only items
 * at the indentation of the section's first item count: nested items are skipped. Sections without a list are left
 * out.
 * @param {string} text
 * @param {RegExp} headingRe
 * @returns {Array<{heading: string, line: number, items: Array<{text: string, line: number}>}>}
 */
export function extractListsUnderHeading(text, headingRe) {
  /** @type {Array<{heading: string, line: number, items: Array<{text: string, line: number}>}>} */
  const sections = [];
  /** @type {{heading: string, line: number, items: Array<{text: string, line: number}>, indent: number} | null} */
  let current = null;
  for (const { text: raw, line, code } of markdownLines(text)) {
    if (code) continue;
    const heading = HEADING.exec(raw);
    if (heading) {
      current = headingRe.test(heading[2]) ? { heading: cleanInline(heading[2]), line, items: [], indent: -1 } : null;
      if (current) sections.push(current);
      continue;
    }
    if (!current) continue;
    const item = LIST_ITEM.exec(raw);
    if (!item) continue;
    const indent = item[1].replace(/\t/g, '    ').length;
    if (current.indent < 0) current.indent = indent;
    if (indent > current.indent) continue;
    const t = cleanInline(item[2]);
    if (t) current.items.push({ text: t, line });
  }
  return sections.filter((s) => s.items.length > 0).map(({ heading, line, items }) => ({ heading, line, items }));
}

/**
 * Headings that match `re`, with their line numbers.
 * @param {string} text
 * @param {RegExp} re
 * @returns {Array<{heading: string, line: number}>}
 */
export function headingsMatching(text, re) {
  const out = [];
  for (const { text: raw, line, code } of markdownLines(text)) {
    if (code) continue;
    const h = HEADING.exec(raw);
    if (h && re.test(h[2])) out.push({ heading: cleanInline(h[2]), line });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Shared readers: claims ledger, never-show list, feature catalogue, sponsor names, brief.json
// ---------------------------------------------------------------------------------------------------------------

/**
 * One ledger status cell in either vocabulary: /hackathon's verified, unverified, cut or Hedera's backed,
 * re-verify, do-not-claim (FD13-F10).
 * @param {string} cell
 * @returns {ClaimStatus}
 */
export function normaliseClaimStatus(cell) {
  const s = cleanInline(cell).toLowerCase();
  if (/^(?:verified|backed)\b/.test(s)) return 'verified';
  if (/^(?:unverified|re-?verify|re verify)\b/.test(s)) return 'unverified';
  if (/^(?:cut|do[- ]not[- ]claim)\b/.test(s)) return 'cut';
  return 'unknown';
}

/**
 * Parses a claims ledger: Markdown tables with an id column (`#`, `id`, `claim id`, `ref`) and a `status` column, or
 * a JSON file holding `[{id, status}]` or `{claims: [...]}`.
 * @param {string} text
 * @param {string} [file] used only to choose JSON by extension
 * @returns {{rows: ClaimRow[], problems: string[]}}
 */
export function parseClaimsLedger(text, file = '') {
  /** @type {ClaimRow[]} */
  const rows = [];
  /** @type {string[]} */
  const problems = [];
  if (/\.json$/i.test(file)) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      return { rows, problems: [`not valid JSON (${err instanceof Error ? err.message : String(err)})`] };
    }
    const list = Array.isArray(data) ? data : isObject(data) && Array.isArray(data.claims) ? data.claims : null;
    if (!list) return { rows, problems: ['a JSON ledger must be [{id, status}] or {claims: [...]}'] };
    list.forEach((item, i) => {
      if (!isObject(item) || (typeof item.id !== 'string' && typeof item.id !== 'number')) {
        problems.push(`claims[${i}] has no id`);
        return;
      }
      const raw = typeof item.status === 'string' ? item.status : '';
      const id = String(item.id).trim();
      const at = text.indexOf(JSON.stringify(item.id));
      rows.push({ id, status: normaliseClaimStatus(raw), raw, line: at >= 0 ? lineOf(text, at) : 1 });
    });
    return { rows, problems };
  }
  const lines = String(text).split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i].trim().startsWith('|') || !isTableSeparator(lines[i])) continue;
    const header = tableCells(lines[i - 1]).map((c) => cleanInline(c));
    const idCol = header.findIndex((c) => ID_HEADER.test(c));
    const statusCol = header.findIndex((c) => STATUS_HEADER.test(c));
    if (idCol < 0 || statusCol < 0) continue;
    for (let j = i + 1; j < lines.length && lines[j].trim().startsWith('|'); j += 1) {
      const cells = tableCells(lines[j]);
      const id = cleanInline(cells[idCol] ?? '');
      if (!id) continue;
      const raw = cleanInline(cells[statusCol] ?? '');
      rows.push({ id, status: normaliseClaimStatus(raw), raw, line: j + 1 });
    }
  }
  return { rows, problems };
}

/**
 * Reads a claims ledger file. A missing or unreadable file is reported in `problems`, never thrown.
 * @param {string} file
 * @returns {ClaimsLedger}
 */
export function loadClaimsLedger(file) {
  const abs = toPosix(path.resolve(file));
  if (!isFile(abs)) return { file: abs, exists: false, rows: [], verifiedIds: [], problems: [`${abs} does not exist`] };
  const { rows, problems } = parseClaimsLedger(readText(abs), abs);
  if (rows.length === 0 && problems.length === 0) {
    problems.push('no claim rows found (a Markdown table with an id column such as "#" and a "status" column)');
  }
  /** @type {string[]} */
  const verifiedIds = [];
  for (const r of rows) if (r.status === 'verified' && !verifiedIds.includes(r.id)) verifiedIds.push(r.id);
  return { file: abs, exists: true, rows, verifiedIds, problems };
}

/**
 * Reads and validates the never-show list (CONTRACTS 6.1b, assets/schemas/never-show.schema.json). Invalid entries
 * are left out of `entries` and described in `problems`; nothing is thrown.
 * @param {string} file
 * @returns {NeverShowList}
 */
export function loadNeverShow(file) {
  const abs = toPosix(path.resolve(file));
  if (!isFile(abs)) return { file: abs, exists: false, entries: [], problems: [`${abs} does not exist`] };
  const text = readText(abs);
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { file: abs, exists: true, entries: [], problems: [`not valid JSON (${err instanceof Error ? err.message : String(err)})`] };
  }
  /** @type {string[]} */
  const problems = [];
  if (!isObject(data) || !Array.isArray(data.entries)) {
    return { file: abs, exists: true, entries: [], problems: ['must be {"version": 1, "entries": [...]}'] };
  }
  if (data.version !== 1) problems.push(`version must be 1 (got ${JSON.stringify(data.version)})`);
  /** @type {NeverShowEntry[]} */
  const entries = [];
  const ids = new Set();
  data.entries.forEach((item, i) => {
    const label = isObject(item) && typeof item.id === 'string' ? item.id : `entries[${i}]`;
    const errs = neverShowEntryProblems(item);
    if (isObject(item) && typeof item.id === 'string') {
      if (ids.has(item.id)) errs.push(`id ${item.id} is used twice`);
      ids.add(item.id);
    }
    if (errs.length > 0 || !isObject(item)) {
      problems.push(`${label}: ${errs.join('; ')}`);
      return;
    }
    const id = String(item.id);
    const at = new RegExp(`"id"\\s*:\\s*${escapeRegExp(JSON.stringify(id))}`).exec(text);
    entries.push({
      id,
      class: /** @type {NeverShowClass} */ (item.class),
      pattern: String(item.pattern),
      regex: item.regex === true,
      case_sensitive: item.case_sensitive === true,
      until_utc: typeof item.until_utc === 'string' ? item.until_utc : null,
      scope: /** @type {'rendered' | 'repo' | 'both'} */ (item.scope),
      note: typeof item.note === 'string' ? item.note : '',
      source: String(item.source),
      line: at ? lineOf(text, at.index) : 1,
    });
  });
  return { file: abs, exists: true, entries, problems };
}

/**
 * @param {unknown} item
 * @returns {string[]}
 */
function neverShowEntryProblems(item) {
  if (!isObject(item)) return ['must be an object'];
  const errs = [];
  if (typeof item.id !== 'string' || !NEVER_SHOW_ID.test(item.id)) errs.push('id must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}');
  if (!NEVER_SHOW_CLASSES.includes(/** @type {never} */ (item.class))) errs.push(`class must be one of ${NEVER_SHOW_CLASSES.join('|')}`);
  if (typeof item.pattern !== 'string' || item.pattern === '') errs.push('pattern must be a non-empty string');
  if (item.regex !== undefined && typeof item.regex !== 'boolean') errs.push('regex must be true or false');
  if (item.case_sensitive !== undefined && typeof item.case_sensitive !== 'boolean') errs.push('case_sensitive must be true or false');
  if (!NEVER_SHOW_SCOPES.includes(/** @type {never} */ (item.scope))) errs.push(`scope must be one of ${NEVER_SHOW_SCOPES.join('|')}`);
  if (typeof item.source !== 'string' || item.source.trim() === '') errs.push('source must name the file the entry comes from');
  if (item.until_utc !== undefined && item.until_utc !== null) {
    if (typeof item.until_utc !== 'string' || !/Z$/.test(item.until_utc) || Number.isNaN(Date.parse(item.until_utc))) {
      errs.push('until_utc must be null or an ISO 8601 UTC date ending in Z');
    }
  } else if (item.class === 'embargo') {
    errs.push('an embargo needs until_utc, its UTC end');
  }
  if (item.regex === true && typeof item.pattern === 'string' && item.pattern !== '') {
    // Q-F9 (CONTRACTS 6.1b): only the regex subset JavaScript and Python read the same way; /execution refuses the rest too.
    const subset = neverShowRegexProblem(item.pattern);
    if (subset) errs.push(`pattern is outside the regex subset JavaScript and Python share: ${subset}`);
    try {
      new RegExp(item.pattern, item.case_sensitive === true ? '' : 'i');
    } catch (err) {
      errs.push(`pattern does not compile as a regular expression (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  return errs;
}

/**
 * True while an entry applies: no end date, or an end date still in the future.
 * @param {{until_utc: string | null}} entry
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isActive(entry, now = new Date()) {
  if (!entry.until_utc) return true;
  return Date.parse(entry.until_utc) > now.getTime();
}

/**
 * Reads the feature catalogue (CONTRACTS 6.1b): `[{id, group, title, priority, status_expected?}]`. Rows with a
 * valid id and title are kept; every other problem is reported, never thrown.
 * @param {string} file
 * @returns {Catalogue}
 */
export function loadCatalogue(file) {
  const abs = toPosix(path.resolve(file));
  if (!isFile(abs)) return { file: abs, exists: false, features: [], problems: [`${abs} does not exist`] };
  const text = readText(abs);
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { file: abs, exists: true, features: [], problems: [`not valid JSON (${err instanceof Error ? err.message : String(err)})`] };
  }
  const list = Array.isArray(data) ? data : isObject(data) && Array.isArray(data.features) ? data.features : null;
  if (!list) return { file: abs, exists: true, features: [], problems: ['must be an array of {id, group, title, priority}'] };
  /** @type {string[]} */
  const problems = [];
  /** @type {CatalogueFeature[]} */
  const features = [];
  const seen = new Set();
  list.forEach((item, i) => {
    if (!isObject(item) || typeof item.id !== 'string' || !/^FR-\d{3,}$/.test(item.id)) {
      problems.push(`[${i}] needs an id like FR-003`);
      return;
    }
    if (seen.has(item.id)) {
      problems.push(`${item.id} is listed twice`);
      return;
    }
    seen.add(item.id);
    if (typeof item.title !== 'string' || item.title.trim() === '') {
      problems.push(`${item.id} has no title`);
      return;
    }
    if (typeof item.group !== 'string' || !/^G\d+$/.test(item.group)) problems.push(`${item.id}: group must look like G1`);
    if (!['P1', 'P2', 'P3'].includes(String(item.priority))) problems.push(`${item.id}: priority must be P1, P2 or P3`);
    const status = typeof item.status_expected === 'string' && FEATURE_STATUSES.includes(/** @type {never} */ (item.status_expected))
      ? /** @type {FeatureStatus} */ (item.status_expected)
      : null;
    if (item.status_expected !== undefined && status === null) {
      problems.push(`${item.id}: status_expected must be one of ${FEATURE_STATUSES.join('|')}`);
    }
    const at = new RegExp(`"id"\\s*:\\s*"${escapeRegExp(item.id)}"`).exec(text);
    features.push({
      id: item.id,
      group: typeof item.group === 'string' ? item.group : '',
      title: item.title.trim(),
      priority: typeof item.priority === 'string' ? item.priority : '',
      status_expected: status,
      line: at ? lineOf(text, at.index) : 1,
    });
  });
  return { file: abs, exists: true, features, problems };
}

/** @type {Map<string, {id: string, name: string}> | null} */
let allowlistCache = null;

/**
 * Sponsor ids of assets/sponsor-allowlist.json with their plain names (the display name before any parenthesis).
 * @returns {Map<string, {id: string, name: string}>}
 */
export function sponsorAllowlist() {
  if (allowlistCache) return allowlistCache;
  /** @type {Map<string, {id: string, name: string}>} */
  const map = new Map();
  if (isFile(SPONSOR_ALLOWLIST)) {
    try {
      const data = JSON.parse(readText(SPONSOR_ALLOWLIST));
      const list = isObject(data) && Array.isArray(data.sponsor_allowlist) ? data.sponsor_allowlist : [];
      for (const entry of list) {
        if (!isObject(entry) || typeof entry.sponsor !== 'string') continue;
        const display = typeof entry.display_name === 'string' ? entry.display_name : entry.sponsor;
        const name = display.split(' (')[0].trim() || entry.sponsor;
        map.set(entry.sponsor.toLowerCase(), { id: entry.sponsor.toLowerCase(), name });
      }
    } catch (err) {
      throw new EnvError(`${SPONSOR_ALLOWLIST} is not valid JSON (${err instanceof Error ? err.message : String(err)}); reinstall the skill`, { cause: err });
    }
  }
  allowlistCache = map;
  return map;
}

/**
 * The sponsor names a page should show: the brief's sponsors when it has any, otherwise the profile's sponsor ids
 * named from the allowlist (an id not listed there stands for itself).
 * @param {{brief?: Brief | null, profile?: Pick<Profile, 'sponsors'> | null}} where
 * @returns {Array<{id: string, name: string, from: 'brief' | 'profile'}>}
 */
export function sponsorNames({ brief, profile }) {
  const fromBrief = (brief?.sponsors ?? []).filter((s) => s && typeof s.name === 'string' && s.name.trim() !== '');
  if (fromBrief.length > 0) return fromBrief.map((s) => ({ id: s.id, name: s.name.trim(), from: /** @type {const} */ ('brief') }));
  const allow = sponsorAllowlist();
  return (profile?.sponsors ?? []).map((id) => ({ id, name: allow.get(id)?.name ?? id, from: /** @type {const} */ ('profile') }));
}

/**
 * Reads `<state>/brief.json`. Never throws: a missing or broken file is reported in `error`.
 * @param {string | null | undefined} state
 * @returns {{file: string, brief: Brief | null, raw: unknown, error: string | null}}
 */
export function readBrief(state) {
  if (!state) return { file: '', brief: null, raw: null, error: 'no state directory' };
  const file = toPosix(path.join(state, 'brief.json'));
  if (!isFile(file)) return { file, brief: null, raw: null, error: `${file} does not exist` };
  try {
    const raw = JSON.parse(readText(file));
    return { file, brief: coerceBrief(raw), raw, error: null };
  } catch (err) {
    return { file, brief: null, raw: null, error: `${file} is not valid JSON (${err instanceof Error ? err.message : String(err)})` };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The brief object
// ---------------------------------------------------------------------------------------------------------------

/** @returns {Brief} */
export function emptyBrief() {
  return {
    project: { name: '', name_status: 'pending', source: '' },
    sentences: { broken: '', did: '', source: '' },
    hero: { h1: '', sentence: '', source: '' },
    gap: { text: '', who_loses: '', how_much: '', source: '' },
    sponsors: [],
    customers: [],
    use_case: { text: '', source: '' },
    features: [],
    claims: { path: '', ids: [] },
    never_show: [],
    judge_path: { beats: [], source: '' },
    missing: [],
  };
}

/**
 * The well-formed parts of a parsed brief.json, in the CONTRACTS 6.4 shape; anything malformed falls back to its
 * empty value. Used to merge with a fresh compile and to read the hero and the sponsors.
 * @param {unknown} raw
 * @returns {Brief}
 */
export function coerceBrief(raw) {
  const b = emptyBrief();
  if (!isObject(raw)) return b;
  const str = (/** @type {unknown} */ v) => (typeof v === 'string' ? v : '');
  const obj = (/** @type {unknown} */ v) => (isObject(v) ? v : {});
  const project = obj(raw.project);
  b.project = {
    name: str(project.name),
    name_status: ['final', 'working', 'pending'].includes(String(project.name_status)) ? /** @type {Brief['project']['name_status']} */ (project.name_status) : 'pending',
    source: str(project.source),
  };
  const sentences = obj(raw.sentences);
  b.sentences = { broken: str(sentences.broken), did: str(sentences.did), source: str(sentences.source) };
  const hero = obj(raw.hero);
  b.hero = { h1: str(hero.h1), sentence: str(hero.sentence), source: str(hero.source) };
  const gap = obj(raw.gap);
  b.gap = { text: str(gap.text), who_loses: str(gap.who_loses), how_much: str(gap.how_much), source: str(gap.source) };
  const useCase = obj(raw.use_case);
  b.use_case = { text: str(useCase.text), source: str(useCase.source) };
  const claims = obj(raw.claims);
  b.claims = { path: str(claims.path), ids: Array.isArray(claims.ids) ? claims.ids.filter((x) => typeof x === 'string') : [] };
  const judge = obj(raw.judge_path);
  b.judge_path = { beats: Array.isArray(judge.beats) ? judge.beats.filter((x) => typeof x === 'string') : [], source: str(judge.source) };
  b.sponsors = (Array.isArray(raw.sponsors) ? raw.sponsors : []).filter(isObject).map((s) => ({
    id: str(s.id), name: str(s.name), strategy: str(s.strategy), source: str(s.source),
  })).filter((s) => s.id !== '');
  b.customers = (Array.isArray(raw.customers) ? raw.customers : []).filter(isObject).map((c) => ({
    name: str(c.name), category: str(c.category), url: str(c.url), url_source: str(c.url_source), owner_confirmed: c.owner_confirmed === true,
  })).filter((c) => c.name !== '');
  b.features = (Array.isArray(raw.features) ? raw.features : []).filter(isObject).map((f) => ({
    id: str(f.id),
    group: str(f.group),
    title: str(f.title),
    status: FEATURE_STATUSES.includes(/** @type {never} */ (f.status)) ? /** @type {FeatureStatus} */ (f.status) : 'planned',
    route: typeof f.route === 'string' ? f.route : null,
    proof: typeof f.proof === 'string' ? f.proof : null,
    source: str(f.source),
  })).filter((f) => f.id !== '');
  b.never_show = (Array.isArray(raw.never_show) ? raw.never_show : []).filter(isObject).map((n) => ({
    class: /** @type {NeverShowClass} */ (NEVER_SHOW_CLASSES.includes(/** @type {never} */ (n.class)) ? n.class : 'never-public'),
    pattern: str(n.pattern),
    regex: n.regex === true,
    until_utc: typeof n.until_utc === 'string' ? n.until_utc : null,
    source: str(n.source),
  })).filter((n) => n.pattern !== '');
  b.missing = (Array.isArray(raw.missing) ? raw.missing : []).filter(isObject).map((m) => ({
    field: str(m.field),
    action: /** @type {MissingAction} */ (m.action === 'question' ? 'question' : 'manual-task'),
    why: str(m.why),
  })).filter((m) => m.field !== '');
  return b;
}

/**
 * Every shape problem of a parsed brief.json against CONTRACTS 6.4 (types, enumerations, required keys, no extra
 * keys), as dotted-path messages.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function briefShapeProblems(raw) {
  /** @type {string[]} */
  const p = [];
  if (!isObject(raw)) return ['brief.json must be a JSON object'];
  /**
   * @param {unknown} value @param {string} where @param {Record<string, (v: unknown) => string | null>} keys
   */
  const object = (value, where, keys) => {
    if (!isObject(value)) {
      p.push(`${where} must be an object`);
      return;
    }
    for (const k of Object.keys(value)) if (!Object.hasOwn(keys, k)) p.push(`${where}.${k} is not a field of the brief`);
    for (const [k, check] of Object.entries(keys)) {
      if (!Object.hasOwn(value, k)) {
        p.push(`${where}.${k} is missing`);
        continue;
      }
      const err = check(value[k]);
      if (err) p.push(`${where}.${k} ${err}`);
    }
  };
  const string = (/** @type {unknown} */ v) => (typeof v === 'string' ? null : 'must be a string');
  const bool = (/** @type {unknown} */ v) => (typeof v === 'boolean' ? null : 'must be true or false');
  /** @param {readonly string[]} values */
  const oneOf = (values) => (/** @type {unknown} */ v) => (values.includes(/** @type {string} */ (v)) ? null : `must be one of ${values.join('|')}`);
  const nullableString = (/** @type {unknown} */ v) => (v === null || typeof v === 'string' ? null : 'must be a string or null');
  const stringArray = (/** @type {unknown} */ v) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? null : 'must be an array of strings');
  /**
   * @param {unknown} value @param {string} where @param {Record<string, (v: unknown) => string | null>} keys
   */
  const array = (value, where, keys) => {
    if (!Array.isArray(value)) {
      p.push(`${where} must be an array`);
      return;
    }
    value.forEach((item, i) => object(item, `${where}[${i}]`, keys));
  };
  const top = ['project', 'sentences', 'hero', 'gap', 'sponsors', 'customers', 'use_case', 'features', 'claims', 'never_show', 'judge_path', 'missing'];
  for (const k of Object.keys(raw)) if (!top.includes(k)) p.push(`${k} is not a field of the brief`);
  for (const k of top) if (!Object.hasOwn(raw, k)) p.push(`${k} is missing`);
  if (Object.hasOwn(raw, 'project')) object(raw.project, 'project', { name: string, name_status: oneOf(['final', 'working', 'pending']), source: string });
  if (Object.hasOwn(raw, 'sentences')) object(raw.sentences, 'sentences', { broken: string, did: string, source: string });
  if (Object.hasOwn(raw, 'hero')) object(raw.hero, 'hero', { h1: string, sentence: string, source: string });
  if (Object.hasOwn(raw, 'gap')) object(raw.gap, 'gap', { text: string, who_loses: string, how_much: string, source: string });
  if (Object.hasOwn(raw, 'use_case')) object(raw.use_case, 'use_case', { text: string, source: string });
  if (Object.hasOwn(raw, 'claims')) object(raw.claims, 'claims', { path: string, ids: stringArray });
  if (Object.hasOwn(raw, 'judge_path')) object(raw.judge_path, 'judge_path', { beats: stringArray, source: string });
  if (Object.hasOwn(raw, 'sponsors')) {
    array(raw.sponsors, 'sponsors', {
      id: (v) => (typeof v === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(v) ? null : 'must be a lowercase sponsor id'),
      name: (v) => (typeof v === 'string' && v.trim() !== '' ? null : 'must be a non-empty string'),
      strategy: string,
      source: string,
    });
  }
  if (Object.hasOwn(raw, 'customers')) {
    array(raw.customers, 'customers', {
      name: (v) => (typeof v === 'string' && v.trim() !== '' ? null : 'must be a non-empty string'),
      category: string,
      url: (v) => (v === '' || (typeof v === 'string' && /^https?:\/\/\S+$/.test(v)) ? null : 'must be empty or an http(s) URL'),
      url_source: string,
      owner_confirmed: bool,
    });
  }
  if (Object.hasOwn(raw, 'features')) {
    array(raw.features, 'features', {
      id: (v) => (typeof v === 'string' && /^FR-\d{3,}$/.test(v) ? null : 'must look like FR-003'),
      group: string,
      title: (v) => (typeof v === 'string' && v.trim() !== '' ? null : 'must be a non-empty string'),
      status: oneOf(FEATURE_STATUSES),
      route: (v) => (v === null || (typeof v === 'string' && v.startsWith('/')) ? null : 'must be null or a path starting with "/"'),
      proof: nullableString,
      source: string,
    });
  }
  if (Object.hasOwn(raw, 'never_show')) {
    array(raw.never_show, 'never_show', {
      class: oneOf(NEVER_SHOW_CLASSES),
      pattern: (v) => (typeof v === 'string' && v !== '' ? null : 'must be a non-empty string'),
      regex: bool,
      until_utc: (v) => (v === null || (typeof v === 'string' && /Z$/.test(v) && !Number.isNaN(Date.parse(v))) ? null : 'must be null or a UTC date ending in Z'),
      source: string,
    });
  }
  if (Object.hasOwn(raw, 'missing')) {
    array(raw.missing, 'missing', {
      field: (v) => (typeof v === 'string' && v.trim() !== '' ? null : 'must name the missing field'),
      action: oneOf(['manual-task', 'question']),
      why: (v) => (typeof v === 'string' && v.trim() !== '' ? null : 'must say why the field is missing and how it gets filled'),
    });
  }
  return p;
}

/**
 * @param {Brief} brief
 * @param {string} field a REQUIRED_FIELDS entry
 * @returns {boolean}
 */
function hasValue(brief, field) {
  switch (field) {
    case 'sponsors':
    case 'customers':
    case 'features':
    case 'never_show':
      return brief[field].length > 0;
    case 'judge_path.beats':
      return brief.judge_path.beats.length > 0;
    default: {
      const [group, key] = field.split('.');
      const value = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (brief[/** @type {keyof Brief} */ (group)]))?.[key];
      return typeof value === 'string' && value.trim() !== '';
    }
  }
}

/**
 * True when `field` is covered by a missing entry for itself or for one of its parents (`hero` covers `hero.h1`,
 * `sponsors` covers `sponsors[cardano].strategy`), or by the list form (`sponsors[].strategy`).
 * @param {readonly MissingEntry[]} missing
 * @param {string} field
 * @returns {boolean}
 */
export function isListed(missing, field) {
  const generic = field.replace(/\[[^\]]*\]/g, '[]');
  return missing.some((m) => {
    const f = m.field.trim();
    if (!f) return false;
    if (f === field || f === generic) return true;
    return field.startsWith(`${f}.`) || field.startsWith(`${f}[`) || generic.startsWith(`${f}.`) || generic.startsWith(`${f}[`);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Workspace and discovery
// ---------------------------------------------------------------------------------------------------------------

/**
 * The workspace root the globs run from, and the research folder. In order: `--workspace`; the parent of the
 * profile's paths.research; the profile's workspace.private_dir; the repository root when it holds research/ or
 * docs/; its parent when that holds research/ (BNB keeps its code in holdover/ next to research/, FD13-F05); else
 * the repository root.
 * @param {{root: string, profile: Pick<Profile, 'paths' | 'workspace'>, workspace?: string | null}} options
 * @returns {{workspace: string, how: string, researchDir: string}}
 */
export function resolveWorkspace({ root, profile, workspace }) {
  const research = profile.paths?.research ? path.resolve(profile.paths.research) : null;
  /** @param {string} w @param {string} how */
  const result = (w, how) => ({ workspace: toPosix(w), how, researchDir: toPosix(research ?? path.join(w, 'research')) });
  if (workspace) {
    const w = path.resolve(workspace);
    if (!isDirectory(w)) throw new UsageError(`--workspace ${toPosix(w)} is not an existing folder; pass the folder that holds research/ or docs/`);
    return result(w, '--workspace');
  }
  if (research) return result(path.dirname(research), 'parent of profile paths.research');
  if (profile.workspace?.private_dir) return result(path.resolve(profile.workspace.private_dir), 'profile workspace.private_dir');
  const base = path.resolve(root);
  if (isDirectory(path.join(base, 'research')) || isDirectory(path.join(base, 'docs'))) return result(base, 'repository root (holds research/ or docs/)');
  const parent = path.dirname(base);
  if (parent !== base && isDirectory(path.join(parent, 'research'))) return result(parent, 'parent of the repository root (holds research/)');
  return result(base, 'repository root (no research/ or docs/ found: pass --workspace)');
}

/**
 * Lists the workspace once as logical paths (relative to the workspace, with research/ mapped to the research
 * folder when the profile puts it elsewhere).
 * @param {string} workspace
 * @param {string} researchDir
 * @returns {Map<string, string>} logical path -> absolute POSIX path
 */
export function listWorkspace(workspace, researchDir) {
  if (!isDirectory(workspace)) throw new UsageError(`workspace ${workspace} is not an existing folder; pass --workspace <folder holding research/ or docs/>`);
  /** @type {Map<string, string>} */
  const files = new Map();
  const research = path.resolve(researchDir);
  const defaultResearch = path.resolve(workspace, 'research');
  const relocated = research.toLowerCase() !== defaultResearch.toLowerCase();
  let listed;
  try {
    listed = walk(workspace);
  } catch (err) {
    if (err instanceof UsageError) throw err;
    throw new EnvError(`cannot list the workspace ${workspace}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  for (const rel of listed) {
    if (relocated && (rel === 'research' || rel.startsWith('research/'))) continue;
    files.set(rel, toPosix(path.join(workspace, rel)));
  }
  if (relocated && isDirectory(research)) {
    for (const rel of walk(research)) files.set(`research/${rel}`, toPosix(path.join(research, rel)));
  }
  return files;
}

/**
 * Matches one input's globs: case-sensitive, then case-insensitive, then research/ re-rooted at docs/ (BF-02).
 * @param {DiscoveryInput} input
 * @param {Map<string, string>} files
 * @param {string} workspace
 * @returns {InputMatch}
 */
export function matchInput(input, files, workspace) {
  const docsGlobs = input.globs.filter((g) => g.startsWith('research/')).map((g) => `docs/${g.slice('research/'.length)}`);
  const attempts = [
    { matcher: 'exact', globs: input.globs, nocase: false },
    { matcher: 'case-insensitive', globs: input.globs, nocase: true },
    { matcher: 'docs/ instead of research/', globs: docsGlobs, nocase: false },
    { matcher: 'docs/ instead of research/, case-insensitive', globs: docsGlobs, nocase: true },
  ];
  const logical = [...files.keys()];
  for (const attempt of attempts) {
    if (attempt.globs.length === 0) continue;
    /** @type {FoundFile[]} */
    const found = [];
    const seen = new Set();
    for (const glob of attempt.globs) {
      const match = compileGlob(glob, { nocase: attempt.nocase });
      for (const rel of logical) {
        if (seen.has(rel) || !match(rel)) continue;
        seen.add(rel);
        const abs = /** @type {string} */ (files.get(rel));
        found.push({ logical: rel, abs, shown: shownPath(abs, workspace) });
      }
    }
    if (found.length > 0) return { key: input.key, label: input.label, globs: input.globs, matcher: attempt.matcher, files: found };
  }
  return { key: input.key, label: input.label, globs: input.globs, matcher: null, files: [] };
}

/**
 * A path as the brief records it: relative to the workspace when inside it, absolute otherwise; forward slashes.
 * @param {string} abs
 * @param {string} workspace
 * @returns {string}
 */
export function shownPath(abs, workspace) {
  const rel = path.relative(workspace, abs);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return toPosix(rel);
  return toPosix(path.resolve(abs));
}

// ---------------------------------------------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{
 *   brief: Brief,
 *   fieldSources: Map<string, string>,
 *   notes: Map<string, string>,
 *   defaulted: Set<string>,
 *   authoritative: {features: boolean, never_show: boolean},
 *   extraMissing: MissingEntry[]
 * }} Fresh
 */

/**
 * Builds a brief from the workspace and the profile (no file is written), merges it with `existing` and computes the
 * missing list.
 * @param {{root: string, profile: Profile, workspace?: string | null, existing?: Brief | null, now?: Date}} options
 * @returns {{brief: Brief, receipt: DiscoveryReceipt, warnings: string[]}}
 */
export function compileBrief({ root, profile, workspace, existing = null, now = new Date() }) {
  const where = resolveWorkspace({ root, profile, workspace });
  const files = listWorkspace(where.workspace, where.researchDir);
  /** @type {Record<string, InputMatch>} */
  const inputs = {};
  for (const input of DISCOVERY) inputs[input.key] = matchInput(input, files, where.workspace);
  const action = profile.run_mode === 'A' ? 'manual-task' : 'question';
  /** @type {string[]} */
  const warnings = [];
  const fresh = extractFresh({ root, profile, inputs, workspace: where.workspace, warnings });
  const merged = mergeBriefs(fresh, existing, warnings);
  merged.missing = computeMissing(merged, fresh, existing, { action, neverShowFile: neverShowFileStatus(profile) });
  /** @type {DiscoveryReceipt} */
  const receipt = {
    version: 1,
    tool: 'brief',
    at: utcSeconds(now),
    workspace: where.workspace,
    workspace_how: where.how,
    research_dir: where.researchDir,
    profile: profile.source.path,
    run_mode: profile.run_mode,
    matcher: MATCHER_NOTE,
    files_scanned: files.size,
    inputs: Object.values(inputs).map((m) => ({
      key: m.key,
      label: m.label,
      globs: m.globs,
      matcher: m.matcher,
      count: m.files.length,
      matches: m.files.slice(0, MAX_RECEIPT_MATCHES).map((f) => f.shown),
    })),
    notes: warnings,
  };
  return { brief: merged, receipt, warnings };
}

/**
 * @param {Pick<Profile, 'paths'>} profile
 * @returns {{path: string | null, exists: boolean}}
 */
function neverShowFileStatus(profile) {
  const file = profile.paths?.never_show ?? null;
  return { path: file, exists: Boolean(file && isFile(file)) };
}

/**
 * @param {string} file
 * @returns {string | null}
 */
function readCandidate(file) {
  try {
    if (statSync(file).size > MAX_READ_BYTES) return null;
    return readText(file);
  } catch {
    return null;
  }
}

/**
 * Collects labelled values for one field across files, in order. One distinct value (after normalisation) is a
 * found value; several are a conflict that the owner settles in the source files.
 * @param {string} field
 * @param {FoundFile[]} candidates
 * @param {Map<string, string | null>} cache
 * @returns {{value: string, source: string} | {conflict: Array<{value: string, source: string}>} | null}
 */
function findLabelled(field, candidates, cache) {
  const labels = LABELS[/** @type {keyof typeof LABELS} */ (field)];
  /** @type {Array<{value: string, source: string}>} */
  const hits = [];
  for (const file of candidates) {
    if (!cache.has(file.abs)) cache.set(file.abs, readCandidate(file.abs));
    const text = cache.get(file.abs);
    if (!text) continue;
    for (const hit of extractLabelled(text, labels)) hits.push({ value: hit.value, source: `${file.shown}:${hit.line}` });
  }
  if (hits.length === 0) return null;
  const distinct = [];
  const seen = new Set();
  for (const h of hits) {
    const key = normaliseText(h.value);
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(h);
  }
  if (distinct.length === 1) return distinct[0];
  return { conflict: distinct };
}

/**
 * @param {FoundFile[]} files
 * @returns {string}
 */
function listShown(files) {
  if (files.length === 0) return 'none';
  const shown = files.slice(0, 6).map((f) => f.shown);
  return files.length > 6 ? `${shown.join(', ')} and ${files.length - 6} more` : shown.join(', ');
}

/**
 * @param {readonly string[]} globs
 * @returns {string}
 */
function listGlobs(globs) {
  return globs.join(', ');
}

/**
 * @param {{root: string, profile: Profile, inputs: Record<string, InputMatch>, workspace: string, warnings: string[]}} args
 * @returns {Fresh}
 */
function extractFresh({ root, profile, inputs, workspace, warnings }) {
  const brief = emptyBrief();
  /** @type {Map<string, string>} */
  const fieldSources = new Map();
  /** @type {Map<string, string>} */
  const notes = new Map();
  /** @type {Set<string>} */
  const defaulted = new Set();
  /** @type {MissingEntry[]} */
  const extraMissing = [];
  /** @type {Map<string, string | null>} */
  const cache = new Map();
  const profileSrc = profile.source.path ? shownPath(profile.source.path, workspace) : null;
  const authoritative = { features: false, never_show: false };

  /** @param {string} file @returns {FoundFile} */
  const asFound = (file) => {
    const abs = toPosix(path.resolve(file));
    return { logical: abs, abs, shown: shownPath(abs, workspace) };
  };
  const specFiles = [...(profile.paths.spec && isFile(profile.paths.spec) ? [asFound(profile.paths.spec)] : []), ...inputs.spec.files.filter((f) => f.abs !== (profile.paths.spec ? toPosix(path.resolve(profile.paths.spec)) : ''))];
  if (profile.paths.spec && !isFile(profile.paths.spec)) warnings.push(`profile paths.spec ${profile.paths.spec} does not exist`);

  /**
   * @param {string} field
   * @param {FoundFile[]} candidates
   * @param {string} ifNone why text when no file matched
   * @param {string} ifUnlabelled why text when files exist but none states the field
   */
  const labelled = (field, candidates, ifNone, ifUnlabelled) => {
    const found = findLabelled(field, candidates, cache);
    if (found && 'value' in found) {
      const [group, key] = field.split('.');
      /** @type {Record<string, string>} */ (/** @type {unknown} */ (brief[/** @type {keyof Brief} */ (group)]))[key] = found.value;
      fieldSources.set(field, found.source);
      return;
    }
    if (found && 'conflict' in found) {
      const list = found.conflict.slice(0, 3).map((c) => `${c.source} says "${c.value.slice(0, 80)}"`).join('; ');
      notes.set(field, `Sources disagree (${list}); keep one source file with one value, then run brief.mjs again (BF-05: the source file is the single editable copy).`);
      return;
    }
    notes.set(field, candidates.length === 0 ? ifNone : ifUnlabelled.replace('{files}', listShown(candidates)));
  };

  // project
  if (profile.project?.name) {
    brief.project.name = profile.project.name;
    brief.project.name_status = profile.project.name_owner_confirmed === true ? 'final' : 'working';
    fieldSources.set('project.name', `${profileSrc ?? 'profile.json'}#project.name`);
  } else {
    labelled(
      'project.name',
      inputs.naming.files,
      `No project.name in the profile and no naming verdict (${listGlobs(inputs.naming.globs)}); the logo task waits for the name (BF-12).`,
      'The naming verdict ({files}) has no labelled "Name:" line; record the chosen name with its line, or ask the owner (BF-12).',
    );
    if (brief.project.name) brief.project.name_status = 'working';
  }
  if (brief.project.name && brief.project.name_status === 'working') {
    extraMissing.push({ field: 'project.name_status', action: 'manual-task', why: `Confirm whether "${brief.project.name}" is final; the mark (FE-05) waits until it is (BF-12).` });
  }

  // the two sentences, the hero, the gap
  const noSpec = `No spec or recommendation matched ${listGlobs(inputs.spec.globs)} (case-insensitive retry and docs/ included) and the profile has no paths.spec.`;
  labelled('sentences.broken', specFiles, `${noSpec} Ask the owner for the thing that is broken; no hero copy is written without the two sentences (BF-03).`,
    'No labelled "Broken:" line in {files}. Record the thing that is broken verbatim with file:line, or have the owner write it into the source file (BF-05).');
  labelled('sentences.did', specFiles, `${noSpec} Ask the owner what was done about it (BF-03).`,
    'No labelled "Did:" line in {files}. Record what was done about it verbatim with file:line, or have the owner write it into the source file (BF-05).');
  labelled('hero.h1', specFiles, `${noSpec} The owner writes the headline (about 2 to 6 words) into the two-sentences source file (BF-05).`,
    'No labelled "H1:" line in {files}. The owner writes the headline (about 2 to 6 words) into the two-sentences source file; brief.mjs reads it on the next run (BF-05).');
  labelled('hero.sentence', specFiles, `${noSpec} The hero sentence comes from the two-sentences source file, unchanged (BF-05).`,
    'No labelled "Hero sentence:" line in {files}. Take it unchanged from the two-sentences source file, with file:line, or have the owner label it there (BF-05).');
  labelled('gap.text', specFiles, `${noSpec} Read the gap from the spec's problem section or ask the owner.`,
    'No labelled "Gap:" line in {files}. Record the gap verbatim from the problem section, with file:line.');
  labelled('gap.who_loses', specFiles, `${noSpec} Ask who loses money.`,
    'No labelled "Who loses:" line in {files}. Record who loses, verbatim with file:line.');
  labelled('gap.how_much', specFiles, `${noSpec} Ask how much is lost.`,
    'No labelled "How much:" line in {files}. Record how much is lost, verbatim with file:line, or leave the amount to the claims ledger.');
  labelled('use_case.text', [...inputs.sponsors.files, ...specFiles],
    `No customer or spec file matched (${listGlobs(inputs.sponsors.globs)}); ask for a named institution, a thing and an amount.`,
    'No labelled "Use case:" line in {files}. Record the use case (a named institution, a thing, an amount) verbatim with file:line, or ask.');

  // sponsors
  const allow = sponsorAllowlist();
  for (const id of profile.sponsors) {
    const known = allow.get(id);
    brief.sponsors.push({
      id,
      name: known ? known.name : id,
      strategy: '',
      source: joinSources([`${profileSrc ?? 'profile.json'}#sponsors`, known ? `${shownPath(SPONSOR_ALLOWLIST, workspace)}#${id}` : null]),
    });
    if (!known) {
      extraMissing.push({ field: `sponsors[${id}].name`, action: 'manual-task', why: `"${id}" is not in assets/sponsor-allowlist.json; write the sponsor's official name with its source.` });
    }
  }
  const strategyFiles = listShown(inputs.sponsors.files);
  notes.set('sponsors', inputs.sponsors.files.length > 0
    ? `The profile names no sponsor; the sponsor files (${strategyFiles}) say which sponsors and tracks apply. Record each sponsor id from assets/sponsor-allowlist.json with its source.`
    : `The profile names no sponsor and no sponsor file matched ${listGlobs(inputs.sponsors.globs)}; ask which sponsors and tracks apply.`);
  notes.set('sponsors[].strategy', inputs.sponsors.files.length > 0
    ? `Read each sponsor's strategy from ${strategyFiles} and record it with file:line.`
    : `No sponsor strategy file matched ${listGlobs(inputs.sponsors.globs)}; ask for the sponsor's strategy.`);

  // customers
  profile.references.forEach((ref, i) => {
    if (!ref.customer) return;
    const where = ref.source ? ref.source : `${profileSrc ?? 'profile.json'}#references[${i}]`;
    brief.customers.push({ name: ref.customer, category: '', url: /^https?:\/\//.test(ref.url) ? ref.url : '', url_source: ref.url ? where : '', owner_confirmed: ref.owner_confirmed });
    if (ref.url && !ref.source) {
      extraMissing.push({ field: `customers[${ref.customer}].url_source`, action: 'manual-task', why: 'The profile gives this URL without a source; record how it was verified (sponsor page, DefiLlama url field, GitHub org) and whether it is a marketing site or an app route (BF-04).' });
    }
  });
  notes.set('customers', inputs.sponsors.files.length > 0
    ? `No customer references in the profile; propose 3 to 5 customers from ${strategyFiles} with their sources, then confirm their URLs with the owner (BF-04).`
    : 'No customer references in the profile and no customer file found; propose 3 to 5 customers from the sponsor\'s case-study or ecosystem pages, with sources, and ask (BF-04).');
  notes.set('customers[].category', 'Record the category the jury will file this customer under (DeFi protocol, trading terminal, savings app, institutional desk), from the customer file with file:line.');

  // features
  const catalogueFile = profile.paths.feature_catalogue;
  let routes = null;
  try {
    routes = loadRoutes(root, profile);
  } catch (err) {
    warnings.push(`routes.json not read (${err instanceof Error ? err.message : String(err)}); feature routes left empty`);
  }
  /** @param {string} id @returns {string | null} */
  const routeOf = (id) => routes?.find((r) => r.features.includes(id))?.path ?? null;
  if (catalogueFile && isFile(catalogueFile)) {
    const catalogue = loadCatalogue(catalogueFile);
    for (const problem of catalogue.problems) warnings.push(`feature catalogue ${shownPath(catalogue.file, workspace)}: ${problem}`);
    if (catalogue.features.length > 0) authoritative.features = true;
    for (const f of catalogue.features) {
      brief.features.push({
        id: f.id,
        group: f.group,
        title: f.title,
        status: f.status_expected ?? 'planned',
        route: routeOf(f.id),
        proof: null,
        source: `${shownPath(catalogue.file, workspace)}:${f.line}`,
      });
      if (!f.status_expected) defaulted.add(`features[${f.id}].status`);
    }
    if (catalogue.features.length === 0) notes.set('features', `The feature catalogue ${shownPath(catalogue.file, workspace)} holds no valid row (${catalogue.problems.slice(0, 2).join('; ') || 'empty'}).`);
  } else {
    if (catalogueFile) warnings.push(`profile paths.feature_catalogue ${catalogueFile} does not exist`);
    const markdown = [...inputs.catalogue.files, ...specFiles];
    for (const file of markdown) {
      if (!cache.has(file.abs)) cache.set(file.abs, readCandidate(file.abs));
      const text = cache.get(file.abs);
      if (!text) continue;
      for (const f of extractFeatureIds(text)) {
        if (brief.features.some((x) => x.id === f.id)) continue;
        brief.features.push({ id: f.id, group: f.group, title: f.title || f.id, status: 'planned', route: routeOf(f.id), proof: null, source: `${file.shown}:${f.line}` });
        defaulted.add(`features[${f.id}].status`);
        if (!f.title) extraMissing.push({ field: `features[${f.id}].title`, action: 'manual-task', why: `${f.id} appears in ${file.shown}:${f.line} without a title; record its title from the spec.` });
      }
    }
    if (brief.features.length > 0) {
      extraMissing.push({ field: 'features', action: 'manual-task', why: `Enumerated from requirement ids in ${listShown(markdown)}; confirm groups, statuses and which rows must be judge-visible, or set paths.feature_catalogue (BF-07).` });
    }
    notes.set('features', `No feature catalogue (paths.feature_catalogue or ${listGlobs(inputs.catalogue.globs)}) and no FR-nnn ids in ${listShown(markdown)}; enumerate the features from the spec and the code into {id, group, title, priority, status_expected}, then ask which rows must be judge-visible (BF-07).`);
  }

  // claims ledger
  const ledgerFromProfile = profile.paths.claims_ledger;
  if (ledgerFromProfile && !isFile(ledgerFromProfile)) {
    notes.set('claims.path', `The profile names the claims ledger ${ledgerFromProfile}, which does not exist; create it from /hackathon's assets/claims.md (BF-08).`);
  } else {
    let ledgerPath = ledgerFromProfile ?? null;
    if (!ledgerPath) {
      const files = inputs.claims.files;
      const preferred = files.filter((f) => /^claims(?:-ledger)?\.md$/i.test(path.basename(f.abs)));
      const pick = preferred.length === 1 ? preferred : files;
      if (pick.length === 1) ledgerPath = pick[0].abs;
      else if (pick.length > 1) notes.set('claims.path', `Several ledgers match (${listShown(pick)}); keep one and set phase_b.claims_ledger in the profile (BF-08).`);
      else notes.set('claims.path', `No claims ledger (phase_b.claims_ledger or ${listGlobs(inputs.claims.globs)}); render no number that cannot be traced to an artifact file and open one from /hackathon's assets/claims.md (BF-08).`);
    }
    if (ledgerPath) {
      const ledger = loadClaimsLedger(ledgerPath);
      brief.claims = { path: ledger.file, ids: ledger.verifiedIds };
      for (const problem of ledger.problems) warnings.push(`claims ledger ${shownPath(ledger.file, workspace)}: ${problem}`);
    }
  }

  // never-show
  const nsFile = profile.paths.never_show;
  if (nsFile && isFile(nsFile)) {
    const list = loadNeverShow(nsFile);
    authoritative.never_show = true;
    for (const e of list.entries) {
      brief.never_show.push({ class: e.class, pattern: e.pattern, regex: e.regex, until_utc: e.until_utc, source: `${shownPath(list.file, workspace)}:${e.line}` });
    }
    list.problems.forEach((problem, i) => {
      const label = /^([^:]+):/.exec(problem)?.[1] ?? `problem ${i + 1}`;
      extraMissing.push({ field: `never_show[${label}]`, action: 'manual-task', why: `The never-show file ${shownPath(list.file, workspace)} has an invalid entry: ${problem}; fix it (CT-12).` });
    });
  } else {
    const sections = [];
    for (const file of inputs.never_show.files) {
      if (/redact-check\./i.test(file.logical)) {
        sections.push(`redaction script ${file.shown} (run it too)`);
        continue;
      }
      if (!cache.has(file.abs)) cache.set(file.abs, readCandidate(file.abs));
      const text = cache.get(file.abs);
      if (!text) continue;
      for (const h of headingsMatching(text, NEVER_SHOW_HEADING)) sections.push(`${file.shown}:${h.line} "${h.heading}"`);
    }
    const head = nsFile ? `The profile names the never-show list ${nsFile}, which does not exist.` : 'No never-show list (paths.never_show).';
    notes.set('never_show', sections.length > 0
      ? `${head} Draft entries in the shared format (CT-12) from ${sections.slice(0, 6).join('; ')}, keep the plaintext outside the repository, and ask the owner what the page must never say, or not before a date (BF-09).`
      : `${head} No do-not-carry or private section found in research/findings/**/_summary.md; ask the owner what the page must never say, or not before a date, and render nothing marked private until then (BF-09).`);
  }

  // judge's path
  const pathFiles = [...inputs.judges.files, ...inputs.storyboard.files, ...inputs.rubric.files];
  /** @type {Array<{file: FoundFile, section: {heading: string, line: number, items: Array<{text: string, line: number}>}}>} */
  const sections = [];
  for (const file of pathFiles) {
    if (!cache.has(file.abs)) cache.set(file.abs, readCandidate(file.abs));
    const text = cache.get(file.abs);
    if (!text) continue;
    for (const section of extractListsUnderHeading(text, JUDGE_PATH_HEADING)) sections.push({ file, section });
  }
  if (sections.length === 1) {
    const { file, section } = sections[0];
    brief.judge_path.beats = section.items.map((i) => i.text);
    const first = section.items[0].line;
    const last = section.items[section.items.length - 1].line;
    fieldSources.set('judge_path.beats', `${file.shown}:${first === last ? first : `${first}-${last}`}`);
  } else if (sections.length > 1) {
    notes.set('judge_path.beats', `Several judge's-path sections (${sections.slice(0, 4).map((s) => `${s.file.shown}:${s.section.line}`).join(', ')}); keep the one that is current and record its beats with file:line (BF-06).`);
  } else {
    notes.set('judge_path.beats', pathFiles.length > 0
      ? `No "Judge's path" or "Demo beats" heading with a list in ${listShown(pathFiles)}; take the beats from the fold spec and the storyboard's on-screen cells, with file:line (BF-06).`
      : 'No judges, storyboard or runsheet file found; /frontend defines the screens and the script is written after /harden (BF-06): record the screens as beats.');
  }

  // spec, data contract, rubric: inputs with no brief field of their own
  if (specFiles.length === 0) {
    extraMissing.push({ field: 'spec', action: 'manual-task', why: `${noSpec} A validated spec is required; /execution should not have started without one (BF-03).` });
  }
  if (profile.run_mode === 'A' && inputs.data_contract.files.length === 0) {
    extraMissing.push({ field: 'data_contract', action: 'manual-task', why: `No API contract or fixtures (${listGlobs(inputs.data_contract.globs)}); feature sections cannot start before the data contract is frozen (BF-11).` });
  }
  if (profile.run_mode === 'B' && inputs.rubric.files.length === 0) {
    extraMissing.push({ field: 'rubric', action: 'question', why: `No rubric matched ${listGlobs(inputs.rubric.globs)}; ask for the rulebook and whether a live URL, a video (length cap) or slides (format) are required, and never assume a live stage (BF-10).` });
  }

  for (const [group, keys] of /** @type {const} */ ([
    ['project', ['name']], ['sentences', ['broken', 'did']], ['hero', ['h1', 'sentence']],
    ['gap', ['text', 'who_loses', 'how_much']], ['use_case', ['text']], ['judge_path', ['beats']],
  ])) {
    /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (brief[group])).source = joinSources(keys.map((k) => fieldSources.get(`${group}.${k}`)));
  }
  return { brief, fieldSources, notes, defaulted, authoritative, extraMissing };
}

/**
 * Merges a fresh compile with the brief already on disk. A value a source file gives now wins (the source is the
 * single editable copy, BF-05); otherwise a sourced value already in brief.json is kept, so fields an agent filled
 * by hand survive a re-run. List items merge by key; items only on disk are kept unless the catalogue or the
 * never-show file is authoritative.
 * @param {Fresh} fresh
 * @param {Brief | null} existing
 * @param {string[]} [warnings]
 * @returns {Brief}
 */
export function mergeBriefs(fresh, existing, warnings = []) {
  const out = structuredClone(fresh.brief);
  if (!existing) return out;
  /**
   * @param {'project' | 'sentences' | 'hero' | 'gap' | 'use_case'} group
   * @param {string[]} keys
   */
  const scalars = (group, keys) => {
    const target = /** @type {Record<string, string>} */ (/** @type {unknown} */ (out[group]));
    const old = /** @type {Record<string, string>} */ (/** @type {unknown} */ (existing[group]));
    const sources = [];
    for (const k of keys) {
      if (target[k]) {
        sources.push(fresh.fieldSources.get(`${group}.${k}`));
      } else if (old[k] && old.source) {
        target[k] = old[k];
        sources.push(old.source);
      }
    }
    target.source = joinSources(sources);
  };
  scalars('project', ['name']);
  if (!fresh.brief.project.name && existing.project.name && existing.project.source) out.project.name_status = existing.project.name_status;
  scalars('sentences', ['broken', 'did']);
  scalars('hero', ['h1', 'sentence']);
  scalars('gap', ['text', 'who_loses', 'how_much']);
  scalars('use_case', ['text']);
  if (out.judge_path.beats.length === 0 && existing.judge_path.beats.length > 0 && existing.judge_path.source) {
    out.judge_path = { beats: [...existing.judge_path.beats], source: existing.judge_path.source };
  }
  if (!out.claims.path && existing.claims.path) out.claims = { path: existing.claims.path, ids: [...existing.claims.ids] };

  for (const old of existing.sponsors) {
    const now = out.sponsors.find((s) => s.id === old.id);
    if (!now) {
      if (old.source) out.sponsors.push({ ...old });
      continue;
    }
    if (!now.strategy && old.strategy) {
      now.strategy = old.strategy;
      now.source = joinSources([now.source, old.source]);
    }
  }
  for (const old of existing.customers) {
    const now = out.customers.find((c) => c.name.toLowerCase() === old.name.toLowerCase());
    if (!now) {
      out.customers.push({ ...old });
      continue;
    }
    if (!now.category && old.category) now.category = old.category;
    if (!now.url && old.url) {
      now.url = old.url;
      now.url_source = old.url_source;
    }
  }
  for (const old of existing.features) {
    const now = out.features.find((f) => f.id === old.id);
    if (!now) {
      if (fresh.authoritative.features) warnings.push(`feature ${old.id} is no longer in the catalogue; dropped from the brief`);
      else if (old.source) out.features.push({ ...old });
      continue;
    }
    if (fresh.defaulted.has(`features[${now.id}].status`) && old.status) {
      now.status = old.status;
      fresh.defaulted.delete(`features[${now.id}].status`);
    }
    if (now.route === null && old.route) now.route = old.route;
    if (now.proof === null && old.proof) now.proof = old.proof;
    if (!now.group && old.group) now.group = old.group;
    if (now.title === now.id && old.title && old.title !== old.id) now.title = old.title;
  }
  if (!fresh.authoritative.never_show) {
    for (const old of existing.never_show) {
      if (!old.source || out.never_show.some((n) => n.pattern === old.pattern && n.class === old.class)) continue;
      out.never_show.push({ ...old });
    }
  }
  return out;
}

/**
 * The missing list of a merged brief: one entry per required field still empty, with the discovery-informed reason;
 * per-item gaps (a sponsor's strategy, a customer's category, a defaulted feature status); inputs without a brief
 * field (spec, data contract, rubric); and the entries already on disk for fields this compile does not know.
 * @param {Brief} brief
 * @param {Fresh} fresh
 * @param {Brief | null} existing
 * @param {{action: MissingAction, neverShowFile: {path: string | null, exists: boolean}}} options
 * @returns {MissingEntry[]}
 */
export function computeMissing(brief, fresh, existing, { action, neverShowFile }) {
  /** @type {MissingEntry[]} */
  const out = [];
  /** @param {string} field @param {string} why */
  const add = (field, why) => {
    if (!out.some((m) => m.field === field)) out.push({ field, action, why });
  };
  for (const field of REQUIRED_FIELDS) {
    if (hasValue(brief, field)) continue;
    if (field === 'never_show' && neverShowFile.exists) continue;
    add(field, fresh.notes.get(field) ?? defaultWhy(field));
  }
  for (const s of brief.sponsors) if (!s.strategy) add(`sponsors[${s.id}].strategy`, fresh.notes.get('sponsors[].strategy') ?? defaultWhy('sponsors[].strategy'));
  for (const c of brief.customers) if (!c.category) add(`customers[${c.name}].category`, fresh.notes.get('customers[].category') ?? defaultWhy('customers[].category'));
  const defaultedIds = brief.features.filter((f) => fresh.defaulted.has(`features[${f.id}].status`)).map((f) => f.id);
  if (defaultedIds.length > 0) {
    add('features[].status', `No expected status for ${defaultedIds.join(', ')}; "planned" is recorded until the plan or the owner gives live, testnet or simulated (BF-07).`);
  }
  for (const extra of fresh.extraMissing) {
    const filled = extra.field === 'project.name_status' ? brief.project.name_status === 'final' : false;
    if (!filled) add(extra.field, extra.why);
  }
  const known = new Set(out.map((m) => m.field));
  for (const old of existing?.missing ?? []) {
    if (known.has(old.field) || old.field.trim() === '') continue;
    if (REQUIRED_FIELDS.includes(old.field) && hasValue(brief, old.field)) continue;
    if (/^(?:sponsors|customers|features|never_show)\[/.test(old.field) || old.field === 'never_show') continue;
    out.push({ field: old.field, action: old.action, why: old.why });
  }
  return out.map((m) => ({ ...m, action }));
}

/**
 * @param {string} field
 * @returns {string}
 */
function defaultWhy(field) {
  return `${field} has no source yet; find it in the workspace and record it with file:line, or ask the owner (01-brief.md).`;
}

// ---------------------------------------------------------------------------------------------------------------
// brief.md
// ---------------------------------------------------------------------------------------------------------------

/**
 * Renders the brief template: `{{path}}` takes the value at that path, a line holding only `{{#each list}}` or
 * `{{/each}}` repeats the lines between once per item (`{{this}}`, `{{this.field}}`), and an empty value renders as
 * "missing" (an empty list renders its block once with every value missing). The template's leading comment is
 * dropped; values inside table rows have their pipes escaped.
 * @param {string} template
 * @param {unknown} data
 * @returns {string}
 */
export function renderTemplate(template, data) {
  const text = String(template).replace(/^\s*<!--[\s\S]*?-->\s*\n/, '');
  const lines = text.split('\n');
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^\s*\{\{#each\s+([\w.]+)\s*\}\}\s*$/.exec(lines[i]);
    if (!open) {
      out.push(fillLine(lines[i], data, undefined));
      continue;
    }
    const end = lines.findIndex((l, j) => j > i && /^\s*\{\{\/each\s*\}\}\s*$/.test(l));
    if (end < 0) throw new EnvError(`template line ${i + 1}: {{#each ${open[1]}}} has no {{/each}}; fix the template`);
    const body = lines.slice(i + 1, end);
    const list = valueAtPath(data, open[1]);
    const items = Array.isArray(list) && list.length > 0 ? list : [undefined];
    for (const item of items) for (const line of body) out.push(fillLine(line, data, item));
    i = end;
  }
  return out.join('\n');
}

/**
 * @param {string} line
 * @param {unknown} data
 * @param {unknown} item
 * @returns {string}
 */
function fillLine(line, data, item) {
  const inTable = line.trim().startsWith('|');
  return line.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = key === 'this' ? item : key.startsWith('this.') ? valueAtPath(item, key.slice(5)) : valueAtPath(data, key);
    const shown = displayValue(value);
    return inTable ? shown.replace(/\|/g, '\\|') : shown;
  });
}

/**
 * @param {unknown} data
 * @param {string} dotted
 * @returns {unknown}
 */
function valueAtPath(data, dotted) {
  let v = data;
  for (const part of dotted.split('.')) {
    if (!isObject(v)) return undefined;
    v = v[part];
  }
  return v;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function displayValue(value) {
  if (value === undefined || value === null || value === '') return 'missing';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.length === 0 ? 'missing' : value.map((v) => String(v)).join(', ');
  return String(value).replace(/\s*[\r\n]+\s*/g, ' ');
}

/**
 * brief.md from brief.json and the skill's template.
 * @param {Brief} brief
 * @param {string} [templateFile]
 * @returns {string}
 */
export function renderBriefMarkdown(brief, templateFile = BRIEF_TEMPLATE) {
  if (!isFile(templateFile)) throw new EnvError(`the brief template ${templateFile} is missing; reinstall the skill`);
  const md = renderTemplate(readText(templateFile), brief);
  return md.endsWith('\n') ? md : `${md}\n`;
}

// ---------------------------------------------------------------------------------------------------------------
// Gate brief.complete
// ---------------------------------------------------------------------------------------------------------------

/**
 * Checks a parsed brief.json: the CONTRACTS 6.4 shape; every non-empty field names a source; every source resolves
 * to an existing file (and its line exists); every required field is filled or listed under missing with an action
 * and a reason. The never-show list may be empty only when the profile's never-show file exists.
 * @param {unknown} raw
 * @param {{bases: readonly string[], neverShowFile?: {path: string | null, exists: boolean}}} options
 * @returns {{problems: string[], filled: number, missing: MissingEntry[]}}
 */
export function checkBrief(raw, { bases, neverShowFile = { path: null, exists: false } }) {
  const problems = briefShapeProblems(raw);
  if (!isObject(raw)) return { problems, filled: 0, missing: [] };
  const brief = coerceBrief(raw);
  /** @type {Map<string, number | null>} */
  const lineCounts = new Map();
  /**
   * @param {string} where
   * @param {string} source
   */
  const checkSource = (where, source) => {
    for (const ref of parseSources(source)) {
      const resolved = resolveSourceFile(ref.path, bases);
      if (!resolved) {
        problems.push(`${where}: source ${ref.raw} does not resolve to an existing file (looked in ${bases.join(', ') || 'no folder'})`);
        continue;
      }
      if (ref.line !== null) {
        if (!lineCounts.has(resolved)) lineCounts.set(resolved, countLines(resolved));
        const count = lineCounts.get(resolved);
        const last = ref.lineEnd ?? ref.line;
        if (count !== null && count !== undefined && (ref.line < 1 || last > count || last < ref.line)) {
          problems.push(`${where}: source ${ref.raw} points past the end of the file (${count} lines)`);
        }
      }
    }
  };
  /**
   * @param {string} where
   * @param {boolean} hasText
   * @param {string} source
   */
  const sourced = (where, hasText, source) => {
    if (!hasText) {
      if (source.trim() !== '') checkSource(where, source);
      return;
    }
    if (source.trim() === '') problems.push(`${where} has text but no source; record the file (and line) it came from, or empty it and list it as missing`);
    else checkSource(where, source);
  };
  sourced('project', brief.project.name !== '', brief.project.source);
  if (brief.project.name === '' && brief.project.name_status !== 'pending') problems.push(`project.name_status is ${brief.project.name_status} but project.name is empty`);
  sourced('sentences', brief.sentences.broken !== '' || brief.sentences.did !== '', brief.sentences.source);
  sourced('hero', brief.hero.h1 !== '' || brief.hero.sentence !== '', brief.hero.source);
  sourced('gap', brief.gap.text !== '' || brief.gap.who_loses !== '' || brief.gap.how_much !== '', brief.gap.source);
  sourced('use_case', brief.use_case.text !== '', brief.use_case.source);
  sourced('judge_path', brief.judge_path.beats.length > 0, brief.judge_path.source);
  brief.sponsors.forEach((s) => sourced(`sponsors[${s.id}]`, true, s.source));
  brief.features.forEach((f) => sourced(`features[${f.id}]`, true, f.source));
  brief.never_show.forEach((n, i) => {
    sourced(`never_show[${i}]`, true, n.source);
    if (n.regex) {
      try {
        new RegExp(n.pattern, 'i');
      } catch (err) {
        problems.push(`never_show[${i}] pattern does not compile (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  });
  brief.customers.forEach((c) => {
    if (c.url && !c.url_source.trim()) problems.push(`customers[${c.name}] has a URL but no url_source; record how it was verified (BF-04)`);
  });
  if (brief.claims.path && !resolveSourceFile(brief.claims.path, bases)) problems.push(`claims.path ${brief.claims.path} does not exist`);

  let filled = 0;
  for (const field of REQUIRED_FIELDS) {
    if (hasValue(brief, field)) {
      filled += 1;
      continue;
    }
    if (field === 'never_show' && neverShowFile.exists) {
      filled += 1;
      continue;
    }
    if (!isListed(brief.missing, field)) {
      problems.push(`${field} is empty and not listed under missing; fill it from its source or add {field: "${field}", action, why}`);
    }
  }
  for (const s of brief.sponsors) {
    if (!s.strategy && !isListed(brief.missing, `sponsors[${s.id}].strategy`)) problems.push(`sponsors[${s.id}].strategy is empty and not listed under missing`);
  }
  for (const c of brief.customers) {
    if (!c.category && !isListed(brief.missing, `customers[${c.name}].category`)) problems.push(`customers[${c.name}].category is empty and not listed under missing`);
  }
  for (const m of brief.missing) {
    const stale = (REQUIRED_FIELDS.includes(m.field) && hasValue(brief, m.field))
      || brief.sponsors.some((s) => s.strategy && m.field === `sponsors[${s.id}].strategy`)
      || brief.customers.some((c) => c.category && m.field === `customers[${c.name}].category`);
    if (stale) problems.push(`missing lists ${m.field}, which is filled; remove the entry`);
  }
  return { problems, filled, missing: brief.missing };
}

/**
 * @param {string} p
 * @param {readonly string[]} bases
 * @returns {string | null}
 */
function resolveSourceFile(p, bases) {
  if (!p) return null;
  if (path.isAbsolute(p)) return isFile(p) ? p : null;
  for (const base of bases) {
    const candidate = path.resolve(base, p);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/**
 * @param {string} file
 * @returns {number | null}
 */
function countLines(file) {
  const text = readCandidate(file);
  if (text === null) return null;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

/**
 * The folders a relative source resolves against: the workspace the discovery receipt recorded, the workspace the
 * profile implies, the repository root and its parent.
 * @param {{state: string | null | undefined, root: string, profile: Profile, workspace?: string | null}} where
 * @returns {string[]}
 */
export function sourceBases({ state, root, profile, workspace }) {
  /** @type {string[]} */
  const bases = [];
  /** @param {string | null | undefined} p */
  const add = (p) => {
    if (!p) return;
    const abs = toPosix(path.resolve(p));
    if (!bases.includes(abs) && isDirectory(abs)) bases.push(abs);
  };
  if (workspace) add(workspace);
  add(receiptWorkspace(state));
  add(resolveWorkspace({ root, profile }).workspace);
  add(root);
  add(path.dirname(path.resolve(root)));
  return bases;
}

/**
 * The workspace the last compile recorded in `<state>/receipts/brief-discovery.json`, or null when there is no
 * readable receipt (the receipt only adds a folder to look in; the gate still checks every source).
 * @param {string | null | undefined} state
 * @returns {string | null}
 */
function receiptWorkspace(state) {
  if (!state) return null;
  const text = readCandidate(path.join(state, RECEIPT_PATH));
  if (text === null) return null;
  /** @type {unknown} */
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (err) {
    process.stderr.write(`brief: ignoring ${RECEIPT_PATH}, not valid JSON (${err instanceof Error ? err.message : String(err)})\n`);
    return null;
  }
  return isObject(data) && typeof data.workspace === 'string' ? data.workspace : null;
}

/**
 * Gate brief.complete on `<state>/brief.json`.
 * @param {{state: string | null | undefined, root: string, profile: Profile, workspace?: string | null}} where
 * @returns {GateResult}
 */
export function briefCompleteGate(where) {
  const g = gate(GATES[0]);
  if (!where.state) return g.skip('no state directory to read brief.json from; pass --state or run inside a repository with a profile');
  const file = toPosix(path.join(where.state, 'brief.json'));
  if (!isFile(file)) {
    return g.fail(`${file} does not exist; run node brief.mjs --root <repo> --profile <abs profile> to compile it`, { file });
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readText(file));
  } catch (err) {
    return g.fail(`${file} is not valid JSON (${err instanceof Error ? err.message : String(err)}); fix it or recompile with brief.mjs`, { file });
  }
  const bases = sourceBases(where);
  const { problems, filled, missing } = checkBrief(raw, { bases, neverShowFile: neverShowFileStatus(where.profile) });
  if (problems.length > 0) {
    const head = problems.slice(0, 3).join('; ');
    return g.fail(
      `${problems.length} problem${problems.length > 1 ? 's' : ''} in brief.json: ${head}${problems.length > 3 ? '; ...' : ''}`,
      capEvidence(problems.map((p) => ({ file, value: p }))),
    );
  }
  const actions = [...new Set(missing.map((m) => m.action))].join(', ');
  return g.ok(
    `brief.json complete: ${filled} of ${REQUIRED_FIELDS.length} required fields filled and sourced, ${missing.length} gap${missing.length === 1 ? '' : 's'} listed as missing${actions ? ` (${actions})` : ''}`,
    capEvidence(missing.map((m) => ({ file, field: m.field, value: `${m.action}: ${m.why}` }))),
  );
}

/**
 * @param {Evidence[]} evidence
 * @param {number} [max]
 * @returns {Evidence[]}
 */
function capEvidence(evidence, max = 60) {
  if (evidence.length <= max) return evidence;
  return [...evidence.slice(0, max), { value: `and ${evidence.length - max} more` }];
}

/**
 * Normalises `selected` (an array, a Set or nothing) to the ids of `gates` that it names; a group name selects the
 * whole group.
 * @param {Iterable<string> | null | undefined} selected
 * @param {ReadonlyArray<{id: string}>} gates
 * @returns {string[]}
 */
export function selectedIds(selected, gates) {
  const all = gates.map((g) => g.id);
  if (selected === undefined || selected === null) return all;
  const wanted = new Set([...selected].map((s) => String(s).trim()).filter(Boolean));
  return all.filter((id) => wanted.has(id) || wanted.has(id.split('.')[0]));
}

/**
 * Check-module entry point (CONTRACTS section 4).
 * @param {{root: string, profile: Profile, state?: string | null, args?: Record<string, unknown>}} ctx
 * @param {Iterable<string>} [selected]
 * @returns {Promise<GateResult[]>}
 */
export async function run(ctx, selected) {
  if (!selectedIds(selected, GATES).includes('brief.complete')) return [];
  const workspace = typeof ctx.args?.workspace === 'string' ? ctx.args.workspace : null;
  return [briefCompleteGate({ state: ctx.state, root: ctx.root, profile: ctx.profile, workspace })];
}

// ---------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------

const HELP = `Usage: node brief.mjs [--root <repo>] [--profile <abs path>] [--state <dir>] [--workspace <dir>]
                     [--check | --dry-run] [--json]

P0 brief (FE-00). Discovers the project's inputs by glob from the workspace root (research/internal-contracts.md
FD13-F05), fills only the fields a file or the profile sources, lists every other field under "missing" with its
action (manual-task in mode A, question in mode B), writes brief.json, brief.md and receipts/brief-discovery.json in
the state directory, then runs gate brief.complete. A re-run keeps the sourced fields already in brief.json and lets a
value a source file now states replace them.

Options:
  --root <repo>        product repository (default: the working directory)
  --profile <path>     /execution profile.json (its frontend block) or a bare frontend block file
  --state <dir>        state directory (default: <root>/.execution/frontend in mode A, <root>/.frontend in mode B;
                       before T0: <workspace.private_dir>/frontend)
  --workspace <dir>    folder holding research/ and docs/ (default: parent of paths.research, workspace.private_dir,
                       the repository root, or its parent when that holds research/)
  --check              run gate brief.complete on the existing brief.json; write nothing
  --dry-run            compile and print brief.json on stdout; write nothing, run no gate
  --json               print the gate report (JSON) on stdout
  -h, --help           this text

Prose fields are read only from labelled lines in the source files, verbatim:
  Broken: / What is broken:      sentences.broken      H1: / Headline:          hero.h1
  Did: / What we did:            sentences.did         Hero sentence: / Subhead: hero.sentence
  Gap: / Who loses: / How much:  gap.*                 Use case:                use_case.text
  Name: / Chosen name:           project.name (naming verdict)
as "Label: value", "**Label:** value" or a table row "| Label | value |". A heading "Judge's path" or "Demo beats"
followed by a list gives judge_path.beats. Globs match with lib/fsutil (case-sensitive first, then
case-insensitive, then research/ re-rooted at docs/); the receipt records which matcher found each file.

Exit codes: 0 brief.complete ok; 1 brief.complete failed; 2 usage error (bad flag, invalid profile or brief.json);
3 environment error (missing template, unreadable workspace).`;

/**
 * @param {readonly string[]} argv
 * @returns {number} exit code
 */
export function main(argv) {
  const { values, positionals } = parseCli(argv, {
    help: HELP,
    allowPositionals: false,
    options: {
      root: { type: 'string' },
      profile: { type: 'string' },
      state: { type: 'string' },
      workspace: { type: 'string' },
      check: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      json: { type: 'boolean' },
    },
  });
  if (positionals.length > 0) throw new UsageError(`unexpected argument ${positionals[0]}; run with --help for usage`);
  if (values.check && values['dry-run']) throw new UsageError('--check and --dry-run do not combine; pick one');
  const root = path.resolve(values.root ?? process.cwd());
  if (!isDirectory(root)) throw new UsageError(`--root ${toPosix(root)} is not an existing folder; pass the repository root`);
  const profile = loadProfile(values.profile, { root });
  const log = (/** @type {string} */ line) => process.stderr.write(`brief: ${line}\n`);

  if (values['dry-run']) {
    const existing = readBrief(values.state ? path.resolve(values.state) : defaultStatePath(root, profile));
    const { brief, warnings } = compileBrief({ root, profile, workspace: values.workspace ?? null, existing: existing.brief });
    for (const w of warnings) log(`note: ${w}`);
    process.stdout.write(`${JSON.stringify(brief, null, 2)}\n`);
    return 0;
  }

  const state = stateDir(root, profile, values.state ?? null);
  if (!values.check) {
    const current = readBrief(state);
    if (current.error && isFile(path.join(state, 'brief.json'))) {
      throw new UsageError(`${current.error}; fix it, or delete it to compile a fresh brief`);
    }
    const { brief, receipt, warnings } = compileBrief({ root, profile, workspace: values.workspace ?? null, existing: current.brief });
    const shape = briefShapeProblems(brief);
    if (shape.length > 0) throw new Error(`compiled brief does not match CONTRACTS 6.4 (${shape.join('; ')}); this is a bug in brief.mjs`);
    const jsonFile = writeText(path.join(state, 'brief.json'), `${JSON.stringify(brief, null, 2)}\n`);
    const mdFile = writeText(path.join(state, 'brief.md'), renderBriefMarkdown(brief));
    const receiptFile = writeText(path.join(state, RECEIPT_PATH), `${JSON.stringify(receipt, null, 2)}\n`);
    log(`workspace ${receipt.workspace} (${receipt.workspace_how}), ${receipt.files_scanned} files scanned`);
    for (const input of receipt.inputs) log(`${input.label}: ${input.count} file${input.count === 1 ? '' : 's'}${input.matcher ? ` (${input.matcher})` : ''}`);
    for (const w of warnings) log(`note: ${w}`);
    log(`wrote ${jsonFile}, ${mdFile} and ${receiptFile}`);
    for (const m of brief.missing) log(`missing ${m.field} (${m.action}): ${m.why}`);
  }
  const result = briefCompleteGate({ state, root, profile, workspace: values.workspace ?? null });
  const report = aggregate([result], { requested: GATES, tool: 'brief', target: { root: toPosix(root), state } });
  log(`${result.id}: ${result.state} - ${result.detail}`);
  if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.ok ? 0 : 1;
}

/**
 * Where stateDir() would put the state, without creating anything (for --dry-run).
 * @param {string} root
 * @param {Pick<Profile, 'run_mode'>} profile
 * @returns {string}
 */
function defaultStatePath(root, profile) {
  return toPosix(profile.run_mode === 'A' ? path.join(root, '.execution', 'frontend') : path.join(root, '.frontend'));
}

/**
 * True when this file is the script node was started with.
 * @returns {boolean}
 */
function isMain() {
  return isMainModule(import.meta.url);
}

if (isMain()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    exitWith(err);
  }
}
