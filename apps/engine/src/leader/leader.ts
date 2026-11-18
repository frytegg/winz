import { performance } from "node:perf_hooks";

import type { Logger } from "pino";

import { LeaderStartError, LeaderStateError } from "./errors";
import { leaseIsFree, type EngineLeaseStore, type LeaseRow } from "./lease";
import { fenceAfterMs, resolveLeaseSettings, type LeaseSettings } from "./settings";

/**
 * Only one engine works on a database at a time (SPEC section 7, "one sender per database").
 *
 * An `EngineLeader` wraps the engine PROCESS, not `startEngine`: `src/index.ts` builds one and
 * hands it a function that starts the engine's services. The process starts as a STANDBY: it
 * starts none of the services and asks for the lease (`engine_lease`) every `standbyPollMs`, the
 * first time at once. Once it holds the lease it starts the services, exactly as before, and
 * renews the lease every `renewMs`.
 *
 * Self-fencing. A renewal can fail (the database unreachable, a timeout, an answer that the lease
 * is no longer this holder's live lease): the leader keeps trying, and once it has not renewed
 * successfully for `ttlMs - fenceMarginMs` (measured on this process's monotonic clock from the
 * moment the last successful renewal was SENT, which is never after the database stamped it) it
 * stops its services with the engine's normal stop, logs an error saying why, and goes back to
 * standby, where it may take the lease again. The margin is the time the stop has before the
 * lease can expire on the database's clock. When an answer names ANOTHER holder, which must never
 * happen, the leader stops its services at once and logs both holders' ids at error level. When an
 * answer shows that this holder's lease is already free on the database (expired, released, or
 * the row deleted), a standby may take it at any moment: the leader stops at once too.
 *
 * Renewals go on while the services stop, so a clean stop (SIGTERM) keeps the lease until every
 * service has stopped, and only then releases it: a standby takes over at its next look, without
 * waiting for the expiry.
 *
 * A fenced stop that has not finished shortly before the lease can expire (a service stuck on a
 * database call) is declared at fatal level and handed to `onFenceOverrun`, which ends the process
 * in production.
 *
 * What it cannot do: a process paused longer than the ttl (a frozen VM, a debugger) runs no timer,
 * so it cannot fence itself while paused. When it resumes, its fence deadline has passed and the
 * first timer turn stops its services, but whatever each service was doing when it froze finishes
 * first. The README says what still protects each money path then.
 */

/** What `startServices` returns: the engine's `Engine` satisfies it. */
export interface LeaderServices {
  /** Resolves once every service has stopped (after the signal given to `startServices` aborts). */
  stopped: Promise<void>;
}

export type LeaderRole = "standby" | "leader";

/** Where the process stands. "starting", "leading" and "fencing" hold (or just lost) the lease. */
export type LeaderPhase = "idle" | "standby" | "starting" | "leading" | "fencing" | "stopped";

/** The lease as this process sees it, for the health report. Durations in milliseconds. */
export interface LeaseView {
  role: LeaderRole;
  /**
   * Leader: its own holder id. Standby: the holder of the live lease it saw last, or null when
   * the lease is free (or was never seen).
   */
  holder: string | null;
  /** How long `holder` has held the lease, or null. */
  heldForMs: number | null;
  /** How long ago `holder`'s latest renewal was, or null. */
  renewedAgoMs: number | null;
  /**
   * Whether this process can work the lease. A leader: true (one that cannot renew fences itself).
   * A standby: its latest ask for the lease was answered, no more than `ttlMs` ago; false before
   * its first answer, after a failed ask (the table missing, no rights on it, the database
   * failing), and while an ask hangs. A standby that cannot work the lease could never take over:
   * the health report answers 503 for it.
   */
  leaseReachable: boolean;
}

/** Why a period of leadership ended. */
export type LeadEnd =
  | { kind: "stop" }
  /** No successful renewal for `fenceAfterMs`. */
  | { kind: "expired"; sinceRenewalMs: number }
  /** A renewal answered that another holder has the lease. */
  | { kind: "taken"; otherHolder: string }
  /** A renewal answered that this holder's lease is free on the database's clock. */
  | { kind: "lapsed"; row: "expired" | "released" | "absent" }
  /** The services stopped without being asked to (they never do; reported, not hidden). */
  | { kind: "services-ended" };

export type LeaderExit = { kind: "stopped" } | { kind: "failed"; error: Error };

export interface EngineLeaderOptions {
  lease: EngineLeaseStore;
  settings: LeaseSettings;
  /** The leader logs through it as is: give it a child with the module named. */
  logger: Logger;
  /**
   * Starts the engine's services and resolves once they run (`startEngine` and its signal).
   * Called each time this process takes the lease; aborting `signal` stops what it started.
   */
  startServices: (signal: AbortSignal) => Promise<LeaderServices>;
  /** Monotonic milliseconds. Default `performance.now`. */
  monotonic?: () => number;
  /** Called on every phase change, for tests and diagnostics. */
  onPhase?: (phase: LeaderPhase) => void;
  /**
   * Called when the services, stopped by the fence, have still not stopped shortly before the
   * lease can expire (`fenceOverrunAtMs`): a service is stuck, typically on a database call that
   * waits for a connection which never comes. `src/index.ts` ends the process there (exit code 1,
   * the platform starts it again as a standby): the one stop that cannot hang. Default: nothing
   * beyond the fatal log.
   */
  onFenceOverrun?: (overrun: FenceOverrun) => void;
}

export interface FenceOverrun {
  holder: string;
  reason: "expired" | "taken" | "lapsed";
  /** How long the services have been stopping. */
  stoppingForMs: number;
}

/**
 * When a fenced stop that has not finished is declared stuck: `slack` before the earliest time the
 * lease can expire (the last successful renewal, as sent, plus the ttl), with
 * `slack = min(1 000 ms, fenceMarginMs / 4)`. With the defaults: 14 s after the last renewal,
 * 4 s into the stop. For a lease found in another holder's name, or found free, `fenceMarginMs`
 * after the fence.
 */
export function fenceOverrunSlackMs(settings: LeaseSettings): number {
  return Math.min(1_000, Math.floor(settings.fenceMarginMs / 4));
}

interface Observation {
  row: LeaseRow | null;
  /** Monotonic time at which the answer arrived. */
  at: number;
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * How a renewal's answer shows this holder's lease free, or null when it does not: no row at all,
 * or the row released or expired at the statement's time. The caller has already ruled out a row
 * in another holder's name.
 */
function lapsedRow(row: LeaseRow | null): "expired" | "released" | "absent" | null {
  if (row === null) return "absent";
  if (row.releasedAt !== null) return "released";
  if (row.expiresAt.getTime() <= row.dbNow.getTime()) return "expired";
  return null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Keeps a held lease alive: renews it every `renewMs` (one attempt at a time, each given at most
 * `renewMs` before the next one is sent) and resolves `lost` when the leader must stop its
 * services. Only `close()` stops it.
 */
class LeaseKeeper {
  readonly lost: Promise<LeadEnd>;
  private resolveLost: (end: LeadEnd) => void = () => undefined;
  private closed = false;
  private ended = false;
  private renewTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private failures = 0;

  constructor(
    private readonly lease: EngineLeaseStore,
    private readonly settings: LeaseSettings,
    private readonly log: Logger,
    private readonly now: () => number,
    /** Monotonic time at which the acquisition that started this period was sent. */
    private lastOk: number,
    private readonly onRenewed: (sentAt: number) => void,
  ) {
    this.lost = new Promise<LeadEnd>((resolve) => {
      this.resolveLost = resolve;
    });
    this.armWatchdog();
    this.schedule(this.settings.renewMs);
  }

  close(): void {
    this.closed = true;
    if (this.renewTimer !== null) clearTimeout(this.renewTimer);
    if (this.watchdog !== null) clearTimeout(this.watchdog);
  }

  private lose(end: LeadEnd): void {
    if (this.ended) return;
    this.ended = true;
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.resolveLost(end);
  }

  private armWatchdog(): void {
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    if (this.ended || this.closed) return;
    const deadline = this.lastOk + fenceAfterMs(this.settings);
    this.watchdog = setTimeout(
      () => {
        const sinceRenewalMs = this.now() - this.lastOk;
        // A timer may fire a little early: never fence before the deadline.
        if (sinceRenewalMs < fenceAfterMs(this.settings)) this.armWatchdog();
        else this.lose({ kind: "expired", sinceRenewalMs: Math.round(sinceRenewalMs) });
      },
      Math.max(0, deadline - this.now()),
    );
  }

  private schedule(ms: number): void {
    if (this.closed) return;
    this.renewTimer = setTimeout(() => {
      this.renewTimer = null;
      void this.attempt();
    }, ms);
  }

  private async attempt(): Promise<void> {
    // Once the lease is lost, renewing it is pointless: the services are stopping.
    if (this.closed || this.ended) return;
    const sentAt = this.now();
    let settled = false;
    // The next attempt goes out after `renewMs` even when this one hangs (a dead connection).
    const next = setTimeout(() => {
      if (settled || this.closed) return;
      settled = true;
      this.failures += 1;
      this.log.warn(
        { failures: this.failures, waitedMs: this.settings.renewMs },
        "lease renewal did not answer in time: trying again",
      );
      this.schedule(0);
    }, this.settings.renewMs);
    try {
      const result = await this.lease.renew();
      if (this.closed) return;
      if (result.renewed) {
        // A late success still counts, from the time it was sent (the database stamped it later).
        if (sentAt > this.lastOk) {
          this.lastOk = sentAt;
          this.onRenewed(sentAt);
          this.armWatchdog();
        }
        if (this.failures > 0 && !settled) {
          this.log.info({ failures: this.failures }, "lease renewed again");
        }
        if (!settled) this.failures = 0;
      } else if (result.lease !== null && result.lease.holder !== this.lease.holder) {
        if (this.ended) return;
        this.log.error(
          {
            holder: this.lease.holder,
            otherHolder: result.lease.holder,
            otherAcquiredAt: result.lease.acquiredAt.toISOString(),
            otherExpiresAt: result.lease.expiresAt.toISOString(),
          },
          "the engine lease is held by another engine: this engine stops its services at once",
        );
        this.lose({ kind: "taken", otherHolder: result.lease.holder });
      } else if (lapsedRow(result.lease) !== null && sentAt >= this.lastOk) {
        // The database says this holder's lease is free: deleted, released, or expired at the
        // statement's time. No renewal can succeed after that (a renewal needs a live lease), and
        // a standby may take it at its next look, so waiting for the fence deadline would run the
        // services beside it. Only an answer to a renewal sent no earlier than the latest
        // successful one counts: an older one cannot overrule a newer success.
        if (this.ended) return;
        const row = lapsedRow(result.lease) ?? "absent";
        this.log.error(
          {
            holder: this.lease.holder,
            row,
            expiresAt: result.lease?.expiresAt.toISOString() ?? null,
            releasedAt: result.lease?.releasedAt?.toISOString() ?? null,
            dbNow: result.lease?.dbNow.toISOString() ?? null,
          },
          "the engine lease is no longer held on the database: this engine stops its services at once",
        );
        this.lose({ kind: "lapsed", row });
      } else if (!settled) {
        this.failures += 1;
        this.log.warn(
          {
            failures: this.failures,
            row:
              result.lease === null
                ? null
                : {
                    expiresAt: result.lease.expiresAt.toISOString(),
                    releasedAt: result.lease.releasedAt?.toISOString() ?? null,
                    dbNow: result.lease.dbNow.toISOString(),
                  },
          },
          "lease renewal not applied although the row still names this engine: trying again",
        );
      }
    } catch (error: unknown) {
      if (this.closed || settled) return;
      this.failures += 1;
      this.log.warn(
        { failures: this.failures, err: describeError(error) },
        "lease renewal failed: trying again",
      );
    } finally {
      clearTimeout(next);
      if (!settled) {
        settled = true;
        this.schedule(this.settings.renewMs);
      }
    }
  }
}

export class EngineLeader {
  private readonly lease: EngineLeaseStore;
  private readonly settings: LeaseSettings;
  private readonly log: Logger;
  private readonly startServices: (signal: AbortSignal) => Promise<LeaderServices>;
  private readonly now: () => number;
  private readonly onPhase: (phase: LeaderPhase) => void;
  private readonly onFenceOverrun: (overrun: FenceOverrun) => void;
  private readonly stopController = new AbortController();
  private currentPhase: LeaderPhase = "idle";
  private running: Promise<LeaderExit> | null = null;
  private observation: Observation | null = null;
  /** Monotonic time of the standby's latest answered ask, or null (none since it became one). */
  private askAnsweredAt: number | null = null;
  /** The standby's latest ask failed. */
  private askFailing = false;
  /** Monotonic times of the current period of leadership. */
  private acquiredAt = 0;
  private lastRenewedAt = 0;

  constructor(options: EngineLeaderOptions) {
    this.lease = options.lease;
    this.settings = resolveLeaseSettings(options.settings);
    this.log = options.logger;
    this.startServices = options.startServices;
    this.now = options.monotonic ?? ((): number => performance.now());
    this.onPhase = options.onPhase ?? ((): void => undefined);
    this.onFenceOverrun = options.onFenceOverrun ?? ((): void => undefined);
  }

  get holder(): string {
    return this.lease.holder;
  }

  get phase(): LeaderPhase {
    return this.currentPhase;
  }

  /** Whether the engine's services run right now under the lease (the health report's view). */
  servicesRunning(): boolean {
    return this.currentPhase === "leading";
  }

  /** The lease as this process sees it, computed without any I/O. */
  view(): LeaseView {
    const now = this.now();
    const phase = this.currentPhase;
    if (phase === "starting" || phase === "leading" || phase === "fencing") {
      return {
        role: "leader",
        holder: this.lease.holder,
        heldForMs: Math.max(0, Math.round(now - this.acquiredAt)),
        renewedAgoMs: Math.max(0, Math.round(now - this.lastRenewedAt)),
        leaseReachable: true,
      };
    }
    const answeredAt = this.askAnsweredAt;
    const leaseReachable =
      !this.askFailing && answeredAt !== null && now - answeredAt <= this.settings.ttlMs;
    const seen = this.observation;
    const free: LeaseView = {
      role: "standby",
      holder: null,
      heldForMs: null,
      renewedAgoMs: null,
      leaseReachable,
    };
    if (seen === null || seen.row === null || leaseIsFree(seen.row)) return free;
    const elapsed = Math.max(0, now - seen.at);
    const row = seen.row;
    if (row.expiresAt.getTime() - row.dbNow.getTime() <= elapsed) return free;
    return {
      role: "standby",
      holder: row.holder,
      heldForMs: Math.round(row.dbNow.getTime() - row.acquiredAt.getTime() + elapsed),
      renewedAgoMs: Math.round(row.dbNow.getTime() - row.renewedAt.getTime() + elapsed),
      leaseReachable,
    };
  }

  /**
   * Runs until `stop()` (then `{ kind: "stopped" }`) or until the services cannot start or end on
   * their own (`{ kind: "failed" }`, the lease released). Never rejects. Call it once.
   */
  run(): Promise<LeaderExit> {
    if (this.running !== null) throw new LeaderStateError("EngineLeader.run() called twice");
    this.running = this.loop();
    return this.running;
  }

  /**
   * Stops the process's part: a standby stops at once; a leader stops its services with the
   * engine's normal stop, then releases the lease. Resolves once `run()` has finished.
   */
  async stop(): Promise<void> {
    this.stopController.abort();
    if (this.running !== null) await this.running;
  }

  private setPhase(phase: LeaderPhase): void {
    this.currentPhase = phase;
    this.onPhase(phase);
  }

  private async loop(): Promise<LeaderExit> {
    this.log.info(
      {
        holder: this.lease.holder,
        ttlMs: this.settings.ttlMs,
        renewMs: this.settings.renewMs,
        standbyPollMs: this.settings.standbyPollMs,
        fenceAfterMs: fenceAfterMs(this.settings),
      },
      "standby: no service runs until this engine holds the lease",
    );
    try {
      while (!this.stopController.signal.aborted) {
        const acquiredSentAt = await this.standby();
        if (acquiredSentAt === null) break;
        const end = await this.lead(acquiredSentAt);
        if (end !== null) return end;
      }
      return { kind: "stopped" };
    } finally {
      this.setPhase("stopped");
    }
  }

  /** Asks for the lease until it gets it (its send time) or the process stops (null). */
  private async standby(): Promise<number | null> {
    this.setPhase("standby");
    const signal = this.stopController.signal;
    let first = true;
    let failures = 0;
    let lastHolderLogged: string | null = null;
    while (!signal.aborted) {
      if (!first) await sleep(this.settings.standbyPollMs, signal);
      first = false;
      if (signal.aborted) return null;
      const sentAt = this.now();
      try {
        const result = await this.lease.acquire();
        this.observation = { row: result.lease, at: this.now() };
        this.askAnsweredAt = this.observation.at;
        this.askFailing = false;
        if (failures > 0) this.log.info({ failures }, "standby: the database answers again");
        failures = 0;
        if (result.acquired) {
          if (signal.aborted) {
            await this.releaseLease();
            return null;
          }
          return sentAt;
        }
        const holder = result.lease?.holder ?? null;
        if (holder !== lastHolderLogged) {
          lastHolderLogged = holder;
          this.log.info(
            {
              holder: this.lease.holder,
              leaseHolder: holder,
              leaseExpiresAt: result.lease?.expiresAt.toISOString() ?? null,
            },
            "standby: the lease is held by another engine",
          );
        }
      } catch (error: unknown) {
        failures += 1;
        this.askFailing = true;
        // The first failure and every tenth: a standby that cannot reach its database is loud
        // without writing a line a second.
        if (failures === 1 || failures % 10 === 0) {
          this.log.warn(
            { failures, err: describeError(error) },
            "standby: could not ask for the lease",
          );
        }
      }
    }
    return null;
  }

  /**
   * One period of leadership: starts the services, keeps the lease, and stops the services when
   * the process stops (then releases the lease) or the lease is lost (then back to standby).
   * Returns null to go back to standby, or how the run ends.
   */
  private async lead(acquiredSentAt: number): Promise<LeaderExit | null> {
    this.acquiredAt = acquiredSentAt;
    this.lastRenewedAt = acquiredSentAt;
    // Back in standby after this period, the process has to be answered again to count as able
    // to work the lease.
    this.askAnsweredAt = null;
    this.askFailing = false;
    this.setPhase("starting");
    this.log.info({ holder: this.lease.holder }, "lease acquired: starting the engine");

    const keeper = new LeaseKeeper(
      this.lease,
      this.settings,
      this.log,
      this.now,
      acquiredSentAt,
      (sentAt) => {
        this.lastRenewedAt = sentAt;
      },
    );
    const services = new AbortController();
    const stopSignal = this.stopController.signal;
    let resolveStop: (end: LeadEnd) => void = () => undefined;
    const stopRequested = new Promise<LeadEnd>((resolve) => {
      resolveStop = resolve;
    });
    const onStop = (): void => resolveStop({ kind: "stop" });
    if (stopSignal.aborted) onStop();
    else stopSignal.addEventListener("abort", onStop, { once: true });
    try {
      return await this.leadPeriod(keeper, services, stopRequested);
    } finally {
      // One listener per period of leadership, removed when the period ends: fence and
      // re-acquire cycles do not pile them up on the process's stop signal.
      stopSignal.removeEventListener("abort", onStop);
    }
  }

  private async leadPeriod(
    keeper: LeaseKeeper,
    services: AbortController,
    stopRequested: Promise<LeadEnd>,
  ): Promise<LeaderExit | null> {
    const ended = Promise.race([keeper.lost, stopRequested]);
    // The services stop as soon as the period ends, even while they are still starting.
    void ended.then(() => services.abort());

    let running: LeaderServices;
    try {
      running = await this.startServices(services.signal);
    } catch (error: unknown) {
      services.abort();
      keeper.close();
      await this.releaseLease();
      return {
        kind: "failed",
        error: new LeaderStartError(`the engine could not start: ${describeError(error)}`, {
          cause: error,
        }),
      };
    }
    if (!services.signal.aborted) {
      this.setPhase("leading");
      this.log.info({ holder: this.lease.holder }, "engine running under the lease");
    }

    const end = await Promise.race([
      ended,
      running.stopped.then((): LeadEnd => ({ kind: "services-ended" })),
    ]);
    services.abort();
    if (end.kind === "expired") {
      this.log.error(
        {
          holder: this.lease.holder,
          sinceRenewalMs: end.sinceRenewalMs,
          fenceAfterMs: fenceAfterMs(this.settings),
          ttlMs: this.settings.ttlMs,
        },
        "the engine lease could not be renewed in time: stopping the engine's services before it expires",
      );
    }
    if (end.kind !== "stop") this.setPhase("fencing");
    const stopStartedAt = this.now();
    let overrun = this.watchFencedStop(end, stopStartedAt);
    let stopped = false;
    if (end.kind === "stop") {
      // A clean stop keeps renewing the lease; if it loses it meanwhile, the same deadline holds.
      void keeper.lost.then((lost) => {
        if (!stopped) overrun = this.watchFencedStop(lost, stopStartedAt);
      });
    }
    await running.stopped;
    stopped = true;
    if (overrun !== null) clearTimeout(overrun);
    const stopMs = Math.round(this.now() - stopStartedAt);
    keeper.close();

    if (end.kind === "stop") {
      this.log.info({ holder: this.lease.holder, stopMs }, "engine services stopped");
      await this.releaseLease();
      return { kind: "stopped" };
    }
    if (end.kind === "services-ended") {
      await this.releaseLease();
      return {
        kind: "failed",
        error: new LeaderStartError("the engine's services stopped without being asked to"),
      };
    }
    this.log.error(
      { holder: this.lease.holder, stopMs, reason: end.kind },
      "engine services stopped by the lease fence: back to standby",
    );
    return null;
  }

  /** A timer that reports a fenced stop still running when the lease is about to expire. */
  private watchFencedStop(end: LeadEnd, stopStartedAt: number): NodeJS.Timeout | null {
    if (end.kind !== "expired" && end.kind !== "taken" && end.kind !== "lapsed") return null;
    const deadline =
      end.kind === "expired"
        ? this.lastRenewedAt + this.settings.ttlMs - fenceOverrunSlackMs(this.settings)
        : stopStartedAt + this.settings.fenceMarginMs;
    return setTimeout(
      () => {
        const overrun: FenceOverrun = {
          holder: this.lease.holder,
          reason: end.kind,
          stoppingForMs: Math.round(this.now() - stopStartedAt),
        };
        this.log.fatal(
          overrun,
          "the engine's services did not stop before the lease can expire: a service is stuck",
        );
        this.onFenceOverrun(overrun);
      },
      Math.max(0, deadline - this.now()),
    );
  }

  private async releaseLease(): Promise<void> {
    try {
      const releasedAt = await this.lease.release();
      this.log.info(
        { holder: this.lease.holder, released: releasedAt !== null, releasedAt },
        "lease released",
      );
    } catch (error: unknown) {
      this.log.error(
        { holder: this.lease.holder, err: describeError(error) },
        "lease not released: a standby takes over once it expires",
      );
    }
  }
}
