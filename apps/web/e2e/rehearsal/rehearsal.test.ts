import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, getAddress, http, type Hex } from "viem";

import { startAnvil, type AnvilInstance } from "../../../engine/src/testing/anvil";
import { deployTestEscrow, testUsdcAbi, type TestEscrow } from "../../../engine/src/testing/escrow";
import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import { LOCAL_CHAIN_ID, runRehearsal, secretsOf } from "./runner";
import { buyerEmail, merchantEmail } from "./scenario";
import {
  RehearsalRefusedError,
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
    // As in the other end-to-end scenarios: E2E_LOG_FILE collects the engine's log when set.
    ...(process.env.E2E_LOG_FILE === undefined || process.env.E2E_LOG_FILE === ""
      ? {}
      : { engineLogFile: process.env.E2E_LOG_FILE }),
    ...extra,
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
      const options = optionsFor(s, { purchases: 6, buyers: 3, outcome: "yes" });
      const receipt = await runRehearsal(options);
      expectPassed(receipt);
      expectMined(receipt);
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
    "NO, a second run on the same database and escrow: no refund, the merchant keeps the rest",
    { timeout: RUN_TIMEOUT_MS },
    async () => {
      if (shared === null) throw new Error("the YES run did not set up the chain");
      const s = await setup(shared);
      const options = optionsFor(s, { purchases: 6, buyers: 3, outcome: "no" });
      const receipt = await runRehearsal(options);
      expectPassed(receipt);
      expectMined(receipt);
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
