"use client";

import type { HedgeDeskResponse } from "@winz/shared";

import { Card } from "@/components/ui/card";
import { copy } from "@/lib/copy";
import { formatMoney } from "@/lib/format";

import { AnimatedMoney } from "./animated-figures";

const T = copy.hedgeDesk;

function Total({
  label,
  hint,
  micro,
}: {
  label: string;
  hint: string;
  micro: string;
}): React.JSX.Element {
  return (
    <Card tone="raised" diagonals className="px-5 py-4 lg:px-6 lg:py-5">
      {/* A phone reads it as a row (label and hint left, figure right); a laptop as a tile. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 sm:grid-cols-1">
        <p className="text-body font-light text-text">{label}</p>
        <p className="figures col-start-2 row-span-2 row-start-1 text-title sm:col-start-1 sm:row-span-1 sm:row-start-2 sm:mt-2 sm:text-figure-sm">
          <AnimatedMoney micro={micro} />
        </p>
        <p className="mt-1 text-caption text-muted sm:row-start-3">{hint}</p>
      </div>
    </Card>
  );
}

/**
 * The three numbers of the engine over every match (SPEC MDB-3, "économie réalisée"): what the maker
 * policy saved against filling everything as taker, what Winz paid when a fill came in above a quote's
 * guarantee, and what it kept when two opposite exposures cancelled.
 */
export function EngineTotals({
  totals,
}: {
  totals: HedgeDeskResponse["totals"];
}): React.JSX.Element {
  return (
    <section aria-label={T.totals.title} className="grid gap-3 sm:grid-cols-3 lg:gap-4">
      <Total
        label={T.totals.makerSavings}
        hint={T.totals.makerSavingsHint}
        micro={totals.makerSavings}
      />
      <Total
        label={T.totals.guaranteeLosses}
        hint={T.totals.guaranteeLossesHint}
        micro={totals.guaranteeLosses}
      />
      <Total
        label={T.totals.crossingGains}
        hint={T.totals.crossingGainsHint}
        micro={totals.crossingGains}
      />
    </section>
  );
}

function Param({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-white/10 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <dt className="min-w-0 text-body text-muted">
        {label}
        {hint === undefined ? null : <span className="text-caption"> · {hint}</span>}
      </dt>
      <dd className="figures shrink-0 text-right text-body font-semibold text-text">{children}</dd>
    </div>
  );
}

/** The risk limits in force (`uMax`, maker lifetime, the ask move that abandons a maker order…). */
export function RiskParams({ params }: { params: HedgeDeskResponse["params"] }): React.JSX.Element {
  const P = T.params;
  return (
    <Card role="region" aria-label={P.title} className="p-5 lg:p-6">
      <h2 className="text-promise uppercase">{P.title}</h2>
      <dl className="mt-4">
        <Param label={P.uMax} hint={P.uMaxHint}>
          {formatMoney(params.uMax)}
        </Param>
        <Param label={P.makerTtl}>{P.makerTtlValue(params.makerTtlSeconds)}</Param>
        <Param label={P.askMove}>{P.askMoveValue(params.askMoveTicks)}</Param>
        <Param label={P.tolerance}>{P.toleranceValue(params.toleranceTicks)}</Param>
        <Param label={P.forceTaker}>{P.forceTakerValue(params.forceTakerMinutes)}</Param>
      </dl>
    </Card>
  );
}
