import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Card } from "../ui/card";
import { FitText } from "../ui/fit-text";

/** A figure with its label (Sales, Gross sales, Coverage…). The value is a `Money` or a number. */
export function StatTile({
  label,
  icon: Icon,
  children,
  className,
}: {
  label: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <Card tone="raised" diagonals className={cn("p-4", className)}>
      <p className="flex items-center gap-2 text-body text-text">
        {Icon === undefined ? null : (
          <Icon className="size-4 text-muted" strokeWidth={1.5} aria-hidden="true" />
        )}
        {label}
      </p>
      <p className="figures mt-2 text-figure-sm">
        <FitText>{children}</FitText>
      </p>
    </Card>
  );
}
