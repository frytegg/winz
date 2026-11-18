/**
 * The rehearsal command (gate G2, Q-03, Q-04). From apps/web:
 *
 *   ARC_RELAYER_PRIVATE_KEY=… ARC_ORACLE_PRIVATE_KEY=… APP_DEMO_WALLET_SEED=… \
 *     pnpm exec tsx e2e/rehearsal/run.ts --rpc-url <url> --throwaway-db [--estimate]
 *
 * See `USAGE` in cli.ts and the "Répétition" section of apps/web/README.md. It exits 0 when every
 * invariant passed (or after `--estimate`), 1 when the run failed or an invariant failed, 2 when
 * it refused to start. Ctrl-C stops the engine, sweeps the demo wallets and writes a FAILED
 * receipt before exiting.
 *
 * With `--recover <receipt.json> --db-url <kept database>` it finishes the campaign that run left
 * behind instead: exit 0 when the campaign is released and nothing is left behind (or after
 * `--estimate`), 1 otherwise (it can be run again), 2 when it refused to start.
 */
import { CliError, USAGE, parseCli, type CliResult } from "./cli";
import { recoverRehearsal, runRehearsal } from "./runner";
import {
  createThrowawayDatabase,
  keepsThrowawayDatabase,
  type ThrowawayDatabase,
} from "./throwaway-db";
import { RehearsalRefusedError } from "./types";

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<number> {
  // The web routes' logger prints to stdout: only its warnings and errors.
  process.env.APP_LOG_LEVEL ??= "warn";
  let parsed;
  try {
    parsed = parseCli(process.argv.slice(2), process.env);
  } catch (error: unknown) {
    if (error instanceof CliError) {
      process.stderr.write(
        `${error.problems.map((problem) => `error: ${problem}`).join("\n")}\n\n${USAGE}`,
      );
      return 2;
    }
    throw error;
  }

  const controller = new AbortController();
  let interrupts = 0;
  const interrupt = (): void => {
    interrupts += 1;
    if (interrupts === 1) {
      out("interrupted: stopping the engine, sweeping the demo wallets, writing the receipt");
      controller.abort();
    } else {
      out("still finishing (the sweep and the receipt protect the test funds)");
    }
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);

  if (parsed.recover !== null) return recover(parsed, parsed.recover, controller.signal);

  let database: ThrowawayDatabase | null = null;
  let keepDatabase = false;
  try {
    let databaseUrl = parsed.databaseUrl;
    if (parsed.throwawayDb && !parsed.options.estimateOnly) {
      database = await createThrowawayDatabase();
      databaseUrl = database.url;
      out("throwaway database created with every migration applied");
    }
    out(`engine log: ${parsed.options.engineLogFile ?? "none"}`);
    const receipt = await runRehearsal({
      ...parsed.options,
      databaseUrl: databaseUrl ?? "postgres://unused-for-an-estimate",
      out,
      signal: controller.signal,
    });
    if (database !== null && keepsThrowawayDatabase(receipt)) {
      keepDatabase = true;
      out(
        `the campaign is not released on-chain: the throwaway database is KEPT for its recovery (see "Récupérer une campagne bloquée" in apps/web/README.md)`,
      );
      out(`  database: ${database.url}`);
      out(`  server data directory: ${await database.dataDirectory().catch(() => "unknown")}`);
      if (receipt.files !== undefined) {
        out(
          `  recover it with: pnpm exec tsx e2e/rehearsal/run.ts --recover ${receipt.files.json} --db-url ${database.url}`,
        );
      }
    }
    return receipt.status === "failed" ? 1 : 0;
  } catch (error: unknown) {
    if (error instanceof RehearsalRefusedError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    process.stderr.write(
      `rehearsal error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    if (!keepDatabase) await database?.drop().catch(() => undefined);
  }
}

async function recover(
  parsed: CliResult,
  receiptPath: string,
  signal: AbortSignal,
): Promise<number> {
  const { options } = parsed;
  try {
    out(`engine log: ${options.engineLogFile ?? "none"}`);
    const receipt = await recoverRehearsal({
      receiptPath,
      databaseUrl: parsed.databaseUrl ?? "",
      rpcUrl: options.rpcUrl,
      ...(options.rpcFallbackUrl === undefined ? {} : { rpcFallbackUrl: options.rpcFallbackUrl }),
      chainId: options.chainId,
      local: options.local,
      escrowAddress: options.escrowAddress,
      escrowDeployBlock: options.escrowDeployBlock,
      ...(options.rpcLimits === undefined ? {} : { rpcLimits: options.rpcLimits }),
      secrets: options.secrets,
      gemini: options.gemini,
      estimateOnly: options.estimateOnly,
      ...(options.engineLogFile === undefined ? {} : { engineLogFile: options.engineLogFile }),
      out,
      signal,
    });
    return receipt.status === "failed" ? 1 : 0;
  } catch (error: unknown) {
    if (error instanceof RehearsalRefusedError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    process.stderr.write(
      `recovery error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(
      `rehearsal crashed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  },
);
