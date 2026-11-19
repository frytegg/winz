"use client";

import type { PublicCampaign } from "@winz/shared";
import { CreditCard } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Diagonals } from "@/components/ui/diagonals";
import { Sheet } from "@/components/ui/sheet";
import { isAbortError } from "@/lib/api/client";
import { isMockApi } from "@/lib/api/mock-scenario";
import { copy } from "@/lib/copy";
import { totalMicro } from "@/lib/fan/amount";
import { runCheckout, type Authorize, type CheckoutOutcome } from "@/lib/fan/checkout-flow";
import { formatMoney } from "@/lib/format";

import { Money } from "./money";
import { CardForm, StripeElements, WalletButton, type PayHandle } from "./stripe-payment";

/** In the simulated mode there is no card to authorize: a short pause stands in for it. */
const SIMULATED_AUTHORIZATION_MS = 500;
/** After this many seconds of waiting, the screen says it is still working. */
const SLOW_AFTER_SECONDS = 12;

export type PayMethod = "apple-pay" | "card";

export interface CheckoutSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Pick<PublicCampaign, "slug" | "product" | "unitPrice" | "merchant">;
  qty: number;
  /** Which of the two buttons of C1 opened the sheet. */
  method: PayMethod;
  /** The promo can still sell. It can pause while the sheet is open: the pay button then locks. */
  canPay: boolean;
}

type Stage =
  | { kind: "review"; error?: string }
  | { kind: "paying" }
  | { kind: "securing"; slow: boolean }
  | { kind: "ended"; outcome: Extract<CheckoutOutcome, { kind: "cancelled" | "failed" }> };

const simulatedAuthorize: Authorize = () =>
  new Promise((resolve) => {
    setTimeout(() => resolve({ ok: true }), SIMULATED_AUTHORIZATION_MS);
  });

/**
 * The payment area of the sheet. Simulated mode: one "Simulate payment" button. Live: Stripe's
 * Express Checkout Element (Apple Pay, Google Pay, with `emailRequired`) when the first button of
 * C1 opened the sheet and a wallet exists on this device, otherwise the card form (Payment Element
 * and the e-mail field). The amount and `captureMethod: "manual"` are those of the PaymentIntent the
 * back end creates, so the card is authorized, not charged.
 */
function PaymentArea({
  amountCents,
  amount,
  method,
  busy,
  locked,
  onPay,
}: {
  amountCents: number;
  amount: string;
  method: PayMethod;
  busy: boolean;
  locked: boolean;
  onPay: (handle: PayHandle | null) => void;
}): React.JSX.Element {
  const [view, setView] = useState<"express" | "card">(method === "apple-pay" ? "express" : "card");
  const [noWallet, setNoWallet] = useState(false);
  const walletUnavailable = useCallback(() => {
    setNoWallet(true);
    setView("card");
  }, []);

  if (isMockApi()) {
    return (
      <Button variant="white" loading={busy} disabled={locked} onClick={() => onPay(null)}>
        {copy.checkout.simulatePaymentOf(amount)}
      </Button>
    );
  }
  return (
    <StripeElements amountCents={amountCents} captureMethod="manual">
      <div className="flex flex-col gap-3">
        {view === "express" ? (
          <>
            <WalletButton
              askEmail
              locked={locked || busy}
              onPay={onPay}
              onUnavailable={walletUnavailable}
            />
            <Button
              variant="dark"
              arrow={false}
              disabled={locked || busy}
              leading={<CreditCard className="size-5" strokeWidth={1.5} aria-hidden="true" />}
              onClick={() => setView("card")}
            >
              {copy.campaign.payWithCard}
            </Button>
          </>
        ) : (
          <>
            {noWallet ? (
              <p className="text-center text-caption text-muted">{copy.checkout.noWallet}</p>
            ) : null}
            <CardForm
              askEmail
              payLabel={copy.checkout.payAmount(amount)}
              busy={busy}
              locked={locked}
              onPay={onPay}
            />
          </>
        )}
      </div>
    </StripeElements>
  );
}

/** The ticket coming out of the printer slot: what "Securing your promo…" looks like. */
function PrintingTicket({ merchant, line }: { merchant: string; line: string }): React.JSX.Element {
  return (
    <div
      className="flex w-56 flex-col items-center"
      role="img"
      aria-label={copy.checkout.ticketPrinting}
    >
      <div className="relative z-10 h-2.5 w-full rounded-full bg-card-raised" />
      <div className="-mt-1.5 h-52 w-[13.25rem] overflow-hidden">
        <div className="animate-print rounded-b-card-sm bg-card p-4 pt-6 text-left">
          <p className="truncate text-lead">{merchant}</p>
          <p className="mt-0.5 truncate text-caption text-muted">{line}</p>
          <div aria-hidden="true" className="my-4 border-t border-dashed border-white/20" />
          <div aria-hidden="true" className="flex items-center gap-3">
            <span className="size-12 shrink-0 rounded-full border-[5px] border-card-raised border-t-lime" />
            <span className="flex-1 space-y-2">
              <span className="block h-2 rounded-full bg-card-raised" />
              <span className="block h-2 w-2/3 rounded-full bg-card-raised" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The wait and its endings take the whole screen. A modal `<dialog>`, like the sheet: the page behind
 * is inert, focus moves in, and Escape does not close it (a purchase is in flight, there is nothing
 * to dismiss).
 */
function FullScreen({
  titleId,
  children,
}: {
  titleId: string;
  children: ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => event.preventDefault()}
      className="m-0 size-full max-h-none max-w-none border-0 bg-ink-deep p-0 text-text outline-none backdrop:bg-ink-deep"
    >
      <div className="mx-auto flex min-h-full w-full max-w-[430px] justify-center">
        <div className="relative flex w-full animate-screen-in flex-col items-center justify-center gap-8 overflow-hidden bg-ink px-6 pb-[calc(var(--safe-bottom)+1.5rem)] pt-[calc(var(--safe-top)+1.5rem)] text-center">
          <Diagonals className="opacity-80" />
          {children}
        </div>
      </div>
    </dialog>
  );
}

/**
 * C2: the payment sheet over C1, and the full-screen wait that follows. Quantity and total, the pay
 * button, then "Securing your promo…" (2 to 8 seconds) until the ticket exists and `/t/<token>`
 * opens. A promo that paused in between, or a payment that did not go through, ends on a screen of
 * its own with the API's message, as it comes, and a way back. Nothing is charged in either case.
 */
export function CheckoutSheet({
  open,
  onOpenChange,
  campaign,
  qty,
  method,
  canPay,
}: CheckoutSheetProps): React.JSX.Element {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "review" });
  const controller = useRef<AbortController | null>(null);
  // A second tap in the same instant must not start a second purchase: state alone is a render late.
  const inFlight = useRef(false);
  const titleId = useId();
  const total = totalMicro(campaign.unitPrice, qty);

  // Leaving the page stops the polling.
  useEffect(() => () => controller.current?.abort(), []);

  const pay = useCallback(
    async (handle: PayHandle | null): Promise<void> => {
      // Locked from the first tap: a second tap must never start a second purchase.
      if (inFlight.current || stage.kind !== "review") return;
      inFlight.current = true;
      setStage({ kind: "paying" });
      const abort = new AbortController();
      controller.current = abort;
      let secured = false;
      try {
        const outcome = await runCheckout({
          slug: campaign.slug,
          qty,
          validate: handle === null ? undefined : handle.submit,
          authorize:
            handle === null
              ? simulatedAuthorize
              : (checkout) => handle.confirm(checkout.clientSecret),
          signal: abort.signal,
          onSecuring: () => {
            secured = true;
            onOpenChange(false);
            setStage({ kind: "securing", slow: false });
          },
          onWaiting: (seconds) =>
            setStage((current) =>
              current.kind === "securing"
                ? { kind: "securing", slow: seconds >= SLOW_AFTER_SECONDS }
                : current,
            ),
        });
        if (outcome.kind === "ticketed") {
          // Stays locked: the page is about to change.
          router.push(`/t/${encodeURIComponent(outcome.token)}`);
          return;
        }
        inFlight.current = false;
        if (outcome.kind === "refused" || (outcome.kind === "failed" && !secured)) {
          // A wallet's own sheet may still be open: it shows the failure too.
          handle?.fail();
          setStage({ kind: "review", error: outcome.message });
        } else {
          setStage({ kind: "ended", outcome });
        }
      } catch (error: unknown) {
        inFlight.current = false;
        handle?.fail();
        if (!isAbortError(error)) setStage({ kind: "review", error: copy.common.genericError });
      }
    },
    [stage.kind, campaign.slug, qty, onOpenChange, router],
  );

  const backToReview = useCallback((): void => setStage({ kind: "review" }), []);
  const amount = formatMoney(total);
  const showScreen = stage.kind === "securing" || stage.kind === "ended";

  return (
    <>
      <Sheet
        open={open && !showScreen}
        onOpenChange={(next) => {
          // The sheet also reports the close we ask for when the wait screen takes over: ignore it.
          if (stage.kind !== "review" && stage.kind !== "paying") return;
          onOpenChange(next);
          if (!next && stage.kind === "review") setStage({ kind: "review" });
        }}
        title={copy.checkout.title}
      >
        <div className="flex flex-col gap-5">
          <div className="rounded-card-sm bg-card-raised p-4">
            <p className="truncate text-lead">{campaign.merchant.name}</p>
            <div className="mt-3 flex items-end justify-between gap-4">
              <p className="min-w-0 text-body text-muted">
                {copy.checkout.lineItem(campaign.product, qty)}
              </p>
              <p className="flex shrink-0 flex-col items-end">
                <span className="text-micro uppercase text-muted">{copy.checkout.total}</span>
                <Money micro={total} className="text-figure-sm" />
              </p>
            </div>
          </div>

          {stage.kind === "review" && stage.error !== undefined ? (
            <p role="alert" className="text-center text-body text-danger">
              {stage.error}
            </p>
          ) : null}
          {!canPay && !(stage.kind === "review" && stage.error !== undefined) ? (
            <p role="status" className="text-center text-body text-muted">
              {copy.campaign.paused}
            </p>
          ) : null}

          <PaymentArea
            amountCents={Number(total / 10_000n)}
            amount={amount}
            method={method}
            busy={stage.kind === "paying"}
            locked={!canPay}
            onPay={(handle) => void pay(handle)}
          />
          <p className="text-center text-caption text-muted">{copy.checkout.chargedWhenReady}</p>
        </div>
      </Sheet>

      {showScreen ? (
        <FullScreen titleId={titleId}>
          {stage.kind === "securing" ? (
            <div className="relative flex flex-col items-center gap-8">
              <PrintingTicket
                merchant={campaign.merchant.name}
                line={copy.checkout.lineItem(campaign.product, qty)}
              />
              <div role="status" className="flex flex-col items-center gap-2">
                <h2 id={titleId} className="text-promise">
                  {copy.checkout.securing}
                </h2>
                <p className="text-body text-muted">
                  {stage.slow ? copy.checkout.securingSlow : copy.checkout.securingBody}
                </p>
              </div>
            </div>
          ) : stage.kind === "ended" ? (
            <div role="alert" className="relative flex w-full flex-col items-center gap-6">
              <h2 id={titleId} className="text-promise">
                {stage.outcome.message}
              </h2>
              <div className="flex w-full flex-col gap-3">
                {stage.outcome.kind === "failed" ? (
                  <Button
                    onClick={() => {
                      backToReview();
                      onOpenChange(true);
                    }}
                  >
                    {copy.common.tryAgain}
                  </Button>
                ) : null}
                <Button
                  variant={stage.outcome.kind === "failed" ? "dark" : "primary"}
                  onClick={backToReview}
                >
                  {copy.checkout.backToPromo}
                </Button>
              </div>
            </div>
          ) : null}
        </FullScreen>
      ) : null}
    </>
  );
}
