import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pino from "pino";
import { describe, expect, it } from "vitest";
import { HttpRequestError, type Address, type Hex } from "viem";

import type { CampaignEvents, OnchainCampaignState } from "./chain";
import { CliError, parseCli, percentToBps } from "./cli";
import { estimateRun, formatWei, withMargin, WEI_PER_MICRO } from "./estimate";
import {
  checkInvariants,
  chargesWithinGuarantee,
  escrowHoldsNothing,
  everySaleTicketed,
  guaranteesWithinCap,
  longestAboveLimitMs,
  moneyAddsUp,
  noSaleAbovePauseThreshold,
  noSaleBeyondBudget,
  refundsEqualRefundable,
  type InvariantInput,
} from "./invariants";
import {
  assertNoSecrets,
  compactUtc,
  receiptJson,
  redactText,
  stats,
  writeReceipt,
} from "./receipt";
import { describeEngineWarnings, moneyPartiesOf, rpcSecrets, runSecrets } from "./runner";
import { buyerOf, defaultBudget, resolveScenario } from "./scenario";
import { keepsThrowawayDatabase } from "./throwaway-db";
import { SecretLeakError, type BalanceRow, type RehearsalReceipt, type Scenario } from "./types";

/** The pure parts of the rehearsal: scenario, estimate, invariants, receipt, command line. */

const KEY_A = `0x${"a1".repeat(32)}` as Hex;
const KEY_B = `0x${"b2".repeat(32)}` as Hex;
const SEED = `0x${"c3".repeat(32)}` as Hex;

describe("scenario", () => {
  it("defaults to 12 sales of $0.50 to 6 buyers, with a budget that covers every guarantee", () => {
    const { scenario, problems } = resolveScenario({});
    expect(problems).toEqual([]);
    expect(scenario).toMatchObject({
      purchases: 12,
      unitsPerPurchase: 1,
      unitPrice: 500_000n,
      refundBps: 10_000,
      buyers: 6,
      outcome: "yes",
      // 12 × $0.50 × (65 % − 45 %) = $1.20.
      budget: 1_200_000n,
    });
    expect(
      defaultBudget({
        purchases: 1,
        unitsPerPurchase: 1,
        unitPrice: 500_000n,
        refundBps: 10_000,
        usualMarginBps: 6_500,
        minMarginBps: 4_500,
      }),
    ).toBe(500_000n);
  });

  it("refuses what the campaign route would refuse, and a budget below the guarantees", () => {
    expect(resolveScenario({ unitPrice: 50_000n }).problems.join()).toMatch(/at least \$0\.50/);
    expect(resolveScenario({ unitPrice: 505_000n }).problems.join()).toMatch(
      /whole number of cents/,
    );
    expect(resolveScenario({ purchases: 0 }).problems.join()).toMatch(/purchases/);
    expect(resolveScenario({ purchases: 301 }).problems.join()).toMatch(/purchases/);
    expect(resolveScenario({ unitsPerPurchase: 21 }).problems.join()).toMatch(/units per purchase/);
    expect(resolveScenario({ minMarginBps: 6_500 }).problems.join()).toMatch(/minimum margin/);
    expect(resolveScenario({ purchases: 12, budget: 500_000n }).problems.join()).toMatch(
      /below the largest guarantee/,
    );
    expect(resolveScenario({ purchases: 2, buyers: 3 }).problems.join()).toMatch(/buyers/);
  });

  it("spreads the sales over the buyers in turn", () => {
    expect([0, 1, 2, 3, 4].map((index) => buyerOf(index, 3))).toEqual([1, 2, 3, 1, 2]);
  });
});

describe("estimate", () => {
  const scenario = resolveScenario({}).scenario as Scenario;

  it("counts the budget, every sale and the merchant's due as fronted, and gas at the node's fee", () => {
    const estimate = estimateRun({
      scenario,
      nodeMaxFeePerGasWei: 2_000_000_000n,
      moneyMode: "erc20",
    });
    expect(estimate.treasuryLocks).toBe(1_200_000n + 6_000_000n + 6_000_000n);
    expect(estimate.feePerGasWei).toBe(2_000_000_000n);
    expect(estimate.relayerGasWei).toBe(estimate.relayerGas * 2_000_000_000n);
    // Gas is not money on a local chain: the treasury needs the locked amount only.
    expect(estimate.treasuryNeedsWithMargin).toBe(withMargin(13_200_000n * WEI_PER_MICRO));
  });

  it("on Arc, gas is USDC from the treasury's balance and never priced under the 20 gwei floor", () => {
    const estimate = estimateRun({
      scenario,
      nodeMaxFeePerGasWei: 1_000_000_000n,
      moneyMode: "native-usdc",
    });
    expect(estimate.feePerGasWei).toBe(20_000_000_000n);
    expect(estimate.treasuryNeedsWithMargin).toBe(
      withMargin(13_200_000n * WEI_PER_MICRO + estimate.relayerGasWei),
    );
  });

  it("formats every digit", () => {
    expect(formatWei(1_234_500_000_000_000_000n, 18)).toBe("1.2345");
    expect(formatWei(-5n, 6)).toBe("-0.000005");
    expect(formatWei(0n, 6)).toBe("0");
    expect(withMargin(100n)).toBe(120n);
  });
});

describe("invariants", () => {
  const treasury = "0x1111111111111111111111111111111111111111" as Address;
  const merchant = "0x2222222222222222222222222222222222222222" as Address;
  const buyer = "0x3333333333333333333333333333333333333333" as Address;
  const escrow = "0x4444444444444444444444444444444444444444" as Address;
  const scenario = resolveScenario({ purchases: 2, buyers: 1 }).scenario as Scenario;
  const events: CampaignEvents = {
    created: [{ budget: 500_000n, block: 1n }],
    purchased: [1n, 2n].map((ticketId) => ({
      ticketId,
      buyer,
      qty: 1,
      paid: 500_000n,
      refundable: 500_000n,
      maxHedgeCost: 70_000n,
      block: 2n,
    })),
    charged: [
      { ticketId: 1n, amount: 55_000n, block: 3n, hash: "0x01" },
      { ticketId: 2n, amount: 55_000n, block: 3n, hash: "0x01" },
    ],
    settled: [{ outcome: 1, merchantDue: 1_000_000n, block: 4n, hash: "0x02" }],
    refunded: [1n, 2n].map((ticketId) => ({
      ticketId,
      buyer,
      amount: 500_000n,
      block: 5n,
      hash: "0x03" as Hex,
    })),
    refundFailed: [],
    merchantPaid: [{ amount: 1_000_000n, block: 6n }],
    released: [{ block: 7n }],
  };
  const onchain: OnchainCampaignState = {
    merchant,
    hedgeBudget: 500_000n,
    hedgeReserved: 0n,
    hedgeSpent: 110_000n,
    lockedRefunds: 0n,
    merchantDue: 0n,
    salesClose: 0n,
    status: 2,
    released: true,
  };
  const micro = (value: bigint): bigint => value * WEI_PER_MICRO;
  // Treasury: −budget − paid − due + charges; merchant: budget + paid + due − charges − refunds.
  const input: InvariantInput = {
    scenario,
    outcome: "yes",
    pauseThresholdBps: 1_800,
    drivenAsksWhileOpen: [1_200, 1_100],
    pauseProbe: {
      bidBps: 1_900,
      askBps: 2_100,
      saleState: "paused_price",
      saleRefusal: "409 sales_paused",
      skipped: null,
    },
    events,
    onchain,
    escrow,
    treasury,
    merchant,
    parties: [
      {
        role: "treasury",
        address: treasury,
        beforeWei: micro(10_000_000n),
        afterWei: micro(10_000_000n - 500_000n - 1_000_000n - 1_000_000n + 110_000n),
        gasWei: 0n,
      },
      { role: "escrow", address: escrow, beforeWei: 0n, afterWei: 0n, gasWei: 0n },
      {
        role: "merchant",
        address: merchant,
        beforeWei: 0n,
        afterWei: micro(500_000n + 1_000_000n + 1_000_000n - 110_000n - 1_000_000n),
        gasWei: 0n,
      },
      { role: "buyer 1", address: buyer, beforeWei: 0n, afterWei: micro(1_000_000n), gasWei: 0n },
    ],
    deskSamples: [
      { atMs: 0, unhedgedNotional: 0n, uMax: 300_000_000n },
      { atMs: 1_000, unhedgedNotional: 1n, uMax: 300_000_000n },
    ],
    demoFlags: [{ source: "x", demo: true }],
    stripe: { budgetPi: "pi_budget", intentIds: ["pi_budget"], callIds: ["pi_budget"] },
  };

  it("all pass on a consistent run", () => {
    const results = checkInvariants(input);
    expect(results.filter((result) => !result.passed)).toEqual([]);
    expect(results).toHaveLength(11);
  });

  it("the money check finds one micro-unit astray, and a gas payment is not money lost", () => {
    const astray = {
      ...input,
      parties: input.parties.map((party) =>
        party.role === "merchant" ? { ...party, afterWei: party.afterWei - WEI_PER_MICRO } : party,
      ),
    };
    expect(moneyAddsUp(astray).passed).toBe(false);
    const withGas = {
      ...input,
      parties: input.parties.map((party) =>
        party.role === "treasury" ? { ...party, afterWei: party.afterWei - 7n, gasWei: 7n } : party,
      ),
    };
    expect(moneyAddsUp(withGas).passed).toBe(true);
  });

  it("an account whose balance after settlement was not read is reported unread, never given its balance before", () => {
    const rows = (pick: (party: (typeof input.parties)[number]) => bigint): BalanceRow[] =>
      input.parties.map((party) => ({
        role: party.role,
        address: party.address,
        moneyWei: pick(party),
        nativeWei: 0n,
      }));
    const before = rows((party) => party.beforeWei);
    const after = rows((party) => party.afterWei);
    const gas = new Map<Address, bigint>([[treasury, 7n]]);
    const complete = moneyPartiesOf(before, after, "erc20", gas);
    expect(complete.unread).toEqual([]);
    expect(complete.parties).toEqual(input.parties);
    // On Arc the gas a signer paid is money: it is carried into the check.
    expect(
      moneyPartiesOf(before, after, "native-usdc", gas).parties.find(
        (party) => party.address === treasury,
      )?.gasWei,
    ).toBe(7n);
    // The merchant's balance after settlement is missing from the snapshot.
    const missing = moneyPartiesOf(
      before,
      after.filter((row) => row.address !== merchant),
      "erc20",
      gas,
    );
    expect(missing.unread).toEqual([
      `the balance of merchant ${merchant} after settlement: not read`,
    ]);
    expect(missing.parties.map((party) => party.role)).toEqual(["treasury", "escrow", "buyer 1"]);
    const check = moneyAddsUp({ ...input, parties: missing.parties });
    expect(check.passed).toBe(false);
    expect(check.details).toContain(`${merchant} not measured`);
  });

  it("flags a charge above its guarantee, an ask at the threshold, a false demo flag, a stray Stripe call", () => {
    const failed = (changed: Partial<InvariantInput>): string[] =>
      checkInvariants({ ...input, ...changed })
        .filter((result) => !result.passed)
        .map((result) => result.name);
    expect(
      failed({
        events: {
          ...events,
          charged: [
            { ticketId: 1n, amount: 70_001n, block: 3n, hash: "0x01" },
            { ticketId: 2n, amount: 55_000n, block: 3n, hash: "0x01" },
          ],
        },
      }),
    ).toContain("no hedge charge above its quote's guarantee");
    expect(failed({ drivenAsksWhileOpen: [1_800] })).toEqual(["no sale above the pause threshold"]);
    expect(failed({ demoFlags: [{ source: "GET /api/t/:token", demo: false }] })).toEqual([
      "every answer about the campaign said demo",
    ]);
    expect(
      failed({
        stripe: {
          budgetPi: "pi_budget",
          intentIds: ["pi_budget"],
          callIds: ["pi_budget", "pi_demo_1"],
        },
      }),
    ).toEqual(["no demo payment reached the simulated Stripe"]);
  });

  /** The names of the invariants that fail once `changed` replaces part of the consistent run. */
  const failing = (changed: Partial<InvariantInput>): string[] =>
    checkInvariants({ ...input, ...changed })
      .filter((item) => !item.passed)
      .map((item) => item.name);
  const ticket = (index: number): CampaignEvents["purchased"][number] => {
    const found = events.purchased[index];
    if (found === undefined) throw new Error("no such ticket");
    return found;
  };

  it("finds a refund one micro-unit off, to another buyer, missing, doubled, or on a NO", () => {
    const refund = (changes: Partial<CampaignEvents["refunded"][number]>): InvariantInput => ({
      ...input,
      events: {
        ...events,
        refunded: events.refunded.map((item, index) =>
          index === 0 ? { ...item, ...changes } : item,
        ),
      },
    });
    expect(refundsEqualRefundable(input).passed).toBe(true);
    expect(refundsEqualRefundable(refund({ amount: 499_999n })).passed).toBe(false);
    expect(refundsEqualRefundable(refund({ amount: 500_001n })).passed).toBe(false);
    expect(refundsEqualRefundable(refund({ buyer: merchant })).passed).toBe(false);
    expect(
      refundsEqualRefundable({
        ...input,
        events: { ...events, refunded: events.refunded.slice(1) },
      }).passed,
    ).toBe(false);
    const first = events.refunded[0];
    if (first === undefined) throw new Error("no refund");
    expect(
      refundsEqualRefundable({
        ...input,
        events: { ...events, refunded: [...events.refunded, first] },
      }).passed,
    ).toBe(false);
    expect(refundsEqualRefundable({ ...input, outcome: "no" }).passed).toBe(false);
    expect(
      refundsEqualRefundable({
        ...input,
        events: { ...events, refundFailed: [{ ticketId: 1n, block: 5n }] },
      }).passed,
    ).toBe(false);
    expect(failing(refund({ amount: 499_999n }))).toContain(
      "every refund equals the ticket's refundable amount",
    );
  });

  it("finds anything the escrow still holds for the campaign", () => {
    const held = (changes: Partial<OnchainCampaignState>): InvariantInput => ({
      ...input,
      onchain: { ...onchain, ...changes },
    });
    expect(escrowHoldsNothing(input).passed).toBe(true);
    for (const changes of [
      { lockedRefunds: 1n },
      { merchantDue: 1n },
      { hedgeReserved: 1n },
      { released: false },
    ]) {
      expect(escrowHoldsNothing(held(changes)).passed, JSON.stringify(String(changes))).toBe(false);
    }
    const escrowGained = {
      ...input,
      parties: input.parties.map((party) =>
        party.role === "escrow" ? { ...party, afterWei: 1n } : party,
      ),
    };
    expect(escrowHoldsNothing(escrowGained).passed).toBe(false);
    expect(failing(held({ lockedRefunds: 1n }))).toEqual([
      "the escrow holds nothing for the campaign",
    ]);
  });

  it("finds guarantees or hedge spending beyond the budget, by one micro-unit", () => {
    // Two guarantees of 70 000: a budget of 139 999 is one short; 140 000 is exactly enough.
    const budget = (value: bigint): InvariantInput => ({
      ...input,
      events: { ...events, created: [{ budget: value, block: 1n }] },
    });
    expect(noSaleBeyondBudget(budget(140_000n)).passed).toBe(true);
    expect(noSaleBeyondBudget(budget(139_999n)).passed).toBe(false);
    expect(
      noSaleBeyondBudget({ ...input, onchain: { ...onchain, hedgeSpent: 500_001n } }).passed,
    ).toBe(false);
    expect(failing(budget(139_999n))).toContain("no sale beyond the budget");
  });

  it("finds a sale that was not ticketed on-chain, and units that do not match", () => {
    expect(everySaleTicketed(input).passed).toBe(true);
    expect(
      everySaleTicketed({ ...input, events: { ...events, purchased: [ticket(0)] } }).passed,
    ).toBe(false);
    expect(
      everySaleTicketed({
        ...input,
        events: { ...events, purchased: [ticket(0), { ...ticket(1), qty: 2 }] },
      }).passed,
    ).toBe(false);
    expect(failing({ events: { ...events, purchased: [ticket(0)] } })).toContain(
      "every sale ticketed on-chain",
    );
  });

  it("caps each guarantee at floor(price paid × (usual − minimum margin) / 10 000), no slack", () => {
    // Margins 65 % and 45 %: a cap of 2 000 bps. Paid 500 001: 100 000.2, so the cap is 100 000.
    const guarantee = (paid: bigint, maxHedgeCost: bigint): InvariantInput => ({
      ...input,
      events: { ...events, purchased: [{ ...ticket(0), paid, maxHedgeCost }, ticket(1)] },
    });
    expect(guaranteesWithinCap(guarantee(500_000n, 100_000n)).passed).toBe(true);
    expect(guaranteesWithinCap(guarantee(500_000n, 100_001n)).passed).toBe(false);
    expect(guaranteesWithinCap(guarantee(500_001n, 100_000n)).passed).toBe(true);
    expect(guaranteesWithinCap(guarantee(500_001n, 100_001n)).passed).toBe(false);
    expect(guaranteesWithinCap(guarantee(500_004n, 100_001n)).passed).toBe(false);
    expect(guaranteesWithinCap(guarantee(500_005n, 100_001n)).passed).toBe(true);
  });

  it("finds a ticket charged twice, never, or for another campaign", () => {
    const charged = (list: CampaignEvents["charged"]): InvariantInput => ({
      ...input,
      events: { ...events, charged: list },
    });
    const [first, second] = events.charged;
    if (first === undefined || second === undefined) throw new Error("no charges");
    expect(chargesWithinGuarantee(charged([first])).passed).toBe(false);
    expect(chargesWithinGuarantee(charged([first, second, first])).passed).toBe(false);
    expect(
      chargesWithinGuarantee(charged([first, second, { ...first, ticketId: 9n }])).passed,
    ).toBe(false);
    expect(chargesWithinGuarantee(charged([first, { ...second, amount: 70_000n }])).passed).toBe(
      true,
    );
  });

  it("needs the driven book under the threshold AND the engine seen pausing above it", () => {
    const probe = input.pauseProbe;
    if (probe === null) throw new Error("no probe");
    expect(noSaleAbovePauseThreshold(input).passed).toBe(true);
    const fails = (changed: Partial<InvariantInput>): boolean =>
      !noSaleAbovePauseThreshold({ ...input, ...changed }).passed;
    expect(fails({ pauseProbe: null })).toBe(true);
    expect(fails({ pauseProbe: { ...probe, skipped: "no room" } })).toBe(true);
    expect(fails({ pauseProbe: { ...probe, saleState: null } })).toBe(true);
    expect(fails({ pauseProbe: { ...probe, saleState: "paused_depth" } })).toBe(true);
    expect(fails({ pauseProbe: { ...probe, saleRefusal: null } })).toBe(true);
    expect(fails({ pauseProbe: { ...probe, saleRefusal: "404 not_found" } })).toBe(true);
    // A probe at the threshold itself proves nothing about prices above it.
    expect(fails({ pauseProbe: { ...probe, bidBps: 1_800 } })).toBe(true);
    expect(fails({ drivenAsksWhileOpen: [] })).toBe(true);
    expect(noSaleAbovePauseThreshold({ ...input, pauseProbe: null }).details).toContain(
      "no pause probe",
    );
  });

  it("allows the unhedged notional above its limit for five seconds, not more", () => {
    const sample = (atMs: number, above: boolean): InvariantInput["deskSamples"][number] => ({
      atMs,
      unhedgedNotional: above ? 2n : 0n,
      uMax: 1n,
    });
    expect(
      longestAboveLimitMs([
        sample(0, false),
        sample(1_000, true),
        sample(6_000, true),
        sample(7_000, false),
      ]),
    ).toBe(6_000);
    expect(longestAboveLimitMs([sample(0, true), sample(4_000, true), sample(5_000, false)])).toBe(
      5_000,
    );
  });
});

describe("receipt", () => {
  it("never carries a key, the seed, a key without its 0x, or an e-mail address", () => {
    expect(() => assertNoSecrets(`x ${KEY_A} y`, [KEY_A], "t")).toThrow(SecretLeakError);
    expect(() => assertNoSecrets(`x ${KEY_A.slice(2).toUpperCase()} y`, [KEY_A], "t")).toThrow(
      SecretLeakError,
    );
    expect(() => assertNoSecrets("buyer rehearsal-1@example.com", [KEY_A], "t")).toThrow(
      SecretLeakError,
    );
    expect(() => assertNoSecrets("0x1234 and a hash", [KEY_A, KEY_B, SEED], "t")).not.toThrow();
    try {
      assertNoSecrets(KEY_A, [KEY_A], "the receipt");
    } catch (error: unknown) {
      expect(String(error)).not.toContain(KEY_A.slice(2));
    }
  });

  it("writes bigints as strings, names files by the UTC start time, and summarises timings", () => {
    expect(compactUtc("2026-11-18T20:30:12.345Z")).toBe("20261118T203012Z");
    const json = receiptJson({ gasWei: 10n, files: { json: "a", markdown: "b" } } as never);
    expect(JSON.parse(json)).toEqual({ gasWei: "10" });
    expect(stats([5, 1, 3])).toEqual({ count: 3, minMs: 1, medianMs: 3, maxMs: 5 });
    expect(stats([1, 2, 3, 4])).toMatchObject({ medianMs: 3 });
    expect(stats([])).toEqual({ count: 0, minMs: null, medianMs: null, maxMs: null });
  });

  it("treats the path and query of an RPC URL as possible access tokens", () => {
    expect(rpcSecrets("https://rpc.testnet.arc.io")).toEqual([]);
    expect(rpcSecrets("https://x.quiknode.pro/0123456789abcdef0123/")).toEqual([
      "0123456789abcdef0123",
    ]);
    expect(
      rpcSecrets("https://x.example/v2/fedcba9876543210fedc?key=0011223344556677aabb"),
    ).toEqual(expect.arrayContaining(["fedcba9876543210fedc", "0011223344556677aabb"]));
    expect(rpcSecrets("https://user:s3cret-pass@x.example/")).toEqual(["s3cret-pass"]);
  });
});

describe("an RPC access token in an engine warning (viem quotes the URL in its errors)", () => {
  const TOKEN = "0123456789abcdef0123456789abcdef";
  const RPC_URL = `https://still-silent-river.arc-testnet.quiknode.pro/${TOKEN}/`;
  const options = {
    secrets: { relayerKey: KEY_A, oracleKey: KEY_B, demoSeed: SEED },
    rpcUrl: RPC_URL,
  };
  const secrets = runSecrets(options, ["rehearsal-1@example.com"]);
  /** The engine's job worker logs a failed job as `{ err }`: what pino makes of viem's error. */
  const warning = {
    level: 40,
    module: "jobs",
    msg: "job failed, will retry",
    err: pino.stdSerializers.err(
      new HttpRequestError({
        url: RPC_URL,
        status: 429,
        body: { method: "eth_sendRawTransaction" },
      }),
    ) as unknown,
  };

  it("is in the error pino serializes", () => {
    expect(JSON.stringify(warning.err)).toContain(TOKEN);
    expect(secrets).toContain(TOKEN);
  });

  it("is left out of the warnings quoted in a timeout's reason", () => {
    const described = describeEngineWarnings([warning]);
    expect(described).toContain("HTTP request failed");
    expect(described).not.toContain(TOKEN);
  });

  it("is replaced in any text printed or written, with keys, the seed and e-mail addresses", () => {
    const text = `URL: ${RPC_URL} key ${KEY_A} bare ${SEED.slice(2).toUpperCase()} to rehearsal-1@example.com`;
    const redacted = redactText(text, secrets);
    for (const secret of [TOKEN, KEY_A.slice(2), SEED.slice(2)]) {
      expect(redacted.toLowerCase()).not.toContain(secret);
    }
    expect(redacted).not.toContain("@example.com");
    expect(redacted).toContain("<redacted>");
    expect(() => assertNoSecrets(redacted, secrets, "t")).not.toThrow();
    // Short values are not secrets: a path such as "v2" is left alone.
    expect(redactText("https://x/v2/", ["v2"])).toBe("https://x/v2/");
  });

  it("does not cost the run its receipt: the receipt is written with the token redacted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winz-rehearsal-unit-"));
    try {
      const reason = `timed out after 1000 ms waiting for x; engine warnings: [40] jobs failed (${String((warning.err as { message: string }).message)})`;
      const receipt = {
        startedAt: "2026-11-18T20:30:12.345Z",
        finishedAt: "2026-11-18T20:31:00.000Z",
        status: "failed",
        failure: { step: "hedging", reason },
        chain: {
          chainId: 5_042_002,
          name: "Arc testnet",
          local: false,
          rpcHost: "x",
          explorer: null,
          moneyMode: null,
          token: null,
        },
        escrow: {
          address: KEY_A.slice(0, 42),
          deployBlock: 1n,
          runStartBlock: null,
          engineStartBlock: null,
        },
        roles: { relayer: "0x1", oracle: "0x2", treasury: null, merchant: null, buyers: [] },
        engine: { started: true, stopped: true },
        game: null,
        instrument: null,
        campaign: null,
        scenario: null,
        driven: null,
        pauseProbe: null,
        estimate: null,
        steps: [],
        transactions: [],
        purchases: [],
        timings: { callToTicket: stats([]), callToDashboard: stats([]), refunds: null },
        hedging: null,
        invariants: [],
        balances: { before: [], afterSettlement: [], afterSweep: [] },
        netCostWei: null,
        gasWei: 0n,
        sweep: [],
        leftBehind: [`engine said ${RPC_URL}`],
        unread: [`the campaign on-chain: HTTP request failed. URL: ${RPC_URL}`],
        rpc: null,
        recovery: null,
        stranded: false,
      } as unknown as RehearsalReceipt;
      const files = await writeReceipt(receipt, dir, secrets);
      for (const file of [files.json, files.markdown]) {
        const text = readFileSync(file, "utf8");
        expect(text).not.toContain(TOKEN);
        expect(text).toContain("hedging");
        expect(text).toContain("<redacted>");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the command's throwaway database", () => {
  it("is kept when the run leaves its campaign unreleased on-chain, dropped otherwise", () => {
    expect(keepsThrowawayDatabase({ stranded: true })).toBe(true);
    expect(keepsThrowawayDatabase({ stranded: false })).toBe(false);
  });
});

describe("command line", () => {
  const env = {
    ARC_RELAYER_PRIVATE_KEY: KEY_A,
    ARC_ORACLE_PRIVATE_KEY: KEY_B,
    APP_DEMO_WALLET_SEED: SEED,
    ARC_RPC_URL: "https://rpc.testnet.arc.io",
    DB_URL: "postgres://localhost/winz",
  };

  it("on Arc testnet takes the committed deployment and writes receipts under docs/rehearsals", () => {
    const parsed = parseCli(
      ["--purchases", "20", "--unit-price", "0.50", "--refund-pct", "50", "--outcome", "no"],
      env,
    );
    expect(parsed.options).toMatchObject({
      chainId: 5_042_002,
      local: false,
      escrowAddress: "0x81d2d4050E617184b2B832c30BE68f8811b37D2c",
      escrowDeployBlock: 72_727_350n,
      scenario: { purchases: 20, unitPrice: 500_000n, refundBps: 5_000, outcome: "no" },
      gemini: { kind: "live", apiUrl: "https://api.gemini.com", wsUrl: "wss://ws.gemini.com" },
      estimateOnly: false,
    });
    expect(parsed.options.receiptDir).toMatch(/\/docs\/rehearsals$/);
    expect(parsed.databaseUrl).toBe("postgres://localhost/winz");
  });

  it("on a local chain writes receipts to a temp directory", () => {
    const parsed = parseCli(
      [
        "--chain-id",
        "31337",
        "--escrow",
        "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        "--deploy-block",
        "1",
        "--throwaway-db",
        "--gemini",
        "simulated",
        "--estimate",
      ],
      { ...env, DB_URL: undefined },
    );
    expect(parsed.throwawayDb).toBe(true);
    expect(parsed.options.estimateOnly).toBe(true);
    expect(parsed.options.gemini).toEqual({ kind: "simulated" });
    expect(parsed.options.receiptDir?.startsWith(tmpdir())).toBe(true);
  });

  it("takes secrets from the environment only, and lists every problem at once", () => {
    expect(() => parseCli(["--relayer-key", KEY_A], env)).toThrow(CliError);
    let problems: readonly string[] = [];
    try {
      parseCli(["--outcome", "maybe", "--refund-pct", "abc"], {
        ARC_RPC_URL: "https://rpc.testnet.arc.io",
      });
    } catch (error: unknown) {
      if (error instanceof CliError) problems = error.problems;
    }
    const text = problems.join("\n");
    for (const expected of [
      "ARC_RELAYER_PRIVATE_KEY",
      "ARC_ORACLE_PRIVATE_KEY",
      "APP_DEMO_WALLET_SEED",
      "--outcome",
      "--refund-pct",
      "no database",
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain(KEY_A.slice(2));
  });

  it("reads percentages to the basis point", () => {
    expect(percentToBps("65")).toBe(6_500);
    expect(percentToBps("12.5")).toBe(1_250);
    expect(percentToBps("0.05")).toBe(5);
    expect(percentToBps("1.234")).toBeNull();
  });
});
