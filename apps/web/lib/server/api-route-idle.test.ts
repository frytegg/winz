import { randomBytes } from "node:crypto";

import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";

import { GET as getHedgeDesk } from "@/app/api/hedge-desk/route";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import { apiRoute, setAfterResponseForTesting } from "./api-route";
import { IDLE_CLOSE_MARGIN_MS, createWebDb, type Db } from "./db";
import { setServerDepsForTesting } from "./deps";
import { FakeIdentity, serverDepsFor } from "./testing/fixtures";

// What a deployed instance does after each response: keep itself awake (next's `after`, i.e. the
// platform's waitUntil) until the client has closed the connections it no longer uses. Here the
// hook is replaced by one that records the task, and the test runs it once the response is out,
// as `after` does, then counts the connections on the test database.

const IDLE_TIMEOUT_S = 1;
const BOUND_MS = IDLE_TIMEOUT_S * 1000 + IDLE_CLOSE_MARGIN_MS;
const noParams = { params: Promise.resolve({}) };

describe("apiRoute keeps the instance awake until its connections are closed", () => {
  let database: TestDatabase;
  let admin: Db;
  let db: Db;
  let application: string;
  let scheduled: (() => Promise<void>)[];

  beforeAll(async () => {
    database = await createTestDatabase();
    admin = postgres(inject("pgAdminUrl"), { max: 1, onnotice: () => undefined });
  });
  afterAll(async () => {
    setAfterResponseForTesting(undefined);
    setServerDepsForTesting(undefined);
    await admin.end();
    await database.drop();
  });

  beforeEach(() => {
    application = `route-${randomBytes(4).toString("hex")}`;
    db = createWebDb(`${database.url}?application_name=${application}`, {
      max: 3,
      idleTimeoutS: IDLE_TIMEOUT_S,
    });
    setServerDepsForTesting(serverDepsFor(db, new FakeIdentity(), new Date()));
    scheduled = [];
    setAfterResponseForTesting((task) => {
      scheduled.push(task);
    });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.end({ timeout: 1 });
  });

  async function openConnections(): Promise<number> {
    const [row] = await admin<{ count: number }[]>`
      select count(*)::int as count from pg_stat_activity where application_name = ${application}
    `;
    return row?.count ?? 0;
  }

  /** The server sees a backend go a few ms after the client's goodbye. */
  async function closedWithin(ms: number): Promise<boolean> {
    const until = performance.now() + ms;
    while (performance.now() < until) {
      if ((await openConnections()) === 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return (await openConnections()) === 0;
  }

  it("after a response, the connections are closed within the bound", async () => {
    const response = await getHedgeDesk(new Request("http://localhost/api/hedge-desk"), noParams);
    expect(response.status).toBe(200);
    expect(scheduled).toHaveLength(1);
    // Positive control: the route left connections open (the hedge desk reads in parallel).
    expect(await openConnections()).toBeGreaterThan(0);

    const started = performance.now();
    await scheduled[0]?.();
    expect(performance.now() - started).toBeLessThan(BOUND_MS);
    expect(db.stats.connections).toBe(0);
    expect(await closedWithin(500)).toBe(true);
  });

  it("a burst of requests shares one wait instead of one per request", async () => {
    const waits: Promise<void>[] = [];
    let lastResponseAt = 0;
    await Promise.all(
      Array.from({ length: 10 }, async () => {
        const response = await getHedgeDesk(
          new Request("http://localhost/api/hedge-desk"),
          noParams,
        );
        expect(response.status).toBe(200);
        lastResponseAt = performance.now();
        // As `after` does: the task runs once its own response is out.
        const task = scheduled.shift();
        if (task) waits.push(task());
      }),
    );
    expect(waits).toHaveLength(10);
    expect(new Set(waits).size).toBe(1);
    expect(await openConnections()).toBeGreaterThan(0);

    await Promise.all(waits);
    // One wait after the last response, not ten after one another.
    expect(performance.now() - lastResponseAt).toBeLessThan(BOUND_MS);
    expect(db.stats.connections).toBe(0);
    expect(await closedWithin(500)).toBe(true);
  });

  it("a route that fails still releases its connections", async () => {
    const failing = apiRoute("hedgeDesk", async (_context, deps) => {
      await Promise.all([deps.db`select pg_sleep(0.05)`, deps.db`select pg_sleep(0.05)`]);
      throw new Error("the implementation broke after reading");
    });
    const response = await failing(new Request("http://localhost/api/hedge-desk"), noParams);
    expect(response.status).toBe(500);
    expect(scheduled).toHaveLength(1);
    expect(await openConnections()).toBe(2);

    await scheduled[0]?.();
    expect(db.stats.connections).toBe(0);
    expect(await closedWithin(500)).toBe(true);
  });

  it("a request refused by authentication is followed by the wait too", async () => {
    const response = await apiRoute("events", () => ({ events: [] }))(
      new Request("http://localhost/api/events"),
      noParams,
    );
    expect(response.status).toBe(401);
    expect(scheduled).toHaveLength(1);
    await scheduled[0]?.();
  });

  it("schedules nothing in mock mode, nor for a route without an implementation", async () => {
    vi.stubEnv("APP_API_MOCK", "true");
    expect(
      (await getHedgeDesk(new Request("http://localhost/api/hedge-desk"), noParams)).status,
    ).toBe(200);
    vi.unstubAllEnvs();
    const unimplemented = apiRoute("quicknodeWebhook");
    expect(
      (
        await unimplemented(
          new Request("http://localhost/api/webhooks/quicknode", { method: "POST", body: "{}" }),
          noParams,
        )
      ).status,
    ).toBe(501);
    expect(scheduled).toHaveLength(0);
  });

  it("costs nothing where no platform freezes the process: no hook, no wait", async () => {
    setAfterResponseForTesting(undefined);
    vi.stubEnv("VERCEL", undefined);
    const started = performance.now();
    const response = await getHedgeDesk(new Request("http://localhost/api/hedge-desk"), noParams);
    expect(response.status).toBe(200);
    expect(performance.now() - started).toBeLessThan(BOUND_MS);
    expect(scheduled).toHaveLength(0);
  });

  it("on Vercel but outside a request scope (next's after throws), the answer is unchanged", async () => {
    setAfterResponseForTesting(undefined);
    vi.stubEnv("VERCEL", "1");
    const response = await getHedgeDesk(new Request("http://localhost/api/hedge-desk"), noParams);
    expect(response.status).toBe(200);
  });
});
