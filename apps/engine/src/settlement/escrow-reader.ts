import { decodeFunctionResult, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

import { winzEscrowAbi } from "@winz/shared";

import { EscrowReadError } from "./errors";
import type { SettlementReadClient } from "./types";

/** `IWinzEscrow.Campaign` as the watcher reads it. */
export interface OnchainCampaign {
  merchant: Address;
  salesClose: bigint;
  hedgeBudget: bigint;
  hedgeReserved: bigint;
  hedgeSpent: bigint;
  lockedRefunds: bigint;
  merchantDue: bigint;
  /** `IWinzEscrow.Status` index. */
  status: number;
  released: boolean;
}

/** `IWinzEscrow.Ticket` as the watcher reads it. */
export interface OnchainTicket {
  campaignId: bigint;
  buyer: Address;
  refundable: bigint;
  maxHedgeCost: bigint;
  hedgeCharged: boolean;
  paidOut: boolean;
}

/** The ERC-20 reads the treasury check needs. */
const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

/**
 * Reads of the escrow and its token through `eth_call`. Every value comes from the chain at the
 * latest block; nothing is cached except the emergency delay, a constant of the contract.
 */
export class EscrowReader {
  private emergencyDelayCache: bigint | null = null;

  constructor(
    private readonly client: SettlementReadClient,
    readonly escrow: Address,
  ) {}

  private async callEscrow(data: Hex, what: string): Promise<Hex> {
    const result = await this.client.call({ to: this.escrow, data });
    if (result.data === undefined) {
      throw new EscrowReadError(`${what}: the node returned no data`);
    }
    return result.data;
  }

  async getCampaign(id: bigint): Promise<OnchainCampaign> {
    const data = await this.callEscrow(
      encodeFunctionData({ abi: winzEscrowAbi, functionName: "getCampaign", args: [id] }),
      `getCampaign(${id.toString()})`,
    );
    const c = decodeFunctionResult({ abi: winzEscrowAbi, functionName: "getCampaign", data });
    return {
      merchant: c.merchant,
      salesClose: c.salesClose,
      hedgeBudget: c.hedgeBudget,
      hedgeReserved: c.hedgeReserved,
      hedgeSpent: c.hedgeSpent,
      lockedRefunds: c.lockedRefunds,
      merchantDue: c.merchantDue,
      status: c.status,
      released: c.released,
    };
  }

  async getTicket(id: bigint): Promise<OnchainTicket> {
    const data = await this.callEscrow(
      encodeFunctionData({ abi: winzEscrowAbi, functionName: "getTicket", args: [id] }),
      `getTicket(${id.toString()})`,
    );
    const t = decodeFunctionResult({ abi: winzEscrowAbi, functionName: "getTicket", data });
    return {
      campaignId: t.campaignId,
      buyer: t.buyer,
      refundable: t.refundable,
      maxHedgeCost: t.maxHedgeCost,
      hedgeCharged: t.hedgeCharged,
      paidOut: t.paidOut,
    };
  }

  /** Seconds after `salesClose` from which the emergency exits open (7 days). */
  async emergencyDelay(): Promise<bigint> {
    if (this.emergencyDelayCache !== null) return this.emergencyDelayCache;
    const data = await this.callEscrow(
      encodeFunctionData({ abi: winzEscrowAbi, functionName: "EMERGENCY_DELAY" }),
      "EMERGENCY_DELAY()",
    );
    const delay = decodeFunctionResult({
      abi: winzEscrowAbi,
      functionName: "EMERGENCY_DELAY",
      data,
    });
    this.emergencyDelayCache = delay;
    return delay;
  }

  private async address(functionName: "usdc" | "treasury"): Promise<Address> {
    const data = await this.callEscrow(
      encodeFunctionData({ abi: winzEscrowAbi, functionName }),
      `${functionName}()`,
    );
    return decodeFunctionResult({ abi: winzEscrowAbi, functionName, data });
  }

  /** What the treasury holds and lets the escrow pull, in micro-USDC. */
  async treasuryFunds(): Promise<{ treasury: Address; balance: bigint; allowance: bigint }> {
    const [token, treasury] = await Promise.all([this.address("usdc"), this.address("treasury")]);
    const [balanceResult, allowanceResult] = await Promise.all([
      this.client.call({
        to: token,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [treasury] }),
      }),
      this.client.call({
        to: token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "allowance",
          args: [treasury, this.escrow],
        }),
      }),
    ]);
    if (balanceResult.data === undefined || allowanceResult.data === undefined) {
      throw new EscrowReadError("treasury balance or allowance: the node returned no data");
    }
    const balance = decodeFunctionResult({
      abi: erc20Abi,
      functionName: "balanceOf",
      data: balanceResult.data,
    });
    const allowance = decodeFunctionResult({
      abi: erc20Abi,
      functionName: "allowance",
      data: allowanceResult.data,
    });
    return { treasury, balance, allowance };
  }

  /** Timestamp of the latest block, Unix seconds: the time `settle` is judged against. */
  async latestTimestamp(): Promise<bigint> {
    const block = await this.client.getBlock({ blockTag: "latest" });
    return block.timestamp;
  }
}
