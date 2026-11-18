/**
 * SPEC ID-1, the web side: a person's first sign-in (the web app writes their users row) racing
 * their first purchase (the engine writes the same row, `resolveUserWallet`), two sign-ins at once
 * (two tabs), and a sign-in racing a purchase that fills a row without a wallet. Real Postgres with
 * every migration applied; the identity provider is a fake that holds every lookup of a round
 * until all of them have asked it, then answers them together after a short delay, so the writes
 * that follow really overlap.
 */
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { UserRole } from "@winz/shared";

import type { IdentityDirectory as EngineDirectory } from "../../../engine/src/identity/directory";
import { gateAfterFailedWrite } from "../../../engine/src/identity/race-support.test-support";
import {
  resolveUserWallet,
  usersLockKey as engineUsersLockKey,
  type ResolvedUser,
} from "../../../engine/src/identity/users";
import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import {
  findOrCreateUser,
  lockUsersEmail,
  normalizeEmail,
  usersLockKey,
  type DirectoryUser,
  type IdentityDirectory,
  type UserPrincipal,
} from "./auth";
import { createWebDb, type Db } from "./db";
import { ApiRouteError } from "./route";
import { randomWallet } from "./testing/fixtures";

/** What the code under test logged: the retries of a users write are logged at warn. */
const logged = vi.hoisted(() => [] as { level: string; fields: unknown; message: unknown }[]);
vi.mock("./logger", () => {
  const record =
    (level: string) =>
    (fields: unknown, message?: unknown): void => {
      logged.push({ level, fields, message });
    };
  const logger = {
    trace: record("trace"),
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    fatal: record("fatal"),
    child: (): unknown => logger,
  };
  return { serverLogger: (): unknown => logger };
});

/** Longest a lookup waits for the rest of its round before answering anyway. */
const GATE_TIMEOUT_MS = 2_000;
/** The short delay every answer takes once the round is complete, plus up to `JITTER_MS`. */
const ANSWER_DELAY_MS = 5;
const JITTER_MS = 3;

let database: TestDatabase;
/** A client with enough connections for every call of a round to run at once. */
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createWebDb(database.url, { max: 10 });
});

beforeEach(() => {
  logged.length = 0;
});

afterAll(async () => {
  await db?.end({ timeout: 5 });
  await database?.drop();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Holds each caller until `round` callers have arrived (or the timeout), then lets them all go
 * after a short delay. The timeout's timer is cleared as soon as the gate opens.
 */
class Gate {
  private waiting: (() => void)[] = [];

  constructor(private readonly round: number) {}

  async pass(): Promise<void> {
    const gate = new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
    if (this.waiting.length >= this.round) {
      const released = this.waiting;
      this.waiting = [];
      for (const release of released) release();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, GATE_TIMEOUT_MS);
    });
    try {
      await Promise.race([gate, timeout]);
    } finally {
      clearTimeout(timer);
    }
    await sleep(ANSWER_DELAY_MS + Math.floor(Math.random() * (JITTER_MS + 1)));
  }
}

/**
 * The identity provider as both sides see it: the web app's directory (`getUser`) and the
 * engine's (`findOrCreateWalletByEmail`), over one set of users, behind one gate.
 */
class RaceIdentity implements IdentityDirectory, EngineDirectory {
  private readonly users = new Map<string, DirectoryUser>();
  private readonly gate: Gate;

  constructor(round: number) {
    this.gate = new Gate(round);
  }

  add(privyUserId: string, email: string, walletAddress: string | null): void {
    this.users.set(privyUserId, { email, walletAddress });
  }

  async getUser(privyUserId: string): Promise<DirectoryUser> {
    await this.gate.pass();
    const user = this.users.get(privyUserId);
    if (!user) throw new Error(`unknown privy user ${privyUserId}`);
    return { ...user };
  }

  async findOrCreateWalletByEmail(
    email: string,
  ): Promise<{ privyUserId: string; walletAddress: string }> {
    await this.gate.pass();
    const address = normalizeEmail(email);
    for (const [privyUserId, user] of this.users) {
      if (user.email !== null && normalizeEmail(user.email) === address) {
        user.walletAddress ??= randomWallet();
        return { privyUserId, walletAddress: user.walletAddress };
      }
    }
    const privyUserId = `did:privy:${address}`;
    const walletAddress = randomWallet();
    this.users.set(privyUserId, { email: address, walletAddress });
    return { privyUserId, walletAddress };
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

/** The failures of settled calls, as text, so an assertion on them shows what went wrong. */
function failuresOf(results: PromiseSettledResult<unknown>[]): string[] {
  return results.flatMap((result) => {
    if (result.status === "fulfilled") return [];
    const reason: unknown = result.reason;
    const code =
      typeof reason === "object" && reason !== null && "code" in reason
        ? ` [${String(reason.code)}]`
        : "";
    return [`${String(reason)}${code}`];
  });
}

function fulfilled<T>(result: PromiseSettledResult<T> | undefined): T {
  if (result?.status !== "fulfilled") throw new Error("expected a fulfilled call");
  return result.value;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected a rejection, the call succeeded");
}

/** Whether a call has settled, read synchronously. */
function track(promise: Promise<unknown>): () => boolean {
  let settled = false;
  const done = (): void => {
    settled = true;
  };
  void promise.then(done, done);
  return () => settled;
}

/**
 * The one backend of this database waiting for an advisory lock, once there is one. Read from a
 * connection outside any transaction: within a transaction, pg_stat_activity is a snapshot taken
 * at its first read.
 */
async function advisoryWaiter(): Promise<number> {
  const deadline = Date.now() + GATE_TIMEOUT_MS;
  for (;;) {
    const waiting = await db<{ pid: number }[]>`
      select pid from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'
    `;
    if (waiting.length === 1 && waiting[0]) return waiting[0].pid;
    if (waiting.length > 1) throw new Error(`${waiting.length} backends wait for a lock, not one`);
    if (Date.now() > deadline) throw new Error("no call ever waited for the e-mail's lock");
    await sleep(5);
  }
}

/** The locks a backend holds on the users table: any write to it takes one. */
async function usersTableLocksOf(pid: number): Promise<string[]> {
  const rows = await db<{ mode: string }[]>`
    select l.mode from pg_locks l join pg_class c on c.oid = l.relation
    where l.pid = ${pid} and c.relname = 'users' and l.granted
  `;
  return rows.map((row) => row.mode);
}

class RetryableTestError extends Error {
  constructor(readonly code: string) {
    super(`injected database error ${code}`);
    this.name = "RetryableTestError";
  }
}

interface FailingTransactions {
  db: Db;
  /** How many transactions were begun through `db`. */
  begins: () => number;
  /** The errors injected so far, in order. */
  injected: RetryableTestError[];
}

/**
 * `db`, whose first `failures` transactions run their work for real and then fail with `code` (so
 * Postgres rolls them back, as it does a transaction that hit a deadlock); the later ones run as
 * they are.
 */
function failFirstTransactions(failures: number, code: string): FailingTransactions {
  let begins = 0;
  const injected: RetryableTestError[] = [];
  const begin = (work: (tx: TransactionSql) => Promise<unknown>): Promise<unknown> => {
    begins += 1;
    if (begins > failures) return db.begin(work);
    return db.begin(async (tx: TransactionSql): Promise<unknown> => {
      await work(tx);
      const error = new RetryableTestError(code);
      injected.push(error);
      throw error;
    });
  };
  const wrapped = new Proxy(db, {
    get(target: Db, property: string | symbol, receiver: unknown): unknown {
      if (property === "begin") return begin;
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  return { db: wrapped, begins: () => begins, injected };
}

function warnings(): { level: string; fields: unknown; message: unknown }[] {
  return logged.filter((entry) => entry.level === "warn");
}

describe("the lock of one e-mail's users row", () => {
  const spellings = [
    "maya@example.com",
    "Maya@Example.com",
    "  MAYA@EXAMPLE.COM ",
    "\tmaya@example.COM\n",
  ];

  it("is computed the same way by the web sign-in and the engine, whatever the spelling", async () => {
    for (const spelling of spellings) {
      expect(usersLockKey(spelling)).toBe(engineUsersLockKey(spelling));
      expect(usersLockKey(spelling)).toBe(usersLockKey("maya@example.com"));
    }
    expect(usersLockKey("maya@example.com")).toBe("winz:users:maya@example.com");
    expect(usersLockKey("joe@example.com")).not.toBe(usersLockKey("maya@example.com"));
    // And Postgres hashes the two sides' keys to one lock.
    const keys = spellings.flatMap((spelling) => [
      usersLockKey(spelling),
      engineUsersLockKey(spelling),
    ]);
    const hashes = await db<{ lock: bigint }[]>`
      select hashtextextended(key, 0) as lock from unnest(${keys}::text[]) as key
    `;
    expect(new Set(hashes.map((row) => row.lock)).size).toBe(1);
  });

  it("held by the web side, makes the engine's write of the same e-mail wait for it", async () => {
    const identity = new RaceIdentity(1);
    let engine: Promise<ResolvedUser> | undefined;
    let settled = false;
    await db.begin(async (tx): Promise<void> => {
      await lockUsersEmail(tx, "  Locked@Example.COM ");
      engine = resolveUserWallet(db, identity, "locked@example.com", "fan");
      void engine.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      // Wait until the engine's transaction is blocked on an advisory lock. Read from another
      // connection: within a transaction, pg_stat_activity is a snapshot taken at its first read.
      const deadline = Date.now() + GATE_TIMEOUT_MS;
      for (;;) {
        const [waiting] = await db<{ n: bigint }[]>`
          select count(*)::bigint as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
            and wait_event = 'advisory'
        `;
        if (waiting?.n === 1n) break;
        if (Date.now() > deadline) throw new Error("the engine never waited for the lock");
        await sleep(5);
      }
      expect(settled).toBe(false);
      expect(await rowsOf("locked@example.com")).toEqual([]);
    });
    const resolved = await engine;
    expect(resolved?.email).toBe("locked@example.com");
    expect(await rowsOf("locked@example.com")).toHaveLength(1);
  });
});

describe("findOrCreateUser takes the e-mail's lock before it writes", () => {
  // The engine holds the lock (it is creating the row at the person's first purchase): the
  // sign-in must wait for it, on each of its two write paths, before it touches the row.

  it("a first sign-in (the upsert) waits for the lock of its e-mail, however it is spelled", async () => {
    const wallet = randomWallet();
    const identity = new RaceIdentity(1);
    identity.add("did:privy:waits-new", "  Waits-New@Example.COM ", wallet);
    let call: Promise<UserPrincipal> | undefined;
    await db.begin(async (tx): Promise<void> => {
      await lockUsersEmail(tx, "WAITS-new@example.com\t");
      call = findOrCreateUser(db, identity, "did:privy:waits-new");
      const settled = track(call);
      const pid = await advisoryWaiter();
      expect(settled()).toBe(false);
      expect(await usersTableLocksOf(pid)).toEqual([]);
      expect(await rowsOf("waits-new@example.com")).toEqual([]);
    });
    const principal = await call;
    expect(principal?.walletAddress).toBe(wallet);
    expect(await rowsOf("waits-new@example.com")).toEqual([
      {
        id: principal?.userId,
        email: "waits-new@example.com",
        privy_id: "did:privy:waits-new",
        wallet,
        roles: [],
      },
    ]);
  });

  it("a sign-in that fills a row without a wallet waits for the lock of that row's e-mail", async () => {
    const wallet = randomWallet();
    const [seeded] = await db<{ id: string }[]>`
      insert into users (email, privy_id, roles)
      values ('waits-fill@example.com', 'did:privy:waits-fill', '{merchant}')
      returning id
    `;
    const identity = new RaceIdentity(1);
    identity.add("did:privy:waits-fill", "waits-fill@example.com", wallet);
    let call: Promise<UserPrincipal> | undefined;
    await db.begin(async (tx): Promise<void> => {
      await lockUsersEmail(tx, " Waits-Fill@EXAMPLE.com");
      call = findOrCreateUser(db, identity, "did:privy:waits-fill");
      const settled = track(call);
      const pid = await advisoryWaiter();
      expect(settled()).toBe(false);
      expect(await usersTableLocksOf(pid)).toEqual([]);
      expect((await rowsOf("waits-fill@example.com"))[0]?.wallet).toBeNull();
    });
    const principal = await call;
    expect(principal?.userId).toBe(seeded?.id);
    expect(principal?.walletAddress).toBe(wallet);
    expect((await rowsOf("waits-fill@example.com"))[0]?.wallet).toBe(wallet);
  });
});

describe("findOrCreateUser on a deadlock or a serialization failure", () => {
  it.each(["40P01", "40001"])(
    "%s four times in a row: the fifth transaction succeeds, each retry logged without the e-mail",
    async (code) => {
      const email = `retry-${code.toLowerCase()}@example.com`;
      const privyUserId = `did:privy:retry-${code.toLowerCase()}`;
      const wallet = randomWallet();
      const failing = failFirstTransactions(4, code);
      const identity = new RaceIdentity(1);
      identity.add(privyUserId, email, wallet);
      const principal = await findOrCreateUser(failing.db, identity, privyUserId);
      expect(failing.begins()).toBe(5);
      expect(failing.injected).toHaveLength(4);
      expect(principal.walletAddress).toBe(wallet);
      expect(await rowsOf(email)).toEqual([
        { id: principal.userId, email, privy_id: privyUserId, wallet, roles: [] },
      ]);
      expect(warnings().map((entry) => entry.fields)).toEqual(
        [1, 2, 3, 4].map((attempt) => ({
          code,
          attempt,
          of: 5,
        })),
      );
      expect(JSON.stringify(logged)).not.toContain(email);
    },
  );

  it("on every attempt: gives up after five transactions with the last error, and writes nothing", async () => {
    // A sixth failure is queued: a retry without a bound would get past it and succeed.
    const failing = failFirstTransactions(6, "40P01");
    const identity = new RaceIdentity(1);
    identity.add("did:privy:retry-give-up", "retry-give-up@example.com", randomWallet());
    const error = await rejection(
      findOrCreateUser(failing.db, identity, "did:privy:retry-give-up"),
    );
    expect(failing.begins()).toBe(5);
    expect(error).toBe(failing.injected[4]);
    expect(warnings()).toHaveLength(4);
    expect(await rowsOf("retry-give-up@example.com")).toEqual([]);
  });

  it("while filling a row without a wallet: retried as well", async () => {
    const wallet = randomWallet();
    const [seeded] = await db<{ id: string }[]>`
      insert into users (email, privy_id, roles)
      values ('retry-fill@example.com', 'did:privy:retry-fill', '{merchant}')
      returning id
    `;
    const failing = failFirstTransactions(1, "40P01");
    const identity = new RaceIdentity(1);
    identity.add("did:privy:retry-fill", "retry-fill@example.com", wallet);
    const principal = await findOrCreateUser(failing.db, identity, "did:privy:retry-fill");
    expect(failing.begins()).toBe(2);
    expect(principal.userId).toBe(seeded?.id);
    expect(principal.walletAddress).toBe(wallet);
    expect((await rowsOf("retry-fill@example.com"))[0]?.wallet).toBe(wallet);
  });

  it("any other error is not retried: a unique violation is let through after one transaction", async () => {
    const failing = failFirstTransactions(1, "23505");
    const identity = new RaceIdentity(1);
    identity.add("did:privy:no-retry-u", "no-retry-u@example.com", randomWallet());
    const error = await rejection(findOrCreateUser(failing.db, identity, "did:privy:no-retry-u"));
    expect(failing.begins()).toBe(1);
    expect(error).toBe(failing.injected[0]);
    expect(warnings()).toEqual([]);
    expect(await rowsOf("no-retry-u@example.com")).toEqual([]);
  });

  it("any other error is not retried: the 409 of an e-mail held by another account, after one transaction", async () => {
    await db`
      insert into users (email, privy_id, roles)
      values ('no-retry-c@example.com', 'did:privy:no-retry-owner', '{merchant}')
    `;
    const counting = failFirstTransactions(0, "40P01");
    const identity = new RaceIdentity(1);
    identity.add("did:privy:no-retry-c", "no-retry-c@example.com", randomWallet());
    const error = await rejection(findOrCreateUser(counting.db, identity, "did:privy:no-retry-c"));
    expect(error).toBeInstanceOf(ApiRouteError);
    expect(error).toMatchObject({ status: 409, code: "conflict" });
    expect(counting.begins()).toBe(1);
    expect(warnings()).toEqual([]);
  });
});

describe("findOrCreateUser racing the engine's resolveUserWallet", () => {
  it("a first sign-in and a first purchase of one new e-mail at once: both succeed, one row", async () => {
    for (let round = 0; round < 120; round += 1) {
      const email = `first-${round}@example.com`;
      const privyUserId = `did:privy:first-${round}`;
      const wallet = randomWallet();
      // Every other round, a second purchase as a merchant joins the race.
      const roles: UserRole[] = round % 2 === 0 ? ["fan"] : ["fan", "merchant"];
      const identity = new RaceIdentity(1 + roles.length);
      // The person signed up with the provider (OTP), which created their wallet; the e-mail is
      // spelled differently on each side.
      identity.add(privyUserId, round % 3 === 0 ? `  First-${round}@Example.COM` : email, wallet);

      const [web, ...engine] = await Promise.allSettled([
        findOrCreateUser(db, identity, privyUserId),
        ...roles.map((role) => resolveUserWallet(db, identity, ` ${email.toUpperCase()}  `, role)),
      ]);
      expect(failuresOf([web, ...engine])).toEqual([]);

      const principal: UserPrincipal = fulfilled(web);
      expect(principal.privyUserId).toBe(privyUserId);
      expect(principal.email).toBe(email);
      expect(principal.walletAddress).toBe(wallet);
      for (const result of engine) {
        const resolved = fulfilled(result);
        expect(resolved.userId).toBe(principal.userId);
        expect(resolved.walletAddress).toBe(wallet);
        expect(resolved.privyUserId).toBe(privyUserId);
      }
      const rows = await rowsOf(email);
      expect(rows.map((row) => ({ ...row, roles: [...row.roles].sort() }))).toEqual([
        { id: principal.userId, email, privy_id: privyUserId, wallet, roles },
      ]);
    }
  });

  it("two first sign-ins of one new person at once (two tabs): both succeed, one row", async () => {
    for (let round = 0; round < 60; round += 1) {
      const email = `tabs-${round}@example.com`;
      const privyUserId = `did:privy:tabs-${round}`;
      const wallet = randomWallet();
      const identity = new RaceIdentity(2);
      identity.add(privyUserId, email, wallet);

      const results = await Promise.allSettled([
        findOrCreateUser(db, identity, privyUserId),
        findOrCreateUser(db, identity, privyUserId),
      ]);
      expect(failuresOf(results)).toEqual([]);
      const [first, second] = results.map(fulfilled);
      expect(second).toEqual(first);
      expect(first?.walletAddress).toBe(wallet);
      expect(await rowsOf(email)).toEqual([
        { id: first?.userId, email, privy_id: privyUserId, wallet, roles: [] },
      ]);
    }
  });

  it("a sign-in while the row has no wallet, racing a purchase that fills it", async () => {
    for (let round = 0; round < 60; round += 1) {
      const email = `nowallet-${round}@example.com`;
      const privyUserId = `did:privy:nowallet-${round}`;
      const wallet = randomWallet();
      // Half the rows already know the Privy user (a merchant who signed in before the provider
      // created their wallet), half do not (a row written before any sign-in).
      const knowsPrivy = round % 2 === 0;
      const [seeded] = await db<{ id: string }[]>`
        insert into users (email, privy_id, roles)
        values (${email}, ${knowsPrivy ? privyUserId : null}, '{merchant}')
        returning id
      `;
      const identity = new RaceIdentity(2);
      identity.add(privyUserId, email, wallet);

      const [web, engine] = await Promise.allSettled([
        findOrCreateUser(db, identity, privyUserId),
        resolveUserWallet(db, identity, email, "fan"),
      ]);
      expect(failuresOf([web, engine])).toEqual([]);
      expect(fulfilled(web).userId).toBe(seeded?.id);
      expect(fulfilled(web).walletAddress).toBe(wallet);
      expect(fulfilled(engine).userId).toBe(seeded?.id);
      expect(fulfilled(engine).walletAddress).toBe(wallet);
      expect(await rowsOf(email)).toEqual([
        { id: seeded?.id, email, privy_id: privyUserId, wallet, roles: ["merchant", "fan"] },
      ]);
    }
  });
});

describe("findOrCreateUser after a unique violation caused by a writer that does not lock", () => {
  // The sign-in's insert really fails on `users_wallet_key`, on a row that holds the person's
  // wallet under another e-mail; before the sign-in reads again, an unlocked writer gives this
  // e-mail's row the person's Privy user and a wallet (`gateAfterFailedWrite`, see its comment).

  it("the e-mail's row is now the person's own: accepted", async () => {
    const wallet = randomWallet();
    const [parked] = await db<{ id: string }[]>`
      insert into users (email, wallet, roles) values ('parked-web@example.com', ${wallet}, '{fan}')
      returning id
    `;
    let failures = 0;
    const gated = gateAfterFailedWrite(db, async (): Promise<void> => {
      failures += 1;
      await db`
        update users set email = 'reread-web@example.com', privy_id = 'did:privy:reread-web'
        where id = ${parked?.id ?? ""}
      `;
    });
    const identity = new RaceIdentity(1);
    identity.add("did:privy:reread-web", "Reread-Web@example.com", wallet);
    const principal = await findOrCreateUser(gated, identity, "did:privy:reread-web");
    expect(failures).toBe(1);
    expect(principal).toEqual({
      kind: "user",
      userId: parked?.id,
      privyUserId: "did:privy:reread-web",
      email: "reread-web@example.com",
      walletAddress: wallet,
      roles: ["fan"],
      merchantId: null,
    });
  });

  it("the e-mail's row now holds another Privy user: the unique violation, as before", async () => {
    const wallet = randomWallet();
    const [parked] = await db<{ id: string }[]>`
      insert into users (email, wallet) values ('parked-web-p@example.com', ${wallet})
      returning id
    `;
    const gated = gateAfterFailedWrite(db, async (): Promise<void> => {
      await db`
        update users set email = 'reread-web-p@example.com', privy_id = 'did:privy:someone-else'
        where id = ${parked?.id ?? ""}
      `;
    });
    const identity = new RaceIdentity(1);
    identity.add("did:privy:reread-web-p", "reread-web-p@example.com", wallet);
    const error = await rejection(findOrCreateUser(gated, identity, "did:privy:reread-web-p"));
    expect(error).toMatchObject({ code: "23505", constraint_name: "users_wallet_key" });
    expect((await rowsOf("reread-web-p@example.com"))[0]?.privy_id).toBe("did:privy:someone-else");
  });

  it("the e-mail's row now holds the person's Privy user but another wallet: the unique violation, as before", async () => {
    const wallet = randomWallet();
    const otherWallet = randomWallet();
    await db`insert into users (email, wallet) values ('parked-web-w@example.com', ${wallet})`;
    // The e-mail's row exists, without a Privy user or a wallet: the sign-in's upsert fills it.
    const [own] = await db<{ id: string }[]>`
      insert into users (email, roles) values ('reread-web-w@example.com', '{merchant}')
      returning id
    `;
    const gated = gateAfterFailedWrite(db, async (): Promise<void> => {
      await db`
        update users set privy_id = 'did:privy:reread-web-w', wallet = ${otherWallet}
        where id = ${own?.id ?? ""}
      `;
    });
    const identity = new RaceIdentity(1);
    identity.add("did:privy:reread-web-w", "reread-web-w@example.com", wallet);
    const error = await rejection(findOrCreateUser(gated, identity, "did:privy:reread-web-w"));
    expect(error).toMatchObject({ code: "23505", constraint_name: "users_wallet_key" });
  });
});

describe("findOrCreateUser still refuses a real conflict", () => {
  it("the person's wallet held by another e-mail's row: the database's unique violation", async () => {
    const wallet = randomWallet();
    await db`
      insert into users (email, privy_id, wallet, roles)
      values ('holder-w@example.com', 'did:privy:holder-w', ${wallet}, '{fan}')
    `;
    const identity = new RaceIdentity(1);
    identity.add("did:privy:newcomer-w", "newcomer-w@example.com", wallet);
    const error = await rejection(findOrCreateUser(db, identity, "did:privy:newcomer-w"));
    expect(error).not.toBeInstanceOf(ApiRouteError);
    expect(error).toMatchObject({ code: "23505", constraint_name: "users_wallet_key" });
    expect(await rowsOf("newcomer-w@example.com")).toEqual([]);
    expect((await rowsOf("holder-w@example.com"))[0]?.privy_id).toBe("did:privy:holder-w");
  });

  it("the person's new wallet held by another e-mail's row, on a row without one", async () => {
    const wallet = randomWallet();
    await db`
      insert into users (email, privy_id, wallet, roles)
      values ('holder-x@example.com', 'did:privy:holder-x', ${wallet}, '{fan}')
    `;
    await db`
      insert into users (email, privy_id, roles)
      values ('late-x@example.com', 'did:privy:late-x', '{merchant}')
    `;
    const identity = new RaceIdentity(1);
    identity.add("did:privy:late-x", "late-x@example.com", wallet);
    const error = await rejection(findOrCreateUser(db, identity, "did:privy:late-x"));
    expect(error).toMatchObject({ code: "23505", constraint_name: "users_wallet_key" });
    expect((await rowsOf("late-x@example.com"))[0]?.wallet).toBeNull();
  });

  it("the e-mail's row holding another Privy user: 409, and that row left as it was", async () => {
    await db`
      insert into users (email, privy_id, roles)
      values ('taken@example.com', 'did:privy:owner', '{merchant}')
    `;
    const identity = new RaceIdentity(1);
    identity.add("did:privy:intruder", "Taken@example.com", randomWallet());
    const error = await rejection(findOrCreateUser(db, identity, "did:privy:intruder"));
    expect(error).toBeInstanceOf(ApiRouteError);
    expect(error).toMatchObject({ status: 409, code: "conflict" });
    expect(await rowsOf("taken@example.com")).toEqual([
      {
        id: expect.any(String),
        email: "taken@example.com",
        privy_id: "did:privy:owner",
        wallet: null,
        roles: ["merchant"],
      },
    ]);
  });

  it("the Privy user already on another e-mail's row (the e-mail changed at the provider): that row, as before", async () => {
    const wallet = randomWallet();
    const [old] = await db<{ id: string }[]>`
      insert into users (email, privy_id, wallet, roles)
      values ('before@example.com', 'did:privy:moved', ${wallet}, '{fan}')
      returning id
    `;
    const identity = new RaceIdentity(1);
    identity.add("did:privy:moved", "after@example.com", wallet);
    const principal = await findOrCreateUser(db, identity, "did:privy:moved");
    expect(principal.userId).toBe(old?.id);
    expect(principal.email).toBe("before@example.com");
    expect(await rowsOf("after@example.com")).toEqual([]);
  });
});
