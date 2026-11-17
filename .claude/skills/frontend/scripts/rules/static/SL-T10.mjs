// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * SL-T10 static: Lucide icons everywhere. Two signals (FD14-F11): decorative marketing glyphs imported from the
 * Lucide family (Sparkles, Zap, Rocket, Shield, TrendingUp, Trophy, Award, Gift, and FD10's chart variants), and a
 * Lucide-family share of 20% or more of the authored files, at least 3 files (the Figma Make exports were at 23 and
 * 33%, the owner's functional XRPL use at 15%). Lucide family means lucide-react and its framework
 * ports, Tabler (same 24px grid and 2px round strokes, FD16-F20) and inline svgs drawn on that grid. Not counted:
 * functional control icons, a declared dependency nobody imports, library primitives, comments.
 *
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-T10';
const PACKAGES = 'lucide-react|lucide-vue-next|lucide-svelte|@lucide\\/svelte|lucide-preact|lucide-solid|@tabler\\/icons-react|@tabler\\/icons-vue';
const NAMED_IMPORT = new RegExp(`\\bimport\\s*(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"](?:${PACKAGES})(?:@[\\d.]+)?['"]`, 'g');
const ANY_IMPORT = new RegExp(`\\bfrom\\s*['"](?:${PACKAGES})(?:@[\\d.]+)?['"]|\\bimport\\s*\\(\\s*['"](?:${PACKAGES})`);
const DEPENDENCY = new RegExp(`"(?:${PACKAGES})"\\s*:`);
const LUCIDE_GEOMETRY = /<svg\b(?=[^>]*viewBox\s*=\s*['"{]*0 0 24 24)(?=[^>]*stroke-?[wW]idth\s*=\s*['"{]*2\b)(?=[^>]*stroke-?[lL]inecap\s*=\s*['"{]*round)/;
/** Marketing glyphs, not controls: FD14-F11's list, with FD10 S10's chart variants. */
const DECORATIVE = new Set(['Sparkles', 'Sparkle', 'Zap', 'Rocket', 'Shield', 'TrendingUp', 'Trophy', 'Award', 'Gift', 'BarChart3', 'ChartBar', 'BarChart']);
const MIN_SHARE = 0.2;
const MIN_FILES = 3;

/**
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  const files = shippedFiles(ctx);
  /** @type {StaticFinding[]} */
  const out = [];
  const authored = files.filter((f) => f.kind !== 'json');
  const lucide = authored.filter((f) => ANY_IMPORT.test(f.code) || LUCIDE_GEOMETRY.test(f.code));
  for (const file of files) {
    for (const m of file.code.matchAll(NAMED_IMPORT)) {
      let offset = m.index + m[0].indexOf('{') + 1;
      for (const spec of m[1].split(',')) {
        const name = spec.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        const base = name.replace(/^(?:Lucide|Icon)/, '').replace(/Icon$/, '');
        if (DECORATIVE.has(base)) out.push(finding(file, offset + spec.indexOf(name), name, `decorative icon ${name} from the Lucide family (a marketing glyph, FD14-F11)`));
        offset += spec.length + 1;
      }
    }
  }
  const share = authored.length > 0 ? lucide.length / authored.length : 0;
  if (lucide.length >= MIN_FILES && share >= MIN_SHARE) {
    const manifest = files.find((f) => f.kind === 'json' && DEPENDENCY.test(f.code));
    const at = manifest ?? lucide[0];
    const index = manifest ? /** @type {RegExpExecArray} */ (DEPENDENCY.exec(manifest.code)).index : Math.max(0, at.code.search(ANY_IMPORT));
    out.push(finding(at, index, `${lucide.length} of ${authored.length} files`, `Lucide-family icons in ${lucide.length} of ${authored.length} authored files (${Math.round(share * 100)}%)`));
  }
  return unique(out);
}

// ─── shared:files ───
/**
 * Test, spec and story files, test folders, type declarations and the repository's own scripts/ and tools/ folders
 * never reach the judged page.
 */
const NOT_SHIPPED = /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|__stories__|tests?|e2e|cypress|playwright|stories|\.storybook)\/|^(?:scripts|tools)\/|\.(?:test|spec|stories|story|cy|e2e)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/i;
/** shadcn and Figma Make primitives: library code, judged through the files that use it. */
const LIBRARY = /(?:^|\/)components\/(?:ui|figma)\//i;
/** A CSS comment inside one template literal (CSS-in-JS): it never crosses a backtick. */
const TEMPLATE_CSS_COMMENT = /\/\*(?:(?!\*\/)[^`])*\*\//g;

/**
 * The files a detector reads: shipped sources only, never precompiled Tailwind output (it repeats its source,
 * FD14-F23), and library primitives only when asked. Their code also has the CSS comments of CSS-in-JS template
 * literals blanked (string content to the JavaScript comment stripper), same length and lines: comments never count.
 * @param {StaticContext} ctx
 * @param {{library?: boolean}} [options]
 * @returns {SourceFile[]}
 */
function shippedFiles(ctx, { library = false } = {}) {
  return ctx.files
    .filter((f) => !NOT_SHIPPED.test(f.path) && (library || !LIBRARY.test(f.path)) && !f.text.slice(0, 600).includes('/*! tailwindcss v'))
    .map((f) => (f.kind === 'css' || f.kind === 'json' || !f.code.includes('/*')
      ? f
      : { ...f, code: f.code.replace(TEMPLATE_CSS_COMMENT, (m) => m.replace(/[^\n]/g, ' ')) }));
}
// ─── end shared:files ───

// ─── shared:findings ───
/**
 * @param {SourceFile} file
 * @param {number} index offset in file.code
 * @param {unknown} value
 * @param {string} detail
 * @returns {StaticFinding}
 */
function finding(file, index, value, detail) {
  return {
    rule: RULE, layer: 'static', file: file.path, line: lineOf(file.code, index), excerpt: excerptAt(file.code, index),
    value, detail,
  };
}

/**
 * The source line holding `index`, whitespace collapsed, at most 120 characters, centred on the match when the line
 * is longer.
 * @param {string} code
 * @param {number} index
 * @returns {string}
 */
function excerptAt(code, index) {
  const at = Math.max(0, Math.min(index, code.length));
  const start = at > 0 ? code.lastIndexOf('\n', at - 1) + 1 : 0;
  const newline = code.indexOf('\n', at);
  const line = code.slice(start, newline < 0 ? code.length : newline);
  const flat = line.replace(/\s+/g, ' ').trim();
  if (flat.length <= 120) return flat;
  const from = Math.max(0, at - start - 30);
  return line.slice(from, from + 240).replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * One finding per file, line and detail, ordered by file then line.
 * @param {StaticFinding[]} findings
 * @returns {StaticFinding[]}
 */
function unique(findings) {
  const seen = new Set();
  return findings
    .filter((f) => {
      const key = `${f.file}\n${f.line}\n${f.detail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
}
// ─── end shared:findings ───
