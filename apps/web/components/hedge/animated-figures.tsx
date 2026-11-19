"use client";

import { AnimatedNumber } from "@/components/ui/animated-number";
import { formatAmount, formatMoney } from "@/lib/format";
import { formatQty } from "@/lib/hedge/format";
import { cn } from "@/lib/utils";

/**
 * Figures of the Hedge desk that change every few seconds. They count to their new value
 * (400ms, instant with reduced motion) and keep tabular digits, so a reading never moves the layout.
 * The text is always written from the exact `bigint`, never from the animated float: the count is
 * only the transition between two exact values. A value beyond 2^53 skips the animation.
 */

function animatable(value: bigint): boolean {
  return value <= BigInt(Number.MAX_SAFE_INTEGER);
}

/** "$1,800.00", the `$` in lime like every amount (MASTER section 3). */
export function AnimatedMoney({
  micro,
  className,
}: {
  micro: string;
  className?: string;
}): React.JSX.Element {
  const value = BigInt(micro);
  return (
    <span className={cn("figures", className)}>
      <span className="sr-only">{formatMoney(value)}</span>
      <span aria-hidden="true">
        <span className="text-lime">$</span>
        {animatable(value) ? (
          <AnimatedNumber value={Number(value)} format={(n) => formatAmount(BigInt(n))} />
        ) : (
          formatAmount(value)
        )}
      </span>
    </span>
  );
}

/** A quantity of contracts, "240.00". */
export function AnimatedQty({
  micro,
  className,
}: {
  micro: string;
  className?: string;
}): React.JSX.Element {
  const value = BigInt(micro);
  return (
    <span className={cn("figures", className)}>
      <span className="sr-only">{formatQty(value)}</span>
      <span aria-hidden="true">
        {animatable(value) ? (
          <AnimatedNumber value={Number(value)} format={(n) => formatQty(BigInt(n))} />
        ) : (
          formatQty(value)
        )}
      </span>
    </span>
  );
}
