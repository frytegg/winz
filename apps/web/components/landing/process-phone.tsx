import type { CSSProperties, ReactNode } from "react";

/**
 * The light card with the dark phone cut at its bottom (`process.png`): 634 x 400 at 1728 px, the phone 355
 * wide, 60 from the top, with a lime ring to go back and a lime progress bar. Everything inside is drawn in
 * the mockup's pixels times `--p` (one pixel of the mockup at the card's own width: `process.css`), so the
 * card is one picture at any size.
 *
 * On the desktop there is one of these, sticky, and its screens take turns (`ProcessScroll`); under 1024 px
 * each step has its own. The bar is the step's share of the way (`fill`, 0 to 1); on the sticky card it is
 * set from the block that is on.
 */
export function ProcessPhone({
  fill,
  children,
}: {
  fill: number;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="process-card" data-process-card style={{ "--fill": fill } as CSSProperties}>
      <div className="process-phone">
        <div className="process-top">
          <span className="process-back">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M14.5 6 8.5 12l6 6" />
            </svg>
          </span>
          <span className="process-bar">
            <span className="process-bar-fill" />
          </span>
        </div>
        <div className="process-screens">{children}</div>
      </div>
    </div>
  );
}
