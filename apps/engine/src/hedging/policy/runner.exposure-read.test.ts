/**
 * The runner's own guard on what its owner hands it (`onExposureRead`): a read of the exposure
 * ledger older than one it already has, or one that knows fewer settlements than it already
 * applied, never sets E; a read that brings settlements releases their contracts from H with its
 * E, in one step. Whoever calls, nothing is bought back or sold for a settlement.
 */
import { describe, expect, it } from "vitest";

import { PolicyInputError } from "./errors";
import { Scenario, c, level } from "./test-support";

/** A started runner holding 10 contracts for an exposure of 10, read at version 100. */
async function hedged(): Promise<Scenario> {
  const s = new Scenario({
    restore: {
      exposure: c(10),
      held: c(10),
      nextOrderSeq: 1,
      settledAllocated: 0n,
      asOf: 100n,
    },
  });
  await s.book([level(4800, 500)], [level(5000, 500)]);
  await s.runner.start();
  return s;
}

function intents(s: Scenario): number {
  return s.sink.events.filter((event) => event.type === "order_intent").length;
}

describe("PolicyRunner.onExposureRead", () => {
  it("applies a newer read; ignores an older one, whatever its E", async () => {
    const s = await hedged();
    expect(s.runner.onExposureRead({ exposure: c(12), settledAllocated: 0n, asOf: 99n })).toEqual({
      applied: false,
      reason: "older_read",
    });
    expect(s.runner.snapshot()).toMatchObject({ exposure: c(10), held: c(10) });
    expect(s.runner.onExposureRead({ exposure: c(12), settledAllocated: 0n, asOf: 101n })).toEqual({
      applied: true,
      released: 0n,
      previousExposure: c(10),
      changed: true,
    });
    expect(s.runner.snapshot().exposure).toBe(c(12));
    expect(s.runner.exposureReadState()).toEqual({ asOf: 101n, settledAllocated: 0n });
    // The same read again changes nothing.
    expect(s.runner.onExposureRead({ exposure: c(12), settledAllocated: 0n, asOf: 101n })).toEqual({
      applied: true,
      released: 0n,
      previousExposure: c(12),
      changed: false,
    });
    await s.runner.stop();
  });

  it("a settlement leaves H with its E in one step; an older read afterwards buys nothing back, and a reconciliation trades nothing", async () => {
    const s = await hedged();
    // Campaigns holding 4 contracts settled: E 10 → 6, H 10 → 6.
    expect(s.runner.onExposureRead({ exposure: c(6), settledAllocated: c(4), asOf: 105n })).toEqual(
      { applied: true, released: c(4), previousExposure: c(10), changed: true },
    );
    expect(s.runner.snapshot()).toMatchObject({ exposure: c(6), held: c(6) });
    // A read taken before that settlement (E 10), handed late: ignored.
    expect(s.runner.onExposureRead({ exposure: c(10), settledAllocated: 0n, asOf: 103n })).toEqual({
      applied: false,
      reason: "older_read",
    });
    // One that claims a newer version but knows fewer settlements: ignored too.
    expect(s.runner.onExposureRead({ exposure: c(10), settledAllocated: 0n, asOf: 107n })).toEqual({
      applied: false,
      reason: "older_settlements",
    });
    expect(s.runner.snapshot()).toMatchObject({ exposure: c(6), held: c(6) });
    const outcome = await s.runner.reconcile();
    expect(outcome).toMatchObject({ attempted: true, withinOneStep: true });
    await s.advance(5_000);
    expect(intents(s)).toBe(0);
    expect(s.venueHeld()).toBe(0n);
    await s.runner.stop();
  });

  it("onSettled counts toward the settled allocation the reads are compared with", async () => {
    const s = await hedged();
    await s.runner.onSettled(c(4), c(6));
    expect(s.runner.exposureReadState()).toEqual({ asOf: 100n, settledAllocated: c(4) });
    expect(s.runner.onExposureRead({ exposure: c(10), settledAllocated: 0n, asOf: 101n })).toEqual({
      applied: false,
      reason: "older_settlements",
    });
    expect(s.runner.onExposureRead({ exposure: c(6), settledAllocated: c(4), asOf: 101n })).toEqual(
      { applied: true, released: 0n, previousExposure: c(6), changed: false },
    );
    await s.runner.stop();
  });

  it("refuses a negative exposure or settled allocation", async () => {
    const s = await hedged();
    expect(() =>
      s.runner.onExposureRead({ exposure: -1n, settledAllocated: 0n, asOf: 101n }),
    ).toThrow(PolicyInputError);
    expect(() =>
      s.runner.onExposureRead({ exposure: 0n, settledAllocated: -1n, asOf: 101n }),
    ).toThrow(PolicyInputError);
    await s.runner.stop();
  });
});
