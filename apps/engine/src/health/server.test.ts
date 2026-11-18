import { createServer } from "node:net";

import pino from "pino";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "../db";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import {
  HealthConfigError,
  healthPortFromEnv,
  healthReportSchema,
  readHealth,
  startHealthServer,
  type HealthReport,
  type HealthServer,
  type HealthSources,
} from "./server";

const silent = pino({ level: "silent" });
const CURSOR = "escrow-logs:0x00000000000000000000000000000000000000e5";

/** True when nothing listens on `port` any more: binding it succeeds. */
function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

describe("healthPortFromEnv", () => {
  it("is off without PORT, and with an empty one", () => {
    expect(healthPortFromEnv({})).toBeUndefined();
    expect(healthPortFromEnv({ PORT: "" })).toBeUndefined();
  });

  it("reads a port", () => {
    expect(healthPortFromEnv({ PORT: "8080" })).toBe(8080);
  });

  it("refuses a malformed port, naming the variable", () => {
    expect(() => healthPortFromEnv({ PORT: "eighty" })).toThrow(HealthConfigError);
    expect(() => healthPortFromEnv({ PORT: "70000" })).toThrow(/PORT/);
  });
});

describe("GET /healthz", () => {
  let database: TestDatabase;
  let server: HealthServer | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.db`insert into chain_cursor (name, block_number) values (${CURSOR}, 4200)`;
  });
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });
  afterAll(async () => {
    await database.drop();
  });

  function sources(overrides: Partial<HealthSources> = {}): HealthSources {
    return {
      db: database.db,
      chain: { getBlockNumber: () => Promise.resolve(4_321n) },
      chainId: 5_042_002,
      cursorName: CURSOR,
      startedAt: new Date("2026-11-18T10:00:00.000Z"),
      services: () => ({ sender: "running", jobs: "running" }),
      now: () => Date.parse("2026-11-18T10:01:05.900Z"),
      timeoutMs: 1_000,
      ...overrides,
    };
  }

  async function get(
    options: Partial<HealthSources>,
    path = "/healthz",
  ): Promise<{ status: number; body: unknown }> {
    server = await startHealthServer({
      ...sources(options),
      port: 0,
      host: "127.0.0.1",
      logger: silent,
    });
    const response = await fetch(`http://127.0.0.1:${server.port.toString()}${path}`);
    return { status: response.status, body: await response.json() };
  }

  it("answers 200 with the expected shape and nothing else", async () => {
    const { status, body } = await get({});
    expect(status).toBe(200);
    const expected: HealthReport = {
      status: "ok",
      startedAt: "2026-11-18T10:00:00.000Z",
      uptimeS: 65,
      chain: { id: 5_042_002, head: 4321, cursor: 4200 },
      db: "ok",
      sender: "running",
      jobs: "running",
    };
    expect(body).toStrictEqual(expected);
    expect(healthReportSchema.safeParse(body).success).toBe(true);
  });

  it("reports a null cursor before the event reader stored one", async () => {
    const { status, body } = await get({ cursorName: "escrow-logs:none" });
    expect(status).toBe(200);
    expect((body as HealthReport).chain.cursor).toBeNull();
  });

  it("answers 503 when the database cannot be reached", async () => {
    // Nothing listens on port 1: every connection is refused.
    const down = createDb("postgres://nobody@127.0.0.1:1/none", { max: 1 });
    try {
      const { status, body } = await get({ db: down });
      expect(status).toBe(503);
      expect(healthReportSchema.safeParse(body).success).toBe(true);
      expect(body).toMatchObject({
        status: "unavailable",
        db: "down",
        chain: { head: 4321, cursor: null },
      });
    } finally {
      await down.end({ timeout: 1 });
    }
  });

  it("answers 503 within the timeout when the node does not answer", async () => {
    const started = Date.now();
    const { status, body } = await get({
      chain: { getBlockNumber: () => new Promise<bigint>(() => undefined) },
      timeoutMs: 200,
    });
    expect(status).toBe(503);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(body).toMatchObject({
      status: "unavailable",
      db: "ok",
      chain: { head: null, cursor: 4200 },
    });
  });

  it("answers 503 when the node refuses", async () => {
    const { status } = await get({
      chain: { getBlockNumber: () => Promise.reject(new Error("connection refused")) },
    });
    expect(status).toBe(503);
  });

  it("answers 503 while the engine stops", async () => {
    const { status, body } = await get({
      services: () => ({ sender: "stopped", jobs: "stopped" }),
    });
    expect(status).toBe(503);
    expect(body).toMatchObject({ sender: "stopped", jobs: "stopped", db: "ok" });
  });

  it("answers 404 on any other path", async () => {
    const { status } = await get({}, "/");
    expect(status).toBe(404);
  });

  it("never answers a key's address, an e-mail or a URL", async () => {
    const { body } = await get({});
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/0x[0-9a-fA-F]{40}/);
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/:\/\//);
  });

  it("frees its port once stopped, even with a connection kept alive", async () => {
    const running = await startHealthServer({
      ...sources(),
      port: 0,
      host: "127.0.0.1",
      logger: silent,
    });
    const response = await fetch(`http://127.0.0.1:${running.port.toString()}/healthz`, {
      headers: { connection: "keep-alive" },
    });
    expect(response.status).toBe(200);
    await response.text();
    expect(await portIsFree(running.port)).toBe(false);
    await running.close();
    expect(await portIsFree(running.port)).toBe(true);
  });

  it("refuses to start on a port already taken", async () => {
    const first = await startHealthServer({
      ...sources(),
      port: 0,
      host: "127.0.0.1",
      logger: silent,
    });
    try {
      await expect(
        startHealthServer({ ...sources(), port: first.port, host: "127.0.0.1", logger: silent }),
      ).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await first.close();
    }
  });

  it("reads the same report without a listener", async () => {
    const { httpStatus, report } = await readHealth(sources());
    expect(httpStatus).toBe(200);
    expect(report.chain).toStrictEqual({ id: 5_042_002, head: 4321, cursor: 4200 });
  });
});
