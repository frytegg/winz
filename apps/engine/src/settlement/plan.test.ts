import { describe, expect, it } from "vitest";
import { encodeErrorResult, getAddress, parseAbi } from "viem";

import {
  attemptKey,
  attemptOf,
  campaignKeyPrefix,
  chargeKeyBase,
  chunk,
  digestOf,
  isSettledStatus,
  ONCHAIN_OUTCOME,
  outcomeOfStatus,
  refundKeyBase,
  retryDelayMs,
  safetyNetCharge,
  settleKeyBase,
} from "./plan";
import { isInfrastructureFailure, isTreasuryFailure, revertName } from "./steps";

const ESCROW = getAddress("0x00000000000000000000000000000000000E5c20");

describe("outcomes and statuses", () => {
  it("maps the results to IWinzEscrow.Outcome: Yes 0, No 1, Void 2", () => {
    expect(ONCHAIN_OUTCOME).toEqual({ yes: 0, no: 1, void: 2 });
  });

  it("reads the result of a settled status and nothing before settlement", () => {
    expect([0, 1, 2, 3, 4].map(outcomeOfStatus)).toEqual([null, null, "yes", "no", "void"]);
    expect([0, 1, 2, 3, 4].map(isSettledStatus)).toEqual([false, false, true, true, true]);
  });
});

describe("chunk", () => {
  it("splits 300 tickets into 6 batches of 50, in order", () => {
    const ids = Array.from({ length: 300 }, (_, index) => BigInt(index + 1));
    const batches = chunk(ids, 50);
    expect(batches).toHaveLength(6);
    expect(batches.every((batch) => batch.length === 50)).toBe(true);
    expect(batches.flat()).toEqual(ids);
  });

  it("keeps the remainder in a last, shorter batch and refuses a size below 1", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 50)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });
});

describe("idempotency keys", () => {
  const prefix = campaignKeyPrefix(ESCROW, 7n);

  it("are scoped by escrow and campaign", () => {
    expect(prefix).toBe("settlement:0x00000000000000000000000000000000000e5c20:7");
    expect(settleKeyBase(prefix, "yes")).toBe(`${prefix}:settle:yes`);
  });

  it("depend on the content of a batch, not on who computes it", () => {
    expect(refundKeyBase(prefix, [1n, 2n, 3n])).toBe(refundKeyBase(prefix, [1n, 2n, 3n]));
    expect(refundKeyBase(prefix, [1n, 2n, 3n])).not.toBe(refundKeyBase(prefix, [1n, 2n, 4n]));
    expect(chargeKeyBase(prefix, [1n, 2n], [5n, 0n])).not.toBe(
      chargeKeyBase(prefix, [1n, 2n], [5n, 1n]),
    );
    expect(chargeKeyBase(prefix, [1n, 2n], [3n])).not.toBe(chargeKeyBase(prefix, [1n], [2n, 3n]));
    expect(digestOf([12n, 3n])).not.toBe(digestOf([1n, 23n]));
  });

  it("number attempts and read them back, ignoring other keys", () => {
    const base = settleKeyBase(prefix, "no");
    expect(attemptKey(base, 1)).toBe(`${base}:a1`);
    expect(attemptOf(base, attemptKey(base, 12))).toBe(12);
    expect(attemptOf(base, `${base}:a0`)).toBeNull();
    expect(attemptOf(base, `${base}:ax`)).toBeNull();
    expect(attemptOf(base, `${base}x:a1`)).toBeNull();
    expect(attemptOf(base, "other:a1")).toBeNull();
  });
});

describe("safetyNetCharge", () => {
  it("charges the lot cost when it is below the guarantee", () => {
    expect(
      safetyNetCharge(1_000_000n, {
        cost: 300_000n,
        filledQty: 5_000_000n,
        maxHedgeCost: 1_000_000n,
      }),
    ).toEqual({ amount: 300_000n, allocated: true });
  });

  it("caps the lot cost at the on-chain guarantee and at the lot's copy of it", () => {
    expect(
      safetyNetCharge(1_000_000n, { cost: 1_500_000n, filledQty: 1n, maxHedgeCost: 1_000_000n }),
    ).toEqual({ amount: 1_000_000n, allocated: true });
    expect(
      safetyNetCharge(1_000_000n, { cost: 1_500_000n, filledQty: 1n, maxHedgeCost: 800_000n }),
    ).toEqual({ amount: 800_000n, allocated: true });
  });

  it("charges zero, flagged, when nothing was ever allocated or there is no lot", () => {
    expect(
      safetyNetCharge(1_000_000n, { cost: 0n, filledQty: 0n, maxHedgeCost: 1_000_000n }),
    ).toEqual({ amount: 0n, allocated: false });
    expect(
      safetyNetCharge(1_000_000n, { cost: null, filledQty: null, maxHedgeCost: null }),
    ).toEqual({
      amount: 0n,
      allocated: false,
    });
  });

  it("charges zero on a zero guarantee, like any other ticket", () => {
    expect(safetyNetCharge(0n, { cost: 400_000n, filledQty: 1n, maxHedgeCost: 0n })).toEqual({
      amount: 0n,
      allocated: true,
    });
  });

  it("counts a filled lot whose fills cost nothing as allocated", () => {
    expect(safetyNetCharge(1_000_000n, { cost: 0n, filledQty: 10_000n, maxHedgeCost: 1n })).toEqual(
      {
        amount: 0n,
        allocated: true,
      },
    );
  });
});

describe("retryDelayMs", () => {
  it("doubles from the base and stops at the maximum", () => {
    expect([1, 2, 3, 4, 5, 6].map((failures) => retryDelayMs(failures, 100, 1_000))).toEqual([
      100, 200, 400, 800, 1_000, 1_000,
    ]);
    expect(retryDelayMs(0, 100, 1_000)).toBe(100);
    expect(retryDelayMs(10_000, 100, 1_000)).toBe(1_000);
  });
});

describe("transaction errors", () => {
  const tokenErrors = parseAbi([
    "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
    "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  ]);

  it("names a token error that reached the sender as raw revert data", () => {
    const data = encodeErrorResult({
      abi: tokenErrors,
      errorName: "ERC20InsufficientAllowance",
      args: [ESCROW, 0n, 5n],
    });
    expect(revertName(data)).toBe("ERC20InsufficientAllowance");
    expect(isTreasuryFailure(data)).toBe(true);
    expect(revertName("0xdeadbeef00")).toBe("0xdeadbeef00");
  });

  it("keeps the escrow's own error names and tells infrastructure failures apart", () => {
    expect(revertName("AlreadySettled")).toBe("AlreadySettled");
    expect(revertName(null)).toBe("unknown error");
    expect(isTreasuryFailure("SafeERC20FailedOperation")).toBe(true);
    expect(isTreasuryFailure("CampaignNotFound")).toBe(false);
    expect(isInfrastructureFailure("NodeUnavailable: fetch failed")).toBe(true);
    expect(isInfrastructureFailure("InsufficientFunds")).toBe(true);
    expect(isInfrastructureFailure("WrongOutcome")).toBe(false);
  });
});
