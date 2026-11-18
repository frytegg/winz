import { apiRoute } from "@/lib/server/api-route";
import { handleStripeWebhook } from "@/lib/server/stripe-webhook";

export const dynamic = "force-dynamic";

// Worst case, a top-up's failure event: the intent read back (Stripe's default client: 15 s, 2
// retries, about 47 s), cancelled (10 s, 1 retry, about 21 s) and read again when Stripe refuses
// for its state (47 s): about 114 s. 120 s fits every plan with Fluid compute (Hobby: 300 s).
export const maxDuration = 120;

// The signature covers the raw body: it is read here as text, never parsed before verification.
export const POST = apiRoute("stripeWebhook", async ({ request }, deps) =>
  handleStripeWebhook(
    deps.db,
    deps.payments,
    await request.text(),
    request.headers.get("stripe-signature"),
  ),
);
