import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TimeoutError,
  createPublicClient,
  createTestClient,
  custom,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { demoWalletAddress } from "../../../engine/src/identity";
import { startAnvil, type AnvilInstance } from "../../../engine/src/testing/anvil";
import { deployTestEscrow, type TestEscrow } from "../../../engine/src/testing/escrow";
import { ARC_USDC_ADDRESS, snapshot, sweepWallets, walletsLeftBehind } from "./chain";
import { WEI_PER_MICRO } from "./estimate";
import { RpcMeter, meteredClient } from "./rpc";
import { LOCAL_CHAIN_ID } from "./runner";
import type { MoneyMode, SweepRecordRow } from "./types";

/**
 * The sweep when the node takes a transfer and its answer is lost (a timeout, a reset): the
 * transfer is recorded by its hash before it is broadcast, so the next attempt looks it up and
 * waits for it instead of reading an empty wallet or sending a second one. On a chain that mines
 * every transaction at once and on one with a block every second, in both money modes.
 */

type LooseRequest = (args: { method: string; params?: unknown }) => Promise<unknown>;

/** How the answer to a broadcast the node accepted is lost. */
type Loss = "timeout" | "reset";

function lostAnswer(loss: Loss, method: string): Error {
  if (loss === "timeout")
    return new TimeoutError({ body: { method }, url: "http://lossy.invalid" });
  return Object.assign(new Error("fetch failed"), {
    cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
  });
}

/** The node's own words in an error viem raised for it (`details` down the causes). */
function nodeAnswer(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8 && typeof current === "object" && current !== null; depth += 1) {
    const details = (current as { details?: unknown }).details;
    if (typeof details === "string" && details !== "") parts.push(details);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

/** What the faulty node does to the sweep's broadcasts and lookups. */
interface Faults {
  /** The first `lose` broadcasts reach the node, and their answer is lost. */
  lose: number;
  /** The first `drop` broadcasts never reach the node (the connection failed first). */
  drop: number;
  /** The first `hide` lookups of a transaction (its receipt, the transaction) answer "not found". */
  hide: number;
}

/**
 * A node that forwards every request but the faults: answers lost after the node took the
 * broadcast, broadcasts that never reach it, lookups that do not see the transaction yet. Every
 * raw transaction that reached the node is kept, with every error the node itself answered.
 */
function lossyNode(
  anvil: AnvilInstance,
  chain: TestEscrow["chain"],
  loss: Loss,
  faults: Faults,
): { client: PublicClient; forwarded: Hex[]; nodeAnswers: string[] } {
  const base = createPublicClient({ chain, transport: http(anvil.rpcUrl, { retryCount: 0 }) });
  const send = base.request as unknown as LooseRequest;
  const forwarded: Hex[] = [];
  const nodeAnswers: string[] = [];
  const left = { ...faults, hideReceipt: faults.hide, hideTransaction: faults.hide };
  const lossy = createPublicClient({
    chain,
    transport: custom(
      {
        async request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
          if (method === "eth_getTransactionReceipt" && left.hideReceipt > 0) {
            left.hideReceipt -= 1;
            return null;
          }
          if (method === "eth_getTransactionByHash" && left.hideTransaction > 0) {
            left.hideTransaction -= 1;
            return null;
          }
          if (method !== "eth_sendRawTransaction") return send({ method, params });
          if (left.drop > 0) {
            left.drop -= 1;
            throw lostAnswer(loss, method);
          }
          forwarded.push((params as Hex[])[0] as Hex);
          let answer: unknown;
          try {
            answer = await send({ method, params });
          } catch (error: unknown) {
            nodeAnswers.push(nodeAnswer(error));
            throw error;
          }
          if (left.lose > 0) {
            left.lose -= 1;
            throw lostAnswer(loss, method);
          }
          return answer;
        },
      },
      { retryCount: 0 },
    ),
  });
  // As in the runner: every request counted, no retry of its own.
  return {
    client: meteredClient(lossy, { meter: new RpcMeter(), step: () => "sweep" }),
    forwarded,
    nodeAnswers,
  };
}

interface Chain {
  anvil: AnvilInstance;
  escrow: TestEscrow;
}

async function chainWith(blockTime: number | undefined): Promise<Chain> {
  const anvil = await startAnvil({
    chainId: LOCAL_CHAIN_ID,
    accounts: 5,
    ...(blockTime === undefined ? {} : { blockTime }),
  });
  try {
    return { anvil, escrow: await deployTestEscrow(anvil) };
  } catch (error: unknown) {
    await anvil.stop();
    throw error;
  }
}

/** One wallet funded with money, swept through a node with `faults`. */
async function sweepWithLostAnswer(
  chain: Chain,
  mode: MoneyMode,
  loss: Loss,
  faults: Faults,
): Promise<{
  rows: SweepRecordRow[];
  forwarded: Hex[];
  nodeAnswers: string[];
  wallet: Address;
  destination: Address;
  fundedWei: bigint;
  lines: string[];
}> {
  const { anvil, escrow } = chain;
  const seed = `0x${randomBytes(32).toString("hex")}` as Hex;
  const email = "lost-answer@example.com";
  const wallet = getAddress(demoWalletAddress(seed, email));
  const destination = getAddress(`0x${randomBytes(20).toString("hex")}`);
  const testClient = createTestClient({
    mode: "anvil",
    chain: escrow.chain,
    transport: http(anvil.rpcUrl),
  });
  const fundedWei = mode === "native-usdc" ? 7n * 10n ** 17n : 2_500_000n * WEI_PER_MICRO;
  if (mode === "native-usdc") {
    await testClient.setBalance({ address: wallet, value: fundedWei });
  } else {
    await escrow.mint(wallet, fundedWei / WEI_PER_MICRO);
  }
  const node = lossyNode(anvil, escrow.chain, loss, faults);
  const lines: string[] = [];
  const rows = await sweepWallets({
    client: node.client,
    chain: escrow.chain,
    mode,
    token: mode === "native-usdc" ? ARC_USDC_ADDRESS : escrow.usdc,
    seed,
    wallets: [{ label: "merchant", email }],
    destination,
    local: true,
    policy: { attempts: 6, baseDelayMs: 100, maxDelayMs: 400 },
    out: (line) => lines.push(line),
    minedTimeoutMs: 15_000,
  });
  return {
    rows,
    forwarded: node.forwarded,
    nodeAnswers: node.nodeAnswers,
    wallet,
    destination,
    fundedWei,
    lines,
  };
}

async function expectSweptOnce(
  chain: Chain,
  mode: MoneyMode,
  result: Awaited<ReturnType<typeof sweepWithLostAnswer>>,
): Promise<void> {
  const { escrow } = chain;
  const reader = escrow.publicClient;
  const { rows, forwarded, wallet, destination, fundedWei, lines } = result;
  const transcript = lines.join("\n");
  // Exactly one transfer reached the node (a re-broadcast of the same bytes is the same transfer).
  const transfers = [...new Set(forwarded.map((raw) => keccak256(raw)))];
  expect(transfers, transcript).toHaveLength(1);
  expect(await reader.getTransactionCount({ address: wallet, blockTag: "pending" })).toBe(1);
  expect(await reader.getTransactionCount({ address: wallet })).toBe(1);
  // The row says swept, with that transfer's hash and the amount it really sent.
  expect(rows, transcript).toHaveLength(1);
  const row = rows[0];
  expect(row?.status, transcript).toBe("swept");
  expect(row?.txHash).toBe(transfers[0]);
  const mined = await reader.getTransactionReceipt({ hash: transfers[0] as Hex });
  expect(mined.status).toBe("success");
  expect(row?.gasWei).toBe(mined.gasUsed * mined.effectiveGasPrice);
  if (mode === "native-usdc") {
    // Every wei: the wallet ends at zero, the destination got what the row says, gas apart.
    expect(await reader.getBalance({ address: wallet })).toBe(0n);
    expect(await reader.getBalance({ address: destination })).toBe(row?.sentWei);
    expect((row?.sentWei ?? 0n) + (row?.gasWei ?? 0n)).toBe(fundedWei);
  } else {
    const balanceOf = (account: Address): Promise<bigint> =>
      reader.readContract({
        address: escrow.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
      });
    expect(await balanceOf(wallet)).toBe(0n);
    expect(await balanceOf(destination)).toBe(fundedWei / WEI_PER_MICRO);
    expect(row?.sentWei).toBe(fundedWei);
  }
  // Nothing is reported left behind for the wallet.
  const after = await snapshot(
    reader,
    mode,
    mode === "native-usdc" ? ARC_USDC_ADDRESS : escrow.usdc,
    [{ role: "merchant", address: wallet }],
  );
  expect(walletsLeftBehind(rows, after, [{ label: "merchant", address: wallet }])).toEqual([]);
  expect(transcript).not.toContain("@example.com");
}

describe("the sweep when the answer to its broadcast is lost", () => {
  for (const blockTime of [undefined, 1] as const) {
    describe(
      blockTime === undefined ? "a chain that mines at once" : "a block every second",
      () => {
        let chain: Chain | null = null;
        beforeAll(async () => {
          chain = await chainWith(blockTime);
        }, 60_000);
        afterAll(async () => {
          await chain?.anvil.stop();
        });

        for (const [mode, loss] of [
          ["native-usdc", "timeout"],
          ["erc20", "reset"],
        ] as const) {
          it(
            `${mode}, the answer lost to a ${loss}: one transfer, swept with its hash and amount, the wallet at zero`,
            {
              timeout: 60_000,
            },
            async () => {
              if (chain === null) throw new Error("no chain");
              const result = await sweepWithLostAnswer(chain, mode, loss, {
                lose: 1,
                drop: 0,
                hide: 0,
              });
              expect(result.forwarded).toHaveLength(1);
              await expectSweptOnce(chain, mode, result);
            },
          );
        }

        it(
          "native-usdc, a broadcast that never reached the node: the same bytes sent again, once swept",
          {
            timeout: 60_000,
          },
          async () => {
            if (chain === null) throw new Error("no chain");
            const result = await sweepWithLostAnswer(chain, "native-usdc", "reset", {
              lose: 0,
              drop: 1,
              hide: 0,
            });
            // Signed once: the bytes that reached the node are the ones the first attempt recorded.
            expect(result.forwarded).toHaveLength(1);
            await expectSweptOnce(chain, "native-usdc", result);
          },
        );

        it(
          "erc20, the answer lost and the transfer not seen at first: sent again as the same bytes, which the node already holds",
          {
            timeout: 60_000,
          },
          async () => {
            if (chain === null) throw new Error("no chain");
            const result = await sweepWithLostAnswer(chain, "erc20", "timeout", {
              lose: 1,
              drop: 0,
              hide: 2,
            });
            // The node got the same bytes twice and said it already had them: one transfer.
            expect(result.forwarded).toHaveLength(2);
            expect(result.nodeAnswers.join("\n")).toMatch(
              /already known|already imported|nonce too low/i,
            );
            await expectSweptOnce(chain, "erc20", result);
          },
        );
      },
    );
  }
});
