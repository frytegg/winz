"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import type { JournalEntry } from "@/lib/admin/journal";
import { copy } from "@/lib/copy";

import { ActionStatus } from "./action-status";
import { PanelCard } from "./panel-card";

const T = copy.admin.resetPanel;

/** "Reset demo": drops every driven book and forced result, after one confirmation. */
export function ResetPanel({
  entry,
  busy,
  onSend,
}: {
  entry: JournalEntry | null;
  busy: boolean;
  onSend: () => void;
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") setConfirming(false);
  }

  return (
    <PanelCard id="admin-reset" title={T.title} lead={T.lead}>
      {confirming ? (
        <div
          ref={confirmRef}
          tabIndex={-1}
          role="group"
          aria-labelledby="admin-reset-confirm"
          onKeyDown={onKeyDown}
          className="flex flex-col gap-4 rounded-card-sm bg-card-raised p-4 outline-none ring-1 ring-inset ring-lime"
        >
          <p id="admin-reset-confirm" className="text-lead text-text">
            {T.confirmTitle}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="white"
              size="md"
              className="w-auto min-w-36"
              onClick={() => {
                onSend();
                setConfirming(false);
              }}
            >
              {T.confirm}
            </Button>
            <Button
              variant="dark"
              size="md"
              arrow={false}
              className="w-auto min-w-32"
              onClick={() => setConfirming(false)}
            >
              {T.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="dark" size="md" loading={busy} onClick={() => setConfirming(true)}>
          {busy ? T.sending : T.button}
        </Button>
      )}
      <ActionStatus entry={entry} sendingText={T.sending} />
    </PanelCard>
  );
}
