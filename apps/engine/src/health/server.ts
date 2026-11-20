import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { Logger } from "pino";
import { z } from "zod";

import type { Db } from "../db";
import type { LeaseView } from "../leader/leader";
import type { LoopReport } from "./loops";

/**
 * The engine's health listener: one route, `GET /healthz`, for the platform's health check
 * (Render checks it during a deploy and every few seconds after it). Off unless `PORT` is set, so
 * local runs and tests listen on nothing. Built on node:http, no dependency.
 *
 * It reads what the engine already knows: its start time, the cursor of the escrow's event reader
 * (a database read, which is also the database probe), the chain's head (one `eth_blockNumber`),
 * whether the transaction sender and the job worker run, the engine lease as this process sees it
 * (src/leader: `role` "leader" or "standby", without any query of its own), and when each of the
 * leader's long-running loops last completed a pass (`health/loops.ts`): a loop that has gone
 * longer than its bound without one makes the answer 503 and is named in `staleLoops`. It never
 * answers a secret, a key's address or an e-mail.
 *
 * The URL is public: one probe (one query, one node call) serves every request that arrives while
 * it runs, and its answer is reused for `DEFAULT_HEALTH_CACHE_MS` (2 s). Only that I/O is cached:
 * the role, the services and the lease are read from the process on every request, so a leader
 * that begins to stop (or fences itself) answers 503 at once, not up to 2 s later.
 */

/**
 * `PORT`, read apart from the engine's own schema (`config/env.ts`), which this listener does not
 * change. Unset or empty: no listener. Render sets it (10000 by default) on every web service.
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
  /** The engine lease as this process sees it (`EngineLeader.view()`). */
  lease: () => LeaseView;
  /**
   * The leader's long-running loops and when each last completed a pass (`LoopMonitor.report`).
   * Empty, or absent, while no engine runs.
   */
  loops?: () => readonly LoopReport[];
  /**
   * Whether a stale or stopped loop makes the leader answer 503 (`APP_HEALTH_FAIL_ON_STALE_LOOPS`).
   * Off, the loops are still reported (`loops`, `staleLoops`) and logged, but the answer stays 200:
   * a platform health check that restarts the service on 503 is only pointed at the loops once
   * they have been seen healthy in production. Defaults to true.
   */
  failOnStaleLoops?: boolean;
  /** Epoch milliseconds. Defaults to the system clock. */
  now?: () => number;
  /** How long the database and the node each get to answer. Default 2 000 ms. */
  timeoutMs?: number;
}

const serviceStateSchema = z.enum(["running", "stopped"]);

/**
 * The lease in the report. Leader: its own holder id, held since, renewed this long ago. Standby:
 * the holder of the live lease it saw last (null when the lease is free), held since, its latest
 * renewal. The holder id is a short random id drawn at the process's start (`eng-` and 12 hex
 * characters): it names a process, it opens nothing.
 */
const leaseReportSchema = z
  .object({
    holder: z
      .string()
      .regex(/^[a-z0-9-]{8,64}$/)
      .nullable(),
    heldForS: z.number().int().nonnegative().nullable(),
    renewedAgoMs: z.number().int().nonnegative().nullable(),
  })
  .strict();

/**
 * One loop in the report: `state` ("running", "stale", "stopped"), the seconds since its last
 * completed pass (since its start before the first one), and its bound in seconds. Field names and
 * values avoid the letters "ok" in a row, so that a keyword monitor looking for `"status":"ok"`
 * can only match the top-level status.
 */
const loopReportSchema = z
  .object({
    state: z.enum(["running", "stale", "stopped"]),
    sinceS: z.number().int().nonnegative(),
    boundS: z.number().int().positive(),
  })
  .strict();

/** Body of `GET /healthz`, 200 or 503. `pnpm smoke --engine` checks a deployed engine against it. */
export const healthReportSchema = z
  .object({
    status: z.enum(["ok", "unavailable"]),
    /** "standby": this process waits for the engine lease and runs no service. */
    role: z.enum(["leader", "standby"]),
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
    lease: leaseReportSchema,
    /**
     * The leader's loops by name (`health/loops.ts`); empty on a standby. This engine always
     * answers it and `staleLoops`; both are optional so that `pnpm smoke --engine` still reads an
     * engine deployed before them.
     */
    loops: z.record(z.string().regex(/^[a-z][a-z-]{1,40}$/), loopReportSchema).optional(),
    /** The loops that make the answer 503 (`stale` or `stopped`), by name; empty when none. */
    staleLoops: z.array(z.string()).optional(),
  })
  .strict();

export type HealthReport = z.infer<typeof healthReportSchema>;

export const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;
/** How long one read answers every request. */
export const DEFAULT_HEALTH_CACHE_MS = 2_000;

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

/** What the health read asks the outside world: the database (the cursor) and the node (the head). */
export interface HealthProbe {
  /** The cursor's block, null when none is stored; undefined when the database did not answer. */
  cursor: number | null | undefined;
  /** The chain's head; undefined when the node did not answer. */
  head: number | undefined;
}

/** One query and one node call, each bounded by the timeout. Never rejects for their failures. */
export async function probeHealth(sources: HealthSources): Promise<HealthProbe> {
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
  return {
    cursor: cursor.status === "fulfilled" ? cursor.value : undefined,
    head: head.status === "fulfilled" ? Number(head.value) : undefined,
  };
}

/**
 * The verdict, from a probe and what the process says now. A leader: 200 when the database and
 * the node both answered within the timeout and the sender and the job worker run; 503 otherwise
 * (a stopping engine answers 503 too). A standby: 200 when the database and the node both
 * answered and its latest ask for the lease was answered (`LeaseView.leaseReachable`; it runs no
 * service, by design), so that a platform's health check passes on a new container while the old
 * one still holds the lease; 503 otherwise. A standby that cannot work the lease (the table
 * missing, no rights on it) would never take over: passing it would let the platform stop the
 * engine that works and leave none. A leader is also 503 while one of its loops is `stale` (no
 * completed pass for longer than its bound) or `stopped` (its service ended by itself): the engine
 * answers and runs, but a part of it no longer works, as on 19-20 November when the sale states
 * stopped closing promos for 98 minutes behind a 200. The body names those loops (`staleLoops`).
 * `problems` names each failed condition, for the log.
 */
export function healthVerdict(sources: HealthSources, probe: HealthProbe): HealthReading {
  const now = sources.now ?? Date.now;
  const services = sources.services();
  const lease = sources.lease();
  const dbOk = probe.cursor !== undefined;
  const nodeOk = probe.head !== undefined;
  const problems: string[] = [];
  if (!dbOk) problems.push("the database did not answer");
  if (!nodeOk) problems.push("the node did not answer");
  if (lease.role === "standby") {
    if (!lease.leaseReachable) {
      problems.push("standby: its latest ask for the engine lease was not answered");
    }
  } else if (services.sender !== "running" || services.jobs !== "running") {
    problems.push("leader: the transaction sender or the job worker is not running");
  }
  const loopReports = lease.role === "leader" ? (sources.loops?.() ?? []) : [];
  const staleLoops: string[] = [];
  const failOnStaleLoops = sources.failOnStaleLoops ?? true;
  for (const loop of loopReports) {
    if (loop.state === "running") continue;
    staleLoops.push(loop.name);
    if (!failOnStaleLoops) continue;
    problems.push(
      loop.state === "stopped"
        ? `leader: loop ${loop.name} stopped (${loop.detail ?? "its service ended"})`
        : `leader: loop ${loop.name} has not completed a pass for ${Math.floor(loop.sinceMs / 1_000).toString()} s (bound ${Math.floor(loop.staleAfterMs / 1_000).toString()} s)`,
    );
  }
  const ok = problems.length === 0;
  return {
    httpStatus: ok ? 200 : 503,
    problems,
    report: {
      status: ok ? "ok" : "unavailable",
      role: lease.role,
      startedAt: sources.startedAt.toISOString(),
      uptimeS: Math.max(0, Math.floor((now() - sources.startedAt.getTime()) / 1_000)),
      chain: {
        id: sources.chainId,
        head: probe.head ?? null,
        cursor: probe.cursor ?? null,
      },
      db: dbOk ? "ok" : "down",
      sender: services.sender,
      jobs: services.jobs,
      lease: {
        holder: lease.holder,
        heldForS: lease.heldForMs === null ? null : Math.floor(lease.heldForMs / 1_000),
        renewedAgoMs: lease.renewedAgoMs,
      },
      loops: Object.fromEntries(
        loopReports.map((loop) => [
          loop.name,
          {
            state: loop.state,
            sinceS: Math.floor(loop.sinceMs / 1_000),
            boundS: Math.max(1, Math.floor(loop.staleAfterMs / 1_000)),
          },
        ]),
      ),
      staleLoops,
    },
  };
}

export interface HealthReading {
  httpStatus: 200 | 503;
  report: HealthReport;
  /** Why it is 503, one entry per failed condition (empty for 200). Logged, never answered. */
  problems: string[];
}

/** Reads the engine's health once, without a cache: a probe, then the verdict. */
export async function readHealth(sources: HealthSources): Promise<HealthReading> {
  return healthVerdict(sources, await probeHealth(sources));
}

/**
 * `readHealth` behind a cache of its I/O: callers that arrive while a probe runs share it, and its
 * answer serves every caller for `cacheMs` after it completed (on `sources.now`). The verdict is
 * built on every call from what the process says then. A probe that throws is not kept.
 */
export function createHealthReader(
  sources: HealthSources,
  options: { cacheMs?: number } = {},
): () => Promise<HealthReading> {
  const cacheMs = options.cacheMs ?? DEFAULT_HEALTH_CACHE_MS;
  const now = sources.now ?? Date.now;
  let inFlight: Promise<HealthProbe> | null = null;
  let last: { at: number; probe: HealthProbe } | null = null;
  const probe = (): Promise<HealthProbe> => {
    if (inFlight !== null) return inFlight;
    if (last !== null && now() - last.at < cacheMs) return Promise.resolve(last.probe);
    const running = probeHealth(sources)
      .then((answer) => {
        last = { at: now(), probe: answer };
        return answer;
      })
      .finally(() => {
        inFlight = null;
      });
    inFlight = running;
    return running;
  };
  return async () => healthVerdict(sources, await probe());
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
  /** How long one read answers every request. Default `DEFAULT_HEALTH_CACHE_MS`. */
  cacheMs?: number;
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
  const read = createHealthReader(options, { cacheMs: options.cacheMs });
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
    read()
      .then(({ httpStatus, report, problems }) => {
        if (httpStatus === 200 && report.staleLoops !== undefined && report.staleLoops.length > 0) {
          // APP_HEALTH_FAIL_ON_STALE_LOOPS off: answered 200, but never silent.
          log.error(
            { staleLoops: report.staleLoops },
            "a loop of the engine no longer completes its passes (health check not failed: APP_HEALTH_FAIL_ON_STALE_LOOPS is off)",
          );
        }
        if (httpStatus !== 200) {
          // A loop that stopped working is an incident, not a passing hiccup of a dependency.
          if (report.staleLoops !== undefined && report.staleLoops.length > 0) {
            log.error(
              { staleLoops: report.staleLoops, problems },
              "health check failed: a loop of the engine no longer completes its passes",
            );
          } else {
            log.warn({ health: report, problems }, "health check failed");
          }
        }
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
