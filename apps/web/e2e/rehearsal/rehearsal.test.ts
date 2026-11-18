import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createTestClient,
  erc20Abi,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";

import { createArcClients } from "../../../engine/src/chain";
import { demoWalletAddress } from "../../../engine/src/identity";
import { startAnvil, type AnvilInstance } from "../../../engine/src/testing/anvil";
import { deployTestEscrow, testUsdcAbi, type TestEscrow } from "../../../engine/src/testing/escrow";
import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import { sweepWallets } from "./chain";
import { RpcMeter, meteredClient, rateLimitAnswer } from "./rpc";
import {
  ENGINE_START_MARGIN_BLOCKS,
  LOCAL_CHAIN_ID,
  recoverRehearsal,
  runRehearsal,
  secretsOf,
} from "./runner";
import { buyerEmail, merchantEmail } from "./scenario";
import {
  RehearsalRefusedError,
  type NodeFault,
  type NodeRequestInfo,
  type RecoveryOptions,
  type RecoveryReceipt,
  type RehearsalOptions,
  type RehearsalReceipt,
  type ScenarioInput,
} from "./types";

/**
 * The rehearsal against a local chain in real time: the contract and the token deployed by the
 * test helper, the simulated Gemini, the engine with its production intervals. Small numbers so
 * that one run stays near a minute and a half.
 */

process.env.APP_LOG_LEVEL ??= "warn";

const RUN_TIMEOUT_MS = 240_000;

let anvil: AnvilInstance;
const cleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  anvil = await startAnvil({ chainId: LOCAL_CHAIN_ID, accounts: 5 });
});
afterAll(async () => {
  await anvil?.stop();
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Setup {
  escrow: TestEscrow;
  database: TestDatabase;
  receiptDir: string;
  lines: string[];
  seed: Hex;
}

async function setup(
  options: {
    treasuryFunds?: bigint;
    treasuryIsRelayer?: boolean;
    database?: TestDatabase;
    escrow?: TestEscrow;
  } = {},
): Promise<Setup> {
  const escrow =
    options.escrow ??
    (await deployTestEscrow(anvil, {
      ...(options.treasuryFunds === undefined ? {} : { treasuryFunds: options.treasuryFunds }),
      ...(options.treasuryIsRelayer === undefined
        ? {}
        : { treasuryIsRelayer: options.treasuryIsRelayer }),
    }));
  let database = options.database;
  if (database === undefined) {
    const created = await createTestDatabase();
    database = created;
    cleanups.push(() => created.drop());
  }
  // REHEARSAL_TEST_DIR keeps the receipts of the tests for reading; by default they are removed.
  const keep = process.env.REHEARSAL_TEST_DIR;
  const receiptDir = await mkdtemp(join(keep ?? tmpdir(), "winz-rehearsal-test-"));
  if (keep === undefined) cleanups.push(() => rm(receiptDir, { recursive: true, force: true }));
  return {
    escrow,
    database,
    receiptDir,
    lines: [],
    seed: `0x${randomBytes(32).toString("hex")}` as Hex,
  };
}

function optionsFor(
  s: Setup,
  scenario: ScenarioInput,
  extra: Partial<RehearsalOptions> = {},
): RehearsalOptions {
  const relayerKey = anvil.privateKeys[1];
  const oracleKey = anvil.privateKeys[2];
  if (relayerKey === undefined || oracleKey === undefined) throw new Error("anvil keys missing");
  return {
    databaseUrl: s.database.url,
    rpcUrl: anvil.rpcUrl,
    chainId: LOCAL_CHAIN_ID,
    local: false,
    escrowAddress: s.escrow.escrow,
    escrowDeployBlock: s.escrow.deployedAtBlock,
    secrets: { relayerKey, oracleKey, demoSeed: s.seed },
    scenario,
    gemini: { kind: "simulated" },
    estimateOnly: false,
    receiptDir: s.receiptDir,
    out: (line) => s.lines.push(line),
    // Shorter than the production defaults, so that a stuck step still ends in a FAILED receipt
    // (engine stopped, wallets swept) well within the test's own timeout.
    timeouts: {
      catalogMs: 30_000,
      liveMs: 30_000,
      openMs: 30_000,
      saleMs: 30_000,
      hedgingMs: 120_000,
      closeMs: 60_000,
      settleMs: 60_000,
      engineStopMs: 20_000,
    },
    // Shorter delays than production's (1 s doubling to 16 s), long enough to outlast a burst of
    // refusals of the faulty node below.
    readRetry: READ_RETRY,
    // As in the other end-to-end scenarios: E2E_LOG_FILE collects the engine's log when set.
    ...(process.env.E2E_LOG_FILE === undefined || process.env.E2E_LOG_FILE === ""
      ? {}
      : { engineLogFile: process.env.E2E_LOG_FILE }),
    ...extra,
  };
}

const READ_RETRY = { attempts: 8, baseDelayMs: 200, maxDelayMs: 2_000 };

/**
 * A node that answers "rate limit exceeded" (HTTP 429, -32005, as Arc's public RPC did) to 15 %
 * of the runner's reads at random, and to every one of them for one second in every nine. A
 * broadcast is never refused (the runner only reads; the sweep's transfer is sent once). Every
 * request is logged, refused or not, for the request budget.
 */
function flakyNode(log: NodeRequestInfo[]): NodeFault {
  let state = 20_261_118;
  const random = (): number => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  const start = Date.now();
  return (request) => {
    log.push(request);
    if (request.method === "eth_sendRawTransaction") return null;
    const inBurst = (request.atMs - start) % 9_000 < 1_000;
    return inBurst || random() < 0.15 ? rateLimitAnswer(request.method) : null;
  };
}

/** The runner's requests during `step`: their rate over the step, and the most in any second. */
function requestRate(
  log: readonly NodeRequestInfo[],
  receipt: RehearsalReceipt,
  step: string,
): { requests: number; perSecond: number; mostInOneSecond: number } {
  const record = receipt.steps.find((item) => item.step === step);
  if (record === undefined || record.durationMs === null) throw new Error(`no step ${step}`);
  const times = log.filter((request) => request.step === step).map((request) => request.atMs);
  let most = 0;
  for (const [index, at] of times.entries()) {
    const within = times.slice(index).filter((other) => other < at + 1_000).length;
    most = Math.max(most, within);
  }
  return {
    requests: times.length,
    perSecond: (times.length * 1_000) / Math.max(record.durationMs, 1_000),
    mostInOneSecond: most,
  };
}

/** Every secret of the run (keys, seed, each demo wallet's key) appears nowhere it was written. */
function expectNoSecrets(s: Setup, options: RehearsalOptions, receipt: RehearsalReceipt): void {
  const emails = [merchantEmail(receipt.runId)];
  for (let buyer = 1; buyer <= (receipt.scenario?.buyers ?? 0); buyer += 1) {
    emails.push(buyerEmail(receipt.runId, buyer));
  }
  const secrets = secretsOf(options, emails).map((secret) => secret.toLowerCase().slice(2));
  const texts = [s.lines.join("\n")];
  if (receipt.files !== undefined) {
    texts.push(
      readFileSync(receipt.files.json, "utf8"),
      readFileSync(receipt.files.markdown, "utf8"),
    );
  }
  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const secret of secrets) expect(lower.includes(secret)).toBe(false);
    expect(lower).not.toContain("@example.com");
  }
}

function kinds(receipt: RehearsalReceipt): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tx of receipt.transactions) {
    if (!tx.ownCampaign) continue;
    expect(tx.hash).toMatch(/^0x[0-9a-f]{64}$/);
    counts.set(tx.kind, (counts.get(tx.kind) ?? 0) + 1);
  }
  return counts;
}

/** The run's failure path brought the campaign to a release: the escrow holds nothing for it. */
function expectRecovered(receipt: RehearsalReceipt): void {
  expect(receipt.recovery, JSON.stringify(receipt.leftBehind)).toEqual({
    outcome: "no",
    released: true,
    reason: null,
  });
  expect(receipt.stranded).toBe(false);
  expect(receipt.steps.some((item) => item.step === "recover" && item.status === "done")).toBe(
    true,
  );
  const counts = kinds(receipt);
  expect(counts.get("closeSales")).toBe(1);
  expect(counts.get("settle")).toBe(1);
  expect(counts.get("release")).toBe(1);
  expect(counts.get("refundBatch") ?? 0).toBe(0);
}

/** Demo payments posted for the campaign: one per sale the demo sale route accepted. */
async function demoPayments(s: Setup, receipt: RehearsalReceipt): Promise<number> {
  const campaign = receipt.campaign;
  if (campaign === null) return 0;
  const [row] = await s.database.db<{ n: number }[]>`
    select count(*)::int as n from payments where campaign_id = ${campaign.id}
  `;
  return row?.n ?? 0;
}

function expectPassed(receipt: RehearsalReceipt): void {
  const failed = receipt.invariants.filter((invariant) => !invariant.passed);
  expect(receipt.failure, JSON.stringify(receipt.failure)).toBeNull();
  expect(failed, JSON.stringify(failed)).toEqual([]);
  expect(receipt.invariants.length).toBeGreaterThanOrEqual(11);
  expect(receipt.status).toBe("passed");
  expect(receipt.engine).toEqual({ started: true, stopped: true });
}

function expectMined(receipt: RehearsalReceipt): void {
  for (const tx of receipt.transactions.filter(
    (item) => item.ownCampaign && item.kind !== "sweep",
  )) {
    expect(tx.status, `${tx.kind} ${tx.hash}`).toBe("mined");
    expect(tx.block).not.toBeNull();
    expect(tx.gasUsed).not.toBeNull();
    expect(tx.feeWei).not.toBeNull();
  }
}

/** After the sweep, the demo wallets hold nothing and the treasury has its tokens back. */
function expectSweptAndReconciled(receipt: RehearsalReceipt): void {
  const wallets = new Set([
    receipt.roles.merchant,
    ...receipt.roles.buyers.map((buyer) => buyer.address),
  ]);
  for (const row of receipt.balances.afterSweep) {
    if (wallets.has(row.address)) expect(row.moneyWei, row.role).toBe(0n);
  }
  // On a local chain the money is the token and gas is not: the run costs the treasury nothing.
  expect(receipt.netCostWei).toBe(0n);
  expect(receipt.leftBehind).toEqual([]);
  expect(receipt.sweep.some((row) => row.wallet === "merchant" && row.status === "swept")).toBe(
    true,
  );
}

describe("refusals: nothing is sent", () => {
  it("refuses a chain that is neither Arc testnet nor a local chain", async () => {
    const s = await setup();
    await expect(runRehearsal(optionsFor(s, {}, { chainId: 777 }))).rejects.toThrow(
      RehearsalRefusedError,
    );
    await expect(
      runRehearsal(optionsFor(s, {}, { chainId: 5_042_002, local: true })),
    ).rejects.toThrow(/Arc testnet/);
    // The configured chain id must be the node's.
    await expect(runRehearsal(optionsFor(s, {}, { chainId: 5_042_002 }))).rejects.toThrow(
      /node answers chain id 31337/,
    );
    // Another id is accepted only with --local, then checked against the node.
    await expect(runRehearsal(optionsFor(s, {}, { chainId: 777, local: true }))).rejects.toThrow(
      /node answers chain id 31337/,
    );
  });

  it("refuses keys that are not the escrow's roles, and a receipt of a local run under docs/", async () => {
    const s = await setup();
    const stranger = anvil.privateKeys[3];
    if (stranger === undefined) throw new Error("no fourth key");
    const options = optionsFor(s, {});
    const refusal = await runRehearsal({
      ...options,
      secrets: { ...options.secrets, oracleKey: stranger },
    }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RehearsalRefusedError);
    expect((refusal as RehearsalRefusedError).reasons.join("\n")).toMatch(/escrow's oracle is/);
    const docs = fileURLToPath(new URL("../../../../docs/rehearsals", import.meta.url));
    await expect(runRehearsal({ ...options, receiptDir: docs })).rejects.toThrow(
      /never written under docs/,
    );
    // The refusal printed the addresses, never a key.
    const printed = s.lines.join("\n").toLowerCase();
    for (const key of [options.secrets.relayerKey, stranger, options.secrets.demoSeed]) {
      expect(printed.includes(key.toLowerCase().slice(2))).toBe(false);
    }
  });

  it("refuses a relayer key that is not the escrow's relayer, and a treasury that is not the relayer", async () => {
    const s = await setup();
    const stranger = anvil.privateKeys[3];
    if (stranger === undefined) throw new Error("no fourth key");
    const options = optionsFor(s, {});
    const refusal = await runRehearsal({
      ...options,
      secrets: { ...options.secrets, relayerKey: stranger },
    }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RehearsalRefusedError);
    const reasons = (refusal as RehearsalRefusedError).reasons.join("\n");
    expect(reasons).toMatch(/escrow's relayer is/);
    expect(reasons).not.toMatch(/escrow's oracle is/);

    // The escrow's treasury is its own account: the relayer's key cannot front the money.
    const apart = await setup({ treasuryIsRelayer: false });
    const second = await runRehearsal(optionsFor(apart, {})).catch((error: unknown) => error);
    expect(second).toBeInstanceOf(RehearsalRefusedError);
    const secondReasons = (second as RehearsalRefusedError).reasons;
    expect(secondReasons).toHaveLength(1);
    expect(secondReasons[0]).toMatch(/escrow's treasury is .*, not the relayer/);
  });

  it("refuses when the treasury's allowance to the escrow is too low", async () => {
    const s = await setup();
    const hash = await s.escrow.wallets.treasury.writeContract({
      address: s.escrow.usdc,
      abi: testUsdcAbi,
      functionName: "approve",
      args: [s.escrow.escrow, 0n],
    });
    await s.escrow.publicClient.waitForTransactionReceipt({ hash });
    const refusal = await runRehearsal(optionsFor(s, {})).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RehearsalRefusedError);
    const reasons = (refusal as RehearsalRefusedError).reasons;
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/allowance to the escrow is 0 USDC/);
  });

  it("refuses when the oracle cannot pay its gas", async () => {
    const s = await setup();
    const oracle = s.escrow.accounts.oracle.address;
    const testClient = createTestClient({
      mode: "anvil",
      chain: s.escrow.chain,
      transport: http(anvil.rpcUrl),
    });
    const balance = await s.escrow.publicClient.getBalance({ address: oracle });
    await testClient.setBalance({ address: oracle, value: 1_000n });
    try {
      const refusal = await runRehearsal(optionsFor(s, {})).catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(RehearsalRefusedError);
      const reasons = (refusal as RehearsalRefusedError).reasons;
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toMatch(/the oracle holds 0\.000000000000001 for gas/);
    } finally {
      // The oracle's account is shared by every escrow of this file.
      await testClient.setBalance({ address: oracle, value: balance });
    }
  });

  it("refuses when the treasury does not cover the worst case with a 20 % margin", async () => {
    // 12 sales of $0.50 at 100 % refund: about $13 fronted at worst; the treasury holds $5.
    const s = await setup({ treasuryFunds: 5_000_000n });
    const refusal = await runRehearsal(optionsFor(s, {})).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RehearsalRefusedError);
    expect((refusal as RehearsalRefusedError).reasons.join("\n")).toMatch(
      /the treasury holds 5 USDC/,
    );
    expect(s.lines.some((line) => line.startsWith("treasury balance: 5 USDC"))).toBe(true);
  });

  it("refuses a scenario the campaign route would refuse", async () => {
    const s = await setup();
    await expect(runRehearsal(optionsFor(s, { unitPrice: 50_000n }))).rejects.toThrow(
      /at least \$0\.50/,
    );
    await expect(runRehearsal(optionsFor(s, { purchases: 301 }))).rejects.toThrow(/purchases/);
  });

  it("--estimate prints the addresses, the balances and the worst case, and sends nothing", async () => {
    const s = await setup();
    const relayer = s.escrow.accounts.relayer.address;
    const nonce = await s.escrow.publicClient.getTransactionCount({ address: relayer });
    const options = optionsFor(s, {}, { estimateOnly: true });
    const receipt = await runRehearsal(options);
    expect(receipt.status).toBe("estimate");
    expect(receipt.estimate?.treasuryLocks).toBe(500_000n * 12n * 2n + 1_200_000n);
    expect(receipt.files).toBeUndefined();
    expect(await s.escrow.publicClient.getTransactionCount({ address: relayer })).toBe(nonce);
    expect(s.lines).toContain(`relayer ${relayer} (escrow's relayer ${relayer})`);
    expect(s.lines.some((line) => line.startsWith("treasury fronts at worst: 13.2 USDC"))).toBe(
      true,
    );
    expect(s.lines[s.lines.length - 1]).toBe("estimate only: nothing sent");
    expectNoSecrets(s, options, receipt);
  });
});

describe("the whole loop in real time", () => {
  let shared: { escrow: TestEscrow; database: TestDatabase } | null = null;
  /** The game and contract of the YES run, which the NO run plays again. */
  let firstGame: { ticker: string; symbol: string } | null = null;
  afterAll(async () => {
    await shared?.database.drop();
  });

  it(
    "YES: sells, hedges, closes, settles, refunds, pays, releases, sweeps; every invariant holds",
    { timeout: RUN_TIMEOUT_MS },
    async () => {
      const database = await createTestDatabase();
      const escrow = await deployTestEscrow(anvil);
      shared = { escrow, database };
      const s = await setup({ escrow, database });
      // A fresh database (as --throwaway-db without --deploy-block): the engine starts near the
      // head. And a node that refuses a share of the runner's reads, in the waits, outside them,
      // during the sweep and the final reads; the engine keeps a healthy client.
      const log: NodeRequestInfo[] = [];
      const headBefore = await s.escrow.publicClient.getBlockNumber();
      const options = optionsFor(
        s,
        { purchases: 6, buyers: 3, outcome: "yes" },
        { startNearHead: true, nodeFaults: flakyNode(log) },
      );
      const receipt = await runRehearsal(options);
      expectPassed(receipt);
      expectMined(receipt);
      // No step failed: every refusal was waited out or read again.
      expect(receipt.steps.every((item) => item.status === "done")).toBe(true);
      const rpc = receipt.rpc;
      if (rpc === null) throw new Error("no request counts");
      expect(rpc.refused).toBeGreaterThan(5);
      expect(rpc.rateLimited).toBe(rpc.refused);
      expect(rpc.retried).toBeGreaterThan(0);
      expect(rpc.requests).toBe(log.length);
      expect(rpc.limiter).not.toBeNull();
      // The faulty node answered the sweep and the reads made once the run was over too.
      expect(log.filter((request) => request.step === "sweep").length).toBeGreaterThan(0);
      expect(log.filter((request) => request.step === null).length).toBeGreaterThan(0);
      expect(s.lines.some((line) => line.startsWith("node: "))).toBe(true);
      // The runner's own load stays under about five requests a second while it waits.
      for (const step of ["hedging", "settle"]) {
        const rate = requestRate(log, receipt, step);
        process.stdout.write(
          `[rehearsal] ${step}: ${rate.requests.toString()} requests, ${rate.perSecond.toFixed(2)}/s, at most ${rate.mostInOneSecond.toString()} in one second\n`,
        );
        expect(rate.perSecond, step).toBeLessThanOrEqual(5);
        expect(rate.mostInOneSecond, step).toBeLessThanOrEqual(8);
      }
      // No eth_getLogs in a loop: once per new block while hedging, once at the end.
      expect(
        log.filter((request) => request.method === "eth_getLogs" && request.step === "settle"),
      ).toEqual([]);
      // The engine started near the head, not at the deploy block.
      const start = receipt.escrow.engineStartBlock ?? -1n;
      const runStart = receipt.escrow.runStartBlock ?? -1n;
      expect(runStart).toBeGreaterThanOrEqual(headBefore);
      expect(start).toBe(
        runStart - ENGINE_START_MARGIN_BLOCKS > s.escrow.deployedAtBlock
          ? runStart - ENGINE_START_MARGIN_BLOCKS
          : s.escrow.deployedAtBlock,
      );
      expect(s.lines.some((line) => line.startsWith("fresh database: the engine reads"))).toBe(
        true,
      );
      if (receipt.game !== null && receipt.instrument !== null) {
        firstGame = { ticker: receipt.game.ticker, symbol: receipt.instrument.symbol };
      }
      const counts = kinds(receipt);
      expect(counts.get("createCampaignFor")).toBe(1);
      expect(counts.get("buyFor")).toBe(6);
      expect(counts.get("chargeHedge") ?? 0).toBeGreaterThanOrEqual(1);
      expect(counts.get("closeSales")).toBe(1);
      expect(counts.get("settle")).toBe(1);
      expect(counts.get("refundBatch")).toBe(1);
      expect(counts.get("payMerchant")).toBe(1);
      expect(counts.get("release")).toBe(1);
      expect(counts.get("sweep")).toBe(4);
      expect(receipt.timings.callToTicket.count).toBe(6);
      expect(receipt.timings.callToDashboard.count).toBe(6);
      expect(receipt.timings.callToTicket.maxMs).not.toBeNull();
      expect(receipt.timings.refunds?.batches).toHaveLength(1);
      expect(receipt.timings.refunds?.wallMs).not.toBeNull();
      expect(receipt.hedging?.charges).toBe(6);
      // The engine was seen pausing with the book above the threshold, before any sale.
      expect(receipt.pauseProbe).toMatchObject({
        saleState: "paused_price",
        saleRefusal: "409 sales_paused",
        skipped: null,
      });
      expect(receipt.pauseProbe?.bidBps).toBeGreaterThan(
        receipt.instrument?.pauseThresholdBps ?? 0,
      );
      expect(receipt.recovery).toBeNull();
      expect(receipt.stranded).toBe(false);
      expect(receipt.sweep.map((row) => row.status)).toEqual(["swept", "swept", "swept", "swept"]);
      expectSweptAndReconciled(receipt);
      expect(receipt.files).toBeDefined();
      const json = JSON.parse(readFileSync(receipt.files?.json ?? "", "utf8")) as {
        status: string;
      };
      expect(json.status).toBe("passed");
      expect(receipt.files?.json).toMatch(/\d{8}T\d{6}Z-31337-yes\.json$/);
      expect(readFileSync(receipt.files?.markdown ?? "", "utf8")).toContain(": PASSED");
      expectNoSecrets(s, options, receipt);
    },
  );

  it(
    "NO, a second run on the same database and escrow, on the same game and contract: no refund, the merchant keeps the rest",
    { timeout: RUN_TIMEOUT_MS },
    async () => {
      if (shared === null) throw new Error("the YES run did not set up the chain");
      if (firstGame === null) throw new Error("the YES run chose no game");
      const s = await setup(shared);
      const options = optionsFor(s, { purchases: 6, buyers: 3, outcome: "no" });
      const receipt = await runRehearsal(options);
      expectPassed(receipt);
      expectMined(receipt);
      // A database given (--db-url): the deploy block, as given; the engine resumed from its
      // cursor, and the run waited for it to reach the head before the first sale.
      expect(receipt.escrow.engineStartBlock).toBe(s.escrow.deployedAtBlock);
      expect(s.lines.some((line) => line.startsWith("the engine's event reader is at block"))).toBe(
        true,
      );
      // The demo replayed on the instrument of the YES run, whose campaign settled on a forced
      // result: its contracts no longer count as held, so this run's sales are hedged and charged.
      expect(receipt.game?.ticker).toBe(firstGame.ticker);
      expect(receipt.instrument?.symbol).toBe(firstGame.symbol);
      expect(receipt.hedging?.charges).toBe(6);
      const counts = kinds(receipt);
      expect(counts.get("buyFor")).toBe(6);
      expect(counts.get("settle")).toBe(1);
      expect(counts.get("refundBatch") ?? 0).toBe(0);
      expect(counts.get("payMerchant") ?? 0).toBe(0);
      expect(counts.get("release")).toBe(1);
      expect(receipt.timings.refunds).toBeNull();
      // A new campaign on an escrow that already holds the YES run's.
      expect(receipt.campaign?.onchainId).toBeGreaterThan(0n);
      // Buyers got nothing to sweep; the merchant got everything left.
      expect(
        receipt.sweep.filter((row) => row.wallet !== "merchant").map((row) => row.status),
      ).toEqual(["empty", "empty", "empty"]);
      expectSweptAndReconciled(receipt);
      expect(receipt.files?.json).toMatch(/-31337-no\.json$/);
      expectNoSecrets(s, options, receipt);
    },
  );
});

describe("failures still stop, sweep and leave a receipt", () => {
  it(
    "a step that fails in the middle: engine stopped, wallets swept, FAILED receipt",
    { timeout: RUN_TIMEOUT_MS },
    async () => {
      const s = await setup();
      // Half refundable: the merchant receives half of each sale at once, so there is a sweep.
      const options = optionsFor(
        s,
        { purchases: 3, buyers: 2, refundBps: 5_000 },
        { failAtStep: "hedging" },
      );
      const receipt = await runRehearsal(options);
      expect(receipt.status).toBe("failed");
      expect(receipt.failure).toEqual({
        step: "hedging",
        reason: "failure injected at step hedging",
      });
      expect(receipt.engine).toEqual({ started: true, stopped: true });
      expect(receipt.invariants).toEqual([]);
      expect(receipt.steps.map((item) => `${item.step}:${item.status}`)).toEqual([
        "start-engine:done",
        "choose-game:done",
        "launch-campaign:done",
        "drive-book:done",
        "pause-probe:done",
        "purchases:done",
        "hedging:failed",
        "recover:done",
        "sweep:done",
      ]);
      // The recovery hedged the three tickets, closed sales, forced NO and the escrow released:
      // the merchant's wallet received everything, which the sweep brought back to the treasury.
      expectRecovered(receipt);
      expect(kinds(receipt).get("buyFor")).toBe(3);
      expect(receipt.hedging?.charges).toBe(3);
      const merchant = receipt.sweep.find((row) => row.wallet === "merchant");
      expect(merchant?.status).toBe("swept");
      expectSweptAndReconciled(receipt);
      // Nothing is sent once the runner has returned: the engine is really stopped.
      const db = s.database.db;
      const [before] = await db<{ n: string }[]>`select count(*)::text as n from chain_txs`;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      const [after] = await db<{ n: string }[]>`select count(*)::text as n from chain_txs`;
      expect(after?.n).toBe(before?.n);
      const markdown = readFileSync(receipt.files?.markdown ?? "", "utf8");
      expect(markdown).toContain(": FAILED");
      expect(markdown).toContain("FAILED at step `hedging`");
      expectNoSecrets(s, options, receipt);
    },
  );

  it("Ctrl-C (the signal aborted) does the same", { timeout: RUN_TIMEOUT_MS }, async () => {
    const s = await setup();
    const controller = new AbortController();
    const options = optionsFor(
      s,
      { purchases: 2, buyers: 1 },
      {
        signal: controller.signal,
        onStep: (name) => {
          if (name === "purchases") controller.abort();
        },
      },
    );
    const receipt = await runRehearsal(options);
    expect(receipt.status).toBe("failed");
    expect(receipt.failure).toEqual({ step: "purchases", reason: "interrupted" });
    expect(receipt.engine).toEqual({ started: true, stopped: true });
    expect(receipt.steps.at(-1)).toMatchObject({ step: "sweep", status: "done" });
    // Nothing sold: the recovery closes and releases, and the budget comes back via the merchant.
    expectRecovered(receipt);
    expect(receipt.sweep.map((row) => `${row.wallet}:${row.status}`)).toEqual([
      "merchant:swept",
      "buyer 1:empty",
    ]);
    expectSweptAndReconciled(receipt);
    expect(existsSync(receipt.files?.json ?? "")).toBe(true);
    expectNoSecrets(s, options, receipt);
  });

  it(
    "Ctrl-C while hedging: the recovery still hedges, closes and releases, ignoring the signal",
    { timeout: RUN_TIMEOUT_MS },
    async () => {
      const s = await setup();
      const controller = new AbortController();
      const options = optionsFor(
        s,
        { purchases: 2, buyers: 1 },
        {
          signal: controller.signal,
          onStep: (name) => {
            if (name === "hedging") controller.abort();
          },
        },
      );
      const receipt = await runRehearsal(options);
      expect(receipt.status).toBe("failed");
      expect(receipt.failure).toEqual({ step: "hedging", reason: "interrupted" });
      expect(receipt.engine).toEqual({ started: true, stopped: true });
      expectRecovered(receipt);
      expect(kinds(receipt).get("buyFor")).toBe(2);
      expect(receipt.hedging?.charges).toBe(2);
      expectSweptAndReconciled(receipt);
      expectNoSecrets(s, options, receipt);
    },
  );

  it(
    "a sale that fails: no other sale is posted afterwards, the ones in flight are awaited",
    { timeout: RUN_TIMEOUT_MS },
    async () => {
      const s = await setup();
      const options = optionsFor(s, { purchases: 6, buyers: 3, parallel: 2 }, { failAtSale: 3 });
      const receipt = await runRehearsal(options);
      expect(receipt.status).toBe("failed");
      expect(receipt.failure).toEqual({ step: "purchases", reason: "failure injected at sale 3" });
      // Sales 1 and 2 were posted; sale 3 failed before it was; 4 to 6 never were.
      expect(await demoPayments(s, receipt)).toBe(2);
      expect(kinds(receipt).get("buyFor")).toBe(2);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(await demoPayments(s, receipt)).toBe(2);
      expectRecovered(receipt);
      expectSweptAndReconciled(receipt);
      expectNoSecrets(s, options, receipt);
    },
  );
});

describe("criterion 6: the refunds of 60 tickets", () => {
  it(
    "60 sales settle YES; both refund batches are sent back to back, all within 10 s of settle",
    { timeout: 420_000 },
    async () => {
      const s = await setup();
      const options = optionsFor(s, { purchases: 60, buyers: 6, parallel: 4, outcome: "yes" });
      const receipt = await runRehearsal(options);
      expectPassed(receipt);
      const refunds = receipt.timings.refunds;
      if (refunds === null) throw new Error("no refund timing");
      expect(refunds.batches.map((batch) => batch.tickets).sort((a, b) => a - b)).toEqual([10, 50]);
      expect(refunds.wallMs).not.toBeNull();
      expect(refunds.wallMs ?? Infinity).toBeLessThan(10_000);
      // The transaction sender is strictly serial per key: the second batch is broadcast once the
      // first is mined, in the same settlement pass (a later pass would come 15 s later).
      const sent = refunds.batches
        .map((batch) => Date.parse(batch.sentAt ?? ""))
        .sort((a, b) => a - b);
      const gap = (sent[1] ?? Infinity) - (sent[0] ?? 0);
      expect(gap).toBeLessThan(2_000);
      process.stdout.write(
        `[rehearsal] 60 tickets: refunds ${String(refunds.wallMs)} ms after settle (wall clock), ${refunds.blocks.toString()} blocks; gap between batches ${gap.toString()} ms\n`,
      );
      expect(
        getAddress(receipt.roles.treasury ?? "0x0000000000000000000000000000000000000000"),
      ).toBe(s.escrow.accounts.treasury.address);
      expectSweptAndReconciled(receipt);
      expectNoSecrets(s, options, receipt);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// A sweep on a rate-limiting node, in Arc's money mode
// ---------------------------------------------------------------------------------------------

describe("the sweep on a node that refuses for a moment", () => {
  it("retries each wallet, never sends a transfer twice, and brings every wei back (native money, as on Arc)", async () => {
    const relayerKey = anvil.privateKeys[1];
    const oracleKey = anvil.privateKeys[2];
    if (relayerKey === undefined || oracleKey === undefined) throw new Error("anvil keys missing");
    const arc = createArcClients({
      ARC_CHAIN_ID: LOCAL_CHAIN_ID,
      ARC_RPC_URL: anvil.rpcUrl,
      ARC_RPC_FALLBACK_URL: anvil.rpcUrl,
      ARC_RELAYER_PRIVATE_KEY: relayerKey,
      ARC_ORACLE_PRIVATE_KEY: oracleKey,
    });
    try {
      const seed = `0x${randomBytes(32).toString("hex")}` as Hex;
      const wallets = [1, 2, 3].map((n) => ({
        label: `buyer ${n.toString()}`,
        email: `w${n.toString()}@example.com`,
      }));
      const testClient = createTestClient({
        mode: "anvil",
        chain: arc.chain,
        transport: http(anvil.rpcUrl),
      });
      const funded = [3n * 10n ** 17n, 0n, 10n ** 18n];
      for (const [index, wallet] of wallets.entries()) {
        await testClient.setBalance({
          address: getAddress(demoWalletAddress(seed, wallet.email)),
          value: funded[index] ?? 0n,
        });
      }
      const destination = getAddress(`0x${randomBytes(20).toString("hex")}`);
      // A few requests of the sweep are refused, early ones and some in the middle of a transfer
      // (a broadcast never is); every wallet meets one.
      const refused = new Set([2, 3, 6, 10, 11, 17, 21, 22]);
      let count = 0;
      const meter = new RpcMeter();
      const client = meteredClient(arc.publicClient, {
        meter,
        step: () => "sweep",
        fault: ({ method }) => {
          if (method === "eth_sendRawTransaction") return null;
          count += 1;
          return refused.has(count) ? rateLimitAnswer(method) : null;
        },
      });
      const lines: string[] = [];
      let retries = 0;
      const rows = await sweepWallets({
        client,
        chain: arc.chain,
        mode: "native-usdc",
        token: "0x3600000000000000000000000000000000000000",
        seed,
        wallets,
        destination,
        local: true,
        policy: { attempts: 8, baseDelayMs: 50, maxDelayMs: 400 },
        out: (line) => lines.push(line),
        onRetry: () => (retries += 1),
      });
      expect(
        rows.map((row) => row.status),
        lines.join("\n"),
      ).toEqual(["swept", "empty", "swept"]);
      expect(retries).toBeGreaterThan(0);
      expect(meter.requests.filter((request) => !request.ok).length).toBeGreaterThan(0);
      // Swept to the wei: the wallets end at zero, the destination got the rest after gas.
      const reader = createPublicClient({ chain: arc.chain, transport: http(anvil.rpcUrl) });
      for (const wallet of wallets) {
        expect(
          await reader.getBalance({ address: getAddress(demoWalletAddress(seed, wallet.email)) }),
        ).toBe(0n);
      }
      const sent = rows.reduce((total, row) => total + row.sentWei, 0n);
      const gas = rows.reduce((total, row) => total + row.gasWei, 0n);
      expect(sent + gas).toBe((funded[0] ?? 0n) + (funded[2] ?? 0n));
      expect(await reader.getBalance({ address: destination })).toBe(sent);
      // One transfer per wallet swept: none was sent twice.
      const hashes = rows.flatMap((row) => (row.txHash === null ? [] : [row.txHash]));
      expect(hashes).toHaveLength(2);
      expect(
        meter.requests.filter((request) => request.method === "eth_sendRawTransaction"),
      ).toHaveLength(2);
      expect(lines.join("\n")).not.toContain("@example.com");
    } finally {
      arc.limiter?.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// A campaign left behind, as on Arc, and --recover
// ---------------------------------------------------------------------------------------------

const RECOVERY_TIMEOUT_MS = 420_000;

function recoveryOptionsFor(
  s: Setup,
  receiptPath: string,
  lines: string[],
  extra: Partial<RecoveryOptions> = {},
): RecoveryOptions {
  const run = optionsFor(s, {});
  return {
    receiptPath,
    databaseUrl: s.database.url,
    rpcUrl: run.rpcUrl,
    chainId: run.chainId,
    local: run.local,
    escrowAddress: run.escrowAddress,
    escrowDeployBlock: run.escrowDeployBlock,
    secrets: run.secrets,
    // As the command's default: a run on the simulated Gemini is recovered on it whatever this says.
    gemini: { kind: "live", apiUrl: "http://127.0.0.1:9", wsUrl: "ws://127.0.0.1:9" },
    estimateOnly: false,
    out: (line) => lines.push(line),
    ...(run.timeouts === undefined ? {} : { timeouts: run.timeouts }),
    readRetry: READ_RETRY,
    ...extra,
  };
}

/** Nothing printed or written by a recovery carries a key, the seed or an e-mail address. */
function expectRecoveryClean(
  s: Setup,
  receipt: RecoveryReceipt,
  lines: readonly string[],
  buyers: number,
): void {
  const runId = receipt.recovers.runId;
  const emails = [merchantEmail(runId)];
  for (let buyer = 1; buyer <= buyers; buyer += 1) emails.push(buyerEmail(runId, buyer));
  const secrets = secretsOf({ secrets: optionsFor(s, {}).secrets }, emails).map((secret) =>
    secret.toLowerCase().slice(2),
  );
  const texts = [lines.join("\n")];
  if (receipt.files !== undefined) {
    texts.push(
      readFileSync(receipt.files.json, "utf8"),
      readFileSync(receipt.files.markdown, "utf8"),
    );
  }
  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const secret of secrets) expect(lower.includes(secret)).toBe(false);
    expect(lower).not.toContain("@example.com");
  }
}

/** A run that fails and leaves its campaign stranded with the database kept, as on Arc. */
async function strandedRun(
  scenario: ScenarioInput,
  extra: Partial<RehearsalOptions>,
): Promise<{ s: Setup; receipt: RehearsalReceipt; path: string }> {
  const s = await setup();
  const receipt = await runRehearsal(optionsFor(s, scenario, { strand: true, ...extra }));
  expect(receipt.status).toBe("failed");
  expect(receipt.stranded, JSON.stringify(receipt.leftBehind)).toBe(true);
  expect(receipt.engine).toEqual({ started: true, stopped: true });
  expect(receipt.leftBehind.join("\n")).toMatch(/the recovery of the campaign failed/);
  expect(receipt.leftBehind.join("\n")).toMatch(/sweep failed: failure injected at step sweep/);
  const path = receipt.files?.json;
  if (path === undefined) throw new Error("no receipt written");
  return { s, receipt, path };
}

/** Every transaction a recovery lists is on the chain, mined. */
async function expectOnChain(s: Setup, receipt: RecoveryReceipt): Promise<void> {
  for (const tx of receipt.transactions) {
    const mined = await s.escrow.publicClient.getTransactionReceipt({ hash: tx.hash });
    expect(mined.status, `${tx.kind} ${tx.hash}`).toBe("success");
    expect(tx.block).toBe(mined.blockNumber);
  }
}

function kindsOf(receipt: RecoveryReceipt): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tx of receipt.transactions.filter((item) => item.ownCampaign)) {
    counts.set(tx.kind, (counts.get(tx.kind) ?? 0) + 1);
  }
  return counts;
}

/** The nonces of the relayer and the oracle, and the rows of the engine's outbox. */
async function sentSoFar(s: Setup): Promise<{ nonces: number[]; outbox: string | undefined }> {
  const nonces = await Promise.all(
    [s.escrow.accounts.relayer.address, s.escrow.accounts.oracle.address].map((address) =>
      s.escrow.publicClient.getTransactionCount({ address }),
    ),
  );
  const [row] = await s.database.db<{ n: string }[]>`select count(*)::text as n from chain_txs`;
  return { nonces, outbox: row?.n };
}

const WEB_DIR = fileURLToPath(new URL("../..", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));
const COMMAND_TIMEOUT_MS = 120_000;

/**
 * `run.ts --recover`, the command a person types, on this test's chain and database: its exit
 * code and what it printed. Its environment holds only what it needs (anvil's public development
 * keys and this test's throwaway seed), never the repository's .env.
 */
async function recoverCommand(
  s: Setup,
  receiptPath: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const { secrets } = optionsFor(s, {});
  const child: ChildProcess = spawn(
    TSX,
    [
      "e2e/rehearsal/run.ts",
      "--recover",
      receiptPath,
      "--db-url",
      s.database.url,
      "--rpc-url",
      anvil.rpcUrl,
      "--chain-id",
      LOCAL_CHAIN_ID.toString(),
      "--escrow",
      s.escrow.escrow,
      "--deploy-block",
      s.escrow.deployedAtBlock.toString(),
      "--gemini",
      "simulated",
      "--engine-log",
      join(s.receiptDir, "recover-command-engine.log"),
    ],
    {
      cwd: WEB_DIR,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        ...(process.env.TMPDIR === undefined ? {} : { TMPDIR: process.env.TMPDIR }),
        NODE_ENV: "test",
        APP_LOG_LEVEL: "warn",
        ARC_RELAYER_PRIVATE_KEY: secrets.relayerKey,
        ARC_ORACLE_PRIVATE_KEY: secrets.oracleKey,
        APP_DEMO_WALLET_SEED: secrets.demoSeed,
      },
    },
  );
  child.stdin?.end();
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  return new Promise((resolveCommand, reject) => {
    const timer = setTimeout(() => {
      // Only the process this test started, by its own handle.
      child.kill("SIGKILL");
      reject(new Error(`run.ts --recover did not exit within ${COMMAND_TIMEOUT_MS.toString()} ms`));
    }, COMMAND_TIMEOUT_MS);
    child.on("error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolveCommand({ code, stdout, stderr });
    });
  });
}

/** Sets an account's native balance on the test chain. */
async function setNative(s: Setup, address: Address, value: bigint): Promise<void> {
  const testClient = createTestClient({
    mode: "anvil",
    chain: s.escrow.chain,
    transport: http(anvil.rpcUrl),
  });
  await testClient.setBalance({ address, value });
}

/** Released, swept to the micro-unit, a -recovery receipt next to the run's, nothing behind. */
async function expectReleasedAndSwept(
  s: Setup,
  run: { receipt: RehearsalReceipt; path: string },
  receipt: RecoveryReceipt,
  suffix = "-recovery",
): Promise<void> {
  expect(receipt.failure, JSON.stringify(receipt.failure)).toBeNull();
  expect(receipt.leftBehind).toEqual([]);
  expect(receipt.unread).toEqual([]);
  expect(receipt.status).toBe("recovered");
  expect(receipt.stateAfter?.released).toBe(true);
  expect(receipt.stateAfter?.escrowHolds).toBe(0n);
  // Every ticket sold charged exactly once, over the run and its recovery.
  expect(receipt.stateAfter?.hedgeCharges).toBe(receipt.stateAfter?.ticketsSold);
  expect(receipt.stateAfter?.ticketsCharged).toBe(receipt.stateAfter?.ticketsSold);
  // Every wallet of the run holds nothing, to the micro-unit, on the token and in the receipt.
  const wallets = [run.receipt.roles.merchant, ...run.receipt.roles.buyers.map((b) => b.address)];
  for (const address of wallets) {
    if (address === null) continue;
    const balance = await s.escrow.publicClient.readContract({
      address: s.escrow.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });
    expect(balance, address).toBe(0n);
    expect(receipt.balances.after.find((row) => row.address === address)?.moneyWei).toBe(0n);
  }
  expect(receipt.files?.json).toBe(
    join(dirname(run.path), `${basename(run.path, ".json")}${suffix}.json`),
  );
  expect(receipt.files?.markdown).toBe(
    join(dirname(run.path), `${basename(run.path, ".json")}${suffix}.md`),
  );
  // The result it settled with is named, and the Markdown says it.
  expect(receipt.result?.settledWith).toBe(receipt.outcome);
  expect(readFileSync(receipt.files?.markdown ?? "", "utf8")).toContain(
    `Settled with: ${String(receipt.result?.settledWith).toUpperCase()} (${String(receipt.result?.source)})`,
  );
  await expectOnChain(s, receipt);
  // The run's receipt is not rewritten.
  expect(JSON.parse(readFileSync(run.path, "utf8"))).toMatchObject({
    status: "failed",
    stranded: true,
  });
}

/** A second recovery: nothing left to finish, nothing sent but what the sweep still finds. */
async function expectRerunSendsNothing(
  s: Setup,
  path: string,
  buyers: number,
  suffix = "-recovery-2",
): Promise<void> {
  const nonces = async (): Promise<number[]> =>
    Promise.all(
      [s.escrow.accounts.relayer.address, s.escrow.accounts.oracle.address].map((address) =>
        s.escrow.publicClient.getTransactionCount({ address }),
      ),
    );
  const before = await nonces();
  const lines: string[] = [];
  const again = await recoverRehearsal(recoveryOptionsFor(s, path, lines));
  expect(again.status, JSON.stringify(again.leftBehind)).toBe("recovered");
  expect(again.stateBefore?.released).toBe(true);
  expect(again.engine).toEqual({ started: false, stopped: false });
  expect(again.transactions).toEqual([]);
  expect(again.sweep.every((row) => row.status === "empty")).toBe(true);
  expect(again.actions[0]).toBe(
    "the campaign was already released: nothing to finish, only the sweep",
  );
  expect(again.files?.json?.endsWith(`${suffix}.json`)).toBe(true);
  // Settled before it started: it says so, and with which result.
  expect(again.result?.source).toBe("already settled on-chain");
  expect(again.result?.settledWith).not.toBeNull();
  expect(await nonces()).toEqual(before);
  expectRecoveryClean(s, again, lines, buyers);
}

describe("a campaign left behind, finished by --recover", () => {
  it(
    "a read that never recovers: the wait times out with its own message and the last error; then a result already forced YES, sales closed: recovered with refunds, swept, twice",
    { timeout: RECOVERY_TIMEOUT_MS },
    async () => {
      // From close-sales on, every eth_call of the runner is refused: the route closes the sales,
      // the engine closes them on-chain, and the runner can never read it.
      let closing = false;
      const never: NodeFault = ({ method, step }) => {
        if (step === "close-sales") closing = true;
        return closing && method === "eth_call" ? rateLimitAnswer(method) : null;
      };
      const run = await strandedRun(
        { purchases: 2, buyers: 2, refundBps: 5_000 },
        {
          nodeFaults: never,
          timeouts: { closeMs: 8_000, engineStopMs: 20_000 },
          readRetry: { attempts: 2, baseDelayMs: 50, maxDelayMs: 100 },
        },
      );
      const { s, receipt } = run;
      expect(receipt.failure?.step).toBe("close-sales");
      expect(receipt.failure?.reason).toMatch(
        /^timed out after 8000 ms waiting for the sales closed on-chain; last error: Request exceeds defined limit\./,
      );
      // FAILED, and still holds everything recorded before and after.
      expect(receipt.steps.map((item) => `${item.step}:${item.status}`).slice(0, 8)).toEqual([
        "start-engine:done",
        "choose-game:done",
        "launch-campaign:done",
        "drive-book:done",
        "pause-probe:done",
        "purchases:done",
        "hedging:done",
        "close-sales:failed",
      ]);
      expect(receipt.purchases).toHaveLength(2);
      expect(receipt.hedging?.charges).toBe(2);
      expect(receipt.transactions.filter((tx) => tx.kind === "buyFor")).toHaveLength(2);
      expect(receipt.transactions.some((tx) => tx.kind === "closeSales")).toBe(true);
      expect(receipt.balances.before.length).toBeGreaterThan(0);
      expect(receipt.balances.afterSettlement).toEqual([]);
      expect(receipt.unread.join("\n")).toMatch(
        /the balances after settlement: .*Request exceeds defined limit/,
      );
      expect(receipt.unread.join("\n")).toMatch(
        /the campaign on-chain: .*Request exceeds defined limit/,
      );
      expect(receipt.rpc?.rateLimited).toBeGreaterThan(0);
      const markdown = readFileSync(receipt.files?.markdown ?? "", "utf8");
      expect(markdown).toContain("## Could not be read");

      // Someone forced YES through the demo route before the recovery (stored, not yet settled).
      const symbol = receipt.instrument?.symbol ?? "";
      await s.database.db`
        insert into demo_overrides (instrument, forced_result) values (${symbol}, 'yes')
        on conflict (instrument) do update set forced_result = 'yes'
      `;
      const lines: string[] = [];

      // The treasury cannot pay what is left (the merchant's due on YES, 2 × 0.25): refused
      // before anything is sent, the shortfall named.
      const treasury = s.escrow.accounts.treasury.address;
      const owner = s.escrow.accounts.owner.address;
      const tokens = (address: Address): Promise<bigint> =>
        s.escrow.publicClient.readContract({
          address: s.escrow.usdc,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        });
      const moved = (await tokens(treasury)) - 100_000n;
      await s.escrow.publicClient.waitForTransactionReceipt({
        hash: await s.escrow.wallets.treasury.writeContract({
          address: s.escrow.usdc,
          abi: erc20Abi,
          functionName: "transfer",
          args: [owner, moved],
        }),
      });
      const beforeRefusal = await sentSoFar(s);
      const short = await recoverRehearsal(recoveryOptionsFor(s, run.path, lines)).catch(
        (error: unknown) => error,
      );
      expect(short).toBeInstanceOf(RehearsalRefusedError);
      expect((short as RehearsalRefusedError).reasons).toEqual([
        "the treasury holds 0.1 USDC, the recovery needs 0.6 with the 20 % margin",
      ]);
      expect(await sentSoFar(s)).toEqual(beforeRefusal);
      await s.escrow.publicClient.waitForTransactionReceipt({
        hash: await s.escrow.wallets.owner.writeContract({
          address: s.escrow.usdc,
          abi: erc20Abi,
          functionName: "transfer",
          args: [treasury, moved],
        }),
      });

      const recovered = await recoverRehearsal(recoveryOptionsFor(s, run.path, lines));
      expect(recovered.stateBefore?.stage).toBe("sales closed");
      expect(recovered.stateBefore?.ticketsCharged).toBe(2);
      expect(recovered.outcome).toBe("yes");
      expect(recovered.actions).toContain("result YES already forced or known: not forced again");
      // Settled YES, as the run asked, on the result forced in the database: nothing more to say.
      expect(recovered.result).toEqual({
        settledWith: "yes",
        source: "already forced in the database",
        scenarioOutcome: "yes",
        differs: null,
      });
      expect(recovered.stateAfter?.ticketsRefunded).toBe(2);
      const counts = kindsOf(recovered);
      expect(counts.get("closeSales") ?? 0).toBe(0);
      expect(counts.get("settle")).toBe(1);
      expect(counts.get("refundBatch")).toBe(1);
      expect(counts.get("payMerchant")).toBe(1);
      expect(counts.get("release")).toBe(1);
      // The refunds went to the buyers' demo wallets: swept back, as the merchant's.
      expect(recovered.sweep.map((row) => `${row.wallet}:${row.status}`)).toEqual([
        "merchant:swept",
        "buyer 1:swept",
        "buyer 2:swept",
      ]);
      await expectReleasedAndSwept(s, run, recovered);
      expectRecoveryClean(s, recovered, lines, 2);
      await expectRerunSendsNothing(s, run.path, 2);
    },
  );

  it(
    "tickets not all charged, sales open: the refusals first, --estimate sends nothing, then hedged, closed, NO forced, released, swept, twice",
    { timeout: RECOVERY_TIMEOUT_MS },
    async () => {
      // One buyer, two sales at once: the engine creates the new buyer once.
      const run = await strandedRun(
        { purchases: 2, buyers: 1, parallel: 2, refundBps: 5_000 },
        { failAtStep: "hedging" },
      );
      const { s, receipt } = run;
      expect(receipt.purchases).toHaveLength(2);
      expect(receipt.failure).toEqual({
        step: "hedging",
        reason: "failure injected at step hedging",
      });

      // The refusals: nothing is sent.
      const refusal = async (options: RecoveryOptions): Promise<readonly string[]> => {
        const error = await recoverRehearsal(options).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(RehearsalRefusedError);
        return (error as RehearsalRefusedError).reasons;
      };
      const json = JSON.parse(readFileSync(run.path, "utf8")) as Record<string, unknown>;
      const variant = (patch: (copy: Record<string, unknown>) => void): string => {
        const copy = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
        patch(copy);
        const path = join(s.receiptDir, `variant-${randomBytes(4).toString("hex")}.json`);
        writeFileSync(path, JSON.stringify(copy));
        return path;
      };
      const lines: string[] = [];
      const otherChain = variant((copy) => {
        (copy.chain as { chainId: number }).chainId = 5_042_002;
      });
      expect(await refusal(recoveryOptionsFor(s, otherChain, lines))).toEqual([
        "the receipt is of a run on chain 5042002, the command is for chain 31337",
      ]);
      const stranger = getAddress(`0x${randomBytes(20).toString("hex")}`);
      expect(
        (await refusal(recoveryOptionsFor(s, run.path, lines, { escrowAddress: stranger }))).join(
          "\n",
        ),
      ).toContain(
        `the receipt's escrow is ${receipt.escrow.address}, the command's is ${stranger}`,
      );
      const otherSeed = `0x${randomBytes(32).toString("hex")}` as Hex;
      const seedReasons = await refusal(
        recoveryOptionsFor(s, run.path, lines, {
          secrets: { ...optionsFor(s, {}).secrets, demoSeed: otherSeed },
        }),
      );
      expect(seedReasons.join("\n")).toMatch(
        /derives the merchant wallet .* the receipt's is .*: another seed/,
      );
      const unknown = randomUUID();
      const unknownCampaign = variant((copy) => {
        (copy.campaign as { id: string }).id = unknown;
      });
      expect(await refusal(recoveryOptionsFor(s, unknownCampaign, lines))).toEqual([
        `the database does not know campaign ${unknown}: give the database the run kept (--db-url)`,
      ]);
      for (const file of readdirSync(s.receiptDir).filter((name) => name.startsWith("variant-"))) {
        await rm(join(s.receiptDir, file));
      }

      // The oracle's and the relayer's gas do not cover what is left to send: the command exits
      // 2 before anything is sent, each shortfall named.
      const gasAccounts = [s.escrow.accounts.oracle.address, s.escrow.accounts.relayer.address];
      const gasBefore = await Promise.all(
        gasAccounts.map((address) => s.escrow.publicClient.getBalance({ address })),
      );
      const beforeRefusal = await sentSoFar(s);
      let command: { code: number | null; stdout: string; stderr: string };
      try {
        await setNative(s, s.escrow.accounts.oracle.address, 1_000n);
        await setNative(s, s.escrow.accounts.relayer.address, 2_000n);
        command = await recoverCommand(s, run.path);
      } finally {
        // Both accounts are shared by every escrow of this file.
        for (const [index, address] of gasAccounts.entries()) {
          await setNative(s, address, gasBefore[index] ?? 0n);
        }
      }
      expect(command.code, command.stderr).toBe(2);
      expect(command.stderr).toContain("refuses to start");
      expect(command.stderr).toMatch(
        /- the oracle holds 0\.000000000000001 for gas, what is left needs [0-9.]+ with the 20 % margin/,
      );
      expect(command.stderr).toMatch(
        /- the relayer holds 0\.000000000000002 for gas, what is left needs [0-9.]+ with the 20 % margin/,
      );
      expect(await sentSoFar(s)).toEqual(beforeRefusal);
      lines.push(command.stdout, command.stderr);

      // --estimate: the checks and the state, nothing sent.
      const relayer = s.escrow.accounts.relayer.address;
      const oracle = s.escrow.accounts.oracle.address;
      const nonces = [
        await s.escrow.publicClient.getTransactionCount({ address: relayer }),
        await s.escrow.publicClient.getTransactionCount({ address: oracle }),
      ];
      const [outboxBefore] = await s.database.db<
        { n: string }[]
      >`select count(*)::text as n from chain_txs`;
      const estimateLines: string[] = [];
      const estimate = await recoverRehearsal(
        recoveryOptionsFor(s, run.path, estimateLines, { estimateOnly: true }),
      );
      expect(estimate.status).toBe("estimate");
      expect(estimate.files).toBeUndefined();
      expect(estimate.stateBefore?.stage).toBe("selling");
      expect(estimate.stateBefore?.ticketsSold).toBe(2);
      expect(estimate.stateBefore?.ticketsCharged ?? 2).toBeLessThan(2);
      expect(estimate.estimate?.oracleGas).toBeGreaterThan(0n);
      expect(estimateLines.at(-1)).toBe("estimate only: nothing sent");
      expect([
        await s.escrow.publicClient.getTransactionCount({ address: relayer }),
        await s.escrow.publicClient.getTransactionCount({ address: oracle }),
      ]).toEqual(nonces);
      const [outboxAfter] = await s.database.db<
        { n: string }[]
      >`select count(*)::text as n from chain_txs`;
      expect(outboxAfter?.n).toBe(outboxBefore?.n);

      // The recovery.
      const recoveryLines: string[] = [];
      const recovered = await recoverRehearsal(recoveryOptionsFor(s, run.path, recoveryLines));
      expect(recovered.stateBefore?.stage).toBe("selling");
      expect(recovered.outcome).toBe("no");
      expect(recovered.actions.join("\n")).toMatch(/ticket\(s\) hedged and charged \(2 sold\)/);
      expect(recovered.actions).toContain("sales closed through the merchant's route");
      expect(recovered.actions).toContain("result NO forced through the demo route");
      // The run asked for YES; its own reset cleared every override (none is left for the
      // instrument), so the recovery forced NO and says so.
      const [overrides] = await s.database.db<{ n: number }[]>`
        select count(*)::int as n from demo_overrides
        where instrument = ${receipt.instrument?.symbol ?? ""}
      `;
      expect(overrides?.n).toBe(0);
      expect(recovered.result?.settledWith).toBe("no");
      expect(recovered.result?.source).toBe("forced by this recovery");
      expect(recovered.result?.differs).toMatch(
        /^The campaign was settled NO, not YES as the scenario of run [0-9a-f]{12} asked: no result was forced or known any more when this recovery started/,
      );
      expect(recoveryLines).toContain(recovered.result?.differs);
      expect(readFileSync(recovered.files?.markdown ?? "", "utf8")).toContain(
        recovered.result?.differs ?? "no sentence",
      );
      expect(recovered.stateAfter?.ticketsCharged).toBe(2);
      const counts = kindsOf(recovered);
      expect(counts.get("chargeHedge") ?? 0).toBeGreaterThanOrEqual(1);
      expect(counts.get("closeSales")).toBe(1);
      expect(counts.get("settle")).toBe(1);
      expect(counts.get("release")).toBe(1);
      expect(counts.get("refundBatch") ?? 0).toBe(0);
      await expectReleasedAndSwept(s, run, recovered);
      expectRecoveryClean(s, recovered, [...lines, ...estimateLines, ...recoveryLines], 1);
      await expectRerunSendsNothing(s, run.path, 1);
    },
  );

  it(
    "every ticket charged, sales open (the Arc case): interrupted after the close, then resumed: closed, NO forced, released, swept, nothing sent twice",
    { timeout: RECOVERY_TIMEOUT_MS },
    async () => {
      const run = await strandedRun(
        { purchases: 2, buyers: 2, refundBps: 5_000 },
        { failAtStep: "close-sales" },
      );
      const { s } = run;
      const campaignId = run.receipt.campaign?.id ?? "";

      // A recovery interrupted (the abort signal, as Ctrl-C sends it) once its first transaction,
      // the close of the sales, is mined.
      const [clock] = await s.database.db<{ now: Date }[]>`select now() as now`;
      const since = clock?.now ?? new Date(0);
      const controller = new AbortController();
      const pollErrors: unknown[] = [];
      let poller: ReturnType<typeof setInterval> | null = null;
      const firstLines: string[] = [];
      let first: RecoveryReceipt;
      try {
        first = await recoverRehearsal(
          recoveryOptionsFor(s, run.path, firstLines, {
            signal: controller.signal,
            onStep: (name) => {
              if (name !== "recover" || poller !== null) return;
              poller = setInterval(() => {
                s.database.db<{ n: number }[]>`
                  select count(*)::int as n from chain_txs
                  where kind = 'closeSales' and status = 'mined' and created_at > ${since}
                    and payload->>'campaignId' = ${campaignId}
                `.then(
                  ([row]) => {
                    if ((row?.n ?? 0) > 0) controller.abort();
                  },
                  (error: unknown) => pollErrors.push(error),
                );
              }, 100);
            },
          }),
        );
      } finally {
        if (poller !== null) clearInterval(poller);
      }
      expect(pollErrors).toEqual([]);
      expect(controller.signal.aborted).toBe(true);
      expect(first.status).toBe("failed");
      expect(first.failure).toEqual({ step: "recover", reason: "interrupted" });
      expect(first.engine).toEqual({ started: true, stopped: true });
      expect(first.files?.json).toMatch(/-recovery\.json$/);
      expect(kindsOf(first).get("closeSales")).toBe(1);
      expect(first.leftBehind.join("\n")).toMatch(/is not released: the escrow still holds/);
      // The merchant's half of each sale was brought back all the same.
      expect(first.sweep.find((row) => row.wallet === "merchant")?.status).toBe("swept");
      await expectOnChain(s, first);
      expectRecoveryClean(s, first, firstLines, 2);

      // Run again: it finishes from where the chain is.
      const lines: string[] = [];
      const recovered = await recoverRehearsal(recoveryOptionsFor(s, run.path, lines));
      expect(recovered.stateBefore?.ticketsSold).toBe(2);
      expect(recovered.stateBefore?.ticketsCharged).toBe(2);
      expect(recovered.stateBefore?.escrowHolds).toBeGreaterThan(0n);
      expect(recovered.outcome).toBe("no");
      expect(recovered.result?.settledWith).toBe("no");
      expect(recovered.actions.some((action) => action.includes("hedged"))).toBe(false);
      expect(recovered.stateAfter?.ticketsCharged).toBe(2);
      // Each receipt lists only the transactions its own run caused; together, each once.
      const firstHashes = new Set(first.transactions.map((tx) => tx.hash));
      expect(recovered.transactions.filter((tx) => firstHashes.has(tx.hash))).toEqual([]);
      const together = new Map<string, number>();
      for (const receipt of [first, recovered]) {
        for (const [kind, count] of kindsOf(receipt)) {
          together.set(kind, (together.get(kind) ?? 0) + count);
        }
      }
      expect(together.get("buyFor") ?? 0).toBe(0);
      expect(together.get("closeSales")).toBe(1);
      expect(together.get("settle")).toBe(1);
      expect(together.get("release")).toBe(1);
      expect(kindsOf(recovered).get("release")).toBe(1);
      // The merchant's wallet received the release: swept back.
      expect(recovered.sweep.find((row) => row.wallet === "merchant")?.status).toBe("swept");
      await expectReleasedAndSwept(s, run, recovered, "-recovery-2");
      const markdown = readFileSync(recovered.files?.markdown ?? "", "utf8");
      expect(markdown).toContain("# Recovery of the rehearsal");
      expect(markdown).toContain(`Recovers \`${basename(run.path)}\``);
      expectRecoveryClean(s, recovered, lines, 2);
      await expectRerunSendsNothing(s, run.path, 2, "-recovery-3");
    },
  );

  it(
    "a run that failed before it drove the book (driven: null): no book driven again, no hedge waited for; closed, NO forced, released, swept",
    { timeout: RECOVERY_TIMEOUT_MS },
    async () => {
      const run = await strandedRun({ purchases: 2, buyers: 1 }, { failAtStep: "drive-book" });
      const { s, receipt } = run;
      expect(receipt.failure).toEqual({
        step: "drive-book",
        reason: "failure injected at step drive-book",
      });
      expect(receipt.driven).toBeNull();
      expect(JSON.parse(readFileSync(run.path, "utf8"))).toMatchObject({ driven: null });
      const lines: string[] = [];
      const recovered = await recoverRehearsal(recoveryOptionsFor(s, run.path, lines));
      expect(recovered.stateBefore).toMatchObject({
        stage: "selling",
        ticketsSold: 0,
        ticketsCharged: 0,
        released: false,
      });
      expect(recovered.steps.map((item) => `${item.step}:${item.status}`)).toEqual([
        "start-engine:done",
        "recover:done",
        "reset:done",
        "stop-engine:done",
        "sweep:done",
      ]);
      expect(recovered.actions).toEqual([
        "engine started on the kept database with the production wiring",
        "sales closed through the merchant's route",
        "result NO forced through the demo route",
        "settled NO, released",
        "1 demo wallet(s) swept back to the treasury",
      ]);
      const counts = kindsOf(recovered);
      expect([...counts.keys()].sort()).toEqual(["closeSales", "release", "settle", "sweep"]);
      expect(counts.get("closeSales")).toBe(1);
      expect(counts.get("settle")).toBe(1);
      expect(counts.get("release")).toBe(1);
      // The budget came back to the merchant's wallet on release, and from it to the treasury.
      expect(recovered.sweep.map((row) => `${row.wallet}:${row.status}`)).toEqual([
        "merchant:swept",
        "buyer 1:empty",
      ]);
      expect(recovered.result?.source).toBe("forced by this recovery");
      await expectReleasedAndSwept(s, run, recovered);
      expectRecoveryClean(s, recovered, lines, 1);
    },
  );
});
