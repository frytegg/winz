import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  type Chain,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ARC_TESTNET_CHAIN_ID, ARC_TESTNET_EXPLORER_URL } from "@winz/shared";

import type { EngineEnv } from "../config/env";
import type { SignerAccounts } from "./types";

/** The variables the chain clients need, a subset of the engine's validated environment. */
export type ArcClientEnv = Pick<
  EngineEnv,
  | "ARC_CHAIN_ID"
  | "ARC_RPC_URL"
  | "ARC_RPC_FALLBACK_URL"
  | "ARC_RELAYER_PRIVATE_KEY"
  | "ARC_ORACLE_PRIVATE_KEY"
>;

export interface ArcClients {
  chain: Chain;
  /** Reads and broadcasts through the primary RPC, and through the fallback when it fails. */
  publicClient: PublicClient;
  /** Local accounts: they sign in-process and expose no way to read their key back. */
  accounts: SignerAccounts;
}

export interface ArcClientOptions {
  /** Timeout of one HTTP request, per endpoint. Default 10 000 ms. */
  requestTimeoutMs?: number;
  /** How many times the whole list of endpoints is tried again. Default 2. */
  retryCount?: number;
  /** Receipt polling interval of the client's own helpers. Default 300 ms. */
  pollingIntervalMs?: number;
}

/**
 * Builds the viem public client and the two signer accounts from the environment. The
 * transport tries `ARC_RPC_URL` (QuickNode) first and `ARC_RPC_FALLBACK_URL` (the public RPC,
 * limited to about 10 requests per second) when it errors (SPEC section 8). The private keys
 * are consumed here and kept nowhere else.
 */
export function createArcClients(env: ArcClientEnv, options: ArcClientOptions = {}): ArcClients {
  const urls = [env.ARC_RPC_URL, env.ARC_RPC_FALLBACK_URL].filter(
    (url, index, all) => all.indexOf(url) === index,
  );
  const chain = defineChain({
    id: env.ARC_CHAIN_ID,
    name:
      env.ARC_CHAIN_ID === ARC_TESTNET_CHAIN_ID
        ? "Arc Testnet"
        : `Chain ${env.ARC_CHAIN_ID.toString()}`,
    // Gas is paid in USDC, whose native representation has 18 decimals.
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: urls } },
    ...(env.ARC_CHAIN_ID === ARC_TESTNET_CHAIN_ID
      ? { blockExplorers: { default: { name: "Arcscan", url: ARC_TESTNET_EXPLORER_URL } } }
      : {}),
  });
  const timeout = options.requestTimeoutMs ?? 10_000;
  const transport = fallback(
    urls.map((url) => http(url, { timeout })),
    { retryCount: options.retryCount ?? 2 },
  );
  const publicClient = createPublicClient({
    chain,
    transport,
    pollingInterval: options.pollingIntervalMs ?? 300,
  });
  return {
    chain,
    publicClient,
    accounts: {
      relayer: privateKeyToAccount(env.ARC_RELAYER_PRIVATE_KEY as `0x${string}`),
      oracle: privateKeyToAccount(env.ARC_ORACLE_PRIVATE_KEY as `0x${string}`),
    },
  };
}
