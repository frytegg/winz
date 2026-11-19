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

/**
 * Postgres client of the engine. `bigint` columns (money, quantities, on-chain ids) come back as
 * JavaScript `bigint`, never as `number`. Prepared statements are off so the client also works
 * through Supabase's transaction pooler. TLS is required for any host that is not local
 * (`databaseSsl`); the local test databases are reached as before.
 */
export function createDb(url: string, options: { max?: number } = {}): Db {
  return postgres(url, {
    max: options.max ?? 10,
    prepare: false,
    types: { bigint: postgres.BigInt },
    onnotice: () => undefined,
    ssl: databaseSsl(url),
  });
}
