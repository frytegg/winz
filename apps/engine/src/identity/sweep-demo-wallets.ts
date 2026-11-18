/**
 * Sweeps the demo wallets back to the treasury (demo mode, SPEC MDB-4). A demo buyer's wallet is
 * derived from the engine's demo seed (`demoWalletKey`), so refunds and payouts sent to it can
 * be moved back. Each wallet's whole native balance (USDC on Arc, 18 decimals natively) is sent
 * to the destination in one plain transfer, minus the gas that transfer costs; empty wallets are
 * skipped. One line per wallet is printed; no key is ever printed or logged.
 *
 *   APP_DEMO_WALLET_SEED=0x… pnpm --filter @winz/engine exec tsx src/identity/sweep-demo-wallets.ts \
 *     --rpc <url> --to <treasury address> (--emails a@x.com,b@y.com | --from-users)
 *
 * The seed is read from the environment only, never from the command line (shell history).
 * `--from-users` reads the e-mails of the users rows the demo directory created (privy_id
 * starting with "demo:") from DB_URL, and skips a row whose wallet is not the derived one.
 * `--rpc` defaults to ARC_RPC_URL. Testnet only: these wallets never hold customers' money.
 */
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  isAddress,
  isHex,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { createDb, type Db } from "../db";
import { DEMO_USER_ID_PREFIX, demoWalletKey } from "./demo-directory";
import { normalizeEmail } from "./directory";

export type SweepStatus = "swept" | "empty" | "mismatch" | "failed";

export interface SweepResult {
  /** The demo wallet (checksummed). */
  address: Address;
  status: SweepStatus;
  /** Wei sent to the destination; 0 unless swept. */
  sentWei: bigint;
  /** Wei paid for gas; 0 unless swept. */
  gasWei: bigint;
  txHash: Hex | null;
}

export interface SweepOptions {
  seed: Hex;
  /** E-mails whose demo wallets are swept; normalised and deduplicated here. */
  emails: readonly string[];
  rpcUrl: string;
  destination: Address;
  /** Receives one line per wallet. */
  out: (line: string) => void;
  /**
   * The wallet the users table holds for each normalised e-mail: a wallet that differs from the
   * derived one is not swept (it was not created by the demo directory with this seed).
   */
  expectedWallets?: ReadonlyMap<string, string>;
}

/** Gas of a plain native transfer to an account without code. */
const TRANSFER_GAS = 21_000n;

/** The sweep cannot start (bad seed, bad destination). Never carries the seed. */
export class SweepConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SweepConfigError";
  }
}

function errorName(error: unknown): string {
  if (error instanceof Error) {
    // viem's short message names the failure without echoing request bodies.
    const short = (error as Error & { shortMessage?: unknown }).shortMessage;
    return typeof short === "string" ? short : error.name;
  }
  return "unknown error";
}

async function chainOf(rpcUrl: string): Promise<{ chain: Chain; client: PublicClient }> {
  const probe = createPublicClient({ transport: http(rpcUrl) });
  const id = await probe.getChainId();
  const chain = defineChain({
    id,
    name: `Chain ${id.toString()}`,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  return { chain, client: createPublicClient({ chain, transport: http(rpcUrl) }) };
}

/**
 * Sends every demo wallet's native balance, minus the gas of the transfer, to `destination`.
 * The fee is paid at one fixed price (max fee = priority fee), so a swept wallet ends at zero.
 * A wallet that fails is reported and the others are still swept.
 */
export async function sweepDemoWallets(options: SweepOptions): Promise<SweepResult[]> {
  if (!isHex(options.seed, { strict: true }) || options.seed.length !== 66) {
    throw new SweepConfigError("the demo seed must be 0x followed by 64 hex digits");
  }
  if (!isAddress(options.destination, { strict: false })) {
    throw new SweepConfigError("the destination is not an address");
  }
  const destination = getAddress(options.destination);
  const { chain, client } = await chainOf(options.rpcUrl);
  const emails = [...new Set(options.emails.map(normalizeEmail).filter((email) => email !== ""))];

  const results: SweepResult[] = [];
  for (const [index, email] of emails.entries()) {
    const account = privateKeyToAccount(demoWalletKey(options.seed, email));
    const label = `wallet ${(index + 1).toString()}/${emails.length.toString()} ${account.address}`;
    const result: SweepResult = {
      address: account.address,
      status: "empty",
      sentWei: 0n,
      gasWei: 0n,
      txHash: null,
    };
    results.push(result);

    const expected = options.expectedWallets?.get(email);
    if (expected !== undefined && expected.toLowerCase() !== account.address.toLowerCase()) {
      result.status = "mismatch";
      options.out(`${label}: users table holds another wallet, skipped`);
      continue;
    }
    if (account.address === destination) {
      options.out(`${label}: is the destination, skipped`);
      continue;
    }
    try {
      const balance = await client.getBalance({ address: account.address });
      const fees = await client.estimateFeesPerGas();
      const price = fees.maxFeePerGas;
      const gasWei = TRANSFER_GAS * price;
      if (balance <= gasWei) {
        options.out(
          `${label}: ${formatUnits(balance, 18)} USDC, not enough to pay the transfer, skipped`,
        );
        continue;
      }
      const value = balance - gasWei;
      const wallet = createWalletClient({ account, chain, transport: http(options.rpcUrl) });
      const txHash = await wallet.sendTransaction({
        to: destination,
        value,
        gas: TRANSFER_GAS,
        maxFeePerGas: price,
        maxPriorityFeePerGas: price,
      });
      const receipt = await client.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error(`transfer ${txHash} reverted`);
      result.status = "swept";
      result.sentWei = value;
      result.gasWei = receipt.gasUsed * receipt.effectiveGasPrice;
      result.txHash = txHash;
      options.out(
        `${label}: swept ${formatUnits(value, 18)} USDC to ${destination} (gas ${formatUnits(result.gasWei, 18)}, tx ${txHash})`,
      );
    } catch (error: unknown) {
      result.status = "failed";
      options.out(`${label}: failed (${errorName(error)})`);
    }
  }
  return results;
}

/** E-mails and wallets of the users rows the demo directory created. */
export async function demoUsers(db: Db): Promise<{ email: string; wallet: string | null }[]> {
  return db<{ email: string; wallet: string | null }[]>`
    select email, wallet from users
     where privy_id like ${`${DEMO_USER_ID_PREFIX}%`}
     order by email
  `;
}

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

const USAGE =
  "usage: APP_DEMO_WALLET_SEED=0x… tsx src/identity/sweep-demo-wallets.ts --rpc <url> --to <address> " +
  "(--emails a@x.com,b@y.com | --from-users)\n";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      rpc: { type: "string" },
      to: { type: "string" },
      emails: { type: "string" },
      "from-users": { type: "boolean", default: false },
    },
    strict: true,
  });
  const seed = process.env.APP_DEMO_WALLET_SEED;
  const rpcUrl = values.rpc ?? process.env.ARC_RPC_URL;
  const fromUsers = values["from-users"] === true;
  if (
    seed === undefined ||
    rpcUrl === undefined ||
    values.to === undefined ||
    (values.emails === undefined) === !fromUsers
  ) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }
  if (!isHex(seed, { strict: true }) || seed.length !== 66) {
    process.stderr.write("APP_DEMO_WALLET_SEED must be 0x followed by 64 hex digits\n");
    process.exitCode = 2;
    return;
  }

  let emails: string[];
  let expectedWallets: Map<string, string> | undefined;
  if (fromUsers) {
    const dbUrl = process.env.DB_URL;
    if (dbUrl === undefined) {
      process.stderr.write("--from-users needs DB_URL\n");
      process.exitCode = 2;
      return;
    }
    const db = createDb(dbUrl, { max: 1 });
    try {
      const rows = await demoUsers(db);
      emails = rows.map((row) => row.email);
      expectedWallets = new Map(
        rows.flatMap((row) => (row.wallet === null ? [] : [[row.email, row.wallet] as const])),
      );
    } finally {
      await db.end({ timeout: 5 });
    }
  } else {
    emails = (values.emails ?? "").split(",");
  }

  const results = await sweepDemoWallets({
    seed,
    emails,
    rpcUrl,
    destination: values.to as Address,
    out,
    ...(expectedWallets === undefined ? {} : { expectedWallets }),
  });
  const swept = results.filter((result) => result.status === "swept");
  const total = swept.reduce((sum, result) => sum + result.sentWei, 0n);
  out(
    `${results.length.toString()} wallets, ${swept.length.toString()} swept, ${formatUnits(total, 18)} USDC sent`,
  );
  if (results.some((result) => result.status === "failed")) process.exitCode = 1;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`sweep failed: ${errorName(error)}\n`);
    process.exitCode = 1;
  });
}
