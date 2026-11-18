import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

import { Diagonals } from "./diagonals";

interface CardProps extends ComponentPropsWithoutRef<"div"> {
  /** `default` is the card grey, `raised` the lighter one (hero cards, fields, segmented). */
  tone?: "default" | "raised";
  /** The lime diagonal pattern behind the content (hero cards). */
  diagonals?: boolean;
}

/** A flat card: depth comes from the grey steps, never from a shadow (MASTER section 4). */
export function Card({
  tone = "default",
  diagonals = false,
  className,
  children,
  ...rest
}: CardProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-card",
        tone === "default" ? "bg-card" : "bg-card-raised",
        className,
      )}
      {...rest}
    >
      {diagonals ? <Diagonals /> : null}
      <div className="relative">{children}</div>
    </div>
  );
}
