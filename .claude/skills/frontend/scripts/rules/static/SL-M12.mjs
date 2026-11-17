// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-M12';
/** Test and story files are never rendered to the jury; demo data in mocks/ or fixtures/ often is, so it stays in. */
const NOT_SHIPPED = /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|tests?|spec|stories|storybook|e2e|cypress|playwright)\/|\.(?:test|spec|stories|story)\.[cm]?[jt]sx?$/i;
const MARKUP = new Set(['js', 'jsx', 'tsx', 'html', 'vue', 'svelte']);
const H1 = /<h1\b/g;
const CENTRED = /(?<![\w-])(?:[\w-]+:)?text-center(?![\w-])|text-align\s*:\s*center|textAlign\s*:\s*["']center["']|\balign=["']center["']/;
const GET_STARTED = /\bget\s+started\b/i;
const LEARN_MORE = /\blearn\s+more\b/i;
/** The wrapper that centres the hero sits a few lines above the h1; the CTA pair follows within the hero. */
const WRAPPER_LINES = 12;
const HERO_LINES = 60;

/**
 * A centred hero whose calls to action are the generic pair "Get started" and "Learn more" (FD10 M12; Krebs's
 * center_aligned_hero fired on 22.0% of Show HN pages, FD10-F11; FD14-F15 found "Get Started" and "Learn More" in the
 * generator exports). Fires when an h1 is centred (on itself or a wrapper just above) and both labels follow it.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if (!MARKUP.has(file.kind) || NOT_SHIPPED.test(file.path)) continue;
    const lines = file.code.split('\n');
    for (const m of file.code.matchAll(H1)) {
      const at = m.index ?? 0;
      const line = lineOf(file.text, at) - 1;
      const above = lines.slice(Math.max(0, line - WRAPPER_LINES), line + 2).join('\n');
      if (!CENTRED.test(above)) continue;
      const hero = lines.slice(line, line + HERO_LINES).join('\n');
      const start = GET_STARTED.exec(hero);
      const more = LEARN_MORE.exec(hero);
      if (start && more) {
        findings.push(finding(file, at, [start[0], more[0]], `centred h1 followed by "${start[0]}" and "${more[0]}"; let the hero show the protocol working and name the action the CTA performs`));
      }
    }
  }
  return findings;
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
