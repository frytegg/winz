import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  BaseError,
  CallExecutionError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  HttpRequestError,
  InternalRpcError,
  RpcRequestError,
  TimeoutError,
  createPublicClient,
  custom,
  type Address,
} from "viem";

import { winzEscrowAbi } from "@winz/shared";

import { RpcLimiterClosedError } from "../../../engine/src/chain";
import { ApiCallError } from "../support/api";
import { WaitTimeoutError } from "../support/wait";
import {
  BlockClock,
  escrowHolds,
  logSpans,
  stageOf,
  walletsLeftBehind,
  type OnchainCampaignState,
} from "./chain";
import { CliError, parseCli } from "./cli";
import { GAS_UNITS } from "./estimate";
import {
  RecoveryReceiptError,
  campaignState,
  estimateRecovery,
  parseRunReceipt,
  readRunReceipt,
  recoveryBaseName,
  recoveryMarkdown,
  recoveryResult,
  resultLines,
  settledOutcome,
} from "./recovery";
import {
  ReadFailedError,
  RpcMeter,
  backoffDelayMs,
  classifyFailure,
  meteredClient,
  rateLimitAnswer,
  retryPolicy,
  withRetry,
} from "./rpc";
import { ENGINE_START_MARGIN_BLOCKS, engineStartBlockOf } from "./runner";
import {
  InjectedFailureError,
  RehearsalAbortedError,
  type BalanceRow,
  type CampaignStateRecord,
  type RecoveryReceipt,
  type SweepRecordRow,
} from "./types";

/**
 * The pure parts of a rehearsal that survives a node rate-limiting it and of `--recover`: which
 * failures are worth waiting out, the bounded retry, the counted client, the receipt a recovery
 * starts from (the real one the first Arc run wrote), what is left to send, and the command line.
 */

const ARC_RECEIPT = fileURLToPath(
  new URL("../../../../docs/rehearsals/20261118T031821Z-5042002-yes.json", import.meta.url),
);
const KEY_A = `0x${"11".repeat(32)}`;
const KEY_B = `0x${"22".repeat(32)}`;
const SEED = `0x${"33".repeat(32)}`;

function apiError(status: number): ApiCallError {
  return new ApiCallError("GET /api/x", status, {
    error: { code: "x", message: "x" },
  } as never);
}

describe("the classification of a failure: transient (wait it out) or permanent (fail now)", () => {
  it("waits out a rate limit however the node words it, a timeout, a 5xx and a lost connection", () => {
    // What Arc's public RPC answered (HTTP 429, -32005), as viem reports it.
    expect(classifyFailure(rateLimitAnswer("eth_getLogs"))).toBe("transient");
    // The same inside a contract read, as readContract wraps it.
    const wrapped = new ContractFunctionExecutionError(
      new CallExecutionError(rateLimitAnswer("eth_call"), {}),
      { abi: winzEscrowAbi, functionName: "getCampaign", args: [1n] },
    );
    expect(classifyFailure(wrapped)).toBe("transient");
    expect(classifyFailure(new HttpRequestError({ url: "http://x", status: 429, body: {} }))).toBe(
      "transient",
    );
    expect(classifyFailure(new HttpRequestError({ url: "http://x", status: 503, body: {} }))).toBe(
      "transient",
    );
    // No status: the request got no answer at all.
    expect(classifyFailure(new HttpRequestError({ url: "http://x", body: {} }))).toBe("transient");
    expect(classifyFailure(new TimeoutError({ body: {}, url: "http://x" }))).toBe("transient");
    expect(classifyFailure(new InternalRpcError(new Error("internal")))).toBe("transient");
    expect(
      classifyFailure(
        new RpcRequestError({
          body: {},
          error: { code: -32007, message: "10/second request limit reached" },
          url: "http://x",
        }),
      ),
    ).toBe("transient");
    const reset = Object.assign(new Error("fetch failed"), {
      cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    });
    expect(classifyFailure(reset)).toBe("transient");
    // Postgres: the connection dropped, the server restarting, a deadlock.
    expect(classifyFailure(Object.assign(new Error("x"), { code: "CONNECTION_CLOSED" }))).toBe(
      "transient",
    );
    expect(classifyFailure(Object.assign(new Error("x"), { code: "57P01" }))).toBe("transient");
    expect(classifyFailure(Object.assign(new Error("x"), { code: "08006" }))).toBe("transient");
    expect(classifyFailure(Object.assign(new Error("x"), { code: "40P01" }))).toBe("transient");
    // A route that answers 429, 503 or 500.
    for (const status of [429, 500, 502, 503, 504]) {
      expect(classifyFailure(apiError(status))).toBe("transient");
    }
  });

  it("fails at once on a refusal of the product, a revert, a range, an abort, an injection", () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(classifyFailure(apiError(status))).toBe("permanent");
    }
    const revert = new ContractFunctionExecutionError(
      new ContractFunctionRevertedError({
        abi: winzEscrowAbi,
        functionName: "getCampaign",
        message: "execution reverted: rate limit",
      }),
      { abi: winzEscrowAbi, functionName: "getCampaign", args: [1n] },
    );
    expect(classifyFailure(revert)).toBe("permanent");
    expect(
      classifyFailure(
        new RpcRequestError({
          body: {},
          error: { code: -32012, message: "requested range too large" },
          url: "http://x",
        }),
      ),
    ).toBe("permanent");
    expect(classifyFailure(new HttpRequestError({ url: "http://x", status: 401, body: {} }))).toBe(
      "permanent",
    );
    expect(classifyFailure(new InjectedFailureError("hedging"))).toBe("permanent");
    expect(classifyFailure(new RehearsalAbortedError())).toBe("permanent");
    expect(classifyFailure(new WaitTimeoutError("timed out"))).toBe("permanent");
    expect(classifyFailure(new ReadFailedError("x", 3, new Error("y")))).toBe("permanent");
    expect(classifyFailure(new RpcLimiterClosedError("eth_call"))).toBe("permanent");
    expect(classifyFailure(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(
      "permanent",
    );
    // A bug is not waited out for minutes.
    expect(classifyFailure(new TypeError("x is undefined"))).toBe("permanent");
    expect(classifyFailure(new BaseError("unknown"))).toBe("permanent");
    expect(classifyFailure("a string")).toBe("permanent");
  });
});

describe("the bounded retry of a read", () => {
  it("doubles its delays up to the ceiling", () => {
    const policy = retryPolicy({ baseDelayMs: 100, maxDelayMs: 1_000 });
    expect([1, 2, 3, 4, 5, 6].map((retry) => backoffDelayMs(policy, retry))).toEqual([
      100, 200, 400, 800, 1_000, 1_000,
    ]);
    expect(retryPolicy(undefined)).toEqual({ attempts: 6, baseDelayMs: 1_000, maxDelayMs: 16_000 });
  });

  it("tries again on a transient failure, names what it could not read, and stops on a permanent one", async () => {
    const policy = { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 };
    let calls = 0;
    let retries = 0;
    await expect(
      withRetry(
        "the head",
        () => {
          calls += 1;
          return calls < 3
            ? Promise.reject(rateLimitAnswer("eth_blockNumber"))
            : Promise.resolve(7n);
        },
        { policy, onRetry: () => (retries += 1) },
      ),
    ).resolves.toBe(7n);
    expect([calls, retries]).toEqual([3, 2]);

    const failed = await withRetry("the head", () => Promise.reject(rateLimitAnswer("x")), {
      policy,
    }).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(ReadFailedError);
    expect((failed as ReadFailedError).message).toBe(
      "the head could not be read (3 attempts; last error: Request exceeds defined limit.)",
    );

    calls = 0;
    const refused = await withRetry(
      "a page",
      () => {
        calls += 1;
        return Promise.reject(apiError(404));
      },
      { policy },
    ).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ApiCallError);
    expect(calls).toBe(1);
  });
});

describe("the runner's counted client", () => {
  it("counts every request with its step, the refusals and the rate limits; a fault never reaches the node", async () => {
    const reached: string[] = [];
    const base = createPublicClient({
      transport: custom({
        request: ({ method }: { method: string }): Promise<unknown> => {
          reached.push(method);
          return Promise.resolve(method === "eth_blockNumber" ? "0x10" : "0x1");
        },
      }),
    });
    const meter = new RpcMeter();
    const current = { step: "hedging" as string | null };
    let refuse = true;
    const client = meteredClient(base, {
      meter,
      step: () => current.step,
      fault: ({ method }) =>
        refuse && method === "eth_blockNumber" ? rateLimitAnswer(method) : null,
    });
    await expect(client.getBlockNumber({ cacheTime: 0 })).rejects.toThrow(
      "Request exceeds defined limit.",
    );
    refuse = false;
    await expect(client.getBlockNumber({ cacheTime: 0 })).resolves.toBe(16n);
    current.step = "settle";
    await expect(client.getChainId()).resolves.toBe(1);
    expect(reached).toEqual(["eth_blockNumber", "eth_chainId"]);
    meter.noteRetry();
    const summary = meter.summary(
      [
        { step: "hedging", startedAt: "", durationMs: 2_000, status: "done" },
        { step: "settle", startedAt: "", durationMs: 1_000, status: "done" },
      ],
      { started: 2, rateLimited: 0, coolDowns: 0 },
    );
    expect(summary).toEqual({
      requests: 3,
      refused: 1,
      rateLimited: 1,
      retried: 1,
      perStep: [
        { step: "hedging", requests: 2, durationMs: 2_000 },
        { step: "settle", requests: 1, durationMs: 1_000 },
      ],
      limiter: { started: 2, rateLimited: 0, coolDowns: 0 },
    });
  });
});

describe("frugal reads of the chain", () => {
  it("splits a span of blocks into eth_getLogs of at most 1 000 blocks", () => {
    expect(logSpans(10n, 9n)).toEqual([]);
    expect(logSpans(5n, 5n)).toEqual([{ fromBlock: 5n, toBlock: 5n }]);
    expect(logSpans(72_784_813n, 72_787_000n)).toEqual([
      { fromBlock: 72_784_813n, toBlock: 72_785_812n },
      { fromBlock: 72_785_813n, toBlock: 72_786_812n },
      { fromBlock: 72_786_813n, toBlock: 72_787_000n },
    ]);
  });

  it("dates each block by the first time the head was seen at it or past it", () => {
    const clock = new BlockClock(
      createPublicClient({ transport: custom({ request: () => Promise.resolve("0x0") }) }),
      500,
    );
    clock.note(100n, 1_000);
    clock.note(100n, 1_500);
    clock.note(103n, 2_000);
    clock.note(102n, 2_500);
    clock.note(104n, 3_000);
    expect(clock.firstSeenAtMs(100n)).toBe(1_000);
    // 101 to 103 were mined between two reads: all dated by the read that saw 103.
    expect(clock.firstSeenAtMs(101n)).toBe(2_000);
    expect(clock.firstSeenAtMs(103n)).toBe(2_000);
    expect(clock.firstSeenAtMs(104n)).toBe(3_000);
    expect(clock.firstSeenAtMs(105n)).toBeNull();
  });

  it("starts the engine near the head on a fresh database, never before the deploy block", () => {
    expect(engineStartBlockOf({ escrowDeployBlock: 10n }, 1_000n)).toBe(10n);
    expect(engineStartBlockOf({ escrowDeployBlock: 10n, startNearHead: true }, 1_000n)).toBe(
      1_000n - ENGINE_START_MARGIN_BLOCKS,
    );
    expect(engineStartBlockOf({ escrowDeployBlock: 990n, startNearHead: true }, 1_000n)).toBe(990n);
    expect(engineStartBlockOf({ escrowDeployBlock: 0n, startNearHead: true }, 20n)).toBe(0n);
  });
});

function onchain(partial: Partial<OnchainCampaignState>): OnchainCampaignState {
  return {
    merchant: "0x0000000000000000000000000000000000000001",
    hedgeBudget: 1_200_000n,
    hedgeReserved: 0n,
    hedgeSpent: 660_000n,
    lockedRefunds: 6_000_000n,
    merchantDue: 0n,
    salesClose: 2_000n,
    status: 0,
    released: false,
    ...partial,
  };
}

describe("the receipt a recovery starts from", () => {
  it("reads the FAILED receipt of the first Arc run (version 1) as it was written", () => {
    const facts = readRunReceipt(ARC_RECEIPT);
    expect(facts).toMatchObject({
      version: 1,
      runId: "d171ed2352fa",
      status: "failed",
      failure: { step: "hedging", reason: "Request exceeds defined limit." },
      chainId: 5_042_002,
      moneyMode: "native-usdc",
      escrow: {
        address: "0x81d2d4050E617184b2B832c30BE68f8811b37D2c",
        deployBlock: 72_727_571n,
        runStartBlock: 72_784_813n,
        engineStartBlock: null,
      },
      roles: { merchant: "0xee18f205461B42416F3099bc583FD4Be27d66C32" },
      gemini: "live",
      campaign: {
        id: "b581dd22-c475-4d0f-b4cb-25f8d2e1df30",
        onchainId: 2n,
        slug: "rehearsal-merchant-jackson-state-wins",
      },
      instrument: "GEMI-NCAAM-2611181700-JKST-BAY-M-JKST",
      scenario: { purchases: 12, unitPrice: 500_000n, budget: 1_200_000n, outcome: "yes" },
      driven: { bidBps: 1_000, askBps: 1_200, depth: 100_000_000n },
    });
    expect(facts.roles.buyers.map((buyer) => buyer.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(recoveryBaseName(ARC_RECEIPT)).toBe("20261118T031821Z-5042002-yes-recovery");
  });

  it("refuses a receipt with no campaign, an estimate, or one that is not a receipt", () => {
    const base = JSON.parse(readFileSync(ARC_RECEIPT, "utf8")) as Record<string, unknown>;
    const reasons = (text: string): string[] => {
      try {
        parseRunReceipt(text, "/x/r.json");
      } catch (error: unknown) {
        if (error instanceof RecoveryReceiptError) return [...error.reasons];
        throw error;
      }
      return [];
    };
    expect(reasons(JSON.stringify({ ...base, campaign: null }))).toEqual([
      "r.json names no campaign: the run stopped before creating one, nothing is in the escrow",
    ]);
    expect(reasons(JSON.stringify({ ...base, status: "estimate" }))[0]).toMatch(/estimate/);
    expect(reasons("not json")).toEqual(["r.json is not JSON"]);
    expect(reasons(JSON.stringify({ ...base, runId: 7 }))[0]).toMatch(/^r\.json: runId/);
  });
});

describe("where a campaign stands, and what a recovery still sends", () => {
  const events = {
    created: [],
    purchased: [1n, 2n, 3n].map((ticketId) => ({
      ticketId,
      buyer: "0x0000000000000000000000000000000000000002" as Address,
      qty: 1,
      paid: 500_000n,
      refundable: 500_000n,
      maxHedgeCost: 100_000n,
      block: 5n,
    })),
    charged: [{ ticketId: 1n, amount: 55_000n, block: 6n, hash: "0x01" as const }],
    settled: [],
    refunded: [],
    refundFailed: [],
    merchantPaid: [],
    released: [],
  };

  it("says selling, paused, sales closed, settled or released, and what the escrow holds", () => {
    expect(stageOf(onchain({}), 1_999n)).toBe("selling");
    expect(stageOf(onchain({ status: 1 }), 1_999n)).toBe("paused");
    expect(stageOf(onchain({}), 2_000n)).toBe("sales closed");
    expect(stageOf(onchain({ status: 2 }), 3_000n)).toBe("settled yes");
    expect(stageOf(onchain({ status: 3 }), 3_000n)).toBe("settled no");
    expect(stageOf(onchain({ status: 3, released: true }), 3_000n)).toBe("released");
    // Arc's stranded campaign: 0.54 of budget unspent and 6 USDC of refunds locked.
    expect(escrowHolds(onchain({}))).toBe(6_540_000n);
    expect(escrowHolds(onchain({ released: true, lockedRefunds: 0n }))).toBe(0n);
    const state = campaignState(onchain({}), events, 100n, 1_500n);
    expect(state).toMatchObject({
      stage: "selling",
      ticketsSold: 3,
      ticketsCharged: 1,
      ticketsRefunded: 0,
      escrowHolds: 6_540_000n,
    });
  });

  it("counts the charges left, the settle, the close if open, refunds and the merchant's due on YES", () => {
    const fee = 20_000_000_000n;
    const selling = campaignState(onchain({}), events, 100n, 1_500n);
    const forcedNo = estimateRecovery({
      state: selling,
      decided: null,
      refundableSold: 1_500_000n,
      unrefundedTickets: 3,
      nodeMaxFeePerGasWei: fee,
      moneyMode: "native-usdc",
    });
    expect(forcedNo.oracleGas).toBe(2n * GAS_UNITS.chargeHedgePerTicket + GAS_UNITS.settle);
    expect(forcedNo.relayerGas).toBe(GAS_UNITS.closeSales + GAS_UNITS.release + GAS_UNITS.buyFor);
    expect(forcedNo.treasuryPays).toBe(0n);
    const yes = estimateRecovery({
      state: selling,
      decided: "yes",
      refundableSold: 1_500_000n,
      unrefundedTickets: 3,
      nodeMaxFeePerGasWei: fee,
      moneyMode: "native-usdc",
    });
    expect(yes.relayerGas).toBe(
      GAS_UNITS.closeSales +
        GAS_UNITS.refundBatchBase +
        3n * GAS_UNITS.refundPerTicket +
        GAS_UNITS.payMerchant +
        GAS_UNITS.release +
        GAS_UNITS.buyFor,
    );
    expect(yes.treasuryPays).toBe(1_500_000n);
    // On Arc the treasury pays the due and the relayer's gas from one balance, with 20 %.
    expect(yes.treasuryNeedsWithMargin).toBe(
      ((1_500_000n * 1_000_000_000_000n + yes.relayerGas * fee) * 120n + 99n) / 100n,
    );
    const released = campaignState(onchain({ status: 3, released: true }), events, 100n, 3_000n);
    expect(
      estimateRecovery({
        state: released,
        decided: "no",
        refundableSold: 1_500_000n,
        unrefundedTickets: 0,
        nodeMaxFeePerGasWei: fee,
        moneyMode: "erc20",
      }),
    ).toMatchObject({ relayerGas: 0n, oracleGas: 0n, treasuryPays: 0n });
  });

  it("writes a recovery's Markdown with the states, the actions, the sweep and what is left", () => {
    const state: CampaignStateRecord = campaignState(onchain({}), events, 100n, 1_500n);
    const receipt = {
      version: 2,
      kind: "recovery",
      recovers: {
        file: "20261118T031821Z-5042002-yes.json",
        runId: "d171ed2352fa",
        status: "failed",
        failure: { step: "hedging", reason: "Request exceeds defined limit." },
        startedAt: "2026-11-18T03:18:21.081Z",
      },
      status: "failed",
      failure: null,
      startedAt: "x",
      finishedAt: "y",
      chain: { chainId: 5_042_002, name: "Arc testnet", rpcHost: "rpc.testnet.arc.io" },
      escrow: { address: "0x81d2d4050E617184b2B832c30BE68f8811b37D2c" },
      campaign: { id: "b581dd22", onchainId: 2n, slug: "s", instrument: "GEMI-X" },
      gemini: "live",
      engine: { started: true, stopped: true },
      outcome: "no",
      actions: ["sales closed through the merchant's route"],
      stateBefore: state,
      stateAfter: null,
      estimate: null,
      steps: [],
      transactions: [],
      balances: { before: [], after: [] },
      sweep: [],
      leftBehind: ["campaign 2 is not released"],
      unread: ["the campaign's state after the recovery: Request exceeds defined limit."],
      rpc: null,
    } as unknown as RecoveryReceipt;
    const text = recoveryMarkdown(receipt);
    expect(text).toContain("# Recovery of the rehearsal d171ed2352fa: FAILED");
    expect(text).toContain("Recovers `20261118T031821Z-5042002-yes.json`");
    expect(text).toContain("Before: selling at block 100: 3 ticket(s) sold, 1 charged");
    expect(text).toContain("After: could not be read.");
    expect(text).toContain("- sales closed through the merchant's route");
    expect(text).toContain("## Could not be read");
    expect(text).toContain("- campaign 2 is not released");
    // A receipt written before `result` existed reads as before; one with it names the result.
    expect(text).not.toContain("Settled with");
    const withResult = recoveryMarkdown({
      ...receipt,
      result: recoveryResult({
        settled: 1,
        source: "forced by this recovery",
        scenarioOutcome: "yes",
        runId: "d171ed2352fa",
      }),
    });
    expect(withResult).toContain(
      "Settled with: NO (forced by this recovery); the run's scenario asked for YES.",
    );
    expect(withResult).toContain("\nThe campaign was settled NO, not YES as the scenario of run");
  });
});

describe("what a sweep left behind, from the balances read after it", () => {
  const wallet = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}` as Address;
  const wallets = [1, 2, 3, 4].map((n) => ({ label: `buyer ${n.toString()}`, address: wallet(n) }));
  const row = (n: number, status: string): SweepRecordRow => ({
    wallet: `buyer ${n.toString()}`,
    address: wallet(n),
    status,
    sentWei: 0n,
    gasWei: 0n,
    txHash: null,
  });
  const balance = (n: number, moneyWei: bigint): BalanceRow => ({
    role: `buyer ${n.toString()}`,
    address: wallet(n),
    moneyWei,
    nativeWei: moneyWei,
  });

  it("a failed row whose wallet is read at zero leaves nothing; money or an unread balance does", () => {
    const sweep = [row(1, "failed"), row(2, "failed"), row(3, "swept"), row(4, "failed")];
    const after = [balance(1, 0n), balance(2, 5n * 10n ** 17n), balance(3, 10n ** 12n)];
    expect(walletsLeftBehind(sweep, after, wallets)).toEqual([
      `buyer 2 ${wallet(2)} was not swept: it still holds 0.5 USDC`,
      `buyer 3 ${wallet(3)} still holds 0.000001 USDC after the sweep`,
      `buyer 4 ${wallet(4)} was not swept, and its balance after the sweep could not be read`,
    ]);
    // No balance read at all: only the failed rows are named.
    expect(walletsLeftBehind(sweep, null, wallets)).toEqual(
      [1, 2, 4].map(
        (n) =>
          `buyer ${n.toString()} ${wallet(n)} was not swept, and its balance after the sweep could not be read`,
      ),
    );
    expect(
      walletsLeftBehind([row(1, "swept"), row(2, "empty")], [balance(1, 0n)], wallets),
    ).toEqual([]);
  });
});

describe("the result a recovery settled with", () => {
  it("reads the escrow's outcome: 0 YES, 1 NO, 2 VOID", () => {
    expect([0, 1, 2, 3].map(settledOutcome)).toEqual(["yes", "no", "void", null]);
  });

  it("says nothing more when it is the run's, and one sentence naming why when it is not", () => {
    const kept = recoveryResult({
      settled: 0,
      source: "already forced in the database",
      scenarioOutcome: "yes",
      runId: "d171ed2352fa",
    });
    expect(kept).toEqual({
      settledWith: "yes",
      source: "already forced in the database",
      scenarioOutcome: "yes",
      differs: null,
    });
    expect(resultLines(kept)).toEqual([
      "Settled with: YES (already forced in the database); the run's scenario asked for YES.",
    ]);
    const forced = recoveryResult({
      settled: 1,
      source: "forced by this recovery",
      scenarioOutcome: "yes",
      runId: "d171ed2352fa",
    });
    expect(forced.settledWith).toBe("no");
    expect(forced.differs).toBe(
      "The campaign was settled NO, not YES as the scenario of run d171ed2352fa asked: no result was forced or known any more when this recovery started (the run's own reset clears the result it forced, even when the settlement has not landed yet), so the recovery forced NO; the money comes back all the same, through the merchant's wallet and the sweep.",
    );
    expect(
      recoveryResult({
        settled: 1,
        source: "already settled on-chain",
        scenarioOutcome: "yes",
        runId: "d171ed2352fa",
      }).differs,
    ).toMatch(/: the campaign was already settled on-chain when this recovery started\.$/);
    // Not settled: nothing to compare.
    expect(
      recoveryResult({ settled: null, source: null, scenarioOutcome: "yes", runId: "x" }),
    ).toEqual({ settledWith: null, source: null, scenarioOutcome: "yes", differs: null });
    expect(resultLines(undefined)).toEqual([]);
  });
});

describe("the command line of a recovery", () => {
  const env = {
    ARC_RELAYER_PRIVATE_KEY: KEY_A,
    ARC_ORACLE_PRIVATE_KEY: KEY_B,
    APP_DEMO_WALLET_SEED: SEED,
    ARC_RPC_URL: "https://rpc.testnet.arc.io",
  };
  const problemsOf = (argv: string[], extra: Record<string, string | undefined> = {}): string[] => {
    try {
      parseCli(argv, { ...env, ...extra });
    } catch (error: unknown) {
      if (error instanceof CliError) return [...error.problems];
      throw error;
    }
    return [];
  };

  it("takes the receipt and the kept database; refuses --throwaway-db and the scenario's flags", () => {
    const parsed = parseCli(
      ["--recover", "docs/rehearsals/x.json", "--db-url", "postgres://h/kept"],
      env,
    );
    expect(parsed.recover).toMatch(/\/docs\/rehearsals\/x\.json$/);
    expect(parsed.databaseUrl).toBe("postgres://h/kept");
    expect(problemsOf(["--recover", "x.json", "--throwaway-db"])).toEqual([
      "--recover needs the database the run kept (--db-url or DB_URL), never --throwaway-db",
    ]);
    expect(problemsOf(["--recover", "x.json"])).toEqual([
      "--recover needs the database the run kept: --db-url or DB_URL",
    ]);
    expect(
      problemsOf(["--recover", "x.json", "--outcome", "no", "--purchases", "3"], {
        DB_URL: "postgres://h/kept",
      }),
    ).toEqual([
      "--purchases, --outcome: the scenario is the receipt's, not the command's, with --recover",
    ]);
  });

  it("starts the engine near the head with a throwaway database unless a deploy block is given", () => {
    const local = ["--chain-id", "31337", "--escrow", "0x5FbDB2315678afecb367f032d93F642f64180aa3"];
    expect(
      parseCli([...local, "--deploy-block", "7", "--throwaway-db"], env).options,
    ).toMatchObject({ startNearHead: false, escrowDeployBlock: 7n });
    expect(
      parseCli([...local, "--throwaway-db"], { ...env, ARC_ESCROW_DEPLOY_BLOCK: "9" }).options
        .startNearHead,
    ).toBe(false);
    // Arc: the committed deployment's block is the default, not a block given.
    expect(parseCli(["--throwaway-db"], env).options.startNearHead).toBe(true);
    expect(parseCli(["--db-url", "postgres://h/x"], env).options.startNearHead).toBe(false);
  });

  it("passes the limiter's variables through, and checks them", () => {
    const parsed = parseCli(["--throwaway-db"], {
      ...env,
      ARC_RPC_MAX_REQUESTS_PER_SECOND: "8",
      ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND: "2.5",
      ARC_RPC_HEAVY_METHODS: "eth_getLogs, eth_call",
    });
    expect(parsed.options.rpcLimits).toEqual({
      maxRequestsPerSecond: 8,
      maxHeavyRequestsPerSecond: 2.5,
      heavyMethods: ["eth_getLogs", "eth_call"],
    });
    expect(parseCli(["--throwaway-db"], env).options.rpcLimits).toBeUndefined();
    expect(problemsOf(["--throwaway-db"], { ARC_RPC_MAX_REQUESTS_PER_SECOND: "0" })).toEqual([
      "ARC_RPC_MAX_REQUESTS_PER_SECOND must be a positive number",
    ]);
  });
});
