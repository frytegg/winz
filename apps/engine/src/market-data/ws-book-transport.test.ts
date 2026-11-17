import { describe, expect, it } from "vitest";

import type { Book } from "@winz/shared";

import {
  ManualScheduler,
  SPORTS_SYMBOLS,
  fakeSocketFactory,
  recordingLogger,
  wsFixtureFrames,
} from "./book-test-support";
import type { BookTransportListener, TradePrint } from "./book-transport";
import { WsBookTransport, type WsBookTransportOptions } from "./ws-book-transport";

interface Received {
  books: { book: Book; sequence: number | null }[];
  trades: TradePrint[];
  connection: boolean[];
}

function setup(options: Partial<WsBookTransportOptions> = {}): {
  transport: WsBookTransport;
  scheduler: ManualScheduler;
  sockets: ReturnType<typeof fakeSocketFactory>;
  received: Received;
  log: ReturnType<typeof recordingLogger>;
} {
  const scheduler = new ManualScheduler();
  const sockets = fakeSocketFactory();
  const log = recordingLogger();
  const received: Received = { books: [], trades: [], connection: [] };
  const listener: BookTransportListener = {
    onBook: (book, sequence) => received.books.push({ book, sequence }),
    onTrade: (trade) => received.trades.push(trade),
    onConnectionChange: (connected) => received.connection.push(connected),
  };
  const transport = new WsBookTransport({
    socketFactory: sockets.factory,
    logger: log.logger,
    scheduler,
    random: () => 0.5,
    ...options,
  });
  transport.start(listener);
  return { transport, scheduler, sockets, received, log };
}

const [NYK, MURR, HOU] = SPORTS_SYMBOLS;

describe("WsBookTransport", () => {
  it("subscribes to depth and trades of every followed instrument once open", () => {
    const { transport, sockets } = setup();
    transport.setSymbols(new Set([NYK, MURR]));
    expect(sockets.latest().sent).toEqual([]);
    sockets.latest().open();
    expect(sockets.latest().subscribedStreams().sort()).toEqual(
      [
        "gemi-nba-2611180030-nyk-tor-m-nyk@depth10@100ms",
        "gemi-nba-2611180030-nyk-tor-m-nyk@trade",
        "gemi-ncaam-2611171700-hof-murr-m-murr@depth10@100ms",
        "gemi-ncaam-2611171700-hof-murr-m-murr@trade",
      ].sort(),
    );
    expect(transport.isConnected()).toBe(true);
  });

  it("subscribes and unsubscribes as the followed set changes", () => {
    const { transport, sockets } = setup({ depthStream: "depth10", trades: false });
    sockets.latest().open();
    transport.setSymbols(new Set([NYK, MURR]));
    transport.setSymbols(new Set([MURR, HOU]));
    expect(sockets.latest().subscribedStreams()).toEqual([
      "gemi-nba-2611180030-nyk-tor-m-nyk@depth10",
      "gemi-ncaam-2611171700-hof-murr-m-murr@depth10",
      "gemi-ncaam-2611171900-rut-hou-m-hou@depth10",
    ]);
    expect(sockets.latest().unsubscribedStreams()).toEqual([
      "gemi-nba-2611180030-nyk-tor-m-nyk@depth10",
    ]);
  });

  it("delivers the recorded snapshots as books of the catalogue symbol, with their update id", () => {
    const { transport, sockets, received } = setup();
    transport.setSymbols(new Set(SPORTS_SYMBOLS));
    sockets.latest().open();
    const frames = wsFixtureFrames("sports-depth10");
    for (const frame of frames) sockets.latest().receive(frame);
    const snapshots = frames.filter((frame) => frame.includes("lastUpdateId")).length;
    expect(received.books).toHaveLength(snapshots);
    const first = received.books[0];
    expect(first?.book.instrumentSymbol).toBe(NYK);
    expect(first?.sequence).toBe(1_764_531_742_529_338);
    expect(first?.book.bids[0]).toEqual({ priceBps: 5600n, qty: 953_000_000n });
    expect(new Set(received.books.map(({ book }) => book.instrumentSymbol))).toEqual(
      new Set(SPORTS_SYMBOLS),
    );
  });

  it("delivers trade prints of followed instruments only", () => {
    const { transport, sockets, received } = setup();
    transport.setSymbols(new Set(["GEMI-ETH15M2611171630-UP"]));
    sockets.latest().open();
    for (const frame of wsFixtureFrames("crypto-trades")) sockets.latest().receive(frame);
    expect(received.trades).toEqual([
      {
        instrumentSymbol: "GEMI-ETH15M2611171630-UP",
        priceBps: 3000n,
        qty: 5_000_000n,
        atMs: 1_794_932_625_041,
      },
      {
        instrumentSymbol: "GEMI-ETH15M2611171630-UP",
        priceBps: 3200n,
        qty: 10_000_000n,
        atMs: 1_794_932_697_985,
      },
      {
        instrumentSymbol: "GEMI-ETH15M2611171630-UP",
        priceBps: 3000n,
        qty: 5_000_000n,
        atMs: 1_794_932_740_102,
      },
    ]);

    const other = setup();
    other.transport.setSymbols(new Set(["GEMI-BTC05M2611171625-UP"]));
    other.sockets.latest().open();
    for (const frame of wsFixtureFrames("crypto-trades")) other.sockets.latest().receive(frame);
    expect(other.received.trades).toEqual([]);
  });

  it("logs and skips a malformed frame, and keeps reading", () => {
    const { transport, sockets, received, log } = setup();
    transport.setSymbols(new Set([NYK]));
    sockets.latest().open();
    sockets.latest().receive("{not json");
    sockets
      .latest()
      .receive(
        '{"lastUpdateId":1,"symbol":"gemi-nba-2611180030-nyk-tor-m-nyk","bids":[["7","1"]],"asks":[]}',
      );
    sockets
      .latest()
      .receive(
        '{"lastUpdateId":2,"symbol":"gemi-nba-2611180030-nyk-tor-m-nyk","bids":[["0.5000","1.00"]],"asks":[]}',
      );
    expect(
      log.messages().filter((message) => message === "gemini websocket frame skipped"),
    ).toHaveLength(2);
    expect(received.books.map(({ sequence }) => sequence)).toEqual([2]);
    expect(sockets.sockets).toHaveLength(1);
  });

  it("logs a refused subscription with the streams it named", () => {
    const { transport, sockets, log } = setup();
    transport.setSymbols(new Set([NYK]));
    sockets.latest().open();
    sockets
      .latest()
      .receive('{"id":1,"status":400,"error":{"code":-1013,"msg":"Invalid stream name: x"}}');
    const line = log.lines.find((entry) => entry.msg === "gemini websocket request refused");
    expect(line?.method).toBe("subscribe");
    expect(line?.error).toEqual({ code: -1013, msg: "Invalid stream name: x" });
  });

  it("reconnects with exponential backoff and jitter, and subscribes again to everything", async () => {
    const { transport, sockets, scheduler, received } = setup({ baseReconnectDelayMs: 1_000 });
    transport.setSymbols(new Set([NYK, MURR]));
    sockets.latest().open();
    sockets.latest().serverClose(1006);
    expect(transport.isConnected()).toBe(false);
    expect(received.connection).toEqual([true, false]);

    // random = 0.5: delays are 3/4 of the step, 1 s then 2 s then 4 s.
    await scheduler.advance(749);
    expect(sockets.sockets).toHaveLength(1);
    await scheduler.advance(1);
    expect(sockets.sockets).toHaveLength(2);
    sockets.latest().serverClose(1006); // refused before opening
    await scheduler.advance(1_499);
    expect(sockets.sockets).toHaveLength(2);
    await scheduler.advance(1);
    expect(sockets.sockets).toHaveLength(3);

    transport.setSymbols(new Set([NYK, MURR, HOU])); // changed while down
    sockets.latest().open();
    expect(received.connection).toEqual([true, false, true]);
    expect(sockets.latest().subscribedStreams()).toHaveLength(6);
    expect(
      new Set(
        sockets
          .latest()
          .subscribedStreams()
          .map((stream) => stream.split("@")[0]),
      ),
    ).toEqual(new Set(SPORTS_SYMBOLS.map((symbol) => symbol.toLowerCase())));

    // Data proves the connection healthy: the next drop starts the backoff over.
    sockets
      .latest()
      .receive(
        wsFixtureFrames("sports-depth10").find((frame) => frame.includes("lastUpdateId")) ?? "",
      );
    sockets.latest().serverClose(1006);
    await scheduler.advance(750);
    expect(sockets.sockets).toHaveLength(4);
  });

  it("caps the backoff", async () => {
    const { sockets, scheduler } = setup({
      baseReconnectDelayMs: 1_000,
      maxReconnectDelayMs: 4_000,
    });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      sockets.latest().serverClose(1006);
      await scheduler.advance(3_000); // 3/4 of the 4 s cap
    }
    expect(sockets.sockets).toHaveLength(7);
  });

  it("replaces a socket that stops delivering data while instruments are followed", async () => {
    const { transport, sockets, scheduler, log } = setup({ silenceTimeoutMs: 5_000 });
    transport.setSymbols(new Set([NYK]));
    sockets.latest().open();
    await scheduler.advance(3_000);
    sockets.latest().heartbeat(); // pings alone do not count as data
    await scheduler.advance(3_000);
    expect(sockets.sockets[0]?.closedByClient).toBe(true);
    expect(log.messages()).toContain("gemini websocket silent, closing it to reconnect");
    await scheduler.advance(1_000);
    expect(sockets.sockets).toHaveLength(2);
  });

  it("keeps an idle socket with no instrument while Gemini pings it", async () => {
    const { sockets, scheduler } = setup({ idleTimeoutMs: 45_000 });
    sockets.latest().open();
    for (let second = 0; second < 120; second += 20) {
      await scheduler.advance(20_000);
      sockets.latest().heartbeat();
    }
    expect(sockets.sockets).toHaveLength(1);
    expect(sockets.latest().closedByClient).toBe(false);
  });

  it("stops: closes the socket, cancels every timer, reports nothing afterwards", async () => {
    const { transport, sockets, scheduler, received } = setup();
    transport.setSymbols(new Set([NYK]));
    sockets.latest().open();
    await transport.stop();
    expect(sockets.latest().closedByClient).toBe(true);
    expect(scheduler.pendingTimers()).toBe(0);
    expect(received.connection).toEqual([true]);
    await scheduler.advance(60_000);
    expect(sockets.sockets).toHaveLength(1);
  });

  it("stops while waiting to reconnect", async () => {
    const { transport, sockets, scheduler } = setup();
    sockets.latest().serverClose(1006);
    expect(scheduler.pendingTimers()).toBe(1);
    await transport.stop();
    expect(scheduler.pendingTimers()).toBe(0);
    await scheduler.advance(60_000);
    expect(sockets.sockets).toHaveLength(1);
  });
});
