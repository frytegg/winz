import { BlockList, isIP } from "node:net";

import postgres, { type Sql } from "postgres";

import { webEnv } from "./env";

/** Postgres client of the web app. Same settings as the engine's (`apps/engine/src/db.ts`). */
export type Db = Sql;

/**
 * Seconds an unused connection is kept before the client closes it. Short, because a deployed
 * instance is kept awake after its responses until this has run out (`untilIdleConnectionsClosed`):
 * Vercel's guide to connection pooling advises about 5 s for that wait.
 */
export const WEB_DB_IDLE_TIMEOUT_S = 5;

/**
 * The name the web's connections carry in `pg_stat_activity` (`application_name`), so that a
 * connection left behind by a frozen instance can be told from the engine's. `PGAPPNAME`, or an
 * `application_name` in the URL, still wins.
 */
export const WEB_DB_APPLICATION_NAME = "winz-web";

// ---------------------------------------------------------------------------------------------
// TLS
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
 * The hosts Postgres.js connects to for `url`, read the way it reads them
 * (node_modules/postgres/src/index.js, `parseUrl` and `hosts`): the `host` URL parameter, else the
 * URL's own host list, else `PGHOST`, else `localhost`.
 */
export function databaseHosts(
  url: string,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const { targets, query } = splitUrl(url);
  const given = query.get("host");
  const list = (text: string, decoded: boolean): string[] =>
    text
      .split(",")
      .filter((target) => target !== "")
      .map((target) => (decoded ? decode(hostOf(target)) : hostOf(target)));
  if (given !== null && given !== "") return list(given, false);
  const fromUrl = list(targets, true).filter((host) => host !== "");
  if (fromUrl.length > 0) return fromUrl;
  return list(env.PGHOST ?? "localhost", false);
}

/**
 * The `ssl` option of a client for `url`: `"require"` when it reaches a host that is not local and
 * nothing says otherwise, `undefined` (Postgres.js's own reading) when every host is local or when
 * the URL (`sslmode`, `ssl`, `sslrootcert`, `sslcert`, `sslkey`) or `PGSSLMODE`/`PGSSL` sets TLS
 * explicitly: an explicit setting keeps its meaning, `sslmode=disable` included.
 *
 * What `"require"` checks, in Postgres.js 4.1.1 (src/socket.js, `secureOptions`; src/startup.js,
 * `negotiate`): the client asks for TLS before anything else and stops with `SSL_NOT_SUPPORTED`
 * when the server declines, so nothing is ever sent in clear; it encrypts with
 * `rejectUnauthorized: false`, so it does NOT verify the certificate chain or the host name (as
 * libpq's `sslmode=require`). That is the mode Supabase documents for its pooler: its certificate
 * is signed by Supabase's own root, which is not in Node's trust store, so verifying needs that
 * root on disk (`sslmode=verify-full&sslrootcert=<file>` in the URL, which this function then
 * leaves alone). Encryption stops anyone reading the traffic; a man in the middle with a
 * certificate of his own is what only `verify-full` stops.
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
// Client
// ---------------------------------------------------------------------------------------------

/**
 * Builds a client: `bigint` columns (money, quantities, on-chain ids) come back as JavaScript
 * `bigint`, never as `number`; prepared statements are off, so a pooler that does not support
 * them can sit in front; TLS is required for any host that is not local (`databaseSsl`).
 *
 * Deployed, the client must go through a pooler in SESSION mode, not in transaction mode:
 * Postgres.js sends queued queries down a busy connection without waiting for the previous
 * answer (pipelining) once more queries are waiting than it has connections, and Supabase's
 * documentation warns that through its transaction pooler this "can hang queries or return
 * mismatched rows", with no option of the client that turns it off (docs/deploy.md, step 1.4).
 * In session mode a client connection keeps its own Postgres connection, so the answers cannot be
 * mixed; the price is that connections are scarce, hence a small pool and a short idle timeout.
 *
 * `idleTimeoutS` exists for tests, which shorten the wait; the server uses the default.
 */
export function createWebDb(
  url: string,
  options: { max?: number; idleTimeoutS?: number } = {},
): Db {
  return postgres(url, {
    max: options.max ?? 5,
    idle_timeout: options.idleTimeoutS ?? WEB_DB_IDLE_TIMEOUT_S,
    prepare: false,
    types: { bigint: postgres.BigInt },
    onnotice: () => undefined,
    ssl: databaseSsl(url),
    connection: process.env.PGAPPNAME ? {} : { application_name: WEB_DB_APPLICATION_NAME },
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

// ---------------------------------------------------------------------------------------------
// Closing idle connections before the instance is frozen
// ---------------------------------------------------------------------------------------------

/**
 * Extra time after the idle timeout, for the client's timer to fire and its goodbye to the
 * server to leave the machine.
 */
export const IDLE_CLOSE_MARGIN_MS = 1_000;
/** How often the wait looks at the pool. */
const IDLE_POLL_MS = 50;

/** What the wait reads of a client: its pool and its idle timeout. */
export type IdleWatchedDb = Pick<Db, "stats"> & { options: Pick<Db["options"], "idle_timeout"> };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The wait of one client: resolves once its pool holds no connection at all, or at the latest its
 * idle timeout plus `IDLE_CLOSE_MARGIN_MS` after the most recent call, whichever comes first.
 * Calls that overlap share one wait (the same promise), whose deadline each of them pushes back:
 * a burst of requests keeps the instance awake for one timeout after the last of them, not one
 * per request.
 */
export class IdleConnectionWait {
  private deadline = 0;
  private pending: Promise<void> | undefined;

  constructor(
    private readonly db: IdleWatchedDb,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** The bound of one wait, in milliseconds: 0 for a client without an idle timeout. */
  boundMs(): number {
    const idle = this.db.options.idle_timeout;
    return typeof idle === "number" && idle > 0 ? idle * 1000 + IDLE_CLOSE_MARGIN_MS : 0;
  }

  /** See the class. */
  wait(): Promise<void> {
    // Without an idle timeout the client never closes its connections: there is nothing to wait for.
    const bound = this.boundMs();
    if (bound === 0) return Promise.resolve();
    this.deadline = Math.max(this.deadline, this.now() + bound);
    this.pending ??= this.watch().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async watch(): Promise<void> {
    for (;;) {
      const { connections, opening } = this.db.stats;
      if (connections === 0 && opening === 0) return;
      const left = this.deadline - this.now();
      if (left <= 0) return;
      await sleep(Math.min(IDLE_POLL_MS, left));
    }
  }
}

const waits = new WeakMap<IdleWatchedDb, IdleConnectionWait>();

/**
 * Resolves once `db` has closed its idle connections (see `IdleConnectionWait`), bounded by its
 * idle timeout plus a margin. What a deployed instance waits for before it may be frozen: Vercel
 * suspends an instance right after its responses, and a suspended client's idle timer does not
 * run, so without this wait its connections stay open, held from the pooler, until the instance
 * is destroyed.
 */
export function untilIdleConnectionsClosed(db: IdleWatchedDb): Promise<void> {
  let wait = waits.get(db);
  if (!wait) {
    wait = new IdleConnectionWait(db);
    waits.set(db, wait);
  }
  return wait.wait();
}
