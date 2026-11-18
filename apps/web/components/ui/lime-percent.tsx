import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Colors every `%` of a promise lime ("100% back if Texas wins by 14+"): the one accent of a
 * headline. On a lime card pass `tone="ink"`, since text is never lime on lime.
 */
export function LimePercent({
  text,
  tone = "lime",
  className,
}: {
  text: string;
  tone?: "lime" | "ink";
  className?: string;
}): ReactNode {
  const parts = text.split("%");
  return (
    <span className={className}>
      {parts.map((part, index) => (
        <Fragment key={`${index.toString()}-${part}`}>
          {part}
          {index < parts.length - 1 ? (
            <span className={cn(tone === "lime" ? "text-lime" : "text-ink")}>%</span>
          ) : null}
        </Fragment>
      ))}
    </span>
  );
}
