import { privyErrorCode } from "./privy-errors";

/** The few fields of a Privy linked account that tell an Ethereum embedded wallet apart. */
interface LinkedAccountLike {
  type: string;
  chainType?: string;
  walletClientType?: string;
}

/** True when the user already has the Ethereum wallet Privy creates for them (`privy` client). */
export function hasEthereumEmbeddedWallet(accounts: readonly LinkedAccountLike[]): boolean {
  return accounts.some(
    (account) =>
      account.type === "wallet" &&
      account.walletClientType === "privy" &&
      account.chainType === "ethereum",
  );
}

/**
 * `createWallet` refuses a user who already has a wallet. That is the state we want, not a
 * failure: a returning user, or a wallet the server pre-generated from their e-mail.
 */
export function isWalletAlreadyThere(error: unknown): boolean {
  return privyErrorCode(error) === "embedded_wallet_already_exists";
}
