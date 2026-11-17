import { apiRoute } from "@/lib/server/api-route";
import { ticketByToken } from "@/lib/server/tickets";

export const dynamic = "force-dynamic";

export const GET = apiRoute("ticketByToken", ({ params }, deps) =>
  ticketByToken(deps.db, params.token ?? "", deps.now()),
);
