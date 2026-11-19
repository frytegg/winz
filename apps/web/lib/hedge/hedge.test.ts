import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { apiExamples, hedgeDeskResponseSchema } from "@winz/shared";
import { describe, expect, it } from "vitest";

import {
  formatBpsPercent,
  formatPriceBps,
  formatQty,
  shareOfBps,
  wholePercentOfShare,
} from "./format";
import { exposureBar, newestFirst, proofSteps, sortInstruments, unhedgedMeter } from "./view";

const hedgeDeskExample = apiExamples.hedgeDeskExample;

describe("formatQty", () => {
  it("writes micro-contracts with two decimals", () => {
    expect(formatQty("240000000")).toBe("240.00");
    expect(formatQty("441190000")).toBe("441.19");
    expect(formatQty("0")).toBe("0.00");
  });

  it("groups thousands and rounds down to the 0.01 step", () => {
    expect(formatQty("1441195999")).toBe("1,441.19");
    expect(formatQty(12_345_678_000_000n)).toBe("12,345,678.00");
  });
});

describe("formatBpsPercent", () => {
  it("keeps only the digits that exist", () => {
    expect(formatBpsPercent(1100)).toBe("11%");
    expect(formatBpsPercent(1250)).toBe("12.5%");
    expect(formatBpsPercent(1205)).toBe("12.05%");
    expect(formatBpsPercent(0)).toBe("0%");
    expect(formatBpsPercent(10_000)).toBe("100%");
  });
});

describe("formatPriceBps", () => {
  it("writes a contract price in dollars", () => {
    expect(formatPriceBps(1200)).toBe("$0.12");
    expect(formatPriceBps(1300)).toBe("$0.13");
    expect(formatPriceBps(10_000)).toBe("$1.00");
    expect(formatPriceBps(50)).toBe("$0.005");
    expect(formatPriceBps(1205)).toBe("$0.1205");
  });
});

describe("shareOfBps", () => {
  it("is integer arithmetic, rounded down", () => {
    expect(shareOfBps("160000000", "240000000")).toBe(6666);
    expect(wholePercentOfShare(6666)).toBe(67);
    expect(shareOfBps(0n, 5n)).toBe(0);
  });

  it("is zero against an empty whole and never above 100%", () => {
    expect(shareOfBps("5", "0")).toBe(0);
    expect(shareOfBps("500", "100")).toBe(10_000);
  });
});

describe("exposureBar", () => {
  it("splits E into held, working and open", () => {
    const bar = exposureBar("240000000", "160000000", "40000000");
    expect(bar.heldBps).toBe(6666);
    expect(bar.workingBps).toBe(1666);
    expect(bar.openBps).toBe(10_000 - 6666 - 1666);
    expect(bar.hedgedOfExposureBps).toBe(6666);
    expect(bar.overCovered).toBe(false);
  });

  it("is empty with no exposure", () => {
    const bar = exposureBar("0", "0", "0");
    expect(bar).toMatchObject({ heldBps: 0, workingBps: 0, openBps: 0, hedgedOfExposureBps: 0 });
  });

  it("scales to H + W when the cover is above the exposure", () => {
    const bar = exposureBar("100000000", "100000000", "50000000");
    expect(bar.overCovered).toBe(true);
    expect(bar.heldBps + bar.workingBps + bar.openBps).toBe(10_000);
    expect(bar.hedgedOfExposureBps).toBe(10_000);
  });
});

describe("unhedgedMeter", () => {
  it("is ok well under the limit", () => {
    expect(unhedgedMeter("9600000", "300000000")).toEqual({ fillBps: 320, level: "ok" });
  });

  it("turns near the limit from 80% of it", () => {
    expect(unhedgedMeter("240000000", "300000000")).toEqual({ fillBps: 8000, level: "near" });
    expect(unhedgedMeter("239999999", "300000000").level).toBe("ok");
  });

  it("stops the bar at the limit and says it is crossed", () => {
    expect(unhedgedMeter("300000000", "300000000")).toEqual({ fillBps: 10_000, level: "near" });
    expect(unhedgedMeter("450000000", "300000000")).toEqual({ fillBps: 10_000, level: "over" });
  });

  it("does not divide by a zero limit", () => {
    expect(unhedgedMeter("0", "0")).toEqual({ fillBps: 0, level: "ok" });
    expect(unhedgedMeter("1", "0")).toEqual({ fillBps: 10_000, level: "over" });
  });
});

describe("ordering", () => {
  it("puts the newest row first", () => {
    const rows = [{ at: "2026-11-20T22:00:00.000Z" }, { at: "2026-11-20T23:00:00.000Z" }];
    expect(newestFirst(rows).map((row) => row.at)).toEqual([
      "2026-11-20T23:00:00.000Z",
      "2026-11-20T22:00:00.000Z",
    ]);
    expect(rows[0]?.at).toBe("2026-11-20T22:00:00.000Z");
  });

  it("orders instruments by start, then symbol", () => {
    const base = hedgeDeskExample.instruments[0];
    if (base === undefined) throw new Error("the example has an instrument");
    const later = { ...base, symbol: "A", startsAt: "2026-11-22T00:00:00.000Z" };
    const earlyB = { ...base, symbol: "B", startsAt: "2026-11-21T00:00:00.000Z" };
    const earlyA = { ...base, symbol: "A2", startsAt: "2026-11-21T00:00:00.000Z" };
    expect(sortInstruments([later, earlyB, earlyA]).map((item) => item.symbol)).toEqual([
      "A2",
      "B",
      "A",
    ]);
  });
});

describe("proofSteps", () => {
  it("shows every step as not done before the check has run", () => {
    expect(proofSteps(null).map((step) => step.done)).toEqual([null, null, null]);
  });

  it("marks the steps the check has shown", () => {
    const steps = proofSteps(hedgeDeskExample.venueCheck);
    expect(steps.map((step) => [step.action, step.done !== null])).toEqual([
      ["placed_maker", true],
      ["cancelled", true],
      ["filled", false],
    ]);
  });
});

describe("the example answer", () => {
  it("is what the screens are built against", () => {
    expect(hedgeDeskResponseSchema.safeParse(hedgeDeskExample).success).toBe(true);
    expect(hedgeDeskExample.venueLabel).toBe("PAPER · live Gemini book");
  });
});

describe("the execution venue", () => {
  it("is never typed by hand on the Hedge desk: it is the API's `venueLabel`, as sent", () => {
    const dir = join(process.cwd(), "components", "hedge");
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith(".tsx"))
      .filter((name) => {
        const code = readFileSync(join(dir, name), "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        return /PAPER|live Gemini book/.test(code);
      });
    expect(offenders).toEqual([]);
  });

  it("says where the orders go whatever the venue is", () => {
    expect(hedgeDeskExample.venueLabel).toBe("PAPER · live Gemini book");
    expect(hedgeDeskExample.venueNote.length).toBeGreaterThan(0);
  });
});
