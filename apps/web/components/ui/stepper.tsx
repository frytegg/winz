"use client";

import { Minus, Plus } from "lucide-react";
import { useId, useState } from "react";

import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

interface StepperProps {
  /** What it sets, for assistive technology and the caps label. */
  label: string;
  value: number;
  onChange: (value: number) => void;
  step: number;
  min: number;
  max: number;
  /** A lime unit before the number ("$"). */
  prefix?: string;
  /** A lime unit after the number ("%"). */
  suffix?: string;
  /** How the value shows when not being typed. Default: the number itself. */
  format?: (value: number) => string;
  /** When set, the number can be typed. Returns `null` for text that is not a value. */
  parse?: (text: string) => number | null;
  className?: string;
  showLabel?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The ± pill (MASTER section 5): round buttons at both ends, the value in the middle with its unit
 * in lime. The round buttons are 44px, the iOS minimum touch target.
 */
export function Stepper({
  label,
  value,
  onChange,
  step,
  min,
  max,
  prefix,
  suffix,
  format = (n) => n.toString(),
  parse,
  className,
  showLabel = true,
}: StepperProps): React.JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? format(value);

  function commit(): void {
    if (draft === null) return;
    const parsed = parse?.(draft) ?? null;
    if (parsed !== null) onChange(clamp(parsed, min, max));
    setDraft(null);
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {showLabel ? (
        <label htmlFor={id} className="text-label uppercase text-text">
          {label}
        </label>
      ) : null}
      <div className="flex h-12 items-center justify-between rounded-full border border-stroke px-0.5 has-[input:focus-visible]:border-lime has-[input:focus-visible]:outline-2 has-[input:focus-visible]:-outline-offset-1 has-[input:focus-visible]:outline-lime">
        <button
          type="button"
          aria-label={copy.common.decrease(label)}
          disabled={value <= min}
          onClick={() => {
            setDraft(null);
            onChange(clamp(value - step, min, max));
          }}
          className="grid size-11 place-items-center rounded-full bg-card-raised text-text transition-[transform,opacity] duration-150 ease-out active:scale-[0.94] disabled:opacity-40"
        >
          <Minus className="size-5" strokeWidth={1.5} aria-hidden="true" />
        </button>
        <div className="figures flex min-w-0 items-center justify-center gap-0.5 text-lead">
          {prefix === undefined ? null : <span className="text-lime">{prefix}</span>}
          <input
            id={id}
            role="spinbutton"
            aria-valuenow={value}
            aria-valuetext={shown}
            aria-valuemin={min}
            aria-valuemax={max}
            inputMode="decimal"
            readOnly={parse === undefined}
            value={shown}
            onFocus={(event) => {
              if (parse !== undefined) event.currentTarget.select();
            }}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "ArrowUp") {
                event.preventDefault();
                onChange(clamp(value + step, min, max));
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                onChange(clamp(value - step, min, max));
              }
            }}
            style={{ width: `${Math.max(1, shown.length).toString()}ch` }}
            className={cn(
              "min-w-0 max-w-32 bg-transparent text-text outline-none",
              prefix !== undefined
                ? "text-left"
                : suffix !== undefined
                  ? "text-right"
                  : "text-center",
            )}
          />
          {suffix === undefined ? null : <span className="text-lime">{suffix}</span>}
        </div>
        <button
          type="button"
          aria-label={copy.common.increase(label)}
          disabled={value >= max}
          onClick={() => {
            setDraft(null);
            onChange(clamp(value + step, min, max));
          }}
          className="grid size-11 place-items-center rounded-full bg-card-raised text-text transition-[transform,opacity] duration-150 ease-out active:scale-[0.94] disabled:opacity-40"
        >
          <Plus className="size-5" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
