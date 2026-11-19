import { loadStripe, type Stripe } from "@stripe/stripe-js";

/**
 * Stripe.js, loaded once. Only a test key (`pk_test_…`) is accepted: the back end refuses the live
 * ones too, and a page that quietly used a live key would charge real cards.
 */
export function stripePublishableKey(): string | null {
  // The literal `process.env.NEXT_PUBLIC_…` is what lets Next put the value into the browser bundle.
  const key = (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "").trim();
  return key.startsWith("pk_test_") ? key : null;
}

let loading: Promise<Stripe | null> | null = null;

/** Stripe.js, or `null` when there is no usable test key or the script could not load. */
export function getStripe(): Promise<Stripe | null> {
  const key = stripePublishableKey();
  if (key === null) return Promise.resolve(null);
  loading ??= loadStripe(key).catch(() => {
    // The script was blocked or offline: allow another try on the next payment.
    loading = null;
    return null;
  });
  return loading;
}
