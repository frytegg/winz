import type { Logger } from "pino";

import type { BookSocket, BookSocketFactory } from "./book-socket";
import type { BookTransport, BookTransportListener } from "./book-transport";
import { describeError } from "./errors";
import { systemScheduler, type CancelTimer, type Scheduler } from "./scheduler";
import { parseGeminiWsMessage, type GeminiWsMessage } from "./ws-messages";

/**
 * `depth10@100ms`: top 10 levels every 100 ms, a full snapshot each time (verified on 17 Nov
 * 2026). `depth10`: the same once a second.
 */
export type DepthStream = "depth10" | "depth10@100ms";

export interface WsBookTransportOptions {
  socketFactory: BookSocketFactory;
  logger: Logger;
  scheduler?: Scheduler;
  /** Source of jitter in [0, 1); defaults to `Math.random`. */
  random?: () => number;
  depthStream?: DepthStream;
  /** Also follow `<symbol>@trade`. */
  trades?: boolean;
  baseReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  /** With instruments followed, no data frame for this long means a dead stream: reconnect. */
  silenceTimeoutMs?: number;
  /** No frame at all, Gemini's 20 s pings included, for this long: reconnect. */
  idleTimeoutMs?: number;
  /** Streams per subscribe request. */
  maxStreamsPerRequest?: number;
  /** Bound on `stop` waiting for the socket to report its close. */
  closeTimeoutMs?: number;
}

interface PendingRequest {
  method: "subscribe" | "unsubscribe";
  streams: string[];
}

const LIVENESS_CHECK_MS = 1_000;

/** Gemini's refusal of a subscribe request, e.g. "Invalid stream name: gemi-…@depth10@100ms". */
const INVALID_STREAM = /^Invalid stream name: (\S+)$/;

/**
 * Books and trades from the Gemini WebSocket.
 *
 * One connection carries every instrument. After any close it reconnects with exponential
 * backoff and equal jitter, and subscribes again to every followed instrument. Gemini pings every
 * 20 s and `ws` answers; a connection that stays silent is closed and replaced.
 */
export class WsBookTransport implements BookTransport {
  readonly source = "ws" as const;

  private readonly socketFactory: BookSocketFactory;
  private readonly logger: Logger;
  private readonly scheduler: Scheduler;
  private readonly random: () => number;
  private readonly depthStream: DepthStream;
  private readonly trades: boolean;
  private readonly baseReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly silenceTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly maxStreamsPerRequest: number;
  private readonly closeTimeoutMs: number;

  private listener: BookTransportListener | null = null;
  /** Lower-case symbol (as Gemini sends it back) to catalogue symbol. */
  private readonly followed = new Map<string, string>();
  private socket: BookSocket | null = null;
  /** Bumped for every new socket, so events of an old one are ignored. */
  private generation = 0;
  private open = false;
  private closing = false;
  private started = false;
  private stopped = false;
  private failedAttempts = 0;
  private lastFrameAtMs = 0;
  private lastDataAtMs = 0;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private cancelReconnect: CancelTimer | null = null;
  private cancelLiveness: CancelTimer | null = null;
  private onSocketClosed: (() => void) | null = null;

  constructor(options: WsBookTransportOptions) {
    this.socketFactory = options.socketFactory;
    this.logger = options.logger;
    this.scheduler = options.scheduler ?? systemScheduler;
    this.random = options.random ?? Math.random;
    this.depthStream = options.depthStream ?? "depth10@100ms";
    this.trades = options.trades ?? true;
    this.baseReconnectDelayMs = options.baseReconnectDelayMs ?? 500;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30_000;
    this.silenceTimeoutMs = options.silenceTimeoutMs ?? 15_000;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 45_000;
    this.maxStreamsPerRequest = options.maxStreamsPerRequest ?? 50;
    this.closeTimeoutMs = options.closeTimeoutMs ?? 3_000;
  }

  start(listener: BookTransportListener): void {
    if (this.started) throw new Error("WsBookTransport: already started");
    this.started = true;
    this.listener = listener;
    this.connect();
  }

  setSymbols(symbols: ReadonlySet<string>): void {
    const wanted = new Map<string, string>();
    for (const symbol of symbols) wanted.set(symbol.toLowerCase(), symbol);
    const added: string[] = [];
    const removed: string[] = [];
    for (const [lower, symbol] of wanted) {
      if (!this.followed.has(lower)) {
        this.followed.set(lower, symbol);
        added.push(lower);
      }
    }
    for (const lower of [...this.followed.keys()]) {
      if (!wanted.has(lower)) {
        this.followed.delete(lower);
        removed.push(lower);
      }
    }
    if (!this.open) return;
    if (added.length > 0) {
      // A first subscription after an empty period must not count the empty period as silence.
      if (this.followed.size === added.length) this.lastDataAtMs = this.scheduler.now();
      this.request(
        "subscribe",
        added.flatMap((lower) => this.streamsOf(lower)),
      );
    }
    if (removed.length > 0) {
      this.request(
        "unsubscribe",
        removed.flatMap((lower) => this.streamsOf(lower)),
      );
    }
  }

  isConnected(): boolean {
    return this.open;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.cancelReconnect?.();
    this.cancelReconnect = null;
    this.stopLiveness();
    const socket = this.socket;
    if (socket === null) return;
    await new Promise<void>((resolve) => {
      let cancelTimeout: CancelTimer = () => undefined;
      this.onSocketClosed = () => {
        cancelTimeout();
        resolve();
      };
      cancelTimeout = this.scheduler.setTimeout(() => {
        this.logger.warn("gemini websocket did not report its close in time");
        this.onSocketClosed = null;
        resolve();
      }, this.closeTimeoutMs);
      this.closeSocket(socket);
    });
  }

  private streamsOf(lower: string): string[] {
    const streams = [`${lower}@${this.depthStream}`];
    if (this.trades) streams.push(`${lower}@trade`);
    return streams;
  }

  private connect(): void {
    this.cancelReconnect = null;
    if (this.stopped) return;
    this.generation += 1;
    const generation = this.generation;
    const current = (): boolean => generation === this.generation;
    this.closing = false;
    try {
      this.socket = this.socketFactory({
        onOpen: () => {
          if (current()) this.handleOpen();
        },
        onMessage: (text) => {
          if (current()) this.handleMessage(text);
        },
        onHeartbeat: () => {
          if (current()) this.lastFrameAtMs = this.scheduler.now();
        },
        onError: (error) => {
          if (current() && !this.stopped) {
            this.logger.warn({ err: describeError(error) }, "gemini websocket error");
          }
        },
        onClose: (code, reason) => {
          if (current()) this.handleClose(code, reason);
        },
      });
    } catch (error: unknown) {
      this.socket = null;
      this.logger.error({ err: describeError(error) }, "gemini websocket could not be created");
      this.scheduleReconnect();
    }
  }

  private handleOpen(): void {
    if (this.stopped) return;
    const nowMs = this.scheduler.now();
    this.open = true;
    this.lastFrameAtMs = nowMs;
    this.lastDataAtMs = nowMs;
    this.pending.clear();
    this.logger.info(
      { instruments: this.followed.size, attempt: this.failedAttempts },
      "gemini websocket connected",
    );
    this.listener?.onConnectionChange(true);
    const streams = [...this.followed.keys()].flatMap((lower) => this.streamsOf(lower));
    if (streams.length > 0) this.request("subscribe", streams);
    this.scheduleLiveness();
  }

  private handleMessage(text: string): void {
    if (this.stopped) return;
    const nowMs = this.scheduler.now();
    this.lastFrameAtMs = nowMs;
    let message: GeminiWsMessage;
    try {
      message = parseGeminiWsMessage(text);
    } catch (error: unknown) {
      this.logger.warn(
        { err: describeError(error), frame: text.slice(0, 200) },
        "gemini websocket frame skipped",
      );
      return;
    }
    if (message.kind === "reply") {
      this.handleReply(message.id, message.status, message.error);
      return;
    }
    this.lastDataAtMs = nowMs;
    // The connection delivers data: the next failure starts the backoff from the beginning.
    this.failedAttempts = 0;
    const symbol = this.followed.get(message.symbol);
    if (symbol === undefined) return;
    if (message.kind === "depthSnapshot") {
      this.listener?.onBook(
        { instrumentSymbol: symbol, bids: message.bids, asks: message.asks, observedAtMs: nowMs },
        message.lastUpdateId,
      );
    } else if (message.kind === "trade") {
      this.listener?.onTrade({
        instrumentSymbol: symbol,
        priceBps: message.priceBps,
        qty: message.qty,
        atMs: message.eventTimeMs,
      });
    }
    // depthUpdate and bookTicker are parsed but not subscribed to: the snapshots carry the book.
  }

  private handleReply(
    id: number | null,
    status: number,
    error: { code: number; msg: string } | null,
  ): void {
    const request = id === null ? undefined : this.pending.get(id);
    if (id !== null) this.pending.delete(id);
    if (status === 200) return;
    // Gemini refuses a whole subscribe request for one invalid stream (an instrument already
    // settled at Gemini, checked on 20 Nov 2026) and sends none of the others: subscribe them
    // again without it. Each retry is one stream shorter, so this ends; the instrument left out is
    // filled from REST by the feed's gap filling.
    const invalid = INVALID_STREAM.exec(error?.msg ?? "")?.[1];
    if (
      request?.method === "subscribe" &&
      invalid !== undefined &&
      request.streams.includes(invalid)
    ) {
      const others = request.streams.filter(
        (stream) => stream !== invalid && this.followed.has(stream.split("@")[0] ?? ""),
      );
      this.logger.warn(
        { id, stream: invalid, others: others.length },
        "gemini websocket stream refused, subscribing the others again",
      );
      if (others.length > 0) this.request("subscribe", others);
      return;
    }
    this.logger.warn(
      {
        id,
        status,
        error,
        method: request?.method,
        streams: request?.streams.slice(0, 10),
      },
      "gemini websocket request refused",
    );
  }

  private handleClose(code: number, reason: string): void {
    const wasOpen = this.open;
    this.open = false;
    this.socket = null;
    this.pending.clear();
    this.stopLiveness();
    const onClosed = this.onSocketClosed;
    this.onSocketClosed = null;
    if (this.stopped) {
      this.logger.info({ code }, "gemini websocket closed");
      onClosed?.();
      return;
    }
    this.logger.warn({ code, reason, wasOpen }, "gemini websocket disconnected");
    if (wasOpen) this.listener?.onConnectionChange(false);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.cancelReconnect !== null) return;
    this.failedAttempts += 1;
    const step = Math.min(
      this.maxReconnectDelayMs,
      this.baseReconnectDelayMs * 2 ** (this.failedAttempts - 1),
    );
    const delayMs = Math.round(step / 2 + this.random() * (step / 2));
    this.logger.info({ attempt: this.failedAttempts, delayMs }, "gemini websocket reconnecting");
    this.cancelReconnect = this.scheduler.setTimeout(() => {
      this.connect();
    }, delayMs);
  }

  private scheduleLiveness(): void {
    this.cancelLiveness = this.scheduler.setTimeout(() => {
      this.cancelLiveness = null;
      this.checkLiveness();
    }, LIVENESS_CHECK_MS);
  }

  private stopLiveness(): void {
    this.cancelLiveness?.();
    this.cancelLiveness = null;
  }

  private checkLiveness(): void {
    if (!this.open || this.stopped || this.socket === null) return;
    const nowMs = this.scheduler.now();
    const silentMs = nowMs - this.lastDataAtMs;
    const idleMs = nowMs - this.lastFrameAtMs;
    if (
      (this.followed.size > 0 && silentMs > this.silenceTimeoutMs) ||
      idleMs > this.idleTimeoutMs
    ) {
      this.logger.warn(
        { silentMs, idleMs, instruments: this.followed.size },
        "gemini websocket silent, closing it to reconnect",
      );
      this.closeSocket(this.socket);
      return;
    }
    this.scheduleLiveness();
  }

  private closeSocket(socket: BookSocket): void {
    if (this.closing) return;
    this.closing = true;
    try {
      socket.close();
    } catch (error: unknown) {
      this.logger.warn({ err: describeError(error) }, "gemini websocket close failed");
    }
  }

  /** Sends one request per `maxStreamsPerRequest` streams. Never sends anything but JSON: Gemini closes the socket (1003) on a non-JSON frame. */
  private request(method: "subscribe" | "unsubscribe", streams: string[]): void {
    const socket = this.socket;
    if (socket === null || !this.open) return;
    for (let index = 0; index < streams.length; index += this.maxStreamsPerRequest) {
      const chunk = streams.slice(index, index + this.maxStreamsPerRequest);
      const id = this.nextRequestId;
      this.nextRequestId += 1;
      this.pending.set(id, { method, streams: chunk });
      try {
        socket.send(JSON.stringify({ id, method, params: chunk }));
      } catch (error: unknown) {
        this.logger.warn({ err: describeError(error), method }, "gemini websocket send failed");
      }
    }
  }
}
