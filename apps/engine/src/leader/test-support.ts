/**
 * Test support of the engine lease: a TCP proxy that can cut one engine's database access, a log
 * of when each engine's services ran, the check that at most one engine ever ran them, and the
 * real `startEngine` composition on the jobs harness (local chain, real escrow, real Postgres,
 * fake payments, fake identity, hand-fed books). Test code only.
 */
import { createServer, connect, type Server, type Socket } from "node:net";
import { performance } from "node:perf_hooks";

import type { Logger } from "pino";

import type { Book } from "@winz/shared";

import { startEngine, type EngineBookFeed, type EngineTuning, type RunningService } from "../app";
import { TEST_SENDER_CONFIG } from "../chain/test-support";
import type { Db } from "../db";
import type { HandFedBooks, JobsHarness } from "../jobs/handlers/test-support";
import type { BookFeedEvent } from "../market-data/book-feed";
import type { LeaderServices } from "./leader";
import type { AcquireResult, EngineLeaseStore, LeaseRow, RenewResult } from "./lease";

// ---------------------------------------------------------------------------------------------
// A TCP proxy in front of Postgres
// ---------------------------------------------------------------------------------------------

/**
 * Forwards connections to `targetPort`. `cut()` makes the database unreachable, until `restore()`,
 * for the pools that go through it, and only for them, in one of two ways:
 * - "refuse": every open connection is destroyed and nothing listens (a new connection is refused
 *   at once, ECONNREFUSED): every query fails fast;
 * - "stall": the database goes silent. Every open connection stays open on the client's side and
 *   nothing comes back on it any more; a new connection is accepted and never answered. Every
 *   query HANGS, on an existing connection as on a new one. On the database's side the
 *   connections are closed, so that what they held (a transaction, its locks) is released.
 *
 * There is deliberately no mode that accepts a connection and closes it at once: what the client
 * then sees depends on which side moves first. Closed before the client has written, postgres.js
 * reconnects in a loop and the query hangs; closed just after, the kernel answers the unread
 * bytes with a reset and the query is rejected (ECONNRESET). Measured with 30 queries per case:
 * closed in the accept callback, 30 hung; closed 0 ms or 1 ms later, 30 rejected. A test built on
 * it passes or fails with the scheduler.
 */
export class TcpProxy {
  /** Forwarding pairs: the client's socket and the database's. */
  private readonly pairs = new Map<Socket, Socket>();
  /** Clients' sockets kept open and silent by a "stall" cut. */
  private readonly held = new Set<Socket>();
  private server: Server;
  private mode: "open" | "refuse" | "stall" = "open";
  private boundPort = 0;

  private constructor(
    private readonly targetPort: number,
    private readonly targetHost: string,
  ) {
    this.server = this.newServer();
  }

  static async start(targetPort: number, targetHost = "127.0.0.1"): Promise<TcpProxy> {
    const proxy = new TcpProxy(targetPort, targetHost);
    await proxy.listen(0);
    return proxy;
  }

  get port(): number {
    return this.boundPort;
  }

  private newServer(): Server {
    return createServer((client) => this.onConnection(client));
  }

  private async listen(port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (address === null || typeof address === "string") throw new Error("proxy has no port");
    this.boundPort = address.port;
  }

  private onConnection(client: Socket): void {
    client.on("error", () => undefined);
    if (this.mode === "stall") {
      client.on("close", () => this.held.delete(client));
      this.hold(client);
      return;
    }
    if (this.mode !== "open") {
      client.destroy();
      return;
    }
    const upstream = connect(this.targetPort, this.targetHost);
    upstream.on("error", () => undefined);
    this.pairs.set(client, upstream);
    client.on("close", () => {
      this.pairs.delete(client);
      this.held.delete(client);
      upstream.destroy();
    });
    // A held client outlives its database connection: that is the stall.
    upstream.on("close", () => {
      if (!this.held.has(client)) client.destroy();
    });
    client.pipe(upstream);
    upstream.pipe(client);
  }

  /** Keeps `client` open and reads nothing more from it: its peer waits for an answer for good. */
  private hold(client: Socket): void {
    this.held.add(client);
    client.pause();
  }

  async cut(mode: "refuse" | "stall"): Promise<void> {
    const wasListening = this.mode !== "refuse";
    this.mode = mode;
    if (mode === "stall") {
      for (const [client, upstream] of this.pairs) {
        client.unpipe(upstream);
        upstream.unpipe(client);
        this.hold(client);
        upstream.destroy();
      }
      this.pairs.clear();
      return;
    }
    for (const socket of [...this.pairs.keys(), ...this.pairs.values(), ...this.held]) {
      socket.destroy();
    }
    if (wasListening) {
      const closing = this.server;
      await new Promise<void>((resolve) => closing.close(() => resolve()));
    }
  }

  /**
   * The database is reachable again for new connections. A connection held by a stall is dead for
   * good: it is closed, so that the query waiting on it fails and its pool opens another.
   */
  async restore(): Promise<void> {
    const refused = this.mode === "refuse";
    this.mode = "open";
    for (const client of this.held) client.destroy();
    this.held.clear();
    if (refused) {
      this.server = this.newServer();
      await this.listen(this.boundPort);
    }
  }

  /** `url` (a postgres URL) pointed at this proxy. */
  rewrite(url: string): string {
    const parsed = new URL(url);
    parsed.hostname = "127.0.0.1";
    parsed.port = this.port.toString();
    return parsed.toString();
  }

  async close(): Promise<void> {
    await this.cut("refuse");
  }
}

// ---------------------------------------------------------------------------------------------
// When each engine's services ran
// ---------------------------------------------------------------------------------------------

export interface ServiceEvent {
  engine: string;
  event: "start" | "stopped";
  /** Monotonic milliseconds of this test process. */
  at: number;
}

/** Each engine's services, from the call that starts them to the moment they have all stopped. */
export class ServiceLog {
  readonly events: ServiceEvent[] = [];

  record(engine: string, event: ServiceEvent["event"]): void {
    this.events.push({ engine, event, at: performance.now() });
  }

  /** Engines whose services run right now. */
  running(): string[] {
    const open = new Map<string, number>();
    for (const { engine, event } of this.events) {
      open.set(engine, (open.get(engine) ?? 0) + (event === "start" ? 1 : -1));
    }
    return [...open.entries()].filter(([, count]) => count > 0).map(([engine]) => engine);
  }

  /** Every moment at which two engines (or two runs of one) had services running, described. */
  overlaps(): string[] {
    const found: string[] = [];
    const open = new Map<string, number>();
    for (const { engine, event, at } of [...this.events].sort((a, b) => a.at - b.at)) {
      if (event === "start") {
        const others = [...open.keys()];
        if (others.length > 0) {
          found.push(
            `${engine} started at ${at.toFixed(0)} ms while ${others.join(", ")} still ran`,
          );
        }
        open.set(engine, (open.get(engine) ?? 0) + 1);
      } else {
        const count = (open.get(engine) ?? 0) - 1;
        if (count <= 0) open.delete(engine);
        else open.set(engine, count);
      }
    }
    return found;
  }

  /** Throws when two engines ever had services running at the same time. */
  assertAtMostOne(): void {
    const overlaps = this.overlaps();
    if (overlaps.length > 0) {
      throw new Error(`two engines worked at once:\n  ${overlaps.join("\n  ")}`);
    }
  }

  /** How many times `engine` started its services. */
  starts(engine: string): number {
    return this.events.filter((e) => e.engine === engine && e.event === "start").length;
  }

  last(engine: string, event: ServiceEvent["event"]): ServiceEvent | undefined {
    return [...this.events].reverse().find((e) => e.engine === engine && e.event === event);
  }
}

// ---------------------------------------------------------------------------------------------
// A lease store a test can break
// ---------------------------------------------------------------------------------------------

/**
 * Wraps a lease store. `dead` makes every call reject (a process whose database calls all fail);
 * `frozen` makes every call hang until unfrozen (a stalled connection);
 * `answerNextRenewalLate` delays the answer of one renewal the database applied, and cuts the
 * database right after it. Records every renewal answer, and every grant the database made (an
 * acquisition or a renewal it applied), whether or not its answer reached the leader.
 */
export class FaultyLease implements EngineLeaseStore {
  dead = false;
  private frozenUntil: Promise<void> | null = null;
  private unfreezeNow: () => void = () => undefined;
  private lateAnswer: { ms: number; stamped: (row: LeaseRow) => void } | null = null;
  readonly renewals: RenewResult[] = [];
  /** Every lease the database granted this holder, as the statement returned it. */
  readonly grants: LeaseRow[] = [];
  /** Database times of this holder's releases. */
  readonly releases: Date[] = [];

  constructor(private readonly inner: EngineLeaseStore) {}

  get holder(): string {
    return this.inner.holder;
  }

  /** Idempotent: freezing a frozen store keeps the one gate, so `unfreeze` releases every call. */
  freeze(): void {
    if (this.frozenUntil !== null) return;
    this.frozenUntil = new Promise((resolve) => {
      this.unfreezeNow = resolve;
    });
  }

  unfreeze(): void {
    this.frozenUntil = null;
    this.unfreezeNow();
  }

  /**
   * The next renewal the database applies answers `ms` later, and from the moment the database
   * applied it every call fails (`dead`). Resolves with the row the database stamped.
   */
  answerNextRenewalLate(ms: number): Promise<LeaseRow> {
    return new Promise((resolve) => {
      this.lateAnswer = { ms, stamped: resolve };
    });
  }

  private async gate(): Promise<void> {
    if (this.frozenUntil !== null) await this.frozenUntil;
    if (this.dead) throw new Error("database unreachable (test)");
  }

  async acquire(): Promise<AcquireResult> {
    await this.gate();
    const result = await this.inner.acquire();
    if (result.acquired) this.grants.push(result.lease);
    return result;
  }

  async renew(): Promise<RenewResult> {
    await this.gate();
    const result = await this.inner.renew();
    this.renewals.push(result);
    if (result.renewed) {
      this.grants.push(result.lease);
      const late = this.lateAnswer;
      if (late !== null) {
        this.lateAnswer = null;
        this.dead = true;
        late.stamped(result.lease);
        await new Promise((resolve) => setTimeout(resolve, late.ms));
      }
    }
    return result;
  }

  async release(): Promise<Date | null> {
    await this.gate();
    const releasedAt = await this.inner.release();
    if (releasedAt !== null) this.releases.push(releasedAt);
    return releasedAt;
  }

  async read(): Promise<LeaseRow | null> {
    await this.gate();
    return this.inner.read();
  }
}

// ---------------------------------------------------------------------------------------------
// The real engine on the jobs harness
// ---------------------------------------------------------------------------------------------

/**
 * One engine's book feed over the harness's hand-fed books: what `getBook` answers comes from the
 * shared books (one market, seen by every engine), and while started it delivers every book to
 * its listeners every `intervalMs`, as a live socket keeps doing (the paper venue fills on them).
 */
export class HarnessBookFeed implements EngineBookFeed {
  private readonly listeners = new Set<(event: BookFeedEvent) => void>();

  constructor(
    private readonly books: HandFedBooks,
    private readonly symbols: () => readonly string[],
    private readonly intervalMs = 100,
  ) {}

  getBook(symbol: string): Book | null {
    return this.books.getBook(symbol);
  }

  isStale(): boolean {
    return false;
  }

  subscribe(listener: (event: BookFeedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(options: { signal: AbortSignal }): RunningService {
    const timer = setInterval(() => {
      for (const symbol of this.symbols()) {
        const book = this.books.getBook(symbol);
        if (book === null) continue;
        for (const listener of this.listeners) listener({ kind: "book", book, source: "ws" });
      }
    }, this.intervalMs);
    return {
      stopped: new Promise<void>((resolve) => {
        const stop = (): void => {
          clearInterval(timer);
          resolve();
        };
        if (options.signal.aborted) stop();
        else options.signal.addEventListener("abort", stop, { once: true });
      }),
    };
  }
}

/** Short intervals for every service, as the e2e world uses. */
export const LEADER_E2E_TUNING: EngineTuning = {
  txSender: TEST_SENDER_CONFIG,
  chainIngest: { pollIntervalMs: 100, projectIntervalMs: 50 },
  hedging: {
    exposureIntervalMs: 100,
    tickIntervalMs: 100,
    chargeIntervalMs: 200,
    deskMinIntervalMs: 200,
    reconcileTimeoutMs: 10_000,
    finalizeTimeoutMs: 20_000,
  },
  saleStates: { intervalMs: 200 },
  settlement: { intervalMs: 250 },
  jobs: {
    options: {
      waitTimeoutMs: 20_000,
      retryDelayMs: 100,
      resendDelayMs: 50,
      maxResendDelayMs: 200,
    },
    worker: { pollIntervalMs: 50, shutdownGraceMs: 5_000 },
  },
};

export interface EngineCompositionOptions {
  /** Name in the service log. */
  name: string;
  harness: JobsHarness;
  /** This engine's own pool (as its own process would have). */
  db: Db;
  logger: Logger;
  log: ServiceLog;
  /** Instruments whose books the feed delivers. */
  symbols: () => readonly string[];
  tuning?: EngineTuning;
}

/**
 * `startServices` of one engine: the real `startEngine` on the harness's chain and database, each
 * run recorded in the service log from the call to the moment every service has stopped.
 */
export function engineComposition(
  options: EngineCompositionOptions,
): (signal: AbortSignal) => Promise<LeaderServices> {
  const { harness } = options;
  return async (signal: AbortSignal): Promise<LeaderServices> => {
    options.log.record(options.name, "start");
    try {
      const engine = await startEngine({
        db: options.db,
        logger: options.logger,
        publicClient: harness.escrow.publicClient,
        accounts: {
          relayer: harness.escrow.accounts.relayer,
          oracle: harness.escrow.accounts.oracle,
        },
        chainId: harness.escrow.chainId,
        escrowAddress: harness.escrow.escrow,
        escrowDeployBlock: harness.escrow.deployedAtBlock,
        bookFeed: new HarnessBookFeed(harness.books, options.symbols),
        payments: harness.gateway,
        identity: harness.identity,
        venueName: "paper",
        signal,
        now: harness.clock.now,
        tuning: options.tuning ?? LEADER_E2E_TUNING,
      });
      return {
        stopped: engine.stopped.then(() => options.log.record(options.name, "stopped")),
      };
    } catch (error: unknown) {
      options.log.record(options.name, "stopped");
      throw error;
    }
  };
}
