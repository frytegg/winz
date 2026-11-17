// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-M17';
/** Test and story files are never rendered to the jury; demo data in mocks/ or fixtures/ often is, so it stays in. */
const NOT_SHIPPED = /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|tests?|spec|stories|storybook|e2e|cypress|playwright)\/|\.(?:test|spec|stories|story)\.[cm]?[jt]sx?$/i;
const MARKUP = new Set(['js', 'jsx', 'tsx', 'html', 'vue', 'svelte']);
/** impeccable's phrases "built for the modern" and "trusted by leading" (FD10-F19), generalised to the formula (FD10 M17). */
const FORMULA = /\bbuilt\s+for\s+(?:the\s+)?[\p{L}\p{N}][\p{L}\p{N}-]*|\btrusted\s+by\b(?:\s+[\p{L}\p{N}][\p{L}\p{N},+-]*){0,2}/giu;
const HEADING_ELEMENT = /<(h[1-6]|CardTitle|DialogTitle|SheetTitle)\b[^>]*>([\s\S]*?)<\/\1\s*>/g;
const HEADING_VALUE = /\b(?:title|heading|headline|tagline|subtitle|subheading)\s*[:=]\s*\{?\s*(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

/**
 * "Built for X" and "Trusted by" headline formulas (FD10 M17; impeccable's "built for the modern" and "trusted by
 * leading", FD10-F19; FD14-F15 found "Built for the agentic economy" in a past frontend). Matches the formula in heading
 * elements and in title-like props and fields, which is where the catalogue scopes it, and as a capitalised sentence
 * of the hero's lead paragraph (the first <p> after an <h1>), where agentfi's sits. A real audience statement is
 * the false positive the waiver records.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if (file.kind === 'json' || file.kind === 'css' || NOT_SHIPPED.test(file.path)) continue;
    const code = file.code;
    /** @type {Array<{index: number, text: string, lead?: boolean}>} */
    const headings = [];
    if (MARKUP.has(file.kind)) {
      for (const m of code.matchAll(HEADING_ELEMENT)) {
        headings.push({ index: (m.index ?? 0) + m[0].indexOf(m[2]), text: m[2] });
        if (m[1] === 'h1') {
          const lead = heroLead(code, (m.index ?? 0) + m[0].length);
          if (lead) headings.push(lead);
        }
      }
    }
    for (const m of code.matchAll(HEADING_VALUE)) headings.push({ index: (m.index ?? 0) + m[0].indexOf(m[2]), text: m[2] });
    for (const h of headings) {
      const plain = h.text.replace(/<[^>]*>|\{[^{}]*\}/g, (s) => ' '.repeat(s.length));
      for (const f of plain.matchAll(FORMULA)) {
        if (h.lead && (!/^[BT]/.test(f[0]) || !SENTENCE_START.test(plain.slice(0, f.index)))) continue;
        const phrase = f[0].replace(/\s+/g, ' ').trim();
        findings.push(finding(file, h.index + (f.index ?? 0), phrase, `headline formula "${phrase}": say what the protocol does and for whom`));
      }
    }
  }
  return findings;
}

/** In the lead paragraph the formula counts only as a sentence of its own: "Built for the agentic economy.", not "we built for fun". */
const SENTENCE_START = /(?:^|[.!?]\s+)\s*$/;
const PARAGRAPH = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/g;
/** How far after the h1 the lead paragraph may open: wrapper tags and whitespace only. */
const LEAD_GAP = 800;

/**
 * The hero's lead paragraph: the first <p> after an <h1> with no other text between them (only tags and
 * whitespace), where the hero sentence under the headline sits (FD14-F15: agentfi's "Built for the agentic economy"
 * is in the lead <p>, not the <h1>).
 * @param {string} code
 * @param {number} from index just past the </h1>
 * @returns {{index: number, text: string, lead: boolean} | null}
 */
function heroLead(code, from) {
  PARAGRAPH.lastIndex = from;
  const m = PARAGRAPH.exec(code);
  if (!m || m.index - from > LEAD_GAP) return null;
  const between = code.slice(from, m.index).replace(/<[^>]*>/g, '').trim();
  if (between) return null;
  return { index: m.index + m[0].indexOf(m[1], m[0].indexOf('>')), text: m[1], lead: true };
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
