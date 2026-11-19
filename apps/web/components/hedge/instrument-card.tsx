"use client";

import type { HedgeDeskResponse, HedgeInstrument } from "@winz/shared";
import { TriangleAlert } from "lucide-react";
import { useId } from "react";

import { AnimatedNumber } from "@/components/ui/animated-number";
import { Card } from "@/components/ui/card";
import { copy } from "@/lib/copy";
import { formatLongDateTime, formatTimeSeconds } from "@/lib/format";
import { formatBpsPercent } from "@/lib/hedge/format";

import { AnimatedMoney } from "./animated-figures";
import { BreakerPill } from "./breaker-pill";
import { ExposureBar } from "./exposure-bar";
import { FillsTable, OrdersTable } from "./order-tables";
import { UnhedgedMeter } from "./unhedged-meter";

const T = copy.hedgeDesk.instruments;

function Quote({ label, bps }: { label: string; bps: number | null }): React.JSX.Element {
  return (
    <div className="min-w-0 flex-1 rounded-card-sm bg-card-raised px-4 py-3">
      <p className="text-caption text-muted">{label}</p>
      <p className="mt-0.5 text-title text-text">
        {bps === null ? (
          <span aria-label={T.noBook}>–</span>
        ) : (
          <AnimatedNumber value={bps} format={formatBpsPercent} />
        )}
      </p>
    </div>
  );
}

/**
 * The book of one instrument: bid and ask as chances, and how fresh the reading is. A stale book
 * is the engine's reason to stop (the breaker names it), so it is written out and not only coloured.
 */
function BookReading({ instrument }: { instrument: HedgeInstrument }): React.JSX.Element {
  const { bidBps, askBps, bookAsOf, stale } = instrument;
  return (
    <div>
      <div className="flex gap-3">
        <Quote label={T.bid} bps={bidBps} />
        <Quote label={T.ask} bps={askBps} />
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
        {stale ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-danger">
            <TriangleAlert className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            {T.stale}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-text">
            <span aria-hidden="true" className="size-2 rounded-full bg-team-b" />
            {T.fresh}
          </span>
        )}
        <span className="figures">
          {bookAsOf === null ? T.noBookTime : T.bookAsOf(formatTimeSeconds(bookAsOf))}
        </span>
      </p>
    </div>
  );
}

/**
 * One instrument the engine covers: what it is, its book, E / H / W, the unhedged amount against
 * the limit, the circuit breaker, then the orders and the fills. On a laptop the figures sit on the
 * left and the two tables on the right; on a phone everything stacks.
 */
export function InstrumentCard({
  instrument,
  params,
  venueLabel,
}: {
  instrument: HedgeInstrument;
  params: HedgeDeskResponse["params"];
  /** Where these orders and fills happen, as the API words it: repeated on each card, so a card shown alone still says it. */
  venueLabel: string;
}): React.JSX.Element {
  const titleId = useId();
  return (
    <Card
      role="region"
      aria-labelledby={titleId}
      className="p-5 lg:p-6"
      data-instrument={instrument.symbol}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="mb-3 inline-flex rounded-full border border-stroke px-3 py-1 text-caption font-semibold text-text">
            {venueLabel}
          </p>
          <h3 id={titleId} className="text-promise uppercase">
            {instrument.eventTitle}
          </h3>
          <p className="mt-1 text-lead text-text">{instrument.label}</p>
          <p className="mt-1 text-caption text-muted">
            {T.starts(formatLongDateTime(instrument.startsAt))}
          </p>
          <p className="mt-1 break-all font-mono text-caption text-muted">{instrument.symbol}</p>
        </div>
        <BreakerPill breaker={instrument.breaker} />
      </header>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-6">
          <BookReading instrument={instrument} />
          <ExposureBar
            exposure={instrument.exposure}
            held={instrument.held}
            working={instrument.working}
          />
          <UnhedgedMeter unhedgedNotional={instrument.unhedgedNotional} uMax={params.uMax} />
          <div className="flex items-baseline justify-between gap-3 border-t border-white/10 pt-4">
            <p className="text-body text-muted">
              {T.makerSavings} <span className="text-caption">· {T.makerSavingsHint}</span>
            </p>
            <p className="text-lead font-semibold">
              <AnimatedMoney micro={instrument.makerSavings} />
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <OrdersTable orders={instrument.orders} />
          <FillsTable fills={instrument.fills} />
        </div>
      </div>
    </Card>
  );
}
