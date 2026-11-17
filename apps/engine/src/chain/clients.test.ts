import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startAnvil, type AnvilInstance } from "../testing/anvil";
import { createArcClients, type ArcClientEnv } from "./clients";

const DEAD_RPC_URL = "http://127.0.0.1:1";

describe("createArcClients", () => {
  let anvil: AnvilInstance;
  let env: ArcClientEnv;

  beforeAll(async () => {
    anvil = await startAnvil();
    const [relayerKey, oracleKey] = anvil.privateKeys;
    if (!relayerKey || !oracleKey) throw new Error("missing keys");
    env = {
      ARC_CHAIN_ID: anvil.chainId,
      ARC_RPC_URL: anvil.rpcUrl,
      ARC_RPC_FALLBACK_URL: DEAD_RPC_URL,
      ARC_RELAYER_PRIVATE_KEY: relayerKey,
      ARC_ORACLE_PRIVATE_KEY: oracleKey,
    };
  });
  afterAll(async () => {
    await anvil.stop();
  });

  it("builds a client for the configured chain and one account per signer", async () => {
    const clients = createArcClients(env);
    expect(clients.chain.id).toBe(5_042_002);
    expect(clients.chain.nativeCurrency).toMatchObject({ symbol: "USDC", decimals: 18 });
    expect(await clients.publicClient.getChainId()).toBe(anvil.chainId);
    expect(clients.accounts.relayer.address).toBe(anvil.accounts[0]?.address);
    expect(clients.accounts.oracle.address).toBe(anvil.accounts[1]?.address);
    expect(clients.accounts.relayer.address).not.toBe(clients.accounts.oracle.address);
  });

  it("falls back to the second RPC when the primary is down", async () => {
    const clients = createArcClients(
      { ...env, ARC_RPC_URL: DEAD_RPC_URL, ARC_RPC_FALLBACK_URL: anvil.rpcUrl },
      { retryCount: 0, requestTimeoutMs: 2_000 },
    );
    expect(await clients.publicClient.getChainId()).toBe(anvil.chainId);
    expect(await clients.publicClient.getBlockNumber()).toBeGreaterThanOrEqual(0n);
  });

  it("fails when both RPCs are down", async () => {
    const clients = createArcClients(
      { ...env, ARC_RPC_URL: DEAD_RPC_URL, ARC_RPC_FALLBACK_URL: "http://127.0.0.1:2" },
      { retryCount: 0, requestTimeoutMs: 2_000 },
    );
    await expect(clients.publicClient.getChainId()).rejects.toThrow();
  });

  it("does not expose the private keys on what it returns", () => {
    const clients = createArcClients(env);
    const seen = new Set<unknown>();
    const texts: string[] = [];
    const visit = (value: unknown, depth: number): void => {
      if (typeof value === "string") texts.push(value.toLowerCase());
      if (typeof value !== "object" || value === null || seen.has(value) || depth > 6) return;
      seen.add(value);
      for (const key of Reflect.ownKeys(value)) {
        visit((value as Record<PropertyKey, unknown>)[key], depth + 1);
      }
    };
    visit(clients, 0);
    const haystack = texts.join("\n");
    // Positive control: the walk does reach strings held by the accounts.
    expect(haystack).toContain(clients.accounts.relayer.address.toLowerCase());
    for (const key of [env.ARC_RELAYER_PRIVATE_KEY, env.ARC_ORACLE_PRIVATE_KEY]) {
      expect(haystack).not.toContain(key.slice(2).toLowerCase());
    }
  });

  it("uses the same URL once when primary and fallback are identical", () => {
    const clients = createArcClients({ ...env, ARC_RPC_FALLBACK_URL: env.ARC_RPC_URL });
    expect(clients.chain.rpcUrls.default.http).toEqual([anvil.rpcUrl]);
  });
});
