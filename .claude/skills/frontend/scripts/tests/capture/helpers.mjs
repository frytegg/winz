// @ts-check
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{status?: number, headers?: Record<string, string>, body?: string | Buffer}} Reply
 * @typedef {Reply | ((req: http.IncomingMessage) => Reply)} Route
 * @typedef {{method: string, url: string, userAgent: string}} Logged
 * @typedef {{url: string, port: number, requests: Logged[], close: () => Promise<void>}} TestServer
 */

export const FIXTURES = fileURLToPath(new URL('../fixtures/capture/', import.meta.url));

/**
 * @param {...string} parts
 * @returns {string}
 */
export function fixture(...parts) {
  return path.join(FIXTURES, ...parts);
}

/**
 * @param {...string} parts
 * @returns {string}
 */
export function readFixture(...parts) {
  return readFileSync(fixture(...parts), 'utf8');
}

/**
 * A fresh folder under the OS temp directory, which is outside every git work tree on this machine.
 * @param {string} prefix
 * @returns {string}
 */
export function tempDir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), `fe-capture-${prefix}-`));
}

/**
 * @param {string} dir
 */
export function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * A loopback HTTP server answering from a route table (exact path, query ignored; unknown paths 404), logging every
 * request with its user agent.
 * @param {Record<string, Route>} routes
 * @returns {Promise<TestServer>}
 */
export async function startServer(routes) {
  /** @type {Logged[]} */
  const requests = [];
  const server = http.createServer((req, res) => {
    const pathOnly = (req.url ?? '/').split('?')[0];
    requests.push({ method: req.method ?? 'GET', url: req.url ?? '/', userAgent: String(req.headers['user-agent'] ?? '') });
    const route = routes[pathOnly];
    const reply = typeof route === 'function' ? route(req) : route ?? { status: 404, body: 'not found' };
    res.statusCode = reply.status ?? 200;
    for (const [k, v] of Object.entries(reply.headers ?? {})) res.setHeader(k, v);
    if (!res.hasHeader('content-type')) res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(reply.body ?? '');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve(undefined));
    }),
  };
}

/**
 * A loopback port with nothing listening.
 * @returns {Promise<number>}
 */
export async function closedPort() {
  const s = await startServer({});
  await s.close();
  return s.port;
}

/**
 * A sleep that records the requested waits and returns at once.
 * @returns {{waits: number[], sleep: (ms: number) => Promise<void>}}
 */
export function fakeSleep() {
  /** @type {number[]} */
  const waits = [];
  return {
    waits,
    sleep: async (ms) => {
      waits.push(ms);
    },
  };
}

/**
 * An HTML page with `blocks` visible paragraphs (enough elements to pass the near-empty page heuristic).
 * @param {string} title
 * @param {{blocks?: number, head?: string, body?: string}} [options]
 * @returns {string}
 */
export function htmlPage(title, { blocks = 80, head = '', body = '' } = {}) {
  const paragraphs = Array.from({ length: blocks }, (_, i) => `<p>Paragraph ${i + 1} of the fixture page.</p>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}${paragraphs}</body></html>`;
}

/**
 * Writes a JSON file (LF, trailing newline), creating its folder.
 * @param {string} file
 * @param {unknown} value
 */
export function writeJsonFile(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
