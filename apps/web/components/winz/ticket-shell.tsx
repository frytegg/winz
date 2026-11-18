import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The shape of a ticket (C3): a header, a dotted tear line with a notch bitten out of each side,
 * then the condition. The notches are filled with the color behind the card, so pass `notchColor`
 * when the screen is not the usual ink (the lime REFUNDED screen).
 */
export function TicketShell({
  top,
  bottom,
  notchColor = "var(--color-ink)",
  tone = "card",
  className,
}: {
  top: ReactNode;
  bottom: ReactNode;
  notchColor?: string;
  tone?: "card" | "ink";
  className?: string;
}): React.JSX.Element {
  const notch = "absolute top-1/2 size-6 -translate-y-1/2 rounded-full";
  return (
    <section
      className={cn("relative rounded-card", tone === "card" ? "bg-card" : "bg-ink", className)}
    >
      <div className="p-5">{top}</div>
      <div aria-hidden="true" className="relative h-0">
        <span
          className={cn(notch, "left-0 -translate-x-1/2")}
          style={{ backgroundColor: notchColor }}
        />
        <span
          className={cn(notch, "right-0 translate-x-1/2")}
          style={{ backgroundColor: notchColor }}
        />
        <div className="mx-6 border-t border-dashed border-white/20" />
      </div>
      <div className="p-5">{bottom}</div>
    </section>
  );
}
