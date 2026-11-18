/**
 * A seeded property over three real `EngineLeader`s on one Postgres, each with its OWN injected
 * process clock (`monotonic`, which drives its fence and its overrun watchdog) that the test steps
 * forward and holds still, mixed with waits of the database's clock, database cuts (calls
 * failing), stalled connections (calls hanging), clean stops and restarts, and crashes.
 *
 * Whatever the interleaving:
 * - at most one engine ever had services running (the service log, on this test process's time);
 * - on the DATABASE's clock, every stop of an engine's services completed before the lease the
 *   database had last granted it expired: no services ran past the database's expiry, so never
 *   beside a successor that took the expired lease.
 *
 * What the clock steps model. A step forward makes the process believe more time has passed than
 * the database did: it may fence early (wasteful, never unsafe). A hold freezes the value the
 * process reads while its timers still fire, then lets it catch up: the fence can come up to the
 * hold's length late. A real process's monotonic clock and its timers are the same clock (libuv's
 * `uv_hrtime`), so this cannot happen there; holds are bounded here by `HOLD_MAX_MS` (100 ms),
 * under the margin left after the stop (600 ms margin, 20 ms stops). A longer pause of the whole
 * process is the frozen process the README describes, which no in-process fence can cover.
 */
import { performance } from "node:perf_hooks";

import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { EngineLeader, type LeaderServices } from "./leader";
import { PgEngineLease } from "./lease";
import type { LeaseSettings } from "./settings";
import { FaultyLease, ServiceLog } from "./test-support";

const SETTINGS: LeaseSettings = {
  ttlMs: 1_500,
  renewMs: 150,
  standbyPollMs: 50,
  fenceMarginMs: 600,
};
const HOLD_MAX_MS = 100;
const STEPS = 28;
const SEEDS = [3, 17, 2_026, 65_537];

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => {
  await database.drop();
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dbNow(): Promise<number> {
  const [row] = await database.db<{ t: Date }[]>`select clock_timestamp() as t`;
  if (row === undefined) throw new Error("no time");
  return row.t.getTime();
}

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

/** A process clock the test steps forward and holds still. */
class SteppedClock {
  private offsetMs = 0;
  private heldAt: number | null = null;

  readonly read = (): number => this.heldAt ?? performance.now() + this.offsetMs;

  step(ms: number): void {
    this.offsetMs += ms;
    if (this.heldAt !== null) this.heldAt += ms;
  }

  hold(): void {
    this.heldAt = this.read();
  }

  /** Catches up: from now on it reads the real time plus its offset again. */
  resume(): void {
    this.heldAt = null;
  }
}

interface Slot {
  name: string;
  leader: EngineLeader;
  lease: FaultyLease;
  clock: SteppedClock;
  /** Database time just after each stop of its services completed. */
  stoppedAtDb: number[];
  run: Promise<unknown>;
}

function startSlot(name: string, log: ServiceLog): Slot {
  const holder = `eng-${name.padEnd(12, "0")}`;
  const lease = new FaultyLease(
    new PgEngineLease({ db: database.db, holder, ttlMs: SETTINGS.ttlMs }),
  );
  const clock = new SteppedClock();
  const stoppedAtDb: number[] = [];
  const startServices = (signal: AbortSignal): Promise<LeaderServices> => {
    log.record(name, "start");
    return Promise.resolve({
      stopped: new Promise<void>((resolve) => {
        const stop = (): void => {
          setTimeout(() => {
            log.record(name, "stopped");
            void dbNow().then((t) => {
              stoppedAtDb.push(t);
              resolve();
            });
          }, 20);
        };
        if (signal.aborted) stop();
        else signal.addEventListener("abort", stop, { once: true });
      }),
    });
  };
  const leader = new EngineLeader({
    lease,
    settings: SETTINGS,
    logger: pino({ level: "silent" }),
    startServices,
    monotonic: clock.read,
  });
  return { name, leader, lease, clock, stoppedAtDb, run: leader.run() };
}

/** Lets every call of a slot through again (a stop then completes, its release included). */
function heal(slot: Slot): void {
  slot.lease.dead = false;
  slot.lease.unfreeze();
  slot.clock.resume();
}

describe("the property's fault injection", () => {
  it("frozen twice, then unfrozen: every waiting call goes through", async () => {
    const lease = new FaultyLease(
      new PgEngineLease({ db: database.db, holder: "eng-frozen000000", ttlMs: 1_000 }),
    );
    lease.freeze();
    const first = lease.read();
    lease.freeze();
    const second = lease.read();
    lease.unfreeze();
    const outcome = await Promise.race([
      Promise.all([first, second]).then(() => "answered"),
      delay(1_000).then(() => "still waiting"),
    ]);
    expect(outcome).toBe("answered");
  });
});

describe("one engine at a time, whatever each process's clock does (seeded property)", () => {
  it.each(SEEDS)(
    "seed %i: never two engines working, never services past the database's expiry",
    async (seed) => {
      await database.db`delete from engine_lease`;
      const random = rng(seed);
      const log = new ServiceLog();
      const generation = [0, 0, 0];
      const slots: Slot[] = ["a", "b", "c"].map((letter) => startSlot(`${letter}0`, log));
      const retired: Slot[] = [];
      const ops: string[] = [];
      const pick = (): { index: number; slot: Slot } => {
        const index = Math.floor(random() * slots.length);
        const slot = slots[index];
        if (slot === undefined) throw new Error("no slot");
        return { index, slot };
      };

      try {
        for (let step = 0; step < STEPS; step += 1) {
          const roll = random();
          const { index, slot } = pick();
          if (roll < 0.25) {
            // The database's clock moves on (real time passes).
            const ms = Math.floor(random() * SETTINGS.ttlMs);
            ops.push(`wait ${ms.toString()}`);
            await delay(ms);
          } else if (roll < 0.4) {
            const ms = Math.floor(random() * SETTINGS.ttlMs * 2);
            ops.push(`${slot.name} clock +${ms.toString()}`);
            slot.clock.step(ms);
          } else if (roll < 0.5) {
            const ms = Math.floor(random() * HOLD_MAX_MS);
            ops.push(`${slot.name} clock held ${ms.toString()}`);
            slot.clock.hold();
            await delay(ms);
            slot.clock.resume();
          } else if (roll < 0.62) {
            slot.lease.dead = !slot.lease.dead;
            ops.push(`${slot.name} database ${slot.lease.dead ? "cut" : "back"}`);
          } else if (roll < 0.72) {
            if (random() < 0.5) {
              slot.lease.freeze();
              ops.push(`${slot.name} calls hang`);
            } else {
              slot.lease.unfreeze();
              ops.push(`${slot.name} calls answer`);
            }
          } else if (roll < 0.84) {
            // A clean stop (SIGTERM), then the platform starts a new process in its place.
            ops.push(`${slot.name} stopped and replaced`);
            heal(slot);
            await slot.leader.stop();
            retired.push(slot);
            generation[index] = (generation[index] ?? 0) + 1;
            slots[index] = startSlot(`${slot.name[0] ?? "x"}${String(generation[index])}`, log);
          } else if (roll < 0.9) {
            // Cut off from the database for good (no renewal, no release, ever again; its services stop
            // only by its own fence), and a new process in its place.
            ops.push(`${slot.name} cut off for good and replaced`);
            slot.lease.unfreeze();
            slot.lease.dead = true;
            retired.push(slot);
            generation[index] = (generation[index] ?? 0) + 1;
            slots[index] = startSlot(`${slot.name[0] ?? "x"}${String(generation[index])}`, log);
          } else {
            const ms = Math.floor(random() * SETTINGS.renewMs * 3);
            ops.push(`short wait ${ms.toString()}`);
            await delay(ms);
          }
          expect(log.overlaps(), `seed ${seed.toString()}: ${ops.join("; ")}`).toEqual([]);
        }

        // Every live process healed: one of them leads again (liveness, after the ttl at most).
        for (const slot of slots) heal(slot);
        const deadline = performance.now() + SETTINGS.ttlMs * 3;
        while (!slots.some((slot) => slot.leader.servicesRunning())) {
          if (performance.now() > deadline) {
            throw new Error(`seed ${seed.toString()}: nobody leads again: ${ops.join("; ")}`);
          }
          await delay(20);
        }
      } finally {
        for (const slot of slots) heal(slot);
        for (const slot of retired) {
          // A process cut off for good stays cut off; its stop releases nothing.
          slot.lease.unfreeze();
          slot.clock.resume();
        }
        await Promise.all([...slots, ...retired].map((slot) => slot.leader.stop()));
      }

      const context = `seed ${seed.toString()}: ${ops.join("; ")}`;
      log.assertAtMostOne();
      // On the database's clock: each stop of a slot's services completed before the latest
      // lease the database had granted it by then expired.
      let periods = 0;
      for (const slot of [...retired, ...slots]) {
        for (const stoppedAt of slot.stoppedAtDb) {
          periods += 1;
          const granted = slot.lease.grants.filter((grant) => grant.dbNow.getTime() < stoppedAt);
          const expiry = Math.max(...granted.map((grant) => grant.expiresAt.getTime()));
          expect(stoppedAt, `${slot.name} stopped past its expiry; ${context}`).toBeLessThan(
            expiry,
          );
        }
      }
      // The run went through handovers, not one engine leading throughout.
      const leaders = new Set(log.events.filter((e) => e.event === "start").map((e) => e.engine));
      expect(leaders.size, context).toBeGreaterThan(1);
      expect(periods).toBeGreaterThan(1);
    },
    120_000,
  );

  it("positive control: a process clock held past the margin runs the services past the expiry, and the check sees it", async () => {
    await database.db`delete from engine_lease`;
    const log = new ServiceLog();
    const slot = startSlot("held", log);
    try {
      const deadline = performance.now() + 2_000;
      while (!slot.leader.servicesRunning()) {
        if (performance.now() > deadline) throw new Error("never led");
        await delay(10);
      }
      await delay(SETTINGS.renewMs * 2);
      // The database is gone and the process's clock stands still for a whole ttl: what the
      // property's holds are bounded against.
      slot.clock.hold();
      slot.lease.dead = true;
      await delay(SETTINGS.ttlMs + 200);
      slot.clock.resume();
      const until = performance.now() + 3_000;
      while (slot.stoppedAtDb.length === 0) {
        if (performance.now() > until) throw new Error("never fenced");
        await delay(10);
      }
    } finally {
      heal(slot);
      await slot.leader.stop();
    }
    const stoppedAt = slot.stoppedAtDb[0] ?? 0;
    const expiry = Math.max(
      ...slot.lease.grants
        .filter((grant) => grant.dbNow.getTime() < stoppedAt)
        .map((grant) => grant.expiresAt.getTime()),
    );
    // The same check as the property's, failing here: the services stopped after the expiry.
    expect(stoppedAt).toBeGreaterThanOrEqual(expiry);
  });
});
