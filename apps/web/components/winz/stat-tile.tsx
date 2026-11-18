import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Card } from "../ui/card";
import { FitText } from "../ui/fit-text";
import type { IconComponent } from "../ui/icons";

/**
 * A figure with its label (Sales, Gross sales, Coverage…). The value is a `Money` or a number.
 * As in the mockups: a 15px white outline icon, 10px before a light-weight white label, 20px of
 * side padding. Pass `ReceiptIcon` for a count of orders or a coverage share, `CashIcon` for an amount.
 */
export function StatTile({
  label,
  icon: Icon,
  children,
  className,
}: {
  label: string;
  icon?: IconComponent;
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <Card tone="raised" diagonals className={cn("px-5 py-4", className)}>
      <p className="flex items-center gap-2.5 text-body font-light text-text">
        {Icon === undefined ? null : (
          <Icon className="size-[15px] shrink-0" strokeWidth={1.25} aria-hidden="true" />
        )}
        {label}
      </p>
      <p className="figures mt-2 text-figure-sm">
        <FitText>{children}</FitText>
      </p>
    </Card>
  );
}
