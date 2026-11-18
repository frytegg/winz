/**
 * The proxy the lease tests put in front of Postgres. Its "stall" cut must make every query hang,
 * each time: the test of a stop stuck on a silent database is built on it, and a cut that lets
 * some queries fail fast instead makes that test pass or fail with the scheduler.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDb, type Db } from "../db";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { TcpProxy } from "./test-support";

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

/** What became of `query` after `ms`. */
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

async function proxied(max: number): Promise<{ proxy: TcpProxy; db: Db }> {
  const proxy = await TcpProxy.start(Number(new URL(database.url).port));
  const db = createDb(proxy.rewrite(database.url), { max });
  // Reverse order at cleanup: the proxy answers again, then the pool closes, then the proxy.
  cleanups.push(() => proxy.close());
  cleanups.push(() => db.end({ timeout: 1 }));
  cleanups.push(() => proxy.restore());
  return { proxy, db };
}

/** The connections of the proxied pools as the database sees them. */
async function backends(applicationName: string): Promise<number> {
  const [row] = await database.db<{ n: number }[]>`
    select count(*)::int as n from pg_stat_activity where application_name = ${applicationName}
  `;
  return row?.n ?? -1;
}

describe("TcpProxy", () => {
  it("stall: every query hangs, on the connections open at the cut and on new ones, 40 out of 40", async () => {
    const { proxy, db } = await proxied(4);
    // Four connections open and idle at the cut.
    await Promise.all(Array.from({ length: 4 }, () => db`select pg_sleep(0.05)`));

    await proxy.cut("stall");
    // 4 queries go out on the open connections; the rest wait in the pool's queue behind them.
    const onOpen = Array.from({ length: 20 }, () => db`select 1`);
    // A second pool, opened after the cut: its connections are accepted and never answered.
    const fresh = createDb(proxy.rewrite(database.url), { max: 4 });
    cleanups.push(() => fresh.end({ timeout: 1 }));
    const onNew = Array.from({ length: 20 }, () => fresh`select 1`);

    const outcomes = await Promise.all([...onOpen, ...onNew].map((q) => outcomeAfter(q, 1_500)));
    expect(outcomes.filter((outcome) => outcome !== "pending")).toEqual([]);

    // Restored: what was waiting on a held connection fails, and a new query is answered.
    await proxy.restore();
    const after = await Promise.all(onOpen.slice(0, 4).map((q) => outcomeAfter(q, 5_000)));
    expect(after.filter((outcome) => outcome === "pending")).toEqual([]);
    expect(after.filter((outcome) => outcome === "answered")).toEqual([]);
    await expect(db`select 1 as one`).resolves.toEqual([{ one: 1 }]);
    // The queries left behind never reached the database: they must not reject unhandled later.
    for (const query of [...onOpen, ...onNew]) query.catch(() => undefined);
  }, 30_000);

  it("stall: the database's side of each connection is closed, so nothing it held stays locked", async () => {
    const { proxy, db: plain } = await proxied(1);
    await plain.end({ timeout: 1 });
    const name = `proxy-stall-${process.pid}`;
    const url = new URL(proxy.rewrite(database.url));
    url.searchParams.set("application_name", name);
    const db = createDb(url.toString(), { max: 3 });
    cleanups.push(() => db.end({ timeout: 1 }));
    await database.db`create table if not exists proxy_stall_probe (id int primary key)`;
    await database.db`insert into proxy_stall_probe values (1) on conflict do nothing`;

    // A transaction holding a row lock, left open at the cut.
    let cut: () => void = () => undefined;
    const untilCut = new Promise<void>((resolve) => (cut = resolve));
    let locked: () => void = () => undefined;
    const hasLock = new Promise<void>((resolve) => (locked = resolve));
    const holder = db
      .begin(async (tx) => {
        await tx`select id from proxy_stall_probe where id = 1 for update`;
        locked();
        await untilCut;
        await tx`select 1`;
      })
      .catch(() => undefined);
    await hasLock;
    expect(await backends(name)).toBeGreaterThanOrEqual(1);

    await proxy.cut("stall");
    cut();
    const deadline = Date.now() + 5_000;
    while ((await backends(name)) > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(await backends(name)).toBe(0);
    // The row is free for anybody else, at once.
    await expect(
      database.db`select id from proxy_stall_probe where id = 1 for update nowait`,
    ).resolves.toHaveLength(1);

    await proxy.restore();
    await holder;
    await database.db`drop table proxy_stall_probe`;
  }, 30_000);

  it("refuse: every query fails fast, and the pool works again once restored", async () => {
    const { proxy, db } = await proxied(2);
    await db`select 1`;
    await proxy.cut("refuse");
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => outcomeAfter(db`select 1`, 5_000)),
    );
    expect(outcomes.filter((outcome) => !outcome.startsWith("rejected:"))).toEqual([]);
    await proxy.restore();
    // The proxy listens again on the same port: a pool opened now is answered at once. (The
    // pool that was refused comes back by itself, after the client's own backoff.)
    const fresh = createDb(proxy.rewrite(database.url), { max: 1 });
    cleanups.push(() => fresh.end({ timeout: 1 }));
    await expect(fresh`select 1 as one`).resolves.toEqual([{ one: 1 }]);
  }, 40_000);
});
