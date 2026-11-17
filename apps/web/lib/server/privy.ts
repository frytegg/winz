import {
  ConflictError,
  InvalidAuthTokenError,
  NotFoundError,
  PrivyClient,
  type LinkedAccount,
  type User,
} from "@privy-io/node";

import {
  InvalidAccessTokenError,
  normalizeEmail,
  type AuthVerifier,
  type DirectoryUser,
  type IdentityDirectory,
  type VerifiedToken,
} from "./auth";

// ---------------------------------------------------------------------------------------------
// NOT YET EXERCISED AGAINST THE LIVE PRIVY SERVICE.
//
// No Privy credentials exist yet. Everything below is written against the types of the installed
// `@privy-io/node` (0.40.0) and type-checks, but no call has reached Privy. The human probe of task
// S-02 must confirm, with a real app id and secret:
//   - `utils().auth().verifyAccessToken` accepts a token issued by the front-end SDK;
//   - `users()._get`, `users().getByEmailAddress`, `users().create` and
//     `users().pregenerateWallets` behave as their types say (shapes, 404 and 409 answers);
//   - the embedded wallet of a pre-generated user is the one the user sees after an OTP login.
// Tests never use this file: they inject fakes of `AuthVerifier` and `IdentityDirectory`.
// ---------------------------------------------------------------------------------------------

export interface PrivyCredentials {
  appId: string;
  appSecret: string;
}

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

  constructor(private readonly credentials: () => PrivyCredentials) {}

  private privy(): PrivyClient {
    if (!this.client) {
      const { appId, appSecret } = this.credentials();
      this.client = new PrivyClient({ appId, appSecret });
    }
    return this.client;
  }

  async verify(accessToken: string): Promise<VerifiedToken> {
    try {
      const claims = await this.privy().utils().auth().verifyAccessToken(accessToken);
      return { privyUserId: claims.user_id };
    } catch (error: unknown) {
      // Privy maps every failure of the JWT check (bad signature, expired, wrong audience, JWKS
      // unreachable) to this one error class.
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
