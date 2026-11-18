/** The demo wallet sweep, on a local anvil chain (and a real Postgres for `--from-users`). */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  getAddress,
  http,
  parseEther,
  recoverTransactionAddress,
  type Address,
  type Hex,
} from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startAnvil, type AnvilInstance } from "../testing/anvil";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { demoWalletAddress, demoWalletKey } from "./demo-directory";
import { demoUsers, sweepDemoWallets } from "./sweep-demo-wallets";

/** Test seed: public, local chain only. */
const SEED: Hex = `0x${"5e".repeat(32)}`;
const TREASURY: Address = "0x00000000000000000000000000000000000Fee01";

let anvil: AnvilInstance;

beforeAll(async () => {
  anvil = await startAnvil();
});

afterAll(async () => {
  await anvil?.stop();
});

async function balanceOf(address: Address): Promise<bigint> {
  return createPublicClient({ transport: http(anvil.rpcUrl) }).getBalance({ address });
}

async function fund(address: Address, wei: bigint): Promise<void> {
  await anvil.rpc("anvil_setBalance", [address, `0x${wei.toString(16)}`]);
}

async function nonceOf(address: Address): Promise<number> {
  return createPublicClient({ transport: http(anvil.rpcUrl) }).getTransactionCount({ address });
}

/** Gas paid by the swept transfers whose hashes the output lines name. */
async function gasOfLines(lines: readonly string[]): Promise<bigint> {
  const client = createPublicClient({ transport: http(anvil.rpcUrl) });
  let total = 0n;
  for (const line of lines) {
    const hash = /tx (0x[0-9a-f]{64})/.exec(line)?.[1] as Hex | undefined;
    if (hash === undefined) continue;
    const receipt = await client.getTransactionReceipt({ hash });
    total += receipt.gasUsed * receipt.effectiveGasPrice;
  }
  return total;
}

/**
 * Fails the test if `text` holds the seed or the key of one of `emails`, in any case. The
 * assertion messages name what leaked, never the secret itself.
 */
function expectNoSecret(text: string, emails: readonly string[]): void {
  const lower = text.toLowerCase();
  for (const email of emails) {
    const key = demoWalletKey(SEED, email).slice(2).toLowerCase();
    expect(lower.includes(key), `the key of ${email} is in the output`).toBe(false);
  }
  expect(lower.includes(SEED.slice(2).toLowerCase()), "the seed is in the output").toBe(false);
}

/**
 * A JSON-RPC endpoint in front of anvil that refuses, as a node does, the signed transfers of
 * the given senders, and passes every other request through.
 */
async function refusingRpc(
  refused: readonly Address[],
): Promise<{ url: string; close: () => Promise<void> }> {
  const senders = new Set(refused.map((address) => address.toLowerCase()));
  const answer = async (body: string): Promise<string> => {
    const request = JSON.parse(body) as { id: unknown; method: string; params?: unknown[] };
    if (request.method === "eth_sendRawTransaction") {
      const serializedTransaction = request.params?.[0] as Parameters<
        typeof recoverTransactionAddress
      >[0]["serializedTransaction"];
      const sender = await recoverTransactionAddress({ serializedTransaction });
      if (senders.has(sender.toLowerCase())) {
        return JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32003, message: "transaction rejected" },
        });
      }
    }
    const upstream = await fetch(anvil.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    return upstream.text();
  };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      answer(Buffer.concat(chunks).toString())
        .then((text) => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(text);
        })
        .catch(() => {
          response.writeHead(502);
          response.end();
        });
    });
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return {
    url: `http://127.0.0.1:${address.port.toString()}`,
    close: () =>
      new Promise<void>((closed) => {
        server.close(() => closed());
      }),
  };
}

const SCRIPT = fileURLToPath(new URL("./sweep-demo-wallets.ts", import.meta.url));
const ENGINE_DIR = resolve(dirname(SCRIPT), "../..");
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

interface CommandRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the sweep command as an operator does. Its environment is built here, from the test seed
 * and `env` only: nothing of the developer's environment reaches it but PATH.
 */
async function runSweepCommand(
  args: readonly string[],
  env: Record<string, string> = {},
): Promise<CommandRun> {
  return new Promise((done, failed) => {
    const child = spawn(process.execPath, [TSX_CLI, SCRIPT, ...args], {
      cwd: ENGINE_DIR,
      env: { PATH: process.env.PATH ?? "", APP_DEMO_WALLET_SEED: SEED, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.once("error", failed);
    child.once("close", (code) => {
      done({ code, stdout, stderr });
    });
  });
}

describe("sweepDemoWallets", () => {
  it("sends each funded demo wallet's balance minus gas to the destination and skips empty ones", async () => {
    const maya = demoWalletAddress(SEED, "maya@example.com") as Address;
    const theo = demoWalletAddress(SEED, "theo@example.com") as Address;
    const empty = demoWalletAddress(SEED, "nobody@example.com") as Address;
    await fund(maya, parseEther("12.5"));
    await fund(theo, parseEther("0.75"));

    const lines: string[] = [];
    const results = await sweepDemoWallets({
      seed: SEED,
      // Two spellings of one e-mail: swept once.
      emails: ["maya@example.com", " Theo@Example.com", "nobody@example.com", "MAYA@example.com"],
      rpcUrl: anvil.rpcUrl,
      destination: TREASURY,
      out: (line) => lines.push(line),
    });

    expect(results.map((result) => result.status)).toEqual(["swept", "swept", "empty"]);
    expect(await balanceOf(maya)).toBe(0n);
    expect(await balanceOf(theo)).toBe(0n);
    expect(await balanceOf(empty)).toBe(0n);
    const [mayaResult, theoResult] = results;
    expect((mayaResult?.sentWei ?? 0n) + (mayaResult?.gasWei ?? 0n)).toBe(parseEther("12.5"));
    expect((theoResult?.sentWei ?? 0n) + (theoResult?.gasWei ?? 0n)).toBe(parseEther("0.75"));
    expect(await balanceOf(TREASURY)).toBe(
      (mayaResult?.sentWei ?? 0n) + (theoResult?.sentWei ?? 0n),
    );

    // One line per wallet, and no key in any of them.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("swept 12.49");
    expect(lines[2]).toContain("skipped");
    const keys = ["maya@example.com", "theo@example.com", "nobody@example.com"].map((email) =>
      demoWalletKey(SEED, email).slice(2).toLowerCase(),
    );
    for (const line of lines) {
      for (const key of keys) expect(line.toLowerCase()).not.toContain(key);
      expect(line.toLowerCase()).not.toContain(SEED.slice(2));
    }

    // A second run finds nothing left.
    const again = await sweepDemoWallets({
      seed: SEED,
      emails: ["maya@example.com", "theo@example.com"],
      rpcUrl: anvil.rpcUrl,
      destination: TREASURY,
      out: () => undefined,
    });
    expect(again.map((result) => result.status)).toEqual(["empty", "empty"]);
  });

  it("skips a wallet the users table records differently", async () => {
    const derived = demoWalletAddress(SEED, "other@example.com") as Address;
    await fund(derived, parseEther("1"));
    const results = await sweepDemoWallets({
      seed: SEED,
      emails: ["other@example.com"],
      rpcUrl: anvil.rpcUrl,
      destination: TREASURY,
      out: () => undefined,
      expectedWallets: new Map([["other@example.com", `0x${"ab".repeat(20)}`]]),
    });
    expect(results.map((result) => result.status)).toEqual(["mismatch"]);
    expect(await balanceOf(derived)).toBe(parseEther("1"));
  });

  it("skips as empty a wallet whose balance does not cover the gas of its own transfer", async () => {
    const destination: Address = "0x00000000000000000000000000000000000Fee03";
    const dusty = demoWalletAddress(SEED, "dust@example.com") as Address;
    const dust = 1_000_000_000_000n;
    const fees = await createPublicClient({ transport: http(anvil.rpcUrl) }).estimateFeesPerGas();
    // Dust indeed: below what the 21 000 gas of the transfer would cost.
    expect(dust).toBeLessThan(21_000n * fees.maxFeePerGas);
    await fund(dusty, dust);

    const lines: string[] = [];
    const results = await sweepDemoWallets({
      seed: SEED,
      emails: ["dust@example.com"],
      rpcUrl: anvil.rpcUrl,
      destination,
      out: (line) => lines.push(line),
    });

    expect(results).toEqual([
      { address: getAddress(dusty), status: "empty", sentWei: 0n, gasWei: 0n, txHash: null },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("not enough to pay the transfer, skipped");
    expect(await balanceOf(dusty)).toBe(dust);
    expect(await nonceOf(dusty)).toBe(0);
    expect(await balanceOf(destination)).toBe(0n);
  });

  it("reports a wallet whose transfer fails, prints no key or seed for it, and sweeps the others", async () => {
    const destination: Address = "0x00000000000000000000000000000000000Fee04";
    const emails = ["first@example.com", "refused@example.com", "last@example.com"];
    const [first, refused, last] = emails.map(
      (email) => demoWalletAddress(SEED, email) as Address,
    ) as [Address, Address, Address];
    await fund(first, parseEther("2"));
    await fund(refused, parseEther("3"));
    await fund(last, parseEther("4"));
    const rpc = await refusingRpc([refused]);
    try {
      const lines: string[] = [];
      const results = await sweepDemoWallets({
        seed: SEED,
        emails,
        rpcUrl: rpc.url,
        destination,
        out: (line) => lines.push(line),
      });

      expect(results.map((result) => result.status)).toEqual(["swept", "failed", "swept"]);
      expect(results[1]).toMatchObject({ sentWei: 0n, gasWei: 0n, txHash: null });
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain(`${getAddress(refused)}: failed (`);
      for (const line of lines) expectNoSecret(line, emails);
      expect(await balanceOf(refused)).toBe(parseEther("3"));
      expect(await nonceOf(refused)).toBe(0);
      expect(await balanceOf(first)).toBe(0n);
      expect(await balanceOf(last)).toBe(0n);
      expect(await balanceOf(destination)).toBe(parseEther("6") - (await gasOfLines(lines)));

      // The command itself: one failure makes it exit 1, and nothing it writes holds a secret.
      await fund(first, parseEther("2"));
      await fund(last, parseEther("4"));
      const run = await runSweepCommand([
        "--rpc",
        rpc.url,
        "--to",
        destination,
        "--emails",
        emails.join(","),
      ]);
      expect(run.code).toBe(1);
      const output = run.stdout.trim().split("\n");
      expect(output).toHaveLength(4);
      expect(output[1]).toContain(`${getAddress(refused)}: failed (`);
      expect(output[3]).toMatch(/^3 wallets, 2 swept, 5\.99\d* USDC sent$/);
      expectNoSecret(run.stdout, emails);
      expectNoSecret(run.stderr, emails);
      expect(await balanceOf(refused)).toBe(parseEther("3"));
      expect(await balanceOf(first)).toBe(0n);
      expect(await balanceOf(last)).toBe(0n);
    } finally {
      await rpc.close();
    }
  }, 60_000);
});

describe("demoUsers and --from-users", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.drop();
  });

  it("reads the demo directory's rows only, skips a mismatched wallet and sweeps the others", async () => {
    const { db } = database;
    const destination: Address = "0x00000000000000000000000000000000000Fee05";
    const derived = (email: string): Address => demoWalletAddress(SEED, email) as Address;
    const strangerWallet = `0x${"cd".repeat(20)}`;
    await db`
      insert into users (email, privy_id, wallet) values
        ('ana@example.com', 'demo:ana', ${derived("ana@example.com").toLowerCase()}),
        ('ben@example.com', 'demo:ben', ${strangerWallet}),
        ('cleo@example.com', 'did:privy:cleo', ${derived("cleo@example.com").toLowerCase()}),
        ('dan@example.com', null, null),
        ('fred@example.com', 'did:privy:demo:fred', null),
        ('gus@example.com', 'demo:gus', null)
    `;

    expect(await demoUsers(db)).toEqual([
      { email: "ana@example.com", wallet: derived("ana@example.com").toLowerCase() },
      { email: "ben@example.com", wallet: strangerWallet },
      { email: "gus@example.com", wallet: null },
    ]);

    for (const email of ["ana", "ben", "cleo", "dan", "fred", "gus"]) {
      await fund(derived(`${email}@example.com`), parseEther("1"));
    }
    const run = await runSweepCommand(
      ["--rpc", anvil.rpcUrl, "--to", destination, "--from-users"],
      { DB_URL: database.url },
    );

    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    const output = run.stdout.trim().split("\n");
    expect(output).toHaveLength(4);
    expect(output[0]).toContain(`wallet 1/3 ${getAddress(derived("ana@example.com"))}: swept 0.99`);
    expect(output[1]).toBe(
      `wallet 2/3 ${getAddress(derived("ben@example.com"))}: users table holds another wallet, skipped`,
    );
    expect(output[2]).toContain(`wallet 3/3 ${getAddress(derived("gus@example.com"))}: swept 0.99`);
    expect(output[3]).toMatch(/^3 wallets, 2 swept, 1\.99\d* USDC sent$/);
    expectNoSecret(run.stdout, ["ana@example.com", "ben@example.com", "gus@example.com"]);

    // Swept: the two demo rows whose wallet is the derived one (or not recorded yet).
    expect(await balanceOf(derived("ana@example.com"))).toBe(0n);
    expect(await balanceOf(derived("gus@example.com"))).toBe(0n);
    expect(await balanceOf(destination)).toBe(parseEther("2") - (await gasOfLines(output)));
    // Nothing sent from or for the mismatched row, nor for rows the demo directory did not create.
    for (const email of ["ben", "cleo", "dan", "fred"]) {
      const wallet = derived(`${email}@example.com`);
      expect(await balanceOf(wallet)).toBe(parseEther("1"));
      expect(await nonceOf(wallet)).toBe(0);
    }
  }, 60_000);
});
