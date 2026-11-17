import { apiRoute } from "@/lib/server/api-route";
import { confirmCheckout } from "@/lib/server/checkout";

export const dynamic = "force-dynamic";

export const POST = apiRoute("confirmCheckout", ({ params }, deps) =>
  confirmCheckout(deps.db, deps.payments, params.pi ?? ""),
);
