import { describe, expect, it, vi } from "vitest";

import { getDemoMode, pinDemoMode, readDemoFlag, setDemoMode, subscribeDemoMode } from "./store";

describe("the DEMO MODE flag", () => {
  it("follows the last answer", () => {
    setDemoMode(true);
    expect(getDemoMode()).toBe(true);
    setDemoMode(false);
    expect(getDemoMode()).toBe(false);
  });

  it("is held up by a pin, whatever the answers say", () => {
    const release = pinDemoMode();
    expect(getDemoMode()).toBe(true);
    setDemoMode(true);
    setDemoMode(false);
    expect(getDemoMode()).toBe(true);
    release();
    expect(getDemoMode()).toBe(false);
  });

  it("keeps showing after the pin when the last answer was a demo one", () => {
    const release = pinDemoMode();
    setDemoMode(true);
    release();
    expect(getDemoMode()).toBe(true);
    setDemoMode(false);
  });

  it("counts the pins, and a pin released twice releases once", () => {
    const first = pinDemoMode();
    const second = pinDemoMode();
    first();
    first();
    expect(getDemoMode()).toBe(true);
    second();
    expect(getDemoMode()).toBe(false);
  });

  it("notifies only when what is shown changes", () => {
    const listener = vi.fn();
    const stop = subscribeDemoMode(listener);
    const release = pinDemoMode();
    setDemoMode(true);
    setDemoMode(false);
    release();
    stop();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("readDemoFlag", () => {
  it("reads a plain flag, or the flag of any ticket of a list, and nothing else", () => {
    expect(readDemoFlag({ demo: true })).toBe(true);
    expect(readDemoFlag({ tickets: [{ demo: false }, { demo: true }] })).toBe(true);
    expect(readDemoFlag({ tickets: [] })).toBe(false);
    expect(readDemoFlag({ other: 1 })).toBeNull();
    expect(readDemoFlag(null)).toBeNull();
  });
});
