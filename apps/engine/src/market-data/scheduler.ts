import { systemClock, type Clock } from "./rate-limiter";

/** Cancels a scheduled callback. Calling it after the callback ran, or twice, does nothing. */
export type CancelTimer = () => void;

/**
 * Time and timers of the book feed, injected so tests drive them by hand while the Postgres
 * driver keeps the real ones.
 */
export interface Scheduler {
  now: Clock;
  setTimeout(callback: () => void, ms: number): CancelTimer;
}

export const systemScheduler: Scheduler = {
  now: systemClock,
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    return () => {
      clearTimeout(handle);
    };
  },
};

/** A `Sleep` on top of a scheduler, for the rate limiter of a client the feed shares. */
export function schedulerSleep(scheduler: Scheduler): (ms: number) => Promise<void> {
  return (ms) =>
    new Promise((resolve) => {
      scheduler.setTimeout(resolve, ms);
    });
}
