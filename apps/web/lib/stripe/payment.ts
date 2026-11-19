import { copy } from "@/lib/copy";

/**
 * The two Stripe calls of a payment, written against the small part of Stripe's objects they use,
 * so they can be tested with fakes and so the screens keep one way to read the outcome.
 *
 * The order, with Elements in deferred mode (no PaymentIntent exists while the shopper fills in the
 * form): `submitPayment` validates the form (and must run first, before any request), the screen
 * then asks the back end for the PaymentIntent, and `confirmIntent` pays or authorizes it.
 */

export type PaymentResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      /**
       * The PaymentIntent is cancelled at Stripe (`canceled`: the engine cancelled the authorization,
       * or it expired). That is final: no attempt can pay it any more, a new one has to be created.
       * Absent for every other failure (a declined card leaves the intent payable with another one).
       */
      ended?: true;
    };

interface StripeError {
  message?: string;
}

export interface ElementsLike {
  submit: () => Promise<{ error?: StripeError }>;
}

interface IntentLike {
  status: string;
}

export interface StripeLike {
  retrievePaymentIntent: (
    clientSecret: string,
  ) => Promise<{ error?: StripeError; paymentIntent?: IntentLike }>;
  confirmPayment: (options: {
    elements: never;
    clientSecret: string;
    confirmParams: {
      return_url: string;
      payment_method_data?: { billing_details: { email: string } };
    };
    redirect: "if_required";
  }) => Promise<{ error?: StripeError; paymentIntent?: IntentLike }>;
}

/**
 * Where a PaymentIntent is once the card has done its part: authorized and waiting for the capture
 * (`requires_capture`, the fan's purchase), paid (`succeeded`, the merchant's budget) or paid and on
 * its way (`processing`).
 */
const DONE: ReadonlySet<string> = new Set(["requires_capture", "succeeded", "processing"]);

export function isAuthorizedStatus(status: string): boolean {
  return DONE.has(status);
}

/** Validates what the shopper typed. The message is Stripe's own ("Your card number is incomplete."). */
export async function submitPayment(elements: ElementsLike): Promise<PaymentResult> {
  const { error } = await elements.submit();
  return error === undefined
    ? { ok: true }
    : { ok: false, message: error.message ?? copy.checkout.failed };
}

export interface ConfirmInput {
  stripe: StripeLike;
  elements: unknown;
  clientSecret: string;
  /** The e-mail typed next to a card (the wallets give theirs themselves). */
  email?: string;
  /** Where a payment that needs a redirect would come back to; none of ours does. */
  returnUrl: string;
}

/** The intent's status, or `undefined` when Stripe cannot be read (offline, an error). */
async function readStatus(stripe: StripeLike, clientSecret: string): Promise<string | undefined> {
  try {
    const { paymentIntent } = await stripe.retrievePaymentIntent(clientSecret);
    return paymentIntent?.status;
  } catch {
    return undefined;
  }
}

const ENDED: PaymentResult = { ok: false, message: copy.checkout.failed, ended: true };

/**
 * Authorizes (fan) or pays (merchant budget) the PaymentIntent. A PaymentIntent that is already
 * authorized or paid (the same request sent again) counts as done and is not confirmed twice; one
 * that was cancelled is not payable (`ended`). `redirect: "if_required"`: a card never leaves the
 * page.
 *
 * When the confirmation answers an error or throws, the card may have been authorized all the same
 * (the answer lost on its way back, a second confirmation of an intent the first already
 * authorized): the intent is read once more, and an authorized one (`requires_capture`) or one
 * already beyond (`processing`, `succeeded`) is a success (review 1.3). Anything else stays the
 * failure Stripe gave, with Stripe's words.
 */
export async function confirmIntent({
  stripe,
  elements,
  clientSecret,
  email,
  returnUrl,
}: ConfirmInput): Promise<PaymentResult> {
  const knownStatus = await readStatus(stripe, clientSecret);
  if (knownStatus !== undefined) {
    if (isAuthorizedStatus(knownStatus)) return { ok: true };
    if (knownStatus === "canceled") return ENDED;
  }

  let message: string = copy.checkout.failed;
  try {
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements: elements as never,
      clientSecret,
      confirmParams: {
        return_url: returnUrl,
        ...(email === undefined ? {} : { payment_method_data: { billing_details: { email } } }),
      },
      redirect: "if_required",
    });
    if (error === undefined) {
      if (paymentIntent !== undefined && isAuthorizedStatus(paymentIntent.status)) {
        return { ok: true };
      }
      return { ok: false, message: copy.checkout.failed };
    }
    message = error.message ?? copy.checkout.failed;
  } catch {
    // Stripe.js itself failed (the network dropped mid-request): read the intent below.
  }

  const afterStatus = await readStatus(stripe, clientSecret);
  if (afterStatus !== undefined) {
    if (isAuthorizedStatus(afterStatus)) return { ok: true };
    if (afterStatus === "canceled") return ENDED;
  }
  return { ok: false, message };
}
