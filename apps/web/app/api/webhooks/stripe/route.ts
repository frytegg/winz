import { apiRoute } from "@/lib/server/api-route";
import { handleStripeWebhook } from "@/lib/server/stripe-webhook";

export const dynamic = "force-dynamic";

// The signature covers the raw body: it is read here as text, never parsed before verification.
export const POST = apiRoute("stripeWebhook", async ({ request }, deps) =>
  handleStripeWebhook(
    deps.db,
    deps.payments,
    await request.text(),
    request.headers.get("stripe-signature"),
  ),
);
