import { describe, expect, it } from "vitest";

import { isManuallyPaused } from "./manual-pause";

const T0 = 1_800_000_000_500; // half a second into a block second

describe("isManuallyPaused", () => {
  it("is not paused without any pause job on a live campaign", () => {
    expect(
      isManuallyPaused({ status: "live", latestPauseJob: null, lastOnChainPauseAtMs: null }),
    ).toBe(false);
  });

  it("pause requested, then mined", () => {
    const job = { paused: true, createdAtMs: T0 };
    // Requested: the API wrote paused_manual, the transaction is on its way.
    expect(
      isManuallyPaused({ status: "live", latestPauseJob: job, lastOnChainPauseAtMs: null }),
    ).toBe(true);
    // Mined and projected: the status is paused. The block time can fall in the job's second.
    expect(
      isManuallyPaused({ status: "paused", latestPauseJob: job, lastOnChainPauseAtMs: T0 - 500 }),
    ).toBe(true);
  });

  it("resume requested, then mined", () => {
    const pausedAt = T0;
    const job = { paused: false, createdAtMs: T0 + 60_000 };
    // Requested: still paused on-chain, the resume counts only once mined.
    expect(
      isManuallyPaused({ status: "paused", latestPauseJob: job, lastOnChainPauseAtMs: pausedAt }),
    ).toBe(true);
    // Mined and projected: live again, the evaluator recomputes normally.
    expect(
      isManuallyPaused({ status: "live", latestPauseJob: job, lastOnChainPauseAtMs: pausedAt }),
    ).toBe(false);
  });

  it("pause then resume, both requested before either is mined", () => {
    const resume = { paused: false, createdAtMs: T0 + 2_000 };
    // Neither mined: the merchant's last word is "resume".
    expect(
      isManuallyPaused({ status: "live", latestPauseJob: resume, lastOnChainPauseAtMs: null }),
    ).toBe(false);
    // The pause is mined first: the campaign is paused on-chain until the resume is mined.
    expect(
      isManuallyPaused({
        status: "paused",
        latestPauseJob: resume,
        lastOnChainPauseAtMs: T0 + 3_000,
      }),
    ).toBe(true);
    // Then the resume is mined.
    expect(
      isManuallyPaused({
        status: "live",
        latestPauseJob: resume,
        lastOnChainPauseAtMs: T0 + 3_000,
      }),
    ).toBe(false);
  });

  it("a second pause after an earlier pause and resume is in force while on its way", () => {
    const second = { paused: true, createdAtMs: T0 + 120_000 };
    expect(
      isManuallyPaused({ status: "live", latestPauseJob: second, lastOnChainPauseAtMs: T0 }),
    ).toBe(true);
  });

  it("is over when the pause was mined since the job and a resume reached the chain without a job", () => {
    const job = { paused: true, createdAtMs: T0 };
    expect(
      isManuallyPaused({ status: "live", latestPauseJob: job, lastOnChainPauseAtMs: T0 + 4_000 }),
    ).toBe(false);
  });

  it("counts a pause mined in the second of its job, even a few hundred ms before it", () => {
    // Block times are whole seconds: a block at T0 − 500 ms (the start of the job's second) may
    // well hold the job's transaction. Mined, then resumed on-chain: the pause is over.
    const job = { paused: true, createdAtMs: T0 };
    expect(
      isManuallyPaused({ status: "live", latestPauseJob: job, lastOnChainPauseAtMs: T0 - 500 }),
    ).toBe(false);
    // A pause from the second before the job's is an older one: the job is still on its way.
    expect(
      isManuallyPaused({ status: "live", latestPauseJob: job, lastOnChainPauseAtMs: T0 - 501 }),
    ).toBe(true);
  });

  it("is paused whenever the status is paused, even with no job (a pause made on-chain directly)", () => {
    expect(
      isManuallyPaused({ status: "paused", latestPauseJob: null, lastOnChainPauseAtMs: T0 }),
    ).toBe(true);
  });
});
