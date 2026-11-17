import type { Clock, Sleep } from "./types";

/** Resolves after `ms`, or as soon as `signal` aborts. The timer never outlives the wait. */
export const abortableSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const finish = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(0, ms));
    signal?.addEventListener("abort", finish, { once: true });
  });

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: abortableSleep,
};
