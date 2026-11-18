import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { getAddress, isAddress, type Address, type Hex } from "viem";

import { ARC_TESTNET_CHAIN_ID, parseUsd } from "@winz/shared";

import { resolveOddsLag } from "./odds";
import type {
  GeminiMode,
  OddsLagOptions,
  RehearsalOptions,
  RpcLimitsInput,
  ScenarioInput,
} from "./types";

/**
 * The command line of the rehearsal: flags and environment into `RehearsalOptions`. Pure apart
 * from reading the committed deployment record. Keys and the seed come from the environment
 * only, never from a flag (a flag ends up in the shell history).
 */

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");

export const USAGE = `usage: tsx e2e/rehearsal/run.ts [flags]   (from apps/web)
       tsx e2e/rehearsal/run.ts --recover <receipt.json> --db-url <kept database> [--estimate]

Environment (secrets only from here):
  ARC_RELAYER_PRIVATE_KEY, ARC_ORACLE_PRIVATE_KEY, APP_DEMO_WALLET_SEED   required
  DB_URL, ARC_RPC_URL, ARC_RPC_FALLBACK_URL, ARC_CHAIN_ID, ARC_ESCROW_ADDRESS,
  ARC_ESCROW_DEPLOY_BLOCK, GEMINI_API_URL, GEMINI_WS_URL, APP_HTTPS_PROXY_URL, APP_PROXY_CA_FILE
  The request limiter shared by the engine and the runner (optional, as in the engine):
  ARC_RPC_MAX_REQUESTS_PER_SECOND (default 10), ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND (4),
  ARC_RPC_HEAVY_METHODS (comma-separated, default eth_getLogs)

Flags (each overrides its variable):
  --db-url <url> | --throwaway-db      a database with every migration, or a throwaway one
                                       (throwaway without --deploy-block: the engine reads the
                                       chain from the head at the start, minus 50 blocks)
  --rpc-url <url> --rpc-fallback-url <url> --chain-id <id> [--local]
  --escrow <address> --deploy-block <n>  (default: packages/contracts/deployments/<chain id>.json)
  --purchases <n=12> --units <n=1> --unit-price <usdc=0.50> --refund-pct <pct=100>
  --usual-margin-pct <pct=65> --min-margin-pct <pct=45> --budget <usdc> --outcome <yes|no>
  --buyers <n=6> --parallel <n=3> --gemini <live|simulated>
  The lag of the ticket's odds behind the book (criterion 7, receipt section "Ticket odds"):
  --odds-samples <n=10>     prices the driven book is set to, each followed to the ticket
  --odds-timeout <s=10>     a price not readable on the ticket within this is a failed sample
  --odds-window <s=60>      live Gemini only: how long the campaign's live row is watched before
                            the book is driven; 0 skips it
  --odds-poll-ms <ms=50>    how often the ticket's sources are read while waiting
  --estimate            print the addresses, the balances and the worst case, send nothing
  --receipt-dir <dir>   default docs/rehearsals on Arc testnet, a temp directory elsewhere
  --engine-log <file>   the engine's JSON log (default: a temp file)
  --recover <receipt.json>  finish the campaign a FAILED run left behind, from its receipt and
                        the database it kept (--db-url or DB_URL; never --throwaway-db), then
                        sweep its wallets; writes <receipt>-recovery.json and .md next to it.
                        With --estimate: the checks and the campaign's state only, nothing sent
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
  /** `--recover`: the receipt of the run whose campaign is to be finished (absolute path). */
  recover: string | null;
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

function positiveNumber(
  problems: string[],
  name: string,
  value: string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(number) || number <= 0) {
    problems.push(`${name} must be a positive number`);
    return undefined;
  }
  return number;
}

/** The limiter's variables, as the engine reads them (`ARC_RPC_MAX_*`, `ARC_RPC_HEAVY_METHODS`). */
function rpcLimitsOf(problems: string[], env: Env): RpcLimitsInput | undefined {
  const all = positiveNumber(
    problems,
    "ARC_RPC_MAX_REQUESTS_PER_SECOND",
    nonEmpty(env.ARC_RPC_MAX_REQUESTS_PER_SECOND),
  );
  const heavy = positiveNumber(
    problems,
    "ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND",
    nonEmpty(env.ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND),
  );
  const methodsText = nonEmpty(env.ARC_RPC_HEAVY_METHODS);
  const methods = methodsText
    ?.split(",")
    .map((method) => method.trim())
    .filter((method) => method !== "");
  const limits: RpcLimitsInput = {
    ...(all === undefined ? {} : { maxRequestsPerSecond: all }),
    ...(heavy === undefined ? {} : { maxHeavyRequestsPerSecond: heavy }),
    ...(methods === undefined ? {} : { heavyMethods: methods }),
  };
  return Object.keys(limits).length === 0 ? undefined : limits;
}

/** Flags of the odds measure: a recovery measures nothing. */
const ODDS_FLAGS = ["odds-samples", "odds-timeout", "odds-window", "odds-poll-ms"] as const;

/** Seconds, with at most three decimals, → whole milliseconds. */
function seconds(problems: string[], name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+(\.\d{1,3})?$/.test(value)) {
    problems.push(`${name} must be a number of seconds, e.g. 10 or 2.5`);
    return undefined;
  }
  return Math.round(Number(value) * 1_000);
}

/** Flags of the scenario: they describe a new run, not the recovery of an old one. */
const SCENARIO_FLAGS = [
  "purchases",
  "units",
  "unit-price",
  "refund-pct",
  "usual-margin-pct",
  "min-margin-pct",
  "budget",
  "outcome",
  "buyers",
  "parallel",
] as const;

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
  const blockGiven = values["deploy-block"] ?? nonEmpty(env.ARC_ESCROW_DEPLOY_BLOCK);
  const blockText = blockGiven ?? deployment?.deployedAtBlock.toString();
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
  const recover = values.recover === undefined ? null : resolve(values.recover);
  if (recover !== null) {
    if (throwawayDb) {
      problems.push(
        "--recover needs the database the run kept (--db-url or DB_URL), never --throwaway-db",
      );
    } else if (databaseUrl === null) {
      problems.push("--recover needs the database the run kept: --db-url or DB_URL");
    }
    const scenarioFlags = SCENARIO_FLAGS.filter((flag) => values[flag] !== undefined);
    if (scenarioFlags.length > 0) {
      problems.push(
        `${scenarioFlags.map((flag) => `--${flag}`).join(", ")}: the scenario is the receipt's, not the command's, with --recover`,
      );
    }
    const oddsFlags = ODDS_FLAGS.filter((flag) => values[flag] !== undefined);
    if (oddsFlags.length > 0) {
      problems.push(
        `${oddsFlags.map((flag) => `--${flag}`).join(", ")}: a recovery measures no odds`,
      );
    }
  } else if (!throwawayDb && databaseUrl === null && values.estimate !== true) {
    // An estimate reads the chain only.
    problems.push("no database: --db-url, DB_URL, or --throwaway-db");
  }
  const rpcLimits = rpcLimitsOf(problems, env);

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

  const oddsLag: Partial<OddsLagOptions> = {};
  const samples = integer(problems, "--odds-samples", values["odds-samples"]);
  if (samples !== undefined) oddsLag.samples = samples;
  const timeout = seconds(problems, "--odds-timeout", values["odds-timeout"]);
  if (timeout !== undefined) oddsLag.sampleTimeoutMs = timeout;
  const window = seconds(problems, "--odds-window", values["odds-window"]);
  if (window !== undefined) oddsLag.liveWindowMs = window;
  const poll = integer(problems, "--odds-poll-ms", values["odds-poll-ms"]);
  if (poll !== undefined) oddsLag.pollMs = poll;
  const oddsProblems = resolveOddsLag(oddsLag).problems;
  if (Object.keys(oddsLag).length > 0) problems.push(...oddsProblems);

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
      ...(Object.keys(oddsLag).length === 0 ? {} : { oddsLag }),
      gemini,
      // A fresh database needs nothing that happened before the run.
      startNearHead: throwawayDb && blockGiven === undefined,
      ...(rpcLimits === undefined ? {} : { rpcLimits }),
      estimateOnly: values.estimate === true,
      receiptDir: resolve(receiptDir),
      engineLogFile,
    },
    databaseUrl,
    throwawayDb,
    recover,
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
    "odds-samples"?: string;
    "odds-timeout"?: string;
    "odds-window"?: string;
    "odds-poll-ms"?: string;
    estimate?: boolean;
    "receipt-dir"?: string;
    "engine-log"?: string;
    recover?: string;
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
      "odds-samples": { type: "string" },
      "odds-timeout": { type: "string" },
      "odds-window": { type: "string" },
      "odds-poll-ms": { type: "string" },
      estimate: { type: "boolean" },
      "receipt-dir": { type: "string" },
      "engine-log": { type: "string" },
      recover: { type: "string" },
    },
  });
}
