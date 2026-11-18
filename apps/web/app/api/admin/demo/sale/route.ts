import { apiRoute } from "@/lib/server/api-route";
import { replayDemoSale } from "@/lib/server/demo";

export const dynamic = "force-dynamic";

// Worst case: the sale written, then up to 8 s waiting for the engine's ticket (DEMO_SALE_WAIT,
// polled every 250 ms). 15 s.
export const maxDuration = 15;

export const POST = apiRoute("demoSale", ({ body }, deps) =>
  replayDemoSale(deps.db, body, deps.now(), deps.demoSaleWait),
);
