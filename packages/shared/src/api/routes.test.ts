import { describe, expect, it } from "vitest";

import { API_ROUTES, type RouteSpec } from "./routes";

const routes: Record<string, RouteSpec> = API_ROUTES;

describe("API route table", () => {
  it("covers every route of SPEC section 10", () => {
    const paths = Object.values(routes).map((route) => `${route.method} ${route.path}`);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual(
      expect.arrayContaining([
        "GET /api/me",
        "POST /api/merchants",
        "GET /api/events",
        "POST /api/campaigns/preview",
        "POST /api/campaigns",
        "GET /api/campaigns",
        "GET /api/campaigns/:id",
        "POST /api/campaigns/:id/pause",
        "POST /api/campaigns/:id/resume",
        "POST /api/campaigns/:id/close",
        "GET /api/c/:slug",
        "POST /api/checkout",
        "POST /api/checkout/:pi/confirm",
        "GET /api/checkout/:pi",
        "GET /api/t/:token",
        "GET /api/tickets",
        "GET /api/hedge-desk",
        "POST /api/admin/demo/book",
        "POST /api/admin/demo/result",
        "POST /api/admin/demo/sale",
        "POST /api/admin/demo/reset",
        "POST /api/webhooks/stripe",
        "POST /api/webhooks/quicknode",
      ]),
    );
  });

  for (const [name, route] of Object.entries(routes)) {
    for (const [scenario, example] of Object.entries(route.examples)) {
      it(`${name}: example "${scenario}" matches the response schema`, () => {
        const result = route.response.safeParse(example);
        expect(result.error?.issues ?? []).toEqual([]);
      });
    }
  }

  it("never puts a crypto word in a customer-facing example", () => {
    const customerFacing = [
      routes.publicCampaign,
      routes.checkout,
      routes.confirmCheckout,
      routes.checkoutStatus,
      routes.ticketByToken,
      routes.tickets,
    ];
    const text = JSON.stringify(customerFacing.map((route) => route?.examples)).toLowerCase();
    for (const word of ["wallet", "usdc", "blockchain", "gas", "seed", "crypto"]) {
      expect(text).not.toContain(word);
    }
  });
});

describe("POST /api/campaigns/:id/top-up (CA-6)", () => {
  const route = API_ROUTES.topUpCampaign;

  it("is a merchant route with a body", () => {
    expect(`${route.method} ${route.path}`).toBe("POST /api/campaigns/:id/top-up");
    expect(route.auth).toBe("merchant");
  });

  it("takes an amount of micro-USDC digits and a uuid request id", () => {
    const body = { amount: "500000000", requestId: "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b" };
    expect(route.request.safeParse(body).success).toBe(true);
    for (const bad of [
      { ...body, amount: "0" },
      { ...body, amount: "12.5" },
      { ...body, amount: 500000000 },
      { ...body, requestId: "not-a-uuid" },
      { amount: body.amount },
      { requestId: body.requestId },
    ]) {
      expect(route.request.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("answers the payment in the shape of the first budget's, with the campaign and the amount", () => {
    const answer = route.examples.created;
    expect(Object.keys(answer.budgetPayment).sort()).toEqual(
      Object.keys(API_ROUTES.createCampaign.examples.default.budgetPayment).sort(),
    );
    expect(answer.amount).toBe(answer.budgetPayment.amount);
    // The same requestId again: the same payment.
    expect(route.examples.repeated).toEqual(answer);
  });

  it("says where the top-up stands, credited included, and nothing else", () => {
    expect(route.examples.created.status).toBe("requires_payment");
    expect(route.examples.credited).toEqual({ ...route.examples.created, status: "credited" });
    expect(route.response.safeParse(route.examples.credited).success).toBe(true);
    // Optional: an answer without it still parses; an unknown status does not.
    const { status: _status, ...withoutStatus } = route.examples.created;
    expect(route.response.safeParse(withoutStatus).success).toBe(true);
    for (const status of ["failed", "refunded", "refunding", "done"]) {
      expect(route.response.safeParse({ ...route.examples.created, status }).success, status).toBe(
        false,
      );
    }
  });
});
