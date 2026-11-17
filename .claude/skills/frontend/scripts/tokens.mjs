// @ts-check
/**
 * tokens.mjs: the visual system's single source and its three gates.
 *
 * `<design>/tokens.json` (CONTRACTS 6.2) holds every colour, type role, font file, spacing step, radius, shadow and
 * motion value. `build` writes the views nobody edits by hand: a CSS file of custom properties per theme (light
 * first, optionally followed by a Tailwind v4 `@theme` block that resets the default namespaces before mapping the
 * tokens), `<design>/DESIGN.md` (Google's design.md alpha plus a Motion section) and, on request, a Claude Design
 * "Design System" mirror. `validate`, `contrast` and `leak` are the gates tokens.valid, tokens.contrast and
 * tokens.leak; `palette` proposes colour tokens from a brand hue with Leonardo (targets 3, 4.5 and 7 on a ground).
 *
 * The contract has no field for contrast pairs, so a colour token declares its grounds in its usage text
 * ("secondary text, 4.5:1 or more on bg and surface") or by name (`on-primary`, `primary-foreground`).
 */
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { parseCli, isMainModule } from './lib/args.mjs';
import { NAMED_COLORS, composite, contrastRatio, parseColor, relativeLuminance, toHex, toOklch } from './lib/color.mjs';
import { CheckError, EnvError, UsageError, exitWith } from './lib/errors.mjs';
import { readText, sha256Text, toPosix, walk, writeText } from './lib/fsutil.mjs';
import { designDir } from './lib/paths.mjs';
import { loadProfile } from './lib/profile.mjs';
import { aggregate, gate, writeReport } from './lib/report.mjs';
import { lineOf, stripComments } from './lib/text.mjs';

/**
 * @typedef {import('./lib/profile.mjs').Profile} Profile
 * @typedef {import('./lib/report.mjs').GateResult} GateResult
 * @typedef {import('./lib/report.mjs').Evidence} Evidence
 * @typedef {import('./lib/color.mjs').Rgba} Rgba
 * @typedef {{rule: string, path: string, message: string, file?: string, value?: string}} Problem
 * @typedef {'display' | 'body' | 'mono'} Role
 * @typedef {'light' | 'dark' | null} Scheme
 * @typedef {{id: string, name: string, scheme: Scheme}} ThemeInfo
 * @typedef {{name: string, cssVar: string, usage: string, values: Record<string, string>}} ColorToken
 * @typedef {{role: Role, raw: string, stack: string[], primary: string}} FamilyRole
 * @typedef {{ok: true, format: string, family: string | null, fixedPitch: boolean, monospace: boolean,
 *   tnum: boolean, digitAdvances: number[], digitsTabular: boolean | null, tabular: boolean, serif: boolean | null}
 *   | {ok: false, format: string | null, error: string}} FontInfo
 * @typedef {{index: number, family: string, file: string, abs: string, weight: string, style: string,
 *   license: string, licenseFile: string, licenseAbs: string, source: string, role: Role | null,
 *   info: FontInfo | null, rfn: string[]}} FontEntry
 * @typedef {{name: string, group: string, cssVar: string, className: string, fontSize: string, lineHeight: string,
 *   fontWeight: string, letterSpacing: string | null}} TypeStyle
 * @typedef {{name: string, family: string, role: Role, data: boolean, styles: TypeStyle[]}} TypeGroup
 * @typedef {'spacing' | 'radius' | 'shadow' | 'motion'} ListCategory
 * @typedef {'duration' | 'easing' | 'transition' | 'other'} MotionKind
 * @typedef {{category: ListCategory, name: string, cssVar: string, usage: string, values: Record<string, string>,
 *   kind: MotionKind | null}} ValueToken
 * @typedef {{name: string, version: string | number, sha: string, rel: string, root: string, design: string,
 *   themes: ThemeInfo[], base: string, colors: ColorToken[], families: {display: FamilyRole, body: FamilyRole,
 *   mono: FamilyRole | null}, fonts: FontEntry[], groups: TypeGroup[], lists: Record<ListCategory, ValueToken[]>,
 *   meta: {direction: string, rationale: string, sources: string[]}}} Model
 * @typedef {{file: string, rel: string, exists: boolean, data: unknown, error: string | null, sha: string | null}} TokensSource
 * @typedef {{root: string, profile?: Profile, design?: string, args?: {serve?: string, outDir?: string},
 *   log?: (message: string) => void}} TokensContext
 */

/** The gates this module owns (CONTRACTS section 4). */
export const GATES = Object.freeze([
  Object.freeze({
    id: 'tokens.valid',
    title: 'tokens.json valid, every token with a usage, views generated from it',
    ifDropped: 'colours, type and motion values could scatter across components with no single source',
  }),
  Object.freeze({
    id: 'tokens.contrast',
    title: 'Declared text and ground pairs meet WCAG 2 contrast in every theme',
    ifDropped: 'a pair such as muted text on a muted fill would fail on every page that uses it',
  }),
  Object.freeze({
    id: 'tokens.leak',
    title: 'No default theme, arbitrary value or default font leaks past the tokens',
    ifDropped: 'indigo, soft grey shadows and the 150 ms default ease could leak back in',
  }),
]);

/** Token names, CONTRACTS 6.2. */
export const TOKEN_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The namespaces a Tailwind v4 `@theme` resets before the project's tokens (FD16 checklist item 1, TK-04). */
export const TAILWIND_RESETS = Object.freeze([
  '--color-*', '--shadow-*', '--inset-shadow-*', '--drop-shadow-*', '--blur-*', '--radius-*', '--animate-*',
  '--ease-*', '--font-*', '--text-*', '--tracking-*', '--leading-*',
]);

/** Tailwind 4.3.3 palettes (theme.css: 26 palettes of 11 shades, plus black and white). */
export const TAILWIND_PALETTES = Object.freeze([
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'mauve', 'olive', 'mist', 'taupe', 'red', 'orange', 'amber', 'yellow',
  'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
]);
const TAILWIND_SHADES = Object.freeze(['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']);

/** Tailwind 4.3.3 default theme variables outside the colour namespace, by namespace (theme.css). */
const TAILWIND_DEFAULT_VARS = Object.freeze({
  font: ['sans', 'serif', 'mono'],
  text: ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'],
  tracking: ['tighter', 'tight', 'normal', 'wide', 'wider', 'widest'],
  leading: ['tight', 'snug', 'normal', 'relaxed', 'loose'],
  radius: ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'],
  shadow: ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'],
  'inset-shadow': ['2xs', 'xs', 'sm'],
  'drop-shadow': ['xs', 'sm', 'md', 'lg', 'xl', '2xl'],
  blur: ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'],
  ease: ['in', 'out', 'in-out'],
  animate: ['spin', 'ping', 'pulse', 'bounce'],
});

/** Faces on the dated reflex list (FD16-F14): a hit asks for a written reason, it never decides alone. */
const REFLEX_FACES = Object.freeze([
  'inter', 'roboto', 'open sans', 'lato', 'montserrat', 'arial', 'helvetica', 'fraunces', 'instrument sans',
  'instrument serif', 'geist', 'mona sans', 'plus jakarta sans', 'space grotesk', 'recoleta', 'playfair', 'cormorant',
  'lora', 'crimson', 'newsreader', 'syne', 'space mono', 'ibm plex', 'dm sans', 'dm serif', 'outfit',
]);

/** Motion role budgets in ms (FD03-F07, TK-20); the smallest matching budget applies. */
const MOTION_BUDGETS = Object.freeze([
  { re: /\b(press|presses|pressed|tap|taps|active|click|clicks)\b/, max: 160, role: 'press' },
  { re: /\btooltips?\b/, max: 200, role: 'tooltip' },
  { re: /\b(dropdowns?|popovers?|menus?|selects?|combobox(?:es)?|listbox(?:es)?)\b/, max: 250, role: 'dropdown' },
  { re: /\b(modals?|dialogs?)\b/, max: 300, role: 'modal' },
  { re: /\b(drawers?|sheets?|full-height|full-screen|fullscreen)\b/, max: 500, role: 'drawer' },
]);
const MOTION_EXEMPT = /\b(explanation|explanatory|explains?|hero|marketing|onboarding|illustration)\b/;
const MOTION_UI_MAX = 300;

const TOP_KEYS = Object.freeze(['name', 'version', 'color', 'type', 'spacing', 'radius', 'shadow', 'motion', 'meta']);
const LIST_CATEGORIES = /** @type {const} */ (['spacing', 'radius', 'shadow', 'motion']);
const ROLES = /** @type {const} */ (['display', 'body', 'mono']);
const FONT_KEYS = Object.freeze(['family', 'file', 'weight', 'style', 'license', 'licenseFile', 'source']);
const GENERATED_MARK = 'Generated by tokens.mjs';
const EM_DASH = String.fromCharCode(0x2014);
/** OKLab distance above which a declared colour counts as outside sRGB (rounding to 3 decimals stays below it). */
const GAMUT_TOLERANCE = 0.002;
/** Characters a token value must not hold: they would break the generated CSS, YAML or Markdown tables. */
const UNSAFE_VALUE = /[{};<>\r\n]|\/\*|\*\//;
const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif',
  'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong',
]);
const FALLBACK_STACKS = Object.freeze({
  sans: ['ui-sans-serif', 'system-ui', 'sans-serif'],
  serif: ['ui-serif', 'Georgia', 'serif'],
  mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
});
const DIMENSION = /^-?(?:\d+(?:\.\d+)?|\.\d+)(px|rem|em|%|vw|vh|vi|vb|vmin|vmax|svh|lvh|dvh|svw|lvw|dvw|ch|ex|cap|ic|lh|rlh|pt|cqi|cqw|cqh)$/i;
const NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const CSS_FUNCTION = /^(clamp|min|max|calc)\((.*)\)$/is;
const GROUND_NAMES = Object.freeze(['bg', 'background', 'page', 'canvas', 'surface', 'base']);
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** @param {unknown} v @returns {v is string} */
function nonEmpty(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/** @param {unknown} v @returns {boolean} */
function isCssValue(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  return typeof v === 'string' && v.trim() !== '' && !UNSAFE_VALUE.test(v);
}

/** @param {unknown} v @returns {boolean} */
function isRepoPath(v) {
  return typeof v === 'string' && v !== '' && !/^[/\\]/.test(v) && !/^[A-Za-z]:/.test(v) && !v.includes('\\')
    && !/(^|\/)\.\.(\/|$)/.test(v);
}

/**
 * The path of `abs` relative to `root` with forward slashes; absolute when it lies outside the root.
 * @param {string} root @param {string} abs @returns {string}
 */
function shown(root, abs) {
  const rel = toPosix(path.relative(root, abs));
  return rel === '' ? '.' : rel.startsWith('..') || path.isAbsolute(rel) ? toPosix(abs) : rel;
}

/** @param {string} name @param {string[]} prefixes @returns {string} */
function strip(name, prefixes) {
  for (const p of prefixes) if (name.startsWith(p) && name.length > p.length) return name.slice(p.length);
  return name;
}

/** @param {number} x @param {number} digits @returns {string} */
function fixed(x, digits) {
  const s = Number(x.toFixed(digits)).toString();
  return s === '-0' ? '0' : s;
}

/** @param {number} r @returns {string} */
function ratioText(r) {
  return `${r.toFixed(2)}:1`;
}

/** @param {string} s @returns {string} */
function cell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\s*[\r\n]+\s*/g, ' ');
}

/** @param {string} p @returns {boolean} */
function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** @param {string} p @returns {boolean} */
function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** @param {string} message */
function stderrLog(message) {
  process.stderr.write(`${message}\n`);
}

/** @param {string} name @returns {string} */
function familyKey(name) {
  return name.trim().replace(/^["']|["']$/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** @param {string} s @returns {string} */
function normaliseNewlines(s) {
  return s.replace(/\r\n?/g, '\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Loading and structural validation (CONTRACTS 6.2)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Reads `<design>/tokens.json`. Never throws for a missing or malformed file: the gate reports it.
 * @param {string} root @param {string} design @returns {TokensSource}
 */
export function readTokensSource(root, design) {
  const file = path.join(design, 'tokens.json');
  const rel = shown(root, file);
  if (!isFile(file)) return { file, rel, exists: false, data: null, error: `${rel} not found`, sha: null };
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(readText(file));
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { file, rel, exists: true, data: null, error: `${rel} is not valid JSON (${why})`, sha: null };
  }
  return { file, rel, exists: true, data, error: null, sha: sha256Text(JSON.stringify(data)).slice(0, 16) };
}

/**
 * The base theme: `light` when declared ("light first"), else the first theme. Other themes inherit its values.
 * @param {string[]} ids @returns {string}
 */
function baseThemeId(ids) {
  return ids.includes('light') ? 'light' : ids[0];
}

/**
 * Checks the shape of tokens.json against CONTRACTS 6.2 (the same rules as assets/schemas/tokens.schema.json) plus
 * what generation needs: theme ids that exist, a base-theme value for every token, values that cannot break the
 * generated CSS. An empty list means the file can be built from.
 * @param {unknown} data
 * @returns {Problem[]}
 */
export function checkStructure(data) {
  /** @type {Problem[]} */
  const out = [];
  /** @param {string} where @param {string} message */
  const add = (where, message) => out.push({ rule: 'CONTRACTS 6.2', path: where, message });
  if (!isObj(data)) {
    add('$', 'must be a JSON object {name, version, color, type, spacing, radius, shadow, motion, meta}');
    return out;
  }
  for (const key of TOP_KEYS) if (!Object.hasOwn(data, key)) add(key, 'is missing');
  for (const key of Object.keys(data)) if (!TOP_KEYS.includes(key)) add(key, 'is not a CONTRACTS 6.2 key; remove it');
  if (Object.hasOwn(data, 'name') && !nonEmpty(data.name)) add('name', 'must be a non-empty string');
  if (Object.hasOwn(data, 'version')) {
    const v = data.version;
    if (!(typeof v === 'number' && Number.isInteger(v) && v >= 1) && !nonEmpty(v)) {
      add('version', 'must be an integer of 1 or more, or a non-empty string');
    }
  }
  const themeIds = checkColorBlock(data.color, add);
  checkTypeBlock(data.type, add);
  for (const cat of LIST_CATEGORIES) checkListBlock(cat, data[cat], themeIds, add);
  checkMeta(data.meta, add);
  return out;
}

/**
 * @param {string} at @param {Record<string, unknown>} obj @param {readonly string[]} allowed
 * @param {(where: string, message: string) => void} add
 */
function extraKeys(at, obj, allowed, add) {
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) add(`${at}.${key}`, `is not allowed here (allowed: ${allowed.join(', ')})`);
}

/**
 * @param {string} at @param {unknown} name @param {Set<string>} seen
 * @param {(where: string, message: string) => void} add @param {string} [scope]
 */
function checkName(at, name, seen, add, scope = '') {
  if (typeof name !== 'string' || !TOKEN_NAME.test(name)) {
    add(`${at}.name`, `must match ${TOKEN_NAME.source} (lowercase letters, digits, hyphens; got ${JSON.stringify(name)})`);
    return;
  }
  if (seen.has(name)) add(`${at}.name`, `duplicates "${name}"${scope ? `; ${scope}` : ''}`);
  seen.add(name);
}

/** @param {string} at @param {unknown} usage @param {(where: string, message: string) => void} add */
function checkUsage(at, usage, add) {
  if (!nonEmpty(usage)) add(`${at}.usage`, 'is empty: say where and why the token is used');
}

/**
 * @param {unknown} color @param {(where: string, message: string) => void} add
 * @returns {Set<string>} the declared theme ids
 */
function checkColorBlock(color, add) {
  /** @type {Set<string>} */
  const ids = new Set();
  if (color === undefined) return ids;
  if (!isObj(color)) {
    add('color', 'must be an object {themes, tokens}');
    return ids;
  }
  extraKeys('color', color, ['themes', 'tokens'], add);
  /** @type {string[]} */
  const order = [];
  if (!Array.isArray(color.themes) || color.themes.length === 0) {
    add('color.themes', 'must be a non-empty array of {id, name}');
  } else {
    color.themes.forEach((t, i) => {
      const at = `color.themes[${i}]`;
      if (!isObj(t)) return add(at, 'must be an object {id, name}');
      extraKeys(at, t, ['id', 'name'], add);
      if (typeof t.id !== 'string' || !TOKEN_NAME.test(t.id)) add(`${at}.id`, `must match ${TOKEN_NAME.source}`);
      else if (ids.has(t.id)) add(`${at}.id`, `duplicates the theme id "${t.id}"`);
      else {
        ids.add(t.id);
        order.push(t.id);
      }
      if (!nonEmpty(t.name)) add(`${at}.name`, 'must be a non-empty string');
    });
  }
  const base = order.length > 0 ? baseThemeId(order) : null;
  if (!Array.isArray(color.tokens) || color.tokens.length === 0) {
    add('color.tokens', 'must be a non-empty array of {name, value, usage}');
    return ids;
  }
  /** @type {Set<string>} */
  const names = new Set();
  color.tokens.forEach((t, i) => {
    const at = `color.tokens[${i}]`;
    if (!isObj(t)) return add(at, 'must be an object {name, value, usage}');
    extraKeys(at, t, ['name', 'value', 'usage'], add);
    checkName(at, t.name, names, add);
    checkUsage(at, t.usage, add);
    if (!isObj(t.value) || Object.keys(t.value).length === 0) {
      add(`${at}.value`, 'must be an object with one CSS colour per theme id, for example {"light": "oklch(0.98 0.01 250)"}');
      return;
    }
    for (const [k, v] of Object.entries(t.value)) {
      if (ids.size > 0 && !ids.has(k)) add(`${at}.value.${k}`, `names no theme of color.themes (${[...ids].join(', ')})`);
      if (!nonEmpty(v)) add(`${at}.value.${k}`, 'must be a non-empty CSS colour');
      else if (UNSAFE_VALUE.test(v)) add(`${at}.value.${k}`, 'holds a character that would break the generated CSS');
    }
    if (base && !Object.hasOwn(t.value, base)) {
      add(`${at}.value`, `has no value for the base theme "${base}" (light first; the other themes inherit it)`);
    }
  });
  return ids;
}

/** @param {unknown} v @returns {boolean} */
function isWeight(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 1000;
  if (typeof v !== 'string') return false;
  const m = /^\s*(\d{1,4})(?:\s+(\d{1,4}))?\s*$/.exec(v);
  if (!m) return /^(normal|bold)$/.test(v.trim());
  return [m[1], m[2]].filter(Boolean).every((n) => Number(n) >= 1 && Number(n) <= 1000);
}

/** @param {unknown} type @param {(where: string, message: string) => void} add */
function checkTypeBlock(type, add) {
  if (type === undefined) return;
  if (!isObj(type)) return add('type', 'must be an object {fonts, families, groups}');
  extraKeys('type', type, ['fonts', 'families', 'groups'], add);
  if (!Array.isArray(type.fonts)) {
    add('type.fonts', 'must be an array (empty when every face is a system face)');
  } else {
    type.fonts.forEach((f, i) => {
      const at = `type.fonts[${i}]`;
      if (!isObj(f)) return add(at, `must be an object {${FONT_KEYS.join(', ')}}`);
      extraKeys(at, f, FONT_KEYS, add);
      for (const k of FONT_KEYS) {
        if (!Object.hasOwn(f, k)) add(`${at}.${k}`, 'is missing: every font names its file, licence, licence file and source');
      }
      if (Object.hasOwn(f, 'family')) {
        if (!nonEmpty(f.family)) add(`${at}.family`, 'must be a non-empty string');
        else if (f.family.includes(',') || UNSAFE_VALUE.test(f.family)) add(`${at}.family`, 'must be one family name, not a stack');
      }
      for (const k of ['file', 'licenseFile']) {
        if (Object.hasOwn(f, k) && !isRepoPath(f[k])) {
          add(`${at}.${k}`, 'must be a repository-relative POSIX path (no leading slash, drive letter, backslash or ..)');
        }
      }
      if (Object.hasOwn(f, 'weight') && !isWeight(f.weight)) add(`${at}.weight`, 'must be a weight from 1 to 1000, or a variable range such as "100 900"');
      if (Object.hasOwn(f, 'style') && !['normal', 'italic', 'oblique'].includes(String(f.style))) add(`${at}.style`, 'must be normal, italic or oblique');
      for (const k of ['license', 'source']) if (Object.hasOwn(f, k) && !nonEmpty(f[k])) add(`${at}.${k}`, 'must be a non-empty string');
    });
  }
  if (!isObj(type.families)) {
    add('type.families', 'must be an object {display, body, mono}');
  } else {
    extraKeys('type.families', type.families, ROLES, add);
    for (const r of ['display', 'body']) if (!nonEmpty(type.families[r])) add(`type.families.${r}`, 'must name a family (or a font stack)');
    const mono = type.families.mono;
    if (!(mono === null || nonEmpty(mono))) add('type.families.mono', 'must name a monospace family, or be null');
    for (const r of ROLES) {
      const v = type.families[r];
      if (typeof v === 'string' && UNSAFE_VALUE.test(v)) add(`type.families.${r}`, 'holds a character that would break the generated CSS');
    }
  }
  if (!Array.isArray(type.groups) || type.groups.length === 0) {
    add('type.groups', 'must be a non-empty array of {name, family, styles}');
    return;
  }
  /** @type {Set<string>} */
  const groupNames = new Set();
  /** @type {Set<string>} */
  const styleNames = new Set();
  type.groups.forEach((g, i) => {
    const at = `type.groups[${i}]`;
    if (!isObj(g)) return add(at, 'must be an object {name, family, styles}');
    extraKeys(at, g, ['name', 'family', 'styles'], add);
    checkName(at, g.name, groupNames, add);
    if (!nonEmpty(g.family)) add(`${at}.family`, 'must name a role (display, body, mono) or a family of type.families');
    if (!Array.isArray(g.styles) || g.styles.length === 0) {
      add(`${at}.styles`, 'must be a non-empty array of {name, fontSize, lineHeight, fontWeight}');
      return;
    }
    g.styles.forEach((s, j) => {
      const sat = `${at}.styles[${j}]`;
      if (!isObj(s)) return add(sat, 'must be an object {name, fontSize, lineHeight, fontWeight, letterSpacing?}');
      extraKeys(sat, s, ['name', 'fontSize', 'lineHeight', 'fontWeight', 'letterSpacing'], add);
      checkName(sat, s.name, styleNames, add, 'type style names are unique across groups because each becomes --text-<name>');
      for (const k of ['fontSize', 'lineHeight', 'fontWeight']) if (!isCssValue(s[k])) add(`${sat}.${k}`, 'is missing, empty or unsafe');
      if (Object.hasOwn(s, 'letterSpacing') && !isCssValue(s.letterSpacing)) add(`${sat}.letterSpacing`, 'is empty or unsafe');
      if (isCssValue(s.fontWeight) && !isWeight(s.fontWeight)) add(`${sat}.fontWeight`, 'must be a weight from 1 to 1000');
    });
  });
}

/**
 * @param {string} cat @param {unknown} block @param {Set<string>} themeIds
 * @param {(where: string, message: string) => void} add
 */
function checkListBlock(cat, block, themeIds, add) {
  if (block === undefined) return;
  if (!isObj(block)) return add(cat, 'must be an object {tokens: [{name, value, usage}]}');
  extraKeys(cat, block, ['tokens'], add);
  if (!Array.isArray(block.tokens)) return add(`${cat}.tokens`, 'must be an array of {name, value, usage}');
  const base = themeIds.size > 0 ? baseThemeId([...themeIds]) : null;
  /** @type {Set<string>} */
  const names = new Set();
  block.tokens.forEach((t, i) => {
    const at = `${cat}.tokens[${i}]`;
    if (!isObj(t)) return add(at, 'must be an object {name, value, usage}');
    checkName(at, t.name, names, add);
    checkUsage(at, t.usage, add);
    if (isObj(t.value)) {
      if (Object.keys(t.value).length === 0) add(`${at}.value`, 'must hold at least one theme value');
      for (const [k, v] of Object.entries(t.value)) {
        if (themeIds.size > 0 && !themeIds.has(k)) add(`${at}.value.${k}`, `names no theme of color.themes (${[...themeIds].join(', ')})`);
        if (!isCssValue(v)) add(`${at}.value.${k}`, 'must be a non-empty, safe CSS value');
      }
      if (base && Object.keys(t.value).length > 0 && !Object.hasOwn(t.value, base)) {
        add(`${at}.value`, `has no value for the base theme "${base}"`);
      }
    } else if (!isCssValue(t.value)) {
      add(`${at}.value`, 'must be a non-empty, safe CSS value, or one CSS value per theme id');
    }
  });
}

/** @param {unknown} meta @param {(where: string, message: string) => void} add */
function checkMeta(meta, add) {
  if (meta === undefined) return;
  if (!isObj(meta)) return add('meta', 'must be an object {direction, rationale, sources}');
  extraKeys('meta', meta, ['direction', 'rationale', 'sources'], add);
  if (!nonEmpty(meta.direction)) add('meta.direction', 'must name the direction picked at H1');
  if (!nonEmpty(meta.rationale)) add('meta.rationale', 'must explain the choices in one paragraph');
  if (!Array.isArray(meta.sources)) add('meta.sources', 'must be an array of pattern-ledger ids, findings or files');
  else meta.sources.forEach((s, i) => { if (!nonEmpty(s)) add(`meta.sources[${i}]`, 'must be a non-empty string'); });
}

// ---------------------------------------------------------------------------------------------------------------
// The model: tokens.json normalised for generation and checks
// ---------------------------------------------------------------------------------------------------------------

/**
 * Splits a CSS font-family value into family names, quotes removed.
 * @param {string} value @returns {string[]}
 */
export function parseStack(value) {
  /** @type {string[]} */
  const out = [];
  let current = '';
  let quote = '';
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = '';
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ',') {
      out.push(current.trim().replace(/\s+/g, ' '));
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim().replace(/\s+/g, ' '));
  return out.filter((s) => s !== '');
}

/** @param {string} name @returns {string} */
function quoteFamily(name) {
  return GENERIC_FAMILIES.has(name.toLowerCase()) ? name : `"${name.replace(/["\\]/g, '\\$&')}"`;
}

/**
 * Colour scheme of a theme: from its id or name, else from the luminance of its page ground.
 * @param {{id: string, name: string}} theme @param {Record<string, unknown>[]} tokens @param {string} base
 * @returns {Scheme}
 */
function themeScheme(theme, tokens, base) {
  const words = `${theme.id} ${theme.name}`.toLowerCase();
  if (/\b(dark|night|dim)\b/.test(words)) return 'dark';
  if (/\b(light|day)\b/.test(words)) return 'light';
  for (const g of GROUND_NAMES) {
    const t = tokens.find((x) => x.name === g);
    if (!t || !isObj(t.value)) continue;
    const css = t.value[theme.id] ?? t.value[base];
    const rgba = typeof css === 'string' ? parseColor(css) : null;
    if (rgba) return relativeLuminance(rgba) < 0.18 ? 'dark' : 'light';
  }
  return null;
}

/** @param {unknown} v @param {'length' | 'duration' | 'plain'} unit @returns {string} */
function cssValueText(v, unit) {
  if (typeof v === 'number') {
    if (v === 0 || unit === 'plain') return String(v);
    return unit === 'duration' ? `${v}ms` : `${v}px`;
  }
  return String(v).trim();
}

/**
 * Classifies a motion value: a duration, a timing function, a transition shorthand or something else.
 * @param {string} value @returns {MotionKind}
 */
export function motionKind(value) {
  const v = value.trim().toLowerCase();
  if (/^-?(?:\d+(?:\.\d+)?|\.\d+)m?s$/.test(v)) return 'duration';
  if (/^(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/.test(v)) return 'easing';
  if (/^(?:cubic-bezier|steps|linear)\(.*\)$/.test(v)) return 'easing';
  if (/(?:^|[\s,])-?(?:\d+(?:\.\d+)?|\.\d+)m?s(?=$|[\s,])/.test(v)) return 'transition';
  return 'other';
}

/**
 * Builds the normalised model from structurally valid tokens.json data. Problems here also block generation (a
 * colour that does not parse, a type group whose family resolves to no role, two tokens on one CSS variable).
 * @param {Record<string, any>} data @param {{root: string, design: string, rel: string, sha: string}} where
 * @returns {{model: Model, problems: Problem[]}}
 */
export function buildModel(data, { root, design, rel, sha }) {
  /** @type {Problem[]} */
  const problems = [];
  /** @param {string} rule @param {string} at @param {string} message */
  const add = (rule, at, message) => problems.push({ rule, path: at, message });
  const declaredThemes = /** @type {{id: string, name: string}[]} */ (data.color.themes);
  const tokens = /** @type {Record<string, unknown>[]} */ (data.color.tokens);
  const ids = declaredThemes.map((t) => t.id);
  const base = baseThemeId(ids);
  const ordered = [declaredThemes.find((t) => t.id === base), ...declaredThemes.filter((t) => t.id !== base)];
  /** @type {ThemeInfo[]} */
  const themes = ordered.map((t) => {
    const theme = /** @type {{id: string, name: string}} */ (t);
    return { id: theme.id, name: theme.name, scheme: themeScheme(theme, tokens, base) };
  });

  /** @type {ColorToken[]} */
  const colors = tokens.map((t, i) => {
    const values = /** @type {Record<string, string>} */ (Object.fromEntries(
      Object.entries(/** @type {Record<string, string>} */ (t.value)).map(([k, v]) => [k, v.trim()]),
    ));
    for (const [k, v] of Object.entries(values)) {
      if (parseColor(v) === null) add('TK-02', `color.tokens[${i}].value.${k}`, `"${v}" is not a colour lib/color can read; write oklch(), rgb() or hex`);
    }
    return { name: String(t.name), cssVar: `--color-${strip(String(t.name), ['color-'])}`, usage: String(t.usage).trim(), values };
  });

  const fam = /** @type {Record<string, string | null>} */ (data.type.families);
  /** @param {Role} role @returns {FamilyRole | null} */
  const roleOf = (role) => {
    const raw = fam[role];
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    const stack = parseStack(raw);
    if (stack.length === 0) {
      add('TK-12', `type.families.${role}`, 'names no family');
      return null;
    }
    return { role, raw: raw.trim(), stack, primary: stack[0] };
  };
  const display = roleOf('display');
  const body = roleOf('body');
  const mono = roleOf('mono');
  const families = {
    display: display ?? { role: /** @type {Role} */ ('display'), raw: 'sans-serif', stack: ['sans-serif'], primary: 'sans-serif' },
    body: body ?? { role: /** @type {Role} */ ('body'), raw: 'sans-serif', stack: ['sans-serif'], primary: 'sans-serif' },
    mono,
  };
  /** @param {string} family @returns {Role | null} */
  const roleForFamily = (family) => {
    const key = familyKey(family);
    if (mono && familyKey(mono.primary) === key) return 'mono';
    if (familyKey(families.body.primary) === key) return 'body';
    if (familyKey(families.display.primary) === key) return 'display';
    return null;
  };

  /** @type {FontEntry[]} */
  const fonts = /** @type {Record<string, unknown>[]} */ (data.type.fonts).map((f, index) => ({
    index,
    family: String(f.family).trim(),
    file: String(f.file),
    abs: path.resolve(root, String(f.file)),
    weight: String(f.weight).trim(),
    style: String(f.style),
    license: String(f.license).trim(),
    licenseFile: String(f.licenseFile),
    licenseAbs: path.resolve(root, String(f.licenseFile)),
    source: String(f.source).trim(),
    role: roleForFamily(String(f.family)),
    info: null,
    rfn: [],
  }));

  /** @type {TypeGroup[]} */
  const groups = /** @type {Record<string, any>[]} */ (data.type.groups).map((g, i) => {
    const familyName = String(g.family).trim();
    /** @type {Role | null} */
    let role = null;
    if (familyName === 'display' || familyName === 'body' || familyName === 'mono') {
      role = familyName;
      if (role === 'mono' && !mono) add('TK-12', `type.groups[${i}].family`, 'uses the mono role but type.families.mono is null');
    } else {
      role = roleForFamily(familyName);
      if (!role) add('TK-12', `type.groups[${i}].family`, `"${familyName}" is no role (display, body, mono) and no family of type.families: a group may not add a family`);
    }
    const resolved = /** @type {Role} */ (role ?? 'body');
    const name = String(g.name);
    /** @type {TypeStyle[]} */
    const styles = /** @type {Record<string, unknown>[]} */ (g.styles).map((s) => {
      const styleName = String(s.name);
      const short = strip(styleName, ['text-']);
      return {
        name: styleName,
        group: name,
        cssVar: `--text-${short}`,
        className: `type-${short}`,
        fontSize: cssValueText(s.fontSize, 'length'),
        lineHeight: cssValueText(s.lineHeight, 'plain'),
        fontWeight: cssValueText(s.fontWeight, 'plain'),
        letterSpacing: s.letterSpacing === undefined ? null : cssValueText(s.letterSpacing, 'length'),
      };
    });
    return { name, family: familyName, role: resolved, data: resolved === 'mono' || isDataGroupName(name), styles };
  });

  /** @type {Record<ListCategory, ValueToken[]>} */
  const lists = { spacing: [], radius: [], shadow: [], motion: [] };
  for (const cat of LIST_CATEGORIES) {
    lists[cat] = /** @type {Record<string, unknown>[]} */ (data[cat].tokens).map((t) => {
      const name = String(t.name);
      const raw = isObj(t.value) ? t.value : { [base]: t.value };
      const unit = cat === 'motion' ? 'duration' : cat === 'shadow' ? 'plain' : 'length';
      const values = /** @type {Record<string, string>} */ (Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, cssValueText(v, unit)])));
      const kind = cat === 'motion' ? motionKind(values[base] ?? Object.values(values)[0]) : null;
      return { category: cat, name, cssVar: listVar(cat, name, kind), usage: String(t.usage).trim(), values, kind };
    });
  }

  const model = {
    name: String(data.name).trim(),
    version: /** @type {string | number} */ (data.version),
    sha,
    rel,
    root,
    design,
    themes,
    base,
    colors,
    families,
    fonts,
    groups,
    lists,
    meta: {
      direction: String(data.meta.direction).trim(),
      rationale: String(data.meta.rationale).trim(),
      sources: /** @type {unknown[]} */ (data.meta.sources).map((s) => String(s).trim()),
    },
  };
  for (const [cssVar, owners] of cssVariableOwners(model)) {
    if (owners.length > 1) add('CONTRACTS 6.2', owners.join(' and '), `all generate ${cssVar}; rename one`);
  }
  return { model, problems };
}

/** @param {ListCategory} cat @param {string} name @param {MotionKind | null} kind @returns {string} */
function listVar(cat, name, kind) {
  if (cat === 'spacing') return `--spacing-${strip(name, ['spacing-', 'space-'])}`;
  if (cat === 'radius') return `--radius-${strip(name, ['radius-'])}`;
  if (cat === 'shadow') return `--shadow-${strip(name, ['shadow-'])}`;
  if (kind === 'easing') return `--ease-${strip(name, ['ease-', 'easing-'])}`;
  if (kind === 'duration') return `--duration-${strip(name, ['duration-'])}`;
  if (kind === 'transition') return `--transition-${strip(name, ['transition-'])}`;
  return `--motion-${strip(name, ['motion-'])}`;
}

/** @param {string} name @returns {boolean} */
function isDataGroupName(name) {
  return name.split('-').some((w) => /^(data|figure|figures|numeric|number|numbers|tabular|table|tables|amount|amounts|balance|balances|price|prices|stat|stats|metric|metrics|mono|code|hash|hashes|ticker)$/.test(w));
}

/**
 * Every CSS custom property the model generates, with the tokens that generate it.
 * @param {Model} model @returns {Map<string, string[]>}
 */
function cssVariableOwners(model) {
  /** @type {Map<string, string[]>} */
  const owners = new Map();
  /** @param {string} v @param {string} who */
  const own = (v, who) => owners.set(v, [...(owners.get(v) ?? []), who]);
  for (const c of model.colors) own(c.cssVar, `colour "${c.name}"`);
  for (const role of ROLES) if (role !== 'mono' || model.families.mono) own(`--font-${role}`, `type.families.${role}`);
  for (const g of model.groups) {
    for (const s of g.styles) {
      own(s.cssVar, `type style "${s.name}"`);
      own(`${s.cssVar}--line-height`, `type style "${s.name}"`);
      own(`${s.cssVar}--font-weight`, `type style "${s.name}"`);
      if (s.letterSpacing !== null) own(`${s.cssVar}--letter-spacing`, `type style "${s.name}"`);
    }
  }
  for (const cat of LIST_CATEGORIES) for (const t of model.lists[cat]) own(t.cssVar, `${cat} "${t.name}"`);
  return owners;
}

/**
 * The CSS custom properties generated from the tokens (for the leak gate's whitelist).
 * @param {Model} model @returns {Set<string>}
 */
export function generatedVariables(model) {
  return new Set(cssVariableOwners(model).keys());
}

/**
 * The font files of a role: those whose family is the role's primary family (display and body may share one).
 * @param {Model} model @param {Role} role @returns {FontEntry[]}
 */
function facesOf(model, role) {
  const fam = role === 'mono' ? model.families.mono : model.families[role];
  if (!fam) return [];
  const key = familyKey(fam.primary);
  return model.fonts.filter((f) => familyKey(f.family) === key);
}

/**
 * The roles a family fills.
 * @param {Model} model @param {string} family @returns {Role[]}
 */
function rolesOf(model, family) {
  return ROLES.filter((r) => facesOf(model, r).some((f) => familyKey(f.family) === familyKey(family)));
}

/** @param {ColorToken | ValueToken} token @param {string} themeId @param {string} base @returns {string} */
function effective(token, themeId, base) {
  return token.values[themeId] ?? token.values[base];
}

/**
 * Loads tokens.json, checks its structure and builds the model. `model` is null when the file is missing, invalid
 * JSON or structurally broken; `problems` then says why.
 * @param {string} root @param {string} design
 * @returns {{source: TokensSource, model: Model | null, problems: Problem[]}}
 */
export function loadModel(root, design) {
  const source = readTokensSource(root, design);
  if (source.error !== null || source.data === null || source.sha === null) {
    return { source, model: null, problems: [{ rule: 'CONTRACTS 6.2', path: '$', message: source.error ?? `${source.rel} is empty` }] };
  }
  const structural = checkStructure(source.data);
  if (structural.length > 0) return { source, model: null, problems: structural };
  const built = buildModel(/** @type {Record<string, any>} */ (source.data), { root, design, rel: source.rel, sha: source.sha });
  if (built.problems.length > 0) return { source, model: null, problems: built.problems };
  return { source, model: built.model, problems: [] };
}

// ---------------------------------------------------------------------------------------------------------------
// Fonts: TrueType, OpenType, WOFF and WOFF2 read with opentype.js
// ---------------------------------------------------------------------------------------------------------------

/** @type {any} */
let opentypeModule = null;

/** @returns {Promise<any>} */
async function loadOpentype() {
  if (opentypeModule) return opentypeModule;
  try {
    // @ts-ignore -- opentype.js 2.0.0 ships no type declarations; its use here is limited to parse().
    const mod = await import('opentype.js');
    opentypeModule = mod.default ?? mod;
  } catch (err) {
    throw new EnvError(`opentype.js is not installed; run pnpm install --frozen-lockfile in ${toPosix(SCRIPTS_DIR)}`, { cause: err });
  }
  return opentypeModule;
}

/** The WOFF2 known-table index (W3C WOFF2, 5.1). */
export const WOFF2_TAGS = Object.freeze([
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ',
  'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS',
  'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc',
  'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
]);

/** Tables the checks read; outlines are stubbed for TrueType so opentype.js never decodes glyphs. */
const KEPT_TABLES = new Set(['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'GSUB', 'CFF ', 'CFF2', 'fvar']);

/**
 * @param {Buffer} buf @param {number} offset @returns {[number, number]} value and next offset
 */
function readBase128(buf, offset) {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    if (offset >= buf.length) throw new Error('truncated UIntBase128 in the WOFF2 table directory');
    const byte = buf[offset];
    offset += 1;
    if (i === 0 && byte === 0x80) throw new Error('UIntBase128 with a leading zero');
    value = value * 128 + (byte & 0x7f);
    if (value > 0xffffffff) throw new Error('UIntBase128 overflow');
    if ((byte & 0x80) === 0) return [value, offset];
  }
  throw new Error('UIntBase128 longer than five bytes');
}

/**
 * Extracts the tables of a WOFF2 file (brotli). Transformed glyf and loca are dropped (the checks never read
 * outlines); a transformed hmtx is rebuilt with its advance widths, side bearings set to 0.
 * @param {Buffer} buf @returns {{flavor: number, tables: Map<string, Buffer>}}
 */
export function woff2Tables(buf) {
  if (buf.length < 48) throw new Error('file shorter than a WOFF2 header');
  const flavor = buf.readUInt32BE(4);
  if (flavor === 0x74746366) throw new Error('WOFF2 font collections are not supported; ship one font per file');
  const numTables = buf.readUInt16BE(12);
  const totalCompressedSize = buf.readUInt32BE(20);
  let off = 48;
  /** @type {{tag: string, length: number, transformed: boolean}[]} */
  const entries = [];
  for (let i = 0; i < numTables; i += 1) {
    if (off >= buf.length) throw new Error('truncated WOFF2 table directory');
    const flags = buf[off];
    off += 1;
    const index = flags & 0x3f;
    let tag;
    if (index === 63) {
      tag = buf.toString('latin1', off, off + 4);
      off += 4;
    } else {
      tag = WOFF2_TAGS[index];
      if (tag === undefined) throw new Error(`unknown WOFF2 table index ${index}`);
    }
    const version = (flags >> 6) & 3;
    let origLength;
    [origLength, off] = readBase128(buf, off);
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    let length = origLength;
    if (transformed) [length, off] = readBase128(buf, off);
    entries.push({ tag, length, transformed });
  }
  if (off + totalCompressedSize > buf.length) throw new Error('truncated WOFF2 compressed stream');
  let data;
  try {
    data = zlib.brotliDecompressSync(buf.subarray(off, off + totalCompressedSize));
  } catch (err) {
    throw new Error(`the WOFF2 brotli stream does not decompress (${err instanceof Error ? err.message : String(err)})`);
  }
  /** @type {Map<string, {data: Buffer, transformed: boolean}>} */
  const raw = new Map();
  let p = 0;
  for (const e of entries) {
    if (p + e.length > data.length) throw new Error(`WOFF2 table ${e.tag.trim()} runs past the decompressed data`);
    raw.set(e.tag, { data: data.subarray(p, p + e.length), transformed: e.transformed });
    p += e.length;
  }
  /** @type {Map<string, Buffer>} */
  const tables = new Map();
  for (const [tag, t] of raw) {
    if (tag === 'hmtx' && t.transformed) continue;
    if ((tag === 'glyf' || tag === 'loca') && t.transformed) continue;
    tables.set(tag, Buffer.from(t.data));
  }
  const hmtx = raw.get('hmtx');
  if (hmtx && hmtx.transformed) {
    const hhea = tables.get('hhea');
    const maxp = tables.get('maxp');
    if (!hhea || !maxp) throw new Error('a transformed hmtx needs hhea and maxp');
    tables.set('hmtx', untransformHmtx(hmtx.data, hhea.readUInt16BE(34), maxp.readUInt16BE(4)));
  }
  return { flavor, tables };
}

/**
 * Rebuilds hmtx from the WOFF2 transform (version 1): advance widths kept, omitted side bearings set to 0.
 * @param {Buffer} src @param {number} numberOfHMetrics @param {number} numGlyphs @returns {Buffer}
 */
function untransformHmtx(src, numberOfHMetrics, numGlyphs) {
  const flags = src[0];
  let p = 1;
  const advances = [];
  for (let i = 0; i < numberOfHMetrics; i += 1, p += 2) advances.push(src.readUInt16BE(p));
  const lsb = [];
  if (!(flags & 1)) for (let i = 0; i < numberOfHMetrics; i += 1, p += 2) lsb.push(src.readInt16BE(p));
  const tail = [];
  if (!(flags & 2)) for (let i = numberOfHMetrics; i < numGlyphs; i += 1, p += 2) tail.push(src.readInt16BE(p));
  const out = Buffer.alloc(numberOfHMetrics * 4 + Math.max(0, numGlyphs - numberOfHMetrics) * 2);
  let q = 0;
  for (let i = 0; i < numberOfHMetrics; i += 1, q += 4) {
    out.writeUInt16BE(advances[i], q);
    out.writeInt16BE(lsb[i] ?? 0, q + 2);
  }
  for (let i = numberOfHMetrics; i < numGlyphs; i += 1, q += 2) out.writeInt16BE(tail[i - numberOfHMetrics] ?? 0, q);
  return out;
}

/** @param {Buffer} buf @returns {{flavor: number, tables: Map<string, Buffer>}} */
function woffTables(buf) {
  if (buf.length < 44) throw new Error('file shorter than a WOFF header');
  const flavor = buf.readUInt32BE(4);
  const numTables = buf.readUInt16BE(12);
  /** @type {Map<string, Buffer>} */
  const tables = new Map();
  for (let i = 0; i < numTables; i += 1) {
    const at = 44 + i * 20;
    if (at + 20 > buf.length) throw new Error('truncated WOFF table directory');
    const tag = buf.toString('latin1', at, at + 4);
    const offset = buf.readUInt32BE(at + 4);
    const compLength = buf.readUInt32BE(at + 8);
    const origLength = buf.readUInt32BE(at + 12);
    if (offset + compLength > buf.length) throw new Error(`WOFF table ${tag.trim()} runs past the end of the file`);
    const slice = buf.subarray(offset, offset + compLength);
    tables.set(tag, compLength < origLength ? zlib.inflateSync(slice) : Buffer.from(slice));
  }
  return { flavor, tables };
}

/** @param {Buffer} buf @returns {{flavor: number, tables: Map<string, Buffer>}} */
function sfntTables(buf) {
  if (buf.length < 12) throw new Error('file shorter than an OpenType header');
  const flavor = buf.readUInt32BE(0);
  const numTables = buf.readUInt16BE(4);
  /** @type {Map<string, Buffer>} */
  const tables = new Map();
  for (let i = 0; i < numTables; i += 1) {
    const at = 12 + i * 16;
    if (at + 16 > buf.length) throw new Error('truncated OpenType table directory');
    const tag = buf.toString('latin1', at, at + 4);
    const offset = buf.readUInt32BE(at + 8);
    const length = buf.readUInt32BE(at + 12);
    if (offset + length > buf.length) throw new Error(`table ${tag.trim()} runs past the end of the file`);
    tables.set(tag, Buffer.from(buf.subarray(offset, offset + length)));
  }
  return { flavor, tables };
}

/** @param {Buffer} data @returns {number} */
function tableChecksum(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const word = ((data[i] ?? 0) << 24 | (data[i + 1] ?? 0) << 16 | (data[i + 2] ?? 0) << 8 | (data[i + 3] ?? 0)) >>> 0;
    sum = (sum + word) >>> 0;
  }
  return sum;
}

/**
 * Assembles an OpenType file from tables (sorted, 4-byte aligned, checksummed).
 * @param {number} flavor @param {Map<string, Buffer>} tables @returns {Buffer}
 */
export function buildSfnt(flavor, tables) {
  const tags = [...tables.keys()].sort();
  const n = tags.length;
  let offset = 12 + 16 * n;
  const records = tags.map((tag) => {
    const data = /** @type {Buffer} */ (tables.get(tag));
    const record = { tag, offset, data };
    offset += (data.length + 3) & ~3;
    return record;
  });
  const out = Buffer.alloc(offset);
  out.writeUInt32BE(flavor >>> 0, 0);
  out.writeUInt16BE(n, 4);
  const pow = n > 0 ? 2 ** Math.floor(Math.log2(n)) : 0;
  out.writeUInt16BE(pow * 16, 6);
  out.writeUInt16BE(pow > 0 ? Math.log2(pow) : 0, 8);
  out.writeUInt16BE(n * 16 - pow * 16, 10);
  records.forEach((r, i) => {
    const at = 12 + 16 * i;
    out.write(r.tag, at, 4, 'latin1');
    out.writeUInt32BE(tableChecksum(r.data), at + 4);
    out.writeUInt32BE(r.offset, at + 8);
    out.writeUInt32BE(r.data.length, at + 12);
    r.data.copy(out, r.offset);
  });
  return out;
}

/**
 * The tables a font file holds, whatever its container, and its container format.
 * @param {Buffer} buf @returns {{format: string, flavor: number, tables: Map<string, Buffer>}}
 */
export function fontTables(buf) {
  if (buf.length < 4) throw new Error('empty or truncated font file');
  const sig = buf.toString('latin1', 0, 4);
  if (sig === 'wOF2') return { format: 'woff2', ...woff2Tables(buf) };
  if (sig === 'wOFF') return { format: 'woff', ...woffTables(buf) };
  if (sig === 'OTTO') return { format: 'otf', ...sfntTables(buf) };
  if (buf.readUInt32BE(0) === 0x00010000 || sig === 'true') return { format: 'ttf', ...sfntTables(buf) };
  if (sig === 'ttcf') throw new Error('font collections (.ttc) are not supported; ship one font per file');
  throw new Error(`not a font file (signature ${JSON.stringify(sig)})`);
}

/**
 * The reduced OpenType file the checks parse: the tables they read, with empty TrueType outlines.
 * @param {number} flavor @param {Map<string, Buffer>} tables @returns {Buffer}
 */
function reducedSfnt(flavor, tables) {
  /** @type {Map<string, Buffer>} */
  const kept = new Map();
  for (const [tag, data] of tables) if (KEPT_TABLES.has(tag)) kept.set(tag, data);
  for (const need of ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name']) {
    if (!kept.has(need)) throw new Error(`the font has no ${need.trim()} table`);
  }
  const cff = kept.has('CFF ') || kept.has('CFF2');
  if (!cff) {
    const head = Buffer.from(/** @type {Buffer} */ (kept.get('head')));
    const numGlyphs = /** @type {Buffer} */ (kept.get('maxp')).readUInt16BE(4);
    const long = head.readInt16BE(50) === 1;
    kept.set('head', head);
    kept.set('loca', Buffer.alloc((numGlyphs + 1) * (long ? 4 : 2)));
    kept.set('glyf', Buffer.alloc(0));
  }
  return buildSfnt(cff ? 0x4f54544f : 0x00010000, kept);
}

/**
 * @param {any} font @param {string} key @returns {string | null}
 */
function englishName(font, key) {
  const names = font.names ?? {};
  for (const platform of ['windows', 'macintosh', 'unicode']) {
    const entry = names[platform]?.[key];
    if (entry && typeof entry === 'object') {
      const value = entry.en ?? Object.values(entry)[0];
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
    }
  }
  return null;
}

/**
 * Reads what the checks need from a font file: family name, tabular figures (a `tnum` feature, or digits 0-9 of
 * one advance width in the default instance), monospace, serif class.
 * @param {string} abs @returns {Promise<FontInfo>}
 */
export async function readFontInfo(abs) {
  let format = null;
  try {
    const opentype = await loadOpentype();
    const extracted = fontTables(readFileSync(abs));
    format = extracted.format;
    const sfnt = reducedSfnt(extracted.flavor, extracted.tables);
    const font = opentype.parse(sfnt.buffer.slice(sfnt.byteOffset, sfnt.byteOffset + sfnt.byteLength));
    const features = /** @type {{tag: string}[]} */ (font.tables?.gsub?.features ?? []);
    const tnum = features.some((f) => f.tag === 'tnum');
    /** @param {string} ch @returns {number | null} */
    const advance = (ch) => {
      const index = font.charToGlyphIndex(ch);
      if (!index) return null;
      const width = font.glyphs.get(index)?.advanceWidth;
      return typeof width === 'number' ? width : null;
    };
    const digitAdvances = [...'0123456789'].map(advance).filter((w) => w !== null);
    const digitsTabular = digitAdvances.length === 10 ? new Set(digitAdvances).size === 1 : null;
    const ascii = [];
    for (let code = 0x21; code <= 0x7e; code += 1) {
      const w = advance(String.fromCharCode(code));
      if (w !== null && w > 0) ascii.push(w);
    }
    const fixedPitch = Number(font.tables?.post?.isFixedPitch ?? 0) !== 0;
    const monospace = fixedPitch || (ascii.length >= 26 && new Set(ascii).size === 1);
    const os2 = font.tables?.os2;
    /** @type {boolean | null} */
    let serif = null;
    if (os2 && Array.isArray(os2.panose) && os2.panose[0] === 2 && os2.panose[1] >= 2 && os2.panose[1] <= 13) {
      serif = os2.panose[1] <= 10;
    } else if (os2 && typeof os2.sFamilyClass === 'number' && os2.sFamilyClass > 0) {
      const cls = os2.sFamilyClass >> 8;
      if ([1, 2, 3, 4, 5, 7].includes(cls)) serif = true;
      else if (cls === 8) serif = false;
    }
    return {
      ok: true,
      format: extracted.format,
      family: englishName(font, 'preferredFamily') ?? englishName(font, 'fontFamily'),
      fixedPitch,
      monospace,
      tnum,
      digitAdvances,
      digitsTabular,
      tabular: tnum || digitsTabular === true || monospace,
      serif,
    };
  } catch (err) {
    if (err instanceof EnvError) throw err;
    return { ok: false, format, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Reserved Font Names declared in an OFL licence file.
 * @param {string} text @returns {string[]}
 */
export function reservedFontNames(text) {
  /** @type {string[]} */
  const out = [];
  for (const m of text.matchAll(/Reserved\s+Font\s+Names?([^\n]*)/gi)) {
    for (const q of m[1].matchAll(/[“"']([^”"']+)[”"']/g)) out.push(q[1].trim());
  }
  return [...new Set(out)];
}

/**
 * Reads every font file and licence of the model (font info, Reserved Font Names). Missing files stay null.
 * @param {Model} model @returns {Promise<void>}
 */
export async function loadFontInfos(model) {
  for (const f of model.fonts) {
    f.info = isFile(f.abs) ? await readFontInfo(f.abs) : null;
    f.rfn = isFile(f.licenseAbs) ? reservedFontNames(readText(f.licenseAbs)) : [];
  }
}

/**
 * The CSS font stack of a role: a declared stack as written, else the family plus a fallback stack chosen from
 * the font file's class (serif or sans) or the role (mono).
 * @param {Model} model @param {FamilyRole} role @returns {string}
 */
export function cssFontStack(model, role) {
  if (role.stack.length > 1) return role.stack.map(quoteFamily).join(', ');
  const name = role.primary;
  if (GENERIC_FAMILIES.has(name.toLowerCase())) return name;
  let kind = /** @type {'sans' | 'serif' | 'mono'} */ ('sans');
  if (role.role === 'mono') kind = 'mono';
  else {
    const font = model.fonts.find((f) => familyKey(f.family) === familyKey(name) && f.info?.ok);
    const serif = font && font.info && font.info.ok ? font.info.serif : null;
    if (serif === true || (serif === null && /serif/i.test(name) && !/sans/i.test(name))) kind = 'serif';
  }
  return [quoteFamily(name), ...FALLBACK_STACKS[kind]].join(', ');
}

// ---------------------------------------------------------------------------------------------------------------
// Semantic checks (tokens.valid)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The kind of literal a colour value is: TK-02 accepts hex, rgb() and oklch().
 * @param {string} css @returns {'hex' | 'rgb' | 'oklch' | 'reference' | 'named' | 'other'}
 */
export function colorLiteralKind(css) {
  const v = css.trim().toLowerCase();
  if (/^#[0-9a-f]+$/.test(v) && [3, 4, 6, 8].includes(v.length - 1)) return 'hex';
  if (/var\(|color-mix\(|\bfrom\s/.test(v)) return 'reference';
  if (/^rgba?\(/.test(v)) return 'rgb';
  if (/^oklch\(/.test(v)) return 'oklch';
  if (v === 'transparent' || v === 'currentcolor' || Object.hasOwn(NAMED_COLORS, v)) return 'named';
  return 'other';
}

/**
 * @param {string} token @param {number} full @returns {number | null}
 */
function oklchComponent(token, full) {
  const m = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(%)?$/.exec(token);
  if (!m) return token === 'none' ? 0 : null;
  return m[2] ? (Number(m[1]) / 100) * full : Number(m[1]);
}

/**
 * OKLab distance between a declared oklch() colour and what an sRGB screen shows after clipping (0 inside the
 * gamut); null when the value is not oklch().
 * @param {string} css @returns {number | null}
 */
export function oklchGamutDistance(css) {
  const m = /^oklch\(\s*([^\s/)]+)\s+([^\s/)]+)\s+([^\s/)]+)\s*(?:\/\s*[^\s)]+\s*)?\)$/i.exec(css.trim());
  if (!m) return null;
  const L = oklchComponent(m[1], 1);
  const C = oklchComponent(m[2], 0.4);
  const hm = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(deg)?$/.exec(m[3]);
  const H = m[3] === 'none' ? 0 : hm ? Number(hm[1]) : null;
  if (L === null || C === null || H === null) return null;
  const shown = parseColor(css);
  if (!shown) return null;
  const back = toOklch(shown);
  const rad = (/** @type {number} */ h) => (h * Math.PI) / 180;
  const c = Math.max(0, C);
  return Math.hypot(L - back.l, c * Math.cos(rad(H)) - back.c * Math.cos(rad(back.h)), c * Math.sin(rad(H)) - back.c * Math.sin(rad(back.h)));
}

/** @param {string} v @returns {boolean} */
function balanced(v) {
  let depth = 0;
  for (const ch of v) {
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/** @param {string} v @param {{unitless?: boolean}} [opts] @returns {boolean} */
export function isLength(v, { unitless = false } = {}) {
  const s = v.trim();
  if (s === '0' || DIMENSION.test(s)) return true;
  if (unitless && NUMBER.test(s)) return true;
  const fn = CSS_FUNCTION.exec(s);
  return fn !== null && balanced(fn[2]) && /\d/.test(fn[2]);
}

/**
 * Parses a duration in ms. @param {string} v @returns {number | null}
 */
function durationMs(v) {
  const m = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)$/.exec(v.trim().toLowerCase());
  if (!m) return null;
  return m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1]);
}

/** @param {string} v @returns {number[] | null} */
function bezier(v) {
  const m = /^cubic-bezier\(\s*([^,]+),([^,]+),([^,]+),([^)]+)\)$/i.exec(v.trim());
  if (!m) return null;
  const n = [m[1], m[2], m[3], m[4]].map((x) => Number(x.trim()));
  return n.every(Number.isFinite) ? n : null;
}

/**
 * True when a value is, or holds, an ease-out curve: fast start, slow end (the keyword, or a cubic-bezier whose
 * control points sit on or above the diagonal).
 * @param {string} value @returns {boolean}
 */
function easesOut(value) {
  const v = value.toLowerCase();
  if (/\bease-out\b/.test(v)) return true;
  return (v.match(/cubic-bezier\([^)]*\)/g) ?? []).some((fn) => {
    const b = bezier(fn);
    return b !== null && b[1] >= b[0] && b[3] >= b[2] && (b[1] > b[0] || b[3] > b[2]);
  });
}

/**
 * Problems of one easing value (TK-20): ease-in on UI, Tailwind's default curve, a bounce.
 * @param {string} v @returns {string[]}
 */
function easingProblems(v) {
  const s = v.trim().toLowerCase();
  if (s === 'ease-in') return ['is ease-in, which makes UI feel sluggish: use an ease-out curve such as cubic-bezier(0.23, 1, 0.32, 1) (FD03-F06)'];
  const b = bezier(s);
  if (!b) return [];
  const [x1, y1, x2, y2] = b;
  const out = [];
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) out.push('has x control points outside 0..1, which CSS rejects');
  if ([x1, y1, x2, y2].map((x) => Math.round(x * 1000)).join(',') === '400,0,200,1000') {
    out.push("is Tailwind's default cubic-bezier(0.4, 0, 0.2, 1): use the ease-out token cubic-bezier(0.23, 1, 0.32, 1) (FD03-F08)");
  }
  if (y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1) out.push('overshoots (a bounce): bounce defaults to zero, and a finance UI reads it as unserious (FD03-F13)');
  if (y1 <= 0.05 && x1 >= 0.3 && x2 >= 0.9 && y2 >= 0.95) out.push('is an ease-in curve (slow start): use ease-out for UI (FD03-F06)');
  return out;
}

/**
 * Problems of one duration against the role budgets (TK-20).
 * @param {number} ms @param {string} words name and usage, lowercased @returns {string[]}
 */
function durationProblems(ms, words) {
  if (ms < 0) return ['is negative'];
  if (MOTION_EXEMPT.test(words)) return [];
  const matched = MOTION_BUDGETS.filter((b) => b.re.test(words));
  if (matched.length > 0) {
    const tightest = matched.reduce((a, b) => (b.max < a.max ? b : a));
    return ms > tightest.max ? [`is ${ms} ms, above the ${tightest.role} budget of ${tightest.max} ms (FD03-F07)`] : [];
  }
  return ms > MOTION_UI_MAX
    ? [`is ${ms} ms: UI motion stays at ${MOTION_UI_MAX} ms or less unless its usage names a drawer or sheet (500 ms) or an explanatory animation (FD03-F07)`]
    : [];
}

/**
 * Motion problems of the whole motion list (TK-20).
 * @param {Model} model @returns {Problem[]}
 */
function motionProblems(model) {
  /** @type {Problem[]} */
  const out = [];
  const motion = model.lists.motion;
  const kinds = new Set(motion.map((t) => t.kind));
  if (!kinds.has('easing') && !kinds.has('transition')) {
    out.push({ rule: 'TK-20', path: 'motion.tokens', message: 'defines no easing: add ease-out = cubic-bezier(0.23, 1, 0.32, 1) (FD03-F06)' });
  } else if (!motion.some((t) => Object.values(t.values).some((v) => (t.kind === 'easing' || t.kind === 'transition') && easesOut(v)))) {
    out.push({ rule: 'TK-20', path: 'motion.tokens', message: 'has no ease-out curve for entrances and exits: add ease-out = cubic-bezier(0.23, 1, 0.32, 1) (FD03-F06)' });
  }
  if (!kinds.has('duration') && !kinds.has('transition')) {
    out.push({ rule: 'TK-20', path: 'motion.tokens', message: 'defines no duration: add the role budgets (press 160 ms, tooltip 125 ms, dropdown 180 ms, modal 300 ms) (FD03-F07)' });
  }
  motion.forEach((t, i) => {
    const at = `motion.tokens[${i}]`;
    const words = `${t.name.replace(/-/g, ' ')} ${t.usage}`.toLowerCase();
    for (const [theme, value] of Object.entries(t.values)) {
      const where = Object.keys(t.values).length > 1 ? `${at}.value.${theme}` : `${at}.value`;
      const kind = motionKind(value);
      if (kind === 'other') {
        out.push({ rule: 'TK-20', path: where, message: `"${value}" is not a duration, a timing function or a transition` });
        continue;
      }
      /** @type {string[]} */
      const found = [];
      if (kind === 'duration') found.push(...durationProblems(/** @type {number} */ (durationMs(value)), words));
      if (kind === 'easing') found.push(...easingProblems(value));
      if (kind === 'transition') {
        if (/(^|[\s,])all(?=$|[\s,])/.test(value.toLowerCase())) found.push('animates "all": name the properties, usually transform and opacity (FD03-F08)');
        for (const part of value.split(/[\s,]+(?![^(]*\))/)) {
          const ms = durationMs(part);
          if (ms !== null) found.push(...durationProblems(ms, words));
        }
        for (const fn of value.match(/cubic-bezier\([^)]*\)|\bease-in\b(?!-)/gi) ?? []) found.push(...easingProblems(fn));
      }
      for (const message of [...new Set(found)]) out.push({ rule: 'TK-20', path: where, message: `"${t.name}" ${message}` });
    }
  });
  return out;
}

/**
 * Everything tokens.valid checks beyond the structure, on a structurally valid model.
 * @param {Model} model @param {Record<string, any>} data @returns {Problem[]}
 */
export function semanticProblems(model, data) {
  /** @type {Problem[]} */
  const out = [];
  /** @param {string} rule @param {string} at @param {string} message */
  const add = (rule, at, message) => out.push({ rule, path: at, message });

  model.colors.forEach((c, i) => {
    for (const [theme, css] of Object.entries(c.values)) {
      const at = `color.tokens[${i}].value.${theme}`;
      const kind = colorLiteralKind(css);
      if (kind === 'reference') add('TK-02', at, `"${c.name}" uses var(), color-mix() or a relative colour; the Design System mirror drops it: write the literal value`);
      else if (kind === 'named') add('TK-02', at, `"${c.name}" is a named colour ("${css}"); the mirror drops named colours: write oklch(), rgb() or hex`);
      else if (kind === 'other') add('TK-02', at, `"${c.name}" is "${css}"; write oklch(), rgb() or hex`);
      const distance = oklchGamutDistance(css);
      if (distance !== null && distance > GAMUT_TOLERANCE) {
        add('TK-07', at, `"${c.name}" ${css} lies outside the sRGB gamut (OKLab distance ${distance.toFixed(3)} after clipping): lower its chroma so ratios do not depend on clipping`);
      }
    }
  });

  for (const cat of LIST_CATEGORIES) {
    model.lists[cat].forEach((t, i) => {
      for (const [theme, value] of Object.entries(t.values)) {
        const at = Object.keys(t.values).length > 1 || isObj(data[cat].tokens[i].value) ? `${cat}.tokens[${i}].value.${theme}` : `${cat}.tokens[${i}].value`;
        if (/var\(|color-mix\(|currentcolor/i.test(value)) add('TK-02', at, `"${t.name}" uses var(), color-mix() or currentColor; the mirror drops it: write the literal value`);
        if ((cat === 'spacing' || cat === 'radius') && !isLength(value)) add('CONTRACTS 6.2', at, `"${t.name}" is "${value}", not a length (px, rem, em, %, or clamp())`);
        if (cat === 'shadow' && value.toLowerCase() !== 'none') {
          for (const literal of value.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\([^)]*\)/gi) ?? []) {
            if (parseColor(literal) === null) add('TK-02', at, `"${t.name}" holds a colour lib/color cannot read: ${literal}`);
          }
          if (!/\d/.test(value)) add('CONTRACTS 6.2', at, `"${t.name}" is "${value}", not a box-shadow`);
        }
      }
    });
  }
  out.push(...motionProblems(model));

  model.groups.forEach((g, i) => {
    g.styles.forEach((s, j) => {
      const at = `type.groups[${i}].styles[${j}]`;
      if (!isLength(s.fontSize)) add('TK-18', `${at}.fontSize`, `"${s.name}" font size "${s.fontSize}" is not a length or a clamp()`);
      if (!(isLength(s.lineHeight, { unitless: true }) || s.lineHeight === 'normal')) add('CONTRACTS 6.2', `${at}.lineHeight`, `"${s.name}" line height "${s.lineHeight}" is not a number, a length or normal`);
      if (s.letterSpacing !== null && !(isLength(s.letterSpacing) || s.letterSpacing === 'normal')) add('CONTRACTS 6.2', `${at}.letterSpacing`, `"${s.name}" letter spacing "${s.letterSpacing}" is not a length or normal`);
    });
  });

  out.push(...familyProblems(model));
  out.push(...fontProblems(model));
  out.push(...emDashProblems(data));
  return out;
}

/**
 * TK-12: one or two families, a monospace only with a role, every font file tied to a role.
 * @param {Model} model @returns {Problem[]}
 */
function familyProblems(model) {
  /** @type {Problem[]} */
  const out = [];
  const { mono } = model.families;
  model.fonts.forEach((f, i) => {
    if (f.role === null) {
      out.push({ rule: 'TK-12', path: `type.fonts[${i}].family`, message: `"${f.family}" is none of type.families (display ${model.families.display.primary}, body ${model.families.body.primary}${mono ? `, mono ${mono.primary}` : ''}): at most two families plus a monospace with a role` });
    }
  });
  if (mono && !model.groups.some((g) => g.role === 'mono')) {
    out.push({ rule: 'TK-12', path: 'type.families.mono', message: `"${mono.primary}" has no role: give it a type group (figures, hashes or code), or set mono to null` });
  }
  if (mono) {
    const file = facesOf(model, 'mono').find((f) => f.info && f.info.ok);
    if (file && file.info && file.info.ok && !file.info.monospace) {
      out.push({ rule: 'TK-12', path: `type.fonts[${file.index}]`, message: `"${mono.primary}" (${file.file}) is not monospaced, so it would be a third family: pick a monospace face for the mono role` });
    }
  }
  return out;
}

/**
 * TK-14 and TK-17: font and licence files present and readable; every face that shows numbers has tabular
 * figures.
 * @param {Model} model @returns {Problem[]}
 */
function fontProblems(model) {
  /** @type {Problem[]} */
  const out = [];
  for (const f of model.fonts) {
    const at = `type.fonts[${f.index}]`;
    if (!isFile(f.abs)) out.push({ rule: 'TK-14', path: `${at}.file`, message: `${f.file} not found: self-host the face and point file at it` });
    else if (f.info && !f.info.ok) out.push({ rule: 'TK-17', path: `${at}.file`, message: `${f.file} cannot be read as a font (${f.info.error})` });
    if (!isFile(f.licenseAbs)) out.push({ rule: 'TK-14', path: `${at}.licenseFile`, message: `${f.licenseFile} not found: commit the licence file beside the font files` });
    else if (readText(f.licenseAbs).trim() === '') out.push({ rule: 'TK-14', path: `${at}.licenseFile`, message: `${f.licenseFile} is empty` });
  }
  const dataRoles = new Set(model.groups.filter((g) => g.data).map((g) => g.role));
  if (model.families.mono) dataRoles.add('mono');
  const fallbackToBody = dataRoles.size === 0;
  if (fallbackToBody) dataRoles.add('body');
  for (const role of dataRoles) {
    const fam = role === 'mono' ? model.families.mono : model.families[role];
    if (!fam) continue;
    const faces = facesOf(model, role);
    const why = fallbackToBody
      ? 'no type group is marked for numbers (data, figures, table...) and there is no mono role, so the body face shows the numbers'
      : role === 'mono' ? 'it is the mono role' : 'a type group for numbers uses it';
    if (faces.length === 0) {
      if (role !== 'mono') {
        out.push({ rule: 'TK-17', path: `type.families.${role}`, message: `"${fam.primary}" shows numbers (${why}) but has no font file to prove tabular figures: self-host it, or add a mono role for figures` });
      }
      continue;
    }
    const readable = faces.filter((f) => f.info && f.info.ok);
    const withDigits = readable.filter((f) => f.info && f.info.ok && f.info.digitAdvances.length > 0);
    if (readable.length > 0 && withDigits.length === 0 && !(role === 'mono' && readable.some((f) => f.info && f.info.ok && f.info.monospace))) {
      out.push({ rule: 'TK-17', path: `type.families.${role}`, message: `no font file of "${fam.primary}" maps the digits 0-9, yet it shows numbers (${why}): numbers would fall back to the next face of the stack` });
    }
    for (const f of withDigits) {
      if (!f.info || !f.info.ok || f.info.tabular) continue;
      out.push({ rule: 'TK-17', path: `type.fonts[${f.index}]`, message: `"${f.family}" (${f.file}) shows numbers (${why}) but has no tnum feature and proportional digits (${f.info.digitAdvances.join('/')}): tabular-nums would do nothing; pick a face with tabular figures for numbers` });
    }
  }
  return out;
}

/** @param {Record<string, any>} data @returns {Problem[]} */
function emDashProblems(data) {
  /** @type {Problem[]} */
  const out = [];
  /** @param {string} at @param {unknown} v */
  const check = (at, v) => {
    if (typeof v === 'string' && v.includes(EM_DASH)) out.push({ rule: 'TK-21', path: at, message: 'holds an em dash, which DESIGN.md must not carry: rewrite the sentence' });
  };
  check('name', data.name);
  check('meta.direction', data.meta.direction);
  check('meta.rationale', data.meta.rationale);
  data.meta.sources.forEach((/** @type {unknown} */ s, /** @type {number} */ i) => check(`meta.sources[${i}]`, s));
  data.color.themes.forEach((/** @type {any} */ t, /** @type {number} */ i) => check(`color.themes[${i}].name`, t.name));
  data.color.tokens.forEach((/** @type {any} */ t, /** @type {number} */ i) => check(`color.tokens[${i}].usage`, t.usage));
  for (const cat of LIST_CATEGORIES) data[cat].tokens.forEach((/** @type {any} */ t, /** @type {number} */ i) => check(`${cat}.tokens[${i}].usage`, t.usage));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Contrast pairs (tokens.contrast)
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {'text' | 'large' | 'ui' | 'surface' | 'decor'} PairKind
 * @typedef {{fg: string, bg: string, kind: PairKind, explicit: number | null, source: 'usage' | 'name'}} PairDecl
 * @typedef {{fg: string, bg: string, theme: string, themeName: string, kind: PairKind, ratio: number | null,
 *   required: number | null, ok: boolean, source: 'usage' | 'name', advice: string | null}} PairResult
 */

const KIND_DECOR = /\b(decorat\w*|illustrat\w*|ornament\w*|logos?|logotypes?|disabled|inactive)\b/;
const KIND_LARGE = /\blarge\b/;
const KIND_TEXT = /\b(text|texts|copy|labels?|headings?|headlines?|titles?|body|captions?|paragraphs?|links?|ink|foreground|fg|placeholders?|numbers?|figures?|digits?|prose|eyebrows?|hints?|helper)\b/;
const KIND_UI = /\b(borders?|outlines?|rings?|focus|strokes?|dividers?|separators?|icons?|boundar(?:y|ies)|indicators?|inputs?|controls?|charts?|graphics?|non-text|checkbox(?:es)?|toggles?|sliders?)\b/;
const KIND_SURFACE = /\b(surfaces?|backgrounds?|bg|fills?|panels?|cards?|layers?|grounds?|canvas|backdrops?|wells?|sheets?|overlays?|tints?|washes?|highlights?)\b/;
const GROUND_FILLER = new Set(['the', 'top', 'of', 'a', 'an', 'any', 'both', 'either', 'all', 'every', 'each', 'its', 'their', 'plain', 'solid']);
const LIST_JOINERS = new Set([',', '/', '&', '+', 'and', 'or']);
const MIN_RATIO = Object.freeze({ text: 4.5, large: 3, ui: 3, surface: null, decor: null });
const DARK_SURFACE_STEP = 1.1;

/**
 * The kind of a colour from the part of its usage before "on" (and its name): large text and UI parts need 3:1,
 * text 4.5:1, surfaces only a 1.1:1 step in dark themes, decoration nothing. Unknown subjects count as text.
 * @param {string} subject @param {string} name
 * @returns {{kind: PairKind, byKeyword: boolean}}
 */
export function pairKind(subject, name) {
  const s = subject.toLowerCase();
  if (KIND_DECOR.test(s)) return { kind: 'decor', byKeyword: true };
  if (KIND_LARGE.test(s)) return { kind: 'large', byKeyword: true };
  if (KIND_TEXT.test(s)) return { kind: 'text', byKeyword: true };
  if (KIND_UI.test(s)) return { kind: 'ui', byKeyword: true };
  if (KIND_SURFACE.test(s)) return { kind: 'surface', byKeyword: true };
  if (/^(text|fg|ink|on)(-|$)|-(foreground|fg)$|^foreground$/.test(name)) return { kind: 'text', byKeyword: true };
  if (/(^|-)(border|ring|focus|outline|stroke|divider)(-|$)/.test(name)) return { kind: 'ui', byKeyword: true };
  return { kind: 'text', byKeyword: false };
}

/**
 * Explicit ratios written in a usage ("4.5:1"), within WCAG's 1..21.
 * @param {string} usage @returns {number[]}
 */
function explicitRatios(usage) {
  const out = [];
  const re = /(\d{1,2}(?:\.\d+)?)\s*:\s*1(?![\d.])/g;
  let m;
  while ((m = re.exec(usage)) !== null) {
    const r = Number(m[1]);
    if (r >= 1 && r <= 21) out.push(r);
  }
  return out;
}

/**
 * The grounds a usage names after "on", "over" or "against": token names joined by commas, "and", "or", "/".
 * Unknown words end the list; an unknown word shaped like a token name (a hyphen, or letters then digits) is
 * reported, because a typo there would silently drop a pair.
 * @param {string} usage @param {Set<string>} names
 * @returns {{grounds: string[], unknown: string[], subject: string}}
 */
export function declaredGrounds(usage, names) {
  const text = usage.replace(/[`"“”‘’]/g, ' ');
  const re = /[A-Za-z0-9][A-Za-z0-9-]*|[,/&+]/g;
  /** @type {{word: string, index: number}[]} */
  const words = [];
  let m;
  while ((m = re.exec(text)) !== null) words.push({ word: m[0].toLowerCase(), index: m.index });
  /** @type {string[]} */
  const grounds = [];
  /** @type {string[]} */
  const unknown = [];
  let subjectEnd = text.length;
  for (let i = 0; i < words.length; i += 1) {
    if (!['on', 'over', 'against'].includes(words[i].word)) continue;
    let j = i + 1;
    while (j < words.length && GROUND_FILLER.has(words[j].word)) j += 1;
    let found = false;
    while (j < words.length) {
      const w = words[j].word;
      if (names.has(w)) {
        if (!grounds.includes(w)) grounds.push(w);
        found = true;
        j += 1;
        if (j < words.length && LIST_JOINERS.has(words[j].word)) {
          j += 1;
          if (j < words.length && LIST_JOINERS.has(words[j].word)) j += 1;
          continue;
        }
        break;
      }
      if (/^[a-z][a-z0-9]*-[a-z0-9-]+$|^[a-z]+\d+$/.test(w)) unknown.push(w);
      break;
    }
    if (found && words[i].index < subjectEnd) subjectEnd = words[i].index;
  }
  return { grounds, unknown, subject: text.slice(0, subjectEnd) };
}

/**
 * The declared pairs of a model: grounds named in usages, plus the naming conventions on-<x>, <x>-foreground and
 * foreground on background.
 * @param {Model} model @returns {{pairs: PairDecl[], problems: Problem[]}}
 */
export function declaredPairs(model) {
  const names = new Set(model.colors.map((c) => c.name));
  /** @type {PairDecl[]} */
  const pairs = [];
  /** @type {Problem[]} */
  const problems = [];
  model.colors.forEach((c, i) => {
    const { grounds, unknown, subject } = declaredGrounds(c.usage, names);
    const { kind, byKeyword } = pairKind(subject, c.name);
    const ratios = explicitRatios(c.usage);
    const explicit = ratios.length > 0 ? Math.min(...ratios) : null;
    for (const w of unknown) {
      problems.push({ rule: 'TK-09', path: `color.tokens[${i}].usage`, message: `"${c.name}" names "${w}" as a ground but no colour token has that name: fix the name so the pair is checked` });
    }
    for (const g of grounds) if (g !== c.name) pairs.push({ fg: c.name, bg: g, kind, explicit, source: 'usage' });
    /** @type {string | null} */
    let conventional = null;
    if (c.name.startsWith('on-') && names.has(c.name.slice(3))) conventional = c.name.slice(3);
    else if (c.name.endsWith('-foreground') && names.has(c.name.slice(0, -11))) conventional = c.name.slice(0, -11);
    else if (c.name === 'foreground' && names.has('background')) conventional = 'background';
    if (conventional && !grounds.includes(conventional)) {
      pairs.push({ fg: c.name, bg: conventional, kind: byKeyword ? kind : 'text', explicit, source: 'name' });
    }
    const hasGround = grounds.length > 0 || conventional !== null;
    if (!hasGround && byKeyword && (kind === 'text' || kind === 'large' || kind === 'ui')) {
      problems.push({ rule: 'TK-09', path: `color.tokens[${i}].usage`, message: `"${c.name}" is ${kind === 'ui' ? 'a UI part' : 'text'} but its usage names no ground: write "on <ground token>" so the pair is checked` });
    }
  });
  return { pairs, problems };
}

/**
 * The opaque colour a ground shows in a theme: a translucent ground is composited on its own declared ground,
 * else on the page ground, else on white (light) or black (dark).
 * @param {Model} model @param {string} name @param {ThemeInfo} theme @param {Map<string, string[]>} groundsOf
 * @param {number} [depth] @returns {Rgba | null}
 */
function opaqueGround(model, name, theme, groundsOf, depth = 0) {
  const token = model.colors.find((c) => c.name === name);
  if (!token) return null;
  const rgba = parseColor(effective(token, theme.id, model.base));
  if (!rgba) return null;
  if (rgba.a >= 1 || depth > 4) return rgba;
  const under = groundsOf.get(name)?.[0] ?? GROUND_NAMES.find((g) => g !== name && model.colors.some((c) => c.name === g));
  const below = under ? opaqueGround(model, under, theme, groundsOf, depth + 1) : null;
  const fallback = theme.scheme === 'dark' ? { r: 0, g: 0, b: 0, a: 1 } : { r: 1, g: 1, b: 1, a: 1 };
  return composite(rgba, below && below.a >= 1 ? below : fallback);
}

/**
 * Evaluates every declared pair in every theme with WCAG 2 ratios (lib/color).
 * @param {Model} model @returns {{results: PairResult[], problems: Problem[]}}
 */
export function evaluatePairs(model) {
  const { pairs, problems } = declaredPairs(model);
  /** @type {Map<string, string[]>} */
  const groundsOf = new Map();
  for (const p of pairs) groundsOf.set(p.fg, [...(groundsOf.get(p.fg) ?? []), p.bg]);
  /** @type {PairResult[]} */
  const results = [];
  for (const p of pairs) {
    const fgToken = /** @type {ColorToken} */ (model.colors.find((c) => c.name === p.fg));
    for (const theme of model.themes) {
      const ground = opaqueGround(model, p.bg, theme, groundsOf);
      const fg = parseColor(effective(fgToken, theme.id, model.base));
      const ratio = ground && fg ? contrastRatio(fg, ground) : null;
      /** @type {number | null} */
      let floor = MIN_RATIO[p.kind];
      if (p.kind === 'surface' && theme.scheme === 'dark') floor = DARK_SURFACE_STEP;
      const required = p.explicit !== null && p.kind !== 'surface' ? Math.max(floor ?? 0, p.explicit) : floor;
      const ok = ratio !== null && (required === null || ratio >= required);
      const advice = theme.scheme === 'dark' && p.kind === 'text' && ratio !== null && ratio >= (required ?? 0) && ratio < 7
        ? 'dark theme: aim for 7:1 on small text (FD16-F27)' : null;
      results.push({ fg: p.fg, bg: p.bg, theme: theme.id, themeName: theme.name, kind: p.kind, ratio, required, ok, source: p.source, advice });
    }
  }
  return { results, problems };
}

// ---------------------------------------------------------------------------------------------------------------
// Generated views: CSS, DESIGN.md, Claude Design mirror
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{tailwind: boolean, fontFace: boolean, darkMedia: boolean}} CssOptions
 */

/** @param {boolean} b @returns {string} */
function yn(b) {
  return b ? 'yes' : 'no';
}

/** @param {string} file @returns {string | null} */
function fontFormat(file) {
  const ext = path.extname(file).toLowerCase();
  return { '.woff2': 'woff2', '.woff': 'woff', '.otf': 'opentype', '.ttf': 'truetype' }[ext] ?? null;
}

/**
 * @param {Model} model @param {string} themeId @param {boolean} isBase @returns {string[]}
 */
function themeDeclarations(model, themeId, isBase) {
  const theme = /** @type {ThemeInfo} */ (model.themes.find((t) => t.id === themeId));
  const out = [];
  if (theme.scheme) out.push(`color-scheme: ${theme.scheme};`);
  const colors = model.colors.filter((c) => isBase || Object.hasOwn(c.values, themeId));
  if (colors.length > 0) {
    if (isBase) out.push('/* colour */');
    for (const c of colors) out.push(`${c.cssVar}: ${isBase ? c.values[model.base] : c.values[themeId]};`);
  }
  if (isBase) {
    out.push('/* type */');
    out.push(`--font-display: ${cssFontStack(model, model.families.display)};`);
    out.push(`--font-body: ${cssFontStack(model, model.families.body)};`);
    if (model.families.mono) out.push(`--font-mono: ${cssFontStack(model, model.families.mono)};`);
    for (const g of model.groups) {
      for (const s of g.styles) {
        out.push(`${s.cssVar}: ${s.fontSize};`, `${s.cssVar}--line-height: ${s.lineHeight};`, `${s.cssVar}--font-weight: ${s.fontWeight};`);
        if (s.letterSpacing !== null) out.push(`${s.cssVar}--letter-spacing: ${s.letterSpacing};`);
      }
    }
  }
  for (const cat of LIST_CATEGORIES) {
    const tokens = model.lists[cat].filter((t) => isBase || Object.hasOwn(t.values, themeId));
    if (tokens.length === 0) continue;
    if (isBase) out.push(`/* ${cat} */`);
    for (const t of tokens) out.push(`${t.cssVar}: ${isBase ? effective(t, model.base, model.base) : t.values[themeId]};`);
  }
  return out;
}

/** @param {string[]} lines @param {string} pad @returns {string[]} */
function indent(lines, pad = '  ') {
  return lines.map((l) => `${pad}${l}`);
}

/**
 * The motion token Tailwind's default transition points at: a press duration, else the shortest duration; the
 * ease-out curve, else the first easing.
 * @param {Model} model @returns {{duration: ValueToken | null, easing: ValueToken | null}}
 */
function defaultTransition(model) {
  const durations = model.lists.motion.filter((t) => t.kind === 'duration');
  const easings = model.lists.motion.filter((t) => t.kind === 'easing');
  const press = durations.find((t) => /press|tap/.test(t.name));
  const shortest = [...durations].sort((a, b) => (durationMs(effective(a, model.base, model.base)) ?? 0) - (durationMs(effective(b, model.base, model.base)) ?? 0))[0];
  const easeOut = easings.find((t) => t.cssVar === '--ease-out') ?? easings.find((t) => /out/.test(t.name) && !/in-out/.test(t.name)) ?? easings[0];
  return { duration: press ?? shortest ?? null, easing: easeOut ?? null };
}

/**
 * Renders the generated CSS: @font-face rules, the base theme on :root, the other themes on [data-theme] (the dark
 * one also under prefers-color-scheme and .dark), one .type-<style> class per type style, and with `tailwind` a
 * @theme block that resets the default namespaces before mapping the tokens.
 * @param {Model} model @param {string} cssAbs where the CSS will be written (font URLs are relative to it)
 * @param {CssOptions} options @returns {string}
 */
export function renderCss(model, cssAbs, options) {
  const out = [
    `/* ${GENERATED_MARK} from ${model.rel} (sha256 ${model.sha}). Do not edit: change the tokens file and run tokens.mjs build. */`,
    `/* tokens.mjs options: tailwind=${yn(options.tailwind)} font-face=${yn(options.fontFace)} dark-media=${yn(options.darkMedia)} */`,
  ];
  if (options.tailwind) out.push('/* Import this file after @import "tailwindcss": its @theme block resets Tailwind\'s default namespaces. */');
  if (options.fontFace) {
    for (const f of model.fonts) {
      let url = toPosix(path.relative(path.dirname(cssAbs), f.abs));
      if (!url.startsWith('.')) url = `./${url}`;
      const format = fontFormat(f.file);
      out.push('', '@font-face {', ...indent([
        `font-family: ${quoteFamily(f.family)};`,
        `src: url("${url.replace(/"/g, '%22')}")${format ? ` format("${format}")` : ''};`,
        `font-weight: ${f.weight};`,
        `font-style: ${f.style};`,
        'font-display: swap;',
      ]), '}');
    }
  }
  out.push('', ':root {', ...indent(themeDeclarations(model, model.base, true)), '}');
  const baseScheme = model.themes[0].scheme;
  const firstDark = model.themes.slice(1).find((t) => t.scheme === 'dark');
  for (const theme of model.themes.slice(1)) {
    const decls = themeDeclarations(model, theme.id, false);
    if (theme === firstDark && options.darkMedia && baseScheme !== 'dark') {
      out.push('', '@media (prefers-color-scheme: dark) {', '  :root:not([data-theme]) {', ...indent(decls, '    '), '  }', '}');
    }
    const selectors = [`:root[data-theme="${theme.id}"]`];
    if (theme === firstDark) selectors.push('.dark');
    out.push('', `${selectors.join(', ')} {`, ...indent(decls), '}');
  }
  for (const g of model.groups) {
    for (const s of g.styles) {
      const decls = [
        `font-family: var(--font-${g.role});`,
        `font-size: var(${s.cssVar});`,
        `line-height: var(${s.cssVar}--line-height);`,
        `font-weight: var(${s.cssVar}--font-weight);`,
      ];
      if (s.letterSpacing !== null) decls.push(`letter-spacing: var(${s.cssVar}--letter-spacing);`);
      if (g.data) decls.push('font-variant-numeric: tabular-nums;');
      out.push('', `.${s.className} {`, ...indent(decls), '}');
    }
  }
  if (options.tailwind) out.push('', ...tailwindTheme(model));
  return `${out.join('\n')}\n`;
}

/**
 * The Tailwind v4 @theme block: the namespace resets, then the tokens under Tailwind's names with their base values
 * (the theme blocks above override them at runtime, unlayered).
 * @param {Model} model @returns {string[]}
 */
function tailwindTheme(model) {
  const decls = TAILWIND_RESETS.map((ns) => `${ns}: initial;`);
  for (const c of model.colors) decls.push(`${c.cssVar}: ${c.values[model.base]};`);
  decls.push(`--font-display: ${cssFontStack(model, model.families.display)};`);
  decls.push(`--font-body: ${cssFontStack(model, model.families.body)};`);
  if (model.families.mono) decls.push(`--font-mono: ${cssFontStack(model, model.families.mono)};`);
  decls.push(`--default-font-family: ${cssFontStack(model, model.families.body)};`);
  if (model.families.mono) decls.push(`--default-mono-font-family: ${cssFontStack(model, model.families.mono)};`);
  for (const g of model.groups) {
    for (const s of g.styles) {
      decls.push(`${s.cssVar}: ${s.fontSize};`, `${s.cssVar}--line-height: ${s.lineHeight};`, `${s.cssVar}--font-weight: ${s.fontWeight};`);
      if (s.letterSpacing !== null) decls.push(`${s.cssVar}--letter-spacing: ${s.letterSpacing};`);
    }
  }
  for (const cat of /** @type {const} */ (['spacing', 'radius', 'shadow'])) {
    for (const t of model.lists[cat]) decls.push(`${t.cssVar}: ${effective(t, model.base, model.base)};`);
  }
  for (const t of model.lists.motion) if (t.kind === 'easing') decls.push(`${t.cssVar}: ${effective(t, model.base, model.base)};`);
  const { duration, easing } = defaultTransition(model);
  if (duration) decls.push(`--default-transition-duration: ${effective(duration, model.base, model.base)};`);
  if (easing) decls.push(`--default-transition-timing-function: ${effective(easing, model.base, model.base)};`);
  return ['@theme {', ...indent(decls), '}'];
}

/**
 * Parses the options line of a generated CSS file.
 * @param {string} text @returns {{source: string, sha: string, options: CssOptions} | null}
 */
export function parseCssHeader(text) {
  const head = /^\/\* Generated by tokens\.mjs from (.+?) \(sha256 ([0-9a-f]{16})\)\./.exec(text);
  const opts = /^\/\* tokens\.mjs options: tailwind=(yes|no) font-face=(yes|no) dark-media=(yes|no) \*\/$/m.exec(text);
  if (!head || !opts) return null;
  return { source: head[1], sha: head[2], options: { tailwind: opts[1] === 'yes', fontFace: opts[2] === 'yes', darkMedia: opts[3] === 'yes' } };
}

/**
 * A YAML double-quoted scalar.
 * @param {string} s @returns {string}
 */
function yamlString(s) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s*[\r\n]+\s*/g, ' ')}"`;
}

/**
 * A YAML mapping key: token names stay plain unless YAML would read them as a number, a boolean or null.
 * @param {string} name @returns {string}
 */
function yamlKey(name) {
  return /^(?:\d[\d-]*|y|yes|n|no|true|false|on|off|null)$/.test(name) ? yamlString(name) : name;
}

/**
 * A plain dimension (px, rem or em) usable where design.md expects one; the upper bound of a clamp().
 * @param {string} v @param {string[]} units @returns {string | null}
 */
function plainDimension(v, units = ['px', 'rem', 'em']) {
  const s = v.trim();
  const unit = DIMENSION.exec(s)?.[1]?.toLowerCase();
  if (unit && units.includes(unit)) return s;
  if (s === '0') return '0px';
  const fn = /^clamp\((.*)\)$/is.exec(s);
  if (fn) {
    const parts = splitTopLevel(fn[1]);
    if (parts.length === 3) return plainDimension(parts[2], units);
  }
  return null;
}

/** @param {string} s @returns {string[]} */
function splitTopLevel(s) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else current += ch;
  }
  out.push(current.trim());
  return out;
}

/**
 * The colour token whose role is the primary action (for design.md's `primary`).
 * @param {Model} model @returns {ColorToken | null}
 */
function primaryColor(model) {
  return model.colors.find((c) => c.name === 'primary')
    ?? model.colors.find((c) => /\bprimary\b/i.test(c.usage) && !/^(on-|text)/.test(c.name) && !c.name.endsWith('-foreground'))
    ?? null;
}

/** @param {string} css @returns {string} */
function hexOf(css) {
  const rgba = parseColor(css);
  return rgba ? toHex(rgba).toUpperCase() : css;
}

/**
 * The YAML front matter of DESIGN.md (design.md alpha): one family per fontFamily, plain dimensions only.
 * @param {Model} model @returns {string[]}
 */
function designFrontMatter(model) {
  const out = ['---', 'version: alpha', `name: ${yamlString(model.name)}`, `description: ${yamlString(model.meta.direction)}`, 'colors:'];
  for (const c of model.colors) out.push(`  ${yamlKey(c.name)}: ${yamlString(hexOf(c.values[model.base]))}`);
  const primary = primaryColor(model);
  if (primary && primary.name !== 'primary') out.push(`  primary: ${yamlString(hexOf(primary.values[model.base]))}`);
  out.push('typography:');
  for (const g of model.groups) {
    const fam = g.role === 'mono' ? model.families.mono : model.families[g.role];
    for (const s of g.styles) {
      out.push(`  ${yamlKey(s.name)}:`, `    fontFamily: ${yamlString(fam ? fam.primary : model.families.body.primary)}`);
      const size = plainDimension(s.fontSize);
      if (size) out.push(`    fontSize: ${yamlString(size)}`);
      if (NUMBER.test(s.fontWeight)) out.push(`    fontWeight: ${Number(s.fontWeight)}`);
      if (NUMBER.test(s.lineHeight)) out.push(`    lineHeight: ${Number(s.lineHeight)}`);
      else if (/%$/.test(s.lineHeight) && NUMBER.test(s.lineHeight.slice(0, -1))) out.push(`    lineHeight: ${Number(s.lineHeight.slice(0, -1)) / 100}`);
      else {
        const lh = plainDimension(s.lineHeight);
        if (lh) out.push(`    lineHeight: ${yamlString(lh)}`);
      }
      const ls = s.letterSpacing === null ? null : plainDimension(s.letterSpacing);
      if (ls) out.push(`    letterSpacing: ${yamlString(ls)}`);
      if (g.data) out.push(`    fontFeature: ${yamlString('"tnum"')}`);
    }
  }
  const rounded = model.lists.radius.map((t) => [t.name, plainDimension(effective(t, model.base, model.base))]).filter(([, v]) => v);
  if (rounded.length > 0) out.push('rounded:', ...rounded.map(([n, v]) => `  ${yamlKey(String(n))}: ${yamlString(String(v))}`));
  const spacing = model.lists.spacing.map((t) => [t.name, plainDimension(effective(t, model.base, model.base))]).filter(([, v]) => v);
  if (spacing.length > 0) out.push('spacing:', ...spacing.map(([n, v]) => `  ${yamlKey(String(n))}: ${yamlString(String(v))}`));
  out.push('---');
  return out;
}

/**
 * The Markdown body shared by DESIGN.md and the mirror's README: colours with the pair table, type with fonts,
 * layout, elevation, shapes, components, motion, do's and don'ts.
 * @param {Model} model @param {PairResult[]} pairs @param {{heading: string}} opts @returns {string[]}
 */
function designBody(model, pairs, { heading }) {
  const themes = model.themes;
  const out = [`# ${model.name}`, '', heading, '', '## Overview', '', `${model.meta.direction}. ${model.meta.rationale}`];
  if (model.meta.sources.length > 0) out.push('', `Sources: ${model.meta.sources.join(', ')}.`);
  out.push('', '## Colors', '');
  out.push(`| token | ${themes.map((t) => cell(t.name)).join(' | ')} | usage |`);
  out.push(`|---|${themes.map(() => '---').join('|')}|---|`);
  for (const c of model.colors) {
    out.push(`| ${c.name} | ${themes.map((t) => cell(effective(c, t.id, model.base))).join(' | ')} | ${cell(c.usage)} |`);
  }
  out.push('', 'Pairs (WCAG 2 ratios computed by tokens.mjs from the values above):', '');
  if (pairs.length === 0) out.push('No colour names a ground in its usage yet.');
  else {
    out.push('| colour | on | theme | ratio | needs | result |', '|---|---|---|---|---|---|');
    for (const p of pairs) {
      const needs = p.required === null ? 'none' : `${fixed(p.required, 2)}:1`;
      const result = p.ratio === null ? 'unreadable' : p.ok ? 'pass' : 'FAIL';
      out.push(`| ${p.fg} | ${p.bg} | ${cell(p.themeName)} | ${p.ratio === null ? 'n/a' : ratioText(p.ratio)} | ${needs} | ${result} |`);
    }
  }
  out.push('', 'Text pairs must meet 4.5:1 (3:1 for large text and for UI component boundaries); this pair table is the evidence, because axe cannot see non-text contrast, gradients or image grounds (FD16).');

  out.push('', '## Typography', '', '| style | family | size | line height | weight | letter spacing |', '|---|---|---|---|---|---|');
  for (const g of model.groups) {
    const fam = g.role === 'mono' ? model.families.mono : model.families[g.role];
    for (const s of g.styles) {
      out.push(`| ${s.name} | ${cell(fam ? fam.primary : model.families.body.primary)} (${g.role}) | ${cell(s.fontSize)} | ${cell(s.lineHeight)} | ${cell(s.fontWeight)} | ${cell(s.letterSpacing ?? 'normal')} |`);
    }
  }
  const { mono } = model.families;
  out.push('', `Families: display ${model.families.display.primary}, body ${model.families.body.primary}, mono ${mono ? mono.primary : 'none'}. CSS class \`.type-<style>\` applies a style; \`--font-display\`, \`--font-body\`${mono ? ' and `--font-mono`' : ''} hold the stacks.`);
  if (model.fonts.length > 0) {
    out.push('', '| face | role | weight | style | file | licence | tabular figures |', '|---|---|---|---|---|---|---|');
    for (const f of model.fonts) {
      const roles = rolesOf(model, f.family);
      out.push(`| ${cell(f.family)} | ${roles.length > 0 ? roles.join(', ') : 'none'} | ${cell(f.weight)} | ${f.style} | ${cell(f.file)} | ${cell(f.license)} (${cell(f.licenseFile)}) | ${tabularText(f.info)} |`);
    }
  }
  const notes = fontNotes(model);
  if (notes.length > 0) out.push('', ...notes.map((n) => `- ${n}`));
  out.push('', 'Fonts are open-licensed and self-hosted with their licence files; faces that show numbers use tabular figures.');

  /** @param {ValueToken[]} list @param {string} label */
  const table = (list, label) => {
    if (list.length === 0) return [`No ${label} tokens.`];
    return [`| ${label} token | ${themes.length > 1 && list.some((t) => Object.keys(t.values).length > 1) ? themes.map((t) => cell(t.name)).join(' | ') : 'value'} | usage |`,
      `|---|${themes.length > 1 && list.some((t) => Object.keys(t.values).length > 1) ? themes.map(() => '---').join('|') : '---'}|---|`,
      ...list.map((t) => `| ${t.name} | ${themes.length > 1 && list.some((x) => Object.keys(x.values).length > 1) ? themes.map((th) => cell(effective(t, th.id, model.base))).join(' | ') : cell(effective(t, model.base, model.base))} | ${cell(t.usage)} |`)];
  };
  out.push('', '## Layout', '', ...table(model.lists.spacing, 'spacing'));
  out.push('', '## Elevation & Depth', '', ...table(model.lists.shadow, 'shadow'));
  out.push('', '## Shapes', '', ...table(model.lists.radius, 'radius'));
  out.push('', '## Components', '', 'Components take every value from the tokens above; this file defines no component tokens.');
  out.push('', '## Motion', '', ...table(model.lists.motion, 'motion'));
  out.push('', 'Motion answers a user action or a real state change and nothing else; the page is complete at rest. Ease-out curves, transitions rather than keyframes, no bounce; press 100-160 ms, tooltip 125-200, dropdown 150-250, modal 200-300; under reduced motion, gentler rather than off, and no content hidden at rest (FD03).');
  out.push('', "## Do's and Don'ts", '');
  out.push('- Do take every colour, size, radius, shadow and curve from these tokens through the generated CSS custom properties; never write a hex, rgb() or oklch() value in a component.');
  out.push('- Do put each text colour only on the grounds its pair names above; never on a gradient, an image or grain without a solid plate.');
  out.push("- Don't add a third type family; the monospace face is for figures, hashes and code only.");
  out.push("- Don't use transition: all, ease-in or a bounce on UI; use the motion tokens.");
  out.push("- Don't use Tailwind's default palette, arbitrary values such as bg-[#hex], or a default Geist or Inter import.");
  return out;
}

/** @param {FontInfo | null} info @returns {string} */
function tabularText(info) {
  if (!info) return 'file missing';
  if (!info.ok) return `unreadable (${cell(info.error)})`;
  if (info.monospace) return 'yes (monospace)';
  if (info.tnum) return 'yes (tnum)';
  if (info.digitsTabular) return 'yes (default digits)';
  return 'no';
}

/** @param {Model} model @returns {string[]} */
function fontNotes(model) {
  /** @type {string[]} */
  const notes = [];
  const rationale = model.meta.rationale.toLowerCase();
  for (const role of ROLES) {
    const fam = role === 'mono' ? model.families.mono : model.families[role];
    if (!fam) continue;
    const key = familyKey(fam.primary);
    const reflex = REFLEX_FACES.find((r) => key === r || key.startsWith(`${r} `));
    if (reflex && !notes.some((n) => n.startsWith(`${fam.primary} `))) {
      notes.push(`${fam.primary} is on the dated reflex list (FD16-F14): ${rationale.includes(key) ? 'meta.rationale gives the reason' : 'give the reason in meta.rationale (TK-13)'}.`);
    }
    if (facesOf(model, role).length === 0 && !GENERIC_FAMILIES.has(fam.primary.toLowerCase())) {
      notes.push(`${fam.primary} (${role}) is a system face with no file: it renders differently per OS.`);
    }
  }
  for (const f of model.fonts) {
    for (const rfn of f.rfn) {
      const line = `${f.family}: the licence reserves the name "${rfn}"; ship the files unmodified, or rename a subset in its name table and @font-face (TK-15).`;
      if (!notes.includes(line)) notes.push(line);
    }
  }
  return notes;
}

/**
 * Renders DESIGN.md: the design.md alpha front matter, a generated-file note, then the body.
 * @param {Model} model @param {PairResult[]} pairs @returns {string}
 */
export function renderDesignMd(model, pairs) {
  const note = `<!-- ${GENERATED_MARK} from ${model.rel} (sha256 ${model.sha}). Do not edit: change the tokens file and run tokens.mjs build. -->`;
  const body = designBody(model, pairs, { heading: 'The look of this project, generated from its tokens file. Agents read it, with the generated CSS, before any UI work.' });
  return `${[...designFrontMatter(model), note, '', ...body].join('\n')}\n`;
}

/**
 * The Claude Design "Design System" tokens.json mirror (list-shaped; names unique across families; lengths in
 * px, rem, em or %; no motion family), and the fonts to copy.
 * @param {Model} model
 * @returns {{tokens: Record<string, unknown>, fonts: {abs: string, name: string}[], dropped: string[]}}
 */
export function mirrorTokens(model) {
  /** @type {string[]} */
  const dropped = [];
  /** @type {Map<string, string>} */
  const used = new Map();
  /** @param {string} name @param {string} family */
  const claim = (name, family) => {
    const other = used.get(name);
    if (other) throw new UsageError(`the mirror needs names unique across families: ${family} "${name}" collides with ${other}; rename one token`);
    used.set(name, family);
    return name;
  };
  const color = {
    themes: model.themes.map((t) => ({ id: t.id, name: t.name })),
    tokens: model.colors.map((c) => ({
      name: claim(c.name, 'color'),
      value: Object.fromEntries(model.themes.filter((t) => Object.hasOwn(c.values, t.id)).map((t) => [t.id, c.values[t.id]])),
      usage: c.usage,
    })),
  };
  /** @type {{abs: string, name: string}[]} */
  const fonts = [];
  const fontEntries = [];
  for (const f of model.fonts) {
    if (/\bFFL\b|fontshare|itf free font/i.test(f.license)) {
      dropped.push(`font ${f.file}: its licence (${f.license}) forbids design tools (FD16-F12)`);
      continue;
    }
    if (!isFile(f.abs)) {
      dropped.push(`font ${f.file}: file not found`);
      continue;
    }
    if (statSync(f.abs).size > 15 * 1024 * 1024) {
      dropped.push(`font ${f.file}: larger than the 15 MiB file cap`);
      continue;
    }
    let name = path.basename(f.abs);
    for (let n = 2; fonts.some((x) => x.name === name); n += 1) name = `${path.basename(f.abs, path.extname(f.abs))}-${n}${path.extname(f.abs)}`;
    fonts.push({ abs: f.abs, name });
    fontEntries.push({ family: f.family, file: `fonts/${name}`, weight: f.weight, style: f.style });
  }
  /** @type {Record<string, string>} */
  const families = {
    display: cssFontStack(model, model.families.display),
    body: cssFontStack(model, model.families.body),
  };
  if (model.families.mono) families.mono = cssFontStack(model, model.families.mono);
  const groups = model.groups.map((g) => ({
    name: g.name,
    family: g.role,
    styles: g.styles.map((s) => {
      /** @type {Record<string, string | number>} */
      const style = { name: s.name };
      const size = plainDimension(s.fontSize, ['px', 'rem', 'em', '%']);
      if (size) style.fontSize = size;
      else dropped.push(`type style ${s.name}: font size ${s.fontSize} is not px, rem, em or %`);
      if (NUMBER.test(s.lineHeight)) style.lineHeight = Number(s.lineHeight);
      else {
        const lh = plainDimension(s.lineHeight, ['px', 'rem', 'em', '%']);
        if (lh) style.lineHeight = lh;
        else dropped.push(`type style ${s.name}: line height ${s.lineHeight} is not a number or a length`);
      }
      style.fontWeight = NUMBER.test(s.fontWeight) ? Number(s.fontWeight) : s.fontWeight;
      if (s.letterSpacing !== null) {
        const ls = plainDimension(s.letterSpacing, ['px', 'rem', 'em', '%']);
        if (ls) style.letterSpacing = ls;
      }
      return style;
    }),
  }));
  /** @param {ListCategory} cat */
  const list = (cat) => model.lists[cat].flatMap((t) => {
    const name = t.cssVar.slice(2);
    const value = effective(t, model.base, model.base);
    const shownValue = cat === 'shadow' ? value : plainDimension(value, ['px', 'rem', 'em', '%']);
    if (shownValue === null) {
      dropped.push(`${cat} ${t.name}: ${value} is not px, rem, em or %`);
      return [];
    }
    return [{ name: claim(name, cat), value: shownValue, usage: t.usage }];
  });
  const tokens = {
    name: model.name,
    version: model.version,
    color,
    type: { fonts: fontEntries, families, groups },
    spacing: { tokens: list('spacing') },
    radius: { tokens: list('radius') },
    shadow: { tokens: list('shadow') },
  };
  return { tokens, fonts, dropped };
}

/**
 * The mirror's README.md (the system's brand book).
 * @param {Model} model @param {PairResult[]} pairs @param {string[]} dropped @returns {string}
 */
function renderMirrorReadme(model, pairs, dropped) {
  const lines = designBody(model, pairs, {
    heading: `<!-- ${GENERATED_MARK} from ${model.rel} (sha256 ${model.sha}). A one-way mirror: change the tokens file in the repository and run tokens.mjs build --mirror; agents never read tokens back from here. -->`,
  });
  if (dropped.length > 0) lines.push('', '## Not in this mirror', '', ...dropped.map((d) => `- ${d}`));
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------
// Freshness of the generated views
// ---------------------------------------------------------------------------------------------------------------

/**
 * Generated CSS files under the root whose header names this tokens file.
 * @param {string} root @param {string} rel @returns {string[]} absolute paths
 */
export function findGeneratedCss(root, rel) {
  return walk(root, { include: ['*.css'] }).map((r) => path.join(root, r)).filter((abs) => {
    const head = readHead(abs, 400);
    const parsed = head.includes(GENERATED_MARK) ? parseCssHeader(head) : null;
    return parsed !== null && parsed.source === rel;
  });
}

/** @param {string} abs @param {number} bytes @returns {string} */
function readHead(abs, bytes) {
  try {
    return readFileSync(abs, 'utf8').slice(0, bytes);
  } catch {
    return '';
  }
}

/**
 * Compares the generated views on disk with what the current tokens produce.
 * @param {Model} model @param {PairResult[]} pairs @returns {Problem[]}
 */
export function viewProblems(model, pairs) {
  /** @type {Problem[]} */
  const out = [];
  const designMd = path.join(model.design, 'DESIGN.md');
  const mdRel = shown(model.root, designMd);
  if (!isFile(designMd)) {
    out.push({ rule: 'TK-21', path: 'DESIGN.md', file: mdRel, message: `${mdRel} not found: run tokens.mjs build` });
  } else {
    const actual = normaliseNewlines(readText(designMd));
    if (!actual.includes(GENERATED_MARK)) out.push({ rule: 'TK-21', path: 'DESIGN.md', file: mdRel, message: `${mdRel} was not generated by tokens.mjs: move it aside and run tokens.mjs build` });
    else if (actual !== renderDesignMd(model, pairs)) out.push({ rule: 'TK-01', path: 'DESIGN.md', file: mdRel, message: `${mdRel} ${staleOrEdited(actual, model.sha)}: run tokens.mjs build` });
  }
  const css = findGeneratedCss(model.root, model.rel);
  if (css.length === 0) out.push({ rule: 'TK-01', path: 'CSS', file: model.rel, message: `no CSS generated from ${model.rel} under the root: run tokens.mjs build (add --css <file> for the app's styles folder)` });
  for (const abs of css) {
    const actual = normaliseNewlines(readText(abs));
    const header = /** @type {NonNullable<ReturnType<typeof parseCssHeader>>} */ (parseCssHeader(actual));
    if (actual !== renderCss(model, abs, header.options)) {
      out.push({ rule: 'TK-01', path: 'CSS', file: shown(model.root, abs), message: `${shown(model.root, abs)} ${staleOrEdited(actual, model.sha)}: run tokens.mjs build` });
    }
  }
  return out;
}

/** @param {string} text @param {string} sha @returns {string} */
function staleOrEdited(text, sha) {
  return text.includes(`(sha256 ${sha})`)
    ? 'differs from what tokens.mjs generates from the same tokens (edited by hand)'
    : 'was generated from an older tokens file (stale)';
}

// ---------------------------------------------------------------------------------------------------------------
// Leak scanning (tokens.leak)
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{kind: string, file: string, line: number, value: string, detail: string}} Leak
 * @typedef {{vars: Set<string>, colorNames: Set<string>, families: Set<string>}} TokenFacts
 */

const COLOR_UTILITIES = 'bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|inset-ring|outline|decoration|divide|placeholder|caret|accent|fill|stroke|from|via|to|shadow|inset-shadow|drop-shadow|text-shadow';
const PALETTE_CLASS = new RegExp(
  `(?<![\\w-])(?:[\\w-]+:)*!?(?:${COLOR_UTILITIES})-((?:${TAILWIND_PALETTES.join('|')})-(?:${TAILWIND_SHADES.join('|')})|black|white)(?:\\/(?:\\d{1,3}|\\[[^\\]\\s]+\\]))?(?![\\w-])`,
  'g',
);
const ARBITRARY_VALUE = /(?<![\w-])((?:[\w-]+:)*!?-?[a-z][\w-]*?)-\[([^\]\s'"`<>]{1,300})\]/g;
const ARBITRARY_PROPERTY = /(?<![\w-])(?:[\w-]+:)*!?\[([a-z-]+|--[\w-]+):([^\]\s'"`<>]{1,300})\]/g;
const CUSTOM_PROPERTY_FORM = /(?<![\w-])((?:[\w-]+:)*!?-?[a-z][\w-]*?)-\((?:[a-z-]+:)?(--[\w-]+)\)/g;
const COLOR_LITERAL = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/;
const GRADIENT = /\b(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;
const COLOR_PROPERTIES = /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|caret-color|accent-color|text-decoration(?:-color)?|column-rule(?:-color)?|stop-color|flood-color|lighting-color)$/i;
const FONT_PACKAGE = /^@fontsource(?:-variable)?\/(inter|geist(?:-sans|-mono)?)$|^geist$/;

/**
 * Normalises a font family name for comparison with imports (Inter Variable is Inter, Geist Sans is Geist).
 * @param {string} name @returns {string}
 */
function fontImportKey(name) {
  const k = name.toLowerCase().replace(/^__/, '').replace(/_[0-9a-f]{6}$/, '').replace(/[\s_-]+/g, '').replace(/variable$/, '');
  if (k === 'geistsans') return 'geist';
  if (k === 'interdisplay' || k === 'intertight') return 'inter';
  return k;
}

/**
 * Display form of an Inter or Geist package or file name: geist-sans is Geist, geist-mono is Geist Mono.
 * @param {string} raw @returns {string}
 */
function displayFamily(raw) {
  return raw.replace(/-sans$/i, '').split(/[-\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

/**
 * Removes CSS escapes before a non-hex character, so `.bg-\[\#fff\]` reads as `.bg-[#fff]` (offsets kept close).
 * @param {string} css @returns {string}
 */
function unescapeCss(css) {
  return css.replace(/\\([^0-9a-fA-F\r\n])/g, '$1');
}

/** @param {string} text @param {number} index @returns {string} */
function excerpt(text, index) {
  const start = text.lastIndexOf('\n', index) + 1;
  let end = text.indexOf('\n', index);
  if (end < 0) end = text.length;
  const line = text.slice(start, end);
  if (line.length <= 120) return line.trim();
  const from = Math.max(0, Math.min(index - start - 40, line.length - 117));
  return `${from > 0 ? '...' : ''}${line.slice(from, from + 114).trim()}...`;
}

/** @param {string} utility @returns {string} */
function baseUtility(utility) {
  return utility.split(':').pop()?.replace(/^!/, '') ?? utility;
}

/**
 * Class-level leaks in any text: arbitrary colour, gradient or blur values, arbitrary properties, custom-property
 * forms naming a variable the tokens do not generate, and (Tailwind only) default palette classes.
 * @param {string} text @param {string} file @param {TokenFacts} facts @param {boolean} tailwind @returns {Leak[]}
 */
export function classLeaks(text, file, facts, tailwind) {
  /** @type {Leak[]} */
  const out = [];
  /** @param {string} kind @param {number} index @param {string} detail */
  const push = (kind, index, detail) => out.push({ kind, file, line: lineOf(text, index), value: excerpt(text, index), detail });
  let m;
  ARBITRARY_VALUE.lastIndex = 0;
  while ((m = ARBITRARY_VALUE.exec(text)) !== null) {
    const utility = baseUtility(m[1]);
    const value = m[2].replace(/_/g, ' ');
    if (GRADIENT.test(value)) push('arbitrary-gradient', m.index, `${utility}-[${m[2]}] is a gradient outside the tokens`);
    else if (COLOR_LITERAL.test(value)) push('arbitrary-color', m.index, `${utility}-[${m[2]}] is a colour outside the tokens`);
    else if (/(?:^|-)blur$/.test(utility)) push('arbitrary-blur', m.index, `${utility}-[${m[2]}] is a blur outside the tokens`);
    else {
      const ref = /^var\((--[\w-]+)/.exec(value);
      if (ref && !facts.vars.has(ref[1])) push('custom-property', m.index, `${utility}-[${m[2]}] reads ${ref[1]}, which the tokens do not define`);
    }
  }
  ARBITRARY_PROPERTY.lastIndex = 0;
  while ((m = ARBITRARY_PROPERTY.exec(text)) !== null) {
    const value = m[2].replace(/_/g, ' ');
    if (GRADIENT.test(value)) push('arbitrary-gradient', m.index, `[${m[1]}:${m[2]}] is a gradient outside the tokens`);
    else if (COLOR_LITERAL.test(value)) push('arbitrary-color', m.index, `[${m[1]}:${m[2]}] is a colour outside the tokens`);
    else if (/\bblur\(/i.test(value)) push('arbitrary-blur', m.index, `[${m[1]}:${m[2]}] is a blur outside the tokens`);
  }
  CUSTOM_PROPERTY_FORM.lastIndex = 0;
  while ((m = CUSTOM_PROPERTY_FORM.exec(text)) !== null) {
    if (!facts.vars.has(m[2])) push('custom-property', m.index, `${baseUtility(m[1])}-(${m[2]}) reads ${m[2]}, which the tokens do not define`);
  }
  if (tailwind) {
    PALETTE_CLASS.lastIndex = 0;
    while ((m = PALETTE_CLASS.exec(text)) !== null) {
      if (facts.colorNames.has(m[1])) continue;
      push('default-palette', m.index, `${m[0].replace(/^.*:/, '')} is a Tailwind default colour, not a token`);
    }
  }
  return out;
}

/**
 * Default Geist or Inter imports that the tokens do not declare.
 * @param {string} text @param {string} file @param {TokenFacts} facts @returns {Leak[]}
 */
export function fontImportLeaks(text, file, facts) {
  /** @type {Leak[]} */
  const out = [];
  /** @param {string} family @param {number} index @param {string} detail */
  const push = (family, index, detail) => {
    if (facts.families.has(fontImportKey(family))) return;
    out.push({ kind: 'default-font', file, line: lineOf(text, index), value: excerpt(text, index), detail });
  };
  let m;
  const nextFont = /import\s*\{([^}]*)\}\s*from\s*['"]next\/font\/google['"]/g;
  while ((m = nextFont.exec(text)) !== null) {
    for (const spec of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      if (/^(Inter|Inter_Tight|Geist|Geist_Mono)$/.test(spec)) push(spec.replace(/_/g, ' '), m.index, `${spec} from next/font/google is a starter default (FD16-F04)`);
    }
  }
  const pkg = /['"](@fontsource(?:-variable)?\/(inter|geist(?:-sans|-mono)?)|geist\/font(?:\/[\w-]+)?)(?:\/[^'"]*)?['"]/g;
  while ((m = pkg.exec(text)) !== null) {
    const family = m[2] ? displayFamily(m[2]) : /mono/.test(m[1]) ? 'Geist Mono' : 'Geist';
    push(family, m.index, `${m[1]} imports ${family}, which the tokens do not declare`);
  }
  const hosted = /fonts\.googleapis\.com\/css2?\?[^"'\s)]*family=(Inter|Geist(?:\+Mono)?)\b|rsms\.me\/inter\b/gi;
  while ((m = hosted.exec(text)) !== null) push(m[1] ? m[1].replace('+', ' ') : 'Inter', m.index, `${m[0]} loads ${m[1] ?? 'Inter'} from a CDN`);
  const face = /@font-face\s*\{[^}]*?font-family\s*:\s*['"]?((?:__)?(?:Inter|Geist)(?:[ _]?(?:Mono|Variable|Tight|Display))?(?:_[0-9a-f]{6})?)['"]?/gi;
  while ((m = face.exec(text)) !== null) push(m[1], m.index, `@font-face declares ${m[1]}, which the tokens do not declare`);
  return out;
}

/**
 * Colour, gradient or blur literals in plain CSS declarations (comments stripped; url() contents ignored).
 * @param {string} code comment-stripped CSS @param {string} file @param {number} [offset] index of code in the file
 * @param {string} [full] the whole file text (for line numbers and excerpts) @returns {Leak[]}
 */
export function cssLiteralLeaks(code, file, offset = 0, full = code) {
  /** @type {Leak[]} */
  const out = [];
  for (const d of cssDeclarations(code)) {
    const value = d.value.replace(/url\([^)]*\)/gi, 'url()').replace(/(['"])(?:\\.|(?!\1).)*\1/g, '""');
    /** @type {string | null} */
    let detail = null;
    let kind = 'css-literal';
    if (GRADIENT.test(value)) {
      kind = 'css-gradient';
      detail = `${d.prop}: a gradient literal outside the tokens`;
    } else if (/\bblur\(/i.test(value) && /filter/i.test(d.prop)) {
      kind = 'css-blur';
      detail = `${d.prop}: a blur literal outside the tokens`;
    } else if (COLOR_LITERAL.test(value)) {
      detail = `${d.prop}: ${value.trim().slice(0, 60)} is a colour literal outside the tokens`;
    } else if (COLOR_PROPERTIES.test(d.prop)) {
      const named = value.toLowerCase().split(/[\s,/()]+/).find((w) => Object.hasOwn(NAMED_COLORS, w));
      if (named) detail = `${d.prop}: the named colour ${named} is outside the tokens`;
    }
    if (detail) {
      const at = offset + d.index;
      out.push({ kind, file, line: lineOf(full, at), value: excerpt(full, at), detail });
    }
  }
  return out;
}

/**
 * The declarations of a CSS text, at any nesting depth (at-rule groups and nested rules followed).
 * @param {string} code @returns {{prop: string, value: string, index: number}[]}
 */
export function cssDeclarations(code) {
  /** @type {{prop: string, value: string, index: number}[]} */
  const out = [];
  /** @type {('rules' | 'decls')[]} */
  const stack = [];
  let start = 0;
  let paren = 0;
  let quote = '';
  /** @param {number} end */
  const take = (end) => {
    const seg = code.slice(start, end);
    const m = /^(\s*)(--[\w-]+|-?[a-zA-Z][\w-]*)\s*:([\s\S]*)$/.exec(seg);
    if (m && m[3].trim() !== '') out.push({ prop: m[2], value: m[3].trim(), index: start + m[1].length });
  };
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') paren += 1;
    else if (c === ')') paren = Math.max(0, paren - 1);
    else if (paren > 0) continue;
    else if (c === '{') {
      const prelude = code.slice(start, i).trim();
      stack.push(/^@(?:media|supports|layer|container|document|scope|starting-style)\b/i.test(prelude) ? 'rules' : 'decls');
      start = i + 1;
    } else if (c === '}') {
      if (stack[stack.length - 1] === 'decls') take(i);
      stack.pop();
      start = i + 1;
    } else if (c === ';') {
      if (stack[stack.length - 1] === 'decls') take(i);
      start = i + 1;
    }
  }
  return out;
}

/**
 * Colour, gradient or blur literals in inline style attributes (HTML, Vue, Svelte) and JSX style objects.
 * @param {string} text @param {string} file @returns {Leak[]}
 */
export function inlineStyleLeaks(text, file) {
  /** @type {Leak[]} */
  const out = [];
  const attr = /(?<![\w-]):?style\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\{([\s\S]*?)\}\})/g;
  let m;
  while ((m = attr.exec(text)) !== null) {
    const body = m[1] ?? m[2] ?? m[3] ?? '';
    const isJsx = m[3] !== undefined;
    const hit = GRADIENT.test(body) ? 'a gradient' : /\bblur\(/i.test(body) ? 'a blur' : COLOR_LITERAL.test(body) ? 'a colour' : null;
    const named = !hit && !isJsx ? /(?:^|;)\s*(color|background(?:-color)?|border(?:-color)?|fill|stroke)\s*:\s*([a-z]+)\s*(?:;|$)/i.exec(body) : null;
    if (hit || (named && Object.hasOwn(NAMED_COLORS, named[2].toLowerCase()))) {
      out.push({ kind: 'inline-style', file, line: lineOf(text, m.index), value: excerpt(text, m.index), detail: `an inline style holds ${hit ?? `the named colour ${named?.[2]}`} outside the tokens` });
    }
  }
  return out;
}

/**
 * Tailwind default theme variables declared in built CSS that the tokens do not generate: the namespace reset
 * did not run (or ran before Tailwind's defaults).
 * @param {string} css @param {string} file @param {TokenFacts} facts @returns {Leak[]}
 */
export function defaultThemeLeaks(css, file, facts) {
  /** @type {Leak[]} */
  const out = [];
  const defaults = new Set(['--color-black', '--color-white']);
  for (const p of TAILWIND_PALETTES) for (const s of TAILWIND_SHADES) defaults.add(`--color-${p}-${s}`);
  for (const [ns, names] of Object.entries(TAILWIND_DEFAULT_VARS)) for (const n of names) defaults.add(`--${ns}-${n}`);
  const seen = new Set();
  const decl = /(?<![\w-])(--[a-z0-9-]+)\s*:\s*([^;}]*)/g;
  let m;
  while ((m = decl.exec(css)) !== null) {
    const name = m[1];
    const value = m[2].trim().replace(/\s+/g, ' ');
    if (name === '--default-transition-duration' && value === '150ms' && !facts.vars.has('--duration-150')) {
      if (!seen.has(name)) out.push({ kind: 'default-theme', file, line: lineOf(css, m.index), value: excerpt(css, m.index), detail: "Tailwind's default 150ms transition: point --default-transition-duration at a motion token (TK-04)" });
      seen.add(name);
      continue;
    }
    if (name === '--default-transition-timing-function' && /^cubic-bezier\(\s*0?\.4\s*,\s*0\s*,\s*0?\.2\s*,\s*1\s*\)$/.test(value)) {
      if (!seen.has(name)) out.push({ kind: 'default-theme', file, line: lineOf(css, m.index), value: excerpt(css, m.index), detail: "Tailwind's default cubic-bezier(0.4, 0, 0.2, 1): point it at the ease-out token (TK-04)" });
      seen.add(name);
      continue;
    }
    if (!defaults.has(name) || facts.vars.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({ kind: 'default-theme', file, line: lineOf(css, m.index), value: excerpt(css, m.index), detail: `${name} is a Tailwind default the namespace reset should have removed (TK-04)` });
  }
  return out;
}

/**
 * True when the project uses Tailwind: a package.json dependency, or a source CSS file importing it.
 * @param {{file: string, text: string}[]} files @returns {boolean}
 */
function usesTailwind(files) {
  for (const { file, text } of files) {
    if (path.basename(file) === 'package.json') {
      try {
        const pkg = JSON.parse(text);
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
        if (Object.keys(deps).some((d) => d === 'tailwindcss' || d.startsWith('@tailwindcss/'))) return true;
      } catch {
        continue;
      }
    } else if (/\.(css|scss|less)$/.test(file) && /@import\s+(?:url\()?['"]tailwindcss|@tailwind\s+(?:base|components|utilities)\b/.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Namespace resets found in the @theme blocks of source CSS; returns the resets that are missing.
 * @param {{file: string, text: string}[]} cssFiles @returns {string[]}
 */
function missingResets(cssFiles) {
  const found = new Set();
  for (const { text } of cssFiles) {
    const code = stripComments(text, 'css');
    for (const block of code.match(/@theme\b[^{]*\{[^}]*\}/g) ?? []) {
      for (const m of block.matchAll(/(--[a-z-]*\*)\s*:\s*initial/g)) found.add(m[1]);
    }
  }
  if (found.has('--*')) return [];
  return TAILWIND_RESETS.filter((r) => !found.has(r));
}

const SOURCE_INCLUDE = ['*.css', '*.scss', '*.less', '*.html', '*.htm', '*.js', '*.jsx', '*.ts', '*.tsx', '*.mjs', '*.cjs', '*.vue', '*.svelte', '*.astro', 'package.json'];
const SOURCE_EXCLUDE = [
  '*.test.*', '*.spec.*', '__tests__', '__snapshots__', '*.min.js', '*.min.css', '*.d.ts', '*.map',
  '.venv', 'venv', '__pycache__', '.turbo', '.vercel', '.svelte-kit', '.nuxt', '.output', '.cache', '.parcel-cache',
  'storybook-static', 'target', '.astro', '.claude',
];
const BUILT_INCLUDE = ['*.css', '*.html', '*.htm', '*.js', '*.mjs', '*.cjs'];
const SOURCE_MAX_BYTES = 5 * 1024 * 1024;
const BUILT_MAX_BYTES = 20 * 1024 * 1024;

/** @param {string} file @returns {string} */
function sourceKind(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (['css', 'scss', 'less', 'html', 'vue', 'svelte'].includes(ext)) return ext;
  if (ext === 'htm' || ext === 'astro') return 'html';
  if (['ts', 'tsx', 'jsx'].includes(ext)) return ext;
  if (ext === 'json') return 'json';
  return 'js';
}

/**
 * Scans the source tree (always) and the built output (when given) for leaks past the tokens.
 * @param {{root: string, design: string, builtDir: string | null, facts: TokenFacts, log?: (m: string) => void}} args
 * @returns {{leaks: Leak[], tailwind: boolean, scanned: {source: number, built: number}, notes: string[]}}
 */
export function scanLeaks({ root, design, builtDir, facts, log = () => {} }) {
  /** @type {Leak[]} */
  const leaks = [];
  /** @type {string[]} */
  const notes = [];
  const exclude = [...SOURCE_EXCLUDE];
  const designRel = toPosix(path.relative(root, design));
  if (designRel && !designRel.startsWith('..') && !path.isAbsolute(designRel)) exclude.push(`${designRel}/**`);
  if (builtDir) {
    const builtRel = toPosix(path.relative(root, builtDir));
    if (builtRel && !builtRel.startsWith('..') && !path.isAbsolute(builtRel)) exclude.push(`${builtRel}/**`);
  }
  /** @type {{file: string, text: string}[]} */
  const sources = [];
  for (const rel of walk(root, { include: SOURCE_INCLUDE, exclude })) {
    const abs = path.join(root, rel);
    if (statSync(abs).size > SOURCE_MAX_BYTES) {
      notes.push(`${rel} skipped (larger than 5 MB)`);
      continue;
    }
    const text = readText(abs);
    if (text.slice(0, 400).includes(GENERATED_MARK)) {
      if (/\.css$/.test(rel)) sources.push({ file: rel, text: '' });
      continue;
    }
    sources.push({ file: rel, text });
  }
  const generatedCss = walk(root, { include: ['*.css'], exclude: SOURCE_EXCLUDE.filter((x) => !x.includes('css')) })
    .filter((rel) => readHead(path.join(root, rel), 400).includes(GENERATED_MARK))
    .map((rel) => ({ file: rel, text: readText(path.join(root, rel)) }));
  const tailwind = usesTailwind(sources);
  log(`tokens.leak: ${sources.length} source files${tailwind ? ' (Tailwind detected)' : ''}`);
  for (const { file, text } of sources) {
    if (text === '') continue;
    const kind = sourceKind(file);
    if (kind === 'json') {
      try {
        const pkg = JSON.parse(text);
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        for (const dep of Object.keys(deps)) {
          const m = FONT_PACKAGE.exec(dep);
          if (!m) continue;
          const family = m[1] ? m[1].replace('-sans', '') : 'Geist';
          if (facts.families.has(fontImportKey(family))) continue;
          const index = text.indexOf(`"${dep}"`);
          leaks.push({ kind: 'default-font', file, line: lineOf(text, Math.max(0, index)), value: excerpt(text, Math.max(0, index)), detail: `the dependency ${dep} brings a default font the tokens do not declare` });
        }
      } catch {
        notes.push(`${file} is not valid JSON; its dependencies were not read`);
      }
      continue;
    }
    const code = stripComments(text, kind);
    leaks.push(...classLeaks(code, file, facts, tailwind), ...fontImportLeaks(code, file, facts));
    if (['css', 'scss', 'less'].includes(kind)) leaks.push(...cssLiteralLeaks(code, file));
    else {
      leaks.push(...inlineStyleLeaks(code, file));
      if (['html', 'vue', 'svelte'].includes(kind)) {
        for (const m of code.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
          const inner = /** @type {number} */ (m.index) + m[0].indexOf(m[1]);
          leaks.push(...cssLiteralLeaks(m[1], file, inner, code));
        }
      }
    }
  }
  if (tailwind) {
    const css = [...sources.filter((s) => /\.(css|scss|less)$/.test(s.file) && s.text !== ''), ...generatedCss];
    const missing = missingResets(css);
    if (missing.length > 0) {
      const anchor = sources.find((s) => /@import\s+(?:url\()?['"]tailwindcss/.test(s.text)) ?? css[0];
      leaks.push({ kind: 'namespace-reset', file: anchor ? anchor.file : '.', line: 1, value: missing.join(' '), detail: `no @theme resets ${missing.join(', ')}: Tailwind's defaults stay available (TK-04); run tokens.mjs build --tailwind yes and import its CSS after tailwindcss` });
    }
  }
  let built = 0;
  if (builtDir) {
    const files = walk(builtDir, { include: BUILT_INCLUDE, exclude: ['node_modules', '.git', '*.map'], defaultExcludes: false });
    const fontFiles = walk(builtDir, { include: ['*.woff2', '*.woff', '*.ttf', '*.otf'], exclude: ['node_modules', '.git'], defaultExcludes: false });
    const builtTailwind = tailwind || files.some((rel) => /\.css$/.test(rel) && statSync(path.join(builtDir, rel)).size <= BUILT_MAX_BYTES
      && /tailwindcss v\d|--tw-/.test(readText(path.join(builtDir, rel))));
    for (const rel of files) {
      const abs = path.join(builtDir, rel);
      if (statSync(abs).size > BUILT_MAX_BYTES) {
        notes.push(`built ${rel} skipped (larger than 20 MB)`);
        continue;
      }
      const raw = readText(abs);
      built += 1;
      const label = `${shown(root, builtDir)}/${rel}`;
      const isCss = /\.css$/.test(rel);
      const text = isCss ? unescapeCss(stripComments(raw, 'css')) : raw;
      leaks.push(...classLeaks(text, label, facts, builtTailwind), ...fontImportLeaks(text, label, facts));
      if (isCss && builtTailwind) leaks.push(...defaultThemeLeaks(text, label, facts));
      if (/\.html?$/.test(rel)) leaks.push(...inlineStyleLeaks(stripComments(raw, 'html'), label));
    }
    for (const rel of fontFiles) {
      const base = path.basename(rel);
      const m = /^(inter|geist)(?:[-_.](mono))?/i.exec(base);
      if (!m) continue;
      const family = displayFamily(m[2] ? `${m[1]} mono` : m[1]);
      if (facts.families.has(fontImportKey(family))) continue;
      leaks.push({ kind: 'default-font', file: `${shown(root, builtDir)}/${rel}`, line: 0, value: base, detail: `the build ships ${base}, a default ${family} file the tokens do not declare` });
    }
    log(`tokens.leak: ${built} built files in ${shown(root, builtDir)}`);
  }
  return { leaks, tailwind, scanned: { source: sources.length, built }, notes };
}

/**
 * The facts the leak scan needs from the tokens; empty when the tokens cannot be read.
 * @param {Model | null} model @returns {TokenFacts}
 */
export function tokenFacts(model) {
  if (!model) return { vars: new Set(), colorNames: new Set(), families: new Set() };
  const families = new Set();
  for (const role of [model.families.display, model.families.body, model.families.mono]) {
    if (role) for (const name of role.stack) families.add(fontImportKey(name));
  }
  for (const f of model.fonts) families.add(fontImportKey(f.family));
  return { vars: generatedVariables(model), colorNames: new Set(model.colors.map((c) => c.name)), families };
}

// ---------------------------------------------------------------------------------------------------------------
// Palette (Leonardo)
// ---------------------------------------------------------------------------------------------------------------

/** @type {typeof import('@adobe/leonardo-contrast-colors') | null} */
let leonardoModule = null;

/** @returns {Promise<typeof import('@adobe/leonardo-contrast-colors')>} */
async function loadLeonardo() {
  if (leonardoModule) return leonardoModule;
  try {
    leonardoModule = await import('@adobe/leonardo-contrast-colors');
  } catch (err) {
    throw new EnvError(`@adobe/leonardo-contrast-colors is not installed; run pnpm install --frozen-lockfile in ${toPosix(SCRIPTS_DIR)}`, { cause: err });
  }
  return leonardoModule;
}

/** @param {number} l @param {number} c @param {number} h @returns {string} */
export function formatOklch(l, c, h) {
  const chroma = Math.max(0, c);
  return `oklch(${fixed(Math.min(1, Math.max(0, l)), 4)} ${fixed(chroma, 4)} ${chroma < 0.0001 ? '0' : fixed(((h % 360) + 360) % 360, 2)})`;
}

/** @param {string} css @returns {boolean} */
function inGamutStrict(css) {
  const d = oklchGamutDistance(css);
  return d !== null && d < 0.0002;
}

/**
 * The largest chroma at this lightness and hue that stays inside sRGB (bisection), capped at `cap`.
 * @param {number} l @param {number} h @param {number} cap @returns {number}
 */
export function maxChroma(l, h, cap = 0.37) {
  if (inGamutStrict(formatOklch(l, cap, h))) return cap;
  let lo = 0;
  let hi = cap;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (inGamutStrict(formatOklch(l, mid, h))) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo * 10000) / 10000;
}

/**
 * Moves a colour along OKLCH lightness (hue kept, chroma reduced only to stay in gamut) until it reaches the
 * target WCAG ratio on the ground, as an oklch() string; null when the target is out of reach.
 * @param {Rgba} start @param {Rgba} ground @param {number} target
 * @returns {{css: string, ratio: number, steps: number} | null}
 */
export function meetTarget(start, ground, target) {
  const o = toOklch(start);
  let l = o.l;
  let c = o.c;
  const h = o.h;
  const lighter = relativeLuminance(start) >= relativeLuminance(ground);
  for (let step = 0; step <= 1000; step += 1) {
    if (!inGamutStrict(formatOklch(l, c, h))) c = maxChroma(l, h, c);
    const css = formatOklch(l, c, h);
    const rgba = /** @type {Rgba} */ (parseColor(css));
    const ratio = /** @type {number} */ (contrastRatio(rgba, ground));
    if (ratio >= target) return { css, ratio, steps: step };
    l += lighter ? 0.001 : -0.001;
    if (l < 0 || l > 1) return null;
  }
  return null;
}

/**
 * @typedef {{theme: string, css: string, rgba: Rgba}} Ground
 * @typedef {{name: string, value: Record<string, string>, usage: string}} CandidateToken
 * @typedef {{name: string, theme: string, target: number, ratio: number | null, leonardo: string, leonardoRatio: number,
 *   value: string | null, adjusted: boolean}} CandidateCheck
 */

/**
 * Candidate colour tokens from a brand hue: Leonardo picks each target ratio on each ground, then every value is
 * re-measured with lib/color and moved along lightness until it meets its target (Leonardo lands up to about 0.02
 * below), and written as in-gamut oklch().
 * @param {{key: {l: number, c: number, h: number}, grounds: Ground[], ratios: number[], name: string,
 *   groundName: string}} args
 * @returns {Promise<{tokens: CandidateToken[], checks: CandidateCheck[], ok: boolean, key: string,
 *   warnings: string[]}>}
 */
export async function makePalette({ key, grounds, ratios, name, groundName }) {
  const leo = await loadLeonardo();
  const keyCss = formatOklch(key.l, Math.min(key.c, maxChroma(key.l, key.h, key.c)), key.h);
  const keyHex = toHex(/** @type {Rgba} */ (parseColor(keyCss)));
  const sorted = [...new Set(ratios)].sort((a, b) => a - b);
  /** @type {string[]} */
  const warnings = [];
  /** @type {CandidateCheck[]} */
  const checks = [];
  /** @type {Map<number, Record<string, string>>} */
  const values = new Map(sorted.map((r) => [r, {}]));
  for (const ground of grounds) {
    const groundHex = toHex(ground.rgba);
    const picked = withLeonardoWarnings(warnings, () => {
      const color = new leo.Color({ name, colorKeys: [/** @type {any} */ (keyHex)], colorSpace: 'OKLCH', ratios: sorted });
      const theme = new leo.Theme({
        colors: [color],
        // Leonardo also takes a CSS string here (lib/theme.js _setBackgroundColor), though its types ask for a BackgroundColor.
        backgroundColor: /** @type {any} */ (groundHex),
        lightness: 0,
        output: 'HEX',
      });
      const entry = /** @type {{values: {contrast: number, value: string}[]}} */ (theme.contrastColors[1]);
      return entry.values.map((v) => ({ target: v.contrast, hex: String(v.value) }));
    });
    for (const p of picked) {
      const target = sorted.find((r) => Math.abs(r - p.target) < 0.005) ?? p.target;
      const leoRgba = parseColor(p.hex);
      const leoRatio = leoRgba ? /** @type {number} */ (contrastRatio(leoRgba, ground.rgba)) : 0;
      const met = leoRgba ? meetTarget(leoRgba, ground.rgba, target) : null;
      const tokenName = `${name}-${String(target).replace('.', '-')}`;
      checks.push({ name: tokenName, theme: ground.theme, target, ratio: met ? met.ratio : null, leonardo: p.hex, leonardoRatio: leoRatio, value: met ? met.css : null, adjusted: met ? met.steps > 0 || met.css !== p.hex : false });
      if (met) /** @type {Record<string, string>} */ (values.get(target))[ground.theme] = met.css;
    }
  }
  /** @type {CandidateToken[]} */
  const tokens = sorted.map((r) => {
    const tokenName = `${name}-${String(r).replace('.', '-')}`;
    const per = grounds.map((g) => {
      const c = checks.find((x) => x.name === tokenName && x.theme === g.theme);
      return c && c.ratio !== null ? `${ratioText(c.ratio)} in ${g.theme}` : `unreachable in ${g.theme}`;
    }).join(', ');
    return { name: tokenName, value: /** @type {Record<string, string>} */ (values.get(r)), usage: `${roleForRatio(r)}, ${fixed(r, 2)}:1 on ${groundName} (candidate from hue ${fixed(key.h, 1)}: ${per})` };
  });
  return { tokens, checks, ok: checks.every((c) => c.ratio !== null), key: keyCss, warnings };
}

/** @param {number} r @returns {string} */
function roleForRatio(r) {
  if (r >= 7) return 'small text that must stay legible in dark mode and on projectors';
  if (r >= 4.5) return 'body and UI text';
  if (r >= 3) return 'large text (24 px, or 18.66 px bold), UI boundaries, focus rings and chart strokes';
  return 'decoration only, below every WCAG minimum';
}

/**
 * Runs a Leonardo call, dropping its known `colorspace` deprecation notice (its BackgroundColor passes the old
 * option name itself) and keeping any other warning.
 * @template T @param {string[]} warnings @param {() => T} fn @returns {T}
 */
function withLeonardoWarnings(warnings, fn) {
  const original = console.warn;
  console.warn = (...args) => {
    const text = args.map(String).join(' ');
    if (!/`colorspace` is deprecated/.test(text) && !warnings.includes(text)) warnings.push(text);
  };
  try {
    return fn();
  } finally {
    console.warn = original;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------------------------------------------

/** @type {Map<string, {id: string, title: string, ifDropped: string}>} */
const GATE_BY_ID = new Map(GATES.map((g) => [g.id, g]));

/** @param {string} id */
function builder(id) {
  return gate(/** @type {{id: string, title: string, ifDropped: string}} */ (GATE_BY_ID.get(id)));
}

/** @param {Problem} p @param {string} file @returns {Evidence} */
function problemEvidence(p, file) {
  return { file: p.file ?? file, path: p.path, rule: p.rule, value: p.message };
}

/** @param {Problem[]} problems @returns {string} */
function summarise(problems) {
  const first = problems.slice(0, 3).map((p) => `${p.path}: ${p.message}`).join('; ');
  return problems.length > 3 ? `${first}; and ${problems.length - 3} more (see evidence)` : first;
}

/**
 * The context pieces every gate needs.
 * @param {TokensContext} ctx
 */
function gateContext(ctx) {
  const root = path.resolve(ctx.root);
  const design = ctx.design ? path.resolve(ctx.design) : path.resolve(designDir(root, ctx.profile ?? { paths: { design: 'design' } }));
  const log = ctx.log ?? (() => {});
  return { root, design, log };
}

/**
 * tokens.valid: structure (CONTRACTS 6.2), values (TK-02, TK-07, TK-12, TK-14, TK-17, TK-18, TK-20, TK-21) and
 * generated views that match the tokens.
 * @param {TokensContext} ctx @returns {Promise<GateResult>}
 */
export async function checkValid(ctx) {
  const g = builder('tokens.valid');
  const { root, design, log } = gateContext(ctx);
  const { source, model, problems } = loadModel(root, design);
  if (!model) {
    log(`tokens.valid: ${source.rel} has ${problems.length} structural problem${problems.length === 1 ? '' : 's'}`);
    return g.fail(`${source.rel}: ${summarise(problems)}`, problems.map((p) => problemEvidence(p, source.rel)));
  }
  await loadFontInfos(model);
  const data = /** @type {Record<string, any>} */ (source.data);
  const semantic = semanticProblems(model, data);
  const { results } = evaluatePairs(model);
  const views = viewProblems(model, results);
  const all = [...semantic, ...views];
  const counts = `${model.colors.length} colours, ${model.groups.reduce((n, x) => n + x.styles.length, 0)} type styles, ${model.lists.spacing.length} spacing, ${model.lists.radius.length} radii, ${model.lists.shadow.length} shadows, ${model.lists.motion.length} motion tokens, ${model.fonts.length} font files`;
  log(`tokens.valid: ${counts}; ${all.length} problem${all.length === 1 ? '' : 's'}`);
  if (all.length > 0) return g.fail(`${source.rel}: ${summarise(all)}`, all.map((p) => problemEvidence(p, source.rel)));
  const fontEvidence = model.fonts.map((f) => ({ file: f.file, value: `${f.family} (${rolesOf(model, f.family).join(', ') || 'no role'}): ${tabularText(f.info)}` }));
  return g.ok(`${source.rel} valid (${counts}); DESIGN.md and ${findGeneratedCss(root, source.rel).length} CSS file(s) match it`, fontEvidence);
}

/**
 * tokens.contrast: every declared pair in every theme at its WCAG 2 minimum.
 * @param {TokensContext} ctx @returns {Promise<GateResult>}
 */
export async function checkContrast(ctx) {
  const g = builder('tokens.contrast');
  const { root, design, log } = gateContext(ctx);
  const { source, model, problems } = loadModel(root, design);
  if (!model) return g.fail(`${source.rel} cannot be read, so no pair can be measured: ${summarise(problems)}`, problems.map((p) => problemEvidence(p, source.rel)));
  const { results, problems: declProblems } = evaluatePairs(model);
  const failing = results.filter((r) => !r.ok);
  log(`tokens.contrast: ${results.length} pair checks over ${model.themes.length} theme(s); ${failing.length} below their minimum`);
  /** @type {Evidence[]} */
  const evidence = [
    ...declProblems.map((p) => problemEvidence(p, source.rel)),
    ...[...failing, ...results.filter((r) => r.ok)].map((r) => ({
      file: source.rel,
      fg: r.fg,
      bg: r.bg,
      theme: r.theme,
      kind: r.kind,
      ratio: r.ratio === null ? null : Number(r.ratio.toFixed(2)),
      required: r.required,
      ok: r.ok,
      source: r.source,
      ...(r.advice ? { advice: r.advice } : {}),
      value: `${r.fg} on ${r.bg} (${r.theme}): ${r.ratio === null ? 'unreadable' : ratioText(r.ratio)}, needs ${r.required === null ? 'none' : `${r.required}:1`}`,
    })),
  ];
  if (results.length === 0) {
    return g.fail(`${source.rel} declares no text and ground pair: write "on <ground token>" in each text, border and focus colour's usage`, evidence);
  }
  if (failing.length > 0 || declProblems.length > 0) {
    const parts = failing.slice(0, 3).map((r) => `${r.fg} on ${r.bg} (${r.theme}) ${r.ratio === null ? 'unreadable' : ratioText(r.ratio)} < ${r.required}:1`);
    const more = failing.length > 3 ? `; and ${failing.length - 3} more` : '';
    const decl = declProblems.length > 0 ? `${parts.length > 0 ? '; ' : ''}${summarise(declProblems)}` : '';
    return g.fail(`${failing.length} pair check${failing.length === 1 ? '' : 's'} below minimum: ${parts.join('; ')}${more}${decl}`, evidence);
  }
  return g.ok(`${results.length} pair checks over ${model.themes.length} theme(s) meet their minimum`, evidence);
}

/**
 * tokens.leak: default Tailwind palette and theme variables, arbitrary colour, gradient and blur values,
 * custom-property forms outside the tokens, default Geist or Inter imports, colour literals in plain CSS and
 * inline styles.
 * @param {TokensContext} ctx @returns {Promise<GateResult>}
 */
export async function checkLeak(ctx) {
  const g = builder('tokens.leak');
  const { root, design, log } = gateContext(ctx);
  const { model } = loadModel(root, design);
  const builtDir = ctx.args?.serve ? path.resolve(ctx.args.serve) : null;
  if (builtDir && !isDir(builtDir)) throw new UsageError(`--serve ${toPosix(builtDir)} is not a folder; pass the built output folder`);
  const { leaks, tailwind, scanned, notes } = scanLeaks({ root, design, builtDir, facts: tokenFacts(model), log });
  const where = `${scanned.source} source file${scanned.source === 1 ? '' : 's'}${builtDir ? ` and ${scanned.built} built file${scanned.built === 1 ? '' : 's'}` : ''}${tailwind ? ', Tailwind' : ''}${model ? '' : ', no readable tokens'}`;
  const evidence = leaks.slice(0, 200).map((l) => ({ file: l.file, line: l.line, kind: l.kind, value: l.value, detail: l.detail }));
  for (const n of notes) evidence.push({ file: '', line: 0, kind: 'note', value: n, detail: n });
  if (leaks.length === 0) return g.ok(`no leak in ${where}`, evidence);
  /** @type {Record<string, number>} */
  const byKind = {};
  for (const l of leaks) byKind[l.kind] = (byKind[l.kind] ?? 0) + 1;
  const kinds = Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ');
  return g.fail(`${leaks.length} leak${leaks.length === 1 ? '' : 's'} in ${where} (${kinds}); first: ${leaks[0].file}:${leaks[0].line} ${leaks[0].detail}`, evidence);
}

/**
 * The module entry point for frontend-check: the results of the selected tokens gates.
 * @param {TokensContext} ctx @param {string[]} selected @returns {Promise<GateResult[]>}
 */
export async function run(ctx, selected) {
  /** @type {GateResult[]} */
  const results = [];
  for (const id of selected) {
    if (id === 'tokens.valid') results.push(await checkValid(ctx));
    else if (id === 'tokens.contrast') results.push(await checkContrast(ctx));
    else if (id === 'tokens.leak') results.push(await checkLeak(ctx));
  }
  return results;
}

// ---------------------------------------------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{css: string, tailwind: 'yes' | 'no' | 'auto', fontFace: boolean, darkMedia: boolean,
 *   mirror: string | null, force: boolean}} BuildOptions
 */

/**
 * Refuses to replace a file that tokens.mjs did not generate, unless forced.
 * @param {string} abs @param {string} root @param {boolean} force
 */
function guardOverwrite(abs, root, force) {
  if (force || !isFile(abs)) return;
  if (readHead(abs, 2000).includes(GENERATED_MARK)) return;
  throw new UsageError(`${shown(root, abs)} exists and was not generated by tokens.mjs: move it aside (its content would be lost) or pass --force to replace it`);
}

/**
 * Writes the views of the tokens: the CSS, DESIGN.md and, with `mirror`, the Claude Design mirror.
 * @param {{root: string, design: string, log?: (m: string) => void}} where @param {BuildOptions} options
 * @returns {Promise<{written: string[], tailwind: boolean, dropped: string[], pairs: number, failingPairs: number}>}
 */
export async function build({ root, design, log = () => {} }, options) {
  const { source, model, problems } = loadModel(root, design);
  if (!model) throw new UsageError(`${source.rel} cannot be built from: ${summarise(problems)}; fix it, then run build again`);
  await loadFontInfos(model);
  const cssAbs = path.resolve(options.css);
  let tailwind = options.tailwind === 'yes';
  if (options.tailwind === 'auto') {
    const files = walk(root, { include: ['package.json', '*.css'], exclude: SOURCE_EXCLUDE }).map((rel) => ({ file: rel, text: readText(path.join(root, rel)) }));
    tailwind = usesTailwind(files);
  }
  const { results } = evaluatePairs(model);
  const designMd = path.join(design, 'DESIGN.md');
  const project = options.mirror ? path.join(path.resolve(options.mirror), 'project') : null;
  guardOverwrite(cssAbs, root, options.force);
  guardOverwrite(designMd, root, options.force);
  if (project) guardOverwrite(path.join(project, 'README.md'), root, options.force);
  const written = [
    writeText(cssAbs, renderCss(model, cssAbs, { tailwind, fontFace: options.fontFace, darkMedia: options.darkMedia })),
    writeText(designMd, renderDesignMd(model, results)),
  ];
  log(`tokens build: ${shown(root, cssAbs)} (tailwind ${yn(tailwind)}), ${shown(root, designMd)}`);
  /** @type {string[]} */
  let dropped = [];
  if (project) {
    const readme = path.join(project, 'README.md');
    const mirror = mirrorTokens(model);
    dropped = mirror.dropped;
    written.push(writeText(path.join(project, 'tokens.json'), `${JSON.stringify(mirror.tokens, null, 2)}\n`));
    written.push(writeText(readme, renderMirrorReadme(model, results, dropped)));
    for (const f of mirror.fonts) {
      const dest = path.join(project, 'fonts', f.name);
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(f.abs, dest);
      written.push(toPosix(dest));
    }
    log(`tokens build: mirror in ${toPosix(project)} (${mirror.fonts.length} font file(s)${dropped.length > 0 ? `, ${dropped.length} item(s) left out` : ''})`);
  }
  return { written, tailwind, dropped, pairs: results.length, failingPairs: results.filter((r) => !r.ok).length };
}

// ---------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------

const HELP = `Usage: node tokens.mjs <command> [options]

The visual system's single source (<design>/tokens.json, CONTRACTS 6.2), its generated views and its gates.

Commands:
  validate   gate tokens.valid: structure, names, usages, colour literals in gamut, at most two families plus a
             monospace with a role, every font with a licence and licence file, tabular figures on faces that
             show numbers, motion budgets, and generated views that match the tokens
  contrast   gate tokens.contrast: every declared text and ground pair, every theme, WCAG 2 (4.5:1 text, 3:1
             large text and UI parts, 1.1:1 surface steps in dark themes)
  leak       gate tokens.leak: default Tailwind palette classes and theme variables, arbitrary colour, gradient
             and blur values, (--x) forms outside the tokens, default Geist or Inter imports, colour literals in
             plain CSS and inline styles (source tree always; built output with --serve <dir>)
  check      run the gates named by --gates (default: all three), like frontend-check
  build      write the CSS (custom properties per theme, light first; Tailwind @theme with namespace resets),
             <design>/DESIGN.md and, with --mirror <dir>, a Claude Design "Design System" mirror
  palette    candidate colour tokens from a brand hue with Leonardo (targets 3, 4.5 and 7 on a ground)

Run node tokens.mjs <command> --help for its options. Flags with no command run check, so the module takes the
same flags as frontend-check: node tokens.mjs --gates tokens --root <repo> --profile <abs> --serve <dist> --json.

Declaring pairs: a colour's usage names its grounds after "on", "over" or "against" ("secondary text, 4.5:1 or
more on bg and surface"); on-<x>, <x>-foreground and foreground (on background) pair by name. The words before
"on" give the kind: large, text, UI part (border, ring, focus, icon, input, chart), surface, decoration.

Exit codes: 0 ok; 1 a gate failed (palette: a target out of reach); 2 usage error; 3 environment error.`;

const COMMON_HELP = `  --root <dir>      the product repository (default: the working directory)
  --profile <path>  an /execution profile.json or a frontend block file (its paths.design is read)
  --design <dir>    the design folder (default: profile paths.design, else <root>/design)
  --state <dir>     accepted for frontend-check compatibility; unused
  --json            print the machine report on stdout
  --out <dir>       also write the report as JSON into <dir>
  -h, --help        this text`;

const GATE_HELP = (/** @type {string} */ name, /** @type {string} */ what) => `Usage: node tokens.mjs ${name} [options]

${what}

Options:
${COMMON_HELP}${name === 'leak' || name === 'check' ? `
  --serve <dir>     the built output folder (dist) to scan as well as the source tree
  --url <url>       accepted for frontend-check compatibility; this gate reads files, never the network` : ''}${name === 'check' ? `
  --gates <ids>     comma-separated gate ids or "tokens" (default: tokens)
  --allow-skip <id> a skipped gate that may still count as ok (repeatable)` : ''}

Exit codes: 0 every requested gate ok; 1 a gate failed; 2 usage error; 3 environment error.`;

const BUILD_HELP = `Usage: node tokens.mjs build [options]

Writes the views of <design>/tokens.json. Refuses to replace a file it did not generate (use --force).

Options:
${COMMON_HELP}
  --css <file>          where to write the CSS (default: <design>/tokens.css)
  --tailwind <mode>     yes, no or auto (default auto: a tailwindcss dependency or @import "tailwindcss" found)
  --font-face <yes|no>  @font-face rules for the font files (default yes; URLs relative to the CSS file)
  --dark-media <yes|no> follow prefers-color-scheme for the dark theme when no data-theme is set (default yes)
  --mirror <dir>        also write a Claude Design "Design System" mirror under <dir>/project (tokens.json,
                        README.md, fonts/); only when the review surface is claude-design, after H2 (TK-23)
  --force               replace files that tokens.mjs did not generate

The CSS uses Tailwind's names: --color-<token>, --font-display|body|mono, --text-<style> (with --line-height,
--font-weight and --letter-spacing sub-properties), --spacing-*, --radius-*, --shadow-*, --ease-*, --duration-*;
import it after @import "tailwindcss". A numeric spacing name (space-4) replaces Tailwind's p-4 step with the
token. Durations have no Tailwind namespace: use duration-(--duration-press). Themes: base (light) on :root,
others on :root[data-theme="<id>"], the dark one also on .dark and under prefers-color-scheme. The CSS must sit
under --root, where validate finds it by its header.

Exit codes: 0 written; 2 usage error (tokens.json missing or structurally invalid, a file not generated by
tokens.mjs in the way); 3 environment error.`;

const PALETTE_HELP = `Usage: node tokens.mjs palette (--hue <deg> | --brand <colour>) [options]

Candidate colour tokens from a brand hue: Leonardo (@adobe/leonardo-contrast-colors 1.1.0) picks each target
ratio on each ground, lib/color re-measures every value, and values below target are moved along OKLCH lightness
until they meet it. Output: tokens shaped for tokens.json (name, value per theme, usage naming the ground).

Options:
  --hue <deg>             the brand hue in OKLCH degrees
  --brand <colour>        a brand colour (its hue, chroma and lightness make the key colour)
  --chroma <c>            key chroma (default: the brand's, or up to 0.16 in gamut)
  --lightness <l>         key lightness 0..1 (default: the brand's, or 0.6)
  --ground <colour>       the ground; repeat as <theme>=<colour> for several themes
  --ground-token <name>   with no --ground: read this colour token per theme from tokens.json (default: the first
                          of bg, background, page, canvas, surface); also the ground the usages name
  --ratios <list>         target ratios (default 3,4.5,7)
  --name <name>           token name prefix (default brand)
${COMMON_HELP}

Exit codes: 0 every target met; 1 a target out of reach on a ground; 2 usage error; 3 environment error.`;

const COMMON_OPTIONS = /** @type {const} */ ({
  root: { type: 'string' },
  profile: { type: 'string' },
  design: { type: 'string' },
  state: { type: 'string' },
  json: { type: 'boolean' },
  out: { type: 'string' },
});

/** @param {string | undefined} v @param {string} flag @param {readonly string[]} allowed @param {string} fallback */
function choice(v, flag, allowed, fallback) {
  if (v === undefined) return fallback;
  if (!allowed.includes(v)) throw new UsageError(`${flag} must be one of ${allowed.join(', ')} (got ${JSON.stringify(v)})`);
  return v;
}

/**
 * @param {{root?: string, profile?: string, design?: string, serve?: string, out?: string}} values
 * @returns {TokensContext & {root: string, design: string}}
 */
function cliContext(values) {
  const root = path.resolve(values.root ?? process.cwd());
  if (!isDir(root)) throw new UsageError(`--root ${toPosix(root)} is not an existing folder; pass the repository root`);
  if (values.profile !== undefined && values.profile === '') throw new UsageError('--profile needs a path');
  const profile = loadProfile(values.profile, { root });
  const design = values.design ? path.resolve(values.design) : path.resolve(designDir(root, profile));
  /** @type {{serve?: string, outDir?: string}} */
  const args = {};
  if (values.serve) args.serve = toPosix(path.resolve(values.serve));
  if (values.out) args.outDir = toPosix(path.resolve(values.out));
  return { root: toPosix(root), profile, design: toPosix(design), args, log: stderrLog };
}

/**
 * @param {string} list @returns {string[]} gate ids
 */
function parseGateList(list) {
  /** @type {string[]} */
  const ids = [];
  for (const raw of list.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (raw === 'tokens' || raw === 'tokens.*') ids.push(...GATES.map((g) => g.id));
    else if (GATE_BY_ID.has(raw)) ids.push(raw);
    else throw new UsageError(`--gates names ${JSON.stringify(raw)}, which is not a tokens gate (${GATES.map((g) => g.id).join(', ')})`);
  }
  if (ids.length === 0) throw new UsageError('--gates needs at least one gate id');
  return [...new Set(ids)];
}

/**
 * Runs gates from the CLI, prints the report, writes it with --out, and throws CheckError when not ok.
 * @param {string[]} ids @param {TokensContext & {root: string, design: string}} ctx
 * @param {{json?: boolean, out?: string, allowSkip?: string[]}} values @param {string} name
 * @returns {Promise<number>}
 */
async function runFromCli(ids, ctx, values, name) {
  const results = await run(ctx, ids);
  const report = aggregate(results, {
    allowSkip: values.allowSkip ?? [],
    requested: ids.map((id) => /** @type {{id: string, title: string, ifDropped: string}} */ (GATE_BY_ID.get(id))),
    tool: 'tokens',
    target: { root: toPosix(ctx.root), design: toPosix(ctx.design), tokens: shown(ctx.root, path.join(ctx.design, 'tokens.json')) },
  });
  for (const r of report.gates) {
    stderrLog(`${r.state === 'ok' ? 'ok  ' : r.state === 'fail' ? 'FAIL' : 'skip'} ${r.id}: ${r.detail}`);
    if (r.state === 'fail') {
      for (const e of r.evidence.slice(0, 25)) {
        if (e.ok === true) continue;
        stderrLog(`       ${e.file ? `${e.file}${e.line ? `:${e.line}` : ''}${e.path ? ` ${e.path}` : ''} ` : ''}${e.detail ?? e.value ?? ''}`);
      }
    }
  }
  if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (values.out) stderrLog(`report: ${writeReport(report, values.out, name)}`);
  if (!report.ok) {
    const failed = report.gates.filter((r) => r.state !== 'ok').map((r) => r.id);
    throw new CheckError(`${failed.join(', ')} not ok; fix the tokens (never the gate) and run again`);
  }
  return 0;
}

/** @param {string} raw @returns {Ground} */
function parseGround(raw) {
  const m = /^([a-z0-9][a-z0-9-]{0,63})=(.+)$/.exec(raw);
  const css = (m ? m[2] : raw).trim();
  const rgba = parseColor(css);
  if (!rgba) throw new UsageError(`--ground ${JSON.stringify(raw)} is not a colour lib/color can read`);
  if (rgba.a < 1) throw new UsageError(`--ground ${JSON.stringify(raw)} is translucent; give the opaque colour the text sits on`);
  return { theme: m ? m[1] : '', css, rgba };
}

/**
 * @param {string[]} argv @returns {Promise<number>}
 */
async function paletteCommand(argv) {
  const { values, positionals } = parseCli(argv, {
    help: PALETTE_HELP,
    allowPositionals: false,
    options: {
      ...COMMON_OPTIONS,
      hue: { type: 'string' },
      brand: { type: 'string' },
      chroma: { type: 'string' },
      lightness: { type: 'string' },
      ground: { type: 'string', multiple: true },
      'ground-token': { type: 'string' },
      ratios: { type: 'string' },
      name: { type: 'string' },
    },
  });
  if (positionals.length > 0) throw new UsageError(`unexpected argument ${positionals[0]}; run with --help for usage`);
  if ((values.hue === undefined) === (values.brand === undefined)) throw new UsageError('palette needs exactly one of --hue <deg> or --brand <colour>');
  /** @param {string | undefined} v @param {string} flag @param {number} min @param {number} max */
  const num = (v, flag, min, max) => {
    if (v === undefined) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new UsageError(`${flag} must be a number from ${min} to ${max} (got ${JSON.stringify(v)})`);
    return n;
  };
  let key;
  if (values.brand !== undefined) {
    const rgba = parseColor(values.brand);
    if (!rgba) throw new UsageError(`--brand ${JSON.stringify(values.brand)} is not a colour lib/color can read`);
    key = toOklch(rgba);
  } else {
    key = { l: 0.6, c: -1, h: /** @type {number} */ (num(values.hue, '--hue', 0, 360)) };
  }
  const lightness = num(values.lightness, '--lightness', 0.05, 0.95);
  const chroma = num(values.chroma, '--chroma', 0, 0.37);
  if (lightness !== null) key.l = lightness;
  if (chroma !== null) key.c = chroma;
  if (key.c < 0) key.c = Math.min(0.16, maxChroma(key.l, key.h));
  const ratios = (values.ratios ?? '3,4.5,7').split(',').map((s) => {
    const r = Number(s.trim());
    if (!Number.isFinite(r) || r <= 1 || r > 21) throw new UsageError(`--ratios must list numbers above 1 and at most 21 (got ${JSON.stringify(s)})`);
    return r;
  });
  const name = values.name ?? 'brand';
  if (!TOKEN_NAME.test(`${name}-4-5`)) throw new UsageError(`--name ${JSON.stringify(name)} must start a token name (lowercase letters, digits, hyphens)`);
  /** @type {Ground[]} */
  let grounds;
  let groundName = values['ground-token'] ?? 'bg';
  if (values['ground-token'] !== undefined && !TOKEN_NAME.test(values['ground-token'])) {
    throw new UsageError(`--ground-token ${JSON.stringify(values['ground-token'])} is not a token name`);
  }
  if (values.ground && values.ground.length > 0) {
    grounds = values.ground.map(parseGround);
    if (grounds.length > 1 && grounds.some((g) => g.theme === '')) throw new UsageError('with several --ground values, write each as <theme>=<colour>');
    if (grounds.length === 1 && grounds[0].theme === '') grounds[0].theme = relativeLuminance(grounds[0].rgba) < 0.18 ? 'dark' : 'light';
    if (new Set(grounds.map((g) => g.theme)).size !== grounds.length) throw new UsageError('two --ground values name the same theme');
  } else {
    const ctx = cliContext(values);
    const { source, model, problems } = loadModel(ctx.root, ctx.design);
    if (!model) throw new UsageError(`palette needs --ground <colour>, or a readable ${source.rel} to take the ground from (${summarise(problems)})`);
    const tokenName = values['ground-token'] ?? GROUND_NAMES.find((g) => model.colors.some((c) => c.name === g));
    const token = model.colors.find((c) => c.name === tokenName);
    if (!token) throw new UsageError(`${source.rel} has no colour token ${tokenName ? `"${tokenName}"` : 'named bg, background, page, canvas or surface'}; pass --ground-token <name> or --ground <colour>`);
    groundName = token.name;
    grounds = model.themes.map((t) => {
      const css = effective(token, t.id, model.base);
      const rgba = parseColor(css);
      if (!rgba || rgba.a < 1) throw new UsageError(`${token.name} in theme ${t.id} (${css}) is not an opaque colour`);
      return { theme: t.id, css, rgba };
    });
  }
  const result = await makePalette({ key, grounds, ratios, name, groundName });
  for (const w of result.warnings) stderrLog(`leonardo: ${w}`);
  stderrLog(`palette: key ${result.key} on ${grounds.map((g) => `${g.theme} ${g.css}`).join(', ')}`);
  for (const c of result.checks) {
    stderrLog(`  ${c.name.padEnd(14)} ${c.theme.padEnd(8)} ${c.value ?? 'unreachable'.padEnd(30)} ${c.ratio === null ? '' : ratioText(c.ratio)} (Leonardo ${c.leonardo} ${ratioText(c.leonardoRatio)}${c.adjusted ? ', adjusted' : ''})`);
  }
  const report = { tool: 'tokens palette', ok: result.ok, key: result.key, grounds: grounds.map((g) => ({ theme: g.theme, value: g.css })), ratios, tokens: result.tokens, checks: result.checks };
  if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (values.out) stderrLog(`report: ${writeReport(report, values.out, 'tokens-palette')}`);
  if (!result.ok) {
    const missed = result.checks.filter((c) => c.ratio === null).map((c) => `${c.name} in ${c.theme}`);
    throw new CheckError(`out of reach on its ground: ${missed.join(', ')}; lower the ratio or change the ground`);
  }
  return 0;
}

/**
 * @param {string[]} argv @returns {Promise<number>}
 */
async function buildCommand(argv) {
  const { values, positionals } = parseCli(argv, {
    help: BUILD_HELP,
    allowPositionals: false,
    options: {
      ...COMMON_OPTIONS,
      css: { type: 'string' },
      tailwind: { type: 'string' },
      'font-face': { type: 'string' },
      'dark-media': { type: 'string' },
      mirror: { type: 'string' },
      force: { type: 'boolean' },
    },
  });
  if (positionals.length > 0) throw new UsageError(`unexpected argument ${positionals[0]}; run with --help for usage`);
  const ctx = cliContext(values);
  if (values.css === '' || values.mirror === '') throw new UsageError('--css and --mirror need a path');
  const options = {
    css: values.css ? path.resolve(values.css) : path.join(ctx.design, 'tokens.css'),
    tailwind: /** @type {'yes' | 'no' | 'auto'} */ (choice(values.tailwind, '--tailwind', ['yes', 'no', 'auto'], 'auto')),
    fontFace: choice(values['font-face'], '--font-face', ['yes', 'no'], 'yes') === 'yes',
    darkMedia: choice(values['dark-media'], '--dark-media', ['yes', 'no'], 'yes') === 'yes',
    mirror: values.mirror ? path.resolve(values.mirror) : null,
    force: Boolean(values.force),
  };
  if (options.mirror && ctx.profile && ctx.profile.review_surface !== 'claude-design') {
    stderrLog(`tokens build: the profile's review surface is ${ctx.profile.review_surface}; the mirror is meant for claude-design (TK-23)`);
  }
  const result = await build({ root: ctx.root, design: ctx.design, log: stderrLog }, options);
  if (result.failingPairs > 0) stderrLog(`tokens build: ${result.failingPairs} pair check(s) below minimum; run node tokens.mjs contrast`);
  for (const d of result.dropped) stderrLog(`tokens build: not in the mirror: ${d}`);
  const report = { tool: 'tokens build', ok: true, written: result.written, tailwind: result.tailwind, dropped: result.dropped };
  if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (values.out) stderrLog(`report: ${writeReport(report, values.out, 'tokens-build')}`);
  return 0;
}

/**
 * The CLI. Returns the exit code when nothing was thrown.
 * @param {string[]} argv @returns {Promise<number>}
 */
export async function main(argv) {
  const [first, ...others] = argv;
  if (first === '--help' || first === '-h' || first === 'help') {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (first === undefined) throw new UsageError('missing command (validate, contrast, leak, check, build or palette); run node tokens.mjs --help');
  const flagsFirst = first.startsWith('-');
  const command = flagsFirst ? 'check' : first;
  const rest = flagsFirst ? argv : others;
  /** @type {Record<string, string>} */
  const what = {
    validate: 'Gate tokens.valid on <design>/tokens.json and its generated views.',
    contrast: 'Gate tokens.contrast: every declared text and ground pair in every theme (WCAG 2 ratios).',
    leak: 'Gate tokens.leak: scans the source tree, and the built output given with --serve, for leaks past the tokens.',
    check: 'Runs the tokens gates named by --gates, like frontend-check does.',
  };
  if (command === 'build') return buildCommand(rest);
  if (command === 'palette') return paletteCommand(rest);
  if (!Object.hasOwn(what, command)) throw new UsageError(`unknown command ${JSON.stringify(command)}; run node tokens.mjs --help`);
  const { values, positionals } = parseCli(rest, {
    help: GATE_HELP(command, what[command]),
    allowPositionals: false,
    options: {
      ...COMMON_OPTIONS,
      serve: { type: 'string' },
      url: { type: 'string' },
      gates: { type: 'string' },
      'allow-skip': { type: 'string', multiple: true },
    },
  });
  if (positionals.length > 0) throw new UsageError(`unexpected argument ${positionals[0]}; run with --help for usage`);
  if (command !== 'check' && values.gates !== undefined) throw new UsageError('--gates belongs to the check command');
  if (values.serve !== undefined && values.url !== undefined) throw new UsageError('--serve and --url do not combine; pass one target');
  const ids = command === 'check' ? parseGateList(values.gates ?? 'tokens') : [`tokens.${command === 'validate' ? 'valid' : command}`];
  const ctx = cliContext(values);
  if (values.url !== undefined) stderrLog('tokens: --url given; the tokens gates read files, not the network (pass --serve <dist> for built files)');
  const allowSkip = (values['allow-skip'] ?? []).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
  return runFromCli(ids, ctx, { json: values.json, out: values.out, allowSkip }, command === 'check' ? 'tokens-gates' : `tokens-${command}`);
}

/**
 * True when this file is the script node was started with.
 * @returns {boolean}
 */
function isMain() {
  return isMainModule(import.meta.url);
}

if (isMain()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }, exitWith);
}
