import { describe, expect, it } from "vitest";

import {
  bpsToWholePercent,
  centsToMicro,
  clampCardCents,
  formatAmount,
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  microToCents,
  pad2,
  parseDollarsToCents,
  splitMoney,
  startGroup,
  timeLeft,
} from "./index";

describe("money", () => {
  it("formats micro-USDC with thousands separators and two decimals", () => {
    expect(formatMoney("20000000")).toBe("$20.00");
    expect(formatMoney("2145450000")).toBe("$2,145.45");
    expect(formatMoney("0")).toBe("$0.00");
    expect(formatMoney(999_999_990_000n)).toBe("$999,999.99");
  });

  it("rounds down to the cent, never up", () => {
    expect(formatMoney("2548000")).toBe("$2.54");
    expect(formatMoney("10452000")).toBe("$10.45");
  });

  it("drops .00 in compact form", () => {
    expect(formatMoneyCompact("1000000000")).toBe("$1,000");
    expect(formatMoneyCompact("2550000")).toBe("$2.55");
  });

  it("formats negatives", () => {
    expect(formatMoney(-2_500_000n)).toBe("-$2.50");
    expect(formatAmount(-2_500_000n)).toBe("-2.50");
    expect(splitMoney(-2_500_000n)).toEqual({ sign: "-", text: "2.50" });
  });

  it("handles amounts above Number.MAX_SAFE_INTEGER without a float", () => {
    expect(formatMoney("9007199254740993000000")).toBe("$9,007,199,254,740,993.00");
  });

  it("converts between cents and micro-USDC", () => {
    expect(centsToMicro(2000)).toBe(20_000_000n);
    expect(microToCents("20000000")).toBe(2000);
    expect(() => microToCents("20000001")).toThrow();
    expect(() => centsToMicro(-1)).toThrow();
    expect(() => centsToMicro(1.5)).toThrow();
  });

  it("parses what a merchant types", () => {
    expect(parseDollarsToCents("20")).toBe(2000);
    expect(parseDollarsToCents("20.5")).toBe(2050);
    expect(parseDollarsToCents("$1,000.99")).toBe(100_099);
    expect(parseDollarsToCents("0.5")).toBe(50);
    expect(parseDollarsToCents(".5")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("-5")).toBeNull();
  });

  it("cuts extra decimals instead of rounding them", () => {
    expect(parseDollarsToCents("1.999")).toBe(199);
  });

  it("keeps a card amount between $0.50 and $999,999.99", () => {
    expect(clampCardCents(1)).toBe(50);
    expect(clampCardCents(2000)).toBe(2000);
    expect(clampCardCents(1_000_000_000)).toBe(99_999_999);
  });
});

describe("percent", () => {
  it("rounds basis points to the nearest whole percent", () => {
    expect(bpsToWholePercent(1240)).toBe(12);
    expect(bpsToWholePercent(1274)).toBe(13);
    expect(bpsToWholePercent(1250)).toBe(13);
    expect(bpsToWholePercent(0)).toBe(0);
    expect(formatPercent(1800)).toBe("18%");
    expect(formatPercent(10_000)).toBe("100%");
  });
});

describe("countdown", () => {
  const target = "2026-11-21T20:25:00.000Z";

  it("splits the time left", () => {
    const now = new Date("2026-11-19T15:40:00.000Z").getTime();
    expect(timeLeft(target, now)).toEqual({
      days: 2,
      hours: 4,
      minutes: 45,
      seconds: 0,
      expired: false,
    });
  });

  it("is expired, at zero, once the target is reached or passed", () => {
    const at = new Date(target).getTime();
    expect(timeLeft(target, at).expired).toBe(true);
    expect(timeLeft(target, at + 60_000)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      expired: true,
    });
  });

  it("pads to two digits", () => {
    expect(pad2(4)).toBe("04");
    expect(pad2(45)).toBe("45");
  });
});

describe("startGroup", () => {
  // Wednesday 18 November 2026, 14:00 local.
  const now = new Date(2026, 10, 18, 14, 0, 0);

  it("puts today's games under tonight", () => {
    expect(startGroup(new Date(2026, 10, 18, 19, 0).toISOString(), now)).toBe("tonight");
  });

  it("puts the coming Saturday and Sunday under this weekend", () => {
    expect(startGroup(new Date(2026, 10, 21, 14, 30).toISOString(), now)).toBe("weekend");
    expect(startGroup(new Date(2026, 10, 22, 19, 0).toISOString(), now)).toBe("weekend");
  });

  it("puts a weekday, or a weekend more than a week away, under later", () => {
    expect(startGroup(new Date(2026, 10, 19, 19, 0).toISOString(), now)).toBe("later");
    expect(startGroup(new Date(2026, 10, 28, 19, 0).toISOString(), now)).toBe("later");
  });
});
