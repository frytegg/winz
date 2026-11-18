/** The demo wallet sweep, on a local anvil chain. */
import { createPublicClient, http, parseEther, type Address, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startAnvil, type AnvilInstance } from "../testing/anvil";
import { demoWalletAddress, demoWalletKey } from "./demo-directory";
import { sweepDemoWallets } from "./sweep-demo-wallets";

/** Test seed: public, local chain only. */
const SEED: Hex = `0x${"5e".repeat(32)}`;
const TREASURY: Address = "0x00000000000000000000000000000000000Fee01";

let anvil: AnvilInstance;

beforeAll(async () => {
  anvil = await startAnvil();
});

afterAll(async () => {
  await anvil?.stop();
});

async function balanceOf(address: Address): Promise<bigint> {
  return createPublicClient({ transport: http(anvil.rpcUrl) }).getBalance({ address });
}

async function fund(address: Address, wei: bigint): Promise<void> {
  await anvil.rpc("anvil_setBalance", [address, `0x${wei.toString(16)}`]);
}

describe("sweepDemoWallets", () => {
  it("sends each funded demo wallet's balance minus gas to the destination and skips empty ones", async () => {
    const maya = demoWalletAddress(SEED, "maya@example.com") as Address;
    const theo = demoWalletAddress(SEED, "theo@example.com") as Address;
    const empty = demoWalletAddress(SEED, "nobody@example.com") as Address;
    await fund(maya, parseEther("12.5"));
    await fund(theo, parseEther("0.75"));

    const lines: string[] = [];
    const results = await sweepDemoWallets({
      seed: SEED,
      // Two spellings of one e-mail: swept once.
      emails: ["maya@example.com", " Theo@Example.com", "nobody@example.com", "MAYA@example.com"],
      rpcUrl: anvil.rpcUrl,
      destination: TREASURY,
      out: (line) => lines.push(line),
    });

    expect(results.map((result) => result.status)).toEqual(["swept", "swept", "empty"]);
    expect(await balanceOf(maya)).toBe(0n);
    expect(await balanceOf(theo)).toBe(0n);
    expect(await balanceOf(empty)).toBe(0n);
    const [mayaResult, theoResult] = results;
    expect((mayaResult?.sentWei ?? 0n) + (mayaResult?.gasWei ?? 0n)).toBe(parseEther("12.5"));
    expect((theoResult?.sentWei ?? 0n) + (theoResult?.gasWei ?? 0n)).toBe(parseEther("0.75"));
    expect(await balanceOf(TREASURY)).toBe(
      (mayaResult?.sentWei ?? 0n) + (theoResult?.sentWei ?? 0n),
    );

    // One line per wallet, and no key in any of them.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("swept 12.49");
    expect(lines[2]).toContain("skipped");
    const keys = ["maya@example.com", "theo@example.com", "nobody@example.com"].map((email) =>
      demoWalletKey(SEED, email).slice(2).toLowerCase(),
    );
    for (const line of lines) {
      for (const key of keys) expect(line.toLowerCase()).not.toContain(key);
      expect(line.toLowerCase()).not.toContain(SEED.slice(2));
    }

    // A second run finds nothing left.
    const again = await sweepDemoWallets({
      seed: SEED,
      emails: ["maya@example.com", "theo@example.com"],
      rpcUrl: anvil.rpcUrl,
      destination: TREASURY,
      out: () => undefined,
    });
    expect(again.map((result) => result.status)).toEqual(["empty", "empty"]);
  });

  it("skips a wallet the users table records differently", async () => {
    const derived = demoWalletAddress(SEED, "other@example.com") as Address;
    await fund(derived, parseEther("1"));
    const results = await sweepDemoWallets({
      seed: SEED,
      emails: ["other@example.com"],
      rpcUrl: anvil.rpcUrl,
      destination: TREASURY,
      out: () => undefined,
      expectedWallets: new Map([["other@example.com", `0x${"ab".repeat(20)}`]]),
    });
    expect(results.map((result) => result.status)).toEqual(["mismatch"]);
    expect(await balanceOf(derived)).toBe(parseEther("1"));
  });
});
