import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adminKeyIsMemoryOnly,
  clearAdminKey,
  readAdminKey,
  saveAdminKey,
  subscribeAdminKey,
} from "./key";

function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
    // A trap: the key must never be written here.
    localStorage: {
      getItem: () => {
        throw new Error("localStorage must not be read");
      },
      setItem: () => {
        throw new Error("localStorage must not be written");
      },
      removeItem: () => {
        throw new Error("localStorage must not be touched");
      },
    },
  });
  return store;
}

afterEach(() => {
  clearAdminKey();
  vi.unstubAllGlobals();
});

describe("the admin key", () => {
  it("is kept in sessionStorage and in no other storage", () => {
    const store = stubStorage();
    expect(readAdminKey()).toBeNull();
    expect(saveAdminKey("  demo-key-123  ")).toBe(true);
    expect(readAdminKey()).toBe("demo-key-123");
    expect([...store.entries()]).toEqual([["winz.admin-key", "demo-key-123"]]);
  });

  it("refuses a blank key and stores nothing", () => {
    const store = stubStorage();
    expect(saveAdminKey("   ")).toBe(false);
    expect(readAdminKey()).toBeNull();
    expect(store.size).toBe(0);
  });

  it("is forgotten on lock, from storage and from memory", () => {
    const store = stubStorage();
    saveAdminKey("demo-key-123");
    clearAdminKey();
    expect(readAdminKey()).toBeNull();
    expect(store.size).toBe(0);
  });

  it("tells the subscribers when it changes", () => {
    stubStorage();
    const listener = vi.fn();
    const stop = subscribeAdminKey(listener);
    saveAdminKey("demo-key-123");
    clearAdminKey();
    stop();
    saveAdminKey("another-key");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("falls back to memory when the browser refuses storage, and says so", () => {
    vi.stubGlobal("window", {
      get sessionStorage(): never {
        throw new DOMException("denied", "SecurityError");
      },
    });
    expect(adminKeyIsMemoryOnly()).toBe(true);
    expect(saveAdminKey("demo-key-123")).toBe(true);
    expect(readAdminKey()).toBe("demo-key-123");
    clearAdminKey();
    expect(readAdminKey()).toBeNull();
  });

  it("falls back to memory when a write throws (quota)", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException("full", "QuotaExceededError");
        },
        removeItem: () => undefined,
      },
    });
    expect(saveAdminKey("demo-key-123")).toBe(true);
    expect(readAdminKey()).toBe("demo-key-123");
  });
});
