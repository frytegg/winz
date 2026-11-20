import { BlockList, isIP } from "node:net";

import postgres, { type Sql } from "postgres";

export type Db = Sql;

// ---------------------------------------------------------------------------------------------
// TLS. The same rule as the web app's client (apps/web/lib/server/db.ts, `databaseSsl`), written
// on both sides because the two apps share no server code: change both or neither.
// ---------------------------------------------------------------------------------------------

/** URL parameters by which the URL itself says how to use TLS; Postgres.js then decides alone. */
const TLS_URL_PARAMETERS = ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey"] as const;

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

/**
 * A host that never leaves this machine: a Unix socket directory, `localhost`, or a loopback
 * address (127.0.0.0/8, `::1`, and their IPv4-mapped form).
 */
export function isLocalDatabaseHost(host: string): boolean {
  if (host.includes("/")) return true;
  if (host.toLowerCase() === "localhost") return true;
  const family = isIP(host);
  if (family === 4) return LOOPBACK.check(host, "ipv4");
  if (family === 6) return LOOPBACK.check(host, "ipv6");
  return false;
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    // Not percent-encoded after all: Postgres.js keeps it as written too.
    return part;
  }
}

/** `host[:port]` or `[ipv6][:port]` → the host, as Postgres.js splits a host list. */
function hostOf(target: string): string {
  const match = /^\[([^\]]*)\](?::\d*)?$/.exec(target) ?? /^([^:]*)(?::\d*)?$/.exec(target);
  return match?.[1] ?? target;
}

/** A connection URL cut as Postgres.js cuts it (node_modules/postgres/src/index.js, `parseUrl`). */
function splitUrl(url: string): { targets: string; query: URLSearchParams } {
  const rest = url.slice(url.indexOf("://") + 3);
  const end = rest.search(/[/?]/);
  const authority = end === -1 ? rest : rest.slice(0, end);
  return {
    targets: authority.slice(authority.lastIndexOf("@") + 1),
    query: new URL(`postgres://x${end === -1 ? "" : rest.slice(end)}`).searchParams,
  };
}

/**
 * The hosts Postgres.js connects to for `url`, read the way it reads them (`hosts` in its
 * src/index.js): the `host` URL parameter, else the URL's host list, else `PGHOST`, else localhost.
 */
function databaseHosts(url: string, env: Record<string, string | undefined>): string[] {
  const { targets, query } = splitUrl(url);
  const list = (text: string, decoded: boolean): string[] =>
    text
      .split(",")
      .filter((target) => target !== "")
      .map((target) => (decoded ? decode(hostOf(target)) : hostOf(target)));
  const given = query.get("host");
  if (given !== null && given !== "") return list(given, false);
  const fromUrl = list(targets, true).filter((host) => host !== "");
  if (fromUrl.length > 0) return fromUrl;
  return list(env.PGHOST ?? "localhost", false);
}

/**
 * The `ssl` option of a client for `url`: `"require"` when it reaches a host that is not local and
 * nothing says otherwise; `undefined` (Postgres.js's own reading: no TLS by default) when every
 * host is local, or when the URL (`sslmode`, `ssl`, `sslrootcert`, `sslcert`, `sslkey`) or
 * `PGSSLMODE`/`PGSSL` sets TLS explicitly, `sslmode=disable` included.
 *
 * `"require"` in Postgres.js 4.1.1 (src/startup.js `negotiate`, src/socket.js `secureOptions`):
 * TLS is asked for before anything else and the connection fails with `SSL_NOT_SUPPORTED` when the
 * server declines, so nothing goes out in clear; the certificate is NOT verified
 * (`rejectUnauthorized: false`, as libpq's `sslmode=require`), because Supabase's pooler presents
 * a certificate of Supabase's own root, absent from Node's trust store. Verifying needs that root
 * on disk: `sslmode=verify-full&sslrootcert=<file>` in the URL, which is then left as it is.
 */
export function databaseSsl(
  url: string,
  env: Record<string, string | undefined> = process.env,
): "require" | undefined {
  const { query } = splitUrl(url);
  if (TLS_URL_PARAMETERS.some((name) => query.has(name))) return undefined;
  if ((env.PGSSLMODE ?? "") !== "" || (env.PGSSL ?? "") !== "") return undefined;
  return databaseHosts(url, env).every(isLocalDatabaseHost) ? undefined : "require";
}

// ---------------------------------------------------------------------------------------------
// Time bounds of the client. Postgres.js 4.1.1 has none by default (`query_timeout` and
// `queue_timeout` 0): a query sent on a connection that goes silent (a pooler that stops answering
// on one connection, a network path that drops packets without a reset) waits for as long as TCP
// takes to notice, and forever when the peer still acknowledges at the TCP level. That froze every
// sale state for about 98 minutes on 19-20 November 2026 while the other connections of the pool
// kept working. A server-side `statement_timeout` cannot help there: the server never got, or never
// answered, the statement.
// ---------------------------------------------------------------------------------------------

/** The client's time bounds, in seconds (Postgres.js's units). */
export interface DbTimeouts {
  /**
   * Longest time one query may take, waiting for a connection and running together (inside a
   * transaction: from the moment it is sent, `begin` and `commit` included). Past it the client
   * asks the server to cancel it and rejects it with `QUERY_TIMEOUT`.
   */
  queryTimeoutS: number;
  /** Longest wait for a connection of a query, a transaction or a reserved connection. */
  queueTimeoutS: number;
  /**
   * Longest wait for the server to answer a cancel. Past it the connection is closed (its queries
   * reject with `CONNECTION_DESTROYED`, whether they ran being unknown, as on a lost connection)
   * and the pool connects again for the next query: what gets rid of a silent connection.
   */
  cancelTimeoutS: number;
  /**
   * An idle connection is closed after this long, so that a connection a NAT or the pooler may
   * have dropped silently while it sat unused is not the one the next query is sent on.
   */
  idleTimeoutS: number;
  /** TCP keep-alive of every connection (Postgres.js's default, written down). */
  keepAliveS: number;
}

/**
 * The engine's bounds. The longest legitimate statement of the engine is a few seconds: every
 * transaction it runs is database work only (none awaits the chain, Gemini or Stripe while it holds
 * a lock; `withExclusiveLock`'s transaction stays open while its handler runs, but idle, which no
 * bound here counts), the sale states cap their own statements at 5 s on the server
 * (`sales/store.ts`), and the largest writes, the catalogue's upserts, go by batches of at most
 * 1 000 rows (`market-data/pg-catalog-store.ts`).
 * 30 s is six times the sale states' own server-side limit and far above any of them, and short
 * enough that a dead connection is closed (30 s, then 5 s for the cancel) within the 60 s after
 * which `/healthz` reports the sale states stale. The connection wait gets the same 30 s: the job
 * worker keeps connections free by construction (`startJobs` refuses a concurrency at the pool's
 * size), so a longer wait means a pool held by stuck work, and failing fast lets the caller retry.
 */
export const ENGINE_DB_TIMEOUTS: DbTimeouts = {
  queryTimeoutS: 30,
  queueTimeoutS: 30,
  cancelTimeoutS: 5,
  idleTimeoutS: 120,
  keepAliveS: 60,
};

/**
 * Postgres client of the engine. `bigint` columns (money, quantities, on-chain ids) come back as
 * JavaScript `bigint`, never as `number`. Prepared statements are off so the client also works
 * through Supabase's transaction pooler. TLS is required for any host that is not local
 * (`databaseSsl`); the local test databases are reached as before. Every query, transaction and
 * connection wait is bounded (`ENGINE_DB_TIMEOUTS`; tests pass shorter ones).
 */
export function createDb(url: string, options: { max?: number } & Partial<DbTimeouts> = {}): Db {
  const bounds: DbTimeouts = { ...ENGINE_DB_TIMEOUTS };
  for (const key of Object.keys(ENGINE_DB_TIMEOUTS) as (keyof DbTimeouts)[]) {
    const value = options[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`createDb: ${key} must be a positive number of seconds`);
    }
    bounds[key] = value;
  }
  return postgres(url, {
    max: options.max ?? 10,
    prepare: false,
    types: { bigint: postgres.BigInt },
    onnotice: () => undefined,
    ssl: databaseSsl(url),
    query_timeout: bounds.queryTimeoutS,
    queue_timeout: bounds.queueTimeoutS,
    cancel_timeout: bounds.cancelTimeoutS,
    idle_timeout: bounds.idleTimeoutS,
    keep_alive: bounds.keepAliveS,
  });
}
