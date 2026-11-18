"use client";

import { useRef, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** `tabs` when it switches views (Stats / Budget / Controls), `radio` when it filters. */
  semantics?: "radio" | "tabs";
  className?: string;
}

/**
 * The pill with a lime segment (In progress / Closed, This month / This week / Today). The lime
 * indicator slides with `transform`. Arrow keys move between segments.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  semantics = "radio",
  className,
}: SegmentedProps<T>): React.JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const isTabs = semantics === "tabs";

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: number): void {
    const last = options.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = current === last ? 0 : current + 1;
    if (event.key === "ArrowLeft") next = current === 0 ? last : current - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    const target = options[next];
    if (target === undefined) return;
    onChange(target.value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role={isTabs ? "tablist" : "radiogroup"}
      aria-label={label}
      className={cn("relative flex h-[52px] rounded-full bg-card-raised p-1", className)}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 rounded-full bg-lime transition-transform duration-240 ease-out"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length.toString()})`,
          transform: `translateX(${(index * 100).toString()}%)`,
        }}
      />
      {options.map((option, position) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[position] = node;
            }}
            type="button"
            role={isTabs ? "tab" : "radio"}
            aria-selected={isTabs ? active : undefined}
            aria-checked={isTabs ? undefined : active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, position)}
            className={cn(
              "relative z-10 min-w-0 flex-1 truncate rounded-full px-2 text-body",
              "transition-colors duration-150 ease-out",
              active ? "text-ink" : "text-text",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
