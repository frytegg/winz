import { describe, expect, it } from "vitest";

import { wsFixtureFrames, wsFixtureRows } from "./book-test-support";
import { GeminiWsMessageError, parseGeminiWsMessage, type GeminiWsMessage } from "./ws-messages";

function kinds(frames: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const frame of frames) {
    const { kind } = parseGeminiWsMessage(frame);
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

function parseOf<K extends GeminiWsMessage["kind"]>(
  frame: string,
  kind: K,
): Extract<GeminiWsMessage, { kind: K }> {
  const message = parseGeminiWsMessage(frame);
  if (message.kind !== kind) throw new Error(`expected ${kind}, got ${message.kind}`);
  return message as Extract<GeminiWsMessage, { kind: K }>;
}

describe("parseGeminiWsMessage on the recorded sessions", () => {
  it("reads every frame of the sports book recording", () => {
    const frames = wsFixtureFrames("sports-depth10");
    expect(frames.length).toBeGreaterThan(300);
    const counts = kinds(frames);
    expect(Object.keys(counts).sort()).toEqual(
      ["bookTicker", "depthSnapshot", "depthUpdate", "reply"].sort(),
    );
    expect(counts.depthSnapshot).toBeGreaterThan(250);
  });

  it("reads every frame of the trade recording", () => {
    const counts = kinds(wsFixtureFrames("crypto-trades"));
    expect(counts.trade).toBe(3);
    expect(counts.reply).toBe(1);
    expect(counts.bookTicker).toBeGreaterThan(0);
  });

  it("reads every reply and snapshot of the control session", () => {
    const counts = kinds(wsFixtureFrames("control-and-errors"));
    expect(counts.reply).toBeGreaterThanOrEqual(15);
    expect(counts.depthSnapshot).toBeGreaterThan(0);
  });

  it("turns a depth10 snapshot into best-first levels in bps and micro-contracts", () => {
    const frame = wsFixtureFrames("sports-depth10").find((text) => text.includes("lastUpdateId"));
    const snapshot = parseOf(frame ?? "", "depthSnapshot");
    expect(snapshot.symbol).toBe("gemi-nba-2611180030-nyk-tor-m-nyk");
    expect(snapshot.lastUpdateId).toBeGreaterThan(1_700_000_000_000_000);
    expect(snapshot.bids[0]).toEqual({ priceBps: 5600n, qty: 953_000_000n });
    expect(snapshot.asks[0]).toEqual({ priceBps: 5700n, qty: 4_250_000_000n });
    for (let index = 1; index < snapshot.bids.length; index += 1) {
      expect(snapshot.bids[index - 1]!.priceBps > snapshot.bids[index]!.priceBps).toBe(true);
    }
    for (let index = 1; index < snapshot.asks.length; index += 1) {
      expect(snapshot.asks[index - 1]!.priceBps < snapshot.asks[index]!.priceBps).toBe(true);
    }
  });

  it("drops zero-quantity levels from a snapshot and sorts it", () => {
    const snapshot = parseOf(
      JSON.stringify({
        lastUpdateId: 5,
        symbol: "x",
        bids: [
          ["0.4000", "1.00"],
          ["0.5000", "0.00"],
          ["0.4500", "2.00"],
        ],
        asks: [
          ["0.6000", "3.00"],
          ["0.5500", "4.00"],
        ],
      }),
      "depthSnapshot",
    );
    expect(snapshot.bids.map((level) => level.priceBps)).toEqual([4500n, 4000n]);
    expect(snapshot.asks.map((level) => level.priceBps)).toEqual([5500n, 6000n]);
  });

  it("keeps the zero quantities of a depth update: they remove a level", () => {
    const frame = wsFixtureFrames("sports-depth10").find((text) => text.includes("depthUpdate"));
    const update = parseOf(frame ?? "", "depthUpdate");
    expect(update.lastUpdateId).toBeGreaterThanOrEqual(update.firstUpdateId);
    expect(update.eventTimeMs).toBeGreaterThan(1_794_000_000_000);
    expect(update.eventTimeMs).toBeLessThan(1_800_000_000_000);
    const zero = parseOf(
      '{"e":"depthUpdate","E":1794932366674803380,"s":"x","U":1,"u":2,"b":[["0.5300","0.00"]],"a":[]}',
      "depthUpdate",
    );
    expect(zero.bids).toEqual([{ priceBps: 5300n, qty: 0n }]);
  });

  it("reads a book ticker, with and without the last-trade fields", () => {
    const ticker = parseOf(
      '{"u":1764531742355199,"E":1794932247419502124,"s":"gemi-nba-2611180030-nyk-tor-m-nyk","b":"0.5600","B":"953.00","a":"0.5700","A":"4250.00","c":"0.5800","C":"135.65"}',
      "bookTicker",
    );
    expect(ticker.bid).toEqual({ priceBps: 5600n, qty: 953_000_000n });
    expect(ticker.ask).toEqual({ priceBps: 5700n, qty: 4_250_000_000n });
    expect(ticker.eventTimeMs).toBe(1_794_932_247_419);
    const oneSided = parseOf('{"u":1,"E":1,"s":"x","b":"0.1000","B":"1.00"}', "bookTicker");
    expect(oneSided.ask).toBeNull();
    // Recorded: an empty side is sent as empty strings.
    const empty = parseOf(
      '{"u":1764531742882451,"E":1794932593178505427,"s":"gemi-eth05m2611171625-up","b":"","B":"","a":"","A":""}',
      "bookTicker",
    );
    expect(empty.bid).toBeNull();
    expect(empty.ask).toBeNull();
  });

  it("reads the recorded trade prints", () => {
    const trades = wsFixtureFrames("crypto-trades")
      .map((frame) => parseGeminiWsMessage(frame))
      .filter((message) => message.kind === "trade");
    expect(trades[0]).toEqual({
      kind: "trade",
      symbol: "gemi-eth15m2611171630-up",
      tradeId: 1_893_456_013_557_062,
      eventTimeMs: 1_794_932_625_041,
      priceBps: 3000n,
      qty: 5_000_000n,
      buyerIsMaker: true,
    });
  });

  it("reads acknowledgements, refusals and list results", () => {
    const replies = wsFixtureFrames("control-and-errors")
      .map((frame) => parseGeminiWsMessage(frame))
      .filter((message) => message.kind === "reply");
    expect(replies).toContainEqual({
      kind: "reply",
      id: 1,
      status: 200,
      result: undefined,
      error: null,
    });
    expect(replies).toContainEqual({
      kind: "reply",
      id: 5,
      status: 400,
      result: undefined,
      error: { code: -1013, msg: "Invalid stream name: NOPE-XYZ@bookTicker" },
    });
    expect(replies).toContainEqual({
      kind: "reply",
      id: 7,
      status: 400,
      result: undefined,
      error: { code: -1020, msg: "Unsupported operation" },
    });
    // A subscribe without an id is acknowledged with id null.
    expect(replies.some((reply) => reply.id === null && reply.status === 200)).toBe(true);
  });

  it("records the close Gemini sends after a non-JSON frame", () => {
    const close = wsFixtureRows("control-and-errors").find(
      (row) => row.kind === "close" && row.session === "explore2",
    );
    expect(close?.data).toEqual({ code: 1003, reason: "Invalid payload" });
  });
});

describe("parseGeminiWsMessage on bad input", () => {
  it.each([
    ["not JSON", "{oops", "frame is not JSON"],
    ["an array", "[1,2]", "frame is not a JSON object"],
    ["an unknown object", '{"hello":"world"}', "unknown message kind"],
    [
      "a snapshot with a price above 1",
      '{"lastUpdateId":1,"symbol":"x","bids":[["1.5000","1.00"]],"asks":[]}',
      "malformed depth snapshot at bids.0.0",
    ],
    [
      "a snapshot with a numeric quantity",
      '{"lastUpdateId":1,"symbol":"x","bids":[["0.5000",1]],"asks":[]}',
      "malformed depth snapshot at bids.0.1",
    ],
    [
      "a trade without a side flag",
      '{"E":1,"s":"x","t":1,"p":"0.3000","q":"5.00"}',
      "malformed trade at m",
    ],
  ])("rejects %s", (_label, frame, message) => {
    expect(() => parseGeminiWsMessage(frame)).toThrow(GeminiWsMessageError);
    expect(() => parseGeminiWsMessage(frame)).toThrow(message);
  });
});
