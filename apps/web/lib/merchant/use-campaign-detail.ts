"use client";

import type { CampaignActionResponse } from "@winz/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiFetch, type RouteResponse } from "@/lib/api/client";
import { isMockApi } from "@/lib/api/mock-scenario";
import { useAsync, type AsyncState } from "@/lib/api/use-async";
import { useLiveCampaign } from "@/lib/realtime/use-live-campaign";

import { isRunning } from "./campaigns";
import { detailPollMs, isStale, mergeLiveCampaign, needsReread } from "./live-detail";

export { DETAIL_POLL_MS } from "./live-detail";

export type CampaignDetailData = RouteResponse<"campaignDetail">;
export type CampaignAction = "pause" | "resume" | "close";

const ACTION_ROUTES = {
  pause: "pauseCampaign",
  resume: "resumeCampaign",
  close: "closeCampaign",
} as const;

export interface CampaignDetailState extends Omit<AsyncState<CampaignDetailData>, "data"> {
  campaign: CampaignDetailData | null;
  /**
   * True when the last read of the API failed while a campaign is on screen: the figures are the
   * last ones, and the screen must say so (« reconnecting ») rather than show them as current.
   */
  stale: boolean;
  /**
   * Pause, resume or close. Resolves with what the route answered (the screen shows that, never the
   * state it expects), and throws the `ApiError` of a refusal so the caller can show its message.
   */
  act: (action: CampaignAction) => Promise<CampaignActionResponse>;
}

/**
 * `GET /api/campaigns/:id`, polled until the campaign is over, with its public row pushed by Supabase
 * Realtime on top (`live_campaigns`, see `live-detail.ts` for which figures it carries), plus the
 * three actions of the Controls tab. A sale shows as soon as its row is pushed; while the feed is
 * down or silent the API is asked every 2 seconds, so the re-reads alone show it within 3 seconds
 * (criterion 7). A pushed row newer than the API answer makes the screen ask the API at once, for the
 * money figures and the status that only the API has.
 *
 * After an action, the answer of the route is shown at once, then the API is asked again. The
 * simulated API has no memory: it would answer "live" again to the next poll and undo a pause. In
 * simulated mode only, the route's answer is therefore kept over the polled campaign for as long as
 * it is still running (the same overlay the simulated sign-in uses for the business of M2).
 */
export function useCampaignDetail(id: string, enabled: boolean): CampaignDetailState {
  const mock = isMockApi();
  // The slug of the last answer: the key of the campaign's public row.
  const [slug, setSlug] = useState<string | null>(null);
  const live = useLiveCampaign(slug, enabled);
  const detail = useAsync(
    (signal) => apiFetch("campaignDetail", { params: { id }, signal }),
    [id],
    {
      enabled,
      pollMs: detailPollMs(live.connected),
      shouldPoll: (data) => data.status !== "void" && !data.status.startsWith("settled"),
    },
  );
  const [answer, setAnswer] = useState<CampaignActionResponse | null>(null);
  const { data, reload } = detail;
  // When the API answer on screen arrived (this device's clock), to order it with a pushed row. Taken
  // in the render that first shows the answer, so no render pairs a new answer with an old time.
  const apiAt = useMemo(() => (data === null ? 0 : Date.now()), [data]);

  useEffect(() => {
    if (data !== null) setSlug(data.slug);
  }, [data]);

  // A pushed row that says something the API answer does not: ask the API now, not at the next poll.
  // Only a new row asks again (a new API answer is what that request brings), so the answer it is
  // compared with is read from a ref.
  const { pushed } = live;
  const shown = useRef({ data, apiAt });
  shown.current = { data, apiAt };
  useEffect(() => {
    const { data: answered, apiAt: answeredAt } = shown.current;
    if (answered !== null && pushed !== null && needsReread(answered, answeredAt, pushed)) reload();
  }, [pushed, reload]);

  // A fresh answer from the real API is the truth again.
  useEffect(() => {
    if (!mock) setAnswer(null);
  }, [data, mock]);
  // Another campaign, another history.
  useEffect(() => {
    setAnswer(null);
    setSlug(null);
  }, [id]);

  const act = useCallback(
    async (action: CampaignAction): Promise<CampaignActionResponse> => {
      const response = await apiFetch(ACTION_ROUTES[action], { params: { id } });
      setAnswer(response);
      reload();
      return response;
    },
    [id, reload],
  );

  const merged = data === null ? null : mergeLiveCampaign(data, apiAt, pushed, Date.now());
  const campaign =
    merged !== null && answer !== null && (!mock || isRunning(merged.status))
      ? { ...merged, status: answer.status, saleState: answer.saleState }
      : merged;

  return {
    campaign,
    stale: isStale(campaign !== null, detail.error),
    error: detail.error,
    loading: detail.loading,
    reload,
    act,
  };
}
