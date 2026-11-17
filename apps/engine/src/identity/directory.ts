/**
 * Where e-mails become wallets (SPEC ID-1): a customer who pays is given an embedded wallet,
 * pre-generated from the e-mail of the payment sheet, before any login. Behind an interface so
 * the job handlers are tested against a fake.
 */
export interface IdentityDirectory {
  /**
   * The user of this e-mail and their Ethereum embedded wallet, both created when missing. The
   * caller passes a normalised e-mail (see `normalizeEmail`); implementations normalise again.
   */
  findOrCreateWalletByEmail(email: string): Promise<{ privyUserId: string; walletAddress: string }>;
}

/** Lower case, surrounding spaces removed: the one form an e-mail is looked up or stored in. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Base class of the identity errors. */
export class IdentityError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "IdentityError";
  }
}

/** An e-mail that is empty once normalised. The e-mail itself is never put in the message. */
export class InvalidEmailError extends IdentityError {
  constructor() {
    super("the e-mail is empty once normalised");
    this.name = "InvalidEmailError";
  }
}

/** The directory answered with something unusable (no wallet, a malformed address). */
export class IdentityResponseError extends IdentityError {
  constructor(message: string) {
    super(message);
    this.name = "IdentityResponseError";
  }
}

/**
 * The users table disagrees with the directory: the e-mail's row holds another Privy user or
 * another wallet, or the directory's user or wallet belongs to another e-mail. Needs a human.
 */
export class IdentityConflictError extends IdentityError {
  constructor(message: string) {
    super(message);
    this.name = "IdentityConflictError";
  }
}
