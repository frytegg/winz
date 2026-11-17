import { apiRoute } from "@/lib/server/api-route";
import { replayDemoSale } from "@/lib/server/demo";

export const dynamic = "force-dynamic";

export const POST = apiRoute("demoSale", ({ body }, deps) =>
  replayDemoSale(deps.db, body, deps.now(), deps.demoSaleWait),
);
