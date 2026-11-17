/**
 * Cross-language check (C-03): what TypeScript builds and signs with the shared definitions of
 * @winz/shared is exactly what the Solidity contract verifies, stores and emits. Runs against the
 * committed artifacts on a local anvil, with viem directly (not the engine's transaction sender).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  encodeErrorResult,
  getAddress,
  hashTypedData,
  parseEventLogs,
  recoverTypedDataAddress,
  zeroAddress,
  type AbiParameter,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";

import {
  ARC_TESTNET_CHAIN_ID,
  QUOTE_TYPES,
  instrumentId,
  parseUsd,
  quoteDomain,
  refundableAmount,
  winzEscrowAbi,
  type Quote,
} from "@winz/shared";

import { decodeRevertData } from "../chain/decode-error";
import { startAnvil, type AnvilInstance } from "./anvil";
import { deployTestEscrow, testUsdcAbi, type TestEscrow } from "./escrow";

const SYMBOL = "GEMI-CFBTEXARK-2611290030-TEXAS-SPREAD-13.5-YES";
const MAX_HEDGE_COST = 2_000_000n;
const BUDGET = 1_000n * 1_000_000n;
const QUOTE_TTL = 60n;
/** Buyers never send transactions: any address will do. */
const BUYER: Address = getAddress("0x00000000000000000000000000000000000b0b01");

let anvil: AnvilInstance;
let env: TestEscrow;
let nextNonce = 1n;

beforeAll(async () => {
  anvil = await startAnvil();
  env = await deployTestEscrow(anvil);
});

afterAll(async () => {
  await anvil?.stop();
});

async function createCampaign(
  unitPrice: bigint,
  refundBps: bigint,
  symbol: string = SYMBOL,
): Promise<bigint> {
  const salesClose = (await env.latestTimestamp()) + 86_400n;
  const { request, result } = await env.publicClient.simulateContract({
    account: env.accounts.relayer,
    address: env.escrow,
    abi: winzEscrowAbi,
    functionName: "createCampaignFor",
    args: [
      env.accounts.merchant.address,
      { instrument: instrumentId(symbol), salesClose, unitPrice, refundBps: Number(refundBps) },
      BUDGET,
    ],
  });
  const hash = await env.wallets.relayer.writeContract(request);
  const receipt = await env.publicClient.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
  return result;
}

async function newQuote(campaignId: bigint, qty: number): Promise<Quote> {
  const nonce = nextNonce;
  nextNonce += 1n;
  return {
    campaignId,
    buyer: BUYER,
    qty,
    maxHedgeCost: MAX_HEDGE_COST,
    expiry: (await env.latestTimestamp()) + QUOTE_TTL,
    nonce,
  };
}

/** Sends `buyFor(quote, signature)` from the relayer and returns its receipt. */
async function buyFor(quote: Quote, signature: Hex): Promise<TransactionReceipt> {
  const { request } = await env.publicClient.simulateContract({
    account: env.accounts.relayer,
    address: env.escrow,
    abi: winzEscrowAbi,
    functionName: "buyFor",
    args: [quote, signature],
  });
  const hash = await env.wallets.relayer.writeContract(request);
  return env.publicClient.waitForTransactionReceipt({ hash });
}

/**
 * Runs `call`, expects a revert, and returns the custom error decoded from the raw revert data
 * with the exported `winzEscrowAbi`, plus what the engine's own decoder reads from the same data.
 */
async function revertOf(
  call: () => Promise<unknown>,
): Promise<{ name: string; args: readonly unknown[]; engineReason: string }> {
  let caught: unknown;
  try {
    await call();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof BaseError)) throw new Error("the call did not revert with a viem error");
  const reverted = caught.walk((cause) => cause instanceof ContractFunctionRevertedError);
  if (!(reverted instanceof ContractFunctionRevertedError) || reverted.raw === undefined) {
    throw new Error(`no revert data in: ${caught.shortMessage}`);
  }
  const decoded = decodeErrorResult({ abi: winzEscrowAbi, data: reverted.raw });
  return {
    name: decoded.errorName,
    args: decoded.args ?? [],
    engineReason: decodeRevertData(reverted.raw),
  };
}

function simulateBuyFor(quote: Quote, signature: Hex): () => Promise<unknown> {
  return () =>
    env.publicClient.simulateContract({
      account: env.accounts.relayer,
      address: env.escrow,
      abi: winzEscrowAbi,
      functionName: "buyFor",
      args: [quote, signature],
    });
}

async function usdcBalance(account: Address): Promise<bigint> {
  return env.publicClient.readContract({
    address: env.usdc,
    abi: testUsdcAbi,
    functionName: "balanceOf",
    args: [account],
  });
}

describe("deployTestEscrow", () => {
  it("deploys the escrow on the token with the expected roles, a funded treasury and its approval", async () => {
    const read = (
      functionName: "usdc" | "relayer" | "oracle" | "treasury" | "owner",
    ): Promise<Address> =>
      env.publicClient.readContract({ address: env.escrow, abi: winzEscrowAbi, functionName });
    expect(env.chainId).toBe(ARC_TESTNET_CHAIN_ID);
    expect(await read("usdc")).toBe(env.usdc);
    expect(await read("relayer")).toBe(env.accounts.relayer.address);
    expect(await read("oracle")).toBe(env.accounts.oracle.address);
    expect(await read("owner")).toBe(env.accounts.owner.address);
    // The hackathon setup: the treasury is the relayer's account.
    expect(await read("treasury")).toBe(env.accounts.relayer.address);
    expect(env.accounts.treasury.address).toBe(env.accounts.relayer.address);
    const distinct = new Set(
      [env.accounts.owner, env.accounts.relayer, env.accounts.oracle, env.accounts.merchant].map(
        (account) => account.address,
      ),
    );
    expect(distinct.size).toBe(4);

    const decimals = await env.publicClient.readContract({
      address: env.usdc,
      abi: testUsdcAbi,
      functionName: "decimals",
    });
    expect(decimals).toBe(6);
    const allowance = await env.publicClient.readContract({
      address: env.usdc,
      abi: testUsdcAbi,
      functionName: "allowance",
      args: [env.accounts.treasury.address, env.escrow],
    });
    expect(allowance).toBe(2n ** 256n - 1n);
    expect(await usdcBalance(env.accounts.treasury.address)).toBeGreaterThan(0n);
    expect(env.deployedAtBlock).toBeGreaterThan(0n);
  });

  it("gives the treasury its own account on request", async () => {
    const separate = await startAnvil();
    try {
      const other = await deployTestEscrow(separate, { treasuryIsRelayer: false });
      expect(other.accounts.treasury.address).not.toBe(other.accounts.relayer.address);
      const treasury = await other.publicClient.readContract({
        address: other.escrow,
        abi: winzEscrowAbi,
        functionName: "treasury",
      });
      expect(treasury).toBe(other.accounts.treasury.address);
    } finally {
      await separate.stop();
    }
  });
});

describe("cross-language check: TypeScript quotes against the Solidity escrow", () => {
  it("stores instrumentId(symbol) from @winz/shared as the campaign instrument", async () => {
    const symbol = "GEMI-CFBTEXARK-2611290030-TEXAS-MONEYLINE-YES";
    const id = await createCampaign(parseUsd("20"), 10_000n, symbol);
    const campaign = await env.publicClient.readContract({
      address: env.escrow,
      abi: winzEscrowAbi,
      functionName: "getCampaign",
      args: [id],
    });
    expect(campaign.instrument).toBe(instrumentId(symbol));
    expect(campaign.merchant).toBe(env.accounts.merchant.address);
  });

  it("computes off-chain the same EIP-712 digest as quoteDigest(quote)", async () => {
    const id = await createCampaign(parseUsd("12.99"), 5_000n);
    const quote = await newQuote(id, 3);
    const offChain = hashTypedData({
      domain: quoteDomain(env.chainId, env.escrow),
      types: QUOTE_TYPES,
      primaryType: "Quote",
      message: quote,
    });
    const onChain = await env.publicClient.readContract({
      address: env.escrow,
      abi: winzEscrowAbi,
      functionName: "quoteDigest",
      args: [quote],
    });
    expect(onChain).toBe(offChain);

    const signature = await env.signQuote(quote);
    const signer = await recoverTypedDataAddress({
      domain: quoteDomain(env.chainId, env.escrow),
      types: QUOTE_TYPES,
      primaryType: "Quote",
      message: quote,
      signature,
    });
    expect(signer).toBe(env.accounts.oracle.address);
  });

  const cases = [
    { label: "12.99 dollars at 50 %, qty 1", price: "12.99", refundBps: 5_000n, qty: 1 },
    { label: "12.99 dollars at 50 %, qty 3", price: "12.99", refundBps: 5_000n, qty: 3 },
    { label: "20 dollars at 100 %, qty 1", price: "20", refundBps: 10_000n, qty: 1 },
    { label: "19.99 dollars at 12.34 %, qty 7", price: "19.99", refundBps: 1_234n, qty: 7 },
    // 2 × 1.234567 × 33.33 % = 0.8229623622: the dust is rounded down on both sides.
    { label: "1.234567 dollars at 33.33 %, qty 2", price: "1.234567", refundBps: 3_333n, qty: 2 },
  ] as const;

  it.each(cases)(
    "accepts a TypeScript-signed quote in buyFor and emits refundableAmount(): $label",
    async ({ price, refundBps, qty }) => {
      const unitPrice = parseUsd(price);
      const id = await createCampaign(unitPrice, refundBps);
      const quote = await newQuote(id, qty);
      const signature = await env.signQuote(quote);

      const escrowBefore = await usdcBalance(env.escrow);
      const merchantBefore = await usdcBalance(env.accounts.merchant.address);
      const mined = await buyFor(quote, signature);
      expect(mined.status).toBe("success");

      const expectedPaid = BigInt(qty) * unitPrice;
      const expectedRefundable = refundableAmount(BigInt(qty), unitPrice, refundBps);
      const events = parseEventLogs({
        abi: winzEscrowAbi,
        eventName: "TicketPurchased",
        logs: mined.logs.filter((log) => log.address.toLowerCase() === env.escrow.toLowerCase()),
      });
      expect(events).toHaveLength(1);
      const event = events[0];
      if (event === undefined) throw new Error("no TicketPurchased event");
      expect(event.args.id).toBe(id);
      expect(event.args.buyer).toBe(BUYER);
      expect(event.args.qty).toBe(qty);
      expect(event.args.paid).toBe(expectedPaid);
      expect(event.args.refundable).toBe(expectedRefundable);
      expect(event.args.maxHedgeCost).toBe(MAX_HEDGE_COST);

      const ticket = await env.publicClient.readContract({
        address: env.escrow,
        abi: winzEscrowAbi,
        functionName: "getTicket",
        args: [event.args.ticketId],
      });
      expect(ticket.refundable).toBe(expectedRefundable);
      expect(ticket.paid).toBe(expectedPaid);
      expect(await usdcBalance(env.escrow)).toBe(escrowBefore + expectedRefundable);
      expect(await usdcBalance(env.accounts.merchant.address)).toBe(
        merchantBefore + expectedPaid - expectedRefundable,
      );
      const used = await env.publicClient.readContract({
        address: env.escrow,
        abi: winzEscrowAbi,
        functionName: "nonceUsed",
        args: [quote.nonce],
      });
      expect(used).toBe(true);
    },
  );

  it("pins the 12.99 dollars at 50 % example to its value", () => {
    expect(refundableAmount(1n, parseUsd("12.99"), 5_000n)).toBe(6_495_000n);
  });

  it("rejects a quote signed by another key with QuoteBadSignature", async () => {
    const id = await createCampaign(parseUsd("12.99"), 5_000n);
    const quote = await newQuote(id, 1);
    const signature = await env.signQuote(quote, env.accounts.merchant);
    const revert = await revertOf(simulateBuyFor(quote, signature));
    expect(revert.name).toBe("QuoteBadSignature");
    expect(revert.engineReason).toBe("QuoteBadSignature");
  });

  it("rejects a quote whose expiry has passed with QuoteExpired", async () => {
    const id = await createCampaign(parseUsd("12.99"), 5_000n);
    const quote = await newQuote(id, 1);
    const signature = await env.signQuote(quote);
    // Valid now: the same call simulates fine before time moves.
    await simulateBuyFor(quote, signature)();
    const now = await env.advanceTime(QUOTE_TTL + 1n);
    expect(now).toBeGreaterThan(quote.expiry);
    const revert = await revertOf(simulateBuyFor(quote, signature));
    expect(revert.name).toBe("QuoteExpired");
    expect(revert.engineReason).toBe("QuoteExpired");
  });

  it("rejects a replayed nonce with QuoteNonceUsed, for the same quote and for a new one", async () => {
    const id = await createCampaign(parseUsd("12.99"), 5_000n);
    const quote = await newQuote(id, 2);
    const signature = await env.signQuote(quote);
    expect((await buyFor(quote, signature)).status).toBe("success");

    const replay = await revertOf(simulateBuyFor(quote, signature));
    expect(replay.name).toBe("QuoteNonceUsed");

    const sameNonce: Quote = { ...(await newQuote(id, 1)), nonce: quote.nonce };
    const reused = await revertOf(simulateBuyFor(sameNonce, await env.signQuote(sameNonce)));
    expect(reused.name).toBe("QuoteNonceUsed");
    expect(reused.engineReason).toBe("QuoteNonceUsed");
  });

  it("rejects createCampaignFor from a non-relayer account with Unauthorized", async () => {
    const salesClose = (await env.latestTimestamp()) + 86_400n;
    const revert = await revertOf(() =>
      env.publicClient.simulateContract({
        account: env.accounts.merchant,
        address: env.escrow,
        abi: winzEscrowAbi,
        functionName: "createCampaignFor",
        args: [
          env.accounts.merchant.address,
          {
            instrument: instrumentId(SYMBOL),
            salesClose,
            unitPrice: parseUsd("20"),
            refundBps: 10_000,
          },
          BUDGET,
        ],
      }),
    );
    expect(revert.name).toBe("Unauthorized");
    expect(revert.engineReason).toBe("Unauthorized");
  });

  it("decodes an OpenZeppelin error that only the implementation ABI carries", async () => {
    // setRoles is owner-only through Ownable: the relayer gets OwnableUnauthorizedAccount, an
    // error IWinzEscrow does not declare. Decoding it proves the exported ABI is the superset.
    const revert = await revertOf(() =>
      env.publicClient.simulateContract({
        account: env.accounts.relayer,
        address: env.escrow,
        abi: winzEscrowAbi,
        functionName: "setRoles",
        args: [
          env.accounts.relayer.address,
          env.accounts.oracle.address,
          env.accounts.treasury.address,
        ],
      }),
    );
    expect(revert.name).toBe("OwnableUnauthorizedAccount");
    expect(revert.args).toEqual([env.accounts.relayer.address]);
    expect(revert.engineReason).toBe("OwnableUnauthorizedAccount");
  });
});

/** A placeholder value of an ABI type, for encoding revert data with arguments. */
function sampleValue(parameter: AbiParameter): unknown {
  const type = parameter.type;
  if (type === "address") return zeroAddress;
  if (type === "string") return "";
  if (type === "bool") return false;
  if (type === "bytes") return "0x";
  if (/^u?int\d*$/.test(type)) return 0n;
  const fixedBytes = /^bytes(\d+)$/.exec(type);
  if (fixedBytes?.[1] !== undefined) return `0x${"00".repeat(Number(fixedBytes[1]))}`;
  throw new Error(`no sample value for ABI type ${type}`);
}

describe("the exported winzEscrowAbi and the engine's revert decoder", () => {
  const errors = winzEscrowAbi.filter((item) => item.type === "error");

  it("carries the implementation-only errors that take arguments", () => {
    // These come from Ownable, SafeERC20 and ShortStrings through the implementation: the interface
    // ABI had none of them, and each takes an argument, so encoding them without one cannot work.
    const withArguments = errors
      .filter((item) => item.inputs.length > 0)
      .map((item) => item.name)
      .sort();
    expect(withArguments).toEqual([
      "OwnableInvalidOwner",
      "OwnableUnauthorizedAccount",
      "SafeERC20FailedOperation",
      "StringTooLong",
    ]);
  });

  it("names every custom error from revert data that carries its arguments", () => {
    expect(errors.length).toBeGreaterThan(20);
    for (const item of errors) {
      const data = encodeErrorResult({
        abi: winzEscrowAbi,
        errorName: item.name,
        args: item.inputs.map(sampleValue),
      } as Parameters<typeof encodeErrorResult>[0]);
      expect(decodeRevertData(data), item.name).toBe(item.name);
    }
  });
});
