import postgres, { type Sql } from "postgres";

import { webEnv } from "./env";

/** Postgres client of the web app. Same settings as the engine's (`apps/engine/src/db.ts`). */
export type Db = Sql;

/** Seconds an unused connection is kept before it is closed, so that an idle instance gives its
 *  connections back to the pooler instead of holding them until it is frozen. */
export const WEB_DB_IDLE_TIMEOUT_S = 20;

/**
 * Builds a client: `bigint` columns (money, quantities, on-chain ids) come back as JavaScript
 * `bigint`, never as `number`; prepared statements are off, so a pooler that does not support
 * them can sit in front.
 *
 * Deployed, the client must go through a pooler in SESSION mode, not in transaction mode:
 * Postgres.js sends queued queries down a busy connection without waiting for the previous
 * answer (pipelining) once more queries are waiting than it has connections, and Supabase's
 * documentation warns that through its transaction pooler this "can hang queries or return
 * mismatched rows", with no option of the client that turns it off (docs/deploy.md, step 1.4).
 * In session mode a client connection keeps its own Postgres connection, so the answers cannot be
 * mixed; the price is that connections are scarce, hence a small pool and a short idle timeout.
 */
export function createWebDb(url: string, options: { max?: number } = {}): Db {
  return postgres(url, {
    max: options.max ?? 5,
    idle_timeout: WEB_DB_IDLE_TIMEOUT_S,
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
  const env = webEnv();
  client ??= createWebDb(env.DB_URL, { max: env.DB_POOL_MAX });
  return client;
}
