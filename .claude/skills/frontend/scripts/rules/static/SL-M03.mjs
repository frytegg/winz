// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-M03';
/** Test and story files are never rendered to the jury; demo data in mocks/ or fixtures/ often is, so it stays in. */
const NOT_SHIPPED = /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|tests?|spec|stories|storybook|e2e|cypress|playwright)\/|\.(?:test|spec|stories|story)\.[cm]?[jt]sx?$/i;
/** A zero-padded marker standing alone as a text node or a string value: 01, 02., 03 /, 04 — */
const PADDED_TEXT = /(?<![=\-])>\s*(0[1-9])\s*[./:)—–-]?\s*</g;
const PADDED_STRING = /(["'`])(0[1-9])[./:)]?\1/g;
/** Index-generated zero padding inside a list render: `0${i + 1}`, String(i + 1).padStart(2, '0'). */
const GENERATED = /`0\$\{\s*[A-Za-z_$][\w$]*\s*\+\s*1\s*\}`|(?:String\(\s*\(?\s*[A-Za-z_$][\w$]*\s*\+\s*1\s*\)?\s*\)|\(\s*[A-Za-z_$][\w$]*\s*\+\s*1\s*\)(?:\.toString\(\))?|`\$\{\s*[A-Za-z_$][\w$]*\s*\+\s*1\s*\}`)\s*\.padStart\(\s*2\s*,\s*["'`]0["'`]\s*\)/g;
const LEADING_ZERO_COUNTER = /decimal-leading-zero/g;
const STEP = /\bStep\s+([1-9])\b(?!\s*(?:of|\/)\s*\d)/gi;
/** Markers count as one run when they sit within this many lines of each other. */
const RUN_SPAN_LINES = 60;
/** Zero-padded strings that are form values or date and time parts, not markers. */
const CALENDAR_KEY = /(?:\b(?:value|key)\s*=\s*\{?|\b(?:value|key|month|day|hour|minute|second|mm|dd|hh)\s*:\s*)$/i;
const CLOCK_LIST = /(["'`])00\1\s*,\s*(["'`])01\2|(["'`])09\3\s*,\s*(["'`])10\4/;

/**
 * A literal clock or calendar list ('00', '01' ... or '09', '10' ...): zero padding there is a format, not a marker.
 * @param {string} code
 * @returns {boolean}
 */
function clockOrCalendar(code) {
  return CLOCK_LIST.test(code);
}

/**
 * Numbered 01/02/03 markers (FD10 M03, FD15-F06: "Many generic designs use numbered markers (01 / 02 / 03), but that's
 * only appropriate if the content actually is a sequence"). Fires on an ascending run of at least three zero-padded
 * markers or "Step N" labels in one file, on index-generated zero padding and on CSS leading-zero counters. Whether the
 * content really is a sequence (a process, a timeline) is the waiver's question, not the detector's.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if (file.kind === 'json' || NOT_SHIPPED.test(file.path)) continue;
    const code = file.code;
    const padded = [
      ...[...code.matchAll(PADDED_TEXT)].map((m) => ({ index: (m.index ?? 0) + m[0].indexOf(m[1]), n: Number(m[1]) })),
      ...[...code.matchAll(PADDED_STRING)]
        .filter((m) => !CALENDAR_KEY.test(code.slice(Math.max(0, (m.index ?? 0) - 16), m.index ?? 0)))
        .map((m) => ({ index: (m.index ?? 0) + 1, n: Number(m[2]) })),
    ].sort((a, b) => a.index - b.index);
    const run = clockOrCalendar(code) ? null : ascendingRun(file, padded);
    if (run) findings.push(finding(file, run.index, run.labels, `zero-padded markers ${run.labels.join(', ')} in one block; keep numbers only where order is information (a real process or timeline)`));
    const steps = [...code.matchAll(STEP)].map((m) => ({ index: m.index ?? 0, n: Number(m[1]) }));
    const stepRun = ascendingRun(file, steps);
    if (stepRun) findings.push(finding(file, stepRun.index, stepRun.labels.map((l) => `Step ${Number(l)}`), 'Step 1, 2, 3 markers beside headings; keep them only for a real sequence the user follows'));
    for (const m of code.matchAll(GENERATED)) {
      findings.push(finding(file, m.index ?? 0, m[0], 'list index rendered as a zero-padded 01/02/03 marker'));
    }
    for (const m of code.matchAll(LEADING_ZERO_COUNTER)) {
      findings.push(finding(file, m.index ?? 0, 'decimal-leading-zero', 'CSS counter rendered as 01/02/03 markers'));
    }
  }
  return findings;
}

/**
 * The first run 1, 2, 3 (and on) of markers in source order within RUN_SPAN_LINES, or null.
 * @param {SourceFile} file
 * @param {Array<{index: number, n: number}>} marks
 * @returns {{index: number, labels: string[]} | null}
 */
function ascendingRun(file, marks) {
  for (let i = 0; i < marks.length; i += 1) {
    if (marks[i].n !== 1) continue;
    const startLine = lineOf(file.text, marks[i].index);
    let expect = 2;
    const labels = ['01'];
    for (let j = i + 1; j < marks.length; j += 1) {
      if (lineOf(file.text, marks[j].index) - startLine > RUN_SPAN_LINES) break;
      if (marks[j].n === expect) {
        labels.push(`0${expect}`);
        expect += 1;
      }
    }
    if (labels.length >= 3) return { index: marks[i].index, labels };
  }
  return null;
}

/**
 * @param {SourceFile} file
 * @param {number} index
 * @param {unknown} value
 * @param {string} detail
 * @returns {StaticFinding}
 */
function finding(file, index, value, detail) {
  return { rule: RULE, layer: 'static', file: file.path, line: lineOf(file.text, index), excerpt: excerpt(file.text, index), value, detail };
}

/**
 * The source line at `index`, trimmed, cut to a 120-character window around the match.
 * @param {string} text
 * @param {number} index
 * @returns {string}
 */
function excerpt(text, index) {
  const start = index > 0 ? text.lastIndexOf('\n', index - 1) + 1 : 0;
  const stop = text.indexOf('\n', index);
  const end = stop < 0 ? text.length : stop;
  const line = text.slice(start, end).trim();
  if (line.length <= 120) return line;
  const from = Math.max(start, Math.min(index - 40, end - 120));
  return text.slice(from, from + 120).trim();
}
