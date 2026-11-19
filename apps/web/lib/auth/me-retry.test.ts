import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/client";

import {
  classifyMeFailure,
  loadMeWithRetry,
  ME_RETRY_DELAYS_MS,
  MeLoadError,
  nextMeRetryStep,
} from "./me-retry";

function apiError(status: number): ApiError {
  if (status === 0) return new ApiError(0, "network", "Can't reach Winz");
  if (status === 401) return new ApiError(401, "unauthenticated", "Sign in");
  if (status === 403) return new ApiError(403, "forbidden", "Forbidden");
  return new ApiError(status, "internal", "Something went wrong");
}

describe("classifyMeFailure", () => {
  it("is anonymous for a 401 or a 403 only", () => {
    expect(classifyMeFailure(apiError(401))).toBe("anonymous");
    expect(classifyMeFailure(apiError(403))).toBe("anonymous");
  });

  it("keeps the session for no answer, a 5xx (the 503 of an unchecked token included) or a bad answer", () => {
    for (const status of [0, 500, 502, 503, 504]) {
      expect(classifyMeFailure(apiError(status)), String(status)).toBe("unreachable");
    }
    expect(classifyMeFailure(new ApiError(200, "invalid_response", "Unexpected answer"))).toBe(
      "unreachable",
    );
    expect(classifyMeFailure(new TypeError("Failed to fetch"))).toBe("unreachable");
  });
});

describe("nextMeRetryStep", () => {
  it("retries after 1 s, 2 s, 4 s, then gives up", () => {
    expect(ME_RETRY_DELAYS_MS).toEqual([1_000, 2_000, 4_000]);
    expect(nextMeRetryStep(apiError(503), 1)).toEqual({ kind: "retry", delayMs: 1_000 });
    expect(nextMeRetryStep(apiError(0), 2)).toEqual({ kind: "retry", delayMs: 2_000 });
    expect(nextMeRetryStep(apiError(500), 3)).toEqual({ kind: "retry", delayMs: 4_000 });
    expect(nextMeRetryStep(apiError(500), 4)).toEqual({ kind: "unreachable" });
  });

  it("never retries a refusal", () => {
    expect(nextMeRetryStep(apiError(401), 1)).toEqual({ kind: "anonymous" });
    expect(nextMeRetryStep(apiError(403), 3)).toEqual({ kind: "anonymous" });
  });
});

/** A `load` that answers each call from `answers` in turn: an error is thrown, anything else returned. */
function scripted(answers: unknown[]): { load: () => Promise<string>; calls: () => number } {
  let calls = 0;
  return {
    load: () => {
      const answer = answers[calls];
      calls += 1;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(String(answer));
    },
    calls: () => calls,
  };
}

function recordingSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    sleep: (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    },
  };
}

describe("loadMeWithRetry", () => {
  it("answers at once when the API does", async () => {
    const api = scripted(["me"]);
    const clock = recordingSleep();
    await expect(loadMeWithRetry(api.load, clock)).resolves.toBe("me");
    expect(clock.waits).toEqual([]);
  });

  it("rides out a cold start: two 503 then an answer", async () => {
    const api = scripted([apiError(503), apiError(0), "me"]);
    const clock = recordingSleep();
    await expect(loadMeWithRetry(api.load, clock)).resolves.toBe("me");
    expect(clock.waits).toEqual([1_000, 2_000]);
    expect(api.calls()).toBe(3);
  });

  it("ends unreachable after four attempts, never anonymous", async () => {
    const api = scripted([apiError(503), apiError(503), apiError(502), apiError(500), "late"]);
    const clock = recordingSleep();
    const failure = await loadMeWithRetry(api.load, clock).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MeLoadError);
    expect((failure as MeLoadError).failure).toBe("unreachable");
    expect((failure as MeLoadError).attempts).toBe(4);
    expect(clock.waits).toEqual([1_000, 2_000, 4_000]);
    expect(api.calls()).toBe(4);
  });

  it("ends anonymous at the first 401, without waiting", async () => {
    const api = scripted([apiError(401), "me"]);
    const clock = recordingSleep();
    const failure = await loadMeWithRetry(api.load, clock).catch((error: unknown) => error);
    expect((failure as MeLoadError).failure).toBe("anonymous");
    expect(clock.waits).toEqual([]);
    expect(api.calls()).toBe(1);
  });

  it("ends anonymous on a 403 that follows a 503", async () => {
    const api = scripted([apiError(503), apiError(403)]);
    const clock = recordingSleep();
    const failure = await loadMeWithRetry(api.load, clock).catch((error: unknown) => error);
    expect((failure as MeLoadError).failure).toBe("anonymous");
    expect(clock.waits).toEqual([1_000]);
  });

  it("stops between attempts once aborted", async () => {
    const controller = new AbortController();
    const api = scripted([apiError(503), "me"]);
    const failure = await loadMeWithRetry(api.load, {
      signal: controller.signal,
      sleep: () => {
        controller.abort();
        return Promise.resolve();
      },
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DOMException);
    expect((failure as DOMException).name).toBe("AbortError");
    expect(api.calls()).toBe(1);
  });
});
