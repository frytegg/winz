"use client";

import { useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "@/lib/hooks";

/**
 * A number that counts to its new value in 400ms (the odds, the sales). Instant with reduced
 * motion. Tabular figures, so the width does not jump while it counts.
 */
export function AnimatedNumber({
  value,
  format = (n) => n.toString(),
  duration = 400,
  className,
}: {
  value: number;
  format?: (value: number) => string;
  duration?: number;
  className?: string;
}): React.JSX.Element {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(value);
  const current = useRef(value);

  useEffect(() => {
    if (reduced || current.current === value) {
      current.current = value;
      setShown(value);
      return;
    }
    const from = current.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      current.current = from + (value - from) * eased;
      setShown(current.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduced]);

  return <span className={className ?? "figures"}>{format(Math.round(shown))}</span>;
}
