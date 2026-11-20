/**
 * When each long-running loop of the engine last completed a pass, for `/healthz`.
 *
 * On 19-20 November 2026 the sale states stopped moving for about 98 minutes while the rest of the
 * engine worked and `/healthz` answered 200: nothing the probe read (the database, the node, the
 * sender, the job worker) covered a loop that had stopped making passes. Every loop now tells this
 * monitor each time it completes one, and `/healthz` answers 503, naming the loop, once one of them
 * has gone longer than its bound without completing a pass (`healthVerdict`). Render restarts an
 * instance whose health check fails for 60 s, which is the last resort: each loop also bounds its
 * own passes (the sale states end a pass after 15 s, the database client every query after 30 s).
 *
 * A pass counts when it ran to its end without failing. A pass that failed (the database or the
 * node did not answer) does not: the loop is alive but does not do its work, and a loop that keeps
 * failing is as stale as one that hangs. A loop whose one pass can legitimately be long (the chain
 * reader catching up, the projector draining a backlog) also reports its progress within the pass.
 */

/** What a loop calls each time it completes a pass (or, within a long pass, makes progress). */
export interface LoopHeartbeat {
  beat(): void;
}

/** A registered loop: its heartbeat, and the way to report that its service stopped on its own. */
export interface LoopHandle extends LoopHeartbeat {
  /** The loop ended while the engine runs (its service stopped by itself): stale at once. */
  stopped(reason: string): void;
}

/**
 * - `running`: completed a pass within its bound, or was registered less than its bound ago (the
 *   start-up grace: a loop gets its whole bound to complete its first pass);
 * - `stale`: no completed pass for longer than its bound;
 * - `stopped`: its service ended by itself while the engine runs.
 */
export type LoopState = "running" | "stale" | "stopped";

export interface LoopReport {
  name: string;
  state: LoopState;
  /** Epoch milliseconds of the last completed pass, null before the first one. */
  lastPassAtMs: number | null;
  /** Time since the last completed pass, or since registration before the first one. */
  sinceMs: number;
  staleAfterMs: number;
  /** Why it stopped, for `stopped`. */
  detail: string | null;
}

/**
 * The bound of each loop of the engine: how long it may go without completing a pass before
 * `/healthz` reports it. Each is the longest wait a working loop can show (its interval, its
 * longest retry delay after failures, the database client's bound on one call, see
 * `ENGINE_DB_TIMEOUTS`: 30 s per query, 5 s more to drop a connection that does not answer the
 * cancel) with room to spare, so that normal operation, including a short outage of the database
 * or the node followed by its retries, never reaches it. Production defaults; tests pass their own.
 */
export const LOOP_STALE_AFTER_MS = {
  /**
   * A pass every second; a pass is ended after 15 s (`DEFAULT_PASS_TIMEOUT_MS`) and the retries
   * wait 2 s, 4 s, 8 s… (at most 30 s): 60 s is three stuck passes in a row. Every automatic pause
   * (breaker, budget, price, book) and every sales close waits on this loop.
   */
  "sale-states": 60_000,
  /**
   * The job worker polls every 0.5 s, and a failed poll is retried at the next one; a poll is
   * two queries (recover abandoned jobs, claim), each ended by the client within 35 s.
   */
  jobs: 120_000,
  /**
   * The settlement watcher passes every 15 s (one node read, one query; the campaign runs go on
   * beside it), but backs off up to 10 min (`retryMaxMs`) after failures in a row.
   */
  settlement: 900_000,
  /**
   * The escrow's log reader: every 5 s, backoff up to 30 s, and pauses of up to 30 s within a pass
   * while the node rate-limits it (`DEFAULT_RATE_LIMIT_MAX_DELAY_MS`), several in a row. It reports
   * every range it stores, so a long catch-up keeps beating.
   */
  "chain-logs": 300_000,
  /** The projector of chain events: every 1 s, backoff up to 30 s; it reports every batch. */
  "chain-projector": 180_000,
  /** The hedging loops: every 1 s (exposure, runner timers) or 2 s (charges), backoff up to 30 s. */
  "hedging-exposure": 180_000,
  "hedging-tick": 180_000,
  "hedging-charge": 180_000,
  /**
   * The book feed's read of the instruments to follow, every 3 s, retried at the same pace. (The
   * books themselves are watched by the sale states: a book older than 10 s pauses its sales.)
   */
  "feed-refresh": 120_000,
} as const satisfies Record<string, number>;

export type EngineLoopName = keyof typeof LOOP_STALE_AFTER_MS;

/**
 * Watches the end of a service whose loops are registered: a service ends only when the engine's
 * signal aborts, so one whose `stopped` settles before that has stopped by itself, its loops with
 * it. Its loops are then reported `stopped` at once (`/healthz` answers 503 without waiting for
 * their bounds) and `onEnd` is called, with the rejection when there is one, for the log.
 */
export function watchServiceEnd(options: {
  name: string;
  stopped: Promise<void>;
  loops: readonly LoopHandle[];
  signal: AbortSignal;
  onEnd: (error: unknown) => void;
}): void {
  const ended = (error: unknown): void => {
    if (options.signal.aborted) return;
    for (const loop of options.loops) loop.stopped(`the ${options.name} service stopped by itself`);
    try {
      options.onEnd(error);
    } catch {
      // Nothing left to report to; /healthz still says it.
    }
  };
  options.stopped.then(
    () => ended(undefined),
    (error: unknown) => ended(error),
  );
}

interface Entry {
  staleAfterMs: number;
  registeredAtMs: number;
  lastPassAtMs: number | null;
  stoppedReason: string | null;
}

/**
 * The registry the loops beat into and `/healthz` reads. One per process; `startEngine` clears it
 * and registers its loops each time this process takes the lease, and clears it when they stop.
 */
export class LoopMonitor {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Registers `name` (replacing a registration of the same name) with its bound. The loop has its
   * whole bound to complete its first pass.
   */
  register(name: string, staleAfterMs: number): LoopHandle {
    if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
      throw new RangeError(`LoopMonitor: staleAfterMs of ${name} must be a positive number`);
    }
    const entry: Entry = {
      staleAfterMs,
      registeredAtMs: this.now(),
      lastPassAtMs: null,
      stoppedReason: null,
    };
    this.entries.set(name, entry);
    const current = (): boolean => this.entries.get(name) === entry;
    return {
      beat: () => {
        // A loop of an earlier period of leadership that is still finishing: not this one.
        if (current()) entry.lastPassAtMs = this.now();
      },
      stopped: (reason: string) => {
        if (current()) entry.stoppedReason = reason;
      },
    };
  }

  /** Forgets every loop (the engine stopped, or starts again). */
  clear(): void {
    this.entries.clear();
  }

  /** Every registered loop, by name. */
  report(): LoopReport[] {
    const nowMs = this.now();
    return [...this.entries.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, entry]) => {
        const sinceMs = Math.max(0, nowMs - (entry.lastPassAtMs ?? entry.registeredAtMs));
        const state: LoopState =
          entry.stoppedReason !== null
            ? "stopped"
            : sinceMs > entry.staleAfterMs
              ? "stale"
              : "running";
        return {
          name,
          state,
          lastPassAtMs: entry.lastPassAtMs,
          sinceMs,
          staleAfterMs: entry.staleAfterMs,
          detail: entry.stoppedReason,
        };
      });
  }
}
