/**
 * The client's time bounds (`ENGINE_DB_TIMEOUTS`): without them a query sent on a connection that
 * goes silent waits for good, which is how one stuck call froze the sale states on 19-20 November.
 */
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDb, ENGINE_DB_TIMEOUTS } from "./db";
import { TcpProxy } from "./leader/test-support";
import { createTestDatabase, type TestDatabase } from "./testing/postgres";

let database: TestDatabase;
const cleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.drop();
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Outcome = "pending" | "answered" | `rejected:${string}`;

async function outcomeAfter(query: Promise<unknown>, ms: number): Promise<Outcome> {
  return Promise.race([
    query.then(
      (): Outcome => "answered",
      (error: unknown): Outcome =>
        `rejected:${String((error as { code?: unknown }).code ?? "unknown")}`,
    ),
    new Promise<Outcome>((resolve) => setTimeout(() => resolve("pending"), ms)),
  ]);
}

describe("createDb's time bounds", () => {
  it("bounds every query, connection wait and cancel by default (30 s, 30 s, 5 s), idle connections 120 s", async () => {
    const db = createDb(database.url, { max: 1 });
    cleanups.push(() => db.end({ timeout: 1 }));
    expect(ENGINE_DB_TIMEOUTS).toEqual({
      queryTimeoutS: 30,
      queueTimeoutS: 30,
      cancelTimeoutS: 5,
      idleTimeoutS: 120,
      keepAliveS: 60,
    });
    expect(db.options).toMatchObject({
      query_timeout: 30,
      queue_timeout: 30,
      cancel_timeout: 5,
      idle_timeout: 120,
      keep_alive: 60,
    });
    // Postgres.js on its own bounds nothing: that is what the engine had.
    const bare = postgres(database.url, { max: 1 });
    cleanups.push(() => bare.end({ timeout: 1 }));
    expect(bare.options).toMatchObject({ query_timeout: 0, queue_timeout: 0 });
  });

  it("takes shorter bounds (tests), and refuses one that is not a positive number", async () => {
    const db = createDb(database.url, { max: 1, queryTimeoutS: 2, cancelTimeoutS: 1 });
    cleanups.push(() => db.end({ timeout: 1 }));
    expect(db.options).toMatchObject({ query_timeout: 2, cancel_timeout: 1, queue_timeout: 30 });
    expect(() => createDb(database.url, { queryTimeoutS: 0 })).toThrow(RangeError);
    expect(() => createDb(database.url, { cancelTimeoutS: Number.NaN })).toThrow(RangeError);
  });

  it("a connection that goes silent: the query is rejected and the next one is answered on a new connection", async () => {
    const proxy = await TcpProxy.start(Number(new URL(database.url).port));
    cleanups.push(() => proxy.close());
    const bounded = createDb(proxy.rewrite(database.url), {
      max: 1,
      queryTimeoutS: 0.5,
      cancelTimeoutS: 0.5,
    });
    // Postgres.js's defaults, the client before this change: the positive control.
    const unbounded = postgres(proxy.rewrite(database.url), { max: 1, onnotice: () => undefined });
    cleanups.push(() => unbounded.end({ timeout: 1 }));
    cleanups.push(() => bounded.end({ timeout: 1 }));
    cleanups.push(() => proxy.restore());
    await bounded`select 1`;
    await unbounded`select 1`;

    proxy.silenceOpen();
    const onBounded = bounded`select 1 as one`;
    const onUnbounded = unbounded`select 1 as one`;
    const [boundedOutcome, unboundedOutcome] = await Promise.all([
      outcomeAfter(onBounded, 3_000),
      outcomeAfter(onUnbounded, 3_000),
    ]);
    expect(unboundedOutcome).toBe("pending");
    expect(boundedOutcome).toBe("rejected:QUERY_TIMEOUT");

    // The silent connection was closed: the pool connects again and is answered.
    await expect(bounded<{ one: number }[]>`select 1 as one`).resolves.toEqual([{ one: 1 }]);
  });

  it("a transaction on a connection that goes silent is rejected too (its begin is bounded)", async () => {
    const proxy = await TcpProxy.start(Number(new URL(database.url).port));
    cleanups.push(() => proxy.close());
    const bounded = createDb(proxy.rewrite(database.url), {
      max: 1,
      queryTimeoutS: 0.5,
      cancelTimeoutS: 0.5,
    });
    cleanups.push(() => bounded.end({ timeout: 1 }));
    cleanups.push(() => proxy.restore());
    await bounded`select 1`;

    proxy.silenceOpen();
    const transaction = bounded.begin(async (tx) => tx`select 1 as one`);
    expect(await outcomeAfter(transaction, 3_000)).toMatch(/^rejected:/);
    await expect(
      bounded.begin(async (tx) => tx<{ one: number }[]>`select 1 as one`),
    ).resolves.toEqual([{ one: 1 }]);
  });
});
