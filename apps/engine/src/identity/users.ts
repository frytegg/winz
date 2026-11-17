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
 * The wallet of an e-mail (SPEC ID-1). The e-mail is normalised first. When the users row of
 * that e-mail already holds a wallet, it is the answer; otherwise the directory finds or creates
 * the user and their embedded wallet, and the row is written. Either way the row ends with
 * `role` among its roles: one row per e-mail, kept, never duplicated.
 *
 * Throws `InvalidEmailError` for an empty e-mail, `IdentityResponseError` when the directory
 * answers with an address that is not one, and `IdentityConflictError` when the table and the
 * directory disagree (the row holds another Privy user or wallet, or another e-mail's row holds
 * this one). Any other error is the directory's or the database's, unchanged.
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
    if (!existing.roles.includes(role)) {
      await db`
        update users set roles = array_append(roles, ${role}::text)
        where id = ${existing.id} and not (${role}::text = any(roles))
      `;
    }
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
    [row] = await db<UserRow[]>`
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
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      throw new IdentityConflictError(
        "the directory's user or wallet is already recorded for another e-mail",
      );
    }
    throw error;
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
