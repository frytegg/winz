/** Helpers shared by the book-feed tests. Not imported by production code. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pino, { type Logger } from "pino";

import type { Db } from "../db";
import type { BookSocket, BookSocketFactory, BookSocketHandlers } from "./book-socket";
import type { CancelTimer, Scheduler } from "./scheduler";

// ---------------------------------------------------------------------------------------------
// Recorded WebSocket sessions (apps/engine/fixtures/gemini-ws)
// ---------------------------------------------------------------------------------------------

export type WsFixtureName = "sports-depth10" | "crypto-trades" | "control-and-errors";

/** One recorded event: `msg` frames carry the raw text in `data`. */
export interface WsFixtureRow {
  /** Receive time, epoch milliseconds. */
  t: number;
  kind: "open" | "sent" | "msg" | "ping" | "pong" | "close" | "end" | "error";
  data: unknown;
  session?: string;
}

export function wsFixtureRows(name: WsFixtureName): WsFixtureRow[] {
  const path = fileURLToPath(new URL(`../../fixtures/gemini-ws/${name}.jsonl`, import.meta.url));
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as WsFixtureRow);
}

/** The text of every received frame, in order. */
export function wsFixtureFrames(name: WsFixtureName): string[] {
  return wsFixtureRows(name)
    .filter((row) => row.kind === "msg" && typeof row.data === "string")
    .map((row) => row.data as string);
}

/** Instruments of the sports recording, as the catalogue spells them. */
export const SPORTS_SYMBOLS = [
  "GEMI-NBA-2611180030-NYK-TOR-M-NYK",
  "GEMI-NCAAM-2611171700-HOF-MURR-M-MURR",
  "GEMI-NCAAM-2611171900-RUT-HOU-M-HOU",
] as const;

// ---------------------------------------------------------------------------------------------
// Logs the test can read
// ---------------------------------------------------------------------------------------------

export interface LogLine {
  level: number;
  msg: string;
  [key: string]: unknown;
}

export interface RecordingLogger {
  logger: Logger;
  lines: LogLine[];
  /** Messages logged so far, in order. */
  messages(): string[];
}

export function recordingLogger(): RecordingLogger {
  const lines: LogLine[] = [];
  const logger = pino(
    { level: "debug" },
    {
      write: (line: string): void => {
        lines.push(JSON.parse(line) as LogLine);
      },
    },
  );
  return { logger, lines, messages: () => lines.map((line) => line.msg) };
}

// ---------------------------------------------------------------------------------------------
// Time driven by hand
// ---------------------------------------------------------------------------------------------

interface ManualTimer {
  id: number;
  atMs: number;
  callback: () => void;
}

/**
 * A scheduler whose clock moves only when the test says so. Postgres keeps real timers, so
 * between two callbacks `advance` lets real I/O progress a little.
 */
export class ManualScheduler implements Scheduler {
  private currentMs: number;
  private nextId = 1;
  private timers: ManualTimer[] = [];

  constructor(startMs = 1_800_000_000_000) {
    this.currentMs = startMs;
  }

  readonly now = (): number => this.currentMs;

  setTimeout(callback: () => void, ms: number): CancelTimer {
    const timer: ManualTimer = {
      id: this.nextId,
      atMs: this.currentMs + Math.max(0, ms),
      callback,
    };
    this.nextId += 1;
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((other) => other.id !== timer.id);
    };
  }

  /** Timers scheduled and not yet run or cancelled. */
  pendingTimers(): number {
    return this.timers.length;
  }

  /** Moves the clock forward by `ms`, running every timer that falls due, in order. */
  async advance(ms: number, stepMs = 100): Promise<void> {
    const targetMs = this.currentMs + ms;
    while (true) {
      await settle();
      const due = this.timers
        .filter((timer) => timer.atMs <= targetMs)
        .sort((a, b) => a.atMs - b.atMs || a.id - b.id)[0];
      const nextStopMs = Math.min(targetMs, this.currentMs + stepMs);
      if (due !== undefined && due.atMs <= nextStopMs) {
        this.timers = this.timers.filter((timer) => timer.id !== due.id);
        this.currentMs = Math.max(this.currentMs, due.atMs);
        due.callback();
        continue;
      }
      if (this.currentMs >= targetMs) break;
      this.currentMs = nextStopMs;
    }
    await settle();
  }
}

/** Lets pending promise chains and a little real I/O run. */
export async function settle(rounds = 5): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

// ---------------------------------------------------------------------------------------------
// A WebSocket driven by hand
// ---------------------------------------------------------------------------------------------

export class FakeSocket implements BookSocket {
  readonly sent: string[] = [];
  closedByClient = false;
  private closed = false;

  constructor(private readonly handlers: BookSocketHandlers) {}

  send(text: string): void {
    if (this.closed) throw new Error("FakeSocket: send after close");
    this.sent.push(text);
  }

  close(): void {
    this.closedByClient = true;
    this.serverClose(1000, "");
  }

  open(): void {
    this.handlers.onOpen();
  }

  receive(text: string): void {
    this.handlers.onMessage(text);
  }

  heartbeat(): void {
    this.handlers.onHeartbeat();
  }

  /** The connection drops (or the server closes it). */
  serverClose(code = 1006, reason = ""): void {
    if (this.closed) return;
    this.closed = true;
    this.handlers.onClose(code, reason);
  }

  /** Streams named in every subscribe request sent on this socket. */
  subscribedStreams(): string[] {
    return this.requests("subscribe");
  }

  unsubscribedStreams(): string[] {
    return this.requests("unsubscribe");
  }

  private requests(method: string): string[] {
    return this.sent.flatMap((text) => {
      const message = JSON.parse(text) as { method: string; params: string[] };
      return message.method === method ? message.params : [];
    });
  }
}

export interface FakeSocketFactory {
  factory: BookSocketFactory;
  sockets: FakeSocket[];
  /** The most recently created socket. */
  latest(): FakeSocket;
}

export function fakeSocketFactory(): FakeSocketFactory {
  const sockets: FakeSocket[] = [];
  return {
    factory: (handlers) => {
      const socket = new FakeSocket(handlers);
      sockets.push(socket);
      return socket;
    },
    sockets,
    latest: () => {
      const socket = sockets.at(-1);
      if (socket === undefined) throw new Error("no socket created yet");
      return socket;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Database rows the feed needs
// ---------------------------------------------------------------------------------------------

/** One event and a moneyline instrument per symbol (book_cache and tracked rows reference them). */
export async function seedInstruments(db: Db, symbols: readonly string[]): Promise<void> {
  await db`
    insert into events (ticker, title, sport, league, home_name, home_abbreviation,
                        away_name, away_abbreviation, starts_at, sales_close_at)
    values ('TEST-EVENT', 'Test game', 'basketball', 'NBA', 'Home', 'HOM', 'Away', 'AWY',
            '2026-11-18T00:30:00Z', '2026-11-18T00:30:00Z')
    on conflict do nothing
  `;
  for (const symbol of symbols) {
    const onchainId = `0x${createHash("sha256").update(symbol).digest("hex")}`;
    await db`
      insert into instruments (symbol, event_ticker, label, type, onchain_id)
      values (${symbol}, 'TEST-EVENT', ${symbol}, 'moneyline', ${onchainId})
      on conflict do nothing
    `;
  }
}

let merchantCounter = 0;

/** A campaign on `symbol` with the given status. Returns its id. */
export async function seedCampaign(db: Db, symbol: string, status: string): Promise<string> {
  merchantCounter += 1;
  const [user] = await db<{ id: string }[]>`
    insert into users (email) values (${`merchant${merchantCounter.toString()}-${symbol.toLowerCase()}@example.com`})
    returning id
  `;
  const [merchant] = await db<{ id: string }[]>`
    insert into merchants (user_id, name, category) values (${user?.id ?? ""}, 'Bar', 'bar') returning id
  `;
  const [campaign] = await db<{ id: string }[]>`
    insert into campaigns (merchant_id, instrument, event_ticker, product, condition_label, promise,
                           unit_price, refund_bps, usual_margin_bps, min_margin_bps,
                           pause_threshold_bps, budget, sales_close, status)
    values (${merchant?.id ?? ""}, ${symbol}, 'TEST-EVENT', 'Beer', 'Home wins', 'Refund',
            5000000, 10000, 1000, 500, 9000, 100000000, '2026-11-18T00:30:00Z', ${status})
    returning id
  `;
  return campaign?.id ?? "";
}

export interface LiveInstrumentDbRow {
  symbol: string;
  bid_bps: number | null;
  ask_bps: number | null;
  mid_bps: number | null;
  observed_at: Date;
  stale: boolean;
}

export async function liveInstrumentRow(
  db: Db,
  symbol: string,
): Promise<LiveInstrumentDbRow | null> {
  const rows = await db<LiveInstrumentDbRow[]>`
    select symbol, bid_bps, ask_bps, mid_bps, observed_at, stale from live_instruments where symbol = ${symbol}
  `;
  return rows[0] ?? null;
}
