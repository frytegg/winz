// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-M05';
/** Test and story files are never rendered to the jury; demo data in mocks/ or fixtures/ often is, so it stays in. */
const NOT_SHIPPED = /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|tests?|spec|stories|storybook|e2e|cypress|playwright)\/|\.(?:test|spec|stories|story)\.[cm]?[jt]sx?$/i;
/** Stock-avatar services named by FD10 M05. */
const AVATAR_SERVICE = /\b(?:randomuser\.me|(?:i\.)?pravatar\.cc)\b/g;
const ARRAY_DECL = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*\[/g;
const TESTIMONIAL_NAME = /testimonial|review|quote|endorsement|praise/i;
const PERSON_KEY = /\b(?:name|author|by|person|handle)\s*:/g;
const QUOTE_KEY = /\b(?:quote|text|content|body|testimonial|review|comment|message)\s*:/g;
const PERSON_VALUE = /\b(?:name|author)\s*:\s*(["'`])([^"'`\n]{1,60})\1/g;
const TESTIMONIAL_TAG = /<Testimonial(?:Card|Item)?\b([^>]*)>/g;
const TRUSTED = /\btrusted\s+by\b/gi;
const LOGO_SIGN = /<img\b|<Image\b|<svg\b|\blogo/gi;
const LOGO_MAP = /\b(?:logos|partners|clients|companies|brands|customers|sponsors)\b\s*\.map\(/i;
/** How far below a "Trusted by" label the logo row may start. */
const WALL_SPAN_LINES = 25;

/**
 * Fabricated social proof (FD10 M05, FD10-F28): testimonial arrays with names and quotes, stock-avatar services, and a
 * "Trusted by" label over a row of logos that link nowhere. Real partners with permission are the false positive;
 * the waiver records the permission.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if (file.kind === 'json' || file.kind === 'css' || NOT_SHIPPED.test(file.path)) continue;
    const code = file.code;
    for (const m of code.matchAll(AVATAR_SERVICE)) {
      findings.push(finding(file, m.index ?? 0, m[0], `stock avatar service ${m[0]}: a face for a person who does not exist`));
    }
    for (const m of code.matchAll(ARRAY_DECL)) {
      if (!TESTIMONIAL_NAME.test(m[1])) continue;
      const open = (m.index ?? 0) + m[0].length - 1;
      const close = matching(code, open);
      if (close < 0) continue;
      const body = code.slice(open, close);
      const people = [...body.matchAll(PERSON_KEY)].length;
      const quotes = [...body.matchAll(QUOTE_KEY)].length;
      if (people < 2 || quotes < 2) continue;
      const names = [...body.matchAll(PERSON_VALUE)].map((p) => p[2]).slice(0, 6);
      findings.push(finding(file, m.index ?? 0, names, `testimonial array "${m[1]}" with ${people} named quotes; omit them, or cite real relations the brief can source`));
    }
    const tags = [...code.matchAll(TESTIMONIAL_TAG)].filter((t) => /\bname\s*=\s*["']/.test(t[1]) && /\b(?:quote|text|content)\s*=\s*["']/.test(t[1]));
    if (tags.length >= 2) {
      findings.push(finding(file, tags[0].index ?? 0, tags.length, `${tags.length} testimonial cards with literal names and quotes`));
    }
    for (const m of code.matchAll(TRUSTED)) {
      const at = m.index ?? 0;
      const window = linesAfter(code, at, WALL_SPAN_LINES);
      const logos = [...window.matchAll(LOGO_SIGN)].length;
      if ((logos >= 3 || LOGO_MAP.test(window)) && !/\bhref\s*=|<a\b|<Link\b/.test(window)) {
        findings.push(finding(file, at, m[0], `"${m[0]}" over a row of logos with no links; show only partners the project can source, linked`));
      }
    }
  }
  return findings;
}

/**
 * @param {string} code
 * @param {number} at
 * @param {number} count
 * @returns {string}
 */
function linesAfter(code, at, count) {
  let end = at;
  for (let n = 0; n < count && end >= 0; n += 1) end = code.indexOf('\n', end + 1);
  return code.slice(at, end < 0 ? code.length : end);
}

/**
 * Index of the bracket closing the one at `open` ([, { or (), skipping strings; -1 when unbalanced.
 * @param {string} code
 * @param {number} open
 * @returns {number}
 */
function matching(code, open) {
  const pairs = /** @type {Record<string, string>} */ ({ '[': ']', '{': '}', '(': ')' });
  const stack = [];
  for (let i = open; i < code.length && i - open < 200000; i += 1) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      const end = stringEnd(code, i);
      if (end < 0) return -1;
      i = end;
    } else if (c in pairs) {
      stack.push(pairs[c]);
    } else if (c === ']' || c === '}' || c === ')') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/**
 * @param {string} code
 * @param {number} start index of the opening quote
 * @returns {number} index of the closing quote, or -1
 */
function stringEnd(code, start) {
  const quote = code[start];
  for (let i = start + 1; i < code.length; i += 1) {
    const c = code[i];
    if (c === '\\') i += 1;
    else if (c === quote) return i;
    else if (quote !== '`' && c === '\n') return i - 1;
  }
  return -1;
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
