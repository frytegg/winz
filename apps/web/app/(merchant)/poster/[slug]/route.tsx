import { ImageResponse } from "next/og";

import { PromoPoster } from "@/components/og/promo-poster";
import { loadPublicCampaign, requestOrigin } from "@/lib/fan/public-campaign";
import { loadSoraFonts, wordmarkDataUrl } from "@/lib/og/assets";
import {
  POSTER_CACHE,
  POSTER_UNAVAILABLE,
  POSTER_SIZE,
  posterContent,
  posterFilename,
  posterRefusal,
  type PosterRefusal,
} from "@/lib/og/poster";

/**
 * `GET /poster/:slug`: the 1080 × 1350 poster of a promo, for "Download poster". Public and without a
 * token, like the promo's own page: it shows only what that page shows (see `lib/og/poster.ts`). It
 * lives in the merchant group because it is the merchant's tool, but nothing here is private.
 */

function refuse(refusal: PosterRefusal): Response {
  return Response.json(
    { error: { code: refusal.code, message: refusal.message } },
    { status: refusal.status, headers: { "Cache-Control": refusal.cacheControl } },
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const early = posterRefusal(slug);
  if (early !== null) return refuse(early);

  const result = await loadPublicCampaign(slug, null);
  const refusal = posterRefusal(slug, result);
  if (refusal !== null) return refuse(refusal);
  const origin = await requestOrigin();
  if (result.kind !== "ok" || origin === null) return refuse(POSTER_UNAVAILABLE);

  const [wordmark, fonts] = await Promise.all([wordmarkDataUrl(), loadSoraFonts()]);
  return new ImageResponse(
    <PromoPoster content={posterContent(result.campaign, origin)} wordmark={wordmark} />,
    {
      ...POSTER_SIZE,
      ...(fonts === undefined ? {} : { fonts }),
      headers: {
        "Cache-Control": POSTER_CACHE,
        "Content-Disposition": `inline; filename="${posterFilename(slug)}"`,
      },
    },
  );
}
