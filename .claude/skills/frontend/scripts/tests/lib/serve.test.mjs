// @ts-check
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EnvError, UsageError } from '../../lib/errors.mjs';
import { mimeType, serveStatic } from '../../lib/serve.mjs';

const SITE = fileURLToPath(new URL('../fixtures/lib/site/', import.meta.url));
const SITE_404 = fileURLToPath(new URL('../fixtures/lib/site-404/', import.meta.url));

/** @type {import('../../lib/serve.mjs').StaticServer} */
let server;
/** @type {import('../../lib/serve.mjs').StaticServer} */
let noFallback;
/** @type {import('../../lib/serve.mjs').StaticServer} */
let with404;

before(async () => {
  server = await serveStatic(SITE);
  noFallback = await serveStatic(SITE, { spaFallback: false });
  with404 = await serveStatic(SITE_404);
});

after(async () => {
  await Promise.all([server.close(), noFallback.close(), with404.close()]);
});

/**
 * Sends a raw request: the path goes on the wire exactly as given (no client-side normalisation).
 * @param {import('../../lib/serve.mjs').StaticServer} target
 * @param {string} rawPath
 * @param {{method?: string, headers?: Record<string, string>}} [options]
 * @returns {Promise<{status: number, headers: http.IncomingHttpHeaders, body: string}>}
 */
function request(target, rawPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: target.port, path: rawPath, method, headers, agent: false }, (res) => {
      const chunks = /** @type {Buffer[]} */ ([]);
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves on 127.0.0.1 with a free port and reports url and root', () => {
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(server.url, `http://127.0.0.1:${server.port}`);
  assert.ok(!server.root.includes('\\'));
});

test('index, files and correct MIME types', async () => {
  const cases = [
    ['/', 'text/html; charset=utf-8', /home page/],
    ['/assets/app.js', 'text/javascript; charset=utf-8', /answer = 42/],
    ['/assets/style.css', 'text/css; charset=utf-8', /margin: 0/],
    ['/assets/logo.svg', 'image/svg+xml', /<svg/],
    ['/assets/data.json', 'application/json; charset=utf-8', /"ok": true/],
    ['/assets/font.woff2', 'font/woff2', /wOF2/],
    ['/assets/my%20file.txt', 'text/plain; charset=utf-8', /spaced name/],
    ['/assets/app.js?v=123#x', 'text/javascript; charset=utf-8', /answer/],
  ];
  for (const [p, type, body] of /** @type {Array<[string, string, RegExp]>} */ (cases)) {
    const r = await request(server, p);
    assert.equal(r.status, 200, p);
    assert.equal(r.headers['content-type'], type, p);
    assert.match(r.body, body, p);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
  }
  assert.equal(mimeType('x.UNKNOWN'), 'application/octet-stream');
  assert.equal(mimeType('a/b/C.PNG'), 'image/png');
});

test('clean URLs: /name serves name.html, a folder redirects to its slash and serves index.html', async () => {
  const about = await request(server, '/about');
  assert.equal(about.status, 200);
  assert.match(about.body, /about page/);
  const blog = await request(server, '/blog');
  assert.equal(blog.status, 200, 'a folder without index.html next to blog.html serves blog.html');
  assert.match(blog.body, /blog list/);
  assert.match((await request(server, '/blog/first')).body, /first post/);
  const docs = await request(server, '/docs?x=1');
  assert.equal(docs.status, 301);
  assert.equal(docs.headers.location, '/docs/?x=1');
  assert.match((await request(server, '/docs/')).body, /docs index/);
});

test('SPA fallback: unknown extensionless paths get index.html; unknown assets get 404', async () => {
  const deep = await request(server, '/app/queue/42');
  assert.equal(deep.status, 200);
  assert.match(deep.body, /home page/);
  const asset = await request(server, '/assets/missing.png');
  assert.equal(asset.status, 404);
  assert.equal(asset.body, 'not found');
  assert.equal((await request(noFallback, '/app/queue')).status, 404, 'fallback can be turned off');
});

test('a build with 404.html serves it with status 404', async () => {
  const r = await request(with404, '/missing.css');
  assert.equal(r.status, 404);
  assert.match(r.body, /custom not found/);
  assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
});

test('path traversal is refused in every spelling', async () => {
  const attempts = [
    '/../secret-outside.txt',
    '/assets/../../secret-outside.txt',
    '/%2e%2e/secret-outside.txt',
    '/%2E%2E%2Fsecret-outside.txt',
    '/assets/%2e%2e%2f%2e%2e%2fsecret-outside.txt',
    '/..%5csecret-outside.txt',
    '/assets/..%5c..%5csecret-outside.txt',
    '/%00index.html',
  ];
  for (const p of attempts) {
    const r = await request(server, p);
    assert.equal(r.status, 403, `${p} -> ${r.status}`);
    assert.ok(!r.body.includes('TOP-SECRET-CONTENT'), `${p} leaked the outside file`);
  }
  if (process.platform === 'win32') {
    assert.equal((await request(server, '/C:/Windows/win.ini')).status, 403);
    assert.equal((await request(server, '/index.html::$DATA')).status, 403);
  }
  assert.equal((await request(server, '/%E0%A4%A')).status, 400, 'malformed percent-encoding');
});

test('dot-folders are hidden; .well-known would be served', async () => {
  assert.equal((await request(server, '/.hidden/secret.txt')).status, 404);
  const wellKnown = await request(server, '/.well-known/security.txt');
  assert.equal(wellKnown.status, 200);
  assert.match(wellKnown.body, /Contact:/);
});

test('HEAD sends headers only; other methods get 405 with Allow', async () => {
  const head = await request(server, '/assets/app.js', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(head.headers['content-length'], String('export const answer = 42;\n'.length));
  const post = await request(server, '/', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
});

test('single byte ranges for media; unsatisfiable ranges get 416', async () => {
  const part = await request(server, '/assets/clip.mp4', { headers: { Range: 'bytes=10-19' } });
  assert.equal(part.status, 206);
  assert.equal(part.body, '0123456789');
  assert.equal(part.headers['content-range'], 'bytes 10-19/100');
  const suffix = await request(server, '/assets/clip.mp4', { headers: { Range: 'bytes=-5' } });
  assert.equal(suffix.body, '56789');
  const open = await request(server, '/assets/clip.mp4', { headers: { Range: 'bytes=95-' } });
  assert.equal(open.body, '56789');
  const bad = await request(server, '/assets/clip.mp4', { headers: { Range: 'bytes=200-300' } });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers['content-range'], 'bytes */100');
  assert.equal((await request(server, '/assets/clip.mp4')).headers['accept-ranges'], 'bytes');
});

test('a missing folder or a file is a UsageError; a taken port is an EnvError', async () => {
  await assert.rejects(serveStatic(fileURLToPath(new URL('../fixtures/lib/nope/', import.meta.url))), UsageError);
  await assert.rejects(serveStatic(fileURLToPath(new URL('../fixtures/lib/secret-outside.txt', import.meta.url))), UsageError);
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = blocker.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  try {
    await assert.rejects(serveStatic(SITE, { port }), (err) => err instanceof EnvError && new RegExp(`port ${port} is already in use`).test(err.message));
  } finally {
    await new Promise((resolve) => blocker.close(() => resolve(undefined)));
  }
});

test('close() is idempotent and frees the port', async () => {
  const s = await serveStatic(SITE);
  await s.close();
  await s.close();
  await assert.rejects(request(s, '/'));
});
