"use client";

import { useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const PIECES = 18;

/**
 * The opening of "Your promo is live!" (MASTER section 7): a lime wipe across the screen, then
 * eighteen lime and white diamonds falling for 1.2 seconds. It plays once and removes itself; with
 * reduced motion it never renders.
 */
export function Celebration({ onDone }: { onDone?: () => void }): React.JSX.Element | null {
  const reduced = usePrefersReducedMotion();
  const [done, setDone] = useState(false);
  const finished = useRef(onDone);
  finished.current = onDone;

  useEffect(() => {
    if (reduced) {
      finished.current?.();
      return;
    }
    const timer = setTimeout(() => {
      setDone(true);
      finished.current?.();
    }, 1900);
    return () => clearTimeout(timer);
  }, [reduced]);

  if (reduced || done) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 animate-sweep bg-lime" />
      {Array.from({ length: PIECES }, (_, index) => {
        // Spread across the width without a random number: the same pattern at every render.
        const left = ((index * 37 + 11) % 92) + 4;
        const drift = ((index % 5) - 2) * 14;
        const size = 8 + (index % 3) * 2;
        return (
          <span
            key={index}
            className={cn(
              "absolute top-0 animate-confetti rotate-45",
              index % 2 === 0 ? "bg-lime" : "bg-white-pill",
            )}
            style={{
              left: `${left.toString()}%`,
              width: size,
              height: size,
              animationDelay: `${(700 + (index % 6) * 70).toString()}ms`,
              ["--dx" as string]: `${drift.toString()}px`,
            }}
          />
        );
      })}
    </div>
  );
}
