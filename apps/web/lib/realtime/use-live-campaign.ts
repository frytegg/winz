"use client";

import { useEffect, useState } from "react";

import { isMockApi } from "@/lib/api/mock-scenario";

import { campaignRowFrom, newerPush, type PushedCampaign } from "./live-campaign";
import { isFeedLive } from "./live-odds";

interface LiveCampaign {
  /** The newest row pushed for this campaign, or `null` while nothing was pushed. */
  pushed: PushedCampaign | null;
  /** True while the feed is subscribed AND has pushed a row recently (see `isFeedLive`). */
  connected: boolean;
}

function supabaseConfig(): { url: string; key: string } | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  return url === "" || key === "" ? null : { url, key };
}

/**
 * The public row of a campaign (`live_campaigns`), pushed by Supabase Realtime, the way
 * `useLiveOdds` follows `live_instruments`: one channel filtered on the campaign's slug, the anon
 * key (the table is readable by `anon`, nothing personal in it). Each row is read with the shared
 * schema; a malformed row or another campaign's is dropped, and a row older than the one kept never
 * replaces it.
 *
 * Nothing subscribes in the simulated mode, without a slug (not live yet), or without the Supabase
 * variables: the caller then relies on its polling alone.
 */
export function useLiveCampaign(slug: string | null, enabled = true): LiveCampaign {
  const mock = isMockApi();
  const [pushed, setPushed] = useState<PushedCampaign | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [lastPushAt, setLastPushAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const config = supabaseConfig();
    if (mock || !enabled || slug === null || config === null) return;
    let closed = false;
    let cleanup: (() => void) | null = null;

    void import("@supabase/supabase-js")
      .then(({ createClient }) => {
        if (closed) return;
        const client = createClient(config.url, config.key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const channel = client
          .channel(`campaign:${slug}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "live_campaigns",
              filter: `slug=eq.${slug}`,
            },
            (payload) => {
              if (closed) return;
              const row = campaignRowFrom(payload.new, slug);
              if (row === null) return;
              const now = Date.now();
              setPushed((current) => newerPush(current, { row, receivedAt: now }));
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
      })
      // The chunk did not load (a weak connection): the screen keeps its polling, which is the
      // fallback anyway. Nothing to tell the merchant, and no unhandled rejection.
      .catch(() => undefined);

    return () => {
      closed = true;
      setSubscribed(false);
      setLastPushAt(null);
      setPushed(null);
      cleanup?.();
    };
  }, [mock, enabled, slug]);

  useEffect(() => {
    if (!subscribed) return;
    const timer = setInterval(() => setClock(Date.now()), 3000);
    return () => clearInterval(timer);
  }, [subscribed]);

  return { pushed, connected: isFeedLive(subscribed, lastPushAt, clock) };
}
