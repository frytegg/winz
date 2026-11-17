import { apiRoute } from "@/lib/server/api-route";
import { requireMerchant } from "@/lib/server/auth";
import { listCampaigns } from "@/lib/server/campaigns";

export const dynamic = "force-dynamic";

// Not implemented yet (A-02, write side): answers 501 outside mock mode.
export const POST = apiRoute("createCampaign");
export const GET = apiRoute("campaigns", ({ principal }, deps) =>
  listCampaigns(deps.db, requireMerchant(principal).merchantId, deps.now()),
);
