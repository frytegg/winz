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
