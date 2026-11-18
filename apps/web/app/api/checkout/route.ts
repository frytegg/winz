import { apiRoute } from "@/lib/server/api-route";
import { startCheckout } from "@/lib/server/checkout";

export const dynamic = "force-dynamic";

// Worst case: one PaymentIntent created with Stripe's default client (15 s, 2 retries with their
// back-off: about 47 s) after a few short queries. 60 s.
export const maxDuration = 60;

export const POST = apiRoute("checkout", ({ body }, deps) =>
  startCheckout(deps.db, deps.payments, body, deps.now()),
);
