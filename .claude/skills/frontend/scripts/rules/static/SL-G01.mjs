// @ts-check
import path from 'node:path';
import { readText, toPosix, walk } from '../../lib/fsutil.mjs';
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 * @typedef {{file: string, text: string, index: number, what: string}} Signature
 */

const RULE = 'SL-G01';
/** Module specifiers pinned inside the import string ("@radix-ui/react-slot@1.1.2"), 67 and 68 per export (FD14-F04). */
const PINNED = /\b(?:from\s+|import\s*\(\s*|import\s+)(["'])(@?[a-z0-9][\w.-]*(?:\/[\w.-]+)*)@(\d+\.\d+\.\d+)\1/g;
const IMAGE_WITH_FALLBACK_FILE = /(?:^|\/)figma\/ImageWithFallback\.(?:tsx|jsx|ts|js)$/;
const IMAGE_WITH_FALLBACK_IMPORT = /\bImageWithFallback\b[^;\n]*from\s+["'][^"']*figma\/ImageWithFallback["']/;
/** Figma Make's base-typography guard (FD14-F26), quotes and spacing normalised. */
const GUARD = /:where\(\s*:not\(\s*:has\(\s*\[class\*=\s*["']\s?text-["']\s*\]\s*\)\s*,\s*:not\(\s*:has\(\s*\[class\^=\s*["']text-["']\s*\]/;
const ATTRIBUTION = 'Figma Make';
const GUIDELINES = 'Use this file to provide the AI with rules and guidelines you want it to follow';
const BUNDLE = /This is a code bundle for (.+?)\.\s+The original project is available at https:\/\/www\.figma\.com\/design\//;

/**
 * An unrefined Figma Make export (FD14-F04, F26): module specifiers pinned inside import strings, the
 * components/figma/ImageWithFallback helper, an Attributions.md naming Figma Make, the Guidelines.md template, the
 * README's "code bundle" line, the guarded base-typography selector, and a page title that is still the Figma file's
 * name. The detector has no runtime layer, so it reports once per project and lists every signature found.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {Signature[]} */
  const signatures = [];
  let pinnedCount = 0;
  /** @type {Set<string>} */
  const pinnedFiles = new Set();
  /** @type {Signature | null} */
  let firstPinned = null;
  for (const file of ctx.files) {
    if (file.kind === 'json') continue;
    if (file.kind !== 'css' && file.kind !== 'html') {
      for (const m of file.code.matchAll(PINNED)) {
        pinnedCount += 1;
        pinnedFiles.add(file.path);
        firstPinned ??= { file: file.path, text: file.text, index: m.index ?? 0, what: 'module specifiers pinned inside import strings' };
      }
      if (IMAGE_WITH_FALLBACK_FILE.test(file.path)) {
        signatures.push({ file: file.path, text: file.text, index: 0, what: 'the components/figma/ImageWithFallback helper' });
      } else {
        const imported = IMAGE_WITH_FALLBACK_IMPORT.exec(file.code);
        if (imported) signatures.push({ file: file.path, text: file.text, index: imported.index, what: 'an import of figma/ImageWithFallback' });
      }
    }
    const guard = GUARD.exec(file.code);
    if (guard) signatures.push({ file: file.path, text: file.text, index: guard.index, what: "the :where(:not(:has([class*=' text-'])...)) base-typography guard" });
  }
  if (firstPinned) signatures.push({ ...firstPinned, what: `${pinnedCount} module specifiers pinned inside import strings in ${pinnedFiles.size} file(s)` });
  signatures.push(...markdownSignatures(ctx));
  if (signatures.length === 0) return [];
  const first = signatures[0];
  return [{
    rule: RULE,
    layer: 'static',
    file: first.file,
    line: first.text ? lineOf(first.text, first.index) : 0,
    excerpt: first.text ? excerpt(first.text, first.index) : '',
    value: signatures.map((s) => s.what),
    detail: `unrefined Figma Make export: ${signatures.map((s) => `${s.what} (${s.file}${s.text ? `:${lineOf(s.text, s.index)}` : ''})`).join('; ')}; treat the export as a wireframe and replace its visual layer`,
  }];
}

/**
 * Signatures in the export's Markdown files and the page title, read from the repository root.
 * @param {StaticContext} ctx
 * @returns {Signature[]}
 */
function markdownSignatures(ctx) {
  const root = typeof ctx.root === 'string' ? ctx.root : null;
  if (!root) return [];
  /** @type {Signature[]} */
  const out = [];
  /** @type {string | null} */
  let bundleName = null;
  for (const rel of shippedPaths(ctx, walk(root, { include: ['Attributions.md', 'Guidelines.md', 'README.md'], exclude: privateExcludes(root, ctx) }))) {
    const text = readText(path.join(root, rel));
    const base = path.posix.basename(rel);
    if (base === 'Attributions.md' && text.includes(ATTRIBUTION)) {
      out.push({ file: rel, text, index: text.indexOf(ATTRIBUTION), what: 'an Attributions.md naming Figma Make' });
    } else if (base === 'Guidelines.md' && text.includes(GUIDELINES)) {
      out.push({ file: rel, text, index: text.indexOf(GUIDELINES), what: "Figma Make's Guidelines.md template addressed to the AI" });
    } else if (base === 'README.md') {
      const bundle = BUNDLE.exec(text);
      if (bundle) {
        bundleName = bundle[1].trim();
        out.push({ file: rel, text, index: bundle.index, what: 'a README describing the code as a Figma Make bundle' });
      }
    }
  }
  if (bundleName) {
    const title = new RegExp(`<title>\\s*${bundleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</title>`, 'i');
    for (const file of ctx.files) {
      const m = file.kind === 'html' ? title.exec(file.code) : null;
      if (m) out.push({ file: file.path, text: file.text, index: m.index, what: `a page title that is still the Figma file name ("${bundleName}")` });
    }
  }
  return out;
}

/**
 * The walked paths the static layer judges: the context's shipped UI surface (rules/load.mjs shippedSources), or
 * every path when the context carries none.
 * @param {StaticContext} ctx
 * @param {string[]} paths
 * @returns {string[]}
 */
function shippedPaths(ctx, paths) {
  return typeof ctx.surface?.keep === 'function' ? ctx.surface.keep(paths) : paths;
}

/**
 * The private workspace and research folders the profile places inside the root (sourceFiles skips them too).
 * @param {string} root
 * @param {StaticContext} ctx
 * @returns {string[]}
 */
function privateExcludes(root, ctx) {
  /** @type {string[]} */
  const out = [];
  for (const dir of [ctx.profile?.workspace?.private_dir, ctx.profile?.paths?.research]) {
    if (!dir) continue;
    const rel = path.relative(path.resolve(root), path.resolve(dir));
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) out.push(`${toPosix(rel)}/**`);
  }
  return out;
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
