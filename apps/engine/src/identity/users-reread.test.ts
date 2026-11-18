import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../db";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { IdentityConflictError, type IdentityDirectory } from "./directory";
import { gateAfterFailedWrite } from "./race-support.test-support";
import { resolveUserWallet } from "./users";

/**
 * SPEC ID-1: `resolveUserWallet` against a writer of the users table that does not take the
 * e-mail's advisory lock. When its insert fails on the unique index of `privy_id` or `wallet`, the
 * call reads the e-mail's row again, accepts it when it holds the directory's own user and wallet
 * (and adds its role), and refuses it otherwise. `gateAfterFailedWrite` reaches that branch every
 * time: the insert really fails on a row that holds the directory's user or wallet under another
 * e-mail, and before the call reads again, the test moves that row to this e-mail.
 */

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
});

afterAll(async () => {
  await database?.drop();
});

type Answer = { privyUserId: string; walletAddress: string };

function answering(answer: Answer, before?: () => Promise<void>): IdentityDirectory {
  return {
    async findOrCreateWalletByEmail(): Promise<Answer> {
      await before?.();
      return { ...answer };
    },
  };
}

function wallet(n: number): string {
  return `0x${n.toString(16).padStart(40, "0")}`;
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

/** A row of the users table, committed, under an e-mail of its own. Returns its id. */
async function parkedRow(email: string, privyId: string, walletAddress: string): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into users (email, privy_id, wallet, roles)
    values (${email}, ${privyId}, ${walletAddress}, '{merchant}')
    returning id
  `;
  if (!row) throw new Error("users insert returned no row");
  return row.id;
}

/** `db`, gated: after the insert fails, the parked row is moved to `email` before the re-read. */
function movingAfterFailure(rowId: string, email: string): { db: Db; failures: () => number } {
  let failures = 0;
  const gated = gateAfterFailedWrite(db, async (): Promise<void> => {
    failures += 1;
    // The writer that does not lock: a plain update, committed at once.
    await db`update users set email = ${email} where id = ${rowId}`;
  });
  return { db: gated, failures: () => failures };
}

describe("resolveUserWallet after a unique violation", () => {
  it("the e-mail's row, written meanwhile with the directory's user and wallet: accepted, role added", async () => {
    const id = await parkedRow("parked-ok@example.com", "did:privy:reread-ok", wallet(1));
    const gate = movingAfterFailure(id, "reread-ok@example.com");
    const resolved = await resolveUserWallet(
      gate.db,
      answering({ privyUserId: "did:privy:reread-ok", walletAddress: wallet(1) }),
      "Reread-OK@example.com",
      "fan",
    );
    // The insert failed and the call read the row again.
    expect(gate.failures()).toBe(1);
    expect(resolved).toEqual({
      userId: id,
      email: "reread-ok@example.com",
      privyUserId: "did:privy:reread-ok",
      walletAddress: wallet(1),
      fromDirectory: true,
    });
    expect(await rowsOf("reread-ok@example.com")).toEqual([
      {
        id,
        email: "reread-ok@example.com",
        privy_id: "did:privy:reread-ok",
        wallet: wallet(1),
        roles: ["merchant", "fan"],
      },
    ]);
  });

  it("the e-mail's row, written meanwhile with the directory's user but another wallet: refused, untouched", async () => {
    const id = await parkedRow("parked-w@example.com", "did:privy:reread-w", wallet(2));
    const gate = movingAfterFailure(id, "reread-w@example.com");
    await expect(
      resolveUserWallet(
        gate.db,
        answering({ privyUserId: "did:privy:reread-w", walletAddress: wallet(3) }),
        "reread-w@example.com",
        "fan",
      ),
    ).rejects.toBeInstanceOf(IdentityConflictError);
    expect(gate.failures()).toBe(1);
    expect(await rowsOf("reread-w@example.com")).toEqual([
      {
        id,
        email: "reread-w@example.com",
        privy_id: "did:privy:reread-w",
        wallet: wallet(2),
        roles: ["merchant"],
      },
    ]);
  });

  it("the e-mail's row, written meanwhile with the directory's wallet but another user: refused, untouched", async () => {
    const id = await parkedRow("parked-p@example.com", "did:privy:someone-else", wallet(4));
    const gate = movingAfterFailure(id, "reread-p@example.com");
    await expect(
      resolveUserWallet(
        gate.db,
        answering({ privyUserId: "did:privy:reread-p", walletAddress: wallet(4) }),
        "reread-p@example.com",
        "fan",
      ),
    ).rejects.toBeInstanceOf(IdentityConflictError);
    expect(gate.failures()).toBe(1);
    expect(await rowsOf("reread-p@example.com")).toEqual([
      {
        id,
        email: "reread-p@example.com",
        privy_id: "did:privy:someone-else",
        wallet: wallet(4),
        roles: ["merchant"],
      },
    ]);
  });

  it("no row moved in: the directory's user held by another e-mail is still refused", async () => {
    await parkedRow("holder-r@example.com", "did:privy:holder-r", wallet(5));
    const gated = gateAfterFailedWrite(db, () => Promise.resolve());
    await expect(
      resolveUserWallet(
        gated,
        answering({ privyUserId: "did:privy:holder-r", walletAddress: wallet(6) }),
        "newcomer-r@example.com",
        "fan",
      ),
    ).rejects.toBeInstanceOf(IdentityConflictError);
    expect(await rowsOf("newcomer-r@example.com")).toEqual([]);
  });
});

describe("resolveUserWallet after a row written the way the web sign-in used to", () => {
  it("written between the directory's answer and the insert: that row, its role added", async () => {
    const email = "old-web@example.com";
    const answer = { privyUserId: "did:privy:old-web", walletAddress: wallet(7) };
    // The sign-in's former upsert, without the lock, committed while the directory answers.
    const directory = answering(answer, async (): Promise<void> => {
      await db`
        insert into users (email, privy_id, wallet)
        values (${email}, ${answer.privyUserId}, ${answer.walletAddress})
        on conflict (email) do update set
          privy_id = coalesce(users.privy_id, excluded.privy_id),
          wallet = coalesce(users.wallet, excluded.wallet)
      `;
    });
    const resolved = await resolveUserWallet(db, directory, email, "fan");
    const rows = await rowsOf(email);
    expect(rows).toEqual([
      {
        id: resolved.userId,
        email,
        privy_id: answer.privyUserId,
        wallet: answer.walletAddress,
        roles: ["fan"],
      },
    ]);
    expect(resolved.walletAddress).toBe(answer.walletAddress);
  });
});
