import { apiRoute } from "@/lib/server/api-route";
import { startCheckout } from "@/lib/server/checkout";

export const dynamic = "force-dynamic";

export const POST = apiRoute("checkout", ({ body }, deps) =>
  startCheckout(deps.db, deps.payments, body, deps.now()),
);
