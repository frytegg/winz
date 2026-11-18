import { apiRoute } from "@/lib/server/api-route";
import { confirmCheckout } from "@/lib/server/checkout";

export const dynamic = "force-dynamic";

// Worst case: the PaymentIntent read once with Stripe's default client (15 s, 2 retries: about
// 47 s), then the purchase recorded in one transaction. 60 s.
export const maxDuration = 60;

export const POST = apiRoute("confirmCheckout", ({ params }, deps) =>
  confirmCheckout(deps.db, deps.payments, params.pi ?? ""),
);
