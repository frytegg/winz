"use client";

import { OUTCOMES, type DemoResultRequest, type Outcome } from "@winz/shared";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import type { JournalEntry } from "@/lib/admin/journal";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

import { ActionStatus } from "./action-status";
import { PanelCard } from "./panel-card";

const T = copy.admin.result;

/**
 * "Force the result": Yes, No or Void, each with what it means for the tickets, then a
 * confirmation that names the choice. Settling is the one action here that the demo cannot take
 * back once the engine has done it, so it takes two deliberate steps.
 */
export function ForceResultPanel({
  symbol,
  entry,
  busy,
  onSend,
}: {
  symbol: string;
  entry: JournalEntry | null;
  busy: boolean;
  onSend: (request: DemoResultRequest) => void;
}): React.JSX.Element {
  const [pending, setPending] = useState<Outcome | null>(null);
  const [missing, setMissing] = useState(false);
  const confirmRef = useRef<HTMLDivElement | null>(null);
  const chosen = symbol.trim();

  // The confirmation takes the focus, so the keyboard lands on the choice it names.
  useEffect(() => {
    if (pending !== null) confirmRef.current?.focus();
  }, [pending]);

  // The instrument changed under an open confirmation: it no longer names what will be settled.
  useEffect(() => {
    setPending(null);
  }, [chosen]);

  function choose(outcome: Outcome): void {
    if (chosen === "") {
      setMissing(true);
      return;
    }
    setMissing(false);
    setPending(outcome);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") setPending(null);
  }

  return (
    <PanelCard id="admin-result" title={T.title} lead={T.lead}>
      {pending === null ? (
        <div role="group" aria-label={T.title} className="grid gap-2 sm:grid-cols-3">
          {OUTCOMES.map((outcome) => (
            <button
              key={outcome}
              type="button"
              disabled={busy}
              onClick={() => choose(outcome)}
              className={cn(
                "flex min-h-20 flex-col items-start gap-1 rounded-card-sm bg-card-raised px-4 py-3 text-left",
                "transition-transform duration-150 ease-out active:scale-[0.98] disabled:opacity-50",
              )}
            >
              <span className="text-lead text-text">{T.options[outcome]}</span>
              <span className="text-caption text-muted">{T.hints[outcome]}</span>
            </button>
          ))}
        </div>
      ) : (
        <div
          ref={confirmRef}
          tabIndex={-1}
          role="group"
          aria-labelledby="admin-result-confirm"
          onKeyDown={onKeyDown}
          className="flex flex-col gap-4 rounded-card-sm bg-card-raised p-4 outline-none ring-1 ring-inset ring-lime"
        >
          <div>
            <p id="admin-result-confirm" className="text-lead text-text">
              {T.confirmTitle(T.options[pending])}
            </p>
            <p className="mt-1 text-caption text-muted [overflow-wrap:anywhere]">{chosen}</p>
            <p className="mt-2 text-body text-muted">{T.confirmBody}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="white"
              size="md"
              className="w-auto min-w-44"
              onClick={() => {
                onSend({ instrumentSymbol: chosen, outcome: pending });
                setPending(null);
              }}
            >
              {T.confirm(T.options[pending])}
            </Button>
            <Button
              variant="dark"
              size="md"
              arrow={false}
              className="w-auto min-w-32"
              onClick={() => setPending(null)}
            >
              {T.cancel}
            </Button>
          </div>
        </div>
      )}

      {missing && chosen === "" ? (
        <p role="alert" className="px-2 text-caption text-danger">
          {T.needInstrument}
        </p>
      ) : null}
      <ActionStatus entry={entry} sendingText={T.sending} />
    </PanelCard>
  );
}
