import { apiRoute } from "@/lib/server/api-route";
import { requireMerchant } from "@/lib/server/auth";
import { createCampaign } from "@/lib/server/campaign-writes";
import { listCampaigns } from "@/lib/server/campaigns";

export const dynamic = "force-dynamic";

export const POST = apiRoute("createCampaign", ({ principal, body }, deps) =>
  createCampaign(deps.db, deps.payments, requireMerchant(principal).merchantId, body, deps.now()),
);
export const GET = apiRoute("campaigns", ({ principal }, deps) =>
  listCampaigns(deps.db, requireMerchant(principal).merchantId, deps.now()),
);
