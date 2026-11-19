"use client";

import { copy } from "@/lib/copy";
import { bpsToWholePercent } from "@/lib/format";
import { cn } from "@/lib/utils";

import { AnimatedNumber } from "./animated-number";

const RADIUS = 88;
const STROKE = 12;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface GaugeProps {
  /** The chance in basis points, or `null` when there is no fresh quote. */
  bps: number | null;
  /** The words under the figure, inside the ring; `null` for none (the screen says it below). */
  caption?: string | null;
  className?: string;
}

/**
 * The ticket's ring: a lime arc proportional to the chance it is free, the figure in the middle.
 * The arc glides in 600ms when the odds move.
 */
export function Gauge({
  bps,
  caption = copy.ticket.chanceUnit,
  className,
}: GaugeProps): React.JSX.Element {
  const fraction = bps === null ? 0 : Math.min(1, Math.max(0, bps / 10_000));
  const percent = bps === null ? null : bpsToWholePercent(bps);
  const label = percent === null ? copy.pickPromo.staleBook : copy.ticket.chanceTitle(percent);
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("relative mx-auto grid size-[200px] place-items-center", className)}
    >
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 size-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="100"
          cy="100"
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-card-raised"
        />
        <circle
          cx="100"
          cy="100"
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          className="stroke-lime transition-[stroke-dashoffset] duration-600 ease-out"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        />
      </svg>
      <div className="relative flex flex-col items-center text-center">
        <span className="figures text-chance text-lime">
          {percent === null ? (
            "–"
          ) : (
            <AnimatedNumber value={percent} format={(n) => `${n.toString()}%`} />
          )}
        </span>
        {caption === null ? null : (
          <span className="mt-2 max-w-[8.5rem] text-micro uppercase leading-tight text-muted">
            {caption}
          </span>
        )}
      </div>
    </div>
  );
}
