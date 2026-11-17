import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_RISK_PARAMS } from "@winz/shared";

import { capturingLogger } from "../../chain/ingest-test-support";
import { createTestDatabase, type TestDatabase } from "../../testing/postgres";
import { PolicyRunner } from "../policy";
import { orderIdPrefix, orderSeqOf } from "./ids";
import { DEFAULT_RUNTIME_RISK_PARAMS, loadRiskParams, policyParamsOf } from "./params";
import { parseBookRef } from "./desk";

let database: TestDatabase;

beforeEach(async () => {
  database = await createTestDatabase();
});
afterEach(async () => {
  await database.drop();
});

describe("loadRiskParams", () => {
  it("falls back to DEFAULT_RISK_PARAMS when engine_params is empty", async () => {
    const params = await loadRiskParams(database.db, pino({ level: "silent" }));
    expect(params).toEqual(DEFAULT_RUNTIME_RISK_PARAMS);
    expect(params.uMaxMicroUsdc).toBe(DEFAULT_RISK_PARAMS.uMaxMicroUsdc);
  });

  it("reads numbers and digit strings, and keeps the default of an invalid value", async () => {
    await database.db`
      insert into engine_params (key, value) values
        ('uMaxMicroUsdc', '"150000000"'), ('makerTtlSeconds', '30'),
        ('askMoveTicks', '"zero"'), ('forceTakerMinutes', '"45"'), ('unrelated', '1')
    `;
    const { logger, entries } = capturingLogger();
    const params = await loadRiskParams(database.db, logger);
    expect(params).toEqual({
      uMaxMicroUsdc: 150_000_000n,
      makerTtlSeconds: 30,
      askMoveTicks: DEFAULT_RISK_PARAMS.askMoveTicks,
      toleranceTicks: DEFAULT_RISK_PARAMS.toleranceTicks,
      forceTakerMinutes: 45,
    });
    expect(entries.some((entry) => entry.key === "askMoveTicks")).toBe(true);
    expect(policyParamsOf(params)).toEqual({
      uMaxMicroUsdc: 150_000_000n,
      makerTtlMs: 30_000,
      askMoveTicks: DEFAULT_RISK_PARAMS.askMoveTicks,
      forceTakerMs: 45 * 60_000,
    });
  });
});

describe("order ids", () => {
  it("one prefix per instrument, accepted by the runner, never a prefix of another's ids", () => {
    const a = orderIdPrefix("GEMI-CFBTEXARK-2611290030-TEXAS-MONEYLINE-YES");
    const b = orderIdPrefix("GEMI-CFBTEXARK-2611290030-ARKANSAS-MONEYLINE-YES");
    expect(a).toMatch(/^wz\.[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
    expect(orderIdPrefix("GEMI-CFBTEXARK-2611290030-TEXAS-MONEYLINE-YES")).toBe(a);
    expect(orderSeqOf(a, `${a}-12`)).toBe(12);
    expect(orderSeqOf(a, `${b}-12`)).toBeNull();
    expect(orderSeqOf(a, `${a}-x`)).toBeNull();
    // The runner validates its prefix: constructing one is the check.
    expect(
      () =>
        new PolicyRunner({
          instrumentSymbol: "X",
          eventStartMs: 0,
          idPrefix: a,
          clock: { now: () => new Date() },
          logger: pino({ level: "silent" }),
          venue: {
            name: "paper",
            placeOrder: () => Promise.reject(new Error("unused")),
            cancelOrder: () => Promise.reject(new Error("unused")),
            getOrder: () => Promise.resolve(null),
            listOpenOrders: () => Promise.resolve([]),
            onEvent: () => () => undefined,
            describe: () => ({ name: "paper", label: "", note: "" }),
          },
        }),
    ).not.toThrow();
  });
});

describe("parseBookRef", () => {
  it("reads a stored book reference back with its bigints", () => {
    const stored = {
      source: "book",
      instrumentSymbol: "X",
      observedAtMs: 1,
      bookSide: "asks",
      levels: [{ priceBps: "4100", displayedQty: "5000000", consumedBeforeQty: "0" }],
      limitPriceBps: "4100",
      orderRemainingQty: "5000000",
      makerFeeWaived: true,
    };
    expect(parseBookRef(stored)).toEqual({
      ...stored,
      levels: [{ priceBps: 4100n, displayedQty: 5_000_000n, consumedBeforeQty: 0n }],
      limitPriceBps: 4100n,
      orderRemainingQty: 5_000_000n,
    });
    expect(parseBookRef(null)).toBeNull();
    expect(parseBookRef({ source: "other" })).toBeNull();
  });
});
