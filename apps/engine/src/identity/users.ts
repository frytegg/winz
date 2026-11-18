import type { Logger } from "pino";

import type { UserRole } from "@winz/shared";

import type { Db } from "../db";
import { createLogger, moduleLogger } from "../logger";
import {
  IdentityConflictError,
  IdentityResponseError,
  InvalidEmailError,
  normalizeEmail,
  type IdentityDirectory,
} from "./directory";
import { retryTransaction } from "./transaction-retry";

const WALLET_PATTERN = /^0x[0-9a-f]{40}$/;
const UNIQUE_VIOLATION = "23505";
/** Namespace of the advisory lock that serialises the writes of one e-mail's users row. */
const USERS_LOCK_PREFIX = "winz:users:";

/**
 * The text whose `hashtextextended(…, 0)` is the advisory lock of one e-mail's users row: the
 * namespace, then the normalised e-mail. The web sign-in (apps/web/lib/server/auth.ts,
 * `usersLockKey`) takes the same lock; packages/shared is frozen, so this recipe is written on
 * both sides, and apps/web/lib/server/auth-race.test.ts checks that the two agree. Change both or
 * neither.
 */
export function usersLockKey(email: string): string {
  return `${USERS_LOCK_PREFIX}${normalizeEmail(email)}`;
}

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

export interface ResolveUserWalletOptions {
  /**
   * Receives a warning for each retry of the users write. Default: an `info` JSON logger of the
   * `identity.users` module.
   */
  logger?: Logger;
}

let defaultLogger: Logger | undefined;

function usersLogger(options: ResolveUserWalletOptions): Logger {
  if (options.logger !== undefined) return options.logger;
  defaultLogger ??= moduleLogger(createLogger({ level: "info", pretty: false }), "identity.users");
  return defaultLogger;
}

/** Name of the users write in the retry's logs and error: never the e-mail. */
const USERS_WRITE = "users write";

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
 * is evaluated again on the locked row, so two calls never append the role twice, and safe to run
 * again after a deadlock or a serialization failure.
 */
async function addRole(db: Db, row: UserRow, role: UserRole, log: Logger): Promise<void> {
  if (row.roles.includes(role)) return;
  await retryTransaction(
    async () => {
      await db`
        update users set roles = array_append(roles, ${role}::text)
        where id = ${row.id} and not (${role}::text = any(roles))
      `;
    },
    { what: USERS_WRITE, logger: log },
  );
}

/**
 * One attempt of the users write of a new wallet: the e-mail's row inserted, or filled where it
 * lacks the user or the wallet, in a transaction that holds the e-mail's advisory lock. Returns
 * the row, or undefined when it already names another Privy user or wallet (left untouched).
 */
async function upsertUsersRow(
  db: Db,
  email: string,
  privyUserId: string,
  wallet: string,
  role: UserRole,
): Promise<UserRow | undefined> {
  return db.begin(async (tx): Promise<UserRow | undefined> => {
    // Calls for one e-mail write one after the other: two concurrent inserts of the same new
    // row otherwise meet on the unique indexes in an order Postgres cannot settle, and one of
    // them fails (a unique violation on `privy_id` or `wallet`, or a deadlock).
    await tx`select pg_advisory_xact_lock(hashtextextended(${usersLockKey(email)}, 0))`;
    const [written] = await tx<UserRow[]>`
      insert into users (email, privy_id, wallet, roles)
      values (${email}, ${privyUserId}, ${wallet}, array[${role}::text])
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
 *
 * A write of the row that fails with a deadlock or a serialization failure (which a writer of the
 * users table that does not take the e-mail's lock can still cause) runs again, its whole
 * transaction, as the web sign-in's does (apps/web/lib/server/auth.ts, `writeUsersRow`): at most
 * five attempts, 10 ms before the second and doubled for each later one, a warning per retry
 * (without the e-mail). Throws `TransactionRetryExhaustedError` when every attempt failed so.
 */
export async function resolveUserWallet(
  db: Db,
  directory: IdentityDirectory,
  rawEmail: string,
  role: UserRole,
  options: ResolveUserWalletOptions = {},
): Promise<ResolvedUser> {
  const email = normalizeEmail(rawEmail);
  if (email === "") throw new InvalidEmailError();
  const log = usersLogger(options);

  const [existing] = await db<UserRow[]>`
    select id, privy_id, wallet, roles from users where email = ${email}
  `;
  if (existing?.wallet) {
    await addRole(db, existing, role, log);
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
    row = await retryTransaction(() => upsertUsersRow(db, email, found.privyUserId, wallet, role), {
      what: USERS_WRITE,
      logger: log,
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
    await addRole(db, current, role, log);
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
