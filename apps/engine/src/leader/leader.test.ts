/**
 * The leader against a real Postgres, with services that only record when they run: standby,
 * handover on a clean stop, takeover after a crash (after the ttl, not before), self-fencing
 * before the lease expires on the database's clock, a stolen lease, a failed start. The same
 * scenarios with the real `startEngine` are in leader.e2e.test.ts.
 */
import { getEventListeners } from "node:events";
import { performance } from "node:perf_hooks";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { capturingLogger, type LogEntry } from "../chain/ingest-test-support";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { LeaseConfigError } from "./errors";
import {
  EngineLeader,
  fenceOverrunSlackMs,
  type FenceOverrun,
  type LeaderServices,
} from "./leader";
import { PgEngineLease, type LeaseRow } from "./lease";
import { fenceAfterMs, resolveLeaseSettings, type LeaseSettings } from "./settings";
import { FaultyLease, ServiceLog } from "./test-support";

const SETTINGS: LeaseSettings = {
  ttlMs: 1_500,
  renewMs: 150,
  standbyPollMs: 50,
  fenceMarginMs: 600,
};

let database: TestDatabase;
const leaders: EngineLeader[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => {
  await database.drop();
});
afterEach(async () => {
  for (const leader of leaders.splice(0)) await leader.stop();
  await database.db`delete from engine_lease`;
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dbNow(): Promise<number> {
  const [row] = await database.db<{ t: Date }[]>`select clock_timestamp() as t`;
  if (row === undefined) throw new Error("no time");
  return row.t.getTime();
}

async function leaseRow(): Promise<LeaseRow | null> {
  return new PgEngineLease({ db: database.db, holder: "eng-reader000000", ttlMs: 1_000 }).read();
}

async function until(
  what: string,
  condition: () => boolean | Promise<boolean>,
  ms = 5_000,
): Promise<void> {
  const deadline = performance.now() + ms;
  while (!(await condition())) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await delay(10);
  }
}

interface Engine {
  name: string;
  leader: EngineLeader;
  lease: FaultyLease;
  logs: LogEntry[];
  /** The database's time just after each stop of its services completed. */
  stoppedAtDb: number[];
}

function engine(
  name: string,
  log: ServiceLog,
  options: {
    stopMs?: number;
    startFails?: boolean;
    settings?: LeaseSettings;
    onFenceOverrun?: (overrun: FenceOverrun) => void;
  } = {},
): Engine {
  const holder = `eng-${name.padEnd(12, "0")}`;
  const settings = options.settings ?? SETTINGS;
  const lease = new FaultyLease(
    new PgEngineLease({ db: database.db, holder, ttlMs: settings.ttlMs }),
  );
  const { logger, entries } = capturingLogger();
  const stoppedAtDb: number[] = [];
  const startServices = async (signal: AbortSignal): Promise<LeaderServices> => {
    if (options.startFails === true) throw new Error("the node answers another chain id");
    log.record(name, "start");
    return {
      stopped: new Promise<void>((resolve) => {
        const stop = (): void => {
          setTimeout(() => {
            log.record(name, "stopped");
            void dbNow().then((t) => {
              stoppedAtDb.push(t);
              resolve();
            });
          }, options.stopMs ?? 20);
        };
        if (signal.aborted) stop();
        else signal.addEventListener("abort", stop, { once: true });
      }),
    };
  };
  const leader = new EngineLeader({
    lease,
    settings,
    logger,
    startServices,
    ...(options.onFenceOverrun === undefined ? {} : { onFenceOverrun: options.onFenceOverrun }),
  });
  leaders.push(leader);
  return { name, leader, lease, logs: entries, stoppedAtDb };
}

function messages(logs: LogEntry[]): string[] {
  return logs.map((entry) => String(entry.msg));
}

describe("lease settings", () => {
  it("accepts the defaults and refuses a renewal not well under the ttl", () => {
    expect(
      resolveLeaseSettings({
        ttlMs: 15_000,
        renewMs: 3_000,
        standbyPollMs: 1_000,
        fenceMarginMs: 5_000,
      }),
    ).toMatchObject({ ttlMs: 15_000 });
    expect(
      fenceAfterMs({ ttlMs: 15_000, renewMs: 3_000, standbyPollMs: 1_000, fenceMarginMs: 5_000 }),
    ).toBe(10_000);
    expect(() =>
      resolveLeaseSettings({
        ttlMs: 15_000,
        renewMs: 4_000,
        standbyPollMs: 1_000,
        fenceMarginMs: 5_000,
      }),
    ).toThrow(LeaseConfigError);
    expect(() =>
      resolveLeaseSettings({
        ttlMs: 5_000,
        renewMs: 100,
        standbyPollMs: 100,
        fenceMarginMs: 5_000,
      }),
    ).toThrow(/above the fence margin/);
    expect(() =>
      resolveLeaseSettings({
        ttlMs: 15_000,
        renewMs: 1.5,
        standbyPollMs: 100,
        fenceMarginMs: 5_000,
      }),
    ).toThrow(/positive integer/);
  });
});

describe("EngineLeader", () => {
  it("starts as a standby that runs nothing while another engine holds the lease", async () => {
    const log = new ServiceLog();
    // Another engine's live lease, written as its process would have.
    await database.db`
      insert into engine_lease (name, holder, acquired_at, renewed_at, expires_at)
      values ('engine', 'eng-other0000000', now(), now(), now() + interval '1 hour')
    `;
    const b = engine("b", log);
    void b.leader.run();
    await until("a first look at the lease", () => b.leader.phase === "standby");
    await delay(300);
    expect(log.starts("b")).toBe(0);
    expect(b.leader.servicesRunning()).toBe(false);
    const view = b.leader.view();
    expect(view).toMatchObject({ role: "standby", holder: "eng-other0000000" });
    expect(view.heldForMs).toBeGreaterThanOrEqual(0);
    expect(view.renewedAgoMs).toBeGreaterThanOrEqual(0);
    expect(messages(b.logs)).toContain("standby: the lease is held by another engine");
    // A standby stops at once.
    const started = performance.now();
    await b.leader.stop();
    expect(performance.now() - started).toBeLessThan(200);
    expect((await leaseRow())?.holder).toBe("eng-other0000000");
  });

  it("takes a free lease at once, runs the services and renews the lease", async () => {
    const log = new ServiceLog();
    const a = engine("a", log);
    void a.leader.run();
    await until("a leading", () => a.leader.servicesRunning(), 1_000);
    expect(log.starts("a")).toBe(1);
    const first = await leaseRow();
    await delay(SETTINGS.renewMs * 3);
    const later = await leaseRow();
    expect(later?.holder).toBe(a.leader.holder);
    expect(later?.acquiredAt).toEqual(first?.acquiredAt);
    expect(later?.renewedAt.getTime()).toBeGreaterThan(first?.renewedAt.getTime() ?? Infinity);
    expect(a.leader.view()).toMatchObject({ role: "leader", holder: a.leader.holder });
    expect(a.leader.view().renewedAgoMs).toBeLessThanOrEqual(SETTINGS.renewMs + 100);
  });

  it("hands over on a clean stop: services stopped, then the lease released, then the standby works", async () => {
    const log = new ServiceLog();
    const a = engine("a", log, { stopMs: 200 });
    const b = engine("b", log);
    void a.leader.run();
    await until("a leading", () => a.leader.servicesRunning());
    void b.leader.run();
    await until("b standing by", () => b.leader.phase === "standby");

    const stopAt = performance.now();
    const stopping = a.leader.stop();
    // While A's services stop, A keeps the lease: B does not start.
    await delay(100);
    expect(log.running()).toEqual(["a"]);
    await stopping;
    // The release is read from A's own log line, which carries what the releasing statement
    // returned (the holder, and the database's time of the release), not from the lease row
    // afterwards: the standby polls every 50 ms, so by the time a read of the row returns B may
    // already hold it (seen in CI: the row read here was B's).
    const releasedLine = a.logs.find((entry) => entry.msg === "lease released");
    expect(releasedLine).toMatchObject({ holder: "eng-a00000000000", released: true });
    const releasedAtMs = Date.parse(String(releasedLine?.releasedAt));
    expect(Number.isNaN(releasedAtMs)).toBe(false);
    // Services stopped (database time) before the release.
    expect(a.stoppedAtDb[0]).toBeLessThanOrEqual(releasedAtMs);
    const order = messages(a.logs);
    expect(order.indexOf("engine services stopped")).toBeLessThan(order.indexOf("lease released"));

    await until("b leading", () => b.leader.servicesRunning(), 2_000);
    expect(performance.now() - stopAt).toBeLessThan(2_000);
    // The row is now B's, taken after A's release and not before.
    const taken = await leaseRow();
    expect(taken?.holder).toBe("eng-b00000000000");
    expect(taken?.releasedAt).toBeNull();
    expect(taken?.acquiredAt.getTime()).toBeGreaterThanOrEqual(releasedAtMs);
    log.assertAtMostOne();
  });

  it("after a crash (no renewal, no release), the standby takes over after the ttl, not before", async () => {
    const log = new ServiceLog();
    const a = engine("a", log);
    const b = engine("b", log);
    void a.leader.run();
    await until("a leading", () => a.leader.servicesRunning());
    void b.leader.run();
    await until("b standing by", () => b.leader.phase === "standby");
    await delay(SETTINGS.renewMs * 2);

    // A's database calls all fail from now on: it renews nothing and releases nothing.
    a.lease.dead = true;
    const lastGrant = await leaseRow();
    expect(lastGrant?.holder).toBe(a.leader.holder);
    const expiresAt = lastGrant?.expiresAt.getTime() ?? 0;

    await until("b leading", () => b.leader.servicesRunning(), SETTINGS.ttlMs * 3);
    const taken = await leaseRow();
    expect(taken?.holder).toBe(b.leader.holder);
    // B's lease began at or after A's last expiry, on the database's clock.
    expect(taken?.acquiredAt.getTime()).toBeGreaterThanOrEqual(expiresAt);
    // A had fenced itself before that expiry.
    expect(a.stoppedAtDb[0]).toBeLessThan(expiresAt);
    log.assertAtMostOne();
  });

  it("fences itself before the lease expires when renewals hang, then leads again", async () => {
    const log = new ServiceLog();
    const a = engine("a", log, { stopMs: 100 });
    void a.leader.run();
    await until("a leading", () => a.leader.servicesRunning());
    await delay(SETTINGS.renewMs * 2);
    a.lease.freeze();
    const frozenAt = performance.now();
    const lastGrant = await leaseRow();
    const expiresAt = lastGrant?.expiresAt.getTime() ?? 0;

    await until("a fenced", () => a.stoppedAtDb.length === 1, SETTINGS.ttlMs * 2);
    const fencedAfter = performance.now() - frozenAt;
    // Not before the fence deadline (minus the renewal it had just made), and before the expiry.
    expect(fencedAfter).toBeGreaterThanOrEqual(fenceAfterMs(SETTINGS) - SETTINGS.renewMs * 2 - 50);
    expect(a.stoppedAtDb[0]).toBeLessThan(expiresAt);
    expect(a.leader.phase).toBe("standby");
    const error = a.logs.find(
      (entry) =>
        entry.msg ===
        "the engine lease could not be renewed in time: stopping the engine's services before it expires",
    );
    expect(error?.level).toBe(50);
    expect(messages(a.logs)).toContain(
      "engine services stopped by the lease fence: back to standby",
    );

    // The database answers again: A takes the lease again and works.
    a.lease.unfreeze();
    await until("a leading again", () => a.leader.servicesRunning(), 3_000);
    expect(log.starts("a")).toBe(2);
    log.assertAtMostOne();
  });

  it("declares a fenced stop that hangs before the lease can expire, and never otherwise", async () => {
    const log = new ServiceLog();
    const overruns: { overrun: FenceOverrun; atDb: number }[] = [];
    // Its services take 3 s to stop: far beyond the 600 ms margin.
    const a = engine("a", log, {
      stopMs: 3_000,
      onFenceOverrun: (overrun) => {
        void dbNow().then((atDb) => overruns.push({ overrun, atDb }));
      },
    });
    void a.leader.run();
    await until("a leading", () => a.leader.servicesRunning());
    await delay(SETTINGS.renewMs * 2);
    a.lease.freeze();
    const expiresAt = (await leaseRow())?.expiresAt.getTime() ?? 0;
    await until("the overrun", () => overruns.length === 1, SETTINGS.ttlMs * 2);
    expect(overruns[0]?.overrun).toMatchObject({ holder: a.leader.holder, reason: "expired" });
    expect(overruns[0]?.atDb).toBeLessThan(expiresAt);
    expect(expiresAt - (overruns[0]?.atDb ?? 0)).toBeLessThanOrEqual(
      fenceOverrunSlackMs(SETTINGS) + 150,
    );
    expect(a.logs.find((entry) => entry.level === 60)?.msg).toBe(
      "the engine's services did not stop before the lease can expire: a service is stuck",
    );
    a.lease.unfreeze();
  });

  it("positive control: a fenced stop within the margin is never declared stuck", async () => {
    const log = new ServiceLog();
    const overruns: FenceOverrun[] = [];
    const a = engine("a", log, {
      stopMs: 100,
      onFenceOverrun: (overrun) => overruns.push(overrun),
    });
    void a.leader.run();
    await until("a leading", () => a.leader.servicesRunning());
    a.lease.freeze();
    await until("a fenced", () => a.stoppedAtDb.length === 1, SETTINGS.ttlMs * 2);
    await delay(SETTINGS.ttlMs);
    expect(overruns).toEqual([]);
    a.lease.unfreeze();
  });

  it("stops at once when the lease is found in another holder's name", async () => {
    const log = new ServiceLog();
    const a = engine("a", log);
    void a.leader.run();
    await until("a leading", () => a.leader.servicesRunning());
    const stolenAt = performance.now();
    await database.db`
      update engine_lease set holder = 'eng-thief0000000', acquired_at = now(), renewed_at = now(),
        expires_at = now() + interval '1 hour'
    `;
    await until("a stopped", () => a.stoppedAtDb.length === 1, SETTINGS.ttlMs);
    // At the next renewal, well before the fence deadline.
    expect(performance.now() - stolenAt).toBeLessThan(SETTINGS.renewMs * 2 + 200);
    expect(performance.now() - stolenAt).toBeLessThan(fenceAfterMs(SETTINGS));
    const error = a.logs.find(
      (entry) =>
        entry.msg ===
        "the engine lease is held by another engine: this engine stops its services at once",
    );
    expect(error).toMatchObject({
      level: 50,
      holder: a.leader.holder,
      otherHolder: "eng-thief0000000",
    });
    // Back to standby: it never takes a live lease from its holder.
    await delay(300);
    expect(a.leader.phase).toBe("standby");
    expect(log.starts("a")).toBe(1);
    expect((await leaseRow())?.holder).toBe("eng-thief0000000");
  });

  it("counts a late renewal answer from when it was sent: fenced before the lease it stamped expires", async () => {
    const log = new ServiceLog();
    const a = engine("a", log);
    void a.leader.run();
    await until("a leading", () => a.leader.servicesRunning());
    await delay(SETTINGS.renewMs * 2);
    // The next renewal is applied by the database, its answer arrives 700 ms later, and the
    // database is gone from the moment it applied it.
    const stamped = await a.lease.answerNextRenewalLate(700);
    const expiresAt = stamped.expiresAt.getTime();
    await until("a fenced", () => a.stoppedAtDb.length === 1, SETTINGS.ttlMs * 2);
    // Counted from its arrival, the renewal would move the fence 700 ms later: past the expiry
    // (fence after 900 ms, ttl 1 500 ms).
    expect(a.stoppedAtDb[0]).toBeLessThan(expiresAt);
    expect(messages(a.logs)).toContain(
      "the engine lease could not be renewed in time: stopping the engine's services before it expires",
    );
    a.lease.dead = false;
  });

  it("stops at once when a renewal finds its own lease expired on the database", async () => {
    const log = new ServiceLog();
    const a = engine("a", log);
    void a.leader.run();
    await until("a leading", () => a.leader.servicesRunning());
    await delay(SETTINGS.renewMs * 2);
    const lapsedAt = performance.now();
    // The row is still this holder's, but expired at the database's clock (as after a renewal
    // sent late): a standby may take it at its next look.
    await database.db`
      update engine_lease set acquired_at = clock_timestamp() - interval '2 seconds',
        renewed_at = clock_timestamp() - interval '2 seconds',
        expires_at = clock_timestamp() - interval '1 second'
    `;
    await until("a stopped", () => a.stoppedAtDb.length === 1, SETTINGS.ttlMs);
    // At the next renewal, not at the fence deadline (900 ms after the last renewal).
    expect(performance.now() - lapsedAt).toBeLessThan(SETTINGS.renewMs * 2 + 200);
    const error = a.logs.find(
      (entry) =>
        entry.msg ===
        "the engine lease is no longer held on the database: this engine stops its services at once",
    );
    expect(error).toMatchObject({ level: 50, holder: a.leader.holder, row: "expired" });
    // Nobody else took it: it takes it again and works.
    await until("a leading again", () => a.leader.servicesRunning(), 2_000);
    expect(log.starts("a")).toBe(2);
    log.assertAtMostOne();
  });

  it("stops at once when the lease row is deleted under it", async () => {
    const log = new ServiceLog();
    const a = engine("a", log);
    void a.leader.run();
    await until("a leading", () => a.leader.servicesRunning());
    await delay(SETTINGS.renewMs * 2);
    const deletedAt = performance.now();
    await database.db`delete from engine_lease`;
    await until("a stopped", () => a.stoppedAtDb.length === 1, SETTINGS.ttlMs);
    expect(performance.now() - deletedAt).toBeLessThan(SETTINGS.renewMs * 2 + 200);
    expect(
      a.logs.find(
        (entry) =>
          entry.msg ===
          "the engine lease is no longer held on the database: this engine stops its services at once",
      ),
    ).toMatchObject({ row: "absent" });
  });

  it("leaves no stop listener behind across periods of leadership", async () => {
    const log = new ServiceLog();
    const a = engine("a", log);
    void a.leader.run();
    const stopSignal = (a.leader as unknown as { stopController: AbortController }).stopController
      .signal;
    for (let period = 1; period <= 4; period += 1) {
      await until(`a leading (${period.toString()})`, () => a.leader.servicesRunning(), 3_000);
      expect(getEventListeners(stopSignal, "abort")).toHaveLength(1);
      await database.db`delete from engine_lease`;
      await until(`a fenced (${period.toString()})`, () => a.stoppedAtDb.length === period, 3_000);
    }
    await until("a leading again", () => a.leader.servicesRunning(), 3_000);
    // One listener: the current period's (a standby's own wait removes its listener too).
    expect(getEventListeners(stopSignal, "abort").length).toBeLessThanOrEqual(1);
    expect(log.starts("a")).toBe(5);
  });

  it("says whether a standby can work the lease: not while its asks fail", async () => {
    const log = new ServiceLog();
    await database.db`
      insert into engine_lease (name, holder, acquired_at, renewed_at, expires_at)
      values ('engine', 'eng-other0000000', now(), now(), now() + interval '1 hour')
    `;
    const b = engine("b", log);
    expect(b.leader.view().leaseReachable).toBe(false);
    void b.leader.run();
    await until("b answered", () => b.leader.view().leaseReachable);
    expect(b.leader.view()).toMatchObject({ role: "standby", holder: "eng-other0000000" });
    b.lease.dead = true;
    await until("b failing", () => !b.leader.view().leaseReachable, 1_000);
    b.lease.dead = false;
    await until("b answered again", () => b.leader.view().leaseReachable, 1_000);
    // An ask that hangs: reachable until its last answer is a ttl old, then not.
    b.lease.freeze();
    await delay(SETTINGS.ttlMs + SETTINGS.standbyPollMs * 2);
    expect(b.leader.view().leaseReachable).toBe(false);
    b.lease.unfreeze();
    await until("b answered after the hang", () => b.leader.view().leaseReachable, 1_000);
    expect(log.starts("b")).toBe(0);
  });

  it("releases the lease and reports a failure when the services cannot start", async () => {
    const log = new ServiceLog();
    const a = engine("a", log, { startFails: true });
    const exit = await a.leader.run();
    expect(exit.kind).toBe("failed");
    if (exit.kind === "failed") expect(exit.error.message).toMatch(/another chain id/);
    const row = await leaseRow();
    expect(row?.holder).toBe(a.leader.holder);
    expect(row?.releasedAt).not.toBeNull();
  });

  it("positive control: the service log catches two engines working at once", () => {
    // What two processes did before this change: each started its services at once.
    const log = new ServiceLog();
    log.record("a", "start");
    log.record("b", "start");
    log.record("a", "stopped");
    log.record("b", "stopped");
    expect(log.overlaps()).toHaveLength(1);
    expect(() => log.assertAtMostOne()).toThrow(/two engines worked at once/);
    // One after the other: no overlap.
    const sequential = new ServiceLog();
    sequential.record("a", "start");
    sequential.record("a", "stopped");
    sequential.record("b", "start");
    expect(sequential.overlaps()).toEqual([]);
  });
});
