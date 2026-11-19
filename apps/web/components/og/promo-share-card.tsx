import { copy } from "@/lib/copy";
import { PREVIEW_SIZES, layoutPromise } from "@/lib/og/promise-layout";

/**
 * The 1200 × 630 card a link to a promo gets in a chat or a feed: the promise, big, with the
 * venue's name. It is drawn by the image renderer, which knows a subset of CSS: every box is a flex
 * box, and colors are written out (the CSS variables do not exist there). They are the tokens of the
 * app: --color-ink, --color-lime, --color-text, --color-muted.
 */
const INK = "#131314";
const LIME = "#D8FE35";
const TEXT = "#FFFFFF";
const MUTED = "#A1A1AA";

export function PromoShareCard({
  promise,
  merchantName,
  eventTitle,
  wordmark,
}: {
  promise: string;
  merchantName: string;
  eventTitle: string;
  /** A data URL of the wordmark, or `null`. */
  wordmark: string | null;
}): React.JSX.Element {
  const { words, fontSize } = layoutPromise(promise, PREVIEW_SIZES);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        position: "relative",
        overflow: "hidden",
        background: INK,
        color: TEXT,
        fontFamily: "Sora",
        padding: 72,
      }}
    >
      {/* The field lines of the app's hero cards: thin lime diagonals. */}
      {[0, 1, 2, 3].map((line) => (
        <div
          key={line}
          style={{
            position: "absolute",
            top: -80,
            left: 760 + line * 120,
            width: 2,
            height: 840,
            background: "rgba(216, 254, 53, 0.15)",
            transform: "rotate(15deg)",
          }}
        />
      ))}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {wordmark === null ? null : <img src={wordmark} height={44} alt="" />}
        <div style={{ display: "flex", alignItems: "center", fontSize: 24, color: MUTED }}>
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {merchantName === "" ? null : (
            <>
              <svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke={LIME}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginRight: 14 }}
              >
                <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <div
                style={{
                  fontSize: 38,
                  fontWeight: 600,
                  // Explicit widths: the renderer does not shrink a flex child below its text, so a
                  // long venue name would run under the event title. 36 + 14 + 580 + 32 + 380 < 1056.
                  maxWidth: 580,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {merchantName}
              </div>
            </>
          )}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: MUTED,
            marginLeft: 32,
            maxWidth: 380,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {eventTitle}
        </div>
      </div>
    </div>
  );
}
