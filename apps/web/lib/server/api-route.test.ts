import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { apiErrorSchema, apiExamples, eventsResponseSchema, meResponseSchema } from "@winz/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { GET as getCampaigns } from "@/app/api/campaigns/route";
import { GET as getEvents } from "@/app/api/events/route";
import { GET as getMe } from "@/app/api/me/route";
import { POST as postMerchants } from "@/app/api/merchants/route";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import { apiRoute } from "./api-route";
import { setServerDepsForTesting } from "./deps";
import { FakeIdentity, randomWallet, serverDepsFor } from "./testing/fixtures";

const API_DIR = fileURLToPath(new URL("../../app/api", import.meta.url));
const noParams = { params: Promise.resolve({}) };

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { headers });
}

describe("route files", () => {
  it("all go through apiRoute, so none can skip authentication", () => {
    const files = routeFiles(API_DIR);
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const name = relative(API_DIR, file);
      const source = readFileSync(file, "utf8");
      // The health check is a plain Next handler, outside the API table.
      if (name === join("health", "route.ts")) continue;
      expect(source, name).toContain('from "@/lib/server/api-route"');
      expect(source, name).not.toContain("defineRoute");
    }
  });
});

describe("route handlers with authentication wired", () => {
  let database: TestDatabase;
  const identity = new FakeIdentity();
  const wallet = randomWallet();

  beforeAll(async () => {
    database = await createTestDatabase();
    identity.addUser("joe-token", "did:privy:joe", {
      email: "Joe@Example.com",
      walletAddress: wallet,
    });
    setServerDepsForTesting(serverDepsFor(database.db, identity, new Date()));
  });
  afterAll(async () => {
    setServerDepsForTesting(undefined);
    await database.drop();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses a request without a token with 401", async () => {
    const response = await getMe(get("/api/me"), noParams);
    expect(response.status).toBe(401);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe("unauthenticated");
  });

  it("signs a user in, then lets them create their business and reach merchant routes", async () => {
    const auth = { authorization: "Bearer joe-token" };

    const events = await getEvents(get("/api/events", auth), noParams);
    expect(events.status).toBe(403);

    const me = await getMe(get("/api/me", auth), noParams);
    expect(me.status).toBe(200);
    const body = meResponseSchema.parse(await me.json());
    expect(body.user).toMatchObject({ email: "joe@example.com", walletAddress: wallet });

    const created = await postMerchants(
      new Request("http://localhost/api/merchants", {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ name: "Joe's Pizza", category: "pizza" }),
      }),
      noParams,
    );
    expect(created.status).toBe(200);

    const after = await getEvents(get("/api/events", auth), noParams);
    expect(after.status).toBe(200);
    expect(eventsResponseSchema.parse(await after.json())).toEqual({ events: [] });

    const campaigns = await getCampaigns(get("/api/campaigns", auth), noParams);
    expect(campaigns.status).toBe(200);
    expect(await campaigns.json()).toEqual({ campaigns: [] });
  });

  it("still answers 501 on a route registered without an implementation", async () => {
    // Every route file has an implementation now (the QuickNode webhook was the last one).
    const unimplemented = apiRoute("quicknodeWebhook");
    const response = await unimplemented(
      new Request("http://localhost/api/webhooks/quicknode", { method: "POST", body: "{}" }),
      noParams,
    );
    expect(response.status).toBe(501);
  });

  it("changes nothing in mock mode: examples, no token needed", async () => {
    vi.stubEnv("APP_API_MOCK", "true");
    const response = await getMe(get("/api/me"), noParams);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(apiExamples.meExamples.merchant);
  });
});
