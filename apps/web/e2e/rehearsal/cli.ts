import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { getAddress, isAddress, type Address, type Hex } from "viem";

import { ARC_TESTNET_CHAIN_ID, parseUsd } from "@winz/shared";

import type { GeminiMode, RehearsalOptions, ScenarioInput } from "./types";

/**
 * The command line of the rehearsal: flags and environment into `RehearsalOptions`. Pure apart
 * from reading the committed deployment record. Keys and the seed come from the environment
 * only, never from a flag (a flag ends up in the shell history).
 */

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");

export const USAGE = `usage: tsx e2e/rehearsal/run.ts [flags]   (from apps/web)

Environment (secrets only from here):
  ARC_RELAYER_PRIVATE_KEY, ARC_ORACLE_PRIVATE_KEY, APP_DEMO_WALLET_SEED   required
  DB_URL, ARC_RPC_URL, ARC_RPC_FALLBACK_URL, ARC_CHAIN_ID, ARC_ESCROW_ADDRESS,
  ARC_ESCROW_DEPLOY_BLOCK, GEMINI_API_URL, GEMINI_WS_URL, APP_HTTPS_PROXY_URL, APP_PROXY_CA_FILE

Flags (each overrides its variable):
  --db-url <url> | --throwaway-db      a database with every migration, or a throwaway one
  --rpc-url <url> --rpc-fallback-url <url> --chain-id <id> [--local]
  --escrow <address> --deploy-block <n>  (default: packages/contracts/deployments/<chain id>.json)
  --purchases <n=12> --units <n=1> --unit-price <usdc=0.50> --refund-pct <pct=100>
  --usual-margin-pct <pct=65> --min-margin-pct <pct=45> --budget <usdc> --outcome <yes|no>
  --buyers <n=6> --parallel <n=3> --gemini <live|simulated>
  --estimate            print the addresses, the balances and the worst case, send nothing
  --receipt-dir <dir>   default docs/rehearsals on Arc testnet, a temp directory elsewhere
  --engine-log <file>   the engine's JSON log (default: a temp file)
`;

export class CliError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(problems.join("\n"));
    this.name = "CliError";
  }
}

export interface CliResult {
  options: Omit<RehearsalOptions, "out" | "signal" | "databaseUrl">;
  /** Null with `throwawayDb`. */
  databaseUrl: string | null;
  throwawayDb: boolean;
}

type Env = Record<string, string | undefined>;

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function integer(problems: string[], name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    problems.push(`${name} must be a whole number`);
    return undefined;
  }
  return Number(value);
}

/** "65" or "65.5" percent → basis points. */
export function percentToBps(value: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value);
  if (match === null) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

function percent(problems: string[], name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const bps = percentToBps(value);
  if (bps === null) {
    problems.push(`${name} must be a percentage with at most two decimals, e.g. 65 or 12.5`);
    return undefined;
  }
  return bps;
}

function usdc(problems: string[], name: string, value: string | undefined): bigint | undefined {
  if (value === undefined) return undefined;
  try {
    return parseUsd(value);
  } catch {
    problems.push(`${name} must be an amount in USDC, e.g. 0.50`);
    return undefined;
  }
}

interface Deployment {
  escrow: string;
  deployedAtBlock: number;
}

function deploymentOf(chainId: number): Deployment | null {
  const path = join(REPO_ROOT, "packages/contracts/deployments", `${chainId.toString()}.json`);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Deployment>;
  if (typeof parsed.escrow !== "string" || typeof parsed.deployedAtBlock !== "number") return null;
  return { escrow: parsed.escrow, deployedAtBlock: parsed.deployedAtBlock };
}

function secret(problems: string[], env: Env, name: string): Hex {
  const value = nonEmpty(env[name]);
  if (value === undefined) {
    problems.push(`${name} is not set (secrets are read from the environment only)`);
    return "0x";
  }
  return value as Hex;
}

/** Flags and environment → options, or a `CliError` listing every problem. */
export function parseCli(argv: readonly string[], env: Env): CliResult {
  let values: ReturnType<typeof parse>["values"];
  try {
    values = parse(argv).values;
  } catch (error: unknown) {
    throw new CliError([error instanceof Error ? error.message : "unreadable flags"]);
  }
  const problems: string[] = [];

  const chainId =
    integer(problems, "--chain-id", values["chain-id"] ?? nonEmpty(env.ARC_CHAIN_ID)) ??
    ARC_TESTNET_CHAIN_ID;
  const local = values.local === true;
  const deployment = deploymentOf(chainId);

  const rpcUrl = values["rpc-url"] ?? nonEmpty(env.ARC_RPC_URL);
  if (rpcUrl === undefined) problems.push("the RPC URL is missing (--rpc-url or ARC_RPC_URL)");
  const rpcFallbackUrl = values["rpc-fallback-url"] ?? nonEmpty(env.ARC_RPC_FALLBACK_URL);

  const escrowText = values.escrow ?? nonEmpty(env.ARC_ESCROW_ADDRESS) ?? deployment?.escrow;
  let escrowAddress: Address = "0x0000000000000000000000000000000000000000";
  if (escrowText === undefined || !isAddress(escrowText, { strict: false })) {
    problems.push("the escrow address is missing or malformed (--escrow or ARC_ESCROW_ADDRESS)");
  } else {
    escrowAddress = getAddress(escrowText);
  }
  const blockText =
    values["deploy-block"] ??
    nonEmpty(env.ARC_ESCROW_DEPLOY_BLOCK) ??
    deployment?.deployedAtBlock.toString();
  let escrowDeployBlock = 0n;
  if (blockText === undefined || !/^\d+$/.test(blockText)) {
    problems.push(
      "the escrow's deploy block is missing (--deploy-block or ARC_ESCROW_DEPLOY_BLOCK)",
    );
  } else {
    escrowDeployBlock = BigInt(blockText);
  }

  const throwawayDb = values["throwaway-db"] === true;
  const databaseUrl = values["db-url"] ?? nonEmpty(env.DB_URL) ?? null;
  if (throwawayDb && values["db-url"] !== undefined)
    problems.push("--db-url and --throwaway-db exclude each other");
  // An estimate reads the chain only.
  if (!throwawayDb && databaseUrl === null && values.estimate !== true) {
    problems.push("no database: --db-url, DB_URL, or --throwaway-db");
  }

  const outcome = values.outcome;
  if (outcome !== undefined && outcome !== "yes" && outcome !== "no")
    problems.push("--outcome must be yes or no");
  const scenario: ScenarioInput = {};
  const set = <K extends keyof ScenarioInput>(
    key: K,
    value: ScenarioInput[K] | undefined,
  ): void => {
    if (value !== undefined) scenario[key] = value;
  };
  set("purchases", integer(problems, "--purchases", values.purchases));
  set("unitsPerPurchase", integer(problems, "--units", values.units));
  set("unitPrice", usdc(problems, "--unit-price", values["unit-price"]));
  set("refundBps", percent(problems, "--refund-pct", values["refund-pct"]));
  set("usualMarginBps", percent(problems, "--usual-margin-pct", values["usual-margin-pct"]));
  set("minMarginBps", percent(problems, "--min-margin-pct", values["min-margin-pct"]));
  set("budget", usdc(problems, "--budget", values.budget));
  set("outcome", outcome === "yes" || outcome === "no" ? outcome : undefined);
  set("buyers", integer(problems, "--buyers", values.buyers));
  set("parallel", integer(problems, "--parallel", values.parallel));

  const geminiKind = values.gemini ?? "live";
  let gemini: GeminiMode = { kind: "simulated" };
  if (geminiKind === "live") {
    const proxyUrl = nonEmpty(env.APP_HTTPS_PROXY_URL);
    const caFile = nonEmpty(env.APP_PROXY_CA_FILE);
    gemini = {
      kind: "live",
      apiUrl: nonEmpty(env.GEMINI_API_URL) ?? "https://api.gemini.com",
      wsUrl: nonEmpty(env.GEMINI_WS_URL) ?? "wss://ws.gemini.com",
      ...(proxyUrl === undefined ? {} : { proxyUrl }),
      ...(caFile === undefined ? {} : { caFile }),
    };
  } else if (geminiKind !== "simulated") {
    problems.push("--gemini must be live or simulated");
  }

  const secrets = {
    relayerKey: secret(problems, env, "ARC_RELAYER_PRIVATE_KEY"),
    oracleKey: secret(problems, env, "ARC_ORACLE_PRIVATE_KEY"),
    demoSeed: secret(problems, env, "APP_DEMO_WALLET_SEED"),
  };

  const receiptDir =
    values["receipt-dir"] ??
    (chainId === ARC_TESTNET_CHAIN_ID && !local
      ? join(REPO_ROOT, "docs/rehearsals")
      : join(tmpdir(), "winz-rehearsals"));
  const engineLogFile =
    values["engine-log"] ?? join(tmpdir(), `winz-rehearsal-engine-${Date.now().toString()}.log`);

  if (problems.length > 0) throw new CliError(problems);
  return {
    options: {
      rpcUrl: rpcUrl ?? "",
      ...(rpcFallbackUrl === undefined ? {} : { rpcFallbackUrl }),
      chainId,
      local,
      escrowAddress,
      escrowDeployBlock,
      secrets,
      scenario,
      gemini,
      estimateOnly: values.estimate === true,
      receiptDir: resolve(receiptDir),
      engineLogFile,
    },
    databaseUrl,
    throwawayDb,
  };
}

function parse(argv: readonly string[]): {
  values: {
    "db-url"?: string;
    "throwaway-db"?: boolean;
    "rpc-url"?: string;
    "rpc-fallback-url"?: string;
    "chain-id"?: string;
    local?: boolean;
    escrow?: string;
    "deploy-block"?: string;
    purchases?: string;
    units?: string;
    "unit-price"?: string;
    "refund-pct"?: string;
    "usual-margin-pct"?: string;
    "min-margin-pct"?: string;
    budget?: string;
    outcome?: string;
    buyers?: string;
    parallel?: string;
    gemini?: string;
    estimate?: boolean;
    "receipt-dir"?: string;
    "engine-log"?: string;
  };
} {
  return parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      "db-url": { type: "string" },
      "throwaway-db": { type: "boolean" },
      "rpc-url": { type: "string" },
      "rpc-fallback-url": { type: "string" },
      "chain-id": { type: "string" },
      local: { type: "boolean" },
      escrow: { type: "string" },
      "deploy-block": { type: "string" },
      purchases: { type: "string" },
      units: { type: "string" },
      "unit-price": { type: "string" },
      "refund-pct": { type: "string" },
      "usual-margin-pct": { type: "string" },
      "min-margin-pct": { type: "string" },
      budget: { type: "string" },
      outcome: { type: "string" },
      buyers: { type: "string" },
      parallel: { type: "string" },
      gemini: { type: "string" },
      estimate: { type: "boolean" },
      "receipt-dir": { type: "string" },
      "engine-log": { type: "string" },
    },
  });
}
