/**
 * The book feed tells its heartbeat (`/healthz`, `health/loops.ts`) of every read of the tracked
 * instruments that succeeded, and of none while that read fails.
 */
import pino from "pino";
import { describe, expect, it } from "vitest";

import { BookFeed } from "./book-feed";
import type { BookStore } from "./book-store";
import { ManualScheduler } from "./book-test-support";
import type { BookTransport } from "./book-transport";

/** A transport that never delivers anything. */
function idleTransport(source: "ws" | "rest"): BookTransport {
  return {
    source,
    start: () => undefined,
    setSymbols: () => undefined,
    isConnected: () => false,
    stop: () => Promise.resolve(),
  };
}

describe("BookFeed heartbeat", () => {
  it("beats on every successful refresh of the tracked set, not while it fails, again once it works", async () => {
    let failing = false;
    const store: BookStore = {
      listTrackedSymbols: () =>
        failing ? Promise.reject(new Error("database unavailable")) : Promise.resolve([]),
      writeBook: () => Promise.resolve(),
      markStale: () => Promise.resolve(),
    };
    const scheduler = new ManualScheduler();
    const feed = new BookFeed({
      store,
      ws: null,
      rest: idleTransport("rest"),
      logger: pino({ level: "silent" }),
      scheduler,
      trackedRefreshMs: 1_000,
      demo: null,
    });
    let beats = 0;
    const controller = new AbortController();
    const run = feed.start({
      signal: controller.signal,
      heartbeat: {
        beat: () => {
          beats += 1;
        },
      },
    });
    try {
      await scheduler.advance(0);
      expect(beats).toBe(1);
      await scheduler.advance(3_000);
      expect(beats).toBe(4);

      failing = true;
      await scheduler.advance(5_000);
      expect(beats).toBe(4);

      failing = false;
      await scheduler.advance(1_000);
      expect(beats).toBe(5);
    } finally {
      controller.abort();
      await run.stopped;
    }
  });
});
