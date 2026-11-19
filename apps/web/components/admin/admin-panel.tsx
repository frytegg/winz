"use client";

import { ExternalLink, Lock } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { latestOf } from "@/lib/admin/journal";
import { useAdminActions } from "@/lib/admin/use-admin-actions";
import { copy } from "@/lib/copy";
import { sortInstruments } from "@/lib/hedge/view";
import { useHedgeDesk } from "@/lib/hedge/use-hedge-desk";

import { ActionLog } from "./action-log";
import { DriveOddsPanel } from "./drive-odds-panel";
import { ForceResultPanel } from "./force-result-panel";
import { InstrumentPicker } from "./instrument-picker";
import { ReplaySalePanel } from "./replay-sale-panel";
import { ResetPanel } from "./reset-panel";

const T = copy.admin;

/**
 * The execution venue, exactly as the API words it. It is read from `GET /api/hedge-desk`
 * (`venueLabel`) and never typed here: a desk running on the live exchange must not say "PAPER"
 * because this page assumed it. Until the desk answers, the pill says so.
 */
function VenuePill({ label }: { label: string | null }): React.JSX.Element {
  return (
    <p className="inline-flex min-h-9 items-center gap-2 rounded-full bg-lime px-4 text-label font-semibold text-ink">
      <span className="font-normal opacity-70">{T.venueTitle}</span>
      <span>{label ?? T.venueUnknown}</span>
    </p>
  );
}

/** The panel itself, shown once a key is held: the instrument, the four actions and their log. */
export function AdminPanel({ onLock }: { onLock: () => void }): React.JSX.Element {
  const desk = useHedgeDesk();
  const actions = useAdminActions();
  const [symbol, setSymbol] = useState("");

  const instruments = useMemo(
    () => (desk.data === null ? [] : sortInstruments(desk.data.instruments)),
    [desk.data],
  );
  const onDesk = instruments.find((instrument) => instrument.symbol === symbol.trim()) ?? null;
  const { entries } = actions;

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-5 pb-16 pt-[calc(var(--safe-top)+1.25rem)] lg:gap-8 lg:px-8 lg:pt-8">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3">
          <Logo />
          <div className="min-w-0">
            <h1 className="text-step uppercase">{T.title}</h1>
            <p className="max-w-[52ch] text-body text-muted">{T.lead}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <VenuePill label={desk.data?.venueLabel ?? null} />
          <Link
            href="/hedge-desk"
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-body text-muted hover:text-text"
          >
            {T.openDesk}
            <ExternalLink className="size-4" strokeWidth={1.5} aria-hidden="true" />
          </Link>
          <Button
            variant="dark"
            size="md"
            arrow={false}
            className="w-auto min-w-28"
            leading={<Lock className="size-4" strokeWidth={1.5} aria-hidden="true" />}
            onClick={onLock}
          >
            {T.lock}
          </Button>
        </div>
      </header>

      <InstrumentPicker
        instruments={instruments}
        loading={desk.loading}
        failed={desk.error !== null}
        symbol={symbol}
        onChange={setSymbol}
      />

      <div className="grid items-start gap-6 lg:grid-cols-2 lg:gap-8">
        <DriveOddsPanel
          symbol={symbol}
          desk={onDesk}
          entry={latestOf(entries, "book")}
          busy={actions.busy.book}
          onSend={actions.sendBook}
        />
        <ForceResultPanel
          symbol={symbol}
          entry={latestOf(entries, "result")}
          busy={actions.busy.result}
          onSend={actions.sendResult}
        />
        <ReplaySalePanel
          entry={latestOf(entries, "sale")}
          busy={actions.busy.sale}
          onSend={actions.sendSale}
        />
        <ResetPanel
          entry={latestOf(entries, "reset")}
          busy={actions.busy.reset}
          onSend={actions.sendReset}
        />
      </div>

      <ActionLog entries={entries} />
    </main>
  );
}
