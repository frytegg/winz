// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-X01';
const MARKUP = new Set(['js', 'jsx', 'tsx', 'html', 'vue', 'svelte']);
const TAG = /(?<![\w$.)\]])<([A-Za-z][\w.:-]*)\b((?:[^>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*?)(\/?)>/g;
const SOURCED = /\bdata-(?:ledger|source)\s*=/;
const METRIC_ATTR = /\bdata-metric\b/;
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
/** Display sizes a stat tile uses: Tailwind text-3xl and up (30px+), or an arbitrary size of 28px / 1.75rem or more. */
const DISPLAY_SIZE = /(?<![\w-])(?:[\w-]+:)*text-(?:[3-9]xl|\[(?:2[89]|[3-9]\d|\d{3})px\]|\[(?:1\.(?:7[5-9]|[89]\d*)|[2-9](?:\.\d+)?)rem\])(?![\w-])/;
const STAT_TEXT = /^(?:[$€£]\s?)?\d[\d,]*(?:\.\d+)?\s?(?:%|[KMB]n?|[kmb]|x|×)?\+?$/;
const PRICE = /^[$€£]\s?\d[\d,]*(?:\.\d{1,2})?$/;
const YEAR = /^(?:19|20)\d{2}$/;
const HERO_NUMBER = /(?<![\w.\-/#:])(?:[$€£]\s?)?\d+(?:[.,]\d+)*\s?(?:%|[KMB]n?(?![a-z])|x(?![a-z])|×|\+)?(?![\w.\-/:])/g;
const NOT_SHIPPED = /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|tests?|spec|stories|storybook|e2e|cypress|playwright)\/|\.(?:test|spec|stories|story)\.[cm]?[jt]sx?$/i;
/** An error page's status code (404 on not-found.tsx) is not a claim. */
const ERROR_PAGE = /(?:^|\/)(?:not-found|404|500|_error|error|global-error)\.[cm]?[jt]sx?$|(?:^|\/)(?:404|500)\.html?$/i;
const STATUS_CODE = /^[45]\d\d$/;

/**
 * Figures shown as claims with no source (FD01-F12, FD13; CONTRACTS 6.6: a `data-metric` element must also carry
 * `data-ledger` or `data-source`). Reports `data-metric` elements without either, display-size elements whose text is
 * a literal figure or a member of an array literal mapped into them (`stats.map((s) => <p className="text-4xl">
 * {s.value}</p>)`, each claim reported at its literal), and numbers written into the h1 or a `data-hero` element.
 * Figures built at run time (fetched, computed, or text inside a longer string) are the runtime layer's to read. Prices, dates and years, versions,
 * ordinals and single digits are not claims.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if (!MARKUP.has(file.kind) || NOT_SHIPPED.test(file.path)) continue;
    const errorPage = ERROR_PAGE.test(file.path);
    const code = file.code;
    for (const m of code.matchAll(TAG)) {
      const [whole, name, attrs, selfClosing] = m;
      const at = m.index ?? 0;
      const sourced = SOURCED.test(attrs);
      if (METRIC_ATTR.test(attrs) && !sourced) {
        findings.push(finding(file, at, `<${name} data-metric>`, 'data-metric without data-ledger or data-source: trace the figure to the claims ledger or a labelled data source'));
        continue;
      }
      if (sourced || selfClosing) continue;
      const after = code.slice(at + whole.length, at + whole.length + 80);
      const text = /^([^<{]*)</.exec(after)?.[1].trim() ?? '';
      const classes = [...attrs.matchAll(STRING)].map((s) => s[0].slice(1, -1)).join(' ');
      if (text && DISPLAY_SIZE.test(classes) && isClaim(text) && !(errorPage && STATUS_CODE.test(text))) {
        findings.push(finding(file, at + whole.length + after.indexOf(text), text, `stat-styled figure "${text}" with no data-ledger or data-source; render only numbers from the claims ledger or a labelled data source`));
        continue;
      }
      const member = MEMBER_TEXT.exec(after);
      if (member && DISPLAY_SIZE.test(classes)) {
        const mapped = mappedValues(code, at, member[1], member[2]).filter((v) => isClaim(v.text));
        for (const v of mapped) {
          findings.push(finding(file, v.index, v.text, `stat-styled figure "${v.text}" mapped from an array into a display-size element (${member[1]}.${member[2]}) with no data-ledger or data-source; render only numbers from the claims ledger or a labelled data source`));
        }
        if (mapped.length > 0) continue;
      }
      if ((name === 'h1' || /\bdata-hero\s*=/.test(attrs)) && !errorPage) findings.push(...heroNumbers(file, at + whole.length, name));
    }
  }
  return findings;
}

/** The element's text is one member expression: `{s.value}`. */
const MEMBER_TEXT = /^\s*\{\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\}\s*</;

/**
 * The literal values of `field` in the array whose `.map((item) => ...)` callback renders `item.field` at `at`: the
 * dominant generated shape, `const stats = [{ value: '10K+' }, ...]` mapped into `<p className="text-4xl">`
 * (FD14-F22). Empty when the array is not a literal of this file.
 * @param {string} code
 * @param {number} at
 * @param {string} item
 * @param {string} field
 * @returns {Array<{index: number, text: string}>}
 */
function mappedValues(code, at, item, field) {
  const window = code.slice(Math.max(0, at - 3000), at);
  const maps = [...window.matchAll(new RegExp(`([A-Za-z_$][\\w$.]*)\\.map\\(\\s*(?:\\(\\s*)?${item}\\b`, 'g'))];
  const call = maps[maps.length - 1];
  if (!call) return [];
  const array = call[1].split('.').pop() ?? '';
  const decl = new RegExp(`\\b(?:const|let|var)\\s+${array.replace(/\$/g, '\\$')}\\b[^=]*=\\s*\\[`).exec(code);
  if (!decl) return [];
  const open = decl.index + decl[0].length - 1;
  const close = closingBracket(code, open);
  if (close < 0) return [];
  /** @type {Array<{index: number, text: string}>} */
  const out = [];
  const value = new RegExp(`\\b${field.replace(/\$/g, '\\$')}\\s*:\\s*(["'\`])((?:\\\\.|(?!\\1)[^\\\\\\n])*)\\1`, 'g');
  for (const m of code.slice(open, close).matchAll(value)) out.push({ index: open + (m.index ?? 0) + m[0].indexOf(m[2]), text: m[2].trim() });
  return out;
}

/**
 * The index of the ']' closing the '[' at `open`, skipping strings; -1 when it does not close within 20000 characters.
 * @param {string} code
 * @param {number} open
 * @returns {number}
 */
function closingBracket(code, open) {
  let depth = 0;
  let quote = '';
  for (let i = open; i < code.length && i - open < 20000; i += 1) {
    const c = code[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * A literal figure presented as a claim: not a price, a year, or a lone digit.
 * @param {string} text
 * @returns {boolean}
 */
function isClaim(text) {
  if (!STAT_TEXT.test(text) || PRICE.test(text) || YEAR.test(text)) return false;
  return !/^\d$/.test(text);
}

/**
 * Numbers in the text content of the hero element opened just before `start`.
 * @param {SourceFile} file
 * @param {number} start
 * @param {string} name
 * @returns {StaticFinding[]}
 */
function heroNumbers(file, start, name) {
  const code = file.code;
  const close = code.indexOf(`</${name}`, start);
  if (close < 0 || close - start > 2000) return [];
  const content = code.slice(start, close).replace(/<[^>]*>|\{[^{}]*\}/g, (s) => ' '.repeat(s.length));
  /** @type {StaticFinding[]} */
  const out = [];
  for (const m of content.matchAll(HERO_NUMBER)) {
    const number = m[0].trim();
    const digits = number.replace(/\D/g, '');
    if (YEAR.test(number) || (digits.length < 2 && !/[%KMBx×+.]/.test(number))) continue;
    out.push(finding(file, start + (m.index ?? 0), number, `number "${number}" written into the hero copy with no data-ledger or data-source; cite it from the claims ledger or remove it`));
  }
  return out;
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
