import { randomBytes } from "node:crypto";

import type { Db } from "../db";
import { LeaseConfigError } from "./errors";

/**
 * The engine's lease (table `engine_lease`, one row under `ENGINE_LEASE_NAME`): which engine
 * process works on this database.
 *
 * Each method is ONE statement, so its own transaction, and works through a transaction pooler
 * (no session state: no advisory lock, no LISTEN, no prepared statement). Every decision is taken
 * on the database's clock: the statement reads `clock_timestamp()` once and compares and writes
 * with that value only. That value is read when the statement starts; a statement that then waits
 * on the row's lock decides with a time slightly in the past, which can only make an acquisition
 * harder and a new expiry earlier, never let two holders in.
 *
 * Two acquisitions racing on an empty table, or on an expired row, are serialised by the primary
 * key and the row lock: the second one sees the first one's row (`on conflict ... where`) and
 * finds it neither expired nor its own.
 */

/** The one row's name. */
export const ENGINE_LEASE_NAME = "engine";

/** The lease row, with the database's time at which the statement read or wrote it. */
export interface LeaseRow {
  holder: string;
  acquiredAt: Date;
  renewedAt: Date;
  expiresAt: Date;
  releasedAt: Date | null;
  /** The database's clock when the statement ran. */
  dbNow: Date;
}

/** True when nobody holds the lease at `row.dbNow`: released, or expired. */
export function leaseIsFree(row: LeaseRow): boolean {
  return row.releasedAt !== null || row.expiresAt.getTime() <= row.dbNow.getTime();
}

export type AcquireResult =
  | { acquired: true; lease: LeaseRow }
  /** `lease` is the row as it was (another holder's, unexpired), or null when none was seen. */
  | { acquired: false; lease: LeaseRow | null };

export type RenewResult =
  | { renewed: true; lease: LeaseRow }
  /**
   * The row was not this holder's live lease: another holder's (`lease.holder`), this holder's
   * but expired or released, or no row at all (`lease` null).
   */
  | { renewed: false; lease: LeaseRow | null };

/** What the leader needs of the lease. `PgEngineLease` is the real one; tests wrap it. */
export interface EngineLeaseStore {
  readonly holder: string;
  acquire(): Promise<AcquireResult>;
  renew(): Promise<RenewResult>;
  /**
   * Gives the lease up, only this holder's and only once. The database's time of the release, or
   * null when this holder had nothing to release.
   */
  release(): Promise<Date | null>;
  read(): Promise<LeaseRow | null>;
}

const HOLDER_PATTERN = /^[a-z0-9-]{8,64}$/;

/**
 * A new holder id: `eng-` and 12 random hex characters, drawn once per process. Opaque and short:
 * it names a process in the logs and in `/healthz`, it opens nothing.
 */
export function newHolderId(): string {
  return `eng-${randomBytes(6).toString("hex")}`;
}

interface RawRow {
  holder: string;
  acquired_at: Date;
  renewed_at: Date;
  expires_at: Date;
  released_at: Date | null;
  db_now: Date;
}

interface RawResult extends RawRow {
  won: boolean;
}

function toRow(raw: RawRow): LeaseRow {
  return {
    holder: raw.holder,
    acquiredAt: raw.acquired_at,
    renewedAt: raw.renewed_at,
    expiresAt: raw.expires_at,
    releasedAt: raw.released_at,
    dbNow: raw.db_now,
  };
}

export interface PgEngineLeaseOptions {
  db: Db;
  holder: string;
  /** How long an acquisition or a renewal holds the lease, on the database's clock. */
  ttlMs: number;
  /** Default `ENGINE_LEASE_NAME`. */
  name?: string;
}

export class PgEngineLease implements EngineLeaseStore {
  readonly holder: string;
  private readonly db: Db;
  private readonly ttlMs: number;
  private readonly name: string;

  constructor(options: PgEngineLeaseOptions) {
    if (!HOLDER_PATTERN.test(options.holder)) {
      throw new LeaseConfigError(
        `lease holder must match ${HOLDER_PATTERN.source}, got "${options.holder}"`,
      );
    }
    if (!Number.isInteger(options.ttlMs) || options.ttlMs <= 0) {
      throw new LeaseConfigError(
        `lease ttlMs must be a positive integer, got ${String(options.ttlMs)}`,
      );
    }
    this.db = options.db;
    this.holder = options.holder;
    this.ttlMs = options.ttlMs;
    this.name = options.name ?? ENGINE_LEASE_NAME;
  }

  /**
   * Takes the lease when the row is absent, expired, released, or already this holder's. One
   * statement: two holders racing cannot both succeed. A holder that still holds a live lease
   * keeps its `acquired_at`.
   */
  async acquire(): Promise<AcquireResult> {
    const rows = await this.db<RawResult[]>`
      with clock as (select clock_timestamp() as t),
      attempt as (
        insert into engine_lease as l (name, holder, acquired_at, renewed_at, expires_at)
        select ${this.name}, ${this.holder}, c.t, c.t,
               c.t + ${this.ttlMs}::int * interval '1 millisecond'
        from clock c
        on conflict (name) do update set
          holder = excluded.holder,
          acquired_at = case
            when l.holder = excluded.holder and l.released_at is null
                 and l.expires_at > excluded.renewed_at
            then l.acquired_at
            else excluded.acquired_at
          end,
          renewed_at = excluded.renewed_at,
          expires_at = excluded.expires_at,
          released_at = null
        where l.holder = excluded.holder
           or l.released_at is not null
           or l.expires_at <= excluded.renewed_at
        returning l.holder, l.acquired_at, l.renewed_at, l.expires_at, l.released_at
      )
      select true as won, a.holder, a.acquired_at, a.renewed_at, a.expires_at, a.released_at,
             c.t as db_now
      from attempt a cross join clock c
      union all
      select false as won, l.holder, l.acquired_at, l.renewed_at, l.expires_at, l.released_at,
             c.t as db_now
      from engine_lease l cross join clock c
      where l.name = ${this.name} and not exists (select 1 from attempt)
    `;
    const row = rows[0];
    if (row === undefined) return { acquired: false, lease: null };
    return row.won ? { acquired: true, lease: toRow(row) } : { acquired: false, lease: toRow(row) };
  }

  /**
   * Extends the lease by `ttlMs` from now, only when the row is this holder's, not released and
   * not expired. The answer says whether this holder still has it, and otherwise what the row
   * says (as it was before this statement).
   */
  async renew(): Promise<RenewResult> {
    const rows = await this.db<RawResult[]>`
      with clock as (select clock_timestamp() as t),
      attempt as (
        update engine_lease l
        set renewed_at = c.t, expires_at = c.t + ${this.ttlMs}::int * interval '1 millisecond'
        from clock c
        where l.name = ${this.name}
          and l.holder = ${this.holder}
          and l.released_at is null
          and l.expires_at > c.t
        returning l.holder, l.acquired_at, l.renewed_at, l.expires_at, l.released_at
      )
      select true as won, a.holder, a.acquired_at, a.renewed_at, a.expires_at, a.released_at,
             c.t as db_now
      from attempt a cross join clock c
      union all
      select false as won, l.holder, l.acquired_at, l.renewed_at, l.expires_at, l.released_at,
             c.t as db_now
      from engine_lease l cross join clock c
      where l.name = ${this.name} and not exists (select 1 from attempt)
    `;
    const row = rows[0];
    if (row === undefined) return { renewed: false, lease: null };
    return row.won ? { renewed: true, lease: toRow(row) } : { renewed: false, lease: toRow(row) };
  }

  /** Releases this holder's lease at once: a standby can take it at its next look. */
  async release(): Promise<Date | null> {
    const rows = await this.db<{ released_at: Date }[]>`
      with clock as (select clock_timestamp() as t)
      update engine_lease l
      set released_at = c.t, expires_at = least(l.expires_at, c.t)
      from clock c
      where l.name = ${this.name} and l.holder = ${this.holder} and l.released_at is null
      returning l.released_at
    `;
    return rows[0]?.released_at ?? null;
  }

  /** The row as it is, with the database's time; null when no engine ever took the lease. */
  async read(): Promise<LeaseRow | null> {
    const rows = await this.db<RawRow[]>`
      select l.holder, l.acquired_at, l.renewed_at, l.expires_at, l.released_at,
             clock_timestamp() as db_now
      from engine_lease l
      where l.name = ${this.name}
    `;
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }
}
