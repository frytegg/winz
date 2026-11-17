import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import {
  authenticateRequest,
  normalizeEmail,
  requireMerchant,
  requireUser,
  secretsEqual,
  type UserPrincipal,
} from "./auth";
import { ApiRouteError } from "./route";
import {
  ADMIN_KEY,
  FakeIdentity,
  authDeps,
  insertMerchant,
  randomWallet,
} from "./testing/fixtures";

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => {
  await database.drop();
});

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/me", { headers });
}

async function rejection(promise: Promise<unknown>): Promise<ApiRouteError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof ApiRouteError) return error;
    throw error;
  }
  throw new Error("expected an ApiRouteError, the call succeeded");
}

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Joe@Example.COM \t")).toBe("joe@example.com");
    expect(normalizeEmail("maya@example.com")).toBe("maya@example.com");
  });
});

describe("secretsEqual", () => {
  it("is true only for identical strings", () => {
    expect(secretsEqual(ADMIN_KEY, ADMIN_KEY)).toBe(true);
    expect(secretsEqual(`${ADMIN_KEY}x`, ADMIN_KEY)).toBe(false);
    expect(secretsEqual("", ADMIN_KEY)).toBe(false);
    expect(secretsEqual(ADMIN_KEY.toUpperCase(), ADMIN_KEY)).toBe(false);
  });
});

describe("requireUser and requireMerchant", () => {
  it("refuse a missing principal as a programming error, not as a 401", () => {
    expect(() => requireUser(undefined)).toThrow(/authenticate wired/);
    expect(() => requireUser({ kind: "admin" })).toThrow(/authenticate wired/);
    const fan: UserPrincipal = {
      kind: "user",
      userId: "u",
      privyUserId: "p",
      email: "e@example.com",
      walletAddress: null,
      roles: [],
      merchantId: null,
    };
    expect(requireUser(fan)).toBe(fan);
    expect(() => requireMerchant(fan)).toThrow(/authenticate wired/);
  });
});

describe("authenticateRequest", () => {
  let identity: FakeIdentity;

  beforeEach(async () => {
    await database.db`truncate users, merchants cascade`;
    identity = new FakeIdentity();
  });

  it("lets public and signature routes through with no principal", async () => {
    const deps = authDeps(database.db, identity);
    await expect(authenticateRequest(request(), "public", deps)).resolves.toBeNull();
    await expect(authenticateRequest(request(), "signature", deps)).resolves.toBeNull();
  });

  describe("admin", () => {
    it("accepts the exact key", async () => {
      const principal = await authenticateRequest(
        request({ "x-admin-key": ADMIN_KEY }),
        "admin",
        authDeps(database.db, identity),
      );
      expect(principal).toEqual({ kind: "admin" });
    });

    it.each([
      ["missing", {}],
      ["wrong", { "x-admin-key": "not-the-admin-key-at-all" }],
      ["a prefix", { "x-admin-key": ADMIN_KEY.slice(0, -1) }],
      ["longer", { "x-admin-key": `${ADMIN_KEY}0` }],
    ])("refuses a %s key with 401", async (_name, headers: Record<string, string>) => {
      const error = await rejection(
        authenticateRequest(request(headers), "admin", authDeps(database.db, identity)),
      );
      expect(error.status).toBe(401);
      expect(error.code).toBe("unauthenticated");
    });
  });

  describe("user", () => {
    it.each([
      ["missing", {}],
      ["empty", { authorization: "" }],
      ["not bearer", { authorization: "Basic am9lOnB3" }],
      ["bearer without token", { authorization: "Bearer" }],
      ["two tokens", { authorization: "Bearer abc def" }],
    ])("refuses a %s authorization header with 401", async (_name, headers) => {
      const error = await rejection(
        authenticateRequest(request(headers), "user", authDeps(database.db, identity)),
      );
      expect(error.status).toBe(401);
      expect(error.code).toBe("unauthenticated");
    });

    it("refuses a token the provider rejects with 401", async () => {
      identity.addUser("good", "did:privy:joe", { email: "joe@example.com" });
      const error = await rejection(
        authenticateRequest(
          request({ authorization: "Bearer forged" }),
          "user",
          authDeps(database.db, identity),
        ),
      );
      expect(error.status).toBe(401);
      const [count] = await database.db<{ n: bigint }[]>`select count(*)::bigint as n from users`;
      expect(count?.n).toBe(0n);
    });

    it("lets a provider outage through as an error (500), not as a 401", async () => {
      identity.failure = new Error("JWKS endpoint unreachable");
      await expect(
        authenticateRequest(
          request({ authorization: "Bearer good" }),
          "user",
          authDeps(database.db, identity),
        ),
      ).rejects.toThrow("JWKS endpoint unreachable");
    });

    it("creates the user at the first sign-in, with a normalised e-mail, and only once", async () => {
      const wallet = randomWallet();
      identity.addUser("tok", "did:privy:joe", {
        email: "  Joe@Example.COM ",
        walletAddress: wallet,
      });
      const deps = authDeps(database.db, identity);
      const first = await authenticateRequest(
        request({ authorization: "Bearer tok" }),
        "user",
        deps,
      );
      const second = await authenticateRequest(
        request({ authorization: "Bearer tok" }),
        "user",
        deps,
      );

      expect(first).toEqual({
        kind: "user",
        userId: expect.any(String),
        privyUserId: "did:privy:joe",
        email: "joe@example.com",
        walletAddress: wallet,
        roles: [],
        merchantId: null,
      });
      expect(second).toEqual(first);
      // The second request found the row: no second call to the provider's directory.
      expect(identity.getUserCalls).toBe(1);
      const rows = await database.db`select email, privy_id, wallet from users`;
      expect(rows).toEqual([{ email: "joe@example.com", privy_id: "did:privy:joe", wallet }]);
    });

    it("creates one row when two first requests arrive together", async () => {
      identity.addUser("tok", "did:privy:joe", { email: "joe@example.com" });
      identity.delayMs = 50;
      const deps = authDeps(database.db, identity);
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          authenticateRequest(request({ authorization: "Bearer tok" }), "user", deps),
        ),
      );
      const ids = new Set(results.map((principal) => (principal as UserPrincipal).userId));
      expect(ids.size).toBe(1);
      const [count] = await database.db<{ n: bigint }[]>`select count(*)::bigint as n from users`;
      expect(count?.n).toBe(1n);
    });

    it("adopts the row of a fan created at purchase with the same e-mail", async () => {
      const wallet = randomWallet();
      const [fan] = await database.db<{ id: string }[]>`
        insert into users (email, wallet, roles) values ('maya@example.com', ${wallet}, '{fan}')
        returning id
      `;
      identity.addUser("tok", "did:privy:maya", { email: "Maya@example.com", walletAddress: null });
      const principal = (await authenticateRequest(
        request({ authorization: "Bearer tok" }),
        "user",
        authDeps(database.db, identity),
      )) as UserPrincipal;
      expect(principal.userId).toBe(fan?.id);
      expect(principal.walletAddress).toBe(wallet);
      expect(principal.roles).toEqual(["fan"]);
    });

    it("picks up a wallet the provider created after the first sign-in", async () => {
      identity.addUser("tok", "did:privy:joe", { email: "joe@example.com", walletAddress: null });
      const deps = authDeps(database.db, identity);
      const before = (await authenticateRequest(
        request({ authorization: "Bearer tok" }),
        "user",
        deps,
      )) as UserPrincipal;
      expect(before.walletAddress).toBeNull();

      const wallet = randomWallet();
      identity.users.set("did:privy:joe", { email: "joe@example.com", walletAddress: wallet });
      const after = (await authenticateRequest(
        request({ authorization: "Bearer tok" }),
        "user",
        deps,
      )) as UserPrincipal;
      expect(after.walletAddress).toBe(wallet);
      expect(after.userId).toBe(before.userId);
    });

    it("refuses an account without an e-mail with 403", async () => {
      identity.addUser("tok", "did:privy:passkey-only", { email: null });
      const error = await rejection(
        authenticateRequest(
          request({ authorization: "Bearer tok" }),
          "user",
          authDeps(database.db, identity),
        ),
      );
      expect(error.status).toBe(403);
    });
  });

  describe("merchant", () => {
    it("refuses a signed-in user without a business with 403", async () => {
      identity.addUser("tok", "did:privy:maya", { email: "maya@example.com" });
      const error = await rejection(
        authenticateRequest(
          request({ authorization: "Bearer tok" }),
          "merchant",
          authDeps(database.db, identity),
        ),
      );
      expect(error.status).toBe(403);
      expect(error.code).toBe("forbidden");
    });

    it("refuses a missing token with 401 before anything else", async () => {
      const error = await rejection(
        authenticateRequest(request(), "merchant", authDeps(database.db, identity)),
      );
      expect(error.status).toBe(401);
    });

    it("returns the merchant id of a user who owns a business", async () => {
      const { userId, merchantId } = await insertMerchant(database.db, {
        email: "joe@example.com",
        privyId: "did:privy:joe",
        wallet: randomWallet(),
      });
      identity.addUser("tok", "did:privy:joe", { email: "joe@example.com" });
      const principal = requireMerchant(
        await authenticateRequest(
          request({ authorization: "Bearer tok" }),
          "merchant",
          authDeps(database.db, identity),
        ),
      );
      expect(principal.userId).toBe(userId);
      expect(principal.merchantId).toBe(merchantId);
      expect(principal.roles).toEqual(["merchant"]);
    });
  });
});
