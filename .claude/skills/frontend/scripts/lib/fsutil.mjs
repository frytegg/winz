// @ts-check
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './errors.mjs';

/**
 * Folder names skipped at any depth unless `walk(..., {defaultExcludes: false})`: build output, dependencies (npm,
 * Yarn's checked-in releases, Python virtual environments and their site-packages) and the skills' state folders.
 */
export const DEFAULT_EXCLUDES = Object.freeze([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', '.execution', '.frontend', 'vendor',
  '.venv', 'venv', 'site-packages', '__pycache__', '.yarn',
]);

const BOM = String.fromCharCode(0xfeff);

/**
 * @typedef {{include?: string | readonly string[], exclude?: string | readonly string[], defaultExcludes?: boolean,
 *   nocase?: boolean}} WalkOptions
 */

/**
 * Lists the files under `root` as sorted, root-relative POSIX paths. Symbolic links are not followed.
 *
 * Globs: `*` matches within one path segment, `**` across segments (zero or more), `?` one character, `{a,b}`
 * alternatives (nestable). A glob without `/` matches the base name at any depth (gitignore style: `*.tsx`,
 * `node_modules`); a glob with `/` matches the whole relative path from the root (`src/**` also matches `src`).
 * `exclude` prunes folders and drops files; it adds to DEFAULT_EXCLUDES. `include`, when given, keeps only matching
 * files.
 * @param {string} root
 * @param {WalkOptions} [options]
 * @returns {string[]}
 */
export function walk(root, { include, exclude, defaultExcludes = true, nocase = false } = {}) {
  const abs = path.resolve(root);
  let stats;
  try {
    stats = statSync(abs);
  } catch (err) {
    throw new UsageError(`folder not found: ${toPosix(abs)}; pass an existing folder`, { cause: err });
  }
  if (!stats.isDirectory()) throw new UsageError(`not a folder: ${toPosix(abs)}; pass a folder, not a file`);
  const includes = toList(include).map((g) => compileGlob(g, { nocase }));
  const excludes = [...(defaultExcludes ? DEFAULT_EXCLUDES : []), ...toList(exclude)].map((g) => compileGlob(g, { nocase }));
  /** @type {string[]} */
  const files = [];
  /** @param {string} dirAbs @param {string} dirRel */
  const visit = (dirAbs, dirRel) => {
    for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || excludes.some((m) => m(rel))) continue;
      if (entry.isDirectory()) visit(path.join(dirAbs, entry.name), rel);
      else if (entry.isFile() && (includes.length === 0 || includes.some((m) => m(rel)))) files.push(rel);
    }
  };
  visit(abs, '');
  return files.sort();
}

/**
 * Compiles a glob (see `walk`) into a predicate over root-relative POSIX paths.
 * @param {string} glob
 * @param {{nocase?: boolean}} [options]
 * @returns {(relPath: string) => boolean}
 */
export function compileGlob(glob, { nocase = false } = {}) {
  if (typeof glob !== 'string' || glob === '') throw new TypeError('compileGlob: glob must be a non-empty string');
  const alternatives = expandBraces(glob).map((alt) => {
    let g = alt.replace(/\\/g, '/');
    while (g.startsWith('./')) g = g.slice(2);
    g = g.replace(/^\/+/, '').replace(/\/+$/, '');
    return { byBase: !g.includes('/'), re: new RegExp(`^${globSource(g)}$`, nocase ? 'i' : '') };
  });
  return (relPath) => {
    const rel = relPath.replace(/\\/g, '/');
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    return alternatives.some((a) => a.re.test(a.byBase ? base : rel));
  };
}

/**
 * @param {string} glob
 * @param {string} relPath
 * @returns {boolean}
 */
export function matchGlob(glob, relPath) {
  return compileGlob(glob)(relPath);
}

/**
 * Expands the first `{a,b}` group that has a top-level comma, recursively. Unbalanced or comma-less braces stay
 * literal.
 * @param {string} glob
 * @returns {string[]}
 */
function expandBraces(glob) {
  for (let open = 0; open < glob.length; open += 1) {
    if (glob[open] !== '{') continue;
    let depth = 0;
    /** @type {number[]} */
    const commas = [];
    let close = open;
    for (; close < glob.length; close += 1) {
      const c = glob[close];
      if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) break;
      } else if (c === ',' && depth === 1) commas.push(close);
    }
    if (close >= glob.length) return [glob];
    if (commas.length === 0) continue;
    const head = glob.slice(0, open);
    const tail = glob.slice(close + 1);
    const bounds = [open, ...commas, close];
    /** @type {string[]} */
    const out = [];
    for (let i = 0; i + 1 < bounds.length; i += 1) out.push(...expandBraces(head + glob.slice(bounds[i] + 1, bounds[i + 1]) + tail));
    return out;
  }
  return [glob];
}

/**
 * @param {string} glob a brace-free glob with forward slashes and no leading or trailing slash
 * @returns {string}
 */
function globSource(glob) {
  const segments = glob.split('/');
  let out = '';
  let needSeparator = false;
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    if (segment === '**') {
      if (i === 0) out += last ? '.*' : '(?:.*/)?';
      else out += last ? '(?:/.*)?' : '/(?:.*/)?';
      needSeparator = false;
      return;
    }
    if (needSeparator) out += '/';
    out += segment.replace(/\*+|\?|[.+^$()|[\]{}\\]/g, (m) => {
      if (m.startsWith('*')) return '[^/]*';
      if (m === '?') return '[^/]';
      return `\\${m}`;
    });
    needSeparator = true;
  });
  return out;
}

/**
 * @param {string | readonly string[] | undefined} value
 * @returns {string[]}
 */
function toList(value) {
  if (value === undefined || value === null) return [];
  return typeof value === 'string' ? [value] : [...value];
}

/**
 * Reads a UTF-8 text file and strips a leading byte-order mark. A missing file is a UsageError (exit 2).
 * @param {string} file
 * @returns {string}
 */
export function readText(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    throw inputError(err, file);
  }
  return text.startsWith(BOM) ? text.slice(1) : text;
}

/**
 * Writes UTF-8 text with LF line endings and no byte-order mark, creating parent folders. Returns the absolute path
 * with forward slashes.
 * @param {string} file
 * @param {string} text
 * @returns {string}
 */
export function writeText(file, text) {
  const abs = path.resolve(file);
  mkdirSync(path.dirname(abs), { recursive: true });
  let body = String(text).replace(/\r\n?/g, '\n');
  if (body.startsWith(BOM)) body = body.slice(1);
  writeFileSync(abs, body, 'utf8');
  return toPosix(abs);
}

/**
 * SHA-256 of a file's bytes, lowercase hex. Reads in 1 MiB chunks so large media do not load whole.
 * @param {string} file
 * @returns {string}
 */
export function sha256File(file) {
  const hash = createHash('sha256');
  let fd;
  try {
    fd = openSync(file, 'r');
  } catch (err) {
    throw inputError(err, file);
  }
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    for (;;) {
      const n = readSync(fd, buffer, 0, buffer.length, null);
      if (n === 0) break;
      hash.update(buffer.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * SHA-256 of a string's UTF-8 bytes, lowercase hex.
 * @param {string} text
 * @returns {string}
 */
export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * @param {string} p
 * @returns {string}
 */
export function toPosix(p) {
  return p.replace(/\\/g, '/');
}

/**
 * @param {unknown} err
 * @param {string} file
 * @returns {Error}
 */
function inputError(err, file) {
  const code = err instanceof Error && 'code' in err ? /** @type {{code?: unknown}} */ (err).code : undefined;
  const where = toPosix(path.resolve(file));
  if (code === 'ENOENT') return new UsageError(`file not found: ${where}; check the path`, { cause: err });
  if (code === 'EISDIR') return new UsageError(`expected a file but found a folder: ${where}`, { cause: err });
  return err instanceof Error ? err : new Error(String(err));
}
