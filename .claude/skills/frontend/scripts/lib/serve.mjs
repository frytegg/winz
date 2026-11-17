// @ts-check
import { createReadStream, realpathSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { EnvError, UsageError } from './errors.mjs';

const TEXT = '; charset=utf-8';

/** Content types by extension; text types carry a charset. */
export const MIME_TYPES = Object.freeze({
  '.html': `text/html${TEXT}`,
  '.htm': `text/html${TEXT}`,
  '.css': `text/css${TEXT}`,
  '.js': `text/javascript${TEXT}`,
  '.mjs': `text/javascript${TEXT}`,
  '.cjs': `text/javascript${TEXT}`,
  '.json': `application/json${TEXT}`,
  '.map': `application/json${TEXT}`,
  '.jsonld': `application/ld+json${TEXT}`,
  '.webmanifest': `application/manifest+json${TEXT}`,
  '.txt': `text/plain${TEXT}`,
  '.md': `text/markdown${TEXT}`,
  '.csv': `text/csv${TEXT}`,
  '.xml': `application/xml${TEXT}`,
  '.rss': `application/rss+xml${TEXT}`,
  '.atom': `application/atom+xml${TEXT}`,
  '.vtt': `text/vtt${TEXT}`,
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.apng': 'image/apng',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
});

/**
 * @param {string} file
 * @returns {string}
 */
export function mimeType(file) {
  const ext = path.extname(file).toLowerCase();
  return Object.hasOwn(MIME_TYPES, ext) ? MIME_TYPES[/** @type {keyof typeof MIME_TYPES} */ (ext)] : 'application/octet-stream';
}

/**
 * @typedef {{url: string, port: number, root: string, close: () => Promise<void>}} StaticServer
 */

/**
 * Serves a folder (a static build) on 127.0.0.1 with node:http, for checks and tests; never on another interface.
 * - GET and HEAD only; `Cache-Control: no-store`; single byte ranges for media.
 * - Path resolution: `/x` tries `x`, `x.html`, then `x/index.html` (a folder without its trailing slash is
 *   redirected to it, as static hosts do); `/` serves `index.html`.
 * - SPA fallback: an extensionless path that matches nothing gets `index.html` with status 200 (spaFallback); a
 *   missing asset with an extension gets 404 (`404.html` when the build has one).
 * - Refused: `..` segments (raw or percent-encoded, with / or \), NUL, `:` on Windows, symbolic links that leave
 *   the folder (403); dot-folders other than `.well-known` (404).
 * Throws UsageError when the folder does not exist, EnvError when the port is taken.
 * @param {string} dir
 * @param {{port?: number, spaFallback?: boolean}} [options]
 * @returns {Promise<StaticServer>}
 */
export async function serveStatic(dir, { port = 0, spaFallback = true } = {}) {
  const root = path.resolve(dir);
  let stats;
  try {
    stats = statSync(root);
  } catch (err) {
    throw new UsageError(`folder to serve not found: ${toPosix(root)}; build first or pass the right --serve folder`, { cause: err });
  }
  if (!stats.isDirectory()) throw new UsageError(`--serve needs a folder, got a file: ${toPosix(root)}`);
  const realRoot = realpathSync(root);
  const server = http.createServer((req, res) => {
    try {
      handle(req, res, realRoot, spaFallback);
    } catch (err) {
      send(res, 500, `internal error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  server.keepAliveTimeout = 1000;
  await new Promise((resolve, reject) => {
    /** @param {NodeJS.ErrnoException} err */
    const onError = (err) => {
      server.off('listening', onListening);
      if (err.code === 'EADDRINUSE') {
        reject(new EnvError(`port ${port} is already in use; stop the other server or pass another port (0 picks a free one)`, { cause: err }));
      } else {
        reject(new EnvError(`cannot listen on 127.0.0.1:${port}: ${err.message}`, { cause: err }));
      }
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(undefined);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new EnvError('static server has no TCP address');
  let closed = false;
  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    root: toPosix(root),
    close: () => {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} root real path of the served folder
 * @param {boolean} spaFallback
 */
function handle(req, res, root, spaFallback) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    send(res, 405, 'method not allowed', req.method === 'HEAD');
    return;
  }
  const rawPath = (req.url ?? '/').split(/[?#]/)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    send(res, 400, 'bad request: malformed percent-encoding', req.method === 'HEAD');
    return;
  }
  const head = req.method === 'HEAD';
  const segments = decoded.split(/[/\\]+/).filter(Boolean);
  if (decoded.includes('\0') || segments.includes('..') || (process.platform === 'win32' && decoded.includes(':'))) {
    send(res, 403, 'forbidden: path outside the served folder', head);
    return;
  }
  if (segments.some((s) => s.startsWith('.') && s !== '.well-known')) {
    sendNotFound(res, root, head);
    return;
  }
  const target = path.join(root, ...segments);
  if (!inside(root, target)) {
    send(res, 403, 'forbidden: path outside the served folder', head);
    return;
  }
  const trailingSlash = rawPath.endsWith('/');
  const resolved = resolveFile(root, target, trailingSlash);
  if (resolved === 'redirect') {
    const query = (req.url ?? '').slice(rawPath.length);
    res.statusCode = 301;
    res.setHeader('Location', `${rawPath}/${query}`);
    res.setHeader('Cache-Control', 'no-store');
    res.end();
    return;
  }
  if (resolved === 'outside') {
    send(res, 403, 'forbidden: link leaves the served folder', head);
    return;
  }
  if (resolved) {
    sendFile(req, res, resolved);
    return;
  }
  const hasExtension = path.extname(segments.at(-1) ?? '') !== '';
  if (spaFallback && !hasExtension) {
    const index = path.join(root, 'index.html');
    if (isFile(index)) {
      sendFile(req, res, index);
      return;
    }
  }
  sendNotFound(res, root, head);
}

/**
 * @param {string} root
 * @param {string} target
 * @param {boolean} trailingSlash
 * @returns {string | null | 'redirect' | 'outside'}
 */
function resolveFile(root, target, trailingSlash) {
  /** @type {string[]} */
  const candidates = [];
  if (isDirectory(target)) {
    const index = path.join(target, 'index.html');
    if (isFile(index)) {
      if (!trailingSlash && target !== root) return 'redirect';
      candidates.push(index);
    }
  } else {
    candidates.push(target);
  }
  if (!trailingSlash && target !== root && path.extname(target) === '') candidates.push(`${target}.html`);
  for (const file of candidates) {
    if (!isFile(file)) continue;
    let real;
    try {
      real = realpathSync(file);
    } catch {
      continue;
    }
    return inside(root, real) ? real : 'outside';
  }
  return null;
}

/**
 * @param {string} root
 * @param {string} candidate
 * @returns {boolean}
 */
function inside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** @param {string} p @returns {boolean} */
function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** @param {string} p @returns {boolean} */
function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} file
 * @param {number} [status]
 */
function sendFile(req, res, file, status = 200) {
  const size = statSync(file).size;
  res.setHeader('Content-Type', mimeType(file));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Accept-Ranges', 'bytes');
  let start = 0;
  let end = size - 1;
  const range = status === 200 ? req.headers.range : undefined;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const parsed = m && (m[1] !== '' || m[2] !== '') ? parseRange(m[1], m[2], size) : null;
    if (!parsed) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${size}`);
      res.end();
      return;
    }
    [start, end] = parsed;
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  } else {
    res.statusCode = status;
  }
  const length = size === 0 ? 0 : end - start + 1;
  res.setHeader('Content-Length', String(length));
  if (req.method === 'HEAD' || length === 0) {
    res.end();
    return;
  }
  const stream = createReadStream(file, { start, end });
  stream.on('error', (err) => res.destroy(err));
  stream.pipe(res);
}

/**
 * @param {string} first
 * @param {string} last
 * @param {number} size
 * @returns {[number, number] | null}
 */
function parseRange(first, last, size) {
  if (size === 0) return null;
  if (first === '') {
    const suffix = Number(last);
    if (suffix <= 0) return null;
    return [Math.max(0, size - suffix), size - 1];
  }
  const start = Number(first);
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (start > end || start >= size) return null;
  return [start, end];
}

/**
 * @param {http.ServerResponse} res
 * @param {string} root
 * @param {boolean} head
 */
function sendNotFound(res, root, head) {
  const page = path.join(root, '404.html');
  if (isFile(page)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', mimeType(page));
    res.setHeader('Cache-Control', 'no-store');
    const size = statSync(page).size;
    res.setHeader('Content-Length', String(size));
    if (head) {
      res.end();
      return;
    }
    const stream = createReadStream(page);
    stream.on('error', (err) => res.destroy(err));
    stream.pipe(res);
    return;
  }
  send(res, 404, 'not found', head);
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {string} body
 * @param {boolean} [head]
 */
function send(res, status, body, head = false) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', `text/plain${TEXT}`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', String(Buffer.byteLength(body)));
  res.end(head ? undefined : body);
}

/** @param {string} p @returns {string} */
function toPosix(p) {
  return p.replace(/\\/g, '/');
}
