"use client";

import { useEffect, useState } from "react";

import { isMockApi } from "@/lib/api/mock-scenario";

import { isFeedLive, oddsFromRow, wobble } from "./live-odds";

/** How often the simulated figure moves. */
const WOBBLE_MS = 2000;

/** Seconds between two polls of the API when the live feed is not connected (BRIEF section 7). */
export const FALLBACK_POLL_MS = 2000;

interface LiveOdds {
  /** The chance in basis points, or `null` when there is no fresh quote. */
  bps: number | null;
  /** True while the live feed is connected: the API then only needs a slow poll. */
  connected: boolean;
}

function supabaseConfig(): { url: string; key: string } | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  return url === "" || key === "" ? null : { url, key };
}

/**
 * The live odds of a promo, for C1 and C3. `apiBps` is what the last API answer said.
 *
 * - Simulated mode (`NEXT_PUBLIC_APP_API_MOCK=true`): no market, so the figure wobbles a little
 *   around `apiBps` every two seconds. Only there.
 * - Otherwise: a Supabase Realtime subscription to `live_instruments` filtered on the promo's
 *   symbol pushes each new quote. The newest of a pushed quote and an API answer shows. `connected`
 *   means the feed is subscribed AND has pushed a row recently (Supabase says "subscribed" even for a
 *   table that does not exist); otherwise the caller polls the API every 2 seconds.
 */
export function useLiveOdds(
  symbol: string | null,
  apiBps: number | null,
  enabled = true,
): LiveOdds {
  const mock = isMockApi();
  const [step, setStep] = useState(0);
  // `null` means nothing was pushed since the last API answer; `{ bps: null }` is a pushed "no quote".
  const [pushed, setPushed] = useState<{ bps: number | null } | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  // When the last row arrived, and a clock that moves while the feed is subscribed, so a feed that
  // goes quiet is noticed.
  const [lastPushAt, setLastPushAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  // An API answer is a quote too: it replaces an older pushed one.
  useEffect(() => {
    setPushed(null);
  }, [apiBps]);

  useEffect(() => {
    if (!mock || !enabled || apiBps === null) return;
    const timer = setInterval(() => setStep((current) => current + 1), WOBBLE_MS);
    return () => clearInterval(timer);
  }, [mock, enabled, apiBps]);

  useEffect(() => {
    const config = supabaseConfig();
    if (mock || !enabled || symbol === null || config === null) return;
    let closed = false;
    let cleanup: (() => void) | null = null;

    void import("@supabase/supabase-js").then(({ createClient }) => {
      if (closed) return;
      const client = createClient(config.url, config.key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const channel = client
        .channel(`odds:${symbol}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "live_instruments",
            filter: `symbol=eq.${symbol}`,
          },
          (payload) => {
            if (closed) return;
            const now = Date.now();
            setPushed({ bps: oddsFromRow(payload.new, now) });
            setLastPushAt(now);
            setClock(now);
          },
        )
        .subscribe((status) => {
          if (!closed) setSubscribed(status === "SUBSCRIBED");
        });
      cleanup = () => {
        void client.removeChannel(channel);
      };
    });

    return () => {
      closed = true;
      setSubscribed(false);
      setLastPushAt(null);
      cleanup?.();
    };
  }, [mock, enabled, symbol]);

  useEffect(() => {
    if (!subscribed) return;
    const timer = setInterval(() => setClock(Date.now()), 3000);
    return () => clearInterval(timer);
  }, [subscribed]);

  const connected = isFeedLive(subscribed, lastPushAt, clock);
  if (mock) {
    return { bps: apiBps === null || step === 0 ? apiBps : wobble(apiBps, step), connected: false };
  }
  return { bps: pushed === null ? apiBps : pushed.bps, connected };
}
