import { describe, expect, it } from "vitest";

import { ARC_MIN_MAX_FEE_PER_GAS_WEI } from "@winz/shared";

import { TxSenderConfigError } from "./errors";
import {
  addGasMargin,
  backoffDelayMs,
  bumpFees,
  computeFees,
  createFeePolicy,
  DEFAULT_MAX_FEE_PER_GAS_CAP_WEI,
  DEFAULT_MIN_PRIORITY_FEE_PER_GAS_WEI,
} from "./fees";

const GWEI = 1_000_000_000n;
const policy = createFeePolicy();

describe("createFeePolicy", () => {
  it("defaults to Arc's floor, a 1 gwei tip and a 1000 gwei cap", () => {
    expect(policy).toEqual({
      floorWei: ARC_MIN_MAX_FEE_PER_GAS_WEI,
      minPriorityWei: DEFAULT_MIN_PRIORITY_FEE_PER_GAS_WEI,
      capWei: DEFAULT_MAX_FEE_PER_GAS_CAP_WEI,
    });
    expect(policy.floorWei).toBe(20n * GWEI);
  });

  it("accepts a higher floor and refuses one below Arc's minimum", () => {
    expect(createFeePolicy({ minMaxFeePerGasWei: 25n * GWEI }).floorWei).toBe(25n * GWEI);
    expect(() => createFeePolicy({ minMaxFeePerGasWei: 20n * GWEI - 1n })).toThrow(
      TxSenderConfigError,
    );
  });

  it("refuses a cap below the floor and a tip outside [0, cap]", () => {
    expect(() => createFeePolicy({ maxFeePerGasCapWei: 19n * GWEI })).toThrow(TxSenderConfigError);
    expect(() => createFeePolicy({ minPriorityFeePerGasWei: -1n })).toThrow(TxSenderConfigError);
    expect(() =>
      createFeePolicy({ minPriorityFeePerGasWei: DEFAULT_MAX_FEE_PER_GAS_CAP_WEI + 1n }),
    ).toThrow(TxSenderConfigError);
    expect(createFeePolicy({ minPriorityFeePerGasWei: 0n }).minPriorityWei).toBe(0n);
  });
});

describe("computeFees", () => {
  it("raises a suggestion below the floor to the floor", () => {
    const fees = computeFees({ maxFeePerGas: 2_200_000_000n, maxPriorityFeePerGas: GWEI }, policy);
    expect(fees).toEqual({ maxFeePerGas: 20n * GWEI, maxPriorityFeePerGas: GWEI });
  });

  it("keeps a suggestion above the floor as it is", () => {
    const fees = computeFees({ maxFeePerGas: 50n * GWEI, maxPriorityFeePerGas: 3n * GWEI }, policy);
    expect(fees).toEqual({ maxFeePerGas: 50n * GWEI, maxPriorityFeePerGas: 3n * GWEI });
  });

  it("is exactly the floor at the floor, and one wei more just above it", () => {
    expect(
      computeFees({ maxFeePerGas: 20n * GWEI, maxPriorityFeePerGas: GWEI }, policy).maxFeePerGas,
    ).toBe(20n * GWEI);
    expect(
      computeFees({ maxFeePerGas: 20n * GWEI + 1n, maxPriorityFeePerGas: GWEI }, policy)
        .maxFeePerGas,
    ).toBe(20n * GWEI + 1n);
  });

  it("never goes below the floor, whatever the node answers", () => {
    for (const suggested of [0n, 1n, -5n, GWEI, 19n * GWEI, 20n * GWEI - 1n]) {
      const fees = computeFees({ maxFeePerGas: suggested, maxPriorityFeePerGas: 0n }, policy);
      expect(fees.maxFeePerGas).toBeGreaterThanOrEqual(ARC_MIN_MAX_FEE_PER_GAS_WEI);
    }
  });

  it("offers at least the minimum tip when the node suggests none", () => {
    const fees = computeFees({ maxFeePerGas: 30n * GWEI, maxPriorityFeePerGas: 0n }, policy);
    expect(fees.maxPriorityFeePerGas).toBe(GWEI);
  });

  it("caps the fee at the cap and the tip at the fee", () => {
    const fees = computeFees(
      { maxFeePerGas: 5_000n * GWEI, maxPriorityFeePerGas: 4_000n * GWEI },
      policy,
    );
    expect(fees).toEqual({ maxFeePerGas: 1_000n * GWEI, maxPriorityFeePerGas: 1_000n * GWEI });

    const tight = createFeePolicy({ minPriorityFeePerGasWei: 30n * GWEI });
    const low = computeFees({ maxFeePerGas: GWEI, maxPriorityFeePerGas: GWEI }, tight);
    expect(low).toEqual({ maxFeePerGas: 20n * GWEI, maxPriorityFeePerGas: 20n * GWEI });
  });
});

describe("bumpFees", () => {
  const previous = { maxFeePerGas: 20n * GWEI, maxPriorityFeePerGas: GWEI };
  const quiet = { maxFeePerGas: 2n * GWEI, maxPriorityFeePerGas: GWEI };

  it("raises both fees by the percentage when the node suggests less", () => {
    expect(bumpFees(previous, quiet, policy, 25)).toEqual({
      maxFeePerGas: 25n * GWEI,
      maxPriorityFeePerGas: 1_250_000_000n,
    });
  });

  it("follows the node when it now suggests more than the bump", () => {
    const busy = { maxFeePerGas: 80n * GWEI, maxPriorityFeePerGas: 5n * GWEI };
    expect(bumpFees(previous, busy, policy, 25)).toEqual({
      maxFeePerGas: 80n * GWEI,
      maxPriorityFeePerGas: 5n * GWEI,
    });
  });

  it("rounds up, so a bump is at least the requested percentage", () => {
    const odd = { maxFeePerGas: 20n * GWEI + 1n, maxPriorityFeePerGas: 3n };
    const bumped = bumpFees(odd, { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }, policy, 10);
    expect(bumped).toBeDefined();
    expect(bumped!.maxFeePerGas * 100n).toBeGreaterThanOrEqual(odd.maxFeePerGas * 110n);
    // 3 wei + 10 % rounds up to 4 wei, but the policy's minimum tip is higher still.
    expect(bumped!.maxPriorityFeePerGas).toBe(GWEI);
  });

  it("raises a zero tip by at least one wei", () => {
    const noTip = createFeePolicy({ minPriorityFeePerGasWei: 0n });
    const bumped = bumpFees(
      { maxFeePerGas: 20n * GWEI, maxPriorityFeePerGas: 0n },
      { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n },
      noTip,
      25,
    );
    expect(bumped?.maxPriorityFeePerGas).toBe(1n);
  });

  it("gives up when the cap leaves no room for a replacement", () => {
    const atCap = { maxFeePerGas: 900n * GWEI, maxPriorityFeePerGas: GWEI };
    expect(bumpFees(atCap, quiet, policy, 25)).toBeUndefined();
    // Positive control: the same bump fits under a higher cap.
    const roomy = createFeePolicy({ maxFeePerGasCapWei: 2_000n * GWEI });
    expect(bumpFees(atCap, quiet, roomy, 25)?.maxFeePerGas).toBe(1_125n * GWEI);
  });

  it("stays strictly increasing over successive bumps", () => {
    let fees = previous;
    for (let bump = 0; bump < 5; bump += 1) {
      const next = bumpFees(fees, quiet, policy, 10);
      expect(next).toBeDefined();
      expect(next!.maxFeePerGas).toBeGreaterThan(fees.maxFeePerGas);
      expect(next!.maxPriorityFeePerGas).toBeGreaterThan(fees.maxPriorityFeePerGas);
      expect(next!.maxPriorityFeePerGas).toBeLessThanOrEqual(next!.maxFeePerGas);
      fees = next!;
    }
  });
});

describe("addGasMargin", () => {
  it("adds 20 % by default and rounds up", () => {
    expect(addGasMargin(100_000n)).toBe(120_000n);
    expect(addGasMargin(21_000n)).toBe(25_200n);
    expect(addGasMargin(1n)).toBe(2n);
    expect(addGasMargin(0n)).toBe(0n);
  });

  it("takes another margin", () => {
    expect(addGasMargin(100_000n, 50)).toBe(150_000n);
    expect(addGasMargin(100_000n, 0)).toBe(100_000n);
  });
});

describe("backoffDelayMs", () => {
  it("doubles from the base and stops at the maximum", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((attempt) => backoffDelayMs(attempt, 250, 5_000))).toEqual([
      250, 500, 1_000, 2_000, 4_000, 5_000, 5_000,
    ]);
  });

  it("treats attempt 0 like the first and survives huge attempt numbers", () => {
    expect(backoffDelayMs(0, 100, 1_000)).toBe(100);
    expect(backoffDelayMs(10_000, 100, 1_000)).toBe(1_000);
  });
});
