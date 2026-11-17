import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../db";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { IdentityConflictError, InvalidEmailError, normalizeEmail } from "./directory";
import { FakeIdentityDirectory } from "./fake-directory";
import { resolveUserWallet } from "./users";

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
});

afterAll(async () => {
  await database?.drop();
});

interface UserRow {
  email: string;
  privy_id: string | null;
  wallet: string | null;
  roles: string[];
}

async function usersLike(fragment: string): Promise<UserRow[]> {
  return db<UserRow[]>`
    select email, privy_id, wallet, roles from users where email like ${`%${fragment}%`}
    order by email
  `;
}

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Maya@Example.com ")).toBe("maya@example.com");
  });
});

describe("resolveUserWallet", () => {
  it("normalises before any lookup: two spellings, one user, one wallet", async () => {
    const directory = new FakeIdentityDirectory();
    const first = await resolveUserWallet(db, directory, "  Maya@Example.com ", "fan");
    const second = await resolveUserWallet(db, directory, "maya@example.com", "fan");

    expect(second.walletAddress).toBe(first.walletAddress);
    expect(second.userId).toBe(first.userId);
    expect(first.fromDirectory).toBe(true);
    expect(second.fromDirectory).toBe(false);
    expect(directory.lookups).toEqual(["maya@example.com"]);
    expect(await usersLike("maya")).toEqual([
      {
        email: "maya@example.com",
        privy_id: first.privyUserId,
        wallet: first.walletAddress,
        roles: ["fan"],
      },
    ]);
  });

  it("keeps a merchant's row and adds the fan role to it", async () => {
    await db`insert into users (email, roles) values ('owner@example.com', '{merchant}')`;
    const directory = new FakeIdentityDirectory();
    const resolved = await resolveUserWallet(db, directory, "Owner@Example.com", "fan");
    expect(await usersLike("owner")).toEqual([
      {
        email: "owner@example.com",
        privy_id: resolved.privyUserId,
        wallet: resolved.walletAddress,
        roles: ["merchant", "fan"],
      },
    ]);
    // Asked again with the other role it already has: nothing duplicated.
    await resolveUserWallet(db, directory, "owner@example.com", "merchant");
    expect((await usersLike("owner"))[0]?.roles).toEqual(["merchant", "fan"]);
  });

  it("refuses an empty e-mail", async () => {
    await expect(
      resolveUserWallet(db, new FakeIdentityDirectory(), "   ", "fan"),
    ).rejects.toBeInstanceOf(InvalidEmailError);
  });

  it("refuses when the row of the e-mail holds another Privy user", async () => {
    await db`insert into users (email, privy_id, roles) values ('clash@example.com', 'did:privy:other', '{}')`;
    await expect(
      resolveUserWallet(db, new FakeIdentityDirectory(), "clash@example.com", "fan"),
    ).rejects.toBeInstanceOf(IdentityConflictError);
    expect((await usersLike("clash"))[0]?.wallet).toBeNull();
  });

  it("passes the directory's failure through, and writes nothing", async () => {
    const directory = new FakeIdentityDirectory();
    directory.failNext(new Error("directory down"));
    await expect(resolveUserWallet(db, directory, "down@example.com", "fan")).rejects.toThrow(
      "directory down",
    );
    expect(await usersLike("down")).toEqual([]);
  });
});
