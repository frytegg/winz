import { describe, expect, it } from "vitest";

import { LOOP_STALE_AFTER_MS, LoopMonitor, watchServiceEnd, type LoopReport } from "./loops";

function clock(start: number): { now: () => number; advance: (ms: number) => void } {
  let nowMs = start;
  return { now: () => nowMs, advance: (ms) => (nowMs += ms) };
}

function stateOf(reports: readonly LoopReport[], name: string): LoopReport | undefined {
  return reports.find((report) => report.name === name);
}

describe("LoopMonitor", () => {
  it("running within its bound from registration, stale past it, running again after a pass", () => {
    const time = clock(1_000_000);
    const monitor = new LoopMonitor(time.now);
    const loop = monitor.register("sale-states", 60_000);

    time.advance(60_000);
    expect(stateOf(monitor.report(), "sale-states")).toMatchObject({
      state: "running",
      lastPassAtMs: null,
      sinceMs: 60_000,
    });
    time.advance(1);
    expect(stateOf(monitor.report(), "sale-states")?.state).toBe("stale");

    loop.beat();
    expect(stateOf(monitor.report(), "sale-states")).toMatchObject({
      state: "running",
      lastPassAtMs: 1_060_001,
      sinceMs: 0,
    });
    time.advance(60_001);
    expect(stateOf(monitor.report(), "sale-states")?.state).toBe("stale");
  });

  it("stopped at once, whatever its last pass, until registered again", () => {
    const time = clock(0);
    const monitor = new LoopMonitor(time.now);
    const loop = monitor.register("jobs", 120_000);
    loop.beat();
    loop.stopped("the jobs service stopped by itself");
    expect(stateOf(monitor.report(), "jobs")).toMatchObject({
      state: "stopped",
      detail: "the jobs service stopped by itself",
    });
    loop.beat();
    expect(stateOf(monitor.report(), "jobs")?.state).toBe("stopped");

    monitor.register("jobs", 120_000);
    expect(stateOf(monitor.report(), "jobs")?.state).toBe("running");
  });

  it("ignores the beats of a registration that was replaced or cleared (an earlier leadership)", () => {
    const time = clock(0);
    const monitor = new LoopMonitor(time.now);
    const old = monitor.register("settlement", 1_000);
    monitor.clear();
    expect(monitor.report()).toEqual([]);
    const current = monitor.register("settlement", 1_000);
    time.advance(2_000);
    old.beat();
    old.stopped("late");
    expect(stateOf(monitor.report(), "settlement")).toMatchObject({ state: "stale", detail: null });
    current.beat();
    expect(stateOf(monitor.report(), "settlement")?.state).toBe("running");
  });

  it("reports by name and refuses a bound that is not a positive number", () => {
    const monitor = new LoopMonitor(() => 0);
    monitor.register("sale-states", 1);
    monitor.register("chain-logs", 1);
    expect(monitor.report().map((report) => report.name)).toEqual(["chain-logs", "sale-states"]);
    expect(() => monitor.register("x", 0)).toThrow(RangeError);
    expect(() => monitor.register("x", Number.NaN)).toThrow(RangeError);
  });

  it("bounds every engine loop, the sale states at 60 s; no loop name contains the letters ok", () => {
    expect(LOOP_STALE_AFTER_MS["sale-states"]).toBe(60_000);
    for (const [name, bound] of Object.entries(LOOP_STALE_AFTER_MS)) {
      expect(bound).toBeGreaterThanOrEqual(60_000);
      expect(name).not.toContain("ok");
    }
  });
});

describe("watchServiceEnd", () => {
  it("a service that ends while the engine runs marks its loops stopped and is reported", async () => {
    const monitor = new LoopMonitor(() => 0);
    const loops = [
      monitor.register("hedging-tick", 1_000),
      monitor.register("hedging-charge", 1_000),
    ];
    const other = monitor.register("jobs", 1_000);
    const ends: unknown[] = [];
    let end: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => (end = resolve));
    watchServiceEnd({
      name: "hedging",
      stopped,
      loops,
      signal: new AbortController().signal,
      onEnd: (error) => ends.push(error),
    });
    expect(monitor.report().every((report) => report.state === "running")).toBe(true);
    end();
    await stopped;
    await Promise.resolve();
    expect(ends).toEqual([undefined]);
    expect(monitor.report().map((report) => [report.name, report.state])).toEqual([
      ["hedging-charge", "stopped"],
      ["hedging-tick", "stopped"],
      ["jobs", "running"],
    ]);
    void other;
  });

  it("a service that rejects is reported with its error", async () => {
    const monitor = new LoopMonitor(() => 0);
    const loop = monitor.register("feed-refresh", 1_000);
    const ends: unknown[] = [];
    const failure = new Error("boom");
    const stopped = Promise.reject(failure);
    watchServiceEnd({
      name: "book-feed",
      stopped,
      loops: [loop],
      signal: new AbortController().signal,
      onEnd: (error) => ends.push(error),
    });
    await stopped.catch(() => undefined);
    await Promise.resolve();
    expect(ends).toEqual([failure]);
    expect(monitor.report()[0]?.state).toBe("stopped");
  });

  it("a service that ends because the engine stops is not reported (positive control above)", async () => {
    const monitor = new LoopMonitor(() => 0);
    const loop = monitor.register("settlement", 1_000);
    const engine = new AbortController();
    const ends: unknown[] = [];
    let end: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => (end = resolve));
    watchServiceEnd({
      name: "settlement",
      stopped,
      loops: [loop],
      signal: engine.signal,
      onEnd: (error) => ends.push(error),
    });
    engine.abort();
    end();
    await stopped;
    await Promise.resolve();
    expect(ends).toEqual([]);
    expect(monitor.report()[0]?.state).toBe("running");
  });
});
