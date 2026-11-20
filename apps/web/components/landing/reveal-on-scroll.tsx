"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Phase = "visible" | "armed" | "in";

/**
 * Holds the cards of a section back until the section scrolls into view, then lets them in (the cards
 * rise and fade, one after another: `landing.css`, `.reveal-card`), once.
 *
 * Progressive: the server renders the cards visible, and so does a browser that never runs the script. After
 * hydration the cards are put out of sight ("armed") ONLY when the group is entirely below the first screen
 * and the visitor has not asked for less motion; otherwise nothing is hidden at all. Nothing is ever hidden
 * on the strength of a script that might not arrive.
 */
export function RevealOnScroll({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("visible");

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined") return;
    // Already on screen (a tall window, an anchor jump): there is nothing to wait for.
    if (element.getBoundingClientRect().top < window.innerHeight) return;

    setPhase("armed");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setPhase("in");
          observer.disconnect();
        }
      },
      // The group counts as seen when 10 % of the screen's height of it is in.
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={ref} data-reveal={phase} className={className}>
      {children}
    </div>
  );
}
