import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  API_ROUTES,
  MOCK_SCENARIO_HEADER,
  apiErrorSchema,
  apiExamples,
  type RouteSpec,
} from "@winz/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRouteError, defineRoute, mockScenarios, type RouteResponse } from "./route";

const logError = vi.hoisted(() => vi.fn());
vi.mock("./logger", () => ({ serverLogger: () => ({ error: logError }) }));

const routes: Record<string, RouteSpec> = API_ROUTES;
const noParams = { params: Promise.resolve({}) };
const validCheckout = { slug: "joes-texas", qty: 1 };

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { headers });
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  return apiErrorSchema.parse(await response.json()).error;
}

beforeEach(() => {
  logError.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("defineRoute in mock mode", () => {
  beforeEach(() => {
    vi.stubEnv("APP_API_MOCK", "true");
  });

  it("answers the default example", async () => {
    const response = await defineRoute("publicCampaign")(get("/api/c/joes-texas"), {
      params: Promise.resolve({ slug: "joes-texas" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(apiExamples.publicCampaignExamples.live);
  });

  it("answers the example named by the scenario header", async () => {
    const response = await defineRoute("publicCampaign")(
      get("/api/c/joes-texas", { [MOCK_SCENARIO_HEADER]: "settledYes" }),
      { params: Promise.resolve({ slug: "joes-texas" }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(apiExamples.publicCampaignExamples.settledYes);
  });

  it("never calls the implementation", async () => {
    const implementation = vi.fn();
    const response = await defineRoute("tickets", implementation)(get("/api/tickets"), noParams);
    expect(response.status).toBe(200);
    expect(implementation).not.toHaveBeenCalled();
  });

  it("refuses an unknown scenario and lists the valid ones", async () => {
    const response = await defineRoute("publicCampaign")(
      get("/api/c/joes-texas", { [MOCK_SCENARIO_HEADER]: "nope" }),
      noParams,
    );
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("invalid_request");
    for (const scenario of mockScenarios("publicCampaign")) {
      expect(error.message).toContain(scenario);
    }
  });

  it("does not resolve scenarios on the prototype chain", async () => {
    const response = await defineRoute("tickets")(
      get("/api/tickets", { [MOCK_SCENARIO_HEADER]: "toString" }),
      noParams,
    );
    expect(response.status).toBe(400);
  });

  it("refuses a body that fails the schema, naming the field", async () => {
    const response = await defineRoute("checkout")(
      post("/api/checkout", { slug: "joes-texas", qty: 0 }),
      noParams,
    );
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("invalid_request");
    expect(error.message).toContain("body.qty");
  });

  it("refuses a body that is not JSON", async () => {
    const response = await defineRoute("checkout")(post("/api/checkout", "{not json"), noParams);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("invalid_request");
  });

  it("refuses a query string that fails the schema, naming the field", async () => {
    const response = await defineRoute("events")(get("/api/events?sport=curling"), noParams);
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("invalid_request");
    expect(error.message).toContain("query.sport");
  });

  it("accepts a valid body and answers the example", async () => {
    const response = await defineRoute("checkout")(post("/api/checkout", validCheckout), noParams);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(apiExamples.checkoutExample);
  });

  it.each([
    ["salesPaused", "sales_paused"],
    ["salesClosed", "sales_closed"],
  ])("checkout scenario %s answers 409 %s", async (scenario, code) => {
    const response = await defineRoute("checkout")(
      post("/api/checkout", validCheckout, { [MOCK_SCENARIO_HEADER]: scenario }),
      noParams,
    );
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe(code);
  });

  it("acknowledges a webhook without reading its body", async () => {
    const request = post("/api/webhooks/stripe", "raw provider payload");
    const response = await defineRoute("stripeWebhook")(request, noParams);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(request.bodyUsed).toBe(false);
  });
});

describe("defineRoute outside mock mode", () => {
  beforeEach(() => {
    vi.stubEnv("APP_API_MOCK", "false");
  });

  it("answers 501 while no implementation is registered", async () => {
    const response = await defineRoute("tickets")(get("/api/tickets"), noParams);
    expect(response.status).toBe(501);
    expect(await errorOf(response)).toEqual({ code: "internal", message: "Not implemented yet" });
  });

  it("passes params, body and query to the implementation and sends its answer", async () => {
    const seen: unknown[] = [];
    const checkout = defineRoute("checkout", ({ body, params, query }) => {
      seen.push({ body, params, query });
      return apiExamples.checkoutExample;
    });
    const response = await checkout(post("/api/checkout", validCheckout), noParams);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(apiExamples.checkoutExample);
    expect(seen).toEqual([{ body: validCheckout, params: {}, query: undefined }]);

    const events = defineRoute("events", ({ query, params }) => {
      seen.push({ query, params });
      return apiExamples.eventsExample;
    });
    await events(get("/api/events?search=texas"), noParams);
    expect(seen[1]).toEqual({ query: { search: "texas" }, params: {} });
  });

  it("validates the body before calling the implementation", async () => {
    const implementation = vi.fn();
    const response = await defineRoute("checkout", implementation)(
      post("/api/checkout", { slug: "joes-texas" }),
      noParams,
    );
    expect(response.status).toBe(400);
    expect((await errorOf(response)).message).toContain("body.qty");
    expect(implementation).not.toHaveBeenCalled();
  });

  it("answers 500 and leaks nothing when the implementation returns an invalid shape", async () => {
    const invalid = {
      secret: "sk_test_leak",
      tickets: "nope",
    } as unknown as RouteResponse<"tickets">;
    const response = await defineRoute("tickets", () => invalid)(get("/api/tickets"), noParams);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("sk_test_leak");
    expect(text).not.toContain("tickets");
    expect(JSON.parse(text)).toEqual({ error: { code: "internal", message: "Internal error" } });
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("converts an ApiRouteError into its status and code", async () => {
    const handler = defineRoute("ticketByToken", () => {
      throw new ApiRouteError(404, "not_found", "Ticket not found");
    });
    const response = await handler(get("/api/t/unknown"), {
      params: Promise.resolve({ token: "unknown" }),
    });
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toEqual({ code: "not_found", message: "Ticket not found" });
    expect(logError).not.toHaveBeenCalled();
  });

  it("converts any other error into a logged, generic 500", async () => {
    const handler = defineRoute("tickets", () => {
      throw new Error("connection string postgres://user:pw@host");
    });
    const response = await handler(get("/api/tickets"), noParams);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("postgres");
    expect(JSON.parse(text)).toEqual({ error: { code: "internal", message: "Internal error" } });
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("runs the authenticate hook first and hands its result to the implementation", async () => {
    const refused = defineRoute("tickets", () => apiExamples.ticketsExample, {
      authenticate: ({ auth }) => {
        throw new ApiRouteError(401, "unauthenticated", `Sign in (${auth})`);
      },
    });
    const response = await refused(get("/api/tickets"), noParams);
    expect(response.status).toBe(401);
    expect(await errorOf(response)).toEqual({ code: "unauthenticated", message: "Sign in (user)" });

    let principal: unknown;
    const accepted = defineRoute(
      "tickets",
      (context) => {
        principal = context.principal;
        return apiExamples.ticketsExample;
      },
      { authenticate: () => ({ userId: "u_1" }) },
    );
    expect((await accepted(get("/api/tickets"), noParams)).status).toBe(200);
    expect(principal).toEqual({ userId: "u_1" });
  });
});

describe("route files", () => {
  const appDir = fileURLToPath(new URL("../../app", import.meta.url));
  const methodsByPath = new Map<string, string[]>();
  for (const route of Object.values(routes)) {
    methodsByPath.set(route.path, [...(methodsByPath.get(route.path) ?? []), route.method]);
  }

  for (const [name, route] of Object.entries(routes)) {
    it(`${route.method} ${route.path} (${name}) has a route file exporting only its methods`, async () => {
      const file = join(appDir, route.path.replace(/:([A-Za-z]+)/g, "[$1]"), "route.ts");
      expect(existsSync(file), `missing ${file}`).toBe(true);

      const module = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<
        string,
        unknown
      >;
      expect(module.dynamic).toBe("force-dynamic");
      expect(typeof module[route.method]).toBe("function");
      const exported = Object.keys(module).filter((key) => key !== "dynamic");
      expect(exported.sort()).toEqual([...(methodsByPath.get(route.path) ?? [])].sort());
    });
  }

  it("binds every exported method to its own entry of the route table", async () => {
    vi.stubEnv("APP_API_MOCK", "true");
    // A scenario that no route knows: the 400 names the method and path the handler was built for.
    const headers = { [MOCK_SCENARIO_HEADER]: "__which__" };
    for (const route of Object.values(routes)) {
      if (route.request) continue; // Their body is validated first; covered by the export check.
      const file = join(appDir, route.path.replace(/:([A-Za-z]+)/g, "[$1]"), "route.ts");
      const module = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<
        string,
        (request: Request, context: typeof noParams) => Promise<Response>
      >;
      const request = new Request("http://localhost/", { method: route.method, headers });
      const response = await module[route.method]!(request, noParams);
      expect((await errorOf(response)).message).toContain(`${route.method} ${route.path}.`);
    }
  });
});

describe("empty POST body", () => {
  it("is read as an empty object, so a route with no required field accepts it", async () => {
    vi.stubEnv("APP_API_MOCK", "true");
    const handler = defineRoute("demoReset");
    const response = await handler(
      new Request("http://localhost/api/admin/demo/reset", { method: "POST" }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(200);
    vi.unstubAllEnvs();
  });

  it("still fails validation when the route requires fields", async () => {
    vi.stubEnv("APP_API_MOCK", "true");
    const handler = defineRoute("checkout");
    const response = await handler(
      new Request("http://localhost/api/checkout", { method: "POST" }),
      {
        params: Promise.resolve({}),
      },
    );
    expect(response.status).toBe(400);
    vi.unstubAllEnvs();
  });
});
