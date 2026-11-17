import { keccak256, toHex } from "viem";

import type { IdentityDirectory } from "./directory";

/**
 * An identity directory for tests: one user and one wallet per e-mail string, derived from it,
 * created at the first lookup. It deliberately does NOT normalise what it receives, so a caller
 * that forgets to normalise gets two users for one person. Records every lookup and can be told
 * to fail. Test code only.
 */
export class FakeIdentityDirectory implements IdentityDirectory {
  /** Every e-mail looked up, as received. */
  readonly lookups: string[] = [];
  private readonly users = new Map<string, { privyUserId: string; walletAddress: string }>();
  private failures: { error: Error; times: number } | undefined;

  /** The next `times` lookups throw `error`. */
  failNext(error: Error, times = 1): void {
    this.failures = { error, times };
  }

  /** How many distinct users the directory holds. */
  get size(): number {
    return this.users.size;
  }

  findOrCreateWalletByEmail(
    email: string,
  ): Promise<{ privyUserId: string; walletAddress: string }> {
    this.lookups.push(email);
    if (this.failures !== undefined && this.failures.times > 0) {
      this.failures.times -= 1;
      const { error } = this.failures;
      if (this.failures.times === 0) this.failures = undefined;
      return Promise.reject(error);
    }
    let user = this.users.get(email);
    if (user === undefined) {
      const digest = keccak256(toHex(`fake-privy:${email}`));
      user = {
        privyUserId: `did:privy:${digest.slice(2, 26)}`,
        walletAddress: `0x${digest.slice(-40)}`,
      };
      this.users.set(email, user);
    }
    return Promise.resolve({ ...user });
  }
}
