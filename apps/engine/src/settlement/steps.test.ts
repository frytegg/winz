/**
 * `StepRunner.waitForTx` once the watcher stops: nothing of the wait may outlive it for longer
 * than one wait slice, whatever the transaction wait timeout.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TxWaitTimeoutError, type EnqueueResult, type TxOutcome } from "../chain";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { StepRunner } from "./steps";
import type { SettlementTxSender } from "./types";

/** A sender whose transactions never become final, counting the waits still running. */
class NeverFinalSender implements SettlementTxSender {
  active = 0;
  calls = 0;

  enqueue(): Promise<EnqueueResult> {
    return Promise.resolve({ id: "00000000-0000-0000-0000-000000000000", created: true });
  }

  async waitFor(id: string, options: { timeoutMs: number }): Promise<TxOutcome> {
    this.active += 1;
    this.calls += 1;
    try {
      await new Promise((resolve) => setTimeout(resolve, options.timeoutMs));
      throw new TxWaitTimeoutError(id, options.timeoutMs, "queued");
    } finally {
      this.active -= 1;
    }
  }
}

let database: TestDatabase | undefined;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database?.drop();
});

describe("StepRunner.waitForTx", () => {
  it("leaves no wait running more than one slice after the watcher stops", async () => {
    const sender = new NeverFinalSender();
    const controller = new AbortController();
    if (database === undefined) throw new Error("no test database");
    const runner = new StepRunner(database.db, sender, 60_000, controller.signal, 100);
    const waiting = runner.waitForTx("tx");
    await new Promise((resolve) => setTimeout(resolve, 250));
    controller.abort();
    expect(await waiting).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sender.active).toBe(0);
  });

  it("still waits the whole timeout, slice after slice, while the watcher runs", async () => {
    const sender = new NeverFinalSender();
    const controller = new AbortController();
    if (database === undefined) throw new Error("no test database");
    const runner = new StepRunner(database.db, sender, 450, controller.signal, 100);
    const started = performance.now();
    expect(await runner.waitForTx("tx")).toBeNull();
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(440);
    expect(elapsed).toBeLessThan(1_500);
    // 100 + 100 + 100 + 100 + 50 ms; a sixth call of a millisecond or so when timers run late.
    expect(sender.calls).toBeGreaterThanOrEqual(5);
    expect(sender.calls).toBeLessThanOrEqual(6);
    expect(sender.active).toBe(0);
  });
});
