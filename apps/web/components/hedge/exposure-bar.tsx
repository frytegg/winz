"use client";

import type { CSSProperties } from "react";

import { copy } from "@/lib/copy";
import { wholePercentOfShare } from "@/lib/hedge/format";
import { exposureBar } from "@/lib/hedge/view";
import { cn } from "@/lib/utils";

import { AnimatedQty } from "./animated-figures";

const T = copy.hedgeDesk.instruments;

/** The stripes of the working orders: lime lines at 45°, so "resting" reads without relying on colour. */
const STRIPES: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--color-lime) 0 2px, transparent 2px 6px)",
};

/**
 * A segment of the bar: a full-size layer cut to its span with `clip-path`, so the span glides
 * (400ms) and the stripes keep their size, which a `scaleX` would stretch. `fromBps` and
 * `toBps` are the span in basis points of the bar; a 1px cut on a side that touches another
 * segment leaves the 2px gap of the mark spec.
 */
function Segment({
  fromBps,
  toBps,
  cutStart,
  cutEnd,
  className,
  style,
}: {
  fromBps: number;
  toBps: number;
  cutStart: boolean;
  cutEnd: boolean;
  className?: string;
  style?: CSSProperties;
}): React.JSX.Element {
  const left = `calc(${(fromBps / 100).toString()}% + ${cutStart ? "1px" : "0px"})`;
  const right = `calc(${((10_000 - toBps) / 100).toString()}% + ${cutEnd ? "1px" : "0px"})`;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "absolute inset-0 transition-[clip-path] duration-400 ease-out motion-reduce:transition-none",
        className,
      )}
      style={{ ...style, clipPath: `inset(0 ${right} 0 ${left})` }}
    />
  );
}

function Swatch({ kind }: { kind: "exposure" | "held" | "working" }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-[3px]",
        kind === "held" && "bg-lime",
        kind === "exposure" && "border border-stroke",
        kind === "working" && "border border-lime/60",
      )}
      style={kind === "working" ? STRIPES : undefined}
    />
  );
}

function Figure({
  kind,
  code,
  label,
  hint,
  micro,
  large = false,
}: {
  kind: "exposure" | "held" | "working";
  code: string;
  label: string;
  hint: string;
  micro: string;
  large?: boolean;
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-2 text-caption text-muted">
        <Swatch kind={kind} />
        <span className="truncate">
          <span className="font-semibold text-text">{code}</span> · {label}
        </span>
      </p>
      <p
        className={cn(
          "mt-1 text-text [overflow-wrap:anywhere]",
          large ? "text-title" : "text-lead font-semibold",
        )}
      >
        <AnimatedQty micro={micro} />
      </p>
      <p className="mt-0.5 text-caption text-muted">{hint}</p>
    </div>
  );
}

/**
 * E, H and W of one instrument, in contracts: the exposure (what Winz owes if YES), what is held,
 * and what rests as maker orders. One bar of the exposure's length, held first (solid lime), then
 * working (striped), the rest empty. No chart library: a few layers (BRIEF section 6).
 */
export function ExposureBar({
  exposure,
  held,
  working,
}: {
  exposure: string;
  held: string;
  working: string;
}): React.JSX.Element {
  const bar = exposureBar(exposure, held, working);
  const heldTo = bar.heldBps;
  const workingTo = bar.heldBps + bar.workingBps;
  const hedgedPercent = wholePercentOfShare(bar.hedgedOfExposureBps);
  const noExposure = BigInt(exposure) === 0n;
  const summary = noExposure ? T.noExposure : `${T.barLabel}: ${T.hedged(hedgedPercent)}`;

  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        <Figure
          kind="exposure"
          code={T.exposureCode}
          label={T.exposure}
          hint={T.exposureHint}
          micro={exposure}
          large
        />
        <Figure kind="held" code={T.heldCode} label={T.held} hint={T.heldHint} micro={held} />
        <Figure
          kind="working"
          code={T.workingCode}
          label={T.working}
          hint={T.workingHint}
          micro={working}
        />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div
          role="img"
          aria-label={summary}
          className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-card-raised"
        >
          <Segment
            fromBps={0}
            toBps={heldTo}
            cutStart={false}
            cutEnd={bar.workingBps > 0}
            className="bg-lime"
          />
          <Segment
            fromBps={heldTo}
            toBps={workingTo}
            cutStart={bar.heldBps > 0}
            cutEnd={false}
            style={STRIPES}
          />
        </div>
        <p className="figures w-[7.5rem] shrink-0 text-right text-caption text-muted">
          {noExposure ? (
            T.noExposure
          ) : (
            <>
              <span className="text-label font-semibold text-lime">
                {hedgedPercent.toString()}%
              </span>{" "}
              {T.hedgedLabel}
            </>
          )}
        </p>
      </div>
      {bar.overCovered ? <p className="mt-2 text-caption text-muted">{T.overCovered}</p> : null}
    </div>
  );
}
