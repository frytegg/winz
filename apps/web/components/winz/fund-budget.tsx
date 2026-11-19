"use client";

import { CreditCard } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/client";
import { isMockApi } from "@/lib/api/mock-scenario";
import { copy } from "@/lib/copy";
import { centsToMicro, formatMoneyCompact } from "@/lib/format";
import { useHydrated } from "@/lib/hooks";
import type { FundingPlan } from "@/lib/merchant/funding";

import { CardForm, StripeElements, WalletButton, type PayHandle } from "./stripe-payment";

export interface FundBudgetProps {
  /** What the merchant pays to fund the promo's coverage budget, in cents. */
  amountCents: number;
  /**
   * Asks the back end for the campaign (or the top-up) and its payment: `POST /api/campaigns` with a
   * `requestId`. Called again at every attempt, never cached: the same `requestId` answers the same
   * payment, or a new one when Stripe cancelled the first, and only the last answer can be paid.
   */
  prepare: () => Promise<FundingPlan>;
  /** The budget is paid (or there was nothing left to pay) and the campaign is on its way live. */
  onFunded: (campaignId: string) => void;
  disabled?: boolean;
}

/**
 * The payment buttons of M7 and of "Add budget". Simulated mode has no Stripe: one "Simulate
 * payment" button asks for the campaign and moves on.
 *
 * Live, the order is Stripe's for a payment whose amount is known before the payment exists:
 * the form is validated (`elements.submit()`), the back end creates the campaign and its payment
 * (`prepare`), then Stripe pays it. The budget is paid at once (`captureMethod: "automatic"`, unlike
 * a fan's purchase); the engine puts the campaign live when Stripe's webhook says it is paid.
 */
export function FundBudget(props: FundBudgetProps): React.JSX.Element {
  const hydrated = useHydrated();
  if (isMockApi()) return <SimulatedFund {...props} />;
  // Stripe lives in the browser: the server renders only the place where it will be.
  if (!hydrated) return <Skeleton className="h-14 rounded-full" />;
  return (
    <StripeElements amountCents={props.amountCents} captureMethod="automatic">
      <LiveFund {...props} />
    </StripeElements>
  );
}

function ErrorLine({ message }: { message: string | undefined }): React.JSX.Element | null {
  return message === undefined ? null : (
    <p role="alert" className="px-2 text-center text-body text-danger">
      {message}
    </p>
  );
}

function SimulatedFund({
  amountCents,
  prepare,
  onFunded,
  disabled = false,
}: FundBudgetProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const amount = formatMoneyCompact(centsToMicro(amountCents));

  async function simulate(): Promise<void> {
    // Locked from the first tap: a double tap is one request.
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const plan = await prepare();
      onFunded(plan.campaignId);
    } catch (caught: unknown) {
      setError(errorMessage(caught, copy.common.genericError));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ErrorLine message={error} />
      <Button variant="white" loading={busy} disabled={disabled} onClick={() => void simulate()}>
        {copy.review.simulatePaymentOf(amount)}
      </Button>
    </div>
  );
}

function LiveFund({
  amountCents,
  prepare,
  onFunded,
  disabled = false,
}: FundBudgetProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [cardOpen, setCardOpen] = useState(false);
  const [wallet, setWallet] = useState(true);
  // A second tap in the same instant: state alone is a render late.
  const inFlight = useRef(false);
  const amount = formatMoneyCompact(centsToMicro(amountCents));
  const walletUnavailable = useCallback(() => setWallet(false), []);

  async function pay(handle: PayHandle): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    let funded = false;
    try {
      const valid = await handle.submit();
      if (!valid.ok) throw new PaymentRefused(valid.message);
      const plan = await prepare();
      if (plan.payment !== null) {
        const paid = await handle.confirm(plan.payment.clientSecret);
        if (!paid.ok) throw new PaymentRefused(paid.message);
      }
      funded = true;
      setCardOpen(false);
      onFunded(plan.campaignId);
    } catch (caught: unknown) {
      handle.fail();
      setError(
        caught instanceof PaymentRefused
          ? caught.message
          : errorMessage(caught, copy.common.genericError),
      );
    } finally {
      // After a payment the screen is about to change: stay locked.
      if (!funded) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  const locked = disabled || busy;
  return (
    <div className="flex flex-col gap-3">
      <ErrorLine message={error} />
      <WalletButton
        askEmail={false}
        locked={locked}
        onPay={(handle) => void pay(handle)}
        onUnavailable={walletUnavailable}
      />
      <Button
        variant={wallet ? "dark" : "white"}
        loading={busy && !cardOpen}
        disabled={locked}
        arrow={!wallet}
        leading={
          wallet ? (
            <CreditCard className="size-5" strokeWidth={1.5} aria-hidden="true" />
          ) : undefined
        }
        onClick={() => setCardOpen(true)}
      >
        {wallet ? copy.review.payWithCard : copy.review.fundWithCard(amount)}
      </Button>
      <Sheet
        open={cardOpen}
        onOpenChange={(next) => {
          if (!busy) setCardOpen(next);
        }}
        title={copy.review.cardTitle}
      >
        {cardOpen ? (
          <div className="flex flex-col gap-4">
            <ErrorLine message={error} />
            <CardForm
              askEmail={false}
              payLabel={copy.review.fundAmount(amount)}
              busy={busy}
              locked={disabled}
              onPay={(handle) => void pay(handle)}
            />
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

/** A refusal Stripe worded itself (a card number that is not complete, a declined card). */
class PaymentRefused extends Error {}
