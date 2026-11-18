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
    }, 1000);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

function getTickNow(): number {
  if (tickTimer === null) tickNow = Date.now();
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
