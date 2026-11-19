"use client";

import type { Stripe, StripeElementsOptionsMode } from "@stripe/stripe-js";
import {
  Elements,
  ExpressCheckoutElement,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { copy } from "@/lib/copy";
import { getStripe, stripePublishableKey } from "@/lib/stripe/client";
import {
  confirmIntent,
  submitPayment,
  type ElementsLike,
  type PaymentResult,
  type StripeLike,
} from "@/lib/stripe/payment";
import { cn } from "@/lib/utils";

/**
 * What a screen gets when the shopper taps pay (a wallet's own button, or the card form's). The
 * screen runs its own steps around it and calls these in order: `submit` first (it validates the
 * form, before any request), then the back end creates the payment, then `confirm`.
 */
export interface PayHandle {
  submit: () => Promise<PaymentResult>;
  confirm: (clientSecret: string) => Promise<PaymentResult>;
  /** Tells a wallet's open sheet that the payment failed, so it shows it. No-op for a card. */
  fail: () => void;
}

/** The look of Stripe's fields: the dark card of the app, white text, the lime accent. */
const APPEARANCE: NonNullable<StripeElementsOptionsMode["appearance"]> = {
  theme: "night",
  variables: {
    colorPrimary: "#d8fe35",
    colorBackground: "#2a2a2d",
    colorText: "#ffffff",
    colorTextSecondary: "#a1a1aa",
    colorDanger: "#ff5a5f",
    borderRadius: "16px",
    spacingUnit: "4px",
    fontSizeBase: "16px",
  },
};

/**
 * Only a card (and the wallets that are cards) pays a promo. The PaymentIntent the back end creates
 * accepts every method enabled in the Stripe dashboard (automatic payment methods), and Stripe refuses an
 * allow-list next to those, so the ones that would take the shopper off the page are excluded here.
 * Turning them off in the dashboard (Settings, Payment methods) is the real switch.
 */
const EXCLUDED_METHODS = [
  "amazon_pay",
  "cashapp",
  "klarna",
  "affirm",
  "afterpay_clearpay",
  "us_bank_account",
  "paypal",
  "revolut_pay",
];

/** The one Stripe load, read by the elements below. */
function useStripeLoad(): { stripe: Promise<Stripe | null>; usable: boolean } {
  const stripe = useMemo(() => getStripe(), []);
  return { stripe, usable: stripePublishableKey() !== null };
}

/**
 * Stripe's Elements for one amount, in deferred mode: the shopper fills in the form before the
 * back end has created the payment, so the amount and the capture method are set here and must be
 * the ones of the PaymentIntent the back end creates. A fan's purchase is authorized and captured
 * later (`manual`); a merchant's budget is paid at once (`automatic`).
 */
export function StripeElements({
  amountCents,
  captureMethod,
  children,
}: {
  amountCents: number;
  captureMethod: "manual" | "automatic";
  children: ReactNode;
}): React.JSX.Element {
  const { stripe, usable } = useStripeLoad();
  if (!usable) {
    return (
      <p role="alert" className="px-2 text-center text-body text-danger">
        {copy.checkout.unavailable}
      </p>
    );
  }
  return (
    <Elements
      // The capture method cannot change on a mounted Elements: another one is another instance.
      key={captureMethod}
      stripe={stripe}
      options={{
        mode: "payment",
        amount: amountCents,
        currency: "usd",
        captureMethod,
        excludedPaymentMethodTypes: EXCLUDED_METHODS,
        locale: "en",
        appearance: APPEARANCE,
      }}
    >
      {children}
    </Elements>
  );
}

function usePayHandle(email: string | undefined, fail: () => void): PayHandle | null {
  const stripe = useStripe();
  const elements = useElements();
  return useMemo(() => {
    if (stripe === null || elements === null) return null;
    return {
      submit: () => submitPayment(elements as unknown as ElementsLike),
      confirm: (clientSecret) =>
        confirmIntent({
          stripe: stripe as unknown as StripeLike,
          elements,
          clientSecret,
          email,
          returnUrl: window.location.href,
        }),
      fail,
    };
  }, [stripe, elements, email, fail]);
}

/**
 * Apple Pay and Google Pay, in Stripe's Express Checkout Element. Where neither is available (a
 * page that is not HTTPS on a registered domain, a browser without a wallet) `onUnavailable` is
 * called and nothing is drawn, so the screen can offer the card instead.
 */
export function WalletButton({
  askEmail,
  locked,
  onPay,
  onUnavailable,
}: {
  /** The wallet asks for the e-mail (`emailRequired`): the fan's tickets are kept under it. */
  askEmail: boolean;
  /** The promo cannot take payments now: the button is shown but does nothing. */
  locked: boolean;
  onPay: (handle: PayHandle) => void;
  onUnavailable?: () => void;
}): React.JSX.Element | null {
  const [ready, setReady] = useState<"loading" | "shown" | "none">("loading");
  const noop = useCallback(() => undefined, []);
  const handle = usePayHandle(undefined, noop);

  useEffect(() => {
    if (ready === "none") onUnavailable?.();
  }, [ready, onUnavailable]);

  if (ready === "none") return null;
  return (
    <div
      className={cn("relative", locked && "pointer-events-none opacity-50")}
      aria-disabled={locked || undefined}
    >
      {ready === "loading" ? <Skeleton className="absolute inset-0 h-[55px] rounded-full" /> : null}
      <ExpressCheckoutElement
        options={{
          emailRequired: askEmail,
          buttonHeight: 55,
          buttonType: { applePay: "buy", googlePay: "buy" },
          paymentMethods: {
            applePay: "auto",
            googlePay: "auto",
            link: "never",
            amazonPay: "never",
            paypal: "never",
          },
        }}
        onReady={({ availablePaymentMethods }) => {
          const any =
            availablePaymentMethods !== undefined &&
            Object.values(availablePaymentMethods).some(Boolean);
          setReady(any ? "shown" : "none");
        }}
        onConfirm={(event) => {
          if (handle === null || locked) {
            event.paymentFailed({ reason: "fail" });
            return;
          }
          onPay({ ...handle, fail: () => event.paymentFailed({ reason: "fail" }) });
        }}
      />
    </div>
  );
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A card: Stripe's Payment Element (card only), the e-mail for a fan, and the pay button. */
export function CardForm({
  askEmail,
  payLabel,
  busy,
  locked,
  onPay,
}: {
  askEmail: boolean;
  payLabel: string;
  busy: boolean;
  locked: boolean;
  onPay: (handle: PayHandle) => void;
}): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [cardReady, setCardReady] = useState(false);
  const noop = useCallback(() => undefined, []);
  const trimmed = email.trim();
  const handle = usePayHandle(askEmail ? trimmed : undefined, noop);

  function pay(): void {
    if (handle === null) return;
    if (askEmail && !EMAIL_PATTERN.test(trimmed)) {
      setEmailError(copy.checkout.emailInvalid);
      return;
    }
    setEmailError(undefined);
    onPay(handle);
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        pay();
      }}
    >
      {askEmail ? (
        <Field
          label={copy.checkout.emailLabel}
          hint={copy.checkout.emailHint}
          error={emailError}
          type="email"
          name="email"
          inputMode="email"
          autoComplete="email"
          enterKeyHint="next"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setEmailError(undefined);
          }}
        />
      ) : null}
      <div className="min-h-[7.5rem]">
        {cardReady ? null : <Skeleton className="h-28 rounded-card-sm" />}
        <PaymentElement
          onReady={() => setCardReady(true)}
          options={{
            layout: "tabs",
            // A fan's e-mail is asked by the form above and passed when the payment is confirmed; for
            // anyone else Stripe asks for it itself, as it must be passed one way or the other.
            ...(askEmail ? { fields: { billingDetails: { email: "never" as const } } } : {}),
            wallets: { applePay: "never", googlePay: "never", link: "never" },
          }}
        />
      </div>
      <Button
        type="submit"
        variant="white"
        loading={busy}
        disabled={locked || handle === null || !cardReady}
      >
        {payLabel}
      </Button>
    </form>
  );
}
