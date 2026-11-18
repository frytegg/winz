"use client";

import { useEffect } from "react";

import { copy } from "@/lib/copy";
import { pad2, timeLeft } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { cn } from "@/lib/utils";

interface CountdownProps {
  /** ISO time to count down to. */
  target: string;
  /** `md` in cards (32px), `lg` on the campaign page (44px). */
  size?: "md" | "lg" | "sm";
  onExpire?: () => void;
  className?: string;
}

function Unit({
  value,
  label,
  size,
}: {
  value: string;
  label: string;
  size: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center">
      <span className={cn("figures font-light leading-none", size)}>{value}</span>
      <span className="mt-1 text-micro uppercase text-muted">{label}</span>
    </div>
  );
}

/**
 * DAYS : HRS : MINS, ticking each second. The server does not know the time left, so the digits
 * show "--" until hydration. Announced once as a timer, not every second.
 */
export function Countdown({
  target,
  size = "md",
  onExpire,
  className,
}: CountdownProps): React.JSX.Element {
  const now = useNow();
  const ready = now !== 0;
  const left = ready ? timeLeft(target, now) : null;
  const expired = left?.expired === true;

  useEffect(() => {
    if (expired) onExpire?.();
  }, [expired, onExpire]);

  const digits =
    size === "lg" ? "text-countdown-lg" : size === "sm" ? "text-countdown-sm" : "text-countdown";
  const separator =
    size === "lg" ? "text-countdown-lg" : size === "sm" ? "text-countdown-sm" : "text-countdown";
  const value = (n: number | undefined): string => (n === undefined ? "--" : pad2(n));
  const label =
    left === null
      ? copy.countdown.timeLeft
      : copy.countdown.aria(left.days, left.hours, left.minutes);

  return (
    <div
      role="timer"
      aria-label={label}
      className={cn("inline-flex items-start gap-1.5", className)}
    >
      <Unit value={value(left?.days)} label={copy.countdown.days} size={digits} />
      <span aria-hidden="true" className={cn("font-light leading-none", separator)}>
        :
      </span>
      <Unit value={value(left?.hours)} label={copy.countdown.hours} size={digits} />
      <span aria-hidden="true" className={cn("font-light leading-none", separator)}>
        :
      </span>
      <Unit value={value(left?.minutes)} label={copy.countdown.mins} size={digits} />
    </div>
  );
}
