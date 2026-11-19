"use client";

import type { HedgeDeskResponse } from "@winz/shared";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api/client";
import { useAsync } from "@/lib/api/use-async";

/** The desk is read again this long after each answer (SCREENS: "polling 2 s"). */
export const HEDGE_DESK_POLL_MS = 2_000;

export interface HedgeDeskState {
  data: HedgeDeskResponse | null;
  /** The error of the last reading. The last good answer stays in `data` while it lasts. */
  error: unknown;
  /** True until the first answer. */
  loading: boolean;
  /** When the last good answer arrived, as an ISO string, or `null` before the first. */
  updatedAt: string | null;
  reload: () => void;
}

/**
 * `GET /api/hedge-desk`, polled. The public route needs no token. Realtime (`live_hedge_desk`) is
 * the other source the spec allows; the polling alone is enough for a desk that changes every few
 * seconds, and it works the same with the mock API, which has no Realtime.
 */
export function useHedgeDesk(): HedgeDeskState {
  const state = useAsync((signal) => apiFetch("hedgeDesk", { signal }), [], {
    pollMs: HEDGE_DESK_POLL_MS,
  });
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const { data } = state;

  useEffect(() => {
    if (data !== null) setUpdatedAt(new Date().toISOString());
  }, [data]);

  return {
    data: state.data,
    error: state.error,
    loading: state.loading && state.data === null,
    updatedAt,
    reload: state.reload,
  };
}
