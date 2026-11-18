import type { Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserRole } from "@winz/shared";

import { createDb, type Db } from "../db";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { demoUserId, demoWalletAddress, DemoIdentityDirectory } from "./demo-directory";
import { IdentityConflictError, type IdentityDirectory } from "./directory";
import { FakeIdentityDirectory } from "./fake-directory";
import { resolveUserWallet, type ResolvedUser } from "./users";

/**
 * Concurrent `resolveUserWallet` calls (SPEC ID-1): a buyer who taps twice, two tabs, or the demo
 * replaying two sales of one buyer. The directory holds every lookup until all the calls of a
 * round have asked it, then answers them together after a short delay, so the inserts that
 * follow really overlap.
 */

/** Test seed: public, local only. */
const SEED: Hex = `0x${"33".repeat(32)}`;
/** Longest a lookup waits for the rest of its round before answering anyway. */
const GATE_TIMEOUT_MS = 2_000;
/** The short delay every answer takes once the round is complete. */
const ANSWER_DELAY_MS = 5;

type Answer = { privyUserId: string; walletAddress: string };

let database: TestDatabase;
/** A client with enough connections for the largest round to run at once. */
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url, { max: 25 });
});

afterAll(async () => {
  await db?.end({ timeout: 5 });
  await database?.drop();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a directory: each lookup waits until `round` lookups have arrived (or the timeout), then
 * all of them get the inner directory's answer after `ANSWER_DELAY_MS`.
 */
class GatedDirectory implements IdentityDirectory {
  private waiting: (() => void)[] = [];

  constructor(
    private readonly inner: IdentityDirectory,
    private readonly round: number,
  ) {}

  async findOrCreateWalletByEmail(email: string): Promise<Answer> {
    const gate = new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
    if (this.waiting.length >= this.round) {
      const released = this.waiting;
      this.waiting = [];
      for (const release of released) release();
    }
    // The timeout's timer is cleared once the gate opens, so no round leaves one pending.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, GATE_TIMEOUT_MS);
    });
    try {
      await Promise.race([gate, timeout]);
    } finally {
      clearTimeout(timer);
    }
    await sleep(ANSWER_DELAY_MS);
    return this.inner.findOrCreateWalletByEmail(email);
  }
}

/** A directory whose answers the test writes: the `n`-th lookup gets `answer(n)`. */
class ScriptedDirectory implements IdentityDirectory {
  private count = 0;

  constructor(private readonly answer: (n: number) => Answer) {}

  findOrCreateWalletByEmail(): Promise<Answer> {
    const n = this.count;
    this.count += 1;
    return Promise.resolve(this.answer(n));
  }
}

interface UserRow {
  id: string;
  email: string;
  privy_id: string | null;
  wallet: string | null;
  roles: string[];
}

async function rowsOf(email: string): Promise<UserRow[]> {
  return db<UserRow[]>`
    select id, email, privy_id, wallet, roles from users where email = ${email}
  `;
}

function wallet(n: number): string {
  return `0x${n.toString(16).padStart(40, "0")}`;
}

/** N concurrent calls; every one must succeed with the same user and wallet. */
async function concurrentAgreement(
  directory: IdentityDirectory,
  emails: string[],
  role: UserRole,
): Promise<ResolvedUser[]> {
  const results = await Promise.allSettled(
    emails.map((email) => resolveUserWallet(db, directory, email, role)),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [String(result.reason)] : [],
  );
  expect(failures).toEqual([]);
  return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

describe("resolveUserWallet under concurrency", () => {
  for (const [n, rounds] of [
    [2, 150],
    [5, 60],
    [20, 15],
  ] as const) {
    it(`${n} concurrent calls for one new e-mail all get the same user and wallet, one row (${rounds} rounds)`, async () => {
      for (let round = 0; round < rounds; round += 1) {
        const email = `race-${n}-${round}@example.com`;
        const directory = new GatedDirectory(new FakeIdentityDirectory(), n);
        const resolved = await concurrentAgreement(
          directory,
          Array.from({ length: n }, () => email),
          "fan",
        );
        const [first] = resolved;
        expect(first).toBeDefined();
        for (const user of resolved) {
          expect(user.userId).toBe(first?.userId);
          expect(user.walletAddress).toBe(first?.walletAddress);
          expect(user.privyUserId).toBe(first?.privyUserId);
          expect(user.email).toBe(email);
        }
        expect(await rowsOf(email)).toEqual([
          {
            id: first?.userId,
            email,
            privy_id: first?.privyUserId,
            wallet: first?.walletAddress,
            roles: ["fan"],
          },
        ]);
      }
    });
  }

  it("concurrent calls with two roles: the row ends with both", async () => {
    for (let round = 0; round < 60; round += 1) {
      const email = `roles-${round}@example.com`;
      const directory = new GatedDirectory(new FakeIdentityDirectory(), 4);
      const roles: UserRole[] = ["fan", "merchant", "fan", "merchant"];
      const results = await Promise.allSettled(
        roles.map((role) => resolveUserWallet(db, directory, email, role)),
      );
      expect(results.filter((result) => result.status === "rejected")).toEqual([]);
      const rows = await rowsOf(email);
      expect(rows).toHaveLength(1);
      expect([...(rows[0]?.roles ?? [])].sort()).toEqual(["fan", "merchant"]);
    }
  });

  it("concurrent calls for two different e-mails: two rows, no interference", async () => {
    for (let round = 0; round < 40; round += 1) {
      const emails = [`pair-a-${round}@example.com`, `pair-b-${round}@example.com`];
      const directory = new GatedDirectory(new FakeIdentityDirectory(), 6);
      const resolved = await concurrentAgreement(
        directory,
        [emails[0], emails[1], emails[0], emails[1], emails[0], emails[1]] as string[],
        "fan",
      );
      const byEmail = new Map<string, Set<string>>();
      for (const user of resolved) {
        const set = byEmail.get(user.email) ?? new Set<string>();
        set.add(`${user.userId}|${user.walletAddress}`);
        byEmail.set(user.email, set);
      }
      expect(byEmail.get(emails[0] as string)?.size).toBe(1);
      expect(byEmail.get(emails[1] as string)?.size).toBe(1);
      const [rowA] = await rowsOf(emails[0] as string);
      const [rowB] = await rowsOf(emails[1] as string);
      expect(rowA?.wallet).not.toBeNull();
      expect(rowB?.wallet).not.toBeNull();
      expect(rowA?.wallet).not.toBe(rowB?.wallet);
      expect(rowA?.id).not.toBe(rowB?.id);
    }
  });

  it("the e-mail in different cases and spaces resolves to one row", async () => {
    for (let round = 0; round < 40; round += 1) {
      const spellings = [
        `Case-${round}@Example.com`,
        `  case-${round}@example.com`,
        `CASE-${round}@EXAMPLE.COM  `,
        `case-${round}@example.com`,
      ];
      const directory = new GatedDirectory(new FakeIdentityDirectory(), spellings.length);
      const resolved = await concurrentAgreement(directory, spellings, "fan");
      const email = `case-${round}@example.com`;
      expect(new Set(resolved.map((user) => user.userId)).size).toBe(1);
      expect(new Set(resolved.map((user) => user.walletAddress)).size).toBe(1);
      expect(resolved.every((user) => user.email === email)).toBe(true);
      expect(await rowsOf(email)).toHaveLength(1);
    }
  });

  it("the same race through DemoIdentityDirectory, with the real derivation", async () => {
    for (let round = 0; round < 40; round += 1) {
      const email = `demo-race-${round}@example.com`;
      const directory = new GatedDirectory(new DemoIdentityDirectory(SEED), 5);
      const resolved = await concurrentAgreement(
        directory,
        Array.from({ length: 5 }, () => email),
        "fan",
      );
      const expectedWallet = demoWalletAddress(SEED, email);
      for (const user of resolved) {
        expect(user.walletAddress).toBe(expectedWallet);
        expect(user.privyUserId).toBe(demoUserId(email));
      }
      expect(await rowsOf(email)).toEqual([
        {
          id: resolved[0]?.userId,
          email,
          privy_id: demoUserId(email),
          wallet: expectedWallet,
          roles: ["fan"],
        },
      ]);
    }
  });

  it("concurrent calls on a row that already holds a wallet add each role once", async () => {
    // The fast path: the directory is not asked, and every call reads the row before any adds
    // its role, so only the condition `addRole` evaluates again on the locked row keeps a role
    // from being appended twice.
    const cases: { label: string; roles: UserRole[]; expected: string[] }[] = [
      {
        label: "two roles",
        roles: ["fan", "merchant", "fan", "merchant"],
        expected: ["fan", "merchant"],
      },
      { label: "one role", roles: ["fan", "fan", "fan", "fan"], expected: ["fan"] },
    ];
    for (const { label, roles, expected } of cases) {
      for (let round = 0; round < 60; round += 1) {
        const email = `fast-${label.replace(" ", "-")}-${round}@example.com`;
        const [row] = await db<{ id: string }[]>`
          insert into users (email, privy_id, wallet, roles)
          values (${email}, ${`did:privy:fast-${label.length}-${round}`},
            ${wallet(10_000 + label.length * 1_000 + round)}, '{}')
          returning id
        `;
        const directory = new FakeIdentityDirectory();
        const results = await Promise.allSettled(
          roles.map((role) => resolveUserWallet(db, directory, email, role)),
        );
        expect(results.filter((result) => result.status === "rejected")).toEqual([]);
        for (const result of results) {
          if (result.status === "fulfilled") expect(result.value.userId).toBe(row?.id);
        }
        expect(directory.lookups).toEqual([]);
        const rows = await rowsOf(email);
        expect(rows).toHaveLength(1);
        expect([...(rows[0]?.roles ?? [])].sort()).toEqual(expected);
      }
    }
  });

  it("concurrent calls on an existing row without a wallet fill it once and keep its roles", async () => {
    for (let round = 0; round < 40; round += 1) {
      const email = `nowallet-${round}@example.com`;
      await db`insert into users (email, roles) values (${email}, '{merchant}')`;
      const directory = new GatedDirectory(new FakeIdentityDirectory(), 5);
      const resolved = await concurrentAgreement(
        directory,
        Array.from({ length: 5 }, () => email),
        "fan",
      );
      expect(new Set(resolved.map((user) => user.userId)).size).toBe(1);
      expect(new Set(resolved.map((user) => user.walletAddress)).size).toBe(1);
      const rows = await rowsOf(email);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.wallet).toBe(resolved[0]?.walletAddress);
      expect(rows[0]?.roles).toEqual(["merchant", "fan"]);
    }
  });

  it("writers that do not take the lock (the web sign-in's upsert) racing the calls", async () => {
    for (let round = 0; round < 200; round += 1) {
      const email = `foreign-${round}@example.com`;
      const directory = new GatedDirectory(new FakeIdentityDirectory(), 4);
      const foreign = async (): Promise<void> => {
        const found = await directory.findOrCreateWalletByEmail(email);
        try {
          await db`
            insert into users (email, privy_id, wallet)
            values (${email}, ${found.privyUserId}, ${found.walletAddress})
            on conflict (email) do update set
              privy_id = coalesce(users.privy_id, excluded.privy_id),
              wallet = coalesce(users.wallet, excluded.wallet)
          `;
        } catch (error: unknown) {
          // How the sign-in handles its own lost race is not under test here.
          const code = (error as { code?: unknown }).code;
          if (code !== "23505" && code !== "40P01") throw error;
        }
      };
      const [resolved] = await Promise.all([
        concurrentAgreement(directory, [email, email], "fan"),
        foreign(),
        foreign(),
      ]);
      expect(new Set(resolved.map((user) => user.userId)).size).toBe(1);
      const rows = await rowsOf(email);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.wallet).toBe(resolved[0]?.walletAddress);
      expect(rows[0]?.roles).toEqual(["fan"]);
    }
  });
});

describe("resolveUserWallet still refuses a real conflict", () => {
  it("a new e-mail whose directory wallet another e-mail's row holds, even in concurrent calls", async () => {
    await db`
      insert into users (email, privy_id, wallet, roles)
      values ('holder-w@example.com', 'did:privy:holder-w', ${wallet(1)}, '{fan}')
    `;
    const directory = new GatedDirectory(
      new ScriptedDirectory(() => ({
        privyUserId: "did:privy:newcomer-w",
        walletAddress: wallet(1),
      })),
      3,
    );
    const results = await Promise.allSettled(
      [0, 1, 2].map(() => resolveUserWallet(db, directory, "newcomer-w@example.com", "fan")),
    );
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(IdentityConflictError);
      }
    }
    expect(await rowsOf("newcomer-w@example.com")).toEqual([]);
    expect((await rowsOf("holder-w@example.com"))[0]?.privy_id).toBe("did:privy:holder-w");
  });

  it("a new e-mail whose directory user another e-mail's row holds", async () => {
    await db`
      insert into users (email, privy_id, wallet, roles)
      values ('holder-p@example.com', 'did:privy:holder-p', ${wallet(2)}, '{fan}')
    `;
    const directory = new ScriptedDirectory(() => ({
      privyUserId: "did:privy:holder-p",
      walletAddress: wallet(3),
    }));
    await expect(
      resolveUserWallet(db, directory, "newcomer-p@example.com", "fan"),
    ).rejects.toBeInstanceOf(IdentityConflictError);
    expect(await rowsOf("newcomer-p@example.com")).toEqual([]);
  });

  it("the e-mail's row holding another wallet than the directory's, written by a concurrent call", async () => {
    for (let round = 0; round < 40; round += 1) {
      const email = `split-${round}@example.com`;
      // An inconsistent directory: one Privy user, a different wallet per lookup.
      const directory = new GatedDirectory(
        new ScriptedDirectory((n) => ({
          privyUserId: `did:privy:split-${round}`,
          walletAddress: wallet(1_000 + round * 10 + n),
        })),
        3,
      );
      const results = await Promise.allSettled(
        [0, 1, 2].map(() => resolveUserWallet(db, directory, email, "fan")),
      );
      const fulfilled = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const rejected = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason as unknown] : [],
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(2);
      for (const reason of rejected) expect(reason).toBeInstanceOf(IdentityConflictError);
      expect(await rowsOf(email)).toEqual([
        {
          id: fulfilled[0]?.userId,
          email,
          privy_id: `did:privy:split-${round}`,
          wallet: fulfilled[0]?.walletAddress,
          roles: ["fan"],
        },
      ]);
    }
  });

  it("the e-mail's row holding another wallet: answered from the row, the directory not asked", async () => {
    await db`
      insert into users (email, privy_id, wallet, roles)
      values ('kept@example.com', 'did:privy:kept', ${wallet(4)}, '{merchant}')
    `;
    const directory = new FakeIdentityDirectory();
    const resolved = await resolveUserWallet(db, directory, "kept@example.com", "fan");
    expect(resolved.walletAddress).toBe(wallet(4));
    expect(resolved.fromDirectory).toBe(false);
    expect(directory.lookups).toEqual([]);
  });
});
