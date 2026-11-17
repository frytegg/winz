import type { Address, Hex } from "viem";
import { z } from "zod";

import type { Db } from "../db";
import { CorruptSenderStateError, TxSenderError } from "./errors";
import { insertChainEvents } from "./events";
import {
  SENDER_STATE_KEY,
  type ChainTx,
  type DecodedEvent,
  type JsonObject,
  type SenderState,
  type SignerName,
  type TxStatus,
} from "./types";

interface ChainTxRow {
  id: string;
  idempotency_key: string;
  signer: SignerName;
  kind: string;
  to_address: string;
  data: string;
  value: bigint;
  payload: JsonObject;
  nonce: bigint | null;
  signer_address: string | null;
  chain_id: number | null;
  tx_hash: string | null;
  status: TxStatus;
  attempts: number;
  last_error: string | null;
  block_number: bigint | null;
  created_at: Date;
  sent_at: Date | null;
  mined_at: Date | null;
}

function toChainTx(row: ChainTxRow): ChainTx {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    signer: row.signer,
    kind: row.kind,
    to: row.to_address as Address,
    data: row.data as Hex,
    value: row.value,
    payload: row.payload,
    nonce: row.nonce,
    signerAddress: row.signer_address as Address | null,
    chainId: row.chain_id,
    txHash: row.tx_hash as Hex | null,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    blockNumber: row.block_number,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    minedAt: row.mined_at,
  };
}

const hexString = z.string().regex(/^0x([0-9a-f]{2})*$/);
const decimalString = z.string().regex(/^[0-9]+$/);
const senderStateSchema = z.object({
  gas: decimalString,
  attempts: z
    .array(
      z.object({
        hash: z.string().regex(/^0x[0-9a-f]{64}$/),
        raw: hexString.min(4),
        maxFeePerGas: decimalString,
        maxPriorityFeePerGas: decimalString,
        signedAt: z.string().min(1),
      }),
    )
    .min(1),
});

/**
 * Reads what the sender stored in a `sent` row. Throws `CorruptSenderStateError` if it is
 * missing or malformed, or if the row's hash is not the hash of its latest attempt: the signed
 * transaction is the only thing that may be broadcast for that nonce.
 */
export function readSenderState(tx: ChainTx): SenderState {
  const state = readSignedAttempts(tx);
  const latest = state.attempts[state.attempts.length - 1];
  if (latest?.hash !== tx.txHash) {
    throw new CorruptSenderStateError(tx.id, "tx_hash is not the hash of the latest attempt");
  }
  return state;
}

/**
 * Reads the signed attempts of any row that was signed (`sent`, `mined`, `reverted`, or a
 * `failed` row that lost its nonce), without the check that the row's hash is the latest
 * attempt's: a final row records the hash that was mined, which can be an earlier attempt.
 */
export function readSignedAttempts(tx: ChainTx): SenderState {
  const parsed = senderStateSchema.safeParse(tx.payload[SENDER_STATE_KEY]);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CorruptSenderStateError(
      tx.id,
      issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid state",
    );
  }
  return parsed.data as SenderState;
}

export interface NewChainTx {
  idempotencyKey: string;
  signer: SignerName;
  kind: string;
  /** Lowercase. */
  to: Address;
  /** Lowercase. */
  data: Hex;
  value: bigint;
  payload: JsonObject;
}

/** A signer role as configured for one run: the key that serves it and the chain it signs for. */
export interface SigningKey {
  signer: SignerName;
  /** Lowercase. */
  address: Address;
  chainId: number;
}

export interface FinalizeInput {
  id: string;
  status: "mined" | "reverted";
  /** Hash that was mined: an earlier attempt can win over its replacement. */
  txHash: Hex;
  blockNumber: bigint;
  minedAt: Date;
  /** Block timestamp, when it could be read. */
  blockTime: Date | null;
  error: string | null;
  events: readonly DecodedEvent[];
}

/**
 * Every statement on `chain_txs`. Each transition is one statement (or one database
 * transaction) guarded by the status it leaves, so a row is never half-written and a second
 * writer loses instead of overwriting.
 */
export class ChainTxStore {
  constructor(private readonly db: Db) {}

  /** Inserts a `queued` row, or returns the row that already holds the idempotency key. */
  async insertQueued(input: NewChainTx): Promise<{ tx: ChainTx; created: boolean }> {
    const inserted = await this.db<ChainTxRow[]>`
      insert into chain_txs (idempotency_key, signer, kind, to_address, data, value, payload)
      values (
        ${input.idempotencyKey}, ${input.signer}, ${input.kind}, ${input.to}, ${input.data},
        ${input.value.toString()}::bigint, ${this.db.json(input.payload)}
      )
      on conflict (idempotency_key) do nothing
      returning *
    `;
    const created = inserted[0];
    if (created) return { tx: toChainTx(created), created: true };
    const existing = await this.db<ChainTxRow[]>`
      select * from chain_txs where idempotency_key = ${input.idempotencyKey}
    `;
    const row = existing[0];
    // The conflicting row is committed before `do nothing` returns, and rows are never deleted.
    if (!row) {
      throw new TxSenderError(`chain_txs row for key '${input.idempotencyKey}' disappeared`);
    }
    return { tx: toChainTx(row), created: false };
  }

  async get(id: string): Promise<ChainTx | undefined> {
    const rows = await this.db<ChainTxRow[]>`select * from chain_txs where id = ${id}`;
    return rows[0] ? toChainTx(rows[0]) : undefined;
  }

  /**
   * The transaction of a signer role that the configured key signed on this chain and that is
   * not final. At most one exists. A `sent` row of another key or chain is never returned: it
   * is `foreignSent`'s, and the sender refuses to start while one exists.
   */
  async oldestSent(key: SigningKey): Promise<ChainTx | undefined> {
    const rows = await this.db<ChainTxRow[]>`
      select * from chain_txs
      where signer = ${key.signer}
        and signer_address = ${key.address}
        and chain_id = ${key.chainId}
        and status = 'sent'
      order by nonce asc
      limit 1
    `;
    return rows[0] ? toChainTx(rows[0]) : undefined;
  }

  /**
   * The oldest `sent` row of a signer role that was signed by another key or for another chain
   * than `key`: a transaction that the sender, configured with `key`, would never complete.
   */
  async foreignSent(key: SigningKey): Promise<ChainTx | undefined> {
    const rows = await this.db<ChainTxRow[]>`
      select * from chain_txs
      where signer = ${key.signer}
        and status = 'sent'
        and (signer_address is distinct from ${key.address} or chain_id is distinct from ${key.chainId})
      order by nonce asc
      limit 1
    `;
    return rows[0] ? toChainTx(rows[0]) : undefined;
  }

  async oldestQueued(signer: SignerName): Promise<ChainTx | undefined> {
    const rows = await this.db<ChainTxRow[]>`
      select * from chain_txs
      where signer = ${signer} and status = 'queued'
      order by created_at asc, id asc
      limit 1
    `;
    return rows[0] ? toChainTx(rows[0]) : undefined;
  }

  /**
   * Highest nonce ever stored for a key on a chain, or `null` if it never signed anything there.
   * Read across roles: the nonce sequence belongs to the key, and the unique index on
   * `(signer_address, chain_id, nonce)` holds whatever role used it.
   */
  async maxNonce(key: Pick<SigningKey, "address" | "chainId">): Promise<bigint | null> {
    const rows = await this.db<{ max: bigint | null }[]>`
      select max(nonce) as max from chain_txs
      where signer_address = ${key.address} and chain_id = ${key.chainId}
    `;
    return rows[0]?.max ?? null;
  }

  /**
   * `queued` → `sent`: stores the nonce, the signing key and chain, the hash and the signed
   * transaction in one statement, before anything is broadcast. False if the row was not
   * `queued` any more.
   */
  async markSent(input: {
    id: string;
    nonce: bigint;
    /** Address of the key that signed; stored lowercase. */
    signerAddress: Address;
    chainId: number;
    txHash: Hex;
    state: SenderState;
    sentAt: Date;
  }): Promise<boolean> {
    const rows = await this.db<{ id: string }[]>`
      update chain_txs
      set status = 'sent',
          nonce = ${input.nonce.toString()}::bigint,
          signer_address = ${input.signerAddress.toLowerCase()},
          chain_id = ${input.chainId},
          tx_hash = ${input.txHash},
          payload = payload || ${this.db.json({ [SENDER_STATE_KEY]: input.state })}::jsonb,
          attempts = attempts + 1,
          last_error = null,
          sent_at = ${input.sentAt}
      where id = ${input.id} and status = 'queued'
      returning id
    `;
    return rows.length === 1;
  }

  /**
   * Stores a replacement (same nonce, higher fee) before it is broadcast. False if the row is
   * not `sent` with `previousHash` any more.
   */
  async replaceAttempt(input: {
    id: string;
    previousHash: Hex;
    txHash: Hex;
    state: SenderState;
  }): Promise<boolean> {
    const rows = await this.db<{ id: string }[]>`
      update chain_txs
      set tx_hash = ${input.txHash},
          payload = payload || ${this.db.json({ [SENDER_STATE_KEY]: input.state })}::jsonb,
          attempts = attempts + 1
      where id = ${input.id} and status = 'sent' and tx_hash = ${input.previousHash}
      returning id
    `;
    return rows.length === 1;
  }

  /**
   * Counts a failed preparation of a `queued` row. Returns the new count and the age of the row
   * in milliseconds, both read by the database (one clock for `created_at` and now), or
   * `undefined` if the row is not `queued` any more.
   */
  async recordPrepareFailure(
    id: string,
    error: string,
  ): Promise<{ attempts: number; ageMs: number } | undefined> {
    const rows = await this.db<{ attempts: number; age_ms: string }[]>`
      update chain_txs
      set attempts = attempts + 1, last_error = ${error}
      where id = ${id} and status = 'queued'
      returning attempts, floor(extract(epoch from (now() - created_at)) * 1000)::text as age_ms
    `;
    const row = rows[0];
    return row ? { attempts: row.attempts, ageMs: Number(row.age_ms) } : undefined;
  }

  /** Notes why a `sent` row is not progressing, without changing anything else. */
  async recordSentError(id: string, error: string): Promise<void> {
    await this.db`
      update chain_txs set last_error = ${error} where id = ${id} and status = 'sent'
    `;
  }

  /** `queued` → `failed`: the transaction is never signed and uses no nonce. */
  async markQueuedFailed(id: string, error: string): Promise<boolean> {
    const rows = await this.db<{ id: string }[]>`
      update chain_txs
      set status = 'failed', last_error = ${error}
      where id = ${id} and status = 'queued'
      returning id
    `;
    return rows.length === 1;
  }

  /**
   * `sent` → `failed` for a transaction that can no longer be mined because another one used
   * its nonce. The nonce and hash are cleared (they describe nothing on-chain); the signed
   * attempts stay in the payload.
   */
  async markSentFailed(id: string, txHash: Hex, error: string): Promise<boolean> {
    const rows = await this.db<{ id: string }[]>`
      update chain_txs
      set status = 'failed', last_error = ${error}, nonce = null, tx_hash = null
      where id = ${id} and status = 'sent' and tx_hash = ${txHash}
      returning id
    `;
    return rows.length === 1;
  }

  /**
   * `sent` → `mined` / `reverted`, together with the events of the receipt, in one database
   * transaction: either both are stored or neither. False if the row was already final.
   */
  async finalize(input: FinalizeInput): Promise<boolean> {
    return this.db.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        update chain_txs
        set status = ${input.status},
            tx_hash = ${input.txHash},
            block_number = ${input.blockNumber.toString()}::bigint,
            mined_at = ${input.minedAt},
            last_error = ${input.error}
        where id = ${input.id} and status = 'sent'
        returning id
      `;
      await insertChainEvents(tx, input.events, input.blockTime);
      return rows.length === 1;
    });
  }
}
