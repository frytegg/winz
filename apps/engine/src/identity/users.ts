import type { UserRole } from "@winz/shared";

import type { Db } from "../db";
import {
  IdentityConflictError,
  IdentityResponseError,
  InvalidEmailError,
  normalizeEmail,
  type IdentityDirectory,
} from "./directory";

const WALLET_PATTERN = /^0x[0-9a-f]{40}$/;
const UNIQUE_VIOLATION = "23505";
/** Namespace of the advisory lock that serialises the writes of one e-mail's users row. */
const USERS_LOCK_PREFIX = "winz:users:";

export interface ResolvedUser {
  userId: string;
  /** Normalised. Personal data: never logged. */
  email: string;
  privyUserId: string | null;
  /** Lowercase. */
  walletAddress: string;
  /** False when the users row already held the wallet and the directory was not asked. */
  fromDirectory: boolean;
}

interface UserRow {
  id: string;
  privy_id: string | null;
  wallet: string | null;
  roles: string[];
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as Record<string, unknown>).code === UNIQUE_VIOLATION
  );
}

/**
 * Adds `role` to the roles of a users row that lacks it. Safe under concurrency: the condition
 * is evaluated again on the locked row, so two calls never append the role twice.
 */
async function addRole(db: Db, row: UserRow, role: UserRole): Promise<void> {
  if (row.roles.includes(role)) return;
  await db`
    update users set roles = array_append(roles, ${role}::text)
    where id = ${row.id} and not (${role}::text = any(roles))
  `;
}

/**
 * The wallet of an e-mail (SPEC ID-1). The e-mail is normalised first. When the users row of
 * that e-mail already holds a wallet, it is the answer; otherwise the directory finds or creates
 * the user and their embedded wallet, and the row is written. Either way the row ends with
 * `role` among its roles: one row per e-mail, kept, never duplicated.
 *
 * Throws `InvalidEmailError` for an empty e-mail, `IdentityResponseError` when the directory
 * answers with an address that is not one, and `IdentityConflictError` when the table and the
 * directory disagree (the row holds another Privy user or wallet, or another e-mail's row holds
 * this one). Any other error is the directory's or the database's, unchanged.
 *
 * Safe under concurrent calls for one e-mail: when another call wrote the row first with the
 * directory's same user and wallet, every call resolves to that row.
 */
export async function resolveUserWallet(
  db: Db,
  directory: IdentityDirectory,
  rawEmail: string,
  role: UserRole,
): Promise<ResolvedUser> {
  const email = normalizeEmail(rawEmail);
  if (email === "") throw new InvalidEmailError();

  const [existing] = await db<UserRow[]>`
    select id, privy_id, wallet, roles from users where email = ${email}
  `;
  if (existing?.wallet) {
    await addRole(db, existing, role);
    return {
      userId: existing.id,
      email,
      privyUserId: existing.privy_id,
      walletAddress: existing.wallet,
      fromDirectory: false,
    };
  }

  const found = await directory.findOrCreateWalletByEmail(email);
  const wallet = found.walletAddress.toLowerCase();
  if (!WALLET_PATTERN.test(wallet)) {
    throw new IdentityResponseError("the directory answered with a malformed wallet address");
  }
  if (found.privyUserId.trim() === "") {
    throw new IdentityResponseError("the directory answered with an empty user id");
  }

  let row: UserRow | undefined;
  try {
    row = await db.begin(async (tx): Promise<UserRow | undefined> => {
      // Calls for one e-mail write one after the other: two concurrent inserts of the same new
      // row otherwise meet on the unique indexes in an order Postgres cannot settle, and one of
      // them fails (a unique violation on `privy_id` or `wallet`, or a deadlock).
      await tx`select pg_advisory_xact_lock(hashtextextended(${`${USERS_LOCK_PREFIX}${email}`}, 0))`;
      const [written] = await tx<UserRow[]>`
        insert into users (email, privy_id, wallet, roles)
        values (${email}, ${found.privyUserId}, ${wallet}, array[${role}::text])
        on conflict (email) do update
          set privy_id = coalesce(users.privy_id, excluded.privy_id),
              wallet = coalesce(users.wallet, excluded.wallet),
              roles = case
                when ${role}::text = any(users.roles) then users.roles
                else array_append(users.roles, ${role}::text)
              end
          -- A row that already names another Privy user or wallet is left untouched.
          where (users.privy_id is null or users.privy_id = excluded.privy_id)
            and (users.wallet is null or users.wallet = excluded.wallet)
        returning id, privy_id, wallet, roles
      `;
      return written;
    });
  } catch (error: unknown) {
    if (!isUniqueViolation(error)) throw error;
    // Another writer of the users table that does not take the lock above (the web app's
    // sign-in) may have written this e-mail's row a moment earlier, or filled it while it had no
    // wallet: the unique violation is then raised by the index on `privy_id` or `wallet`, not by
    // the arbiter on `email`, and the row that holds them is this e-mail's own. Postgres raises
    // it only once that other write has committed, so a fresh read sees it. Anything else is a
    // real conflict: the directory's user or wallet belongs to another e-mail.
    const [current] = await db<UserRow[]>`
      select id, privy_id, wallet, roles from users where email = ${email}
    `;
    if (current?.privy_id !== found.privyUserId || current.wallet !== wallet) {
      throw new IdentityConflictError(
        "the directory's user or wallet is already recorded for another e-mail",
      );
    }
    await addRole(db, current, role);
    row = current;
  }
  if (row === undefined || row.privy_id !== found.privyUserId || row.wallet !== wallet) {
    throw new IdentityConflictError(
      "the users row of this e-mail holds another Privy user or another wallet than the directory",
    );
  }
  return {
    userId: row.id,
    email,
    privyUserId: row.privy_id,
    walletAddress: wallet,
    fromDirectory: true,
  };
}
