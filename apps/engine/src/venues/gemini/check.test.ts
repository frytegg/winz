import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../testing/postgres";
import { makerPriceFor, runVenueCheck, type VenueCheckReport } from "./check";
import { PgVenueCheckRecorder } from "./check-store";
import {
  KEYS_MISSING,
  formatVenueCheckReport,
  runAndRecordVenueCheck,
  runBootVenueCheck,
} from "./run";
import type { SimGemini } from "./sim-server";
import {
  SIM_KEY,
  SIM_SECRET,
  capturedLogger,
  cryptoContract,
  noSleep,
  simClient,
  simGemini,
} from "./test-support";

const ORDER_PATH = "/v1/prediction-markets/order";
const CANCEL_PATH = "/v1/prediction-markets/order/cancel";
const FIRST_ID = 73_797_746_498_585_286n;

let sim: SimGemini | null = null;

afterEach(async () => {
  await sim?.stop();
  sim = null;
});

async function check(
  server: SimGemini,
  options: { acceptTerms?: boolean; symbol?: string; apiKey?: string } = {},
): Promise<{ report: VenueCheckReport; lines: string[] }> {
  const { logger, lines } = capturedLogger();
  const report = await runVenueCheck(
    {
      api: simClient(
        server,
        logger,
        options.apiKey === undefined ? {} : { apiKey: options.apiKey },
      ),
      logger,
      sleep: noSleep,
    },
    {
      trigger: "command",
      ...(options.acceptTerms === undefined ? {} : { acceptTerms: options.acceptTerms }),
      ...(options.symbol === undefined ? {} : { symbol: options.symbol }),
    },
  );
  return { report, lines };
}

describe("venue:check, the full sequence on the simulated Gemini", () => {
  it("proves the three steps, each read back from Gemini", async () => {
    sim = await simGemini();
    const { report } = await check(sim);
    expect(report.failure).toBeNull();
    expect(report.outcome).toBe("proven");
    expect(report.instrument?.symbol).toBe("GEMI-BTC2611202200-HI91000");
    expect(report.orders.map((order) => [order.action, order.status])).toEqual([
      ["placed_maker", "open"],
      ["cancelled", "cancelled"],
      ["filled", "filled"],
    ]);
    const [placed, cancelled, filled] = report.orders;
    // The maker rests two ticks under the bid of 0.38: 0.36, one contract.
    expect(placed).toMatchObject({
      venueOrderId: FIRST_ID.toString(),
      kind: "maker",
      side: "buy",
      limitPriceBps: 3_600n,
      qty: 1_000_000n,
      filledQty: 0n,
    });
    expect(cancelled?.venueOrderId).toBe(placed?.venueOrderId);
    // One contract bought at the ask of 0.57.
    expect(filled).toMatchObject({
      venueOrderId: (FIRST_ID + 1n).toString(),
      kind: "taker",
      limitPriceBps: 5_700n,
      filledQty: 1_000_000n,
      avgPrice: "0.57",
    });
    // What Gemini received: maker-or-cancel, then a cancel of that id, then immediate-or-cancel.
    const placements = sim.privateRequests(ORDER_PATH).map((request) => request.payload);
    expect(placements[0]).toMatchObject({
      makerOrCancel: true,
      timeInForce: "good-til-cancel",
      price: "0.36",
    });
    expect(placements[1]).toMatchObject({
      timeInForce: "immediate-or-cancel",
      price: "0.57",
      quantity: "1.00",
    });
    expect(sim.privateRequests(CANCEL_PATH)[0]?.payload?.orderId).toBe(FIRST_ID);
    // Read back: active orders while resting, the history once closed.
    const readPaths = sim.privateRequests().map((request) => request.path);
    expect(readPaths).toContain("/v1/prediction-markets/orders/active");
    expect(readPaths).toContain("/v1/prediction-markets/orders/history");
    // Nothing is left resting.
    expect(sim.orders.filter((order) => order.status === "open")).toEqual([]);
    expect(formatVenueCheckReport({ report, runId: null, recordError: null })).toContain("PROVEN");
  });

  it("refused authentication: fails at preflight with Gemini's reason, and places nothing", async () => {
    sim = await simGemini();
    const { report } = await check(sim, { apiKey: "account-NotTheKey" });
    expect(report).toMatchObject({ outcome: "failed", failedStep: "preflight", orders: [] });
    expect(report.failure).toContain("InvalidApiKey");
    expect(sim.privateRequests(ORDER_PATH)).toHaveLength(0);
  });

  it("429 then success: the placement is sent again after the wait, and the check proves", async () => {
    sim = await simGemini();
    sim.script(ORDER_PATH, {
      status: 429,
      body: '{"result":"error","reason":"RateLimit","message":"x"}',
      headers: { "retry-after": "0" },
    });
    const { report } = await check(sim);
    expect(report.outcome).toBe("proven");
    expect(sim.privateRequests(ORDER_PATH).map((request) => request.status)).toEqual([
      429, 201, 201,
    ]);
    expect(sim.orders).toHaveLength(2);
  });

  it("an order that does not rest (filled at once by the market) fails the maker step", async () => {
    sim = await simGemini();
    sim.afterPlace = (order) => {
      if (order.makerOrCancel && order.status === "open") {
        order.filled = order.quantity;
        order.notional = order.quantity * order.price;
        order.status = "filled";
      }
    };
    const { report } = await check(sim);
    expect(report).toMatchObject({ outcome: "failed", failedStep: "placed_maker", orders: [] });
    expect(report.failure).toContain("filled");
    expect(sim.privateRequests(ORDER_PATH)).toHaveLength(1);
  });

  it("a maker refused twice as crossing (the ask came down to it each time) fails the maker step", async () => {
    sim = await simGemini();
    let placements = 0;
    // A seller reaches the maker's price just as it arrives: Gemini's maker-or-cancel cancels it.
    sim.afterPlace = (order) => {
      placements += 1;
      if (order.makerOrCancel) {
        order.status = "cancelled";
        order.cancelledAt = order.createdAt;
      }
    };
    const { report } = await check(sim);
    expect(placements).toBe(2);
    expect(report).toMatchObject({ outcome: "failed", failedStep: "placed_maker", orders: [] });
    expect(report.failure).toContain("would_cross");
  });

  it("a book that crossed by the retry leaves no price for a resting buy: fails without a second order", async () => {
    sim = await simGemini();
    sim.afterPlace = (order) => {
      const contract = sim?.contracts.get("GEMI-BTC2611202200-HI91000");
      if (order.makerOrCancel && contract !== undefined) {
        order.status = "cancelled";
        contract.asks = [{ price: "0.30", amount: "1.0" }, ...contract.asks];
      }
    };
    const { report } = await check(sim);
    expect(report).toMatchObject({ outcome: "failed", failedStep: "placed_maker" });
    expect(report.failure).toContain("no price leaves a buy away from the ask");
    expect(sim.privateRequests(ORDER_PATH)).toHaveLength(1);
  });

  it("the cancel of an order filled in the meantime fails the cancel step, read back filled", async () => {
    sim = await simGemini();
    sim.beforePrivate = (path) => {
      if (path === CANCEL_PATH) sim?.fill(FIRST_ID);
    };
    const { report } = await check(sim);
    expect(report).toMatchObject({ outcome: "failed", failedStep: "cancelled" });
    expect(report.failure).toBe("the maker order filled before it could be cancelled");
    expect(report.orders.map((order) => order.action)).toEqual(["placed_maker"]);
    // No marketable order was sent after the failure.
    expect(sim.privateRequests(ORDER_PATH)).toHaveLength(1);
  });

  it("a failure after the maker rests cancels it: nothing is left at Gemini", async () => {
    sim = await simGemini();
    // The book empties before the marketable order: the filled step fails.
    sim.beforePrivate = (path) => {
      if (path === CANCEL_PATH) {
        const contract = sim?.contracts.get("GEMI-BTC2611202200-HI91000");
        if (contract !== undefined) contract.asks = [];
      }
    };
    const { report } = await check(sim);
    expect(report).toMatchObject({ outcome: "failed", failedStep: "filled" });
    expect(report.failure).toContain("no ask");
    expect(sim.orders.filter((order) => order.status === "open")).toEqual([]);
  });

  it("terms not accepted: fails at preflight unless allowed to accept them", async () => {
    sim = await simGemini({ termsAccepted: false });
    const refused = await check(sim);
    expect(refused.report).toMatchObject({ outcome: "failed", failedStep: "preflight" });
    expect(refused.report.failure).toContain("terms");
    expect(sim.privateRequests("/v1/prediction-markets/terms/accept")).toHaveLength(0);

    const accepted = await check(sim, { acceptTerms: true });
    expect(accepted.report.outcome).toBe("proven");
    expect(sim.privateRequests("/v1/prediction-markets/terms/accept")).toHaveLength(1);
  });

  it("no two-sided crypto contract: fails at the instrument step", async () => {
    sim = await simGemini({ contracts: [cryptoContract({ bids: [], asks: [] })] });
    const { report } = await check(sim);
    expect(report).toMatchObject({ outcome: "failed", failedStep: "instrument" });
  });

  it("a contract expiring too soon is not chosen", async () => {
    sim = await simGemini({
      contracts: [cryptoContract({ expiryDate: new Date(Date.now() + 5 * 60_000).toISOString() })],
    });
    const { report } = await check(sim);
    expect(report).toMatchObject({ outcome: "failed", failedStep: "instrument" });
  });

  it("the maker price is two ticks under the bid, on the grid, and never near the ask", () => {
    expect(makerPriceFor(3_800n, 5_700n)).toBe(3_600n);
    expect(makerPriceFor(200n, 5_700n)).toBe(100n);
    expect(makerPriceFor(null, 5_700n)).toBe(5_200n);
    expect(makerPriceFor(3_800n, 3_900n)).toBe(3_600n);
    // No room: the buy would sit within two ticks of the ask.
    expect(makerPriceFor(100n, 200n)).toBeNull();
    expect(makerPriceFor(null, 200n)).toBeNull();
    expect(makerPriceFor(3_800n, 3_000n)).toBeNull();
  });
});

describe("the keys never reach a log, a report or the database", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  it("neither the key, the secret, a payload nor a signature appears anywhere", async () => {
    sim = await simGemini();
    const { logger, lines } = capturedLogger();
    const outcome = await runAndRecordVenueCheck({
      api: simClient(sim, logger),
      recorder: new PgVenueCheckRecorder(database.db),
      logger,
      sleep: noSleep,
      options: { trigger: "command" },
    });
    expect(outcome.report.outcome).toBe("proven");
    // And a refused run (wrong secret), whose errors are logged too.
    const refused = await runVenueCheck(
      { api: simClient(sim, logger, { apiSecret: "wrong-secret-0000" }), logger, sleep: noSleep },
      { trigger: "command" },
    );
    expect(refused.outcome).toBe("failed");

    // Positive control: the logs are captured, at trace level, and do name the orders.
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.join("\n")).toContain(FIRST_ID.toString());

    const secrets = [SIM_KEY, SIM_SECRET, "wrong-secret-0000"];
    for (const request of sim.privateRequests()) {
      if (request.rawPayloadHeader !== null) secrets.push(request.rawPayloadHeader);
      if (request.rawSignatureHeader !== null) secrets.push(request.rawSignatureHeader);
    }
    const rows = await database.db`
      select row_to_json(r)::text as text from venue_check_runs r
      union all select row_to_json(c)::text from venue_checks c
    `;
    const haystacks = {
      logs: lines.join("\n"),
      report: JSON.stringify(outcome.report, (_k, v: unknown) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
      printed: formatVenueCheckReport(outcome),
      database: rows.map((row) => String(row.text)).join("\n"),
    };
    for (const [where, text] of Object.entries(haystacks)) {
      for (const secret of secrets) {
        expect(text.includes(secret), `${where} contains a secret`).toBe(false);
      }
    }
  });
});

describe("the proof recorded in Postgres", () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await database.drop();
  });

  it("a proven run: one run row and the three orders with what was read back", async () => {
    sim = await simGemini();
    const { logger } = capturedLogger();
    const outcome = await runAndRecordVenueCheck({
      api: simClient(sim, logger),
      recorder: new PgVenueCheckRecorder(database.db),
      logger,
      sleep: noSleep,
      options: { trigger: "command" },
    });
    expect(outcome.runId).not.toBeNull();
    const runs =
      await database.db`select venue, trigger, outcome, failed_step, failure, instrument from venue_check_runs`;
    expect(runs).toEqual([
      {
        venue: "gemini-sandbox",
        trigger: "command",
        outcome: "proven",
        failed_step: null,
        failure: null,
        instrument: "GEMI-BTC2611202200-HI91000",
      },
    ]);
    const orders = await database.db`
      select venue_order_id, action, side, kind, price_bps, qty::text, filled_qty::text, status, avg_price
      from venue_checks where run_id = ${outcome.runId} order by at, action
    `;
    expect(orders).toEqual([
      {
        venue_order_id: FIRST_ID.toString(),
        action: "placed_maker",
        side: "buy",
        kind: "maker",
        price_bps: 3600,
        qty: "1000000",
        filled_qty: "0",
        status: "open",
        avg_price: null,
      },
      {
        venue_order_id: FIRST_ID.toString(),
        action: "cancelled",
        side: "buy",
        kind: "maker",
        price_bps: 3600,
        qty: "1000000",
        filled_qty: "0",
        status: "cancelled",
        avg_price: null,
      },
      {
        venue_order_id: (FIRST_ID + 1n).toString(),
        action: "filled",
        side: "buy",
        kind: "taker",
        price_bps: 5700,
        qty: "1000000",
        filled_qty: "1000000",
        status: "filled",
        avg_price: "0.57",
      },
    ]);
  });

  it("at boot without the keys: an ERROR log and a failed run saying so, the engine untouched", async () => {
    const { logger, lines } = capturedLogger();
    await runBootVenueCheck({
      settings: {
        baseUrl: "https://api.sandbox.gemini.com",
        apiKey: undefined,
        apiSecret: undefined,
        nonceMode: "incremental",
        symbol: undefined,
        acceptTerms: false,
      },
      db: database.db,
      logger,
      signal: new AbortController().signal,
    });
    const runs =
      await database.db`select trigger, outcome, failed_step, failure from venue_check_runs`;
    expect(runs).toEqual([
      { trigger: "boot", outcome: "failed", failed_step: "preflight", failure: KEYS_MISSING },
    ]);
    expect(lines.some((line) => line.includes('"level":50') && line.includes("cannot run"))).toBe(
      true,
    );
  });

  it("at boot with the keys, against a refusing sandbox: recorded as failed, never thrown", async () => {
    sim = await simGemini();
    const { logger, lines } = capturedLogger();
    await expect(
      runBootVenueCheck({
        settings: {
          baseUrl: sim.baseUrl,
          apiKey: SIM_KEY,
          apiSecret: "not-the-secret",
          nonceMode: "incremental",
          symbol: undefined,
          acceptTerms: false,
        },
        db: database.db,
        logger,
        signal: new AbortController().signal,
        testing: { api: simClient(sim, logger, { apiSecret: "not-the-secret" }), sleep: noSleep },
      }),
    ).resolves.toBeUndefined();
    const [run] = await database.db<{ outcome: string; failed_step: string; failure: string }[]>`
      select outcome, failed_step, failure from venue_check_runs
    `;
    expect(run).toMatchObject({ outcome: "failed", failed_step: "preflight" });
    expect(run?.failure).toContain("InvalidSignature");
    expect(lines.some((line) => line.includes("venue check at boot FAILED"))).toBe(true);
  });

  it("at boot with the keys, against a working sandbox: recorded as proven and logged", async () => {
    sim = await simGemini();
    const { logger, lines } = capturedLogger();
    await runBootVenueCheck({
      settings: {
        baseUrl: sim.baseUrl,
        apiKey: SIM_KEY,
        apiSecret: SIM_SECRET,
        nonceMode: "incremental",
        symbol: undefined,
        acceptTerms: false,
      },
      db: database.db,
      logger,
      signal: new AbortController().signal,
      testing: { api: simClient(sim, logger), sleep: noSleep },
    });
    const runs = await database.db`select trigger, outcome from venue_check_runs`;
    expect(runs).toEqual([{ trigger: "boot", outcome: "proven" }]);
    const count = await database.db`select count(*)::int as n from venue_checks`;
    expect(count[0]?.n).toBe(3);
    expect(lines.some((line) => line.includes("venue check at boot PROVEN"))).toBe(true);
  });

  it("a stopped boot check (the engine shutting down) is recorded as failed and says why", async () => {
    sim = await simGemini();
    const { logger } = capturedLogger();
    const stop = new AbortController();
    stop.abort();
    await runBootVenueCheck({
      settings: {
        baseUrl: sim.baseUrl,
        apiKey: SIM_KEY,
        apiSecret: SIM_SECRET,
        nonceMode: "incremental",
        symbol: undefined,
        acceptTerms: false,
      },
      db: database.db,
      logger,
      signal: stop.signal,
      testing: { api: simClient(sim, logger), sleep: noSleep },
    });
    const [run] = await database.db<{ outcome: string; failure: string }[]>`
      select outcome, failure from venue_check_runs
    `;
    expect(run?.outcome).toBe("failed");
    expect(run?.failure).toContain("shutting down");
    expect(sim.privateRequests(ORDER_PATH)).toHaveLength(0);
  });
});
