// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-M06';
/** Test and story files are never rendered to the jury; demo data in mocks/ or fixtures/ often is, so it stays in. */
const NOT_SHIPPED = /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|tests?|spec|stories|storybook|e2e|cypress|playwright)\/|\.(?:test|spec|stories|story)\.[cm]?[jt]sx?$/i;
const FAQ_HEADING = /\bfrequently[\s-]+asked(?:\s+questions)?\b|(?<![\w-])FAQs?(?![\w-])/gi;
const ITEM_TAGS = /<details\b|<(?:Accordion|Disclosure)\.?Item\b|<AccordionItem\b|<Disclosure\b(?!\.(?:Button|Panel))|<Collapsible\b(?!Trigger|Content)/g;
const ACCORDION_USE = /<details\b|<Accordion\b|<Disclosure\b|<Collapsible\b|\.map\(/;
const QA_ARRAY = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*\[/g;
const QUESTION_KEY = /\b(?:question|q|title)\s*:/g;
const ANSWER_KEY = /\b(?:answer|a|content|body)\s*:/g;
/** "3 or more items" is the catalogue's threshold (FD10 M06). */
const MIN_ITEMS = 3;

/**
 * An FAQ accordion of three or more items under a "Frequently asked" or "FAQ" heading (FD10 M06; Krebs's
 * faq_accordion fired on 15.5% of 982 Show HN pages, FD10-F11). Items are counted as rendered tags in the file, or as
 * the entries of a question-and-answer array anywhere in the project when the heading's file maps over data.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  const dataItems = Math.max(0, ...ctx.files.map(questionArrayEntries));
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if (file.kind === 'json' || file.kind === 'css' || file.kind === 'ts' || NOT_SHIPPED.test(file.path)) continue;
    const code = file.code;
    const heading = rendered(code, FAQ_HEADING);
    if (heading < 0) continue;
    const tags = [...code.matchAll(ITEM_TAGS)].length;
    const local = questionArrayEntries(file);
    const items = Math.max(tags, ACCORDION_USE.test(code) ? Math.max(local, dataItems) : 0);
    if (items >= MIN_ITEMS) {
      findings.push(finding(file, heading, items, `FAQ accordion with ${items} items; answer the jury's questions inside the product narrative instead`));
    }
  }
  return findings;
}

/**
 * Index of the first match of `re` in text a user would read (a text node or a string literal), or -1.
 * @param {string} code
 * @param {RegExp} re
 * @returns {number}
 */
function rendered(code, re) {
  for (const m of code.matchAll(re)) {
    const at = m.index ?? 0;
    const before = code.slice(Math.max(0, at - 200), at);
    const inText = /(?<![=\-])>[^<>{}]*$/.test(before);
    const inString = /(["'`])[^"'`\n]*$/.test(before.slice(before.lastIndexOf('\n') + 1));
    if (inText || inString) return at;
  }
  return -1;
}

/**
 * Entries of the largest question-and-answer array declared in a file.
 * @param {SourceFile} file
 * @returns {number}
 */
function questionArrayEntries(file) {
  if (file.kind === 'json' || file.kind === 'css') return 0;
  let best = 0;
  for (const m of file.code.matchAll(QA_ARRAY)) {
    if (!/faq|question|qa\b|q_?and_?a/i.test(m[1])) continue;
    const open = (m.index ?? 0) + m[0].length - 1;
    const close = file.code.indexOf('];', open);
    const body = file.code.slice(open, close < 0 ? Math.min(file.code.length, open + 20000) : close);
    const entries = Math.min([...body.matchAll(QUESTION_KEY)].length, [...body.matchAll(ANSWER_KEY)].length);
    best = Math.max(best, entries);
  }
  return best;
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
