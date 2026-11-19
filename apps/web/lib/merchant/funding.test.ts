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
  sendRenewingOnce,
  sendRequest,
  type RequestIdStorage,
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

/** A tab's `sessionStorage`, as far as the request ids use it: it outlives a page instance. */
class MemoryStorage implements RequestIdStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** Private mode, or a full storage: every call throws. */
const brokenStorage: RequestIdStorage = {
  getItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("full", "QuotaExceededError");
  },
  removeItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
};

const SPENT = new ApiError(409, "conflict", "This top-up request is over; make a new request");
const noWait = (): Promise<void> => Promise.resolve();

describe("the request id of a Fund request, across a reload or a remount (review 1.1)", () => {
  const KEY = "winz.fund-request";

  it("is the same for the same terms after a reload: a new instance over the same storage", () => {
    const tab = new MemoryStorage();
    const first = new RequestIds(KEY, () => tab).idFor("terms-a");
    const afterReload = new RequestIds(KEY, () => tab);
    expect(afterReload.idFor("terms-a")).toBe(first);
  });

  it("is another one for other terms, which then replace the first in the storage", () => {
    const tab = new MemoryStorage();
    const first = new RequestIds(KEY, () => tab).idFor("terms-a");
    const other = new RequestIds(KEY, () => tab).idFor("terms-b");
    expect(other).not.toBe(first);
    expect(new RequestIds(KEY, () => tab).idFor("terms-b")).toBe(other);
    expect(new RequestIds(KEY, () => tab).idFor("terms-a")).not.toBe(first);
  });

  it("is written to the storage before the request leaves", async () => {
    const tab = new MemoryStorage();
    const ids = new RequestIds(KEY, () => tab);
    let storedWhenSent: string | null = null;
    const sentWith = await sendRequest(ids, "terms-a", (requestId) => {
      storedWhenSent = tab.getItem(KEY);
      return Promise.resolve(requestId);
    });
    expect(storedWhenSent).not.toBeNull();
    expect(JSON.parse(storedWhenSent ?? "null")).toEqual({ key: "terms-a", id: sentWith });
  });

  it("is cleared after success: the next request with the same terms is a new one", () => {
    const tab = new MemoryStorage();
    const ids = new RequestIds(KEY, () => tab);
    const paid = ids.idFor("terms-a");
    ids.renew();
    expect(tab.getItem(KEY)).toBeNull();
    expect(new RequestIds(KEY, () => tab).idFor("terms-a")).not.toBe(paid);
  });

  it("is cleared after a 409 'spent', and the 409 is thrown", async () => {
    const tab = new MemoryStorage();
    const ids = new RequestIds(KEY, () => tab);
    const first = ids.idFor("terms-a");
    await expect(sendRequest(ids, "terms-a", () => Promise.reject(SPENT), noWait)).rejects.toBe(
      SPENT,
    );
    expect(tab.getItem(KEY)).toBeNull();
    expect(new RequestIds(KEY, () => tab).idFor("terms-a")).not.toBe(first);
  });

  it("is kept after any other failure (a lost answer, a 502, a 503 still being created)", async () => {
    const tab = new MemoryStorage();
    const ids = new RequestIds(KEY, () => tab);
    const lost = new ApiError(0, "network", "offline");
    let sent = "";
    await expect(
      sendRequest(
        ids,
        "terms-a",
        (requestId) => {
          sent = requestId;
          return Promise.reject(lost);
        },
        noWait,
      ),
    ).rejects.toBe(lost);
    expect(new RequestIds(KEY, () => tab).idFor("terms-a")).toBe(sent);
  });

  it("lives in memory when there is no storage (no window, private mode)", () => {
    const ids = new RequestIds(KEY, () => null);
    const first = ids.idFor("terms-a");
    expect(ids.idFor("terms-a")).toBe(first);
    expect(ids.idFor("terms-b")).not.toBe(first);
  });

  it("lives in memory, without an error, when the storage throws or is full", async () => {
    const ids = new RequestIds(KEY, () => brokenStorage);
    const first = ids.idFor("terms-a");
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids.idFor("terms-a")).toBe(first);
    await expect(sendRequest(ids, "terms-a", () => Promise.reject(SPENT), noWait)).rejects.toBe(
      SPENT,
    );
    expect(ids.idFor("terms-a")).not.toBe(first);
  });

  it("ignores what it cannot read back in the storage", () => {
    const tab = new MemoryStorage();
    for (const junk of ["not json", "{}", '{"key":"terms-a","id":"not-a-uuid"}', "null"]) {
      tab.setItem(KEY, junk);
      expect(new RequestIds(KEY, () => tab).idFor("terms-a")).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("keeps two requests apart when they are stored under two keys (a promo, a top-up)", () => {
    const tab = new MemoryStorage();
    const fund = new RequestIds(KEY, () => tab).idFor("same");
    const topUp = new RequestIds("winz.top-up-request.cmp_1", () => tab).idFor("same");
    expect(topUp).not.toBe(fund);
    expect(new RequestIds(KEY, () => tab).idFor("same")).toBe(fund);
  });
});

describe("a top-up refused at the card, then tapped again (review 1.4)", () => {
  it("renews the request on the 409 'request is over' and sends it once more, in the same tap", async () => {
    const ids = new RequestIds();
    const sent: string[] = [];
    const result = await sendRenewingOnce(
      ids,
      "50000",
      (requestId) => {
        sent.push(requestId);
        return sent.length === 1 ? Promise.reject(SPENT) : Promise.resolve("paid");
      },
      noWait,
    );
    expect(result).toBe("paid");
    expect(sent).toHaveLength(2);
    expect(sent[1]).not.toBe(sent[0]);
    expect(ids.idFor("50000"), "the new request is the one kept for its retries").toBe(sent[1]);
  });

  it("sends once more only: a second 409 is shown, and the next tap is a new request", async () => {
    const ids = new RequestIds();
    const sent: string[] = [];
    await expect(
      sendRenewingOnce(
        ids,
        "50000",
        (requestId) => {
          sent.push(requestId);
          return Promise.reject(SPENT);
        },
        noWait,
      ),
    ).rejects.toBe(SPENT);
    expect(sent).toHaveLength(2);
    expect(sent).not.toContain(ids.idFor("50000"));
  });

  it("never renews on another error: a lost answer or a 503 keeps the same request", async () => {
    const ids = new RequestIds();
    const lost = new ApiError(0, "network", "offline");
    const send = vi.fn<(requestId: string) => Promise<string>>().mockRejectedValue(lost);
    await expect(sendRenewingOnce(ids, "50000", send, noWait)).rejects.toBe(lost);
    expect(send).toHaveBeenCalledTimes(1);
    expect(ids.idFor("50000")).toBe(send.mock.calls[0]?.[0]);
  });

  it("sends the same request again while the answer is 503, as the creation does", async () => {
    const ids = new RequestIds();
    const send = vi
      .fn<(requestId: string) => Promise<string>>()
      .mockRejectedValueOnce(STILL_CREATING)
      .mockResolvedValueOnce("paid");
    await expect(sendRenewingOnce(ids, "50000", send, noWait)).resolves.toBe("paid");
    expect(send.mock.calls[1]?.[0]).toBe(send.mock.calls[0]?.[0]);
  });
});
