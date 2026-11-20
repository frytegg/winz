import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The small pill of the illustrations of How it works (`how/how.png`: "Budget", "Fund with Apple Pay",
 * "Fund with card"…): 30 px high in the 340 x 295 frame, an icon on the left, a label in Sora 11 px.
 * `lime` is the accent (ink text); `dark` is the dark card's grey (white text), as the mockup's
 * "Fund with card". Both tabs use it, so a Fan chip is the same object as a Merchant one.
 *
 * Placed by its parent's coordinates (`style`): the frame is a fixed 340 x 295 canvas.
 */
export function HowChip({
  tone,
  icon,
  style,
  className,
  children,
}: {
  tone: "lime" | "dark";
  icon?: ReactNode;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span
      style={style}
      className={cn(
        "absolute inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full pl-3 pr-3.5 text-[11px] font-normal leading-none",
        tone === "lime" ? "bg-lime text-ink" : "bg-landing-chip text-white",
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
