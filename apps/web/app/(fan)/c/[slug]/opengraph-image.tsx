import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { copy } from "@/lib/copy";
import { loadPublicCampaign } from "@/lib/fan/public-campaign";

export const alt = copy.brand.description;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#131314";
const LIME = "#D8FE35";
const MUTED = "#A1A1AA";

/** The wordmark, read from the brand file and inlined: no network at render time. */
async function wordmark(): Promise<string | null> {
  try {
    const svg = await readFile(join(process.cwd(), "public", "brand", "logo-winz-lime.svg"));
    return `data:image/svg+xml;base64,${svg.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Word by word, so the line wraps like a sentence and only the `%` of "100%" turns lime. */
function words(promise: string): string[] {
  return promise.split(/\s+/).filter((word) => word !== "");
}

/**
 * The preview a link to a promo gets in a chat or a feed (CO-1): the promise, big, with the venue's
 * name. Lime on the near-black of the app, the same two colors as the screens.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<ImageResponse> {
  const { slug } = await params;
  const [result, logo] = await Promise.all([loadPublicCampaign(slug, null), wordmark()]);
  const campaign = result.kind === "ok" ? result.campaign : null;
  const promise = words((campaign?.promise ?? copy.brand.tagline).toUpperCase());

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: INK,
        color: "#FFFFFF",
        padding: 72,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {logo === null ? null : <img src={logo} height={44} alt="" />}
        <div style={{ display: "flex", alignItems: "center", fontSize: 26, color: MUTED }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              background: LIME,
              marginRight: 14,
            }}
          />
          {copy.campaign.badge.toUpperCase()}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          fontSize: 86,
          lineHeight: 1.08,
          fontWeight: 600,
        }}
      >
        {promise.map((word, index) => (
          <div key={index} style={{ display: "flex", marginRight: 24 }}>
            {word.endsWith("%") ? word.slice(0, -1) : word}
            {word.endsWith("%") ? <span style={{ color: LIME }}>%</span> : null}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", fontSize: 38 }}>{campaign?.merchant.name ?? ""}</div>
        <div style={{ display: "flex", fontSize: 30, color: MUTED }}>
          {campaign?.eventTitle ?? ""}
        </div>
      </div>
    </div>,
    size,
  );
}
