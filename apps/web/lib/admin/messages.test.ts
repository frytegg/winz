import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/client";
import { copy } from "@/lib/copy";

import { describeSaleOutcome, failureMessage } from "./use-admin-actions";

describe("failureMessage", () => {
  it("shows the API's own words for a refusal, and no uncertainty: nothing was written", () => {
    expect(
      failureMessage("book", new ApiError(409, "sales_paused", "This promo is paused")),
    ).toEqual({
      message: "This promo is paused",
      uncertain: false,
    });
  });

  it("warns that a sale may exist when no answer came, or the server failed", () => {
    const offline = failureMessage(
      "sale",
      new ApiError(0, "network", "Can't reach Winz right now."),
    );
    expect(offline.uncertain).toBe(true);
    expect(offline.message).toContain(copy.admin.sale.mayExist.trim());
    expect(failureMessage("sale", new ApiError(500, "internal", "Internal error")).uncertain).toBe(
      true,
    );
  });

  it("does not warn for a book, a result or a reset: sending them again is harmless", () => {
    expect(failureMessage("book", new ApiError(0, "network", "x")).uncertain).toBe(false);
    expect(failureMessage("reset", new ApiError(500, "internal", "x")).uncertain).toBe(false);
  });

  it("says the key was refused on a 401, without echoing anything", () => {
    expect(failureMessage("result", new ApiError(401, "unauthenticated", "Missing")).message).toBe(
      copy.admin.errors.keyRejected,
    );
  });
});

describe("describeSaleOutcome", () => {
  it("calls a sale done only when the ticket exists", () => {
    expect(
      describeSaleOutcome({ kind: "ticketed", ticketToken: "tkt_1" }, "pi_demo_1"),
    ).toMatchObject({
      status: "done",
      ticketToken: "tkt_1",
    });
    for (const outcome of [
      { kind: "timeout" },
      { kind: "failed", message: null },
      { kind: "cancelled_paused", message: null },
      { kind: "lost", message: "x" },
    ] as const) {
      expect(describeSaleOutcome(outcome, "pi_demo_1").status).toBe("error");
    }
  });

  it("names the payment when the wait ran out", () => {
    expect(describeSaleOutcome({ kind: "timeout" }, "pi_demo_1").message).toContain("pi_demo_1");
  });
});
