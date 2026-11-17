// @ts-check
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { toPosix, walk } from '../../lib/fsutil.mjs';
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 * @typedef {{width: number, height: number, rgba: Uint8Array}} Image
 * @typedef {{template: string, match: 'exact' | 'normalised' | 'pixels' | 'fingerprint', line: number}} IconMatch
 */

const RULE = 'SL-G02';

/**
 * Framework template favicons. Raw SHA-256 of the files' bytes; `prefix` entries match on the first 16 hex digits,
 * which is all FD12-F27 recorded for create-vite's vanilla copy.
 */
export const TEMPLATE_FILES = Object.freeze([
  { sha256: '61bc9a161de58248288e6905425d7180f0624c2865007b97d763fdac12043a66', template: "create-vite's favicon.svg (react-ts, vue-ts, svelte-ts and 12 other templates)", source: 'FD12-F27' },
  { sha256: 'ceeac38434be7a3b', prefix: true, template: "create-vite's favicon.svg (vanilla template, one trailing newline more)", source: 'FD12-F27' },
  { sha256: 'c28fdd2a4f31e2dc64f653962286da5c82a4cdfc518b242d32812c624e9a19a4', template: "create-next-app's app/favicon.ico (canary, entries 48/32/16)", source: 'FD12-F27' },
  {
    sha256: '2b8ad2d33455a8f736fc3a8ebf8f0bdea8848ad4c0db48a2833bd0f9cd775932',
    template: "create-next-app's earlier app/favicon.ico (25,931 bytes, entries 16/32/48/256)",
    source: 'observed 2026-10-01: identical in five create-next-app scaffolds on the owner machine, two still titled "Create Next App"',
  },
]);

/**
 * SHA-256 of normalised SVG text (CRLF to LF, trailing whitespace removed per line and at the end). The create-vite
 * entry assumes its 9,522-byte file has no trailing whitespace (the vanilla copy differs by one trailing newline only,
 * FD12-F27); if that assumption is wrong the raw hashes above still match the pristine files.
 */
export const TEMPLATE_SVG_NORMALISED = Object.freeze(new Map([
  ['61bc9a161de58248288e6905425d7180f0624c2865007b97d763fdac12043a66', "create-vite's favicon.svg"],
]));

/** SHA-256 of decoded RGBA pixels ("<w>x<h>:" + bytes, transparent pixels zeroed) of each template ICO entry. */
export const TEMPLATE_PIXELS = Object.freeze(new Map([
  ['61f123880ac798d6805cca4485ed60fa3cdbfe26b8f53a54f99230edc8ac1526', "create-next-app's earlier favicon (16x16)"],
  ['af39a9b444db3fa006fcd4c655d145362c5b07df49be92e095bc26b388e76fb8', "create-next-app's earlier favicon (32x32)"],
  ['a910c37beaaec95ee91711ca09a444854bcb7493091c1db6e1a546a46778abe1', "create-next-app's earlier favicon (48x48)"],
  ['e736d950eacdafc68d6be25382606a326bfc2accfd423848bc15a6bbc96ab694', "create-next-app's earlier favicon (256x256)"],
]));

/** create-vite's logo fill (FD12-F27: `head -c 300 vite-favicon.svg` shows fill="#863bff"). */
const VITE_LOGO_FILL = /#863bff\b/i;
const ICON_FILE = /^(?:favicon|icon|apple-icon|apple-touch-icon)(?:[-.][\w.-]*)?\.(?:ico|svg|png)$/i;

const TEXT_SIGNS = [
  { re: /\bCreate Next App\b/g, what: 'the create-next-app page title "Create Next App"' },
  { re: /\bVite \+ (?:React|Vue|Svelte|Preact|Lit|Solid|Qwik)(?: \+ TS)?\b/g, what: 'the create-vite page title' },
  { re: /#aa3bff\b/gi, what: "create-vite's demo accent #aa3bff" },
  { re: /\bimport\s*\{[^}]*\bGeist(?:_Mono)?\b[^}]*\}\s*from\s*["']next\/font\/google["']/g, what: "create-next-app's Geist import from next/font/google" },
  { re: /\blocalFont\(\s*\{[^}]*GeistVF\.woff/g, what: "create-next-app's local GeistVF.woff font" },
  { re: /@fontsource(?:-variable)?\/geist(?:-sans|-mono)?\b/g, what: 'the Geist font that shadcn init installs' },
  { re: /\bGet started by editing\b|\bTo get started, edit the page\.tsx file\b/g, what: "create-next-app's starter page copy" },
  { re: /\band save to test HMR\b|\bClick on the Vite and \w+ logos to learn more\b/g, what: "create-vite's demo page copy" },
  { re: />\s*count is \{\s*count\s*\}\s*</g, what: "create-vite's demo counter" },
  { re: /\bgenerator\s*:\s*["'`]v0(?:\.app|\.dev)?["'`]/g, what: 'v0\'s generator metadata (generator: "v0.app")' },
];

/** v0's scaffold font binding: `const _inter = Inter({ subsets: ["latin"] })`, a next/font call nothing uses. */
const UNUSED_FONT = /\bconst\s+(_[A-Za-z][\w$]*)\s*=\s*([A-Z][A-Za-z_]*)\(\s*\{[^{}]*\bsubsets\b/g;
/** v0's default public assets (observed in a v0.app scaffold, XRPL_Hackathon/hackathon-rwa public/), matched by name. */
const V0_ASSET = /(?:^|\/)public\/(?:placeholder(?:-logo|-user)?\.(?:svg|png|jpe?g)|icon-(?:light|dark)-32x32\.png)$/i;
/** One placeholder file can be the project's own; v0's set ships five of them. */
const MIN_V0_ASSETS = 2;

/**
 * Starter-template leftovers (FD16-F04 "starter-residue grep for Geist, #aa3bff, 'Create Next App' and 'Vite + React'";
 * FD10-F06 create-next-app's dark globals.css; FD12-F27 default favicons, matched after normalisation). Reports each
 * leftover: template titles, create-vite's accent, the scaffold's Geist imports, an untouched create-next-app
 * globals.css, and favicon or icon files that are a framework's default by raw hash, normalised SVG hash, decoded
 * pixels, or create-vite's logo fill. v0 scaffolds (a third generator, seen in the owner's XRPL RWA project) leave
 * `generator: "v0.app"` in the Next.js metadata, an unused `const _inter = Inter(...)` binding and v0's placeholder
 * and icon files in public/ (named placeholder-logo.svg, placeholder-user.jpg, icon-light-32x32.png and so on; two or
 * more of them are reported, matched by name because the template's hashes are not recorded offline).
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    for (const { re, what } of TEXT_SIGNS) {
      for (const m of file.code.matchAll(re)) findings.push(finding(file, m.index ?? 0, m[0], `${what} left from the starter template; replace it with the project's own`));
    }
    if (file.kind === 'css' && /--background\s*:\s*#0a0a0a/i.test(file.code) && /--foreground\s*:\s*#ededed/i.test(file.code) && /font-family\s*:\s*Arial,\s*Helvetica,\s*sans-serif/i.test(file.code)) {
      const at = file.code.search(/--background\s*:\s*#0a0a0a/i);
      findings.push(finding(file, at, 'create-next-app globals.css', "globals.css still holds create-next-app's #0a0a0a / #ededed theme and Arial body font; replace it with the project's tokens"));
    }
    for (const m of file.code.matchAll(UNUSED_FONT)) {
      const uses = file.code.split(new RegExp(`(?<![\\w$])${m[1].replace(/\$/g, '\\$')}(?![\\w$])`)).length - 1;
      if (uses === 1) findings.push(finding(file, m.index ?? 0, m[1], `an unused ${m[2]} font binding (${m[1]}) left from the v0 scaffold; load the project's own faces and apply them`));
    }
  }
  const rootDir = typeof ctx.root === 'string' ? ctx.root : null;
  if (rootDir) {
    const assets = shippedPaths(ctx, walk(rootDir, { include: ['placeholder*.{svg,png,jpg,jpeg}', 'icon-*-32x32.png'], exclude: privateExcludes(rootDir, ctx), nocase: true }))
      .filter((rel) => V0_ASSET.test(rel));
    if (assets.length >= MIN_V0_ASSETS) {
      for (const rel of assets) {
        findings.push({
          rule: RULE, layer: 'static', file: rel, line: 0, excerpt: path.posix.basename(rel), value: { template: 'v0 default assets', match: 'name' },
          detail: `${rel} is one of v0's default placeholder and icon files (${assets.length} in the project); replace them with the project's own assets`,
        });
      }
    }
  }
  const root = typeof ctx.root === 'string' ? ctx.root : null;
  if (root) {
    const include = ['{favicon,icon,apple-icon,apple-touch-icon}*.{ico,svg,png}'];
    for (const rel of shippedPaths(ctx, walk(root, { include, exclude: privateExcludes(root, ctx), nocase: true }))) {
      if (!ICON_FILE.test(path.posix.basename(rel))) continue;
      const match = templateIcon(readFileSync(path.join(root, rel)), rel);
      if (!match) continue;
      findings.push({
        rule: RULE,
        layer: 'static',
        file: rel,
        line: match.line,
        excerpt: path.posix.basename(rel),
        value: { template: match.template, match: match.match },
        detail: `${rel} is ${match.template} (${match.match} match); draw the project's own favicon set`,
      });
    }
  }
  return findings;
}

/**
 * Which template icon a file is, if any: raw hash, normalised SVG hash, decoded pixels, then create-vite's logo fill.
 * @param {Buffer} bytes
 * @param {string} name
 * @returns {IconMatch | null}
 */
export function templateIcon(bytes, name) {
  const raw = createHash('sha256').update(bytes).digest('hex');
  for (const t of TEMPLATE_FILES) {
    if (t.prefix ? raw.startsWith(t.sha256) : raw === t.sha256) return { template: t.template, match: 'exact', line: 0 };
  }
  if (/\.svg$/i.test(name)) {
    const text = bytes.toString('utf8');
    const normalised = createHash('sha256').update(normaliseSvg(text)).digest('hex');
    const known = TEMPLATE_SVG_NORMALISED.get(normalised);
    if (known) return { template: known, match: 'normalised', line: 0 };
    const fill = VITE_LOGO_FILL.exec(text);
    if (fill) return { template: "create-vite's purple logo (fill #863bff)", match: 'fingerprint', line: lineOf(text, fill.index) };
    return null;
  }
  for (const image of decodeIcon(bytes)) {
    const known = TEMPLATE_PIXELS.get(pixelHash(image));
    if (known) return { template: known, match: 'pixels', line: 0 };
  }
  return null;
}

/**
 * CRLF to LF, trailing whitespace stripped from every line and from the end.
 * @param {string} text
 * @returns {string}
 */
export function normaliseSvg(text) {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
}

/**
 * SHA-256 of "<width>x<height>:" followed by the RGBA bytes, with fully transparent pixels zeroed so encoders that
 * keep or drop hidden colour agree.
 * @param {Image} image
 * @returns {string}
 */
export function pixelHash({ width, height, rgba }) {
  const pixels = Uint8Array.from(rgba);
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) pixels.fill(0, i, i + 3);
  }
  return createHash('sha256').update(`${width}x${height}:`).update(pixels).digest('hex');
}

/**
 * The images of an ICO (BMP or PNG entries) or of a PNG file; [] for anything it cannot decode.
 * @param {Buffer} bytes
 * @returns {Image[]}
 */
export function decodeIcon(bytes) {
  if (isPng(bytes)) {
    const png = decodePng(bytes);
    return png ? [png] : [];
  }
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) return [];
  /** @type {Image[]} */
  const images = [];
  const count = bytes.readUInt16LE(4);
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16;
    if (entry + 16 > bytes.length) break;
    const width = bytes[entry] || 256;
    const height = bytes[entry + 1] || 256;
    const size = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    if (offset + size > bytes.length) continue;
    const data = bytes.subarray(offset, offset + size);
    const image = isPng(data) ? decodePng(data) : decodeDib(data, width, height);
    if (image) images.push(image);
  }
  return images;
}

/**
 * @param {Buffer} bytes
 * @returns {boolean}
 */
function isPng(bytes) {
  return bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a;
}

/**
 * A 24- or 32-bit BMP icon entry (bottom-up rows, then a 1-bit AND mask); null for other depths.
 * @param {Buffer} data
 * @param {number} width
 * @param {number} height
 * @returns {Image | null}
 */
function decodeDib(data, width, height) {
  if (data.length < 40) return null;
  const header = data.readUInt32LE(0);
  const bpp = data.readUInt16LE(14);
  if (bpp !== 32 && bpp !== 24) return null;
  const stride = Math.ceil((width * bpp) / 32) * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const maskStart = header + stride * height;
  if (maskStart > data.length) return null;
  const rgba = new Uint8Array(width * height * 4);
  let alpha = false;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = header + (height - 1 - y) * stride + x * (bpp / 8);
      const dst = (y * width + x) * 4;
      rgba[dst] = data[src + 2];
      rgba[dst + 1] = data[src + 1];
      rgba[dst + 2] = data[src];
      rgba[dst + 3] = bpp === 32 ? data[src + 3] : 255;
      if (bpp === 32 && data[src + 3] !== 0) alpha = true;
    }
  }
  if (!alpha && maskStart + maskStride * height <= data.length) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const bit = data[maskStart + (height - 1 - y) * maskStride + (x >> 3)] & (0x80 >> (x & 7));
        rgba[(y * width + x) * 4 + 3] = bit ? 0 : 255;
      }
    }
  }
  return { width, height, rgba };
}

/**
 * A non-interlaced PNG of bit depth 8 or 16 (greyscale, RGB, grey+alpha, RGBA) or a palette image of depth 1-8;
 * null for anything else.
 * @param {Buffer} data
 * @returns {Image | null}
 */
function decodePng(data) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = -1;
  let interlace = 0;
  /** @type {Buffer | null} */
  let palette = null;
  /** @type {Buffer | null} */
  let transparency = null;
  /** @type {Buffer[]} */
  const chunks = [];
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset);
    const kind = data.toString('latin1', offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') transparency = body;
    else if (kind === 'IDAT') chunks.push(body);
    else if (kind === 'IEND') break;
    offset += 12 + length;
  }
  const channels = /** @type {Record<number, number>} */ ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[type];
  if (!channels || interlace !== 0 || width === 0 || height === 0) return null;
  if (type === 3 ? ![1, 2, 4, 8].includes(depth) : ![8, 16].includes(depth)) return null;
  /** @type {Buffer} */
  let raw;
  try {
    raw = inflateSync(Buffer.concat(chunks));
  } catch {
    return null;
  }
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const step = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < (stride + 1) * height) return null;
  const rows = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const current = Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= step ? current[i - step] : 0;
      const b = previous[i];
      const c = i >= step ? previous[i - step] : 0;
      current[i] = (line[i] + predictor(filter, a, b, c)) & 0xff;
    }
    current.copy(rows, y * stride);
    previous = current;
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dst = (y * width + x) * 4;
      if (type === 3) {
        const index = sample(rows, y * stride, x, depth);
        rgba[dst] = palette?.[index * 3] ?? 0;
        rgba[dst + 1] = palette?.[index * 3 + 1] ?? 0;
        rgba[dst + 2] = palette?.[index * 3 + 2] ?? 0;
        rgba[dst + 3] = transparency && index < transparency.length ? transparency[index] : 255;
        continue;
      }
      const at = y * stride + x * channels * (depth / 8);
      const read = (/** @type {number} */ k) => rows[at + k * (depth / 8)];
      if (type === 0 || type === 4) {
        rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = read(0);
        rgba[dst + 3] = type === 4 ? read(1) : 255;
      } else {
        rgba[dst] = read(0);
        rgba[dst + 1] = read(1);
        rgba[dst + 2] = read(2);
        rgba[dst + 3] = type === 6 ? read(3) : 255;
      }
    }
  }
  return { width, height, rgba };
}

/**
 * @param {number} filter
 * @param {number} a left
 * @param {number} b up
 * @param {number} c upper left
 * @returns {number}
 */
function predictor(filter, a, b, c) {
  if (filter === 1) return a;
  if (filter === 2) return b;
  if (filter === 3) return (a + b) >> 1;
  if (filter === 4) {
    const pa = Math.abs(b - c);
    const pb = Math.abs(a - c);
    const pc = Math.abs(a + b - 2 * c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }
  return 0;
}

/**
 * The palette index of pixel x in a row packed at `depth` bits per pixel.
 * @param {Buffer} rows
 * @param {number} rowStart
 * @param {number} x
 * @param {number} depth
 * @returns {number}
 */
function sample(rows, rowStart, x, depth) {
  if (depth === 8) return rows[rowStart + x];
  const perByte = 8 / depth;
  const byte = rows[rowStart + Math.floor(x / perByte)];
  const shift = 8 - depth * ((x % perByte) + 1);
  return (byte >> shift) & ((1 << depth) - 1);
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
