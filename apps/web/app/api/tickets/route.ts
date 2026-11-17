import { apiRoute } from "@/lib/server/api-route";
import { requireUser } from "@/lib/server/auth";
import { myTickets } from "@/lib/server/tickets";

export const dynamic = "force-dynamic";

export const GET = apiRoute("tickets", ({ principal }, deps) =>
  myTickets(deps.db, requireUser(principal).walletAddress, deps.now()),
);
