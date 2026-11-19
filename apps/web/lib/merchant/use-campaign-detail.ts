"use client";

import type { CampaignActionResponse } from "@winz/shared";
import { useCallback, useEffect, useState } from "react";

import { apiFetch, type RouteResponse } from "@/lib/api/client";
import { isMockApi } from "@/lib/api/mock-scenario";
import { useAsync, type AsyncState } from "@/lib/api/use-async";

import { isRunning } from "./campaigns";

/** How often a campaign screen asks the API again (SCREENS, MD: polling every 3 seconds). */
export const DETAIL_POLL_MS = 3000;

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
   * Pause, resume or close. Resolves with what the route answered (the screen shows that, never the
   * state it expects), and throws the `ApiError` of a refusal so the caller can show its message.
   */
  act: (action: CampaignAction) => Promise<CampaignActionResponse>;
}

/**
 * `GET /api/campaigns/:id`, polled every 3 seconds until the campaign is over, plus the three
 * actions of the Controls tab.
 *
 * After an action, the answer of the route is shown at once, then the API is asked again. The
 * simulated API has no memory: it would answer "live" again to the next poll and undo a pause. In
 * simulated mode only, the route's answer is therefore kept over the polled campaign for as long as
 * it is still running (the same overlay the simulated sign-in uses for the business of M2).
 */
export function useCampaignDetail(id: string, enabled: boolean): CampaignDetailState {
  const mock = isMockApi();
  const detail = useAsync(
    (signal) => apiFetch("campaignDetail", { params: { id }, signal }),
    [id],
    {
      enabled,
      pollMs: DETAIL_POLL_MS,
      shouldPoll: (data) => data.status !== "void" && !data.status.startsWith("settled"),
    },
  );
  const [answer, setAnswer] = useState<CampaignActionResponse | null>(null);
  const { data, reload } = detail;

  // A fresh answer from the real API is the truth again.
  useEffect(() => {
    if (!mock) setAnswer(null);
  }, [data, mock]);
  // Another campaign, another history.
  useEffect(() => {
    setAnswer(null);
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

  const campaign =
    data !== null && answer !== null && (!mock || isRunning(data.status))
      ? { ...data, status: answer.status, saleState: answer.saleState }
      : data;

  return { campaign, error: detail.error, loading: detail.loading, reload, act };
}
