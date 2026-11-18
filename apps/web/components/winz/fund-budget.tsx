"use client";

import type { CreateCampaignResponse } from "@winz/shared";
import { CreditCard } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api/client";
import { isMockApi } from "@/lib/api/mock-scenario";
import { copy } from "@/lib/copy";
import { centsToMicro, formatMoneyCompact } from "@/lib/format";

export interface FundBudgetProps {
  /** What the merchant pays to fund the promo's coverage budget, in cents. */
  amountCents: number;
  /**
   * Creates the campaign (`POST /api/campaigns`) and returns its payment. The caller keeps the
   * answer, so a second tap after a refused payment pays the same campaign instead of creating
   * another one (DEMANDES-ALEXANDRE, item 4: the route is not idempotent).
   */
  createCampaign: () => Promise<CreateCampaignResponse>;
  /** The budget is paid and the campaign is on its way live. */
  onFunded: (campaignId: string) => void;
  disabled?: boolean;
}

/**
 * The two payment buttons of M7. In simulated mode there is no Stripe: one "Simulate payment"
 * button creates the campaign and moves on. The real Apple Pay and card flow (Stripe Elements) is
 * task U-04 and replaces the body of this component; its props stay the same.
 */
export function FundBudget({
  amountCents,
  createCampaign,
  onFunded,
  disabled = false,
}: FundBudgetProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const amount = formatMoneyCompact(centsToMicro(amountCents));

  async function simulate(): Promise<void> {
    // Locked from the first tap: a double tap must never create two campaigns.
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const created = await createCampaign();
      onFunded(created.campaignId);
    } catch (caught: unknown) {
      setError(errorMessage(caught, copy.common.genericError));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error === undefined ? null : (
        <p role="alert" className="px-2 text-center text-body text-danger">
          {error}
        </p>
      )}
      {isMockApi() ? (
        <Button variant="white" loading={busy} disabled={disabled} onClick={() => void simulate()}>
          {copy.review.simulatePaymentOf(amount)}
        </Button>
      ) : (
        <>
          <Button variant="white" disabled>
            {copy.review.fund(amount)}
          </Button>
          <Button
            variant="dark"
            disabled
            arrow={false}
            leading={<CreditCard className="size-5" strokeWidth={1.5} aria-hidden="true" />}
          >
            {copy.review.payWithCard}
          </Button>
          <p className="px-2 text-center text-caption text-muted">{copy.review.cardSoon}</p>
        </>
      )}
    </div>
  );
}
