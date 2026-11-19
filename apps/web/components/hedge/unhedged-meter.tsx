"use client";

import { TriangleAlert } from "lucide-react";

import { copy } from "@/lib/copy";
import { formatMoney } from "@/lib/format";
import { unhedgedMeter } from "@/lib/hedge/view";
import { cn } from "@/lib/utils";

import { AnimatedMoney } from "./animated-figures";

const T = copy.hedgeDesk.instruments;

/**
 * The unhedged notional of one instrument, (E − H) × price, against the limit `uMax` (SPEC 9.3).
 * The bar is grey while there is room and turns red from 80% of the limit; the words "Near the
 * limit" or "Over the limit" and an icon say the same, so the colour is never the only signal.
 * The bar stops at the limit, the figure keeps counting past it.
 */
export function UnhedgedMeter({
  unhedgedNotional,
  uMax,
}: {
  unhedgedNotional: string;
  uMax: string;
}): React.JSX.Element {
  const meter = unhedgedMeter(unhedgedNotional, uMax);
  const risky = meter.level !== "ok";
  const right = ((10_000 - meter.fillBps) / 100).toString();
  const summary = `${T.unhedgedLabel}: ${formatMoney(unhedgedNotional)} ${T.unhedgedOf(formatMoney(uMax))}`;

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption text-muted">
            {T.unhedged} · <span className="whitespace-nowrap">{T.unhedgedHint}</span>
          </p>
          <p className="mt-1 text-lead font-semibold text-text">
            <AnimatedMoney micro={unhedgedNotional} />
            <span className="ml-2 text-caption font-normal text-muted">
              {T.unhedgedOf(formatMoney(uMax))}
            </span>
          </p>
        </div>
        {risky ? (
          <p
            className={cn(
              "flex shrink-0 items-center gap-1.5 text-caption font-semibold",
              meter.level === "over" ? "text-danger" : "text-text",
            )}
          >
            <TriangleAlert className="size-4" strokeWidth={1.5} aria-hidden="true" />
            {meter.level === "over" ? T.overLimit : T.nearLimit}
          </p>
        ) : null}
      </div>
      <div
        role="img"
        aria-label={summary}
        className="relative mt-3 h-3 overflow-hidden rounded-full bg-card-raised"
      >
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0 transition-[clip-path,background-color] duration-400 ease-out motion-reduce:transition-none",
            risky ? "bg-danger" : "bg-muted",
          )}
          style={{ clipPath: `inset(0 ${right}% 0 0 round 9999px)` }}
        />
      </div>
    </div>
  );
}
