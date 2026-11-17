// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 * @typedef {{index: number, text: string, kind: 'text' | 'prop' | 'url'}} Rendered
 */

const RULE = 'SL-X02';
const MARKUP = new Set(['js', 'jsx', 'tsx', 'html', 'vue', 'svelte']);
/** "Test fixtures not rendered" is the documented false positive. */
const NOT_SHIPPED = /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|tests?|spec|stories|storybook|e2e|cypress|playwright)\/|\.(?:test|spec|stories|story)\.[cm]?[jt]sx?$/i;
const PLACEHOLDERS = [
  { re: /\bAcme\b/gi, what: 'the placeholder company "Acme"', kinds: ['text', 'prop'] },
  { re: /\b(?:John|Jane)\s+Doe\b/gi, what: 'a placeholder person', kinds: ['text', 'prop'] },
  { re: /\blorem\s+ipsum\b|\bdolor\s+sit\s+amet\b/gi, what: 'lorem ipsum filler', kinds: ['text', 'prop'] },
  { re: /\bTODO\b/g, what: 'a TODO in text the jury reads', kinds: ['text', 'prop'] },
  { re: /\bexample\.(?:com|org|net)\b/gi, what: 'an example.com placeholder', kinds: ['text', 'prop', 'url'] },
  { re: /\[\s*YOUR\b[^\]\n]{0,40}\]/gi, what: 'a [YOUR ...] slot never filled', kinds: ['text', 'prop'] },
];
const TEXT_NODE = /(?<![=\-])>([^<>{}]+)</g;
const BRACED_TEXT = /\{\s*(["'`])((?:\\.|(?!\1)[^\\\n])*)\1\s*\}/g;
/** Props and fields whose string value is shown to the user. */
const TEXT_PROP = /\b(?:title|label|description|alt|aria-label|heading|headline|subtitle|tagline|text|content|caption|body|name|author|company|role|quote|message|cta|summary|excerpt)\s*[:=]\s*\{?\s*(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const URL_PROP = /\b(?:href|src|action|url|link|website|image|avatar|logo|to)\s*[:=]\s*\{?\s*(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

/**
 * Placeholder names and copy in rendered text (FD13, FD10; the Claude Design type: "No filler, invented stats or lorem
 * ipsum; missing facts become placeholders like [YOUR PRICE]", FD10-F04, which must be filled before a jury sees
 * them). Looks at markup text, text-bearing props and fields, and link or image targets (for example.com), and skips
 * tests, stories and fixtures. Input `placeholder` hints are not content and are not read.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if (file.kind === 'json' || file.kind === 'css' || NOT_SHIPPED.test(file.path)) continue;
    const rendered = renderedText(file);
    for (const r of rendered) {
      for (const { re, what, kinds } of PLACEHOLDERS) {
        if (!kinds.includes(r.kind)) continue;
        for (const m of r.text.matchAll(re)) {
          findings.push(finding(file, r.index + (m.index ?? 0), m[0], `${what} in rendered ${r.kind === 'url' ? 'link or image target' : 'text'}; use real content from the brief, or a visible "not yet verified" state`));
        }
      }
    }
  }
  return dedupe(findings);
}

/**
 * Text a user sees, with its position: markup text nodes and braced string children, text-bearing props and fields,
 * and link or image targets.
 * @param {SourceFile} file
 * @returns {Rendered[]}
 */
function renderedText(file) {
  const code = file.code;
  /** @type {Rendered[]} */
  const out = [];
  if (MARKUP.has(file.kind)) {
    const markup = file.kind === 'html' || file.kind === 'vue' || file.kind === 'svelte' ? blankScriptsAndStyles(code) : code;
    for (const m of markup.matchAll(TEXT_NODE)) out.push({ index: (m.index ?? 0) + 1, text: m[1], kind: 'text' });
    for (const m of code.matchAll(BRACED_TEXT)) out.push({ index: (m.index ?? 0) + m[0].indexOf(m[2]), text: m[2], kind: 'text' });
  }
  for (const m of code.matchAll(TEXT_PROP)) out.push({ index: (m.index ?? 0) + m[0].lastIndexOf(m[2]), text: m[2], kind: 'prop' });
  for (const m of code.matchAll(URL_PROP)) out.push({ index: (m.index ?? 0) + m[0].lastIndexOf(m[2]), text: m[2], kind: 'url' });
  return out;
}

/**
 * The code with `<script>` and `<style>` element contents blanked (same length), so their code is not read as text.
 * @param {string} code
 * @returns {string}
 */
function blankScriptsAndStyles(code) {
  return code.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (_, open, _tag, inner, close) => open + inner.replace(/[^\n]/g, ' ') + close);
}

/**
 * @param {StaticFinding[]} findings
 * @returns {StaticFinding[]}
 */
function dedupe(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.file}:${f.line}:${String(f.value).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
