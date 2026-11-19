"use client";

import { useMemo } from "react";

import { Card } from "@/components/ui/card";
import { Logo } from "@/components/ui/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadError } from "@/components/winz/load-error";
import { copy } from "@/lib/copy";
import { formatTimeSeconds } from "@/lib/format";
import { sortInstruments } from "@/lib/hedge/view";
import { useHedgeDesk } from "@/lib/hedge/use-hedge-desk";
import { cn } from "@/lib/utils";

import { EngineTotals, RiskParams } from "./desk-summary";
import { InstrumentCard } from "./instrument-card";
import { ProofBlock } from "./proof-block";
import { VenueBanner } from "./venue-banner";

const T = copy.hedgeDesk;

/**
 * "Live · Updated 11:10:04 PM". The dot pulses (2s) while readings keep coming. When a reading fails
 * the pill says "Offline" and gives the time of the last good one, so a frozen screen is never
 * mistaken for a quiet engine.
 */
function LiveStatus({
  updatedAt,
  connected,
}: {
  updatedAt: string | null;
  connected: boolean;
}): React.JSX.Element {
  const waiting = updatedAt === null;
  return (
    <p className="flex items-center gap-2.5 rounded-full bg-card px-4 py-2 text-caption text-muted">
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", connected ? "animate-pulse-dot bg-lime" : "bg-danger")}
      />
      <span className="font-semibold text-text">{connected ? T.live : T.offline}</span>
      <span className="figures">
        {connected
          ? waiting
            ? T.waiting
            : T.updatedAt(formatTimeSeconds(updatedAt))
          : waiting
            ? T.noReading
            : T.lastReading(formatTimeSeconds(updatedAt))}
      </span>
    </p>
  );
}

function DeskSkeleton(): React.JSX.Element {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-[116px] rounded-card" />
        <Skeleton className="h-[116px] rounded-card" />
        <Skeleton className="h-[116px] rounded-card" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-[236px] rounded-card" />
        <Skeleton className="h-[236px] rounded-card" />
      </div>
      <Skeleton className="h-[420px] rounded-card" />
    </div>
  );
}

/**
 * `/hedge-desk`: the engine shown to the jury (SPEC MDB-3, SCREENS "Hedge desk"). Public and
 * read-only, `GET /api/hedge-desk` read every 2 seconds. Built for a laptop on a projector, one
 * column that reads on a phone. Technical words are allowed here, and the execution venue is the
 * first thing on the page.
 */
export function HedgeDeskScreen(): React.JSX.Element {
  const desk = useHedgeDesk();
  const { data } = desk;
  const instruments = useMemo(
    () => (data === null ? [] : sortInstruments(data.instruments)),
    [data],
  );
  const connected = desk.error === null;

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-5 pb-16 pt-[calc(var(--safe-top)+1.25rem)] lg:gap-8 lg:px-8 lg:pt-8">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-4">
          <Logo />
          <div className="min-w-0">
            <h1 className="text-step uppercase">{T.title}</h1>
          </div>
        </div>
        <LiveStatus updatedAt={desk.updatedAt} connected={connected} />
      </header>

      <VenueBanner
        label={data?.venueLabel ?? null}
        note={data?.venueNote ?? null}
        unavailable={data === null && desk.error !== null}
      />

      {/* The pill says it in words; this is the same message for a screen reader, and it moves nothing. */}
      {data !== null && desk.error !== null ? (
        <p role="status" className="sr-only">
          {T.reconnecting}
        </p>
      ) : null}

      {data === null && desk.error !== null ? (
        <LoadError error={desk.error} onRetry={desk.reload} title={T.loadFailedTitle} />
      ) : data === null ? (
        <DeskSkeleton />
      ) : (
        <>
          <EngineTotals totals={data.totals} />
          <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
            <RiskParams params={data.params} />
            <ProofBlock venueCheck={data.venueCheck} />
          </div>

          <section aria-labelledby="desk-instruments" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <h2 id="desk-instruments" className="text-promise uppercase">
                {T.instruments.title}
              </h2>
              <p className="text-caption text-muted">{T.instruments.count(instruments.length)}</p>
            </div>
            {instruments.length === 0 ? (
              <Card tone="raised" diagonals className="px-6 py-10 text-center">
                <p className="mx-auto max-w-[24rem] text-lead">{T.instruments.emptyTitle}</p>
                <p className="mx-auto mt-2 max-w-[24rem] text-body text-muted">
                  {T.instruments.emptyBody}
                </p>
              </Card>
            ) : (
              instruments.map((instrument) => (
                <InstrumentCard
                  key={instrument.symbol}
                  instrument={instrument}
                  params={data.params}
                  venueLabel={data.venueLabel}
                />
              ))
            )}
          </section>
        </>
      )}
    </main>
  );
}
