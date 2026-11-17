import { apiRoute } from "@/lib/server/api-route";
import { requireMerchant } from "@/lib/server/auth";
import { pauseCampaign } from "@/lib/server/campaign-writes";

export const dynamic = "force-dynamic";

export const POST = apiRoute("pauseCampaign", ({ principal, params }, deps) =>
  pauseCampaign(deps.db, requireMerchant(principal).merchantId, params.id ?? "", deps.now()),
);
