import {
  concat,
  hexToBytes,
  isHex,
  keccak256,
  size,
  stringToBytes,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  IdentityError,
  InvalidEmailError,
  normalizeEmail,
  type IdentityDirectory,
} from "./directory";

/** Prefix of the synthetic user ids the demo directory gives (stored in users.privy_id). */
export const DEMO_USER_ID_PREFIX = "demo:";

/** The demo seed is not a 32-byte hex string. Its value is never put in the message. */
export class DemoSeedError extends IdentityError {
  constructor() {
    super("the demo wallet seed must be a 32-byte hex string (0x followed by 64 hex digits)");
    this.name = "DemoSeedError";
  }
}

function checkSeed(seed: Hex): void {
  if (!isHex(seed, { strict: true }) || size(seed) !== 32) throw new DemoSeedError();
}

function normalizedOrThrow(email: string): string {
  const normalized = normalizeEmail(email);
  if (normalized === "") throw new InvalidEmailError();
  return normalized;
}

/**
 * The private key of the demo wallet of an e-mail: keccak256(seed || normalised e-mail as
 * UTF-8). Deterministic, so the engine (and the sweep script) can derive it again to move the
 * testnet funds refunded to a demo buyer back to the treasury. A SECRET: never log it, never
 * print it, never store it.
 */
export function demoWalletKey(seed: Hex, email: string): Hex {
  checkSeed(seed);
  return keccak256(concat([hexToBytes(seed), stringToBytes(normalizedOrThrow(email))]));
}

/** The address of the demo wallet of an e-mail (lowercase), from `demoWalletKey`. */
export function demoWalletAddress(seed: Hex, email: string): Address {
  const key = demoWalletKey(seed, email);
  let address: Address;
  try {
    address = privateKeyToAccount(key).address;
  } catch {
    // keccak256 gave zero or a value above the curve order: about one chance in 2^128. The
    // library's error is dropped on purpose: it could quote the key.
    throw new IdentityError("the derived demo key is not a valid secp256k1 key");
  }
  return address.toLowerCase() as Address;
}

/** The stable synthetic user id of an e-mail: "demo:" and 32 hex digits of a hash of it. */
export function demoUserId(email: string): string {
  const digest = keccak256(toHex(`winz-demo-user:${normalizedOrThrow(email)}`));
  return `${DEMO_USER_ID_PREFIX}${digest.slice(2, 34)}`;
}

/**
 * An identity directory for the demo: one wallet per normalised e-mail, derived from a 32-byte
 * secret seed (`demoWalletKey`), and a synthetic user id (`demoUserId`). No network call, no
 * Privy account: the buyer cannot log in to this wallet. Demo wallets are NOT customers'
 * wallets; this exists for demo sales and for running without Privy credentials only.
 */
export class DemoIdentityDirectory implements IdentityDirectory {
  constructor(private readonly seed: Hex) {
    checkSeed(seed);
  }

  findOrCreateWalletByEmail(
    email: string,
  ): Promise<{ privyUserId: string; walletAddress: string }> {
    try {
      return Promise.resolve({
        privyUserId: demoUserId(email),
        walletAddress: demoWalletAddress(this.seed, email),
      });
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  }
}

/**
 * The engine's identity directory: the real one (Privy) when it is configured, the demo one
 * otherwise.
 *
 * DEMO ONLY: without Privy credentials every buyer gets a demo wallet, derived from the engine's
 * demo seed and held by nobody but the engine. Demo wallets are NOT customers' wallets: a real
 * customer must never be given one. Run without Privy only for the demo, on the testnet.
 */
export class RoutingIdentityDirectory implements IdentityDirectory {
  constructor(
    private readonly real: IdentityDirectory | null,
    private readonly demo: IdentityDirectory,
  ) {}

  /** Whether lookups go to the demo directory. */
  get usesDemoWallets(): boolean {
    return this.real === null;
  }

  findOrCreateWalletByEmail(
    email: string,
  ): Promise<{ privyUserId: string; walletAddress: string }> {
    return (this.real ?? this.demo).findOrCreateWalletByEmail(email);
  }
}
