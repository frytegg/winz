/**
 * The charge batches end to end on a local chain: the lots `recordFill` covered, the batch
 * `pendingCharges` builds and the request `chargeHedgeTxRequest` encodes are accepted by the real
 * escrow, which charges each ticket exactly the amount computed off-chain and releases every
 * reservation, so the campaign can settle.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAddress, parseEventLogs, type Address } from "viem";

import { instrumentId, parseUsd, winzEscrowAbi, type Quote } from "@winz/shared";

import { startAnvil, type AnvilInstance } from "../../testing/anvil";
import { deployTestEscrow, testUsdcAbi, type TestEscrow } from "../../testing/escrow";
import { createTestDatabase, type TestDatabase } from "../../testing/postgres";
import { chargeHedgeTxRequest, pendingCharges, recordFill } from "./store";
import { createCampaign, createLot, createMarket, createOrder } from "./test-support";

const BUYER: Address = getAddress("0x00000000000000000000000000000000000b0b02");
const BUDGET = 1_000n * 1_000_000n;

let anvil: AnvilInstance;
let env: TestEscrow;
let database: TestDatabase;

beforeAll(async () => {
  anvil = await startAnvil();
  env = await deployTestEscrow(anvil);
});
afterAll(async () => {
  await anvil?.stop();
});
beforeEach(async () => {
  database = await createTestDatabase();
});
afterEach(async () => {
  await database.drop();
});

async function createOnchainCampaign(symbol: string): Promise<bigint> {
  const salesClose = (await env.latestTimestamp()) + 86_400n;
  const { request, result } = await env.publicClient.simulateContract({
    account: env.accounts.relayer,
    address: env.escrow,
    abi: winzEscrowAbi,
    functionName: "createCampaignFor",
    args: [
      env.accounts.merchant.address,
      {
        instrument: instrumentId(symbol),
        salesClose,
        unitPrice: parseUsd("20"),
        refundBps: 10_000,
      },
      BUDGET,
    ],
  });
  const receipt = await env.publicClient.waitForTransactionReceipt({
    hash: await env.wallets.relayer.writeContract(request),
  });
  expect(receipt.status).toBe("success");
  return result;
}

async function buyOnchain(
  campaignId: bigint,
  maxHedgeCost: bigint,
  nonce: bigint,
): Promise<bigint> {
  const quote: Quote = {
    campaignId,
    buyer: BUYER,
    qty: 1,
    maxHedgeCost,
    expiry: (await env.latestTimestamp()) + 60n,
    nonce,
  };
  const signature = await env.signQuote(quote);
  const { request, result } = await env.publicClient.simulateContract({
    account: env.accounts.relayer,
    address: env.escrow,
    abi: winzEscrowAbi,
    functionName: "buyFor",
    args: [quote, signature],
  });
  const receipt = await env.publicClient.waitForTransactionReceipt({
    hash: await env.wallets.relayer.writeContract(request),
  });
  expect(receipt.status).toBe("success");
  return result;
}

describe("chargeHedgeTxRequest on the escrow", () => {
  it("the batch pendingCharges builds is accepted and charges exactly the amounts computed off-chain", async () => {
    const market = await createMarket(database.db);
    const campaignOnchainId = await createOnchainCampaign(market.instrument);
    // Two sales: one whose hedge costs less than its guarantee, one whose hedge costs more.
    const ticket1 = await buyOnchain(campaignOnchainId, 250_000n, 1n);
    const ticket2 = await buyOnchain(campaignOnchainId, 120_000n, 2n);

    const campaign = await createCampaign(database.db, market, { onchainId: campaignOnchainId });
    await createLot(database.db, market, campaign, 400_000n, 250_000n, { onchainId: ticket1 });
    await createLot(database.db, market, campaign, 300_000n, 120_000n, { onchainId: ticket2 });
    const order = await createOrder(database.db, market, "buy");
    await recordFill(database.db, {
      orderId: order,
      venueFillId: "vf-chain-1",
      priceBps: 5000n,
      qty: 700_000n,
      fee: 0n,
      at: new Date("2026-11-17T12:00:00Z"),
      bookRef: null,
    }); // 200 000 for the first lot, 150 000 for the second (above its 120 000)

    const batches = await pendingCharges(database.db, { limit: 10 });
    expect(batches).toHaveLength(1);
    const batch = batches[0];
    if (batch === undefined) throw new Error("expected a batch");
    expect(batch.ticketIds).toEqual([ticket1, ticket2]);
    expect(batch.amounts).toEqual([200_000n, 120_000n]);

    const request = chargeHedgeTxRequest(batch, env.escrow);
    expect(request.signer).toBe("oracle");
    const treasuryBefore = await env.publicClient.readContract({
      address: env.usdc,
      abi: testUsdcAbi,
      functionName: "balanceOf",
      args: [env.accounts.treasury.address],
    });
    const hash = await env.wallets.oracle.sendTransaction({ to: request.to, data: request.data });
    const receipt = await env.publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");

    const charged = parseEventLogs({
      abi: winzEscrowAbi,
      eventName: "HedgeCharged",
      logs: receipt.logs,
    }).map((log) => [log.args.ticketId, log.args.id, log.args.amount]);
    expect(charged).toEqual([
      [ticket1, campaignOnchainId, 200_000n],
      [ticket2, campaignOnchainId, 120_000n],
    ]);
    const onchain = await env.publicClient.readContract({
      address: env.escrow,
      abi: winzEscrowAbi,
      functionName: "getCampaign",
      args: [campaignOnchainId],
    });
    expect(onchain.hedgeReserved).toBe(0n);
    expect(onchain.hedgeSpent).toBe(320_000n);
    const treasuryAfter = await env.publicClient.readContract({
      address: env.usdc,
      abi: testUsdcAbi,
      functionName: "balanceOf",
      args: [env.accounts.treasury.address],
    });
    expect(treasuryAfter - treasuryBefore).toBe(320_000n);
  });
});
