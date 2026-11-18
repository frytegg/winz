import { privateKeyToAccount } from "viem/accounts";
import { concat, hexToBytes, keccak256, stringToBytes, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../db";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import {
  DemoIdentityDirectory,
  DemoSeedError,
  RoutingIdentityDirectory,
  demoUserId,
  demoWalletAddress,
  demoWalletKey,
} from "./demo-directory";
import { InvalidEmailError } from "./directory";
import { FakeIdentityDirectory } from "./fake-directory";
import { resolveUserWallet } from "./users";

/** Test seeds: public, local only. */
const SEED: Hex = `0x${"11".repeat(32)}`;
const OTHER_SEED: Hex = `0x${"22".repeat(32)}`;

describe("demo wallets", () => {
  it("are deterministic: the same e-mail always gets the same key, address and user id", async () => {
    const directory = new DemoIdentityDirectory(SEED);
    const first = await directory.findOrCreateWalletByEmail("maya@example.com");
    const second = await new DemoIdentityDirectory(SEED).findOrCreateWalletByEmail(
      "maya@example.com",
    );
    expect(second).toEqual(first);
    expect(demoWalletKey(SEED, "maya@example.com")).toBe(demoWalletKey(SEED, "maya@example.com"));
    expect(first.privyUserId).toMatch(/^demo:[0-9a-f]{32}$/);
    expect(first.walletAddress).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it("normalise the e-mail first", async () => {
    const directory = new DemoIdentityDirectory(SEED);
    expect(await directory.findOrCreateWalletByEmail("  Maya@Example.com ")).toEqual(
      await directory.findOrCreateWalletByEmail("maya@example.com"),
    );
    expect(demoWalletKey(SEED, "  Maya@Example.com ")).toBe(
      demoWalletKey(SEED, "maya@example.com"),
    );
    expect(demoUserId("  Maya@Example.com ")).toBe(demoUserId("maya@example.com"));
  });

  it("differ between e-mails", async () => {
    const directory = new DemoIdentityDirectory(SEED);
    const maya = await directory.findOrCreateWalletByEmail("maya@example.com");
    const theo = await directory.findOrCreateWalletByEmail("theo@example.com");
    expect(theo.walletAddress).not.toBe(maya.walletAddress);
    expect(theo.privyUserId).not.toBe(maya.privyUserId);
  });

  it("differ between seeds (the user id does not depend on the seed)", () => {
    expect(demoWalletAddress(OTHER_SEED, "maya@example.com")).not.toBe(
      demoWalletAddress(SEED, "maya@example.com"),
    );
    expect(demoWalletKey(OTHER_SEED, "maya@example.com")).not.toBe(
      demoWalletKey(SEED, "maya@example.com"),
    );
  });

  it("have the address of their derived key, and the key is keccak256(seed || e-mail)", async () => {
    const key = demoWalletKey(SEED, "maya@example.com");
    expect(key).toBe(keccak256(concat([hexToBytes(SEED), stringToBytes("maya@example.com")])));
    const { walletAddress } = await new DemoIdentityDirectory(SEED).findOrCreateWalletByEmail(
      "maya@example.com",
    );
    expect(walletAddress).toBe(privateKeyToAccount(key).address.toLowerCase());
  });

  it("refuse a malformed seed and an empty e-mail", async () => {
    expect(() => new DemoIdentityDirectory("0x1234")).toThrow(DemoSeedError);
    expect(() => demoWalletKey(`0x${"zz".repeat(32)}` as Hex, "a@b.c")).toThrow(DemoSeedError);
    await expect(
      new DemoIdentityDirectory(SEED).findOrCreateWalletByEmail("   "),
    ).rejects.toBeInstanceOf(InvalidEmailError);
  });
});

describe("RoutingIdentityDirectory", () => {
  it("uses the real directory when one is configured", async () => {
    const real = new FakeIdentityDirectory();
    const directory = new RoutingIdentityDirectory(real, new DemoIdentityDirectory(SEED));
    const found = await directory.findOrCreateWalletByEmail("maya@example.com");
    expect(real.lookups).toEqual(["maya@example.com"]);
    expect(found.privyUserId).toMatch(/^did:privy:/);
    expect(directory.usesDemoWallets).toBe(false);
  });

  it("uses the demo directory otherwise", async () => {
    const directory = new RoutingIdentityDirectory(null, new DemoIdentityDirectory(SEED));
    expect(directory.usesDemoWallets).toBe(true);
    expect((await directory.findOrCreateWalletByEmail("maya@example.com")).walletAddress).toBe(
      demoWalletAddress(SEED, "maya@example.com"),
    );
  });
});

describe("demo wallets in the users table", () => {
  let database: TestDatabase;
  let db: Db;

  beforeAll(async () => {
    database = await createTestDatabase();
    db = database.db;
  });

  afterAll(async () => {
    await database?.drop();
  });

  it("go through resolveUserWallet like Privy's", async () => {
    const directory = new DemoIdentityDirectory(SEED);
    const resolved = await resolveUserWallet(db, directory, " Demo.Buyer@Example.com", "fan");
    expect(resolved.walletAddress).toBe(demoWalletAddress(SEED, "demo.buyer@example.com"));
    expect(resolved.privyUserId).toBe(demoUserId("demo.buyer@example.com"));
    const again = await resolveUserWallet(db, directory, "demo.buyer@example.com", "fan");
    expect(again.userId).toBe(resolved.userId);
    expect(again.fromDirectory).toBe(false);
  });
});
