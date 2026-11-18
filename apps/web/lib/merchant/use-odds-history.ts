"use client";

import { useEffect, useRef, useState } from "react";

import { appendPoint, loadHistory, saveHistory, type OddsPoint } from "./odds-history";

/** The chart takes a reading this often, whether or not the figure moved. */
const SAMPLE_MS = 5000;

/**
 * The points of the live-chance chart: the ones kept for this campaign in the tab's session, plus a
 * new one every few seconds while `enabled` and a quote exists. `bps` is the chance as the screen
 * sees it (the API, or the live feed on top of it).
 */
export function useOddsHistory(
  campaignId: string,
  bps: number | null,
  enabled: boolean,
): OddsPoint[] {
  const [points, setPoints] = useState<OddsPoint[]>([]);
  const latest = useRef(bps);
  latest.current = bps;
  const hasQuote = bps !== null;

  useEffect(() => {
    setPoints(loadHistory(campaignId));
  }, [campaignId]);

  useEffect(() => {
    if (!enabled || !hasQuote) return;
    const sample = (): void => {
      const value = latest.current;
      if (value === null) return;
      setPoints((current) => {
        const next = appendPoint(current, { t: Date.now(), bps: value });
        if (next.length === current.length && next[next.length - 1] === current[current.length - 1])
          return current;
        saveHistory(campaignId, next);
        return next;
      });
    };
    sample();
    const timer = setInterval(sample, SAMPLE_MS);
    return () => clearInterval(timer);
  }, [campaignId, enabled, hasQuote]);

  return points;
}
