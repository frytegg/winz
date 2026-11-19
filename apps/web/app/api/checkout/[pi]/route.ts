import { apiRoute } from "@/lib/server/api-route";
import { pollCheckoutStatus } from "@/lib/server/checkout";

export const dynamic = "force-dynamic";

// Worst case: a payment still `requires_payment` five seconds after it was created or last
// looked at, so this poll reads its PaymentIntent once with Stripe's default client (15 s, 2
// retries with their back-off: about 47 s), then records the purchase in one transaction and
// reads the row. 60 s, as the confirmation. Every other poll is two short queries.
export const maxDuration = 60;

export const GET = apiRoute("checkoutStatus", ({ params }, deps) =>
  pollCheckoutStatus(deps.db, deps.payments, params.pi ?? ""),
);
