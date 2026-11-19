"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = (): (() => void) => () => undefined;

/** False on the server and during hydration, true afterwards: gate anything time-zone dependent. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** One shared timer, started with the first subscriber and stopped with the last. */
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
let tickNow = 0;

function subscribeTick(listener: () => void): () => void {
  tickListeners.add(listener);
  if (tickTimer === null) {
    tickNow = Date.now();
    tickTimer = setInterval(() => {
      tickNow = Date.now();
      for (const notify of tickListeners) notify();
    }, TICK_MS);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

/** How often the shared timer ticks, and how fresh a read is without it. */
export const TICK_MS = 1000;

/**
 * What a read of the clock returns. While the timer runs, the value it last set. Without it (the
 * first render reads before it subscribes), the current time, but renewed at the tick's own pace
 * only: React reads a snapshot twice in a render and compares, and two reads a millisecond apart
 * must be equal ("The result of getSnapshot should be cached").
 */
export function readTick(previous: number, now: number, timerRunning: boolean): number {
  if (timerRunning) return previous;
  return now - previous >= TICK_MS ? now : previous;
}

function getTickNow(): number {
  tickNow = readTick(tickNow, Date.now(), tickTimer !== null);
  return tickNow;
}

/** The current time in milliseconds, refreshed every second. `0` on the server. */
export function useNow(): number {
  return useSyncExternalStore(subscribeTick, getTickNow, () => 0);
}

/** `prefers-reduced-motion: reduce`, live. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}
