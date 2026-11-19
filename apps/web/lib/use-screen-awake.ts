"use client";

import { useEffect } from "react";

/**
 * Keeps the screen from dimming and locking while `active` (the Screen Wake Lock API). A QR code held
 * up at the counter is useless once the phone goes dark. The browser drops the lock whenever the page
 * is hidden, so it is asked for again when the page comes back. Where the API does not exist (older
 * Safari, an insecure page) or refuses (low battery), nothing happens: the code still shows.
 */
export function useScreenAwake(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire(): Promise<void> {
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) await next.release();
        else lock = next;
      } catch {
        // Refused (battery saver, permissions policy): the screen may dim, the code still scans.
      }
    }

    function onVisible(): void {
      if (document.visibilityState === "visible" && (lock === null || lock.released)) {
        void acquire();
      }
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (lock !== null) void lock.release().catch(() => undefined);
    };
  }, [active]);
}
