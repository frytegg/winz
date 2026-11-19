import { getAddress, type Address } from "viem";

import type { Db } from "../db";
import { defaultCursorName } from "./log-poller";

/**
 * Which chain and which escrow a database belongs to (table `engine_identity`, one row, migration
 * 20261119020000_engine_identity.sql).
 *
 * Two engines on one database take turns (the lease), but campaigns, tickets, chain events and
 * nonces of two chains, or of two escrows, in the same tables cannot be told apart afterwards.
 * The first engine that works on a database records its pair; every later start compares and
 * refuses a database recorded for another pair, before any service runs.
 */
export interface EngineIdentity {
  chainId: number;
  escrowAddress: Address;
}

export interface RecordedIdentity extends EngineIdentity {
  /** When the first engine recorded it, on the database's clock. */
  recordedAt: Date;
}

/** Base class of the identity check's refusals: a configuration error, the start stops. */
export class EngineIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineIdentityError";
  }
}

function describePair(identity: EngineIdentity): string {
  return `chain ${identity.chainId.toString()} and escrow ${identity.escrowAddress}`;
}

const REMEDY =
  "Campaigns, tickets, chain events and nonces of two chains or two escrows cannot share one " +
  "database. Point DB_URL at the database of the configured chain and escrow, or start from an " +
  "empty database (a new one with supabase/migrations applied); or, if this database is the " +
  "right one, fix ARC_CHAIN_ID and ARC_ESCROW_ADDRESS.";

/** The database was recorded for another chain or another escrow than the configured ones. */
export class EngineIdentityMismatchError extends EngineIdentityError {
  constructor(
    public readonly recorded: RecordedIdentity,
    public readonly configured: EngineIdentity,
  ) {
    super(
      `This database belongs to ${describePair(recorded)} (recorded ` +
        `${recorded.recordedAt.toISOString()} by the first engine that worked on it), but this ` +
        `engine is configured for ${describePair(configured)}. ${REMEDY}`,
    );
    this.name = "EngineIdentityMismatchError";
  }
}

/** What a database without an identity already holds of another chain or escrow. */
export interface ForeignHistory {
  /** Chain ids `chain_txs` rows were signed for, other than the configured one. */
  chainIds: number[];
  /** Addresses `chain_txs` rows were sent to, other than the configured escrow. */
  escrows: string[];
  /** Event reader cursors (`chain_cursor`) of other escrows. */
  cursors: string[];
}

/**
 * The database has no identity yet (it predates the table) but already holds work of another
 * chain or escrow: recording the configured pair would mix the two for good.
 */
export class EngineIdentityForeignHistoryError extends EngineIdentityError {
  constructor(
    public readonly configured: EngineIdentity,
    public readonly history: ForeignHistory,
  ) {
    const found = [
      history.chainIds.length > 0
        ? `chain_txs signed for chain ${history.chainIds.map(String).join(", ")}`
        : null,
      history.escrows.length > 0 ? `chain_txs sent to ${history.escrows.join(", ")}` : null,
      history.cursors.length > 0 ? `event reader cursor ${history.cursors.join(", ")}` : null,
    ].filter((item): item is string => item !== null);
    super(
      "This database records no engine identity yet but already holds the work of another chain " +
        `or escrow (${found.join("; ")}), and this engine is configured for ` +
        `${describePair(configured)}. ${REMEDY}`,
    );
    this.name = "EngineIdentityForeignHistoryError";
  }
}

interface IdentityRow {
  chain_id: number;
  escrow_address: string;
  recorded_at: Date;
}

function toRecorded(row: IdentityRow): RecordedIdentity {
  return {
    chainId: row.chain_id,
    escrowAddress: getAddress(row.escrow_address),
    recordedAt: row.recorded_at,
  };
}

/** The recorded identity, or null when no engine has worked on this database since the table. */
export async function readEngineIdentity(db: Db): Promise<RecordedIdentity | null> {
  const [row] = await db<IdentityRow[]>`
    select chain_id, escrow_address, recorded_at from engine_identity where name = 'engine'
  `;
  return row === undefined ? null : toRecorded(row);
}

/** Throws `EngineIdentityMismatchError` when `recorded` is not `configured`. */
export function assertSameIdentity(recorded: RecordedIdentity, configured: EngineIdentity): void {
  if (
    recorded.chainId !== configured.chainId ||
    recorded.escrowAddress.toLowerCase() !== configured.escrowAddress.toLowerCase()
  ) {
    throw new EngineIdentityMismatchError(recorded, {
      chainId: configured.chainId,
      escrowAddress: getAddress(configured.escrowAddress),
    });
  }
}

/**
 * The start check of the database, run by `startEngine` before any service: records `configured`
 * when the database has no identity yet, otherwise compares.
 *
 * The record is one statement, decided by the database: `insert … on conflict do nothing` on the
 * table's single key, so of two engines starting together on an empty database exactly one
 * records its pair and the other reads it back (and refuses if it differs). The same statement
 * refuses to record on a database that already holds work of another chain or escrow (rows of
 * `chain_txs`, a `chain_cursor` of the event reader): that is `EngineIdentityForeignHistoryError`.
 *
 * Returns the identity in force and whether this call recorded it. Writes nothing when it throws.
 */
export async function claimEngineIdentity(
  db: Db,
  configured: EngineIdentity,
): Promise<{ identity: RecordedIdentity; recorded: boolean }> {
  const first = await claimOnce(db, configured);
  if (first !== null) return first;
  // Neither recorded, nor an identity, nor foreign work: the row was there for the insert and
  // gone for the read (an operator deleting it). Once more, from the start.
  const second = await claimOnce(db, configured);
  if (second !== null) return second;
  throw new EngineIdentityError("engine_identity changed twice while this engine read it");
}

async function claimOnce(
  db: Db,
  configured: EngineIdentity,
): Promise<{ identity: RecordedIdentity; recorded: boolean } | null> {
  const chainId = configured.chainId;
  const escrow = configured.escrowAddress.toLowerCase();
  const ownCursor = defaultCursorName(configured.escrowAddress);
  const inserted = await db<IdentityRow[]>`
    insert into engine_identity (name, chain_id, escrow_address)
    select 'engine', ${chainId}, ${escrow}
    where not exists (
      select 1 from chain_txs t
      where (t.chain_id is not null and t.chain_id <> ${chainId}) or t.to_address <> ${escrow}
    )
    and not exists (
      select 1 from chain_cursor c where c.name like 'escrow-logs:%' and c.name <> ${ownCursor}
    )
    on conflict (name) do nothing
    returning chain_id, escrow_address, recorded_at
  `;
  const [row] = inserted;
  if (row !== undefined) return { identity: toRecorded(row), recorded: true };

  // Another engine recorded first (read in a new statement, which sees its committed row), or
  // the database holds foreign work.
  const existing = await readEngineIdentity(db);
  if (existing !== null) {
    assertSameIdentity(existing, configured);
    return { identity: existing, recorded: false };
  }
  const [history] = await db<
    { chain_ids: number[] | null; escrows: string[] | null; cursors: string[] | null }[]
  >`
    select
      (select array_agg(distinct t.chain_id order by t.chain_id) from chain_txs t
        where t.chain_id is not null and t.chain_id <> ${chainId}) as chain_ids,
      (select array_agg(distinct t.to_address order by t.to_address) from chain_txs t
        where t.to_address <> ${escrow}) as escrows,
      (select array_agg(c.name order by c.name) from chain_cursor c
        where c.name like 'escrow-logs:%' and c.name <> ${ownCursor}) as cursors
  `;
  const foreign: ForeignHistory = {
    chainIds: history?.chain_ids ?? [],
    escrows: history?.escrows ?? [],
    cursors: history?.cursors ?? [],
  };
  if (foreign.chainIds.length + foreign.escrows.length + foreign.cursors.length === 0) return null;
  throw new EngineIdentityForeignHistoryError(
    { chainId, escrowAddress: getAddress(configured.escrowAddress) },
    foreign,
  );
}
