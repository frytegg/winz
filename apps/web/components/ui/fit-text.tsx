"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Keeps a figure on one line by shrinking its font size until it fits its box (never below
 * `minScale` of the original). A big amount like "$12,420.50" in a half-width tile would
 * otherwise spill out; cutting it with an ellipsis would hide digits of a sum of money.
 */
export function FitText({
  children,
  minScale = 0.5,
  className,
}: {
  children: ReactNode;
  minScale?: number;
  className?: string;
}): React.JSX.Element {
  const box = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const outer = box.current;
    const inner = text.current;
    if (outer === null || inner === null) return;

    const fit = (): void => {
      inner.style.fontSize = "";
      const available = outer.clientWidth;
      const needed = inner.scrollWidth;
      if (available > 0 && needed > available) {
        const base = Number.parseFloat(getComputedStyle(inner).fontSize);
        const scale = Math.max(minScale, available / needed);
        inner.style.fontSize = `${(base * scale).toString()}px`;
      }
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    return () => observer.disconnect();
  });

  return (
    <span ref={box} className={cn("block min-w-0 overflow-hidden whitespace-nowrap", className)}>
      <span ref={text} className="inline-block">
        {children}
      </span>
    </span>
  );
}
