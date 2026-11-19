/**
 * The engine's start checks: the escrow's relayer and oracle are the configured keys (local
 * chain, real escrow), and the database belongs to the configured chain and escrow (real
 * Postgres), each one run alone and through the real `startEngine`, which must then start
 * nothing and write nothing.
 */
import { getAddress, type Address, type LocalAccount } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startEngine, type RunningService } from "../app";
import { createDb, type Db } from "../db";
import { createJobsHarness, type JobsHarness } from "../jobs/handlers/test-support";
import { HarnessBookFeed, LEADER_E2E_TUNING } from "../leader/test-support";
import type { HandFedBooks } from "../jobs/handlers/test-support";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import {
  EngineIdentityForeignHistoryError,
  EngineIdentityMismatchError,
  claimEngineIdentity,
  readEngineIdentity,
} from "./engine-identity";
import { ChainIdMismatchError } from "./errors";
import {
  EscrowNotFoundError,
  EscrowRolesMismatchError,
  EscrowRolesUnreadableError,
  checkEscrowRoles,
} from "./escrow-roles";
import { capturingLogger } from "./ingest-test-support";

const OTHER_ESCROW = "0x81d2d4050e617184b2b832c30be68f8811b37d2c" as Address;

/** The harness's book feed, recording its start in `starts`. */
class CountingBookFeed extends HarnessBookFeed {
  constructor(
    books: HandFedBooks,
    private readonly starts: string[],
  ) {
    super(books, () => []);
  }

  override start(options: { signal: AbortSignal }): RunningService {
    this.starts.push("book-feed");
    return super.start(options);
  }
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof Error) return error;
    throw new Error(`rejected with a non-error: ${String(error)}`, { cause: error });
  }
  throw new Error("expected a rejection");
}

describe("checkEscrowRoles on a local chain", () => {
  let harness: JobsHarness;

  beforeAll(async () => {
    harness = await createJobsHarness();
  });
  afterAll(async () => {
    await harness.close();
  });

  function check(
    accounts: { relayer: LocalAccount; oracle: LocalAccount },
    overrides: { escrowAddress?: Address; chainId?: number } = {},
  ): Promise<{ relayer: Address; oracle: Address }> {
    return checkEscrowRoles({
      client: harness.escrow.publicClient,
      chainId: overrides.chainId ?? harness.escrow.chainId,
      escrowAddress: overrides.escrowAddress ?? harness.escrow.escrow,
      accounts,
    });
  }

  /** No private key of the local chain appears in `text`. */
  function expectNoKey(text: string): void {
    for (const key of harness.anvil.privateKeys) {
      expect(text.toLowerCase()).not.toContain(key.slice(2).toLowerCase());
    }
  }

  it("passes with the escrow's own relayer and oracle, and returns them", async () => {
    const { relayer, oracle } = harness.escrow.accounts;
    expect(await check({ relayer, oracle })).toEqual({
      relayer: getAddress(relayer.address),
      oracle: getAddress(oracle.address),
    });
  });

  it("refuses the two keys swapped, says they are swapped, and names both addresses", async () => {
    const { relayer, oracle } = harness.escrow.accounts;
    const error = await rejection(check({ relayer: oracle, oracle: relayer }));

    expect(error).toBeInstanceOf(EscrowRolesMismatchError);
    expect((error as EscrowRolesMismatchError).swapped).toBe(true);
    expect(error.message).toContain("swapped");
    expect(error.message).toContain(getAddress(relayer.address));
    expect(error.message).toContain(getAddress(oracle.address));
    expectNoKey(error.message);
  });

  it("refuses a foreign key as the relayer, naming the escrow's relayer and the configured one", async () => {
    const { oracle, merchant, relayer } = harness.escrow.accounts;
    const error = await rejection(check({ relayer: merchant, oracle }));

    expect(error).toBeInstanceOf(EscrowRolesMismatchError);
    const mismatch = error as EscrowRolesMismatchError;
    expect(mismatch.swapped).toBe(false);
    expect(mismatch.mismatches).toEqual([
      {
        role: "relayer",
        escrow: getAddress(relayer.address),
        configured: getAddress(merchant.address),
      },
    ]);
    expect(error.message).toContain("ARC_RELAYER_PRIVATE_KEY");
    expect(error.message).not.toContain("ARC_ORACLE_PRIVATE_KEY is the key");
    expectNoKey(error.message);
  });

  it("refuses a foreign key as the oracle alone, naming the escrow's oracle and the configured one", async () => {
    const { relayer, merchant, oracle } = harness.escrow.accounts;
    const error = await rejection(check({ relayer, oracle: merchant }));

    expect(error).toBeInstanceOf(EscrowRolesMismatchError);
    const mismatch = error as EscrowRolesMismatchError;
    expect(mismatch.swapped).toBe(false);
    expect(mismatch.mismatches).toEqual([
      {
        role: "oracle",
        escrow: getAddress(oracle.address),
        configured: getAddress(merchant.address),
      },
    ]);
    expect(error.message).toContain("ARC_ORACLE_PRIVATE_KEY is the key");
    expect(error.message).toContain(getAddress(oracle.address));
    expect(error.message).toContain(getAddress(merchant.address));
    expect(error.message).not.toContain("ARC_RELAYER_PRIVATE_KEY is the key");
    expectNoKey(error.message);
  });

  it("refuses an escrow address with no contract code", async () => {
    const { relayer, oracle, merchant } = harness.escrow.accounts;
    const error = await rejection(
      check({ relayer, oracle }, { escrowAddress: getAddress(merchant.address) }),
    );
    expect(error).toBeInstanceOf(EscrowNotFoundError);
    expect(error.message).toContain(getAddress(merchant.address));
    expect(error.message).toContain("no contract code");
  });

  it("refuses a contract that is not an escrow (the token)", async () => {
    const { relayer, oracle } = harness.escrow.accounts;
    const error = await rejection(
      check({ relayer, oracle }, { escrowAddress: harness.escrow.usdc }),
    );
    expect(error).toBeInstanceOf(EscrowRolesUnreadableError);
  });

  it("refuses a node on another chain than the configured one", async () => {
    const { relayer, oracle } = harness.escrow.accounts;
    const error = await rejection(check({ relayer, oracle }, { chainId: 1 }));
    expect(error).toBeInstanceOf(ChainIdMismatchError);
  });
});

describe("claimEngineIdentity on Postgres", () => {
  let database: TestDatabase;
  const pair = { chainId: 5_042_002, escrowAddress: getAddress(OTHER_ESCROW) };

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.drop();
  });
  beforeEach(async () => {
    await database.db`truncate table engine_identity, chain_txs, chain_cursor`;
  });

  it("records the pair on the first start, and only compares afterwards", async () => {
    expect(await readEngineIdentity(database.db)).toBeNull();
    const first = await claimEngineIdentity(database.db, pair);
    expect(first.recorded).toBe(true);
    expect(first.identity).toMatchObject(pair);

    const again = await claimEngineIdentity(database.db, {
      ...pair,
      escrowAddress: OTHER_ESCROW.toLowerCase() as Address,
    });
    expect(again.recorded).toBe(false);
    expect(again.identity.recordedAt).toEqual(first.identity.recordedAt);
    const [row] = await database.db<
      { escrow_address: string }[]
    >`select escrow_address from engine_identity`;
    expect(row?.escrow_address).toBe(OTHER_ESCROW.toLowerCase());
  });

  it("refuses another chain id, naming the recorded pair and the configured one", async () => {
    await claimEngineIdentity(database.db, pair);
    const error = await rejection(claimEngineIdentity(database.db, { ...pair, chainId: 31_337 }));
    expect(error).toBeInstanceOf(EngineIdentityMismatchError);
    expect(error.message).toContain("chain 5042002");
    expect(error.message).toContain("chain 31337");
    expect(error.message).toContain(getAddress(OTHER_ESCROW));
    expect(error.message).toContain("empty database");
  });

  it("refuses another escrow", async () => {
    await claimEngineIdentity(database.db, pair);
    const other = getAddress("0x00000000000000000000000000000000000000aa");
    const error = await rejection(
      claimEngineIdentity(database.db, { ...pair, escrowAddress: other }),
    );
    expect(error).toBeInstanceOf(EngineIdentityMismatchError);
    expect(error.message).toContain(other);
    expect((await readEngineIdentity(database.db))?.escrowAddress).toBe(getAddress(OTHER_ESCROW));
  });

  it("lets exactly one of two engines racing on an empty database record its pair", async () => {
    const pools: Db[] = [createDb(database.url, { max: 1 }), createDb(database.url, { max: 1 })];
    try {
      for (let round = 0; round < 10; round += 1) {
        await database.db`truncate table engine_identity`;
        const pairs = [pair, { ...pair, chainId: 31_337 + round }];
        const results = await Promise.allSettled(
          pairs.map((candidate, index) => claimEngineIdentity(pools[index]!, candidate)),
        );
        const recorded = results.filter(
          (result) => result.status === "fulfilled" && result.value.recorded,
        );
        const refused = results.filter(
          (result) =>
            result.status === "rejected" && result.reason instanceof EngineIdentityMismatchError,
        );
        expect(recorded).toHaveLength(1);
        expect(refused).toHaveLength(1);
        const [count] = await database.db<
          { n: bigint }[]
        >`select count(*) as n from engine_identity`;
        expect(count?.n).toBe(1n);
      }
    } finally {
      await Promise.all(pools.map((pool) => pool.end({ timeout: 5 })));
    }
  });

  it("does not record on a database that already holds another chain's or escrow's work", async () => {
    await database.db`
      insert into chain_txs (idempotency_key, signer, kind, to_address, data)
      values ('k-1', 'relayer', 'buyFor', '0x00000000000000000000000000000000000000bb', '0x')
    `;
    await database.db`
      insert into chain_cursor (name, block_number)
      values ('escrow-logs:0x00000000000000000000000000000000000000cc', 12)
    `;
    const error = await rejection(claimEngineIdentity(database.db, pair));
    expect(error).toBeInstanceOf(EngineIdentityForeignHistoryError);
    expect(error.message).toContain("0x00000000000000000000000000000000000000bb");
    expect(error.message).toContain("escrow-logs:0x00000000000000000000000000000000000000cc");
    expect(await readEngineIdentity(database.db)).toBeNull();
  });

  it("records on a database whose history is its own (positive control)", async () => {
    await database.db`
      insert into chain_txs (idempotency_key, signer, kind, to_address, data)
      values ('k-1', 'relayer', 'buyFor', ${OTHER_ESCROW.toLowerCase()}, '0x')
    `;
    await database.db`
      insert into chain_cursor (name, block_number)
      values (${`escrow-logs:${OTHER_ESCROW.toLowerCase()}`}, 12)
    `;
    expect((await claimEngineIdentity(database.db, pair)).recorded).toBe(true);
  });
});

describe("startEngine runs the start checks before any service", () => {
  let harness: JobsHarness;

  beforeAll(async () => {
    harness = await createJobsHarness();
  });
  afterAll(async () => {
    await harness.close();
  });
  beforeEach(async () => {
    await harness.db`truncate table engine_identity`;
  });

  /** A book feed and a background service that record their starts in `starts`. */
  function probes(starts: string[]): {
    bookFeed: CountingBookFeed;
    background: { name: string; start: (signal: AbortSignal) => RunningService };
  } {
    const bookFeed = new CountingBookFeed(harness.books, starts);
    const background = {
      name: "probe",
      start: (signal: AbortSignal): RunningService => {
        starts.push("background");
        return {
          stopped: new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener("abort", () => resolve(), { once: true });
          }),
        };
      },
    };
    return { bookFeed, background };
  }

  /** `startEngine` on the harness; every service start is recorded in `starts`. */
  async function start(
    overrides: { relayer?: LocalAccount; oracle?: LocalAccount },
    signal: AbortSignal,
    starts: string[],
  ): Promise<{ stopped: Promise<void> }> {
    const { bookFeed, background } = probes(starts);
    const engine = await startEngine({
      db: harness.db,
      logger: capturingLogger().logger,
      publicClient: harness.escrow.publicClient,
      accounts: {
        relayer: overrides.relayer ?? harness.escrow.accounts.relayer,
        oracle: overrides.oracle ?? harness.escrow.accounts.oracle,
      },
      chainId: harness.escrow.chainId,
      escrowAddress: harness.escrow.escrow,
      escrowDeployBlock: harness.escrow.deployedAtBlock,
      bookFeed,
      payments: harness.gateway,
      identity: harness.identity,
      venueName: "paper",
      background: [background],
      signal,
      now: harness.clock.now,
      tuning: LEADER_E2E_TUNING,
    });
    return { stopped: engine.stopped };
  }

  async function writes(): Promise<{ identity: bigint; txs: bigint; events: bigint }> {
    const [row] = await harness.db<{ identity: bigint; txs: bigint; events: bigint }[]>`
      select (select count(*) from engine_identity) as identity,
             (select count(*) from chain_txs) as txs,
             (select count(*) from chain_events) as events
    `;
    if (!row) throw new Error("no count row");
    return row;
  }

  it("starts with the right keys and records the database's identity", async () => {
    const controller = new AbortController();
    const starts: string[] = [];
    const engine = await start({}, controller.signal, starts);
    try {
      expect(starts).toEqual(["book-feed", "background"]);
      expect(await readEngineIdentity(harness.db)).toMatchObject({
        chainId: harness.escrow.chainId,
        escrowAddress: getAddress(harness.escrow.escrow),
      });
    } finally {
      controller.abort();
      await engine.stopped;
    }
  });

  it("refuses swapped keys: no service started, nothing written", async () => {
    const before = await writes();
    const { relayer, oracle } = harness.escrow.accounts;
    const starts: string[] = [];
    const error = await rejection(
      start({ relayer: oracle, oracle: relayer }, new AbortController().signal, starts),
    );
    expect(error).toBeInstanceOf(EscrowRolesMismatchError);
    expect(starts).toEqual([]);
    expect(await writes()).toEqual({ ...before, identity: 0n });
  });

  it("refuses a database recorded for another escrow: no service started, nothing written", async () => {
    await harness.db`
      insert into engine_identity (chain_id, escrow_address)
      values (${harness.escrow.chainId}, ${OTHER_ESCROW.toLowerCase()})
    `;
    const before = await writes();
    const starts: string[] = [];
    const error = await rejection(start({}, new AbortController().signal, starts));
    expect(error).toBeInstanceOf(EngineIdentityMismatchError);
    expect(starts).toEqual([]);
    expect(error.message).toContain(getAddress(OTHER_ESCROW));
    expect(error.message).toContain(getAddress(harness.escrow.escrow));
    expect(await writes()).toEqual(before);
    expect((await readEngineIdentity(harness.db))?.escrowAddress).toBe(getAddress(OTHER_ESCROW));
  });

  it("refuses a database recorded for another chain id: no service started, nothing written", async () => {
    await harness.db`
      insert into engine_identity (chain_id, escrow_address)
      values (31337, ${harness.escrow.escrow.toLowerCase()})
    `;
    const before = await writes();
    const starts: string[] = [];
    const error = await rejection(start({}, new AbortController().signal, starts));
    expect(error).toBeInstanceOf(EngineIdentityMismatchError);
    expect(starts).toEqual([]);
    expect(error.message).toContain("chain 31337");
    expect(error.message).toContain(`chain ${harness.escrow.chainId.toString()}`);
    expect(await writes()).toEqual(before);
  });
});
