import { Writable } from "node:stream";

import pino, { type Logger } from "pino";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { Db } from "../db";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { enqueueJob } from "./enqueue";
import { JobAbortedError, JobConfigError, PermanentJobError, RetryLaterError } from "./errors";
import { JobWorker, type JobWorkerConfig } from "./worker";

interface JobRow {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
}

type LogEntry = Record<string, unknown>;

/** A pino logger that keeps its entries, so tests can assert on what was logged. */
function capturingLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (line.trim() !== "") entries.push(JSON.parse(line) as LogEntry);
      }
      callback();
    },
  });
  return { logger: pino({ level: "debug" }, stream), entries };
}

/** A clock the test can push forward; it otherwise follows real time. */
function adjustableClock(): { now: () => number; advance: (ms: number) => void } {
  let offsetMs = 0;
  return {
    now: () => Date.now() + offsetMs,
    advance: (ms: number): void => {
      offsetMs += ms;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline)
      throw new Error(`condition not met within ${timeoutMs.toString()} ms`);
    await sleep(5);
  }
}

describe("JobWorker", () => {
  let database: TestDatabase;
  let db: Db;
  let workers: JobWorker[] = [];
  let logs: LogEntry[] = [];
  let logger: Logger;

  beforeAll(async () => {
    database = await createTestDatabase();
    db = database.db;
  });
  afterAll(async () => {
    await database.drop();
  });
  beforeEach(async () => {
    await db`delete from jobs`;
    const captured = capturingLogger();
    logger = captured.logger;
    logs = captured.entries;
  });
  afterEach(async () => {
    await Promise.all(workers.map((worker) => worker.stop()));
    workers = [];
  });

  function makeWorker(overrides: Partial<JobWorkerConfig> = {}, clock?: () => number): JobWorker {
    const worker = new JobWorker({
      db,
      logger,
      ...(clock ? { clock } : {}),
      config: {
        concurrency: 4,
        pollIntervalMs: 10,
        visibilityTimeoutMs: 30_000,
        workerId: `worker-${(workers.length + 1).toString()}`,
        backoff: () => 20,
        shutdownGraceMs: 2_000,
        ...overrides,
      },
    });
    workers.push(worker);
    return worker;
  }

  async function job(id: string): Promise<JobRow> {
    const rows = await db<JobRow[]>`select * from jobs where id = ${id}`;
    const row = rows[0];
    if (!row) throw new Error(`job ${id} not found`);
    return row;
  }

  async function statusIs(id: string, status: string): Promise<boolean> {
    return (await job(id)).status === status;
  }

  function logged(message: string, jobId: string): LogEntry[] {
    return logs.filter((entry) => entry.msg === message && entry.jobId === jobId);
  }

  it("handles each of 200 jobs exactly once with two workers on the same queue", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 200; index += 1) {
      const { id } = await enqueueJob(db, { kind: "count", payload: { index } });
      ids.push(id);
    }

    const handledBy = new Map<string, string[]>();
    const makeHandler =
      (workerName: string) =>
      async (_payload: unknown, ctx: { jobId: string }): Promise<void> => {
        handledBy.set(ctx.jobId, [...(handledBy.get(ctx.jobId) ?? []), workerName]);
        // Yield so the two workers really interleave.
        await sleep(1);
      };
    const first = makeWorker({ concurrency: 8 });
    const second = makeWorker({ concurrency: 8 });
    first.register("count", makeHandler("first"));
    second.register("count", makeHandler("second"));
    first.start();
    second.start();

    await waitFor(async () => {
      const [row] = await db<{ n: bigint }[]>`select count(*) as n from jobs where status = 'done'`;
      return row?.n === 200n;
    });
    // Let any wrongly duplicated run show up.
    await sleep(100);

    expect(handledBy.size).toBe(200);
    for (const id of ids) expect(handledBy.get(id)).toHaveLength(1);
    const workersUsed = new Set([...handledBy.values()].flat());
    expect(workersUsed).toEqual(new Set(["first", "second"]));

    const rows = await db<JobRow[]>`select * from jobs`;
    expect(rows.every((row) => row.status === "done" && row.attempts === 1)).toBe(true);
    expect(rows.every((row) => row.locked_at === null && row.locked_by === null)).toBe(true);
  });

  it("runs jobs oldest run_at first", async () => {
    const base = Date.now() - 60_000;
    const order: number[] = [];
    for (const position of [3, 1, 2]) {
      await enqueueJob(db, {
        kind: "ordered",
        payload: { position },
        runAt: new Date(base + position * 1_000),
      });
    }
    const worker = makeWorker({ concurrency: 1 });
    worker.register("ordered", z.object({ position: z.number() }), async (payload) => {
      order.push(payload.position);
    });
    worker.start();
    await waitFor(() => order.length === 3);
    expect(order).toEqual([1, 2, 3]);
  });

  it("never runs more handlers at once than its concurrency", async () => {
    for (let index = 0; index < 12; index += 1) {
      await enqueueJob(db, { kind: "slow", payload: {} });
    }
    let running = 0;
    let peak = 0;
    let finished = 0;
    const worker = makeWorker({ concurrency: 3 });
    worker.register("slow", async () => {
      running += 1;
      peak = Math.max(peak, running);
      await sleep(15);
      running -= 1;
      finished += 1;
    });
    worker.start();
    await waitFor(() => finished === 12);
    expect(peak).toBe(3);
  });

  it("retries a failing job after the backoff, then succeeds", async () => {
    const { id } = await enqueueJob(db, { kind: "flaky", payload: {} });
    const attempts: number[] = [];
    const backoffCalls: number[] = [];
    const worker = makeWorker({
      backoff: (attempt) => {
        backoffCalls.push(attempt);
        return 150;
      },
    });
    worker.register("flaky", async (_payload, ctx) => {
      attempts.push(ctx.attempt);
      if (ctx.attempt < 3) throw new Error(`boom ${ctx.attempt.toString()}`);
    });
    worker.start();

    await waitFor(async () => (await job(id)).attempts === 1 && (await statusIs(id, "queued")));
    const afterFirst = await job(id);
    expect(afterFirst.last_error).toBe("Error: boom 1");
    expect(afterFirst.locked_by).toBeNull();
    const waitMs = afterFirst.run_at.getTime() - Date.now();
    expect(waitMs).toBeGreaterThan(50);
    expect(waitMs).toBeLessThanOrEqual(150);

    await waitFor(() => statusIs(id, "done"));
    expect(attempts).toEqual([1, 2, 3]);
    expect(backoffCalls).toEqual([1, 2]);
    const done = await job(id);
    expect(done.attempts).toBe(3);
    // The last failure stays readable on the row.
    expect(done.last_error).toBe("Error: boom 2");

    const retries = logged("job failed; retry scheduled", id);
    expect(retries.map((entry) => entry.attempt)).toEqual([1, 2]);
    expect(retries[0]?.level).toBe(40);
    expect(retries[0]?.kind).toBe("flaky");
    const err = retries[0]?.err as { stack?: string; message?: string } | undefined;
    expect(err?.message).toBe("boom 1");
    expect(err?.stack).toContain("worker.test.ts");
    expect(logged("job started", id).map((entry) => entry.attempt)).toEqual([1, 2, 3]);
    expect(logged("job done", id).map((entry) => entry.attempt)).toEqual([3]);
  });

  it("sets a job aside as dead once its attempts are used up", async () => {
    const { id } = await enqueueJob(db, { kind: "doomed", payload: {}, maxAttempts: 3 });
    let calls = 0;
    const worker = makeWorker({ backoff: () => 5 });
    worker.register("doomed", async () => {
      calls += 1;
      throw new Error(`still broken (${calls.toString()})`, { cause: new Error("root cause") });
    });
    worker.start();

    await waitFor(() => statusIs(id, "dead"));
    await sleep(80);
    expect(calls).toBe(3);
    const dead = await job(id);
    expect(dead.attempts).toBe(3);
    expect(dead.last_error).toBe("Error: still broken (3) (caused by Error: root cause)");
    expect(dead.locked_at).toBeNull();
    expect(dead.locked_by).toBeNull();

    const deadLogs = logged("job dead: it will not be retried", id);
    expect(deadLogs).toHaveLength(1);
    expect(deadLogs[0]?.level).toBe(50);
    expect(deadLogs[0]?.attempt).toBe(3);
    expect((deadLogs[0]?.err as { stack?: string }).stack).toContain("still broken (3)");
  });

  it("sends a job to dead at once on PermanentJobError", async () => {
    const { id } = await enqueueJob(db, { kind: "refused", payload: {}, maxAttempts: 5 });
    let calls = 0;
    const worker = makeWorker();
    worker.register("refused", async () => {
      calls += 1;
      throw new PermanentJobError("sale is closed");
    });
    worker.start();

    await waitFor(() => statusIs(id, "dead"));
    await sleep(80);
    expect(calls).toBe(1);
    const dead = await job(id);
    expect(dead.attempts).toBe(1);
    expect(dead.last_error).toBe("PermanentJobError: sale is closed");
  });

  it("honours the delay of RetryLaterError and does not log it as a failure", async () => {
    const clock = adjustableClock();
    const { id } = await enqueueJob(db, { kind: "waiting", payload: {} });
    const attempts: number[] = [];
    const worker = makeWorker({ backoff: () => 1 }, clock.now);
    worker.register("waiting", async (_payload, ctx) => {
      attempts.push(ctx.attempt);
      if (ctx.attempt === 1) throw new RetryLaterError(60_000, "book is stale");
    });
    worker.start();

    await waitFor(async () => (await job(id)).attempts === 1 && (await statusIs(id, "queued")));
    const deferred = await job(id);
    const delayMs = deferred.run_at.getTime() - clock.now();
    expect(delayMs).toBeGreaterThan(59_000);
    expect(delayMs).toBeLessThanOrEqual(60_000);
    expect(deferred.last_error).toBe("RetryLaterError: book is stale");

    // Not picked up before its time: many polls go by.
    await sleep(150);
    expect(attempts).toEqual([1]);

    clock.advance(59_000);
    await sleep(100);
    expect(attempts).toEqual([1]);

    clock.advance(1_100);
    await waitFor(() => statusIs(id, "done"));
    expect(attempts).toEqual([1, 2]);
    expect((await job(id)).attempts).toBe(2);

    const deferrals = logged("job deferred by its handler", id);
    expect(deferrals).toHaveLength(1);
    expect(deferrals[0]?.level).toBe(30);
    expect(deferrals[0]?.delayMs).toBe(60_000);
    expect(logs.filter((entry) => entry.jobId === id && Number(entry.level) >= 40)).toEqual([]);
  });

  it("counts a RetryLaterError as an attempt: a job that always defers ends dead", async () => {
    const { id } = await enqueueJob(db, { kind: "never-ready", payload: {}, maxAttempts: 2 });
    let calls = 0;
    const worker = makeWorker();
    worker.register("never-ready", async () => {
      calls += 1;
      throw new RetryLaterError(5);
    });
    worker.start();
    await waitFor(() => statusIs(id, "dead"));
    expect(calls).toBe(2);
    expect((await job(id)).attempts).toBe(2);
  });

  it("sends a job with an invalid payload to dead without calling the handler", async () => {
    const schema = z.object({ paymentIntent: z.string().min(1), qty: z.number().int().positive() });
    const bad = await enqueueJob(db, { kind: "purchase", payload: { paymentIntent: "pi_1" } });
    const good = await enqueueJob(db, {
      kind: "purchase",
      payload: { paymentIntent: "pi_2", qty: 3 },
    });
    const received: { paymentIntent: string; qty: number }[] = [];
    const worker = makeWorker();
    worker.register("purchase", schema, async (payload) => {
      received.push(payload);
    });
    worker.start();

    await waitFor(
      async () => (await statusIs(bad.id, "dead")) && (await statusIs(good.id, "done")),
    );
    await sleep(80);
    expect(received).toEqual([{ paymentIntent: "pi_2", qty: 3 }]);
    const dead = await job(bad.id);
    expect(dead.attempts).toBe(1);
    expect(dead.last_error).toContain(
      'InvalidJobPayloadError: invalid payload for job kind "purchase"',
    );
    expect(dead.last_error).toContain("qty");
  });

  it("recovers a job left running by a dead worker after the visibility timeout, once", async () => {
    const stale = await enqueueJob(db, { kind: "orphan", payload: {} });
    const fresh = await enqueueJob(db, { kind: "orphan", payload: {} });
    // `stale` was taken 1.5 s ago by a worker that died; `fresh` is held by a live worker.
    await db`
      update jobs set status = 'running', attempts = 1, locked_by = 'dead-worker',
        locked_at = now() - interval '1500 milliseconds'
      where id = ${stale.id}
    `;
    await db`
      update jobs set status = 'running', attempts = 1, locked_by = 'live-worker', locked_at = now()
      where id = ${fresh.id}
    `;

    const handled: { jobId: string; attempt: number }[] = [];
    const makeHandler =
      () => async (_payload: unknown, ctx: { jobId: string; attempt: number }) => {
        handled.push({ jobId: ctx.jobId, attempt: ctx.attempt });
        await sleep(5);
      };
    const first = makeWorker({ visibilityTimeoutMs: 1_000 });
    const second = makeWorker({ visibilityTimeoutMs: 1_000 });
    first.register("orphan", makeHandler());
    second.register("orphan", makeHandler());
    first.start();
    second.start();

    await waitFor(() => statusIs(stale.id, "done"));
    await sleep(100);
    expect(handled).toEqual([{ jobId: stale.id, attempt: 2 }]);
    const recovered = await job(stale.id);
    expect(recovered.attempts).toBe(2);
    expect(recovered.last_error).toContain("worker dead-worker stopped refreshing its lock");
    expect(logged("abandoned job recovered: back in the queue", stale.id)).toHaveLength(1);

    const untouched = await job(fresh.id);
    expect(untouched.status).toBe("running");
    expect(untouched.locked_by).toBe("live-worker");
  });

  it("sets an abandoned job aside as dead when the lost attempt was its last", async () => {
    const { id } = await enqueueJob(db, { kind: "orphan", payload: {}, maxAttempts: 2 });
    await db`
      update jobs set status = 'running', attempts = 2, locked_by = 'dead-worker',
        locked_at = now() - interval '5 seconds'
      where id = ${id}
    `;
    let calls = 0;
    const worker = makeWorker({ visibilityTimeoutMs: 1_000 });
    worker.register("orphan", async () => {
      calls += 1;
    });
    worker.start();
    await waitFor(() => statusIs(id, "dead"));
    await sleep(60);
    expect(calls).toBe(0);
  });

  it("keeps the lock of a handler that runs longer than the visibility timeout", async () => {
    const { id } = await enqueueJob(db, { kind: "long", payload: {} });
    let calls = 0;
    const makeHandler = () => async (): Promise<void> => {
      calls += 1;
      await sleep(700);
    };
    // Two workers: the second would take the job over if the first let its lock go stale.
    const first = makeWorker({ visibilityTimeoutMs: 200 });
    const second = makeWorker({ visibilityTimeoutMs: 200 });
    first.register("long", makeHandler());
    second.register("long", makeHandler());
    first.start();
    second.start();

    await waitFor(() => statusIs(id, "done"));
    expect(calls).toBe(1);
    expect((await job(id)).attempts).toBe(1);
  });

  it("does not pick up a job before its run_at", async () => {
    const clock = adjustableClock();
    const later = await enqueueJob(db, {
      kind: "scheduled",
      payload: {},
      runAt: new Date(clock.now() + 3_600_000),
    });
    const now = await enqueueJob(db, { kind: "scheduled", payload: {} });
    const handled: string[] = [];
    const worker = makeWorker({}, clock.now);
    worker.register("scheduled", async (_payload, ctx) => {
      handled.push(ctx.jobId);
    });
    worker.start();

    await waitFor(() => statusIs(now.id, "done"));
    await sleep(150);
    expect(handled).toEqual([now.id]);
    const waiting = await job(later.id);
    expect(waiting.status).toBe("queued");
    expect(waiting.attempts).toBe(0);

    clock.advance(3_599_000);
    await sleep(100);
    expect(handled).toEqual([now.id]);

    clock.advance(1_100);
    await waitFor(() => statusIs(later.id, "done"));
    expect(handled).toEqual([now.id, later.id]);
  });

  it("does not pick up a job before its run_at on the real clock either", async () => {
    const { id } = await enqueueJob(db, {
      kind: "scheduled",
      payload: {},
      runAt: new Date(Date.now() + 400),
    });
    let handledAt: number | undefined;
    const worker = makeWorker();
    worker.register("scheduled", async () => {
      handledAt = Date.now();
    });
    worker.start();
    const runAt = (await job(id)).run_at.getTime();
    await waitFor(() => statusIs(id, "done"));
    expect(handledAt).toBeGreaterThanOrEqual(runAt);
  });

  it("leaves a kind without a registered handler untouched in the queue", async () => {
    const unknown = await enqueueJob(db, { kind: "nobody-handles-this", payload: {} });
    const known = await enqueueJob(db, { kind: "known", payload: {} });
    const before = await job(unknown.id);
    const worker = makeWorker();
    worker.register("known", async () => undefined);
    worker.start();

    await waitFor(() => statusIs(known.id, "done"));
    await sleep(150);
    const after = await job(unknown.id);
    expect(after).toEqual(before);
    expect(after.status).toBe("queued");
    expect(after.attempts).toBe(0);
    expect(logs.filter((entry) => entry.jobId === unknown.id)).toEqual([]);
  });

  it("leaves the whole queue untouched when no handler is registered", async () => {
    const { id } = await enqueueJob(db, { kind: "anything", payload: {} });
    const worker = makeWorker();
    worker.start();
    await sleep(100);
    expect((await job(id)).status).toBe("queued");
  });

  it("stop() aborts a long handler and gives its job back to the queue", async () => {
    const { id } = await enqueueJob(db, { kind: "long", payload: {} });
    let started = false;
    let seenAborted: boolean | undefined;
    let abortReason: unknown;
    const worker = makeWorker();
    worker.register("long", (_payload, ctx) => {
      started = true;
      return new Promise((_resolve, reject) => {
        ctx.signal.addEventListener("abort", () => {
          seenAborted = ctx.signal.aborted;
          abortReason = ctx.signal.reason;
          reject(ctx.signal.reason as Error);
        });
      });
    });
    worker.start();
    await waitFor(() => started);
    expect((await job(id)).status).toBe("running");
    expect((await job(id)).locked_by).toBe("worker-1");

    const stopStarted = Date.now();
    await worker.stop();
    expect(Date.now() - stopStarted).toBeLessThan(1_500);

    expect(seenAborted).toBe(true);
    expect(abortReason).toBeInstanceOf(JobAbortedError);
    const after = await job(id);
    expect(after.status).toBe("queued");
    // The interruption is not the job's fault: the attempt is refunded.
    expect(after.attempts).toBe(0);
    expect(after.locked_at).toBeNull();
    expect(after.locked_by).toBeNull();
    expect(after.last_error).toBeNull();

    // Another worker picks it up and finishes it.
    const next = makeWorker();
    next.register("long", async () => undefined);
    next.start();
    await waitFor(() => statusIs(id, "done"));
    expect((await job(id)).attempts).toBe(1);
  });

  it("stop() lets a handler that finishes on abort end its job done", async () => {
    const { id } = await enqueueJob(db, { kind: "long", payload: {} });
    let started = false;
    const worker = makeWorker();
    worker.register("long", (_payload, ctx) => {
      started = true;
      return new Promise<void>((resolve) => {
        ctx.signal.addEventListener("abort", () => {
          // Finishes its critical section, then returns normally.
          setTimeout(resolve, 30);
        });
      });
    });
    worker.start();
    await waitFor(() => started);
    await worker.stop();

    const after = await job(id);
    expect(after.status).toBe("done");
    expect(after.attempts).toBe(1);
    expect(after.locked_by).toBeNull();
  });

  it("stop() takes the job away from a handler that ignores the signal past the grace period", async () => {
    const { id } = await enqueueJob(db, { kind: "stubborn", payload: {} });
    let started = false;
    let finishHandler: (() => void) | undefined;
    const worker = makeWorker({ shutdownGraceMs: 100 });
    worker.register("stubborn", () => {
      started = true;
      return new Promise<void>((resolve) => {
        finishHandler = resolve;
      });
    });
    worker.start();
    await waitFor(() => started);

    const stopStarted = Date.now();
    await worker.stop();
    const stopMs = Date.now() - stopStarted;
    expect(stopMs).toBeGreaterThanOrEqual(90);
    expect(stopMs).toBeLessThan(1_500);

    const after = await job(id);
    expect(after.status).toBe("queued");
    expect(after.attempts).toBe(0);
    expect(after.locked_by).toBeNull();

    // The handler finally returns: its late result must not mark the job done.
    finishHandler?.();
    await sleep(80);
    expect((await job(id)).status).toBe("queued");
    expect(
      logged("job result ignored: the job is no longer locked by this worker", id),
    ).toHaveLength(1);
  });

  it("stop() leaves no job running under this worker, whatever the handlers do", async () => {
    for (let index = 0; index < 30; index += 1) {
      await enqueueJob(db, { kind: "mixed", payload: { index } });
    }
    const worker = makeWorker({ concurrency: 6, shutdownGraceMs: 150 });
    let started = 0;
    worker.register("mixed", z.object({ index: z.number() }), async (payload, ctx) => {
      started += 1;
      if (payload.index % 3 === 0) {
        await sleep(20);
        return;
      }
      if (payload.index % 3 === 1) {
        await new Promise((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => {
            reject(new Error("interrupted"));
          });
        });
        return;
      }
      await sleep(5_000);
    });
    worker.start();
    await waitFor(() => started >= 6);
    await worker.stop();

    const rows = await db<JobRow[]>`select * from jobs`;
    expect(rows.filter((row) => row.status === "running")).toEqual([]);
    expect(rows.filter((row) => row.locked_by !== null)).toEqual([]);
    expect(rows.every((row) => row.status === "queued" || row.status === "done")).toBe(true);
    const startedBeforeStop = started;
    await sleep(100);
    expect(started).toBe(startedBeforeStop);
  });

  it("can be stopped twice, stopped before start, and started again", async () => {
    const worker = makeWorker();
    await worker.stop();
    let calls = 0;
    worker.register("again", async () => {
      calls += 1;
    });
    worker.start();
    expect(() => {
      worker.start();
    }).toThrow(JobConfigError);
    await Promise.all([worker.stop(), worker.stop()]);

    const { id } = await enqueueJob(db, { kind: "again", payload: {} });
    await sleep(60);
    expect((await job(id)).status).toBe("queued");

    worker.start();
    await waitFor(() => statusIs(id, "done"));
    expect(calls).toBe(1);
  });

  it("refuses a second handler for a kind and a senseless configuration", () => {
    const worker = makeWorker();
    worker.register("once", async () => undefined);
    expect(() => {
      worker.register("once", async () => undefined);
    }).toThrow(JobConfigError);
    expect(() => makeWorker({ concurrency: 0 })).toThrow(JobConfigError);
    expect(() => makeWorker({ pollIntervalMs: 0 })).toThrow(JobConfigError);
    expect(() => makeWorker({ visibilityTimeoutMs: -1 })).toThrow(JobConfigError);
    expect(() => makeWorker({ workerId: "" })).toThrow(JobConfigError);
  });

  it("tags every job log line with the job id, kind, attempt, module and worker", async () => {
    const { id } = await enqueueJob(db, { kind: "logged", payload: {} });
    const worker = makeWorker();
    worker.register("logged", async () => undefined);
    worker.start();
    await waitFor(() => statusIs(id, "done"));

    const lines = logs.filter((entry) => entry.jobId === id);
    expect(lines.map((entry) => entry.msg)).toEqual(["job started", "job done"]);
    for (const line of lines) {
      expect(line.kind).toBe("logged");
      expect(line.attempt).toBe(1);
      expect(line.module).toBe("jobs");
      expect(line.workerId).toBe("worker-1");
    }
  });
});
