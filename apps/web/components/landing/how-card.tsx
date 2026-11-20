import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * One card of How it works (`sections/03-how.md`), the same shell for both tabs: a 340 x 413 card
 * (1 px #ECECEC border, #FAFAFA, 24 px radius, measured on `how/how.png`), the illustration on top in a
 * 340 x 295 frame, the title and the description below.
 *
 * The cards are NOT scaled with the page: the grid is 1060 px wide (3 x 340 + 2 x 20) and stays so down
 * to 1110 px, where the layout changes (two columns, then one) instead of shrinking the illustrations
 * to a size nobody can read. On a phone a card can be narrower than its frame (down to 288 px at 320):
 * the frame then steps down (`landing.css`, `.how-frame`), by container query on the card.
 *
 * The frame is laid over the card's border box (-1 px on the top and the sides), because the mockup's
 * illustrations are drawn from the card's own corner: their coordinates are the card's.
 */
export function HowCard({
  index,
  title,
  body,
  bodyMaxWidth,
  art,
  className,
}: {
  /** 0 to 2: the position in the row, for the 60 ms stagger of the tab change. */
  index: number;
  title: string;
  body: string;
  /** The mockup breaks one description earlier than the card's width does (Show the QR): a width in px. */
  bodyMaxWidth?: number;
  /** The 340 x 295 illustration: a picture (Merchant) or a drawn scene (Fan). */
  art: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <article
      style={{ "--i": index } as React.CSSProperties}
      className={cn(
        "how-card @container relative flex min-h-[413px] w-full max-w-[400px] flex-col rounded-3xl border border-landing-line bg-landing-card md:w-[340px]",
        className,
      )}
    >
      <div className="relative -mx-px -mt-px h-[295px] shrink-0">
        <div className="how-frame">{art}</div>
      </div>
      <div className="px-[19px] pb-[27px] pt-3 text-left">
        <h3 className="text-xl font-semibold leading-7 text-ink">{title}</h3>
        <p
          style={bodyMaxWidth === undefined ? undefined : { maxWidth: bodyMaxWidth }}
          className="mt-2.5 text-base leading-5 text-landing-gray"
        >
          {body}
        </p>
      </div>
    </article>
  );
}
