"use client";

import { Minus, Plus } from "lucide-react";

import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * The quantity pill of the product card (C1, mockup): a dark round "−", the number, a lime round
 * "+". The two buttons are 44px, the touch minimum. The number is announced when it changes.
 */
export function QtyStepper({
  value,
  onChange,
  min,
  max,
  label,
  disabled = false,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  label: string;
  disabled?: boolean;
  className?: string;
}): React.JSX.Element {
  const button =
    "grid size-11 shrink-0 place-items-center rounded-full transition-[transform,opacity] duration-150 ease-out active:scale-[0.94] disabled:opacity-40";
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex h-[52px] items-center gap-1 rounded-full border border-stroke px-1",
        className,
      )}
    >
      <button
        type="button"
        aria-label={copy.common.decrease(label)}
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className={cn(button, "bg-ink text-text")}
      >
        <Minus className="size-5" strokeWidth={1.5} aria-hidden="true" />
      </button>
      <output aria-live="polite" className="figures min-w-8 text-center text-lead">
        {value}
      </output>
      <button
        type="button"
        aria-label={copy.common.increase(label)}
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className={cn(button, "bg-lime text-ink")}
      >
        <Plus className="size-5" strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}
