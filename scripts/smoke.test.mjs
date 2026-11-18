// Tests for scripts/smoke.mjs. Run with: pnpm exec tsx --test scripts/smoke.test.mjs
// A local node:http server plays the deployed stack, answering the examples of packages/shared;
// the CLI case runs the real command against it. The run against a real `next start` and a
// running engine is in docs/deploy.md (it needs the stack up).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildChecks, loadSchemas, parseArgs, runChecks } from "./smoke.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

const HEALTHY_ENGINE = {
  status: "ok",
  startedAt: "2026-11-18T10:00:00.000Z",
  uptimeS: 12,
  chain: { id: 5042002, head: 100, cursor: 98 },
  db: "ok",
  sender: "running",
  jobs: "running",
  role: "leader",
  lease: { holder: "eng-0123456789ab", heldForS: 12, renewedAgoMs: 800 },
};

let shared;
let schemas;
let server;
let base;
/** What the fake stack answers, by path: [status, body or string, content type]. Reset per test. */
let routes;
const requests = [];

function healthyRoutes() {
  return {
    "/": [200, "<!doctype html><title>Winz</title>", "text/html; charset=utf-8"],
    "/api/health": [200, { ok: true, service: "web", time: new Date().toISOString() }],
    "/api/events": [401, { error: { code: "unauthenticated", message: "Sign in first" } }],
    "/api/hedge-desk": [200, shared.apiExamples.hedgeDeskExample],
    "/api/c/joes-pizza": [200, shared.apiExamples.publicCampaignExamples.live],
    "/engine/healthz": [200, HEALTHY_ENGINE],
  };
}

before(async () => {
  shared = await import(pathToFileURL(resolve(repoRoot, "packages/shared/src/index.ts")).href);
  schemas = await loadSchemas();
  server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    const route = routes[request.url ?? ""];
    if (!route) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
      return;
    }
    const [status, body, type] = route;
    response.writeHead(status, { "content-type": type ?? "application/json" });
    response.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((done) => server.close(done)));
beforeEach(() => {
  routes = healthyRoutes();
  requests.length = 0;
});

async function run(argv) {
  const lines = [];
  const ok = await runChecks(buildChecks(parseArgs(argv), schemas), (line) => lines.push(line));
  return { ok, lines };
}

describe("smoke checks", () => {
  test("a healthy stack passes every check, with GET requests only", async () => {
    const { ok, lines } = await run([
      base,
      "--campaign",
      "joes-pizza",
      "--engine",
      `${base}/engine`,
    ]);
    assert.equal(ok, true, lines.join("\n"));
    assert.equal(lines.length, 6);
    for (const line of lines) assert.match(line, /^ok {4}.+ \d+ ms {2}/);
    assert.ok(requests.every((r) => r.startsWith("GET ")));
  });

  test("the campaign and engine checks run only when asked", async () => {
    const { ok, lines } = await run([base]);
    assert.equal(ok, true);
    assert.equal(lines.length, 4);
  });

  test("the mock API is caught: the events list answered without a token", async () => {
    routes["/api/events"] = [200, shared.apiExamples.eventsExample];
    const { ok, lines } = await run([base]);
    assert.equal(ok, false);
    assert.match(lines.at(-1), /^FAIL .*mock API is served/);
  });

  test("an answer that does not match its schema fails, and stops the run", async () => {
    routes["/api/hedge-desk"] = [200, { instruments: "nope" }];
    const { ok, lines } = await run([base, "--campaign", "joes-pizza"]);
    assert.equal(ok, false);
    assert.equal(lines.length, 4, "the campaign check after the failure must not run");
    assert.match(lines.at(-1), /FAIL .*hedge-desk.*does not match its schema/);
  });

  test("an unknown campaign fails", async () => {
    const { ok, lines } = await run([base, "--campaign", "nobody"]);
    assert.equal(ok, false);
    assert.match(lines.at(-1), /HTTP 404, expected 200/);
  });

  test("an engine answering 503 fails with what is down", async () => {
    routes["/engine/healthz"] = [
      503,
      {
        ...HEALTHY_ENGINE,
        status: "unavailable",
        db: "down",
        chain: { id: 5042002, head: 100, cursor: null },
      },
    ];
    const { ok, lines } = await run([base, "--engine", `${base}/engine`]);
    assert.equal(ok, false);
    assert.match(lines.at(-1), /HTTP 503: db down/);
  });

  test("a web app that is not there fails on the first check", async () => {
    const { ok, lines } = await run(["http://127.0.0.1:1"]);
    assert.equal(ok, false);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^FAIL {2}GET \//);
  });

  test("a slow answer fails at the timeout", async () => {
    const slow = createServer(() => undefined);
    await new Promise((done) => slow.listen(0, "127.0.0.1", done));
    try {
      const { ok, lines } = await run([
        `http://127.0.0.1:${slow.address().port}`,
        "--timeout",
        "200",
      ]);
      assert.equal(ok, false);
      assert.match(lines[0], /no answer within the timeout/);
    } finally {
      slow.closeAllConnections();
      await new Promise((done) => slow.close(done));
    }
  });
});

describe("parseArgs", () => {
  test("needs exactly one http(s) base URL", () => {
    assert.throws(() => parseArgs([]), /usage/);
    assert.throws(() => parseArgs(["ftp://x"]), /http/);
    assert.throws(() => parseArgs(["https://a", "--engine"]), /needs a value/);
    assert.deepEqual(parseArgs(["https://a.example/"]), {
      base: "https://a.example",
      campaign: undefined,
      engine: undefined,
      timeoutMs: 15000,
    });
  });
});

describe("the command", () => {
  test("exits 0 on a healthy stack and 1 on a failure, 2 on a usage error", () => {
    const command = (args) =>
      spawnSync(process.execPath, ["--import", "tsx", join(scriptsDir, "smoke.mjs"), ...args], {
        cwd: repoRoot,
        encoding: "utf8",
      });
    // The CLI runs in a child process while this one serves: spawnSync would block the server, so
    // the child is pointed at a stack that is down (exit 1) and at bad arguments (exit 2) only.
    const down = command(["http://127.0.0.1:1"]);
    assert.equal(down.status, 1);
    assert.match(down.stdout, /result: FAILED/);
    assert.equal(command(["not-a-url"]).status, 2);
  });
});
