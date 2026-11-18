import pino, { type Logger } from "pino";
import postgres, { type TransactionSql } from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDb, type Db } from "../db";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import type { IdentityDirectory } from "./directory";
import { TransactionRetryExhaustedError } from "./transaction-retry";
import { resolveUserWallet, usersLockKey } from "./users";

/**
 * `resolveUserWallet` on a deadlock (40P01) or a serialization failure (40001): its write of the
 * users row runs again, like the web sign-in's (apps/web/lib/server/auth.ts, `writeUsersRow`), at
 * most five transactions in all, 10 ms before the second and doubled for each later one, with a
 * warning per retry that never holds the e-mail. The deadlock and the serialization failure are
 * real ones, forced by another transaction holding what the call's transaction needs; any other
 * error is let through at once, and an error that lasts through the five attempts is reported as
 * `TransactionRetryExhaustedError`.
 */

let database: TestDatabase;
let db: Db;
/** Every line the call logged, parsed. */
let logged: Record<string, unknown>[] = [];
let logger: Logger;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url, { max: 6 });
  logger = pino(
    { level: "debug", base: undefined },
    {
      write: (line: string): void => {
        logged.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  );
});

afterAll(async () => {
  await db?.end({ timeout: 5 });
  await database?.drop();
});

afterEach(() => {
  logged = [];
});

type Answer = { privyUserId: string; walletAddress: string };

function answering(answer: Answer): IdentityDirectory {
  return { findOrCreateWalletByEmail: (): Promise<Answer> => Promise.resolve({ ...answer }) };
}

function wallet(n: number): string {
  return `0x${n.toString(16).padStart(40, "0")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface UserRow {
  email: string;
  privy_id: string | null;
  wallet: string | null;
  roles: string[];
}

async function rowsOf(email: string): Promise<UserRow[]> {
  return db<UserRow[]>`select email, privy_id, wallet, roles from users where email = ${email}`;
}

function retryWarnings(): Record<string, unknown>[] {
  return logged.filter((entry) => entry.level === 40);
}

/**
 * Waits until a backend of this database waits for a row or transaction lock in an insert into
 * `users`: the call's upsert, blocked behind the test's transaction.
 */
async function upsertBlocked(): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const [row] = await db<{ n: bigint }[]>`
      select count(*)::bigint as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'
        and wait_event in ('transactionid', 'tuple') and query ilike '%insert into users%'
    `;
    if (row?.n === 1n) return;
    if (Date.now() > deadline) throw new Error("the call's upsert never waited for the lock");
    await sleep(5);
  }
}

/** Resolves with the call's rejection, or fails the test if it succeeded. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected a rejection");
}

class InjectedDbError extends Error {
  constructor(readonly code: string) {
    super(`injected database error ${code}`);
    this.name = "InjectedDbError";
  }
}

/**
 * `inner`, whose transactions are counted, the first `failures` of them run for real and then
 * failing with `code` (Postgres rolls them back, as it does a transaction that hit a deadlock).
 */
function failingTransactions(
  inner: Db,
  failures: number,
  code: string,
): { db: Db; begins: () => number; injected: InjectedDbError[] } {
  let begins = 0;
  const injected: InjectedDbError[] = [];
  const begin = (work: (tx: TransactionSql) => Promise<unknown>): Promise<unknown> => {
    begins += 1;
    if (begins > failures) return inner.begin(work);
    return inner.begin(async (tx: TransactionSql): Promise<unknown> => {
      await work(tx);
      const error = new InjectedDbError(code);
      injected.push(error);
      throw error;
    });
  };
  const wrapped = new Proxy(inner, {
    get(target: Db, property: string | symbol, receiver: unknown): unknown {
      if (property === "begin") return begin;
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  return { db: wrapped, begins: () => begins, injected };
}

describe("resolveUserWallet retries a deadlock or a serialization failure", () => {
  it("a real deadlock with a writer that locks in the other order: retried, one row, the directory's wallet", async () => {
    const email = "deadlock@example.com";
    const answer = { privyUserId: "did:privy:deadlock", walletAddress: wallet(1) };
    let inserted!: () => void;
    const rowInserted = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    let blocked!: () => void;
    const callBlocked = new Promise<void>((resolve) => {
      blocked = resolve;
    });
    // The other writer takes the row first (its insert, not committed), then the e-mail's lock:
    // the opposite order of the call, which takes the lock, then the row. Its own deadlock check
    // is put off, so the call, which waits first, is the transaction Postgres cancels.
    const other = db.begin(async (tx): Promise<void> => {
      await tx`set local deadlock_timeout = '30s'`;
      await tx`insert into users (email, roles) values (${email}, '{merchant}')`;
      inserted();
      await callBlocked;
      await tx`select pg_advisory_xact_lock(hashtextextended(${usersLockKey(email)}, 0))`;
    });
    await rowInserted;
    const call = resolveUserWallet(db, answering(answer), email, "fan", { logger });
    await upsertBlocked();
    blocked();
    const [, resolved] = await Promise.all([other, call]);

    expect(resolved).toMatchObject({ email, walletAddress: answer.walletAddress });
    expect(await rowsOf(email)).toEqual([
      {
        email,
        privy_id: answer.privyUserId,
        wallet: answer.walletAddress,
        roles: ["merchant", "fan"],
      },
    ]);
    expect(retryWarnings().map((entry) => ({ code: entry.code, attempt: entry.attempt }))).toEqual([
      { code: "40P01", attempt: 1 },
    ]);
    expect(JSON.stringify(logged)).not.toContain(email);
  });

  it("a real serialization failure under repeatable read: retried, one row, the directory's wallet", async () => {
    const email = "serialization@example.com";
    const answer = { privyUserId: "did:privy:serialization", walletAddress: wallet(2) };
    await db`insert into users (email, roles) values (${email}, '{merchant}')`;
    // A client whose transactions are repeatable read: an upsert of a row that a transaction
    // committed after its snapshot fails with 40001 instead of waiting and going on.
    const repeatable = postgres(database.url, {
      max: 2,
      prepare: false,
      types: { bigint: postgres.BigInt },
      onnotice: () => undefined,
      connection: { default_transaction_isolation: "repeatable read" },
    });
    try {
      let locked!: () => void;
      const rowLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });
      let blocked!: () => void;
      const callBlocked = new Promise<void>((resolve) => {
        blocked = resolve;
      });
      // The other writer updates the row (not committed); the call's snapshot is taken before
      // that update commits, and its upsert waits for the row.
      const other = db.begin(async (tx): Promise<void> => {
        await tx`update users set roles = array['merchant']::text[] where email = ${email}`;
        locked();
        await callBlocked;
      });
      await rowLocked;
      const call = resolveUserWallet(repeatable, answering(answer), email, "fan", { logger });
      await upsertBlocked();
      blocked();
      const [, resolved] = await Promise.all([other, call]);

      expect(resolved).toMatchObject({ email, walletAddress: answer.walletAddress });
      expect(await rowsOf(email)).toEqual([
        {
          email,
          privy_id: answer.privyUserId,
          wallet: answer.walletAddress,
          roles: ["merchant", "fan"],
        },
      ]);
      expect(
        retryWarnings().map((entry) => ({ code: entry.code, attempt: entry.attempt })),
      ).toEqual([{ code: "40001", attempt: 1 }]);
      expect(JSON.stringify(logged)).not.toContain(email);
    } finally {
      await repeatable.end({ timeout: 5 });
    }
  });

  it("another error is not retried: a lock timeout (55P03) is let through after one transaction", async () => {
    const email = "lock-timeout@example.com";
    const impatient = postgres(database.url, {
      max: 2,
      prepare: false,
      types: { bigint: postgres.BigInt },
      onnotice: () => undefined,
      // Milliseconds.
      connection: { lock_timeout: 100 },
    });
    try {
      const counting = failingTransactions(impatient, 0, "40P01");
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let held!: () => void;
      const lockHeld = new Promise<void>((resolve) => {
        held = resolve;
      });
      const holder = db.begin(async (tx): Promise<void> => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${usersLockKey(email)}, 0))`;
        held();
        await released;
      });
      await lockHeld;
      const error = await rejection(
        resolveUserWallet(
          counting.db,
          answering({ privyUserId: "did:privy:lock-timeout", walletAddress: wallet(3) }),
          email,
          "fan",
          { logger },
        ),
      );
      release();
      await holder;
      expect(error).toMatchObject({ code: "55P03" });
      expect(error).not.toBeInstanceOf(TransactionRetryExhaustedError);
      expect(counting.begins()).toBe(1);
      expect(retryWarnings()).toEqual([]);
      expect(await rowsOf(email)).toEqual([]);
    } finally {
      await impatient.end({ timeout: 5 });
    }
  });

  it("a unique violation is not retried either: one transaction, then the re-read", async () => {
    await db`
      insert into users (email, privy_id, wallet, roles)
      values ('holder-u@example.com', 'did:privy:holder-u', ${wallet(4)}, '{merchant}')
    `;
    const counting = failingTransactions(db, 0, "40P01");
    const error = await rejection(
      resolveUserWallet(
        counting.db,
        answering({ privyUserId: "did:privy:holder-u", walletAddress: wallet(5) }),
        "newcomer-u@example.com",
        "fan",
        { logger },
      ),
    );
    expect(error).toMatchObject({ name: "IdentityConflictError" });
    expect(counting.begins()).toBe(1);
    expect(retryWarnings()).toEqual([]);
  });

  it.each(["40P01", "40001"])(
    "%s on every attempt: five transactions, 10/20/40/80 ms apart, then the named error, nothing written",
    async (code) => {
      const email = `exhausted-${code.toLowerCase()}@example.com`;
      // A sixth failure is queued: a retry without a bound would get past it and succeed.
      const failing = failingTransactions(db, 6, code);
      const started = Date.now();
      const error = await rejection(
        resolveUserWallet(
          failing.db,
          answering({ privyUserId: `did:privy:${email}`, walletAddress: wallet(6) }),
          email,
          "fan",
          { logger },
        ),
      );
      const elapsed = Date.now() - started;
      expect(error).toBeInstanceOf(TransactionRetryExhaustedError);
      expect(error).toMatchObject({ attempts: 5, code, cause: failing.injected[4] });
      expect((error as Error).message).not.toContain(email);
      expect(failing.begins()).toBe(5);
      expect(elapsed).toBeGreaterThanOrEqual(10 + 20 + 40 + 80);
      expect(
        retryWarnings().map((entry) => ({ code: entry.code, attempt: entry.attempt })),
      ).toEqual([1, 2, 3, 4].map((attempt) => ({ code, attempt })));
      expect(JSON.stringify(logged)).not.toContain(email);
      expect(await rowsOf(email)).toEqual([]);
    },
  );

  it("fails four times, then succeeds on the fifth transaction", async () => {
    const email = "fifth@example.com";
    const failing = failingTransactions(db, 4, "40P01");
    const resolved = await resolveUserWallet(
      failing.db,
      answering({ privyUserId: "did:privy:fifth", walletAddress: wallet(7) }),
      email,
      "fan",
      { logger },
    );
    expect(failing.begins()).toBe(5);
    expect(resolved.walletAddress).toBe(wallet(7));
    expect(await rowsOf(email)).toEqual([
      { email, privy_id: "did:privy:fifth", wallet: wallet(7), roles: ["fan"] },
    ]);
    expect(retryWarnings()).toHaveLength(4);
  });
});
