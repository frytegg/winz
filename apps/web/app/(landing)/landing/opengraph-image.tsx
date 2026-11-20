import { ImageResponse } from "next/og";

import { LandingShareCard } from "@/components/og/landing-share-card";
import { landingCopy } from "@/lib/landing/copy";
import { loadSoraFonts, wordmarkDataUrl } from "@/lib/og/assets";

export const alt = `Winz: ${landingCopy.heroTitle.before}${landingCopy.heroTitle.highlight}${landingCopy.heroTitle.firstLineEnd} ${landingCopy.heroTitle.second}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The preview a link to `/landing` gets in a chat or a feed: the hero without its phones, no photo.
 * It reads nothing from the request, so Next renders it once at build time.
 */
export default async function Image(): Promise<ImageResponse> {
  const [wordmark, fonts] = await Promise.all([wordmarkDataUrl(), loadSoraFonts()]);
  return new ImageResponse(<LandingShareCard wordmark={wordmark} />, {
    ...size,
    ...(fonts === undefined ? {} : { fonts }),
  });
}
