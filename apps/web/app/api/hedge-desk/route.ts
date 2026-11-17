import { apiRoute } from "@/lib/server/api-route";
import { hedgeDesk } from "@/lib/server/hedge-desk";

export const dynamic = "force-dynamic";

export const GET = apiRoute("hedgeDesk", (_context, deps) =>
  hedgeDesk(deps.db, deps.config().executionVenue),
);
