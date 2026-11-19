/**
 * Syncs the real Gemini sports catalogue and the recent settlements into Postgres, once.
 *
 *   DB_URL=postgres://… pnpm --filter @winz/engine exec tsx src/market-data/sync-once.ts
 *
 * Reads two variables and nothing else of the engine configuration:
 *   DB_URL          Postgres connection string, with the migrations applied (required)
 *   GEMINI_API_URL  base URL of the Gemini REST API (default https://api.gemini.com)
 * `APP_LOG_LEVEL` (default "warn") sets how much of the sync is logged to stdout as JSON.
 *
 * Only public Gemini endpoints are read, without an API key. Exit code 0 on success, 1 when the
 * sync failed, 2 when the configuration is wrong.
 */
import { createDb, type Db } from "../db";
import { createLogger, moduleLogger } from "../logger";

import { GeminiError, describeError } from "./errors";
import { GeminiRestClient } from "./gemini-rest-client";
import { PgCatalogStore } from "./pg-catalog-store";
import { loadSportsCatalog, storeCatalog, syncSettlements } from "./sync";
import { SyncOnceConfigError, loadSyncOnceEnv } from "./sync-once-env";

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

interface TableCounts {
  events: bigint;
  instruments: bigint;
  active: bigint;
  quoted: bigint;
  settled: bigint;
}

async function tableCounts(db: Db): Promise<TableCounts> {
  const [row] = await db<TableCounts[]>`
    select
      (select count(*) from events) as events,
      count(*) as instruments,
      count(*) filter (where active) as active,
      count(*) filter (where best_bid_bps is not null and best_ask_bps is not null) as quoted,
      count(*) filter (where outcome is not null) as settled
    from instruments
  `;
  if (!row) throw new Error("sync-once: the count query returned no row");
  return row;
}

async function main(): Promise<void> {
  const env = loadSyncOnceEnv(process.env);
  const logger = moduleLogger(
    createLogger({ level: env.APP_LOG_LEVEL, pretty: false }),
    "market-data-sync-once",
  );
  const client = new GeminiRestClient({ baseUrl: env.GEMINI_API_URL, logger });
  const db = createDb(env.DB_URL, { max: 2 });
  try {
    const store = new PgCatalogStore(db);
    const catalog = await loadSportsCatalog(client, logger);
    const synced = await storeCatalog(catalog, store);
    // The whole settled list (Gemini keeps about a day of it), bounded by SETTLED_MAX_PAGES.
    const settled = await syncSettlements(client, store, logger);
    const counts = await tableCounts(db);

    const incomplete = catalog.leagues.filter((league) => !league.complete);
    out(
      `catalogue: ${catalog.leagues.length.toString()} leagues read with ` +
        `${catalog.requests.toString()} requests, ${catalog.completeLeagues.length.toString()} complete` +
        (incomplete.length === 0
          ? ""
          : ` (incomplete: ${incomplete.map((league) => `${league.league}: ${league.reason ?? "?"}`).join("; ")})`),
    );
    out(
      `catalogue: ${synced.events.toString()} events and ${synced.instruments.toString()} instruments ` +
        `written, ${catalog.skipped.length.toString()} items skipped, ` +
        `${synced.delisted.toString()} instruments newly delisted`,
    );
    out(
      `settlements: ${settled.events.toString()} settled events read in ${settled.pages.toString()} pages ` +
        `(${settled.complete ? "to the end of the list" : "stopped at the bound"}), ` +
        `${settled.newlySettled.toString()} instruments newly settled, ` +
        `${settled.conflicts.toString()} contradicted games`,
    );
    out(
      `database: ${counts.events.toString()} events, ${counts.instruments.toString()} instruments ` +
        `(${counts.active.toString()} active, ${counts.quoted.toString()} quoted on both sides, ` +
        `${counts.settled.toString()} settled)`,
    );
  } finally {
    await db.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  if (error instanceof SyncOnceConfigError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  const detail = error instanceof GeminiError ? error.message : describeError(error);
  process.stderr.write(`sync-once failed: ${detail}\n`);
  process.exitCode = 1;
});
