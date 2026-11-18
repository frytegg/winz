import type { CancelTimer, Scheduler } from "../../../engine/src/market-data";

/**
 * The time of the whole world: the local chain's block time, followed by the engine, the web
 * routes and the simulated Gemini alike. Quotes expire and sales close by block time, so every
 * clock of the product must read the chain's. It never moves backwards: when the chain is read
 * again, the clock only catches up.
 */
export class WorldClock {
  private offsetMs: number | null = null;

  /** Epoch milliseconds, chain time. */
  readonly now = (): number => Date.now() + (this.offsetMs ?? 0);

  readonly date = (): Date => new Date(this.now());

  /** Aligns the clock on a block timestamp (Unix seconds) the chain just reported. */
  alignOn(chainSeconds: bigint): void {
    const offset = Number(chainSeconds) * 1000 - Date.now();
    if (this.offsetMs === null || offset > this.offsetMs) this.offsetMs = offset;
  }

  /**
   * The engine's book feed runs on this scheduler: the world's time with real timers, so a book
   * re-stamped after a jump of chain time is fresh, and an old one is stale, by the same clock
   * every other subsystem reads.
   */
  scheduler(): Scheduler {
    return {
      now: this.now,
      setTimeout: (callback: () => void, ms: number): CancelTimer => {
        const handle = setTimeout(callback, ms);
        return () => {
          clearTimeout(handle);
        };
      },
    };
  }
}
