/**
 * The lease store against a real Postgres: what each statement decides, on the database's clock;
 * two (and many) holders racing for it; and a seeded property test over acquisitions, renewals,
 * releases and expiries, checked against a model that reads only the database's times. The store
 * reads no process clock at all; the leaders' process clocks, stepped and held, are the subject of
 * leader.property.test.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDb, type Db } from "../db";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { LeaseConfigError } from "./errors";
import { ENGINE_LEASE_NAME, PgEngineLease, leaseIsFree, newHolderId, type LeaseRow } from "./lease";

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => {
  await database.drop();
});
afterEach(async () => {
  await database.db`delete from engine_lease`;
});

function lease(holder: string, ttlMs = 5_000, db: Db = database.db): PgEngineLease {
  return new PgEngineLease({ db, holder, ttlMs });
}

async function row(): Promise<LeaseRow | null> {
  return lease("eng-reader000000").read();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("PgEngineLease", () => {
  it("draws short opaque holder ids and refuses malformed ones", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newHolderId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^eng-[0-9a-f]{12}$/);
    expect(() => lease("Not An Id")).toThrow(LeaseConfigError);
    expect(() => lease("eng-0123456789ab", 0)).toThrow(LeaseConfigError);
  });

  it("acquires an absent lease, for ttl on the database's clock", async () => {
    const a = lease("eng-aaaaaaaaaaaa", 15_000);
    const result = await a.acquire();
    expect(result.acquired).toBe(true);
    if (!result.acquired) return;
    expect(result.lease.holder).toBe("eng-aaaaaaaaaaaa");
    expect(result.lease.acquiredAt).toEqual(result.lease.renewedAt);
    expect(result.lease.acquiredAt).toEqual(result.lease.dbNow);
    expect(result.lease.expiresAt.getTime() - result.lease.renewedAt.getTime()).toBe(15_000);
    expect(result.lease.releasedAt).toBeNull();
    const stored = await row();
    expect(stored).toMatchObject({ holder: "eng-aaaaaaaaaaaa", releasedAt: null });
    expect(stored?.expiresAt).toEqual(result.lease.expiresAt);
  });

  it("refuses a second holder while the lease is live, and says who holds it", async () => {
    await lease("eng-aaaaaaaaaaaa").acquire();
    const b = await lease("eng-bbbbbbbbbbbb").acquire();
    expect(b.acquired).toBe(false);
    expect(b.lease?.holder).toBe("eng-aaaaaaaaaaaa");
    expect((await row())?.holder).toBe("eng-aaaaaaaaaaaa");
    // The refused holder cannot renew or release it either.
    expect((await lease("eng-bbbbbbbbbbbb").renew()).renewed).toBe(false);
    expect(await lease("eng-bbbbbbbbbbbb").release()).toBeNull();
    expect((await row())?.releasedAt).toBeNull();
  });

  it("lets the holder acquire again, keeping when it first took the lease", async () => {
    const a = lease("eng-aaaaaaaaaaaa");
    const first = await a.acquire();
    await delay(20);
    const again = await a.acquire();
    expect(again.acquired).toBe(true);
    if (!first.acquired || !again.acquired) return;
    expect(again.lease.acquiredAt).toEqual(first.lease.acquiredAt);
    expect(again.lease.renewedAt.getTime()).toBeGreaterThan(first.lease.renewedAt.getTime());
  });

  it("renews only the holder's live lease, extending it by ttl from now", async () => {
    const a = lease("eng-aaaaaaaaaaaa", 2_000);
    await a.acquire();
    await delay(30);
    const renewed = await a.renew();
    expect(renewed.renewed).toBe(true);
    if (!renewed.renewed) return;
    expect(renewed.lease.renewedAt).toEqual(renewed.lease.dbNow);
    expect(renewed.lease.expiresAt.getTime() - renewed.lease.renewedAt.getTime()).toBe(2_000);
    expect(renewed.lease.renewedAt.getTime()).toBeGreaterThan(renewed.lease.acquiredAt.getTime());
  });

  it("lets another holder take an expired lease, and the old holder can no longer renew it", async () => {
    const a = lease("eng-aaaaaaaaaaaa", 150);
    const b = lease("eng-bbbbbbbbbbbb", 5_000);
    await a.acquire();
    // Before the expiry: refused. After it, on the database's clock: taken.
    expect((await b.acquire()).acquired).toBe(false);
    await delay(200);
    const taken = await b.acquire();
    expect(taken.acquired).toBe(true);
    if (!taken.acquired) return;
    expect(taken.lease.acquiredAt).toEqual(taken.lease.dbNow);
    const late = await a.renew();
    expect(late.renewed).toBe(false);
    expect(late.lease?.holder).toBe("eng-bbbbbbbbbbbb");
  });

  it("refuses the holder's own renewal once its lease has expired", async () => {
    const a = lease("eng-aaaaaaaaaaaa", 100);
    await a.acquire();
    await delay(150);
    const late = await a.renew();
    expect(late.renewed).toBe(false);
    expect(late.lease?.holder).toBe("eng-aaaaaaaaaaaa");
    if (late.lease !== null) expect(leaseIsFree(late.lease)).toBe(true);
    // Acquiring it again is allowed: nobody else took it. A new period starts.
    const again = await a.acquire();
    expect(again.acquired).toBe(true);
    if (again.acquired) expect(again.lease.acquiredAt).toEqual(again.lease.dbNow);
  });

  it("releases only the holder's lease, at once, and keeps the last holder on the row", async () => {
    const a = lease("eng-aaaaaaaaaaaa", 60_000);
    await a.acquire();
    const at = await a.release();
    expect(at).not.toBeNull();
    const released = await row();
    expect(released?.releasedAt).toEqual(at);
    expect(released?.holder).toBe("eng-aaaaaaaaaaaa");
    expect(released?.releasedAt).not.toBeNull();
    expect(released?.expiresAt).toEqual(released?.releasedAt);
    if (released !== null) expect(leaseIsFree(released)).toBe(true);
    // Released twice: nothing more. Renewed after its release: refused.
    expect(await a.release()).toBeNull();
    expect((await a.renew()).renewed).toBe(false);
    // A standby takes it at once, without waiting for the 60 s.
    const b = await lease("eng-bbbbbbbbbbbb").acquire();
    expect(b.acquired).toBe(true);
    expect((await row())?.releasedAt).toBeNull();
  });

  it("answers no row before any engine took the lease", async () => {
    expect(await row()).toBeNull();
    const renewed = await lease("eng-aaaaaaaaaaaa").renew();
    expect(renewed).toEqual({ renewed: false, lease: null });
    expect(await lease("eng-aaaaaaaaaaaa").release()).toBeNull();
  });

  it("keeps one row, under the one name", async () => {
    await lease("eng-aaaaaaaaaaaa").acquire();
    await expect(
      database.db`
        insert into engine_lease (name, holder, acquired_at, renewed_at, expires_at)
        values ('second', 'eng-bbbbbbbbbbbb', now(), now(), now() + interval '1 second')
      `,
    ).rejects.toThrow(/engine_lease_name_known/);
    const [count] = await database.db<
      { n: bigint }[]
    >`select count(*)::bigint as n from engine_lease`;
    expect(count?.n).toBe(1n);
    expect(ENGINE_LEASE_NAME).toBe("engine");
  });
});

// -------------------------------------------------------------------------------------------
// Races
// -------------------------------------------------------------------------------------------

/** A lease taken in two statements (read, then write): what the real one must not be. */
class ReadThenWriteLease {
  constructor(
    private readonly db: Db,
    readonly holder: string,
  ) {}

  async acquire(): Promise<boolean> {
    const [current] = await this.db<{ free: boolean }[]>`
      select (released_at is not null or expires_at <= clock_timestamp()) as free
      from engine_lease where name = 'engine'
    `;
    if (current !== undefined && !current.free) return false;
    // The window in which another engine reads the same thing.
    await this.db`select pg_sleep(0.05)`;
    await this.db`
      insert into engine_lease (name, holder, acquired_at, renewed_at, expires_at)
      values ('engine', ${this.holder}, clock_timestamp(), clock_timestamp(),
              clock_timestamp() + interval '5 seconds')
      on conflict (name) do update set holder = excluded.holder, acquired_at = excluded.acquired_at,
        renewed_at = excluded.renewed_at, expires_at = excluded.expires_at, released_at = null
    `;
    return true;
  }
}

describe("racing acquisitions", () => {
  const HOLDERS = 24;
  let pool: Db;

  beforeAll(() => {
    // One connection per holder: every acquisition really runs at the same time.
    pool = createDb(database.url, { max: HOLDERS });
  });
  afterAll(async () => {
    await pool.end({ timeout: 5 });
  });

  /** Sets the row up for a round: absent, expired, or released by a holder not racing. */
  async function prepare(kind: "absent" | "expired" | "released"): Promise<void> {
    await database.db`delete from engine_lease`;
    if (kind === "absent") return;
    await database.db`
      insert into engine_lease (name, holder, acquired_at, renewed_at, expires_at, released_at)
      values ('engine', 'eng-previous0000', now() - interval '1 minute', now() - interval '30 seconds',
              now() - interval '15 seconds',
              ${kind === "released" ? database.db`now() - interval '15 seconds'` : null})
    `;
  }

  it("lets exactly one of 24 holders win, round after round, from every starting row", async () => {
    const holders = Array.from({ length: HOLDERS }, (_, i) =>
      lease(`eng-race${i.toString().padStart(8, "0")}`, 5_000, pool),
    );
    for (let round = 0; round < 15; round += 1) {
      const kind = (["absent", "expired", "released"] as const)[round % 3] ?? "absent";
      await prepare(kind);
      const results = await Promise.all(holders.map((holder) => holder.acquire()));
      const winners = results.filter((result) => result.acquired);
      expect(winners, `round ${round.toString()} (${kind})`).toHaveLength(1);
      const stored = await row();
      expect(stored?.holder).toBe(winners[0]?.lease?.holder);
      // Every loser that saw a row saw the winner's, or the row as it was before the race.
      for (const result of results.filter((r) => !r.acquired)) {
        if (result.lease !== null) {
          expect([stored?.holder, "eng-previous0000"]).toContain(result.lease.holder);
        }
      }
    }
  });

  it("positive control: the same race finds two winners when the lease is read then written", async () => {
    const naive = Array.from(
      { length: 8 },
      (_, i) => new ReadThenWriteLease(pool, `eng-naive${i.toString().padStart(7, "0")}`),
    );
    let worst = 0;
    for (let round = 0; round < 3; round += 1) {
      await prepare("absent");
      const won = await Promise.all(naive.map((holder) => holder.acquire()));
      worst = Math.max(worst, won.filter(Boolean).length);
    }
    expect(worst).toBeGreaterThan(1);
  });
});

// -------------------------------------------------------------------------------------------
// Property: one holder at a time, whatever the interleaving
// -------------------------------------------------------------------------------------------

/** mulberry32: a small seeded generator, so a failing run can be replayed from its seed. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface ModelLease {
  holder: string;
  expiresAt: number;
  released: boolean;
}

/** A holder's grant, as the database reported it: [from, until) on the database's clock. */
interface Grant {
  holder: string;
  from: number;
  until: number;
}

describe("one holder at a time (seeded property)", () => {
  const TTL_MS = 120;
  const SEEDS = [1, 7, 42, 1_234, 99_991, 271_828];

  it.each(SEEDS)("seed %i: every answer matches the database-clock model", async (seed) => {
    const random = rng(seed);
    const holders = ["eng-propa0000000", "eng-propb0000000", "eng-propc0000000"].map((id) =>
      lease(id, TTL_MS),
    );
    let model: ModelLease | null = null;
    const grants: Grant[] = [];
    const ops: string[] = [];

    const grant = (holder: string, row: LeaseRow): void => {
      grants.push({ holder, from: row.dbNow.getTime(), until: row.expiresAt.getTime() });
    };
    const endGrants = (holder: string, at: number): void => {
      for (const g of grants) if (g.holder === holder && g.until > at) g.until = at;
    };

    for (let step = 0; step < 40; step += 1) {
      const which = Math.floor(random() * holders.length);
      const holder = holders[which];
      if (holder === undefined) continue;
      const roll = random();
      if (roll < 0.15) {
        // A step of the database's clock (real time passes).
        const ms = Math.floor(random() * TTL_MS * 1.5);
        ops.push(`wait ${ms.toString()}`);
        await delay(ms);
        continue;
      }
      if (roll < 0.55) {
        const result = await holder.acquire();
        ops.push(`${holder.holder} acquire -> ${String(result.acquired)}`);
        // The model decides on the time the statement read: its `dbNow`.
        const at = result.lease?.dbNow.getTime();
        if (result.acquired) {
          const before = model as ModelLease | null;
          const allowed =
            before === null ||
            before.holder === holder.holder ||
            before.released ||
            before.expiresAt <= result.lease.dbNow.getTime();
          expect(allowed, `seed ${seed.toString()}: ${ops.join("; ")}`).toBe(true);
          model = {
            holder: holder.holder,
            expiresAt: result.lease.expiresAt.getTime(),
            released: false,
          };
          grant(holder.holder, result.lease);
        } else {
          // Refused: the row (as it was) must have been another holder's live lease. Postgres
          // compared in microseconds (expires_at > now); a `Date` keeps milliseconds, truncated,
          // so the strict inequality reaches the test as `>=`.
          const seen = result.lease;
          if (seen !== null && at !== undefined) {
            expect(seen.holder).not.toBe(holder.holder);
            expect(seen.releasedAt).toBeNull();
            expect(seen.expiresAt.getTime()).toBeGreaterThanOrEqual(at);
          }
        }
        continue;
      }
      if (roll < 0.85) {
        const result = await holder.renew();
        ops.push(`${holder.holder} renew -> ${String(result.renewed)}`);
        const current = model as ModelLease | null;
        if (result.renewed) {
          const now = result.lease.dbNow.getTime();
          // `>=`: the database's strict `expires_at > now`, seen in truncated milliseconds.
          expect(
            current !== null &&
              current.holder === holder.holder &&
              !current.released &&
              current.expiresAt >= now,
            `seed ${seed.toString()}: ${ops.join("; ")}`,
          ).toBe(true);
          model = {
            holder: holder.holder,
            expiresAt: result.lease.expiresAt.getTime(),
            released: false,
          };
          grant(holder.holder, result.lease);
        } else if (result.lease !== null) {
          const now = result.lease.dbNow.getTime();
          const live =
            current !== null &&
            current.holder === holder.holder &&
            !current.released &&
            current.expiresAt > now;
          expect(live, `seed ${seed.toString()}: ${ops.join("; ")}`).toBe(false);
        } else {
          expect(current).toBeNull();
        }
        continue;
      }
      const releasedAt = await holder.release();
      ops.push(`${holder.holder} release -> ${String(releasedAt !== null)}`);
      const current = model as ModelLease | null;
      expect(releasedAt !== null).toBe(
        current !== null && current.holder === holder.holder && !current.released,
      );
      if (releasedAt !== null && current !== null) {
        const at = releasedAt.getTime();
        model = { ...current, released: true, expiresAt: Math.min(current.expiresAt, at) };
        endGrants(holder.holder, at);
      }
    }

    // On the database's clock, no two holders' grants ever overlapped.
    const sorted = [...grants].sort((a, b) => a.from - b.from);
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i];
        const b = sorted[j];
        if (a === undefined || b === undefined || a.holder === b.holder) continue;
        expect(
          b.from >= a.until,
          `seed ${seed.toString()}: ${a.holder} until ${a.until.toString()} overlaps ${b.holder} from ${b.from.toString()}`,
        ).toBe(true);
      }
    }
    // The run exercised the interesting cases: the lease went from one holder to another.
    expect(new Set(grants.map((g) => g.holder)).size).toBeGreaterThan(1);
  });

  it("concurrent bursts: whatever interleaves, grants of two holders never overlap", async () => {
    const random = rng(2_026);
    const pool = createDb(database.url, { max: 12 });
    try {
      const holders = Array.from({ length: 3 }, (_, i) =>
        lease(`eng-burst${i.toString().padStart(7, "0")}`, TTL_MS, pool),
      );
      const grants: Grant[] = [];
      const releases: { holder: string; at: number }[] = [];
      for (let round = 0; round < 30; round += 1) {
        const ops = holders.flatMap((holder) => {
          const roll = random();
          if (roll < 0.5) {
            return [
              holder.acquire().then((r) => {
                if (r.acquired) {
                  grants.push({
                    holder: holder.holder,
                    from: r.lease.dbNow.getTime(),
                    until: r.lease.expiresAt.getTime(),
                  });
                }
              }),
            ];
          }
          if (roll < 0.85) {
            return [
              holder.renew().then((r) => {
                if (r.renewed) {
                  grants.push({
                    holder: holder.holder,
                    from: r.lease.dbNow.getTime(),
                    until: r.lease.expiresAt.getTime(),
                  });
                }
              }),
            ];
          }
          return [
            holder.release().then((releasedAt) => {
              if (releasedAt !== null) {
                releases.push({ holder: holder.holder, at: releasedAt.getTime() });
              }
            }),
          ];
        });
        await Promise.all(ops);
        await delay(Math.floor(random() * TTL_MS));
      }
      // A release ends its holder's grants at the release time.
      for (const release of releases) {
        for (const g of grants) {
          if (g.holder === release.holder && g.from <= release.at && g.until > release.at) {
            g.until = release.at;
          }
        }
      }
      const sorted = [...grants].sort((a, b) => a.from - b.from);
      for (let i = 0; i < sorted.length; i += 1) {
        for (let j = i + 1; j < sorted.length; j += 1) {
          const a = sorted[i];
          const b = sorted[j];
          if (a === undefined || b === undefined || a.holder === b.holder) continue;
          expect(
            b.from >= a.until,
            `${a.holder} [${a.from}, ${a.until}) / ${b.holder} from ${b.from}`,
          ).toBe(true);
        }
      }
      expect(new Set(grants.map((g) => g.holder)).size).toBeGreaterThan(1);
    } finally {
      await pool.end({ timeout: 5 });
    }
  });
});
