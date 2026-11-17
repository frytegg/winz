import { apiRoute } from "@/lib/server/api-route";
import { forceDemoResult } from "@/lib/server/demo";

export const dynamic = "force-dynamic";

export const POST = apiRoute("demoResult", ({ body }, deps) => forceDemoResult(deps.db, body));
