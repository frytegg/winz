"use client";

import { useRef, useState } from "react";

import { Chip } from "@/components/ui/chip";
import { Sheet } from "@/components/ui/sheet";
import { Stepper } from "@/components/ui/stepper";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { copy } from "@/lib/copy";
import { RequestIds, planFromTopUp, sendRenewingOnce } from "@/lib/merchant/funding";
import {
  MAX_CARD_AMOUNT_CENTS,
  MIN_CARD_AMOUNT_CENTS,
  centsToMicro,
  formatCentsPlain,
  microToWire,
  parseDollarsToCents,
} from "@/lib/format";

import { FundBudget } from "./fund-budget";

const DEFAULT_CENTS = 50_000;
const STEP_CENTS = 5_000;
const QUICK_CENTS = [10_000, 25_000, 50_000, 100_000] as const;

/**
 * "Add budget" (CA-6): the merchant tops up the coverage budget of a running promo. The payment
 * buttons are the same `<FundBudget>` as M7 (Stripe replaces their body in U-04), so the top-up and
 * the first budget pay the same way.
 *
 * `requestId` is chosen once per top-up and kept for its retries: a second tap after a refused
 * payment, or after a dropped connection, asks for the same payment instead of creating another.
 * Changing the amount is a new top-up, so it gets a new `requestId`. It is kept in the tab's
 * storage, per promo, so a reload asks for the same top-up. A card refused at Stripe ends the
 * top-up (its repeat answers 409 "This top-up request is over"): the same tap then sends a new one.
 */
export function TopUpSheet({
  open,
  onOpenChange,
  campaignId,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  /** The top-up went through: the screen reads the campaign again. */
  onAdded: () => void;
}): React.JSX.Element {
  const toast = useToast();
  const [cents, setCents] = useState(DEFAULT_CENTS);
  const requestIds = useRef(new RequestIds(`winz.top-up-request.${campaignId}`));

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={copy.campaignDetail.addBudgetTitle}
      description={copy.campaignDetail.addBudgetBody}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <Stepper
            label={copy.campaignDetail.addBudgetAmount}
            prefix="$"
            value={cents}
            step={STEP_CENTS}
            min={MIN_CARD_AMOUNT_CENTS}
            max={MAX_CARD_AMOUNT_CENTS}
            format={formatCentsPlain}
            parse={parseDollarsToCents}
            onChange={setCents}
          />
          <div role="group" aria-label={copy.campaignDetail.addBudgetQuick} className="flex gap-2">
            {QUICK_CENTS.map((value) => (
              <Chip
                key={value}
                label={`$${(value / 100).toLocaleString("en-US")}`}
                active={cents === value}
                onClick={() => setCents(value)}
              />
            ))}
          </div>
        </div>
        <FundBudget
          amountCents={cents}
          prepare={async () => {
            // The same amount keeps its `requestId`; another amount is another top-up.
            const response = await sendRenewingOnce(
              requestIds.current,
              cents.toString(),
              (requestId) =>
                apiFetch("topUpCampaign", {
                  params: { id: campaignId },
                  body: { amount: microToWire(centsToMicro(cents)), requestId },
                }),
            );
            return planFromTopUp(response);
          }}
          onFunded={() => {
            requestIds.current.renew();
            toast.show(copy.campaignDetail.addBudgetDone);
            onOpenChange(false);
            onAdded();
          }}
        />
      </div>
    </Sheet>
  );
}
