import { describe, expect, it } from "vitest";

import { TICK_MS, readTick } from "./hooks";

describe("readTick", () => {
  it("gives two reads of the same render the same value when no timer runs", () => {
    // React reads the snapshot twice in a render; the clock moved a millisecond in between.
    const first = readTick(0, 1_700_000_000_000, false);
    const second = readTick(first, 1_700_000_000_001, false);
    expect(first).toBe(1_700_000_000_000);
    expect(second).toBe(first);
  });

  it("renews the value once a tick has passed", () => {
    const first = readTick(0, 1_700_000_000_000, false);
    expect(readTick(first, first + TICK_MS - 1, false)).toBe(first);
    expect(readTick(first, first + TICK_MS, false)).toBe(first + TICK_MS);
  });

  it("leaves the value to the timer while it runs", () => {
    expect(readTick(1_700_000_000_000, 1_700_000_005_000, true)).toBe(1_700_000_000_000);
  });
});
