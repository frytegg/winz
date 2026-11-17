import { describe, expect, it } from "vitest";

import {
  UnitParseError,
  bpsToPercent,
  ceilToContractStep,
  formatContracts,
  formatUsd,
  mulDivDown,
  mulDivUp,
  parseContracts,
  parsePriceBps,
  parseUsd,
  refundableAmount,
} from "./units";

describe("money", () => {
  it("parses dollars into micro-USDC without floats", () => {
    expect(parseUsd("20")).toBe(20_000_000n);
    expect(parseUsd("12.99")).toBe(12_990_000n);
    expect(parseUsd("0.000001")).toBe(1n);
  });

  it("rejects what it cannot represent exactly", () => {
    expect(() => parseUsd("1.0000001")).toThrow(UnitParseError);
    expect(() => parseUsd("-1")).toThrow(UnitParseError);
    expect(() => parseUsd("1e3")).toThrow(UnitParseError);
    expect(() => parseUsd("")).toThrow(UnitParseError);
  });

  it("formats to two decimals, rounding down", () => {
    expect(formatUsd(20_000_000n)).toBe("20.00");
    expect(formatUsd(2_548_000n)).toBe("2.54");
    expect(formatUsd(9_999n)).toBe("0.00");
    expect(formatUsd(-1_500_000n)).toBe("-1.50");
  });
});

describe("prices and quantities", () => {
  it("parses Gemini price strings into basis points", () => {
    expect(parsePriceBps("0.54")).toBe(5400n);
    expect(parsePriceBps("0.5300")).toBe(5300n);
    expect(parsePriceBps("1")).toBe(10_000n);
    expect(() => parsePriceBps("1.01")).toThrow(UnitParseError);
  });

  it("parses and formats contract quantities at the 0.01 step", () => {
    expect(parseContracts("441.19")).toBe(441_190_000n);
    expect(formatContracts(441_190_000n)).toBe("441.19");
    expect(formatContracts(441_199_999n)).toBe("441.19");
    expect(formatContracts(5_000n)).toBe("0.00");
  });

  it("rounds a hedge quantity up to the contract step", () => {
    expect(ceilToContractStep(6_495_000n)).toBe(6_500_000n);
    expect(ceilToContractStep(6_500_000n)).toBe(6_500_000n);
    expect(ceilToContractStep(1n)).toBe(10_000n);
    expect(ceilToContractStep(0n)).toBe(0n);
  });

  it("shows basis points as a rounded percentage", () => {
    expect(bpsToPercent(1240n)).toBe(12);
    expect(bpsToPercent(1250n)).toBe(13);
  });
});

describe("rounding direction", () => {
  it("rounds costs up and capacities down", () => {
    expect(mulDivUp(10n, 1n, 3n)).toBe(4n);
    expect(mulDivDown(10n, 1n, 3n)).toBe(3n);
    expect(mulDivUp(9n, 1n, 3n)).toBe(3n);
    expect(() => mulDivUp(1n, 1n, 0n)).toThrow(RangeError);
    expect(() => mulDivDown(1n, 1n, 0n)).toThrow(RangeError);
  });

  it("computes the refundable amount like the contract", () => {
    expect(refundableAmount(1n, 20_000_000n, 10_000n)).toBe(20_000_000n);
    expect(refundableAmount(1n, 12_990_000n, 5000n)).toBe(6_495_000n);
    expect(refundableAmount(3n, 20_000_000n, 5000n)).toBe(30_000_000n);
  });
});
