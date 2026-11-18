import {
  createWalletClient,
  erc20Abi,
  getAddress,
  http,
  toHex,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ARC_TESTNET_CHAIN_ID, winzEscrowAbi } from "@winz/shared";

import { demoWalletKey } from "../../../engine/src/identity";
import { WEI_PER_MICRO } from "./estimate";
import type { BalanceRow, MoneyMode, SweepRecordRow } from "./types";

/**
 * What the rehearsal reads from the chain, and the one thing it writes itself: the sweep of the
 * demo wallets. Everything else on-chain is sent by the engine.
 */

/** Arc's USDC: the native coin behind an ERC-20 interface at this address. */
export const ARC_USDC_ADDRESS: Address = "0x3600000000000000000000000000000000000000";

/** Native coin on Arc, an ERC-20 test token elsewhere. */
export function moneyModeOf(chainId: number, token: Address): MoneyMode {
  return chainId === ARC_TESTNET_CHAIN_ID && getAddress(token) === ARC_USDC_ADDRESS
    ? "native-usdc"
    : "erc20";
}

export interface EscrowRoles {
  relayer: Address;
  oracle: Address;
  treasury: Address;
  token: Address;
}

/** The roles the escrow holds, read from the contract. */
export async function readEscrowRoles(client: PublicClient, escrow: Address): Promise<EscrowRoles> {
  const [relayer, oracle, treasury, token] = await Promise.all([
    client.readContract({ address: escrow, abi: winzEscrowAbi, functionName: "relayer" }),
    client.readContract({ address: escrow, abi: winzEscrowAbi, functionName: "oracle" }),
    client.readContract({ address: escrow, abi: winzEscrowAbi, functionName: "treasury" }),
    client.readContract({ address: escrow, abi: winzEscrowAbi, functionName: "usdc" }),
  ]);
  return {
    relayer: getAddress(relayer),
    oracle: getAddress(oracle),
    treasury: getAddress(treasury),
    token: getAddress(token),
  };
}

/**
 * The money an account holds, in 18-decimal units: on Arc its native balance (which is its USDC,
 * gas included), elsewhere its token balance × 10^12.
 */
export async function moneyOf(
  client: PublicClient,
  mode: MoneyMode,
  token: Address,
  account: Address,
): Promise<bigint> {
  if (mode === "native-usdc") return client.getBalance({ address: account });
  const balance = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
  return balance * WEI_PER_MICRO;
}

export async function allowanceOf(
  client: PublicClient,
  token: Address,
  owner: Address,
  spender: Address,
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
}

export interface Party {
  role: string;
  address: Address;
}

/** Each party's money and native balance, at the latest block. A repeated address is read once. */
export async function snapshot(
  client: PublicClient,
  mode: MoneyMode,
  token: Address,
  parties: readonly Party[],
): Promise<BalanceRow[]> {
  const rows: BalanceRow[] = [];
  for (const party of parties) {
    const [moneyWei, nativeWei] = await Promise.all([
      moneyOf(client, mode, token, party.address),
      client.getBalance({ address: party.address }),
    ]);
    rows.push({ role: party.role, address: party.address, moneyWei, nativeWei });
  }
  return rows;
}

export interface OnchainCampaignState {
  merchant: Address;
  hedgeBudget: bigint;
  hedgeReserved: bigint;
  hedgeSpent: bigint;
  lockedRefunds: bigint;
  merchantDue: bigint;
  salesClose: bigint;
  status: number;
  released: boolean;
}

export async function readCampaign(
  client: PublicClient,
  escrow: Address,
  id: bigint,
): Promise<OnchainCampaignState> {
  const campaign = await client.readContract({
    address: escrow,
    abi: winzEscrowAbi,
    functionName: "getCampaign",
    args: [id],
  });
  return {
    merchant: getAddress(campaign.merchant),
    hedgeBudget: campaign.hedgeBudget,
    hedgeReserved: campaign.hedgeReserved,
    hedgeSpent: campaign.hedgeSpent,
    lockedRefunds: campaign.lockedRefunds,
    merchantDue: campaign.merchantDue,
    salesClose: campaign.salesClose,
    status: campaign.status,
    released: campaign.released,
  };
}

// ---------------------------------------------------------------------------------------------
// Events of one campaign, from the block the run started at
// ---------------------------------------------------------------------------------------------

export interface CampaignEvents {
  created: { budget: bigint; block: bigint }[];
  purchased: {
    ticketId: bigint;
    buyer: Address;
    qty: number;
    paid: bigint;
    refundable: bigint;
    maxHedgeCost: bigint;
    block: bigint;
  }[];
  charged: { ticketId: bigint; amount: bigint; block: bigint; hash: Hex }[];
  settled: { outcome: number; merchantDue: bigint; block: bigint; hash: Hex }[];
  refunded: { ticketId: bigint; buyer: Address; amount: bigint; block: bigint; hash: Hex }[];
  refundFailed: { ticketId: bigint; block: bigint }[];
  merchantPaid: { amount: bigint; block: bigint }[];
  released: { block: bigint }[];
}

function blockOf(log: { blockNumber: bigint | null }): bigint {
  return log.blockNumber ?? 0n;
}

function hashOf(log: { transactionHash: Hex | null }): Hex {
  return log.transactionHash ?? "0x";
}

/** Every escrow event of the campaign `id` since `fromBlock`. */
export async function campaignEvents(
  client: PublicClient,
  escrow: Address,
  id: bigint,
  fromBlock: bigint,
): Promise<CampaignEvents> {
  const base = { address: escrow, abi: winzEscrowAbi, fromBlock, strict: true } as const;
  const [created, purchased, charged, settled, refunded, refundFailed, paid, released] =
    await Promise.all([
      client.getContractEvents({ ...base, eventName: "CampaignCreated", args: { id } }),
      client.getContractEvents({ ...base, eventName: "TicketPurchased", args: { id } }),
      client.getContractEvents({ ...base, eventName: "HedgeCharged", args: { id } }),
      client.getContractEvents({ ...base, eventName: "CampaignSettled", args: { id } }),
      client.getContractEvents({ ...base, eventName: "TicketRefunded", args: { id } }),
      client.getContractEvents({ ...base, eventName: "RefundFailed", args: { id } }),
      client.getContractEvents({ ...base, eventName: "MerchantPaid", args: { id } }),
      client.getContractEvents({ ...base, eventName: "CampaignReleased", args: { id } }),
    ]);
  return {
    created: created.map((log) => ({ budget: log.args.budget, block: blockOf(log) })),
    purchased: purchased
      .map((log) => ({
        ticketId: log.args.ticketId,
        buyer: getAddress(log.args.buyer),
        qty: Number(log.args.qty),
        paid: log.args.paid,
        refundable: log.args.refundable,
        maxHedgeCost: log.args.maxHedgeCost,
        block: blockOf(log),
      }))
      .sort((a, b) => (a.ticketId < b.ticketId ? -1 : a.ticketId > b.ticketId ? 1 : 0)),
    charged: charged.map((log) => ({
      ticketId: log.args.ticketId,
      amount: log.args.amount,
      block: blockOf(log),
      hash: hashOf(log),
    })),
    settled: settled.map((log) => ({
      outcome: Number(log.args.outcome),
      merchantDue: log.args.merchantDue,
      block: blockOf(log),
      hash: hashOf(log),
    })),
    refunded: refunded.map((log) => ({
      ticketId: log.args.ticketId,
      buyer: getAddress(log.args.buyer),
      amount: log.args.amount,
      block: blockOf(log),
      hash: hashOf(log),
    })),
    refundFailed: refundFailed.map((log) => ({ ticketId: log.args.ticketId, block: blockOf(log) })),
    merchantPaid: paid.map((log) => ({ amount: log.args.amount, block: blockOf(log) })),
    released: released.map((log) => ({ block: blockOf(log) })),
  };
}

// ---------------------------------------------------------------------------------------------
// Sweep on a local chain
// ---------------------------------------------------------------------------------------------

export interface LocalSweepInput {
  client: PublicClient;
  chain: Chain;
  rpcUrl: string;
  token: Address;
  seed: Hex;
  wallets: readonly { label: string; email: string }[];
  destination: Address;
  out: (line: string) => void;
}

/** Gas a token transfer is given; the wallet is topped up with twice its cost. */
const TOKEN_TRANSFER_GAS = 80_000n;

async function rawRpc(url: string, method: string, params: readonly unknown[]): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error !== undefined) {
    throw new Error(`${method} failed: ${body.error.message ?? "unknown error"}`);
  }
  return body.result;
}

function shortError(error: unknown): string {
  if (error instanceof Error) {
    const short = (error as Error & { shortMessage?: unknown }).shortMessage;
    return typeof short === "string" ? short : (error.message.split("\n")[0] ?? error.name);
  }
  return "unknown error";
}

/**
 * The sweep of a local chain, where the money is an ERC-20 test token and gas is the native coin
 * (on Arc, `sweepDemoWallets` sends the native USDC instead). Each demo wallet holding tokens is
 * given the gas of one transfer with `anvil_setBalance` (local chains only: no role key sends
 * anything, so the engine's nonces are untouched), then sends its whole token balance to
 * `destination`. A wallet that fails is reported and the others are still swept.
 */
export async function sweepTokenOnLocalChain(input: LocalSweepInput): Promise<SweepRecordRow[]> {
  const results: SweepRecordRow[] = [];
  for (const wallet of input.wallets) {
    const account = privateKeyToAccount(demoWalletKey(input.seed, wallet.email));
    const row: SweepRecordRow = {
      wallet: wallet.label,
      address: account.address,
      status: "empty",
      sentWei: 0n,
      gasWei: 0n,
      txHash: null,
    };
    results.push(row);
    try {
      const balance = await input.client.readContract({
        address: input.token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      });
      if (balance === 0n) {
        input.out(`sweep ${wallet.label} ${account.address}: empty`);
        continue;
      }
      const fees = await input.client.estimateFeesPerGas();
      const topUp = TOKEN_TRANSFER_GAS * fees.maxFeePerGas * 2n;
      await rawRpc(input.rpcUrl, "anvil_setBalance", [account.address, toHex(topUp)]);
      const walletClient = createWalletClient({
        account,
        chain: input.chain,
        transport: http(input.rpcUrl),
      });
      const hash = await walletClient.writeContract({
        address: input.token,
        abi: erc20Abi,
        functionName: "transfer",
        args: [input.destination, balance],
        gas: TOKEN_TRANSFER_GAS,
      });
      const receipt = await input.client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`transfer ${hash} reverted`);
      row.status = "swept";
      row.sentWei = balance * WEI_PER_MICRO;
      row.gasWei = receipt.gasUsed * receipt.effectiveGasPrice;
      row.txHash = hash;
      input.out(
        `sweep ${wallet.label} ${account.address}: ${balance.toString()} micro-USDC sent back (tx ${hash})`,
      );
    } catch (error: unknown) {
      row.status = "failed";
      input.out(`sweep ${wallet.label} ${account.address}: failed (${shortError(error)})`);
    }
  }
  return results;
}
