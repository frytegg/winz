import { describe, expect, it } from "vitest";

import { GeminiHttpError, GeminiNetworkError, GeminiResponseError } from "./errors";
import { GeminiRestClient } from "./gemini-rest-client";
import {
  fakeFetch,
  fakeTime,
  fixtureJson,
  fixtureText,
  jsonResponse,
  silentLogger,
  type FakeFetch,
  type FakeResponse,
  type FakeTime,
} from "./test-support";

const BASE_URL = "https://gemini.test";

function setup(respond: (url: string, call: number) => FakeResponse): {
  client: GeminiRestClient;
  http: FakeFetch;
  time: FakeTime;
} {
  const http = fakeFetch(respond);
  const time = fakeTime();
  const client = new GeminiRestClient({
    baseUrl: `${BASE_URL}/`,
    logger: silentLogger,
    fetch: http.fetch,
    now: time.now,
    sleep: time.sleep,
    random: () => 0.5,
  });
  return { client, http, time };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

describe("GeminiRestClient.listActiveEvents", () => {
  it("parses the recorded active sports page", async () => {
    const { client } = setup(() => ({ status: 200, body: fixtureText("events-active-sports") }));
    const page = await client.listActiveEvents({ category: "Sports", limit: 50, offset: 0 });

    expect(page.pagination).toEqual({ limit: 50, offset: 0, total: 6 });
    expect(page.events.map((event) => event.ticker)).toEqual([
      "NCAAF-2611212030-ARK-TEX-M",
      "NCAAF-2611212030-ARK-TEX-S",
      "NHL-2611180000-EDM-FLA-M",
      "EPL-2611211730-ARS-NEW-M",
      "NFL-2611221800-BAL-CAR-1QM",
      "WNBA27DRAFTENESKANTER",
    ]);
    const game = page.events[0];
    expect(game?.startTime).toBe("2026-11-21T20:30:00.000Z");
    expect(game?.events?.map((child) => child.ticker)).toEqual([
      "NCAAF-2611212030-ARK-TEX-S",
      "NCAAF-2611212030-ARK-TEX-T",
      "NCAAF-2611212030-ARK-TEX-1HS",
      "NCAAF-2611212030-ARK-TEX-1HT",
    ]);
    expect(game?.contracts[0]).toMatchObject({
      label: "Texas",
      instrumentSymbol: "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX",
      prices: { bestBid: "0.9", bestAsk: "0.92" },
      sportsSide: "home",
    });
  });

  it("sends the filters as query parameters and a plain user agent", async () => {
    const { client, http } = setup(() => ({
      status: 200,
      body: fixtureText("events-active-sports"),
    }));
    await client.listActiveEvents({
      category: "Sports",
      search: "Texas A&M",
      limit: 25,
      offset: 50,
    });

    expect(http.urls).toEqual([
      `${BASE_URL}/v1/prediction-markets/events?limit=25&offset=50&status=active&category=Sports&search=Texas+A%26M`,
    ]);
    expect(http.headers[0]).toEqual({ accept: "application/json", "user-agent": "node" });
  });

  it("leaves out the filters that are not set", async () => {
    const { client, http } = setup(() => ({
      status: 200,
      body: fixtureText("events-active-sports"),
    }));
    await client.listActiveEvents({ limit: 50, offset: 0 });
    expect(http.urls[0]).toBe(
      `${BASE_URL}/v1/prediction-markets/events?limit=50&offset=0&status=active`,
    );
  });
});

describe("GeminiRestClient.listAllSportsEvents", () => {
  it("walks every page until the reported total is reached", async () => {
    const all = fixtureJson("events-active-sports") as { data: unknown[] };
    const { client, http } = setup((url) => {
      const params = new URL(url).searchParams;
      const limit = Number(params.get("limit"));
      const offset = Number(params.get("offset"));
      return jsonResponse({
        data: all.data.slice(offset, offset + 4),
        pagination: { limit, offset, total: all.data.length },
      });
    });

    const events = await client.listAllSportsEvents();

    expect(events).toHaveLength(6);
    expect(http.urls.map((url) => new URL(url).searchParams.get("offset"))).toEqual(["0", "4"]);
    expect(http.urls.every((url) => new URL(url).searchParams.get("category") === "Sports")).toBe(
      true,
    );
  });

  it("stops on an empty page even if the total says there is more", async () => {
    const { client, http } = setup(() =>
      jsonResponse({ data: [], pagination: { limit: 50, offset: 0, total: 900 } }),
    );
    expect(await client.listAllSportsEvents()).toEqual([]);
    expect(http.urls).toHaveLength(1);
  });

  it("stops at maxPages when the listing never ends", async () => {
    const all = fixtureJson("events-active-sports") as { data: unknown[] };
    const { client, http } = setup(() =>
      jsonResponse({
        data: all.data.slice(0, 1),
        pagination: { limit: 1, offset: 0, total: 1_000_000 },
      }),
    );
    const events = await client.listAllActiveEvents({ pageSize: 1, maxPages: 3 });
    expect(events).toHaveLength(3);
    expect(http.urls).toHaveLength(3);
  });
});

describe("GeminiRestClient.getBook", () => {
  it("parses a recorded book with depth into basis points and micro-contracts", async () => {
    const { client, http, time } = setup(() => ({
      status: 200,
      body: fixtureText("book-with-depth"),
    }));
    const book = await client.getBook("GEMI-NCAAF-2611212030-ARK-TEX-M-TEX");

    expect(http.urls).toEqual([`${BASE_URL}/v1/book/GEMI-NCAAF-2611212030-ARK-TEX-M-TEX`]);
    expect(book).toEqual({
      instrumentSymbol: "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX",
      bids: [
        { priceBps: 9000n, qty: 791_000_000n },
        { priceBps: 8900n, qty: 842_000_000n },
      ],
      asks: [
        { priceBps: 9200n, qty: 2_070_000_000n },
        { priceBps: 9300n, qty: 72_000_000n },
        { priceBps: 9400n, qty: 250_000_000n },
        { priceBps: 9500n, qty: 14_999_000_000n },
      ],
      observedAtMs: time.now(),
    });
  });

  it("stamps the book with the injected clock, read after the response", async () => {
    const time = fakeTime(1_000);
    const http = fakeFetch(() => {
      time.advance(250);
      return { status: 200, body: fixtureText("book-empty") };
    });
    const client = new GeminiRestClient({
      baseUrl: BASE_URL,
      logger: silentLogger,
      fetch: http.fetch,
      now: time.now,
      sleep: time.sleep,
    });
    expect((await client.getBook("GEMI-X")).observedAtMs).toBe(1_250);
  });

  it("returns empty arrays for a recorded empty book", async () => {
    const { client } = setup(() => ({ status: 200, body: fixtureText("book-empty") }));
    const book = await client.getBook("GEMI-NCAAF-2611212030-ARK-TEX-S-TEX6");
    expect(book.bids).toEqual([]);
    expect(book.asks).toEqual([]);
  });

  it("returns best-first levels even if the API order changes, and drops empty levels", async () => {
    const { client } = setup(() =>
      jsonResponse({
        bids: [
          { price: "0.50", amount: "1" },
          { price: "0.53", amount: "2" },
          { price: "0.52", amount: "0" },
        ],
        asks: [
          { price: "0.60", amount: "1" },
          { price: "0.54", amount: "441.19" },
        ],
      }),
    );
    const book = await client.getBook("GEMI-X");
    expect(book.bids.map((level) => level.priceBps)).toEqual([5300n, 5000n]);
    expect(book.asks).toEqual([
      { priceBps: 5400n, qty: 441_190_000n },
      { priceBps: 6000n, qty: 1_000_000n },
    ]);
  });
});

describe("GeminiRestClient.listRecentlySettled", () => {
  it("parses the recorded settled page and filters by category", async () => {
    const { client, http } = setup(() => ({
      status: 200,
      body: fixtureText("events-recently-settled"),
    }));
    const page = await client.listRecentlySettled({ category: "Sports" });

    expect(http.urls).toEqual([
      `${BASE_URL}/v1/prediction-markets/events/recently-settled?limit=50&category=Sports`,
    ]);
    expect(page.events).toHaveLength(4);
    expect(page.events.every((event) => event.status === "settled")).toBe(true);
    const game = page.events.find((event) => event.ticker === "NHL-2611170230-VAN-UTA-M");
    expect(game?.contracts.map((contract) => contract.resolutionSide)).toEqual(["yes", "no"]);
  });
});

describe("GeminiRestClient response validation", () => {
  it("throws GeminiResponseError with the path of a missing field", async () => {
    const payload = fixtureJson("events-active-sports") as {
      data: { contracts: Record<string, unknown>[] }[];
    };
    delete payload.data[1]?.contracts[0]?.instrumentSymbol;
    const { client, http } = setup(() => jsonResponse(payload));

    const error = await rejection(client.listActiveEvents({ limit: 50, offset: 0 }));

    expect(error).toBeInstanceOf(GeminiResponseError);
    const responseError = error as GeminiResponseError;
    expect(responseError.path).toBe("data[1].contracts[0].instrumentSymbol");
    expect(responseError.endpoint).toBe(
      "/v1/prediction-markets/events?limit=50&offset=0&status=active",
    );
    expect(responseError.issues).toHaveLength(1);
    expect(http.urls).toHaveLength(1);
  });

  it("points into nested child events", async () => {
    const payload = fixtureJson("events-active-sports") as {
      data: { events: { contracts: { prices: Record<string, unknown> }[] }[] }[];
    };
    const prices = payload.data[2]?.events[0]?.contracts[1]?.prices;
    if (prices) prices.bestAsk = "1.28";
    const { client } = setup(() => jsonResponse(payload));

    const error = await rejection(client.listActiveEvents({ limit: 50, offset: 0 }));
    expect((error as GeminiResponseError).path).toBe(
      "data[2].events[0].contracts[1].prices.bestAsk",
    );
  });

  it("rejects a startTime that is not an ISO timestamp", async () => {
    const payload = fixtureJson("events-active-sports") as { data: Record<string, unknown>[] };
    const first = payload.data[0];
    if (first) first.startTime = "next Saturday";
    const { client } = setup(() => jsonResponse(payload));
    const error = await rejection(client.listActiveEvents({ limit: 50, offset: 0 }));
    expect((error as GeminiResponseError).path).toBe("data[0].startTime");
  });

  it("rejects an envelope without pagination", async () => {
    const { client } = setup(() => jsonResponse({ data: [] }));
    const error = await rejection(client.listRecentlySettled());
    expect(error).toBeInstanceOf(GeminiResponseError);
    expect((error as GeminiResponseError).path).toBe("pagination");
  });

  it("rejects a book level whose price is not a decimal", async () => {
    const { client } = setup(() =>
      jsonResponse({ bids: [{ price: "abc", amount: "1" }], asks: [] }),
    );
    const error = await rejection(client.getBook("GEMI-X"));
    expect((error as GeminiResponseError).path).toBe("bids[0].price");
  });

  it("rejects a body that is not JSON, without retrying", async () => {
    const { client, http } = setup(() => ({ status: 200, body: "<html>maintenance</html>" }));
    const error = await rejection(client.getBook("GEMI-X"));
    expect(error).toBeInstanceOf(GeminiResponseError);
    expect((error as GeminiResponseError).path).toBe("$");
    expect(http.urls).toHaveLength(1);
  });

  it("ignores fields it does not know", async () => {
    const { client } = setup(() =>
      jsonResponse({ bids: [], asks: [], sequence: 12, somethingNew: { nested: true } }),
    );
    await expect(client.getBook("GEMI-X")).resolves.toMatchObject({ bids: [], asks: [] });
  });
});

describe("GeminiRestClient retries", () => {
  it("retries on 429 then succeeds", async () => {
    const { client, http, time } = setup((_url, call) =>
      call === 0
        ? { status: 429, body: '{"result":"error","reason":"RateLimited"}' }
        : { status: 200, body: fixtureText("book-with-depth") },
    );
    const book = await client.getBook("GEMI-X");

    expect(book.bids).toHaveLength(2);
    expect(http.urls).toHaveLength(2);
    // First backoff step is 500 ms; with random = 0.5 the jittered wait is 375 ms.
    expect(time.sleeps).toEqual([375]);
  });

  it("waits at least Retry-After on 429", async () => {
    const { client, time } = setup((_url, call) =>
      call === 0
        ? { status: 429, body: "", headers: { "retry-after": "7" } }
        : { status: 200, body: fixtureText("book-empty") },
    );
    await client.getBook("GEMI-X");
    expect(time.sleeps).toEqual([7_000]);
  });

  it("backs off exponentially on 5xx and gives up after the bounded attempts", async () => {
    const { client, http, time } = setup(() => ({ status: 503, body: "unavailable" }));
    const error = await rejection(client.getBook("GEMI-X"));

    expect(error).toBeInstanceOf(GeminiHttpError);
    expect((error as GeminiHttpError).status).toBe(503);
    expect(http.urls).toHaveLength(4);
    expect(time.sleeps).toEqual([375, 750, 1_500]);
  });

  it("spreads the wait between half and the whole step with jitter", async () => {
    const waits: number[] = [];
    for (const random of [0, 0.999]) {
      const http = fakeFetch((_url, call) =>
        call === 0 ? { status: 500, body: "" } : { status: 200, body: fixtureText("book-empty") },
      );
      const time = fakeTime();
      const client = new GeminiRestClient({
        baseUrl: BASE_URL,
        logger: silentLogger,
        fetch: http.fetch,
        now: time.now,
        sleep: time.sleep,
        random: () => random,
      });
      await client.getBook("GEMI-X");
      waits.push(...time.sleeps);
    }
    expect(waits).toEqual([250, 500]);
  });

  it("does not retry on 404", async () => {
    const { client, http, time } = setup(() => ({ status: 404, body: "Not Found" }));
    const error = await rejection(client.getBook("GEMI-X"));

    expect(error).toBeInstanceOf(GeminiHttpError);
    expect((error as GeminiHttpError).status).toBe(404);
    expect(http.urls).toHaveLength(1);
    expect(time.sleeps).toEqual([]);
  });

  it("does not retry on the 400 Gemini returns for an unknown symbol", async () => {
    // Body recorded from GET /v1/book/GEMI-NOPE-XYZ on 17 Nov 2026.
    const body =
      '{"result":"error","reason":"Bad Request","message":"Supplied value \'GEMI-NOPE-XYZ\' is not a valid symbol"}';
    const { client, http } = setup(() => ({ status: 400, body }));
    const error = await rejection(client.getBook("GEMI-NOPE-XYZ"));

    expect((error as GeminiHttpError).status).toBe(400);
    expect((error as GeminiHttpError).bodySnippet).toContain("not a valid symbol");
    expect(http.urls).toHaveLength(1);
  });

  it("retries a network failure then succeeds", async () => {
    const { client, http } = setup((_url, call) => {
      if (call === 0) throw new TypeError("fetch failed");
      return { status: 200, body: fixtureText("book-empty") };
    });
    await expect(client.getBook("GEMI-X")).resolves.toMatchObject({ bids: [], asks: [] });
    expect(http.urls).toHaveLength(2);
  });

  it("throws GeminiNetworkError once every attempt failed", async () => {
    const { client, http } = setup(() => {
      throw new TypeError("fetch failed", { cause: new Error("ECONNRESET") });
    });
    const error = await rejection(client.getBook("GEMI-X"));

    expect(error).toBeInstanceOf(GeminiNetworkError);
    expect((error as GeminiNetworkError).attempts).toBe(4);
    expect((error as GeminiNetworkError).message).toContain("ECONNRESET");
    expect(http.urls).toHaveLength(4);
  });

  it("takes a limiter token for every attempt, retries included", async () => {
    const http = fakeFetch((_url, call) =>
      call < 2 ? { status: 429, body: "" } : { status: 200, body: fixtureText("book-empty") },
    );
    const time = fakeTime();
    let acquired = 0;
    const client = new GeminiRestClient({
      baseUrl: BASE_URL,
      logger: silentLogger,
      fetch: http.fetch,
      now: time.now,
      sleep: time.sleep,
      limiter: {
        acquire: () => {
          acquired += 1;
          return Promise.resolve();
        },
      },
    });
    await client.getBook("GEMI-X");
    expect(acquired).toBe(3);
  });
});
