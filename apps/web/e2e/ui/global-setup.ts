import { rmSync } from "node:fs";

import type { FullConfig } from "@playwright/test";

import { recordMeasure, seconds } from "./support/measures";
import { MEASURES_DIR } from "./support/paths";

class NotSimulatedError extends Error {
  override name = "NotSimulatedError";
}

/**
 * Every page and API route the flows open. `next dev` compiles each on its first request (up to
 * 40 seconds for the first one on this machine), so they are asked for once before the flows run:
 * the timings of the flows are then those of the app, not of the compiler.
 */
const PAGES = [
  "/",
  "/start",
  "/business",
  "/new",
  "/new/cmp_warmup/live",
  "/home",
  "/campaigns",
  "/campaigns/cmp_warmup",
  "/settings",
  "/balance",
  "/stats",
  "/c/joes-texas",
  "/t/tkt_warmup",
  "/hedge-desk",
  // No page: M0's fan link opens it (a known defect). Asked once so `next dev` has compiled the
  // not-found page before the test that follows the link waits for its answer.
  "/tickets",
] as const;

const API_GETS = [
  "/api/me",
  "/api/events",
  "/api/campaigns",
  "/api/campaigns/cmp_warmup",
  "/api/c/joes-texas",
  "/api/checkout/pi_warmup",
  "/api/t/tkt_warmup",
  "/api/hedge-desk",
] as const;

/** Compiled with an empty body: a `400` is fine, the point is the compilation. */
const API_POSTS = [
  "/api/merchants",
  "/api/campaigns/preview",
  "/api/campaigns",
  "/api/campaigns/cmp_warmup/pause",
  "/api/campaigns/cmp_warmup/resume",
  "/api/checkout",
  "/api/checkout/pi_warmup/confirm",
] as const;

async function ask(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(180_000) });
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  rmSync(MEASURES_DIR, { recursive: true, force: true });
  const baseURL = config.projects[0]?.use.baseURL;
  if (baseURL === undefined) throw new Error("playwright.config.ts must set use.baseURL");

  // A server reused on this port must be the simulated one: the real API does not know this slug,
  // the mock ignores it.
  const probe = await ask(`${baseURL}/api/c/no-such-promo-e2e-ui`);
  if (probe.status !== 200) {
    throw new NotSimulatedError(
      `The server on ${baseURL} is not in simulated mode (GET /api/c/<unknown slug> answered ${probe.status.toString()}). ` +
        "Stop it, or set E2E_UI_PORT to a free port: the suite starts its own with APP_API_MOCK=true.",
    );
  }

  const started = Date.now();
  for (const path of PAGES) await (await ask(`${baseURL}${path}`)).arrayBuffer();
  for (const path of API_GETS) await (await ask(`${baseURL}${path}`)).arrayBuffer();
  for (const path of API_POSTS) {
    await (
      await ask(`${baseURL}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    ).arrayBuffer();
  }
  recordMeasure("warmup-seconds", {
    label:
      "Compilation des pages et des routes par `next dev` avant les parcours (non comptée dans les parcours)",
    value: seconds(Date.now() - started),
    unit: "s",
    limit: null,
    detail: `${PAGES.length.toString()} pages, ${(API_GETS.length + API_POSTS.length).toString()} routes d'API, une requête chacune`,
  });
}
