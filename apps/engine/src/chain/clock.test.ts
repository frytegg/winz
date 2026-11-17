import { describe, expect, it } from "vitest";

import { abortableSleep, systemClock } from "./clock";

describe("abortableSleep", () => {
  it("waits about the requested time", async () => {
    const started = Date.now();
    await abortableSleep(40);
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
  });

  it("returns as soon as the signal aborts", async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 20);
    await abortableSleep(5_000, controller.signal);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("returns at once for a signal that is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const started = Date.now();
    await abortableSleep(5_000, controller.signal);
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe("systemClock", () => {
  it("tells the current time", () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1_000);
  });
});
