"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isAbortError } from "./client";

export interface AsyncState<T> {
  /** The last answer. Kept while a newer one loads, so a list does not flash empty. */
  data: T | null;
  error: unknown;
  /** True from the moment the inputs change (during the debounce) until the answer arrives. */
  loading: boolean;
  reload: () => void;
}

interface AsyncOptions<T> {
  enabled?: boolean;
  /** Wait this long after the last change of `deps` before asking (a search box, a slider). */
  debounceMs?: number;
  /** Ask again this long after each answer, for as long as `shouldPoll` says so. */
  pollMs?: number;
  shouldPoll?: (data: T) => boolean;
}

/**
 * Fetch + revalidation, small on purpose (BRIEF section 7: no cache library). `fetcher` receives an
 * `AbortSignal`: when `deps` change, the request in flight is cancelled, so a slow answer to an old
 * input can never overwrite the answer to the new one.
 */
export function useAsync<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  options: AsyncOptions<T> = {},
): AsyncState<T> {
  const { enabled = true, debounceMs = 0, pollMs, shouldPoll } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(enabled);
  const [reloadKey, setReloadKey] = useState(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const shouldPollRef = useRef(shouldPoll);
  shouldPollRef.current = shouldPoll;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    setLoading(true);

    const run = async (): Promise<void> => {
      try {
        const result = await fetcherRef.current(controller.signal);
        if (controller.signal.aborted) return;
        setData(result);
        setError(null);
        setLoading(false);
        if (pollMs !== undefined && (shouldPollRef.current?.(result) ?? true)) {
          timer = setTimeout(() => void run(), pollMs);
        }
      } catch (caught: unknown) {
        if (controller.signal.aborted || isAbortError(caught)) return;
        setError(caught);
        setLoading(false);
        // A poll that failed once (a dropped connection) tries again; a one-shot does not.
        if (pollMs !== undefined) timer = setTimeout(() => void run(), pollMs);
      }
    };

    timer = setTimeout(() => void run(), debounceMs);
    return () => {
      controller.abort();
      if (timer !== null) clearTimeout(timer);
    };
    // `deps` is the caller's list of inputs; the rest are options that restart the request.
  }, [...deps, enabled, debounceMs, pollMs, reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  return { data, error, loading, reload };
}
