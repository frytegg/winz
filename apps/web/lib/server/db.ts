import postgres, { type Sql } from "postgres";

import { webEnv } from "./env";

/** Postgres client of the web app. Same settings as the engine's (`apps/engine/src/db.ts`). */
export type Db = Sql;

/**
 * Builds a client: `bigint` columns (money, quantities, on-chain ids) come back as JavaScript
 * `bigint`, never as `number`; prepared statements are off so it also works through Supabase's
 * transaction pooler.
 */
export function createWebDb(url: string, options: { max?: number } = {}): Db {
  return postgres(url, {
    max: options.max ?? 5,
    prepare: false,
    types: { bigint: postgres.BigInt },
    onnotice: () => undefined,
  });
}

let client: Db | undefined;

/**
 * The shared client, created on first use from `DB_URL` and reused by every later invocation of
 * the same server instance. Never created at import time, so `next build` needs no database.
 */
export function getDb(): Db {
  client ??= createWebDb(webEnv().DB_URL);
  return client;
}
