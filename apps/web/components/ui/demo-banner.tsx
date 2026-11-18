"use client";

import { useSyncExternalStore } from "react";

import { copy } from "@/lib/copy";
import { getDemoMode, subscribeDemoMode } from "@/lib/demo/store";

/**
 * The DEMO MODE band: a thin lime strip with black diagonal stripes, shown as soon as an API answer
 * carries `demo: true` (C1, C3, C4, campaign detail, hedge desk, admin). It sits above the screen
 * and pushes it down, so it never covers a header.
 */
export function DemoBanner(): React.JSX.Element | null {
  const demo = useSyncExternalStore(subscribeDemoMode, getDemoMode, () => false);
  if (!demo) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex h-6 items-center justify-center text-ink"
      style={{
        backgroundColor: "var(--color-lime)",
        backgroundImage:
          "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--color-ink) 28%, transparent) 6px 8px)",
        paddingTop: "var(--safe-top)",
        boxSizing: "content-box",
      }}
    >
      <span className="bg-lime px-3 text-micro font-semibold tracking-[0.12em]">
        {copy.demo.banner}
      </span>
    </div>
  );
}
