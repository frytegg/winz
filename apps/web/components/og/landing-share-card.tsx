import { OG_COLORS, OG_LANDING_HERO } from "@/lib/og/colors";
import { landingCopy } from "@/lib/landing/copy";

/**
 * The 1200 × 630 card a link to `/landing` gets in a chat or a feed: the hero of the page, without
 * its phones and with no photo. Dark at the top, fading to the lime at the bottom, the wordmark, the
 * H1 with "payback" in lime. Drawn by the image renderer, which knows a subset of CSS: every box is a
 * flex box, and colors are written out (the CSS variables do not exist there).
 */
const { lime: LIME, text: TEXT } = OG_COLORS;
const { ink: INK, end: END, fadeStart } = OG_LANDING_HERO;

const TITLE_SIZE = 104;

export function LandingShareCard({ wordmark }: { wordmark: string | null }): React.JSX.Element {
  const { before, highlight, after } = landingCopy.heroTitle;
  // "Get payback if" on the first line, "your team wins." on the second, as on the page.
  const [afterFirstLine = "", secondLine = ""] = after.split(/(?<=if) /);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        background: `linear-gradient(180deg, ${INK} 0%, ${INK} ${fadeStart * 100}%, ${END} 100%)`,
        color: TEXT,
        fontFamily: "Sora",
        padding: 72,
      }}
    >
      {/* The thin lime diagonals of the hero's background. */}
      {[0, 1, 2, 3].map((line) => (
        <div
          key={line}
          style={{
            position: "absolute",
            top: -120,
            left: 120 + line * 300,
            width: 2,
            height: 900,
            background: "rgba(216, 254, 53, 0.14)",
            transform: `rotate(${line % 2 === 0 ? 14 : -14}deg)`,
          }}
        />
      ))}

      {wordmark === null ? null : <img src={wordmark} height={48} alt="" />}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flexGrow: 1,
          fontSize: TITLE_SIZE,
          lineHeight: 1.12,
          fontWeight: 600,
          textAlign: "center",
          // Keep the title above the fade: the bottom third is the lime.
          paddingBottom: 90,
        }}
      >
        <div style={{ display: "flex", whiteSpace: "pre" }}>
          {before}
          <span style={{ color: LIME }}>{highlight}</span>
          {afterFirstLine}
        </div>
        <div style={{ display: "flex" }}>{secondLine}</div>
      </div>
    </div>
  );
}
