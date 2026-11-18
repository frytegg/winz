import type { PublicCampaign } from "@winz/shared";
import { headers } from "next/headers";
import { cache } from "react";

import { ApiError, apiFetch } from "@/lib/api/client";

/**
 * `GET /api/c/:slug` made on the server for C1 (a Server Component, `generateMetadata` and the
 * share image all read it). The URL is built from the request's own headers: nothing about the
 * domain is written in the code, so a preview, a staging and the production domain all work.
 */

export type PublicCampaignResult =
  { kind: "ok"; campaign: PublicCampaign } | { kind: "not_found" } | { kind: "error" };

const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/** `https://host` of the request being served, or `null` when the headers do not say. */
export async function requestOrigin(): Promise<string | null> {
  const list = await headers();
  const host = (list.get("x-forwarded-host") ?? list.get("host") ?? "").split(",")[0]?.trim() ?? "";
  // The host comes from the client: keep it to what a host can be, so it cannot smuggle a path.
  if (!HOST.test(host)) return null;
  const forwarded = list.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const protocol =
    forwarded === "http" || forwarded === "https" ? forwarded : local ? "http" : "https";
  return `${protocol}://${host}`;
}

/** Deduplicated per request: the page and `generateMetadata` ask once. */
export const loadPublicCampaign = cache(
  async (slug: string, scenario: string | null): Promise<PublicCampaignResult> => {
    const baseUrl = await requestOrigin();
    if (baseUrl === null) return { kind: "error" };
    try {
      const campaign = await apiFetch("publicCampaign", { params: { slug }, baseUrl, scenario });
      return { kind: "ok", campaign };
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 404) return { kind: "not_found" };
      return { kind: "error" };
    }
  },
);
