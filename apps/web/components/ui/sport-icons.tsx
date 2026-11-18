import type { Sport } from "@winz/shared";
import { Trophy } from "lucide-react";
import type { SVGProps } from "react";

import type { IconComponent } from "./icons";

/**
 * The sport icons of the filter chips (M3), redrawn from the mockup (M3-pick-game): thin outlines,
 * 24px box, 1.5 stroke, round caps and joins, `currentColor`: they sit next to lucide icons without
 * showing. Lucide has no American football and its soccer ball is a different drawing. The mockup
 * has football, soccer and basketball; hockey and baseball follow the same line, and "other" uses
 * lucide's trophy.
 */

function Outline(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

/** A tilted ball: laces along its length, a seam near each tip. */
export function FootballIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <Outline {...props}>
      <g transform="rotate(-45 12 12)">
        <ellipse cx="12" cy="12" rx="9.6" ry="5.7" />
        <path d="M8.6 12h6.8M10 10.5v3M12 10.5v3M14 10.5v3" />
        <path d="M6.3 9.4Q7.6 12 6.3 14.6M17.7 9.4Q16.4 12 17.7 14.6" />
      </g>
    </Outline>
  );
}

/** The ball: a pentagon in the middle, a seam from each of its corners to the edge. */
export function SoccerIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <Outline {...props}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 8.8L15.04 11.01L13.88 14.59H10.12L8.96 11.01Z" />
      <path d="M12 8.8V2.5M15.04 11.01L21.03 9.06M13.88 14.59L17.58 19.69M10.12 14.59L6.42 19.69M8.96 11.01L2.97 9.06" />
    </Outline>
  );
}

/** Two crossing lines and the two curved seams. */
export function BasketballIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <Outline {...props}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 2.5V21.5M2.5 12H21.5" />
      <path d="M5.3 5.3Q9.6 12 5.3 18.7M18.7 5.3Q14.4 12 18.7 18.7" />
    </Outline>
  );
}

/** A stick and a puck. */
export function HockeyIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <Outline {...props}>
      <path d="M5 3L10.6 16.2H19" />
      <ellipse cx="7.5" cy="19" rx="3.8" ry="1.5" />
      <path d="M3.7 19v1.8c0 .9 1.7 1.7 3.8 1.7s3.8-.8 3.8-1.7V19" />
    </Outline>
  );
}

/** The ball: two seams with their stitches. */
export function BaseballIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <Outline {...props}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M7 3.9Q11 12 7 20.1M17 3.9Q13 12 17 20.1" />
      <path d="M8.5 7.95L6.6 7.2M9 12H6.9M8.5 16.05L6.6 16.8M15.5 7.95L17.4 7.2M15 12H17.1M15.5 16.05L17.4 16.8" />
    </Outline>
  );
}

export const SPORT_ICONS: Record<Sport, IconComponent> = {
  football: FootballIcon,
  basketball: BasketballIcon,
  hockey: HockeyIcon,
  baseball: BaseballIcon,
  soccer: SoccerIcon,
  other: Trophy,
};
