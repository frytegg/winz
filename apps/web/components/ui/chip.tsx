import type { LucideIcon } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

interface ChipProps extends Omit<ComponentPropsWithoutRef<"button">, "children"> {
  label: string;
  icon?: LucideIcon;
  /** Whether it is the chosen one. Announced as pressed. */
  active?: boolean;
  /** `outline` for filters (sports), `fill` for a choice (category). */
  variant?: "outline" | "fill";
}

/** A pill with an optional icon: sport filters, merchant categories. 44px high. */
export function Chip({
  label,
  icon: Icon,
  active = false,
  variant = "outline",
  className,
  ...rest
}: ChipProps): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-body",
        "transition-[transform,background-color,color,box-shadow] duration-150 ease-out active:scale-[0.97]",
        active && variant === "fill" && "bg-lime text-ink",
        active && variant === "outline" && "bg-card-raised text-text ring-1 ring-lime",
        !active && "bg-card-raised text-text",
        "disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      {Icon === undefined ? null : (
        <Icon className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />
      )}
      {label}
    </button>
  );
}
