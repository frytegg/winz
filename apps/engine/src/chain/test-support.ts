import pino, { type Logger } from "pino";
import {
  createPublicClient,
  http,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type TransactionReceipt,
} from "viem";

import { ARC_MIN_MAX_FEE_PER_GAS_WEI } from "@winz/shared";

import type { Db } from "../db";
import { startAnvil, type AnvilInstance, type AnvilOptions } from "../testing/anvil";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { TxSender } from "./tx-sender";
import {
  SENDER_STATE_KEY,
  type ChainClient,
  type JsonObject,
  type SenderState,
  type SignerAccounts,
  type SignerName,
  type TxRequest,
  type TxSenderConfig,
  type TxStatus,
} from "./types";

/** Signature of the event the test contract emits; it exists in `winzEscrowAbi`. */
export const TEST_EVENT_SIGNATURE = "BudgetToppedUp(uint64,uint128)";
/** Value of the event's `amount` argument. */
export const TEST_EVENT_AMOUNT = 42n;
/** Custom error of `winzEscrowAbi` the test contract reverts with. */
export const TEST_REVERT_ERROR = "SalesArePaused";
/** Call data that makes the test contract revert: any single byte. */
export const REVERTING_CALL_DATA: Hex = "0x00";

/**
 * Creation code of the test contract, written in raw EVM bytecode (the engine has no Solidity
 * toolchain). Called with exactly one byte of call data it reverts with `SalesArePaused()`.
 * Otherwise it increments a counter in storage slot 0 and emits
 * `BudgetToppedUp(id = counter, amount = 42)`, so "mined exactly once" can be read on-chain.
 */
export function testContractInitCode(): Hex {
  const topic = keccak256(toHex(TEST_EVENT_SIGNATURE)).slice(2);
  const selector = keccak256(toHex(`${TEST_REVERT_ERROR}()`)).slice(2, 10);
  const body = (revertOffset: string): string =>
    [
      "36600114", // CALLDATASIZE PUSH1 1 EQ
      `60${revertOffset}57`, // PUSH1 <revert> JUMPI
      "600054600101", // PUSH1 0 SLOAD PUSH1 1 ADD
      "80600055", // DUP1 PUSH1 0 SSTORE            stack: [counter]
      `60${TEST_EVENT_AMOUNT.toString(16).padStart(2, "0")}600052`, // PUSH1 42 PUSH1 0 MSTORE
      `7f${topic}`, // PUSH32 topic0                 stack: [counter, topic0]
      "60206000a2", // PUSH1 32 PUSH1 0 LOG2         log(mem[0..32], topic0, counter)
      "00", // STOP
    ].join("");
  const revertOffset = (body("00").length / 2).toString(16).padStart(2, "0");
  const runtime = [
    body(revertOffset),
    "5b", // JUMPDEST
    `63${selector}60e01b600052`, // PUSH4 selector PUSH1 224 SHL PUSH1 0 MSTORE
    "60046000fd", // PUSH1 4 PUSH1 0 REVERT
  ].join("");
  const length = (runtime.length / 2).toString(16).padStart(2, "0");
  // PUSH1 len PUSH1 12 PUSH1 0 CODECOPY PUSH1 len PUSH1 0 RETURN, followed by the runtime.
  return `0x60${length}600c60003960${length}6000f3${runtime}`;
}

const GWEI = 1_000_000_000n;

/** Signs and sends a transaction outside the sender, and returns its hash. */
export async function sendDirect(
  client: PublicClient,
  account: LocalAccount,
  chainId: number,
  tx: { nonce: number; to?: Address; data?: Hex; value?: bigint; gas?: bigint },
): Promise<Hex> {
  const raw = await account.signTransaction({
    type: "eip1559",
    chainId,
    nonce: tx.nonce,
    gas: tx.gas ?? 300_000n,
    // High enough for the harness that starts with a 100 gwei base fee.
    maxFeePerGas: 500n * GWEI,
    maxPriorityFeePerGas: 2n * GWEI,
    ...(tx.to ? { to: tx.to } : {}),
    ...(tx.data ? { data: tx.data } : {}),
    ...(tx.value !== undefined ? { value: tx.value } : {}),
  });
  return client.sendRawTransaction({ serializedTransaction: raw });
}

/**
 * A client that forwards to `client` except for the methods given in `overrides`: how tests
 * inject a failing broadcast, a lying fee oracle or a slow receipt.
 */
export function wrapClient(client: ChainClient, overrides: Partial<ChainClient> = {}): ChainClient {
  return {
    getChainId: () => client.getChainId(),
    call: (request) => client.call(request),
    estimateGas: (request) => client.estimateGas(request),
    estimateFeesPerGas: () => client.estimateFeesPerGas(),
    getTransactionCount: (request) => client.getTransactionCount(request),
    sendRawTransaction: (request) => client.sendRawTransaction(request),
    getTransactionReceipt: (request) => client.getTransactionReceipt(request),
    getBlock: (request) => client.getBlock(request),
    ...overrides,
  };
}

/** An error no classifier recognises: what a dropped connection looks like to the sender. */
export function transientError(): Error {
  return Object.assign(new Error("HTTP request failed."), {
    name: "HttpRequestError",
    shortMessage: "HTTP request failed.",
    details: "fetch failed",
  });
}

/** Receipt of a transaction, waiting for it: anvil's automine answers before the block exists. */
export async function receiptOf(client: PublicClient, hash: Hex): Promise<TransactionReceipt> {
  return client.waitForTransactionReceipt({ hash, pollingInterval: 10, timeout: 10_000 });
}

export interface ChainTxSnapshot {
  id: string;
  idempotencyKey: string;
  signer: SignerName;
  kind: string;
  status: TxStatus;
  nonce: bigint | null;
  signerAddress: string | null;
  chainId: number | null;
  txHash: Hex | null;
  attempts: number;
  lastError: string | null;
  blockNumber: bigint | null;
  sentAt: Date | null;
  minedAt: Date | null;
  payload: JsonObject;
  senderState: SenderState | undefined;
}

export async function readChainTxs(db: Db): Promise<ChainTxSnapshot[]> {
  const rows = await db<
    {
      id: string;
      idempotency_key: string;
      signer: SignerName;
      kind: string;
      status: TxStatus;
      nonce: bigint | null;
      signer_address: string | null;
      chain_id: number | null;
      tx_hash: string | null;
      attempts: number;
      last_error: string | null;
      block_number: bigint | null;
      sent_at: Date | null;
      mined_at: Date | null;
      payload: JsonObject;
    }[]
  >`select * from chain_txs order by signer asc, nonce asc nulls last, created_at asc`;
  return rows.map((row) => ({
    id: row.id,
    idempotencyKey: row.idempotency_key,
    signer: row.signer,
    kind: row.kind,
    status: row.status,
    nonce: row.nonce,
    signerAddress: row.signer_address,
    chainId: row.chain_id,
    txHash: row.tx_hash as Hex | null,
    attempts: row.attempts,
    lastError: row.last_error,
    blockNumber: row.block_number,
    sentAt: row.sent_at,
    minedAt: row.mined_at,
    payload: row.payload,
    senderState: row.payload[SENDER_STATE_KEY] as SenderState | undefined,
  }));
}

/**
 * Why a row is not in one of the states the sender may leave behind, or `undefined` if it is.
 * `queued`: nothing assigned. `sent`: nonce, signing address and chain, hash and signed bytes,
 * the hash being the latest attempt's. `mined` / `reverted`: also a block and a time. `failed`: no nonce, no hash.
 */
export function rowInconsistency(row: ChainTxSnapshot): string | undefined {
  const latest = row.senderState?.attempts[row.senderState.attempts.length - 1];
  switch (row.status) {
    case "queued":
      if (
        row.nonce !== null ||
        row.txHash !== null ||
        row.sentAt !== null ||
        row.signerAddress !== null ||
        row.chainId !== null
      ) {
        return "queued row with a nonce, a signing key, a hash or a sent time";
      }
      if (row.senderState !== undefined) return "queued row with a signed transaction";
      return undefined;
    case "failed":
      if (row.nonce !== null || row.txHash !== null) return "failed row holding a nonce or a hash";
      if (row.lastError === null) return "failed row without an error";
      return undefined;
    case "sent":
    case "mined":
    case "reverted":
      if (row.nonce === null || row.txHash === null || row.sentAt === null) {
        return `${row.status} row without nonce, hash or sent time`;
      }
      if (row.signerAddress === null || row.chainId === null) {
        return `${row.status} row without its signing address or chain`;
      }
      if (!latest || !/^0x[0-9a-f]+$/.test(latest.raw)) {
        return `${row.status} row without its signed transaction`;
      }
      if (keccak256(latest.raw) !== latest.hash) return "stored hash is not the hash of the bytes";
      if (row.status === "sent") {
        if (latest.hash !== row.txHash) return "sent row whose hash is not its latest attempt";
        if (row.blockNumber !== null || row.minedAt !== null) return "sent row with a block";
        return undefined;
      }
      if (!row.senderState?.attempts.some((attempt) => attempt.hash === row.txHash)) {
        return "final row whose hash is none of its attempts";
      }
      if (row.blockNumber === null || row.minedAt === null) {
        return `${row.status} row without block number or mined time`;
      }
      return undefined;
  }
}

export interface ChainHarness {
  anvil: AnvilInstance;
  database: TestDatabase;
  db: Db;
  client: PublicClient;
  chainId: number;
  /** anvil accounts 1 and 2; account 0 deploys, account 3 is a bystander. */
  accounts: SignerAccounts;
  privateKeys: Record<SignerName, Hex>;
  deployer: LocalAccount;
  bystander: LocalAccount;
  /** Test contract registered as the escrow: its logs are indexed. */
  escrow: Address;
  /** Same contract at another address: its logs must be ignored. */
  otherContract: Address;
  /** Every log line written by the senders of this harness, as JSON text. */
  logLines: string[];
  logger: Logger;
  /** A sender on this chain and database, stopped by `close()` if the test did not. */
  createSender: (overrides?: {
    client?: ChainClient;
    config?: Partial<TxSenderConfig>;
  }) => TxSender;
  /** A call to the escrow test contract that increments its counter and emits one event. */
  bumpRequest: (signer: SignerName, key: string) => TxRequest;
  rows: () => Promise<ChainTxSnapshot[]>;
  /** How many times a test contract was successfully called. */
  counter: (address: Address) => Promise<bigint>;
  /** Number of mined transactions of an address. */
  minedCount: (address: Address) => Promise<number>;
  close: () => Promise<void>;
}

/** Fast timings for tests; replacement is off unless a test asks for it. */
export const TEST_SENDER_CONFIG = {
  receiptPollMs: 15,
  idlePollMs: 40,
  replaceAfterMs: 120_000,
  // Preparation is given up after `maxPrepareAttempts` alone unless a test sets a time budget.
  maxPrepareMs: 0,
  retryBaseMs: 10,
  retryMaxMs: 80,
  waitPollMs: 20,
  defaultWaitTimeoutMs: 15_000,
} satisfies Partial<TxSenderConfig>;

/** A fresh local chain with the two test contracts deployed, and a fresh database. */
export async function createChainHarness(options: AnvilOptions = {}): Promise<ChainHarness> {
  const anvil = await startAnvil({ ...options, accounts: 4 });
  let database: TestDatabase;
  try {
    database = await createTestDatabase();
  } catch (error: unknown) {
    await anvil.stop();
    throw error;
  }
  const senders: TxSender[] = [];
  const close = async (): Promise<void> => {
    await Promise.allSettled(senders.map((sender) => sender.stop()));
    await anvil.stop();
    await database.drop();
  };

  try {
    const client = createPublicClient({ transport: http(anvil.rpcUrl) });
    const [deployer, relayer, oracle, bystander] = anvil.accounts;
    const [, relayerKey, oracleKey] = anvil.privateKeys;
    if (!deployer || !relayer || !oracle || !bystander || !relayerKey || !oracleKey) {
      throw new Error("anvil did not provide four accounts");
    }

    const deploy = async (nonce: number): Promise<Address> => {
      const hash = await sendDirect(client, deployer, anvil.chainId, {
        nonce,
        data: testContractInitCode(),
      });
      const receipt = await receiptOf(client, hash);
      if (!receipt.contractAddress) throw new Error("test contract was not deployed");
      return receipt.contractAddress.toLowerCase() as Address;
    };
    if (options.noMining) await anvil.rpc("evm_setAutomine", [true]);
    const escrow = await deploy(0);
    const otherContract = await deploy(1);
    if (options.noMining) await anvil.rpc("evm_setAutomine", [false]);

    const logLines: string[] = [];
    const logger = pino(
      { level: "debug", base: undefined },
      { write: (line: string) => void logLines.push(line) },
    );
    const accounts: SignerAccounts = { relayer, oracle };

    return {
      anvil,
      database,
      db: database.db,
      client,
      chainId: anvil.chainId,
      accounts,
      privateKeys: { relayer: relayerKey, oracle: oracleKey },
      deployer,
      bystander,
      escrow,
      otherContract,
      logLines,
      logger,
      createSender: (overrides = {}) => {
        const sender = new TxSender({
          db: database.db,
          client: overrides.client ?? client,
          accounts,
          logger,
          config: {
            chainId: anvil.chainId,
            escrowAddress: escrow,
            ...TEST_SENDER_CONFIG,
            ...overrides.config,
          },
        });
        senders.push(sender);
        return sender;
      },
      bumpRequest: (signer, key) => ({
        idempotencyKey: key,
        signer,
        kind: "test.bump",
        to: escrow,
        data: "0x",
      }),
      rows: () => readChainTxs(database.db),
      counter: async (address) =>
        BigInt((await client.getStorageAt({ address, slot: "0x0" })) ?? "0x0"),
      minedCount: (address) => client.getTransactionCount({ address, blockTag: "latest" }),
      close,
    };
  } catch (error: unknown) {
    await close();
    throw error;
  }
}

/** The fee floor, re-exported so tests compare against the shared constant. */
export const FEE_FLOOR_WEI = ARC_MIN_MAX_FEE_PER_GAS_WEI;

/** Waits until `predicate` holds, failing with `what` after `timeoutMs`. */
export async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
