import {
  ConflictError,
  InvalidAuthTokenError,
  NotFoundError,
  PrivyClient,
  verifyAccessToken,
  type LinkedAccount,
  type User,
  type VerifyAccessTokenInput,
} from "@privy-io/node";

import {
  AUTH_OUTAGE_LOG_WINDOW_MS,
  AuthUnavailableError,
  InvalidAccessTokenError,
  normalizeEmail,
  type AuthVerifier,
  type DirectoryUser,
  type IdentityDirectory,
  type VerifiedToken,
} from "./auth";
import { serverLogger } from "./logger";

// ---------------------------------------------------------------------------------------------
// NOT YET EXERCISED AGAINST THE LIVE PRIVY SERVICE.
//
// No Privy credentials exist yet. Everything below is written against the types of the installed
// `@privy-io/node` (0.40.0) and type-checks, but no call has reached Privy. The human probe of task
// S-02 must confirm, with a real app id and secret:
//   - `verifyAccessToken`, with the key set fetched from `<api>/v1/apps/<app id>/jwks.json` by
//     `PrivyKeySet`, accepts a token issued by the front-end SDK;
//   - `users()._get`, `users().getByEmailAddress`, `users().create` and
//     `users().pregenerateWallets` behave as their types say (shapes, 404 and 409 answers);
//   - the embedded wallet of a pre-generated user is the one the user sees after an OTP login.
// Route tests inject fakes of `AuthVerifier` and `IdentityDirectory`; the token check below runs in
// privy.test.ts with the real SDK against a local stand-in for Privy's key set.
// ---------------------------------------------------------------------------------------------

export interface PrivyCredentials {
  appId: string;
  appSecret: string;
  /** Privy's API; `PRIVY_API_URL` when absent. Tests point it at a local stand-in. */
  apiUrl?: string;
}

// ---------------------------------------------------------------------------------------------
// Privy's key set
// ---------------------------------------------------------------------------------------------

/** Privy's API, the SDK's own default (`@privy-io/node` 0.40.0, src/client.ts `environments`). */
export const PRIVY_API_URL = "https://api.privy.io";

/**
 * How the SDK fetches the key set (src/lib/auth.ts, `createPrivyAppJWKS`, on jose 6
 * `createRemoteJWKSet`): 5 s before giving up, keys kept 60 min, and a token signed by a key the
 * set does not have makes it fetch again at most once per 10 min.
 */
export const PRIVY_KEYS_TIMEOUT_MS = 5_000;
export const PRIVY_KEYS_MAX_AGE_MS = 60 * 60_000;
export const PRIVY_KEYS_COOLDOWN_MS = 10 * 60_000;

/** The `verification_key` the SDK's `verifyAccessToken` accepts as a function. */
type KeyGetter = Extract<VerifyAccessTokenInput["verification_key"], (...args: never[]) => unknown>;
type KeyHeader = Parameters<KeyGetter>[0];

/** One key of Privy's key set, as its JWKS lists it. */
interface PrivyJwk {
  kty: string;
  crv?: string;
  x?: string;
  y?: string;
  kid?: string;
  alg?: string;
  use?: string;
}

/** Privy's key set could not be fetched: slow, unreachable, or an answer that is not a key set. */
export class PrivyKeysUnavailableError extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`Privy's key set could not be fetched: ${reason}`, options);
    this.name = "PrivyKeysUnavailableError";
  }
}

/**
 * The answers by which Privy says that the request for the key set is itself wrong, so that asking
 * again cannot help: 400, 401, 403 and 404, which the SDK maps to `BadRequestError`,
 * `AuthenticationError`, `PermissionDeniedError` and `NotFoundError` and never retries
 * (@privy-io/node 0.40.0, core/error.js `APIError.generate`, client.js `shouldRetry`). The key set
 * is a public GET of `/v1/apps/<app id>/jwks.json`, with no body and no credentials: the only part
 * of the request this server chooses is the app id, so such an answer means that
 * `NEXT_PUBLIC_PRIVY_APP_ID` is not the id of a Privy app (an unknown id answers 404). 408 and
 * 429 (the SDK retries them), a 5xx, a timeout or a network failure are an outage instead.
 */
export const PRIVY_KEYS_REFUSED_STATUSES: ReadonlySet<number> = new Set([400, 401, 403, 404]);

/** The variable that names the app whose key set is fetched; what to check on a refusal. */
export const PRIVY_APP_ID_VARIABLE = "NEXT_PUBLIC_PRIVY_APP_ID";

/**
 * Privy refused the request for its key set (`PRIVY_KEYS_REFUSED_STATUSES`): a configuration
 * error, not an outage. Still a `PrivyKeysUnavailableError`, since the token could not be checked.
 */
export class PrivyKeysRefusedError extends PrivyKeysUnavailableError {
  constructor(readonly status: number) {
    super(`HTTP ${String(status)}, a request Privy refuses: check ${PRIVY_APP_ID_VARIABLE}`);
    this.name = "PrivyKeysRefusedError";
  }
}

/** Where `ThrottledPrivyConfigurationLog` writes: the server's pino logger, or a fake in tests. */
export interface PrivyConfigurationSink {
  error(details: Record<string, unknown>, message: string): void;
}

/**
 * Logs at ERROR, once per window (`AUTH_OUTAGE_LOG_WINDOW_MS`, as the outage warning of
 * auth.ts), that Privy refuses the request for its key set, with the number of refusals held back
 * since the last line. Names the variable to check and the status; never the app id's value, a
 * secret or a token.
 */
export class ThrottledPrivyConfigurationLog {
  private lastLoggedAt = Number.NEGATIVE_INFINITY;
  private heldBack = 0;

  constructor(
    private readonly sink: PrivyConfigurationSink,
    private readonly windowMs: number = AUTH_OUTAGE_LOG_WINDOW_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  report(error: PrivyKeysRefusedError): void {
    const now = this.now();
    if (now - this.lastLoggedAt < this.windowMs) {
      this.heldBack += 1;
      return;
    }
    // A 401 or a 403 can also come from a protection layer in front of Privy (a transient block):
    // the sentence must stay true in both cases. A 400 or a 404 is the app id.
    const blockedOrId = error.status === 401 || error.status === 403;
    this.sink.error(
      { status: error.status, variable: PRIVY_APP_ID_VARIABLE, heldBack: this.heldBack },
      `Privy refuses the request for its key set (HTTP ${String(error.status)}): ` +
        (blockedOrId
          ? `either ${PRIVY_APP_ID_VARIABLE} is not the id of a Privy app, or the request was ` +
            "blocked before it reached Privy; if the next attempts are refused the same way, " +
            "check the variable; "
          : `check ${PRIVY_APP_ID_VARIABLE}, which is probably not the id of a Privy app; `) +
        "until it is fixed, every signed-in route answers 503",
    );
    this.lastLoggedAt = now;
    this.heldBack = 0;
  }
}

let defaultConfigurationLog: ThrottledPrivyConfigurationLog | undefined;

function configurationLog(): ThrottledPrivyConfigurationLog {
  defaultConfigurationLog ??= new ThrottledPrivyConfigurationLog(serverLogger("privy"));
  return defaultConfigurationLog;
}

/** The key set was fetched and has no key for the token's header. */
class PrivyKeyNotFoundError extends Error {
  constructor() {
    super("no key of Privy's key set matches the token");
    this.name = "PrivyKeyNotFoundError";
  }
}

function isJwk(value: unknown): value is PrivyJwk {
  return typeof value === "object" && value !== null && typeof (value as PrivyJwk).kty === "string";
}

export interface PrivyKeySetOptions {
  /** Milliseconds before a fetch is given up. Default `PRIVY_KEYS_TIMEOUT_MS`. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** The clock, in milliseconds. */
  now?: () => number;
}

/**
 * Privy's key set (`<api>/v1/apps/<app id>/jwks.json`, no credentials), fetched and cached as the
 * SDK does it, but by this code: the SDK turns a failed fetch into the same
 * `InvalidAuthTokenError("Failed to verify authentication token")` as a forged signature, and only
 * the fetcher knows which one happened. A fetch that fails leaves nothing behind: the next token
 * fetches again.
 */
export class PrivyKeySet {
  private keys: PrivyJwk[] | undefined;
  private fetchedAt = Number.NEGATIVE_INFINITY;
  private pending: Promise<PrivyJwk[]> | undefined;

  constructor(
    private readonly url: string,
    private readonly options: PrivyKeySetOptions = {},
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private async download(): Promise<PrivyJwk[]> {
    const timeoutMs = this.options.timeoutMs ?? PRIVY_KEYS_TIMEOUT_MS;
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(this.url, {
        method: "GET",
        redirect: "manual",
        headers: { accept: "application/json, application/jwk-set+json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: unknown) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new PrivyKeysUnavailableError(
        timedOut ? `no answer within ${String(timeoutMs)} ms` : "the request failed",
        { cause: error },
      );
    }
    if (PRIVY_KEYS_REFUSED_STATUSES.has(response.status)) {
      throw new PrivyKeysRefusedError(response.status);
    }
    if (response.status !== 200) {
      throw new PrivyKeysUnavailableError(`HTTP ${String(response.status)}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error: unknown) {
      throw new PrivyKeysUnavailableError("the answer is not JSON", { cause: error });
    }
    const keys =
      typeof body === "object" && body !== null ? (body as { keys?: unknown }).keys : null;
    if (!Array.isArray(keys) || !keys.every(isJwk)) {
      throw new PrivyKeysUnavailableError("the answer is not a key set");
    }
    return keys;
  }

  private async reload(): Promise<PrivyJwk[]> {
    this.pending ??= this.download()
      .then((keys) => {
        this.keys = keys;
        this.fetchedAt = this.now();
        return keys;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private static match(keys: readonly PrivyJwk[], header: KeyHeader): PrivyJwk | undefined {
    const candidates = keys.filter(
      (key) =>
        key.kty === "EC" &&
        (key.crv === undefined || key.crv === "P-256") &&
        (key.use === undefined || key.use === "sig") &&
        (key.alg === undefined || key.alg === header.alg) &&
        (header.kid === undefined || key.kid === header.kid),
    );
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  /**
   * The key of `header`. Throws `PrivyKeysUnavailableError` when the set could not be fetched,
   * `PrivyKeyNotFoundError` when it was and has no such key.
   */
  async keyFor(header: KeyHeader): Promise<PrivyJwk> {
    const fresh = this.now() - this.fetchedAt < PRIVY_KEYS_MAX_AGE_MS;
    const keys = this.keys !== undefined && fresh ? this.keys : await this.reload();
    const key = PrivyKeySet.match(keys, header);
    if (key) return key;
    // A key Privy added since the last fetch: fetch again, at most once per cooldown.
    if (this.now() - this.fetchedAt >= PRIVY_KEYS_COOLDOWN_MS) {
      const again = PrivyKeySet.match(await this.reload(), header);
      if (again) return again;
    }
    throw new PrivyKeyNotFoundError();
  }
}

// ---------------------------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------------------------

/** The Ethereum embedded wallet Privy created for the user, lowercase; null when none exists. */
function ethereumEmbeddedWallet(accounts: readonly LinkedAccount[]): string | null {
  for (const account of accounts) {
    if (
      account.type === "wallet" &&
      "connector_type" in account &&
      account.connector_type === "embedded" &&
      account.chain_type === "ethereum"
    ) {
      return account.address.toLowerCase();
    }
  }
  return null;
}

function emailOf(accounts: readonly LinkedAccount[]): string | null {
  for (const account of accounts) {
    if (account.type === "email") return normalizeEmail(account.address);
  }
  return null;
}

function toDirectoryUser(user: User): DirectoryUser {
  return {
    email: emailOf(user.linked_accounts),
    walletAddress: ethereumEmbeddedWallet(user.linked_accounts),
  };
}

/** Raised when Privy answers with a user that has no Ethereum embedded wallet after creating one. */
export class PrivyWalletMissingError extends Error {
  constructor(privyUserId: string) {
    super(`Privy user ${privyUserId} has no Ethereum embedded wallet after pre-generation`);
    this.name = "PrivyWalletMissingError";
  }
}

/**
 * `AuthVerifier` and `IdentityDirectory` on `@privy-io/node`. The client is created on first use,
 * never at import time, so `next build` needs no Privy secret.
 */
export class PrivyIdentity implements AuthVerifier, IdentityDirectory {
  private client: PrivyClient | undefined;
  private keySet: PrivyKeySet | undefined;

  constructor(
    private readonly credentials: () => PrivyCredentials,
    private readonly options: {
      keys?: PrivyKeySetOptions;
      /** Where a refused key-set request is logged; the server's logger by default. */
      configurationLog?: ThrottledPrivyConfigurationLog;
    } = {},
  ) {}

  private privy(): PrivyClient {
    if (!this.client) {
      const { appId, appSecret, apiUrl } = this.credentials();
      this.client = new PrivyClient({ appId, appSecret, ...(apiUrl ? { apiUrl } : {}) });
    }
    return this.client;
  }

  private keys(): PrivyKeySet {
    if (!this.keySet) {
      const { appId, apiUrl } = this.credentials();
      const base = (apiUrl ?? PRIVY_API_URL).replace(/\/+$/, "");
      this.keySet = new PrivyKeySet(
        `${base}/v1/apps/${encodeURIComponent(appId)}/jwks.json`,
        this.options.keys,
      );
    }
    return this.keySet;
  }

  /**
   * Checks the token with the SDK's own `verifyAccessToken` (signature, ES256, issuer, audience,
   * expiry), with this file's key set. The SDK answers every failure with `InvalidAuthTokenError`:
   * "Authentication token expired", "Authentication token is invalid", or "Failed to verify
   * authentication token" for everything else, a forged signature as much as a key set it could
   * not fetch (@privy-io/node 0.40.0, src/lib/auth.ts `mapAndThrowJoseErrors`). The key set says
   * which: when it could not be fetched, the token was not checked at all
   * (`AuthUnavailableError`, answered 503); otherwise the token is refused
   * (`InvalidAccessTokenError`, answered 401). When Privy refused the key-set request itself
   * (`PrivyKeysRefusedError`, a wrong app id), the answer is the same 503, and the configuration
   * error is also logged at ERROR (`ThrottledPrivyConfigurationLog`); a 5xx, a timeout or a network
   * failure only gets the outage warning of `authenticateRequest`.
   */
  async verify(accessToken: string): Promise<VerifiedToken> {
    const keys = this.keys();
    let unavailable: PrivyKeysUnavailableError | undefined;
    const key: KeyGetter = async (header) => {
      try {
        return await keys.keyFor(header);
      } catch (error: unknown) {
        if (error instanceof PrivyKeysUnavailableError) unavailable = error;
        throw error;
      }
    };
    try {
      const claims = await verifyAccessToken({
        access_token: accessToken,
        app_id: this.credentials().appId,
        verification_key: key,
      });
      return { privyUserId: claims.user_id };
    } catch (error: unknown) {
      if (unavailable) {
        if (unavailable instanceof PrivyKeysRefusedError) {
          (this.options.configurationLog ?? configurationLog()).report(unavailable);
        }
        throw new AuthUnavailableError(unavailable.message, {
          cause: unavailable,
          configuration: unavailable instanceof PrivyKeysRefusedError,
        });
      }
      if (error instanceof InvalidAuthTokenError) throw new InvalidAccessTokenError(error.message);
      throw error;
    }
  }

  async getUser(privyUserId: string): Promise<DirectoryUser> {
    return toDirectoryUser(await this.privy().users()._get(privyUserId));
  }

  async findOrCreateWalletByEmail(
    email: string,
  ): Promise<{ privyUserId: string; walletAddress: string }> {
    const address = normalizeEmail(email);
    const users = this.privy().users();

    let user: User;
    try {
      user = await users.getByEmailAddress({ address });
    } catch (error: unknown) {
      if (!(error instanceof NotFoundError)) throw error;
      try {
        user = await users.create({
          linked_accounts: [{ type: "email", address }],
          wallets: [{ chain_type: "ethereum" }],
        });
      } catch (createError: unknown) {
        // A concurrent request created the same user first: read it back.
        if (!(createError instanceof ConflictError)) throw createError;
        user = await users.getByEmailAddress({ address });
      }
    }

    let wallet = ethereumEmbeddedWallet(user.linked_accounts);
    if (wallet === null) {
      user = await users.pregenerateWallets(user.id, { wallets: [{ chain_type: "ethereum" }] });
      wallet = ethereumEmbeddedWallet(user.linked_accounts);
    }
    if (wallet === null) throw new PrivyWalletMissingError(user.id);
    return { privyUserId: user.id, walletAddress: wallet };
  }
}
