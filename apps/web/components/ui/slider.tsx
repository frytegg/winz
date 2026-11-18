"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** The value as shown at the right of the label ("25%"). */
  display?: string;
  className?: string;
}

/**
 * A native range input (keyboard, screen reader and touch for free), restyled: a lime fill up to
 * the thumb, a 28px thumb inside a 44px touch target.
 */
export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  display,
  className,
}: SliderProps): React.JSX.Element {
  const id = useId();
  const span = max - min;
  const fill = span <= 0 ? 0 : ((value - min) / span) * 100;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-label uppercase text-text">
          {label}
        </label>
        {display === undefined ? null : (
          <output htmlFor={id} className="figures text-lead text-lime">
            {display}
          </output>
        )}
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ ["--fill" as string]: `${fill.toString()}%` }}
        className={cn(
          "h-11 w-full cursor-pointer appearance-none bg-transparent",
          // Track
          "[&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full",
          "[&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--color-lime)_var(--fill),var(--color-card-raised)_var(--fill))]",
          "[&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-card-raised",
          "[&::-moz-range-progress]:h-2 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-lime",
          // Thumb
          "[&::-webkit-slider-thumb]:-mt-2.5 [&::-webkit-slider-thumb]:size-7 [&::-webkit-slider-thumb]:appearance-none",
          "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white-pill",
          "[&::-moz-range-thumb]:size-7 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white-pill",
          "focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-lime",
        )}
      />
    </div>
  );
}
