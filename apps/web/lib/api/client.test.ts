import { apiExamples, MOCK_SCENARIO_HEADER } from "@winz/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDemoMode, setDemoMode } from "@/lib/demo/store";

import {
  ApiError,
  apiFetch,
  buildPath,
  setAccessTokenProvider,
  setUnauthenticatedHandler,
} from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setAccessTokenProvider(null);
  setUnauthenticatedHandler(null);
  setDemoMode(false);
});

describe("buildPath", () => {
  it("fills path parameters and the query string", () => {
    expect(buildPath("/api/c/:slug", { slug: "joes-texas" }, undefined)).toBe("/api/c/joes-texas");
    expect(buildPath("/api/events", undefined, { sport: "football", search: "" })).toBe(
      "/api/events?sport=football",
    );
  });

  it("escapes what it inserts", () => {
    expect(buildPath("/api/t/:token", { token: "a/b c" }, undefined)).toBe("/api/t/a%2Fb%20c");
  });

  it("refuses a missing parameter", () => {
    expect(() => buildPath("/api/c/:slug", {}, undefined)).toThrow(/slug/);
  });
});

describe("apiFetch", () => {
  it("returns a validated answer", async () => {
    fetchMock.mockResolvedValue(jsonResponse(apiExamples.publicCampaignExamples.live));
    const campaign = await apiFetch("publicCampaign", { params: { slug: "joes-texas" } });
    expect(campaign.promise).toBe("100% back if Texas wins by 14+");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/c/joes-texas");
  });

  it("throws an invalid_response error when the answer does not match its schema", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ slug: "x" }));
    await expect(
      apiFetch("publicCampaign", { params: { slug: "joes-texas" } }),
    ).rejects.toMatchObject({
      name: "ApiError",
      code: "invalid_response",
    });
  });

  it("turns an API error into an ApiError with the message as sent", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "sales_paused",
            message: "This promo is paused right now, you were not charged",
          },
        },
        409,
      ),
    );
    const error = await apiFetch("checkout", { body: { slug: "joes-texas", qty: 1 } }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "sales_paused",
      message: "This promo is paused right now, you were not charged",
    });
  });

  it("reports a network failure as an ApiError, not a raw exception", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(apiFetch("hedgeDesk")).rejects.toMatchObject({ code: "network", status: 0 });
  });

  it("validates the body before sending it", async () => {
    await expect(
      apiFetch("checkout", { body: { slug: "joes-texas", qty: 99 } }),
    ).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the body as JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse(apiExamples.checkoutExample));
    await apiFetch("checkout", { body: { slug: "joes-texas", qty: 2 } });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ slug: "joes-texas", qty: 2 }));
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("adds the access token to merchant and user routes only", async () => {
    setAccessTokenProvider(() => Promise.resolve("privy-token"));
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(apiExamples.meExamples.merchant)),
    );
    await apiFetch("me");
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).authorization).toBe(
      "Bearer privy-token",
    );

    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(apiExamples.publicCampaignExamples.live)),
    );
    await apiFetch("publicCampaign", { params: { slug: "joes-texas" } });
    expect(
      (fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>).authorization,
    ).toBeUndefined();
  });

  it("calls the unauthenticated handler on a 401", async () => {
    const handler = vi.fn();
    setUnauthenticatedHandler(handler);
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "unauthenticated", message: "Sign in first" } }, 401),
    );
    await expect(apiFetch("me")).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledWith("me");
  });

  it("sends the admin key on admin routes", async () => {
    fetchMock.mockResolvedValue(jsonResponse(apiExamples.demoExamples.ok));
    await apiFetch("demoReset", { body: {}, adminKey: "secret" });
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)["x-admin-key"]).toBe(
      "secret",
    );
  });

  it("prefixes a base URL, for a request made on the server", async () => {
    fetchMock.mockResolvedValue(jsonResponse(apiExamples.publicCampaignExamples.live));
    await apiFetch("publicCampaign", {
      params: { slug: "joes-texas" },
      baseUrl: "https://example.test",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.test/api/c/joes-texas");
  });
});

describe("mock scenarios", () => {
  function stubBrowser(search: string): void {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      location: { search },
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
    });
  }

  it("relays ?scenario= only to the routes that have that scenario", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_API_MOCK", "true");
    stubBrowser("?scenario=refunded");
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(apiExamples.ticketExamples.refunded)),
    );
    await apiFetch("ticketByToken", { params: { token: "x" } });
    expect(
      (fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)[MOCK_SCENARIO_HEADER],
    ).toBe("refunded");

    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(apiExamples.hedgeDeskExample)));
    await apiFetch("hedgeDesk");
    expect(
      (fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>)[MOCK_SCENARIO_HEADER],
    ).toBeUndefined();
  });

  it("sends no scenario outside mock mode", async () => {
    stubBrowser("?scenario=refunded");
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(apiExamples.ticketExamples.refunded)),
    );
    await apiFetch("ticketByToken", { params: { token: "x" } });
    expect(
      (fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)[MOCK_SCENARIO_HEADER],
    ).toBeUndefined();
  });
});

describe("demo banner", () => {
  it("follows the demo flag of the last answer that carries one", async () => {
    stubWindow();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...apiExamples.publicCampaignExamples.live, demo: true }),
    );
    await apiFetch("publicCampaign", { params: { slug: "joes-texas" } });
    expect(getDemoMode()).toBe(true);

    fetchMock.mockResolvedValueOnce(jsonResponse(apiExamples.publicCampaignExamples.live));
    await apiFetch("publicCampaign", { params: { slug: "joes-texas" } });
    expect(getDemoMode()).toBe(false);
  });

  it("leaves the banner alone for an answer without a demo field", async () => {
    stubWindow();
    setDemoMode(true);
    fetchMock.mockResolvedValue(jsonResponse(apiExamples.checkoutStatusExamples.ticketed));
    await apiFetch("checkoutStatus", { params: { pi: "pi_1" } });
    expect(getDemoMode()).toBe(true);
  });

  function stubWindow(): void {
    vi.stubGlobal("window", { location: { search: "" }, sessionStorage: undefined });
  }
});
