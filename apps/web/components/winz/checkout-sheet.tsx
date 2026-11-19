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
import {
  createCheckoutMemory,
  resumeCheckout,
  runCheckout,
  type Authorize,
  type CheckoutOutcome,
} from "@/lib/fan/checkout-flow";
import type { ExpressPay } from "@/lib/fan/express-pay";
import {
  STRIPE_RETURN_PARAMS,
  beforePaying,
  forgetPurchase,
  pendingPurchase,
  purchaseToResume,
  rememberPurchase,
  type PendingPurchase,
} from "@/lib/fan/pending-purchase";
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
  /** Why the pay button is locked, when it is: paused (the default), closed, or unreachable. */
  lockedMessage?: string;
  /** The express payment C1 named, for the message shown when it is not available after all. */
  express?: ExpressPay;
}

type Stage =
  | { kind: "review"; error?: string }
  | { kind: "paying" }
  | { kind: "securing"; slow: boolean }
  /** The wait reached its bound (WAIT_LIMIT_SECONDS): the card is authorized, the ticket not there yet. */
  | { kind: "unresolved" }
  | { kind: "ended"; outcome: Extract<CheckoutOutcome, { kind: "cancelled" | "failed" }> };

/** How following a kept purchase ended for a tap on Pay: `free` lets a new purchase start. */
type Followed = "free" | "taken";

/** Offline, the simulated authorization fails as Stripe would: no answer from the card. */
const simulatedAuthorize: Authorize = () =>
  new Promise((resolve) => {
    setTimeout(
      () =>
        resolve(navigator.onLine ? { ok: true } : { ok: false, message: copy.common.networkError }),
      SIMULATED_AUTHORIZATION_MS,
    );
  });

/** Back to the promo from a wait that has nothing more to show; any other stage stays. */
function leaveWait(current: Stage): Stage {
  return current.kind === "securing" ? { kind: "review" } : current;
}

/** Stripe's parameters on the address of a page it sent a payer back to, removed once read. */
function dropStripeReturnParams(): void {
  const url = new URL(window.location.href);
  if (!STRIPE_RETURN_PARAMS.some((name) => url.searchParams.has(name))) return;
  for (const name of STRIPE_RETURN_PARAMS) url.searchParams.delete(name);
  window.history.replaceState(window.history.state, "", url);
}

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
  express,
  busy,
  locked,
  onPay,
}: {
  amountCents: number;
  amount: string;
  method: PayMethod;
  express: ExpressPay | undefined;
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
              <p className="text-center text-caption text-muted">
                {express === "google" ? copy.checkout.noGooglePay : copy.checkout.noWallet}
              </p>
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
  lockedMessage = copy.campaign.paused,
  express,
}: CheckoutSheetProps): React.JSX.Element {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "review" });
  const controller = useRef<AbortController | null>(null);
  // A second tap in the same instant must not start a second purchase: state alone is a render late.
  const inFlight = useRef(false);
  // The payment of an earlier attempt, paid again by the next one (review 1.2).
  const [memory] = useState(createCheckoutMemory);
  // The purchase picked up when the page opened (review 2.1), and the one « Check again » follows.
  const resuming = useRef<AbortController | null>(null);
  const following = useRef<string | null>(null);
  // The follow-up in progress, which a tap on Pay waits for instead of paying again.
  const pickup = useRef<{ paymentIntentId: string; done: Promise<Followed> } | null>(null);
  // The purchase this browser keeps for the promo, held here too for a storage that throws.
  const known = useRef<PendingPurchase | null>(null);
  // An authorized purchase of this promo is still on its way: the sheet says so.
  const [onItsWay, setOnItsWay] = useState(false);
  const titleId = useId();
  const total = totalMicro(campaign.unitPrice, qty);
  const { slug } = campaign;

  // Leaving the page stops the polling.
  useEffect(
    () => () => {
      controller.current?.abort();
      resuming.current?.abort();
    },
    [],
  );

  const remember = useCallback(
    (purchase: PendingPurchase): void => {
      known.current = purchase;
      rememberPurchase(slug, purchase);
    },
    [slug],
  );
  const forget = useCallback(
    (paymentIntentId: string): void => {
      if (known.current?.paymentIntentId === paymentIntentId) known.current = null;
      forgetPurchase(slug, paymentIntentId);
    },
    [slug],
  );

  /**
   * Follows a purchase this page did not start, or no longer waits on: a lost page, a redirect, a
   * purchase still on its way when the fan taps Pay. Resolves `free` when that payment turned out
   * over without a ticket and nothing was shown (a new purchase may start), `taken` otherwise.
   */
  const follow = useCallback(
    (purchase: PendingPurchase): Promise<Followed> => {
      resuming.current?.abort();
      const abort = new AbortController();
      resuming.current = abort;
      following.current = purchase.paymentIntentId;
      const { paymentIntentId } = purchase;
      const run = async (): Promise<Followed> => {
        try {
          const outcome = await resumeCheckout({
            paymentIntentId,
            authorized: purchase.authorized,
            signal: abort.signal,
            onSecuring: () => {
              inFlight.current = true;
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
            forget(paymentIntentId);
            router.replace(`/t/${encodeURIComponent(outcome.token)}`);
            return "taken";
          }
          inFlight.current = false;
          if (outcome.kind === "unresolved") {
            setOnItsWay(true);
            setStage({ kind: "unresolved" });
            return "taken";
          }
          forget(paymentIntentId);
          setOnItsWay(false);
          if (outcome.kind === "cancelled" || outcome.kind === "failed") {
            setStage({ kind: "ended", outcome });
            return "taken";
          }
          setStage(leaveWait);
          return "free";
        } catch (error: unknown) {
          // Aborted: the page left, or « Check again » started another follow-up.
          if (!isAbortError(error)) {
            inFlight.current = false;
            setStage(leaveWait);
          }
          return "taken";
        }
      };
      const done = run();
      const current = { paymentIntentId, done };
      pickup.current = current;
      void done.then(() => {
        if (pickup.current === current) pickup.current = null;
      });
      return done;
    },
    [onOpenChange, router, forget],
  );
  const followRef = useRef(follow);
  followRef.current = follow;

  // A purchase this browser started on this promo and did not see end, or the one a payment
  // redirect (3-D Secure) brings back: followed to its ticket.
  useEffect(() => {
    const purchase = purchaseToResume(window.location.search, pendingPurchase(slug));
    if (purchase === null) return;
    // Read once: a reload goes back to what this browser kept.
    known.current = purchase;
    rememberPurchase(slug, purchase);
    dropStripeReturnParams();
    void followRef.current(purchase);
  }, [slug]);

  const pay = useCallback(
    async (handle: PayHandle | null): Promise<void> => {
      // Locked from the first tap: a second tap must never start a second purchase.
      if (inFlight.current || stage.kind !== "review") return;
      inFlight.current = true;
      setStage({ kind: "paying" });

      // A purchase of this promo that may be authorized is followed to its end first: the sheet's
      // memory does not outlive the page, the browser's record does (review 1.2 across a reload).
      const before = beforePaying(
        pendingPurchase(slug) ?? known.current,
        memory.peek()?.paymentIntentId ?? null,
      );
      if (before.kind === "follow") {
        const current = pickup.current;
        const followed = await (current !== null &&
        current.paymentIntentId === before.purchase.paymentIntentId
          ? current.done
          : follow(before.purchase));
        if (followed === "taken") {
          // A wallet's own sheet may still be open: nothing is paid with it.
          handle?.fail();
          return;
        }
        // Over without a ticket: this tap is a new purchase.
        inFlight.current = true;
        if (memory.peek()?.paymentIntentId === before.purchase.paymentIntentId) memory.drop();
      }

      const abort = new AbortController();
      controller.current = abort;
      let secured = false;
      const paying: { id: string | null } = { id: null };
      try {
        const outcome = await runCheckout({
          slug,
          qty,
          validate: handle === null ? undefined : handle.submit,
          authorize:
            handle === null
              ? simulatedAuthorize
              : (checkout) => handle.confirm(checkout.clientSecret),
          memory,
          signal: abort.signal,
          onPayment: (checkout) => {
            paying.id = checkout.paymentIntentId;
            remember({ paymentIntentId: checkout.paymentIntentId, authorized: false });
          },
          onSecuring: () => {
            secured = true;
            if (paying.id !== null) remember({ paymentIntentId: paying.id, authorized: true });
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
          if (paying.id !== null) forget(paying.id);
          setOnItsWay(false);
          // Stays locked: the page is about to change.
          router.push(`/t/${encodeURIComponent(outcome.token)}`);
          return;
        }
        inFlight.current = false;
        if (outcome.kind === "unresolved") {
          // Kept, in this sheet and in the browser: the next tap or visit follows the same payment.
          following.current = paying.id;
          setOnItsWay(true);
          setStage({ kind: "unresolved" });
        } else if (outcome.kind === "refused" || (outcome.kind === "failed" && !secured)) {
          // A wallet's own sheet may still be open: it shows the failure too.
          handle?.fail();
          setStage({ kind: "review", error: outcome.message });
          // The sheet may have been closed while paying: the message must be seen.
          onOpenChange(true);
        } else {
          // Over without a ticket: nothing to pick up on the next visit.
          if (paying.id !== null) forget(paying.id);
          setOnItsWay(false);
          setStage({ kind: "ended", outcome });
        }
      } catch (error: unknown) {
        inFlight.current = false;
        handle?.fail();
        if (!isAbortError(error)) {
          setStage({ kind: "review", error: copy.common.genericError });
          onOpenChange(true);
        }
      }
    },
    [stage.kind, slug, qty, memory, onOpenChange, router, follow, remember, forget],
  );

  const backToReview = useCallback((): void => setStage({ kind: "review" }), []);
  const amount = formatMoney(total);
  const checkAgain = useCallback((): void => {
    const paymentIntentId = following.current;
    if (paymentIntentId === null) {
      setStage({ kind: "review" });
      return;
    }
    void follow({ paymentIntentId, authorized: true });
  }, [follow]);
  const showScreen =
    stage.kind === "securing" || stage.kind === "ended" || stage.kind === "unresolved";

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
          {onItsWay ? (
            <p role="status" className="text-center text-body text-muted">
              {copy.checkout.stillOnItsWay}
            </p>
          ) : null}
          {!canPay && !(stage.kind === "review" && stage.error !== undefined) ? (
            <p role="status" className="text-center text-body text-muted">
              {lockedMessage}
            </p>
          ) : null}

          <PaymentArea
            amountCents={Number(total / 10_000n)}
            amount={amount}
            method={method}
            express={express}
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
          ) : stage.kind === "unresolved" ? (
            <div role="alert" className="relative flex w-full flex-col items-center gap-6">
              <div className="flex flex-col items-center gap-2">
                <h2 id={titleId} className="text-promise">
                  {copy.checkout.unresolvedTitle}
                </h2>
                <p className="text-body text-muted">{copy.checkout.unresolvedBody}</p>
              </div>
              <div className="flex w-full flex-col gap-3">
                <Button onClick={checkAgain}>{copy.checkout.checkAgain}</Button>
                <Button variant="dark" onClick={backToReview}>
                  {copy.checkout.backToPromo}
                </Button>
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
