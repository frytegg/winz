import { ADMIN_KEY_HEADER, apiExamples } from "@winz/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDemoMode } from "@/lib/demo/store";

import {
  checkAdminKey,
  followSale,
  forceResult,
  replaySale,
  resetDemo,
  setBook,
  type FollowSaleOptions,
} from "./api";
import { clearAdminKey, readAdminKey, saveAdminKey } from "./key";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function refusal(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, status);
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    location: { search: "" },
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  });
});

afterEach(() => {
  clearAdminKey();
  setDemoMode(false);
  vi.unstubAllGlobals();
});

const book = { instrumentSymbol: "GEMI-X", bidBps: 1100, askBps: 1300, depth: "500000000" };

describe("the admin calls", () => {
  it("send the key in x-admin-key, and only there", async () => {
    saveAdminKey("secret-demo-key");
    fetchMock.mockResolvedValue(jsonResponse(apiExamples.demoExamples.ok));
    await setBook(book);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/admin/demo/book");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers[ADMIN_KEY_HEADER]).toBe("secret-demo-key");
    expect(String(url)).not.toContain("secret-demo-key");
    expect(String(init?.body)).not.toContain("secret-demo-key");
    expect(headers.authorization).toBeUndefined();
  });

  it("reach the four routes", async () => {
    saveAdminKey("k");
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(apiExamples.demoExamples.ok)));
    await forceResult({ instrumentSymbol: "GEMI-X", outcome: "yes" });
    await replaySale({ slug: "joes-texas", qty: 1, email: "fan@example.com" });
    await resetDemo();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/admin/demo/result",
      "/api/admin/demo/sale",
      "/api/admin/demo/reset",
    ]);
  });

  it("refuse to send without a key, and send nothing", async () => {
    await expect(setBook(book)).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forget the key on a 401, so the panel goes back to the key screen", async () => {
    saveAdminKey("old-key");
    fetchMock.mockResolvedValue(refusal(401, "unauthenticated", "Missing or invalid admin key"));
    await expect(setBook(book)).rejects.toMatchObject({ status: 401 });
    expect(readAdminKey()).toBeNull();
  });

  it("keep the key on any other refusal", async () => {
    saveAdminKey("good-key");
    fetchMock.mockResolvedValue(refusal(400, "invalid_request", "Invalid body.bidBps"));
    await expect(setBook(book)).rejects.toMatchObject({ status: 400 });
    expect(readAdminKey()).toBe("good-key");
  });

  it("never put the key in an error", async () => {
    saveAdminKey("secret-demo-key");
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const error = await setBook(book).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(String(error)).not.toContain("secret-demo-key");
    expect(JSON.stringify(error)).not.toContain("secret-demo-key");
  });
});

describe("checkAdminKey", () => {
  it("sends a book the server refuses after its key check, never a real one", async () => {
    fetchMock.mockResolvedValue(refusal(400, "invalid_request", "Invalid body.bidBps"));
    await checkAdminKey("typed-key");
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      instrumentSymbol: "key-check",
      bidBps: 0,
      askBps: 0,
      depth: "0",
    });
  });

  it("calls a 400 or a 404 accepted (the server got past the key), a 401 rejected", async () => {
    fetchMock.mockResolvedValueOnce(refusal(400, "invalid_request", "bad"));
    expect(await checkAdminKey("k")).toEqual({ outcome: "accepted" });
    fetchMock.mockResolvedValueOnce(refusal(404, "not_found", "Instrument not found"));
    expect(await checkAdminKey("k")).toEqual({ outcome: "accepted" });
    fetchMock.mockResolvedValueOnce(
      refusal(401, "unauthenticated", "Missing or invalid admin key"),
    );
    expect(await checkAdminKey("k")).toEqual({ outcome: "rejected" });
  });

  it("does not claim the simulated API checked anything", async () => {
    fetchMock.mockResolvedValue(jsonResponse(apiExamples.demoExamples.ok));
    expect(await checkAdminKey("k")).toEqual({ outcome: "unchecked" });
  });

  it("says nothing is known when the server does not answer or fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await checkAdminKey("k")).toMatchObject({ outcome: "unknown" });
    fetchMock.mockResolvedValueOnce(refusal(500, "internal", "Internal error"));
    expect(await checkAdminKey("k")).toMatchObject({
      outcome: "unknown",
      message: "Internal error",
    });
  });
});

describe("followSale", () => {
  const processing = { status: "processing", ticketToken: null, message: null } as const;

  function options(
    reads: (() => Promise<unknown>)[],
    extra: Partial<FollowSaleOptions> = {},
  ): FollowSaleOptions & { reads: number } {
    let clock = 0;
    const state = { reads: 0 };
    const result: FollowSaleOptions & { reads: number } = {
      signal: new AbortController().signal,
      read: () => {
        const next = reads[Math.min(state.reads, reads.length - 1)];
        state.reads += 1;
        if (next === undefined) throw new Error("no read planned");
        return next() as ReturnType<FollowSaleOptions["read"]>;
      },
      sleep: () => {
        clock += 1_000;
        return Promise.resolve();
      },
      now: () => clock,
      get reads() {
        return state.reads;
      },
      ...extra,
    };
    return result;
  }

  it("reads until the ticket is issued, and returns its link", async () => {
    const o = options([
      () => Promise.resolve(processing),
      () => Promise.resolve(processing),
      () => Promise.resolve({ status: "ticketed", ticketToken: "tkt_1", message: null }),
    ]);
    expect(await followSale("pi_demo_1", o)).toEqual({ kind: "ticketed", ticketToken: "tkt_1" });
    expect(o.reads).toBe(3);
  });

  it("ends on a payment that ended without a ticket, with the server's words", async () => {
    const paused = options([
      () =>
        Promise.resolve({
          status: "cancelled_paused",
          ticketToken: null,
          message: "Promo just paused, you were not charged",
        }),
    ]);
    expect(await followSale("pi_demo_1", paused)).toEqual({
      kind: "cancelled_paused",
      message: "Promo just paused, you were not charged",
    });
    const failed = options([
      () => Promise.resolve({ status: "failed", ticketToken: null, message: null }),
    ]);
    expect(await followSale("pi_demo_1", failed)).toEqual({ kind: "failed", message: null });
  });

  it("gives up with `timeout`, not with a success, when the payment stays processing", async () => {
    const o = options([() => Promise.resolve(processing)], { timeoutMs: 5_000 });
    expect(await followSale("pi_demo_1", o)).toEqual({ kind: "timeout" });
  });

  it("rides out a failed read, and says `lost` after too many in a row", async () => {
    const blip = options([
      () => Promise.reject(new Error("network")),
      () => Promise.resolve({ status: "ticketed", ticketToken: "tkt_1", message: null }),
    ]);
    expect(await followSale("pi_demo_1", blip)).toEqual({ kind: "ticketed", ticketToken: "tkt_1" });
    const down = options([() => Promise.reject(new Error("network"))], { maxReadFailures: 3 });
    expect(await followSale("pi_demo_1", down)).toMatchObject({ kind: "lost" });
    expect(down.reads).toBe(3);
  });

  it("stops quietly when the person leaves the page", async () => {
    const controller = new AbortController();
    const o = options([() => Promise.resolve(processing)], { signal: controller.signal });
    controller.abort();
    expect(await followSale("pi_demo_1", o)).toBeNull();
    expect(o.reads).toBe(0);
  });
});
