import { copy } from "@/lib/copy";
import { OG_COLORS } from "@/lib/og/colors";
import type { PosterContent } from "@/lib/og/poster";
import { POSTER_SIZES, layoutPromise } from "@/lib/og/promise-layout";

import { PosterQr } from "./poster-qr";

const { ink: INK, lime: LIME, text: TEXT, muted: MUTED, white: WHITE } = OG_COLORS;

/** The QR code is the biggest thing on the poster after the promise: it is read from a counter's length. */
const QR_TARGET = 500;

/**
 * The 1080 × 1350 poster a venue prints and sticks up. From top to bottom: the wordmark, the promise
 * in capitals, the venue and the game, the QR code on white, and a lime band with the line "Scan.
 * Pay. Maybe it's free." (dark text on lime). Everything is sized for a page held at arm's length:
 * nothing is under 26 px, and the muted grey is only used on the near-black, at 7:1.
 */
export function PromoPoster({
  content,
  wordmark,
}: {
  content: PosterContent;
  /** A data URL of the wordmark, or `null`. */
  wordmark: string | null;
}): React.JSX.Element {
  const { words, fontSize } = layoutPromise(content.promise, POSTER_SIZES);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: INK,
        color: TEXT,
        fontFamily: "Sora",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "space-between",
          padding: "72px 72px 56px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {wordmark === null ? <div /> : <img src={wordmark} height={52} alt="" />}
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
            fontSize,
            lineHeight: 1.1,
            fontWeight: 600,
          }}
        >
          {words.map((word, index) => (
            <div key={index} style={{ display: "flex", marginRight: Math.round(fontSize * 0.28) }}>
              {word.endsWith("%") ? word.slice(0, -1) : word}
              {word.endsWith("%") ? <span style={{ color: LIME }}>%</span> : null}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <svg
              width="46"
              height="46"
              viewBox="0 0 24 24"
              fill="none"
              stroke={LIME}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: 16 }}
            >
              <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <div
              style={{
                fontSize: 46,
                fontWeight: 600,
                // Explicit width: the renderer does not shrink a flex child below its text.
                maxWidth: 860,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {content.merchantName}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 8,
              fontSize: 32,
              color: MUTED,
              maxWidth: 936,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {content.eventTitle}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <div
            style={{
              display: "flex",
              background: WHITE,
              borderRadius: 32,
              overflow: "hidden",
            }}
          >
            <PosterQr value={content.link} target={QR_TARGET} />
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 150,
          background: LIME,
          color: INK,
          fontSize: 52,
          fontWeight: 600,
        }}
      >
        {copy.poster.tagline}
      </div>
    </div>
  );
}
