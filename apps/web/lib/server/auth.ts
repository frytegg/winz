import { createHash, timingSafeEqual } from "node:crypto";

import type { TransactionSql } from "postgres";

import { ADMIN_KEY_HEADER, USER_ROLES, type RouteAuth, type UserRole } from "@winz/shared";

import type { Db } from "./db";
import { serverLogger } from "./logger";
import { ApiRouteError } from "./route";

const log = serverLogger("auth");

// ---------------------------------------------------------------------------------------------
// Identity provider contracts (implemented on Privy in privy.ts, faked in tests)
// ---------------------------------------------------------------------------------------------

export interface VerifiedToken {
  privyUserId: string;
}

/** Checks an access token issued by the identity provider. */
export interface AuthVerifier {
  /**
   * Resolves the token's user. Throws `InvalidAccessTokenError` when the token is rejected, and
   * `AuthUnavailableError` when it could not be checked at all.
   */
  verify(accessToken: string): Promise<VerifiedToken>;
}

export interface DirectoryUser {
  /** Normalised (see `normalizeEmail`); null when the account has no e-mail. */
  email: string | null;
  /** Lowercase Ethereum embedded wallet; null while none was created. */
  walletAddress: string | null;
}

/** The identity provider's user directory. */
export interface IdentityDirectory {
  getUser(privyUserId: string): Promise<DirectoryUser>;
  /**
   * The user of this e-mail, created with a pre-generated Ethereum embedded wallet when it does not
   * exist yet (ID-1: a fan's wallet is pre-generated from the e-mail of the payment sheet).
   */
  findOrCreateWalletByEmail(email: string): Promise<{ privyUserId: string; walletAddress: string }>;
}

/** Thrown by an `AuthVerifier` when the token is malformed, expired or not signed by the provider. */
export class InvalidAccessTokenError extends Error {
  constructor(reason: string) {
    super(`Access token rejected: ${reason}`);
    this.name = "InvalidAccessTokenError";
  }
}

/**
 * Thrown by an `AuthVerifier` when it could not check the token at all (the provider's keys could
 * not be fetched): it says nothing of the token, which may well be valid. Answered 503, never 401,
 * so that the front does not sign a person out because the provider is slow or unreachable.
 */
export class AuthUnavailableError extends Error {
  /**
   * True when the verifier has already logged the reason as a configuration error (a wrong app
   * id, say): the outage log then stays silent, so that one request is not reported both as a
   * configuration error and as an outage. The answer is the same 503 either way.
   */
  readonly configuration: boolean;

  constructor(reason: string, options?: { cause?: unknown; configuration?: boolean }) {
    super(`Access token could not be checked: ${reason}`, { cause: options?.cause });
    this.name = "AuthUnavailableError";
    this.configuration = options?.configuration === true;
  }
}

// ---------------------------------------------------------------------------------------------
// Outages of the identity provider
// ---------------------------------------------------------------------------------------------

/** An outage of the identity provider is logged at most once in this window, per instance. */
export const AUTH_OUTAGE_LOG_WINDOW_MS = 60_000;

/** Where `ThrottledOutageLog` writes: the server's pino logger, or a fake in tests. */
export interface OutageSink {
  warn(details: Record<string, unknown>, message: string): void;
}

function causeOf(error: Error): string | undefined {
  return error.cause instanceof Error ? `${error.cause.name}: ${error.cause.message}` : undefined;
}

/**
 * Logs an outage of the identity provider once per window, with the number of requests answered
 * 503 since the last line (`heldBack`): one line a minute during an outage, not one per request.
 * Never the token.
 */
export class ThrottledOutageLog {
  private lastLoggedAt = Number.NEGATIVE_INFINITY;
  private heldBack = 0;

  constructor(
    private readonly sink: OutageSink,
    private readonly windowMs: number = AUTH_OUTAGE_LOG_WINDOW_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  report(error: AuthUnavailableError): void {
    // Already logged at ERROR by the verifier, with the variable to check: not an outage.
    if (error.configuration) return;
    const now = this.now();
    if (now - this.lastLoggedAt < this.windowMs) {
      this.heldBack += 1;
      return;
    }
    this.sink.warn(
      { reason: error.message, cause: causeOf(error), heldBack: this.heldBack },
      "access tokens cannot be checked (identity provider unreachable): answering 503",
    );
    this.lastLoggedAt = now;
    this.heldBack = 0;
  }
}

const defaultOutageLog = new ThrottledOutageLog(log);

// ---------------------------------------------------------------------------------------------
// E-mail
// ---------------------------------------------------------------------------------------------

/**
 * The one normalisation of an e-mail address (ID-1): surrounding spaces removed, lowercase. Every
 * lookup and every write of an e-mail goes through it; `users.email` has a check constraint that
 * refuses anything else.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---------------------------------------------------------------------------------------------
// Principals
// ---------------------------------------------------------------------------------------------

/** A signed-in person, as the `users` row knows them. */
export interface UserPrincipal {
  kind: "user";
  userId: string;
  privyUserId: string;
  email: string;
  walletAddress: string | null;
  roles: UserRole[];
  merchantId: string | null;
}

export interface MerchantPrincipal extends UserPrincipal {
  merchantId: string;
}

export interface AdminPrincipal {
  kind: "admin";
}

/** What `authenticateRequest` returns: null for public and signature routes. */
export type Principal = UserPrincipal | AdminPrincipal | null;

function isUserPrincipal(principal: unknown): principal is UserPrincipal {
  return (
    typeof principal === "object" &&
    principal !== null &&
    "kind" in principal &&
    principal.kind === "user"
  );
}

/**
 * The principal of a `user` or `merchant` route. Reaching an implementation without one means the
 * route was registered without authentication: a programming error, answered 500.
 */
export function requireUser(principal: unknown): UserPrincipal {
  if (!isUserPrincipal(principal)) {
    throw new Error("route reached without an authenticated user: is authenticate wired?");
  }
  return principal;
}

/** The principal of a `merchant` route (see `requireUser`). */
export function requireMerchant(principal: unknown): MerchantPrincipal {
  const user = requireUser(principal);
  if (user.merchantId === null) {
    throw new Error("merchant route reached without a merchant: is authenticate wired?");
  }
  return { ...user, merchantId: user.merchantId };
}

// ---------------------------------------------------------------------------------------------
// authenticateRequest
// ---------------------------------------------------------------------------------------------

export interface AuthDeps {
  db: Db;
  verifier: AuthVerifier;
  directory: IdentityDirectory;
  /** The demo admin key (`APP_ADMIN_DEMO_KEY`). Read only for `admin` routes. */
  adminKey: () => string;
  /** Where an outage of the identity provider is logged; one per instance by default. */
  outageLog?: ThrottledOutageLog;
}

const BEARER = /^Bearer[ \t]+([A-Za-z0-9\-._~+/]+=*)$/;

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization");
  if (header === null || header.trim() === "") {
    throw new ApiRouteError(401, "unauthenticated", "Sign in to continue");
  }
  const match = BEARER.exec(header.trim());
  if (!match?.[1]) {
    throw new ApiRouteError(401, "unauthenticated", "Malformed authorization header");
  }
  return match[1];
}

/** Compares two secrets in time independent of where they differ (and of their lengths). */
export function secretsEqual(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

interface UserRow {
  id: string;
  email: string;
  privy_id: string | null;
  wallet: string | null;
  roles: string[];
  merchant_id: string | null;
}

function knownRoles(roles: readonly string[]): UserRole[] {
  return roles.filter((role): role is UserRole => (USER_ROLES as readonly string[]).includes(role));
}

function toPrincipal(row: UserRow, privyUserId: string): UserPrincipal {
  return {
    kind: "user",
    userId: row.id,
    privyUserId,
    email: row.email,
    walletAddress: row.wallet,
    roles: knownRoles(row.roles),
    merchantId: row.merchant_id,
  };
}

async function selectByPrivyId(db: Db, privyUserId: string): Promise<UserRow | undefined> {
  const rows = await db<UserRow[]>`
    select u.id, u.email, u.privy_id, u.wallet, u.roles, m.id as merchant_id
    from users u
    left join merchants m on m.user_id = u.id
    where u.privy_id = ${privyUserId}
  `;
  return rows[0];
}

const UNIQUE_VIOLATION = "23505";
/** Postgres errors after which a whole transaction is safe to run again. */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  "40P01", // deadlock_detected
  "40001", // serialization_failure
]);
/** Attempts of one users write, the first included, before its retryable error is let through. */
const USERS_WRITE_ATTEMPTS = 5;
/** Wait before the second attempt; doubled for each later one. */
const USERS_WRITE_BACKOFF_MS = 10;

function errorField(error: unknown, field: string): unknown {
  return typeof error === "object" && error !== null && field in error
    ? (error as Record<string, unknown>)[field]
    : undefined;
}

/** A unique violation; of `constraint` only, when given. */
function isUniqueViolation(error: unknown, constraint?: string): boolean {
  return (
    errorField(error, "code") === UNIQUE_VIOLATION &&
    (constraint === undefined || errorField(error, "constraint_name") === constraint)
  );
}

function isRetryable(error: unknown): boolean {
  const code = errorField(error, "code");
  return typeof code === "string" && RETRYABLE_CODES.has(code);
}

/** Namespace of the advisory lock that serialises the writes of one e-mail's users row. */
const USERS_LOCK_PREFIX = "winz:users:";

/**
 * The text whose `hashtextextended(…, 0)` is the advisory lock of one e-mail's users row: the
 * namespace, then the normalised e-mail. The engine, which writes the row of a buyer at their
 * first purchase (apps/engine/src/identity/users.ts, `usersLockKey`), takes the same lock;
 * packages/shared is frozen, so this recipe is written on both sides, and auth-race.test.ts checks
 * that the two agree. Change both or neither.
 */
export function usersLockKey(email: string): string {
  return `${USERS_LOCK_PREFIX}${normalizeEmail(email)}`;
}

/**
 * Takes the advisory lock of one e-mail's users row, held until `tx` ends. Transaction-scoped, so
 * it works through Supabase's transaction pooler, which keeps no session state between
 * transactions.
 */
export async function lockUsersEmail(tx: TransactionSql, email: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${usersLockKey(email)}, 0))`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `write` in a transaction that first takes the lock of `email`'s users row, so that it never
 * overlaps another locked write of that row (another sign-in, or the engine creating the row at
 * the person's first purchase). A deadlock or a serialization failure, which a writer that does
 * not take the lock can still cause, runs the whole transaction again, at most
 * `USERS_WRITE_ATTEMPTS` times in all; any other error is let through at once.
 */
async function writeUsersRow(
  db: Db,
  email: string,
  write: (tx: TransactionSql) => Promise<void>,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await db.begin(async (tx): Promise<void> => {
        await lockUsersEmail(tx, email);
        await write(tx);
      });
      return;
    } catch (error: unknown) {
      if (!isRetryable(error) || attempt >= USERS_WRITE_ATTEMPTS) throw error;
      // The e-mail is personal data: never logged.
      log.warn(
        { code: errorField(error, "code"), attempt, of: USERS_WRITE_ATTEMPTS },
        "users write retried",
      );
      await sleep(USERS_WRITE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
}

/**
 * The `users` row of a verified identity, created at the first signed-in request. A row that
 * already exists for the e-mail (a fan whose wallet was pre-generated at purchase) is adopted: its
 * privy id and wallet are filled in when they were missing.
 *
 * Safe under concurrency: every write of the row runs under the e-mail's advisory lock, the same
 * one the engine takes when it creates the row at a first purchase (`usersLockKey`), so two first
 * requests of the same person, or a first sign-in racing a first purchase, end with one row and
 * both succeed. A writer that does not take the lock can still make the write fail: a unique
 * violation is then forgiven when a fresh read shows the row is this person's own, and a deadlock
 * or serialization failure is retried a bounded number of times. A real conflict is refused as
 * before: 409 when the e-mail's row holds another Privy user, the database's unique violation
 * when the wallet belongs to another e-mail's row.
 */
export async function findOrCreateUser(
  db: Db,
  directory: IdentityDirectory,
  privyUserId: string,
): Promise<UserPrincipal> {
  const existing = await selectByPrivyId(db, privyUserId);
  if (existing) {
    if (existing.wallet !== null) return toPrincipal(existing, privyUserId);
    // A merchant's wallet is created by the front-end SDK at the first login, possibly after the
    // first API call: pick it up as soon as the directory has it.
    const { walletAddress } = await directory.getUser(privyUserId);
    if (walletAddress === null) return toPrincipal(existing, privyUserId);
    try {
      await writeUsersRow(db, existing.email, async (tx): Promise<void> => {
        await tx`update users set wallet = ${walletAddress} where id = ${existing.id} and wallet is null`;
      });
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error;
      // A writer that does not lock filled this row with the same wallet a moment earlier: the
      // row is this person's own. Any other row holding the wallet is a real conflict.
      const current = await selectByPrivyId(db, privyUserId);
      if (current?.wallet !== walletAddress) throw error;
    }
    const refreshed = await selectByPrivyId(db, privyUserId);
    return toPrincipal(refreshed ?? existing, privyUserId);
  }

  const profile = await directory.getUser(privyUserId);
  if (profile.email === null) {
    throw new ApiRouteError(403, "forbidden", "Sign in with an e-mail address to continue");
  }
  const email = normalizeEmail(profile.email);
  try {
    await writeUsersRow(db, email, async (tx): Promise<void> => {
      const [row] = await tx<{ id: string; privy_id: string | null }[]>`
        insert into users (email, privy_id, wallet)
        values (${email}, ${privyUserId}, ${profile.walletAddress})
        on conflict (email) do update set
          privy_id = coalesce(users.privy_id, excluded.privy_id),
          wallet = coalesce(users.wallet, excluded.wallet)
        returning id, privy_id
      `;
      // Thrown inside the transaction, so the other account's row is left as it was.
      if (row && row.privy_id !== privyUserId) {
        throw new ApiRouteError(409, "conflict", "This e-mail belongs to another account");
      }
    });
  } catch (error: unknown) {
    if (!isUniqueViolation(error)) throw error;
    // The privy id is already on another row (the e-mail changed at the provider): use that row.
    if (!isUniqueViolation(error, "users_privy_id_key")) {
      // A writer that does not lock wrote this e-mail's row first, with this person's Privy id and
      // wallet: Postgres raises the violation only once that write has committed, so a fresh read
      // sees it. Anything else (the wallet is another e-mail's) is a real conflict.
      const [current] = await db<{ privy_id: string | null; wallet: string | null }[]>`
        select privy_id, wallet from users where email = ${email}
      `;
      if (current?.privy_id !== privyUserId || current.wallet !== profile.walletAddress) {
        throw error;
      }
    }
  }
  const created = await selectByPrivyId(db, privyUserId);
  if (!created) throw new Error(`users row of ${privyUserId} vanished right after its upsert`);
  return toPrincipal(created, privyUserId);
}

/**
 * The `authenticate` hook of every API route (see `api-route.ts`), by the route's auth kind:
 *
 * - `public`: nothing to check, the principal is null;
 * - `user`: `Authorization: Bearer <access token>`, verified by the identity provider, then the
 *   `users` row is found or created; 401 when the token is missing, malformed or rejected; 503
 *   (`internal`, "try again") when the provider could not check it (logged once per minute);
 * - `merchant`: as `user`, and the user must own a business (403 otherwise);
 * - `admin`: the `x-admin-key` header must equal `APP_ADMIN_DEMO_KEY` (constant-time comparison);
 * - `signature`: left to the webhook implementations, which need the raw body.
 */
export async function authenticateRequest(
  request: Request,
  routeAuth: RouteAuth,
  deps: AuthDeps,
): Promise<Principal> {
  switch (routeAuth) {
    case "public":
    case "signature":
      return null;
    case "admin": {
      const given = request.headers.get(ADMIN_KEY_HEADER);
      if (given === null || !secretsEqual(given, deps.adminKey())) {
        throw new ApiRouteError(401, "unauthenticated", "Missing or invalid admin key");
      }
      return { kind: "admin" };
    }
    case "user":
    case "merchant": {
      const token = bearerToken(request);
      let verified: VerifiedToken;
      try {
        verified = await deps.verifier.verify(token);
      } catch (error: unknown) {
        if (error instanceof InvalidAccessTokenError) {
          throw new ApiRouteError(
            401,
            "unauthenticated",
            "Your session has expired, sign in again",
          );
        }
        if (error instanceof AuthUnavailableError) {
          (deps.outageLog ?? defaultOutageLog).report(error);
          // `internal`: the shared error codes have no other one for a 5xx (packages/shared).
          throw new ApiRouteError(
            503,
            "internal",
            "We could not check your sign-in just now, try again in a moment",
          );
        }
        throw error;
      }
      const principal = await findOrCreateUser(deps.db, deps.directory, verified.privyUserId);
      if (routeAuth === "merchant" && principal.merchantId === null) {
        throw new ApiRouteError(403, "forbidden", "Set up your business first");
      }
      return principal;
    }
  }
}
