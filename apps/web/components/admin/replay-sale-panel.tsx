"use client";

import type { DemoSaleRequest } from "@winz/shared";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { QtyStepper } from "@/components/ui/qty-stepper";
import type { JournalEntry } from "@/lib/admin/journal";
import { checkSale, type SaleField } from "@/lib/admin/sale";
import { copy } from "@/lib/copy";

import { ActionStatus } from "./action-status";
import { PanelCard } from "./panel-card";

const T = copy.admin.sale;

/**
 * "Replay a sale": a purchase without a card. Every send is a new sale, so the button stays locked
 * from the tap until the sale has ended (a ticket, a refusal or a timeout), and the fields keep
 * their values to make the next one quick.
 */
export function ReplaySalePanel({
  entry,
  busy,
  onSend,
}: {
  entry: JournalEntry | null;
  busy: boolean;
  onSend: (request: DemoSaleRequest) => void;
}): React.JSX.Element {
  const [slug, setSlug] = useState("");
  const [qty, setQty] = useState(1);
  const [email, setEmail] = useState("");
  const [attempted, setAttempted] = useState(false);

  const check = checkSale({ slug, qty, email });
  const errors: Partial<Record<SaleField, string>> = attempted && !check.ok ? check.errors : {};

  return (
    <PanelCard id="admin-sale" title={T.title} lead={T.lead}>
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
          if (check.ok && !busy) onSend(check.request);
        }}
      >
        <Field
          label={T.slugLabel}
          hint={T.slugHint}
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          error={errors.slug}
          placeholder={T.slugPlaceholder}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <div className="flex flex-col gap-2">
          <span className="text-label uppercase text-text">{T.qtyLabel}</span>
          <QtyStepper
            value={qty}
            onChange={setQty}
            min={1}
            max={20}
            label={T.qtyLabel}
            disabled={busy}
            className="w-fit"
          />
        </div>
        <Field
          label={T.emailLabel}
          hint={T.emailHint}
          type="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors.email}
          placeholder="fan@example.com"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <Button type="submit" variant="white" size="md" loading={busy}>
          {busy ? T.sending : T.submit}
        </Button>
      </form>

      {busy && entry?.status === "sending" ? (
        <p className="px-1 text-caption text-muted">{T.waiting}</p>
      ) : null}
      <ActionStatus entry={entry} sendingText={T.sending} />
    </PanelCard>
  );
}
