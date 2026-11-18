import { LeaseConfigError } from "./errors";

/**
 * The lease's timings. Three come from the environment (`ENGINE_LEASE_TTL_MS`,
 * `ENGINE_LEASE_RENEW_MS`, `ENGINE_LEASE_STANDBY_POLL_MS`); the fence margin is fixed in
 * production (`FENCE_MARGIN_MS`) and only tests shorten it, with everything else.
 */
export interface LeaseSettings {
  /** How long an acquisition or a renewal holds the lease, on the database's clock. */
  ttlMs: number;
  /** Interval between two renewals of the leader. */
  renewMs: number;
  /** Interval between two attempts of a standby to take the lease. */
  standbyPollMs: number;
  /**
   * Time kept, before the lease can expire, for the engine's services to stop. A leader that has
   * not renewed for `ttlMs - fenceMarginMs` stops its services by itself (`fenceAfterMs`).
   */
  fenceMarginMs: number;
}

export const DEFAULT_LEASE_TTL_MS = 15_000;
export const DEFAULT_LEASE_RENEW_MS = 3_000;
export const DEFAULT_LEASE_STANDBY_POLL_MS = 1_000;

/**
 * The margin in production: 5 s. It covers `engine.stop()`, measured on the real composition
 * (leader.e2e.test.ts: every service of `startEngine` on a local chain, with a purchase in flight
 * or with the database refusing connections: tens of milliseconds) and on the real process
 * (process.test.ts: SIGTERM to "engine stopped" in 0.5 to 3 s, the Gemini catalogue request in
 * flight being the longest part). A stop can outlast it (a job handler that ignores its abort
 * keeps the job worker up to its 10 s grace; a service waiting on a database that drops
 * connections never returns): the leader then declares the stop stuck before the lease can expire
 * and `src/index.ts` ends the process (`EngineLeaderOptions.onFenceOverrun`).
 */
export const FENCE_MARGIN_MS = 5_000;

/** Bounds of the environment's values (milliseconds). */
export const LEASE_BOUNDS = {
  ttlMs: { min: 10_000, max: 300_000 },
  renewMs: { min: 200, max: 60_000 },
  standbyPollMs: { min: 100, max: 60_000 },
} as const;

/** Time without a successful renewal after which a leader stops its services. */
export function fenceAfterMs(settings: LeaseSettings): number {
  return settings.ttlMs - settings.fenceMarginMs;
}

/**
 * What is wrong with these settings, one message each, or nothing. The rules, whatever the source:
 * every value is a positive integer; the margin is under the ttl; at least three renewals are
 * tried before the leader fences itself (`renewMs * 3 <= ttlMs - fenceMarginMs`, so with the
 * defaults a renewal every 3 s and a fence after 10 s); a standby looks at least once per ttl.
 */
export function leaseSettingsProblems(settings: LeaseSettings): string[] {
  const problems: string[] = [];
  for (const [name, value] of Object.entries(settings)) {
    if (!Number.isInteger(value) || value <= 0) {
      problems.push(`${name} must be a positive integer of milliseconds, got ${String(value)}`);
    }
  }
  if (problems.length > 0) return problems;
  if (settings.fenceMarginMs >= settings.ttlMs) {
    problems.push(
      `the lease ttl (${String(settings.ttlMs)} ms) must be above the fence margin (${String(settings.fenceMarginMs)} ms)`,
    );
    return problems;
  }
  if (settings.renewMs * 3 > fenceAfterMs(settings)) {
    problems.push(
      `the lease renewal (${String(settings.renewMs)} ms) must be at most a third of the ttl minus the fence margin (${String(settings.ttlMs)} - ${String(settings.fenceMarginMs)} ms): at least three renewals are tried before the engine stops itself`,
    );
  }
  if (settings.standbyPollMs > settings.ttlMs) {
    problems.push(
      `the standby poll (${String(settings.standbyPollMs)} ms) must not exceed the lease ttl (${String(settings.ttlMs)} ms)`,
    );
  }
  return problems;
}

/** The settings, checked. Throws `LeaseConfigError` naming every problem. */
export function resolveLeaseSettings(settings: LeaseSettings): LeaseSettings {
  const problems = leaseSettingsProblems(settings);
  if (problems.length > 0) {
    throw new LeaseConfigError(`Invalid lease settings: ${problems.join("; ")}`);
  }
  return { ...settings };
}
