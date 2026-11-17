import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bytesToHex, type Hex } from "viem";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BUNDLED_ANVIL = resolve(REPO_ROOT, "packages/contracts/node_modules/.bin/anvil");

/** Foundry's public development mnemonic. Its keys are known to everyone: local chains only. */
export const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
/** Arc testnet's chain id, so transactions signed in tests carry the id used in production. */
export const ANVIL_DEFAULT_CHAIN_ID = 5_042_002;

const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 3_000;
const START_ATTEMPTS = 3;

export interface AnvilOptions {
  /** Defaults to Arc testnet's chain id. */
  chainId?: number;
  /** Seconds between blocks. Omitted: a block is mined for every transaction (automine). */
  blockTime?: number;
  /** Start with mining off: transactions stay pending until `evm_mine` or `evm_setAutomine`. */
  noMining?: boolean;
  /** Number of funded development accounts (default 5). */
  accounts?: number;
  /** Base fee of the first block, in wei. Anvil's default is 1 gwei. */
  baseFeeWei?: bigint;
}

export interface AnvilInstance {
  rpcUrl: string;
  port: number;
  chainId: number;
  /** Funded accounts, in anvil's order. */
  accounts: readonly HDAccount[];
  /** Private keys of `accounts`, for code that takes a key rather than an account. */
  privateKeys: readonly Hex[];
  /** Raw JSON-RPC call, for the `anvil_*` and `evm_*` methods. */
  rpc: (method: string, params?: readonly unknown[]) => Promise<unknown>;
  /** Stops the process. Safe to call twice. */
  stop: () => Promise<void>;
}

export class AnvilError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AnvilError";
  }
}

function anvilBinary(): string {
  const fromEnv = process.env.ANVIL_BIN;
  if (fromEnv) return fromEnv;
  // Falls back to the PATH when the contracts package has not installed its own copy.
  return existsSync(BUNDLED_ANVIL) ? BUNDLED_ANVIL : "anvil";
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolvePort(address.port);
        else reject(new AnvilError("could not allocate a port"));
      });
    });
  });
}

async function jsonRpc(
  url: string,
  method: string,
  params: readonly unknown[] = [],
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) {
    throw new AnvilError(`${method} failed: ${body.error.message ?? "unknown error"}`);
  }
  return body.result;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveStop) => {
    const force = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS);
    child.once("exit", () => {
      clearTimeout(force);
      resolveStop();
    });
    child.kill("SIGTERM");
  });
}

async function launch(options: AnvilOptions, port: number): Promise<ChildProcess> {
  const chainId = options.chainId ?? ANVIL_DEFAULT_CHAIN_ID;
  const args = [
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--chain-id",
    String(chainId),
    "--accounts",
    String(options.accounts ?? 5),
    "--mnemonic",
    ANVIL_MNEMONIC,
    "--quiet",
  ];
  if (options.blockTime !== undefined) args.push("--block-time", String(options.blockTime));
  if (options.noMining) args.push("--no-mining");
  if (options.baseFeeWei !== undefined) args.push("--base-fee", options.baseFeeWei.toString());

  const child = spawn(anvilBinary(), args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  let spawnError: Error | undefined;
  child.once("error", (error) => (spawnError = error));

  const url = `http://127.0.0.1:${String(port)}`;
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (spawnError) throw new AnvilError(`anvil could not be started`, { cause: spawnError });
    if (child.exitCode !== null) {
      throw new AnvilError(`anvil exited with code ${String(child.exitCode)}: ${stderr.trim()}`);
    }
    try {
      const answer = await jsonRpc(url, "eth_chainId");
      if (Number(answer) === chainId) return child;
      // Another process took the port between the probe and the spawn.
      await stopProcess(child);
      throw new AnvilError(`port ${String(port)} answers with chain id ${String(answer)}`);
    } catch (error: unknown) {
      if (error instanceof AnvilError) throw error;
      await delay(25);
    }
  }
  await stopProcess(child);
  throw new AnvilError(`anvil did not answer within ${String(START_TIMEOUT_MS)} ms`);
}

/**
 * Starts a local chain on a free port and resolves once it answers. Test helper: the accounts
 * come from Foundry's public mnemonic and must never hold real funds.
 */
export async function startAnvil(options: AnvilOptions = {}): Promise<AnvilInstance> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= START_ATTEMPTS; attempt += 1) {
    const port = await freePort();
    let child: ChildProcess;
    try {
      child = await launch(options, port);
    } catch (error: unknown) {
      // Most likely a port race with another test worker: try another port.
      lastError = error;
      continue;
    }
    const rpcUrl = `http://127.0.0.1:${String(port)}`;
    const count = options.accounts ?? 5;
    const accounts = Array.from({ length: count }, (_, addressIndex) =>
      mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex }),
    );
    const privateKeys = accounts.map((account) => {
      const key = account.getHdKey().privateKey;
      if (!key) throw new AnvilError("development account without a private key");
      return bytesToHex(key);
    });
    return {
      rpcUrl,
      port,
      chainId: options.chainId ?? ANVIL_DEFAULT_CHAIN_ID,
      accounts,
      privateKeys,
      rpc: (method, params) => jsonRpc(rpcUrl, method, params),
      stop: () => stopProcess(child),
    };
  }
  throw new AnvilError(`anvil could not be started after ${String(START_ATTEMPTS)} attempts`, {
    cause: lastError,
  });
}
