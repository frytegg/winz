"use client";

import type { DemoBookRequest, HedgeInstrument } from "@winz/shared";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import {
  DEFAULT_DEPTH,
  ODDS_PRESETS,
  bpsToPercentText,
  checkBook,
  presetPrices,
  type BookField,
} from "@/lib/admin/book";
import type { JournalEntry } from "@/lib/admin/journal";
import { copy } from "@/lib/copy";

import { ActionStatus } from "./action-status";
import { PanelCard } from "./panel-card";

const T = copy.admin.drive;

/**
 * "Drive the odds": sets the bid, the ask and the depth of the chosen instrument's book. The
 * request is checked here with the server's rules before it leaves. "Book saved" appears only with
 * the server's answer; what the engine actually reads is shown from the hedge desk, which the
 * screen already polls, so the person sees the book move rather than taking it on trust.
 */
export function DriveOddsPanel({
  symbol,
  desk,
  entry,
  busy,
  onSend,
}: {
  symbol: string;
  /** The instrument as the desk reads it now, or `null` when the desk does not list it. */
  desk: HedgeInstrument | null;
  entry: JournalEntry | null;
  busy: boolean;
  onSend: (request: DemoBookRequest) => void;
}): React.JSX.Element {
  const [bid, setBid] = useState("");
  const [ask, setAsk] = useState("");
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const [attempted, setAttempted] = useState(false);

  const check = checkBook({ symbol, bid, ask, depth });
  const errors: Partial<Record<BookField, string>> = attempted && !check.ok ? check.errors : {};

  function applyPreset(chance: number): void {
    const prices = presetPrices(chance);
    setBid(prices.bid);
    setAsk(prices.ask);
  }

  return (
    <PanelCard id="admin-drive" title={T.title} lead={T.lead}>
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
          if (check.ok && !busy) onSend(check.request);
        }}
      >
        <div className="flex flex-col gap-2">
          <p id="admin-presets" className="text-label uppercase text-text">
            {T.presetsLabel}
          </p>
          <div role="group" aria-labelledby="admin-presets" className="flex flex-wrap gap-2">
            {ODDS_PRESETS.map((preset) => {
              const prices = presetPrices(preset.chance);
              return (
                <Chip
                  key={preset.chance}
                  label={preset.label}
                  onClick={() => applyPreset(preset.chance)}
                  active={bid === prices.bid && ask === prices.ask}
                />
              );
            })}
          </div>
          <p className="px-1 text-caption text-muted">
            {T.presetsHint} {T.pauseHint}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label={T.bidLabel}
            inputMode="numeric"
            autoComplete="off"
            value={bid}
            onChange={(event) => setBid(event.target.value)}
            error={errors.bid}
            placeholder="11"
          />
          <Field
            label={T.askLabel}
            inputMode="numeric"
            autoComplete="off"
            value={ask}
            onChange={(event) => setAsk(event.target.value)}
            error={errors.ask}
            placeholder="13"
          />
        </div>
        <Field
          label={T.depthLabel}
          hint={T.depthHint}
          inputMode="decimal"
          autoComplete="off"
          value={depth}
          onChange={(event) => setDepth(event.target.value)}
          error={errors.depth}
        />

        {errors.symbol === undefined ? null : (
          <p role="alert" className="px-2 text-caption text-danger">
            {errors.symbol}
          </p>
        )}

        <Button type="submit" variant="white" size="md" loading={busy}>
          {busy ? T.sending : T.submit}
        </Button>
      </form>

      <ActionStatus entry={entry} sendingText={T.sending} />
      {entry?.status === "done" && desk !== null ? (
        <p className="figures px-1 text-caption text-muted" role="status">
          {T.onDesk}:{" "}
          {copy.admin.instrument.bidAsk(
            bpsToPercentText(desk.bidBps),
            bpsToPercentText(desk.askBps),
          )}
        </p>
      ) : null}
    </PanelCard>
  );
}
