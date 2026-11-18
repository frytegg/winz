import type { Logger } from "pino";
import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  type Chain,
  type PublicClient,
  type Transport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ARC_TESTNET_CHAIN_ID, ARC_TESTNET_EXPLORER_URL } from "@winz/shared";

import type { EngineEnv } from "../config/env";
import { explicitLogRange } from "./log-range";
import { rateLimitedTransport, RpcLimiter, type RpcLimits } from "./rpc-limiter";
import type { SignerAccounts } from "./types";

/** The variables the chain clients need, a subset of the engine's validated environment. */
export type ArcClientEnv = Pick<
  EngineEnv,
  | "ARC_CHAIN_ID"
  | "ARC_RPC_URL"
  | "ARC_RPC_FALLBACK_URL"
  | "ARC_RELAYER_PRIVATE_KEY"
  | "ARC_ORACLE_PRIVATE_KEY"
> &
  Partial<
    Pick<
      EngineEnv,
      | "ARC_RPC_MAX_REQUESTS_PER_SECOND"
      | "ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND"
      | "ARC_RPC_HEAVY_METHODS"
    >
  >;

export interface ArcClients {
  chain: Chain;
  /** Reads and broadcasts through the primary RPC, and through the fallback when it fails. */
  publicClient: PublicClient;
  /** Local accounts: they sign in-process and expose no way to read their key back. */
  accounts: SignerAccounts;
  /**
   * The limiter every request of `publicClient` goes through, or null when it was turned off.
   * `close()` it once nothing will use the client any more: waiting requests are released.
   */
  limiter: RpcLimiter | null;
}

export interface ArcClientOptions {
  /** Timeout of one HTTP request, per endpoint. Default 10 000 ms. */
  requestTimeoutMs?: number;
  /**
   * How many times the whole list of endpoints is tried again after a failure other than a rate
   * limit (network, timeout, HTTP 5xx). Default 2.
   */
  retryCount?: number;
  /** Receipt polling interval of the client's own helpers. Default 300 ms. */
  pollingIntervalMs?: number;
  /**
   * Limits of the request limiter, over those of the environment and the defaults
   * (`DEFAULT_RPC_LIMITS`). `false` turns the limiter off: requests then go straight to viem's
   * fallback transport, as they did before it existed.
   */
  rateLimit?: Partial<RpcLimits> | false;
  /** Where the limiter warns that a cool-down starts. Default: nowhere. */
  logger?: Logger;
}

/** The limits set by the environment, the unset ones left out. */
function limitsFromEnv(env: ArcClientEnv): Partial<RpcLimits> {
  return {
    ...(env.ARC_RPC_MAX_REQUESTS_PER_SECOND !== undefined
      ? { maxRequestsPerSecond: env.ARC_RPC_MAX_REQUESTS_PER_SECOND }
      : {}),
    ...(env.ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND !== undefined
      ? { maxHeavyRequestsPerSecond: env.ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND }
      : {}),
    ...(env.ARC_RPC_HEAVY_METHODS !== undefined ? { heavyMethods: env.ARC_RPC_HEAVY_METHODS } : {}),
  };
}

/**
 * Builds the viem public client and the two signer accounts from the environment. The
 * transport tries `ARC_RPC_URL` (QuickNode) first and `ARC_RPC_FALLBACK_URL` (the public RPC,
 * limited to about 10 requests per second) when it errors (SPEC section 8). The private keys
 * are consumed here and kept nowhere else.
 *
 * Every request goes through one `RpcLimiter` (unless `rateLimit: false`): whoever holds this
 * client, every service of the engine and the rehearsal runner, shares its limits and its
 * cool-downs. The limiter counts one request per try of the endpoint list; the fallback endpoint
 * is asked within the same turn when the primary fails, so neither endpoint ever gets more than
 * the limiter lets through.
 *
 * Every `eth_getLogs` is sent with an explicit `toBlock` ("latest" when the caller named none):
 * the public RPC of Arc testnet keeps answering an open-ended filter with its first answer.
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
  const retryCount = options.retryCount ?? 2;
  const endpoints = urls.map((url) => http(url, { timeout }));

  let limiter: RpcLimiter | null = null;
  let transport: Transport;
  if (options.rateLimit === false) {
    transport = fallback(endpoints, { retryCount });
  } else {
    limiter = new RpcLimiter({
      limits: { ...limitsFromEnv(env), ...options.rateLimit },
      logger: options.logger,
    });
    // The fallback tries each endpoint once; the limiter's transport owns every retry, so that
    // none of them skips the queue (viem's own retry would send a rate-limited request again
    // after 150 ms and 300 ms, feeding the limit).
    transport = rateLimitedTransport(fallback(endpoints, { retryCount: 0 }), {
      limiter,
      retryCount,
    });
  }
  const publicClient = createPublicClient({
    chain,
    // Outermost, so that it holds with or without the limiter (see log-range.ts).
    transport: explicitLogRange(transport),
    pollingInterval: options.pollingIntervalMs ?? 300,
  });
  return {
    chain,
    publicClient,
    accounts: {
      relayer: privateKeyToAccount(env.ARC_RELAYER_PRIVATE_KEY as `0x${string}`),
      oracle: privateKeyToAccount(env.ARC_ORACLE_PRIVATE_KEY as `0x${string}`),
    },
    limiter,
  };
}
