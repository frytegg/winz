import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { Logger } from "pino";
import { z } from "zod";

import type { Db } from "../db";

/**
 * The engine's health listener: one route, `GET /healthz`, for the platform's health check
 * (Railway reads it during a deploy). Off unless `PORT` is set, so local runs and tests listen on
 * nothing. Built on node:http, no dependency.
 *
 * It reads what the engine already knows: its start time, the cursor of the escrow's event reader
 * (a database read, which is also the database probe), the chain's head (one `eth_blockNumber`)
 * and whether the transaction sender and the job worker run. It never answers a secret, a key's
 * address or an e-mail.
 */

/**
 * `PORT`, read apart from the engine's own schema (`config/env.ts`), which this listener does not
 * change. Unset or empty: no listener. Railway sets it for every service.
 */
export const engineHealthEnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).optional(),
});

export class HealthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HealthConfigError";
  }
}

/** The port to listen on, or undefined when `PORT` is unset or empty. Throws on a malformed one. */
export function healthPortFromEnv(
  source: Record<string, string | undefined> = process.env,
): number | undefined {
  const raw = source.PORT;
  const result = engineHealthEnvSchema.safeParse(
    raw === undefined || raw === "" ? {} : { PORT: raw },
  );
  if (!result.success) {
    throw new HealthConfigError(
      `Invalid environment:\n${result.error.issues.map((issue) => `  - PORT: ${issue.message}`).join("\n")}`,
    );
  }
  return result.data.PORT;
}

export type ServiceState = "running" | "stopped";

/** What `/healthz` reads. Production passes the engine's own parts; tests pass fakes. */
export interface HealthSources {
  db: Db;
  /** Reads the chain's head. The engine's public client satisfies it. */
  chain: { getBlockNumber(): Promise<bigint> };
  chainId: number;
  /** Row of `chain_cursor` of the escrow's event reader (`defaultCursorName(escrow)`). */
  cursorName: string;
  startedAt: Date;
  /** Whether the transaction sender and the job worker run right now. */
  services: () => { sender: ServiceState; jobs: ServiceState };
  /** Epoch milliseconds. Defaults to the system clock. */
  now?: () => number;
  /** How long the database and the node each get to answer. Default 2 000 ms. */
  timeoutMs?: number;
}

const serviceStateSchema = z.enum(["running", "stopped"]);

/** Body of `GET /healthz`, 200 or 503. `pnpm smoke --engine` checks a deployed engine against it. */
export const healthReportSchema = z
  .object({
    status: z.enum(["ok", "unavailable"]),
    startedAt: z.iso.datetime(),
    uptimeS: z.number().int().nonnegative(),
    chain: z
      .object({
        id: z.number().int().positive(),
        head: z.number().int().nonnegative().nullable(),
        cursor: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    db: z.enum(["ok", "down"]),
    sender: serviceStateSchema,
    jobs: serviceStateSchema,
  })
  .strict();

export type HealthReport = z.infer<typeof healthReportSchema>;

export const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;

class HealthTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} did not answer within ${ms.toString()} ms`);
    this.name = "HealthTimeoutError";
  }
}

/** `promise`, or a rejection after `ms`. A late rejection of `promise` is swallowed, never unhandled. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  promise.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new HealthTimeoutError(what, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Reads the engine's health. 200 when the database and the node both answered within the timeout
 * and the sender and the job worker run; 503 otherwise (a stopping engine answers 503 too).
 */
export async function readHealth(
  sources: HealthSources,
): Promise<{ httpStatus: 200 | 503; report: HealthReport }> {
  const now = sources.now ?? Date.now;
  const timeoutMs = sources.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;

  const cursorQuery = (async (): Promise<number | null> => {
    const rows = await sources.db<{ block_number: bigint | number | string }[]>`
      select block_number from chain_cursor where name = ${sources.cursorName}
    `;
    const row = rows[0];
    return row === undefined ? null : Number(row.block_number);
  })();
  const [cursor, head] = await Promise.allSettled([
    within(cursorQuery, timeoutMs, "database"),
    within(sources.chain.getBlockNumber(), timeoutMs, "node"),
  ]);

  const services = sources.services();
  const dbOk = cursor.status === "fulfilled";
  const nodeOk = head.status === "fulfilled";
  const ok = dbOk && nodeOk && services.sender === "running" && services.jobs === "running";
  return {
    httpStatus: ok ? 200 : 503,
    report: {
      status: ok ? "ok" : "unavailable",
      startedAt: sources.startedAt.toISOString(),
      uptimeS: Math.max(0, Math.floor((now() - sources.startedAt.getTime()) / 1_000)),
      chain: {
        id: sources.chainId,
        head: head.status === "fulfilled" ? Number(head.value) : null,
        cursor: cursor.status === "fulfilled" ? cursor.value : null,
      },
      db: dbOk ? "ok" : "down",
      sender: services.sender,
      jobs: services.jobs,
    },
  };
}

export interface HealthServer {
  /** The port it listens on (the one asked, or the one the system gave for 0). */
  port: number;
  /** Stops listening and closes every open connection. Resolves once the port is free. */
  close(): Promise<void>;
}

export interface HealthServerOptions extends HealthSources {
  port: number;
  /** Default: every interface, as a platform's probe needs. */
  host?: string;
  logger: Logger;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text).toString(),
  });
  response.end(text);
}

/** Starts the listener. Resolves once it listens; rejects when the port cannot be bound. */
export async function startHealthServer(options: HealthServerOptions): Promise<HealthServer> {
  const log = options.logger;
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = (request.url ?? "/").split("?")[0];
    if (path !== "/healthz") {
      send(response, 404, { error: "not found" });
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, { error: "method not allowed" });
      return;
    }
    readHealth(options)
      .then(({ httpStatus, report }) => {
        if (httpStatus !== 200) log.warn({ health: report }, "health check failed");
        send(response, httpStatus, report);
      })
      .catch((error: unknown) => {
        log.error({ err: error }, "health check could not be read");
        send(response, 503, { status: "unavailable" });
      });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(options.port, options.host, () => {
      server.off("error", onError);
      resolve();
    });
  });
  server.on("error", (error: Error) => log.error({ err: error }, "health listener error"));
  const port = (server.address() as AddressInfo).port;
  log.info({ port, path: "/healthz" }, "health listener started");

  let closing: Promise<void> | undefined;
  return {
    port,
    close: (): Promise<void> => {
      closing ??= new Promise<void>((resolve) => {
        server.close(() => {
          log.info({ port }, "health listener stopped");
          resolve();
        });
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
