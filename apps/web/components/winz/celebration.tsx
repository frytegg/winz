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
export function Celebration({
  onDone,
  tone = "lime",
  wipe = true,
}: {
  onDone?: () => void;
  /** `ink` draws ink and white diamonds, for a screen that is already lime (REFUNDED). */
  tone?: "lime" | "ink";
  /** The lime wipe before the diamonds. Off on a screen that is already lime. */
  wipe?: boolean;
}): React.JSX.Element | null {
  const reduced = usePrefersReducedMotion();
  const [done, setDone] = useState(false);
  const finished = useRef(onDone);
  finished.current = onDone;

  useEffect(() => {
    if (reduced) {
      finished.current?.();
      return;
    }
    const timer = setTimeout(
      () => {
        setDone(true);
        finished.current?.();
      },
      wipe ? 1900 : 1500,
    );
    return () => clearTimeout(timer);
  }, [reduced, wipe]);

  if (reduced || done) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {wipe ? <div className="absolute inset-0 animate-sweep bg-lime" /> : null}
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
              index % 2 === 0 ? (tone === "lime" ? "bg-lime" : "bg-ink") : "bg-white-pill",
            )}
            style={{
              left: `${left.toString()}%`,
              width: size,
              height: size,
              animationDelay: `${((wipe ? 700 : 150) + (index % 6) * 70).toString()}ms`,
              ["--dx" as string]: `${drift.toString()}px`,
            }}
          />
        );
      })}
    </div>
  );
}
