import type { Address, Hex } from "viem";
import { keccak256, toHex } from "viem";

/** EIP-712 domain of WinzEscrow. Must match the contract's constructor. */
export const QUOTE_DOMAIN_NAME = "WinzEscrow";
export const QUOTE_DOMAIN_VERSION = "1";

/** Typed-data definition of a quote, field for field the `Quote` struct of IWinzEscrow. */
export const QUOTE_TYPES = {
  Quote: [
    { name: "campaignId", type: "uint64" },
    { name: "buyer", type: "address" },
    { name: "qty", type: "uint32" },
    { name: "maxHedgeCost", type: "uint128" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface Quote {
  campaignId: bigint;
  buyer: Address;
  qty: number;
  /** Most the merchant can be charged for hedging this purchase, micro-USDC. */
  maxHedgeCost: bigint;
  /** Unix seconds. */
  expiry: bigint;
  nonce: bigint;
}

export interface QuoteDomain {
  name: typeof QUOTE_DOMAIN_NAME;
  version: typeof QUOTE_DOMAIN_VERSION;
  chainId: number;
  verifyingContract: Address;
}

export function quoteDomain(chainId: number, escrow: Address): QuoteDomain {
  return {
    name: QUOTE_DOMAIN_NAME,
    version: QUOTE_DOMAIN_VERSION,
    chainId,
    verifyingContract: escrow,
  };
}

/** On-chain identifier of a Gemini instrument: keccak256 of its `instrumentSymbol`. */
export function instrumentId(instrumentSymbol: string): Hex {
  return keccak256(toHex(instrumentSymbol));
}

/** Arc testnet. */
export const ARC_TESTNET_CHAIN_ID = 5_042_002;
/** ERC-20 interface of USDC on Arc (6 decimals). The native balance (18 decimals) is never used. */
export const ARC_USDC_ADDRESS: Address = "0x3600000000000000000000000000000000000000";
export const ARC_TESTNET_EXPLORER_URL = "https://explorer.testnet.arc.io";
/** Arc's minimum base fee: transactions below it may stay pending. */
export const ARC_MIN_MAX_FEE_PER_GAS_WEI = 20_000_000_000n;
