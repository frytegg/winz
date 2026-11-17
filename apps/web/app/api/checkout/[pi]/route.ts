import { apiRoute } from "@/lib/server/api-route";
import { checkoutStatus } from "@/lib/server/checkout";

export const dynamic = "force-dynamic";

export const GET = apiRoute("checkoutStatus", ({ params }, deps) =>
  checkoutStatus(deps.db, params.pi ?? ""),
);
