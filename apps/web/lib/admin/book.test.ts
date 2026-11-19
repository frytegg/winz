import { describe, expect, it } from "vitest";

import {
  ODDS_PRESETS,
  bpsToPercentText,
  checkBook,
  contractsToMicro,
  microToContracts,
  percentToBps,
  presetPrices,
} from "./book";

describe("percentToBps", () => {
  it("accepts whole percents from 1 to 99 and nothing else", () => {
    expect(percentToBps("12")).toBe(1200);
    expect(percentToBps(" 1 ")).toBe(100);
    expect(percentToBps("99")).toBe(9900);
    for (const bad of ["", "0", "100", "12.5", "-3", "abc", "1e1", "012x"]) {
      expect(percentToBps(bad)).toBeNull();
    }
  });
});

describe("contractsToMicro", () => {
  it("goes through whole numbers, never a float", () => {
    expect(contractsToMicro("500")).toBe("500000000");
    expect(contractsToMicro("0.07")).toBe("70000");
    expect(contractsToMicro("0.5")).toBe("500000");
    expect(contractsToMicro("1.25")).toBe("1250000");
    expect(contractsToMicro("0.01")).toBe("10000");
  });

  it("refuses zero, a third decimal, text and absurd sizes", () => {
    for (const bad of ["", "0", "0.00", "1.234", "-1", "1,5", "ten", "99999999999"]) {
      expect(contractsToMicro(bad)).toBeNull();
    }
  });

  it("always lands on the server's step of 10 000 micro-contracts", () => {
    for (const text of ["0.01", "3.3", "12.34", "999999.99"]) {
      const micro = contractsToMicro(text);
      expect(micro).not.toBeNull();
      expect(BigInt(micro ?? "1") % 10_000n).toBe(0n);
    }
  });
});

describe("microToContracts", () => {
  it("is the inverse, without trailing zeros", () => {
    expect(microToContracts("500000000")).toBe("500");
    expect(microToContracts("1500000")).toBe("1.5");
    expect(microToContracts("10000")).toBe("0.01");
    expect(microToContracts("1250000")).toBe("1.25");
  });
});

describe("presets", () => {
  it("sit one point either side of their chance, on the tick, bid below ask", () => {
    expect(ODDS_PRESETS.map((preset) => preset.chance)).toEqual([12, 18, 25]);
    expect(presetPrices(12)).toEqual({ bid: "11", ask: "13" });
    for (const preset of ODDS_PRESETS) {
      const { bid, ask } = presetPrices(preset.chance);
      expect(percentToBps(bid)).not.toBeNull();
      expect(percentToBps(ask)).not.toBeNull();
      expect((percentToBps(bid) ?? 0) < (percentToBps(ask) ?? 0)).toBe(true);
    }
  });
});

describe("checkBook", () => {
  const good = { symbol: " GEMI-X ", bid: "11", ask: "13", depth: "500" };

  it("builds the request of the route, in bps and micro-contracts", () => {
    expect(checkBook(good)).toEqual({
      ok: true,
      request: { instrumentSymbol: "GEMI-X", bidBps: 1100, askBps: 1300, depth: "500000000" },
    });
  });

  it("names every wrong field", () => {
    const result = checkBook({ symbol: "", bid: "0", ask: "x", depth: "0" });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(Object.keys(result.errors).sort()).toEqual(["ask", "bid", "depth", "symbol"]);
  });

  it("refuses a crossed or locked book, as the server does", () => {
    for (const [bid, ask] of [
      ["13", "11"],
      ["12", "12"],
    ] as const) {
      const result = checkBook({ ...good, bid, ask });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.ask).toBeDefined();
    }
  });
});

describe("bpsToPercentText", () => {
  it("writes a whole percent, one decimal otherwise, and says when there is no book", () => {
    expect(bpsToPercentText(1100)).toBe("11%");
    expect(bpsToPercentText(1150)).toBe("11.5%");
    expect(bpsToPercentText(null)).toBe("no book");
  });
});
