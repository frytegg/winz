import {
  ConflictError,
  NotFoundError,
  PrivyClient,
  type LinkedAccount,
  type User,
} from "@privy-io/node";

import { IdentityResponseError, normalizeEmail, type IdentityDirectory } from "./directory";

// ---------------------------------------------------------------------------------------------
// NOT YET EXERCISED AGAINST THE LIVE PRIVY SERVICE.
//
// Written against the types of the installed `@privy-io/node` (0.40.0), mirroring the web app's
// apps/web/lib/server/privy.ts; it type-checks, but no call has reached Privy. The human probe of
// task S-02 must confirm, with a real app id and secret, that `users().getByEmailAddress`,
// `users().create` and `users().pregenerateWallets` behave as their types say (shapes, 404 and
// 409 answers), and that the embedded wallet of a pre-generated user is the one the user sees
// after an OTP login. Tests never use this file: they inject a fake `IdentityDirectory`.
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

/**
 * `IdentityDirectory` on `@privy-io/node`. The client is created at the first call, never at
 * construction, so a process that never resolves a wallet needs no Privy round trip.
 */
export class PrivyIdentityDirectory implements IdentityDirectory {
  private client: PrivyClient | undefined;

  constructor(private readonly credentials: PrivyCredentials) {}

  private privy(): PrivyClient {
    this.client ??= new PrivyClient({
      appId: this.credentials.appId,
      appSecret: this.credentials.appSecret,
    });
    return this.client;
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
    if (wallet === null) {
      throw new IdentityResponseError(
        `Privy user ${user.id} has no Ethereum embedded wallet after pre-generation`,
      );
    }
    return { privyUserId: user.id, walletAddress: wallet };
  }
}
