import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { isBusinessAlreadyThere, submitBusiness } from "./business-create";

const ALREADY = new ApiError(409, "conflict", "You already have a business");
const BUSINESS = { id: "mer_joes", name: "Joe's Pizza" };

describe("M2's submit (review 2.3)", () => {
  it("adopts the business the API answers, without reading the session again", async () => {
    const refreshMe = vi.fn<() => Promise<{ hasBusiness: boolean }>>();
    await expect(submitBusiness(() => Promise.resolve(BUSINESS), refreshMe)).resolves.toEqual({
      kind: "created",
      merchant: BUSINESS,
    });
    expect(refreshMe).not.toHaveBeenCalled();
  });

  it("on a 409, reads the session again and moves on when it has the business", async () => {
    const refreshMe = vi
      .fn<() => Promise<{ hasBusiness: boolean }>>()
      .mockResolvedValue({ hasBusiness: true });
    await expect(submitBusiness(() => Promise.reject(ALREADY), refreshMe)).resolves.toEqual({
      kind: "existing",
    });
    expect(refreshMe).toHaveBeenCalledTimes(1);
  });

  it("shows the 409 when the session read again still has no business", async () => {
    const refreshMe = vi
      .fn<() => Promise<{ hasBusiness: boolean }>>()
      .mockResolvedValue({ hasBusiness: false });
    await expect(submitBusiness(() => Promise.reject(ALREADY), refreshMe)).rejects.toBe(ALREADY);
  });

  it("shows the 409 when the session cannot be read again", async () => {
    const refreshMe = vi
      .fn<() => Promise<{ hasBusiness: boolean }>>()
      .mockRejectedValue(new ApiError(0, "network", "offline"));
    await expect(submitBusiness(() => Promise.reject(ALREADY), refreshMe)).rejects.toBe(ALREADY);
  });

  it("throws any other refusal at once, without reading the session", async () => {
    const invalid = new ApiError(400, "invalid_request", "Invalid body.name: too long");
    const refreshMe = vi.fn<() => Promise<{ hasBusiness: boolean }>>();
    await expect(submitBusiness(() => Promise.reject(invalid), refreshMe)).rejects.toBe(invalid);
    expect(refreshMe).not.toHaveBeenCalled();
  });

  it("tells the 409 of an existing business from the others", () => {
    expect(isBusinessAlreadyThere(ALREADY)).toBe(true);
    expect(isBusinessAlreadyThere(new ApiError(409, "sales_closed", "Sales are closed"))).toBe(
      false,
    );
    expect(isBusinessAlreadyThere(new ApiError(500, "internal", "boom"))).toBe(false);
    expect(isBusinessAlreadyThere(new Error("boom"))).toBe(false);
  });
});
