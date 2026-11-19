"use client";

import { BOOK_STALE_AFTER_MS } from "@winz/shared";
import { useEffect, useState } from "react";

/**
 * How fresh what a fan's screen shows is (review 2.4). C1 and the ticket re-read the API every few
 * seconds; when those reads fail, the last answer stays on screen, and its odds must not pass for
 * fresh ones: the API itself hides a quote older than BOOK_STALE_AFTER_MS (10 s, `liveProbabilityBps`
 * on the server), so the screens apply the same bound to their last successful read.
 */

/** The last read is recent enough to sell on: no older than the API's own bound for a quote. */
export function isReadFresh(lastReadAtMs: number | null, nowMs: number): boolean {
  // `null`: nothing re-read yet, what shows is the answer the page was served with. `nowMs` is 0
  // on the server and during hydration (`useNow`).
  if (lastReadAtMs === null || nowMs === 0) return true;
  return nowMs - lastReadAtMs <= BOOK_STALE_AFTER_MS;
}

/**
 * The chance to show: unknown (`null`, « Odds updating… ») as soon as a re-read failed, and while
 * the last successful one is too old, whatever the last answer said.
 */
export function shownOdds(
  bps: number | null,
  read: { failing: boolean; lastReadAtMs: number | null; nowMs: number },
): number | null {
  if (read.failing || !isReadFresh(read.lastReadAtMs, read.nowMs)) return null;
  return bps;
}

/**
 * Wraps a read so that each successful answer stamps the time it arrived, whatever object it hands
 * back: an answer equal to the last one (or the same object, from a cache) is a fresh read all the
 * same, and a read that fails stamps nothing.
 */
export function stampingReads<T>(
  read: (signal: AbortSignal) => Promise<T>,
  onRead: (atMs: number) => void,
  now: () => number = Date.now,
): (signal: AbortSignal) => Promise<T> {
  return async (signal: AbortSignal): Promise<T> => {
    const result = await read(signal);
    if (!signal.aborted) onRead(now());
    return result;
  };
}

/**
 * The time of the page's last successful read, and the `stamp` its reads call (`stampingReads`).
 * `served`: the page was served with an answer, which counts as read at the mount.
 */
export function useReadClock(served: boolean): {
  readAt: number | null;
  stamp: (atMs: number) => void;
} {
  const [readAt, setReadAt] = useState<number | null>(null);
  useEffect(() => {
    if (served) setReadAt((at) => at ?? Date.now());
  }, [served]);
  return { readAt, stamp: setReadAt };
}
