import { createHash, timingSafeEqual } from "node:crypto";

import { ADMIN_KEY_HEADER, USER_ROLES, type RouteAuth, type UserRole } from "@winz/shared";

import type { Db } from "./db";
import { ApiRouteError } from "./route";

// ---------------------------------------------------------------------------------------------
// Identity provider contracts (implemented on Privy in privy.ts, faked in tests)
// ---------------------------------------------------------------------------------------------

export interface VerifiedToken {
  privyUserId: string;
}

/** Checks an access token issued by the identity provider. */
export interface AuthVerifier {
  /** Resolves the token's user, or throws `InvalidAccessTokenError` when the token is rejected. */
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

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint_name" in error &&
    error.constraint_name === constraint
  );
}

/**
 * The `users` row of a verified identity, created at the first signed-in request. Safe under
 * concurrency: two first requests of the same person meet on the unique e-mail and end with one
 * row. A row that already exists for the e-mail (a fan whose wallet was pre-generated at purchase)
 * is adopted: its privy id and wallet are filled in when they were missing.
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
    await db`update users set wallet = ${walletAddress} where id = ${existing.id} and wallet is null`;
    const refreshed = await selectByPrivyId(db, privyUserId);
    return toPrincipal(refreshed ?? existing, privyUserId);
  }

  const profile = await directory.getUser(privyUserId);
  if (profile.email === null) {
    throw new ApiRouteError(403, "forbidden", "Sign in with an e-mail address to continue");
  }
  const email = normalizeEmail(profile.email);
  try {
    const [row] = await db<{ id: string; privy_id: string | null }[]>`
      insert into users (email, privy_id, wallet)
      values (${email}, ${privyUserId}, ${profile.walletAddress})
      on conflict (email) do update set
        privy_id = coalesce(users.privy_id, excluded.privy_id),
        wallet = coalesce(users.wallet, excluded.wallet)
      returning id, privy_id
    `;
    if (row && row.privy_id !== privyUserId) {
      throw new ApiRouteError(409, "conflict", "This e-mail belongs to another account");
    }
  } catch (error: unknown) {
    // The privy id is already on another row (the e-mail changed at the provider): use that row.
    if (!isUniqueViolation(error, "users_privy_id_key")) throw error;
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
 *   `users` row is found or created; 401 when the token is missing, malformed or rejected;
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
