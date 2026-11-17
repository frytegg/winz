import { apiRoute } from "@/lib/server/api-route";
import { resetDemo } from "@/lib/server/demo";

export const dynamic = "force-dynamic";

export const POST = apiRoute("demoReset", (_context, deps) => resetDemo(deps.db));
