// @ts-check
/**
 * Checks the skill's research citations. Every finding id cited in references/*.md, SKILL.md, ARCHITECTURE.md,
 * scripts/CONTRACTS.md and the Markdown and task templates under assets/
 * (`[FD13-F03]`, `[FD11-F02, F06, F08]`, or a bare `FD05-F21` in a sentence) must exist as a `### FDnn-Fmm` heading
 * in research/*.md and must not be a finding dropped at verification; a cited dossier (`[FD14]`) must exist. A
 * section citation (`[FD19 Capture policy table]`) should name a heading of that dossier: unresolved ones are
 * warnings, errors with --strict. The rule registry's `sources` (scripts/rules/registry.json) are checked the same
 * way, finding ids and dossier codes only. The command also counts em dashes (U+2014) in the prose of the Markdown
 * files, code excluded, as /prose measures them; the count is reported, never a failure.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli, isMainModule } from './lib/args.mjs';
import { CheckError, UsageError, exitWith } from './lib/errors.mjs';
import { readText, toPosix } from './lib/fsutil.mjs';
import { emDashRate, lineOf } from './lib/text.mjs';

/** The skill folder this script belongs to. */
export const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Usage: node check-refs.mjs [--root <skill dir>] [--strict] [--json]

Checks that every finding id cited in references/*.md, SKILL.md, ARCHITECTURE.md, scripts/CONTRACTS.md, the
Markdown files of assets/templates and assets/agents, assets/task-templates/frontend.json and the sources of
scripts/rules/registry.json exists as a "### FDnn-Fmm" heading in research/*.md, is not a finding dropped at
verification, and that every cited dossier exists. Also counts em dashes (U+2014) in the prose of the Markdown files
(code, URLs and HTML comments excluded).

Options:
  --root <dir>   the skill folder (default: ${toPosix(SKILL_ROOT)})
  --strict       also fail on section citations such as [FD19 Capture policy table] that match no heading
  --json         print the machine report on stdout
  -h, --help     this text

Exit codes: 0 every citation resolves; 1 a cited finding or dossier is missing or dropped (with --strict, also an
unresolved section citation); 2 usage error (no research folder under --root); 3 unexpected error.`;

const EM_DASH = String.fromCharCode(0x2014);
const FINDING_HEADING = /^FD(\d{2})-F(\d{2,3})(?![0-9])/;
const FINDING_TOKEN = /\bFD(\d{2})-F(\d{2,3})(?![0-9])/g;
const GROUP_SPLIT = /[;,]\s*(?=FD\d{2}(?![0-9])|F\d{2,3}(?![0-9]))/;
const MAX_GROUP = 600;
const MAX_LINES_LISTED = 50;

/**
 * @typedef {[number, number]} Range half-open [start, end) offsets
 * @typedef {{id: string, code: string, file: string, line: number, verdict: string | null, dropped: boolean}} Finding
 * @typedef {{level: number, text: string, line: number}} Heading
 * @typedef {{file: string, line: number, id: string, level: number}} Misleveled
 * @typedef {{findings: Map<string, Finding>, dossiers: Map<string, string[]>, headings: Map<string, Heading[]>,
 *   duplicates: Array<{id: string, first: string, again: string}>, misleveled: Map<string, Misleveled>}} ResearchIndex
 * @typedef {'finding' | 'dossier' | 'section'} CitationKind
 * @typedef {{kind: CitationKind, id: string, code: string, section: string | null, file: string, line: number,
 *   offset: number, raw: string, where: 'bracket' | 'prose' | 'code'}} Citation
 * @typedef {Citation & {problem: 'missing' | 'dropped' | 'missing-dossier' | 'unresolved-section', hint: string}} Problem
 * @typedef {{file: string, count: number, words: number, per1000: number, inCode: number, lines: number[]}} DashCount
 * @typedef {{ok: boolean, tool: string, root: string, strict: boolean, files: string[],
 *   counts: {citations: number, findings: number, dossiers: number, sections: number, distinctFindings: number,
 *     missing: number, dropped: number, missingDossiers: number, unresolvedSections: number},
 *   problems: Problem[], warnings: Problem[], duplicates: ResearchIndex['duplicates'],
 *   emDashes: {total: number, inCode: number, words: number, per1000: number, files: DashCount[]}}} RefsReport
 */

/**
 * Ranges of a Markdown text that are not prose: fenced code blocks, inline code spans, HTML comments, link
 * destinations, autolinks and bare URLs. Offsets refer to the original text.
 * @param {string} text
 * @returns {{code: Range[], other: Range[]}}
 */
export function nonProseRanges(text) {
  /** @type {Range[]} */
  const code = [];
  /** @type {Range[]} */
  const other = [];
  const fences = fencedBlocks(text);
  code.push(...fences);
  const outside = (/** @type {number} */ at) => !fences.some(([s, e]) => at >= s && at < e);
  for (const m of text.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) {
    if (m.index !== undefined && outside(m.index)) other.push([m.index, m.index + m[0].length]);
  }
  const inComment = (/** @type {number} */ at) => other.some(([s, e]) => at >= s && at < e);
  code.push(...inlineCode(text, (at) => outside(at) && !inComment(at)));
  const blocked = (/** @type {number} */ at) => !outside(at) || inComment(at) || code.some(([s, e]) => at >= s && at < e);
  for (const m of text.matchAll(/\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:\s+"[^"]*")?\)/g)) {
    if (m.index !== undefined && !blocked(m.index)) other.push([m.index + 2, m.index + m[0].length - 1]);
  }
  for (const m of text.matchAll(/<(?:https?|mailto):[^>\s]+>/g)) {
    if (m.index !== undefined && !blocked(m.index)) other.push([m.index, m.index + m[0].length]);
  }
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>)\]]+/g)) {
    if (m.index !== undefined && !blocked(m.index)) other.push([m.index, m.index + m[0].length]);
  }
  return { code: mergeRanges(code), other: mergeRanges(other) };
}

/**
 * Fenced code blocks (``` or ~~~, up to three spaces of indent), each from its opening fence to the end of its
 * closing fence line, or to the end of the text when it never closes.
 * @param {string} text
 * @returns {Range[]}
 */
function fencedBlocks(text) {
  /** @type {Range[]} */
  const ranges = [];
  const lines = text.split('\n');
  let offset = 0;
  /** @type {{char: string, size: number, start: number} | null} */
  let open = null;
  for (const line of lines) {
    const end = offset + line.length + 1;
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r$/, ''));
    if (open === null) {
      if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) open = { char: fence[1][0], size: fence[1].length, start: offset };
    } else if (fence && fence[1][0] === open.char && fence[1].length >= open.size && fence[2].trim() === '') {
      ranges.push([open.start, Math.min(end, text.length)]);
      open = null;
    }
    offset = end;
  }
  if (open !== null) ranges.push([open.start, text.length]);
  return ranges;
}

/**
 * Inline code spans: a run of N backticks up to the next run of exactly N backticks, within one paragraph.
 * @param {string} text
 * @param {(at: number) => boolean} allowed
 * @returns {Range[]}
 */
function inlineCode(text, allowed) {
  /** @type {Range[]} */
  const ranges = [];
  const runs = [...text.matchAll(/`+/g)].filter((m) => m.index !== undefined && allowed(/** @type {number} */ (m.index)));
  for (let i = 0; i < runs.length; i += 1) {
    const opener = runs[i];
    const start = /** @type {number} */ (opener.index);
    for (let j = i + 1; j < runs.length; j += 1) {
      const closer = runs[j];
      const at = /** @type {number} */ (closer.index);
      if (/\n[ \t]*\n/.test(text.slice(start, at))) break;
      if (closer[0].length === opener[0].length) {
        ranges.push([start, at + closer[0].length]);
        i = j;
        break;
      }
    }
  }
  return ranges;
}

/**
 * @param {Range[]} ranges
 * @returns {Range[]}
 */
function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  /** @type {Range[]} */
  const out = [];
  for (const [s, e] of sorted) {
    const last = out.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * The text with the ranges replaced by spaces, line breaks kept, so offsets and line numbers stay valid.
 * @param {string} text
 * @param {Range[]} ranges
 * @returns {string}
 */
function blank(text, ranges) {
  let out = '';
  let at = 0;
  for (const [s, e] of mergeRanges(ranges)) {
    out += text.slice(at, s) + text.slice(s, e).replace(/[^\n]/g, ' ');
    at = e;
  }
  return out + text.slice(at);
}

/**
 * Reads research/*.md: every `### FDnn-Fmm` heading (outside code), its verdict line, whether it sits under
 * "## Dropped at verification" or carries the verdict DROPPED, the headings of each dossier file (for section
 * citations), duplicated finding ids, and finding ids written at another heading level.
 * @param {string} researchDir
 * @returns {ResearchIndex}
 */
export function indexResearch(researchDir) {
  /** @type {ResearchIndex} */
  const index = { findings: new Map(), dossiers: new Map(), headings: new Map(), duplicates: [], misleveled: new Map() };
  const files = readdirSync(researchDir).filter((f) => f.toLowerCase().endsWith('.md')).sort();
  for (const name of files) {
    const rel = `research/${name}`;
    const text = readText(path.join(researchDir, name));
    const lines = blank(text, fencedBlocks(text)).split('\n');
    /** @type {Heading[]} */
    const headings = [];
    /** @type {Set<string>} */
    const codes = new Set();
    let inDropped = false;
    lines.forEach((raw, i) => {
      const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw.replace(/\r$/, ''));
      if (!m) return;
      const level = m[1].length;
      const title = m[2];
      headings.push({ level, text: title, line: i + 1 });
      if (level <= 2) inDropped = level === 2 && /^dropped at verification\b/i.test(title);
      const f = FINDING_HEADING.exec(title);
      if (!f) return;
      const id = `FD${f[1]}-F${f[2]}`;
      if (level !== 3) {
        if (!index.misleveled.has(id)) index.misleveled.set(id, { file: rel, line: i + 1, id, level });
        return;
      }
      const verdict = verdictAfter(lines, i);
      const finding = { id, code: `FD${f[1]}`, file: rel, line: i + 1, verdict, dropped: inDropped || verdict === 'DROPPED' };
      const known = index.findings.get(id);
      if (known) {
        index.duplicates.push({ id, first: `${known.file}:${known.line}`, again: `${rel}:${i + 1}` });
        if (known.dropped && !finding.dropped) index.findings.set(id, finding);
      } else {
        index.findings.set(id, finding);
      }
      codes.add(finding.code);
    });
    for (const code of codes) {
      index.dossiers.set(code, [...(index.dossiers.get(code) ?? []), rel]);
      index.headings.set(rel, headings);
    }
  }
  return index;
}

/**
 * The verdict word of a finding: the first `**Verdict:**` within the lines before the next heading.
 * @param {string[]} lines
 * @param {number} headingIndex
 * @returns {string | null}
 */
function verdictAfter(lines, headingIndex) {
  for (let i = headingIndex + 1; i < Math.min(lines.length, headingIndex + 12); i += 1) {
    if (/^#{1,6}\s/.test(lines[i])) return null;
    const m = /\*\*Verdict:\*\*\s*([A-Z]+)/.exec(lines[i]);
    if (m) return m[1];
  }
  return null;
}

/**
 * The citations of one Markdown file.
 * - Bracket groups in prose (`[FD13-F03]`, `[FD11-F02, F06, F08]`, `[FD14]`, `[FD19 Capture policy table]`,
 *   `[FD06; critic C4, ...]`), which may wrap lines but never cross a blank line. A bare `Fmm` continues the last
 *   dossier named in the same group; text after a dossier code is a section name.
 * - Finding ids anywhere else in prose (`FD05-F21 and FD05-F25 suggest ...`).
 * - Finding ids inside code spans and blocks: only complete `FDnn-Fmm` ids count there.
 * @param {string} text
 * @param {string} file the file name reported with each citation
 * @returns {Citation[]}
 */
export function extractCitations(text, file) {
  const { code, other } = nonProseRanges(text);
  const prose = blank(text, [...code, ...other]);
  /** @type {Citation[]} */
  const out = [];
  /** @type {Range[]} */
  const groups = [];
  for (const m of prose.matchAll(/\[([^\[\]]*)\]/g)) {
    const start = /** @type {number} */ (m.index);
    const inner = m[1];
    if (inner.length > MAX_GROUP || /\n[ \t]*\n/.test(inner) || !/FD\d{2}(?![0-9])/.test(inner)) continue;
    groups.push([start, start + m[0].length]);
    out.push(...groupCitations(inner, start + 1, text, file));
  }
  const loose = blank(prose, groups);
  for (const m of loose.matchAll(FINDING_TOKEN)) {
    out.push(citation('finding', `FD${m[1]}-F${m[2]}`, null, /** @type {number} */ (m.index), m[0], text, file, 'prose'));
  }
  for (const [s, e] of code) {
    for (const m of text.slice(s, e).matchAll(FINDING_TOKEN)) {
      out.push(citation('finding', `FD${m[1]}-F${m[2]}`, null, s + /** @type {number} */ (m.index), m[0], text, file, 'code'));
    }
  }
  return out.sort((a, b) => a.offset - b.offset);
}

/**
 * @param {string} inner the text between the brackets
 * @param {number} offset offset of `inner` in the file
 * @param {string} text the whole file
 * @param {string} file
 * @returns {Citation[]}
 */
function groupCitations(inner, offset, text, file) {
  /** @type {Citation[]} */
  const out = [];
  let code = '';
  let cursor = 0;
  for (const part of inner.split(GROUP_SPLIT)) {
    const at = inner.indexOf(part, cursor);
    cursor = at + part.length;
    const lead = part.length - part.trimStart().length;
    const piece = part.trim();
    const where = offset + at + lead;
    const finding = /^FD(\d{2})-F(\d{2,3})(?![0-9])/.exec(piece);
    const dossier = /^FD(\d{2})(?![0-9])(\s.*|[;,].*)?$/s.exec(piece);
    const continued = /^F(\d{2,3})(?![0-9])/.exec(piece);
    if (finding) {
      code = `FD${finding[1]}`;
      out.push(citation('finding', `${code}-F${finding[2]}`, null, where, finding[0], text, file, 'bracket'));
    } else if (dossier) {
      code = `FD${dossier[1]}`;
      const rest = dossier[2] ?? '';
      const section = /^\s+\S/.test(rest) ? rest.replace(/\s+/g, ' ').trim() : '';
      if (section) out.push(citation('section', code, section, where, piece.replace(/\s+/g, ' '), text, file, 'bracket'));
      else out.push(citation('dossier', code, null, where, `FD${dossier[1]}`, text, file, 'bracket'));
    } else if (continued && code) {
      out.push(citation('finding', `${code}-F${continued[1]}`, null, where, continued[0], text, file, 'bracket'));
    } else {
      for (const m of piece.matchAll(FINDING_TOKEN)) {
        out.push(citation('finding', `FD${m[1]}-F${m[2]}`, null, where + /** @type {number} */ (m.index), m[0], text, file, 'bracket'));
      }
    }
  }
  return out;
}

/**
 * @param {CitationKind} kind
 * @param {string} id
 * @param {string | null} section
 * @param {number} at
 * @param {string} raw
 * @param {string} text
 * @param {string} file
 * @param {Citation['where']} where
 * @returns {Citation}
 */
function citation(kind, id, section, at, raw, text, file, where) {
  return { kind, id, code: id.slice(0, 4), section, file, line: lineOf(text, at), offset: at, raw, where };
}

/**
 * Lowercase, NFKC, straight quotes, no Markdown emphasis or code marks, no leading enumerator ("A. ", "2. "),
 * single spaces, no trailing punctuation: how section names and headings compare.
 * @param {string} s
 * @returns {string}
 */
function normaliseSection(s) {
  return s
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[`*_]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:[a-z]|\d{1,2})[.)]\s+/, '')
    .replace(/[\s.:;,]+$/, '');
}

/**
 * Whether a section name matches a heading of the dossier: equal, or one a prefix of the other at a word boundary
 * ("Weak spots" names "Weak spots of this dossier"; "Policy table (derived from the findings" names the full
 * heading).
 * @param {string} section
 * @param {Heading[]} headings
 * @returns {boolean}
 */
function sectionResolves(section, headings) {
  const want = normaliseSection(section);
  if (want === '') return false;
  return headings.some((h) => {
    const have = normaliseSection(h.text);
    if (have === want) return true;
    const [short, long] = have.length < want.length ? [have, want] : [want, have];
    return short.length >= 4 && long.startsWith(short) && /^[\s(:;,.-]/.test(long.slice(short.length) || ' ');
  });
}

/**
 * The Markdown files of one folder under the skill root, sorted, as paths relative to the root.
 * @param {string} root
 * @param {string} dir
 * @returns {string[]}
 */
function markdownIn(root, dir) {
  const full = path.join(root, dir);
  return existsSync(full) && statSync(full).isDirectory()
    ? readdirSync(full).filter((f) => f.toLowerCase().endsWith('.md')).sort().map((f) => `${dir}/${f}`)
    : [];
}

/**
 * The files whose citations are checked: references/*.md (sorted), SKILL.md, ARCHITECTURE.md, scripts/CONTRACTS.md,
 * the Markdown templates and agent definitions under assets/, and the task templates (assets/task-templates/frontend.json),
 * as paths relative to the skill root.
 * @param {string} root
 * @returns {string[]}
 */
export function citingFiles(root) {
  const top = ['SKILL.md', 'ARCHITECTURE.md', 'scripts/CONTRACTS.md'].filter((f) => existsSync(path.join(root, f)));
  const templates = ['assets/task-templates/frontend.json'].filter((f) => existsSync(path.join(root, f)));
  return [...markdownIn(root, 'references'), ...top, ...markdownIn(root, 'assets/templates'), ...markdownIn(root, 'assets/agents'), ...templates];
}

/** Where the rule registry sits under the skill root; its `sources` cite research too. */
export const REGISTRY_FILE = 'scripts/rules/registry.json';

/**
 * The citations in the rule registry's `sources` (`"FD14-F07"`, `"FD21"`, `"FD10 T01"`): finding ids are checked like
 * any other; a dossier code followed by words names a catalogue row or a table, not a heading, so only the dossier is
 * checked. Line numbers point at the source string in the JSON.
 * @param {string} text the registry file
 * @returns {Citation[]}
 */
export function registryCitations(text) {
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new UsageError(`${REGISTRY_FILE} is not valid JSON (${err instanceof Error ? err.message : String(err)}); fix it first`);
  }
  const rules = raw && typeof raw === 'object' && Array.isArray(/** @type {Record<string, unknown>} */ (raw).rules)
    ? /** @type {Array<Record<string, unknown>>} */ (/** @type {Record<string, unknown>} */ (raw).rules)
    : [];
  /** @type {Citation[]} */
  const out = [];
  let cursor = 0;
  for (const rule of rules) {
    const idAt = typeof rule.id === 'string' ? text.indexOf(JSON.stringify(rule.id), cursor) : -1;
    if (idAt >= 0) cursor = idAt;
    for (const source of Array.isArray(rule.sources) ? rule.sources : []) {
      if (typeof source !== 'string') continue;
      const at = Math.max(0, text.indexOf(JSON.stringify(source), cursor));
      for (const c of extractCitations(`[${source}]`, REGISTRY_FILE)) {
        const kind = c.kind === 'section' ? 'dossier' : c.kind;
        out.push({ ...c, kind, id: kind === 'dossier' ? c.code : c.id, section: null, line: lineOf(text, at), offset: at, raw: `${rule.id}: ${source}`, where: 'code' });
      }
    }
  }
  return out;
}

/**
 * Em dashes in the prose of one file: count, words and rate per 1,000 words (lib/text emDashRate on the prose with
 * code, comments and URLs blanked), the lines they sit on, and how many sit in code (not counted).
 * @param {string} text
 * @param {string} file
 * @returns {DashCount}
 */
export function countDashes(text, file) {
  const { code, other } = nonProseRanges(text);
  const prose = blank(text, [...code, ...other]);
  const rate = emDashRate(prose);
  /** @type {number[]} */
  const lines = [];
  for (let at = prose.indexOf(EM_DASH); at >= 0; at = prose.indexOf(EM_DASH, at + 1)) lines.push(lineOf(prose, at));
  const inCode = code.reduce((n, [s, e]) => n + (text.slice(s, e).split(EM_DASH).length - 1), 0);
  return { file, count: rate.count, words: rate.words, per1000: round(rate.per1000), inCode, lines: [...new Set(lines)] };
}

/**
 * @param {number} n
 * @returns {number}
 */
function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Checks every citation of the citing files against the research index and counts em dashes.
 * @param {{root?: string, strict?: boolean}} [options]
 * @returns {RefsReport}
 */
export function checkRefs({ root = SKILL_ROOT, strict = false } = {}) {
  const base = path.resolve(root);
  const researchDir = path.join(base, 'research');
  if (!existsSync(researchDir) || !statSync(researchDir).isDirectory()) {
    throw new UsageError(`no research folder at ${toPosix(researchDir)}; pass --root <the skill folder>`);
  }
  const index = indexResearch(researchDir);
  const files = citingFiles(base);
  /** @type {Citation[]} */
  const citations = [];
  /** @type {DashCount[]} */
  const dashes = [];
  for (const file of files) {
    const text = readText(path.join(base, file));
    citations.push(...extractCitations(text, file));
    dashes.push(countDashes(text, file));
  }
  if (existsSync(path.join(base, REGISTRY_FILE))) {
    citations.push(...registryCitations(readText(path.join(base, REGISTRY_FILE))));
    files.push(REGISTRY_FILE);
  }
  /** @type {Problem[]} */
  const problems = [];
  /** @type {Problem[]} */
  const warnings = [];
  for (const c of citations) {
    const problem = judge(c, index);
    if (!problem) continue;
    if (problem.problem === 'unresolved-section' && !strict) warnings.push(problem);
    else problems.push(problem);
  }
  const count = (/** @type {Problem['problem']} */ kind) => [...problems, ...warnings].filter((p) => p.problem === kind).length;
  const words = dashes.reduce((n, d) => n + d.words, 0);
  const total = dashes.reduce((n, d) => n + d.count, 0);
  return {
    ok: problems.length === 0,
    tool: 'check-refs',
    root: toPosix(base),
    strict,
    files,
    counts: {
      citations: citations.length,
      findings: citations.filter((c) => c.kind === 'finding').length,
      dossiers: citations.filter((c) => c.kind === 'dossier').length,
      sections: citations.filter((c) => c.kind === 'section').length,
      distinctFindings: new Set(citations.filter((c) => c.kind === 'finding').map((c) => c.id)).size,
      missing: count('missing'),
      dropped: count('dropped'),
      missingDossiers: count('missing-dossier'),
      unresolvedSections: count('unresolved-section'),
    },
    problems,
    warnings,
    duplicates: index.duplicates,
    emDashes: {
      total,
      inCode: dashes.reduce((n, d) => n + d.inCode, 0),
      words,
      per1000: words > 0 ? round((total * 1000) / words) : 0,
      files: dashes,
    },
  };
}

/**
 * @param {Citation} c
 * @param {ResearchIndex} index
 * @returns {Problem | null}
 */
function judge(c, index) {
  if (c.kind === 'finding') {
    const found = index.findings.get(c.id);
    if (found && found.dropped) {
      return { ...c, problem: 'dropped', hint: `${found.file}:${found.line} was dropped at verification; cite a surviving finding` };
    }
    if (found) return null;
    const off = index.misleveled.get(c.id);
    const hint = off
      ? `${off.file}:${off.line} has it as a level-${off.level} heading; findings are "### ${c.id}"`
      : index.dossiers.has(c.code)
        ? `no "### ${c.id}" heading in ${(index.dossiers.get(c.code) ?? []).join(', ')}`
        : `no dossier ${c.code} in research/`;
    return { ...c, problem: 'missing', hint };
  }
  if (!index.dossiers.has(c.code)) return { ...c, problem: 'missing-dossier', hint: `no "### ${c.code}-Fnn" heading in any research/*.md` };
  if (c.kind === 'dossier') return null;
  const headings = (index.dossiers.get(c.code) ?? []).flatMap((f) => index.headings.get(f) ?? []);
  if (sectionResolves(c.section ?? '', headings)) return null;
  return { ...c, problem: 'unresolved-section', hint: `no heading of ${(index.dossiers.get(c.code) ?? []).join(', ')} starts with "${c.section}"` };
}

/**
 * Human lines for stderr.
 * @param {RefsReport} report
 * @returns {string[]}
 */
export function describe(report) {
  const lines = [];
  for (const p of report.problems) lines.push(`${p.file}:${p.line}: ${p.problem} ${p.raw} (${p.hint})`);
  for (const w of report.warnings) lines.push(`${w.file}:${w.line}: warning: ${w.problem} [${w.raw}] (${w.hint})`);
  for (const d of report.duplicates) lines.push(`warning: ${d.id} is defined twice (${d.first} and ${d.again})`);
  const c = report.counts;
  lines.push(
    `check-refs: ${report.files.length} files, ${c.citations} citations (${c.findings} findings, ${c.distinctFindings} distinct; ` +
      `${c.dossiers} dossiers; ${c.sections} sections): ${c.missing} missing, ${c.dropped} dropped, ${c.missingDossiers} missing dossiers, ` +
      `${c.unresolvedSections} unresolved sections${report.strict ? '' : ' (warnings)'}`,
  );
  const e = report.emDashes;
  lines.push(`em dashes in prose: ${e.total} in ${e.words} words (${e.per1000} per 1,000)${e.inCode ? `, ${e.inCode} more in code (not counted)` : ''}`);
  for (const d of e.files.filter((f) => f.count > 0)) {
    const shown = d.lines.slice(0, MAX_LINES_LISTED).join(', ');
    lines.push(`  ${d.file}: ${d.count} (${d.per1000} per 1,000 words), lines ${shown}${d.lines.length > MAX_LINES_LISTED ? ', ...' : ''}`);
  }
  lines.push(report.ok ? 'check-refs: ok' : `check-refs: FAIL (${report.problems.length} problem${report.problems.length === 1 ? '' : 's'})`);
  return lines;
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
export function main(argv) {
  const { values, positionals } = parseCli(argv, {
    help: HELP,
    allowPositionals: false,
    options: {
      root: { type: 'string' },
      strict: { type: 'boolean' },
      json: { type: 'boolean' },
    },
  });
  if (positionals.length > 0) throw new UsageError(`unexpected argument ${positionals[0]}; run with --help for usage`);
  if (values.root === '') throw new UsageError('--root needs the skill folder');
  const report = checkRefs({ root: values.root ?? SKILL_ROOT, strict: Boolean(values.strict) });
  for (const line of describe(report)) process.stderr.write(`${line}\n`);
  if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) {
    throw new CheckError(`${report.problems.length} citation problem(s); fix each cited id or add the finding it names to research/`);
  }
  return 0;
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
