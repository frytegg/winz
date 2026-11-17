// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 * @typedef {{index: number, text: string}} Stat
 */

const RULE = 'SL-M04';
const MARKUP = new Set(['js', 'jsx', 'tsx', 'html', 'vue', 'svelte']);
const SCRIPT = new Set(['js', 'jsx', 'ts', 'tsx', 'vue', 'svelte']);
/**
 * A headline figure: a count with a magnitude suffix or a plus (10K+, 2.5M, 500+), a percentage, a multiplier (10x),
 * 24/7, or a star rating (4.9★, 4.8/5). Plain numbers, prices without a magnitude, years, versions and ordinals do not
 * match: those are the false positives FD10 M04 lists.
 */
const STAT_SOURCE = String.raw`(?:[$€£]\s?)?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s?(?:[KMB]n?\+?|[kmb]\+|\+|%|[x×](?![\w]))(?![\w%+])|24\/7(?![\w/])|\d\.\d\s?(?:★|\/\s?5\b)`;
const STAT_TOKEN = new RegExp(String.raw`(?<![\w.$€£/])(?:${STAT_SOURCE})`, 'gu');
const PURE_STAT = new RegExp(String.raw`^(?:${STAT_SOURCE})(?:\s+[\p{L}][\p{L}\s'-]{0,30})?$`, 'u');
const STRING = /'(?:\\.|[^\\'\r\n])*'|"(?:\\.|[^\\"\r\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
const TEXT_NODE = /(?<![=\-])>([^<>{}]+)</g;
const CSS_KEY = /\b(?:width|height|top|left|right|bottom|inset|translate[XYZ]?|x|y|size|basis|radius|offset|delay|duration|scale|opacity|margin\w*|padding\w*|gap|max\w*|min\w*|flex\w*|font\w*|line\w*|letter\w*|z\w*|transform\w*|background\w*|stroke\w*|clip\w*)["']?\s*[:=]\s*\{?$/i;
/** A string counts as a figure when it is the value of a field (stats arrays: { value: '10K+', label: 'Users' }); bare array items are enumerations (fee tiers, options) and object keys are keyframe offsets. */
const FIELD_VALUE = /[\w$]["']?\s*:\s*$/;
const BANNER_SEPARATOR = /[·•|]/;
const NOT_SHIPPED = /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|tests?|spec|stories|storybook|e2e|cypress|playwright)\/|\.(?:test|spec|stories|story)\.[cm]?[jt]sx?$/i;
const NUMBER_TICKER = /<NumberTicker\b([^>]*)>/g;
/** Stats count as one banner when at least three sit within this many lines (Krebs: 3 to 6 siblings, FD10-F28). */
const BANNER_SPAN_LINES = 30;

/**
 * A row of headline figures with no source (FD10 M04; FD15-F06 "a big number with a small label, supporting stats";
 * Krebs's stat-banner rule "10K+ users · 99.9% uptime · 4.9★", FD10-F28). Fires on three or more such figures within a
 * few lines when none of them carries data-ledger or data-source, and on Magic UI's NumberTicker fed a literal.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if ((!SCRIPT.has(file.kind) && file.kind !== 'html') || NOT_SHIPPED.test(file.path)) continue;
    const code = file.code;
    /** @type {Stat[]} */
    const stats = [];
    if (MARKUP.has(file.kind)) {
      for (const m of code.matchAll(TEXT_NODE)) {
        const text = m[1].trim();
        const at = (m.index ?? 0) + m[0].indexOf(text);
        const tokens = [...text.matchAll(STAT_TOKEN)].map((t) => t[0].trim());
        if (tokens.length >= 3 && BANNER_SEPARATOR.test(text) && !allocation(tokens) && !sourced(file, at, at)) {
          findings.push(finding(file, at, tokens, `${tokens.length} unsourced figures in one line (${tokens.join(', ')}); render only figures from the claims ledger or a labelled data source`));
        } else if (text.length <= 40 && PURE_STAT.test(text)) {
          stats.push({ index: at, text });
        }
      }
    }
    if (SCRIPT.has(file.kind)) {
      for (const m of code.matchAll(STRING)) {
        const text = m[0].slice(1, -1).trim();
        const at = (m.index ?? 0) + 1;
        if (text.length > 40 || !PURE_STAT.test(text)) continue;
        const before = code.slice(Math.max(0, at - 32), at - 1);
        if (!FIELD_VALUE.test(before) || CSS_KEY.test(before)) continue;
        stats.push({ index: at, text });
      }
    }
    findings.push(...banners(file, stats.sort((a, b) => a.index - b.index)));
    for (const m of code.matchAll(NUMBER_TICKER)) {
      const value = /\bvalue\s*=\s*\{\s*(-?[\d_.]+)\s*\}|\bvalue\s*=\s*["']([\d.,]+)["']/.exec(m[1]);
      if (value) findings.push(finding(file, m.index ?? 0, value[1] ?? value[2], 'Magic UI NumberTicker counting up to a literal figure; bind it to a ledger or data-source value, or show the number plainly'));
    }
  }
  return findings;
}

/**
 * True when every token is a percentage and they add up to about 100: an allocation or a split, not a banner.
 * @param {string[]} tokens
 * @returns {boolean}
 */
function allocation(tokens) {
  if (!tokens.every((t) => t.endsWith('%'))) return false;
  const sum = tokens.reduce((n, t) => n + Number(t.replace(/[^\d.]/g, '')), 0);
  return Math.abs(sum - 100) <= 1;
}

/**
 * Groups of three or more stats within BANNER_SPAN_LINES that carry no data-ledger or data-source nearby.
 * @param {SourceFile} file
 * @param {Stat[]} stats
 * @returns {StaticFinding[]}
 */
function banners(file, stats) {
  /** @type {StaticFinding[]} */
  const out = [];
  let i = 0;
  while (i < stats.length) {
    const firstLine = lineOf(file.text, stats[i].index);
    let j = i;
    while (j + 1 < stats.length && lineOf(file.text, stats[j + 1].index) - firstLine <= BANNER_SPAN_LINES) j += 1;
    const group = stats.slice(i, j + 1);
    const distinct = [...new Set(group.map((s) => s.text))];
    if (distinct.length >= 3 && !sourced(file, group[0].index, group[group.length - 1].index)) {
      out.push(finding(file, group[0].index, distinct.slice(0, 6), `stat banner of ${distinct.length} figures (${distinct.slice(0, 6).join(', ')}) with no data-ledger or data-source; show real, linked data or none`));
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return out;
}

/**
 * True when data-ledger or data-source appears within three lines of the stretch [from, to].
 * @param {SourceFile} file
 * @param {number} from
 * @param {number} to
 * @returns {boolean}
 */
function sourced(file, from, to) {
  const lines = file.code.split('\n');
  const first = Math.max(0, lineOf(file.text, from) - 4);
  const last = Math.min(lines.length, lineOf(file.text, to) + 3);
  return /\bdata-(?:ledger|source)\b|\b(?:ledger|source)Id\b|\bdataSource\s*[:=]/.test(lines.slice(first, last).join('\n'));
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
