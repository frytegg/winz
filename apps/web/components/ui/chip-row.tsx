import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A horizontally scrolling row of chips (sport filters, categories).
 *
 * A scroll container clips whatever overflows it, on both axes, even when only one scrolls. The
 * vertical padding (`py-1`, cancelled by `-my-1`) leaves room for the 2px focus outline and its
 * 2px offset, which would otherwise be cut flat at the top and bottom of every chip.
 */
export function ChipRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("no-scrollbar -mx-5 -my-1 flex gap-2 overflow-x-auto px-5 py-1", className)}
    >
      {children}
    </div>
  );
}
