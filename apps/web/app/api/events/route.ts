import { apiRoute } from "@/lib/server/api-route";
import { listEvents } from "@/lib/server/events";

export const dynamic = "force-dynamic";

export const GET = apiRoute("events", ({ query }, deps) => listEvents(deps.db, query, deps.now()));
