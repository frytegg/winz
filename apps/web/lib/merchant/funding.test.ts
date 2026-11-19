import { apiExamples } from "@winz/shared";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import {
  RequestIds,
  STILL_CREATING_DELAYS_MS,
  isRequestSpent,
  isStillCreating,
  planFromCreate,
  planFromTopUp,
  retryWhileCreating,
} from "./funding";

const { createCampaignExamples, topUpCampaignExamples } = apiExamples;

const STILL_CREATING = new ApiError(
  503,
  "internal",
  "This promo is still being created; try again in a moment",
);

describe("what the answer to a Fund tap asks to pay", () => {
  it("pays the budget of a campaign that is waiting for it (created, repeated)", () => {
    for (const example of [createCampaignExamples.created, createCampaignExamples.repeated]) {
      const plan = planFromCreate(example);
      expect(plan.campaignId).toBe("cmp_joes_texas");
      expect(plan.payment).toEqual({
        paymentIntentId: "pi_budget_example",
        clientSecret: "pi_budget_example_secret_example",
      });
    }
  });

  it("has nothing to pay once the campaign is live (repeatedLive): open it instead", () => {
    const plan = planFromCreate(createCampaignExamples.repeatedLive);
    expect(plan.campaignId).toBe("cmp_joes_texas");
    expect(plan.payment).toBeNull();
  });

  it("pays a top-up that requires payment, and nothing for one already paid or credited", () => {
    expect(planFromTopUp(topUpCampaignExamples.created).payment).not.toBeNull();
    expect(planFromTopUp(topUpCampaignExamples.repeated).payment).not.toBeNull();
    expect(planFromTopUp(topUpCampaignExamples.credited).payment).toBeNull();
    expect(planFromTopUp({ ...topUpCampaignExamples.created, status: "processing" }).payment).toBe(
      null,
    );
    const { status: _status, ...withoutStatus } = topUpCampaignExamples.created;
    expect(planFromTopUp(withoutStatus).payment).not.toBeNull();
  });

  it("uses the campaign and the payment of the last answer when Stripe cancelled the first", () => {
    const replaced = {
      ...createCampaignExamples.created,
      campaignId: "cmp_joes_texas_second",
      budgetPayment: {
        ...createCampaignExamples.created.budgetPayment,
        paymentIntentId: "pi_budget_second",
        clientSecret: "pi_budget_second_secret_x",
      },
    };
    const plan = planFromCreate(replaced);
    expect(plan.campaignId).toBe("cmp_joes_texas_second");
    expect(plan.payment?.clientSecret).toBe("pi_budget_second_secret_x");
  });
});

describe("the request id of a Fund request", () => {
  it("is the same for the same terms, however many taps", () => {
    const ids = new RequestIds();
    const first = ids.idFor("terms-a");
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids.idFor("terms-a")).toBe(first);
    expect(ids.idFor("terms-a")).toBe(first);
  });

  it("changes with the terms: another promo is another request", () => {
    const ids = new RequestIds();
    const first = ids.idFor("terms-a");
    const second = ids.idFor("terms-b");
    expect(second).not.toBe(first);
    expect(ids.idFor("terms-b")).toBe(second);
  });

  it("starts a new request after renew, even for the same terms", () => {
    const ids = new RequestIds();
    const first = ids.idFor("terms-a");
    ids.renew();
    expect(ids.idFor("terms-a")).not.toBe(first);
  });
});

describe("the refusals of the creation route", () => {
  it("tells a 503 'still being created' from every other error", () => {
    expect(isStillCreating(STILL_CREATING)).toBe(true);
    expect(isStillCreating(new ApiError(502, "internal", "Payment provider down"))).toBe(false);
    expect(isStillCreating(new ApiError(0, "network", "offline"))).toBe(false);
    expect(isStillCreating(new Error("boom"))).toBe(false);
  });

  it("tells a request that is spent (409 conflict) from the other 409s", () => {
    expect(isRequestSpent(new ApiError(409, "conflict", "This request was already used"))).toBe(
      true,
    );
    expect(isRequestSpent(new ApiError(409, "sales_closed", "Sales are closed"))).toBe(false);
    expect(isRequestSpent(STILL_CREATING)).toBe(false);
  });
});

describe("retryWhileCreating", () => {
  it("sends the same request again after a pause while the answer is 503, then returns", async () => {
    const request = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(STILL_CREATING)
      .mockRejectedValueOnce(STILL_CREATING)
      .mockResolvedValueOnce("created");
    const waits: number[] = [];
    const result = await retryWhileCreating(request, (ms) => {
      waits.push(ms);
      return Promise.resolve();
    });
    expect(result).toBe("created");
    expect(request).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([STILL_CREATING_DELAYS_MS[0], STILL_CREATING_DELAYS_MS[1]]);
  });

  it("gives up after the last retry and throws the 503, for the next tap to resend", async () => {
    const request = vi.fn<() => Promise<string>>().mockRejectedValue(STILL_CREATING);
    await expect(retryWhileCreating(request, () => Promise.resolve())).rejects.toBe(STILL_CREATING);
    expect(request).toHaveBeenCalledTimes(STILL_CREATING_DELAYS_MS.length + 1);
  });

  it("throws any other error at once, without waiting", async () => {
    const refused = new ApiError(409, "conflict", "This request was already used");
    const request = vi.fn<() => Promise<string>>().mockRejectedValue(refused);
    const wait = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue();
    await expect(retryWhileCreating(request, wait)).rejects.toBe(refused);
    expect(request).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
