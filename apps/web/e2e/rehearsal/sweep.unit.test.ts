import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  TimeoutError,
  createPublicClient,
  createTestClient,
  custom,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseTransaction,
  type Address,
  type Hex,
  type PublicClient,
  type TestClient,
} from "viem";

import { demoWalletAddress } from "../../../engine/src/identity";
import { startAnvil, type AnvilInstance } from "../../../engine/src/testing/anvil";
import { deployTestEscrow, type TestEscrow } from "../../../engine/src/testing/escrow";
import {
  ARC_USDC_ADDRESS,
  SweepRevertedError,
  snapshot,
  sweepWallets,
  walletsLeftBehind,
} from "./chain";
import { WEI_PER_MICRO } from "./estimate";
import { RpcMeter, classifyFailure, meteredClient, rateLimitAnswer } from "./rpc";
import { LOCAL_CHAIN_ID } from "./runner";
import type * as Rpc from "./rpc";
import type { MoneyMode, SweepRecordRow } from "./types";

/** Every error the sweep reported on a failed wallet (what `describeFailure` was given). */
const reported = vi.hoisted((): { errors: unknown[] } => ({ errors: [] }));

vi.mock("./rpc", async (importOriginal) => {
  const actual = await importOriginal<typeof Rpc>();
  return {
    ...actual,
    describeFailure: (error: unknown): string => {
      reported.errors.push(error);
      return actual.describeFailure(error);
    },
  };
});

/**
 * The sweep when the node takes a transfer and its answer is lost (a timeout, a reset): the
 * transfer is recorded by its hash before it is broadcast, so the next attempt looks it up and
 * waits for it instead of reading an empty wallet or sending a second one: found mined at once,
 * found pending by a later attempt (the lookup after the lost answer refused), or unknown to the
 * node and sent again as the bytes first signed. And a transfer mined that reverts: failed, with
 * its hash, never sent twice. On a chain that mines every transaction at once and on one with a
 * block every second, in both money modes.
 */

type LooseRequest = (args: { method: string; params?: unknown }) => Promise<unknown>;

/** TestUSDC's blocklist switch (owner only): transfers to or from a blocked address revert. */
const BLOCKLIST_ABI = parseAbi(["function setBlocked(address account, bool isBlocked)"]);

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

/** A lookup the node refuses: which method, how many times, and how. */
interface Refusal {
  method: "eth_getTransactionReceipt" | "eth_getTransactionByHash";
  times: number;
  /** A rate limit (HTTP 429, -32005, as Arc's public RPC answers) or a reset connection. */
  as: "rate-limit" | "reset";
}

/** What the faulty node does to the sweep's broadcasts and lookups. */
interface Faults {
  /** The first `lose` broadcasts reach the node, and their answer is lost. */
  lose: number;
  /** The first `drop` broadcasts never reach the node (the connection failed first). */
  drop: number;
  /** The first `hide` lookups of a transaction (its receipt, the transaction) answer "not found". */
  hide: number;
  /** Lookups refused before they reach the node. */
  refuse?: Refusal;
}

/** What the test does at given moments of the sweep, through anvil. */
interface NodeHooks {
  /** After a broadcast was dropped, before its failure is answered. */
  afterDrop?: () => Promise<void>;
  /**
   * Once, before the first receipt lookup that follows a lookup which found a transaction
   * pending (in the pool, not mined).
   */
  afterPendingSeen?: () => Promise<void>;
}

/**
 * A node that forwards every request but the faults: answers lost after the node took the
 * broadcast, broadcasts that never reach it, lookups that do not see the transaction yet, lookups
 * refused. Every raw transaction that reached the node is kept, with every error the node itself
 * answered, the raw transactions dropped before reaching it, and the hashes a lookup found
 * pending.
 */
function lossyNode(
  anvil: AnvilInstance,
  chain: TestEscrow["chain"],
  loss: Loss,
  faults: Faults,
  hooks: NodeHooks = {},
): {
  client: PublicClient;
  forwarded: Hex[];
  nodeAnswers: string[];
  dropped: Hex[];
  pendingSeen: Hex[];
} {
  const base = createPublicClient({ chain, transport: http(anvil.rpcUrl, { retryCount: 0 }) });
  const send = base.request as unknown as LooseRequest;
  const forwarded: Hex[] = [];
  const nodeAnswers: string[] = [];
  const dropped: Hex[] = [];
  const pendingSeen: Hex[] = [];
  let released = false;
  const left = {
    ...faults,
    hideReceipt: faults.hide,
    hideTransaction: faults.hide,
    refuse: faults.refuse?.times ?? 0,
  };
  const lossy = createPublicClient({
    chain,
    transport: custom(
      {
        async request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
          if (method === faults.refuse?.method && left.refuse > 0) {
            left.refuse -= 1;
            throw faults.refuse.as === "rate-limit"
              ? rateLimitAnswer(method)
              : lostAnswer("reset", method);
          }
          if (method === "eth_getTransactionReceipt" && left.hideReceipt > 0) {
            left.hideReceipt -= 1;
            return null;
          }
          if (method === "eth_getTransactionByHash" && left.hideTransaction > 0) {
            left.hideTransaction -= 1;
            return null;
          }
          if (
            method === "eth_getTransactionReceipt" &&
            pendingSeen.length > 0 &&
            !released &&
            hooks.afterPendingSeen !== undefined
          ) {
            released = true;
            await hooks.afterPendingSeen();
          }
          if (method === "eth_getTransactionByHash") {
            const found = await send({ method, params });
            const minedIn = (found as { blockNumber?: unknown } | null)?.blockNumber;
            if (found !== null && (minedIn === null || minedIn === undefined)) {
              pendingSeen.push((params as Hex[])[0] as Hex);
            }
            return found;
          }
          if (method !== "eth_sendRawTransaction") return send({ method, params });
          if (left.drop > 0) {
            left.drop -= 1;
            dropped.push((params as Hex[])[0] as Hex);
            await hooks.afterDrop?.();
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
    dropped,
    pendingSeen,
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

/** What a test prepares around one sweep: before it starts, and at moments of it. */
interface SweepSetup {
  /** Before the sweep, once the wallet is funded (the destination is known). */
  before?: (destination: Address) => Promise<void>;
  hooks?: NodeHooks;
}

interface SweepResult {
  rows: SweepRecordRow[];
  forwarded: Hex[];
  nodeAnswers: string[];
  dropped: Hex[];
  pendingSeen: Hex[];
  wallet: Address;
  destination: Address;
  fundedWei: bigint;
  lines: string[];
}

/** One wallet funded with money, swept through a node with `faults`. */
async function sweepWithLostAnswer(
  chain: Chain,
  mode: MoneyMode,
  loss: Loss,
  faults: Faults,
  prepared: SweepSetup = {},
): Promise<SweepResult> {
  const { anvil, escrow } = chain;
  const seed = `0x${randomBytes(32).toString("hex")}` as Hex;
  const email = "lost-answer@example.com";
  const wallet = getAddress(demoWalletAddress(seed, email));
  const destination = getAddress(`0x${randomBytes(20).toString("hex")}`);
  const testClient = testClientOf(chain);
  const fundedWei = mode === "native-usdc" ? 7n * 10n ** 17n : 2_500_000n * WEI_PER_MICRO;
  if (mode === "native-usdc") {
    await testClient.setBalance({ address: wallet, value: fundedWei });
  } else {
    await escrow.mint(wallet, fundedWei / WEI_PER_MICRO);
  }
  await prepared.before?.(destination);
  const node = lossyNode(anvil, escrow.chain, loss, faults, prepared.hooks);
  const lines: string[] = [];
  reported.errors.length = 0;
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
    dropped: node.dropped,
    pendingSeen: node.pendingSeen,
    wallet,
    destination,
    fundedWei,
    lines,
  };
}

function testClientOf(chain: Chain): TestClient {
  return createTestClient({
    mode: "anvil",
    chain: chain.escrow.chain,
    transport: http(chain.anvil.rpcUrl),
  });
}

/**
 * Stops the chain from mining (a transfer then stays in the pool), and returns what mines one
 * block and gives the chain back its own mode (at once, or a block every `blockTime` seconds).
 */
async function holdMining(
  chain: Chain,
  blockTime: number | undefined,
): Promise<() => Promise<void>> {
  const testClient = testClientOf(chain);
  if (blockTime === undefined) {
    await testClient.setAutomine(false);
  } else {
    await testClient.setIntervalMining({ interval: 0 });
  }
  let resumed = false;
  return async (): Promise<void> => {
    if (resumed) return;
    resumed = true;
    await testClient.mine({ blocks: 1 });
    if (blockTime === undefined) {
      await testClient.setAutomine(true);
    } else {
      await testClient.setIntervalMining({ interval: blockTime });
    }
  };
}

async function expectSweptOnce(chain: Chain, mode: MoneyMode, result: SweepResult): Promise<void> {
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
          "native-usdc, a broadcast that never reached the node, the fees moved before the retry: the bytes first signed sent again, once swept",
          {
            timeout: 60_000,
          },
          async () => {
            if (chain === null) throw new Error("no chain");
            const current = chain;
            const reader = current.escrow.publicClient;
            const testClient = testClientOf(current);
            const moved: { maxFeePerGas: bigint | null } = { maxFeePerGas: null };
            const result = await sweepWithLostAnswer(
              current,
              "native-usdc",
              "reset",
              { lose: 0, drop: 1, hide: 0 },
              {
                hooks: {
                  // Between the attempts the node's base fee halves (one block mined with it), so
                  // the fee a new signature would carry, and its amount, differ from the first.
                  afterDrop: async () => {
                    const latest = await reader.getBlock({ blockTag: "latest" });
                    await testClient.setNextBlockBaseFeePerGas({
                      baseFeePerGas: (latest.baseFeePerGas ?? 0n) / 2n,
                    });
                    await testClient.mine({ blocks: 1 });
                    moved.maxFeePerGas = (await reader.estimateFeesPerGas()).maxFeePerGas;
                  },
                },
              },
            );
            const transcript = result.lines.join("\n");
            expect(result.dropped, transcript).toHaveLength(1);
            const first = result.dropped[0] as Hex;
            // A second signature would differ: the fee it would be given is not the first one.
            expect(moved.maxFeePerGas).not.toBeNull();
            expect(moved.maxFeePerGas).not.toBe(parseTransaction(first).maxFeePerGas);
            // Signed once: the bytes that reached the node are the ones the first attempt signed.
            expect(result.forwarded, transcript).toEqual([first]);
            await expectSweptOnce(current, "native-usdc", result);
          },
        );

        for (const [mode, loss, refuse] of [
          [
            "native-usdc",
            "timeout",
            { method: "eth_getTransactionReceipt", times: 1, as: "rate-limit" },
          ],
          ["erc20", "reset", { method: "eth_getTransactionByHash", times: 1, as: "reset" }],
        ] as const) {
          it(
            `${mode}, the answer lost and the lookup after it refused (${refuse.as} on ${refuse.method}): the retry finds the transfer pending and waits for it, never signs another`,
            {
              timeout: 60_000,
            },
            async () => {
              if (chain === null) throw new Error("no chain");
              const current = chain;
              // Nothing is mined until the retry has found the transfer in the pool, so the
              // lookup cannot find it mined, and a second transfer would be signed against a
              // wallet that still holds its money.
              const mining = { resume: async (): Promise<void> => undefined };
              try {
                const result = await sweepWithLostAnswer(
                  current,
                  mode,
                  loss,
                  { lose: 1, drop: 0, hide: 0, refuse },
                  {
                    before: async () => {
                      mining.resume = await holdMining(current, blockTime);
                    },
                    hooks: { afterPendingSeen: () => mining.resume() },
                  },
                );
                const transcript = result.lines.join("\n");
                expect(result.forwarded, transcript).toHaveLength(1);
                // The lookup of the retry found that transfer pending: the branch that waits.
                expect(result.pendingSeen, transcript).toEqual([
                  keccak256(result.forwarded[0] as Hex),
                ]);
                await expectSweptOnce(current, mode, result);
              } finally {
                await mining.resume();
              }
            },
          );
        }

        it(
          "erc20, a transfer mined and reverted (the token blocks the destination): failed with its hash, what the wallet holds named, no second transfer",
          {
            timeout: 60_000,
          },
          async () => {
            if (chain === null) throw new Error("no chain");
            const current = chain;
            const { escrow } = current;
            const reader = escrow.publicClient;
            const result = await sweepWithLostAnswer(
              current,
              "erc20",
              "reset",
              { lose: 0, drop: 0, hide: 0 },
              {
                // TestUSDC's blocklist, as USDC's: a transfer to a blocked address reverts.
                before: async (destination) => {
                  await reader.waitForTransactionReceipt({
                    hash: await escrow.wallets.owner.writeContract({
                      address: escrow.usdc,
                      abi: BLOCKLIST_ABI,
                      functionName: "setBlocked",
                      args: [destination, true],
                    }),
                  });
                },
              },
            );
            const { rows, forwarded, wallet, fundedWei, lines } = result;
            const transcript = lines.join("\n");
            // One transfer signed and sent: a revert is permanent, the wallet is not tried again.
            expect(forwarded, transcript).toHaveLength(1);
            const hash = keccak256(forwarded[0] as Hex);
            const mined = await reader.getTransactionReceipt({ hash });
            expect(mined.status).toBe("reverted");
            expect(await reader.getTransactionCount({ address: wallet, blockTag: "pending" })).toBe(
              1,
            );
            // The row is failed and keeps the transfer's hash and the gas it cost.
            expect(rows).toEqual([
              {
                wallet: "merchant",
                address: wallet,
                status: "failed",
                sentWei: 0n,
                gasWei: mined.gasUsed * mined.effectiveGasPrice,
                txHash: hash,
              },
            ]);
            // The error reported is the revert, with that hash.
            const reverted = reported.errors.filter((error) => error instanceof SweepRevertedError);
            expect(reported.errors).toHaveLength(1);
            expect(reverted).toHaveLength(1);
            expect((reverted[0] as SweepRevertedError).hash).toBe(hash);
            expect(classifyFailure(reverted[0])).toBe("permanent");
            expect(lines).toEqual([`sweep merchant ${wallet}: failed (transfer ${hash} reverted)`]);
            // The wallet still holds its money, and the receipt says so.
            const tokens = await reader.readContract({
              address: escrow.usdc,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [wallet],
            });
            expect(tokens).toBe(fundedWei / WEI_PER_MICRO);
            const after = await snapshot(reader, "erc20", escrow.usdc, [
              { role: "merchant", address: wallet },
            ]);
            expect(
              walletsLeftBehind(rows, after, [{ label: "merchant", address: wallet }]),
            ).toEqual([`merchant ${wallet} was not swept: it still holds 2.5 USDC`]);
            expect(transcript).not.toContain("@example.com");
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
