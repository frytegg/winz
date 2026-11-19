import { ImageResponse } from "next/og";

import { PromoShareCard } from "@/components/og/promo-share-card";
import { copy } from "@/lib/copy";
import { loadPublicCampaign } from "@/lib/fan/public-campaign";
import { loadSoraFonts, wordmarkDataUrl } from "@/lib/og/assets";

export const alt = copy.brand.description;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The preview a link to a promo gets in a chat or a feed (CO-1): the promise, big, with the venue's
 * name. For a link that is not a promo (unknown slug, API down) it is the brand's tagline alone: a
 * preview is never broken.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<ImageResponse> {
  const { slug } = await params;
  const [result, wordmark, fonts] = await Promise.all([
    loadPublicCampaign(slug, null),
    wordmarkDataUrl(),
    loadSoraFonts(),
  ]);
  const campaign = result.kind === "ok" ? result.campaign : null;

  return new ImageResponse(
    <PromoShareCard
      promise={campaign?.promise ?? copy.brand.tagline}
      merchantName={campaign?.merchant.name ?? ""}
      eventTitle={campaign?.eventTitle ?? ""}
      wordmark={wordmark}
    />,
    { ...size, ...(fonts === undefined ? {} : { fonts }) },
  );
}
